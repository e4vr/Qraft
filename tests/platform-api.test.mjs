import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, pbkdf2Sync, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

void test('platform API authorization, import, subscription and ticket workflows', async (t) => {
  await mkdir('.ui-review', { recursive: true });
  await build({
    stdin: {
      contents: `export {RealtimeChannel} from './workers/realtime.ts'; import {GET,POST,PUT,DELETE} from './app/api/cloudflare/[...path]/route.ts'; export default {fetch(request){return ({GET,POST,PUT,DELETE})[request.method](request)}}`,
      resolveDir: process.cwd(),
      sourcefile: 'qa-worker.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    external: ['cloudflare:workers'],
    outfile: '.ui-review/platform-worker.mjs',
  });
  const workerOptions = {
    modules: true,
    scriptPath: '.ui-review/platform-worker.mjs',
    compatibilityDate: '2026-09-07',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'platform-test' },
    r2Buckets: { ASSETS: 'assets-test' },
    durableObjects: {
      REALTIME: { className: 'RealtimeChannel', useSQLite: true },
    },
    bindings: {
      ROOT_ADMIN_EMAIL: 'admin@example.test',
      R2_BILLING_CYCLE_DAY: '7',
      R2_CLASS_A_MONTHLY_CAP: '1',
      R2_CLASS_B_MONTHLY_CAP: '1',
      R2_STORAGE_CAP_BYTES: '1024',
    },
  };
  const built = process.env.PLATFORM_TEST_BUILT === '1';
  const productionModules = built
    ? [
        'index.js',
        ...readdirSync('dist/server', { recursive: true })
          .map(String)
          .filter((path) => path !== 'index.js' && path.endsWith('.js')),
      ].map((path) => ({ type: 'ESModule', path: `dist/server/${path}` }))
    : [];
  const mf = new Miniflare(
    convertV4MiniflareOptions(
      built
        ? {
            workers: [
              {
                ...workerOptions,
                name: 'app',
                modules: productionModules,
                durableObjects: {
                  REALTIME: {
                    className: 'RealtimeChannel',
                    scriptName: 'realtime',
                    useSQLite: true,
                  },
                },
              },
              {
                name: 'realtime',
                modules: true,
                scriptPath: 'dist/qraft_realtime/index.js',
                compatibilityDate: '2026-09-07',
                durableObjects: {
                  REALTIME: { className: 'RealtimeChannel', useSQLite: true },
                },
              },
            ],
          }
        : workerOptions,
    ),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB', built ? 'app' : undefined);
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
  for (const uid of [
    'admin',
    'free',
    'lite',
    'other',
    'pro',
    'pro-limit',
    'pro-pending',
    'unlimited',
    'reviewer',
    'reviewer2',
    'access',
    'manual-member',
    'paid-member',
    'discount-member',
  ]) {
    const profile = {
      uid,
      email: `${uid}@example.test`,
      displayName: uid,
      tier:
        uid === 'free'
          ? 'free'
          : uid === 'pro' || uid === 'pro-limit' || uid === 'pro-pending'
            ? 'pro'
            : uid === 'unlimited'
              ? 'unlimited'
              : 'lite',
      status: 'approved',
      role:
        uid === 'admin'
          ? 'super_admin'
          : uid === 'reviewer' || uid === 'reviewer2'
            ? 'reviewer'
            : 'student',
      platformRoles:
        uid === 'reviewer' || uid === 'reviewer2'
          ? ['reviewer']
          : uid === 'access'
            ? ['access_manager']
            : [],
      phone: `private-${uid}`,
      universityId: uid,
      createdAt: new Date().toISOString(),
    };
    await db
      .prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)')
      .bind(
        uid,
        profile.email,
        'unused',
        'unused',
        JSON.stringify(profile),
        uid === 'admin' ? 'fixture-mfa' : null,
        profile.createdAt,
        profile.createdAt,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,1,?)',
      )
      .bind(
        createHash('sha256').update(`fixture-${uid}`).digest('hex'),
        uid,
        Math.floor(Date.now() / 1000) + 3600,
        profile.createdAt,
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
  const uploadImage = async (
    uid,
    name = 'scan.png',
    content = 'png-test-content',
  ) => {
    const body = new FormData();
    body.append(
      'file',
      new File(
        [
          new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          new TextEncoder().encode(content),
        ],
        name,
        { type: 'image/png' },
      ),
    );
    body.append('qbankId', 'smle-gs');
    body.append('questionId', 'gs-001');
    const encoded = new Request('https://qraft.test/upload-body', {
      method: 'POST',
      body,
    });
    return mf.dispatchFetch('https://qraft.test/api/cloudflare/media/notes', {
      method: 'POST',
      headers: {
        cookie: `__Host-qraft_session=fixture-${uid}`,
        origin: 'https://qraft.test',
        'content-type': encoded.headers.get('content-type'),
      },
      body: await encoded.arrayBuffer(),
    });
  };
  let codeId;
  await t.test('R2 uploads are private, hashed, and deduplicated', async () => {
    const first = await uploadImage('pro');
    assert.equal(first.status, 201);
    const uploaded = await first.json();
    assert.match(uploaded.url, /^\/api\/cloudflare\/media\/notes\//);
    const duplicate = await uploadImage('pro', 'renamed.png');
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);
    const asset = await mf.dispatchFetch(`https://qraft.test${uploaded.url}`, {
      headers: { cookie: '__Host-qraft_session=fixture-pro' },
    });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'image/png');
    assert.match(asset.headers.get('cache-control'), /private/);
    const storage = await db
      .prepare("SELECT value FROM counters WHERE id='r2-storage-bytes'")
      .first();
    assert.ok(storage.value > 0);
    await db
      .prepare("UPDATE counters SET value=1024 WHERE id='r2-storage-bytes'")
      .run();
    assert.equal(
      (await uploadImage('pro', 'storage-limit.png', 'different')).status,
      413,
    );
    await db
      .prepare("UPDATE counters SET value=? WHERE id='r2-storage-bytes'")
      .bind(storage.value)
      .run();
    assert.equal((await uploadImage('pro', 'new.png', 'different')).status, 429);
    assert.equal(
      (
        await mf.dispatchFetch(`https://qraft.test${uploaded.url}`, {
          headers: { cookie: '__Host-qraft_session=fixture-lite' },
        })
      ).status,
      429,
    );
    const rows = await db
      .prepare("SELECT provider,file_hash FROM media WHERE owner_id='pro'")
      .all();
    assert.equal(rows.results.length, 1);
    assert.equal(rows.results[0].provider, 'r2');
    assert.match(rows.results[0].file_hash, /^[a-f0-9]{64}$/);
    const usage = await db.prepare('SELECT * FROM r2_usage_periods').first();
    assert.equal(usage.class_a_operations, 1);
    assert.equal(usage.class_b_operations, 1);
  });
  await t.test(
    'Members can update their profile and securely change their password',
    async () => {
      const currentPassword = 'current-password-123';
      const salt = 'profile-test-salt';
      const passwordHash = pbkdf2Sync(
        currentPassword,
        salt,
        100_000,
        32,
        'sha256',
      ).toString('hex');
      await db
        .prepare(
          'UPDATE profiles SET password_hash=?,password_salt=? WHERE uid=?',
        )
        .bind(passwordHash, salt, 'lite')
        .run();
      await db
        .prepare(
          'INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,1,?)',
        )
        .bind(
          createHash('sha256').update('another-lite-session').digest('hex'),
          'lite',
          Math.floor(Date.now() / 1000) + 3600,
          new Date().toISOString(),
        )
        .run();
      const updated = await call(
        'lite',
        '/auth/profile',
        { displayName: 'Updated Learner', phone: '+966 55 123 4567' },
        'PUT',
      );
      assert.equal(updated.status, 200, JSON.stringify(updated));
      assert.equal(updated.data.user.displayName, 'Updated Learner');
      assert.equal(updated.data.user.phone, '966551234567');
      const stored = JSON.parse(
        (
          await db
            .prepare('SELECT profile_json FROM profiles WHERE uid=?')
            .bind('lite')
            .first()
        ).profile_json,
      );
      assert.equal(stored.displayName, 'Updated Learner');
      assert.equal(
        (
          await call(
            'lite',
            '/auth/password',
            {
              currentPassword: 'wrong-password',
              newPassword: 'replacement-password-456',
            },
            'PUT',
          )
        ).status,
        401,
      );
      const changed = await call(
        'lite',
        '/auth/password',
        { currentPassword, newPassword: 'replacement-password-456' },
        'PUT',
      );
      assert.equal(changed.status, 200, JSON.stringify(changed));
      const account = await db
        .prepare('SELECT password_hash,password_salt FROM profiles WHERE uid=?')
        .bind('lite')
        .first();
      assert.equal(
        account.password_hash,
        pbkdf2Sync(
          'replacement-password-456',
          account.password_salt,
          100_000,
          32,
          'sha256',
        ).toString('hex'),
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS count FROM sessions WHERE user_id=?')
            .bind('lite')
            .first()
        ).count,
        1,
      );
    },
  );
  await t.test(
    'Access managers receive limited profiles and cannot modify official subscribers or their blocks',
    async () => {
      const now = new Date().toISOString();
      for (const [uid, method, paid, code] of [
        ['manual-member', 'manual', 0, null],
        ['paid-member', 'manual', 1500, null],
        ['discount-member', 'discount', 0, 'FREE'],
      ]) {
        await db
          .prepare(
            'INSERT INTO subscriptions(user_id,status,method,paid,discount_code,updated_at) VALUES(?,?,?,?,?,?)',
          )
          .bind(uid, 'active', method, paid, code, now)
          .run();
      }
      const loaded = await call('access', '/collaboration');
      assert.equal(loaded.status, 200);
      const members = loaded.data.collaboration.members;
      for (const member of members)
        for (const key of [
          'phone',
          'createdAt',
          'mfaEnrolled',
          'approvedAt',
          'approvedByName',
        ])
          assert.equal(key in member, false);
      const save = (operations) =>
        call('access', '/collaboration', { operations }, 'PUT');
      const profileOp = (uid, changes) => ({
        collection: 'profiles',
        type: 'set',
        id: uid,
        value: { ...members.find((m) => m.uid === uid), ...changes },
      });
      const suspendManual = await save([
        profileOp('manual-member', { suspended: true }),
      ]);
      assert.equal(suspendManual.status, 200, JSON.stringify(suspendManual.data));
      const stored = JSON.parse(
        (
          await db
            .prepare('SELECT profile_json FROM profiles WHERE uid=?')
            .bind('manual-member')
            .first()
        ).profile_json,
      );
      assert.equal(stored.phone, 'private-manual-member');
      assert.ok(stored.createdAt);
      assert.equal(
        (await save([profileOp('manual-member', { suspended: false })])).status,
        200,
      );
      for (const uid of ['paid-member', 'discount-member']) {
        assert.equal(
          (await save([profileOp(uid, { suspended: true })])).status,
          403,
        );
        assert.equal(
          (
            await save([
              profileOp(uid, { tier: 'lite', subscriptionProtected: false }),
            ])
          ).status,
          403,
        );
        for (const kind of ['emails', 'universityIds']) {
          assert.equal(
            (
              await save([
                {
                  collection: 'system',
                  type: 'set',
                  id: 'accessControl',
                  value: {
                    emails: [],
                    phones: [],
                    universityIds: [],
                    [kind]: [kind === 'emails' ? `${uid}@example.test` : uid],
                  },
                },
              ])
            ).status,
            403,
          );
        }
        assert.equal(
          (await call('access', '/platform/subscriptions', { userId: uid }))
            .status,
          403,
        );
      }
      assert.equal(
        (
          await save([
            {
              collection: 'system',
              type: 'set',
              id: 'accessControl',
              value: {
                emails: [],
                phones: ['private-paid-member'],
                universityIds: [],
              },
            },
          ])
        ).status,
        403,
      );
      const rootMember = (
        await call('admin', '/collaboration')
      ).data.collaboration.members.find((m) => m.uid === 'paid-member');
      assert.equal(rootMember.phone, 'private-paid-member');
      assert.equal(
        (
          await call(
            'admin',
            '/collaboration',
            {
              operations: [
                {
                  collection: 'profiles',
                  type: 'set',
                  id: rootMember.uid,
                  value: { ...rootMember, suspended: true },
                },
              ],
            },
            'PUT',
          )
        ).status,
        200,
      );
    },
  );
  await t.test(
    'Clearing review history is persisted for the authenticated account only',
    async () => {
      const before = await db
        .prepare(
          "SELECT type,id,payload FROM records WHERE type IN ('questionProposals','sharedQuestions') ORDER BY type,id",
        )
        .all();
      const cleared = await call('reviewer', '/platform/review-history', {
        userId: 'other',
        clearedAt: '2099-01-01',
      });
      assert.equal(cleared.status, 200);
      assert.ok(Date.parse(cleared.data.clearedAt) <= Date.now());
      assert.deepEqual(
        (await call('reviewer', '/platform/review-history')).data,
        cleared.data,
      );
      assert.deepEqual((await call('other', '/platform/review-history')).data, {
        clearedAt: '',
      });
      assert.equal(
        (await call('missing', '/platform/review-history', {})).status,
        403,
      );
      assert.equal(
        (await call('reviewer', '/platform/review-history', {}, 'DELETE'))
          .status,
        405,
      );
      const after = await db
        .prepare(
          "SELECT type,id,payload FROM records WHERE type IN ('questionProposals','sharedQuestions') ORDER BY type,id",
        )
        .all();
      assert.deepEqual(after.results, before.results);
    },
  );
  await t.test(
    'Lite cannot administer discounts or subscriptions',
    async () => {
      assert.equal((await call('lite', '/platform/discounts')).status, 403);
      assert.equal(
        (
          await call('lite', '/platform/subscriptions', {
            userId: 'lite',
            expires_at: '2099-01-01',
          })
        ).status,
        403,
      );
    },
  );
  await t.test('Free exam allowance is lifetime-based and server enforced', async () => {
    assert.equal(
      (
        await call('free', '/platform/exam-start', {
          testId: randomUUID(),
          questionCount: 16,
        })
      ).status,
      403,
    );
    for (let index = 0; index < 2; index += 1) {
      const started = await call('free', '/platform/exam-start', {
        testId: randomUUID(),
        questionCount: 15,
      });
      assert.equal(started.status, 201, JSON.stringify(started));
    }
    const blocked = await call('free', '/platform/exam-start', {
      testId: randomUUID(),
      questionCount: 1,
    });
    assert.equal(blocked.status, 403);
    assert.match(blocked.data.error, /lifetime/i);
    const status = await call('free', '/platform/plan-status');
    assert.equal(status.data.plan, 'free');
    assert.equal(status.data.usage.lifetimeStartedExams, 2);
  });
  await t.test('Pro monthly exam limit is enforced at exactly 250 starts', async () => {
    const now = new Date().toISOString();
    await db
      .prepare(`INSERT INTO test_registry(user_id,test_id,question_count,started_at)
        SELECT 'pro-limit','pro-limit-'||value,1,? FROM json_each(?)`)
      .bind(now, JSON.stringify(Array.from({ length: 249 }, (_, index) => index)))
      .run();
    assert.equal(
      (
        await call('pro-limit', '/platform/exam-start', {
          testId: randomUUID(),
          questionCount: 200,
        })
      ).status,
      201,
    );
    const blocked = await call('pro-limit', '/platform/exam-start', {
      testId: randomUUID(),
      questionCount: 1,
    });
    assert.equal(blocked.status, 403);
    assert.match(blocked.data.error, /monthly/i);
  });
  await t.test('Free redemption is atomic and idempotent', async () => {
    codeId = randomUUID();
    assert.equal(
      (
        await call('admin', '/platform/discounts', {
          id: codeId,
          code: 'FREE',
          kind: 'percent',
          amount: 100,
          enabled: true,
          max_uses: 1,
          per_user: 1,
        })
      ).status,
      200,
    );
    const quote = await call('lite', '/platform/quote', { code: 'FREE' });
    assert.equal(quote.data.final, 0);
    const requestId = randomUUID();
    const first = await call('lite', '/platform/checkout', {
      code: 'FREE',
      requestId,
    });
    assert.equal(first.data.upgraded, true, JSON.stringify(first));
    assert.equal(
      (await call('lite', '/platform/checkout', { code: 'FREE', requestId }))
        .data.upgraded,
      true,
    );
    assert.equal(
      (await call('other', '/platform/quote', { code: 'FREE' })).status,
      400,
    );
    assert.equal((await call('lite', '/auth/session')).data.user.tier, 'pro');
  });
  await t.test(
    'Credit rewards are atomic, activate separately, and fall back to the paid plan',
    async () => {
      const adjustment = await call('admin', '/platform/economy-admin', {
        operation: 'adjust-credits',
        userId: 'lite',
        amount: 700,
        reason: 'Reward integration fixture',
        requestId: randomUUID(),
      });
      assert.equal(adjustment.status, 200, JSON.stringify(adjustment));
      assert.equal(
        (await call('lite', '/platform/contributions')).data.creditsBalance,
        700,
      );
      const requestId = randomUUID();
      const redemption = await call('lite', '/platform/rewards', {
        operation: 'redeem',
        rewardId: 'unlimited-month',
        requestId,
      });
      assert.equal(redemption.status, 201, JSON.stringify(redemption));
      const repeated = await call('lite', '/platform/rewards', {
        operation: 'redeem',
        rewardId: 'unlimited-month',
        requestId,
      });
      assert.equal(repeated.status, 200);
      assert.equal(repeated.data.duplicate, true);
      assert.equal(
        (await call('lite', '/platform/contributions')).data.creditsBalance,
        0,
      );
      const activation = await call('lite', '/platform/rewards', {
        operation: 'activate',
        passId: redemption.data.pass.id,
      });
      assert.equal(activation.status, 200, JSON.stringify(activation));
      assert.equal(activation.data.effectivePlan, 'unlimited');
      const paid = await db
        .prepare('SELECT plan,status FROM subscriptions WHERE user_id=?')
        .bind('lite')
        .first();
      assert.deepEqual(paid, { plan: 'pro', status: 'active' });
      await db
        .prepare("UPDATE reward_passes SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
        .bind(redemption.data.pass.id)
        .run();
      assert.equal((await call('lite', '/auth/session')).data.user.tier, 'pro');
      assert.deepEqual(
        await db
          .prepare('SELECT plan,status FROM subscriptions WHERE user_id=?')
          .bind('lite')
          .first(),
        paid,
      );
    },
  );
  await t.test(
    'Paid subscription prepares WhatsApp without upgrading',
    async () => {
      const r = await call('other', '/platform/checkout', {
        code: '',
        requestId: randomUUID(),
      });
      assert.equal(r.status, 200);
      assert.match(r.data.url, /wa\.me\/966537043984/);
      assert.equal(
        (await call('other', '/auth/session')).data.user.tier,
        'lite',
      );
    },
  );
  await t.test(
    'Lite limits are enforced and previous saved state remains intact',
    async () => {
      const state = {
        version: 1,
        tests: [],
        progress: {},
        reports: [],
        revisions: [],
        customQuestions: [],
        questionOverrides: {},
        settings: {},
      };
      const make = (id, count) => ({
        id,
        questionIds: Array(count).fill('gs-001'),
        currentIndex: 0,
        answers: {},
        revealed: [],
        graded: [],
      });
      assert.equal(
        (
          await call(
            'other',
            '/state',
            { state: { ...state, tests: [make('oversized', 51)] } },
            'PUT',
          )
        ).status,
        403,
      );
      for (let i = 0; i < 30; i++) {
        state.tests.push(make(`test-${i}`, 30));
      }
      assert.equal((await call('other', '/state', { state }, 'PUT')).status, 200);
      const duplicateTitles = {
        ...state,
        tests: [
          { ...make('named-1', 1), title: 'Surgery   1' },
          { ...make('named-2', 1), title: ' surgery 1 ' },
        ],
      };
      assert.equal(
        (await call('lite', '/state', { state: duplicateTitles }, 'PUT'))
          .status,
        409,
      );
      const denied = await call(
        'other',
        '/state',
        { state: { ...state, tests: [...state.tests, make('thirty-first', 1)] } },
        'PUT',
      );
      assert.equal(denied.status, 403, JSON.stringify(denied));
      assert.equal((await call('other', '/state')).data.state.tests.length, 30);
      await call('other', '/state', { state: { ...state, tests: [] } }, 'PUT');
      assert.equal(
        (
          await call(
            'other',
            '/state',
            { state: { ...state, tests: [make('after-delete', 1)] } },
            'PUT',
          )
        ).status,
        403,
      );
      await db
        .prepare("UPDATE test_registry SET started_at='2000-01-01T00:00:00.000Z' WHERE user_id='other'")
        .run();
      assert.equal(
        (
          await call('other', '/platform/exam-start', {
            testId: randomUUID(),
            questionCount: 50,
          })
        ).status,
        201,
      );
    },
  );
  await t.test(
    'Flashcards remain private and malformed decks or review data are rejected',
    async () => {
      const now = new Date().toISOString();
      const deck = {
        id: 'deck-one',
        name: 'Surgery',
        qbankId: 'smle-gs',
        color: '#5b5bd6',
        createdAt: now,
        updatedAt: now,
      };
      const card = {
        id: 'card-one',
        deckId: deck.id,
        qbankId: 'smle-gs',
        type: 'basic',
        front: 'Question',
        back: 'Answer',
        tags: ['High Yield'],
        importedGuid: 'anki-guid:0',
        createdAt: now,
        updatedAt: now,
      };
      const state = {
        version: 1,
        tests: [],
        progress: {},
        reports: [],
        revisions: [],
        customQuestions: [],
        questionOverrides: {},
        settings: {},
        flashcardDecks: [deck],
        flashcards: [card],
        flashcardSchedules: {},
        flashcardReviewLog: [],
        flashcardSettings: {
          desiredRetention: 0.9,
          dailyNewLimit: 20,
          dailyReviewLimit: 200,
        },
      };
      assert.equal(
        (await call('reviewer', '/state', { state }, 'PUT')).status,
        200,
      );
      assert.equal(
        (await call('reviewer', '/state')).data.state.flashcards.length,
        1,
      );
      assert.equal(
        (await call('lite', '/state')).data.state?.flashcards?.length ?? 0,
        0,
      );
      assert.equal(
        (
          await call(
            'reviewer',
            '/state',
            {
              state: {
                ...state,
                flashcards: [{ ...card, deckId: 'missing' }],
              },
            },
            'PUT',
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            'reviewer',
            '/state',
            {
              state: {
                ...state,
                flashcards: [card, { ...card, id: 'card-two' }],
              },
            },
            'PUT',
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await call(
            'reviewer',
            '/state',
            {
              state: {
                ...state,
                flashcardSchedules: {
                  [card.id]: {
                    cardId: card.id,
                    due: 'not-a-date',
                    state: 'review',
                  },
                },
              },
            },
            'PUT',
          )
        ).status,
        400,
      );
    },
  );
  await t.test(
    'Live channels authenticate subscriptions and deliver saved changes to both sessions',
    async () => {
      const connect = (uid, channel, origin = 'https://qraft.test') =>
        mf.dispatchFetch(
          `https://qraft.test/api/cloudflare/realtime?channel=${encodeURIComponent(channel)}`,
          {
            headers: {
              Upgrade: 'websocket',
              origin,
              cookie: `__Host-qraft_session=fixture-${uid}`,
            },
          },
        );
      assert.equal((await connect('other', 'admin')).status, 403);
      assert.equal((await connect('other', 'user:lite')).status, 403);
      assert.equal((await connect('other', 'bank:missing')).status, 403);
      assert.equal(
        (await connect('other', 'user:other', 'https://evil.test')).status,
        403,
      );
      const first = await connect('other', 'user:other');
      const second = await connect('other', 'user:other');
      assert.equal(first.status, 101);
      assert.equal(second.status, 101);
      first.webSocket.accept();
      second.webSocket.accept();
      const receive = (socket) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('No live update received')),
            3000,
          );
          socket.addEventListener(
            'message',
            (event) => {
              clearTimeout(timeout);
              resolve(JSON.parse(event.data));
            },
            { once: true },
          );
        });
      const received = Promise.all([
        receive(first.webSocket),
        receive(second.webSocket),
      ]);
      const saved = await call('other', '/contact', {
        title: 'Live fixture',
        body: 'Saved before notifying',
        requestId: randomUUID(),
      });
      assert.equal(saved.status, 200);
      assert.deepEqual(await received, [
        { type: 'changed', topic: 'contact' },
        { type: 'changed', topic: 'contact' },
      ]);
      assert.equal(
        (await call('other', `/contact?id=${saved.data.id}`)).data.messages[0]
          .body,
        'Saved before notifying',
      );
      first.webSocket.close();
      second.webSocket.close();
    },
  );
  await t.test(
    'Question import validates fields and retries do not duplicate proposals',
    async () => {
      const payload = {
        stem: 'Fixture question',
        options: ['A', 'B'],
        answer: 0,
        specialty: 'General',
        topic: 'Topic',
        explanation: 'Fixture explanation',
        sourceFile: 'Fixture.pdf',
        sourcePage: 12,
        sourceReference: 'This long source is ignored',
        images: [],
      };
      const invalidFileHash = createHash('sha256')
        .update('invalid-import')
        .digest('hex');
      assert.equal(
        (
          await call('pro', '/platform/import', {
            qbankId: 'smle-gs',
            requestId: randomUUID(),
            fileName: 'invalid.json',
            fileHash: invalidFileHash,
            questions: [{ ...payload, options: [{}, 'B'] }],
          })
        ).status,
        400,
      );
      const request = {
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        fileName: 'fixture.json',
        fileHash: createHash('sha256').update('fixture-import').digest('hex'),
        questions: [payload],
      };
      const first = await call('pro', '/platform/import', request);
      assert.equal(first.status, 200, JSON.stringify(first));
      assert.equal(first.data.successful, 1);
      assert.equal(
        first.data.proposals[0].payload.sourceReference,
        'Fixture.pdf - p.12',
      );
      assert.equal(
        (await call('pro', '/platform/import', request)).data.proposals[0].id,
        first.data.proposals[0].id,
      );
      const partial = await call('pro', '/platform/import', {
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        fileName: 'gemini-output.txt',
        fileHash: createHash('sha256').update('gemini-output').digest('hex'),
        questions:
          '```json\n{sourceFile:"Scan.pdf",questions:[{stem:"Valid",options:["Yes","No",],correctAnswer:"A",sourcePage:4,},{stem:"Broken",options:["Only one"],correctAnswer:"A",sourcePage:5,}],}\n```',
      });
      assert.equal(partial.status, 200, JSON.stringify(partial));
      assert.equal(partial.data.successful, 1);
      assert.equal(partial.data.failed, 1);
      assert.equal(partial.data.repaired, true);
      assert.equal(partial.data.skipped[0].page, 5);
      assert.equal(
        partial.data.proposals[0].payload.sourceReference,
        'Scan.pdf - p.4',
      );
      const duplicateName = await call('pro', '/platform/import', {
        ...request,
        requestId: randomUUID(),
        fileHash: createHash('sha256').update('different').digest('hex'),
      });
      assert.equal(duplicateName.status, 409);
      const duplicateHash = await call('pro', '/platform/import', {
        ...request,
        requestId: randomUUID(),
        fileName: 'renamed.json',
      });
      assert.equal(duplicateHash.status, 409);
      const dailyPayload = (index) => ({
        ...payload,
        stem: `Daily limit fixture ${index} with distinct clinical wording`,
        topic: 'Daily import quota',
      });
      const third = await call('pro', '/platform/import', {
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        fileName: 'daily-third.json',
        fileHash: createHash('sha256').update('daily-third').digest('hex'),
        questions: [dailyPayload(3)],
      });
      assert.equal(third.status, 200, JSON.stringify(third));
      const fourth = await call('pro', '/platform/import', {
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        fileName: 'daily-fourth.json',
        fileHash: createHash('sha256').update('daily-fourth').digest('hex'),
        questions: [dailyPayload(4)],
      });
      assert.equal(fourth.status, 403);
      assert.match(fourth.data.error, /daily JSON import limit/i);
    },
  );
  await t.test(
    'Pending queue and JSON-only suspensions cannot be bypassed through the import API',
    async () => {
      const now = new Date().toISOString();
      await db
        .prepare(`INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at)
          SELECT 'questionProposals','pending-limit-'||value,'smle-gs','pro-pending',
            json_object(
              'id','pending-limit-'||value,
              'status','pending',
              'payload',json_object('stem','Existing pending '||value,'options',json_array('Yes','No'))
            ),?
          FROM json_each(?)`)
        .bind(now, JSON.stringify(Array.from({ length: 300 }, (_, index) => index)))
        .run();
      const request = (suffix) => ({
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        fileName: `${suffix}.json`,
        fileHash: createHash('sha256').update(suffix).digest('hex'),
        questions: [
          {
            stem: `Pending and suspension fixture ${suffix}`,
            options: ['Yes', 'No'],
            answer: 0,
            specialty: 'General',
            topic: 'Import protection',
            explanation: 'Fixture explanation',
            sourceFile: 'Fixture.pdf',
            sourcePage: 1,
            sourceReference: 'Fixture.pdf - p.1',
            images: [],
          },
        ],
      });
      const queueBlocked = await call(
        'pro-pending',
        '/platform/import',
        request('pending-full'),
      );
      assert.equal(queueBlocked.status, 403);
      assert.match(queueBlocked.data.error, /submission queue is full/i);
      await db
        .prepare("DELETE FROM records WHERE type='questionProposals' AND owner_id='pro-pending'")
        .run();
      const suspended = await call('admin', '/platform/economy-admin', {
        operation: 'suspend-json',
        userId: 'pro-pending',
        reason: 'Import suspension integration fixture',
        days: 7,
      });
      assert.equal(suspended.status, 200);
      const suspensionBlocked = await call(
        'pro-pending',
        '/platform/import',
        request('suspended-import'),
      );
      assert.equal(suspensionBlocked.status, 403);
      assert.match(suspensionBlocked.data.error, /suspended until/i);
      assert.equal(
        (await call('pro-pending', '/platform/exam-start', {
          testId: randomUUID(),
          questionCount: 10,
        })).status,
        201,
      );
    },
  );
  await t.test(
    'High-risk corrections require two independent reviewers before credits are awarded',
    async () => {
      const existingRow = await db
        .prepare("SELECT id,payload FROM records WHERE type='sharedQuestions' AND qbank_id='smle-gs' LIMIT 1")
        .first();
      const existing = JSON.parse(existingRow.payload);
      const proposalId = `high-risk-${randomUUID()}`;
      const proposedAt = new Date().toISOString();
      const changedAnswer = existing.answer === 0 ? 1 : 0;
      const proposal = {
        id: proposalId,
        qbankId: 'smle-gs',
        type: 'question_edit',
        editKinds: ['correct_answer'],
        questionId: existingRow.id,
        payload: {
          stem: existing.stem,
          options: existing.options,
          answer: changedAnswer,
          specialty: existing.specialty,
          topic: existing.topic,
          explanation: existing.explanation,
          sourceReference: existing.sourceReference || 'Verified source',
          sourceFile: existing.sourceFile,
          sourcePage: existing.sourcePage,
          images: existing.images || [],
        },
        rationale: 'Correct answer verified against the cited source.',
        submissionMethod: 'manual',
        status: 'pending',
        proposedById: 'other',
        proposedByName: 'other',
        proposedAt,
      };
      await db
        .prepare("INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES('questionProposals',?,?,?,?,?)")
        .bind(proposalId, 'smle-gs', 'other', JSON.stringify(proposal), proposedAt)
        .run();

      const first = await call('reviewer', '/platform/bulk-review', {
        proposalIds: [proposalId],
        status: 'approved',
      });
      assert.deepEqual(first, {
        status: 200,
        data: { ok: true, reviewed: 0, awaitingSecondReview: 1 },
      });
      assert.equal(
        JSON.parse(
          (
            await db
              .prepare("SELECT payload FROM records WHERE type='questionProposals' AND id=?")
              .bind(proposalId)
              .first()
          ).payload,
        ).status,
        'pending',
      );
      assert.equal(
        (
          await db
            .prepare("SELECT count(*) AS value FROM credit_transactions WHERE reference_id=?")
            .bind(proposalId)
            .first()
        ).value,
        0,
      );

      const second = await call('reviewer2', '/platform/bulk-review', {
        proposalIds: [proposalId],
        status: 'approved',
      });
      assert.deepEqual(second, {
        status: 200,
        data: { ok: true, reviewed: 1, awaitingSecondReview: 0 },
      });
      const reviews = await db
        .prepare('SELECT reviewer_id FROM contribution_reviews WHERE proposal_id=? ORDER BY reviewer_id')
        .bind(proposalId)
        .all();
      assert.deepEqual(
        reviews.results.map((review) => review.reviewer_id),
        ['reviewer', 'reviewer2'],
      );
      const reward = await db
        .prepare('SELECT amount,lifetime_delta FROM credit_transactions WHERE reference_id=?')
        .bind(proposalId)
        .first();
      assert.deepEqual(reward, { amount: 15, lifetime_delta: 15 });
    },
  );
  await t.test(
    'Bulk review approves or rejects up to 200 selected proposals atomically',
    async () => {
      const payload = (index) => ({
        stem: `Bulk fixture ${index}`,
        options: ['Correct', 'Incorrect'],
        answer: 0,
        specialty: 'General',
        topic: 'Bulk review',
        explanation: `Explanation ${index}`,
        sourceFile: 'Bulk.pdf',
        sourcePage: index,
        sourceReference: `Source ${index}`,
        images: [],
      });
      const imported = await call('unlimited', '/platform/import', {
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        fileName: 'bulk-150.json',
        fileHash: createHash('sha256').update('bulk-150').digest('hex'),
        questions: Array.from({ length: 150 }, (_, index) =>
          payload(index + 1),
        ),
      });
      assert.equal(imported.status, 200, JSON.stringify(imported));
      assert.equal(
        imported.data.proposals.every(
          (proposal) =>
            proposal.submissionMethod === 'json' && proposal.importBatchId,
        ),
        true,
      );
      assert.equal(imported.data.proposals.length, 150);
      const approved = imported.data.proposals;
      const approval = await call('reviewer', '/platform/bulk-review', {
        proposalIds: approved.map((proposal) => proposal.id),
        status: 'approved',
      });
      assert.deepEqual(approval, {
        status: 200,
        data: { ok: true, reviewed: 150, awaitingSecondReview: 0 },
      });
      const rejectedImport = await call('unlimited', '/platform/import', {
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        fileName: 'bulk-rejected.json',
        fileHash: createHash('sha256').update('bulk-rejected').digest('hex'),
        questions: [payload(151)],
      });
      const [rejected] = rejectedImport.data.proposals;
      const rejection = await call('reviewer', '/platform/bulk-review', {
        proposalIds: [rejected.id],
        status: 'rejected',
      });
      assert.equal(rejection.status, 200);
      const stored = await db
        .prepare(
          "SELECT payload FROM records WHERE type='questionProposals' AND json_extract(payload,'$.payload.topic')='Bulk review'",
        )
        .all();
      const reviewed = stored.results.map((row) => JSON.parse(row.payload));
      assert.equal(
        reviewed.filter(
          (proposal) =>
            proposal.status === 'approved' &&
            proposal.reviewedById === 'reviewer',
        ).length,
        150,
      );
      assert.equal(
        reviewed.filter(
          (proposal) =>
            proposal.status === 'rejected' &&
            proposal.reviewedById === 'reviewer',
        ).length,
        1,
      );
      const published = await db
        .prepare(
          "SELECT count(*) AS count FROM records WHERE type='sharedQuestions' AND json_extract(payload,'$.topic')='Bulk review'",
        )
        .first();
      assert.equal(published.count, 150);
      assert.equal(
        (
          await call('reviewer', '/platform/bulk-review', {
            proposalIds: [approved[0].id],
            status: 'approved',
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call('other', '/platform/bulk-review', {
            proposalIds: [approved[0].id],
            status: 'rejected',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call('reviewer', '/platform/bulk-review', {
            proposalIds: Array(201).fill('x'),
            status: 'approved',
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    'Answer statistics preserve other users and accept option indexes',
    async () => {
      const row = await db
        .prepare(
          "SELECT payload FROM records WHERE type='sharedQuestions' AND json_extract(payload,'$.questionId')='00002'",
        )
        .first();
      const question = JSON.parse(row.payload);
      const id = `stat-${question.id}`;
      const save = (uid, selections) =>
        call(
          uid,
          '/collaboration',
          {
            operations: [
              {
                collection: 'answerStats',
                type: 'set',
                id,
                value: {
                  id,
                  qbankId: 'smle-gs',
                  questionId: question.id,
                  selections,
                },
              },
            ],
          },
          'PUT',
        );
      assert.equal((await save('lite', { lite: 0 })).status, 200);
      assert.equal((await save('other', { lite: 0, other: 1 })).status, 200);
      assert.equal((await save('lite', { lite: 2, other: 1 })).status, 200);
      assert.equal((await save('lite', { lite: 1, other: 2 })).status, 403);
      assert.equal((await save('lite', { lite: 99, other: 1 })).status, 403);
    },
  );
  await t.test(
    'Tickets are private, support clarification, and survive deleted/reused question IDs',
    async () => {
      const r = await call('other', '/contact', {
        title: 'Question issue',
        body: 'Keep my description',
        questionId: '00001',
        requestId: randomUUID(),
      });
      assert.equal(r.status, 200, JSON.stringify(r));
      const id = r.data.id;
      assert.equal((await call('lite', `/contact?id=${id}`)).status, 404);
      assert.equal(
        (
          await call('other', '/contact', {
            id,
            body: 'Reply before request',
            requestId: randomUUID(),
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call('admin', '/contact', {
            id,
            operation: 'status',
            status: 'in_progress',
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await call('other', '/contact', {
            id,
            body: 'Clarification',
            requestId: randomUUID(),
          })
        ).status,
        200,
      );
      assert.equal(
        (await call('other', '/platform/question', { id: '00001' }, 'DELETE'))
          .status,
        403,
      );
      const removed = await call(
        'admin',
        '/platform/question',
        { id: '00001' },
        'DELETE',
      );
      assert.equal(removed.status, 200, JSON.stringify(removed));
      assert.equal(
        (await call('other', '/platform/question?id=00001')).status,
        404,
      );
      const ticket = (await call('other', '/contact')).data.tickets.find(
        (t) => t.id === id,
      );
      assert.equal(ticket.question_id, 'deleted');
      const reserved = await call('admin', '/ids/reserve', {
        qbankId: 'smle-gs',
        count: 1,
      });
      assert.equal(reserved.data.ids[0], '00001');
      assert.equal(
        (await call('other', `/contact?id=${id}`)).data.messages[0].body,
        'Keep my description',
      );
      assert.equal(
        (
          await call('admin', '/contact', {
            id,
            operation: 'status',
            status: 'resolved',
          })
        ).status,
        200,
      );
      const reportReward = await db
        .prepare("SELECT amount,lifetime_delta FROM credit_transactions WHERE reference_type='ticket' AND reference_id=?")
        .bind(id)
        .first();
      assert.deepEqual(reportReward, { amount: 3, lifetime_delta: 3 });
    },
  );
  await t.test(
    'Reviewer search requires bank management and adds a membership',
    async () => {
      assert.equal(
        (await call('other', '/platform/reviewers?bank=smle-gs&search=rev'))
          .status,
        403,
      );
      const matches = await call(
        'admin',
        '/platform/reviewers?bank=smle-gs&search=rev',
      );
      assert.ok(matches.data.users.some((match) => match.uid === 'reviewer'));
      assert.equal(
        (
          await call('admin', '/platform/reviewers', {
            bankId: 'smle-gs',
            userId: 'reviewer',
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await call('admin', '/platform/reviewers', {
            bankId: 'smle-gs',
            userId: 'reviewer',
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    'Tickets reject new images and deletion is restricted to owner or Superadmin',
    async () => {
      const draft = {
        title: 'Delete fixture',
        body: 'Text complaint',
        requestId: randomUUID(),
      };
      assert.equal(
        (
          await call('other', '/contact', {
            ...draft,
            attachment: 'data:image/png;base64,aGVsbG8=',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS total FROM ticket_messages WHERE id=?')
            .bind(draft.requestId)
            .first()
        ).total,
        0,
      );
      const created = await call('other', '/contact', draft);
      assert.equal(created.status, 200);
      const id = created.data.id;
      assert.equal(
        (await call('lite', '/contact', { id }, 'DELETE')).status,
        404,
      );
      assert.equal((await call('other', `/contact?id=${id}`)).status, 200);
      assert.equal(
        (await call('other', '/contact', { id }, 'DELETE')).status,
        200,
      );
      assert.equal((await call('other', `/contact?id=${id}`)).status, 404);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS total FROM ticket_messages WHERE ticket_id=?',
            )
            .bind(id)
            .first()
        ).total,
        0,
      );
      const second = await call('other', '/contact', {
        ...draft,
        requestId: randomUUID(),
      });
      assert.equal(
        (await call('admin', '/contact', { id: second.data.id }, 'DELETE'))
          .status,
        200,
      );
      const audit = await db
        .prepare(
          "SELECT count(*) AS total FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='ticket_deleted'",
        )
        .first();
      assert.equal(audit.total, 2);
    },
  );
  await t.test('Expired Pro becomes Lite and expiry is audited', async () => {
    await db
      .prepare(
        "UPDATE subscriptions SET expires_at='2020-01-01' WHERE user_id='lite'",
      )
      .run();
    assert.equal((await call('lite', '/auth/session')).data.user.tier, 'lite');
    assert.equal(
      (
        await db
          .prepare(
            "SELECT count(*) AS n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='subscription_expired'",
          )
          .first()
      ).n,
      1,
    );
  });
});
