import { env } from 'cloudflare:workers';
import { currentUser, json, readJson } from './cloudflare-server';
import { bankAccessState } from './qbank-access-repository';
import { canAccessBank, canReviewBank } from './medguard-types';

type RealtimeStub = DurableObjectStub & {
  publish(topic: string): Promise<void>;
};

function realtimeStub(channel: string): RealtimeStub {
  // Wrangler cannot infer RPC methods from a Durable Object in another Worker.
  return env.REALTIME.getByName(channel) as RealtimeStub;
}

export async function connectRealtime(request: Request) {
  const url = new URL(request.url);
  if (request.headers.get('origin') !== url.origin) return json({ error: 'Invalid origin.' }, 403);
  const user = await currentUser(request);
  if (!user || user.suspended) return json({ error: 'Authentication required.' }, 401);
  const channel = url.searchParams.get('channel') ?? '';
  let allowed = channel === `user:${user.uid}`;
  if (user.status === 'approved') {
    if (channel === 'catalog') allowed = true;
    if (channel === 'admin') allowed = Boolean(user.role === 'super_admin' && user.mfaEnrolled && user.mfaVerified);
    if (channel === 'access') allowed = user.role === 'super_admin' || user.platformRoles.includes('access_manager');
    if (channel.startsWith('bank:')) {
      const state = await bankAccessState(channel.slice(5));
      const bank = state.qbanks.find(b => b.id === channel.slice(5));
      allowed = Boolean(bank && (canAccessBank(user, bank, state.memberships) || canReviewBank(user, bank, state.memberships)));
    }
  }
  if (!allowed) return json({ error: 'Channel not available.' }, 403);
  if (!env.REALTIME) return json({ error: 'Live connection is temporarily unavailable.' }, 503);
  // Do not forward cookies or accept client-selected publishing actions.
  return realtimeStub(channel).fetch(new Request('https://channel/connect', { headers: { Upgrade: 'websocket' } }));
}

export async function publishChanges(channels: Iterable<string>, topic = 'collaboration') {
  if (!env.REALTIME) return;
  const results = await Promise.allSettled([...new Set(channels)].map(channel => realtimeStub(channel).publish(topic)));
  if (results.some(result => result.status === 'rejected')) console.error(JSON.stringify({ event: 'realtime_publish_failed' }));
}

// Called only after a mutation has succeeded. No content, names or record IDs
// are sent over the socket; the client re-fetches through existing permissions.
export async function notifyMutation(request: Request) {
  const path = new URL(request.url).pathname.split('/').slice(3);
  if (['state', 'media', 'ids'].includes(path[0]) || (path[0] === 'platform' && path[1] === 'quote')) return;
  const input = await readJson<Record<string, unknown>>(request, 2_000_000);
  const user = await currentUser(request);
  const channels = new Set<string>(['admin']);
  if (user) channels.add(`user:${user.uid}`);
  const addUser = (id: unknown) => { if (typeof id === 'string' && id) channels.add(`user:${id}`); };
  const addBank = (id: unknown) => { if (typeof id === 'string' && id) channels.add(`bank:${id}`); };
  addUser(input.userId);
  addBank(input.qbankId ?? input.bankId);
  let topic = 'collaboration';
  if (path[0] === 'contact') {
    topic = 'contact';
    const ticketId = typeof input.id === 'string' ? input.id : '';
    const ticket = await env.DB.prepare('SELECT user_id FROM tickets WHERE id=?').bind(ticketId).first<{ user_id: string }>();
    addUser(ticket?.user_id);
    // On deletion, the preserved audit has the owner without retaining content.
    if (!ticket && ticketId) {
      const audit = await env.DB.prepare("SELECT json_extract(payload,'$.detail') AS detail FROM records WHERE type='auditLog' AND json_extract(payload,'$.entityId')=? AND json_extract(payload,'$.action')='ticket_deleted' ORDER BY updated_at DESC LIMIT 1").bind(ticketId).first<{ detail: string }>();
      if (audit) addUser((JSON.parse(audit.detail) as { previous?: { ownerId?: string } }).previous?.ownerId);
    }
  } else if (path[0] === 'collaboration' && Array.isArray(input.operations)) {
    for (const operation of input.operations as Array<{ collection: string; id: string; type: string; value?: Record<string, unknown> }>) {
      const value = operation.value ?? {};
      addBank(value.qbankId);
      addUser(value.userId ?? value.proposedById);
      if (operation.collection === 'profiles') { addUser(operation.id); channels.add('access'); }
      if (operation.collection === 'qbanks') { addBank(operation.id); channels.add('catalog'); }
      if (operation.type === 'delete' || ['qbankMemberships', 'qbankInvitations', 'system'].includes(operation.collection)) channels.add('catalog');
    }
  } else if (path[0] === 'platform' && path[1] === 'discounts') {
    topic = 'pricing'; channels.add('catalog');
  } else if (path[0] === 'platform' && path[1] === 'subscriptions') {
    topic = 'account'; channels.add('access');
  } else if (path[0] === 'platform' && path[1] === 'bulk-review' && Array.isArray(input.proposalIds)) {
    const rows = await env.DB.prepare("SELECT qbank_id FROM records WHERE type='questionProposals' AND id IN (SELECT value FROM json_each(?)) GROUP BY qbank_id")
      .bind(JSON.stringify(input.proposalIds)).all<{ qbank_id: string }>();
    rows.results.forEach(row => addBank(row.qbank_id));
  } else if (path[0] === 'auth') {
    if (path[1] !== 'register') return;
    channels.add('access');
  } else if (path[0] === 'qbanks' || path[1] === 'question') {
    channels.add('catalog');
  }
  await publishChanges(channels, topic);
}
