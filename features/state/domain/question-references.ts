import type { AppState } from '@/lib/medguard-types';

// Only fields currently cleaned by cleanDeletedState. Flashcard/history policy
// is deliberately unchanged; this narrows the DB read without deleting data.
export function stateQuestionReferences(state: AppState): string[] {
  const ids = new Set<string>([
    ...(state.customQuestions ?? []).map(question => question.id),
    ...Object.keys(state.questionOverrides ?? {}),
    ...Object.keys(state.progress ?? {}),
    ...(state.reports ?? []).map(report => report.questionId),
    ...(state.revisions ?? []).map(revision => revision.questionId),
  ]);
  for (const test of state.tests) {
    for (const id of [...test.questionIds, ...Object.keys(test.answers), ...test.revealed, ...test.graded]) ids.add(id);
  }
  return [...ids].filter(id => typeof id === 'string' && id.length > 0);
}
