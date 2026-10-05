import {
  normalizeCollaborationState,
  type CollaborationState,
  type QuestionProposal,
} from '@/lib/medguard-types';
import type { RejectedCollaborationDraft } from './proposal-delete-recovery';
import { sameCollaborationValue } from './collaboration-values';

export interface PendingProposalEditOperation {
  collection: 'questionProposals';
  type: 'set';
  id: string;
  baseValue: QuestionProposal;
  value: QuestionProposal;
}

export interface PendingEditReceipt {
  snapshotId: string;
  operation: PendingProposalEditOperation;
}

export function completedPendingEditReceipts(
  uid: string,
  drafts: RejectedCollaborationDraft[],
  state: CollaborationState,
): PendingEditReceipt[] {
  return drafts.flatMap((draft) =>
    draft.snapshot.uid !== uid
      ? []
      : [draft.details, ...(draft.failures ?? [])].flatMap((details) =>
          pendingProposalEditOperations(details).flatMap((operation) => {
            const current = state.proposals.find(
              (proposal) => proposal.id === operation.id,
            );
            return current &&
              ['approved', 'rejected'].includes(current.status) &&
              current.proposedById === uid &&
              operation.baseValue.proposedById === uid &&
              current.qbankId === operation.baseValue.qbankId &&
              current.type === operation.baseValue.type &&
              current.proposedAt === operation.baseValue.proposedAt
              ? [{ snapshotId: draft.snapshot.id, operation }]
              : [];
          }),
        ),
  );
}

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

// Recover recorded edits only. A historic full snapshot can contain unrelated
// administration, publication and classification changes that must not replay.
export function pendingProposalEditOperations(
  details: unknown,
): PendingProposalEditOperation[] {
  if (
    !record(details) ||
    !Array.isArray(details.operations) ||
    !details.operations.length
  )
    return [];
  const operations = details.operations.filter(
    (operation): operation is PendingProposalEditOperation => {
      if (
        !record(operation) ||
        operation.collection !== 'questionProposals' ||
        operation.type !== 'set' ||
        !record(operation.baseValue) ||
        !record(operation.value)
      )
        return false;
      const { baseValue: base, value } = operation;
      if (
        typeof operation.id !== 'string' ||
        base.id !== operation.id ||
        value.id !== operation.id ||
        base.status !== 'pending' ||
        value.status !== 'pending' ||
        typeof base.qbankId !== 'string' ||
        typeof base.proposedById !== 'string' ||
        !record(base.payload) ||
        !record(value.payload) ||
        typeof value.rationale !== 'string' ||
        ![
          base.payload.specialty,
          base.payload.topic,
          value.payload.specialty,
          value.payload.topic,
        ].every((item) => typeof item === 'string')
      )
        return false;
      // The old editor incorrectly changed proposedAt. Restore the server's
      // immutable timestamp; every other identity/review field must be unchanged.
      return [...new Set([...Object.keys(base), ...Object.keys(value)])].every(
        (key) =>
          ['payload', 'rationale', 'proposedAt'].includes(key) ||
          sameCollaborationValue(base[key], value[key]),
      );
    },
  );
  return operations.length === details.operations.length ? operations : [];
}

const nameKey = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

function normalized(
  proposal: QuestionProposal,
  state: CollaborationState,
): QuestionProposal {
  return normalizeCollaborationState({
    qbanks: state.qbanks,
    specialties: state.specialties,
    topics: state.topics,
    proposals: [proposal],
  }).proposals[0];
}

function recoveredValue(
  operation: PendingProposalEditOperation,
  current: QuestionProposal,
  state: CollaborationState,
): QuestionProposal {
  const payload = { ...operation.value.payload };
  const base = operation.baseValue.payload;
  const specialty = state.specialties.find(
    (item) =>
      item.qbankId === current.qbankId &&
      nameKey(item.name) === nameKey(payload.specialty),
  );
  const sameSpecialty = nameKey(payload.specialty) === nameKey(base.specialty);
  payload.specialtyId =
    specialty?.id ?? (sameSpecialty ? base.specialtyId : undefined);
  const topic = state.topics.find(
    (item) =>
      item.qbankId === current.qbankId &&
      item.specialtyId === payload.specialtyId &&
      nameKey(item.name) === nameKey(payload.topic),
  );
  payload.topicId =
    topic?.id ??
    (sameSpecialty && nameKey(payload.topic) === nameKey(base.topic)
      ? base.topicId
      : undefined);
  return normalized(
    { ...current, payload, rationale: operation.value.rationale },
    state,
  );
}

export function planPendingProposalEditRecovery(
  uid: string,
  drafts: RejectedCollaborationDraft[],
  state: CollaborationState,
) {
  const candidates = new Map<
    string,
    Array<PendingEditReceipt & { createdAt: number }>
  >();
  for (const draft of drafts) {
    const createdAt = Date.parse(draft.snapshot.createdAt);
    if (draft.snapshot.uid !== uid || !Number.isFinite(createdAt)) continue;
    for (const details of [draft.details, ...(draft.failures ?? [])]) {
      for (const operation of pendingProposalEditOperations(details)) {
        if (operation.baseValue.proposedById !== uid) continue;
        const items = candidates.get(operation.id) ?? [];
        items.push({ snapshotId: draft.snapshot.id, operation, createdAt });
        candidates.set(operation.id, items);
      }
    }
  }
  return [...candidates].flatMap(([id, receipts]) => {
    receipts.sort((a, b) => a.createdAt - b.createdAt);
    const latest = receipts.at(-1)!;
    const current = state.proposals.find((proposal) => proposal.id === id);
    if (
      !current ||
      current.status !== 'pending' ||
      current.proposedById !== uid ||
      current.qbankId !== latest.operation.baseValue.qbankId
    )
      return [];
    const value = recoveredValue(latest.operation, current, state);
    // Equal-time conflicting drafts have no trustworthy ordering.
    if (
      receipts.some(
        (item) =>
          item.createdAt === latest.createdAt &&
          !sameCollaborationValue(
            recoveredValue(item.operation, current, state),
            value,
          ),
      )
    )
      return [];
    const alreadyApplied =
      sameCollaborationValue(current.payload, value.payload) &&
      current.rationale === value.rationale;
    if (
      !alreadyApplied &&
      !sameCollaborationValue(
        normalized(latest.operation.baseValue, state),
        current,
      )
    )
      return [];
    return [
      {
        current,
        value,
        alreadyApplied,
        receipts: receipts.map(({ snapshotId, operation }) => ({
          snapshotId,
          operation,
        })),
      },
    ];
  });
}

// Clear only the captured operations that the server has confirmed. A newer
// edit appended to IndexedDB while the request is in flight stays preserved.
export function acknowledgeRejectedPendingEdits(
  drafts: RejectedCollaborationDraft[],
  receipts: PendingEditReceipt[],
): RejectedCollaborationDraft[] {
  return drafts.flatMap((draft) => {
    const acknowledged = receipts.filter(
      (receipt) => receipt.snapshotId === draft.snapshot.id,
    );
    if (!acknowledged.length) return [draft];
    const remaining = (details: unknown): unknown => {
      if (!record(details) || !Array.isArray(details.operations))
        return details;
      const operations = details.operations.filter(
        (operation) =>
          !acknowledged.some((receipt) =>
            sameCollaborationValue(receipt.operation, operation),
          ),
      );
      return operations.length ? { ...details, operations } : undefined;
    };
    const details = remaining(draft.details);
    const failures = draft.failures
      ?.map(remaining)
      .filter((value) => value !== undefined);
    return details === undefined && !failures?.length
      ? []
      : [{ ...draft, details, failures }];
  });
}
