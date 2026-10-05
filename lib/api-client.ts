import {
  clearResourceCache,
  invalidateTags,
  noteNetworkRequest,
  policyFor,
  readThrough,
  resourceKey,
  writeCache,
  type RequestReason,
} from './resource-data';

const API_ROOT = '/api/cloudflare';

export const clientInstanceId = (() => {
  if (typeof window === 'undefined') return '';
  // Duplicated tabs inherit sessionStorage. A document-local ID ensures that
  // suppressing the sender's echo never silences another window's updates.
  return crypto.randomUUID();
})();

export interface ApiRequestInit extends RequestInit {
  resourceQuery?: boolean;
  forceRefresh?: boolean;
  requestReason?: RequestReason;
  cacheScope?: string;
  expectedUserId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, status: number, payload: Record<string, unknown>, retryAfterMs?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    this.retryAfterMs = retryAfterMs;
  }
}

function mutationTags(path: string, body: BodyInit | null | undefined) {
  if (path === '/preformed/submit') return ['preformed-results'];
  if(path === '/platform/import-preview') return [];
  if (path === '/platform/import-settings') return ['import-status'];
  const tags = new Set(policyFor(path).tags);
  if (path === '/qbanks' || path.startsWith('/qbanks/')) {
    tags.add('collaboration'); tags.add('question-catalog'); tags.add('test-pool');
  }
  let input: Record<string, unknown> = {};
  if (typeof body === 'string') {
    try { input = JSON.parse(body) as Record<string, unknown>; } catch { /* Non-JSON bodies are transactional only. */ }
  }
  if (path === '/collaboration' && Array.isArray(input.operations)) {
    const collections = new Set((input.operations as Array<{ collection?: string }>).map(operation => operation.collection));
    if (collections.has('questionProposals')) { tags.add('review-queue'); tags.add('contributions'); }
    if (collections.has('sharedQuestions') || collections.has('qbankSpecialties') || collections.has('qbankTopics')) { tags.add('question-catalog'); tags.add('test-pool'); }
    if (collections.has('qbanks') || collections.has('qbankFolders') || collections.has('qbankMemberships') || collections.has('qbankInvitations')) tags.add('collaboration');
    if (collections.has('profiles') || collections.has('system')) { tags.add('account'); tags.add('subscriptions'); }
  }
  if (path.startsWith('/platform/bulk-review')) {
    tags.add('review-queue'); tags.add('question-catalog'); tags.add('reviewer-performance'); tags.add('contributions'); tags.add('economy');
  }
  if (path.startsWith('/platform/classification')) { tags.add('collaboration'); tags.add('question-catalog'); tags.add('test-pool'); }
  if (path === '/platform/question-edit') { tags.add('collaboration'); tags.add('question-catalog'); tags.add('test-pool'); }
  if (path.startsWith('/qbank-folders/')) { tags.add('collaboration'); tags.add('question-catalog'); tags.add('test-pool'); }
  if (path.startsWith('/platform/discounts') || path.startsWith('/platform/plan-pricing')) { tags.add('discounts'); tags.add('pricing'); }
  if (path.startsWith('/platform/monitoring')) tags.add('monitoring');
  if (path.startsWith('/platform/site-operations')) tags.add('site-operations');
  if (path.startsWith('/platform/account-block')) { tags.add('account'); tags.add('collaboration'); }
  if (path === '/platform/deleted-registration') { tags.add('collaboration'); tags.add('audit'); }
  if (path === '/platform/registration-policy') { tags.add('registration-policy'); tags.add('audit'); }
  if (path.startsWith('/platform/subscriptions') || path.startsWith('/platform/checkout')) { tags.add('subscriptions'); tags.add('account'); }
  if (['/platform/access-admin', '/platform/activation-codes', '/platform/activation-code'].includes(path)) { tags.add('subscriptions'); tags.add('account'); tags.add('contributions'); tags.add('economy'); }
  if (path.startsWith('/platform/rewards')) {
    tags.add('contributions');
    tags.add('economy');
    if (input.operation === 'activate') { tags.add('account'); tags.add('subscriptions'); }
  }
  if (path.startsWith('/platform/economy-admin')) { tags.add('contributions'); tags.add('economy'); tags.add('import-status'); }
  if (path.startsWith('/platform/import') || path.startsWith('/platform/json-imports')) tags.add('json-import-monitor');
  if(path === '/platform/import-delete-duplicate') { tags.add('question-catalog');tags.add('collaboration');tags.add('review-queue'); }
  if(path === '/platform/import-defaults' || (path === '/platform/economy-admin' && ['import-limits','reset-import-limits'].includes(String(input.operation)))) tags.add('subscriptions');
  if (path.startsWith('/preformed/')) tags.add('preformed-tests');
  if (path.startsWith('/auth/')) { tags.add('account'); tags.add('collaboration'); }
  if (path.startsWith('/contact')) tags.add('contact');
  return [...tags];
}

async function network<T>(path: string, init: RequestInit, reason: RequestReason): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (method !== 'GET' && clientInstanceId) headers.set('x-qraft-client-id', clientInstanceId);
  noteNetworkRequest(method, policyFor(path).name, reason);
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers,
    });
  } catch (error) {
    if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new ApiError('Unable to connect. Check your connection and try again.', 0, {});
  }
  const retryAfter = response.headers.get('retry-after');
  const retryAfterMs = retryAfter === null ? undefined : /^\d+$/.test(retryAfter)
    ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
  let payload: Record<string, unknown>;
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid API response');
    payload = value as Record<string, unknown>;
  } catch {
    // A truncated success is not an acknowledgement. Preserve pending writes.
    throw new ApiError(response.status === 429
      ? 'Too many requests. Please wait a moment and try again.'
      : 'The server response could not be read. Please try again.',
      response.ok ? 502 : response.status, {},
      Number.isFinite(retryAfterMs) ? retryAfterMs : undefined);
  }
  if (!response.ok)
    payload.requestId ??= response.headers.get('x-request-id') ?? undefined;
  if (!response.ok)
    throw new ApiError(
      typeof payload.error === 'string' ? payload.error : `Request failed (${response.status}).`,
      response.status,
      payload,
      Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
    );
  return payload as T;
}

// Custom resource loaders use readThrough for coalescing/invalidation. This
// exposes the account-bound transport without introducing another cache.
export function apiTransport<T>(path: string, init: ApiRequestInit, reason: RequestReason) {
  const { expectedUserId, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  if (expectedUserId) headers.set('x-qraft-account', expectedUserId);
  return network<T>(path, { ...requestInit, headers }, reason);
}

export async function api<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { resourceQuery, forceRefresh, requestReason, cacheScope, expectedUserId, ...requestInit } = init;
  if (expectedUserId) {
    const headers = new Headers(requestInit.headers);
    headers.set('x-qraft-account', expectedUserId);
    requestInit.headers = headers;
  }
  const method = (requestInit.method ?? 'GET').toUpperCase();
  const policy = policyFor(path);
  if (method === 'GET' || resourceQuery) {
    const key = resourceKey(path, method, requestInit.body, cacheScope);
    return readThrough({
      key,
      tags: policy.tags,
      force: forceRefresh,
      reason: requestReason,
      load: reason => network<T>(path, requestInit, reason),
    });
  }
  const result = await network<T>(path, requestInit, requestReason ?? 'user-transaction');
  if (!(result && typeof result === 'object' && 'unchanged' in result && result.unchanged === true))
    invalidateTags(mutationTags(path, requestInit.body), 'mutation');
  return result;
}

export function setApiCache<T>(path: string, value: T, init: Pick<ApiRequestInit, 'method' | 'body' | 'cacheScope'> = {}) {
  const method = (init.method ?? 'GET').toUpperCase();
  writeCache(resourceKey(path, method, init.body, init.cacheScope), value, policyFor(path).tags);
}

export function invalidateApiResources(tags: Iterable<string>, reason = 'mutation') {
  invalidateTags(tags, reason);
}

export { clearResourceCache };
