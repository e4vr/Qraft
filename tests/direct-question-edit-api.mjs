import assert from 'node:assert/strict';

export async function directQuestionEditApiTests(t, { db, call }) {
  const bankId = 'direct-edit-private', questionId = 'direct-edit-question', now = new Date().toISOString();
  const question = {
    id: questionId, questionId: '98671', qbankId: bankId, number: 1,
    stem: 'Original question', options: ['A', 'B'], answer: 0, answerLetter: 'A',
    specialty: 'General', topic: 'General', sourcePage: 2, sourceFile: 'Original source',
    explanation: 'Original explanation', sourceReference: 'Source', images: [], revision: 1,
    writtenById: 'other', writtenByName: 'other',
  };
  const payload = { ...question, stem: 'Administrator correction', explanation: '' };
  const body = { qbankId: bankId, questionId, baseRevision: 1, payload };
  const read = async (type, id) => {
    const row = await db.prepare('SELECT payload FROM records WHERE type=? AND id=?').bind(type, id).first();
    return row && JSON.parse(row.payload);
  };
  const save = (uid, value = body) => call(uid, '/platform/question-edit', value, 'PUT');
  const proposal = {
    id: 'direct-edit-pending', qbankId: bankId, questionId, type: 'question_edit',
    editKinds: ['typo_formatting'], payload: { ...question, stem: 'Earlier user proposal', explanation: '' },
    currentSnapshot: { ...question }, status: 'pending', rationale: 'Fix wording',
    proposedById: 'other', proposedByName: 'other', proposedAt: now,
  };
  const insert = (type, id, value) => db.prepare('INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES(?,?,?,?,?)')
    .bind(type, id, bankId, JSON.stringify(value), now).run();
  await insert('qbanks', bankId, { id: bankId, name: 'Private', visibility: 'private', ownerId: 'reviewer', reviewerIds: [], viewerIds: [], createdAt: now });
  await insert('sharedQuestions', questionId, question);
  // Production identity invariant: every canonical question has a reservation.
  await db.prepare('INSERT INTO question_ids(question_id,qbank_id,created_by_id,created_at) VALUES(?,?,?,?)').bind(question.questionId, bankId, 'other', now).run();
  await insert('questionProposals', proposal.id, proposal);
  try {
    await t.test('only verified Superadmin can directly edit another user private QBank', async () => {
      for (const uid of ['other', 'reviewer', 'moderator']) assert.equal((await save(uid)).status, 403);
      await db.prepare('UPDATE sessions SET verified=0 WHERE user_id=?').bind('admin').run();
      assert.equal((await save('admin')).status, 403);
      await db.prepare('UPDATE sessions SET verified=1 WHERE user_id=?').bind('admin').run();
      assert.equal((await save('admin', { ...body, qbankId: 'smle-gs' })).status, 404);
      assert.equal((await call('admin', '/platform/question-edit', body)).status, 405);
    });
    await t.test('direct edit deletes explanation, preserves identity and pending proposal, and audits once', async () => {
      const result = await save('admin');
      assert.equal(result.status, 200);
      assert.equal(result.data.question.explanation, '');
      assert.equal(result.data.question.revision, 2);
      assert.equal(result.data.question.writtenById, 'other');
      assert.deepEqual(await read('questionProposals', proposal.id), proposal);
      assert.equal((await db.prepare('SELECT count(*) n FROM contribution_reviews WHERE proposal_id=?').bind(proposal.id).first()).n, 0);
      const replay = await save('admin');
      assert.equal(replay.status, 200);
      assert.equal(replay.data.unchanged, true);
      assert.equal((await db.prepare("SELECT count(*) n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='superadmin_question_edited' AND json_extract(payload,'$.entityId')=?").bind(questionId).first()).n, 1);
    });
    await t.test('stale and invalid administrative edits cannot overwrite saved content', async () => {
      assert.equal((await save('admin', { ...body, payload: { ...payload, stem: 'Stale write' } })).status, 409);
      for (const bad of [{ answer: -1 }, { options: ['one'] }, { stem: '' }, { explanation: null }, { images: [null] }])
        assert.equal((await save('admin', { ...body, baseRevision: 2, payload: { ...payload, ...bad } })).status, 400);
      assert.equal((await read('sharedQuestions', questionId)).stem, payload.stem);
    });
    await t.test('accepting older pending proposal replaces Superadmin correction immediately', async () => {
      const accepted = await call('reviewer', '/platform/bulk-review', { proposalIds: [proposal.id], status: 'approved' });
      assert.equal(accepted.status, 200);
      assert.equal(accepted.data.reviewed, 1);
      assert.equal((await read('sharedQuestions', questionId)).stem, proposal.payload.stem);
      assert.equal((await read('sharedQuestions', questionId)).explanation, '');
    });
    await t.test('rejecting pending proposal leaves subsequent Superadmin edit intact', async () => {
      const current = await read('sharedQuestions', questionId);
      const rejectedProposal = { ...proposal, id: 'direct-edit-reject', payload: { ...proposal.payload, stem: 'Rejected change' } };
      await insert('questionProposals', rejectedProposal.id, rejectedProposal);
      const corrected = { ...body, baseRevision: current.revision, payload: { ...payload, stem: 'Final administrator correction' } };
      assert.equal((await save('admin', corrected)).status, 200);
      const rejected = await call('reviewer', '/platform/bulk-review', { proposalIds: [rejectedProposal.id], status: 'rejected' });
      assert.equal(rejected.status, 200);
      assert.equal((await read('sharedQuestions', questionId)).stem, corrected.payload.stem);
    });
    await t.test('Superadmin directly edits public and Essential QBanks without a proposal', async () => {
      await db.prepare("UPDATE records SET qbank_id='smle-gs',payload=json_set(payload,'$.qbankId','smle-gs') WHERE type='sharedQuestions' AND id=?").bind(questionId).run();
      const current = await read('sharedQuestions', questionId);
      const result = await save('admin', { ...body, qbankId: 'smle-gs', baseRevision: current.revision, payload: { ...payload, stem: 'Essential bank correction' } });
      assert.equal(result.status, 200);
      assert.equal(result.data.question.stem, 'Essential bank correction');
    });
    await t.test('concurrent direct edits commit one winner and one audit entry', async () => {
      const current = await read('sharedQuestions', questionId);
      const attempts = await Promise.all(['Concurrent edit one', 'Concurrent edit two'].map(stem =>
        save('admin', { ...body, qbankId: 'smle-gs', baseRevision: current.revision, payload: { ...payload, stem } })));
      assert.deepEqual(attempts.map(result => result.status).sort((a, b) => a - b), [200, 409]);
      assert.equal((await read('sharedQuestions', questionId)).revision, current.revision + 1);
      assert.equal((await db.prepare("SELECT count(*) n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='superadmin_question_edited' AND json_extract(payload,'$.entityId')=?").bind(questionId).first()).n, 4);
    });
    await t.test('source metadata is persisted separately and an omitted page clears the previous page', async () => {
      const current = await read('sharedQuestions', questionId);
      const nextPayload = { ...payload, sourceFile: 'Unified bank.pdf', sourcePage: 12, sourceReference: 'Unified bank.pdf - p.12' };
      const withPage = await save('admin', { ...body, qbankId: 'smle-gs', baseRevision: current.revision, payload: nextPayload });
      assert.equal(withPage.status, 200);
      assert.equal(withPage.data.question.sourceFile, 'Unified bank.pdf');
      assert.equal(withPage.data.question.sourcePage, 12);
      const withoutPage = { ...nextPayload, sourcePage: undefined, sourceReference: 'Unified bank.pdf' };
      const cleared = await save('admin', { ...body, qbankId: 'smle-gs', baseRevision: withPage.data.question.revision, payload: withoutPage });
      assert.equal(cleared.status, 200);
      assert.equal(Object.hasOwn(cleared.data.question, 'sourcePage'), false);
      assert.equal(cleared.data.question.sourceReference, 'Unified bank.pdf');
      assert.equal(cleared.data.question.questionId, question.questionId);
      assert.equal((await save('admin', { ...body, qbankId: 'smle-gs', baseRevision: cleared.data.question.revision, payload: { ...withoutPage, sourcePage: 0 } })).status, 400);
      assert.equal(Object.hasOwn(await read('sharedQuestions', questionId), 'sourcePage'), false);
    });
    await t.test('explanation images round-trip through direct edits, legacy edits and clearing', async () => {
      const image = { id: 'solution', url: 'https://example.test/solution.png', name: 'solution.png', caption: 'Clinical reasoning' };
      let current = await read('sharedQuestions', questionId);
      const withImages = await save('admin', { ...body, qbankId: 'smle-gs', baseRevision: current.revision, payload: { ...current, explanationImages: [image] } });
      assert.equal(withImages.status, 200, JSON.stringify(withImages));
      assert.deepEqual((await read('sharedQuestions', questionId)).explanationImages, [image]);
      current = withImages.data.question;
      const { explanationImages, ...legacy } = current;
      const preserved = await save('admin', { ...body, qbankId: 'smle-gs', baseRevision: current.revision, payload: { ...legacy, explanation: 'Legacy correction' } });
      assert.equal(preserved.status, 200);
      assert.deepEqual(preserved.data.question.explanationImages, explanationImages);
      const invalid = await save('admin', { ...body, qbankId: 'smle-gs', baseRevision: preserved.data.question.revision, payload: { ...preserved.data.question, explanationImages: [{ ...image, url: 'javascript:alert(1)' }] } });
      assert.equal(invalid.status, 400);
      const cleared = await save('admin', { ...body, qbankId: 'smle-gs', baseRevision: preserved.data.question.revision, payload: { ...preserved.data.question, explanationImages: [] } });
      assert.equal(cleared.status, 200);
      assert.deepEqual(cleared.data.question.explanationImages, []);
    });
    await t.test('new question contributions and reviewed edits preserve explanation images', async () => {
      const image = { id: 'diagram', url: '/api/cloudflare/media/shared-notes/fixture.png', name: 'diagram.png', caption: 'Solution diagram' };
      const newId = 'explanation-image-proposal', editId = 'explanation-image-edit';
      const newProposal = { ...proposal, id: newId, questionId: undefined, type: 'new_question', proposedById: 'admin', proposedByName: 'admin', payload: { ...question, stem: 'New illustrated question', explanationImages: [image] } };
      let published;
      try {
        const submit = value => call('admin', '/collaboration', { operations: [{ collection: 'questionProposals', id: value.id, type: 'set', value }] }, 'PUT');
        const invalid = await submit({ ...newProposal, payload: { ...newProposal.payload, explanationImages: [{ ...image, url: 'data:image/png;base64,bad' }] } });
        assert.equal(invalid.status, 403);
        assert.equal((await submit(newProposal)).status, 200);
        const accepted = await call('reviewer', '/platform/bulk-review', { proposalIds: [newId], status: 'approved' });
        assert.equal(accepted.status, 200, JSON.stringify(accepted));
        published = accepted.data.updatedQuestions.find(item => item.stem === newProposal.payload.stem);
        assert.ok(published);
        assert.deepEqual(published.explanationImages, [image]);
        assert.deepEqual((await read('sharedQuestions', published.id)).explanationImages, [image]);
        const { explanationImages: _images, ...legacyPayload } = newProposal.payload;
        const edit = { ...newProposal, id: editId, type: 'question_edit', questionId: published.id, editKinds: ['explanation'], payload: { ...legacyPayload, explanation: 'Edited text from an older client' } };
        assert.equal((await submit(edit)).status, 200);
        const reviewed = await call('reviewer', '/platform/bulk-review', { proposalIds: [editId], status: 'approved' });
        assert.equal(reviewed.status, 200, JSON.stringify(reviewed));
        assert.deepEqual((await read('sharedQuestions', published.id)).explanationImages, [image]);
      } finally {
        for (const id of [newId, editId]) {
          await db.prepare('DELETE FROM contribution_reviews WHERE proposal_id=?').bind(id).run();
          await db.prepare('DELETE FROM review_completion_claims WHERE proposal_id=?').bind(id).run();
          await db.prepare('DELETE FROM credit_transactions WHERE reference_id=?').bind(id).run();
          await db.prepare("DELETE FROM records WHERE type='questionProposals' AND id=?").bind(id).run();
        }
        if (published) {
          await db.prepare("DELETE FROM records WHERE type='sharedQuestions' AND id=?").bind(published.id).run();
          await db.prepare('DELETE FROM question_ids WHERE question_id=?').bind(published.questionId).run();
        }
      }
    });
  } finally {
    await db.prepare('UPDATE sessions SET verified=1 WHERE user_id=?').bind('admin').run();
    await db.prepare('DELETE FROM contribution_reviews WHERE proposal_id IN (?,?)').bind(proposal.id, 'direct-edit-reject').run();
    await db.prepare('DELETE FROM review_completion_claims WHERE proposal_id IN (?,?)').bind(proposal.id, 'direct-edit-reject').run();
    await db.prepare('DELETE FROM credit_transactions WHERE reference_id IN (?,?)').bind(proposal.id, 'direct-edit-reject').run();
    await db.prepare('DELETE FROM question_ids WHERE question_id=?').bind(question.questionId).run();
    await db.prepare("DELETE FROM records WHERE id IN (?,?,?,?) OR (type='auditLog' AND json_extract(payload,'$.entityId')=?)").bind(bankId, questionId, proposal.id, 'direct-edit-reject', questionId).run();
  }
}
