import type { CollaborationState } from '@/lib/medguard-types';
import { mergeLiveState } from '@/lib/merge-live-state';

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
  return current
    ? {
        ...next,
        base: current.base,
        state: mergeLiveState(next.base, next.state, current.base),
      }
    : next;
}
