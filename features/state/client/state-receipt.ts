import type { AppState } from '@/lib/medguard-types';
import { mergeAppStates } from '@/lib/merge-app-state';

// A new object is allocated on every account transition, including A → out → A.
export type PersonalStateSession = { uid: string | undefined };
export type PersonalStateReceipt = {
  session: PersonalStateSession;
  snapshot: AppState;
  dirtyBefore: boolean;
  full: boolean;
};

export function resolvePersonalStateReceipt(
  receipt: PersonalStateReceipt,
  session: PersonalStateSession,
  current: AppState,
  remote: AppState | undefined,
): { state: AppState; dirty: boolean } | undefined {
  if (receipt.session !== session || !session.uid) return undefined;
  // An acknowledgement is not a new edit. Even a newer server timestamp must
  // not erase edits made while this request was pending. Partial checkpoints
  // also cannot acknowledge unrelated, previously unsaved fields.
  const pending = current !== receipt.snapshot || (!receipt.full && receipt.dirtyBefore);
  if (pending || !remote) return { state: current, dirty: true };
  return { state: mergeAppStates(current, remote), dirty: false };
}
