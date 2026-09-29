import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

await mkdir('.ui-review', { recursive: true });
await build({ stdin: { contents: `export * from './lib/question-import'; export * from './features/imports/domain/import-duplicate-index'; export * from './features/imports/domain/local-import-duplicates'; export * from './features/imports/domain/exact-import-duplicates'; export {prepareDuplicateCandidate,normalizeDuplicateText} from './features/duplicates/domain/duplicate-detection';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: '.ui-review/json-import-quality.mjs' });
const { normalizeQuestionText, parseQuestionImportReport, importedSourceReference, buildQuestionPrompt, ImportDuplicateIndex, prepareDuplicateCandidate, normalizeDuplicateText, withLocalImportMatches, exactImportIdentity, planExactImportSkip } = await import('../.ui-review/json-import-quality.mjs');
const question = { stem: 'Which drug is indicated?', options: ['Option one', 'Option two'], correctAnswer: 'B', sourceFile: 'Original bank.pdf', sourcePage: 4, originalQuestionNumber: '17', explanation: 'Explanation', specialty: 'Medicine', topic: 'Treatment' };

void test('OCR prose flows while real paragraphs, findings, numbers and lists are preserved', () => {
  assert.equal(normalizeQuestionText('A patient receives\n0.5 mg of medication\r\nand has NOT improved.'), 'A patient receives 0.5 mg of medication and has NOT improved.');
  const structured = 'History:\nPatient has pain.\n\nResults:\nNa: 135 mmol/L\nK: 4.5 mmol/L\n\n- Left arm\n- Right arm';
  assert.equal(normalizeQuestionText(structured), structured);
  assert.equal(normalizeQuestionText('Dose  Unit\n0.5   mg'), 'Dose  Unit\n0.5   mg');
});

void test('common model schema variants preserve ordered choices and answer keys', () => {
  const report = parseQuestionImportReport({ sourceFile: 'Bank.pdf', questions: [{ questionText: 'A patient\nneeds treatment.', choices: { B: 'B. Second choice', A: 'A. First choice' }, correct_answer: 'B. Second choice', page: '12' }] });
  assert.equal(report.skipped.length, 0);
  assert.deepEqual(report.questions[0].options, ['First choice', 'Second choice']);
  assert.equal(report.questions[0].answer, 1);
  assert.equal(report.questions[0].stem, 'A patient needs treatment.');
});

void test('readable questions survive malformed JSON and invalid rows without guessing answers or pages', () => {
  const raw = JSON.stringify({ sourceFile: 'Bank.pdf', questions: [question, { ...question, correctAnswer: 'Z' }, { ...question, sourcePage: undefined }] }).replace(/\}\]\}$/, '},]}');
  const report = parseQuestionImportReport(raw);
  assert.equal(report.questions.length, 1);
  assert.equal(report.skipped.length, 2);
  assert.equal(report.repaired, true);
  assert.match(report.skipped[0].reason, /answer/);
  assert.match(report.skipped[1].reason, /sourcePage/);
});

void test('full local parsing accepts a large file and source rename preserves source numbering', () => {
  const report = parseQuestionImportReport({ questions: Array.from({ length: 1000 }, (_, i) => ({ ...question, stem: `Clinical item ${i}` })) }, '', Infinity);
  assert.equal(report.questions.length, 1000);
  assert.equal(importedSourceReference('New source title', 4, '17'), 'New source title - p.4 - Q.17');
  assert.equal(report.questions[0].sourceReference, 'Original bank.pdf - p.4 - Q.17');
});

void test('candidate shortlist finds relevant questions after the first forty and isolates banks', () => {
  const candidates = Array.from({ length: 80 }, (_, i) => prepareDuplicateCandidate({ entityId: `q-${i}`, entityType: 'approved_question', qbankId: 'bank', payload: { ...question, stem: `Unrelated history item ${i}`, answer: 1 } }));
  const relevant = prepareDuplicateCandidate({ entityId: 'relevant', entityType: 'approved_question', qbankId: 'bank', payload: { ...question, stem: 'Clinical management of acute pancreatitis', answer: 1 } });
  const otherBank = { ...relevant, qbankId: 'other', entityId: 'other-bank' };
  const index = new ImportDuplicateIndex([...candidates, relevant, otherBank]);
  assert.ok(index.near('bank', normalizeDuplicateText('Clinical management of severe acute pancreatitis')).some(item => item.entityId === 'relevant'));
  assert.ok(index.near('bank', 'acute pancreatitis').every(item => item.qbankId === 'bank'));
  assert.deepEqual(index.exact('bank', relevant.prepared.stem).map(item => item.entityId), ['relevant']);
});

void test('prompt retains its introduction and extraction safeguards with descriptive formatting guidance', () => {
  const settings = { source: 'qbank', kind: 'clinical', length: 'medium', countMode: 'fixed', count: 20, optionCount: 4 };
  const prompt = buildQuestionPrompt(settings);
  assert.ok(prompt.startsWith('This guide asks you to build a JSON file that will be uploaded to an electronic question platform.'));
  for (const phrase of ['OCR', 'four close, logical and plausible options', 'outside the bank only for this explanation', 'originalQuestionNumber', 'sourcePage', 'READABLE QUESTION TEXT', 'negation', 'skipped']) assert.ok(prompt.includes(phrase));
  assert.match(buildQuestionPrompt({ ...settings, source: 'lecture', optionCount: 6 }), /6 distinct answer options/);
});

void test('excluding or editing a local duplicate rebases later comparisons onto surviving questions', () => {
  const questions = parseQuestionImportReport({ questions: [question, question, question] }).questions;
  const matches = withLocalImportMatches(questions, []);
  assert.deepEqual(matches.map(list => list[0]?.draftIndex), [undefined, 0, 0]);
  const removed = withLocalImportMatches(questions, matches, [0]);
  assert.equal(removed[1].length, 0);
  assert.equal(removed[2][0].draftIndex, 1);
  const edited = withLocalImportMatches([{ ...questions[0], stem: 'A different question' }, ...questions.slice(1)], matches);
  assert.equal(edited[1].length, 0);
  assert.equal(edited[2][0].draftIndex, 1);
});

void test('bulk skipping requires equal text, options and correct answer while tolerating formatting and reordered options', () => {
  const original = parseQuestionImportReport({ questions: [question] }).questions[0];
  assert.equal(exactImportIdentity(original), exactImportIdentity({ ...original,
    stem: '  WHICH drug\n is indicated? ', options: ['B. Option two', 'A. Option one'], answer: 0,
    sourceFile: 'Another source', explanation: 'Another explanation', topic: 'Another topic' }));
  for (const changed of [
    { answer: 0 }, { options: ['Option one', 'A different option'] },
    { stem: 'Which drug is NOT indicated?' }, { stem: 'Which drug at 0.5 mg is indicated?' },
  ]) assert.notEqual(exactImportIdentity(original), exactImportIdentity({ ...original, ...changed }));
  assert.equal(exactImportIdentity({ ...original, answer: -1 }), undefined);
  assert.equal(exactImportIdentity({ ...original, options: ['', 'Valid'] }), undefined);
  assert.notEqual(exactImportIdentity({ ...original, stem: '0.5 mg is administered. What follows?' }),
    exactImportIdentity({ ...original, stem: '5 mg is administered. What follows?' }));
  assert.notEqual(exactImportIdentity({ ...original, options: ['0.5 mg', 'Placebo'] }),
    exactImportIdentity({ ...original, options: ['5 mg', 'Placebo'] }));
  assert.notEqual(exactImportIdentity({ ...original, options: ['B-adrenergic agonist', 'Placebo'] }),
    exactImportIdentity({ ...original, options: ['adrenergic agonist', 'Placebo'] }));
});

void test('bulk skipping retains one new copy per full-content group and preserves same-stem variants', () => {
  const original = parseQuestionImportReport({ questions: [question] }).questions[0];
  const variant = { ...original, answer: 0 };
  const drafts = [original, variant, variant, original, { ...original, stem: 'A new clinical case?' }];
  const plan = planExactImportSkip(drafts, withLocalImportMatches(drafts, []));
  assert.deepEqual(plan.indexes, [2, 3]);
  assert.equal(plan.fileMatches, 2);
  assert.deepEqual(planExactImportSkip(drafts, [], [0]).indexes, [2]);
  assert.equal(drafts.length, 5, 'Planning never discards the original drafts before server confirmation.');
});

void test('bulk skipping uses full bank matches and ignores stale evidence for edited drafts', () => {
  const original = parseQuestionImportReport({ questions: [question] }).questions[0];
  const match = { entityId: 'existing', entityType: 'approved_question', payload: original, classification: 'exact' };
  assert.deepEqual(planExactImportSkip([original], [[match]]).indexes, [0]);
  assert.deepEqual(planExactImportSkip([{ ...original, answer: 0 }], [[match]]).indexes, []);
  assert.deepEqual(planExactImportSkip([original], [[match]], [], [0]).indexes, []);
});

void test('bulk skipping handles a large file while preserving one copy of each distinct question', () => {
  const original = parseQuestionImportReport({ questions: [question] }).questions[0];
  const drafts = Array.from({ length: 2000 }, (_, i) => ({ ...original, stem: `Clinical case ${i % 100}` }));
  const plan = planExactImportSkip(drafts, []);
  assert.equal(plan.indexes.length, 1900);
  assert.equal(plan.fileMatches, 1900);
  assert.equal(plan.bankMatches, 0);
});

void test('file worker reads UTF-8 and UTF-16 and produces a validated report and stable file hash', async () => {
  const result = await build({ entryPoints: ['features/imports/client/import-file-worker.ts'], bundle: true, platform: 'browser', format: 'iife', write: false });
  const content = JSON.stringify({ questions: [{ ...question, stem: 'سؤال عن جرعة 0.5 mg' }] });
  for (const bytes of [Buffer.from(content), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')])]) {
    const output = await new Promise((resolve, reject) => {
      const worker = { postMessage: resolve };
      runInNewContext(result.outputFiles[0].text, { self: worker, crypto: webcrypto, TextDecoder, URL });
      void worker.onmessage({ data: { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), fallbackSourceFile: '' } }).catch(reject);
    });
    assert.equal(output.error, undefined);
    assert.equal(output.report.questions[0].stem, 'سؤال عن جرعة 0.5 mg');
    assert.equal(output.report.questions[0].answer, 1);
    assert.match(output.hash, /^[a-f0-9]{64}$/);
  }
});
