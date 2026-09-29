export const USAGE_KEYS = [
  'testsCreated',
  'testsCompleted',
  'questionsAnswered',
  'questionsImported',
  'privateBanksCreated',
  'flashcardsCreated',
  'reviewContributions',
] as const;
export type UsageKey = (typeof USAGE_KEYS)[number];
export type UsageCounts = Record<UsageKey, number>;
export const emptyUsage = (): UsageCounts =>
  Object.fromEntries(USAGE_KEYS.map((key) => [key, 0])) as UsageCounts;
export const INFRA_KEYS = [
  'workerRequests',
  'workerErrors',
  'cpuP99Ms',
  'exceededResources',
  'd1Reads',
  'd1Writes',
  'rowsRead',
  'rowsWritten',
  'r2StorageBytes',
  'r2Operations',
] as const;
export type InfraKey = (typeof INFRA_KEYS)[number];
export type InfraCounts = Partial<Record<InfraKey, number>>;
export type MonitoringDay = {
  date: string;
  usage?: UsageCounts;
  activeUsers?: number;
  infrastructure?: InfraCounts;
};
export type QueryInsight = {
  fingerprint: string;
  executions: number;
  rowsRead: number;
  rowsWritten: number;
  totalMs: number;
};
export type UsageUser = UsageCounts & {
  telemetryId: string;
  name?: string;
  userId?: string;
  events: number;
  reasons?: string[];
};
export type MonitoringSnapshot = {
  format: 'qraft-monitoring-v1';
  from: string;
  to: string;
  activeUsers?: number;
  days: MonitoringDay[];
  users: UsageUser[];
  queries: QueryInsight[];
  unavailable: string[];
  sampled: boolean;
  limited: boolean;
};
export function monitoringWindow(period: number, now = new Date()) {
  if (![1, 7, 30].includes(period))
    throw new Error('Choose Today, 7 days or 30 days.');
  // Dashboard periods use UTC consistently with Cloudflare and free-tier resets.
  const from = new Date(now);
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - period + 1);
  return { from: from.toISOString(), to: now.toISOString() };
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid monitoring object.');
  return value as Record<string, unknown>;
};
function numeric(value: unknown) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  )
    throw new Error('Metrics must be finite non-negative numbers.');
  return value;
}
export function parseMonitoringImport(
  value: unknown,
  period: number,
  now = new Date(),
): MonitoringSnapshot {
  const source = object(value);
  if (
    source.format !== 'qraft-monitoring-v1' ||
    typeof source.from !== 'string' ||
    typeof source.to !== 'string'
  )
    throw new Error('Use the Qraft monitoring JSON template.');
  const from = Date.parse(source.from),
    to = Date.parse(source.to);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from >= to ||
    to > now.getTime() + 60_000 ||
    to - from > period * 86_400_000 + 60_000 ||
    from < now.getTime() - 32 * 86_400_000
  )
    throw new Error('The imported period is invalid or older than 31 days.');
  if (
    !Array.isArray(source.days) ||
    source.days.length > 31 ||
    !Array.isArray(source.queries) ||
    source.queries.length > 20
  )
    throw new Error(
      'Import supports at most 31 days and 20 query fingerprints.',
    );
  const seen = new Set<string>();
  const firstDate = new Date(from).toISOString().slice(0, 10),
    lastDate = new Date(to).toISOString().slice(0, 10);
  const days = source.days.map((item) => {
    const day = object(item);
    if (
      typeof day.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
      !Number.isFinite(Date.parse(day.date)) ||
      new Date(day.date).toISOString().slice(0, 10) !== day.date ||
      day.date < firstDate ||
      day.date > lastDate ||
      seen.has(day.date)
    )
      throw new Error('Invalid or repeated date.');
    seen.add(day.date);
    const infrastructure: InfraCounts = {};
    if (day.infrastructure !== undefined) {
      const metrics = object(day.infrastructure);
      for (const key of Object.keys(metrics)) {
        if (!(INFRA_KEYS as readonly string[]).includes(key))
          throw new Error('Unknown infrastructure metric.');
        infrastructure[key as InfraKey] = numeric(metrics[key]);
      }
    }
    // User activity comes exclusively from server telemetry; manual imports are infrastructure only.
    return { date: day.date, infrastructure };
  });
  const queries = source.queries.map((item) => {
    const query = object(item);
    if (
      typeof query.fingerprint !== 'string' ||
      !/^[a-f0-9]{16,64}$/.test(query.fingerprint)
    )
      throw new Error(
        'Use hashed query fingerprints; do not import raw SQL or private content.',
      );
    return {
      fingerprint: query.fingerprint,
      executions: numeric(query.executions),
      rowsRead: numeric(query.rowsRead),
      rowsWritten: numeric(query.rowsWritten),
      totalMs: numeric(query.totalMs),
    };
  });
  return {
    format: 'qraft-monitoring-v1',
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    days,
    queries,
    users: [],
    unavailable: [
      'User analytics: manual imports contain infrastructure only.',
    ],
    sampled: true,
    limited: false,
  };
}
export function detectUsageAnomalies(users: UsageUser[]): UsageUser[] {
  // Relative cohort alerts are investigational, never entitlement/fair-use enforcement.
  const ordered = users.map((user) => user.events).sort((a, b) => a - b);
  const median = ordered[Math.floor(ordered.length / 2)] ?? 0;
  return users.map((user) => ({
    ...user,
    reasons:
      users.length >= 5 &&
      user.events >= 100 &&
      user.events > Math.max(100, median * 8)
        ? [
            'Activity exceeds 8× the cohort median; review context before acting.',
          ]
        : [],
  }));
}
export function systemHealth(
  snapshot: MonitoringSnapshot | null,
  refreshedAt?: string | null,
) {
  const reasons: string[] = [];
  let status: 'Healthy' | 'Attention' | 'Critical' = 'Healthy';
  if (!snapshot)
    return {
      status: 'Attention' as const,
      reasons: [
        'No monitoring snapshot is available. Health cannot be verified.',
      ],
    };
  const totals = snapshot.days.reduce((acc, day) => {
    for (const key of INFRA_KEYS)
      if (day.infrastructure?.[key] !== undefined)
        acc[key] =
          key === 'cpuP99Ms' || key === 'r2StorageBytes'
            ? Math.max(acc[key] ?? 0, day.infrastructure[key]!)
            : (acc[key] ?? 0) + day.infrastructure[key]!;
    return acc;
  }, {} as InfraCounts);
  const rate =
    (totals.workerErrors ?? 0) / Math.max(1, totals.workerRequests ?? 0);
  if ((totals.exceededResources ?? 0) > 0 || rate >= 0.05) {
    status = 'Critical';
    reasons.push(
      'Resource exhaustion or Worker error rate ≥5% in the selected period.',
    );
  } else if (rate >= 0.01) {
    status = 'Attention';
    reasons.push('Worker error rate ≥1% in the selected period.');
  }
  if (
    snapshot.days.some(
      (day) =>
        (day.infrastructure?.rowsRead ?? 0) >= 4_000_000 ||
        (day.infrastructure?.rowsWritten ?? 0) >= 80_000 ||
        (day.infrastructure?.workerRequests ?? 0) >= 80_000,
    )
  ) {
    if (status === 'Healthy') status = 'Attention';
    reasons.push(
      'At least one day reaches 80% of a Workers/D1 free allowance.',
    );
  }
  if (snapshot.unavailable.length) {
    if (status === 'Healthy') status = 'Attention';
    reasons.push(
      `Monitoring sources unavailable: ${snapshot.unavailable.map((reason) => reason.split(':')[0]).join(', ')}.`,
    );
  }
  if (snapshot.limited) {
    if (status === 'Healthy') status = 'Attention';
    reasons.push(
      'The monitoring snapshot was truncated. Some results may be missing.',
    );
  }
  const observationTimes = [
    Date.parse(refreshedAt ?? ''),
    Date.parse(snapshot.to),
  ];
  if (observationTimes.some((time) => !Number.isFinite(time))) {
    if (status === 'Healthy') status = 'Attention';
    reasons.push(
      'The snapshot has no valid observation time. Sync Cloudflare to update it.',
    );
  } else if (observationTimes.some((time) => Date.now() - time > 3_600_000)) {
    if (status === 'Healthy') status = 'Attention';
    reasons.push(
      'The monitoring snapshot is more than one hour old. Sync Cloudflare to update it.',
    );
  }
  if (!reasons.length)
    reasons.push(
      'Available metrics are within the current operational alert levels.',
    );
  return { status, reasons };
}
