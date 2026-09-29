import type { CollaborationState } from '@/lib/medguard-types';

export function withoutQBank(
  current: CollaborationState,
  bankId: string,
): CollaborationState {
  const { [bankId]: _revision, ...classificationRevisions } =
    current.classificationRevisions;
  return {
    ...current,
    classificationRevisions,
    qbanks: current.qbanks.filter((item) => item.id !== bankId),
    memberships: current.memberships.filter((item) => item.qbankId !== bankId),
    invitations: current.invitations.filter((item) => item.qbankId !== bankId),
    proposals: current.proposals.filter((item) => item.qbankId !== bankId),
    approvedQuestions: current.approvedQuestions.filter(
      (item) => item.qbankId !== bankId,
    ),
    specialties: current.specialties.filter((item) => item.qbankId !== bankId),
    topics: current.topics.filter((item) => item.qbankId !== bankId),
    answerStats: Object.fromEntries(
      Object.entries(current.answerStats).filter(
        ([, item]) => item.qbankId !== bankId,
      ),
    ),
    sharedNotes: Object.fromEntries(
      Object.entries(current.sharedNotes).filter(
        ([, item]) => item.qbankId !== bankId,
      ),
    ),
  };
}
