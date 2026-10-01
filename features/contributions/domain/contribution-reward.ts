import type { QuestionProposal } from '@/lib/medguard-types';
import { CONTRIBUTION_CREDITS } from '@/features/subscriptions/domain/plan-config';

// One reward per approved proposal, using the highest-priority edit kind.
// Imported new questions still publish normally but do not earn credits.
export function contributionReward(proposal: QuestionProposal) {
  if (proposal.type === 'new_question') {
    const imported = proposal.submissionMethod === 'json' || Boolean(proposal.importBatchId);
    return {
      amount: imported ? CONTRIBUTION_CREDITS.importedQuestion : CONTRIBUTION_CREDITS.newQuestion,
      reason: imported ? 'Imported approved question' : 'New approved question',
    };
  }
  if (proposal.editKinds.includes('correct_answer'))
    return { amount: CONTRIBUTION_CREDITS.medicalFactOrCorrectAnswer, reason: 'Corrected wrong answer or medical fact' };
  if (proposal.editKinds.includes('question_text') || proposal.editKinds.includes('options'))
    return { amount: CONTRIBUTION_CREDITS.substantialCorrection, reason: 'Substantial question correction' };
  if (proposal.editKinds.includes('explanation'))
    return { amount: CONTRIBUTION_CREDITS.explanationImprovement, reason: 'Useful explanation improvement' };
  if (proposal.editKinds.includes('source'))
    return { amount: CONTRIBUTION_CREDITS.sourceReference, reason: 'Valid source or reference' };
  return { amount: CONTRIBUTION_CREDITS.typoFormatting, reason: 'Typo or formatting correction' };
}
