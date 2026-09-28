import { api, ApiError } from '@/lib/api-client';
import type { Question, QuestionProposal } from '@/lib/medguard-types';

export async function saveDirectQuestionEdit(uid: string, qbankId: string, question: Question, payload: QuestionProposal['payload']) {
  const result = await api<{ ok: boolean; question: Question }>('/platform/question-edit', {
    method: 'PUT', expectedUserId: uid,
    body: JSON.stringify({ qbankId, questionId: question.id, baseRevision: question.revision, payload }),
  });
  if (result.ok !== true || result.question?.id !== question.id || result.question.qbankId !== qbankId)
    throw new ApiError('The server did not confirm this edit. Your draft has been kept.', 502, {});
  return result.question;
}
