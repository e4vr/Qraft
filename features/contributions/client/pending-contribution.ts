import { ApiError, api } from '@/lib/api-client';
import type {
  QuestionProposal,
  QuestionProposalPayload,
} from '@/lib/medguard-types';
import { collaborationBaseHash } from '@/features/collaboration/domain/collaboration-values';

export async function savePendingContribution(
  uid: string,
  previous: QuestionProposal,
  payload: QuestionProposalPayload,
  rationale: string,
): Promise<QuestionProposal> {
  if (previous.proposedById !== uid || previous.status !== 'pending')
    throw new Error('Only your pending contributions can be edited.');
  const value: QuestionProposal = { ...previous, payload, rationale };
  const response = await api<{
    ok: boolean;
    unchanged?: boolean;
    operations?: Array<{
      collection: string;
      id: string;
      value?: QuestionProposal;
    }>;
  }>('/collaboration', {
    method: 'PUT',
    expectedUserId: uid,
    body: JSON.stringify({
      operations: [
        {
          collection: 'questionProposals',
          id: previous.id,
          type: 'set',
          baseHash: await collaborationBaseHash(previous),
          value,
        },
      ],
    }),
  });
  const saved = response.operations?.find(
    (operation) =>
      operation.collection === 'questionProposals' &&
      operation.id === previous.id,
  )?.value;
  if (!response.ok || (!saved && !response.unchanged))
    throw new ApiError(
      'The server did not confirm your contribution. Your draft remains in the editor.',
      502,
      {},
    );
  return saved ?? value;
}
