import { env } from 'cloudflare:workers';
import { currentUser } from '@/features/auth/server/auth-service';
import { readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { bankAccessState } from './qbank-access-repository';
import {
  canAccessBank,
  canReviewBank,
  hasAccessManagerRole,
  hasModeratorRole,
} from '@/features/access/domain/access-policy';

type RealtimeStub = DurableObjectStub & {
  publish(resources: string[], originClientId?: string): Promise<void>;
  publishLegacy(resources: string[], originClientId?: string): Promise<void>;
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
    if (channel === 'admin') allowed = hasModeratorRole(user) && (user.role !== 'super_admin' || Boolean(user.mfaEnrolled && user.mfaVerified));
    if (channel === 'access') allowed = hasAccessManagerRole(user);
    if (channel.startsWith('bank:')) {
      const state = await bankAccessState(channel.slice(5));
      const bank = state.qbanks.find(b => b.id === channel.slice(5));
      allowed = Boolean(bank && (canAccessBank(user, bank, state.memberships) || canReviewBank(user, bank, state.memberships)));
    }
    if (channel.startsWith('review:bank:')) {
      const bankId = channel.slice('review:bank:'.length);
      const state = await bankAccessState(bankId);
      const bank = state.qbanks.find(item => item.id === bankId);
      allowed = Boolean(bank && canReviewBank(user, bank, state.memberships));
    }
  }
  if (!allowed) return json({ error: 'Channel not available.' }, 403);
  if (!env.REALTIME) return json({ error: 'Live connection is temporarily unavailable.' }, 503);
  // Do not forward cookies or accept client-selected publishing actions.
  const clientId = url.searchParams.get('client') ?? '';
  const headers = new Headers({ Upgrade: 'websocket' });
  if (url.searchParams.get('v') === '2') headers.set('x-qraft-live-version', '2');
  if (/^[a-f0-9-]{20,80}$/i.test(clientId)) headers.set('x-qraft-client-id', clientId);
  return realtimeStub(channel).fetch(new Request('https://channel/connect', { headers }));
}

export async function publishChanges(channels: Iterable<string>, topics: Iterable<string> = ['collaboration'], originClientId = '') {
  if (!env.REALTIME) return;
  const resources = [...new Set(topics)];
  const audience = [...new Set(channels)];
  const results = await Promise.allSettled(audience.map(channel => realtimeStub(channel).publish(resources, originClientId)));
  const failed = audience.filter((_, index) => results[index].status === 'rejected');
  if (failed.length) {
    const retries = await Promise.allSettled(failed.map(channel => realtimeStub(channel).publish(resources, originClientId)));
    if (retries.some(result => result.status === 'rejected')) console.error(JSON.stringify({ event: 'realtime_publish_failed' }));
  }
}

// Called only after a mutation has succeeded. No content, names or record IDs
// are sent over the socket; the client re-fetches through existing permissions.
export function needsMutationNotification(request: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
  const path = new URL(request.url).pathname.split('/').slice(3);
  if (
    (path[0] === 'platform' && path[1] === 'registration-policy') ||
    (['state', 'media', 'ids'].includes(path[0]) && !(path[0] === 'state' && path[1] === 'exam')) ||
    (path[0] === 'auth' && path[1] !== 'register') ||
    (path[0] === 'platform' && ['exam-start', 'quote', 'import-preview', 'announcement-dismiss', 'gift-notification'].includes(path[1]))
  )
    return false;
  return true;
}

export async function notifyMutation(request: Request, response?: Response) {
  if (!needsMutationNotification(request)) return;
  const path = new URL(request.url).pathname.split('/').slice(3);
  const input = request.body ? await readJson<Record<string, unknown>>(request, 2_000_000) : {};
  const user = await currentUser(request);
  // Results concern the participant and test owner. Publishing each completion
  // to catalog would wake every user's catalog/leaderboard consumers.
  if (path[0] === 'preformed' && path[1] === 'submit') {
    const owner = response?.headers.get('x-qraft-result-owner');
    const audience = new Set<string>();
    if (owner) audience.add(`user:${owner}`);
    if (user) audience.add(`user:${user.uid}`);
    await publishChanges(audience, ['preformed-results'], request.headers.get('x-qraft-client-id') ?? '');
    return;
  }
  if (path[0] === 'platform' && path[1] === 'import') {
    const bankId = typeof input.qbankId === 'string' ? input.qbankId : '';
    const origin = request.headers.get('x-qraft-client-id') ?? '';
    if (response?.headers.get('x-qraft-import-content-changed') === '0') {
      await publishChanges(['admin', ...(user ? [`user:${user.uid}`] : [])], ['json-import-monitor', 'audit'], origin);
      return;
    }
    const reviewers = ['admin', ...(user ? [`user:${user.uid}`] : []), ...(bankId ? [`review:bank:${bankId}`] : [])];
    await publishChanges(reviewers, ['review-queue', 'contributions', 'audit'], origin);
    await publishChanges(['admin', ...(user ? [`user:${user.uid}`] : [])], ['json-import-monitor'], origin);
    if (bankId && response?.headers.get('x-qraft-classification-changed') === '1')
      await publishChanges([`bank:${bankId}`], ['classification'], origin);
    // Older open tabs do not have the new reviewer channel. Preserve their
    // existing notifications until they reconnect with protocol version 2.
    if (bankId && env.REALTIME) {
      try { await realtimeStub(`bank:${bankId}`).publishLegacy(['review-queue', 'question-catalog'], origin); }
      catch { await publishChanges([`bank:${bankId}`], ['review-queue', 'question-catalog'], origin); }
    }
    return;
  }
  const channels = new Set<string>(['admin']);
  if (user) channels.add(`user:${user.uid}`);
  const addUser = (id: unknown) => { if (typeof id === 'string' && id) channels.add(`user:${id}`); };
  const addBank = (id: unknown) => { if (typeof id === 'string' && id) channels.add(`bank:${id}`); };
  addUser(input.userId);
  addBank(input.qbankId ?? input.bankId);
  const topics = new Set<string>();
  if (path[0] === 'state' && path[1] === 'exam' && Array.isArray(input.answerSelections)) {
    for (const selection of input.answerSelections as Array<{ qbankId?: string }>) addBank(selection.qbankId);
    topics.add('question-stats');
  } else if (path[0] === 'contact') {
    topics.add('contact');
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
      else if (operation.collection === 'qbankFolders') channels.add('catalog');
      if (operation.type === 'delete' || ['qbankMemberships', 'qbankInvitations', 'system'].includes(operation.collection)) channels.add('catalog');
      if (operation.collection === 'questionProposals') {
        topics.add('review-queue'); topics.add('contributions'); topics.add('reviewer-performance');
        if (typeof value.qbankId === 'string') channels.add(`review:bank:${value.qbankId}`);
      }
      else if (['sharedQuestions', 'qbankSpecialties', 'qbankTopics'].includes(operation.collection)) topics.add('question-catalog');
      else if (operation.collection === 'answerStats') topics.add('question-stats');
      else if (operation.collection === 'sharedNotes') topics.add('shared-notes');
      else topics.add('collaboration');
    }
  } else if (path[0] === 'qbanks') {
    addBank(path[1] ?? (input.bank as { id?: string } | undefined)?.id);
    channels.add('catalog');
    topics.add('collaboration');
    topics.add('question-catalog');
  } else if (path[0] === 'qbank-folders') {
    channels.add('catalog');
    topics.add('collaboration');
    topics.add('question-catalog');
  } else if (path[0] === 'platform' && path[1] === 'review-history') {
    topics.add('review-history');
  } else if (path[0] === 'platform' && ['discounts','plan-pricing'].includes(path[1])) {
    topics.add('pricing'); topics.add('discounts'); channels.add('catalog');
  } else if (path[0] === 'platform' && ['subscriptions', 'access-admin', 'activation-codes', 'activation-code'].includes(path[1])) {
    topics.add('account'); topics.add('subscriptions'); channels.add('access');
    topics.add('contributions'); topics.add('economy');
  } else if (path[0] === 'platform' && path[1] === 'announcement') {
    topics.add('announcement'); channels.add('catalog');
  } else if (path[0] === 'platform' && path[1] === 'community-links') {
    topics.add('community-links'); channels.add('catalog');
  } else if (path[0] === 'platform' && path[1] === 'legal-links') {
    topics.add('legal-links'); channels.add('catalog');
  } else if (path[0] === 'platform' && path[1] === 'monitoring') {
    topics.add('monitoring');
  } else if (path[0] === 'platform' && (path[1] === 'economy-admin' || path[1] === 'import-defaults' || path[1] === 'import-settings')) {
    topics.add('economy');
    topics.add('import-status');
    if(path[1] === 'import-defaults' || path[1] === 'import-settings') channels.add('catalog');
    topics.add(input.operation === 'grant-reward' ? 'reward-gift' : 'reward');
  } else if (path[0] === 'platform' && path[1] === 'question-edit') {
    addBank(input.qbankId);
    topics.add('question-catalog');
  } else if (path[0] === 'platform' && path[1] === 'classification') {
    addBank(input.qbankId);
    topics.add('question-catalog'); topics.add('collaboration');
  } else if (path[0] === 'platform' && (path[1] === 'import' || path[1] === 'json-imports')) {
    topics.add('json-import-monitor');
    if (path[1] === 'import') {
      topics.add('review-queue');
      topics.add('contributions');
      topics.add('question-catalog');
    }
  } else if (path[0] === 'platform' && path[1] === 'bulk-review' && Array.isArray(input.proposalIds)) {
    const rows = await env.DB.prepare("SELECT qbank_id,owner_id FROM records WHERE type='questionProposals' AND id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(input.proposalIds)).all<{ qbank_id: string; owner_id: string }>();
    rows.results.forEach(row => { addBank(row.qbank_id); addUser(row.owner_id); });
    topics.add('review-queue'); topics.add('reviewer-performance'); topics.add('question-catalog');
    if (input.status === 'approved') { topics.add('reward'); topics.add('contributions'); }
  } else if (path[0] === 'preformed') {
    topics.add('preformed-tests');
    channels.add('catalog');
  } else if (path[0] === 'auth') {
    topics.add('account');
    channels.add('access');
  } else if (path[0] === 'qbanks' || (path[1] === 'question' || path[1] === 'import-delete-duplicate')) {
    topics.add('collaboration'); topics.add('question-catalog');
    channels.add('catalog');
  }
  if (!topics.size) topics.add('collaboration');
  topics.add('audit');
  await publishChanges(channels, topics, request.headers.get('x-qraft-client-id') ?? '');
}
