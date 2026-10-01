import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus, platform } from 'node:os';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import ts from 'typescript';
import { build } from 'esbuild';
import { compileFunction } from 'node:vm';

const label = process.argv[2] ?? 'current';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple benchmark label.');
const code = await readFile('components/medguard-app.tsx', 'utf8');
const source = ts.createSourceFile('app.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function extract(name) {
  let result = '';
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!result) throw new Error(`Missing application function: ${name}`);
  return ts.transpile(`(${result})`, { target: ts.ScriptTarget.ES2022 });
}
const compiled = await build({ stdin: { contents: `export {initialAppState, emptyProgress} from './lib/medguard-types'; export {mergeAppStates} from './lib/merge-app-state'; export {indexQuestionsById} from './features/qbanks/domain/question-index';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const getQuestionProgress = compileFunction(`return ${extract('getQuestionProgress')}`, ['emptyProgress'])(m.emptyProgress);
const percentiles = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50Ms: +sorted[Math.floor(sorted.length * .5)].toFixed(3), p95Ms: +sorted[Math.ceil(sorted.length * .95) - 1].toFixed(3) };
};
function measure(fn, samples = 60) {
  for (let i = 0; i < 10; i++) fn();
  const values = [];
  for (let i = 0; i < samples; i++) { const start = performance.now(); fn(); values.push(performance.now() - start); }
  return percentiles(values);
}
const completion = [];
for (const [catalogCount, examCount, progressCount] of [[1000, 200, 500], [5000, 500, 2000], [20000, 2000, 4000]]) {
  const questions = Array.from({ length: catalogCount }, (_, i) => ({ id: `q-${i}`, answer: i % 4, qbankId: 'synthetic-bank' }));
  const questionIds = Array.from({ length: examCount }, (_, i) => `q-${Math.floor(i * catalogCount / examCount)}`);
  const test = { id: 'synthetic-exam', origin: 'custom', status: 'active', questionIds, answers: Object.fromEntries(questionIds.map((id, i) => [id, i % 4])), graded: [], revealed: [] };
  const initial = { ...m.initialAppState(), tests: [test], progress: Object.fromEntries(Array.from({ length: progressCount }, (_, i) => [`prior-${i}`, m.emptyProgress()])) };
  let state, collaboration;
  const dependencies = { questions, test, user: { uid: 'synthetic-user' }, seconds: 120, getQuestionProgress,
    setFinishConfirmOpen() {}, onExit() {},
    setState(update) { state = update(state); }, updateCollaboration(update) { collaboration = update(collaboration); },
    // Current handlers may reuse this memoized index. Its construction is
    // measured separately, so the one-time cost remains visible.
    examQuestionsById: m.indexQuestionsById(questions),
  };
  const handler = compileFunction(`return ${extract('completeTest')}`, Object.keys(dependencies))(...Object.values(dependencies));
  const run = () => { state = initial; collaboration = { answerStats: {} }; handler(); };
  run();
  assert.equal(state.tests[0].status, 'completed');
  assert.equal(Object.keys(collaboration.answerStats).length, examCount);
  assert.equal(Object.keys(state.progress).length, progressCount + examCount);
  const checksum = createHash('sha256').update(JSON.stringify(Object.entries(state.progress).filter(([id]) => id.startsWith('q-')).map(([id, value]) => [id, value.attempts, value.correctAttempts, value.incorrectAttempts, value.lastAnswer]))).digest('hex');
  completion.push({ catalogCount, examCount, progressCount, ...measure(run), indexConstruction: measure(() => m.indexQuestionsById(questions)), checksum });
}
const snapshots = [];
for (const targetBytes of [100_000, 750_000, 1_350_000]) {
  const state = { ...m.initialAppState(), clientUpdatedAt: '2026-10-01T10:00:00Z' };
  const count = Math.floor(targetBytes / 450);
  state.progress = Object.fromEntries(Array.from({ length: count }, (_, i) => [`q-${i}`, { ...m.emptyProgress(), note: 'Synthetic note '.repeat(20) }]));
  const raw = JSON.stringify(state);
  snapshots.push({ entries: count, bytes: Buffer.byteLength(raw), stringify: measure(() => JSON.stringify(state)), clone: measure(() => structuredClone(state)), normalizeAndMerge: measure(() => m.mergeAppStates(state, state)) });
}
const manifest = JSON.parse(await readFile('dist/client/.vite/manifest.json', 'utf8'));
const key = Object.keys(manifest).find(key => key.endsWith('components/medguard-app.tsx'));
assert.ok(key, 'Build the app before collecting bundle measurements.');
const entry = manifest[key];
const bundle = await readFile(`dist/client/${entry.file}`);
const result = {
  label, at: new Date().toISOString(), environment: { node: process.version, platform: platform(), cpu: cpus()[0]?.model, samples: 60, warmup: 10 },
  limitations: 'Synthetic local Node CPU timings; not browser frame times or production capacity. Index construction is measured separately. Existing D1 load test results are separate.',
  sourceSha256: createHash('sha256').update(code).digest('hex'), completion, snapshots,
  bundle: { file: entry.file, rawBytes: bundle.length, gzipBytes: gzipSync(bundle).length, brotliBytes: brotliCompressSync(bundle).length, staticImports: entry.imports?.length ?? 0, dynamicImports: entry.dynamicImports?.length ?? 0 },
};
await mkdir('outputs', { recursive: true });
await writeFile(`outputs/cleanup-benchmark-${label}.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
