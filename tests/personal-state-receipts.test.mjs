import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { compileFunction } from 'node:vm';

const built = await build({ stdin: { contents: `
export * from './features/state/client/state-receipt';
export {initialAppState} from './lib/medguard-types';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const m = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const source = ts.createSourceFile('app.tsx', readFileSync('components/medguard-app.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function extract(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      found = node.initializer.arguments?.[0] ?? node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Missing real application handler ${name}`);
  return ts.transpile(`(${found.getText(source)})`, { target: ts.ScriptTarget.ES2022 });
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function harness() {
  const session = { uid: 'a' };
  const snapshot = { ...m.initialAppState(), clientUpdatedAt: '2026-10-01T10:00:00.000Z', progress: { q: { note: 'before' } } };
  const pending = deferred();
  const ref = value => ({ current: value });
  const h = {
    user: { uid: 'a', status: 'approved' }, state: snapshot, collaboration: { answerStats: {} },
    allQuestions: [], allQuestionsById: new Map(), navigator: { onLine: true }, personalStateSession: ref(session),
    stateSnapshot: ref(snapshot), stateDirty: ref(true), cloudStateSnapshot: ref(undefined),
    liveSnapshot: ref({ user: { uid: 'a' }, collaboration: { answerStats: {} } }),
    cloudLoaded: ref(true), stateSyncInFlight: ref(false), checkpointInFlight: ref(0),
    hydratedIdentity: ref('a'), outboxReplayedFor: ref('a'),
    initialAppState: m.initialAppState,
    setUserRaw(value) { h.user = value; }, setHydrated() {}, setCollaborationHydrated() {},
    viewSnapshot: ref('dashboard'), flashcardReviewActive: ref(false), lastSavedCollaboration: ref({ answerStats: {} }),
    setStateRaw(value) { h.applied = value; h.stateSnapshot.current = value; },
    setSyncStatus(value) { h.status = value; }, setSyncIssue() {}, reportSyncError() {},
    resolvePersonalStateReceipt: m.resolvePersonalStateReceipt,
    saveLocalState: async (_uid, value) => { h.saved = value; },
    saveLocalCollaboration: async () => {}, loadRejectedCollaboration: async () => [],
    saveCloudState: () => pending.promise, saveDailyGoal: () => pending.promise,
    saveExamCheckpoint: () => pending.promise, saveFlashcardCheckpoint: () => pending.promise,
    saveCollaborationState: async () => ({ answerStats: {} }), mergeLiveState: (_old, latest) => latest,
  };
  const handler = name => compileFunction(`return ${extract(name)}`, Object.keys(h))(...Object.values(h));
  h.acceptPersonalStateReceipt = handler('acceptPersonalStateReceipt');
  return { h, pending, handler, snapshot };
}

for (const name of ['manualSync', 'persistDailyGoal', 'checkpointPersonalState', 'flushCloudState']) {
  void test(`${name}: a later server clock cannot erase an edit made during a slow save`, async () => {
    const { h, pending, handler, snapshot } = harness();
    const work = handler(name)(name === 'persistDailyGoal' ? 30 : 'flashcards');
    await Promise.resolve();
    const newer = { ...h.stateSnapshot.current, progress: { q: { note: 'during request' } }, clientUpdatedAt: '2026-10-01T10:00:01.000Z' };
    h.stateSnapshot.current = newer;
    pending.resolve({ ...snapshot, clientUpdatedAt: '2026-10-01T10:00:05.000Z' });
    await work;
    assert.equal(h.stateSnapshot.current, newer);
    assert.equal(h.stateDirty.current, true);
    assert.notEqual(h.status, 'synced');
  });
  void test(`${name}: a response from a previous login cannot change the current account or its status`, async () => {
    const { h, pending, handler, snapshot } = harness();
    const work = handler(name)(name === 'persistDailyGoal' ? 30 : 'flashcards');
    await Promise.resolve();
    const current = m.initialAppState();
    const setUser = handler('setUser');
    setUser(null);
    setUser({ uid: 'a' });
    h.stateSnapshot.current = current;
    h.stateDirty.current = false;
    h.status = 'new session';
    pending.resolve(snapshot);
    await work;
    assert.equal(h.stateSnapshot.current, current);
    assert.equal(h.status, 'new session');
    assert.equal(h.stateDirty.current, false);
  });
}
void test('a partial checkpoint cannot acknowledge an unsaved private note', () => {
  const session = { uid: 'a' }, state = m.initialAppState();
  const remote = { ...state, progress: {}, clientUpdatedAt: '2030-01-01T00:00:00Z' };
  const receipt = { session, snapshot: state, dirtyBefore: true, full: false };
  assert.deepEqual(m.resolvePersonalStateReceipt(receipt, session, state, remote), { state, dirty: true });
});
void test('confirmed full saves become clean; offline queueing remains pending', () => {
  const session = { uid: 'a' }, state = m.initialAppState();
  const receipt = { session, snapshot: state, dirtyBefore: true, full: true };
  assert.equal(m.resolvePersonalStateReceipt(receipt, session, state, state).dirty, false);
  assert.equal(m.resolvePersonalStateReceipt(receipt, session, state, undefined).dirty, true);
});

void test('consecutive local edits update the snapshot before React commits a render', () => {
  const { h, handler } = harness();
  const update = handler('setState');
  update(state => ({ ...state, settings: { ...state.settings, dailyGoal: 30 } }));
  update(state => ({ ...state, settings: { ...state.settings, dailyGoal: state.settings.dailyGoal + 1 } }));
  assert.equal(h.stateSnapshot.current.settings.dailyGoal, 31);
  assert.equal(h.stateDirty.current, true);
});
