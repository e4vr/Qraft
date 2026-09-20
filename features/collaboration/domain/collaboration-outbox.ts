import type { CollaborationState } from '@/lib/medguard-types';

export interface CollaborationSyncSnapshot {
  id: string;
  uid: string;
  base: CollaborationState;
  state: CollaborationState;
  createdAt: string;
  attempts: number;
}

export function coalesceCollaborationSync(
  current: CollaborationSyncSnapshot | undefined,
  next: CollaborationSyncSnapshot,
): CollaborationSyncSnapshot {
  return current ? { ...next, base: current.base } : next;
}
