import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { indexedDB } from 'fake-indexeddb';

globalThis.indexedDB = indexedDB;
const compiled = await build({ stdin: { contents: "export * from './features/imports/domain/import-workspace'; export * from './features/imports/client/import-draft-store'; export * from './lib/question-import';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const input = { stem: 'Which choice applies?', options: ['First', 'Second'], correctAnswer: 'B', sourceFile: 'Original.pdf', explanation: 'Reason', specialty: 'General', topic: 'Topic' };
const draft = (questions = [input], bank = 'bank') => m.draftFromReport(m.parseQuestionImportReport({ questions }), bank, 'file.json', 'a'.repeat(64), JSON.stringify({ questions }));
const checked = d => ({ ...d, checks: Object.fromEntries(d.rows.map(row => [row.id, { fingerprint: m.importRowFingerprint(row), matches: [] }])) });
const resolved = d => { const state = m.workspaceReadiness(d); for (const row of state.unresolved) d.decisions[row.id] = { fingerprint: m.importRowFingerprint(row), candidates: state.matches[row.id].map(match => match.candidateFingerprint) }; return d; };

await test('invalid entries remain editable with original positions and raw data', () => {
  const d = draft([input, { ...input, correctAnswer: 'Z' }, { ...input, sourceFile: '' }]);
  assert.equal(d.rows.length, 3);
  assert.equal(d.rows[1].position, 2);
  assert.equal(d.rows[1].raw.correctAnswer, 'Z');
  assert.equal(d.rows[1].question.answer, -1);
  assert.equal(d.rows[2].question.answer, 1, 'a source issue must not discard a valid answer');
  assert.equal(m.workspaceReadiness(d).invalid.length, 2);
  const fixed = m.repairImportRow(d.rows[1], JSON.stringify(input));
  assert.equal(m.validateImportRow(fixed).error, undefined);
  assert.equal(fixed.id, d.rows[1].id);
});

await test('fixing an answer does not discard independently valid image attachments', () => {
  const images = [{ id: 'source-image', url: 'https://example.test/image.png', name: 'Source image', caption: 'Source caption' }];
  const d = draft([{ ...input, correctAnswer: 'Z', images }]);
  assert.deepEqual(d.rows[0].question.images, images);
  d.rows[0] = { ...d.rows[0], repairError: undefined, question: { ...d.rows[0].question, answer: 1 } };
  assert.deepEqual(m.validateImportRow(d.rows[0]).question.images, images);
});

await test('uploaded protected question images round-trip while unsafe image URLs remain invalid', () => {
  const image = { id: 'uploaded-image', url: '/api/cloudflare/media/questions/bank/image.png', name: 'Image', caption: '' };
  const report = m.parseQuestionImportReport({ questions: [{ ...input, images: [image] }] });
  assert.equal(report.questions.length, 1);
  assert.equal(report.questions[0].images[0].url, image.url);
  assert.equal(m.parseQuestionImportReport({ questions: [{ ...input, images: [{ ...image, url: 'javascript:alert(1)' }] }] }).questions.length, 0);
});

await test('labelled answer text and multiple keys must agree; ambiguity is never guessed', () => {
  for (const q of [{ ...input, correctAnswer: 'B. First' }, { ...input, answer: 0 }, { ...input, options: ['Same', 'Same'], correctAnswer: 'Same' }]) {
    const report = m.parseQuestionImportReport({ questions: [q] });
    assert.equal(report.questions.length, 0);
    assert.match(report.skipped[0].reason, /answer/);
  }
  const report = m.parseQuestionImportReport({ questions: [{ ...input, correctAnswer: 'B. Second', answer: 1 }] });
  assert.equal(report.questions[0].answer, 1);
});

await test('labelled option objects preserve their keys without mutating original JSON', () => {
  const options = [{ label: 'b', text: 'Second' }, { label: 'A', text: 'First' }];
  const report = m.parseQuestionImportReport({ questions: [{ ...input, options }] });
  assert.deepEqual(report.questions[0].options, ['First', 'Second']);
  assert.equal(report.questions[0].answer, 1);
  assert.equal(options[0].label, 'b');
  for (const options of [[{ label: 'A', text: 'One' }, { label: 'A', text: 'Two' }], [{ label: 'A', text: 'One' }, { label: 'C', text: 'Two' }]])
    assert.equal(m.parseQuestionImportReport({ questions: [{ ...input, options }] }).questions.length, 0);
});

await test('moving choices keeps the correct answer tied to the same choice', () => {
  const q = draft().rows[0].question;
  const moved = m.moveImportOption(q, 1, 0);
  assert.equal(moved.answer, 0);
  assert.equal(moved.options[moved.answer], 'Second');
  assert.equal(m.moveImportOption(moved, 0, 1).answer, 1);
});

await test('submission requires explicit checks and every duplicate decision', () => {
  let d = draft([input, input]);
  assert.equal(m.workspaceReadiness(d).unchecked.length, 2);
  assert.throws(() => m.makeImportSubmission(d));
  d = checked(d);
  const state = m.workspaceReadiness(d);
  assert.equal(state.unresolved.length, 1);
  const row = d.rows[1];
  d.decisions[row.id] = { fingerprint: m.importRowFingerprint(row), candidates: state.matches[row.id].map(match => match.candidateFingerprint) };
  assert.equal(m.workspaceReadiness(d).ready, true);
  assert.equal(m.makeImportSubmission(d).batches[0].questions.length, 2);
  d.rows[0] = { ...d.rows[0], question: { ...d.rows[0].question, options: ['New', 'Second'] } };
  assert.equal(m.workspaceReadiness(d).ready, false);
  assert.equal(m.workspaceReadiness(d).unresolved.length, 1, 'editing a candidate invalidates the keep-both decision');
});

await test('source/explanation edits invalidate checks; notes and review flags stay local', () => {
  const d = checked(draft());
  d.rows[0].notes = 'Verify against source'; d.rows[0].reviewed = true;
  assert.equal(m.workspaceReadiness(d).ready, true);
  d.rows[0].question.sourceFile = 'Different source.pdf';
  assert.equal(m.workspaceReadiness(d).unchecked.length, 1);
});

await test('excluding and restoring a row recomputes file matches and gates submission', () => {
  let d = checked(draft([input, input, input]));
  d.rows[0].excluded = true;
  assert.equal(m.workspaceReadiness(d).matches[d.rows[1].id].length, 0);
  assert.equal(m.workspaceReadiness(d).matches[d.rows[2].id][0].draftIndex, 0);
  d = m.skipWorkspaceExact(d);
  assert.equal(d.rows.filter(row => !row.excluded).length, 1);
  assert.equal(m.workspaceReadiness(d).ready, true);
  d.rows[2].excluded = false;
  assert.equal(m.workspaceReadiness(d).ready, false);
});

await test('export preserves multiple sources, keyed answers and medical values', () => {
  const d = draft([input, { ...input, stem: 'Dose 0.5 mg is NOT appropriate.', sourceFile: 'Other.pdf', sourcePage: 12 }]);
  const output = JSON.parse(m.exportImportDraft(d));
  assert.deepEqual(output.questions.map(q => q.sourceFile), ['Original.pdf', 'Other.pdf']);
  assert.equal(output.questions[1].correctAnswer, 'B');
  assert.equal(output.questions[1].stem, 'Dose 0.5 mg is NOT appropriate.');
  assert.equal(m.parseQuestionImportReport(output).questions.length, 2);
});

await test('local images survive device persistence without blocking structural validation', async () => {
  const d = draft();
  d.media.image = new Blob(['image bytes'], { type: 'image/png' });
  d.rows[0].question.images = [{ id: 'image', url: 'local-import:image', name: 'test.png', caption: '' }];
  assert.equal(m.validateImportRow(d.rows[0]).error, undefined);
  await m.saveImportDraft('alice', d);
  const saved = await m.loadImportDraft('alice', 'bank');
  assert.equal(await saved.media.image.text(), 'image bytes');
  assert.equal(saved.rows[0].question.images[0].url, 'local-import:image');
  assert.equal(await m.loadImportDraft('bob', 'bank'), undefined);
  assert.equal(await m.loadImportDraft('alice', 'other-bank'), undefined);
});

await test('stable batch identifiers and acknowledgement count survive reloads', async () => {
  const d = resolved(checked(draft(Array.from({ length: 60 }, (_, i) => ({ ...input, stem: `Unique question ${i}` })))));
  d.submission = m.makeImportSubmission(d);
  assert.deepEqual(d.submission.batches.map(batch => batch.questions.length), [25, 25, 10]);
  d.submission.completed = 1; d.submission.successful = 25;
  await m.saveImportDraft('resume', d);
  const restored = await m.loadImportDraft('resume', 'bank');
  assert.equal(restored.submission.completed, 1);
  assert.equal(restored.submission.batches[1].requestId, d.submission.batches[1].requestId);
  assert.equal(restored.submission.sessionId, d.submission.sessionId);
});

await test('a conflict after partial submission resumes the same logical import without resending saved questions', () => {
  const d = resolved(checked(draft(Array.from({ length: 30 }, (_, i) => ({ ...input, stem: `Resume question ${i}` })))));
  const original = m.makeImportSubmission(d);
  d.resume = { sessionId: original.sessionId, successful: 25, savedBatches: original.batches.slice(0, 1) };
  const saved = new Set(original.batches[0].rowIds);
  d.rows = d.rows.map(row => saved.has(row.id) ? { ...row, excluded: true, submitted: true } : row);
  const resumed = m.makeImportSubmission(resolved(d));
  assert.equal(resumed.sessionId, original.sessionId);
  assert.equal(resumed.completed, 1);
  assert.equal(resumed.successful, 25);
  assert.equal(resumed.batches[0].requestId, original.batches[0].requestId);
  assert.equal(resumed.batches[1].questions.length, 5);
});

await test('account question limits block submission locally after policy is returned by Check duplication', () => {
  const d = checked(draft([{ ...input, stem: 'First question' }, { ...input, stem: 'Second question' }]));
  d.questionLimit = 1;
  assert.equal(m.workspaceReadiness(d).limitExceeded, true);
  assert.throws(() => m.makeImportSubmission(d), /at most 1/);
  d.rows[1].excluded = true;
  assert.equal(m.workspaceReadiness(d).ready, true);
});

await test('unapplied raw JSON edits survive local recovery and block an accidental submission of older fields', async () => {
  const d = checked(draft());
  d.rows[0].pendingRaw = JSON.stringify({ ...input, correctAnswer: 'A' });
  assert.equal(m.workspaceReadiness(d).ready, false);
  await m.saveImportDraft('raw-repair', d);
  const restored = await m.loadImportDraft('raw-repair', 'bank');
  assert.equal(restored.rows[0].pendingRaw, d.rows[0].pendingRaw);
  const repaired = m.repairImportRow(restored.rows[0], restored.rows[0].pendingRaw);
  assert.equal(repaired.pendingRaw, undefined);
  assert.equal(repaired.question.answer, 0);
});
