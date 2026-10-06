import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { indexedDB } from 'fake-indexeddb';
import { zipSync, strToU8 } from 'fflate';

globalThis.indexedDB = indexedDB;
const compile = async contents => {
  const result = await build({ stdin: { contents, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
};
const m = await compile("export * from './features/imports/domain/import-workspace'; export * from './features/imports/client/import-draft-store'; export * from './features/imports/client/open-import-workspace'; export * from './lib/question-import';");
const input = { stem: 'Which treatment is appropriate for this synthetic patient with chest pain?', options: ['First', 'Second'], correctAnswer: 'B', sourceFile: 'Original.pdf', explanation: 'Reason', specialty: 'General', topic: 'Topic' };
const draft = (questions = [input], bank = 'safety-bank') => m.draftFromReport(m.parseQuestionImportReport({ questions }), bank, 'file.json', 'a'.repeat(64), JSON.stringify({ questions }));

await test('concurrent tabs cannot silently overwrite a newer local draft', async () => {
  const d = draft(); await m.saveImportDraft('cas-user', d);
  const a = await m.loadImportDraft('cas-user', d.bankId), b = await m.loadImportDraft('cas-user', d.bankId);
  a.rows[0].notes = 'Tab A work'; b.rows[0].notes = 'Tab B work';
  await m.saveImportDraft('cas-user', a);
  await assert.rejects(m.saveImportDraft('cas-user', b), m.ImportDraftConflict);
  assert.equal((await m.loadImportDraft('cas-user', d.bankId)).rows[0].notes, 'Tab A work');
  assert.equal(b.rows[0].notes, 'Tab B work', 'the losing tab can still export its own backup');
});

await test('discard removes only the selected account and bank, including local attachments', async () => {
  const d = draft(); d.media.image = new Blob(['local image']);
  const revision = await m.saveImportDraft('discard-user', d);
  await m.saveImportDraft('other-user', d);
  await m.saveImportDraft('discard-user', draft([input], 'other-bank'));
  await m.discardImportDraft('discard-user', d.bankId, revision);
  assert.equal(await m.loadImportDraft('discard-user', d.bankId), undefined);
  assert.ok(await m.loadImportDraft('other-user', d.bankId));
  assert.ok(await m.loadImportDraft('discard-user', 'other-bank'));
  // A delayed save from an old tab must not resurrect the deleted draft.
  await assert.rejects(m.saveImportDraft('discard-user', d, revision), m.ImportDraftConflict);
});

await test('discard rejects stale tabs rather than deleting newer edits', async () => {
  const d = draft(); const oldRevision = await m.saveImportDraft('discard-stale', d);
  d.rows[0].notes = 'Newer work';
  const revision = await m.saveImportDraft('discard-stale', d, oldRevision);
  await assert.rejects(m.discardImportDraft('discard-stale', d.bankId, oldRevision), m.ImportDraftConflict);
  assert.equal((await m.loadImportDraft('discard-stale', d.bankId)).rows[0].notes, 'Newer work');
  await m.discardImportDraft('discard-stale', d.bankId, revision);
  await m.discardImportDraft('discard-stale', d.bankId, null);
});

await test('binding removes the unbound copy atomically and rejects stale target revisions', async () => {
  const d = draft(); const oldRevision = await m.saveImportDraft('unbound:test-session', d);
  const revision = await m.bindImportDraftScope('unbound:test-session', 'bound-user', d, oldRevision, null);
  assert.equal(await m.loadImportDraft('unbound:test-session', d.bankId), undefined);
  const bound = await m.loadImportDraft('bound-user', d.bankId); assert.equal(bound.accountId, 'bound-user'); assert.equal(bound.storageRevision, revision);
  const another = draft(); const anotherRevision = await m.saveImportDraft('unbound:another-session', another);
  await assert.rejects(m.bindImportDraftScope('unbound:another-session', 'bound-user', another, anotherRevision, null), m.ImportDraftConflict);
  assert.ok(await m.loadImportDraft('unbound:another-session', another.bankId));
});

await test('prototype names never resolve to a local Blob, but an own Blob remains usable', () => {
  const d = draft([{ ...input, images: [{ id: 'constructor', url: 'https://example.test/image.png', name: 'Source', caption: '' }] }]);
  assert.equal(m.validateImportRow(d.rows[0]).error, undefined);
  for (const id of ['constructor', '__proto__', 'toString']) assert.equal(m.localImportBlob(d.media, id), undefined);
  const media = Object.fromEntries([['constructor', new Blob(['bytes'])]]);
  assert.ok(m.localImportBlob(media, 'constructor') instanceof Blob);
});

await test('correcting unrelated fields cannot discard malformed original attachments silently', () => {
  const image = { id: 'same', url: 'https://example.test/image.png', name: 'Source', caption: '' };
  const d = draft([{ ...input, images: [image, image], explanationImages: [{ ...image, id: 'valid' }] }]);
  const row = { ...d.rows[0], repairError: undefined, question: { ...d.rows[0].question, answer: 1 } };
  assert.match(m.validateImportRow(row).error, /original attachments/);
  assert.equal(row.question.explanationImages.length, 1, 'one malformed section must not discard the other');
  assert.equal(m.validateImportRow({ ...row, unresolvedMedia: [] }).error, undefined, 'explicit removal resolves the field');
  assert.equal(m.validateImportRow(m.repairImportRow(row, JSON.stringify(input))).error, undefined);
});

await test('near duplicates inside the file require a decision before submission', () => {
  const d = draft([input, { ...input, stem: input.stem.replace('chest pain', 'chest discomfort') }]);
  d.checks = Object.fromEntries(d.rows.map(row => [row.id, { fingerprint: m.importRowFingerprint(row), matches: [] }]));
  assert.equal(m.workspaceReadiness(d).unresolved.length, 1);
  assert.throws(() => m.makeImportSubmission(d), /resolve every match/);
});

await test('removing images releases local storage while retaining submission snapshots', () => {
  const d = draft(); d.media.keep = new Blob(['keep']); d.media.orphan = new Blob(['orphan']);
  d.rows[0].question.images = [{ id: 'keep', url: 'local-import:keep', name: 'Keep', caption: '' }];
  assert.deepEqual(Object.keys(m.pruneImportMedia(d).media), ['keep']);
  d.rows[0].question.images = [];
  assert.equal(Object.keys(m.pruneImportMedia(d).media).length, 0);
  const batch = { requestId: crypto.randomUUID(), rowIds: [d.rows[0].id], questions: [{ ...d.rows[0].question, images: [{ id: 'keep', url: 'local-import:keep', name: 'Keep', caption: '' }] }], choices: [null] };
  d.resume = { sessionId: crypto.randomUUID(), successful: 0, confirmedCount: 0, savedBatches: [batch] };
  assert.deepEqual(Object.keys(m.pruneImportMedia(d).media), ['keep'], 'partial recovery keeps images until its original request is acknowledged');
});

await test('safe unlock preserves acknowledged rows and uploaded URLs without resending them', () => {
  const d = draft(Array.from({ length: 30 }, (_, i) => ({ ...input, stem: `Unique recovery question ${i}` })));
  d.checks = Object.fromEntries(d.rows.map(row => [row.id, { fingerprint: m.importRowFingerprint(row), matches: [] }]));
  const state = m.workspaceReadiness(d); for (const row of state.unresolved) d.decisions[row.id] = { fingerprint: m.importRowFingerprint(row), candidates: state.matches[row.id].map(match => match.candidateFingerprint) };
  d.submission = m.makeImportSubmission(d); d.submission.completed = 1; d.submission.successful = 25;
  d.submission.batches[1].questions[0].images = [{ id: 'uploaded', url: '/api/cloudflare/media/proposals/safety-bank/image.png', name: 'Uploaded', caption: '' }];
  const unlocked = m.unlockImportSubmission(d);
  assert.equal(unlocked.submission, undefined); assert.equal(unlocked.resume.successful, 25);
  assert.equal(unlocked.rows.filter(row => row.submitted && row.excluded).length, 25);
  assert.equal(unlocked.rows[25].question.images[0].url, '/api/cloudflare/media/proposals/safety-bank/image.png');
  assert.equal(Object.keys(unlocked.checks).length, 0);
});

await test('undo history releases removed image collections before memory grows without a bound', () => {
  const a = draft(), b = draft(), current = draft();
  a.media.a = new Blob([new Uint8Array(85 * 1024 * 1024)]);
  b.media.b = new Blob([new Uint8Array(85 * 1024 * 1024)]);
  assert.deepEqual(m.boundedImportHistory([a, b], current), [b]);
  assert.equal(m.boundedImportHistory(Array.from({ length: 30 }, () => current), current).length, 20);
});

await test('direct links use independent session scopes instead of the shared anonymous namespace', () => {
  let memory = new Map();
  globalThis.sessionStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  globalThis.localStorage = { getItem: () => null };
  assert.equal(m.importWorkspaceContext('bank').uid, '');
  const first = m.unboundImportScope('bank'); assert.equal(m.unboundImportScope('bank'), first);
  memory = new Map(); assert.notEqual(m.unboundImportScope('bank'), first);
  m.bindImportWorkspace('bank', 'confirmed-account', 'Confirmed bank');
  assert.equal(m.importWorkspaceContext('bank').uid, 'confirmed-account');
  globalThis.localStorage = { getItem: () => 'different-account' };
  assert.equal(m.importWorkspaceContext('bank').uid, 'different-account', 'stale tab context never restores another account’s draft');
});

await test('full local backups round-trip images, notes and recovery; malformed archives are rejected', async () => {
  let response; globalThis.self = { postMessage: data => { response = data; } };
  await compile("import './features/imports/client/import-local-worker';");
  const d = draft(); d.accountId = 'backup-user'; d.rows[0].notes = 'Verify source';
  d.media.photo = new Blob(['synthetic image bytes'], { type: 'image/png' });
  d.rows[0].question.images = [{ id: 'photo', url: 'local-import:photo', name: 'Photo', caption: 'Caption' }];
  d.checks = Object.fromEntries(d.rows.map(row => [row.id, { fingerprint: m.importRowFingerprint(row), matches: [] }]));
  d.submission = m.makeImportSubmission(d);
  d.submission.completed = 1; d.submission.successful = 1;
  await self.onmessage({ data: { action: 'backup', draft: d } }); assert.ok(response.backup);
  const bytes = response.backup.buffer;
  await self.onmessage({ data: { action: 'restore', bytes } });
  assert.equal(response.error, undefined); assert.equal(response.draft.rows[0].notes, 'Verify source');
  assert.equal(await response.draft.media.photo.text(), 'synthetic image bytes');
  assert.equal(response.draft.submission.batches[0].requestId, d.submission.batches[0].requestId);
  assert.equal(response.draft.submission.completed, 0, 'external completion claims are reconfirmed only on Submit');
  assert.equal(response.draft.rows[0].frozen, true);
  assert.equal(response.draft.rows[0].submitted, false);
  assert.equal(response.draft.accountId, d.accountId);
  const bad = zipSync({ 'manifest.json': strToU8('{}'), '../unexpected': strToU8('no') });
  await self.onmessage({ data: { action: 'restore', bytes: bad.buffer } }); assert.match(response.error, /Unexpected file/);
});
