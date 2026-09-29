import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
await mkdir('.ui-review', { recursive: true });
await build({
  entryPoints: ['features/administration/domain/monitoring.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.ui-review/monitoring-domain.mjs',
});
await build({
  entryPoints: ['features/administration/domain/account-block.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.ui-review/account-block-domain.mjs',
});
const {
  parseMonitoringImport,
  emptyUsage,
  detectUsageAnomalies,
  monitoringWindow,
  systemHealth,
} = await import('../.ui-review/monitoring-domain.mjs');
const { accountBlocked } =
  await import('../.ui-review/account-block-domain.mjs');
void test('monitoring periods are UTC calendar windows and reject arbitrary queries', () => {
  assert.deepEqual(monitoringWindow(7, new Date('2026-09-27T14:00:00Z')), {
    from: '2026-09-21T00:00:00.000Z',
    to: '2026-09-27T14:00:00.000Z',
  });
  assert.throws(() => monitoringWindow(365));
});
void test('manual import validates finite metrics and removes user content', () => {
  const now = new Date('2026-09-27T14:00:00Z');
  const input = {
    format: 'qraft-monitoring-v1',
    from: '2026-09-27T00:00:00Z',
    to: now.toISOString(),
    days: [
      {
        date: '2026-09-27',
        infrastructure: { workerRequests: 100 },
        usage: { secret: 'PRIVATE' },
      },
    ],
    queries: [],
    users: [{ email: 'PRIVATE' }],
  };
  const parsed = parseMonitoringImport(input, 1, now);
  assert.doesNotMatch(JSON.stringify(parsed), /PRIVATE|email/);
  assert.equal(parsed.days[0].infrastructure.workerRequests, 100);
  for (const metric of [-1, Infinity, NaN, '100'])
    assert.throws(() =>
      parseMonitoringImport(
        {
          ...input,
          days: [
            { date: '2026-09-27', infrastructure: { workerRequests: metric } },
          ],
        },
        1,
        now,
      ),
    );
  assert.throws(() =>
    parseMonitoringImport(
      { ...input, days: [...input.days, ...input.days] },
      1,
      now,
    ),
  );
  assert.throws(() =>
    parseMonitoringImport(
      {
        ...input,
        queries: [
          {
            fingerprint: "SELECT 'private'",
            executions: 1,
            rowsRead: 1,
            rowsWritten: 0,
            totalMs: 1,
          },
        ],
      },
      1,
      now,
    ),
  );
  assert.throws(() =>
    parseMonitoringImport({ ...input, to: '2027-01-01' }, 1, now),
  );
});
void test('usage anomaly alerts need a cohort, compare relative activity and never enforce quotas', () => {
  const users = [10, 11, 12, 13, 1000].map((events, index) => ({
    ...emptyUsage(),
    events,
    telemetryId: String(index),
  }));
  assert.equal(
    detectUsageAnomalies(users).filter((user) => user.reasons.length).length,
    1,
  );
  assert.equal(detectUsageAnomalies([users.at(-1)])[0].reasons.length, 0);
  assert.equal(users[4].events, 1000);
});
void test('health detects exhaustion, daily free-tier pressure, missing and stale observations', () => {
  const now = new Date().toISOString();
  const snapshot = {
    format: 'qraft-monitoring-v1',
    from: now,
    to: now,
    days: [
      {
        date: now.slice(0, 10),
        infrastructure: { workerRequests: 100, workerErrors: 0 },
      },
    ],
    users: [],
    queries: [],
    unavailable: [],
    sampled: true,
    limited: false,
  };
  assert.equal(systemHealth(snapshot, now).status, 'Healthy');
  assert.equal(
    systemHealth(
      {
        ...snapshot,
        days: [{ infrastructure: { workerRequests: 100, workerErrors: 5 } }],
      },
      now,
    ).status,
    'Critical',
  );
  assert.equal(
    systemHealth(
      { ...snapshot, days: [{ infrastructure: { exceededResources: 1 } }] },
      now,
    ).status,
    'Critical',
  );
  assert.equal(
    systemHealth(
      { ...snapshot, days: [{ infrastructure: { rowsWritten: 80000 } }] },
      now,
    ).status,
    'Attention',
  );
  assert.equal(
    systemHealth({ ...snapshot, to: '2020-01-01T00:00:00Z' }, now).status,
    'Attention',
  );
  assert.equal(systemHealth(null).status, 'Attention');
  assert.deepEqual(
    systemHealth(
      {
        ...snapshot,
        unavailable: ['D1: unavailable for the current token, plan or period.'],
      },
      now,
    ).reasons,
    ['Monitoring sources unavailable: D1.'],
  );
  assert.deepEqual(systemHealth({ ...snapshot, limited: true }, now).reasons, [
    'The monitoring snapshot was truncated. Some results may be missing.',
  ]);
  assert.deepEqual(
    systemHealth({ ...snapshot, to: '2020-01-01T00:00:00Z' }, now).reasons,
    [
      'The monitoring snapshot is more than one hour old. Sync Cloudflare to update it.',
    ],
  );
  assert.equal(systemHealth(snapshot, 'invalid').status, 'Attention');
  assert.equal(
    systemHealth({ ...snapshot, to: 'invalid' }, now).status,
    'Attention',
  );
});
void test('timed block expires exactly; malformed legacy expirations fail closed', () => {
  assert.equal(
    accountBlocked(
      { suspended: true, suspendedUntil: '2026-09-27T14:00:00Z' },
      Date.parse('2026-09-27T14:00:00Z'),
    ),
    false,
  );
  assert.equal(accountBlocked({ suspended: true }), true);
  assert.equal(
    accountBlocked({ suspended: true, suspendedUntil: 'invalid' }),
    true,
  );
});
void test('telemetry contains no question content or client-token route', async () => {
  const source = await readFile(
    'features/administration/server/usage-telemetry.ts',
    'utf8',
  );
  assert.doesNotMatch(source, /email|question\.stem|lastAnswer|\.note\b/);
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  assert.notEqual(
    config.analytics_engine_datasets[0].dataset,
    config.env.staging.analytics_engine_datasets[0].dataset,
  );
});
