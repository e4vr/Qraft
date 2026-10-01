import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { indexedDB } from 'fake-indexeddb';

globalThis.indexedDB = indexedDB;
const compiled = await build({
  stdin: {
    contents: `
export * from './features/collaboration/client/collaboration-client';
export * from './features/qbanks/client/qbank-client';
export * from './lib/local-db';
export {initialCollaborationState, normalizeCollaborationState} from './lib/medguard-types';
export {canDeleteBank, canManageBank} from './features/access/domain/access-policy';
`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const m = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const empty = () => ({ ...m.initialCollaborationState(), qbanks: [] });
const bank = (id) => ({
  id,
  ownerId: 'owner',
  name: id,
  visibility: 'public',
  essential: false,
});

void test('deletion permissions depend on ownership or Superadmin, including Essential banks', () => {
  for (const role of ['student', 'admin', 'reviewer', 'access_manager']) {
    assert.equal(m.canDeleteBank({ uid: 'other', role }, bank('a')), false);
    assert.equal(
      m.canDeleteBank(
        { uid: 'owner', role },
        { ...bank('a'), essential: true },
      ),
      true,
    );
  }
  const root = { uid: 'root', role: 'super_admin' };
  assert.equal(m.canManageBank(root, bank('a')), true);
  assert.equal(m.canDeleteBank(root, { ...bank('a'), essential: true }), true);
  assert.deepEqual(m.normalizeCollaborationState({ qbanks: [] }).qbanks, []);
});

void test('deleting a large bank produces one parent operation rather than hundreds of child deletes', () => {
  const before = {
    ...empty(),
    qbanks: [{ ...bank('a'), shareToken: 'link' }],
    sharedNotes: Object.fromEntries(
      Array.from({ length: 650 }, (_, i) => [
        `note-${i}`,
        { id: `note-${i}`, qbankId: 'a' },
      ]),
    ),
  };
  assert.deepEqual(m.collaborationChangeSet(empty(), before), [
    { collection: 'qbanks', id: 'a', type: 'delete', baseValue: before.qbanks[0] },
  ]);
});

void test('a rejected group is preserved locally while an unrelated bank synchronizes and leaves no poisoned outbox', async (t) => {
  const fetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetch;
  });
  const before = empty();
  const next = { ...before, qbanks: [bank('good'), bank('bad')] };
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    if (init.method === 'PUT') {
      const operations = JSON.parse(init.body).operations;
      sent.push(operations.map((op) => op.id));
      if (operations.some((op) => op.id === 'bad'))
        return Response.json(
          {
            code: 'COLLABORATION_REJECTED',
            error: 'Access revoked',
            rejected: [{ collection: 'qbanks', id: 'bad' }],
          },
          { status: 403 },
        );
      return Response.json({ ok: true });
    }
    return Response.json({
      collaboration: { ...before, qbanks: [bank('good')] },
    });
  };
  const saved = await m.saveCollaborationState(next, before, 'recovery');
  assert.deepEqual(
    saved.qbanks.map((item) => item.id),
    ['good'],
  );
  assert.deepEqual(sent, [['good', 'bad'], ['good']]);
  assert.equal(await m.loadCollaborationSyncOutbox('recovery'), undefined);
  const retained = await m.loadRejectedCollaboration('recovery');
  assert.equal(retained.length, 1);
  assert.equal(
    retained[0].snapshot.state.qbanks.some((item) => item.id === 'bad'),
    true,
  );
  assert.equal(retained[0].details.group, 'bad');
});

void test('peer-only answer statistics do not send empty patches or reject unrelated bank changes', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const uid = 'answer-patch-recovery';
  const stat = (id, selections) => ({ id, qbankId: 'a', questionId: id, selections });
  const before = {
    ...empty(), qbanks: [bank('a')],
    answerStats: {
      'no-own-answer': stat('no-own-answer', { peer: 0 }),
      'same-own-answer': stat('same-own-answer', { [uid]: 0, peer: 0 }),
      'changed-own-answer': stat('changed-own-answer', { [uid]: 0, peer: 0 }),
    },
  };
  const next = {
    ...before, qbanks: [{ ...bank('a'), name: 'Updated bank' }],
    answerStats: {
      'no-own-answer': stat('no-own-answer', { peer: 1 }),
      'same-own-answer': stat('same-own-answer', { [uid]: 0, peer: 1 }),
      'changed-own-answer': stat('changed-own-answer', { [uid]: 1, peer: 1 }),
      'new-own-answer': stat('new-own-answer', { [uid]: 0 }),
      'empty-stat': stat('empty-stat', {}),
    },
  };
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, 'PUT');
    const operations = JSON.parse(init.body).operations;
    sent.push(operations);
    for (const operation of operations.filter(o => o.collection === 'answerStats')) {
      assert.deepEqual(Object.keys(operation.value.selections), [uid]);
      assert.equal(typeof operation.value.selections[uid], 'number');
    }
    return Response.json({ ok: true });
  };
  await m.saveCollaborationState(next, before, uid);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].map(o => o.id), ['a', 'changed-own-answer', 'new-own-answer']);
  assert.equal((await m.loadRejectedCollaboration(uid)).length, 0);
  assert.equal(await m.loadCollaborationSyncOutbox(uid), undefined);
});

void test('a peer-only statistics refresh completes without any write or rejection', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { assert.fail('A peer-only refresh must not send a request.'); };
  const uid = 'peer-only-refresh';
  const before = { ...empty(), answerStats: { s: { id: 's', qbankId: 'a', questionId: 'q', selections: { peer: 0 } } } };
  const next = { ...before, answerStats: { s: { ...before.answerStats.s, selections: { peer: 1 } } } };
  await m.saveCollaborationState(next, before, uid);
  assert.equal((await m.loadRejectedCollaboration(uid)).length, 0);
  assert.equal(await m.loadCollaborationSyncOutbox(uid), undefined);
});

void test('acknowledging an in-flight batch rebases newer changes instead of resending already accepted changes', async (t) => {
  const fetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetch;
  });
  let release;
  let started;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const beginning = new Promise((resolve) => {
    started = resolve;
  });
  const batches = [];
  globalThis.fetch = async (_url, init) => {
    batches.push(JSON.parse(init.body).operations.map((op) => op.id));
    if (batches.length === 1) {
      started();
      await held;
    }
    return Response.json({ ok: true });
  };
  const before = empty(),
    first = { ...before, qbanks: [bank('first')] };
  await m.queueCollaborationState('concurrent', first, before);
  const flushing = m.flushPendingCollaborationState('concurrent');
  await beginning;
  await m.queueCollaborationState(
    'concurrent',
    { ...first, qbanks: [...first.qbanks, bank('second')] },
    before,
  );
  release();
  await flushing;
  assert.deepEqual(batches, [['first'], ['second']]);
  assert.equal(await m.loadCollaborationSyncOutbox('concurrent'), undefined);
});

void test('a malformed old draft is isolated without blocking a valid bank', async (t) => {
  const fetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetch;
  });
  const before = empty(),
    next = { ...before, qbanks: [bank('valid'), bank('malformed')] };
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    if (init.method === 'PUT') {
      const ids = JSON.parse(init.body).operations.map((op) => op.id);
      sent.push(ids);
      return ids.includes('malformed')
        ? Response.json({ error: 'Invalid legacy draft.' }, { status: 400 })
        : Response.json({ ok: true });
    }
    return Response.json({
      collaboration: { ...before, qbanks: [bank('valid')] },
    });
  };
  const confirmed = await m.saveCollaborationState(
    next,
    before,
    'validation-recovery',
  );
  assert.deepEqual(sent, [['valid', 'malformed'], ['valid'], ['malformed']]);
  assert.deepEqual(
    confirmed.qbanks.map((item) => item.id),
    ['valid'],
  );
  assert.equal(
    (await m.loadRejectedCollaboration('validation-recovery'))[0].snapshot.state
      .qbanks.length,
    2,
  );
  assert.equal(
    await m.loadCollaborationSyncOutbox('validation-recovery'),
    undefined,
  );
});

void test('an oversized bank draft stays recoverable while a small bank can synchronize', async (t) => {
  const fetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetch;
  });
  const before = empty(),
    next = {
      ...before,
      qbanks: [bank('large'), bank('small')],
      specialties: Array.from({ length: 500 }, (_, i) => ({
        id: `specialty-${i}`,
        qbankId: 'large',
        name: 'Draft',
      })),
    };
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    if (init.method === 'PUT') {
      sent.push(JSON.parse(init.body).operations.map((op) => op.id));
      return Response.json({ ok: true });
    }
    return Response.json({
      collaboration: { ...before, qbanks: [bank('small')] },
    });
  };
  await m.saveCollaborationState(next, before, 'large-recovery');
  assert.deepEqual(sent, [['small']]);
  assert.equal(
    (await m.loadRejectedCollaboration('large-recovery'))[0].snapshot.state
      .specialties.length,
    500,
  );
  assert.equal(
    await m.loadCollaborationSyncOutbox('large-recovery'),
    undefined,
  );
});

void test('undoing an unsent edit cancels it without replaying an older outbox snapshot', async (t) => {
  const fetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetch;
  });
  const before = { ...empty(), qbanks: [bank('undo')] };
  await m.queueCollaborationState(
    'undo',
    { ...before, qbanks: [{ ...bank('undo'), name: 'Edited' }] },
    before,
  );
  await m.queueCollaborationState('undo', before, before);
  globalThis.fetch = async () => {
    throw new Error('An undone edit must not be sent.');
  };
  await m.flushPendingCollaborationState('undo');
  assert.equal(await m.loadCollaborationSyncOutbox('undo'), undefined);
});

void test('connection errors, changed accounts and unreadable successes retain the outbox for retry', async (t) => {
  const fetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetch;
  });
  for (const [uid, response] of [
    [
      'offline',
      () => {
        throw new TypeError('Disconnected');
      },
    ],
    [
      'account',
      () => Response.json({ code: 'ACCOUNT_CHANGED' }, { status: 409 }),
    ],
    ['truncated', () => new Response('{')],
  ]) {
    globalThis.fetch = async () => response();
    await m.queueCollaborationState(
      uid,
      { ...empty(), qbanks: [bank(uid)] },
      empty(),
    );
    await assert.rejects(m.flushPendingCollaborationState(uid));
    assert.ok(await m.loadCollaborationSyncOutbox(uid));
    assert.equal((await m.loadRejectedCollaboration(uid)).length, 0);
    globalThis.fetch = async () => Response.json({ ok: true });
    await m.flushPendingCollaborationState(uid);
    assert.equal(await m.loadCollaborationSyncOutbox(uid), undefined);
  }
});

void test('server-confirmed bank mutations rebase old snapshots without losing unrelated drafts', async (t) => {
  const fetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetch;
  });
  const before = { ...empty(), qbanks: [bank('existing')] };
  await m.queueCollaborationState(
    'lifecycle-client',
    { ...before, qbanks: [...before.qbanks, bank('pending')] },
    before,
  );
  globalThis.fetch = async (_url, init) =>
    init.method === 'POST'
      ? Response.json({ ok: true, bank: JSON.parse(init.body).bank })
      : Response.json({ ok: true, deletedId: 'existing' });
  await m.createQBank('lifecycle-client', bank('confirmed'));
  await m.deleteQBank('lifecycle-client', 'existing');
  const queued = await m.loadCollaborationSyncOutbox('lifecycle-client');
  assert.deepEqual(
    queued.base.qbanks.map((item) => item.id),
    ['confirmed'],
  );
  assert.deepEqual(
    queued.state.qbanks.map((item) => item.id),
    ['pending', 'confirmed'],
  );
  assert.deepEqual(
    m.collaborationChangeSet(queued.state, queued.base).map((op) => op.id),
    ['pending'],
  );
  // An older render queued late must not undo the confirmed bank mutation.
  await m.queueCollaborationState(
    'lifecycle-client',
    {
      ...before,
      qbanks: [...before.qbanks, bank('pending'), bank('late-draft')],
    },
    before,
  );
  const late = await m.loadCollaborationSyncOutbox('lifecycle-client');
  assert.deepEqual(late.state.qbanks.map((item) => item.id).sort(), [
    'confirmed',
    'late-draft',
    'pending',
  ]);
  assert.deepEqual(
    m
      .collaborationChangeSet(late.state, late.base)
      .map((op) => op.id)
      .sort(),
    ['late-draft', 'pending'],
  );
});
