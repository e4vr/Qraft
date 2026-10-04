import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function classificationCleanupApiTests(t, { db, call }) {
  const now = new Date().toISOString(), bankId = 'classification-cleanup-bank';
  const specialty = (id, name) => ({ id, qbankId: bankId, name, order: 0, createdAt: now, updatedAt: now });
  const topic = (id, specialtyId, name) => ({ ...specialty(id, name), specialtyId });
  const oldS = specialty('cleanup-old-s', 'Old'), oldT = topic('cleanup-old-t', oldS.id, 'Old topic');
  const newS = specialty('cleanup-new-s', 'New'), newT = topic('cleanup-new-t', newS.id, 'New topic');
  const question = { id: 'cleanup-question', questionId: '98731', qbankId: bankId, number: 1,
    specialtyId: oldS.id, topicId: oldT.id, specialty: oldS.name, topic: oldT.name,
    stem: 'Classification cleanup fixture', options: ['A', 'B'], answer: 0, answerLetter: 'A',
    explanation: 'Explanation', sourceFile: 'Cleanup source', sourceReference: 'Cleanup source', revision: 1, images: [] };
  const insert = (type, value) => db.prepare('INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES(?,?,?,?,?)')
    .bind(type, value.id, bankId, JSON.stringify(value), now).run();
  const classifications = async () => (await db.prepare("SELECT type,id FROM records WHERE qbank_id=? AND type IN ('qbankSpecialties','qbankTopics') ORDER BY type,id").bind(bankId).all()).results;
  const save = (baseRevision, specialties, topics, assignments = [], operationId = randomUUID()) => call('admin', '/platform/classification', { qbankId: bankId, operationId, baseRevision, specialties, topics, assignments }, 'PUT');
  await insert('qbanks', { id: bankId, name: 'Cleanup bank', ownerId: 'admin', visibility: 'private', essential: false, createdAt: now });
  await db.prepare('INSERT INTO question_ids(question_id,qbank_id,created_by_id,created_at) VALUES(?,?,?,?)').bind(question.questionId, bankId, 'admin', now).run();
  await insert('sharedQuestions', question);
  await insert('qbankSpecialties', oldS);
  await insert('qbankTopics', oldT);
  try {
    await t.test('moving the last question removes old and unused classifications atomically', async () => {
      const operationId = randomUUID();
      const specialties = [oldS, newS, specialty('cleanup-empty-s', 'Unused')];
      const topics = [oldT, newT, topic('cleanup-empty-t', newS.id, 'Unused')];
      const assignments = [{ questionId: question.id, topicId: newT.id }];
      const result = await save(0, specialties, topics, assignments, operationId);
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.deepEqual(result.data.specialties.map(s => s.id), [newS.id]);
      assert.deepEqual(result.data.topics.map(s => s.id), [newT.id]);
      const revision = await db.prepare('SELECT revision FROM qbank_classification_revisions WHERE qbank_id=?').bind(bankId).first();
      assert.equal(result.data.revision, revision.revision);
      const stored = JSON.parse((await db.prepare("SELECT payload FROM records WHERE type='sharedQuestions' AND id=?").bind(question.id).first()).payload);
      assert.equal(stored.topicId, newT.id);
      const replay = await save(0, specialties, topics, assignments, operationId);
      assert.equal(replay.status, 200);
      assert.equal(replay.data.unchanged, true);
      assert.equal(replay.data.revision, result.data.revision);
      assert.deepEqual(replay.data.specialties, result.data.specialties);
      assert.deepEqual(replay.data.topics, result.data.topics);
      assert.equal(replay.data.assignments[0].topicId, newT.id);
      assert.equal((await save(0, [oldS], [oldT])).status, 409);
      assert.equal((await classifications()).length, 2);
    });
    await t.test('deleting the last question removes both levels and records journal removals', async () => {
      const result = await call('admin', '/platform/question', { id: question.questionId }, 'DELETE');
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.deepEqual(await classifications(), []);
      const removed = await db.prepare("SELECT record_id FROM collaboration_changes WHERE qbank_id=? AND collection IN ('qbankTopics','qbankSpecialties')").bind(bankId).all();
      assert.ok(removed.results.some(row => row.record_id === newT.id));
      assert.ok(removed.results.some(row => row.record_id === newS.id));
    });
    await t.test('empty preparation is removed while later publication restores proposal classification', async () => {
      const revision = await db.prepare('SELECT revision FROM qbank_classification_revisions WHERE qbank_id=?').bind(bankId).first();
      const prepared = await save(revision.revision, [newS], [newT]);
      assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
      assert.deepEqual(prepared.data.specialties, []);
      assert.deepEqual(prepared.data.topics, []);
      const proposalId = 'cleanup-pending-proposal';
      await insert('questionProposals', { id: proposalId, qbankId: bankId, type: 'new_question', status: 'pending',
        payload: { ...question, specialtyId: newS.id, specialty: newS.name, topicId: newT.id, topic: newT.name },
        proposedById: 'other', proposedByName: 'Contributor', proposedAt: now,
        rationale: 'Fixture', submissionMethod: 'json', importBatchId: 'cleanup-api-import', editKinds: ['question_text'] });
      const published = await call('admin', '/platform/bulk-review', { proposalIds: [proposalId], status: 'approved' });
      assert.equal(published.status, 200, JSON.stringify(published.data));
      assert.equal(published.data.reviewed, 1);
      assert.deepEqual((await classifications()).map(row => row.id), [newS.id, newT.id]);
    });
    await t.test('an older proposal reuses the current classification without creating a duplicate', async () => {
      const proposalId = 'cleanup-older-proposal';
      await insert('questionProposals', { id: proposalId, qbankId: bankId, type: 'new_question', status: 'pending',
        payload: { ...question, specialtyId: 'removed-specialty', specialty: newS.name, topicId: 'removed-topic', topic: newT.name },
        proposedById: 'other', proposedByName: 'Contributor', proposedAt: now,
        rationale: 'Fixture', submissionMethod: 'json', importBatchId: 'cleanup-api-import', editKinds: ['question_text'] });
      const published = await call('admin', '/platform/bulk-review', { proposalIds: [proposalId], status: 'approved' });
      assert.equal(published.status, 200, JSON.stringify(published.data));
      assert.equal(published.data.updatedQuestions[0].specialtyId, newS.id);
      assert.equal(published.data.updatedQuestions[0].topicId, newT.id);
      assert.equal((await classifications()).length, 2);
    });
  } finally {
    for (const table of ['review_completion_claims', 'contribution_reviews'])
      await db.prepare(`DELETE FROM ${table} WHERE proposal_id IN ('cleanup-pending-proposal','cleanup-older-proposal')`).run();
    await db.prepare('DELETE FROM records WHERE qbank_id=?').bind(bankId).run();
    await db.prepare("DELETE FROM records WHERE type='qbanks' AND id=?").bind(bankId).run();
    await db.prepare('DELETE FROM qbank_classification_revisions WHERE qbank_id=?').bind(bankId).run();
  }
}
