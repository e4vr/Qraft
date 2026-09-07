import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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
      durableObjects: { REALTIME: { className: 'RealtimeChannel', useSQLite: true } },
      bindings: { ROOT_ADMIN_EMAIL: 'admin@example.test' },
  };
  const built = process.env.PLATFORM_TEST_BUILT === '1';
  const productionModules = built ? ['index.js', ...readdirSync('dist/server', { recursive: true }).map(String).filter(path => path !== 'index.js' && path.endsWith('.js'))].map(path => ({ type: 'ESModule', path: `dist/server/${path}` })) : [];
  const mf = new Miniflare(
    convertV4MiniflareOptions(built ? { workers: [
      { ...workerOptions, name: 'app', modules: productionModules, durableObjects: { REALTIME: { className: 'RealtimeChannel', scriptName: 'realtime', useSQLite: true } } },
      { name: 'realtime', modules: true, scriptPath: 'dist/qraft_realtime/index.js', compatibilityDate: '2026-09-07', durableObjects: { REALTIME: { className: 'RealtimeChannel', useSQLite: true } } },
    ] } : workerOptions),
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
  for (const uid of ['admin', 'lite', 'other', 'reviewer', 'access', 'manual-member', 'paid-member', 'discount-member']) {
    const profile = {
      uid,
      email: `${uid}@example.test`,
      displayName: uid,
      tier: 'lite',
      status: 'approved',
      role:
        uid === 'admin'
          ? 'super_admin'
          : uid === 'reviewer'
            ? 'reviewer'
            : 'student',
      platformRoles: uid === 'reviewer' ? ['reviewer'] : uid === 'access' ? ['access_manager'] : [],
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
  let codeId;
  await t.test('Access managers receive limited profiles and cannot modify official subscribers or their blocks', async () => {
    const now = new Date().toISOString();
    for (const [uid, method, paid, code] of [['manual-member', 'manual', 0, null], ['paid-member', 'manual', 1500, null], ['discount-member', 'discount', 0, 'FREE']]) {
      await db.prepare('INSERT INTO subscriptions(user_id,status,method,paid,discount_code,updated_at) VALUES(?,?,?,?,?,?)').bind(uid, 'active', method, paid, code, now).run();
    }
    const loaded = await call('access', '/collaboration');
    assert.equal(loaded.status, 200);
    const members = loaded.data.collaboration.members;
    for (const member of members) for (const key of ['phone', 'createdAt', 'mfaEnrolled', 'approvedAt', 'approvedByName']) assert.equal(key in member, false);
    const save = operations => call('access', '/collaboration', { operations }, 'PUT');
    const profileOp = (uid, changes) => ({ collection: 'profiles', type: 'set', id: uid, value: { ...members.find(m => m.uid === uid), ...changes } });
    assert.equal((await save([profileOp('manual-member', { suspended: true })])).status, 200);
    const stored = JSON.parse((await db.prepare('SELECT profile_json FROM profiles WHERE uid=?').bind('manual-member').first()).profile_json);
    assert.equal(stored.phone, 'private-manual-member');
    assert.ok(stored.createdAt);
    assert.equal((await save([profileOp('manual-member', { suspended: false })])).status, 200);
    for (const uid of ['paid-member', 'discount-member']) {
      assert.equal((await save([profileOp(uid, { suspended: true })])).status, 403);
      assert.equal((await save([profileOp(uid, { tier: 'lite', subscriptionProtected: false })])).status, 403);
      for (const kind of ['emails', 'universityIds']) {
        assert.equal((await save([{ collection: 'system', type: 'set', id: 'accessControl', value: { emails: [], phones: [], universityIds: [], [kind]: [kind === 'emails' ? `${uid}@example.test` : uid] } }])).status, 403);
      }
      assert.equal((await call('access', '/platform/subscriptions', { userId: uid })).status, 403);
    }
    assert.equal((await save([{ collection: 'system', type: 'set', id: 'accessControl', value: { emails: [], phones: ['private-paid-member'], universityIds: [] } }])).status, 403);
    const rootMember = (await call('admin', '/collaboration')).data.collaboration.members.find(m => m.uid === 'paid-member');
    assert.equal(rootMember.phone, 'private-paid-member');
    assert.equal((await call('admin', '/collaboration', { operations: [{ collection: 'profiles', type: 'set', id: rootMember.uid, value: { ...rootMember, suspended: true } }] }, 'PUT')).status, 200);
  });
  await t.test('Clearing review history is persisted for the authenticated account only', async () => {
    const before = await db.prepare("SELECT type,id,payload FROM records WHERE type IN ('questionProposals','sharedQuestions') ORDER BY type,id").all();
    const cleared = await call('reviewer', '/platform/review-history', { userId: 'other', clearedAt: '2099-01-01' });
    assert.equal(cleared.status, 200);
    assert.ok(Date.parse(cleared.data.clearedAt) <= Date.now());
    assert.deepEqual((await call('reviewer', '/platform/review-history')).data, cleared.data);
    assert.deepEqual((await call('other', '/platform/review-history')).data, { clearedAt: '' });
    assert.equal((await call('missing', '/platform/review-history', {})).status, 403);
    assert.equal((await call('reviewer', '/platform/review-history', {}, 'DELETE')).status, 405);
    const after = await db.prepare("SELECT type,id,payload FROM records WHERE type IN ('questionProposals','sharedQuestions') ORDER BY type,id").all();
    assert.deepEqual(after.results, before.results);
  });
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
            { state: { ...state, tests: [make('oversized', 31)] } },
            'PUT',
          )
        ).status,
        403,
      );
      for (let i = 0; i < 3; i++) {
        state.tests.push(make(`test-${i}`, 30));
        assert.equal(
          (await call('other', '/state', { state }, 'PUT')).status,
          200,
        );
      }
      const denied = await call(
        'other',
        '/state',
        { state: { ...state, tests: [...state.tests, make('fourth', 1)] } },
        'PUT',
      );
      assert.equal(denied.status, 403, JSON.stringify(denied));
      assert.equal((await call('other', '/state')).data.state.tests.length, 3);
      await call('other', '/state', { state: { ...state, tests: [] } }, 'PUT');
      assert.equal(
        (
          await call(
            'other',
            '/state',
            { state: { ...state, tests: [make('fifth', 1)] } },
            'PUT',
          )
        ).status,
        403,
      );
    },
  );
  await t.test('Live channels authenticate subscriptions and deliver saved changes to both sessions', async () => {
    const connect = (uid, channel, origin = 'https://qraft.test') => mf.dispatchFetch(`https://qraft.test/api/cloudflare/realtime?channel=${encodeURIComponent(channel)}`, { headers: { Upgrade: 'websocket', origin, cookie: `__Host-qraft_session=fixture-${uid}` } });
    assert.equal((await connect('other', 'admin')).status, 403);
    assert.equal((await connect('other', 'user:lite')).status, 403);
    assert.equal((await connect('other', 'bank:missing')).status, 403);
    assert.equal((await connect('other', 'user:other', 'https://evil.test')).status, 403);
    const first = await connect('other', 'user:other');
    const second = await connect('other', 'user:other');
    assert.equal(first.status, 101); assert.equal(second.status, 101);
    first.webSocket.accept(); second.webSocket.accept();
    const receive = socket => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No live update received')), 3000);
      socket.addEventListener('message', event => { clearTimeout(timeout); resolve(JSON.parse(event.data)); }, { once: true });
    });
    const received = Promise.all([receive(first.webSocket), receive(second.webSocket)]);
    const saved = await call('other', '/contact', { title: 'Live fixture', body: 'Saved before notifying', requestId: randomUUID() });
    assert.equal(saved.status, 200);
    assert.deepEqual(await received, [{ type: 'changed', topic: 'contact' }, { type: 'changed', topic: 'contact' }]);
    assert.equal((await call('other', `/contact?id=${saved.data.id}`)).data.messages[0].body, 'Saved before notifying');
    first.webSocket.close(); second.webSocket.close();
  });
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
        sourceReference: 'Fixture source',
        images: [],
      };
      assert.equal(
        (
          await call('lite', '/platform/import', {
            qbankId: 'smle-gs',
            requestId: randomUUID(),
            questions: [{ ...payload, options: [{}, 'B'] }],
          })
        ).status,
        400,
      );
      const request = {
        qbankId: 'smle-gs',
        requestId: randomUUID(),
        questions: [payload],
      };
      const first = await call('lite', '/platform/import', request);
      assert.equal(first.status, 200, JSON.stringify(first));
      assert.equal(first.data.successful, 1);
      assert.equal(
        (await call('lite', '/platform/import', request)).data.proposals[0].id,
        first.data.proposals[0].id,
      );
    },
  );
  await t.test('Bulk review approves or rejects up to 200 selected proposals atomically', async () => {
    const payload = index => ({
      stem: `Bulk fixture ${index}`,
      options: ['Correct', 'Incorrect'],
      answer: 0,
      specialty: 'General',
      topic: 'Bulk review',
      explanation: `Explanation ${index}`,
      sourceReference: `Source ${index}`,
      images: [],
    });
    const imported = await call('other', '/platform/import', {
      qbankId: 'smle-gs',
      requestId: randomUUID(),
      questions: Array.from({ length: 200 }, (_, index) => payload(index + 1)),
    });
    assert.equal(imported.status, 200, JSON.stringify(imported));
    assert.equal(imported.data.proposals.every(proposal => proposal.submissionMethod === 'json' && proposal.importBatchId), true);
    assert.equal(imported.data.proposals.length, 200);
    const approved = imported.data.proposals;
    const approval = await call('reviewer', '/platform/bulk-review', {
      proposalIds: approved.map(proposal => proposal.id),
      status: 'approved',
    });
    assert.deepEqual(approval, { status: 200, data: { ok: true, reviewed: 200 } });
    const rejectedImport = await call('other', '/platform/import', {
      qbankId: 'smle-gs',
      requestId: randomUUID(),
      questions: [payload(201)],
    });
    const [rejected] = rejectedImport.data.proposals;
    const rejection = await call('reviewer', '/platform/bulk-review', {
      proposalIds: [rejected.id],
      status: 'rejected',
    });
    assert.equal(rejection.status, 200);
    const stored = await db.prepare("SELECT payload FROM records WHERE type='questionProposals' AND json_extract(payload,'$.payload.topic')='Bulk review'").all();
    const reviewed = stored.results.map(row => JSON.parse(row.payload));
    assert.equal(reviewed.filter(proposal => proposal.status === 'approved' && proposal.reviewedById === 'reviewer').length, 200);
    assert.equal(reviewed.filter(proposal => proposal.status === 'rejected' && proposal.reviewedById === 'reviewer').length, 1);
    const published = await db.prepare("SELECT count(*) AS count FROM records WHERE type='sharedQuestions' AND json_extract(payload,'$.topic')='Bulk review'").first();
    assert.equal(published.count, 200);
    assert.equal((await call('reviewer', '/platform/bulk-review', { proposalIds: [approved[0].id], status: 'approved' })).status, 409);
    assert.equal((await call('other', '/platform/bulk-review', { proposalIds: [approved[0].id], status: 'rejected' })).status, 403);
    assert.equal((await call('reviewer', '/platform/bulk-review', { proposalIds: Array(201).fill('x'), status: 'approved' })).status, 400);
  });
  await t.test('Answer statistics preserve other users and accept option indexes', async () => {
    const row = await db.prepare("SELECT payload FROM records WHERE type='sharedQuestions' AND json_extract(payload,'$.questionId')='00002'").first();
    const question = JSON.parse(row.payload);
    const id = `stat-${question.id}`;
    const save = (uid, selections) => call(uid, '/collaboration', { operations: [{ collection: 'answerStats', type: 'set', id, value: { id, qbankId: 'smle-gs', questionId: question.id, selections } }] }, 'PUT');
    assert.equal((await save('lite', { lite: 0 })).status, 200);
    assert.equal((await save('other', { lite: 0, other: 1 })).status, 200);
    assert.equal((await save('lite', { lite: 2, other: 1 })).status, 200);
    assert.equal((await save('lite', { lite: 1, other: 2 })).status, 403);
    assert.equal((await save('lite', { lite: 99, other: 1 })).status, 403);
  });
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
      assert.equal(matches.data.users[0].uid, 'reviewer');
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
  await t.test('Tickets reject new images and deletion is restricted to owner or Superadmin', async () => {
    const draft = { title: 'Delete fixture', body: 'Text complaint', requestId: randomUUID() };
    assert.equal((await call('other', '/contact', { ...draft, attachment: 'data:image/png;base64,aGVsbG8=' })).status, 400);
    assert.equal((await db.prepare('SELECT count(*) AS total FROM ticket_messages WHERE id=?').bind(draft.requestId).first()).total, 0);
    const created = await call('other', '/contact', draft);
    assert.equal(created.status, 200);
    const id = created.data.id;
    assert.equal((await call('lite', '/contact', { id }, 'DELETE')).status, 404);
    assert.equal((await call('other', `/contact?id=${id}`)).status, 200);
    assert.equal((await call('other', '/contact', { id }, 'DELETE')).status, 200);
    assert.equal((await call('other', `/contact?id=${id}`)).status, 404);
    assert.equal((await db.prepare('SELECT count(*) AS total FROM ticket_messages WHERE ticket_id=?').bind(id).first()).total, 0);
    const second = await call('other', '/contact', { ...draft, requestId: randomUUID() });
    assert.equal((await call('admin', '/contact', { id: second.data.id }, 'DELETE')).status, 200);
    const audit = await db.prepare("SELECT count(*) AS total FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='ticket_deleted'").first();
    assert.equal(audit.total, 2);
  });
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
