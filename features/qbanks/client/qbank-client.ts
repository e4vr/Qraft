import { api } from '@/lib/api-client';
import type {
  AppUser,
  CollaborationState,
} from '@/lib/medguard-types';

async function upload(
  uid: string,
  file: File,
  qbankId: string,
  questionId: string,
  kind: 'notes' | 'questions',
): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('qbankId', qbankId);
  form.append('questionId', questionId);
  const result = await api<{ url: string }>(`/media/${kind}`, {
      method: 'POST',
      expectedUserId: uid,
      body: form,
    });
  if (typeof result.url !== 'string' || !result.url.trim())
    throw new Error('The image upload was not confirmed. Keep this draft and retry.');
  return result.url;
}

export async function uploadNoteImage(
  _uid: string,
  file: File,
  qbankId = 'smle-gs',
  questionId = 'general',
): Promise<string> {
  return upload(_uid, file, qbankId, questionId, 'notes');
}

export async function uploadQuestionImage(
  _uid: string,
  file: File,
  qbankId: string,
  questionId: string,
): Promise<string> {
  return upload(_uid, file, qbankId, questionId, 'questions');
}

export async function deleteQBankImages(qbankId: string): Promise<void> {
  await api(`/media/${encodeURIComponent(qbankId)}`, {
    method: 'DELETE',
    body: '{}',
  });
}

export async function reserveQuestionIds(
  count: number,
  qbankId: string,
  _user: AppUser,
  knownQuestionIds: string[],
): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1 || count > 200)
    throw new Error('You can add between 1 and 200 questions at a time.');
  const highestKnown = knownQuestionIds.reduce(
    (highest, value) =>
      /^\d{5}$/.test(value) ? Math.max(highest, Number(value)) : highest,
    217,
  );
  return (
    await api<{ ids: string[] }>('/ids/reserve', {
      method: 'POST',
      body: JSON.stringify({ count, qbankId, highestKnown }),
    })
  ).ids;
}

export async function joinCloudflareQBankByLink(
  _user: AppUser,
  qbankId: string,
  token: string,
): Promise<CollaborationState['memberships'][number]> {
  return (
    await api<{ membership: CollaborationState['memberships'][number] }>(
      '/qbanks/join',
      { method: 'POST', body: JSON.stringify({ qbankId, token }) },
    )
  ).membership;
}

export interface QBankLinkInvitation {
  qbankId: string;
  bankName: string;
  description: string;
  ownerName: string;
  role: 'viewer';
}

export async function previewCloudflareQBankInvitation(
  qbankId: string,
  token: string,
): Promise<QBankLinkInvitation> {
  return (
    await api<{ invitation: QBankLinkInvitation }>(
      '/qbanks/invite-preview',
      { method: 'POST', body: JSON.stringify({ qbankId, token }) },
    )
  ).invitation;
}
