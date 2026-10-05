import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

void test('unified subscription ledger, one-use activation codes and clean migration', async (t) => {
  await mkdir('.ui-review', { recursive: true });
  await build({
    stdin: {
      contents: `export {RealtimeChannel} from './workers/realtime.ts'; import {GET,POST,PUT,DELETE} from './app/api/cloudflare/[...path]/route.ts'; import {expireSubscriptions} from './lib/platform-server'; export default {fetch(request){return ({GET,POST,PUT,DELETE})[request.method](request)},scheduled(){return expireSubscriptions()}}`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    external: ['cloudflare:workers'],
    outfile: '.ui-review/unified-subscriptions-worker.mjs',
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.ui-review/unified-subscriptions-worker.mjs',
      compatibilityDate: '2026-09-09',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'unified-subscriptions-test' },
      r2Buckets: { ASSETS: 'access-test' },
      durableObjects: {
        REALTIME: { className: 'RealtimeChannel', useSQLite: true },
      },
      bindings: { ROOT_ADMIN_EMAIL: 'admin@example.test' },
    }),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const statements = JSON.parse(
    execFileSync(
      'python',
      [
        '-c',
        `import sqlite3,json,pathlib
out=[]
for f in sorted(pathlib.Path('drizzle').glob('*.sql')):
 s=''
 for ch in f.read_text(encoding='utf-8'):
  s+=ch
  if ch==';' and sqlite3.complete_statement(s):
   out.append(s);s=''
print(json.dumps(out))`,
      ],
      { encoding: 'utf8' },
    ),
  );
  for (const sql of statements) await db.prepare(sql).run();
  const now = new Date().toISOString();
  async function account(uid = randomUUID(), options = {}) {
    const profile = {
      uid,
      email: uid + '@example.test',
      displayName: uid,
      role: 'student',
      platformRoles: [],
      tier: 'free',
      status: 'approved',
      createdAt: now,
      ...options,
    };
    await db
      .prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)')
      .bind(
        uid,
        profile.email,
        '!',
        '!',
        JSON.stringify(profile),
        uid === 'admin' || uid === 'unverified' ? 'fixture-mfa' : null,
        now,
        now,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,?,?)',
      )
      .bind(
        createHash('sha256')
          .update('fixture-' + uid)
          .digest('hex'),
        uid,
        Math.floor(Date.now() / 1000) + 3600,
        uid === 'unverified' ? 0 : 1,
        now,
      )
      .run();
    return uid;
  }
  await account('admin', { role: 'super_admin', email: 'admin@example.test' });
  await account('unverified', { role: 'super_admin' });
  const call = async (uid, path, body, method = body ? 'POST' : 'GET') => {
    const response = await mf.dispatchFetch(
      'https://qraft.test/api/cloudflare' + path,
      {
        method,
        headers: {
          cookie: '__Host-qraft_session=fixture-' + uid,
          origin: 'https://qraft.test',
          'content-type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    return { status: response.status, data: await response.json() };
  };
  const user = async (uid) => (await call(uid, '/auth/session')).data.user;
  const grant = (
    uid,
    duration = 1,
    unit = 'month',
    requestId = randomUUID(),
    paid = 10000,
  ) =>
    call('admin', '/platform/access-admin', {
      operation: 'grant',
      userId: uid,
      duration,
      unit,
      requestId,
      paid,
      label: 'Synthetic manual subscription',
      reference: 'Synthetic transfer',
    });
  const generate = async (options = {}) => {
    const secret = randomBytes(20).toString('hex').toUpperCase(),
      requestId = randomUUID();
    const body = {
      operation: 'create',
      requestId,
      name: 'Synthetic activation',
      duration: 7,
      unit: 'day',
      codes: [secret],
      ...options,
    };
    const response = await call('admin', '/platform/activation-codes', body);
    assert.equal(response.status, 201, JSON.stringify(response));
    return { secret, body, code: response.data.codes[0] };
  };
  const redeem = (uid, secret, requestId = randomUUID()) =>
    call(uid, '/platform/activation-code', { code: secret, requestId });
  const state = () => ({
    version: 1,
    tests: [],
    progress: {},
    reports: [],
    revisions: [],
    customQuestions: [],
    questionOverrides: {},
    settings: {},
    flashcardDecks: [],
    flashcards: [],
    flashcardSchedules: {},
    flashcardReviewLog: [],
  });

  await t.test(
    'code status filters, gift issuance retries and disable/redeem races remain consistent',
    async () => {
      assert.equal((await call('admin', '/platform/access-admin')).data.summary.full, 0);
      const uid = await account(),
        requestId = randomUUID(),
        giftBody = {
          operation: 'gift',
          userId: uid,
          requestId,
          duration: 3,
          unit: 'month',
          label: 'Synthetic gift',
        };
      const issued = await Promise.all([
        call('admin', '/platform/access-admin', giftBody),
        call('admin', '/platform/access-admin', giftBody),
      ]);
      assert.ok(
        issued.every((result) => result.status === 200),
        JSON.stringify(issued),
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM reward_passes WHERE id=?')
            .bind('gift-' + requestId)
            .first()
        ).n,
        1,
      );
      const generated = await generate();
      const race = await Promise.all([
        redeem(uid, generated.secret),
        call('admin', '/platform/activation-codes', {
          operation: 'disable',
          codeId: generated.code.id,
          requestId: randomUUID(),
        }),
      ]);
      assert.ok(
        race.every((result) => [200, 409].includes(result.status)),
        JSON.stringify(race),
      );
      const code = await db
        .prepare(
          'SELECT disabled_at,redeemed_at FROM activation_codes WHERE id=?',
        )
        .bind(generated.code.id)
        .first();
      assert.ok(Boolean(code.disabled_at) !== Boolean(code.redeemed_at));
      const filtered = await call(
        'admin',
        '/platform/activation-codes?status=' +
          (code.redeemed_at ? 'used' : 'disabled'),
      );
      assert.ok(
        filtered.data.codes.some((item) => item.id === generated.code.id),
      );
      const unused = await call(
        'admin',
        '/platform/activation-codes?status=unused',
      );
      assert.ok(unused.data.codes.every((item) => item.status === 'unused'));
    },
  );

  await t.test(
    'manual coupon confirmation is atomic, one-use and idempotent; rejected confirmations grant nothing',
    async () => {
      const left = await account(),
        right = await account(),
        id = randomUUID(),
        code = 'PROMO_' + randomUUID().replaceAll('-', '').slice(0, 12);
      await db
        .prepare(
          "INSERT INTO discount_codes(id,code,kind,amount,enabled,max_uses,per_user,allowed_plans,updated_at) VALUES(?,?,'percent',100,1,1,1,'[\"full_monthly\"]',?)",
        )
        .bind(id, code, now)
        .run();
      const body = (uid) => ({
        operation: 'grant',
        userId: uid,
        requestId: randomUUID(),
        duration: 1,
        unit: 'month',
        paid: 0,
        label: 'Manual promotion',
        discountCode: code,
      });
      const first = body(left),
        second = body(right);
      const results = await Promise.all([
        call('admin', '/platform/access-admin', first),
        call('admin', '/platform/access-admin', second),
      ]);
      assert.equal(results.filter((result) => result.status === 200).length, 1);
      assert.ok(
        results.every((result) => [200, 400, 409].includes(result.status)),
        JSON.stringify(results),
      );
      const winner = results[0].status === 200 ? first : second,
        loser = winner === first ? right : left;
      assert.equal(
        (await call('admin', '/platform/access-admin', winner)).data.duplicate,
        true,
      );
      assert.equal((await user(loser)).tier, 'free');
      assert.equal(
        (
          await db
            .prepare('SELECT uses FROM discount_codes WHERE id=?')
            .bind(id)
            .first()
        ).uses,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM subscription_events WHERE code_id=?',
            )
            .bind(id)
            .first()
        ).n,
        1,
      );
    },
  );

  await t.test(
    'Superadmin has permanent access; legacy tiers no longer grant access; MFA required',
    async () => {
      assert.equal((await user('admin')).effectivePlan, 'full_monthly');
      assert.equal((await user('admin')).effectivePlanExpiresAt, null);
      const uid = await account(undefined, { tier: 'full_quarterly' });
      assert.equal((await user(uid)).effectivePlan, 'free');
      for (const caller of [uid, 'unverified', 'missing'])
        assert.equal(
          (
            await call(caller, '/platform/activation-codes', {
              operation: 'create',
            })
          ).status,
          403,
        );
      assert.equal((await grant('admin')).status, 400);
    },
  );
  await t.test(
    'manual activation and renewals stack calendar periods; payment history survives cancellation and replay',
    async () => {
      const uid = await account(),
        id = randomUUID(),
        first = await grant(uid, 1, 'month', id);
      assert.equal(first.status, 200, JSON.stringify(first));
      assert.equal((await grant(uid, 1, 'month', id)).data.duplicate, true);
      const second = await grant(uid, 3, 'month', randomUUID(), 23000);
      assert.equal(second.status, 200);
      assert.equal(second.data.startsAt, first.data.expiresAt);
      assert.equal(
        (await user(uid)).effectivePlanExpiresAt,
        second.data.expiresAt,
      );
      const revoked = await call('admin', '/platform/access-admin', {
        operation: 'revoke',
        userId: uid,
        reason: 'Synthetic cancellation',
        requestId: randomUUID(),
      });
      assert.equal(revoked.status, 200);
      assert.equal((await user(uid)).effectivePlan, 'free');
      const payments = await db
        .prepare(
          'SELECT sum(amount) n,count(*) c FROM access_payments WHERE user_id=?',
        )
        .bind(uid)
        .first();
      assert.deepEqual(payments, { n: 33000, c: 2 });
      await grant(uid, 1, 'month', id);
      assert.equal((await user(uid)).effectivePlan, 'free');
      assert.equal((await grant(uid, 7, 'day', randomUUID(), 0)).status, 200);
      assert.equal((await user(uid)).effectivePlan, 'full_monthly');
    },
  );
  await t.test(
    'activation code contains duration and no plan is required; secrets stay out of stored history',
    async () => {
      const uid = await account(),
        code = await generate({ duration: 3, unit: 'month' }),
        requestId = randomUUID();
      const active = await redeem(
        uid,
        code.secret.match(/.{1,5}/g).join('-'),
        requestId,
      );
      assert.equal(active.status, 200, JSON.stringify(active));
      assert.equal(active.data.grant.duration, 3);
      assert.equal(active.data.grant.duration_unit, 'month');
      assert.equal(
        (await redeem(uid, code.secret, requestId)).data.duplicate,
        true,
      );
      assert.equal((await redeem(uid, code.secret)).status, 409);
      const listings = await call('admin', '/platform/activation-codes');
      assert.equal(
        listings.data.codes.find((row) => row.id === code.code.id).status,
        'used',
      );
      assert.ok(!JSON.stringify(listings).includes(code.secret));
      const history = await db
        .prepare('SELECT result_json FROM access_operations')
        .all();
      assert.ok(!JSON.stringify(history).includes(code.secret));
    },
  );
  await t.test(
    'one code used concurrently by two accounts grants exactly once globally',
    async () => {
      const a = await account(),
        b = await account(),
        code = await generate();
      const responses = await Promise.all([
        redeem(a, code.secret),
        redeem(b, code.secret),
      ]);
      assert.deepEqual(
        responses.map((row) => row.status).sort((a, b) => a - b),
        [200, 409],
        JSON.stringify(responses),
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) n FROM access_grants WHERE source='activation_code' AND source_id=?",
            )
            .bind(code.code.id)
            .first()
        ).n,
        1,
      );
    },
  );
  await t.test(
    'two concurrent durations for one account append without lost updates',
    async () => {
      const uid = await account(),
        a = await generate(),
        b = await generate();
      const results = await Promise.all([
        redeem(uid, a.secret),
        redeem(uid, b.secret),
      ]);
      assert.deepEqual(
        results.map((row) => row.status),
        [200, 200],
        JSON.stringify(results),
      );
      const rows = (
        await db
          .prepare(
            'SELECT * FROM access_grants WHERE user_id=? ORDER BY starts_at',
          )
          .bind(uid)
          .all()
      ).results;
      assert.equal(rows.length, 2);
      assert.equal(rows[1].starts_at, rows[0].expires_at);
      assert.equal(
        Date.parse(rows[1].expires_at) - Date.parse(rows[0].starts_at),
        14 * 86400000,
      );
    },
  );
  await t.test(
    'bound, disabled and expired codes cannot be consumed; account ownership preserved',
    async () => {
      const uid = await account(),
        other = await account(),
        bound = await generate({ userId: uid });
      assert.equal((await redeem(other, bound.secret)).status, 409);
      assert.equal((await redeem(uid, bound.secret)).status, 200);
      const disabled = await generate();
      assert.equal(
        (
          await call('admin', '/platform/activation-codes', {
            operation: 'disable',
            codeId: disabled.code.id,
            requestId: randomUUID(),
          })
        ).status,
        200,
      );
      assert.equal((await redeem(uid, disabled.secret)).status, 409);
      const expired = await generate();
      await db
        .prepare(
          "UPDATE activation_codes SET redeem_before='2000-01-01T00:00:00.000Z' WHERE id=?",
        )
        .bind(expired.code.id)
        .run();
      assert.equal((await redeem(uid, expired.secret)).status, 409);
      assert.equal(
        (
          await db
            .prepare('SELECT redeemed_at FROM activation_codes WHERE id=?')
            .bind(expired.code.id)
            .first()
        ).redeemed_at,
        null,
      );
    },
  );
  await t.test('code consumption rolls back when audit fails', async () => {
    const uid = await account(),
      code = await generate();
    await db
      .prepare(
        "CREATE TRIGGER fail_access_audit BEFORE INSERT ON records WHEN NEW.type='auditLog' AND json_extract(NEW.payload,'$.action')='access_granted' BEGIN SELECT RAISE(ABORT,'AUDIT_TEST_FAILURE'); END",
      )
      .run();
    assert.equal((await redeem(uid, code.secret)).status, 500);
    await db.prepare('DROP TRIGGER fail_access_audit').run();
    assert.equal(
      (
        await db
          .prepare('SELECT redeemed_at FROM activation_codes WHERE id=?')
          .bind(code.code.id)
          .first()
      ).redeemed_at,
      null,
    );
    assert.equal((await user(uid)).effectivePlan, 'free');
    assert.equal((await redeem(uid, code.secret)).status, 200);
  });
  await t.test(
    'cancelling one grant brings scheduled grants forward without deleting payment records',
    async () => {
      const uid = await account(),
        a = await grant(uid, 7, 'day'),
        b = await grant(uid, 7, 'day'),
        c = await grant(uid, 7, 'day');
      const response = await call('admin', '/platform/access-admin', {
        operation: 'cancel',
        userId: uid,
        grantId: b.data.grant.id,
        reason: 'Cancel middle period',
        requestId: randomUUID(),
      });
      assert.equal(response.status, 200);
      const next = await db
        .prepare('SELECT * FROM access_grants WHERE id=?')
        .bind(c.data.grant.id)
        .first();
      assert.equal(next.starts_at, a.data.expiresAt);
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) n FROM access_payments WHERE user_id=?')
            .bind(uid)
            .first()
        ).n,
        3,
      );
    },
  );
  await t.test(
    'gifts activate through the same stacking ledger; expired gift wallet is derived correctly',
    async () => {
      const uid = await account(),
        active = await grant(uid);
      const gift = await call('admin', '/platform/access-admin', {
        operation: 'gift',
        userId: uid,
        duration: 9,
        unit: 'day',
        label: 'Synthetic gift',
        requestId: randomUUID(),
      });
      assert.equal(gift.status, 200);
      const activation = await call(uid, '/platform/rewards', {
        operation: 'activate',
        passId: gift.data.passId,
      });
      assert.equal(activation.status, 200, JSON.stringify(activation));
      assert.equal(activation.data.startsAt, active.data.expiresAt);
      const wallet = await call(uid, '/platform/contributions');
      assert.equal(
        wallet.data.rewardPasses.find((pass) => pass.id === gift.data.passId)
          .status,
        'scheduled',
      );
      assert.equal(
        (
          await call(uid, '/platform/rewards', {
            operation: 'activate',
            passId: gift.data.passId,
          })
        ).status,
        200,
      );
      await db
        .prepare(
          "UPDATE access_grants SET starts_at='1999-01-01T00:00:00.000Z',expires_at='2000-01-01T00:00:00.000Z' WHERE source='reward' AND source_id=?",
        )
        .bind(gift.data.passId)
        .run();
      assert.equal(
        (await call(uid, '/platform/contributions')).data.rewardPasses.find(
          (pass) => pass.id === gift.data.passId,
        ).status,
        'expired',
      );
    },
  );
  await t.test(
    'expiry is enforced without cron and paid tools reject updates while history remains intact',
    async () => {
      const uid = await account();
      await grant(uid);
      const s = state(),
        testId = randomUUID();
      assert.equal(
        (await call(uid, '/platform/exam-start', { testId, questionCount: 20 }))
          .status,
        201,
      );
      s.tests = [
        {
          id: testId,
          questionIds: Array.from({ length: 20 }, (_, i) => 'q-' + i),
          answers: {},
          revealed: [],
          graded: [],
          currentIndex: 0,
        },
      ];
      assert.equal(
        (await call(uid, '/state', { state: s }, 'PUT')).status,
        200,
      );
      const ready = await call(uid, '/preformed/create', {});
      assert.equal(ready.status, 201);
      await db
        .prepare(
          "UPDATE access_grants SET starts_at='1999-01-01T00:00:00.000Z',expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?",
        )
        .bind(uid)
        .run();
      assert.equal((await user(uid)).effectivePlan, 'free');
      s.tests[0].answers['q-0'] = 1;
      assert.equal(
        (await call(uid, '/state', { state: s }, 'PUT')).status,
        403,
      );
      assert.equal(
        (await call(uid, '/preformed/save', { test: ready.data.test }, 'PUT'))
          .status,
        403,
      );
      assert.equal(
        Object.keys((await call(uid, '/state')).data.state.tests[0].answers)
          .length,
        0,
      );
      const worker = await mf.getWorker();
      assert.equal((await worker.scheduled()).outcome, 'ok');
    },
  );
  await t.test(
    'trial remains two lifetime exams, max 15, and history deletion does not reset it',
    async () => {
      const uid = await account();
      assert.equal(
        (
          await call(uid, '/platform/exam-start', {
            testId: randomUUID(),
            questionCount: 16,
          })
        ).status,
        403,
      );
      const starts = await Promise.all(
        Array.from({ length: 4 }, () =>
          call(uid, '/platform/exam-start', {
            testId: randomUUID(),
            questionCount: 15,
          }),
        ),
      );
      assert.equal(starts.filter((row) => row.status === 201).length, 2);
      assert.equal(starts.filter((row) => row.status === 403).length, 2);
      assert.equal(
        (await call(uid, '/state', { state: state() }, 'PUT')).status,
        200,
      );
      assert.equal(
        (
          await call(uid, '/platform/exam-start', {
            testId: randomUUID(),
            questionCount: 1,
          })
        ).status,
        403,
      );
    },
  );
  await t.test('a deleted test ID cannot be reused with different questions; retirement still cleans existing tests', async () => {
    const uid = await account(), id = randomUUID(), question = 'synthetic-' + randomUUID(), s = state();
    s.tests = [{ id, title:'Synthetic trial', questionIds:[question], answers:{}, revealed:[],graded:[],currentIndex:0,startedAt:now }];
    assert.equal((await call(uid,'/state',{state:s},'PUT')).status,200);
    assert.equal((await call(uid,'/state',{state:state()},'PUT')).status,200);
    const replaced = structuredClone(s); replaced.tests[0].questionIds = ['replacement-' + randomUUID()];
    const rejection = await call(uid,'/state',{state:replaced},'PUT'); assert.equal(rejection.status,409); assert.equal(rejection.data.code,'EXAM_CONTENT_CHANGED');
    assert.equal((await call(uid,'/state',{state:s},'PUT')).status,200);
    await db.prepare('INSERT INTO retired_questions(id,uuid,deleted_at) VALUES(?,?,?)').bind(question,randomUUID(),now).run();
    assert.equal((await call(uid,'/state',{state:s},'PUT')).status,200);
    const next = await call(uid,'/state'); assert.deepEqual(next.data.state.tests[0].questionIds,[]);
  });
  await t.test(
    'free notes and cards cannot poison cloud state; disabled Full flashcards flag is authoritative',
    async () => {
      const uid = await account(),
        s = state();
      s.progress.x = { note: 'Forbidden' };
      assert.equal(
        (await call(uid, '/state', { state: s }, 'PUT')).status,
        403,
      );
      delete s.progress.x;
      await grant(uid);
      await db
        .prepare(
          "UPDATE plan_prices SET policy_json='{\"canUseFlashcards\":false}' WHERE plan='full_monthly'",
        )
        .run();
      s.flashcardDecks = [
        {
          id: 'deck',
          name: 'Synthetic',
          qbankId: 'smle-gs',
          color: '#5b5bd6',
          createdAt: now,
          updatedAt: now,
        },
      ];
      s.flashcards = [
        {
          id: 'card',
          deckId: 'deck',
          qbankId: 'smle-gs',
          type: 'basic',
          front: 'F',
          back: 'B',
          tags: [],
          createdAt: now,
          updatedAt: now,
        },
      ];
      assert.equal(
        (await call(uid, '/state', { state: s }, 'PUT')).status,
        403,
      );
      await db
        .prepare(
          "UPDATE plan_prices SET policy_json=NULL WHERE plan='full_monthly'",
        )
        .run();
    },
  );
  await t.test(
    'catalog prices preserved; discount checkout never silently activates access; legacy management is retired',
    async () => {
      const uid = await account();
      const catalog = await call(uid, '/platform/plan-catalog');
      assert.equal(
        catalog.data.plans.find((plan) => plan.id === 'full_monthly').price,
        10000,
      );
      assert.equal(
        catalog.data.plans.find((plan) => plan.id === 'full_quarterly').price,
        23000,
      );
      const checkout = await call(uid, '/platform/checkout', {
        requestId: randomUUID(),
        plan: 'full_monthly',
        acceptedTerms: true,
      });
      assert.equal(checkout.status, 200);
      assert.ok(checkout.data.url.startsWith('https://wa.me/'));
      assert.equal((await user(uid)).effectivePlan, 'free');
      assert.equal(
        (
          await call('admin', '/platform/subscriptions', {
            userId: uid,
            operation: 'cancel',
          })
        ).status,
        410,
      );
    },
  );
});
