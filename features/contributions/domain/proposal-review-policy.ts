import type { AppUser, QuestionProposal } from '@/lib/medguard-types';

// This checks authorship only; callers must still verify bank access, pending
// status and review versions. Superadmin can review new questions they upload.
// Self-review of edits remains blocked, including changes requiring two reviewers.
export function canReviewProposalAuthorship(
  user: Pick<AppUser, 'uid' | 'role'>,
  proposal: Pick<QuestionProposal, 'proposedById' | 'type'>,
): boolean {
  return proposal.proposedById !== user.uid ||
    (user.role === 'super_admin' && proposal.type === 'new_question');
}
