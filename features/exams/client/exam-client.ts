import { api } from '@/lib/api-client';

export async function registerStartedExam(
  testId: string,
  questionCount: number,
): Promise<{ started: boolean; startedAt: string; duplicate?: boolean }> {
  return api('/platform/exam-start', {
    method: 'POST',
    body: JSON.stringify({ testId, questionCount }),
  });
}
