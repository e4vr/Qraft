import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preproductionApiTests } from './preproduction-api.mjs';
import { createHash, createHmac, pbkdf2Sync, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { improvementsApiTests } from './improvements-api.mjs';
import { saasApiTests } from './saas-api.mjs';
import { directQuestionEditApiTests } from './direct-question-edit-api.mjs';
import { serverEfficiencyApiTests } from './server-efficiency-api.mjs';
import { qbankLifecycleApiTests } from './qbank-lifecycle-api.mjs';
import { exactImportSkipApiTests } from './exact-import-skip-api.mjs';
import { sharedNoteImageApiTests } from './shared-note-images-api.mjs';
import { announcementApiTests } from './announcement-api.mjs';
import { contributionEconomyApiTests } from './contribution-economy-api.mjs';
import { collaborationConflictApiTests } from './collaboration-conflicts-api.mjs';

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replace(/=+$/g, '').toUpperCase())
    bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  return bytes;
}

function currentTotp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const signature = createHmac('sha1', decodeBase32(secret))
    .update(counter)
    .digest();
  const offset = signature.at(-1) & 0x0f;
  const number =
    ((signature[offset] & 0x7f) << 24) |
    (signature[offset + 1] << 16) |
    (signature[offset + 2] << 8) |
    signature[offset + 3];
  return String(number % 1_000_000).padStart(6, '0');
}

void test('platform API authorization, import, subscription and ticket workflows', async (t) => {
  await mkdir('.ui-review', { recursive: true });
  await build({
    stdin: {
      contents: `export {RealtimeChannel} from './workers/realtime.ts'; import {GET,POST,PUT,DELETE} from './app/api/cloudflare/[...path]/route.ts'; import {expireSubscriptions} from './lib/platform-server.ts'; export default {fetch(request){return ({GET,POST,PUT,DELETE})[request.method](request)},scheduled(){return expireSubscriptions()}}`,
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
      BACKUP_SIGNING_KEY: 'phase-4-local-test-backup-signing-key-only',
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
  const assets = await mf.getR2Bucket('ASSETS', built ? 'app' : undefined);
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
    'trial',
    'other',
    'monthly',
    'monthly-limit',
    'monthly-pending',
    'quarterly',
    'moderator',
    'reviewer',
    'reviewer2',
    'editor',
    'access',
    'manual-member',
    'paid-member',
    'discount-member',
    'override-member',
  ]) {
    const profile = {
      uid,
      email: `${uid}@example.test`,
      displayName: uid,
      tier:
        uid === 'free'
          ? 'free'
          : uid === 'monthly' || uid === 'monthly-limit' || uid === 'monthly-pending'
            ? 'full_monthly'
            : uid === 'quarterly'
              ? 'full_quarterly'
              : 'free',
      status: 'approved',
      role: uid === 'admin' ? 'super_admin' : 'student',
      platformRoles:
        uid === 'moderator'
          ? ['moderator']
          : uid === 'reviewer' || uid === 'reviewer2'
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
  const call = async (uid, path, body, method = body ? 'POST' : 'GET', { withBaseValues = true } = {}) => {
    // Model the snapshot carried by current clients. Security/concurrency tests
    // can opt out to exercise missing or explicitly stale preconditions.
    if (withBaseValues && path === '/collaboration' && method === 'PUT' && body?.operations?.some(op => op.collection !== 'answerStats' && !Object.hasOwn(op, 'baseValue'))) {
      const response = await call(uid, '/collaboration');
      const state = response.data.collaboration;
      if (state) {
        const fields = { qbanks: 'qbanks', qbankFolders: 'qbankFolders', qbankMemberships: 'memberships', qbankInvitations: 'invitations', profiles: 'members', universityIds: 'allowedUniversityIds', adminInvites: 'adminInvites', questionProposals: 'proposals', roleApplications: 'roleApplications', sharedQuestions: 'approvedQuestions', qbankSpecialties: 'specialties', qbankTopics: 'topics' };
        body = { ...body, operations: body.operations.map(op => {
          if (Object.hasOwn(op, 'baseValue') || op.collection === 'answerStats') return op;
          const value = op.collection === 'system' ? (op.id === 'accessControl' ? state.blockedAccess : state.security)
            : op.collection === 'sharedNotes' ? state.sharedNotes[op.id]
            : state[fields[op.collection]]?.find(item => item.id === op.id || item.uid === op.id);
          return { ...op, baseValue: value ?? null };
        }) };
      }
    }
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
  const emptyState = (changes = {}) => ({
    version: 1,
    tests: [],
    progress: {},
    reports: [],
    revisions: [],
    customQuestions: [],
    questionOverrides: {},
    flashcardDecks: [],
    flashcards: [],
    flashcardSchedules: {},
    flashcardReviewLog: [],
    flashcardSettings: {
      desiredRetention: 0.9,
      dailyNewLimit: 20,
      dailyReviewLimit: 200,
    },
    settings: { dailyGoal: 20, theme: 'system', autoSync: true },
    studyStreak: { current: 0, best: 0, lastActivityDate: '' },
    ...changes,
  });
  const uploadImage = async (
    uid,
    name = 'scan.png',
    content = 'png-test-content',
    kind = 'notes',
    qbankId = 'smle-gs',
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
    body.append('qbankId', qbankId);
    body.append('questionId', 'gs-001');
    const encoded = new Request('https://qraft.test/upload-body', {
      method: 'POST',
      body,
    });
    return mf.dispatchFetch(`https://qraft.test/api/cloudflare/media/${kind}`, {
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
  await saasApiTests(t, { db, call, mf, emptyState });
  await collaborationConflictApiTests(t, { db, call });
  await t.test(
    'Superadmin plan assignments override every entitlement, including Free, and preserve billing and gifts',
    async () => {
      const uid = 'override-member',
        now = new Date().toISOString(),
        future = new Date(Date.now() + 86400000 * 365).toISOString();
      await db
        .prepare(
          "UPDATE profiles SET profile_json=json_set(profile_json,'$.tier','full_quarterly') WHERE uid=?",
        )
        .bind(uid)
        .run();
      await db
        .prepare(
          "INSERT INTO subscriptions(user_id,status,method,paid,updated_at,plan,expires_at) VALUES(?,'active','manual',9900,?,'full_quarterly',?)",
        )
        .bind(uid, now, future)
        .run();
      await db
        .prepare(
          "INSERT INTO reward_passes(id,user_id,plan,duration,duration_unit,status,created_at,expires_at,source) VALUES('override-gift',?,'full_quarterly',1,'year','active',?,?,'admin')",
        )
        .bind(uid, now, future)
        .run();
      await db
        .prepare(
          "INSERT INTO admin_plan_entitlements(id,user_id,plan,reason,granted_by,created_at) VALUES('override-old-admin',?,'full_quarterly','test','admin',?)",
        )
        .bind(uid, now)
        .run();
      for (const role of ['free', 'moderator', 'access'])
        assert.equal(
          (
            await call(role, '/platform/subscriptions', {
              operation: 'override',
              userId: uid,
              plan: 'free',
            })
          ).status,
          403,
        );
      for (const plan of ['free', 'full_monthly', 'full_quarterly', 'free']) {
        const changed = await call('admin', '/platform/subscriptions', {
          operation: 'override',
          userId: uid,
          plan,
          expires_at: null,
          reason: 'Explicit admin assignment',
        });
        assert.equal(changed.status, 200, JSON.stringify(changed.data));
        assert.equal(changed.data.effectivePlan, plan);
        const session = await call(uid, '/auth/session');
        assert.equal(session.data.user.tier, plan);
        assert.equal(session.data.user.adminOverridePlan, plan);
        const listing = await call(
          'admin',
          `/platform/subscriptions?search=${uid}&status=${plan}`,
        );
        assert.equal(listing.data.subscriptions[0].tier, plan);
        assert.equal(listing.data.summary.total, 1);
        assert.equal(listing.data.subscriptions[0].override_plan, plan);
      }
      assert.equal(
        (
          await call('admin', '/platform/subscriptions', {
            operation: 'override',
            userId: uid,
            plan: 'invalid',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call('admin', '/platform/subscriptions', {
            operation: 'override',
            userId: uid,
            plan: 'full_monthly',
            expires_at: '2020-01-01',
          })
        ).status,
        400,
      );
      assert.equal((await call(uid, '/auth/session')).data.user.tier, 'free');
      // A gift activated after assignment must not bypass the assignment either.
      await db
        .prepare(
          "INSERT INTO reward_passes(id,user_id,plan,duration,duration_unit,status,created_at,source) VALUES('override-new-gift',?,'full_quarterly',1,'year','available',?,'admin')",
        )
        .bind(uid, now)
        .run();
      const gift = await call(uid, '/platform/rewards', {
        operation: 'activate',
        passId: 'override-new-gift',
      });
      assert.equal(gift.status, 200, JSON.stringify(gift.data));
      assert.equal((await call(uid, '/auth/session')).data.user.tier, 'free');
      const billing = await db
        .prepare('SELECT plan,paid FROM subscriptions WHERE user_id=?')
        .bind(uid)
        .first();
      assert.equal(billing.plan, 'full_quarterly');
      assert.equal(billing.paid, 9900);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT status FROM reward_passes WHERE id='override-gift'",
            )
            .first()
        ).status,
        'active',
      );
      const logged = await db
        .prepare(
          "SELECT count(*) AS n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='subscription_plan_overridden' AND json_extract(payload,'$.entityId')=?",
        )
        .bind(uid)
        .first();
      assert.equal(logged.n, 4);
      await db
        .prepare(
          "UPDATE account_plan_overrides SET expires_at='2020-01-01' WHERE user_id=?",
        )
        .bind(uid)
        .run();
      assert.equal(
        (await call(uid, '/auth/session')).data.user.tier,
        'full_quarterly',
      );
    },
  );

  await t.test(
    'Discount search and usage history use independent server pagination',
    async () => {
      const now = new Date().toISOString();
      await db.batch(
        Array.from({ length: 52 }, (_, i) =>
          db
            .prepare(
              'INSERT INTO discount_codes(id,code,kind,amount,enabled,max_uses,per_user,updated_at) VALUES(?,?,?,10,0,NULL,1,?)',
            )
            .bind(`table-qa-${i}`, `TABLE_QA_${i}`, 'percent', now),
        ),
      );
      const first = await call(
        'admin',
        '/platform/discounts?search=TABLE_QA_&status=disabled',
      );
      assert.equal(first.status, 200);
      assert.equal(first.data.summary.total, 52);
      assert.equal(first.data.codes.length, 51);
      const next = await call(
        'admin',
        '/platform/discounts?search=TABLE_QA_&status=disabled&offset=50',
      );
      assert.equal(next.data.codes.length, 2);
      const active = await call(
        'admin',
        '/platform/discounts?search=TABLE_QA_&status=active',
      );
      assert.equal(active.data.summary.total, 0);
      await db.batch(
        Array.from({ length: 52 }, (_, i) =>
          db
            .prepare(
              "INSERT INTO subscription_events(id,user_id,email,name,code_id,code,action,original,discount,final,status,created_at,detail) VALUES(?,?,?,?,?,?,'test',100,10,90,'success',?,'test')",
            )
            .bind(
              `table-event-${i}`,
              'override-member',
              'test@example.test',
              'Test member',
              'table-qa-0',
              'TABLE_QA_0',
              now,
            ),
        ),
      );
      const history = await call(
        'admin',
        '/platform/discounts?search=TABLE_QA_&offset=50&id=table-qa-0&usageOffset=0',
      );
      assert.equal(history.data.codes.length, 2);
      assert.equal(history.data.events.length, 51);
      const historyNext = await call(
        'admin',
        '/platform/discounts?search=TABLE_QA_&offset=0&id=table-qa-0&usageOffset=50',
      );
      assert.equal(historyNext.data.codes.length, 51);
      assert.equal(historyNext.data.events.length, 2);
      await db.batch([
        db.prepare(
          "DELETE FROM subscription_events WHERE id LIKE 'table-event-%'",
        ),
        db.prepare("DELETE FROM discount_codes WHERE id LIKE 'table-qa-%'"),
      ]);
    },
  );
  await t.test(
    'Subscription and coupon timestamps are compared and stored canonically',
    async () => {
      const couponId = randomUUID();
      const coupon = await call('admin', '/platform/discounts', {
        id: couponId,
        code: 'DATE_BOUNDARY',
        kind: 'percent',
        amount: 10,
        enabled: true,
        max_uses: null,
        per_user: null,
        starts_at: '2030-01-01T00:00:00+14:00',
        expires_at: '2029-12-31T12:00:00Z',
        allowedPlans: ['full_monthly'],
      });
      assert.equal(coupon.status, 200, JSON.stringify(coupon));
      const storedCoupon = await db
        .prepare('SELECT starts_at,expires_at FROM discount_codes WHERE id=?')
        .bind(couponId)
        .first();
      assert.deepEqual(storedCoupon, {
        starts_at: '2029-12-31T10:00:00.000Z',
        expires_at: '2029-12-31T12:00:00.000Z',
      });

      const subscription = await call('admin', '/platform/subscriptions', {
        operation: 'activate',
        userId: 'manual-member',
        plan: 'full_monthly',
        expires_at: 'Wed, 02 Jan 2030 00:00:00 GMT',
        paid: 5000,
      });
      assert.equal(subscription.status, 200, JSON.stringify(subscription));
      assert.equal(
        (
          await db
            .prepare('SELECT expires_at FROM subscriptions WHERE user_id=?')
            .bind('manual-member')
            .first()
        ).expires_at,
        '2030-01-02T00:00:00.000Z',
      );
      await db.batch([
        db.prepare('DELETE FROM discount_codes WHERE id=?').bind(couponId),
        db.prepare("DELETE FROM subscriptions WHERE user_id='manual-member'"),
      ]);
    },
  );

  await t.test('R2 uploads are private, hashed, and deduplicated', async () => {
    const first = await uploadImage('monthly');
    assert.equal(first.status, 201);
    const uploaded = await first.json();
    assert.match(uploaded.url, /^\/api\/cloudflare\/media\/notes\//);
    const duplicate = await uploadImage('monthly', 'renamed.png');
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);
    const asset = await mf.dispatchFetch(`https://qraft.test${uploaded.url}`, {
      headers: { cookie: '__Host-qraft_session=fixture-monthly' },
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
      (await uploadImage('monthly', 'storage-limit.png', 'different')).status,
      413,
    );
    await db
      .prepare("UPDATE counters SET value=? WHERE id='r2-storage-bytes'")
      .bind(storage.value)
      .run();
    assert.equal(
      (await uploadImage('monthly', 'new.png', 'different')).status,
      429,
    );
    assert.equal(
      (
        await mf.dispatchFetch(`https://qraft.test${uploaded.url}`, {
          headers: { cookie: '__Host-qraft_session=fixture-trial' },
        })
      ).status,
      429,
    );
    const rows = await db
      .prepare("SELECT provider,file_hash FROM media WHERE owner_id='monthly'")
      .all();
    assert.equal(rows.results.length, 1);
    assert.equal(rows.results[0].provider, 'r2');
    assert.match(rows.results[0].file_hash, /^[a-f0-9]{64}$/);
    const usage = await db.prepare('SELECT * FROM r2_usage_periods').first();
    assert.equal(usage.class_a_operations, 1);
    assert.equal(usage.class_b_operations, 1);
  });
  await sharedNoteImageApiTests(t, { db, call, mf, uploadImage });
  await announcementApiTests(t, { db, call, mf, uploadImage });
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
        .bind(passwordHash, salt, 'trial')
        .run();
      await db
        .prepare(
          'INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,1,?)',
        )
        .bind(
          createHash('sha256').update('another-trial-session').digest('hex'),
          'trial',
          Math.floor(Date.now() / 1000) + 3600,
          new Date().toISOString(),
        )
        .run();
      const updated = await call(
        'trial',
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
            .bind('trial')
            .first()
        ).profile_json,
      );
      assert.equal(stored.displayName, 'Updated Learner');
      assert.equal(
        (
          await call(
            'trial',
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
        'trial',
        '/auth/password',
        { currentPassword, newPassword: 'replacement-password-456' },
        'PUT',
      );
      assert.equal(changed.status, 200, JSON.stringify(changed));
      const account = await db
        .prepare('SELECT password_hash,password_salt FROM profiles WHERE uid=?')
        .bind('trial')
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
            .bind('trial')
            .first()
        ).count,
        1,
      );
    },
  );
  await t.test(
    'Access managers manage registration and access independently from subscriptions',
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
      assert.equal(
        suspendManual.status,
        200,
        JSON.stringify(suspendManual.data),
      );
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
          200,
        );
        assert.equal(
          (await save([profileOp(uid, { suspended: false })])).status,
          200,
        );
        assert.equal(
          (await save([profileOp(uid, { tier: 'full_monthly' })])).status,
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
            200,
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
      assert.equal((await call('trial', '/platform/discounts')).status, 403);
      assert.equal(
        (
          await call('trial', '/platform/subscriptions', {
            userId: 'trial',
            expires_at: '2099-01-01',
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    'Free exam allowance is lifetime-based and server enforced',
    async () => {
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
    },
  );
  await t.test(
    'Full Access has no monthly exam quota after 250 starts',
    async () => {
      const now = new Date().toISOString();
      await db
        .prepare(`INSERT INTO test_registry(user_id,test_id,question_count,started_at)
        SELECT 'monthly-limit','monthly-limit-'||value,1,? FROM json_each(?)`)
        .bind(
          now,
          JSON.stringify(Array.from({ length: 249 }, (_, index) => index)),
        )
        .run();
      assert.equal(
        (
          await call('monthly-limit', '/platform/exam-start', {
            testId: randomUUID(),
            questionCount: 200,
          })
        ).status,
        201,
      );
      const blocked = await call('monthly-limit', '/platform/exam-start', {
        testId: randomUUID(),
        questionCount: 1,
      });
      assert.equal(blocked.status, 201);
    },
  );
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
    const quote = await call('trial', '/platform/quote', { code: 'FREE' });
    assert.equal(quote.data.final, 0);
    const requestId = randomUUID();
    const first = await call('trial', '/platform/checkout', {
      code: 'FREE',
      requestId,
    });
    assert.equal(first.data.upgraded, true, JSON.stringify(first));
    assert.equal(
      (await call('trial', '/platform/checkout', { code: 'FREE', requestId }))
        .data.upgraded,
      true,
    );
    assert.equal(
      (await call('other', '/platform/quote', { code: 'FREE' })).status,
      400,
    );
    assert.equal((await call('trial', '/auth/session')).data.user.tier, 'full_monthly');
  });
  await t.test(
    'Credit rewards are atomic, activate separately, and fall back to the paid plan',
    async () => {
      const adjustment = await call('admin', '/platform/economy-admin', {
        operation: 'adjust-credits',
        userId: 'trial',
        amount: 850,
        reason: 'Reward integration fixture',
        requestId: randomUUID(),
      });
      assert.equal(adjustment.status, 200, JSON.stringify(adjustment));
      assert.equal(
        (await call('trial', '/platform/contributions')).data.creditsBalance,
        850,
      );
      const requestId = randomUUID();
      const redemption = await call('trial', '/platform/rewards', {
        operation: 'redeem',
        rewardId: 'full-access-quarter',
        requestId,
      });
      assert.equal(redemption.status, 201, JSON.stringify(redemption));
      const repeated = await call('trial', '/platform/rewards', {
        operation: 'redeem',
        rewardId: 'full-access-quarter',
        requestId,
      });
      assert.equal(repeated.status, 200);
      assert.equal(repeated.data.duplicate, true);
      assert.equal(
        (await call('trial', '/platform/contributions')).data.creditsBalance,
        0,
      );
      const activation = await call('trial', '/platform/rewards', {
        operation: 'activate',
        passId: redemption.data.pass.id,
      });
      assert.equal(activation.status, 200, JSON.stringify(activation));
      assert.equal(activation.data.effectivePlan, 'full_quarterly');
      const paid = await db
        .prepare('SELECT plan,status FROM subscriptions WHERE user_id=?')
        .bind('trial')
        .first();
      assert.deepEqual(paid, { plan: 'full_monthly', status: 'active' });
      await db
        .prepare(
          "UPDATE reward_passes SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
        )
        .bind(redemption.data.pass.id)
        .run();
      assert.equal((await call('trial', '/auth/session')).data.user.tier, 'full_monthly');
      assert.deepEqual(
        await db
          .prepare('SELECT plan,status FROM subscriptions WHERE user_id=?')
          .bind('trial')
          .first(),
        paid,
      );
    },
  );
  await t.test(
    'Paid subscription requires explicit agreement before preparing WhatsApp without upgrading',
    async () => {
      const before = await db.prepare('SELECT count(*) n FROM subscription_events WHERE user_id=?').bind('other').first();
      for (const plan of ['full_monthly', 'full_quarterly']) {
        for (const acceptedTerms of [undefined, false, 'true', 1]) {
          const rejected = await call('other', '/platform/checkout', { code: '', requestId: randomUUID(), plan, acceptedTerms });
          assert.equal(rejected.status, 400);
          assert.match(rejected.data.error, /agree.*terms/i);
          assert.equal(rejected.data.url, undefined);
        }
        const r = await call('other', '/platform/checkout', {
          code: '', requestId: randomUUID(), plan, acceptedTerms: true,
        });
        assert.equal(r.status, 200);
        assert.match(r.data.url, /wa\.me\/966537043984/);
      }
      assert.deepEqual(await db.prepare('SELECT count(*) n FROM subscription_events WHERE user_id=?').bind('other').first(), before);
      assert.equal(
        (await call('other', '/auth/session')).data.user.tier,
        'free',
      );
    },
  );
  await t.test(
    'Free trial limits are enforced and previous saved state remains intact',
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
        questionIds: Array.from(
          { length: count },
          (_, index) => `${id}-q-${index}`,
        ),
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
            { state: { ...state, tests: [make('oversized', 16)] } },
            'PUT',
          )
        ).status,
        403,
      );
      for (let i = 0; i < 2; i++) {
        state.tests.push(make(`test-${i}`, 15));
      }
      assert.equal(
        (await call('other', '/state', { state }, 'PUT')).status,
        200,
      );
      const duplicateTitles = {
        ...state,
        tests: [
          { ...make('named-1', 1), title: 'Surgery   1' },
          { ...make('named-2', 1), title: ' surgery 1 ' },
        ],
      };
      assert.equal(
        (await call('trial', '/state', { state: duplicateTitles }, 'PUT'))
          .status,
        409,
      );
      const denied = await call(
        'other',
        '/state',
        {
          state: { ...state, tests: [...state.tests, make('third-test', 1)] },
        },
        'PUT',
      );
      assert.equal(denied.status, 403, JSON.stringify(denied));
      assert.equal((await call('other', '/state')).data.state.tests.length, 2);
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
        .prepare(
          "UPDATE test_registry SET started_at='2000-01-01T00:00:00.000Z' WHERE user_id='other'",
        )
        .run();
      assert.equal(
        (
          await call('other', '/platform/exam-start', {
            testId: randomUUID(),
            questionCount: 15,
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    'Moderator, Reviewer, and Access Manager permissions do not change subscriptions',
    async () => {
      const moderator = (await call('moderator', '/auth/session')).data.user;
      const reviewer = (await call('reviewer', '/auth/session')).data.user;
      const accessManager = (await call('access', '/auth/session')).data.user;
      assert.equal(moderator.effectivePlan, 'free');
      assert.equal(reviewer.effectivePlan, 'free');
      assert.equal(accessManager.effectivePlan, 'free');
      assert.equal(moderator.isAdmin, true);
      assert.equal(reviewer.isAdmin, false);
      assert.equal(accessManager.isAdmin, true);
      const moderatorState = (await call('moderator', '/collaboration')).data
        .collaboration;
      assert.ok(moderatorState.members.length > 0);
      assert.equal(
        (await call('reviewer', '/collaboration')).data.collaboration.members
          .length,
        0,
      );
      const member = moderatorState.members.find(
        (item) => item.uid === 'manual-member',
      );
      const updateProfile = (value) =>
        call(
          'moderator',
          '/collaboration',
          {
            operations: [
              {
                collection: 'profiles',
                type: 'set',
                id: member.uid,
                value,
              },
            ],
          },
          'PUT',
        );
      assert.equal(
        (await updateProfile({ ...member, tier: 'full_monthly' })).status,
        403,
      );
      assert.equal(
        (
          await updateProfile({
            ...member,
            platformRoles: ['reviewer'],
          })
        ).status,
        200,
      );
      const savedMember = JSON.parse(
        (
          await db
            .prepare('SELECT profile_json FROM profiles WHERE uid=?')
            .bind(member.uid)
            .first()
        ).profile_json,
      );
      assert.equal(savedMember.tier, 'free');
      assert.deepEqual(savedMember.platformRoles, ['reviewer']);
    },
  );
  await t.test(
    'QBank editors can edit settings and questions while membership and deletion stay owner-only',
    async () => {
      const now = new Date().toISOString();
      const bank = {
        id: 'editor-bank',
        name: 'Editor fixture',
        shortName: 'EDITOR',
        description: 'Before editor update',
        createdAt: now,
        createdById: 'trial',
        createdByName: 'trial',
        archived: false,
        essential: false,
        ownerId: 'trial',
        ownerName: 'trial',
        visibility: 'private',
        shareEnabled: false,
        reviewerIds: [],
        viewerIds: ['other'],
      };
      const editorMembership = {
        id: 'editor-bank-editor',
        qbankId: bank.id,
        userId: 'editor',
        userName: 'editor',
        role: 'editor',
        grantedById: 'trial',
        grantedByName: 'trial',
        createdAt: now,
      };
      const viewerMembership = {
        id: 'editor-bank-viewer',
        qbankId: bank.id,
        userId: 'other',
        userName: 'other',
        role: 'viewer',
        grantedById: 'trial',
        grantedByName: 'trial',
        createdAt: now,
      };
      for (const [type, id, ownerId, value] of [
        ['qbanks', bank.id, 'trial', bank],
        ['qbankMemberships', editorMembership.id, 'editor', editorMembership],
        ['qbankMemberships', viewerMembership.id, 'other', viewerMembership],
      ]) {
        await db
          .prepare(
            'INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(?,?,?,?,?,?)',
          )
          .bind(type, id, bank.id, ownerId, JSON.stringify(value), now)
          .run();
      }

      const unrelatedReviewer = await call('reviewer', '/collaboration');
      assert.equal(unrelatedReviewer.status, 200);
      assert.equal(
        unrelatedReviewer.data.collaboration.qbanks.some(
          (item) => item.id === bank.id,
        ),
        false,
      );

      const reviewerMembership = {
        id: 'editor-bank-reviewer2',
        qbankId: bank.id,
        userId: 'reviewer2',
        userName: 'reviewer2',
        role: 'reviewer',
        grantedById: 'trial',
        grantedByName: 'trial',
        createdAt: now,
      };
      await db
        .prepare(
          'INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          'qbankMemberships',
          reviewerMembership.id,
          bank.id,
          reviewerMembership.userId,
          JSON.stringify(reviewerMembership),
          now,
        )
        .run();
      const assignedReviewer = await call('reviewer2', '/collaboration');
      assert.equal(assignedReviewer.status, 200);
      assert.equal(
        assignedReviewer.data.collaboration.qbanks.some(
          (item) => item.id === bank.id,
        ),
        true,
      );

      const invitation = {
        id: 'editor-bank-invite',
        qbankId: bank.id,
        email: 'manual-member@example.test',
        role: 'editor',
        invitedById: 'trial',
        invitedByName: 'trial',
        createdAt: now,
        status: 'pending',
      };
      assert.equal(
        (
          await call(
            'trial',
            '/collaboration',
            {
              operations: [
                {
                  collection: 'qbankInvitations',
                  id: invitation.id,
                  type: 'set',
                  value: invitation,
                },
              ],
            },
            'PUT',
          )
        ).status,
        200,
      );
      const receivedInvitation = await call('manual-member', '/collaboration');
      assert.equal(receivedInvitation.status, 200);
      assert.ok(
        receivedInvitation.data.collaboration.qbanks.some(
          (item) => item.id === bank.id,
        ),
      );
      assert.equal(
        receivedInvitation.data.collaboration.invitations.find(
          (item) => item.id === invitation.id,
        )?.role,
        'editor',
      );
      const acceptedAt = new Date().toISOString();
      assert.equal(
        (
          await call(
            'manual-member',
            '/collaboration',
            {
              operations: [
                {
                  collection: 'qbankInvitations',
                  id: invitation.id,
                  type: 'set',
                  value: {
                    ...invitation,
                    status: 'accepted',
                    acceptedById: 'manual-member',
                    acceptedAt,
                  },
                },
                {
                  collection: 'qbankMemberships',
                  id: `${bank.id}_manual-member`,
                  type: 'set',
                  value: {
                    id: `${bank.id}_manual-member`,
                    qbankId: bank.id,
                    userId: 'manual-member',
                    userName: 'manual-member',
                    role: 'editor',
                    grantedById: 'trial',
                    grantedByName: 'trial',
                    createdAt: acceptedAt,
                    inviteId: invitation.id,
                  },
                },
              ],
            },
            'PUT',
          )
        ).status,
        200,
      );

      const loaded = await call('editor', '/collaboration');
      assert.equal(loaded.status, 200);
      assert.equal(
        loaded.data.collaboration.qbanks.find((item) => item.id === bank.id)
          ?.name,
        bank.name,
      );
      assert.ok(
        loaded.data.collaboration.memberships.some(
          (item) => item.id === viewerMembership.id,
        ),
      );

      const update = await call(
        'editor',
        '/collaboration',
        {
          operations: [
            {
              collection: 'qbanks',
              id: bank.id,
              type: 'set',
              value: { ...bank, description: 'Updated by editor' },
            },
          ],
        },
        'PUT',
      );
      assert.equal(update.status, 200, JSON.stringify(update.data));

      const reserved = await call('editor', '/ids/reserve', {
        count: 1,
        qbankId: bank.id,
        highestKnown: 0,
      });
      assert.equal(reserved.status, 200, JSON.stringify(reserved.data));

      const classification = await call(
        'editor',
        '/platform/classification',
        {
          qbankId: bank.id,
          operationId: randomUUID(),
          baseRevision: 0,
          specialties: [],
          topics: [],
          assignments: [],
        },
        'PUT',
      );
      assert.equal(
        classification.status,
        200,
        JSON.stringify(classification.data),
      );

      assert.equal(
        (
          await call(
            'editor',
            '/collaboration',
            {
              operations: [
                {
                  collection: 'qbankMemberships',
                  id: viewerMembership.id,
                  type: 'delete',
                },
              ],
            },
            'PUT',
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await call(
            'editor',
            '/collaboration',
            {
              operations: [
                { collection: 'qbanks', id: bank.id, type: 'delete' },
              ],
            },
            'PUT',
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await call(
            'trial',
            '/collaboration',
            {
              operations: [
                {
                  collection: 'qbankMemberships',
                  id: 'invalid-owner-membership',
                  type: 'set',
                  value: {
                    ...viewerMembership,
                    id: 'invalid-owner-membership',
                    role: 'owner',
                  },
                },
              ],
            },
            'PUT',
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await call(
            'trial',
            '/collaboration',
            {
              operations: [
                {
                  collection: 'qbankMemberships',
                  id: viewerMembership.id,
                  type: 'delete',
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
    'a created QBank and later property changes remain in D1 after a fresh read',
    async () => {
      const now = new Date().toISOString();
      const bank = {
        id: `sync-bank-${randomUUID()}`,
        name: 'Created bank',
        shortName: 'CREATED',
        description: 'Before update',
        createdAt: now,
        createdById: 'monthly',
        createdByName: 'monthly',
        ownerId: 'monthly',
        ownerName: 'monthly',
        visibility: 'private',
        shareEnabled: false,
        reviewerIds: [],
        viewerIds: [],
        archived: false,
        essential: false,
      };
      const create = await call(
        'monthly',
        '/collaboration',
        {
          operations: [
            { collection: 'qbanks', id: bank.id, type: 'set', value: bank },
          ],
        },
        'PUT',
      );
      assert.equal(create.status, 200, JSON.stringify(create.data));
      assert.equal(
        (await call('monthly', '/collaboration')).data.collaboration.qbanks.find(
          (item) => item.id === bank.id,
        )?.name,
        bank.name,
      );

      const updated = {
        ...bank,
        name: 'Renamed bank',
        description: 'After update',
      };
      const edit = await call(
        'monthly',
        '/collaboration',
        {
          operations: [
            { collection: 'qbanks', id: bank.id, type: 'set', value: updated },
          ],
        },
        'PUT',
      );
      assert.equal(edit.status, 200, JSON.stringify(edit.data));
      const reloaded = (
        await call('monthly', '/collaboration')
      ).data.collaboration.qbanks.find((item) => item.id === bank.id);
      assert.equal(reloaded?.name, updated.name);
      assert.equal(reloaded?.description, updated.description);
    },
  );
  await t.test(
    'Superadmin can hide, restore and delete ordinary and Essential QBanks',
    async () => {
      const now = new Date().toISOString();
      const bank = {
        id: `admin-bank-${randomUUID()}`,
        name: 'Admin controlled bank',
        shortName: 'ADMIN',
        description: 'Managed from the Superadmin workspace',
        createdAt: now,
        createdById: 'monthly',
        createdByName: 'monthly',
        ownerId: 'monthly',
        ownerName: 'monthly',
        visibility: 'public',
        shareEnabled: false,
        reviewerIds: [],
        viewerIds: [],
        archived: false,
        essential: false,
      };
      const create = await call(
        'monthly',
        '/collaboration',
        {
          operations: [
            {
              collection: 'qbanks',
              id: bank.id,
              type: 'set',
              value: bank,
            },
          ],
        },
        'PUT',
      );
      assert.equal(create.status, 200, JSON.stringify(create.data));

      const hidden = { ...bank, archived: true };
      const hide = await call(
        'admin',
        '/collaboration',
        {
          operations: [
            {
              collection: 'qbanks',
              id: bank.id,
              type: 'set',
              value: hidden,
            },
          ],
        },
        'PUT',
      );
      assert.equal(hide.status, 200, JSON.stringify(hide.data));
      assert.equal(
        (await call('admin', '/collaboration')).data.collaboration.qbanks.find(
          (item) => item.id === bank.id,
        )?.archived,
        true,
      );

      const unrelatedRestore = await call(
        'other',
        '/collaboration',
        {
          operations: [
            {
              collection: 'qbanks',
              id: bank.id,
              type: 'set',
              value: bank,
            },
          ],
        },
        'PUT',
      );
      assert.equal(unrelatedRestore.status, 403);

      const restore = await call(
        'admin',
        '/collaboration',
        {
          operations: [
            {
              collection: 'qbanks',
              id: bank.id,
              type: 'set',
              value: bank,
            },
          ],
        },
        'PUT',
      );
      assert.equal(restore.status, 200, JSON.stringify(restore.data));
      assert.equal(
        (await call('admin', '/collaboration')).data.collaboration.qbanks.find(
          (item) => item.id === bank.id,
        )?.archived,
        false,
      );

      const specialty = {
        id: `${bank.id}-specialty`,
        qbankId: bank.id,
        name: 'Surgery',
      };
      await db
        .prepare(
          'INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES(?,?,?,?,?)',
        )
        .bind(
          'qbankSpecialties',
          specialty.id,
          bank.id,
          JSON.stringify(specialty),
          now,
        )
        .run();

      const remove = await call(
        'admin',
        '/collaboration',
        {
          operations: [{ collection: 'qbanks', id: bank.id, type: 'delete' }],
        },
        'PUT',
      );
      assert.equal(remove.status, 200, JSON.stringify(remove.data));
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS count FROM records WHERE qbank_id=?')
            .bind(bank.id)
            .first()
        ).count,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS count FROM records WHERE type='qbanks' AND id=?",
            )
            .bind(bank.id)
            .first()
        ).count,
        0,
      );

      const essentialBank = { ...bank, id: 'legacy-essential-deletion', ownerId: 'admin', createdById: 'admin', essential: true };
      assert.equal((await call('admin', '/collaboration', { operations: [{ collection: 'qbanks', id: essentialBank.id, type: 'set', value: essentialBank }] }, 'PUT')).status, 200);
      const essentialDelete = await call(
        'admin',
        '/collaboration',
        {
          operations: [{ collection: 'qbanks', id: essentialBank.id, type: 'delete' }],
        },
        'PUT',
      );
      assert.equal(essentialDelete.status, 200);
    },
  );
  await t.test(
    'MFA verification rotates the temporary privileged session',
    async () => {
      const password = 'superadmin-password-456';
      const salt = 'phase-4-admin-login-salt';
      const secret = 'JBSWY3DPEHPK3PXP';
      const passwordHash = pbkdf2Sync(
        password,
        salt,
        100_000,
        32,
        'sha256',
      ).toString('hex');
      await db
        .prepare(
          'UPDATE profiles SET password_hash=?,password_salt=?,totp_secret=? WHERE uid=?',
        )
        .bind(passwordHash, salt, null, 'admin')
        .run();
      const enrollmentLogin = await mf.dispatchFetch(
        'https://qraft.test/api/cloudflare/auth/login',
        {
          method: 'POST',
          headers: {
            origin: 'https://qraft.test',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: 'admin@example.test',
            password,
          }),
        },
      );
      assert.equal(enrollmentLogin.status, 200);
      const enrollmentUser = (await enrollmentLogin.json()).user;
      assert.equal(enrollmentUser.mfaEnrolled, false);
      assert.equal(enrollmentUser.mfaVerified, false);
      const enrollmentCookie = enrollmentLogin.headers
        .get('set-cookie')
        ?.split(';')[0];
      assert.ok(enrollmentCookie);
      const protectedBeforeMfa = await mf.dispatchFetch(
        'https://qraft.test/api/cloudflare/platform/discounts',
        { headers: { cookie: enrollmentCookie } },
      );
      assert.equal(protectedBeforeMfa.status, 403);
      const beginEnrollment = await mf.dispatchFetch(
        'https://qraft.test/api/cloudflare/auth/mfa-begin',
        {
          method: 'POST',
          headers: {
            origin: 'https://qraft.test',
            cookie: enrollmentCookie,
            'content-type': 'application/json',
          },
          body: '{}',
        },
      );
      assert.equal(beginEnrollment.status, 200, await beginEnrollment.text());
      await db
        .prepare('UPDATE profiles SET totp_secret=? WHERE uid=?')
        .bind(secret, 'admin')
        .run();
      const login = await mf.dispatchFetch(
        'https://qraft.test/api/cloudflare/auth/login',
        {
          method: 'POST',
          headers: {
            origin: 'https://qraft.test',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: 'admin@example.test',
            password,
          }),
        },
      );
      assert.equal(login.status, 428);
      const temporaryCookie = login.headers.get('set-cookie')?.split(';')[0];
      assert.ok(temporaryCookie);
      const verified = await mf.dispatchFetch(
        'https://qraft.test/api/cloudflare/auth/mfa',
        {
          method: 'POST',
          headers: {
            origin: 'https://qraft.test',
            cookie: temporaryCookie,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ code: currentTotp(secret) }),
        },
      );
      assert.equal(verified.status, 200, await verified.text());
      const privilegedCookie = verified.headers
        .get('set-cookie')
        ?.split(';')[0];
      assert.ok(privilegedCookie);
      assert.notEqual(privilegedCookie, temporaryCookie);
      const oldSession = await mf.dispatchFetch(
        'https://qraft.test/api/cloudflare/auth/session',
        { headers: { cookie: temporaryCookie } },
      );
      assert.equal((await oldSession.json()).user, null);
      const privilegedSession = await mf.dispatchFetch(
        'https://qraft.test/api/cloudflare/auth/session',
        { headers: { cookie: privilegedCookie } },
      );
      assert.equal((await privilegedSession.json()).user.uid, 'admin');
    },
  );
  await t.test(
    'Audit records are server-authored and cannot be forged through collaboration',
    async () => {
      const id = `forged-audit-${randomUUID()}`;
      const forged = await call(
        'trial',
        '/collaboration',
        {
          operations: [
            {
              collection: 'auditLog',
              type: 'set',
              id,
              value: {
                id,
                actorId: 'trial',
                actorName: 'System',
                action: 'subscription_plan_overridden',
                entityType: 'account',
                entityId: 'trial',
                createdAt: new Date().toISOString(),
                detail: 'forged',
              },
            },
          ],
        },
        'PUT',
      );
      assert.equal(forged.status, 403, JSON.stringify(forged));
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM records WHERE type='auditLog' AND id=?",
            )
            .bind(id)
            .first()
        ).n,
        0,
      );
    },
  );
  await t.test(
    'Personal backup restore rejects unsigned data and cross-owner record collisions',
    async () => {
      const id = `backup-victim-${randomUUID()}`;
      const now = new Date().toISOString();
      const original = {
        id,
        name: 'Other owner bank',
        visibility: 'private',
        ownerId: 'other',
      };
      await db
        .prepare(
          "INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES('qbanks',?,?,?,?,?)",
        )
        .bind(id, id, 'other', JSON.stringify(original), now)
        .run();
      const forged = {
        format: 'qraft-personal-backup-v1',
        ownerId: 'monthly',
        exportedAt: now,
        records: [
          {
            type: 'qbanks',
            id,
            qbank_id: id,
            owner_id: 'monthly',
            payload: {
              ...original,
              name: 'Overwritten bank',
              ownerId: 'monthly',
            },
            updated_at: now,
          },
        ],
        flashcards: null,
      };
      const response = await call(
        'monthly',
        '/platform/personal-backup',
        forged,
        'PUT',
      );
      const stored = await db
        .prepare(
          "SELECT owner_id,payload FROM records WHERE type='qbanks' AND id=?",
        )
        .bind(id)
        .first();
      if (response.status === 200) {
        await db
          .prepare(
            "UPDATE records SET owner_id=?,payload=? WHERE type='qbanks' AND id=?",
          )
          .bind('other', JSON.stringify(original), id)
          .run();
      }
      assert.equal(response.status, 403, JSON.stringify(response));
      assert.equal(stored.owner_id, 'other');
      assert.deepEqual(JSON.parse(stored.payload), original);
      await db
        .prepare("DELETE FROM records WHERE type='qbanks' AND id=?")
        .bind(id)
        .run();
      const exported = await call('monthly', '/platform/personal-backup');
      assert.equal(exported.status, 200, JSON.stringify(exported));
      assert.equal(exported.data.signatureVersion, 'hmac-sha256-v1');
      assert.match(exported.data.signature, /^[a-f0-9]{64}$/);
      const restored = await call(
        'monthly',
        '/platform/personal-backup',
        exported.data,
        'PUT',
      );
      assert.equal(restored.status, 200, JSON.stringify(restored));
      await db.prepare("DELETE FROM app_states WHERE user_id='monthly'").run();
    },
  );
  await t.test(
    'Personal state rejects first-write private notes and impossible duplicate or cyclic identities',
    async () => {
      const privateNote = emptyState({
        progress: {
          'gs-001': {
            attempts: 0,
            correctAttempts: 0,
            incorrectAttempts: 0,
            flagged: false,
            bookmarked: false,
            highlights: [],
            note: 'This must require Pro even on the first save.',
            noteImages: [],
          },
        },
      });
      const noteSave = await call(
        'reviewer',
        '/state',
        { state: privateNote },
        'PUT',
      );
      assert.equal(noteSave.status, 403, JSON.stringify(noteSave));
      assert.equal(
        await db
          .prepare("SELECT user_id FROM app_states WHERE user_id='reviewer'")
          .first(),
        null,
      );

      const test = {
        id: 'duplicate-test',
        title: '',
        mode: 'tutor',
        questionIds: ['gs-001'],
        currentIndex: 0,
        answers: {},
        revealed: [],
        graded: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active',
      };
      const duplicateTests = await call(
        'monthly',
        '/state',
        { state: emptyState({ tests: [test, { ...test }] }) },
        'PUT',
      );
      assert.equal(duplicateTests.status, 400, JSON.stringify(duplicateTests));

      const deckA = {
        id: 'cycle-a',
        name: 'A',
        qbankId: 'smle-gs',
        parentId: 'cycle-b',
        color: '#000',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const deckB = { ...deckA, id: 'cycle-b', name: 'B', parentId: 'cycle-a' };
      const cyclicDecks = await call(
        'monthly',
        '/state',
        { state: emptyState({ flashcardDecks: [deckA, deckB] }) },
        'PUT',
      );
      assert.equal(cyclicDecks.status, 400, JSON.stringify(cyclicDecks));
      assert.equal(
        await db
          .prepare("SELECT user_id FROM app_states WHERE user_id='monthly'")
          .first(),
        null,
      );
    },
  );
  await t.test(
    'Invalid exam answer statistics cannot partially persist the checkpoint',
    async () => {
      const state = emptyState({
        tests: [
          {
            id: 'checkpoint-invalid-answer',
            title: '',
            mode: 'tutor',
            questionIds: ['gs-001'],
            currentIndex: 0,
            answers: { 'gs-001': 0 },
            revealed: ['gs-001'],
            graded: ['gs-001'],
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'active',
          },
        ],
      });
      const result = await call(
        'monthly',
        '/state/exam',
        {
          ...state,
          answerSelections: [
            { qbankId: 'smle-gs', questionId: 'gs-001', answer: 99 },
          ],
        },
        'PUT',
      );
      assert.equal(result.status, 400, JSON.stringify(result));
      assert.equal(
        await db
          .prepare("SELECT user_id FROM app_states WHERE user_id='monthly'")
          .first(),
        null,
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
        403,
      );
      assert.equal(
        (await call('reviewer', '/auth/session')).data.user.effectivePlan,
        'free',
      );
      assert.equal((await call('monthly', '/state', { state }, 'PUT')).status, 200);
      assert.equal(
        (await call('monthly', '/state')).data.state.flashcards.length,
        1,
      );
      assert.equal(
        (await call('trial', '/state')).data.state?.flashcards?.length ?? 0,
        0,
      );
      assert.equal(
        (
          await call(
            'monthly',
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
      assert.equal((await connect('other', 'user:trial')).status, 403);
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
        { type: 'resources_changed', resources: ['contact', 'audit'] },
        { type: 'resources_changed', resources: ['contact', 'audit'] },
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
          await call('monthly', '/platform/import', {
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
      const first = await call('monthly', '/platform/import', request);
      assert.equal(first.status, 200, JSON.stringify(first));
      assert.equal(first.data.successful, 1);
      assert.equal(
        first.data.proposals[0].payload.sourceReference,
        'Fixture.pdf - p.12',
      );
      assert.equal(
        (await call('monthly', '/platform/import', request)).data.proposals[0].id,
        first.data.proposals[0].id,
      );
      const partial = await call('monthly', '/platform/import', {
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
      await db.prepare("INSERT INTO import_policies VALUES('monthly',75,5,?)").bind(new Date().toISOString()).run();
      const duplicateName = await call('monthly', '/platform/import', {
        ...request,
        requestId: randomUUID(),
        fileHash: createHash('sha256').update('different').digest('hex'),
      });
      assert.equal(duplicateName.status, 200, JSON.stringify(duplicateName));
      assert.equal(duplicateName.data.successful, 1);
      assert.equal(duplicateName.data.skippedDuplicates, 0);
      const duplicateHash = await call('monthly', '/platform/import', {
        ...request,
        requestId: randomUUID(),
        fileName: 'renamed.json',
      });
      assert.equal(duplicateHash.status, 200, JSON.stringify(duplicateHash));
      assert.equal(duplicateHash.data.successful, 1);
      assert.equal(duplicateHash.data.skippedDuplicates, 0);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS value FROM sqlite_master WHERE name='duplicate_attempts'",
            )
            .first()
        ).value,
        1,
      );
      assert.equal((await db.prepare('SELECT count(*) AS value FROM duplicate_attempts').first()).value, 0);
      const dailyPayload = (index) => ({
        ...payload,
        stem: `Daily limit fixture ${index} with distinct clinical wording`,
        topic: 'Daily import quota',
      });
      const third = await call('monthly', '/platform/import', {
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        fileName: 'daily-third.json',
        fileHash: createHash('sha256').update('daily-third').digest('hex'),
        questions: [dailyPayload(3)],
      });
      assert.equal(third.status, 200, JSON.stringify(third));
      const fourth = await call('monthly', '/platform/import', {
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        fileName: 'daily-fourth.json',
        fileHash: createHash('sha256').update('daily-fourth').digest('hex'),
        questions: [dailyPayload(4)],
      });
      assert.equal(fourth.status, 403);
      assert.match(fourth.data.error, /daily import limit/i);
    },
  );
  await t.test(
    'Pending queue and JSON-only suspensions cannot be bypassed through the import API',
    async () => {
      const now = new Date().toISOString();
      await db
        .prepare(`INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at)
          SELECT 'questionProposals','pending-limit-'||value,'smle-gs','monthly-pending',
            json_object(
              'id','pending-limit-'||value,
              'status','pending',
              'payload',json_object('stem','Existing pending '||value,'options',json_array('Yes','No'))
            ),?
          FROM json_each(?)`)
        .bind(
          now,
          JSON.stringify(Array.from({ length: 1_000 }, (_, index) => index)),
        )
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
        'monthly-pending',
        '/platform/import',
        request('pending-full'),
      );
      assert.equal(queueBlocked.status, 403);
      assert.match(queueBlocked.data.error, /submission queue is full/i);
      await db
        .prepare(
          "DELETE FROM records WHERE type='questionProposals' AND owner_id='monthly-pending'",
        )
        .run();
      const suspended = await call('admin', '/platform/economy-admin', {
        operation: 'suspend-json',
        userId: 'monthly-pending',
        reason: 'Import suspension integration fixture',
        days: 7,
      });
      assert.equal(suspended.status, 200);
      const suspensionBlocked = await call(
        'monthly-pending',
        '/platform/import',
        request('suspended-import'),
      );
      assert.equal(suspensionBlocked.status, 403);
      assert.match(suspensionBlocked.data.error, /suspended until/i);
      assert.equal(
        (
          await call('monthly-pending', '/platform/exam-start', {
            testId: randomUUID(),
            questionCount: 10,
          })
        ).status,
        201,
      );
    },
  );
  await t.test(
    'High-risk corrections require two independent reviewers before credits are awarded',
    async () => {
      const existingRow = await db
        .prepare(
          "SELECT id,payload FROM records WHERE type='sharedQuestions' AND qbank_id='smle-gs' LIMIT 1",
        )
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
        .prepare(
          "INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES('questionProposals',?,?,?,?,?)",
        )
        .bind(
          proposalId,
          'smle-gs',
          'other',
          JSON.stringify(proposal),
          proposedAt,
        )
        .run();

      const first = await call('reviewer', '/platform/bulk-review', {
        proposalIds: [proposalId],
        status: 'approved',
      });
      assert.equal(first.status, 200);
      assert.deepEqual(
        {
          ok: first.data.ok,
          reviewed: first.data.reviewed,
          awaitingSecondReview: first.data.awaitingSecondReview,
          queueDelta: first.data.queueDelta,
          reviewerCompletedDelta: first.data.reviewerCompletedDelta,
        },
        {
          ok: true,
          reviewed: 0,
          awaitingSecondReview: 1,
          queueDelta: 0,
          reviewerCompletedDelta: 0,
        },
      );
      assert.deepEqual(first.data.updatedProposals, []);
      assert.deepEqual(first.data.updatedQuestions, []);
      assert.equal(
        JSON.parse(
          (
            await db
              .prepare(
                "SELECT payload FROM records WHERE type='questionProposals' AND id=?",
              )
              .bind(proposalId)
              .first()
          ).payload,
        ).status,
        'pending',
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS value FROM credit_transactions WHERE reference_id=?',
            )
            .bind(proposalId)
            .first()
        ).value,
        0,
      );

      const second = await call('reviewer2', '/platform/bulk-review', {
        proposalIds: [proposalId],
        status: 'approved',
      });
      assert.equal(second.status, 200);
      assert.equal(second.data.reviewed, 1);
      assert.equal(second.data.awaitingSecondReview, 0);
      assert.equal(second.data.queueDelta, -1);
      assert.equal(second.data.reviewerCompletedDelta, 1);
      assert.equal(second.data.updatedProposals.length, 1);
      assert.equal(second.data.updatedQuestions.length, 1);
      const reviews = await db
        .prepare(
          'SELECT reviewer_id FROM contribution_reviews WHERE proposal_id=? ORDER BY reviewer_id',
        )
        .bind(proposalId)
        .all();
      assert.deepEqual(
        reviews.results.map((review) => review.reviewer_id),
        ['reviewer', 'reviewer2'],
      );
      const reward = await db
        .prepare(
          'SELECT amount,lifetime_delta FROM credit_transactions WHERE reference_id=?',
        )
        .bind(proposalId)
        .first();
      assert.deepEqual(reward, { amount: 10, lifetime_delta: 10 });
    },
  );
  await t.test(
    'Bulk review approves or rejects up to 200 selected proposals atomically',
    async () => {
      const payload = (index) => ({
        stem: `Bulk workflow fixture ${createHash('sha256').update(`stem-${index}`).digest('hex')}`,
        options: [
          `Correct ${createHash('sha256').update(`correct-${index}`).digest('hex')}`,
          `Incorrect ${createHash('sha256').update(`incorrect-${index}`).digest('hex')}`,
        ],
        answer: 0,
        specialty: 'General',
        topic: 'Bulk review',
        explanation: `Explanation ${index}`,
        sourceFile: 'Bulk.pdf',
        sourcePage: index,
        sourceReference: `Source ${index}`,
        images: [],
      });
      const imported = await call('quarterly', '/platform/import', {
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
      const balanceBeforeApproval = (await call('quarterly', '/platform/contributions')).data;
      const modifiedOrigin = await call('quarterly', '/collaboration', {
        operations: [{ collection: 'questionProposals', type: 'set', id: approved[0].id, value: { ...approved[0], submissionMethod: 'manual', importBatchId: undefined } }],
      }, 'PUT');
      assert.equal(modifiedOrigin.status, 403);
      const approval = await call('reviewer', '/platform/bulk-review', {
        proposalIds: approved.map((proposal) => proposal.id),
        status: 'approved',
      });
      assert.equal(approval.status, 200);
      assert.equal(approval.data.ok, true);
      assert.equal(approval.data.reviewed, 150);
      assert.equal(approval.data.awaitingSecondReview, 0);
      assert.equal(approval.data.queueDelta, -150);
      assert.equal(approval.data.reviewerCompletedDelta, 150);
      assert.equal(approval.data.updatedProposals.length, 150);
      assert.equal(approval.data.updatedQuestions.length, 150);
      const balanceAfterApproval = (await call('quarterly', '/platform/contributions')).data;
      assert.equal(balanceAfterApproval.creditsBalance, balanceBeforeApproval.creditsBalance);
      assert.equal(balanceAfterApproval.lifetimeContributionScore, balanceBeforeApproval.lifetimeContributionScore);
      assert.equal((await db.prepare('SELECT count(*) n FROM credit_transactions WHERE reference_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(approved.map(proposal => proposal.id))).first()).n, 0);
      const rejectedImport = await call('quarterly', '/platform/import', {
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
    'Duplicate candidates require reviewer resolution, preserve canonical content, and suppress unchanged pairs',
    async () => {
      const marker = randomUUID();
      const question = {
        stem: `A unique duplicate workflow case ${marker} asks for the NEXT management step.`,
        options: [`CT ${marker}`, `MRI ${marker}`, `Observe ${marker}`],
        answer: 0,
        specialty: 'Duplicate QA',
        topic: marker,
        explanation: 'Purpose-built duplicate workflow fixture.',
        sourceFile: 'duplicate-qa.pdf',
        sourcePage: 1,
        sourceReference: 'Duplicate QA source',
        images: [],
      };
      const nearDuplicate = {
        ...question,
        sourcePage: 2,
        options: [
          question.options[0],
          question.options[1],
          `${question.options[2]} now`,
        ],
      };
      const imported = await call('quarterly', '/platform/import', {
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        fileName: `duplicate-${marker}.json`,
        fileHash: createHash('sha256')
          .update(`duplicate-${marker}`)
          .digest('hex'),
        questions: [question, nearDuplicate],
      });
      assert.equal(imported.status, 200, JSON.stringify(imported));
      assert.equal(imported.data.proposals.length, 2);
      assert.equal(imported.data.skippedDuplicates, 0);
      assert.equal(imported.data.flaggedDuplicates, 1);
      const [first, duplicate] = imported.data.proposals;
      assert.equal(duplicate.duplicateReview.status, 'flagged');
      assert.equal(duplicate.duplicateReview.candidates[0].entityId, first.id);
      assert.equal(
        duplicate.duplicateReview.candidates[0].entityType,
        'pending_proposal',
      );
      assert.equal(
        duplicate.duplicateReview.candidates[0].classification,
        'exact',
      );

      const blockedBulk = await call('reviewer', '/platform/bulk-review', {
        proposalIds: [duplicate.id],
        status: 'approved',
      });
      assert.equal(blockedBulk.status, 409);
      const selfReview = await call(
        'quarterly',
        '/platform/duplicate-resolve',
        {
          proposalId: duplicate.id,
          candidateEntityId: first.id,
          decision: 'kept_both',
        },
      );
      assert.equal(selfReview.status, 403);
      const keep = await call('reviewer', '/platform/duplicate-resolve', {
        proposalId: duplicate.id,
        candidateEntityId: first.id,
        decision: 'kept_both',
        note: 'Intentional variants for this fixture.',
      });
      assert.equal(keep.status, 200, JSON.stringify(keep));
      assert.equal(keep.data.updatedProposals[0].status, 'pending');
      assert.equal(
        keep.data.updatedProposals[0].duplicateReview.status,
        'resolved',
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS value FROM duplicate_pair_decisions WHERE proposal_id=? AND decision='kept_both'",
            )
            .bind(duplicate.id)
            .first()
        ).value,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS value FROM json_import_suspensions WHERE created_by='system' AND user_id=?",
            )
            .bind(first.id)
            .first()
        ).value,
        0,
      );
      const medicalReview = await call('reviewer', '/platform/bulk-review', {
        proposalIds: [first.id, duplicate.id],
        status: 'approved',
      });
      assert.equal(medicalReview.status, 200, JSON.stringify(medicalReview));
      assert.equal(medicalReview.data.reviewed, 2);

      const canonicalId = medicalReview.data.updatedQuestions[0].id;
      const rejectedImport = await call('quarterly', '/platform/import', {
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        fileName: `duplicate-reject-${marker}.json`,
        fileHash: createHash('sha256')
          .update(`duplicate-reject-${marker}`)
          .digest('hex'),
        questions: [
          {
            ...question,
            sourcePage: 3,
            options: [
              question.options[0],
              `${question.options[1]} urgently`,
              question.options[2],
            ],
          },
        ],
      });
      assert.equal(rejectedImport.status, 200);
      const rejected = rejectedImport.data.proposals[0];
      const approvedCandidate = rejected.duplicateReview.candidates.find(
        (item) => item.entityType === 'approved_question',
      );
      assert.ok(approvedCandidate);
      const [reviewerOne, reviewerTwo] = await Promise.all([
        call('reviewer', '/platform/duplicate-resolve', {
          proposalId: rejected.id,
          candidateEntityId: approvedCandidate.entityId,
          decision: 'rejected_as_duplicate',
        }),
        call('reviewer2', '/platform/duplicate-resolve', {
          proposalId: rejected.id,
          candidateEntityId: approvedCandidate.entityId,
          decision: 'rejected_as_duplicate',
        }),
      ]);
      assert.deepEqual(
        [reviewerOne.status, reviewerTwo.status].sort(
          (left, right) => left - right,
        ),
        [200, 409],
        JSON.stringify({ reviewerOne, reviewerTwo }),
      );
      assert.ok(
        await db
          .prepare(
            "SELECT id FROM records WHERE type='sharedQuestions' AND id=?",
          )
          .bind(canonicalId)
          .first(),
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS value FROM json_import_suspensions WHERE user_id='quarterly' AND created_by='system'",
            )
            .first()
        ).value,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS value FROM contribution_reviews WHERE proposal_id=? AND decision='rejected' AND json_extract(metadata,'$.duplicateDecision')='rejected_as_duplicate'",
            )
            .bind(rejected.id)
            .first()
        ).value,
        1,
      );

      const staleMarker = randomUUID();
      const staleQuestion = {
        ...question,
        stem: `Stale duplicate case ${staleMarker}`,
        topic: staleMarker,
      };
      const staleImport = await call('quarterly', '/platform/import', {
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        fileName: `duplicate-stale-${staleMarker}.json`,
        fileHash: createHash('sha256')
          .update(`duplicate-stale-${staleMarker}`)
          .digest('hex'),
        questions: [
          staleQuestion,
          {
            ...staleQuestion,
            sourcePage: 4,
            options: [
              staleQuestion.options[0],
              staleQuestion.options[1],
              `${staleQuestion.options[2]} now`,
            ],
          },
        ],
      });
      const [staleCandidate, staleIncoming] = staleImport.data.proposals;
      const staleCandidateRow = await db
        .prepare(
          "SELECT payload FROM records WHERE type='questionProposals' AND id=?",
        )
        .bind(staleCandidate.id)
        .first();
      const changedCandidate = JSON.parse(staleCandidateRow.payload);
      changedCandidate.payload.stem += ' materially changed';
      await db
        .prepare(
          "UPDATE records SET payload=?,updated_at=? WHERE type='questionProposals' AND id=?",
        )
        .bind(
          JSON.stringify(changedCandidate),
          new Date().toISOString(),
          staleCandidate.id,
        )
        .run();
      const staleDecision = await call(
        'reviewer',
        '/platform/duplicate-resolve',
        {
          proposalId: staleIncoming.id,
          candidateEntityId: staleCandidate.id,
          decision: 'rejected_as_duplicate',
        },
      );
      assert.equal(staleDecision.status, 409);
      assert.equal(
        JSON.parse(
          (
            await db
              .prepare(
                "SELECT payload FROM records WHERE type='questionProposals' AND id=?",
              )
              .bind(staleIncoming.id)
              .first()
          ).payload,
        ).status,
        'pending',
      );

      const scan = await call('reviewer', '/platform/duplicate-scan', {
        qbankId: 'smle-gs',
        cursor: 0,
        batchSize: 2,
      });
      assert.equal(scan.status, 200, JSON.stringify(scan));
      assert.equal(scan.data.scanned, 2);
      const resumable = await call(
        'reviewer',
        '/platform/duplicate-scan?qbankId=smle-gs',
      );
      assert.equal(resumable.status, 200);
      assert.equal(resumable.data.run.runId, scan.data.runId);
      assert.equal(resumable.data.run.cursor, scan.data.cursor);
    },
  );
  await t.test(
    'reviewing a matched proposal rebases dependent duplicate cases without deciding them',
    async () => {
      // Earlier import tests already consumed this fixture account's daily quota.
      await db
        .prepare('UPDATE imported_files SET uploaded_at=? WHERE user_id=?')
        .bind(new Date(Date.now() - 86_400_000).toISOString(), 'quarterly')
        .run();
      const makePair = async (marker) => {
        const question = {
          stem: `A linked duplicate case ${marker} asks for the best management step.`,
          options: [`CT ${marker}`, `MRI ${marker}`, `Observe ${marker}`],
          answer: 0,
          specialty: 'Duplicate QA',
          topic: marker,
          explanation: 'Independent linked-review fixture.',
          sourceFile: 'linked-review.pdf',
          sourcePage: 1,
          sourceReference: 'Linked review source',
          images: [],
        };
        const imported = await call('quarterly', '/platform/import', {
          qbankId: 'smle-gs',
          requestId: randomUUID(),
          fileName: `linked-${marker}.json`,
          fileHash: createHash('sha256')
            .update(`linked-${marker}`)
            .digest('hex'),
          questions: [
            question,
            {
              ...question,
              sourcePage: 2,
              options: [
                question.options[0],
                question.options[1],
                `${question.options[2]} now`,
              ],
            },
          ],
        });
        assert.equal(imported.status, 200, JSON.stringify(imported));
        const [first, dependent] = imported.data.proposals;
        assert.equal(
          dependent.duplicateReview.candidates[0].entityId,
          first.id,
        );
        return { first, dependent };
      };

      const approvedPair = await makePair(randomUUID());
      const approval = await call('reviewer', '/platform/bulk-review', {
        proposalIds: [approvedPair.first.id],
        status: 'approved',
      });
      assert.equal(approval.status, 200, JSON.stringify(approval));
      const published = approval.data.updatedQuestions[0];
      const rebased = approval.data.updatedProposals.find(
        (item) => item.id === approvedPair.dependent.id,
      );
      assert.equal(rebased.status, 'pending');
      assert.equal(
        rebased.duplicateReview.candidates[0].entityType,
        'approved_question',
      );
      assert.equal(
        rebased.duplicateReview.candidates[0].entityId,
        published.id,
      );

      // An older imported case can still point at the approved proposal. It must
      // resolve against the canonical question without requiring a re-upload.
      const stored = await db
        .prepare(
          "SELECT payload FROM records WHERE type='questionProposals' AND id=?",
        )
        .bind(approvedPair.dependent.id)
        .first();
      const oldCase = JSON.parse(stored.payload);
      oldCase.duplicateReview.candidates =
        approvedPair.dependent.duplicateReview.candidates;
      await db
        .prepare(
          "UPDATE records SET payload=? WHERE type='questionProposals' AND id=?",
        )
        .bind(JSON.stringify(oldCase), approvedPair.dependent.id)
        .run();
      const oldCaseDecision = await call(
        'reviewer',
        '/platform/duplicate-resolve',
        {
          proposalId: approvedPair.dependent.id,
          candidateEntityId: approvedPair.first.id,
          decision: 'rejected_as_duplicate',
        },
      );
      assert.equal(
        oldCaseDecision.status,
        200,
        JSON.stringify(oldCaseDecision),
      );
      assert.equal(oldCaseDecision.data.updatedProposals[0].status, 'rejected');
      assert.equal(
        oldCaseDecision.data.updatedProposals[0].duplicateReview.candidates[0]
          .entityId,
        published.id,
      );

      const rejectedPair = await makePair(randomUUID());
      const rejection = await call('reviewer', '/platform/bulk-review', {
        proposalIds: [rejectedPair.first.id],
        status: 'rejected',
      });
      assert.equal(rejection.status, 200, JSON.stringify(rejection));
      const remaining = rejection.data.updatedProposals.find(
        (item) => item.id === rejectedPair.dependent.id,
      );
      assert.equal(remaining.status, 'pending');
      assert.equal(remaining.duplicateReview, undefined);
      const staleRejectedCase = {
        ...remaining,
        duplicateReview: rejectedPair.dependent.duplicateReview,
      };
      await db
        .prepare(
          "UPDATE records SET payload=? WHERE type='questionProposals' AND id=?",
        )
        .bind(JSON.stringify(staleRejectedCase), rejectedPair.dependent.id)
        .run();
      const reconciled = await call('reviewer', '/platform/duplicate-resolve', {
        proposalId: rejectedPair.dependent.id,
        candidateEntityId: rejectedPair.first.id,
        decision: 'kept_both',
      });
      assert.equal(reconciled.status, 200, JSON.stringify(reconciled));
      assert.equal(reconciled.data.reconciled, true);
      assert.equal(
        reconciled.data.updatedProposals[0].duplicateReview,
        undefined,
      );
      const normalReview = await call('reviewer', '/platform/bulk-review', {
        proposalIds: [rejectedPair.dependent.id],
        status: 'approved',
      });
      assert.equal(normalReview.status, 200, JSON.stringify(normalReview));
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
      assert.equal((await save('trial', { trial: 0 })).status, 200);
      assert.equal((await save('other', { trial: 0, other: 1 })).status, 200);
      assert.equal((await save('trial', { trial: 2, other: 1 })).status, 200);
      assert.equal((await save('trial', { trial: 1, other: 2 })).status, 403);
      assert.equal((await save('trial', { trial: 99, other: 1 })).status, 403);
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
      assert.equal((await call('trial', `/contact?id=${id}`)).status, 404);
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
        .prepare(
          "SELECT amount,lifetime_delta FROM credit_transactions WHERE reference_type='ticket' AND reference_id=?",
        )
        .bind(id)
        .first();
      assert.deepEqual(reportReward, { amount: 2, lifetime_delta: 2 });
      for (const status of ['open', 'resolved']) assert.equal((await call('admin', '/contact', { id, operation: 'status', status })).status, 200);
      assert.equal((await db.prepare("SELECT count(*) n FROM credit_transactions WHERE reference_type='ticket' AND reference_id=?").bind(id).first()).n, 1);
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
        (await call('trial', '/contact', { id }, 'DELETE')).status,
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
  await t.test('Expired Full Access returns to Free trial and expiry is audited', async () => {
    await db
      .prepare(
        "UPDATE subscriptions SET starts_at='2019-01-01T00:00:00.000Z', expires_at='2020-01-01T00:00:00.000Z' WHERE user_id='trial'",
      )
      .run();
    assert.equal((await call('trial', '/auth/session')).data.user.tier, 'free');
    assert.equal(
      (
        await db
          .prepare(
            "SELECT count(*) AS n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='subscription_expired'",
          )
          .first()
      ).n,
      0,
    );
    const worker = await mf.getWorker(built ? 'app' : undefined);
    const scheduled = await worker.scheduled({
      cron: '0 3 * * *',
      scheduledTime: new Date(),
    });
    assert.equal(scheduled.outcome, 'ok');
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
  await t.test('refund policy defaults, Superadmin updates and legacy saves preserve the configured link', async () => {
    const stored = await db.prepare("SELECT * FROM records WHERE type='system' AND id='legalLinks'").first();
    const defaultRefund = 'https://qraftbank.netlify.app/policies/refund.html';
    const legacy = { termsUrl: 'https://example.test/terms', privacyUrl: 'https://example.test/privacy' };
    try {
      await db.prepare("DELETE FROM records WHERE type='system' AND id='legalLinks'").run();
      const defaults = await call('free', '/platform/legal-links');
      assert.equal(defaults.status, 200);
      assert.equal(defaults.data.refundUrl, defaultRefund);
      await db.prepare("INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES('system','legalLinks',?,?,?)")
        .bind('admin', JSON.stringify(legacy), new Date().toISOString()).run();
      assert.deepEqual((await call('free', '/platform/legal-links')).data, { ...legacy, refundUrl: defaultRefund });
      const custom = { ...legacy, refundUrl: 'https://example.test/refund' };
      for (const uid of ['free', 'reviewer', 'moderator']) assert.equal((await call(uid, '/platform/legal-links', custom, 'PUT')).status, 403);
      assert.equal((await call('admin', '/platform/legal-links', { ...custom, refundUrl: 'javascript:alert(1)' }, 'PUT')).status, 400);
      assert.equal((await call('admin', '/platform/legal-links', custom, 'PUT')).status, 200);
      assert.deepEqual((await call('free', '/platform/legal-links')).data, custom);
      assert.equal(JSON.parse((await db.prepare("SELECT payload FROM records WHERE type='system' AND id='legalLinks'").first()).payload).refundUrl, custom.refundUrl);
      const replay = await call('admin', '/platform/legal-links', custom, 'PUT');
      assert.equal(replay.data.unchanged, true);
      const oldClient = await call('admin', '/platform/legal-links', legacy, 'PUT');
      assert.equal(oldClient.status, 200);
      assert.equal(oldClient.data.refundUrl, custom.refundUrl);
      const disabled = await call('admin', '/platform/legal-links', { ...custom, refundUrl: '' }, 'PUT');
      assert.equal(disabled.status, 200);
      assert.equal((await call('free', '/platform/legal-links')).data.refundUrl, '');
    } finally {
      await db.prepare("DELETE FROM records WHERE type='system' AND id='legalLinks'").run();
      if (stored) await db.prepare("INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES('system','legalLinks',?,?,?)")
        .bind(stored.owner_id, stored.payload, stored.updated_at).run();
    }
  });
  await preproductionApiTests(t, { db, call });
  await improvementsApiTests(t, db, call, {
    assets,
    fetch: (url, init) => mf.dispatchFetch(url, init),
  });
  await directQuestionEditApiTests(t, { db, call });
  await contributionEconomyApiTests(t, { db, call });
  await serverEfficiencyApiTests(t, { db, call, mf, assets });
  await t.test(
    'Read-only integrity checks find no contradictions in the local fixture',
    async () => {
      const source = await readFile(
        'scripts/data-integrity-checks.sql',
        'utf8',
      );
      const statements = source
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) {
        const result = await db.prepare(statement).all();
        assert.equal(
          result.results.length,
          0,
          `Integrity check returned rows: ${statement.slice(0, 100)}`,
        );
      }
    },
  );
  await exactImportSkipApiTests(t, { db, call });
  await qbankLifecycleApiTests(t, { db, call });
});
