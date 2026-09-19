import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

async function loadTypeScript(path) {
  const result = await build({
    entryPoints: [path],
    absWorkingDir: process.cwd(),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

void test('access policy preserves platform and QBank role outcomes', async () => {
  const access = await loadTypeScript(
    'features/access/domain/access-policy.ts',
  );
  const student = { uid: 'u1', role: 'student', platformRoles: [] };
  const reviewer = {
    uid: 'u2',
    role: 'student',
    platformRoles: ['reviewer'],
  };
  const root = { uid: 'root', role: 'super_admin', platformRoles: [] };
  const publicBank = {
    id: 'public',
    ownerId: 'owner',
    visibility: 'public',
    essential: false,
  };
  const privateBank = { ...publicBank, id: 'private', visibility: 'private' };
  const editorMembership = [
    { qbankId: 'private', userId: 'u1', role: 'editor' },
  ];

  assert.equal(access.canAccessBank(student, publicBank, []), true);
  assert.equal(access.canAccessBank(student, privateBank, []), false);
  assert.equal(
    access.canAccessBank(student, privateBank, editorMembership),
    true,
  );
  assert.equal(access.canEditBank(student, privateBank, editorMembership), true);
  assert.equal(access.canManageBank(student, privateBank), false);
  assert.equal(access.canAccessBank(root, privateBank, []), true);
  assert.equal(access.canReviewBank(reviewer, privateBank, []), true);
});

void test('plan policy preserves limits, ordering, and feature gates', async () => {
  const plans = await loadTypeScript(
    'features/subscriptions/domain/plan-config.ts',
  );
  assert.deepEqual(plans.PLAN_ORDER, ['free', 'lite', 'pro', 'unlimited']);
  assert.equal(plans.getPlanLimits('free').lifetimeExamLimit, 2);
  assert.equal(plans.getPlanLimits('lite').monthlyExamLimit, 30);
  assert.equal(plans.getPlanLimits('pro').maxQuestionsPerExam, 200);
  assert.equal(plans.hasFeature('lite', 'flashcards'), false);
  assert.equal(plans.hasFeature('pro', 'flashcards'), true);
  assert.equal(plans.highestPlan('lite', 'free', 'unlimited'), 'unlimited');
});

void test('exam helpers preserve range, title, and progress behavior', async () => {
  const highlights = await loadTypeScript(
    'features/exams/domain/highlight-ranges.ts',
  );
  const presenters = await loadTypeScript(
    'features/exams/domain/exam-presenters.ts',
  );

  assert.deepEqual(
    highlights.mergeRanges([
      { start: 4, end: 8 },
      { start: 0, end: 5 },
      { start: 10, end: 10 },
    ]),
    [{ start: 0, end: 8 }],
  );
  assert.equal(
    presenters.nextTestTitle('Surgery', [
      { title: 'surgery 1' },
      { title: ' Surgery   2 ' },
    ]),
    'Surgery 3',
  );
  assert.equal(
    presenters.mainProgressCategory({ specialty: 'General Surgery', topic: '' }),
    'Surgery',
  );
  assert.equal(presenters.formatDuration(3661), '01:01:01');
});

void test('collaboration merge preserves only the current local answer', async () => {
  const collaboration = await loadTypeScript(
    'features/collaboration/domain/preserve-personal-answers.ts',
  );
  const remote = {
    answerStats: {
      q1: { id: 'q1', selections: { u1: 0, u2: 2 } },
    },
  };
  const local = {
    answerStats: {
      q1: { id: 'q1', selections: { u1: 3, u2: 1 } },
    },
  };
  const result = collaboration.preserveNewerLocalAnswers(remote, local, 'u1');
  assert.deepEqual(result.answerStats.q1.selections, { u1: 3, u2: 2 });
});
