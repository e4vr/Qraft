import { api, setApiCache } from '@/lib/api-client';
import type {
  AppUser,
  CollaborationState,
} from '@/lib/medguard-types';
import {
  enqueueCollaborationSync,
  loadCollaborationSyncOutbox,
  noteCollaborationSyncAttempt,
  removeCollaborationSync,
} from '@/lib/local-db';

type CollaborationResponse = { collaboration: CollaborationState };

let collaborationScope = '';

function collaborationRequest(user: AppUser, force = false) {
  collaborationScope = user.uid;
  return api<CollaborationResponse>('/collaboration', {
    cacheScope: user.uid,
    forceRefresh: force,
    requestReason: force ? 'explicit-refresh' : undefined,
  });
}

function changed<T>(next: T[], previous: T[], key: (item: T) => string) {
  const old = new Map(
    previous.map((item) => [key(item), JSON.stringify(item)]),
  );
  return next.filter((item) => old.get(key(item)) !== JSON.stringify(item));
}

export async function loadCollaborationState(
  user: AppUser,
  force = false,
): Promise<CollaborationState> {
  return (await collaborationRequest(user, force)).collaboration;
}

export function collaborationChangeSet(
  next: CollaborationState,
  previous: CollaborationState,
) {
  const writes: Array<{
    collection: string;
    id: string;
    value: unknown;
    type: 'set';
  }> = [];
  const deletes: Array<{
    collection: string;
    id: string;
    type: 'delete';
  }> = [];
  const collect = <T>(
    collection: string,
    values: T[],
    old: T[],
    key: (item: T) => string,
    deleteMissing = false,
  ) => {
    changed(values, old, key).forEach((item) =>
      writes.push({
        collection,
        id: key(item),
        value: item,
        type: 'set',
      }),
    );
    if (deleteMissing) {
      const currentKeys = new Set(values.map(key));
      old
        .filter((item) => !currentKeys.has(key(item)))
        .forEach((item) =>
          deletes.push({ collection, id: key(item), type: 'delete' }),
        );
    }
  };

  collect('qbanks', next.qbanks, previous.qbanks, (item) => item.id, true);
  collect(
    'qbankFolders',
    next.qbankFolders,
    previous.qbankFolders,
    (item) => item.id,
    true,
  );
  changed(next.qbanks, previous.qbanks, (item) => item.id).forEach((bank) => {
    const oldBank = previous.qbanks.find((item) => item.id === bank.id);
    if (
      bank.shareToken &&
      (!oldBank ||
        oldBank.shareToken !== bank.shareToken ||
        oldBank.shareEnabled !== bank.shareEnabled)
    ) {
      writes.push({
        collection: 'qbankShareLinks',
        id: bank.shareToken,
        value: {
          id: bank.shareToken,
          qbankId: bank.id,
          bankName: bank.name,
          description: bank.description,
          ownerId: bank.ownerId,
          ownerName: bank.ownerName,
          enabled: bank.shareEnabled,
          updatedAt: new Date().toISOString(),
        },
        type: 'set',
      });
    }
  });
  previous.qbanks.forEach((oldBank) => {
    const nextBank = next.qbanks.find((item) => item.id === oldBank.id);
    if (oldBank.shareToken && oldBank.shareToken !== nextBank?.shareToken) {
      deletes.push({
        collection: 'qbankShareLinks',
        id: oldBank.shareToken,
        type: 'delete',
      });
    }
  });
  collect(
    'qbankMemberships',
    next.memberships,
    previous.memberships,
    (item) => item.id,
    true,
  );
  collect(
    'qbankInvitations',
    next.invitations,
    previous.invitations,
    (item) => item.id,
    true,
  );
  collect('profiles', next.members, previous.members, (item) => item.uid);
  collect(
    'universityIds',
    next.allowedUniversityIds,
    previous.allowedUniversityIds,
    (item) => item.id,
  );
  if (JSON.stringify(next.blockedAccess) !== JSON.stringify(previous.blockedAccess)) {
    writes.push({
      collection: 'system',
      id: 'accessControl',
      value: {
        id: 'accessControl',
        ...next.blockedAccess,
        updatedAt: new Date().toISOString(),
      },
      type: 'set',
    });
  }
  collect(
    'adminInvites',
    next.adminInvites,
    previous.adminInvites,
    (item) => item.id,
  );
  collect(
    'questionProposals',
    next.proposals,
    previous.proposals,
    (item) => item.id,
    true,
  );
  collect(
    'roleApplications',
    next.roleApplications,
    previous.roleApplications,
    (item) => item.id,
  );
  collect(
    'sharedQuestions',
    next.approvedQuestions,
    previous.approvedQuestions,
    (item) => item.id,
    true,
  );
  collect(
    'qbankSpecialties',
    next.specialties,
    previous.specialties,
    (item) => item.id,
    true,
  );
  collect(
    'qbankTopics',
    next.topics,
    previous.topics,
    (item) => item.id,
    true,
  );
  collect(
    'answerStats',
    Object.values(next.answerStats),
    Object.values(previous.answerStats),
    (item) => item.id,
    true,
  );
  collect(
    'sharedNotes',
    Object.values(next.sharedNotes),
    Object.values(previous.sharedNotes),
    (item) => item.id,
    true,
  );
  // Audit entries are written by the server after a mutation is authorized.
  // Client-authored audit entries would make the entire change set fail with 403.
  return [...deletes, ...writes];
}

async function sendCollaborationState(
  next: CollaborationState,
  previous: CollaborationState,
): Promise<void> {
  const operations = collaborationChangeSet(next, previous);
  if (operations.length) {
    await api('/collaboration', {
      method: 'PUT',
      body: JSON.stringify({ operations }),
    });
    if (collaborationScope) {
      setApiCache(
        '/collaboration',
        { collaboration: next },
        { cacheScope: collaborationScope },
      );
    }
  }
}

const collaborationFlushes = new Map<string, Promise<CollaborationState | undefined>>();

export async function queueCollaborationState(
  uid: string,
  next: CollaborationState,
  previous: CollaborationState,
): Promise<void> {
  await enqueueCollaborationSync({
    id: crypto.randomUUID(),
    uid,
    base: previous,
    state: next,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
}

export async function flushPendingCollaborationState(
  uid: string,
): Promise<CollaborationState | undefined> {
  const active = collaborationFlushes.get(uid);
  if (active) return active;
  const pending = (async () => {
    let latest: CollaborationState | undefined;
    for (;;) {
      const operation = await loadCollaborationSyncOutbox(uid);
      if (!operation) return latest;
      await noteCollaborationSyncAttempt(uid, operation.id);
      await sendCollaborationState(operation.state, operation.base);
      await removeCollaborationSync(uid, operation.id);
      latest = operation.state;
    }
  })().finally(() => collaborationFlushes.delete(uid));
  collaborationFlushes.set(uid, pending);
  return pending;
}

export async function saveCollaborationState(
  next: CollaborationState,
  previous: CollaborationState,
  uid = collaborationScope,
): Promise<void> {
  if (!uid) throw new Error('Collaboration synchronization requires an account.');
  await queueCollaborationState(uid, next, previous);
  do {
    await flushPendingCollaborationState(uid);
  } while (await loadCollaborationSyncOutbox(uid));
}
