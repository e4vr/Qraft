import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export async function accessRevocationApiTests(t, { db, call }) {
  const now = new Date().toISOString(), future = new Date(Date.now() + 365 * 86400000).toISOString();
  const createdUsers = [], createdGifts = [], createdCodes = [];
  async function account(tier = 'free') {
    const uid = 'access-revision-' + randomUUID();
    createdUsers.push(uid);
    const profile = { uid, email: uid + '@example.test', displayName: 'Access revision test', role: 'student', status: 'approved', tier, platformRoles: [], universityId: uid, createdAt: now };
    await db.prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)').bind(uid, profile.email, '!', '!', JSON.stringify(profile), null, now, now).run();
    await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,1,?)').bind(createHash('sha256').update('fixture-' + uid).digest('hex'), uid, Math.floor(Date.now()/1000)+3600, now).run();
    return uid;
  }
  async function grant(uid, days = 9, plan = 'full_monthly') {
    const result = await call('admin', '/platform/economy-admin', { operation: 'grant-reward', userId: uid, days, plan, reason: 'Access revision verification' });
    assert.equal(result.status, 200, JSON.stringify(result));
    createdGifts.push(result.data.pass.id);
    return result.data.pass.id;
  }
  const activate = (uid, passId) => call(uid, '/platform/rewards', { operation: 'activate', passId });
  const revoke = (uid, requestId = randomUUID()) => call('admin', '/platform/subscriptions', { operation: 'override', userId: uid, plan: 'free', requestId, reason: 'Revoke existing access' });
  const user = async uid => (await call(uid, '/auth/session')).data.user;
  const row = id => db.prepare('SELECT * FROM reward_passes WHERE id=?').bind(id).first();
  async function listing(uid) {
    const result = await call('admin', '/platform/subscriptions?search=' + uid);
    assert.equal(result.status, 200, JSON.stringify(result));
    return result.data.subscriptions.find(item => item.uid === uid);
  }

  try {
  await t.test('revocation preserves financial and gift history, allows stored gifts, and cannot resurrect old access', async () => {
    const uid = await account('full_quarterly');
    await db.prepare("INSERT INTO subscriptions(user_id,status,starts_at,expires_at,method,paid,updated_at,plan) VALUES(?,'active',?,?,'manual',23000,?,'full_quarterly')").bind(uid, now, future, now).run();
    await db.prepare("INSERT INTO admin_plan_entitlements(id,user_id,plan,reason,granted_by,created_at,expires_at) VALUES(?,?,'full_quarterly','Existing grant','admin',?,?)").bind(randomUUID(), uid, now, future).run();
    const old = await grant(uid, 90, 'full_quarterly');
    assert.equal((await activate(uid, old)).status, 200);
    const unused = await grant(uid, 9);
    const beforeGift = await row(old), beforeBilling = await db.prepare('SELECT * FROM subscriptions WHERE user_id=?').bind(uid).first();
    const cancelled = await revoke(uid);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.effectivePlan, 'free');
    assert.equal(cancelled.data.accessRevision, 1);
    assert.equal((await user(uid)).effectivePlan, 'free');
    assert.equal((await listing(uid)).tier, 'free');
    assert.deepEqual(await row(old), beforeGift);
    assert.deepEqual(await db.prepare('SELECT * FROM subscriptions WHERE user_id=?').bind(uid).first(), beforeBilling);
    const wallet = (await call(uid, '/platform/rewards')).data.passes;
    assert.equal(wallet.find(pass => pass.id === old).status, 'cancelled');
    assert.equal(wallet.find(pass => pass.id === unused).status, 'available');
    assert.equal((await activate(uid, old)).status, 409);
    const resumed = await activate(uid, unused);
    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.effectivePlan, 'full_monthly');
    assert.equal(Date.parse(resumed.data.pass.expires_at)-Date.parse(resumed.data.pass.activated_at), 9*86400000);
    assert.equal((await row(unused)).access_generation, 1);
    assert.equal((await listing(uid)).tier, 'full_monthly');
    assert.equal((await listing(uid)).effective_expires_at, resumed.data.expiresAt);
    await db.prepare("UPDATE reward_passes SET expires_at='2000-01-01T00:00:00Z' WHERE id=?").bind(unused).run();
    // Even expiring/removing the visible Free assignment cannot remove the revocation.
    await db.prepare('DELETE FROM account_plan_overrides WHERE user_id=?').bind(uid).run();
    assert.equal((await user(uid)).effectivePlan, 'free');
    assert.equal((await listing(uid)).tier, 'free');
  });

  await t.test('arbitrary gift days grant Full after revocation and ignore client access-generation values', async () => {
    for (const plan of ['full_monthly','full_quarterly']) for (const days of [1,9,45,730]) {
      const uid = await account();
      const passId = await grant(uid, days, plan);
      assert.equal((await revoke(uid)).status, 200);
      const activation = await call(uid, '/platform/rewards', { operation: 'activate', passId, access_generation: 9999, accessRevision: 9999 });
      assert.equal(activation.status, 200, JSON.stringify(activation));
      assert.equal(activation.data.effectivePlan, plan);
      assert.equal((await row(passId)).access_generation, 1);
      assert.equal(Date.parse(activation.data.expiresAt)-Date.parse(activation.data.pass.activated_at), days*86400000);
      const currentUser = await user(uid);
      assert.equal(currentUser.planLimits.lifetimeExamLimit, null);
      assert.equal(currentUser.planLimits.canUseFlashcards, true);
      assert.equal((await call(uid, '/platform/exam-start', { testId: randomUUID(), questionCount: 50 })).status, 201);
    }
  });

  await t.test('replayed revocation never cancels later gifts, but a new revocation does', async () => {
    const uid = await account(), requestId = randomUUID();
    assert.equal((await revoke(uid, requestId)).data.accessRevision, 1);
    const gift = await grant(uid);
    assert.equal((await activate(uid, gift)).status, 200);
    const retry = await revoke(uid, requestId);
    assert.equal(retry.data.unchanged, true);
    assert.equal(retry.data.effectivePlan, 'full_monthly');
    assert.equal(retry.data.accessRevision, 1);
    assert.equal((await revoke(uid)).data.accessRevision, 2);
    assert.equal((await user(uid)).effectivePlan, 'free');
    // A retry after a different revocation still must not increment the revision.
    assert.equal((await revoke(uid, requestId)).data.accessRevision, 2);
    const nextGift = await grant(uid, 2);
    assert.equal((await activate(uid, nextGift)).data.effectivePlan, 'full_monthly');
    assert.equal((await row(nextGift)).access_generation, 2);
    assert.equal((await revoke(uid, requestId)).data.effectivePlan, 'full_monthly');
  });

  await t.test('activation and revocation races follow the database commit order, including simultaneous activation retries', async () => {
    for (let i=0;i<8;i++) {
      const uid = await account(), id = await grant(uid);
      const operations = [activate(uid,id), revoke(uid)];
      const result = await Promise.all(i%2 ? operations.reverse() : operations);
      assert.ok(result.every(item => item.status===200), JSON.stringify(result));
      const gift = await row(id), current = await user(uid);
      assert.equal(current.accessRevision, 1);
      assert.equal(current.effectivePlan, gift.access_generation===1 ? 'full_monthly' : 'free');
      assert.equal((await listing(uid)).tier, current.effectivePlan);
    }
    const uid = await account(), id = await grant(uid);
    await revoke(uid);
    const activations = await Promise.all([activate(uid,id),activate(uid,id),activate(uid,id)]);
    assert.equal(activations.filter(item=>item.status===200).length,1);
    assert.equal(activations.filter(item=>item.status===409).length,2);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='reward_activated' AND json_extract(payload,'$.entityId')=?").bind(id).first()).n,1);
  });

  await t.test('activation and revocation roll back completely when audit storage fails', async () => {
    const uid = await account(), id = await grant(uid), before = await row(id);
    await db.exec(`CREATE TRIGGER fail_access_audit BEFORE INSERT ON records WHEN NEW.type='auditLog' AND json_extract(NEW.payload,'$.action') IN ('subscription_plan_overridden','reward_activated') AND json_extract(NEW.payload,'$.entityId') IN ('${uid}','${id}') BEGIN SELECT RAISE(ABORT,'ACCESS_AUDIT_FAILURE'); END;`);
    try {
      assert.equal((await revoke(uid)).status,500);
      assert.equal(await db.prepare('SELECT * FROM account_access_revisions WHERE user_id=?').bind(uid).first(),null);
      assert.equal((await activate(uid,id)).status,500);
      assert.deepEqual(await row(id),before);
    } finally { await db.exec('DROP TRIGGER fail_access_audit;'); }
    assert.equal((await activate(uid,id)).status,200);
  });

  await t.test('new paid and admin grants work after cancellation without restoring prior grants', async () => {
    const uid = await account('full_quarterly');
    await revoke(uid);
    const paid = await call('admin', '/platform/subscriptions', { userId: uid, plan: 'full_monthly', expires_at: future, paid: 10000 });
    assert.equal(paid.status,200,JSON.stringify(paid));
    assert.equal(paid.data.effectivePlan,'full_monthly');
    assert.equal((await db.prepare('SELECT access_generation FROM subscriptions WHERE user_id=?').bind(uid).first()).access_generation,1);
    await revoke(uid);
    const assignment = await call('admin', '/platform/subscriptions', { operation:'override',userId:uid,plan:'full_monthly',expires_at:future,reason:'New grant' });
    assert.equal(assignment.status,200);
    assert.equal(assignment.data.effectivePlan,'full_monthly');
    await db.prepare("UPDATE account_plan_overrides SET expires_at='2000-01-01' WHERE user_id=?").bind(uid).run();
    assert.equal((await user(uid)).effectivePlan,'free');
    const codeId = randomUUID(), code = 'REVISION-' + randomUUID();
    createdCodes.push(codeId);
    await db.prepare("INSERT INTO discount_codes(id,code,kind,amount,updated_at) VALUES(?,?,'percent',100,?)").bind(codeId,code,now).run();
    const requestId = randomUUID();
    const redeemed = await call(uid,'/platform/checkout',{plan:'full_monthly',code,requestId});
    assert.equal(redeemed.status,200,JSON.stringify(redeemed));
    assert.equal(redeemed.data.user.effectivePlan,'full_monthly');
    assert.equal((await db.prepare('SELECT access_generation FROM subscriptions WHERE user_id=?').bind(uid).first()).access_generation,2);
    await revoke(uid);
    const retry = await call(uid,'/platform/checkout',{plan:'full_monthly',code,requestId});
    assert.equal(retry.status,200);
    assert.equal(retry.data.user.effectivePlan,'free');
    assert.equal((await db.prepare('SELECT uses FROM discount_codes WHERE id=?').bind(codeId).first()).uses,1);
  });

  await t.test('Full expiry selects the longest eligible gift and respects indefinite access', async () => {
    const uid = await account();
    let longest;
    for (const [plan,days] of [['full_monthly',1],['full_monthly',45],['full_quarterly',2]]) {
      const active = await activate(uid,await grant(uid,days,plan));
      if(days===45)longest=active.data.expiresAt;
    }
    assert.equal((await user(uid)).effectivePlanExpiresAt,longest);
    assert.equal((await listing(uid)).effective_expires_at,longest);
    await db.prepare("INSERT INTO admin_plan_entitlements(id,user_id,plan,reason,granted_by,created_at) VALUES(?,?,'full_monthly','Indefinite grant','admin',?)").bind(randomUUID(),uid,now).run();
    assert.equal((await user(uid)).effectivePlanExpiresAt,null);
  });

  await t.test('only approved verified Superadmin can revoke; suspension and gift ownership still protect activation', async () => {
    const uid = await account(), id = await grant(uid);
    for (const role of ['free','access','moderator','missing-session']) assert.equal((await call(role,'/platform/subscriptions',{operation:'override',userId:uid,plan:'free',requestId:randomUUID()})).status,403);
    assert.equal(await db.prepare('SELECT * FROM account_access_revisions WHERE user_id=?').bind(uid).first(),null);
    assert.equal((await activate('free',id)).status,404);
    await db.prepare("UPDATE profiles SET profile_json=json_set(profile_json,'$.suspended',json('true')) WHERE uid=?").bind(uid).run();
    assert.equal((await activate(uid,id)).status,403);
    assert.equal((await row(id)).status,'available');
  });
  } finally {
    // These accounts intentionally match "rev" searches. Remove fixtures before
    // subsequent reviewer-directory tests, as well as their own billing/audits.
    const users = JSON.stringify(createdUsers);
    await db.batch([
      db.prepare('DELETE FROM subscriptions WHERE user_id IN (SELECT value FROM json_each(?))').bind(users),
      db.prepare('DELETE FROM subscription_events WHERE user_id IN (SELECT value FROM json_each(?))').bind(users),
      db.prepare('DELETE FROM test_registry WHERE user_id IN (SELECT value FROM json_each(?))').bind(users),
      db.prepare('DELETE FROM reward_passes WHERE user_id IN (SELECT value FROM json_each(?))').bind(users),
      db.prepare('DELETE FROM credit_transactions WHERE user_id IN (SELECT value FROM json_each(?))').bind(users),
      db.prepare("DELETE FROM records WHERE type='auditLog' AND json_extract(payload,'$.entityId') IN (SELECT value FROM json_each(?))").bind(JSON.stringify([...createdUsers,...createdGifts])),
      db.prepare('DELETE FROM discount_codes WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(createdCodes)),
      db.prepare('DELETE FROM profiles WHERE uid IN (SELECT value FROM json_each(?))').bind(users),
    ]);
  }
}
