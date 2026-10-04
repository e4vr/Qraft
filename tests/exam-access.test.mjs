import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const output = await build({ entryPoints: ['features/subscriptions/domain/exam-access.ts', 'features/subscriptions/domain/plan-config.ts'], bundle: true, write: false, outdir: 'unused', format: 'esm', platform: 'node' });
const modules = await Promise.all(output.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const { exhaustedExamAllowance, examRestriction } = modules.find(item => item.examRestriction);
const { PLAN_LIMITS } = modules.find(item => item.PLAN_LIMITS);
void test('exam allowance uses authoritative lifetime counts, never remaining history', () => {
  assert.equal(exhaustedExamAllowance(PLAN_LIMITS.free, { lifetimeStartedExams: 1, monthlyStartedExams: 1 }), null);
  assert.equal(exhaustedExamAllowance(PLAN_LIMITS.free, { lifetimeStartedExams: 2, monthlyStartedExams: 0 }), 'lifetime');
  assert.equal(exhaustedExamAllowance(PLAN_LIMITS.full_monthly, { lifetimeStartedExams: 10000, monthlyStartedExams: 10000 }), null);
  assert.equal(exhaustedExamAllowance(PLAN_LIMITS.full_quarterly, { lifetimeStartedExams: 10000, monthlyStartedExams: 10000 }), null);
  assert.equal(exhaustedExamAllowance({ ...PLAN_LIMITS.free, lifetimeExamLimit: null, monthlyExamLimit: 3 }, { lifetimeStartedExams: 10, monthlyStartedExams: 3 }), 'monthly');
  assert.equal(exhaustedExamAllowance(PLAN_LIMITS.free, { lifetimeStartedExams: NaN, monthlyStartedExams: 0 }), null);
});
void test('only explicit exam restrictions become upgrade prompts', () => {
  assert.equal(examRestriction({ status: 403, payload: { code: 'EXAM_LIMIT_REACHED' } }), 'exams');
  assert.equal(examRestriction({ status: 403, payload: { code: 'EXAM_QUESTION_LIMIT_REACHED' } }), 'questions');
  assert.equal(examRestriction({ status: 403, message: "You've reached your lifetime exam limit." }), 'exams');
  for (const error of [null, new Error('Unable to connect'), {status:0,payload:{code:'EXAM_LIMIT_REACHED'}}, {status:429,payload:{code:'EXAM_LIMIT_REACHED'}}, {status:403,message:'QBank access required.'}, {status:403,payload:{code:'QUESTION_LIMIT_REACHED'}}, {status:500,message:"You've reached your lifetime exam limit."}]) assert.equal(examRestriction(error),null);
});
