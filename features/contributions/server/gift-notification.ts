import { env } from 'cloudflare:workers';
import { json } from '@/server/http/response';
import { publishChanges } from '@/lib/realtime-server';
import type { GiftNotification } from '../domain/reward-pass';

const giftFields = 'id,plan,duration,duration_unit,duration_days,created_at';

// The existing user/status index bounds this query to the owner's wallet.
// Keep presentation metadata on the pass so backups and account deletion
// retain their existing behavior, without another table or notification log.
export async function giftNotificationApi(
  request: Request,
  userId: string,
  input: Record<string, unknown>,
) {
  if (request.method === 'GET') {
    const gift = await env.DB.prepare(`SELECT ${giftFields} FROM reward_passes
      WHERE user_id=? AND status='available' AND source='admin'
      AND json_extract(metadata,'$.giftPopupSeenAt') IS NULL
      ORDER BY created_at DESC,id DESC LIMIT 1`)
      .bind(userId)
      .first<GiftNotification>();
    return json({ gift });
  }
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed.' }, 405);
  const now = new Date().toISOString();
  if (input.operation === 'migrate-seen') {
    if (
      !Array.isArray(input.passIds) ||
      input.passIds.length > 100 ||
      input.passIds.some(
        (id) => typeof id !== 'string' || !id || id.length > 160,
      )
    )
      return json({ error: 'Invalid gift history.' }, 400);
    const result = await env.DB.prepare(`UPDATE reward_passes
      SET metadata=json_set(metadata,'$.giftPopupSeenAt',?)
      WHERE user_id=? AND source='admin' AND json_extract(metadata,'$.giftPopupSeenAt') IS NULL
      AND id IN (SELECT value FROM json_each(?))`)
      .bind(now, userId, JSON.stringify([...new Set(input.passIds)]))
      .run();
    return json({ ok: true, unchanged: !result.meta.changes });
  }
  if (
    input.operation !== 'claim' ||
    typeof input.passId !== 'string' ||
    !input.passId ||
    input.passId.length > 160
  )
    return json({ error: 'Invalid gift notification.' }, 400);
  // Exactly one request may claim presentation, even across devices. Checking
  // eligibility and marking it seen happen in the same statement. Display only
  // after this acknowledgement; a failed/ambiguous response never opens a popup.
  const gift =
    await env.DB.prepare(`UPDATE reward_passes SET metadata=json_set(metadata,'$.giftPopupSeenAt',?)
    WHERE id=? AND user_id=? AND source='admin' AND status='available'
    AND json_extract(metadata,'$.giftPopupSeenAt') IS NULL RETURNING ${giftFields}`)
      .bind(now, input.passId, userId)
      .first<GiftNotification>();
  if (gift)
    await publishChanges(
      [`user:${userId}`],
      ['gift-notification'],
      request.headers.get('x-qraft-client-id') ?? '',
    );
  return json({ gift, unchanged: !gift });
}
