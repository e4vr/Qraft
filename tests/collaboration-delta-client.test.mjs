import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { indexedDB } from 'fake-indexeddb';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

globalThis.indexedDB = indexedDB;
const compiled = await build({ stdin: { contents: `export * from './features/collaboration/client/collaboration-client.ts';
  export * from './lib/local-db.ts'; export * from './lib/resource-data.ts';
  export {initialCollaborationState} from './lib/medguard-types.ts';
  export {mergeLiveState} from './lib/merge-live-state.ts';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
await mkdir('.ui-review', { recursive: true });
await writeFile('.ui-review/collaboration-delta-client.mjs', compiled.outputFiles[0].text);
const m = await import(pathToFileURL('.ui-review/collaboration-delta-client.mjs').href);

void test('client persists confirmed state and cursor together, coalesces signals, and preserves pending local drafts', async () => {
  m.clearResourceCache();
  const user = { uid: 'delta-client' }, other = { uid: 'delta-client-other' };
  const question = { id: 'q1', qbankId: 'smle-gs', stem: 'Before', options: ['A', 'B'], answer: 0, specialty: 'Medicine', topic: 'Therapy', images: [] };
  const proposal = { id: 'draft-target', qbankId: 'smle-gs', status: 'pending', proposedById: user.uid, payload: question, rationale: 'Before' };
  const base = { ...m.initialCollaborationState(), approvedQuestions: [question], proposals: [proposal] };
  const cursor = { version: 1, uid: user.uid, sequence: 10, scope: 'same-rights' };
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, uid: new Headers(init.headers).get('x-qraft-account') });
    return Response.json({ collaboration: base, cursor });
  };
  assert.deepEqual(await m.loadCollaborationState(user), base);
  const stored = await m.loadConfirmedCollaboration(user.uid);
  assert.deepEqual(stored, { collaboration: base, cursor });
  const local = { ...base, proposals: [{ ...proposal, rationale: 'Unsaved local edit' }] };
  await m.saveLocalCollaboration(local, user.uid);
  const delta = { cursor: { ...cursor, sequence: 11 }, syncedAt: '2026-10-02T05:00:00Z',
    resetBanks: [], catalog: { qbanks: base.qbanks, qbankFolders: base.qbankFolders, memberships: base.memberships },
    removed: [{ collection: 'sharedQuestions', id: 'q1' }],
    changes: { approvedQuestions: [], proposals: [{ ...proposal, id: 'new-proposal', rationale: 'Remote' }], specialties: [], topics: [], answerStats: {}, sharedNotes: {}, classificationRevisions: {} } };
  let finish;
  globalThis.fetch = async (url, init) => {
    requests.push({ url, uid: new Headers(init.headers).get('x-qraft-account') });
    return await new Promise(resolve => { finish = () => resolve(Response.json({ delta })); });
  };
  m.invalidateTags(['collaboration'], 'realtime:review-queue');
  const first = m.loadCollaborationState(user), second = m.loadCollaborationState(user);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(requests.length, 2);
  assert.match(requests.at(-1).url, /since=10.*syncUid=delta-client.*syncScope=same-rights/);
  finish();
  const [remote, duplicate] = await Promise.all([first, second]);
  assert.deepEqual(remote, duplicate);
  assert.equal(remote.approvedQuestions.length, 0);
  const merged = m.mergeLiveState(base, local, remote);
  assert.equal(merged.proposals.find(row => row.id === 'draft-target').rationale, 'Unsaved local edit');
  assert.equal(merged.proposals.some(row => row.id === 'new-proposal'), true);
  assert.equal(merged.approvedQuestions.length, 0);
  assert.deepEqual((await m.loadConfirmedCollaboration(user.uid)).cursor, delta.cursor);
  assert.equal((await m.loadLocalCollaboration(user.uid)).proposals[0].rationale, 'Unsaved local edit');
  // Session cache resets recover from the persisted confirmed snapshot.
  m.clearResourceCache();
  globalThis.fetch = async (url, init) => {
    requests.push({ url, uid: new Headers(init.headers).get('x-qraft-account') });
    return Response.json({ delta: { ...delta, changes: { ...delta.changes, proposals: [] } } });
  };
  await m.loadCollaborationState(user);
  assert.match(requests.at(-1).url, /since=11/);
  m.clearResourceCache();
  globalThis.fetch = async (url, init) => {
    requests.push({ url, uid: new Headers(init.headers).get('x-qraft-account') });
    return Response.json({ collaboration: m.initialCollaborationState(), cursor: { ...cursor, uid: other.uid } });
  };
  await m.loadCollaborationState(other);
  assert.equal(requests.at(-1).url, '/api/cloudflare/collaboration');
  assert.equal(requests.at(-1).uid, other.uid);
  await m.forgetLocalUser(user.uid);
  assert.equal(await m.loadConfirmedCollaboration(user.uid), undefined);
});

void test('a failed local save never advances the confirmed synchronization cursor', async () => {
  m.clearResourceCache();
  const uid = 'delta-storage-failure';
  const state = m.initialCollaborationState();
  const paths = [];
  globalThis.fetch = async url => { paths.push(url); return Response.json({ collaboration: state,
    cursor: { version: 1, uid, sequence: 20, scope: 'rights' } }); };
  globalThis.indexedDB = { open() { throw new Error('Storage unavailable'); } };
  try {
    await m.loadCollaborationState({ uid });
    await m.loadCollaborationState({ uid }, true);
    assert.deepEqual(paths, ['/api/cloudflare/collaboration', '/api/cloudflare/collaboration']);
  } finally { globalThis.indexedDB = indexedDB; }
  assert.equal(await m.loadConfirmedCollaboration(uid), undefined);
});
