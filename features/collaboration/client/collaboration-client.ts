import { ApiError, api, apiTransport, setApiCache } from '@/lib/api-client';
import { policyFor, readThrough, resourceKey, resourceCacheGeneration } from '@/lib/resource-data';
import { applyCollaborationDelta, type CollaborationReadResponse } from '../domain/collaboration-delta';
import type { AppUser, CollaborationState } from '@/lib/medguard-types';
import {
  acknowledgeCollaborationSync,
  acknowledgeCollaborationProposalDeletes,
  acknowledgeCollaborationProposalEdits,
  archiveCompletedCollaborationEdits,
  loadRejectedCollaboration,
  enqueueCollaborationSync,
  loadCollaborationSyncOutbox,
  noteCollaborationSyncAttempt,
  preserveRejectedCollaboration,
  loadConfirmedCollaboration,
  saveConfirmedCollaboration,
  type ConfirmedCollaborationSnapshot,
} from '@/lib/local-db';
import { withStateSyncLock } from '@/lib/tab-sync';
import type { CollaborationSyncSnapshot } from '../domain/collaboration-outbox';
import { collaborationBaseHash, collaborationValue, sameCollaborationValue } from '../domain/collaboration-values';
import { collaborationBatchFits, proposalDeleteOperations, splitProposalDeleteGroup, withoutProposals } from '../domain/proposal-delete-recovery';
import { completedPendingEditReceipts, pendingProposalEditOperations, planPendingProposalEditRecovery } from '../domain/proposal-edit-recovery';
import { savePendingContribution } from '@/features/contributions/client/pending-contribution';

export const COLLABORATION_SYNC_NOTICE = 'qraft-collaboration-sync';
export type CollaborationSyncNotice = {
  uid: string;
  local: CollaborationState;
  confirmed: CollaborationState;
  rejected: number;
};

type CollaborationResponse = { collaboration: CollaborationState };

let collaborationScope = '';
const confirmedReads = new Map<string, ConfirmedCollaborationSnapshot>();
let confirmedGeneration = resourceCacheGeneration();

function collaborationRequest(user: AppUser, force = false) {
  collaborationScope = user.uid;
  if (confirmedGeneration !== resourceCacheGeneration()) {
    confirmedReads.clear();
    confirmedGeneration = resourceCacheGeneration();
  }
  const generation = confirmedGeneration;
  return readThrough<CollaborationResponse>({
    key: resourceKey('/collaboration', 'GET', undefined, user.uid),
    tags: policyFor('/collaboration').tags,
    force,
    reason: force ? 'explicit-refresh' : undefined,
    load: async reason => {
      const base = confirmedReads.get(user.uid) ?? await loadConfirmedCollaboration(user.uid).catch(() => undefined);
      const valid = base?.cursor?.version === 1 && base.cursor.uid === user.uid && Boolean(base.cursor.scope);
      const path = valid ? `/collaboration?since=${base.cursor.sequence}&syncUid=${encodeURIComponent(user.uid)}&syncScope=${encodeURIComponent(base.cursor.scope)}` : '/collaboration';
      const response = await apiTransport<CollaborationReadResponse>(path, { expectedUserId: user.uid }, reason);
      // Plain full snapshots keep older servers compatible during rollout.
      const snapshot: ConfirmedCollaborationSnapshot = 'delta' in response && base
        ? { collaboration: applyCollaborationDelta(base.collaboration, response.delta), cursor: response.delta.cursor }
        : response as ConfirmedCollaborationSnapshot;
      if (resourceCacheGeneration() === generation && snapshot.cursor?.uid === user.uid) {
        // Persistence failure leaves the old cursor, so changes are replayed.
        await saveConfirmedCollaboration(user.uid, snapshot).then(() => {
          if (resourceCacheGeneration() === generation) confirmedReads.set(user.uid, snapshot);
        }).catch(() => undefined);
      }
      return { collaboration: snapshot.collaboration };
    },
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
    baseValue: unknown;
    value: unknown;
    type: 'set';
  }> = [];
  const deletes: Array<{
    collection: string;
    id: string;
    baseValue: unknown;
    type: 'delete';
  }> = [];
  const collect = <T>(
    collection: string,
    values: T[],
    old: T[],
    key: (item: T) => string,
    deleteMissing = false,
  ) => {
    const baseValues = new Map<string, T>();
    for (const item of old) {
      const id = key(item);
      if (!baseValues.has(id)) baseValues.set(id, item);
    }
    changed(values, old, key).forEach((item) =>
      writes.push({
        collection,
        id: key(item),
        baseValue: baseValues.get(key(item)) ?? null,
        value: item,
        type: 'set',
      }),
    );
    if (deleteMissing) {
      const currentKeys = new Set(values.map(key));
      old
        .filter((item) => !currentKeys.has(key(item)))
        .forEach((item) =>
          deletes.push({ collection, id: key(item), type: 'delete', baseValue: item }),
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
        baseValue: null,
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
        baseValue: null,
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
  if (
    JSON.stringify(next.blockedAccess) !==
    JSON.stringify(previous.blockedAccess)
  ) {
    writes.push({
      collection: 'system',
      id: 'accessControl',
      baseValue: previous.blockedAccess,
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
  collect('qbankTopics', next.topics, previous.topics, (item) => item.id, true);
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
  const deletedBanks = new Set(
    deletes
      .filter((item) => item.collection === 'qbanks')
      .map((item) => item.id),
  );
  return [...deletes, ...writes].filter((operation) => {
    if (operation.type !== 'delete' || operation.collection === 'qbanks')
      return true;
    const bank = operationBankId(operation, previous);
    return !bank || !deletedBanks.has(bank);
  });
}

type CollaborationOperation = ReturnType<typeof collaborationChangeSet>[number];

async function sendCollaborationOperations(uid: string, batch: CollaborationOperation[]) {
  const operations = await Promise.all(batch.map(async ({ baseValue, ...operation }) => ({
    ...operation,
    ...(operation.collection === 'answerStats' && operation.type === 'set' ? {} : { baseHash: await collaborationBaseHash(baseValue) }),
  })));
  const result = await api<{ ok?: boolean }>('/collaboration', {
    method: 'PUT', expectedUserId: uid, body: JSON.stringify({ operations }),
  });
  if (result.ok !== true) throw new ApiError('The server did not confirm your changes. They remain saved locally.', 502, {});
  await acknowledgeCollaborationProposalDeletes(uid, batch.filter(operation =>
    operation.collection === 'questionProposals' && operation.type === 'delete').map(operation => operation.id));
}

function operationBankId(
  operation: { collection: string; id: string; value?: unknown },
  state: CollaborationState,
): string | undefined {
  if (operation.collection === 'qbanks') return operation.id;
  const value = operation.value as { qbankId?: string } | undefined;
  if (value?.qbankId) return value.qbankId;
  if (operation.collection === 'qbankShareLinks')
    return state.qbanks.find((bank) => bank.shareToken === operation.id)?.id;
  const collections: Record<string, Array<{ id: string; qbankId?: string }>> = {
    qbankMemberships: state.memberships,
    qbankInvitations: state.invitations,
    questionProposals: state.proposals,
    sharedQuestions: state.approvedQuestions,
    qbankSpecialties: state.specialties,
    qbankTopics: state.topics,
  };
  if (operation.collection === 'answerStats')
    return state.answerStats[operation.id]?.qbankId;
  if (operation.collection === 'sharedNotes')
    return state.sharedNotes[operation.id]?.qbankId;
  return collections[operation.collection]?.find(
    (item) => item.id === operation.id,
  )?.qbankId;
}

async function sendCollaborationState(
  snapshot: CollaborationSyncSnapshot,
): Promise<{ confirmed: CollaborationState; rejected: number }> {
  const { uid, state: next, base: previous } = snapshot;
  const operations = collaborationChangeSet(next, previous).flatMap((operation) => {
    if (operation.collection !== 'answerStats' || operation.type !== 'set')
      return [operation];
    const value = operation.value as CollaborationState['answerStats'][string];
    const answer = value.selections[uid];
    // A refreshed aggregate may only contain other learners' changes. Missing
    // own answers are not answer removals and must never become empty patches.
    if (answer === undefined || answer === previous.answerStats[operation.id]?.selections[uid])
      return [];
    return [{
      ...operation,
      value: { ...value, selections: { [uid]: answer } },
    }];
  });
  if (!operations.length) return { confirmed: next, rejected: 0 };
  const groups = new Map<string, CollaborationOperation[]>();
  for (const operation of operations) {
    const key =
      operationBankId(operation, next) ??
      operationBankId(operation, previous) ??
      'administration';
    const items = groups.get(key) ?? [];
    items.push(operation);
    groups.set(key, items);
  }
  const rejectedGroups: Array<{ group: string; error: unknown }> = [];
  const pending: Array<[string, CollaborationOperation[]]> = [...groups].flatMap(([group, items]) =>
    splitProposalDeleteGroup(items).map(batch => [group, batch] as [string, CollaborationOperation[]]));
  const send = async (batch: CollaborationOperation[]) => {
    await sendCollaborationOperations(uid, batch);
    snapshot.base = withoutProposals(snapshot.base, new Set(batch.filter(operation =>
      operation.collection === 'questionProposals' && operation.type === 'delete').map(operation => operation.id)));
  };
  // Keep dependent operations together. On an authorization rejection, isolate
  // only the affected bank/group and preserve its entire draft for recovery.
  while (pending.length) {
    const batch: CollaborationOperation[] = [];
    const batchGroups: Array<[string, CollaborationOperation[]]> = [];
    while (pending.length) {
      const group = pending[0];
      const candidate = [...batch, ...group[1]];
      if (
        !collaborationBatchFits(candidate)
      ) {
        if (!batch.length) {
          pending.shift();
          const error =
            'This pending update exceeds the synchronization limit. Its draft is preserved for review.';
          await preserveRejectedCollaboration(snapshot, {
            group: group[0],
            error,
            operations: group[1],
          });
          rejectedGroups.push({ group: group[0], error });
          continue;
        }
        break;
      }
      pending.shift();
      batchGroups.push(group);
      batch.push(...group[1]);
    }
    if (!batch.length) continue;
    try {
      await send(batch);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 400 ||
          (error.status === 409 && error.payload.code !== 'ACCOUNT_CHANGED'))
      ) {
        // Validation/conflict failures are isolated at the same dependency
        // boundary; a malformed old draft must not poison another bank.
        for (const group of batchGroups) {
          try {
            await send(group[1]);
          } catch (groupError) {
            if (
              !(groupError instanceof ApiError) ||
              ![400, 403, 409].includes(groupError.status) ||
              groupError.payload.code === 'ACCOUNT_CHANGED'
            )
              throw groupError;
            await preserveRejectedCollaboration(snapshot, {
              group: group[0],
              error: groupError.payload,
              operations: group[1],
            });
            rejectedGroups.push({ group: group[0], error: groupError.payload });
          }
        }
        continue;
      }
      if (
        !(error instanceof ApiError) ||
        error.status !== 403 ||
        error.payload.code !== 'COLLABORATION_REJECTED' ||
        !Array.isArray(error.payload.rejected)
      )
        throw error;
      const denied = error.payload.rejected as Array<{
        collection: string;
        id: string;
      }>;
      const retry: Array<[string, CollaborationOperation[]]> = [];
      let isolated = 0;
      for (const group of batchGroups) {
        if (
          group[1].some((op) =>
            denied.some(
              (item) => item.collection === op.collection && item.id === op.id,
            ),
          )
        ) {
          await preserveRejectedCollaboration(snapshot, {
            group: group[0],
            error: error.payload,
            operations: group[1],
          });
          rejectedGroups.push({ group: group[0], error: error.payload });
          isolated++;
        } else retry.push(group);
      }
      if (!isolated) throw error;
      pending.unshift(...retry);
    }
  }
  // Reconciliation is a recovery read, not a periodic full refresh. It also
  // prevents an unsaved local bank from being advertised as server-confirmed.
  const confirmed = rejectedGroups.length
    ? (
        await api<CollaborationResponse>('/collaboration', {
          expectedUserId: uid,
          cacheScope: uid,
          forceRefresh: true,
          requestReason: 'explicit-refresh',
        })
      ).collaboration
    : next;
  if (collaborationScope === uid) {
    setApiCache(
      '/collaboration',
      { collaboration: confirmed },
      { cacheScope: uid },
    );
  }
  return { confirmed, rejected: rejectedGroups.length };
}

const collaborationFlushes = new Map<
  string,
  Promise<CollaborationState | undefined>
>();

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
  const pending = withStateSyncLock(`collaboration:${uid}`, async () => {
    let latest: CollaborationState | undefined;
    for (;;) {
      const operation = await loadCollaborationSyncOutbox(uid);
      if (!operation) return latest;
      await noteCollaborationSyncAttempt(uid, operation.id);
      const result = await sendCollaborationState(operation);
      const newer = await loadCollaborationSyncOutbox(uid);
      if (result.rejected && newer && newer.id !== operation.id)
        await preserveRejectedCollaboration(newer, {
          reason: 'Newer local draft preserved during reconciliation.',
        });
      await acknowledgeCollaborationSync(operation, result.confirmed);
      latest = result.confirmed;
      if (typeof window !== 'undefined')
        window.dispatchEvent(
          new CustomEvent<CollaborationSyncNotice>(COLLABORATION_SYNC_NOTICE, {
            detail: {
              uid,
              local: operation.state,
              confirmed: result.confirmed,
              rejected: result.rejected,
            },
          }),
        );
    }
  }).finally(() => collaborationFlushes.delete(uid));
  collaborationFlushes.set(uid, pending);
  return pending;
}

export async function saveCollaborationState(
  next: CollaborationState,
  previous: CollaborationState,
  uid = collaborationScope,
): Promise<CollaborationState> {
  if (!uid)
    throw new Error('Collaboration synchronization requires an account.');
  await queueCollaborationState(uid, next, previous);
  let confirmed = next;
  do {
    confirmed = (await flushPendingCollaborationState(uid)) ?? confirmed;
  } while (await loadCollaborationSyncOutbox(uid));
  return confirmed;
}

// Explicit manual retry: use only recorded contribution intents, never the full
// historic snapshot. Old snapshots also contain other banks and account data.
export async function retryRejectedCollaborationState(uid: string): Promise<CollaborationState | undefined> {
  return withStateSyncLock(`collaboration:${uid}`, async () => {
    const drafts = await loadRejectedCollaboration(uid);
    const groups = new Map<string, CollaborationOperation[]>();
    for (const draft of drafts) {
      if (draft.snapshot.uid !== uid) continue;
      for (const details of [draft.details, ...(draft.failures ?? [])]) {
        for (const operation of proposalDeleteOperations(details)) {
          const items = groups.get(operation.baseValue.qbankId) ?? [];
          if (!items.some(item => item.id === operation.id)) items.push(operation);
          groups.set(operation.baseValue.qbankId, items);
        }
      }
    }
    const hasEdits = drafts.some(draft => draft.snapshot.uid === uid &&
      [draft.details, ...(draft.failures ?? [])].some(details => pendingProposalEditOperations(details).some(operation => operation.baseValue.proposedById === uid)));
    if (!groups.size && !hasEdits) return undefined;
    const { collaboration } = await api<CollaborationResponse>('/collaboration', {
      expectedUserId: uid, cacheScope: uid, forceRefresh: true, requestReason: 'explicit-refresh',
    });
    let confirmed = collaboration;
    for (const items of groups.values()) {
      // A missing item may be hidden by revoked permissions. Let the server
      // confirm its deletion/no-op with the original hash before clearing it.
      const unchanged = items.filter(operation => {
        const current = collaborationValue(confirmed, operation.collection, operation.id);
        return current === undefined || sameCollaborationValue(current, operation.baseValue);
      });
      for (const batch of splitProposalDeleteGroup(unchanged)) {
        if (!collaborationBatchFits(batch)) continue;
        try {
          await sendCollaborationOperations(uid, batch);
          confirmed = withoutProposals(confirmed, new Set(batch.map(operation => operation.id)));
        } catch (error) {
          if (!(error instanceof ApiError) || ![400, 403, 409].includes(error.status) || error.payload.code === 'ACCOUNT_CHANGED') throw error;
          // Permission and concurrent-edit failures remain preserved for review.
          break;
        }
      }
    }
    for (const edit of planPendingProposalEditRecovery(uid, drafts, confirmed)) {
      try {
        const saved = edit.alreadyApplied ? edit.current : await savePendingContribution(uid, edit.current, edit.value.payload, edit.value.rationale);
        confirmed = { ...confirmed, proposals: confirmed.proposals.map(proposal => proposal.id === saved.id ? saved : proposal) };
        await acknowledgeCollaborationProposalEdits(uid, edit.receipts);
      } catch (error) {
        if (!(error instanceof ApiError) || ![400, 403, 409].includes(error.status) || error.payload.code === 'ACCOUNT_CHANGED') throw error;
        // A reviewed, changed or unauthorized proposal remains downloadable.
      }
    }
    await archiveCompletedCollaborationEdits(uid, completedPendingEditReceipts(uid, drafts, confirmed));
    if (collaborationScope === uid) setApiCache('/collaboration', { collaboration: confirmed }, { cacheScope: uid });
    return confirmed;
  });
}
