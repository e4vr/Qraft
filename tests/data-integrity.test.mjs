import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const questions = JSON.parse(await readFile(new URL('../data/questions.json', import.meta.url), 'utf8'));

void test('phase one contains every keyed question from the 51-page source', () => {
  assert.equal(questions.length, 217);
  assert.equal(questions[0].id, 'gs-001');
  assert.equal(questions.at(-1).id, 'gs-217');
  assert.equal(questions[0].questionId, '00001');
  assert.equal(questions.at(-1).questionId, '00217');
  assert.equal(questions[0].sourcePage, 1);
  assert.equal(questions.at(-1).sourcePage, 51);
});

void test('question structure and answer keys are internally consistent', () => {
  const questionIds = new Set();
  questions.forEach((question, index) => {
    assert.equal(question.number, index + 1);
    assert.equal(question.options.length, 4, question.id);
    assert.ok(question.options.every((option) => option.trim().length > 0), question.id);
    assert.ok(question.stem.length > 20, question.id);
    assert.ok(Number.isInteger(question.answer) && question.answer >= 0 && question.answer <= 3, question.id);
    assert.equal(question.answerLetter, 'ABCD'[question.answer], question.id);
    assert.equal(question.specialty, 'Surgery', question.id);
    assert.ok(question.topic.length > 0, question.id);
    assert.ok(question.sourcePage >= 1 && question.sourcePage <= 51, question.id);
    assert.match(question.questionId, /^\d{5}$/, question.id);
    assert.equal(questionIds.has(question.questionId), false, question.questionId);
    questionIds.add(question.questionId);
    assert.ok(Array.isArray(question.images), question.id);
  });
});

void test('source pages remain in order and extraction artifacts are removed', () => {
  const pages = questions.map((question) => question.sourcePage);
  assert.deepEqual([...pages].sort((a, b) => a - b), pages);
  const combined = questions.map((question) => `${question.stem} ${question.options.join(' ')}`).join('\n');
  assert.doesNotMatch(combined, /[>�]/);
  assert.doesNotMatch(combined, /\b(?:aOacks?|admijed|soO|unevenRul|Curejage|intermiOent|ajending|shaO)\b/);
});

void test('PWA shell and Cloudflare persistence configuration are present', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const serviceWorker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const schema = await readFile(new URL('../db/schema.ts', import.meta.url), 'utf8');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable' && icon.sizes === '512x512'));
  assert.ok(manifest.icons.some(icon => icon.purpose === 'any' && icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.purpose === 'any' && icon.sizes === '512x512'));
  assert.match(serviceWorker, /CACHE_NAME/);
  assert.match(serviceWorker, /'\/offline'/);
  assert.match(wrangler, /"binding": "DB"/);
  assert.doesNotMatch(wrangler, /"binding": "MEDIA"/);
  assert.match(schema, /sqliteTable\(\s*'profiles'/);
  assert.match(schema, /sqliteTable\(\s*'media'/);
});

void test('friendly error, not-found, offline, and account profile experiences are present', async () => {
  const errorPage = await readFile(new URL('../app/error.tsx', import.meta.url), 'utf8');
  const notFoundPage = await readFile(new URL('../app/not-found.tsx', import.meta.url), 'utf8');
  const offlinePage = await readFile(new URL('../app/offline/page.tsx', import.meta.url), 'utf8');
  const profile = await readFile(new URL('../components/account-profile.tsx', import.meta.url), 'utf8');
  const app = await readFile(new URL('../components/medguard-app.tsx', import.meta.url), 'utf8');
  assert.match(errorPage, /kind="error"/);
  assert.match(notFoundPage, /kind="not-found"/);
  assert.match(offlinePage, /kind="offline"/);
  assert.match(profile, /Reset password/);
  assert.match(profile, /updateCloudflareProfile/);
  assert.match(app, /aria-label="Open account profile"/);
  assert.match(app, /view === 'account'/);
});
