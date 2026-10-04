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
  const reviewerMembership = [
    { qbankId: 'private', userId: 'u2', role: 'reviewer' },
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
  assert.equal(access.canReviewBank(root, privateBank, []), true);
  assert.equal(access.canReviewBank(reviewer, publicBank, []), true);
  assert.equal(access.canReviewBank(reviewer, privateBank, []), false);
  assert.equal(
    access.canReviewBank(reviewer, privateBank, reviewerMembership),
    true,
  );
});

void test('plan policy preserves limits, ordering, and feature gates', async () => {
  const plans = await loadTypeScript(
    'features/subscriptions/domain/plan-config.ts',
  );
  assert.deepEqual(plans.PLAN_ORDER, ['free', 'full_monthly', 'full_quarterly']);
  assert.equal(plans.getPlanLimits('free').lifetimeExamLimit, 2);
  assert.equal(plans.getPlanLimits('free').maxQuestionsPerExam, 15);
  assert.equal(plans.getPlanLimits('full_monthly').priceSarPeriod, 100);
  assert.equal(plans.getPlanLimits('full_quarterly').priceSarPeriod, 230);
  const { priceSarPeriod: monthlyPrice, ...monthlyAccess } = plans.getPlanLimits('full_monthly');
  const { priceSarPeriod: quarterlyPrice, ...quarterlyAccess } = plans.getPlanLimits('full_quarterly');
  assert.deepEqual([monthlyPrice, quarterlyPrice], [100, 230]);
  assert.deepEqual(monthlyAccess, quarterlyAccess);
  assert.equal(monthlyAccess.monthlyExamLimit, null);
  assert.equal(monthlyAccess.lifetimeExamLimit, null);
  assert.equal(monthlyAccess.maxFlashcardDecks, null);
  assert.equal(monthlyAccess.maxFlashcards, null);
  for (const feature of ['createQBank', 'createPrivateQBank', 'jsonImport', 'privateNotes', 'flashcards', 'readyTests']) {
    assert.equal(plans.hasFeature('free', feature), false);
    assert.equal(plans.hasFeature('full_monthly', feature), true);
    assert.equal(plans.hasFeature('full_quarterly', feature), true);
  }
  assert.equal(plans.highestPlan('full_monthly', 'free', 'full_quarterly'), 'full_quarterly');
  assert.equal(plans.PLAN_DURATION_MONTHS.full_monthly, 1);
  assert.equal(plans.PLAN_DURATION_MONTHS.full_quarterly, 3);
});

void test('calendar subscription durations clamp end-of-month and leap-day boundaries', async () => {
  const calendar = await loadTypeScript(
    'features/subscriptions/domain/calendar-duration.ts',
  );
  assert.equal(
    calendar.addCalendarDuration('2027-01-31T12:30:00.000Z', 1, 'month'),
    '2027-02-28T12:30:00.000Z',
  );
  assert.equal(
    calendar.addCalendarDuration('2028-02-29T12:30:00.000Z', 1, 'year'),
    '2029-02-28T12:30:00.000Z',
  );
  assert.equal(calendar.addCalendarDuration('2027-01-31T12:30:00.000Z', 3, 'month'), '2027-04-30T12:30:00.000Z');
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
  assert.equal(presenters.formatDuration(3661), '01:01:01');
  assert.equal(presenters.availableExamQuestionLimit(84, 200), 84);
  assert.equal(presenters.availableExamQuestionLimit(84, 50), 50);
  assert.equal(presenters.availableExamQuestionLimit(0, 50), 0);
  assert.equal(presenters.clampExamQuestionCount(500, 12), 12);
  assert.equal(presenters.clampExamQuestionCount(7, 12), 7);
  assert.equal(presenters.clampExamQuestionCount(0, 12), 1);
  assert.equal(presenters.clampExamQuestionCount(5, 0), 0);
});

void test('Progress follows the QBank specialty and topic hierarchy exactly', async () => {
  const { groupQuestionsByQBankClassification } = await loadTypeScript(
    'features/progress/domain/qbank-classification.ts',
  );
  const specialties = [
    { id: 'surgery', name: 'Surgery', order: 1 },
    { id: 'pediatrics', name: 'Pediatrics', order: 0 },
    { id: 'empty', name: 'Empty specialty', order: 2 },
  ];
  const topics = [
    { id: 'surgical-children', specialtyId: 'surgery', name: 'Pediatric Surgery', order: 0 },
    { id: 'pediatric-topic', specialtyId: 'pediatrics', name: 'Pediatric Surgery', order: 0 },
  ];
  const questions = [
    { id: 'q1', specialtyId: 'surgery', topicId: 'surgical-children', specialty: 'Surgery', topic: 'Pediatric Surgery' },
    { id: 'q2', specialtyId: 'surgery', topicId: 'pediatric-topic', specialty: 'Old specialty', topic: 'Old topic' },
    { id: 'q3', specialty: 'Surgery', topic: 'General Surgery' },
    { id: 'q4', specialty: 'Unlisted specialty', topic: 'Unlisted topic' },
  ];
  const groups = groupQuestionsByQBankClassification(questions, specialties, topics);
  assert.deepEqual(groups.map((group) => group.name), [
    'Pediatrics', 'Surgery', 'Unlisted specialty',
  ]);
  assert.deepEqual(groups[0].questions.map((question) => question.id), ['q2']);
  assert.deepEqual(groups[1].questions.map((question) => question.id), ['q1', 'q3']);
  assert.deepEqual(groups[1].topics.map((topic) => topic.name), [
    'Pediatric Surgery', 'General Surgery',
  ]);
  assert.ok(groups.every((group) => group.questions.length > 0));
  assert.ok(groups.every((group) => group.topics.every((topic) => topic.questions.length > 0)));
  assert.equal(groups.reduce((total, group) => total + group.questions.length, 0), questions.length);
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

void test('collaboration outbox preserves the first server baseline and latest local state', async () => {
  const outbox = await loadTypeScript(
    'features/collaboration/domain/collaboration-outbox.ts',
  );
  const base = { qbanks: [{ id: 'bank', name: 'Before' }] };
  const first = {
    id: 'first', uid: 'user', base, state: { qbanks: [{ id: 'bank', name: 'First' }] },
    createdAt: '2026-01-01T00:00:00.000Z', attempts: 0,
  };
  const latest = {
    id: 'latest', uid: 'user', base: first.state, state: { qbanks: [{ id: 'bank', name: 'Latest' }] },
    createdAt: '2026-01-01T00:01:00.000Z', attempts: 0,
  };
  assert.deepEqual(outbox.coalesceCollaborationSync(first, latest), {
    ...latest,
    base,
  });
});
