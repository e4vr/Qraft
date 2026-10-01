import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export async function contributionEconomyApiTests(t, { db, call }) {
  async function account() {
    const uid = `economy-${randomUUID()}`;
    const now = new Date().toISOString();
    const profile = { uid, email: `${uid}@example.test`, displayName: uid, universityId: uid, status: 'approved', role: 'student', tier: 'free', platformRoles: [], createdAt: now };
    await db.prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)').bind(uid, profile.email, 'unused', 'unused', JSON.stringify(profile), null, now, now).run();
    await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,1,?)').bind(createHash('sha256').update(`fixture-${uid}`).digest('hex'), uid, Math.floor(Date.now() / 1000) + 3600, now).run();
    return uid;
  }
  const summary = async uid => (await call(uid, '/platform/contributions')).data;
  const grant = (uid, amount) => call('admin', '/platform/economy-admin', { operation: 'adjust-credits', userId: uid, amount, reason: 'Economy verification fixture', requestId: randomUUID() });

  await t.test('weekly and monthly rewards enforce costs, retry safely and begin only on activation', async () => {
    const uid = await account();
    const catalog = (await call(uid, '/platform/rewards')).data.rewards;
    assert.deepEqual(catalog.map(reward => reward.credits), [200, 400, 850]);
    assert.equal((await grant(uid, 199)).status, 200);
    const request = { operation: 'redeem', rewardId: 'full-access-week', requestId: randomUUID() };
    assert.equal((await call(uid, '/platform/rewards', request)).status, 409);
    assert.equal((await summary(uid)).creditsBalance, 199);
    assert.equal((await summary(uid)).rewardPasses.length, 0);
    assert.equal((await grant(uid, 1)).status, 200);
    const redeemed = await call(uid, '/platform/rewards', request);
    assert.equal(redeemed.status, 201, JSON.stringify(redeemed));
    assert.equal(redeemed.data.pass.duration_days, 7);
    assert.equal(redeemed.data.pass.status, 'available');
    assert.equal(redeemed.data.pass.expires_at, null);
    assert.equal((await call(uid, '/auth/session')).data.user.effectivePlan, 'free');
    const replay = await call(uid, '/platform/rewards', request);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.duplicate, true);
    assert.equal((await summary(uid)).creditsBalance, 0);
    assert.equal((await summary(uid)).rewardPasses.length, 1);
    assert.equal((await call('free', '/platform/rewards', { operation: 'activate', passId: redeemed.data.pass.id })).status, 404);
    const active = await call(uid, '/platform/rewards', { operation: 'activate', passId: redeemed.data.pass.id });
    assert.equal(active.status, 200, JSON.stringify(active));
    assert.equal(active.data.effectivePlan, 'full_monthly');
    assert.equal(Date.parse(active.data.expiresAt) - Date.parse(active.data.pass.activated_at), 7 * 86_400_000);
    assert.equal((await call(uid, '/platform/rewards', { operation: 'activate', passId: redeemed.data.pass.id })).status, 409);
    await db.prepare("UPDATE reward_passes SET expires_at='2000-01-01T00:00:00Z' WHERE id=?").bind(redeemed.data.pass.id).run();
    assert.equal((await call(uid, '/auth/session')).data.user.effectivePlan, 'free');
    assert.equal((await grant(uid, 399)).status, 200);
    const monthRequest = { operation: 'redeem', rewardId: 'full-access-month', requestId: randomUUID() };
    assert.equal((await call(uid, '/platform/rewards', monthRequest)).status, 409);
    assert.equal((await grant(uid, 1)).status, 200);
    const month = await call(uid, '/platform/rewards', monthRequest);
    assert.equal(month.status, 201, JSON.stringify(month));
    assert.equal(month.data.pass.duration_days, null);
    assert.equal(month.data.pass.duration, 1);
    assert.equal(month.data.pass.status, 'available');
    assert.equal((await summary(uid)).creditsBalance, 0);
    assert.equal((await summary(uid)).lifetimeContributionScore, 0);
  });

  await t.test('manual contributions award the agreed points only after independent acceptance and preserve historical scores', async () => {
    const uid = await account();
    const now = new Date().toISOString(), bankId = `economy-bank-${randomUUID()}`;
    const bank = { id: bankId, name: 'Economy verification', visibility: 'public', ownerId: 'admin', reviewerIds: [], viewerIds: [], createdAt: now };
    await db.prepare('INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES(?,?,?,?,?)').bind('qbanks', bankId, bankId, JSON.stringify(bank), now).run();
    for (const [amount, lifetime, id] of [[250, 250, randomUUID()], [-208, 0, randomUUID()]]) {
      await db.prepare('INSERT INTO credit_transactions(id,user_id,amount,lifetime_delta,type,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, uid, amount, lifetime, 'historical_fixture', 'Existing balance and lifetime history', 'admin', now).run();
    }
    let question;
    const cases = [
      ['new_question', ['question_text'], 1, false, 'reviewer'],
      ['question_edit', ['typo_formatting'], 1, false, 'reviewer'],
      ['question_edit', ['source'], 1, false, 'reviewer'],
      ['question_edit', ['explanation'], 4, false, 'admin'],
      ['question_edit', ['question_text'], 8, true, 'reviewer'],
      ['question_edit', ['options'], 8, true, 'reviewer'],
      ['question_edit', ['correct_answer'], 10, true, 'reviewer'],
    ];
    let total = 0;
    try {
      for (const [type, editKinds, amount, twoReviews, reviewer] of cases) {
        const id = randomUUID();
        const payload = question ? { ...question } : { stem: 'Economy manual question?', options: ['A', 'B'], answer: 0, specialty: 'General', topic: 'General', explanation: 'Reasoning', sourceFile: 'Verified.pdf', sourceReference: 'Verified.pdf', images: [] };
        if (editKinds.includes('correct_answer')) payload.answer = 1 - payload.answer;
        else if (editKinds.includes('options')) payload.options = [payload.options[0], `${payload.options[1]} revised`];
        else if (type === 'question_edit') payload[editKinds.includes('source') ? 'sourceFile' : editKinds.includes('explanation') ? 'explanation' : 'stem'] += ' revised';
        const proposal = { id, qbankId: bankId, type, editKinds, questionId: question?.id, payload, rationale: 'Verified correction', submissionMethod: 'manual', proposedById: uid, proposedByName: uid, proposedAt: now, status: 'pending' };
        await db.prepare('INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(?,?,?,?,?,?)').bind('questionProposals', id, bankId, uid, JSON.stringify(proposal), now).run();
        assert.equal((await summary(uid)).creditsBalance, 42 + total);
        assert.equal((await call(uid, '/platform/bulk-review', { proposalIds: [id], status: 'approved' })).status, 403);
        const first = await call(reviewer, '/platform/bulk-review', { proposalIds: [id], status: 'approved' });
        assert.equal(first.status, 200, JSON.stringify(first));
        let accepted = first;
        if (twoReviews) {
          assert.equal(first.data.awaitingSecondReview, 1);
          assert.equal((await summary(uid)).creditsBalance, 42 + total);
          accepted = await call('reviewer2', '/platform/bulk-review', { proposalIds: [id], status: 'approved' });
          assert.equal(accepted.status, 200, JSON.stringify(accepted));
        }
        question = accepted.data.updatedQuestions[0];
        total += amount;
        assert.deepEqual(await db.prepare('SELECT amount,lifetime_delta FROM credit_transactions WHERE reference_id=?').bind(id).first(), { amount, lifetime_delta: amount });
        assert.equal((await summary(uid)).creditsBalance, 42 + total);
        assert.equal((await summary(uid)).lifetimeContributionScore, 250 + total);
        assert.equal((await call('reviewer', '/platform/bulk-review', { proposalIds: [id], status: 'approved' })).status, 409);
        assert.equal((await db.prepare('SELECT count(*) n FROM credit_transactions WHERE reference_id=?').bind(id).first()).n, 1);
      }
      const id = randomUUID();
      const rejected = { id, qbankId: bankId, type: 'question_edit', editKinds: ['explanation'], questionId: question.id, payload: question, rationale: 'Reject fixture', submissionMethod: 'manual', proposedById: uid, proposedByName: uid, proposedAt: now, status: 'pending' };
      await db.prepare('INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(?,?,?,?,?,?)').bind('questionProposals', id, bankId, uid, JSON.stringify(rejected), now).run();
      assert.equal((await call('reviewer', '/platform/bulk-review', { proposalIds: [id], status: 'rejected' })).status, 200);
      assert.equal((await db.prepare('SELECT count(*) n FROM credit_transactions WHERE reference_id=?').bind(id).first()).n, 0);
      assert.equal((await summary(uid)).lifetimeContributionScore, 250 + total);
    } finally {
      await db.prepare("DELETE FROM review_completion_claims WHERE proposal_id IN (SELECT id FROM records WHERE type='questionProposals' AND qbank_id=?)").bind(bankId).run();
      await db.prepare("DELETE FROM records WHERE qbank_id=? OR (type='qbanks' AND id=?)").bind(bankId, bankId).run();
      await db.prepare('DELETE FROM question_ids WHERE qbank_id=?').bind(bankId).run();
    }
  });
}
