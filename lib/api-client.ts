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
  const key = 'qraft-client-instance';
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
})();

export interface ApiRequestInit extends RequestInit {
  resourceQuery?: boolean;
  forceRefresh?: boolean;
  requestReason?: RequestReason;
  cacheScope?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;

  constructor(message: string, status: number, payload: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function mutationTags(path: string, body: BodyInit | null | undefined) {
  const tags = new Set(policyFor(path).tags);
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
  if (path.startsWith('/qbank-folders/')) { tags.add('collaboration'); tags.add('question-catalog'); tags.add('test-pool'); }
  if (path.startsWith('/platform/discounts')) { tags.add('discounts'); tags.add('pricing'); }
  if (path.startsWith('/platform/subscriptions') || path.startsWith('/platform/checkout')) { tags.add('subscriptions'); tags.add('account'); }
  if (path.startsWith('/platform/rewards')) {
    tags.add('contributions');
    tags.add('economy');
    if (input.operation === 'activate') { tags.add('account'); tags.add('subscriptions'); }
  }
  if (path.startsWith('/platform/economy-admin')) { tags.add('contributions'); tags.add('economy'); tags.add('import-status'); }
  if (path.startsWith('/platform/import') || path.startsWith('/platform/json-imports')) tags.add('json-import-monitor');
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
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok)
    throw new ApiError(
      payload.error || `Request failed (${response.status}).`,
      response.status,
      payload as Record<string, unknown>,
    );
  return payload;
}

export async function api<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { resourceQuery, forceRefresh, requestReason, cacheScope, ...requestInit } = init;
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
