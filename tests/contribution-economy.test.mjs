import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: { contents: `export * from './features/contributions/domain/contribution-reward'; export * from './features/subscriptions/domain/plan-config';`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const proposal = (type, editKinds, extra = {}) => ({ type, editKinds, ...extra });

void test('approved task awards match the agreed contribution schedule', () => {
  const cases = [
    [proposal('new_question', ['question_text']), 1],
    [proposal('question_edit', ['typo_formatting']), 1],
    [proposal('question_edit', ['source']), 1],
    [proposal('question_edit', ['explanation']), 4],
    [proposal('question_edit', ['question_text']), 8],
    [proposal('question_edit', ['options']), 8],
    [proposal('question_edit', ['correct_answer']), 10],
  ];
  for (const [item, amount] of cases) assert.equal(m.contributionReward(item).amount, amount);
  assert.equal(m.CONTRIBUTION_CREDITS.validReport, 2);
});

void test('import origin suppresses only new-question rewards, including legacy batch metadata', () => {
  for (const origin of [{ submissionMethod: 'json' }, { importBatchId: 'batch' }, { submissionMethod: 'manual', importBatchId: 'batch' }]) {
    assert.equal(m.contributionReward(proposal('new_question', ['correct_answer', 'explanation'], origin)).amount, 0);
  }
  assert.equal(m.contributionReward(proposal('question_edit', ['explanation'], { submissionMethod: 'json', importBatchId: 'old-bank' })).amount, 4);
});

void test('mixed edits grant one reward while manual new questions retain their own award', () => {
  const kinds = ['typo_formatting', 'source', 'explanation', 'options', 'question_text', 'correct_answer'];
  assert.equal(m.contributionReward(proposal('question_edit', kinds)).amount, 10);
  assert.equal(m.contributionReward(proposal('question_edit', kinds.slice(0, -1))).amount, 8);
  assert.equal(m.contributionReward(proposal('question_edit', kinds.slice(0, 3))).amount, 4);
  assert.equal(m.contributionReward(proposal('new_question', kinds, { submissionMethod: 'manual' })).amount, 1);
});

void test('reward catalog prices and labels distinguish a seven-day pass from calendar subscriptions', () => {
  assert.deepEqual(m.REWARD_CATALOG.map(reward => [reward.id, reward.credits]), [
    ['full-access-week', 200], ['full-access-month', 400], ['full-access-quarter', 850],
  ]);
  assert.equal(m.REWARD_CATALOG[0].durationDays, 7);
  assert.equal(m.rewardDurationLabel(m.REWARD_CATALOG[0]), '1 week (7 days)');
  assert.equal(m.rewardDurationLabel(m.REWARD_CATALOG[1]), '1 month');
  assert.equal(m.rewardDurationLabel(m.REWARD_CATALOG[2]), '3 months');
});
