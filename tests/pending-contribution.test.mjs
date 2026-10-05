import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const compiled = await build({
  entryPoints: ['features/collaboration/domain/collaboration-values.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { collaborationBaseHash } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

void test('pending contributions: author editing, independent review and live updates', async (t) => {
  await mkdir('.ui-review', { recursive: true });
  await build({
    stdin: {
      contents: `export {RealtimeChannel} from './workers/realtime.ts'; import {GET,POST,PUT,DELETE} from './app/api/cloudflare/[...path]/route.ts'; export default {fetch(request){return ({GET,POST,PUT,DELETE})[request.method](request)}}`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    external: ['cloudflare:workers'],
    outfile: '.ui-review/pending-contribution-worker.mjs',
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: '.ui-review/pending-contribution-worker.mjs',
      compatibilityDate: '2026-09-09',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'pending-contribution-test' },
      r2Buckets: { ASSETS: 'pending-contribution-assets' },
      durableObjects: {
        REALTIME: { className: 'RealtimeChannel', useSQLite: true },
      },
      bindings: { ROOT_ADMIN_EMAIL: 'admin@example.test' },
    }),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const sql = JSON.parse(
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
  if ch==';' and sqlite3.complete_statement(s):out.append(s);s=''
print(json.dumps(out))`,
      ],
      { encoding: 'utf8' },
    ),
  );
  for (const statement of sql) await db.prepare(statement).run();
  const now = new Date().toISOString(),
    bankId = 'pending-edit-bank';
  for (const uid of ['admin', 'author', 'other', 'reviewer', 'reviewer2']) {
    const profile = {
      uid,
      email: `${uid}@example.test`,
      displayName: uid,
      role: uid === 'admin' ? 'super_admin' : 'student',
      platformRoles: uid.startsWith('reviewer') ? ['reviewer'] : [],
      tier: 'free',
      status: 'approved',
      createdAt: now,
    };
    await db
      .prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)')
      .bind(
        uid,
        profile.email,
        '!',
        '!',
        JSON.stringify(profile),
        uid === 'admin' ? 'fixture-mfa' : null,
        now,
        now,
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
        now,
      )
      .run();
  }
  const put = (type, value) =>
    db
      .prepare(
        'INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        type,
        value.id,
        type === 'qbanks' ? null : bankId,
        value.proposedById ?? null,
        JSON.stringify(value),
        now,
      )
      .run();
  await put('qbanks', {
    id: bankId,
    name: 'Pending edit bank',
    ownerId: 'admin',
    visibility: 'public',
    createdAt: now,
    essential: false,
  });
  const call = async (uid, path, body, method = body ? 'POST' : 'GET') => {
    const response = await mf.dispatchFetch(
      `https://qraft.test/api/cloudflare${path}`,
      {
        method,
        headers: {
          origin: 'https://qraft.test',
          cookie: `__Host-qraft_session=fixture-${uid}`,
          'content-type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    return { status: response.status, data: await response.json() };
  };
  const read = async (id) =>
    JSON.parse(
      (
        await db
          .prepare(
            "SELECT payload FROM records WHERE type='questionProposals' AND id=?",
          )
          .bind(id)
          .first()
      ).payload,
    );
  const proposal = async (uid = 'author', changes = {}) => {
    const value = {
      id: randomUUID(),
      qbankId: bankId,
      type: 'new_question',
      editKinds: [
        'question_text',
        'options',
        'correct_answer',
        'explanation',
        'source',
      ],
      payload: {
        stem: randomUUID(),
        options: ['One', 'Two'],
        answer: 0,
        specialty: 'General',
        topic: 'General',
        explanation: 'Synthetic explanation',
        sourceFile: 'Fixture.pdf',
        sourceReference: 'Fixture.pdf',
        images: [],
      },
      rationale: 'Initial context',
      submissionMethod: 'manual',
      proposedById: uid,
      proposedByName: uid,
      proposedAt: now,
      status: 'pending',
      ...changes,
    };
    await put('questionProposals', value);
    return value;
  };
  const edit = (uid, previous, changes = {}) =>
    call(
      uid,
      '/collaboration',
      {
        operations: [
          {
            collection: 'questionProposals',
            id: previous.id,
            type: 'set',
            baseValue: previous,
            value: {
              ...previous,
              payload: {
                ...previous.payload,
                explanation: 'Revised explanation',
              },
              ...changes,
            },
          },
        ],
      },
      'PUT',
    );
  const review = async (uid, previous, status = 'approved') =>
    call(uid, '/platform/bulk-review', {
      proposalIds: [previous.id],
      status,
      expectedProposalHashes: {
        [previous.id]: await collaborationBaseHash(previous),
      },
    });

  await t.test(
    'free authors, reviewers and Superadmin edit their own pending content',
    async () => {
      for (const uid of ['author', 'reviewer', 'admin']) {
        const previous = await proposal(uid);
        const result = await edit(uid, previous);
        assert.equal(result.status, 200, JSON.stringify(result));
        const saved = await read(previous.id);
        assert.equal(saved.payload.explanation, 'Revised explanation');
        assert.equal(saved.proposedAt, previous.proposedAt);
        assert.equal(saved.status, 'pending');
        assert.ok(
          [403, 409].includes((await review(uid, saved)).status),
          'Independent review still required',
        );
      }
    },
  );
  await t.test(
    'other accounts cannot edit a pending submission and authors cannot forge review or identity',
    async () => {
      const previous = await proposal();
      for (const uid of ['other', 'reviewer', 'admin'])
        assert.equal((await edit(uid, previous)).status, 403);
      for (const changes of [
        { status: 'approved' },
        { proposedAt: new Date(Date.now() + 1000).toISOString() },
        { proposedById: 'other' },
        { proposedByName: 'Forged' },
        { questionId: 'forged' },
        { qbankId: 'missing' },
        { type: 'question_edit' },
        { reviewedById: 'reviewer' },
        { duplicateInfo: { type: 'possible', similarity: 0 } },
        { editKinds: ['typo_formatting'] },
      ])
        assert.equal(
          (await edit('author', previous, changes)).status,
          403,
          JSON.stringify(changes),
        );
      assert.deepEqual(await read(previous.id), previous);
    },
  );
  await t.test(
    'reviewer receives a live notification and reads the edited proposal immediately',
    async () => {
      const connection = await mf.dispatchFetch(
        `https://qraft.test/api/cloudflare/realtime?channel=review:bank:${bankId}&v=2`,
        {
          headers: {
            Upgrade: 'websocket',
            origin: 'https://qraft.test',
            cookie: '__Host-qraft_session=fixture-reviewer',
          },
        },
      );
      assert.equal(connection.status, 101);
      const socket = connection.webSocket;
      socket.accept();
      const packets = [];
      socket.addEventListener('message', (event) =>
        packets.push(JSON.parse(event.data)),
      );
      try {
        const previous = await proposal();
        const result = await edit('author', previous, {
          payload: {
            ...previous.payload,
            specialty: 'General Surgery',
            topic: 'Esophagus',
          },
        });
        assert.equal(result.status, 200);
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.ok(
          packets.some((packet) => packet.resources.includes('review-queue')),
        );
        const queue = await call('reviewer', '/collaboration');
        assert.equal(
          queue.data.collaboration.proposals.find(
            (item) => item.id === previous.id,
          ).payload.topic,
          'Esophagus',
        );
      } finally {
        socket.close();
      }
    },
  );
  await t.test(
    'stale edits conflict and a stale reviewer cannot approve an unseen revision',
    async () => {
      const previous = await proposal();
      assert.equal((await edit('author', previous)).status, 200);
      assert.equal(
        (await edit('author', previous, { rationale: 'Stale' })).status,
        409,
      );
      const stale = await review('reviewer', previous);
      assert.equal(stale.status, 409);
      assert.equal(stale.data.code, 'PROPOSAL_CHANGED');
      const saved = await read(previous.id);
      const approved = await review('reviewer', saved);
      assert.equal(approved.status, 200, JSON.stringify(approved));
      assert.equal(
        approved.data.updatedQuestions[0].explanation,
        'Revised explanation',
      );
      const final = await read(previous.id);
      assert.equal(final.status, 'approved');
      assert.equal(
        (
          await edit('author', final, {
            payload: {
              ...final.payload,
              explanation: 'Forbidden post-approval edit',
            },
          })
        ).status,
        403,
      );
      assert.equal((await read(previous.id)).status, 'approved');
    },
  );
  await t.test(
    'rejected submissions remain history and can only be resubmitted with a new identity',
    async () => {
      const previous = await proposal('author', { status: 'rejected' });
      assert.equal(
        (await edit('author', previous, { status: 'pending' })).status,
        403,
      );
      const next = { ...previous, id: randomUUID(), status: 'pending' };
      const submitted = await call(
        'author',
        '/collaboration',
        {
          operations: [
            {
              collection: 'questionProposals',
              id: next.id,
              type: 'set',
              baseValue: null,
              value: next,
            },
          ],
        },
        'PUT',
      );
      assert.equal(submitted.status, 200);
      assert.equal((await read(previous.id)).status, 'rejected');
      assert.equal((await read(next.id)).status, 'pending');
    },
  );
  await t.test(
    'content edits reset first approval; a high-risk change needs two fresh independent reviews',
    async () => {
      const question = {
        id: randomUUID(),
        questionId: '99101',
        qbankId: bankId,
        number: 1,
        stem: randomUUID(),
        options: ['One', 'Two'],
        answer: 0,
        answerLetter: 'A',
        specialty: 'General',
        topic: 'General',
        explanation: 'Original',
        sourceFile: 'Fixture.pdf',
        sourceReference: 'Fixture.pdf',
        images: [],
        revision: 1,
      };
      await put('sharedQuestions', question);
      await db
        .prepare('INSERT INTO question_ids VALUES(?,?,?,?)')
        .bind(question.questionId, bankId, 'admin', now)
        .run();
      const previous = await proposal('author', {
        type: 'question_edit',
        questionId: question.id,
        currentSnapshot: question,
        payload: { ...question, answer: 1 },
        editKinds: ['correct_answer'],
      });
      assert.equal(
        (await review('reviewer', previous)).data.awaitingSecondReview,
        1,
      );
      assert.equal(
        await db
          .prepare(
            'SELECT count(*) FROM contribution_reviews WHERE proposal_id=?',
          )
          .bind(previous.id)
          .first('count(*)'),
        1,
      );
      assert.equal((await edit('author', previous)).status, 200);
      assert.equal(
        await db
          .prepare(
            'SELECT count(*) FROM contribution_reviews WHERE proposal_id=?',
          )
          .bind(previous.id)
          .first('count(*)'),
        0,
      );
      const saved = await read(previous.id);
      assert.equal(
        (await review('reviewer2', saved)).data.awaitingSecondReview,
        1,
      );
      assert.equal((await read(previous.id)).status, 'pending');
      assert.equal((await review('reviewer', saved)).data.reviewed, 1);
      assert.equal((await read(previous.id)).status, 'approved');
    },
  );
  await t.test(
    'changing an answer upgrades a low-risk pending edit before review',
    async () => {
      const previous = await proposal('author', {
        type: 'question_edit',
        editKinds: ['typo_formatting'],
        questionId: 'synthetic-existing',
      });
      const result = await edit('author', previous, {
        payload: { ...previous.payload, answer: 1 },
      });
      assert.equal(result.status, 200);
      assert.ok((await read(previous.id)).editKinds.includes('correct_answer'));
    },
  );
  await t.test(
    'legacy defaults and renamed classifications use the same versions seen by authors and reviewers',
    async () => {
      await put('qbankSpecialties', {
        id: 'renamed-specialty',
        qbankId: bankId,
        name: 'General Surgery',
        order: 0,
        createdAt: now,
        updatedAt: now,
      });
      const previous = await proposal();
      const legacy = {
        ...previous,
        payload: {
          ...previous.payload,
          sourceReference: undefined,
          specialtyId: 'renamed-specialty',
          specialty: 'Old specialty name',
        },
      };
      await db
        .prepare(
          "UPDATE records SET payload=? WHERE type='questionProposals' AND id=?",
        )
        .bind(JSON.stringify(legacy), legacy.id)
        .run();
      const shown = (
        await call('author', '/collaboration')
      ).data.collaboration.proposals.find((item) => item.id === legacy.id);
      assert.equal(shown.payload.specialty, 'General Surgery');
      assert.equal((await edit('author', shown)).status, 200);
      const latest = (
        await call('reviewer', '/collaboration')
      ).data.collaboration.proposals.find((item) => item.id === legacy.id);
      assert.equal((await review('reviewer', latest)).status, 200);
    },
  );
  await t.test(
    'concurrent author edit and reviewer approval cannot publish a different unreviewed revision',
    async () => {
      const previous = await proposal();
      const outcomes = await Promise.all([
        edit('author', previous),
        review('reviewer', previous),
      ]);
      assert.equal(
        outcomes.filter((result) => result.status === 200).length,
        1,
        JSON.stringify(outcomes),
      );
      assert.ok(outcomes.some((result) => [403, 409].includes(result.status)));
      const saved = await read(previous.id);
      if (saved.status === 'approved')
        assert.equal(saved.payload.explanation, previous.payload.explanation);
      else assert.equal(saved.payload.explanation, 'Revised explanation');
      assert.equal(
        await db
          .prepare('SELECT count(*) FROM collaboration_write_guards')
          .first('count(*)'),
        0,
      );
    },
  );
  await t.test(
    'an audit failure rolls back the content change and invalidation of prior approval',
    async () => {
      const previous = await proposal();
      await db
        .prepare(
          "INSERT INTO contribution_reviews VALUES(?,?,?,?,'approved',1,?,'{}')",
        )
        .bind(randomUUID(), previous.id, 'author', 'reviewer', now)
        .run();
      await db
        .prepare(
          "CREATE TRIGGER pending_edit_fail BEFORE INSERT ON records WHEN NEW.type='auditLog' AND json_extract(NEW.payload,'$.action')='questionProposals_set' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END",
        )
        .run();
      try {
        assert.equal((await edit('author', previous)).status, 500);
      } finally {
        await db.prepare('DROP TRIGGER pending_edit_fail').run();
      }
      assert.deepEqual(await read(previous.id), previous);
      assert.equal(
        await db
          .prepare(
            'SELECT count(*) FROM contribution_reviews WHERE proposal_id=?',
          )
          .bind(previous.id)
          .first('count(*)'),
        1,
      );
      assert.equal(
        await db
          .prepare('SELECT count(*) FROM collaboration_write_guards')
          .first('count(*)'),
        0,
      );
    },
  );
});

void test('pending contribution client sends immutable identity and waits for the server receipt', async (t) => {
  const bundle = await build({
    entryPoints: ['features/contributions/client/pending-contribution.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  const { savePendingContribution } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
  );
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const previous = {
    id: 'proposal',
    proposedById: 'author',
    proposedAt: '2026-10-01T00:00:00Z',
    status: 'pending',
    payload: { stem: 'Original' },
    rationale: 'Initial',
  };
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body).operations[0];
    assert.equal(new Headers(init.headers).get('x-qraft-account'), 'author');
    return Response.json({
      ok: true,
      operations: [
        {
          ...sent,
          value: { ...sent.value, duplicateReview: { status: 'flagged' } },
        },
      ],
    });
  };
  const saved = await savePendingContribution(
    'author',
    previous,
    { stem: 'Edited' },
    'Revised',
  );
  assert.equal(sent.value.proposedAt, previous.proposedAt);
  assert.equal(sent.baseHash, await collaborationBaseHash(previous));
  assert.equal(saved.duplicateReview.status, 'flagged');
  globalThis.fetch = async () =>
    Response.json({ ok: true, unchanged: true, operations: [] });
  assert.equal(
    (
      await savePendingContribution(
        'author',
        previous,
        { stem: 'Already saved' },
        'Revised',
      )
    ).payload.stem,
    'Already saved',
  );
  for (const invalid of [
    { ...previous, status: 'approved' },
    { ...previous, status: 'rejected' },
    { ...previous, proposedById: 'other' },
  ])
    await assert.rejects(
      savePendingContribution('author', invalid, {}, ''),
      /Only your pending/,
    );
  globalThis.fetch = async () => Response.json({ ok: false });
  await assert.rejects(
    savePendingContribution('author', previous, {}, ''),
    (error) => error.status === 502,
  );
});
