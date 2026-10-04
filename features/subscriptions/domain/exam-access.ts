import type { PlanLimits } from './plan-config';

export type ExamUpgradeReason = 'exams' | 'questions';
export interface ExamUsage { lifetimeStartedExams: number; monthlyStartedExams: number }
export function exhaustedExamAllowance(limits: PlanLimits, usage: ExamUsage): 'lifetime' | 'monthly' | null {
  const reached = (limit: number | null, used: number) => limit !== null && Number.isFinite(limit) && Number.isFinite(used) && used >= 0 && used >= limit;
  if (reached(limits.lifetimeExamLimit, usage.lifetimeStartedExams)) return 'lifetime';
  if (reached(limits.monthlyExamLimit, usage.monthlyStartedExams)) return 'monthly';
  return null;
}

// Other 403s (bank access, membership, validation) and connection failures are
// not upgrade prompts. Exact old messages keep rolling deployments compatible.
export function examRestriction(error: unknown): ExamUpgradeReason | null {
  if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 403) return null;
  const payload = 'payload' in error && error.payload && typeof error.payload === 'object' ? error.payload : {};
  const code = 'code' in payload ? payload.code : undefined;
  if (code === 'EXAM_LIMIT_REACHED') return 'exams';
  if (code === 'EXAM_QUESTION_LIMIT_REACHED') return 'questions';
  const message = 'message' in error ? error.message : '';
  return message === "You've reached your lifetime exam limit." || message === "You've reached your monthly exam limit." ? 'exams' : null;
}
