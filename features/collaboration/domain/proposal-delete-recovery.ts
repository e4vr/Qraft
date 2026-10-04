import type { CollaborationState, QuestionProposal } from '@/lib/medguard-types';
import type { CollaborationSyncSnapshot } from './collaboration-outbox';

export interface RejectedCollaborationDraft {
  snapshot: CollaborationSyncSnapshot;
  details: unknown;
  failures?: unknown[];
}

export type ProposalDeleteOperation = {
  collection: 'questionProposals';
  type: 'delete';
  id: string;
  baseValue: QuestionProposal;
};

export function proposalDeleteOperations(details: unknown): ProposalDeleteOperation[] {
  if (!details || typeof details !== 'object' || !('operations' in details) || !Array.isArray(details.operations)) return [];
  const operations = details.operations.filter((operation): operation is ProposalDeleteOperation =>
    operation?.collection === 'questionProposals' && operation.type === 'delete' &&
    typeof operation.id === 'string' && operation.baseValue?.id === operation.id &&
    typeof operation.baseValue.qbankId === 'string');
  return operations.length === details.operations.length ? operations : [];
}

export function withoutProposals(state: CollaborationState, ids: ReadonlySet<string>): CollaborationState {
  return { ...state, proposals: state.proposals.filter(proposal => !ids.has(proposal.id)) };
}

export function acknowledgeRejectedProposalDeletes(drafts: RejectedCollaborationDraft[], ids: ReadonlySet<string>): RejectedCollaborationDraft[] {
  const remaining = (details: unknown): unknown => {
    if (!details || typeof details !== 'object' || !('operations' in details) || !Array.isArray(details.operations)) return details;
    const operations = details.operations.filter(operation =>
      !(operation?.collection === 'questionProposals' && operation.type === 'delete' && ids.has(operation.id)));
    return operations.length ? { ...details, operations } : undefined;
  };
  return drafts.flatMap(draft => {
    const details = remaining(draft.details);
    const failures = draft.failures?.map(remaining).filter(value => value !== undefined);
    if (details === undefined && !failures?.length) return [];
    return [{ ...draft, details, failures,
      snapshot: { ...draft.snapshot, base: withoutProposals(draft.snapshot.base, ids), state: withoutProposals(draft.snapshot.state, ids) } }];
  });
}

type SizedOperation = { baseValue: unknown; collection: string; type: string };
const encoder = new TextEncoder();
const envelopeBytes = encoder.encode('{"operations":[]}').byteLength;
function operationBytes({ baseValue: _baseValue, ...operation }: SizedOperation): number {
  return encoder.encode(JSON.stringify({ ...operation,
    ...(operation.collection === 'answerStats' && operation.type === 'set' ? {} : { baseHash: '0'.repeat(64) }),
  })).byteLength;
}
export function collaborationBatchFits(operations: SizedOperation[]): boolean {
  return operations.length <= 500 && envelopeBytes + Math.max(0, operations.length - 1) +
    operations.reduce((bytes, operation) => bytes + operationBytes(operation), 0) <= 1_700_000;
}

// Only proposal deletions can be split here. Publication and classification
// changes still share their original atomic bank boundary.
export function splitProposalDeleteGroup<T extends { collection: string; type: string; baseValue: unknown }>(operations: T[]): T[][] {
  if (!operations.every(operation => operation.collection === 'questionProposals' && operation.type === 'delete')) return [operations];
  const batches: T[][] = [];
  let batch: T[] = [];
  let bytes = envelopeBytes;
  for (const operation of operations) {
    const size = operationBytes(operation);
    if (batch.length && (batch.length === 500 || bytes + size + 1 > 1_700_000)) {
      batches.push(batch); batch = []; bytes = envelopeBytes;
    }
    bytes += size + (batch.length ? 1 : 0);
    batch.push(operation);
  }
  if (batch.length) batches.push(batch);
  return batches;
}
