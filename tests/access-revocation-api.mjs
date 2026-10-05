import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export async function accessRevocationApiTests(t, { db, call }) {
  const users = [],
    now = new Date().toISOString();
  const account = async () => {
    const uid = 'access-revision-' + randomUUID();
    users.push(uid);
    const profile = {
      uid,
      email: uid + '@example.test',
      displayName: 'Access revision test',
      role: 'student',
      status: 'approved',
      tier: 'free',
      platformRoles: [],
      createdAt: now,
    };
    await db
      .prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)')
      .bind(
        uid,
        profile.email,
        '!',
        '!',
        JSON.stringify(profile),
        null,
        now,
        now,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,1,?)',
      )
      .bind(
        createHash('sha256')
          .update('fixture-' + uid)
          .digest('hex'),
        uid,
        Math.floor(Date.now() / 1000) + 3600,
        now,
      )
      .run();
    return uid;
  };
  const gift = async (uid, days) => {
    const result = await call('admin', '/platform/economy-admin', {
      operation: 'grant-reward',
      userId: uid,
      days,
      plan: 'full_monthly',
      reason: 'Synthetic gift',
    });
    assert.equal(result.status, 200);
    return result.data.pass.id;
  };
  const activate = (uid, id) =>
    call(uid, '/platform/rewards', { operation: 'activate', passId: id });
  const revoke = (uid, id = randomUUID()) =>
    call('admin', '/platform/access-admin', {
      operation: 'revoke',
      userId: uid,
      requestId: id,
      reason: 'Synthetic revocation',
    });
  const session = async (uid) => (await call(uid, '/auth/session')).data.user;
  try {
    await t.test(
      'revocation preserves payments and unused gifts; replay cannot revoke a later activation',
      async () => {
        const uid = await account(),
          requestId = randomUUID();
        const paid = await call('admin', '/platform/access-admin', {
          operation: 'grant',
          userId: uid,
          requestId: randomUUID(),
          label: 'Paid',
          duration: 1,
          unit: 'month',
          paid: 10000,
        });
        assert.equal(paid.status, 200);
        const id = await gift(uid, 9);
        assert.equal((await revoke(uid, requestId)).status, 200);
        assert.equal((await session(uid)).tier, 'free');
        assert.equal((await activate(uid, id)).status, 200);
        assert.equal((await revoke(uid, requestId)).data.duplicate, true);
        assert.equal((await session(uid)).tier, 'full_monthly');
        assert.equal(
          (
            await db
              .prepare(
                'SELECT sum(amount) AS amount FROM access_payments WHERE user_id=?',
              )
              .bind(uid)
              .first()
          ).amount,
          10000,
        );
        assert.equal((await activate(uid, id)).status, 200);
        assert.equal((await revoke(uid)).status, 200);
        assert.equal((await activate(uid, id)).data.user.tier, 'free');
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM access_grants WHERE user_id=?',
              )
              .bind(uid)
              .first()
          ).n,
          2,
        );
      },
    );
    await t.test(
      'custom gift days have exact durations and ignore client generation values',
      async () => {
        for (const days of [1, 9, 45, 730]) {
          const uid = await account(),
            id = await gift(uid, days);
          await revoke(uid);
          const result = await call(uid, '/platform/rewards', {
            operation: 'activate',
            passId: id,
            access_generation: -100,
          });
          assert.equal(result.status, 200);
          assert.equal(
            Date.parse(result.data.expiresAt) -
              Date.parse(result.data.startsAt),
            days * 86400000,
          );
          assert.equal((await session(uid)).tier, 'full_monthly');
        }
      },
    );
    await t.test(
      'activation and revocation races follow commit order and concurrent retries grant once',
      async () => {
        for (let i = 0; i < 4; i++) {
          const uid = await account(),
            id = await gift(uid, 9);
          const results = await Promise.all([activate(uid, id), revoke(uid)]);
          assert.ok(
            results.every((result) => result.status === 200),
            JSON.stringify(results),
          );
          const row = await db
            .prepare(
              "SELECT revoked_at FROM access_grants WHERE source='reward' AND source_id=?",
            )
            .bind(id)
            .first();
          assert.equal(
            (await session(uid)).tier,
            row.revoked_at ? 'free' : 'full_monthly',
          );
          const next = await gift(uid, 7),
            concurrent = await Promise.all([
              activate(uid, next),
              activate(uid, next),
            ]);
          assert.ok(concurrent.every((result) => result.status === 200));
          assert.equal(
            (
              await db
                .prepare(
                  "SELECT count(*) AS n FROM access_grants WHERE source='reward' AND source_id=?",
                )
                .bind(next)
                .first()
            ).n,
            1,
          );
        }
      },
    );
    await t.test(
      'cancellation audit failure rolls back access; only MFA Superadmin can cancel',
      async () => {
        const uid = await account(),
          id = await gift(uid, 9);
        await activate(uid, id);
        await db.exec(
          "CREATE TRIGGER fail_access_audit BEFORE INSERT ON records WHEN NEW.type='auditLog' AND json_extract(NEW.payload,'$.action')='access_cancelled' BEGIN SELECT RAISE(ABORT,'ACCESS_AUDIT_FAILURE'); END;",
        );
        try {
          assert.equal((await revoke(uid)).status, 500);
          assert.equal((await session(uid)).tier, 'full_monthly');
        } finally {
          await db.exec('DROP TRIGGER fail_access_audit;');
        }
        for (const actor of ['free', 'access', 'moderator', 'missing-session'])
          assert.equal(
            (
              await call(actor, '/platform/access-admin', {
                operation: 'revoke',
                userId: uid,
                requestId: randomUUID(),
                reason: 'Attempt',
              })
            ).status,
            403,
          );
        assert.equal((await revoke(uid)).status, 200);
        assert.equal((await session(uid)).tier, 'free');
        assert.equal(
          (
            await db
              .prepare('SELECT count(*) AS n FROM access_operation_guards')
              .first()
          ).n,
          0,
        );
      },
    );
  } finally {
    for (const uid of users) {
      for (const table of [
        'reward_passes',
        'access_payments',
        'access_operations',
      ])
        await db
          .prepare('DELETE FROM ' + table + ' WHERE user_id=?')
          .bind(uid)
          .run();
      await db
        .prepare(
          "DELETE FROM records WHERE type='auditLog' AND json_extract(payload,'$.entityId')=?",
        )
        .bind(uid)
        .run();
      await db.prepare('DELETE FROM profiles WHERE uid=?').bind(uid).run();
    }
  }
}
