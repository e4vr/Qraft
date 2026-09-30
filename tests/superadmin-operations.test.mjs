import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

void test('superadmin operations enforce authorization, money, maintenance and bounded analytics', async (t) => {
  await mkdir('.ui-review', { recursive: true });
  await build({
    stdin: {
      contents:
        "import {GET,POST,PUT,DELETE} from './server/api/cloudflare-router'; import {env} from 'cloudflare:workers'; import {RealtimeChannel} from './workers/realtime'; export {RealtimeChannel}; export default {async fetch(r){const path=new URL(r.url).pathname;if(path==='/__budget'||path==='/__budget-status'){const stub=env.REALTIME.getByName('test-budget');return Response.json(path==='/__budget-status'?await stub.usageBudget():await stub.reserveUsageBudget(256));}return ({GET,POST,PUT,DELETE})[r.method](r)}};",
      resolveDir: process.cwd(),
      sourcefile: 'test-superadmin.ts',
      loader: 'ts',
    },
    bundle: true,
    external: ['cloudflare:workers'],
    platform: 'neutral',
    format: 'esm',
    outfile: '.ui-review/superadmin-worker.mjs',
  });
  let upstreamCalls = 0;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.ui-review/superadmin-worker.mjs',
      compatibilityDate: '2026-09-09',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'superadmin-tests' },
      r2Buckets: { ASSETS: 'superadmin-assets' },
      durableObjects: {
        REALTIME: { className: 'RealtimeChannel', useSQLite: true },
      },
      bindings: {
        CLOUDFLARE_ANALYTICS_TOKEN: 'read-only-test-secret',
        CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
        MONITORING_WORKER_NAME: 'test-app',
        MONITORING_D1_ID: 'test-database',
        MONITORING_R2_BUCKET: 'test-bucket',
        QRAFT_TELEMETRY_ENABLED: 'false',
      },
      outboundService: async (request) => {
        upstreamCalls++;
        assert.equal(
          request.headers.get('authorization'),
          'Bearer read-only-test-secret',
        );
        const { query } = await request.json();
        const data = {};
        if (query.includes('workersInvocationsAdaptive'))
          for (const [, id] of query.matchAll(/(w\d+):workers/g))
            data[id] = [
              {
                sum: { requests: 120, errors: 2 },
                quantiles: { cpuTimeP99: 900 },
                dimensions: { status: 'ok' },
              },
            ];
        if (query.includes('d1AnalyticsAdaptiveGroups'))
          data.d1AnalyticsAdaptiveGroups = [
            {
              sum: {
                readQueries: 30,
                writeQueries: 10,
                rowsRead: 400,
                rowsWritten: 10,
              },
              dimensions: { date: new Date().toISOString().slice(0, 10) },
            },
          ];
        if (query.includes('d1QueriesAdaptiveGroups'))
          data.d1QueriesAdaptiveGroups = [
            {
              sum: { queryDurationMs: 20, rowsRead: 400, rowsWritten: 0 },
              count: 8,
              dimensions: {
                query:
                  "SELECT * FROM profiles WHERE email='private@example.test'",
              },
            },
          ];
        if (query.includes('r2OperationsAdaptiveGroups')) {
          data.r2OperationsAdaptiveGroups = [
            {
              sum: { requests: 45 },
              dimensions: { datetimeHour: new Date().toISOString() },
            },
          ];
          data.r2StorageAdaptiveGroups = [
            {
              max: { payloadSize: 1024, metadataSize: 10 },
              dimensions: { datetime: new Date().toISOString() },
            },
          ];
        }
        return Response.json({ data: { viewer: { accounts: [data] } } });
      },
    }),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const migrations = JSON.parse(
    execFileSync(
      'python',
      [
        '-c',
        "import sqlite3,json,pathlib\nout=[]\nfor f in sorted(pathlib.Path('drizzle').glob('*.sql')):\n s=''\n for ch in f.read_text(encoding='utf-8'):\n  s+=ch\n  if ch==';' and sqlite3.complete_statement(s):out.append(s);s=''\nprint(json.dumps(out))",
      ],
      { encoding: 'utf8' },
    ),
  );
  for (const sql of migrations) await db.prepare(sql).run();
  const now = new Date().toISOString();
  for (const uid of ['admin', 'unverified', 'member']) {
    const root = uid !== 'member';
    const profile = {
      uid,
      email: `${uid}@example.test`,
      displayName: uid,
      role: root ? 'super_admin' : 'student',
      status: 'approved',
      tier: 'full_monthly',
      platformRoles: [],
      universityId: uid,
      createdAt: now,
    };
    await db
      .prepare(
        'INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,totp_secret,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .bind(
        uid,
        profile.email,
        'PRIVATE_PASSWORD_HASH',
        'PRIVATE_PASSWORD_SALT',
        JSON.stringify(profile),
        root ? 'JBSWY3DPEHPK3PXP' : null,
        now,
        now,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,?,?)',
      )
      .bind(
        createHash('sha256').update(`fixture-${uid}`).digest('hex'),
        uid,
        Math.floor(Date.now() / 1000) + 3600,
        uid === 'unverified' ? 0 : 1,
        now,
      )
      .run();
  }
  const call = async (uid, path, body, method = body ? 'POST' : 'GET') => {
    const response = await mf.dispatchFetch(
      `https://qraft.test/api/cloudflare${path}`,
      {
        method,
        headers: {
          cookie: `__Host-qraft_session=fixture-${uid}`,
          origin: 'https://qraft.test',
          'content-type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    return { status: response.status, data: await response.json() };
  };
  await t.test('the catalog defaults to two Full Access periods and rejects retired plan requests', async () => {
    const catalog = await call('member', '/platform/plan-catalog');
    assert.equal(catalog.status, 200);
    assert.deepEqual(catalog.data.plans.map(({ id, price }) => [id, price]), [['free', 0], ['full_monthly', 10000], ['full_quarterly', 23000]]);
    for (const plan of ['full_monthly', 'full_quarterly']) {
      const quote = await call('member', '/platform/quote', { plan });
      assert.equal(quote.status, 200);
      assert.equal(quote.data.plan, plan);
    }
    assert.equal((await call('member', '/platform/quote', { plan: 'retired-plan' })).status, 400);
    assert.equal((await call('member', '/platform/checkout', { plan: 'retired-plan', requestId: randomUUID() })).status, 400);
  });
  await t.test(
    'all operational endpoints require verified MFA and authoritative root role',
    async () => {
      for (const uid of ['member', 'unverified', 'unknown'])
        for (const path of [
          '/platform/monitoring',
          '/platform/site-operations',
          '/platform/plan-pricing',
        ])
          assert.equal((await call(uid, path)).status, 403);
      assert.equal(
        (await call('admin', '/platform/monitoring?period=99')).status,
        400,
      );
      assert.equal(
        (await call('member', '/platform/plan-catalog')).status,
        200,
      );
    },
  );
  await t.test(
    'fractional plan prices feed quote and the atomic discount trigger',
    async () => {
      const prices = {
        plans: [
          { id: 'full_monthly', price: 2999 },
          { id: 'full_quarterly', price: 6999 },
        ],
        reason: 'Test subscription prices',
      };
      assert.equal(
        (await call('admin', '/platform/plan-pricing', prices, 'PUT')).status,
        200,
      );
      const quote = await call('member', '/platform/quote', {
        plan: 'full_monthly',
        code: '',
      });
      assert.equal(quote.data.original, 2999);
      assert.equal(
        (
          await call(
            'admin',
            '/platform/plan-pricing',
            {
              ...prices,
              plans: prices.plans.map((plan) => ({ ...plan, price: 0 })),
            },
            'PUT',
          )
        ).status,
        400,
      );
      await db
        .prepare(
          "INSERT INTO discount_codes(id,code,kind,amount,enabled,uses,allowed_plans,updated_at) VALUES('test-free','TESTFREE','percent',100,1,0,'[\"full_monthly\",\"full_quarterly\"]',?)",
        )
        .bind(now)
        .run();
      const checkout = await call('member', '/platform/checkout', {
        plan: 'full_quarterly',
        code: 'TESTFREE',
        requestId: randomUUID(),
      });
      assert.equal(checkout.status, 200);
      assert.equal(checkout.data.upgraded, true);
      const paid = await db.prepare("SELECT starts_at,expires_at FROM subscriptions WHERE user_id='member'").first();
      const calendarEnd = new Date(paid.starts_at);
      const day = calendarEnd.getUTCDate();
      calendarEnd.setUTCDate(1);
      calendarEnd.setUTCMonth(calendarEnd.getUTCMonth() + 3);
      const lastDay = new Date(Date.UTC(calendarEnd.getUTCFullYear(),calendarEnd.getUTCMonth()+1,0)).getUTCDate();
      calendarEnd.setUTCDate(Math.min(day,lastDay));
      assert.equal(paid.expires_at, calendarEnd.toISOString());
    },
  );
  await t.test(
    'timed blocks preserve identity and never expose password material',
    async () => {
      const blocked = await call('admin', '/platform/account-block', {
        userId: 'member',
        blocked: true,
        days: 2,
        reason: 'Timed moderation test',
      });
      assert.equal(blocked.status, 200);
      assert.doesNotMatch(
        JSON.stringify(blocked.data),
        /PRIVATE_PASSWORD|password_hash|password_salt/,
      );
      assert.equal(
        (await call('member', '/platform/quote', { plan: 'full_monthly', code: '' }))
          .status,
        403,
      );
      assert.equal(
        (
          await call('admin', '/platform/account-block', {
            userId: 'admin',
            blocked: true,
            days: 2,
            reason: 'Invalid target',
          })
        ).status,
        403,
      );
      await db
        .prepare(
          "UPDATE profiles SET profile_json=json_set(profile_json,'$.suspendedUntil',?) WHERE uid='member'",
        )
        .bind(new Date(Date.now() - 1000).toISOString())
        .run();
      assert.equal(
        (await call('member', '/platform/quote', { plan: 'full_monthly', code: '' }))
          .status,
        200,
      );
      assert.equal(
        (
          await call('admin', '/platform/account-block', {
            userId: 'member',
            blocked: false,
            days: 2,
            reason: 'Restore test',
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    'published plan details enforce server limits and ignore forged profile limits',
    async () => {
      const plans = (await call('admin', '/platform/plan-pricing')).data.plans;
      const input = {
        reason: 'Controlled exam limits',
        plans: plans
          .filter((plan) => plan.id !== 'free')
          .map((plan) => ({
            id: plan.id,
            price: plan.price,
            policy:
              plan.id === 'full_quarterly'
                ? { name: 'Full Access Plus', maxQuestionsPerExam: 5, canCreateReadyTests: false, maxFlashcardDecks: null, maxFlashcards: null }
                : { name: plan.name },
          })),
      };
      assert.equal(
        (await call('admin', '/platform/plan-pricing', input, 'PUT')).status,
        200,
      );
      const session = await call('member', '/auth/session');
      assert.equal(session.data.user.planLimits.name, 'Full Access Plus');
      assert.equal(session.data.user.planLimits.maxQuestionsPerExam, 5);
      assert.equal(session.data.user.planLimits.canCreateReadyTests, false);
      assert.equal(session.data.user.planLimits.maxFlashcardDecks, null);
      assert.equal(session.data.user.planLimits.maxFlashcards, null);
      assert.equal((await call('member', '/preformed/create', { title: 'Disabled by plan' })).status, 403);
      await db
        .prepare(
          "UPDATE profiles SET profile_json=json_set(profile_json,'$.planLimits.maxQuestionsPerExam',99999) WHERE uid='member'",
        )
        .run();
      assert.equal(
        (
          await call('member', '/platform/exam-start', {
            testId: randomUUID(),
            questionCount: 6,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call('member', '/platform/exam-start', {
            testId: randomUUID(),
            questionCount: 5,
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await call(
            'admin',
            '/platform/plan-pricing',
            {
              ...input,
              plans: input.plans.map((plan) => ({
                ...plan,
                policy: { maxQuestionsPerExam: 501 },
              })),
            },
            'PUT',
          )
        ).status,
        400,
      );
    },
  );
  await t.test(
    'custom reward days survive activation with exact expiry',
    async () => {
      const gift = await call('admin', '/platform/economy-admin', {
        operation: 'grant-reward',
        userId: 'member',
        plan: 'full_monthly',
        days: 9,
        reason: 'Nine day gift',
      });
      assert.equal(gift.status, 200);
      assert.equal(gift.data.pass.duration_days, 9);
      const activation = await call('member', '/platform/rewards', {
        operation: 'activate',
        passId: gift.data.pass.id,
      });
      assert.equal(activation.status, 200);
      assert.equal(
        Date.parse(activation.data.pass.expires_at) -
          Date.parse(activation.data.pass.activated_at),
        9 * 86400000,
      );
    },
  );
  await t.test(
    'maintenance blocks user actions but keeps root and sign-in recoverable; conflicts are audited atomically',
    async () => {
      const start = await call('admin', '/platform/site-operations');
      const body = {
        maintenance: true,
        message: 'Maintenance <script>test</script>',
        endsAt: new Date(Date.now() + 3600000).toISOString(),
        reason: 'Maintenance test',
        revision: start.data.revision,
      };
      assert.equal(
        (await call('admin', '/platform/site-operations', body, 'PUT')).status,
        200,
      );
      assert.equal(
        (await call('member', '/platform/quote', { plan: 'full_monthly', code: '' }))
          .status,
        503,
      );
      assert.equal((await call('member', '/auth/session')).status, 200);
      assert.equal((await call('admin', '/platform/monitoring')).status, 200);
      const before = await db
        .prepare(
          "SELECT count(*) n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='site_operations_changed'",
        )
        .first();
      assert.equal(
        (await call('admin', '/platform/site-operations', body, 'PUT')).status,
        409,
      );
      const after = await db
        .prepare(
          "SELECT count(*) n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='site_operations_changed'",
        )
        .first();
      assert.equal(before.n, after.n);
      const current = await call('admin', '/platform/site-operations');
      assert.equal(
        (
          await call(
            'admin',
            '/platform/site-operations',
            {
              ...body,
              maintenance: false,
              endsAt: null,
              revision: current.data.revision,
            },
            'PUT',
          )
        ).status,
        200,
      );
    },
  );
  await t.test(
    'read token stays server-side; concurrent refreshes consume a single reservation; SQL content is hashed',
    async () => {
      const [a, b] = await Promise.all([
        call('admin', '/platform/monitoring?period=7', { operation: 'sync' }),
        call('admin', '/platform/monitoring?period=7', { operation: 'sync' }),
      ]);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      const dashboard = await call('admin', '/platform/monitoring?period=7');
      assert.equal(dashboard.data.budget.used, 7);
      assert.equal(upstreamCalls, 4);
      assert.deepEqual(dashboard.data.snapshot.unavailable, []);
      assert.equal(dashboard.data.telemetry, false);
      assert.equal(dashboard.data.snapshot.queries[0].executions, 8);
      assert.equal(
        dashboard.data.snapshot.days.at(-1).infrastructure.cpuP99Ms,
        0.9,
      );
      assert.doesNotMatch(
        JSON.stringify(dashboard.data),
        /read-only-test-secret|private@example|SELECT \*/,
      );
      await db
        .prepare('UPDATE monitoring_query_budget SET used=56 WHERE day=?')
        .bind(now.slice(0, 10))
        .run();
      assert.equal(
        (
          await call('admin', '/platform/monitoring?period=30', {
            operation: 'sync',
          })
        ).status,
        429,
      );
      assert.equal(upstreamCalls, 4);
    },
  );
  await t.test(
    'disabled user collection corrects old snapshots while preserving real infrastructure failures',
    async () => {
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
        sampled: true,
        limited: false,
        unavailable: [
          'User Analytics: unavailable for the current token, plan or period.',
        ],
      };
      const store = async () =>
        db
          .prepare(
            "UPDATE monitoring_snapshots SET payload=?,refreshed_at=?,source='cloudflare' WHERE period=1",
          )
          .bind(JSON.stringify(snapshot), now)
          .run();
      await store();
      const disabled = await call('admin', '/platform/monitoring?period=1');
      assert.equal(disabled.data.health.status, 'Healthy');
      assert.deepEqual(disabled.data.snapshot.unavailable, []);
      assert.equal(disabled.data.snapshot.activeUsers, undefined);
      snapshot.unavailable.push(
        'Workers: unavailable for the current token, plan or period.',
      );
      await store();
      const failed = await call('admin', '/platform/monitoring?period=1');
      assert.equal(failed.data.health.status, 'Attention');
      assert.deepEqual(failed.data.health.reasons, [
        'Monitoring sources unavailable: Workers.',
      ]);
      assert.equal(failed.data.snapshot.unavailable.length, 1);
    },
  );
  await t.test(
    'manual fallback preserves observation dates and rejects raw SQL or non-finite metrics',
    async () => {
      const snapshot = {
        format: 'qraft-monitoring-v1',
        from: new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString(),
        to: new Date().toISOString(),
        days: [
          {
            date: now.slice(0, 10),
            infrastructure: { workerRequests: 100, workerErrors: 0 },
          },
        ],
        queries: [],
      };
      const result = await call('admin', '/platform/monitoring?period=1', {
        operation: 'import',
        snapshot,
        reason: 'Dashboard export',
      });
      assert.equal(result.status, 200);
      assert.equal(result.data.source, 'manual');
      assert.equal(result.data.snapshot.to, snapshot.to);
      assert.equal(
        (
          await call('admin', '/platform/monitoring?period=1', {
            operation: 'import',
            snapshot,
            reason: { invalid: 'type' },
          })
        ).status,
        400,
      );
      const beforeImport = await call('admin', '/platform/monitoring?period=7');
      assert.ok(beforeImport.data.nextRefreshAt);
      const imported = await call('admin', '/platform/monitoring?period=7', {
        operation: 'import',
        snapshot,
        reason: 'Preserve refresh cooldown',
      });
      assert.equal(imported.status, 200);
      assert.equal(
        imported.data.nextRefreshAt,
        beforeImport.data.nextRefreshAt,
      );
      await call('admin', '/platform/monitoring?period=7', {
        operation: 'sync',
      });
      assert.equal(upstreamCalls, 4);
      assert.equal(
        (
          await call('admin', '/platform/monitoring?period=1', {
            operation: 'import',
            snapshot: {
              ...snapshot,
              queries: [{ fingerprint: 'SELECT private' }],
            },
            reason: 'Bad export',
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    'durable telemetry reservations are atomic and cannot exceed daily free-tier safety cap',
    async () => {
      const results = await Promise.all(
        Array.from({ length: 82 }, () =>
          mf
            .dispatchFetch('https://qraft.test/__budget')
            .then((response) => response.json()),
        ),
      );
      assert.equal(results.filter(Boolean).length, 78);
      assert.equal(78 * 256, 19968);
      const counters = await mf.dispatchFetch(
        'https://qraft.test/__budget-status',
      );
      assert.deepEqual(await counters.json(), { daily: 19968, monthly: 19968 });
    },
  );
});
