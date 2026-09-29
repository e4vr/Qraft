import { env } from 'cloudflare:workers';
import { currentUser } from '@/features/auth/server/auth-service';
import {
  assertSameOrigin,
  readJson,
  readLimitedBytes,
} from '@/server/http/request';
import { json } from '@/server/http/response';
import { auditStatement } from '@/lib/platform-server';
import {
  detectUsageAnomalies,
  emptyUsage,
  monitoringWindow,
  parseMonitoringImport,
  systemHealth,
  USAGE_KEYS,
  type MonitoringDay,
  type MonitoringSnapshot,
  type UsageUser,
} from '../domain/monitoring';

type SnapshotRow = {
  payload: string | null;
  refreshed_at: string | null;
  refresh_after: string;
  source: string;
};
type Row = {
  sum?: Record<string, number>;
  max?: Record<string, number>;
  quantiles?: Record<string, number>;
  dimensions?: Record<string, string>;
  count?: number;
};
export async function fingerprintQuery(query: string) {
  // Hash only a normalized statement. Raw SQL never reaches the UI or persistent snapshot.
  const normalized = query
    .replace(/'(?:''|[^'])*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(normalized),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
async function cfRequest(body: string, sql = false) {
  const response = await fetch(
    sql
      ? `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`
      : 'https://api.cloudflare.com/client/v4/graphql',
    {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
      headers: {
        authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`,
        'content-type': sql ? 'text/plain' : 'application/json',
      },
      body,
    },
  );
  if (!response.ok)
    throw new Error(
      'Cloudflare analytics is unavailable or permission is missing.',
    );
  // Bound upstream responses and never forward API error text, tokens or raw query strings.
  const bytes = await readLimitedBytes(
    new Request('https://internal/result', {
      method: 'POST',
      body: response.body,
      duplex: 'half',
    } as RequestInit),
    1_500_000,
  );
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (result.errors?.length)
    throw new Error('Dataset unavailable for this token, plan or time window.');
  return result;
}
async function graph(field: string) {
  const result = await cfRequest(
    JSON.stringify({
      query: `query { viewer { accounts(filter:{accountTag:${JSON.stringify(env.CLOUDFLARE_ACCOUNT_ID)}}) { ${field} } } }`,
    }),
  );
  return result.data?.viewer?.accounts?.[0] ?? {};
}
export async function collectMonitoring(
  period: number,
): Promise<MonitoringSnapshot> {
  const { from, to } = monitoringWindow(period);
  const snapshot: MonitoringSnapshot = {
    format: 'qraft-monitoring-v1',
    from,
    to,
    days: [],
    users: [],
    queries: [],
    unavailable: [],
    sampled: true,
    limited: false,
  };
  const days = new Map<string, MonitoringDay>();
  for (let index = 0; index < period; index++) {
    const date = new Date(Date.parse(from) + index * 86_400_000)
      .toISOString()
      .slice(0, 10);
    days.set(date, { date, infrastructure: {} });
  }
  const safe = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch {
      snapshot.unavailable.push(
        `${label}: unavailable for the current token, plan or period.`,
      );
    }
  };
  const quoted = JSON.stringify;
  const time = `datetime_geq:${quoted(from)},datetime_leq:${quoted(to)}`;
  await safe('Workers', async () => {
    if (!env.MONITORING_WORKER_NAME) throw new Error();
    const fields = [...days.keys()].map((date, index) => {
      const next = new Date(Date.parse(date) + 86_400_000).toISOString();
      return `w${index}:workersInvocationsAdaptive(limit:20,filter:{scriptName:${quoted(env.MONITORING_WORKER_NAME)},datetime_geq:${quoted(`${date}T00:00:00.000Z`)},datetime_lt:${quoted(next > to ? to : next)}}){sum{requests errors} quantiles{cpuTimeP99} dimensions{status}}`;
    });
    const data = await graph(fields.join('\n'));
    [...days.values()].forEach((day, index) => {
      const rows = data[`w${index}`] as Row[];
      if (!Array.isArray(rows)) throw new Error();
      day.infrastructure = {
        ...day.infrastructure,
        workerRequests: 0,
        workerErrors: 0,
        cpuP99Ms: 0,
        exceededResources: 0,
      };
      for (const row of rows) {
        day.infrastructure.workerRequests! += Number(row.sum?.requests ?? 0);
        day.infrastructure.workerErrors! += Number(row.sum?.errors ?? 0);
        // Workers CPU quantiles are microseconds; this is the highest status-group p99.
        day.infrastructure.cpuP99Ms = Math.max(
          day.infrastructure.cpuP99Ms!,
          Number(row.quantiles?.cpuTimeP99 ?? 0) / 1000,
        );
        if (/exceeded|exhausted/i.test(row.dimensions?.status ?? ''))
          day.infrastructure.exceededResources! += Number(
            row.sum?.requests ?? 0,
          );
      }
      if (rows.length >= 20) snapshot.limited = true;
    });
  });
  await safe('D1', async () => {
    if (!env.MONITORING_D1_ID) throw new Error();
    const data = await graph(
      `d1AnalyticsAdaptiveGroups(limit:31,filter:{databaseId:${quoted(env.MONITORING_D1_ID)},date_geq:${quoted(from.slice(0, 10))},date_leq:${quoted(to.slice(0, 10))}}){sum{readQueries writeQueries rowsRead rowsWritten} dimensions{date}}`,
    );
    if (!Array.isArray(data.d1AnalyticsAdaptiveGroups)) throw new Error();
    for (const row of data.d1AnalyticsAdaptiveGroups as Row[]) {
      const day = days.get(row.dimensions?.date ?? '');
      if (day)
        day.infrastructure = {
          ...day.infrastructure,
          d1Reads: row.sum?.readQueries ?? 0,
          d1Writes: row.sum?.writeQueries ?? 0,
          rowsRead: row.sum?.rowsRead ?? 0,
          rowsWritten: row.sum?.rowsWritten ?? 0,
        };
    }
  });
  await safe('Query Insights', async () => {
    if (!env.MONITORING_D1_ID) throw new Error();
    const data = await graph(
      `d1QueriesAdaptiveGroups(limit:20,filter:{databaseId:${quoted(env.MONITORING_D1_ID)},datetimeHour_geq:${quoted(from)},datetimeHour_leq:${quoted(to)}},orderBy:[sum_queryDurationMs_DESC]){count sum{queryDurationMs rowsRead rowsWritten} dimensions{query}}`,
    );
    if (!Array.isArray(data.d1QueriesAdaptiveGroups)) throw new Error();
    snapshot.queries = await Promise.all(
      (data.d1QueriesAdaptiveGroups as Row[]).map(async (row) => ({
        fingerprint: await fingerprintQuery(row.dimensions?.query ?? ''),
        executions: row.count ?? 0,
        totalMs: row.sum?.queryDurationMs ?? 0,
        rowsRead: row.sum?.rowsRead ?? 0,
        rowsWritten: row.sum?.rowsWritten ?? 0,
      })),
    );
  });
  await safe('R2', async () => {
    if (!env.MONITORING_R2_BUCKET) throw new Error();
    // Hour grouping keeps the response <=720 rows for 30 days; no object names requested.
    const filter = `bucketName:${quoted(env.MONITORING_R2_BUCKET)},${time}`;
    const data = await graph(
      `r2OperationsAdaptiveGroups(limit:721,filter:{${filter}}){sum{requests} dimensions{datetimeHour}} r2StorageAdaptiveGroups(limit:1,filter:{${filter}},orderBy:[datetime_DESC]){max{payloadSize metadataSize} dimensions{datetime}}`,
    );
    if (
      !Array.isArray(data.r2OperationsAdaptiveGroups) ||
      !Array.isArray(data.r2StorageAdaptiveGroups)
    )
      throw new Error();
    for (const row of data.r2OperationsAdaptiveGroups as Row[]) {
      const day = days.get((row.dimensions?.datetimeHour ?? '').slice(0, 10));
      if (day)
        day.infrastructure!.r2Operations =
          (day.infrastructure!.r2Operations ?? 0) +
          Number(row.sum?.requests ?? 0);
    }
    const storage = data.r2StorageAdaptiveGroups[0] as Row | undefined;
    const storageDay = days.get(
      (storage?.dimensions?.datetime ?? '').slice(0, 10),
    );
    if (storageDay)
      storageDay.infrastructure!.r2StorageBytes =
        (storage?.max?.payloadSize ?? 0) + (storage?.max?.metadataSize ?? 0);
    if (data.r2OperationsAdaptiveGroups.length >= 721) snapshot.limited = true;
  });
  if (env.QRAFT_TELEMETRY_ENABLED === 'true')
    await safe('User Analytics', async () => {
      if (
        !env.QRAFT_USAGE ||
        !/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(env.MONITORING_DATASET ?? '')
      )
        throw new Error();
      const sums = USAGE_KEYS.map(
        (key, index) => `SUM(double${index + 1} * _sample_interval) AS ${key}`,
      ).join(',');
      const where = `FROM ${env.MONITORING_DATASET} WHERE timestamp >= toDateTime('${from.slice(0, 19).replace('T', ' ')}') AND timestamp <= toDateTime('${to.slice(0, 19).replace('T', ' ')}')`;
      const daily = await cfRequest(
        `SELECT toDate(timestamp) AS date, COUNT(DISTINCT index1) AS activeUsers, ${sums} ${where} GROUP BY date ORDER BY date LIMIT 31 FORMAT JSON`,
        true,
      );
      for (const row of daily.data ?? []) {
        const day = days.get(String(row.date));
        if (day) {
          day.activeUsers = Number(row.activeUsers);
          day.usage = Object.fromEntries(
            USAGE_KEYS.map((key) => [key, Number(row[key] ?? 0)]),
          ) as ReturnType<typeof emptyUsage>;
        }
      }
      const users = await cfRequest(
        `SELECT index1 AS telemetryId, SUM(_sample_interval) AS events, ${sums} ${where} GROUP BY telemetryId ORDER BY events DESC LIMIT 1001 FORMAT JSON`,
        true,
      );
      snapshot.users = (users.data ?? []).slice(0, 1000).map(
        (row: Record<string, unknown>) =>
          ({
            telemetryId: String(row.telemetryId),
            events: Number(row.events),
            ...Object.fromEntries(
              USAGE_KEYS.map((key) => [key, Number(row[key] ?? 0)]),
            ),
          }) as UsageUser,
      );
      snapshot.limited ||= (users.data?.length ?? 0) >= 1001;
      const active = await cfRequest(
        `SELECT COUNT(DISTINCT index1) AS activeUsers ${where} FORMAT JSON`,
        true,
      );
      snapshot.activeUsers = Number(active.data?.[0]?.activeUsers ?? 0);
    });
  snapshot.days = [...days.values()];
  return snapshot;
}
async function responseSnapshot(period: number) {
  const row = (await env.DB.prepare(
    'SELECT payload,refreshed_at,refresh_after,source FROM monitoring_snapshots WHERE period=?',
  )
    .bind(period)
    .first<SnapshotRow>())!;
  const snapshot = row.payload
    ? (JSON.parse(row.payload) as MonitoringSnapshot)
    : null;
  // Older snapshots treated intentionally disabled collection as an upstream
  // failure. Keep genuine provider failures while correcting cached coverage.
  if (snapshot && env.QRAFT_TELEMETRY_ENABLED !== 'true')
    snapshot.unavailable = snapshot.unavailable.filter(
      (reason) => !reason.startsWith('User Analytics:'),
    );
  if (snapshot?.users.length) {
    // Identity joins are bounded and resolved at read time. Deleted accounts disappear immediately.
    const identities = await env.DB.prepare(
      "SELECT i.telemetry_id,p.uid,json_extract(p.profile_json,'$.displayName') AS name FROM monitoring_identities i JOIN profiles p ON p.uid=i.user_id WHERE i.telemetry_id IN (SELECT value FROM json_each(?))",
    )
      .bind(JSON.stringify(snapshot.users.map((user) => user.telemetryId)))
      .all<{ telemetry_id: string; uid: string; name: string }>();
    const lookup = new Map(
      identities.results.map((row) => [row.telemetry_id, row]),
    );
    snapshot.users = detectUsageAnomalies(
      snapshot.users
        .filter((user) => lookup.has(user.telemetryId))
        .map((user) => ({
          ...user,
          userId: lookup.get(user.telemetryId)!.uid,
          name: lookup.get(user.telemetryId)!.name,
        })),
    );
  }
  const day = new Date().toISOString().slice(0, 10);
  const budget = await env.DB.prepare(
    'SELECT used FROM monitoring_query_budget WHERE day=?',
  )
    .bind(day)
    .first<{ used: number }>();
  let reserved: { daily: number; monthly: number } | undefined;
  try {
    if (env.QRAFT_TELEMETRY_ENABLED === 'true' && env.REALTIME)
      reserved = await (
        env.REALTIME.getByName('monitoring-budget') as DurableObjectStub & {
          usageBudget(): Promise<{ daily: number; monthly: number }>;
        }
      ).usageBudget();
  } catch {
    /* Older realtime deployments are reported as unavailable; no unsafe fallback. */
  }
  if (snapshot && env.QRAFT_TELEMETRY_ENABLED === 'true' && !reserved)
    snapshot.unavailable.push(
      'Telemetry capacity counters are unavailable; verify the realtime Worker deployment.',
    );
  if (
    snapshot &&
    reserved &&
    (reserved.daily >= 19_968 || reserved.monthly >= 499_968)
  )
    snapshot.unavailable.push(
      'Telemetry safety budget is exhausted; activity coverage may be incomplete.',
    );
  return json({
    snapshot,
    refreshedAt: row.refreshed_at,
    nextRefreshAt: row.refresh_after || null,
    source: row.source,
    health: systemHealth(snapshot, row.refreshed_at),
    connected: Boolean(
      env.CLOUDFLARE_ANALYTICS_TOKEN && env.CLOUDFLARE_ACCOUNT_ID,
    ),
    telemetry:
      env.QRAFT_TELEMETRY_ENABLED === 'true' &&
      Boolean(
        env.QRAFT_USAGE &&
        env.REALTIME &&
        (env.TELEMETRY_SALT?.length ?? 0) >= 32,
      ),
    budget: {
      used: budget?.used ?? 0,
      dailyLimit: 60,
      refreshMinutes: 30,
      telemetryDailyCap: 20_000,
      telemetryMonthlyCap: 500_000,
      telemetryReservedDaily: reserved?.daily,
      telemetryReservedMonthly: reserved?.monthly,
    },
  });
}
export async function monitoringApi(request: Request) {
  const user = await currentUser(request);
  if (
    !user ||
    user.status !== 'approved' ||
    user.role !== 'super_admin' ||
    !user.mfaEnrolled ||
    !user.mfaVerified
  )
    return json({ error: 'Superadmin MFA required.' }, 403);
  const period = Number(new URL(request.url).searchParams.get('period') ?? 7);
  if (![1, 7, 30].includes(period))
    return json({ error: 'Invalid monitoring period.' }, 400);
  if (request.method === 'GET') return responseSnapshot(period);
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed.' }, 405);
  assertSameOrigin(request);
  const input = await readJson<{
    operation?: string;
    snapshot?: unknown;
    reason?: string;
  }>(request, 100_000);
  const now = new Date().toISOString();
  if (input.operation === 'import') {
    let snapshot: MonitoringSnapshot;
    try {
      snapshot = parseMonitoringImport(input.snapshot, period);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : 'Invalid import.' },
        400,
      );
    }
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 3 || reason.length > 500)
      return json({ error: 'Enter an import audit reason.' }, 400);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE monitoring_snapshots SET payload=?,refreshed_at=?,source='manual' WHERE period=?",
      ).bind(JSON.stringify(snapshot), now, period),
      auditStatement(user, 'monitoring_imported', 'monitoring', null, {
        period,
        from: snapshot.from,
        to: snapshot.to,
        reason,
      }),
    ]);
    return responseSnapshot(period);
  }
  if (input.operation !== 'sync')
    return json({ error: 'Unknown monitoring operation.' }, 400);
  if (
    !env.CLOUDFLARE_ANALYTICS_TOKEN ||
    !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID ?? '')
  )
    return json(
      { error: 'Configure the server-only read token and account ID first.' },
      409,
    );
  // Global lease per period prevents concurrent refreshes and throttles failed upstream requests too.
  const claim = await env.DB.prepare(
    'UPDATE monitoring_snapshots SET refresh_after=? WHERE period=? AND refresh_after<=? RETURNING period',
  )
    .bind(new Date(Date.now() + 30 * 60_000).toISOString(), period, now)
    .first();
  if (!claim) return responseSnapshot(period);
  // Reserve all 7 possible API calls atomically before touching Cloudflare. Counts include failed calls.
  const reservation = await env.DB.prepare(
    'INSERT INTO monitoring_query_budget(day,used) VALUES(?,7) ON CONFLICT(day) DO UPDATE SET used=used+7 WHERE used+7<=60 RETURNING used',
  )
    .bind(now.slice(0, 10))
    .first();
  if (!reservation)
    return json(
      {
        error:
          'Monitoring daily query budget reached. Cached snapshots remain available.',
      },
      429,
    );
  const snapshot = await collectMonitoring(period);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE monitoring_snapshots SET payload=?,refreshed_at=?,source='cloudflare' WHERE period=?",
    ).bind(JSON.stringify(snapshot), now, period),
    env.DB.prepare(
      "DELETE FROM monitoring_query_budget WHERE day<date('now','-31 days')",
    ),
    auditStatement(user, 'monitoring_synced', 'monitoring', null, {
      period,
      unavailable: snapshot.unavailable.length,
    }),
  ]);
  return responseSnapshot(period);
}
