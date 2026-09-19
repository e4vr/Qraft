// Compatibility facade. New callers should use the owning feature client.
export * from '@/features/auth/client/auth-client';
export * from '@/features/collaboration/client/collaboration-client';
export * from '@/features/exams/client/exam-client';
export * from '@/features/qbanks/client/qbank-client';
export * from '@/features/state/client/state-sync-client';
export { api } from './api-client';
