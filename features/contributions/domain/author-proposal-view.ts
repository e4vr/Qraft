import type { QuestionProposal } from '@/lib/medguard-types';

// An author can see their own submission, but private duplicate evidence for
// other pending submissions belongs to reviewers. Keep the review status.
export function authorProposalView<T extends { duplicateReview?: QuestionProposal['duplicateReview'] }>(proposal: T): T {
  const review = proposal.duplicateReview;
  if (!review?.candidates.some(candidate => candidate.entityType === 'pending_proposal')) return proposal;
  const candidates = review.candidates.filter(candidate => candidate.entityType === 'approved_question');
  const visible = new Set(candidates.map(candidate => candidate.entityId));
  return { ...proposal, duplicateReview: { ...review, candidates, resolutions: review.resolutions?.filter(resolution => visible.has(resolution.candidateEntityId)) } };
}
