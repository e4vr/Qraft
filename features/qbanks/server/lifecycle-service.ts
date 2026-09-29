import { env } from 'cloudflare:workers';
import { currentUser } from '@/features/auth/server/auth-service';
import { canDeleteBank } from '@/features/access/domain/access-policy';
import { bankAccessState } from '@/lib/qbank-access-repository';
import { saveCollaboration } from '@/features/collaboration/server/collaboration-service';
import type { QBank } from '@/lib/medguard-types';
import { assertSameOrigin, readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { bankDeletionStatements } from './bank-deletion';

export async function createQBank(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved')
    return json({ error: 'Approved account required.' }, 403);
  const input = await readJson<{ bank?: QBank }>(request);
  const bank = input.bank;
  if (
    !bank ||
    typeof bank.id !== 'string' ||
    !bank.id ||
    bank.id.length > 200 ||
    typeof bank.name !== 'string' ||
    !bank.name.trim() ||
    bank.name.length > 200 ||
    typeof bank.shortName !== 'string' ||
    bank.shortName.length > 18 ||
    typeof bank.description !== 'string' ||
    bank.description.length > 5000 ||
    !['public', 'private'].includes(bank.visibility) ||
    bank.ownerId !== user.uid ||
    bank.createdById !== user.uid ||
    typeof bank.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(bank.createdAt)) ||
    typeof bank.essential !== 'boolean' ||
    bank.shareEnabled !== false ||
    bank.shareToken ||
    bank.reviewerIds?.length ||
    bank.viewerIds?.length
  )
    return json({ error: 'Invalid QBank details.' }, 400);
  const state = await bankAccessState(bank.id);
  const existing = state.qbanks.find((item) => item.id === bank.id);
  if (existing) {
    if (existing.ownerId !== user.uid || existing.createdAt !== bank.createdAt)
      return json({ error: 'This QBank ID is already in use.' }, 409);
    return json({ ok: true, bank: existing }, 200, {
      'x-qraft-unchanged': '1',
    });
  }
  const canonical: QBank = {
    ...bank,
    name: bank.name.trim(),
    ownerName: user.displayName,
    createdByName: user.displayName,
    reviewerIds: [],
    viewerIds: [],
    archived: false,
  };
  const mutation = new Request(request.url, {
    method: 'PUT',
    headers: request.headers,
    body: JSON.stringify({
      operations: [
        { collection: 'qbanks', id: bank.id, type: 'set', value: canonical },
      ],
    }),
  });
  const response = await saveCollaboration(mutation);
  if (!response.ok) return response;
  return json({ ok: true, bank: canonical });
}

export async function deleteQBank(request: Request, id: string) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved')
    return json({ error: 'Approved account required.' }, 403);
  const state = await bankAccessState(id);
  const bank = state.qbanks.find((item) => item.id === id);
  if (!bank) {
    const deleted = await env.DB.prepare(
      "SELECT owner_id FROM records WHERE type='qbankTombstones' AND id=?",
    )
      .bind(id)
      .first<{ owner_id: string }>();
    if (
      !deleted ||
      (user.role !== 'super_admin' && deleted.owner_id !== user.uid)
    )
      return json(
        { error: 'Only the QBank owner or Superadmin can delete this bank.' },
        403,
      );
    return json({ ok: true, deletedId: id }, 200, { 'x-qraft-unchanged': '1' });
  }
  if (!canDeleteBank(user, bank))
    return json(
      { error: 'Only the QBank owner or Superadmin can delete this bank.' },
      403,
    );
  try {
    await env.DB.batch(
      bankDeletionStatements(user, bank, new Date().toISOString()),
    );
  } catch (error) {
    const current = (await bankAccessState(id)).qbanks.find(
      (item) => item.id === id,
    );
    if (current && !canDeleteBank(user, current))
      return json(
        {
          error:
            'QBank ownership changed. Only its current owner or Superadmin can delete it.',
        },
        403,
      );
    throw error;
  }
  return json({ ok: true, deletedId: id }, 200, {
    'x-qraft-media-cleanup': '1',
  });
}
