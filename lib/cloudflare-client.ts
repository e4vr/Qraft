import type { AppState, AppUser, CollaborationState } from './medguard-types';

const API = '/api/cloudflare';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${API}${path}`, { credentials: 'same-origin', ...init, headers });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Cloudflare request failed (${response.status}).`);
  return payload;
}

export async function observeCloudflareUser(callback: (user?: AppUser) => void): Promise<() => void> {
  const { user } = await api<{ user: AppUser | null }>('/auth/session');
  callback(user ?? undefined);
  return () => undefined;
}

export async function signInCloudflare(email: string, password: string): Promise<AppUser> {
  try {
    return (await api<{ user: AppUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })).user;
  } catch (error) {
    if (error instanceof Error && error.message === 'MFA_REQUIRED') throw error;
    throw error;
  }
}

export async function completeCloudflareMfaSignIn(code: string): Promise<AppUser> {
  return (await api<{ user: AppUser }>('/auth/mfa', { method: 'POST', body: JSON.stringify({ code }) })).user;
}

export async function createCloudflareAccount(name: string, email: string, password: string, universityId: string, phone: string, setupToken?: string): Promise<AppUser> {
  return (await api<{ user: AppUser }>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, universityId, phone, setupToken }) })).user;
}

export async function signOutCloudflare(): Promise<void> {
  await api('/auth/logout', { method: 'POST', body: '{}' });
}

export async function updateCloudflareProfile(displayName: string, phone: string): Promise<AppUser> {
  return (await api<{ user: AppUser }>('/auth/profile', { method: 'PUT', body: JSON.stringify({ displayName, phone }) })).user;
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

export async function loadCloudState(_uid: string): Promise<AppState | undefined> {
  return (await api<{ state: AppState | null }>('/state')).state ?? undefined;
}

export async function saveCloudState(_uid: string, state: AppState): Promise<void> {
  await api('/state', { method: 'PUT', body: JSON.stringify({ state }) });
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

export async function joinCloudflareQBankByLink(_user: AppUser, qbankId: string, token: string): Promise<void> {
  await api('/qbanks/join', { method: 'POST', body: JSON.stringify({ qbankId, token }) });
}

export interface QBankLinkInvitation {
  qbankId: string;
  bankName: string;
  description: string;
  ownerName: string;
  role: 'viewer';
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

export async function loadCollaborationState(_user: AppUser): Promise<CollaborationState> {
  return (await api<{ collaboration: CollaborationState }>('/collaboration')).collaboration;
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
  changed(next.qbanks, previous.qbanks, (item) => item.id).forEach((bank) => {
    if (bank.shareToken) writes.push({ collection: 'qbankShareLinks', id: bank.shareToken, value: { id: bank.shareToken, qbankId: bank.id, bankName: bank.name, description: bank.description, ownerId: bank.ownerId, ownerName: bank.ownerName, enabled: bank.shareEnabled, updatedAt: new Date().toISOString() }, type: 'set' });
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
  collect('answerStats', Object.values(next.answerStats), Object.values(previous.answerStats), (item) => item.id, true);
  collect('sharedNotes', Object.values(next.sharedNotes), Object.values(previous.sharedNotes), (item) => item.id, true);
  collect('auditLog', next.auditLog, previous.auditLog, (item) => item.id);
  const operations = [...deletes, ...writes];
  if (operations.length) await api('/collaboration', { method: 'PUT', body: JSON.stringify({ operations }) });
}
