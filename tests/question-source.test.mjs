import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({ stdin: { contents: "export * from './features/qbanks/domain/question-source'; export * from './lib/question-import';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const q = { stem: 'Which option applies?', options: ['First', 'Second'], correctAnswer: 'A', explanation: 'Explanation.' };

void test('one source groups different pages, casing and whitespace without merging editions', () => {
  const options = m.questionSourceOptions([
    { sourceFile: ' Surgery.pdf ', sourcePage: 12 },
    { sourceFile: 'surgery.pdf', sourcePage: 40 },
    { sourceFile: 'Surgery.pdf - p.55' },
    { sourceReference: 'Surgery.pdf — صفحة 60' },
    { sourceFile: 'Surgery 2024.pdf' }, { sourceFile: 'Surgery 2025.pdf' }, {},
  ]);
  assert.equal(options.length, 4);
  assert.equal(options.find(o => o.key === 'surgery.pdf').count, 4);
  assert.equal(m.questionSourceKey({ sourceFile: 'Lecture  2026.pdf' }), 'lecture 2026.pdf');
});

void test('legacy explicit page labels split safely and preserve original question numbers', () => {
  for (const reference of ['Bank.pdf - p.12 - Q.37', 'Bank.pdf — page 12 - Q.37', 'Bank.pdf - صفحة 12 - Q.37']) {
    const source = m.readQuestionSource({ sourceReference: reference });
    assert.equal(source.sourceFile, 'Bank.pdf');
    assert.equal(source.sourcePage, 12);
    assert.equal(source.originalQuestionNumber, '37');
  }
  const ambiguous = 'Book / Chapter 2, pages 12–15';
  assert.equal(m.readQuestionSource({ sourceReference: ambiguous }).sourceReference, ambiguous);
  assert.equal(m.readQuestionSource({ sourceFile: 'Bank 12.pdf' }).sourceFile, 'Bank 12.pdf');
  assert.equal(m.readQuestionSource({ sourceFile: 'C:\\Notes\\Bank.pdf' }).sourceFile, 'Bank.pdf');
});

void test('JSON inherits required source names and accepts omitted pages without placeholders', () => {
  const report = m.parseQuestionImportReport({ sourceFile: 'Bank.pdf', questions: [q, { ...q, sourcePage: 12 }, { ...q, sourceFile: 'Other.pdf', sourcePage: null }] });
  assert.equal(report.skipped.length, 0);
  assert.deepEqual(report.questions.map(q => q.sourceFile), ['Bank.pdf', 'Bank.pdf', 'Other.pdf']);
  assert.equal(Object.hasOwn(report.questions[0], 'sourcePage'), false);
  assert.equal(report.questions[0].sourceReference, 'Bank.pdf');
  assert.equal(report.questions[1].sourceReference, 'Bank.pdf - p.12');
  assert.equal(Object.hasOwn(report.questions[2], 'sourcePage'), false);
  assert.equal(m.parseQuestionImportReport({ questions: [q] }).questions.length, 0);
  assert.match(m.parseQuestionImportReport({ questions: [q] }).skipped[0].reason, /sourceFile/);
});

void test('explicitly invalid pages are reported while valid source-only rows survive', () => {
  const invalid = [0, -1, 1.5, 100001, 'unknown', false];
  const report = m.parseQuestionImportReport({ sourceFile: 'Bank.pdf', questions: [q, ...invalid.map(sourcePage => ({ ...q, sourcePage }))] });
  assert.equal(report.questions.length, 1);
  assert.equal(report.skipped.length, invalid.length);
  assert.ok(report.skipped.every(row => row.reason.includes('sourcePage')));
});

void test('clearing a page removes it from the source reference and preserves source identity', () => {
  const before = m.validateQuestionSource({ sourceFile: 'Bank.pdf', sourcePage: 12, originalQuestionNumber: '37' });
  const after = m.validateQuestionSource({ sourceFile: 'Bank.pdf', sourcePage: '', originalQuestionNumber: '37' });
  assert.equal(m.questionSourceKey(before), m.questionSourceKey(after));
  assert.equal(after.sourceReference, 'Bank.pdf - Q.37');
  assert.equal(Object.hasOwn(after, 'sourcePage'), false);
  assert.equal(m.readQuestionSource({ sourceReference: after.sourceReference }).sourceFile, 'Bank.pdf');
  assert.equal(m.readQuestionSource({ sourceReference: after.sourceReference }).originalQuestionNumber, '37');
  assert.equal(m.readQuestionSource({ sourceFile: 'Legacy.pdf', sourcePage: 0 }).sourcePage, undefined);
  assert.equal(m.validateQuestionSource({ sourceFile: 'Bank.pdf', sourcePage: null, sourceReference: 'Bank.pdf - p.12' }).sourcePage, undefined);
  assert.throws(() => m.validateQuestionSource({ sourceFile: 12 }, 'Bank.pdf'), /sourceFile/);
});

void test('prompt requires the original source name and explicitly makes the page optional', () => {
  assert.match(m.QUESTION_JSON_PROMPT, /sourceFile is required/);
  assert.match(m.QUESTION_JSON_PROMPT, /sourcePage is an optional/);
  assert.match(m.QUESTION_JSON_PROMPT, /Never add a page number to sourceFile/);
  for (const optionCount of [2, 4, 6, 10]) {
    const example = m.questionJsonExample(optionCount);
    const report = m.parseQuestionImportReport(example);
    assert.equal(report.skipped.length, 0);
    assert.equal(report.questions.length, 2);
    assert.ok(report.questions.every(question => question.options.length === optionCount));
    assert.equal(report.questions[0].sourcePage, 12);
    assert.equal(Object.hasOwn(report.questions[1], 'sourcePage'), false);
    assert.equal(m.questionSourceKey(report.questions[0]), m.questionSourceKey(report.questions[1]));
    const settings = { source: 'lecture', kind: 'clinical', length: 'medium', countMode: 'fixed', count: 20, optionCount };
    assert.ok(m.buildQuestionPrompt(settings).includes(example));
    assert.ok(m.buildQuestionPrompt({ ...settings, source: 'qbank' }).includes(m.questionJsonExample(4)));
  }
});
