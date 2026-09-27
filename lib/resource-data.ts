export type ResourceClass =
  | 'static'
  | 'session'
  | 'event-driven'
  | 'parameter-driven'
  | 'transactional';

export type RequestReason =
  | 'initial-cache-miss'
  | 'eligibility-parameters-changed'
  | 'server-invalidation'
  | 'reconnect-reconciliation'
  | 'explicit-refresh'
  | 'user-transaction';

export type ResourcePolicy = {
  name: string;
  class: ResourceClass;
  tags: string[];
  persistence: 'memory' | 'indexed-db' | 'service-worker';
  match: (path: string) => boolean;
};

// Freshness belongs to resources. There are deliberately no time-based TTLs:
// cached data becomes stale after a mutation/realtime signal, not after a page mount.
export const resourcePolicies: ResourcePolicy[] = [
  { name:'monitoring', class:'parameter-driven', tags:['monitoring'], persistence:'memory', match:path => path.startsWith('/platform/monitoring') },
  { name:'site-operations', class:'event-driven', tags:['site-operations'], persistence:'memory', match:path => path.startsWith('/platform/site-operations') },
  { name:'plan-pricing', class:'event-driven', tags:['pricing'], persistence:'memory', match:path => path.startsWith('/platform/plan-pricing') || path.startsWith('/platform/plan-catalog') },
  { name: 'session', class: 'session', tags: ['account'], persistence: 'memory', match: path => path === '/auth/session' },
  { name: 'personal-state', class: 'session', tags: ['personal-state'], persistence: 'indexed-db', match: path => path === '/state' || path.startsWith('/state/') },
  { name: 'collaboration', class: 'event-driven', tags: ['collaboration', 'question-catalog', 'review-queue'], persistence: 'indexed-db', match: path => path.startsWith('/collaboration') },
  { name: 'announcement', class: 'event-driven', tags: ['announcement'], persistence: 'memory', match: path => path.startsWith('/platform/announcement') },
  { name: 'legal-links', class: 'static', tags: ['legal-links'], persistence: 'memory', match: path => path.startsWith('/platform/legal-links') },
  { name: 'reviewer-performance', class: 'event-driven', tags: ['reviewer-performance'], persistence: 'memory', match: path => path.startsWith('/platform/reviewer-performance') },
  { name: 'review-history', class: 'event-driven', tags: ['review-history'], persistence: 'memory', match: path => path.startsWith('/platform/review-history') },
  { name: 'contributions', class: 'event-driven', tags: ['contributions', 'economy'], persistence: 'memory', match: path => path.startsWith('/platform/contributions') || path.startsWith('/platform/rewards') },
  { name: 'economy-account', class: 'parameter-driven', tags: ['economy'], persistence: 'memory', match: path => path.startsWith('/platform/economy-admin') },
  { name: 'discounts', class: 'parameter-driven', tags: ['discounts', 'pricing'], persistence: 'memory', match: path => path.startsWith('/platform/discounts') || path.startsWith('/platform/quote') },
  { name: 'subscriptions', class: 'parameter-driven', tags: ['subscriptions', 'account'], persistence: 'memory', match: path => path.startsWith('/platform/subscriptions') || path.startsWith('/platform/plan-status') },
  { name: 'audit-week', class: 'parameter-driven', tags: ['audit'], persistence: 'memory', match: path => path.startsWith('/platform/audit-week') },
  { name: 'contact', class: 'parameter-driven', tags: ['contact'], persistence: 'memory', match: path => path.startsWith('/contact') },
  { name: 'reviewer-search', class: 'parameter-driven', tags: ['reviewers', 'collaboration'], persistence: 'memory', match: path => path.startsWith('/platform/reviewers') },
  { name: 'question-detail', class: 'parameter-driven', tags: ['question-catalog'], persistence: 'memory', match: path => path.startsWith('/platform/question') },
  { name: 'import-status', class: 'session', tags: ['import-status', 'economy'], persistence: 'memory', match: path => path.startsWith('/platform/json-import-status') },
  { name: 'json-import-monitor', class: 'parameter-driven', tags: ['json-import-monitor'], persistence: 'memory', match: path => path.startsWith('/platform/json-imports') },
  { name: 'test-pool', class: 'parameter-driven', tags: ['test-pool', 'question-catalog', 'account'], persistence: 'memory', match: path => path.startsWith('/platform/test-pool') },
  { name: 'preformed-tests', class: 'event-driven', tags: ['preformed-tests'], persistence: 'indexed-db', match: path => path.startsWith('/preformed/') },
  { name: 'backup', class: 'transactional', tags: ['backup'], persistence: 'memory', match: path => path.includes('backup') },
];

type CacheEntry = {
  value: unknown;
  stale: boolean;
  tags: Set<string>;
  invalidatedBy?: string;
};

export type RequestMetrics = {
  GET: number;
  POST: number;
  PUT: number;
  PATCH: number;
  DELETE: number;
  cacheHits: number;
  cacheMisses: number;
  duplicateRequests: number;
  deduplicatedRequests: number;
  invalidationFetches: number;
  networkRequestsAvoided: number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
let cacheGeneration = 0;
const metrics: RequestMetrics = {
  GET: 0,
  POST: 0,
  PUT: 0,
  PATCH: 0,
  DELETE: 0,
  cacheHits: 0,
  cacheMisses: 0,
  duplicateRequests: 0,
  deduplicatedRequests: 0,
  invalidationFetches: 0,
  networkRequestsAvoided: 0,
};

export function policyFor(path: string) {
  return resourcePolicies.find(policy => policy.match(path)) ?? {
    name: 'uncatalogued-query',
    class: 'parameter-driven' as const,
    tags: ['uncatalogued'],
    persistence: 'memory' as const,
    match: () => false,
  };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  return value;
}

function canonicalPath(path: string) {
  const url = new URL(path, 'https://qraft.local');
  const parameters = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
  );
  url.search = '';
  for (const [key, value] of parameters) url.searchParams.append(key, value);
  return `${url.pathname}${url.search}`;
}

function canonicalBody(body: BodyInit | null | undefined) {
  if (typeof body !== 'string' || !body) return body ? '[binary-body]' : '';
  try { return JSON.stringify(stable(JSON.parse(body))); }
  catch { return body; }
}

export function resourceKey(path: string, method = 'GET', body?: BodyInit | null, scope = '') {
  return `${scope}|${method.toUpperCase()}|${canonicalPath(path)}|${canonicalBody(body)}`;
}

function developmentLog(method: string, resource: string, reason: RequestReason) {
  if (typeof window === 'undefined' || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
  console.debug(`[API ${method}]`, { resource, reason });
}

export function noteNetworkRequest(method: string, resource: string, reason: RequestReason) {
  const normalized = method.toUpperCase() as keyof Pick<RequestMetrics, 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>;
  if (normalized in metrics) metrics[normalized]++;
  if (reason === 'server-invalidation' || reason === 'reconnect-reconciliation') metrics.invalidationFetches++;
  developmentLog(method, resource, reason);
}

export async function readThrough<T>({
  key,
  tags,
  force = false,
  reason,
  load,
}: {
  key: string;
  tags: string[];
  force?: boolean;
  reason?: RequestReason;
  load: (reason: RequestReason) => Promise<T>;
}): Promise<T> {
  const present = cache.get(key);
  if (!force && present && !present.stale) {
    metrics.cacheHits++;
    metrics.networkRequestsAvoided++;
    return present.value as T;
  }
  const running = inFlight.get(key);
  if (running) {
    metrics.deduplicatedRequests++;
    metrics.networkRequestsAvoided++;
    return running as Promise<T>;
  }
  metrics.cacheMisses++;
  const requestReason = reason ?? (force
    ? 'explicit-refresh'
    : present?.stale
      ? present.invalidatedBy === 'reconnect'
        ? 'reconnect-reconciliation'
        : 'server-invalidation'
      : 'initial-cache-miss');
  const generation = cacheGeneration;
  const request = load(requestReason).then(value => {
    // A request started for a previous account/session must never repopulate the
    // cache after logout or account switching.
    if (generation === cacheGeneration)
      cache.set(key, { value, stale: false, tags: new Set(tags) });
    return value;
  });
  inFlight.set(key, request);
  const cleanup = () => { if (inFlight.get(key) === request) inFlight.delete(key); };
  void request.then(cleanup, cleanup);
  return request;
}

export function writeCache<T>(key: string, value: T, tags: string[]) {
  cache.set(key, { value, stale: false, tags: new Set(tags) });
}

export function invalidateTags(tags: Iterable<string>, reason = 'mutation') {
  const changed = new Set(tags);
  for (const entry of cache.values()) {
    if ([...entry.tags].some(tag => changed.has(tag))) {
      entry.stale = true;
      entry.invalidatedBy = reason;
    }
  }
}

export function clearResourceCache() {
  cacheGeneration++;
  cache.clear();
  inFlight.clear();
}

export function getRequestMetrics(): Readonly<RequestMetrics> {
  return { ...metrics };
}

export function resetRequestMetrics() {
  for (const key of Object.keys(metrics) as Array<keyof RequestMetrics>) metrics[key] = 0;
}

if (typeof window !== 'undefined') {
  Object.assign(window as Window & { __QRAFT_DATA_DIAGNOSTICS__?: unknown }, {
    __QRAFT_DATA_DIAGNOSTICS__: {
      metrics: getRequestMetrics,
      reset: resetRequestMetrics,
      policies: resourcePolicies.map(({ match: _match, ...policy }) => policy),
    },
  });
}
