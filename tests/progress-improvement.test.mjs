import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const output = await build({ entryPoints: ['features/progress/domain/progress-summary.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { summarizeProgress, topicStudyConfig } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const s = { id: 's', qbankId: 'bank', name: 'Medicine', order: 0 };
const t = { id: 't', qbankId: 'bank', specialtyId: 's', name: 'Cardiology', order: 0 };
const q = (id, changes = {}) => ({ id, qbankId: 'bank', answer: 0, specialtyId: 's', topicId: 't', specialty: 'Medicine', topic: 'Cardiology', ...changes });
const answer = (lastAnswer, attempts = 1) => ({ attempts, lastAnswer, correctAttempts: 999, incorrectAttempts: 999 });

void test('rounded correct-answer percentage controls both display and the 75% threshold', () => {
  const questions = Array.from({ length: 1000 }, (_, i) => q(String(i)));
  for (const [correct, expected, visible] of [[744, 74, true], [745, 75, false], [749, 75, false], [750, 75, false], [0, 0, true], [1000, 100, false]]) {
    const progress = Object.fromEntries(questions.map((question, i) => [question.id, answer(i < correct ? 0 : 1)]));
    const summary = summarizeProgress(progress, questions, [s], [t]);
    assert.equal(summary.categories[0].topics[0].accuracy, expected);
    assert.equal(summary.areasToImprove.length > 0, visible);
    assert.equal(summary.correct, correct);
  }
});

void test('unanswered and empty topics do not imply weakness; last answers count once', () => {
  const questions = [q('a'), q('b')];
  const initial = summarizeProgress({}, questions, [s], [t, { ...t, id: 'empty' }]);
  assert.equal(initial.areasToImprove.length, 0);
  assert.equal(initial.categories[0].topics.length, 1);
  const progress = { a: answer(1, 100), absent: answer(1) };
  const weak = summarizeProgress(progress, questions, [s], [t]);
  assert.equal(weak.completed, 1);
  assert.equal(weak.areasToImprove[0].accuracy, 0);
  progress.a = answer(0, 101);
  const improved = summarizeProgress(progress, questions, [s], [t]);
  assert.equal(improved.completed, 1);
  assert.equal(improved.accuracy, 100);
  assert.equal(improved.areasToImprove.length, 0);
  assert.equal(summarizeProgress(progress, [], [s], [t]).areasToImprove.length, 0);
});

void test('weak topics are ordered by rounded accuracy then answered sample size', () => {
  const questions = [q('a', { topic: 'A', topicId: undefined }), q('b', { topic: 'B', topicId: undefined }), q('c', { topic: 'B', topicId: undefined }), q('d', { topic: 'C', topicId: undefined }), q('e', { topic: 'C', topicId: undefined })];
  const progress = { a: answer(1), b: answer(1), c: answer(1), d: answer(0), e: answer(1) };
  const summary = summarizeProgress(progress, questions, [s], []);
  assert.deepEqual(summary.areasToImprove.map(topic => [topic.topic, topic.accuracy]), [['B', 0], ['A', 0], ['C', 50]]);
});

void test('study includes all questions in one topic, preserving classification IDs and plan limits', () => {
  const summary = summarizeProgress({ a: answer(1) }, [q('a'), q('b'), q('c')], [s], [t]);
  const config = topicStudyConfig(summary.areasToImprove[0], 2);
  assert.deepEqual(config, { mode: 'tutor', statuses: [], specialty: '', topics: [], includedTopics: [{ specialty: 'Medicine', topic: 'Cardiology', specialtyId: 's', topicId: 't' }], randomAll: false, count: 2 });
  assert.equal(topicStudyConfig(summary.areasToImprove[0], 0), null);
  assert.equal(topicStudyConfig(summary.areasToImprove[0], 100).count, 3);
});

void test('renamed classifications and legacy names build distinct selections without crossing specialties', () => {
  const renamed = { ...t, name: 'New topic' };
  const otherS = { ...s, id: 'other', name: 'Surgery' };
  const otherT = { ...renamed, id: 'other-topic', specialtyId: 'other' };
  const questions = [q('a', { topic: 'Old topic' }), q('b', { topicId: undefined, specialtyId: undefined, topic: 'New topic' }), q('c', { specialtyId: 'other', topicId: 'other-topic', specialty: 'Surgery', topic: 'New topic' })];
  const summary = summarizeProgress({ a: answer(1), c: answer(1) }, questions, [s, otherS], [renamed, otherT]);
  assert.equal(summary.areasToImprove.length, 2);
  const medicine = summary.areasToImprove.find(topic => topic.specialty === 'Medicine');
  assert.equal(medicine.total, 2);
  assert.deepEqual(medicine.studyTopics, [{ specialty: 'Medicine', topic: 'New topic', specialtyId: 's', topicId: 't' }, { specialty: 'Medicine', topic: 'New topic', specialtyId: null, topicId: null }]);
  assert.equal(summary.areasToImprove.find(topic => topic.specialty === 'Surgery').studyTopics[0].topicId, 'other-topic');
  const otherBank = summarizeProgress({ a: answer(1) }, [q('elsewhere', { qbankId: 'other-bank' })], [s], [t]);
  assert.equal(otherBank.areasToImprove.length, 0);
});

void test('grandfathered equal names keep legacy questions in only their assigned Progress group', () => {
  const duplicate = { ...t, id: 'duplicate-topic' };
  const summary = summarizeProgress({ a: answer(1), b: answer(1), c: answer(1) }, [q('a'), q('b', { topicId: 'duplicate-topic' }), q('c', { specialtyId: undefined, topicId: undefined })], [s], [t, duplicate]);
  const first = summary.areasToImprove.find(topic => topic.id === 't');
  const second = summary.areasToImprove.find(topic => topic.id === 'duplicate-topic');
  assert.equal(first.total, 2);
  assert.equal(second.total, 1);
  assert.deepEqual(second.studyTopics, [{ specialty: 'Medicine', topic: 'Cardiology', specialtyId: 's', topicId: 'duplicate-topic' }]);
  assert.equal(first.studyTopics.filter(selection => selection.topicId === null).length, 1);
});
