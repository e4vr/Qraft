import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const output = await build({
  entryPoints: ['features/qbanks/domain/bookmarks.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { groupBookmarkedQuestions, createBookmarkStudySession } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
);
const banks = [{ id: 'surgery' }, { id: 'smle-gs' }, { id: 'empty' }];
const questions = [
  { id: 's1', qbankId: 'surgery' },
  { id: 'hidden', qbankId: 'private' },
  { id: 's2', qbankId: 'surgery' },
  { id: 'legacy' },
  { id: 'unmarked', qbankId: 'surgery' },
];
const bookmarkIds = ['s2', 'hidden', 'missing', 's1', 'legacy', 's1'];
const progress = Object.fromEntries(
  bookmarkIds.map((id) => [id, { bookmarked: true }]),
);
const questionsById = new Map(
  questions.map((question) => [question.id, question]),
);

void test('bookmark folders include only accessible banks with loaded bookmarked questions', () => {
  const groups = groupBookmarkedQuestions(banks, questions, bookmarkIds);
  assert.deepEqual(
    groups.map((group) => [
      group.bank.id,
      group.questions.map((question) => question.id),
    ]),
    [
      ['surgery', ['s1', 's2']],
      ['smle-gs', ['legacy']],
    ],
  );
  assert.equal(groups[0].questions[0], questions[0]);
  assert.deepEqual(groupBookmarkedQuestions(banks, questions, []), []);
  assert.deepEqual(groupBookmarkedQuestions([], questions, bookmarkIds), []);
  assert.deepEqual(
    groupBookmarkedQuestions(banks, questions, ['missing', 'hidden']),
    [],
  );
});

void test('live bookmark or access changes update counts and remove unavailable folders', () => {
  const remaining = bookmarkIds.filter((id) => id !== 's1');
  assert.deepEqual(
    groupBookmarkedQuestions(banks, questions, remaining)[0].questions.map(
      (question) => question.id,
    ),
    ['s2'],
  );
  assert.deepEqual(
    groupBookmarkedQuestions(banks.slice(1), questions, bookmarkIds).map(
      (group) => group.bank.id,
    ),
    ['smle-gs'],
  );
});

void test('Tutor sessions validate bank membership and current bookmarks, deduplicate IDs and preserve order', () => {
  const before = JSON.stringify({ questions, progress, bookmarkIds });
  const session = createBookmarkStudySession({
    bankId: 'surgery',
    questionIds: ['s2', 'legacy', 's1', 's2', 'hidden', 'unmarked', 'missing'],
    title: 'Surgery Bookmarks',
    questionsById,
    progress,
  });
  assert.deepEqual(session.questionIds, ['s2', 's1']);
  assert.equal(session.qbankId, 'surgery');
  assert.equal(session.mode, 'tutor');
  assert.equal(session.origin, 'bookmarks');
  assert.equal(session.status, 'active');
  assert.equal(session.title, 'Surgery Bookmarks');
  assert.equal(session.currentIndex, 0);
  assert.equal(session.elapsedSeconds, 0);
  assert.equal(session.timerPaused, false);
  assert.equal(session.startedAt, session.updatedAt);
  assert.equal(session.startedAt, session.timerStartedAt);
  assert.deepEqual(session.answers, {});
  assert.deepEqual(session.graded, []);
  assert.deepEqual(session.revealed, []);
  assert.equal(JSON.stringify({ questions, progress, bookmarkIds }), before);
});

void test('removed, unloaded or foreign bookmarks cannot start an empty Tutor session', () => {
  const input = {
    bankId: 'surgery',
    title: 'Surgery Bookmarks',
    questionsById,
    progress,
  };
  assert.equal(
    createBookmarkStudySession({ ...input, questionIds: [] }),
    undefined,
  );
  assert.equal(
    createBookmarkStudySession({
      ...input,
      questionIds: ['legacy', 'hidden', 'missing', 'unmarked'],
    }),
    undefined,
  );
  assert.equal(
    createBookmarkStudySession({
      ...input,
      questionIds: ['s1'],
      progress: { s1: { bookmarked: false } },
    }),
    undefined,
  );
  assert.equal(
    createBookmarkStudySession({
      ...input,
      questionIds: ['s1'],
      questionsById: new Map(),
    }),
    undefined,
  );
});

void test('opening one bookmarked question and studying legacy-bank bookmarks remain supported', () => {
  const input = { title: 'Bookmarks', questionsById, progress };
  assert.deepEqual(
    createBookmarkStudySession({
      ...input,
      bankId: 'surgery',
      questionIds: ['s1'],
    }).questionIds,
    ['s1'],
  );
  assert.deepEqual(
    createBookmarkStudySession({
      ...input,
      bankId: 'smle-gs',
      questionIds: ['legacy'],
    }).questionIds,
    ['legacy'],
  );
});
