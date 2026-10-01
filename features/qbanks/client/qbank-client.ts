import { api } from '@/lib/api-client';
import { rebasePendingCollaboration } from '@/lib/local-db';
import { withoutQBank } from '../domain/bank-state';
import { withStateSyncLock } from '@/lib/tab-sync';
import type { AppUser, CollaborationState, QBank } from '@/lib/medguard-types';

export async function createQBank(uid: string, bank: QBank): Promise<QBank> {
  return withStateSyncLock(`collaboration:${uid}`, async () => {
    const result = await api<{ ok: boolean; bank: QBank }>('/qbanks', {
      method: 'POST',
      expectedUserId: uid,
      body: JSON.stringify({ bank }),
    });
    if (result.ok !== true || result.bank?.id !== bank.id)
      throw new Error(
        'The QBank creation was not confirmed. Keep these details and retry.',
      );
    await rebasePendingCollaboration(uid, (current) => ({
      ...current,
      qbanks: [
        ...current.qbanks.filter((item) => item.id !== bank.id),
        result.bank,
      ],
    }));
    return result.bank;
  });
}

export async function deleteQBank(uid: string, bankId: string): Promise<void> {
  return withStateSyncLock(`collaboration:${uid}`, async () => {
    const result = await api<{ ok: boolean; deletedId: string }>(
      `/qbanks/${encodeURIComponent(bankId)}`,
      {
        method: 'DELETE',
        expectedUserId: uid,
      },
    );
    if (result.ok !== true || result.deletedId !== bankId)
      throw new Error(
        'The QBank deletion was not confirmed. Retry before leaving this page.',
      );
    await rebasePendingCollaboration(uid, (current) =>
      withoutQBank(current, bankId),
    );
  });
}

async function upload(
  uid: string,
  file: File,
  qbankId: string,
  questionId: string,
  kind: 'notes' | 'questions' | 'shared-notes',
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
    throw new Error(
      'The image upload was not confirmed. Keep this draft and retry.',
    );
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

export async function uploadSharedNoteImage(
  uid: string,
  file: File,
  qbankId: string,
  questionId: string,
): Promise<string> {
  return upload(uid, file, qbankId, questionId, 'shared-notes');
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
    await api<{ invitation: QBankLinkInvitation }>('/qbanks/invite-preview', {
      method: 'POST',
      body: JSON.stringify({ qbankId, token }),
    })
  ).invitation;
}
