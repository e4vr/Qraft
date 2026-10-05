import { env } from 'cloudflare:workers';
import {
  normalizeCollaborationState,
  type QuestionProposal,
  type QBankSpecialty,
  type QBankTopic,
} from '@/lib/medguard-types';
import { collaborationBaseHash } from '@/features/collaboration/domain/collaboration-values';

// Review preconditions describe the normalized version actually shown to the
// reviewer, including current taxonomy names and defaults for legacy records.
export async function proposalReviewHashes(proposals: QuestionProposal[]) {
  const rows = await env.DB.prepare(`SELECT record.type,record.payload
    FROM json_each(?) AS bank CROSS JOIN records AS record INDEXED BY idx_records_qbank_type
    WHERE record.qbank_id=bank.value AND record.type IN ('qbankSpecialties','qbankTopics')`)
    .bind(
      JSON.stringify([
        ...new Set(proposals.map((proposal) => proposal.qbankId)),
      ]),
    )
    .all<{ type: string; payload: string }>();
  const state = normalizeCollaborationState({
    proposals,
    specialties: rows.results
      .filter((row) => row.type === 'qbankSpecialties')
      .map((row) => JSON.parse(row.payload) as QBankSpecialty),
    topics: rows.results
      .filter((row) => row.type === 'qbankTopics')
      .map((row) => JSON.parse(row.payload) as QBankTopic),
  });
  return new Map(
    await Promise.all(
      state.proposals.map(
        async (proposal) =>
          [proposal.id, await collaborationBaseHash(proposal)] as const,
      ),
    ),
  );
}
