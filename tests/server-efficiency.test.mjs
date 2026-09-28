import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { indexedDB } from 'fake-indexeddb';
import { mkdir, writeFile } from 'node:fs/promises';

globalThis.indexedDB = indexedDB;
const compiled = await build({ stdin: { contents: `
export * from './lib/local-db';
export * from './lib/api-client';
export * from './lib/resource-data';
export * from './lib/realtime-client';
export * from './features/state/client/state-sync-client';
export * from './features/collaboration/client/refresh-queue';
export { initialAppState } from './lib/medguard-types';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function globals(t, values) {
  const old = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
  t.after(() => { for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
}

void test('100 accounts compact 2000 offline exam checkpoints into 100 acknowledged requests without losing selections', async t => {
  const navigator = { onLine: false };
  let requests = 0;
  const received = new Map();
  globals(t, { navigator, fetch: async (_url, init) => {
    requests++;
    const uid = new Headers(init.headers).get('x-qraft-account');
    const input = JSON.parse(init.body);
    received.set(uid, input);
    return Response.json({ ok: true, state: { ...m.initialAppState(), ...input }, revision: 1, updatedAt: input.clientUpdatedAt });
  } });
  await Promise.all(Array.from({ length: 100 }, async (_, user) => {
    const uid = `efficiency-${user}`;
    for (let q = 0; q < 20; q++) {
      const state = { ...m.initialAppState(), clientUpdatedAt: new Date(1_800_000_000_000 + q).toISOString() };
      await m.saveExamCheckpoint(uid, state, [{ qbankId: 'bank', questionId: `q${q}`, answer: q % 4 }]);
    }
    const pending = await m.loadStateSyncOutbox(uid);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].attempts, 0);
    assert.equal(pending[0].payload.answerSelections.length, 20);
  }));
  assert.equal(requests, 0, 'answer/checkpoint persistence must stay local while offline');
  navigator.onLine = true;
  await Promise.all(Array.from({ length: 100 }, async (_, user) => {
    const uid = `efficiency-${user}`;
    await m.flushPendingCloudState(uid);
    assert.equal((await m.loadStateSyncOutbox(uid)).length, 0);
    assert.equal(received.get(uid).answerSelections.length, 20);
  }));
  assert.equal(requests, 100);
  await mkdir('outputs', { recursive: true });
  await writeFile('outputs/server-efficiency.json', JSON.stringify({ evidence: 'deterministic client test with fake IndexedDB and mocked API, not production traffic', accounts: 100, persistedOfflineCheckpoints: 2000, offlineHttpRequests: 0, reconnectHttpRequests: requests, selectionsPreserved: 2000 }, null, 2));
});

void test('attempted operations retain their IDs and payloads while newer unsent progress is compacted', async () => {
  const uid = 'immutable-checkpoint';
  const operation = n => ({ uid, id: `op-${n}`, kind: 'exam', baseRevision: 0, createdAt: String(n), attempts: 0,
    payload: { clientUpdatedAt: String(n), answerSelections: [{ qbankId: 'b', questionId: 'q', answer: n }] } });
  await m.enqueueStateSync(operation(1));
  await m.noteStateSyncAttempt(uid, 'op-1');
  await m.enqueueStateSync(operation(2));
  await m.enqueueStateSync(operation(3));
  const pending = await m.loadStateSyncOutbox(uid);
  assert.deepEqual(pending.map(item => item.id), ['op-1', 'op-3']);
  assert.equal(pending[0].payload.answerSelections[0].answer, 1);
  assert.equal(pending[1].payload.answerSelections[0].answer, 3);
  assert.equal(await m.noteStateSyncAttempt(uid, 'op-2'), undefined);
});

void test('coalescing keeps the freshest snapshot and respects the 500 selection server boundary', async () => {
  const make = (id, stamp, count) => ({ uid: 'bounded-checkpoint', id, kind: 'exam', baseRevision: 0, createdAt: id, attempts: 0,
    payload: { clientUpdatedAt: stamp, reports: [stamp], answerSelections: Array.from({ length: count }, (_, n) => ({ qbankId: id, questionId: String(n), answer: 0 })) } });
  await m.enqueueStateSync(make('a', '2026-09-27T12:00:00Z', 300));
  await m.enqueueStateSync(make('b', '2026-09-27T11:00:00Z', 1));
  let pending = await m.loadStateSyncOutbox('bounded-checkpoint');
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].payload.reports, ['2026-09-27T12:00:00Z']);
  await m.enqueueStateSync(make('c', '2026-09-27T13:00:00Z', 300));
  pending = await m.loadStateSyncOutbox('bounded-checkpoint');
  assert.equal(pending.length, 2);
  assert.ok(pending.every(item => item.payload.answerSelections.length <= 500));
});

void test('large exit checkpoints remain durable instead of exceeding keepalive quota', async t => {
  let requests = 0;
  globals(t, { navigator: { onLine: true }, fetch: async () => { requests++; throw new Error('Must not send'); } });
  const state = { ...m.initialAppState(), clientUpdatedAt: new Date().toISOString(), questionOverrides: { big: { explanation: 'x'.repeat(70_000) } } };
  m.saveBestEffortStateCheckpoint('large-exit', state, 'full');
  await pause(30);
  assert.equal(requests, 0);
  assert.equal((await m.loadStateSyncOutbox('large-exit'))[0].attempts, 0);
});

void test('preformed attempt and code reference commit together; late writes cannot undo submission or result', async () => {
  const attempt = { test: { id: 'atomic-test', code: 'ATOMIC', version: 1 }, submissionId: 'one', participantName: 'A', answers: { q: 2 }, elapsedSeconds: 5 };
  await m.savePreformedAttempt('user:atomic', attempt);
  await m.savePreformedAttempt('user:atomic', { ...attempt, submissionPending: true });
  await m.savePreformedAttempt('user:atomic', { ...attempt, answers: { q: 0 } });
  assert.equal((await m.loadPreformedAttemptByCode('user:atomic', 'ATOMIC')).answers.q, 2);
  const result = { score: 1, questionCount: 1, percentage: 100, rank: 1, leaderboard: true };
  await m.savePreformedAttempt('user:atomic', { ...attempt, submittedAt: 'now', result });
  await m.savePreformedAttempt('user:atomic', { ...attempt, submissionPending: true });
  assert.deepEqual((await m.loadPreformedAttemptByCode('user:atomic', 'ATOMIC')).result, result);
});

void test('overlapping realtime topics wake each consumer once and replay after a hidden tab resumes', async t => {
  const window = new EventTarget(); window.location = { origin: 'https://qraft.test' };
  const document = new EventTarget(); document.visibilityState = 'visible';
  const sockets = [];
  class Socket { constructor() { sockets.push(this); } close() {} }
  globals(t, { window, document, navigator: { onLine: true }, WebSocket: Socket });
  let refreshes = 0;
  const stop = m.openLiveChannels(['user:a', 'catalog', 'bank:a'], () => {});
  const unsubscribe = m.subscribeLive(() => { refreshes++; }, ['question-catalog', 'review-queue']);
  const event = { data: JSON.stringify({ type: 'resources_changed', resources: ['question-catalog', 'review-queue', 'audit'] }) };
  for (const socket of sockets) socket.onmessage(event);
  await pause(110);
  assert.equal(refreshes, 1);
  document.visibilityState = 'hidden';
  for (const socket of sockets) socket.onmessage(event);
  await pause(110);
  assert.equal(refreshes, 1);
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(refreshes, 2);
  unsubscribe(); stop();
});

void test('refresh queue collapses a burst and retains one change received during an active read', async () => {
  let reads = 0, release;
  const queue = m.createRefreshQueue(async () => { reads++; if (reads === 1) await new Promise(resolve => { release = resolve; }); });
  for (let i = 0; i < 100; i++) queue.request();
  await pause(0);
  assert.equal(reads, 1);
  for (let i = 0; i < 100; i++) queue.request();
  release();
  await pause(0);
  assert.equal(reads, 2);
  queue.stop(); queue.request();
  await pause(0);
  assert.equal(reads, 2);
});

void test('consumers after an in-flight invalidation share one fresh follow-up read', async () => {
  m.clearResourceCache();
  let release, reads = 0;
  const options = { key: 'invalidation-race', tags: ['race'], load: async () => { reads++; return reads === 1 ? new Promise(resolve => { release = resolve; }) : { revision: 2 }; } };
  const first = m.readThrough(options);
  m.invalidateTags(['race']);
  const waiting = Array.from({ length: 100 }, () => m.readThrough(options));
  release({ revision: 1 }); await first;
  assert.ok((await Promise.all(waiting)).every(value => value.revision === 2));
  assert.equal(reads, 2);
});
