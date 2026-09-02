import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const questions = JSON.parse(await readFile(new URL('../data/questions.json', import.meta.url), 'utf8'));

test('phase one contains every keyed question from the 51-page source', () => {
  assert.equal(questions.length, 217);
  assert.equal(questions[0].id, 'gs-001');
  assert.equal(questions.at(-1).id, 'gs-217');
  assert.equal(questions[0].sourcePage, 1);
  assert.equal(questions.at(-1).sourcePage, 51);
});

test('question structure and answer keys are internally consistent', () => {
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
  });
});

test('source pages remain in order and extraction artifacts are removed', () => {
  const pages = questions.map((question) => question.sourcePage);
  assert.deepEqual([...pages].sort((a, b) => a - b), pages);
  const combined = questions.map((question) => `${question.stem} ${question.options.join(' ')}`).join('\n');
  assert.doesNotMatch(combined, /[>�]/);
  assert.doesNotMatch(combined, /\b(?:aOacks?|admijed|soO|unevenRul|Curejage|intermiOent|ajending|shaO)\b/);
});

test('PWA shell and Firebase access rules are present', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  const serviceWorker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const firestoreRules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  const storageRules = await readFile(new URL('../storage.rules', import.meta.url), 'utf8');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.icons.length, 2);
  assert.match(serviceWorker, /CACHE_NAME/);
  assert.match(firestoreRules, /request\.auth\.uid == userId/);
  assert.match(storageRules, /request\.auth\.uid == userId/);
});
