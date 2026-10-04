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
export * from './features/collaboration/domain/proposal-delete-recovery';
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

const deletionFixture = (uid, count = 614) => {
  const proposals = Array.from({ length: count }, (_, i) => ({ id: `${uid}-p-${i}`, qbankId: 'surgery',
    type: 'new_question', status: i < count - 22 ? 'approved' : 'rejected', proposedById: uid,
    payload: { stem: `Synthetic question ${i}`, options: ['A', 'B'], answer: 0 },
  }));
  const base = { ...empty(), qbanks: [bank('surgery')], proposals };
  const snapshot = { id: crypto.randomUUID(), uid, base, state: { ...base, proposals: [] }, createdAt: new Date().toISOString(), attempts: 0 };
  const operations = m.collaborationChangeSet(snapshot.state, base);
  return { snapshot, operations };
};

void test('614 independent proposal deletes synchronize sequentially in batches of 500 and 114', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const uid = 'delete-614', { snapshot } = deletionFixture(uid), sizes = [];
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, 'PUT');
    const operations = JSON.parse(init.body).operations;
    sizes.push(operations.length);
    assert.ok(new TextEncoder().encode(init.body).byteLength <= 1_700_000);
    assert.ok(operations.every(operation => operation.collection === 'questionProposals' && operation.type === 'delete' && operation.baseHash.length === 64));
    return Response.json({ ok: true });
  };
  await m.saveCollaborationState(snapshot.state, snapshot.base, uid);
  assert.deepEqual(sizes, [500, 114]);
  assert.equal(await m.loadCollaborationSyncOutbox(uid), undefined);
  assert.equal((await m.loadRejectedCollaboration(uid)).length, 0);
});

void test('an interrupted deletion resumes only the remaining 114 operations', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const uid = 'delete-interrupted', { snapshot } = deletionFixture(uid), sizes = [];
  globalThis.fetch = async (_url, init) => {
    sizes.push(JSON.parse(init.body).operations.length);
    if (sizes.length === 2) throw new TypeError('Disconnected');
    return Response.json({ ok: true });
  };
  await m.queueCollaborationState(uid, snapshot.state, snapshot.base);
  await assert.rejects(m.flushPendingCollaborationState(uid));
  const pending = await m.loadCollaborationSyncOutbox(uid);
  assert.equal(m.collaborationChangeSet(pending.state, pending.base).length, 114);
  await m.flushPendingCollaborationState(uid);
  assert.deepEqual(sizes, [500, 114, 114]);
  assert.equal(await m.loadCollaborationSyncOutbox(uid), undefined);
});

void test('manual retry recovers a legacy oversized draft and checkpoints each confirmed batch', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const uid = 'legacy-delete-retry', { snapshot, operations } = deletionFixture(uid), sizes = [];
  await m.preserveRejectedCollaboration(snapshot, { group: 'surgery', error: 'Synchronization limit', operations });
  let remote = snapshot.base;
  globalThis.fetch = async (_url, init) => {
    if (init.method !== 'PUT') return Response.json({ collaboration: remote });
    const batch = JSON.parse(init.body).operations; sizes.push(batch.length);
    if (sizes.length === 2) throw new TypeError('Disconnected');
    remote = m.withoutProposals(remote, new Set(batch.map(operation => operation.id)));
    return Response.json({ ok: true });
  };
  await assert.rejects(m.retryRejectedCollaborationState(uid));
  const retained = await m.loadRejectedCollaboration(uid);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].details.operations.length, 114);
  const result = await m.retryRejectedCollaborationState(uid);
  assert.deepEqual(sizes, [500, 114, 114]);
  assert.equal(result.proposals.length, 0);
  assert.equal((await m.loadRejectedCollaboration(uid)).length, 0);
  assert.equal(await m.retryRejectedCollaborationState(uid), undefined);
});

void test('manual retry keeps changed records and unrelated bank drafts without replaying snapshot fields', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const uid = 'changed-delete-retry', { snapshot, operations } = deletionFixture(uid, 3);
  snapshot.state.qbanks = [{ ...bank('surgery'), name: 'Old unsent bank edit' }];
  await m.preserveRejectedCollaboration(snapshot, { group: 'surgery', operations });
  await m.preserveRejectedCollaboration({ ...snapshot, id: 'unrelated' }, { group: 'other', operations: [{ collection: 'qbanks', type: 'set', id: 'other', value: bank('other'), baseValue: null }] });
  const remote = { ...snapshot.base, proposals: snapshot.base.proposals.map((p, i) => i === 0 ? { ...p, status: 'pending' } : p) };
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    if (init.method !== 'PUT') return Response.json({ collaboration: remote });
    sent.push(...JSON.parse(init.body).operations);
    return Response.json({ ok: true });
  };
  const result = await m.retryRejectedCollaborationState(uid);
  assert.deepEqual(sent.map(operation => operation.id), operations.slice(1).map(operation => operation.id));
  assert.equal(result.qbanks[0].name, 'surgery');
  assert.equal(result.proposals[0].status, 'pending');
  const retained = await m.loadRejectedCollaboration(uid);
  assert.equal(retained.length, 2);
  assert.equal(retained[0].details.operations.length, 1);
  assert.equal(retained[1].details.operations[0].collection, 'qbanks');
});

void test('missing or unauthorized proposals require server confirmation before their draft is cleared', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const uid = 'hidden-delete-retry', { snapshot, operations } = deletionFixture(uid, 1);
  await m.preserveRejectedCollaboration(snapshot, { group: 'surgery', operations });
  let denied = true, attempts = 0;
  globalThis.fetch = async (_url, init) => {
    if (init.method !== 'PUT') return Response.json({ collaboration: empty() });
    attempts++;
    return denied ? Response.json({ error: 'Permission revoked' }, { status: 403 }) : Response.json({ ok: true, unchanged: true });
  };
  await m.retryRejectedCollaborationState(uid);
  assert.equal((await m.loadRejectedCollaboration(uid)).length, 1);
  denied = false;
  await m.retryRejectedCollaborationState(uid);
  assert.equal((await m.loadRejectedCollaboration(uid)).length, 0);
  assert.equal(attempts, 2);
});

void test('a changed account retains every preserved deletion for the original account', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const uid = 'account-delete-retry', { snapshot, operations } = deletionFixture(uid, 1);
  await m.preserveRejectedCollaboration(snapshot, { group: 'surgery', operations });
  globalThis.fetch = async () => Response.json({ code: 'ACCOUNT_CHANGED', error: 'Account changed' }, { status: 409 });
  await assert.rejects(m.retryRejectedCollaborationState(uid));
  assert.equal((await m.loadRejectedCollaboration(uid))[0].details.operations.length, 1);
});

void test('batching counts encoded bytes and keeps dependent publication or classification operations together', () => {
  const large = { collection: 'questionProposals', type: 'delete', id: 'س'.repeat(450_000), baseValue: null };
  assert.deepEqual(m.splitProposalDeleteGroup([large, { ...large, id: 'ص'.repeat(450_000) }]).map(batch => batch.length), [1, 1]);
  const dependent = [{ ...large, collection: 'sharedQuestions', type: 'set' }, ...Array.from({ length: 500 }, (_, i) => ({ ...large, id: String(i) }))];
  assert.equal(m.splitProposalDeleteGroup(dependent).length, 1);
  assert.equal(m.collaborationBatchFits(dependent), false);
  assert.deepEqual(m.proposalDeleteOperations({ operations: [deletionFixture('atomic', 1).operations[0], dependent[0]] }), []);
});

void test('simultaneous manual retry clicks do not duplicate successful deletion batches', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const uid = 'double-click-retry', { snapshot, operations } = deletionFixture(uid), sizes = [];
  await m.preserveRejectedCollaboration(snapshot, { group: 'surgery', operations });
  globalThis.fetch = async (_url, init) => {
    if (init.method !== 'PUT') return Response.json({ collaboration: snapshot.base });
    sizes.push(JSON.parse(init.body).operations.length);
    return Response.json({ ok: true });
  };
  await Promise.all([m.retryRejectedCollaborationState(uid), m.retryRejectedCollaborationState(uid)]);
  assert.deepEqual(sizes, [500, 114]);
  assert.equal((await m.loadRejectedCollaboration(uid)).length, 0);
});

void test('a successful partial checkpoint keeps newer local edits and remaining deletes', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const uid = 'newer-delete-edit', { snapshot } = deletionFixture(uid);
  let sends = 0;
  globalThis.fetch = async () => {
    sends++;
    if (sends === 2) throw new TypeError('Disconnected');
    await m.queueCollaborationState(uid, { ...snapshot.state, qbanks: [{ ...bank('surgery'), name: 'Newer local name' }] }, snapshot.base);
    return Response.json({ ok: true });
  };
  await m.queueCollaborationState(uid, snapshot.state, snapshot.base);
  await assert.rejects(m.flushPendingCollaborationState(uid));
  const pending = await m.loadCollaborationSyncOutbox(uid);
  assert.equal(pending.base.proposals.length, 114);
  assert.equal(pending.state.proposals.length, 0);
  assert.equal(pending.state.qbanks[0].name, 'Newer local name');
  assert.equal(m.collaborationChangeSet(pending.state, pending.base).length, 115);
});

void test('a proposal edited during its in-flight deletion is preserved as a reviewable draft', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const uid = 'concurrent-proposal-edit', { snapshot } = deletionFixture(uid, 1);
  const edited = { ...snapshot.base.proposals[0], authorName: 'Newer local edit' };
  globalThis.fetch = async () => {
    await m.queueCollaborationState(uid, { ...snapshot.state, proposals: [edited] }, snapshot.base);
    return Response.json({ ok: true });
  };
  await m.queueCollaborationState(uid, snapshot.state, snapshot.base);
  await m.flushPendingCollaborationState(uid);
  assert.equal(await m.loadCollaborationSyncOutbox(uid), undefined);
  const drafts = await m.loadRejectedCollaboration(uid);
  assert.ok(drafts.some(draft => draft.snapshot.state.proposals.some(proposal => proposal.id === edited.id && proposal.authorName === edited.authorName)), 'server deletion must not silently discard the newer local proposal edit');
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
