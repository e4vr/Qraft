import { api, setApiCache } from '@/lib/api-client';
import type {
  AppUser,
  CollaborationState,
} from '@/lib/medguard-types';

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

export async function saveCollaborationState(
  next: CollaborationState,
  previous: CollaborationState,
): Promise<void> {
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
  collect('auditLog', next.auditLog, previous.auditLog, (item) => item.id);

  const operations = [...deletes, ...writes];
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
