import { normalizeCollaborationState, type AppState, type CollaborationState, type QBankSpecialty, type QBankTopic } from './medguard-types';
import type { PreformedLocalAttempt } from './preformed-test-types';
import { coalesceStateCheckpoints } from '@/features/state/domain/checkpoint-outbox';
import { mergeLiveState } from './merge-live-state';
import { acknowledgeRejectedProposalDeletes, withoutProposals, type RejectedCollaborationDraft } from '@/features/collaboration/domain/proposal-delete-recovery';
import { acknowledgeRejectedPendingEdits, type PendingEditReceipt } from '@/features/collaboration/domain/proposal-edit-recovery';
import { sameCollaborationValue } from '@/features/collaboration/domain/collaboration-values';
import { preformedAttemptKey, preformedCodeKey } from '@/features/exams/domain/preformed-attempt-scope';
import {
  coalesceCollaborationSync,
  type CollaborationSyncSnapshot,
} from '@/features/collaboration/domain/collaboration-outbox';

const DATABASE = 'medguard-qbank';
const STORE = 'key-value';

export type StateSyncKind = 'full' | 'exam' | 'flashcards' | 'daily-goal';

export interface StateSyncOperation {
  id: string;
  uid: string;
  kind: StateSyncKind;
  payload: Record<string, unknown>;
  baseRevision: number;
  createdAt: string;
  attempts: number;
}

export interface ClassificationDraft {
  qbankId: string;
  baseRevision: number;
  operationId: string;
  specialties: QBankSpecialty[];
  topics: QBankTopic[];
  assignments: Array<{ questionId: string; topicId: string }>;
  updatedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readValue<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function writeValue<T>(key: string, value: T, ownerUid?: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const uid = ownerUid ?? key.slice(key.indexOf(':') + 1);
    const marker = store.get(`deleted:${uid}`);
    marker.onsuccess = () => { if (!marker.result) store.put(value, key); };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Local save aborted.')); };
  });
}

async function updateValue<T>(
  key: string,
  update: (current: T | undefined) => T,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get(key);
    let next: T;
    request.onsuccess = () => {
      next = update(request.result as T | undefined);
      store.put(next, key);
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => { db.close(); resolve(next!); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Local save aborted.')); };
  });
}

export async function loadLocalState(uid: string): Promise<AppState | undefined> {
  return readValue<AppState>(`state:${uid}`);
}

export async function loadLocalCollaboration(uid: string): Promise<CollaborationState | undefined> {
  const state = await readValue<CollaborationState>(`collaboration:${uid}`);
  return state ? normalizeCollaborationState(state) : undefined;
}

export async function saveLocalCollaboration(state: CollaborationState, uid: string): Promise<void> {
  await writeValue(`collaboration:${uid}`, state);
}

export type ConfirmedCollaborationSnapshot = {
  collaboration: CollaborationState;
  cursor: import('@/features/collaboration/domain/collaboration-delta').CollaborationCursor;
};
export function loadConfirmedCollaboration(uid: string) {
  return readValue<ConfirmedCollaborationSnapshot>(`collaboration-confirmed:${uid}`);
}
export function saveConfirmedCollaboration(uid: string, snapshot: ConfirmedCollaborationSnapshot) {
  // Confirmed state and cursor are persisted together; drafts stay separate.
  return writeValue(`collaboration-confirmed:${uid}`, snapshot);
}

export async function saveLocalState(uid: string, state: AppState): Promise<void> {
  await writeValue(`state:${uid}`, state);
}

export async function loadClassificationDraft(uid: string, qbankId: string) {
  return readValue<ClassificationDraft>(`classification-draft:${uid}:${qbankId}`);
}

export async function saveClassificationDraft(uid: string, draft: ClassificationDraft): Promise<void> {
  await writeValue(`classification-draft:${uid}:${draft.qbankId}`, draft);
}

export async function deleteClassificationDraft(uid: string, qbankId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(`classification-draft:${uid}:${qbankId}`);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Local save aborted.')); };
  });
}

export async function loadPreformedAttempt(scope: string, testId: string, version: number) {
  return readValue<PreformedLocalAttempt>(preformedAttemptKey(scope, testId, version));
}

export async function loadPreformedAttemptByCode(scope: string, code: string) {
  const reference = await readValue<{ testId: string; version: number }>(preformedCodeKey(scope, code));
  return reference ? loadPreformedAttempt(scope, reference.testId, reference.version) : undefined;
}

export async function savePreformedAttempt(scope: string, attempt: PreformedLocalAttempt): Promise<void> {
  const uid = scope.startsWith('user:') ? scope.slice(5) : undefined;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const marker = store.get(`deleted:${uid}`);
    marker.onsuccess = () => {
      if (uid && marker.result) return;
      const key = preformedAttemptKey(scope, attempt.test.id, attempt.test.version);
      const existing = store.get(key);
      existing.onsuccess = () => {
        const current = existing.result as PreformedLocalAttempt | undefined;
        // A late timer/answer save cannot undo a queued submission or receipt.
        if (current?.submissionId === attempt.submissionId &&
            ((current?.submittedAt && !attempt.submittedAt) ||
             (current?.submissionPending && !attempt.submissionPending && !attempt.submittedAt))) return;
        store.put(attempt, key);
        store.put({ testId: attempt.test.id, version: attempt.test.version }, preformedCodeKey(scope, attempt.test.code));
      };
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Local save aborted.')); };
  });
}

export async function deletePreformedAttempt(scope: string, testId: string, version: number): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(preformedAttemptKey(scope, testId, version));
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Local save aborted.')); };
  });
}

export async function enqueueStateSync(operation: StateSyncOperation): Promise<void> {
  await updateValue<StateSyncOperation[]>(`state-outbox:${operation.uid}`, current => {
    return coalesceStateCheckpoints(current ?? [], operation);
  });
}

export async function loadStateSyncOutbox(uid: string): Promise<StateSyncOperation[]> {
  return (await readValue<StateSyncOperation[]>(`state-outbox:${uid}`)) ?? [];
}

export async function removeStateSync(uid: string, operationId: string): Promise<void> {
  await updateValue<StateSyncOperation[]>(`state-outbox:${uid}`, current =>
    (current ?? []).filter(item => item.id !== operationId),
  );
}

export async function noteStateSyncAttempt(uid: string, operationId: string): Promise<StateSyncOperation | undefined> {
  const pending = await updateValue<StateSyncOperation[]>(`state-outbox:${uid}`, current =>
    (current ?? []).map(item => item.id === operationId ? { ...item, attempts: item.attempts + 1 } : item),
  );
  return pending.find(item => item.id === operationId);
}

export async function enqueueCollaborationSync(
  operation: CollaborationSyncSnapshot,
): Promise<void> {
  await updateValue<CollaborationSyncSnapshot>(
    `collaboration-outbox:${operation.uid}`,
    current => coalesceCollaborationSync(current, operation),
  );
}

export async function loadCollaborationSyncOutbox(
  uid: string,
): Promise<CollaborationSyncSnapshot | undefined> {
  return readValue<CollaborationSyncSnapshot>(`collaboration-outbox:${uid}`);
}

export async function rebasePendingCollaboration(
  uid: string, patch: (state: CollaborationState) => CollaborationState,
): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const key = `collaboration-outbox:${uid}`;
    const request = store.get(key);
    request.onsuccess = () => {
      const current = request.result as CollaborationSyncSnapshot | undefined;
      if (current) store.put({ ...current, id: crypto.randomUUID(), base: patch(current.base), state: patch(current.state) }, key);
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

export async function acknowledgeCollaborationSync(
  operation: CollaborationSyncSnapshot, confirmed: CollaborationState,
): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const key = `collaboration-outbox:${operation.uid}`;
    const request = store.get(key);
    request.onsuccess = () => {
      const current = request.result as CollaborationSyncSnapshot | undefined;
      if (!current) return;
      if (current.id === operation.id) store.delete(key);
      else store.put({ ...current, base: confirmed,
        state: mergeLiveState(operation.state, current.state, confirmed) }, key);
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

export async function preserveRejectedCollaboration(
  operation: CollaborationSyncSnapshot, details: unknown,
): Promise<void> {
  await updateValue<Array<{ snapshot: CollaborationSyncSnapshot; details: unknown; failures?: unknown[] }>>(
    `collaboration-rejected:${operation.uid}`, current => {
      const drafts = current ?? [];
      const existing = drafts.find(item => item.snapshot.id === operation.id);
      if (!existing) return [...drafts, { snapshot: operation, details }];
      return drafts.map(item => item !== existing ? item : {
        ...item, failures: [...(item.failures ?? []), details],
      });
    },
  );
}

export async function loadRejectedCollaboration(uid: string) {
  return (await readValue<RejectedCollaborationDraft[]>(`collaboration-rejected:${uid}`)) ?? [];
}

export async function acknowledgeCollaborationProposalEdits(uid: string, receipts: PendingEditReceipt[]): Promise<void> {
  if (!receipts.length) return;
  await updateValue<RejectedCollaborationDraft[]>(`collaboration-rejected:${uid}`,
    drafts => acknowledgeRejectedPendingEdits(drafts ?? [], receipts));
}

export type ArchivedCollaborationDraft = RejectedCollaborationDraft & { archivedAt: string; disposition: 'review_completed' };

export async function loadArchivedCollaboration(uid: string): Promise<ArchivedCollaborationDraft[]> {
  return (await readValue<ArchivedCollaborationDraft[]>(`collaboration-archived:${uid}`)) ?? [];
}

// Archive and remove from the active queue together. An abort leaves the
// original draft in place, and a concurrent newer edit is never consumed.
export async function archiveCompletedCollaborationEdits(uid: string, receipts: PendingEditReceipt[]): Promise<void> {
  if (!receipts.length) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite'), store = transaction.objectStore(STORE);
    const activeKey = `collaboration-rejected:${uid}`, archiveKey = `collaboration-archived:${uid}`;
    const active = store.get(activeKey), history = store.get(archiveKey);
    let drafts: RejectedCollaborationDraft[] = [];
    active.onsuccess = () => { drafts = (active.result as RejectedCollaborationDraft[] | undefined) ?? []; };
    history.onsuccess = () => {
      const archived = drafts.flatMap(draft => {
        const captured = receipts.filter(receipt => receipt.snapshotId === draft.snapshot.id);
        const operations = [draft.details, ...(draft.failures ?? [])].flatMap(details => {
          if (!details || typeof details !== 'object' || !('operations' in details) || !Array.isArray(details.operations)) return [];
          return details.operations.filter(operation => captured.some(receipt => sameCollaborationValue(operation, receipt.operation)));
        });
        return operations.length ? [{ snapshot: draft.snapshot, details: { reason: 'Contribution review completed before this edit was recovered.', operations },
          archivedAt: new Date().toISOString(), disposition: 'review_completed' as const }] : [];
      });
      store.put([...(history.result as ArchivedCollaborationDraft[] | undefined ?? []), ...archived], archiveKey);
      store.put(acknowledgeRejectedPendingEdits(drafts, receipts), activeKey);
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Local archive aborted.')); };
  });
}

// Commit a successful deletion batch to both queues in one local transaction.
// A later network failure must never replay the already confirmed batch.
export async function acknowledgeCollaborationProposalDeletes(uid: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const removed = new Set(ids), db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite'), store = transaction.objectStore(STORE);
    const outboxKey = `collaboration-outbox:${uid}`, rejectedKey = `collaboration-rejected:${uid}`;
    let concurrentDraft: RejectedCollaborationDraft | undefined;
    const pending = store.get(outboxKey);
    pending.onsuccess = () => {
      const current = pending.result as CollaborationSyncSnapshot | undefined;
      if (!current) return;
      const newerProposals = current.state.proposals.filter(proposal => removed.has(proposal.id));
      if (newerProposals.length) concurrentDraft = {
        snapshot: { ...current, id: crypto.randomUUID(), base: withoutProposals(current.base, removed) },
        details: {
          reason: 'A proposal was deleted while a newer local edit was pending. The edit is preserved for review.',
          operations: newerProposals.map(value => ({ collection: 'questionProposals', id: value.id, type: 'set', baseValue: null, value })),
        },
      };
      store.put({ ...current, base: withoutProposals(current.base, removed), state: withoutProposals(current.state, removed) }, outboxKey);
    };
    const rejected = store.get(rejectedKey);
    rejected.onsuccess = () => {
      // Requests in a single IndexedDB transaction run in creation order. The
      // pending read above captures newer edits before either queue is pruned.
      const drafts = acknowledgeRejectedProposalDeletes((rejected.result as RejectedCollaborationDraft[] | undefined) ?? [], removed);
      if (concurrentDraft) drafts.push(concurrentDraft);
      if (rejected.result || concurrentDraft) store.put(drafts, rejectedKey);
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Local checkpoint aborted.')); };
  });
}

export async function removeCollaborationSync(
  uid: string,
  operationId: string,
): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const key = `collaboration-outbox:${uid}`;
    const request = store.get(key);
    request.onsuccess = () => {
      const current = request.result as CollaborationSyncSnapshot | undefined;
      if (current?.id === operationId) store.delete(key);
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Local save aborted.')); };
  });
}

export async function noteCollaborationSyncAttempt(
  uid: string,
  operationId: string,
): Promise<void> {
  const current = await loadCollaborationSyncOutbox(uid);
  if (!current || current.id !== operationId) return;
  await updateValue<CollaborationSyncSnapshot>(
    `collaboration-outbox:${uid}`,
    latest =>
      latest && latest.id === operationId
        ? { ...latest, attempts: latest.attempts + 1 }
        : latest ?? current,
  );
}

export async function forgetLocalUser(uid: string): Promise<void> {
  try {
    const keys = Object.keys(localStorage).filter(key =>
      key.startsWith(`qraft-preformed-count:user:${uid}:`) ||
      key.startsWith(`qraft-preformed-participant:user:${uid}:`));
    for (const key of keys) localStorage.removeItem(key);
  } catch { /* Browser storage may be disabled; IndexedDB cleanup must still run. */ }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    store.put(true, `deleted:${uid}`);
    store.delete(`state:${uid}`);
    store.delete(`collaboration:${uid}`);
    store.delete(`collaboration-confirmed:${uid}`);
    store.delete(`collaboration-outbox:${uid}`);
    store.delete(`collaboration-rejected:${uid}`);
    store.delete(`collaboration-archived:${uid}`);
    store.delete(`state-outbox:${uid}`);
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      if (typeof current.key === 'string' && (current.key.startsWith(`classification-draft:${uid}:`) || current.key.startsWith(`preformed:user:${uid}:`))) current.delete();
      current.continue();
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Local save aborted.')); };
  });
}
