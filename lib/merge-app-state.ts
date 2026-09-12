import { normalizeAppState, type AppState } from './medguard-types';

function newest<T>(left: T[], right: T[], id: (item: T) => string, updatedAt: (item: T) => string) {
  const merged = new Map<string, T>();
  for (const item of [...left, ...right]) {
    const current = merged.get(id(item));
    if (!current || updatedAt(item) >= updatedAt(current)) merged.set(id(item), item);
  }
  return [...merged.values()];
}

export function appStateFreshness(state: AppState) {
  return [
    state.clientUpdatedAt,
    state.lastSyncAt,
    ...state.tests.map(item => item.updatedAt),
    ...Object.values(state.progress).flatMap(item => [item.updatedAt, item.lastAnsweredAt]),
    ...state.flashcardDecks.map(item => item.updatedAt),
    ...state.flashcards.map(item => item.updatedAt),
    ...state.flashcardReviewLog.map(item => item.reviewedAt),
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
  const newestState = localIsNewest ? local : remote;
  const olderState = localIsNewest ? remote : local;
  return normalizeAppState({
    ...olderState,
    ...newestState,
    // Mutable snapshot collections come from the newest whole state. Unioning
    // them would resurrect tests, cards, or progress the user deliberately
    // deleted on the newer device.
    progress: newestState.progress,
    tests: newestState.tests,
    reports: newest(local.reports, remote.reports, item => item.id, item => item.createdAt),
    revisions: newest(local.revisions, remote.revisions, item => item.id, item => item.createdAt),
    customQuestions: newestState.customQuestions,
    flashcardDecks: newestState.flashcardDecks,
    flashcards: newestState.flashcards,
    flashcardSchedules: newestState.flashcardSchedules,
    flashcardReviewLog: newest(local.flashcardReviewLog, remote.flashcardReviewLog, item => item.id, item => item.reviewedAt)
      .sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt))
      .slice(-5000),
    clientUpdatedAt: [local.clientUpdatedAt, remote.clientUpdatedAt]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => left.localeCompare(right))
      .at(-1),
  });
}
