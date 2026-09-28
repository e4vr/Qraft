import { ApiError, api, setApiCache } from '@/lib/api-client';
import {
  enqueueStateSync,
  loadStateSyncOutbox,
  noteStateSyncAttempt,
  removeStateSync,
  type StateSyncKind,
  type StateSyncOperation,
} from '@/lib/local-db';
import { normalizeAppState, type AppState } from '@/lib/medguard-types';
import { mergeAppStates } from '@/lib/merge-app-state';
import { stateBudgetError } from '@/features/state/domain/state-budget';
import {
  publishStateSync,
  subscribeStateSync,
  withStateSyncLock,
} from '@/lib/tab-sync';

type StateSyncResponse = {
  ok: true;
  state: AppState;
  revision: number;
  updatedAt: string;
  duplicate?: boolean;
  unchanged?: boolean;
};

const lastSavedState = new Map<string, string>();
const stateRevision = new Map<string, number>();

function cloudState(state: AppState): AppState {
  return {
    ...normalizeAppState(state),
    settings: { ...state.settings, theme: 'system' },
  };
}

function operationPayload(
  kind: StateSyncKind,
  state: AppState,
  dailyGoal?: number,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  if (kind === 'exam')
    return {
      tests: state.tests,
      progress: state.progress,
      reports: state.reports,
      revisions: state.revisions,
      questionOverrides: state.questionOverrides,
      customQuestions: state.customQuestions,
      flashcardDecks: state.flashcardDecks,
      flashcards: state.flashcards,
      studyStreak: state.studyStreak,
      clientUpdatedAt: state.clientUpdatedAt,
      ...extra,
    };
  if (kind === 'flashcards')
    return {
      flashcardSchedules: state.flashcardSchedules,
      flashcardReviewLog: state.flashcardReviewLog,
      clientUpdatedAt: state.clientUpdatedAt,
    };
  if (kind === 'daily-goal') return { dailyGoal };
  return { state: cloudState(state) };
}

function operationPath(kind: StateSyncKind): string {
  return kind === 'full' ? '/state' : `/state/${kind}`;
}

function operationMatchesSaved(
  uid: string,
  kind: StateSyncKind,
  payload: Record<string, unknown>,
): boolean {
  const raw = lastSavedState.get(uid);
  if (!raw) return false;
  const saved = JSON.parse(raw) as AppState;
  if (kind === 'full')
    return JSON.stringify(cloudState(saved)) === JSON.stringify(payload.state);
  if (kind === 'daily-goal')
    return saved.settings.dailyGoal === payload.dailyGoal;
  return (
    JSON.stringify(operationPayload(kind, saved)) === JSON.stringify(payload)
  );
}

async function sendStateOperation(
  operation: StateSyncOperation,
  keepalive = false,
): Promise<StateSyncResponse> {
  const path = operationPath(operation.kind);
  const request = (baseRevision: number, payload: Record<string, unknown>) =>
    api<StateSyncResponse>(path, {
      method: 'PUT',
      keepalive,
      expectedUserId: operation.uid,
      body: JSON.stringify({
        ...payload,
        baseRevision,
        operationId: operation.id,
      }),
    });

  try {
    return await request(stateRevision.get(operation.uid) ?? operation.baseRevision, operation.payload);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    const remote = error.payload.state as AppState | undefined;
    const revision = Number(error.payload.revision);
    if (!remote || !Number.isInteger(revision)) throw error;
    stateRevision.set(operation.uid, revision);
    let payload = operation.payload;
    const localUpdatedAt =
      typeof operation.payload.clientUpdatedAt === 'string'
        ? operation.payload.clientUpdatedAt
        : '';
    if (operation.kind === 'full') {
      payload = {
        state: cloudState(
          mergeAppStates(operation.payload.state as AppState, remote),
        ),
      };
    } else if (
      operation.kind !== 'daily-goal' &&
      localUpdatedAt < (remote.clientUpdatedAt ?? '')
    ) {
      payload = {
        ...operationPayload(operation.kind, remote),
        ...(operation.kind === 'exam'
          ? { answerSelections: [] }
          : {}),
      };
    }
    return request(revision, payload);
  }
}

async function flushOutboxUnlocked(
  uid: string,
  keepalive = false,
): Promise<StateSyncResponse | undefined> {
  let latest: StateSyncResponse | undefined;
  for (let count = 0; count < (keepalive ? 1 : 50); count++) {
    const next = (await loadStateSyncOutbox(uid))[0];
    if (!next) break;
    if (keepalive && new TextEncoder().encode(JSON.stringify(next.payload)).byteLength > 60_000) break;
    const operation = await noteStateSyncAttempt(uid, next.id);
    if (!operation) continue; // A newer unsent checkpoint replaced this one.
    const result = await sendStateOperation(operation, keepalive);
    if (result.ok !== true || !result.state || result.state.version !== 1 ||
        !Number.isSafeInteger(result.revision) || result.revision < 0)
      throw new ApiError('The server did not confirm your changes. They remain saved locally.', 502, {});
    stateRevision.set(uid, result.revision);
    lastSavedState.set(uid, JSON.stringify(cloudState(result.state)));
    setApiCache(
      '/state',
      {
        state: result.state,
        revision: result.revision,
        updatedAt: result.updatedAt,
      },
      { cacheScope: uid },
    );
    await removeStateSync(uid, operation.id);
    publishStateSync({
      uid,
      state: result.state,
      revision: result.revision,
      updatedAt: result.updatedAt,
    });
    latest = result;
  }
  return latest;
}

export async function loadCloudState(
  uid: string,
): Promise<AppState | undefined> {
  const result = await api<{
    state: AppState | null;
    revision: number;
    updatedAt?: string;
  }>('/state', { cacheScope: uid, expectedUserId: uid });
  const state = result.state ?? undefined;
  stateRevision.set(uid, result.revision ?? 0);
  if (state) lastSavedState.set(uid, JSON.stringify(cloudState(state)));
  return state;
}

export async function flushPendingCloudState(
  uid: string,
): Promise<AppState | undefined> {
  const result = await withStateSyncLock(uid, () => flushOutboxUnlocked(uid));
  return result?.state;
}

export function observeCloudStateSync(
  uid: string,
  callback: (state: AppState) => void,
): () => void {
  return subscribeStateSync((notice) => {
    if (notice.uid !== uid) return;
    stateRevision.set(uid, notice.revision);
    lastSavedState.set(uid, JSON.stringify(cloudState(notice.state)));
    setApiCache(
      '/state',
      {
        state: notice.state,
        revision: notice.revision,
        updatedAt: notice.updatedAt,
      },
      { cacheScope: uid },
    );
    callback(notice.state);
  });
}

async function queueStateOperation(
  uid: string,
  kind: StateSyncKind,
  state: AppState,
  dailyGoal?: number,
  extra?: Record<string, unknown>,
): Promise<StateSyncResponse | undefined> {
  const payload = operationPayload(kind, state, dailyGoal, extra);
  const capacityError = stateBudgetError(state);
  if (capacityError) throw new Error(capacityError);
  if (operationMatchesSaved(uid, kind, payload)) return undefined;
  const operation: StateSyncOperation = {
    id: crypto.randomUUID(),
    uid,
    kind,
    payload,
    baseRevision: stateRevision.get(uid) ?? 0,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await enqueueStateSync(operation);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined;
  return withStateSyncLock(uid, () => flushOutboxUnlocked(uid));
}

export async function saveCloudState(
  uid: string,
  state: AppState,
): Promise<AppState | undefined> {
  return (await queueStateOperation(uid, 'full', state))?.state;
}

export async function saveExamCheckpoint(
  uid: string,
  state: AppState,
  answerSelections: Array<{
    qbankId: string;
    questionId: string;
    answer: number;
  }>,
): Promise<AppState | undefined> {
  return (
    await queueStateOperation(uid, 'exam', state, undefined, {
      answerSelections,
    })
  )?.state;
}

export async function saveFlashcardCheckpoint(
  uid: string,
  state: AppState,
): Promise<AppState | undefined> {
  return (await queueStateOperation(uid, 'flashcards', state))?.state;
}

export async function saveDailyGoal(
  uid: string,
  state: AppState,
  dailyGoal: number,
): Promise<AppState | undefined> {
  return (await queueStateOperation(uid, 'daily-goal', state, dailyGoal))
    ?.state;
}

export function saveBestEffortStateCheckpoint(
  uid: string,
  state: AppState,
  kind: Exclude<StateSyncKind, 'daily-goal'>,
  extra?: Record<string, unknown>,
): void {
  if (stateBudgetError(state)) return;
  const operation: StateSyncOperation = {
    id: crypto.randomUUID(),
    uid,
    kind,
    payload: operationPayload(kind, state, undefined, extra),
    baseRevision: stateRevision.get(uid) ?? 0,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  // Persist first. Large payloads exceed the browser's shared keepalive budget;
  // leave them queued for the next online session instead of issuing doomed PUTs.
  void enqueueStateSync(operation).then(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    return withStateSyncLock(uid, () => flushOutboxUnlocked(uid, true));
  }).catch(() => undefined);
}
