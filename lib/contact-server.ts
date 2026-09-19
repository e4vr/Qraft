import { env } from 'cloudflare:workers';
import { currentUser } from './cloudflare-server';
import { assertSameOrigin, readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { auditStatement } from './platform-server';
import { CONTRIBUTION_CREDITS } from '@/features/subscriptions/domain/plan-config';
import { bankAccessState } from './qbank-access-repository';
import {
  canAccessBank,
  canReviewBank,
} from '@/features/access/domain/access-policy';

export async function contactApi(request: Request) {
  if (request.method !== 'GET') assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved' || user.suspended)
    return json({ error: 'Approved account required.' }, 403);
  const root =
    user.role === 'super_admin' && user.mfaEnrolled && user.mfaVerified;
  const url = new URL(request.url);
  const input =
    request.method === 'GET'
      ? {}
      : await readJson<Record<string, unknown>>(request, 80_000);
  const text = (key: string) =>
    typeof input[key] === 'string' ? (input[key] as string).trim() : '';
  const id = url.searchParams.get('id') || text('id');
  const ticket = id
    ? await env.DB.prepare('SELECT id,user_id,title,status,question_uuid,question_linked,created_at,updated_at FROM tickets WHERE id=?')
        .bind(id)
        .first<{ id: string; user_id: string; title: string; status: string; question_uuid: string | null; question_linked: number; created_at: string; updated_at: string }>()
    : null;
  if (id && (!ticket || (!root && ticket.user_id !== user.uid)))
    return json({ error: 'Ticket not found.' }, 404);
  if (request.method === 'GET') {
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    if (ticket) {
      const messages = await env.DB.prepare(
        "SELECT m.id,json_extract(p.profile_json,'$.displayName') AS name,json_extract(p.profile_json,'$.role') AS role,m.body,m.attachment,m.created_at FROM ticket_messages m JOIN profiles p ON p.uid=m.user_id WHERE ticket_id=? ORDER BY m.created_at,m.id LIMIT 51 OFFSET ?",
      )
        .bind(id, offset)
        .all();
      return json({ ticket, messages: messages.results });
    }
    const search = `%${(url.searchParams.get('search') || '').replace(/^#/, '').slice(0, 100)}%`,
      status = url.searchParams.get('status') || '';
    const rows = await env.DB.prepare(
      `SELECT t.id,t.title,t.status,t.user_id,p.email,json_extract(p.profile_json,'$.displayName') AS name,CASE WHEN t.question_linked=1 THEN coalesce(q.question_id,'deleted') END AS question_id,t.created_at,t.updated_at FROM tickets t JOIN profiles p ON p.uid=t.user_id LEFT JOIN question_registry q ON q.uuid=t.question_uuid WHERE (?=1 OR t.user_id=?) AND (?='' OR t.status=?) AND (t.title LIKE ? OR t.id LIKE ? OR p.email LIKE ? OR q.question_id LIKE ?) ORDER BY t.updated_at DESC,t.id LIMIT 51 OFFSET ?`,
    )
      .bind(
        root ? 1 : 0,
        user.uid,
        status,
        status,
        search,
        search,
        search,
        search,
        offset,
      )
      .all();
    return json({ tickets: rows.results });
  }
  const now = new Date().toISOString();
  if (request.method === 'DELETE') {
    if (!ticket) return json({ error: 'Ticket not found.' }, 404);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM ticket_messages WHERE ticket_id=?').bind(id),
      env.DB.prepare('DELETE FROM tickets WHERE id=?').bind(id),
      auditStatement(user, 'ticket_deleted', id, { ownerId: ticket.user_id, status: ticket.status }, null),
    ]);
    return json({ deletedId: id });
  }
  if (input.attachment != null && input.attachment !== '')
    return json({ error: 'Image attachments are no longer supported. Describe the issue in text.' }, 400);
  if (text('operation') === 'status') {
    if (!root || !ticket) return json({ error: 'Superadmin required.' }, 403);
    if (!['open', 'in_progress', 'resolved', 'closed'].includes(text('status')))
      return json({ error: 'Invalid status.' }, 400);
    if (text('status') === ticket.status)
      return json({ ticket, unchanged: true }, 200, { 'x-qraft-unchanged': '1' });
    const statements = [
      env.DB.prepare(
        'UPDATE tickets SET status=?,updated_at=? WHERE id=?',
      ).bind(text('status'), now, id),
      auditStatement(
        user,
        'ticket_status_changed',
        id,
        ticket.status,
        text('status'),
      ),
    ];
    if (
      text('status') === 'resolved' &&
      ticket.status !== 'resolved' &&
      ticket.question_linked === 1
    )
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO credit_transactions
            (id,user_id,amount,lifetime_delta,type,reason,reference_type,reference_id,created_by,created_at,metadata)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          `valid-report-${ticket.id}`,
          ticket.user_id,
          CONTRIBUTION_CREDITS.validReport,
          CONTRIBUTION_CREDITS.validReport,
          'approved_contribution',
          'Valid question report',
          'ticket',
          ticket.id,
          user.uid,
          now,
          '{}',
        ),
      );
    await env.DB.batch(statements);
    return json({ ticket: { ...ticket, status: text('status'), updated_at: now } });
  }
  const body = text('body'),
    title = text('title');
  if (
    !body ||
    body.length > 10000 ||
    (!ticket && (!title || title.length > 160))
  )
    return json(
      {
        error:
          'A title (up to 160 characters) and description (up to 10,000 characters) are required.',
      },
      400,
    );
  if (ticket && !root && ticket.status !== 'in_progress')
    return json(
      {
        error:
          'You can reply when the administrator marks the ticket In Progress to request clarification.',
      },
      409,
    );
  let questionUuid: string | null = null;
  if (!ticket && text('questionId')) {
    const q = await env.DB.prepare(
      'SELECT uuid,qbank_id FROM question_registry WHERE question_id=?',
    )
      .bind(text('questionId').replace(/^#/, '').padStart(5, '0'))
      .first<{ uuid: string; qbank_id: string }>();
    if (!q) return json({ error: 'Question not found' }, 404);
    const state = await bankAccessState(q.qbank_id);
    const bank = state.qbanks.find((x) => x.id === q.qbank_id);
    if (
      !bank ||
      !(
        canAccessBank(user, bank, state.memberships) ||
        canReviewBank(user, bank, state.memberships)
      )
    )
      return json({ error: 'Question not found' }, 404);
    questionUuid = q.uuid;
  }
  const ticketId = id || `T-${crypto.randomUUID()}`;
  const messageId = text('requestId');
  if (!/^[a-zA-Z0-9-]{20,80}$/.test(messageId))
    return json({ error: 'Invalid request ID.' }, 400);
  const prior = await env.DB.prepare(
    'SELECT ticket_id,user_id FROM ticket_messages WHERE id=?',
  )
    .bind(messageId)
    .first<{ ticket_id: string; user_id: string }>();
  if (prior)
    return prior.user_id === user.uid
      ? json({ ok: true, id: prior.ticket_id })
      : json({ error: 'Invalid request ID.' }, 409);
  const statements = [];
  if (!ticket)
    statements.push(
      env.DB.prepare('INSERT INTO tickets VALUES(?,?,?,?,?,?,?,?)').bind(
        ticketId,
        user.uid,
        title,
        'open',
        questionUuid,
        questionUuid ? 1 : 0,
        now,
        now,
      ),
    );
  else
    statements.push(
      env.DB.prepare('UPDATE tickets SET updated_at=? WHERE id=?').bind(
        now,
        ticketId,
      ),
    );
  statements.push(
    env.DB.prepare('INSERT INTO ticket_messages VALUES(?,?,?,?,?,?)').bind(
      messageId,
      ticketId,
      user.uid,
      body,
      null,
      now,
    ),
    auditStatement(
      user,
      ticket ? 'ticket_replied' : 'ticket_created',
      ticketId,
      null,
      { messageId },
    ),
  );
  await env.DB.batch(statements);
  return json({
    id: ticketId,
    ticket: ticket
      ? { ...ticket, updated_at: now }
      : {
          id: ticketId,
          title,
          status: 'open',
          user_id: user.uid,
          email: user.email,
          name: user.displayName,
          question_id: text('questionId')
            ? text('questionId').replace(/^#/, '').padStart(5, '0')
            : null,
          created_at: now,
          updated_at: now,
        },
    message: {
      id: messageId,
      name: user.displayName,
      role: user.role,
      body,
      attachment: null,
      created_at: now,
    },
  });
}
