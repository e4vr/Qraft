import { normalizeAppState, type AppState } from './medguard-types';

export function appStateFreshness(state: AppState) {
  // A synchronization receipt is not an edit. The latest edit owns the snapshot.
  if (state.clientUpdatedAt && Number.isFinite(Date.parse(state.clientUpdatedAt)))
    return new Date(state.clientUpdatedAt).toISOString();
  return [
    ...(Array.isArray(state.tests) ? state.tests : []).map(item => item?.updatedAt),
    ...Object.values(state.progress ?? {}).flatMap(item => [item?.updatedAt, item?.lastAnsweredAt]),
    ...(Array.isArray(state.flashcardDecks) ? state.flashcardDecks : []).map(item => item?.updatedAt),
    ...(Array.isArray(state.flashcards) ? state.flashcards : []).map(item => item?.updatedAt),
    ...(Array.isArray(state.flashcardReviewLog) ? state.flashcardReviewLog : []).map(item => item?.reviewedAt),
  ].filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))
    .at(-1) ?? '';
}

export function mergeAppStates(localInput: AppState, remoteInput: AppState): AppState {
  const local = normalizeAppState(localInput);
  const remote = normalizeAppState(remoteInput);
  // On an exact tie prefer the server snapshot because it may contain
  // authoritative cleanup (for example, a globally deleted question).
  const localIsNewest = appStateFreshness(local) > appStateFreshness(remote);
  // Product policy: no union, including reports and review history.
  return localIsNewest ? local : remote;
}
