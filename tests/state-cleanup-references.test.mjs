import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { compileFunction } from 'node:vm';

const compiled = await build({ stdin: { contents: `export * from './features/state/domain/question-references'; export * from './features/qbanks/domain/question-index'; export * from './features/collaboration/domain/collaboration-values'; export {initialAppState} from './lib/medguard-types';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const source = ts.createSourceFile('server.ts', readFileSync('lib/cloudflare-server.ts', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const handler = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'cleanDeletedState');
assert.ok(handler);
const compileCleanup = env => compileFunction(`return ${ts.transpile(`(${handler.getText(source).replace(/^export\s+/, '')})`, { target: ts.ScriptTarget.ES2022 })}`, ['env', 'stateQuestionReferences'])(env, m.stateQuestionReferences);

void test('scoped cleanup matches the original deletion policy, including orphan answer/review IDs', async () => {
  const state = { ...m.initialAppState(), progress: { removed: {}, kept: {} }, questionOverrides: { removed: {} },
    customQuestions: [{ id: 'removed' }, { id: 'kept' }], reports: [{ questionId: 'removed' }], revisions: [{ questionId: 'removed' }],
    flashcards: [{ id: 'card', questionId: 'removed' }],
    tests: [{ questionIds: ['removed', 'kept'], answers: { removed: 0, kept: 1, orphan: 0 }, revealed: ['removed', 'orphan'], graded: ['orphan'], currentIndex: 10 }],
  };
  const retired = new Set(['removed', 'orphan', 'unrelated']);
  let sql, references;
  const cleanup = compileCleanup({ DB: { prepare(query) { sql = query; return { bind(payload) { references = JSON.parse(payload); return { async all() { return { results: references.filter(id => retired.has(id)).map(id => ({ id })) }; } }; } }; } } });
  const result = await cleanup(state);
  assert.deepEqual(Object.keys(result.progress), ['kept']);
  assert.deepEqual(result.customQuestions, [{ id: 'kept' }]);
  assert.deepEqual(result.questionOverrides, {});
  assert.equal(result.reports[0].questionId, '#deleted');
  assert.equal(result.revisions[0].questionId, '#deleted');
  assert.deepEqual(result.tests[0], { questionIds: ['kept'], answers: { kept: 1 }, revealed: [], graded: [], currentIndex: 0 });
  assert.equal(result.flashcards, state.flashcards, 'Flashcard/history policy is unchanged');
  assert.deepEqual(new Set(references), new Set(['removed', 'kept', 'orphan']));
  const verify = spawnSync('python', ['-c', `import sqlite3,json,sys
sql,ids=json.load(sys.stdin);db=sqlite3.connect(':memory:')
db.execute('CREATE TABLE retired_questions(id TEXT PRIMARY KEY)')
db.executemany('INSERT INTO retired_questions VALUES(?)', [('removed',),('orphan',),('unrelated',)])
assert set(row[0] for row in db.execute(sql,(json.dumps(ids),)))=={'removed','orphan'}
assert any('SEARCH retired' in row[3] for row in db.execute('EXPLAIN QUERY PLAN '+sql,(json.dumps(ids),)))
`], { input: JSON.stringify([sql, references]), encoding: 'utf8' });
  assert.equal(verify.status, 0, verify.stderr);
});
void test('an empty state requires no retired-question database scan', async () => {
  const cleanup = compileCleanup({ DB: { prepare() { assert.fail('Empty state must not scan the retirement table'); } } });
  const initial = m.initialAppState();
  assert.deepEqual(await cleanup(initial), initial);
});
void test('question indexes keep Array.find semantics and do not invent missing questions', () => {
  const first = { id: 'a', answer: 1 }, later = { id: 'a', answer: 2 };
  const indexed = m.indexQuestionsById([first, later]);
  assert.equal(indexed.get('a'), first);
  assert.equal(indexed.get('missing'), undefined);
});
void test('base fingerprints ignore object order, preserve content changes and never carry a second record copy', async () => {
  assert.equal(await m.collaborationBaseHash({ Z: 1, a: 'text' }), await m.collaborationBaseHash({ a: 'text', Z: 1 }));
  assert.notEqual(await m.collaborationBaseHash({ a: 'text' }), await m.collaborationBaseHash({ a: 'changed' }));
  assert.match(await m.collaborationBaseHash(null), /^[a-f0-9]{64}$/);
});
