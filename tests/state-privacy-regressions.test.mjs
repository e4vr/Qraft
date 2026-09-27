import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { indexedDB } from 'fake-indexeddb';

globalThis.indexedDB = indexedDB;
const compiled = await build({ stdin: { contents: `
export * from './lib/local-db';
export * from './lib/merge-app-state';
export { initialAppState, normalizeAppState } from './lib/medguard-types';
export * from './features/state/domain/state-budget';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

void test('the latest whole snapshot wins without resurrecting older reports or reviews', () => {
  const old = m.initialAppState(); const latest = m.initialAppState();
  old.clientUpdatedAt = '2026-09-27T10:00:00.000Z';
  latest.clientUpdatedAt = '2026-09-27T10:01:00.000Z';
  old.lastSyncAt = '2030-01-01T00:00:00.000Z';
  old.reports = [{ id: 'deleted-report', createdAt: old.clientUpdatedAt }];
  old.flashcardReviewLog = [{ id: 'old-log', reviewedAt: old.clientUpdatedAt }];
  assert.deepEqual(m.mergeAppStates(old, latest), m.normalizeAppState(latest));
  assert.deepEqual(m.mergeAppStates(latest, old), m.normalizeAppState(latest));
  const tied = { ...latest, settings: { ...latest.settings, dailyGoal: 10 } };
  assert.deepEqual(m.mergeAppStates(latest, tied), m.normalizeAppState(tied));
});

void test('members and guests have separate persisted attempts and account deletion preserves other participants', async () => {
  const attempt = name => ({ test: { id: 'same-test', version: 1, code: 'SAME' }, participantName: name, answers: { q1: 0 } });
  for (const scope of ['user:a', 'user:b', 'guest:one', 'guest:two'])
    await m.savePreformedAttempt(scope, attempt(scope));
  for (const scope of ['user:a', 'user:b', 'guest:one', 'guest:two'])
    assert.equal((await m.loadPreformedAttemptByCode(scope, 'SAME')).participantName, scope);
  assert.equal(await m.loadPreformedAttemptByCode('user:c', 'SAME'), undefined);
  await m.forgetLocalUser('a');
  assert.equal(await m.loadPreformedAttemptByCode('user:a', 'SAME'), undefined);
  await m.savePreformedAttempt('user:a', attempt('late async write'));
  assert.equal(await m.loadPreformedAttemptByCode('user:a', 'SAME'), undefined);
  assert.equal((await m.loadPreformedAttemptByCode('user:b', 'SAME')).participantName, 'user:b');
  assert.equal((await m.loadPreformedAttemptByCode('guest:one', 'SAME')).participantName, 'guest:one');
});

void test('capacity measures UTF-8 bytes and leaves the rejected state intact', () => {
  assert.equal(m.stateBytes('ا'), 4);
  const large = { note: 'ا'.repeat(800_000) };
  const before = JSON.stringify(large);
  assert.ok(m.stateBudgetError(large));
  assert.equal(JSON.stringify(large), before);
  assert.equal(m.stateBudgetError({ note: 'small' }), undefined);
});
