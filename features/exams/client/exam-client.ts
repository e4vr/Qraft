import { api } from '@/lib/api-client';

export async function registerStartedExam(
  testId: string,
  questionCount: number,
  expectedUserId?: string,
): Promise<{ started: boolean; startedAt: string; duplicate?: boolean }> {
  return api('/platform/exam-start', {
    method: 'POST',
    ...(expectedUserId ? { headers: { 'x-qraft-account': expectedUserId } } : {}),
    body: JSON.stringify({ testId, questionCount }),
  });
}
