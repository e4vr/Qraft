import { normalizeAppState, type AppState, type AppUser, type CollaborationState } from './medguard-types';
import { ApiError, api, clearResourceCache, setApiCache } from './api-client';
import { mergeAppStates } from './merge-app-state';
import {
  enqueueStateSync,
  loadStateSyncOutbox,
  noteStateSyncAttempt,
  removeStateSync,
  type StateSyncKind,
  type StateSyncOperation,
} from './local-db';
import { publishStateSync, subscribeStateSync, withStateSyncLock } from './tab-sync';
export { api } from './api-client';

export async function observeCloudflareUser(callback: (user?: AppUser) => void): Promise<() => void> {
  const { user } = await api<{ user: AppUser | null }>('/auth/session');
  callback(user ?? undefined);
  return () => undefined;
}

export function setAuthenticatedUserCache(user: AppUser) {
  setApiCache('/auth/session', { user });
}

export async function signInCloudflare(email: string, password: string): Promise<AppUser> {
  clearResourceCache();
  try {
    const result = await api<{ user: AppUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setAuthenticatedUserCache(result.user);
    return result.user;
  } catch (error) {
    if (error instanceof Error && error.message === 'MFA_REQUIRED') throw error;
    throw error;
  }
}

export async function completeCloudflareMfaSignIn(code: string): Promise<AppUser> {
  const result = await api<{ user: AppUser }>('/auth/mfa', { method: 'POST', body: JSON.stringify({ code }) });
  setAuthenticatedUserCache(result.user);
  return result.user;
}

export async function createCloudflareAccount(name: string, email: string, password: string, universityId: string, phone: string, setupToken?: string): Promise<AppUser> {
  clearResourceCache();
  const result = await api<{ user: AppUser }>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, universityId, phone, setupToken }) });
  setAuthenticatedUserCache(result.user);
  return result.user;
}

export async function signOutCloudflare(): Promise<void> {
  await api('/auth/logout', { method: 'POST', body: '{}' });
  clearResourceCache();
}

export async function updateCloudflareProfile(displayName: string, phone: string): Promise<AppUser> {
  const result = await api<{ user: AppUser }>('/auth/profile', { method: 'PUT', body: JSON.stringify({ displayName, phone }) });
  setAuthenticatedUserCache(result.user);
  return result.user;
}

export async function changeCloudflarePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api('/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
}

export async function beginTotpEnrollment(): Promise<{ secretKey: string; qrUrl: string }> {
  return api('/auth/mfa-begin', { method: 'POST', body: '{}' });
}

export async function completeTotpEnrollment(code: string): Promise<void> {
  await api('/auth/mfa-complete', { method: 'POST', body: JSON.stringify({ code }) });
}

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
) {
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

function operationPath(kind: StateSyncKind) {
  return kind === 'full' ? '/state' : `/state/${kind}`;
}

function operationMatchesSaved(uid: string, kind: StateSyncKind, payload: Record<string, unknown>) {
  const raw = lastSavedState.get(uid);
  if (!raw) return false;
  const saved = JSON.parse(raw) as AppState;
  if (kind === 'full') return JSON.stringify(cloudState(saved)) === JSON.stringify(payload.state);
  if (kind === 'daily-goal') return saved.settings.dailyGoal === payload.dailyGoal;
  return JSON.stringify(operationPayload(kind, saved)) === JSON.stringify(payload);
}

async function sendStateOperation(operation: StateSyncOperation): Promise<StateSyncResponse> {
  const path = operationPath(operation.kind);
  const request = (baseRevision: number, payload: Record<string, unknown>) =>
    api<StateSyncResponse>(path, {
      method: 'PUT',
      body: JSON.stringify({ ...payload, baseRevision, operationId: operation.id }),
    });
  try {
    return await request(operation.baseRevision, operation.payload);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    const remote = error.payload.state as AppState | undefined;
    const revision = Number(error.payload.revision);
    if (!remote || !Number.isInteger(revision)) throw error;
    stateRevision.set(operation.uid, revision);
    let payload = operation.payload;
    const localUpdatedAt = typeof operation.payload.clientUpdatedAt === 'string'
      ? operation.payload.clientUpdatedAt
      : '';
    if (operation.kind === 'full') {
      payload = { state: cloudState(mergeAppStates(operation.payload.state as AppState, remote)) };
    } else if (
      operation.kind !== 'daily-goal' &&
      localUpdatedAt < (remote.clientUpdatedAt ?? '')
    ) {
      payload = {
        ...operationPayload(operation.kind, remote),
        ...(operation.kind === 'exam' ? { answerSelections: operation.payload.answerSelections } : {}),
      };
    }
    return request(revision, payload);
  }
}

async function flushOutboxUnlocked(uid: string): Promise<StateSyncResponse | undefined> {
  let latest: StateSyncResponse | undefined;
  for (const operation of await loadStateSyncOutbox(uid)) {
    await noteStateSyncAttempt(uid, operation.id);
    const result = await sendStateOperation(operation);
    stateRevision.set(uid, result.revision);
    lastSavedState.set(uid, JSON.stringify(cloudState(result.state)));
    setApiCache('/state', { state: result.state, revision: result.revision, updatedAt: result.updatedAt }, { cacheScope: uid });
    await removeStateSync(uid, operation.id);
    publishStateSync({ uid, state: result.state, revision: result.revision, updatedAt: result.updatedAt });
    latest = result;
  }
  return latest;
}

export async function loadCloudState(uid: string): Promise<AppState | undefined> {
  const result = await api<{ state: AppState | null; revision: number; updatedAt?: string }>('/state', { cacheScope: uid });
  const state = result.state ?? undefined;
  stateRevision.set(uid, result.revision ?? 0);
  if (state) lastSavedState.set(uid, JSON.stringify(cloudState(state)));
  return state;
}

export async function flushPendingCloudState(uid: string): Promise<AppState | undefined> {
  const result = await withStateSyncLock(uid, () => flushOutboxUnlocked(uid));
  return result?.state;
}

export function observeCloudStateSync(uid: string, callback: (state: AppState) => void) {
  return subscribeStateSync(notice => {
    if (notice.uid !== uid) return;
    stateRevision.set(uid, notice.revision);
    lastSavedState.set(uid, JSON.stringify(cloudState(notice.state)));
    setApiCache('/state', { state: notice.state, revision: notice.revision, updatedAt: notice.updatedAt }, { cacheScope: uid });
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
  return withStateSyncLock(uid, () => flushOutboxUnlocked(uid));
}

export async function saveCloudState(uid: string, state: AppState): Promise<AppState | undefined> {
  return (await queueStateOperation(uid, 'full', state))?.state;
}

export async function saveExamCheckpoint(
  uid: string,
  state: AppState,
  answerSelections: Array<{ qbankId: string; questionId: string; answer: number }>,
): Promise<AppState | undefined> {
  return (await queueStateOperation(uid, 'exam', state, undefined, { answerSelections }))?.state;
}

export async function saveFlashcardCheckpoint(uid: string, state: AppState): Promise<AppState | undefined> {
  return (await queueStateOperation(uid, 'flashcards', state))?.state;
}

export async function saveDailyGoal(uid: string, state: AppState, dailyGoal: number): Promise<AppState | undefined> {
  return (await queueStateOperation(uid, 'daily-goal', state, dailyGoal))?.state;
}

export function saveBestEffortStateCheckpoint(
  uid: string,
  state: AppState,
  kind: Exclude<StateSyncKind, 'daily-goal'>,
  extra?: Record<string, unknown>,
) {
  const operation: StateSyncOperation = {
    id: crypto.randomUUID(),
    uid,
    kind,
    payload: operationPayload(kind, state, undefined, extra),
    baseRevision: stateRevision.get(uid) ?? 0,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  void enqueueStateSync(operation);
  const body = JSON.stringify({ ...operation.payload, baseRevision: operation.baseRevision, operationId: operation.id });
  void fetch(`/api/cloudflare${operationPath(kind)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body,
  }).catch(() => undefined);
}

export async function registerStartedExam(
  testId: string,
  questionCount: number,
): Promise<{ started: boolean; startedAt: string; duplicate?: boolean }> {
  return api('/platform/exam-start', {
    method: 'POST',
    body: JSON.stringify({ testId, questionCount }),
  });
}

async function upload(file: File, qbankId: string, questionId: string, kind: 'notes' | 'questions') {
  const form = new FormData();
  form.append('file', file);
  form.append('qbankId', qbankId);
  form.append('questionId', questionId);
  return (await api<{ url: string }>(`/media/${kind}`, { method: 'POST', body: form })).url;
}

export async function uploadNoteImage(_uid: string, file: File, qbankId = 'smle-gs', questionId = 'general'): Promise<string> {
  return upload(file, qbankId, questionId, 'notes');
}

export async function uploadQuestionImage(_uid: string, file: File, qbankId: string, questionId: string): Promise<string> {
  return upload(file, qbankId, questionId, 'questions');
}

export async function deleteQBankImages(qbankId: string): Promise<void> {
  await api(`/media/${encodeURIComponent(qbankId)}`, { method: 'DELETE', body: '{}' });
}

export async function reserveQuestionIds(count: number, qbankId: string, _user: AppUser, knownQuestionIds: string[]): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error('You can add between 1 and 200 questions at a time.');
  const highestKnown = knownQuestionIds.reduce((highest, value) => /^\d{5}$/.test(value) ? Math.max(highest, Number(value)) : highest, 217);
  return (await api<{ ids: string[] }>('/ids/reserve', { method: 'POST', body: JSON.stringify({ count, qbankId, highestKnown }) })).ids;
}

export async function joinCloudflareQBankByLink(_user: AppUser, qbankId: string, token: string): Promise<CollaborationState['memberships'][number]> {
  return (await api<{ membership: CollaborationState['memberships'][number] }>('/qbanks/join', { method: 'POST', body: JSON.stringify({ qbankId, token }) })).membership;
}

export interface QBankLinkInvitation {
  qbankId: string;
  bankName: string;
  description: string;
  ownerName: string;
  role: 'viewer';
}

type CollaborationResponse = { collaboration: CollaborationState };

let collaborationScope = '';

function collaborationRequest(user: AppUser, force = false) {
  collaborationScope = user.uid;
  return api<CollaborationResponse>(
    '/collaboration',
    {
      cacheScope: user.uid,
      forceRefresh: force,
      requestReason: force ? 'explicit-refresh' : undefined,
    },
  );
}

export async function previewCloudflareQBankInvitation(qbankId: string, token: string): Promise<QBankLinkInvitation> {
  return (await api<{ invitation: QBankLinkInvitation }>('/qbanks/invite-preview', {
    method: 'POST',
    body: JSON.stringify({ qbankId, token }),
  })).invitation;
}

function changed<T>(next: T[], previous: T[], key: (item: T) => string) {
  const old = new Map(previous.map((item) => [key(item), JSON.stringify(item)]));
  return next.filter((item) => old.get(key(item)) !== JSON.stringify(item));
}

export async function loadCollaborationState(user: AppUser, force = false): Promise<CollaborationState> {
  return (await collaborationRequest(user, force)).collaboration;
}

export async function saveCollaborationState(next: CollaborationState, previous: CollaborationState): Promise<void> {
  const writes: Array<{ collection: string; id: string; value: unknown; type: 'set' }> = [];
  const deletes: Array<{ collection: string; id: string; type: 'delete' }> = [];
  const collect = <T>(collection: string, values: T[], old: T[], key: (item: T) => string, deleteMissing = false) => {
    changed(values, old, key).forEach((item) => writes.push({ collection, id: key(item), value: item, type: 'set' }));
    if (deleteMissing) {
      const currentKeys = new Set(values.map(key));
      old.filter((item) => !currentKeys.has(key(item))).forEach((item) => deletes.push({ collection, id: key(item), type: 'delete' }));
    }
  };
  collect('qbanks', next.qbanks, previous.qbanks, (item) => item.id, true);
  collect('qbankFolders', next.qbankFolders, previous.qbankFolders, (item) => item.id, true);
  changed(next.qbanks, previous.qbanks, (item) => item.id).forEach((bank) => {
    const oldBank = previous.qbanks.find((item) => item.id === bank.id);
    if (bank.shareToken && (!oldBank || oldBank.shareToken !== bank.shareToken || oldBank.shareEnabled !== bank.shareEnabled)) writes.push({ collection: 'qbankShareLinks', id: bank.shareToken, value: { id: bank.shareToken, qbankId: bank.id, bankName: bank.name, description: bank.description, ownerId: bank.ownerId, ownerName: bank.ownerName, enabled: bank.shareEnabled, updatedAt: new Date().toISOString() }, type: 'set' });
  });
  previous.qbanks.forEach((oldBank) => {
    const nextBank = next.qbanks.find((item) => item.id === oldBank.id);
    if (oldBank.shareToken && oldBank.shareToken !== nextBank?.shareToken) deletes.push({ collection: 'qbankShareLinks', id: oldBank.shareToken, type: 'delete' });
  });
  collect('qbankMemberships', next.memberships, previous.memberships, (item) => item.id, true);
  collect('qbankInvitations', next.invitations, previous.invitations, (item) => item.id, true);
  collect('profiles', next.members, previous.members, (item) => item.uid);
  collect('universityIds', next.allowedUniversityIds, previous.allowedUniversityIds, (item) => item.id);
  if (JSON.stringify(next.blockedAccess) !== JSON.stringify(previous.blockedAccess)) writes.push({ collection: 'system', id: 'accessControl', value: { id: 'accessControl', ...next.blockedAccess, updatedAt: new Date().toISOString() }, type: 'set' });
  collect('adminInvites', next.adminInvites, previous.adminInvites, (item) => item.id);
  collect('questionProposals', next.proposals, previous.proposals, (item) => item.id, true);
  collect('roleApplications', next.roleApplications, previous.roleApplications, (item) => item.id);
  collect('sharedQuestions', next.approvedQuestions, previous.approvedQuestions, (item) => item.id, true);
  collect('qbankSpecialties', next.specialties, previous.specialties, (item) => item.id, true);
  collect('qbankTopics', next.topics, previous.topics, (item) => item.id, true);
  collect('answerStats', Object.values(next.answerStats), Object.values(previous.answerStats), (item) => item.id, true);
  collect('sharedNotes', Object.values(next.sharedNotes), Object.values(previous.sharedNotes), (item) => item.id, true);
  collect('auditLog', next.auditLog, previous.auditLog, (item) => item.id);
  const operations = [...deletes, ...writes];
  if (operations.length) {
    await api('/collaboration', { method: 'PUT', body: JSON.stringify({ operations }) });
    if (collaborationScope)
      setApiCache('/collaboration', { collaboration: next }, { cacheScope: collaborationScope });
  }
}
