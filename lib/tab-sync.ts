'use client';

import type { AppState } from './medguard-types';

export interface StateSyncNotice {
  uid: string;
  state: AppState;
  revision: number;
  updatedAt: string;
}

const channelName = 'qraft-state-sync';
let channel: BroadcastChannel | undefined;
const localLocks = new Map<string, Promise<unknown>>();

function sharedChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return undefined;
  channel ??= new BroadcastChannel(channelName);
  return channel;
}

export async function withStateSyncLock<T>(uid: string, run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request(`qraft-state-sync:${uid}`, run);
  // Older browsers still need serialization within a tab. Cross-tab conflicts
  // remain protected by the server revision and persisted operation ID.
  const previous = localLocks.get(uid) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  localLocks.set(uid, next);
  try { return await next; }
  finally { if (localLocks.get(uid) === next) localLocks.delete(uid); }
}

export function publishStateSync(notice: StateSyncNotice) {
  sharedChannel()?.postMessage({ type: 'state-synced', notice });
}

export function subscribeStateSync(callback: (notice: StateSyncNotice) => void) {
  const active = sharedChannel();
  if (!active) return () => undefined;
  const listener = (event: MessageEvent<{ type?: string; notice?: StateSyncNotice }>) => {
    if (event.data?.type === 'state-synced' && event.data.notice) callback(event.data.notice);
  };
  active.addEventListener('message', listener);
  return () => active.removeEventListener('message', listener);
}
