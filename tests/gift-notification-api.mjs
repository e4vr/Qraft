import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export async function giftNotificationApiTests(t, { db, call, mf }) {
  const path = '/platform/gift-notification',
    now = new Date().toISOString();
  const uid = `gift-owner-${randomUUID()}`,
    other = `gift-other-${randomUUID()}`;
  for (const id of [uid, other]) {
    const profile = {
      uid: id,
      email: `${id}@example.test`,
      displayName: 'Gift reader',
      universityId: id,
      status: 'approved',
      role: 'student',
      tier: 'free',
      platformRoles: [],
      createdAt: now,
    };
    await db
      .prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)')
      .bind(
        id,
        profile.email,
        'unused',
        'unused',
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
        createHash('sha256').update(`fixture-${id}`).digest('hex'),
        id,
        Math.floor(Date.now() / 1000) + 3600,
        now,
      )
      .run();
  }
  const gift = async (
    owner = uid,
    status = 'available',
    source = 'admin',
    createdAt = now,
  ) => {
    const id = randomUUID();
    await db
      .prepare(
        'INSERT INTO reward_passes(id,user_id,plan,duration,duration_unit,duration_days,status,created_at,source,metadata) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        id,
        owner,
        'full_monthly',
        1,
        'month',
        7,
        status,
        createdAt,
        source,
        JSON.stringify({ reason: 'Gift verification', grantedBy: 'admin' }),
      )
      .run();
    return id;
  };
  const claim = (owner, id) =>
    call(owner, path, { operation: 'claim', passId: id });
  const stored = (id) =>
    db.prepare('SELECT * FROM reward_passes WHERE id=?').bind(id).first();
  const receive = (socket) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error('Gift notification missing')),
        5000,
      );
      socket.addEventListener(
        'message',
        (event) => {
          clearTimeout(timer);
          resolve(JSON.parse(event.data));
        },
        { once: true },
      );
    });
  try {
    await t.test(
      'gift notifications require an approved authenticated owner and never disclose another wallet',
      async () => {
        const id = await gift();
        for (const owner of ['missing-session', 'root-unverified']) {
          assert.equal((await call(owner, path)).status, 403);
          assert.equal((await claim(owner, id)).status, 403);
        }
        assert.equal((await call(other, path)).data.gift, null);
        assert.equal((await claim(other, id)).data.gift, null);
        assert.equal(
          JSON.parse((await stored(id)).metadata).giftPopupSeenAt,
          undefined,
        );
        const read = await call(uid, path);
        assert.equal(read.data.gift.id, id);
        assert.deepEqual(
          Object.keys(read.data.gift).sort((a, b) => a.localeCompare(b)),
          [
            'created_at',
            'duration',
            'duration_days',
            'duration_unit',
            'id',
            'plan',
          ],
        );
        assert.equal(
          (await call(uid, path)).data.gift.id,
          id,
          'reading must not consume a popup',
        );
        const cross = await mf.dispatchFetch(
          'https://qraft.test/api/cloudflare' + path,
          {
            method: 'POST',
            headers: {
              cookie: `__Host-qraft_session=fixture-${uid}`,
              origin: 'https://elsewhere.test',
              'content-type': 'application/json',
            },
            body: JSON.stringify({ operation: 'claim', passId: id }),
          },
        );
        assert.equal(cross.status, 403);
        assert.equal(
          (await call(uid, path, { operation: 'unknown' })).status,
          400,
        );
        assert.equal(
          (await call(uid, path, { operation: 'claim', passId: 5 })).status,
          400,
        );
        assert.equal((await call(uid, path, {}, 'PUT')).status, 405);
      },
    );
    await t.test(
      'one atomic claim wins across concurrent devices; refreshes and repeated claims cannot re-show the gift',
      async () => {
        const id = (await call(uid, path)).data.gift.id;
        const results = await Promise.all([claim(uid, id), claim(uid, id)]);
        assert.ok(results.every((result) => result.status === 200));
        assert.equal(
          results.filter((result) => result.data.gift?.id === id).length,
          1,
        );
        assert.equal(
          results.filter((result) => result.data.unchanged).length,
          1,
        );
        const before = await stored(id),
          metadata = JSON.parse(before.metadata);
        assert.ok(metadata.giftPopupSeenAt);
        assert.equal(metadata.reason, 'Gift verification');
        assert.equal(metadata.grantedBy, 'admin');
        assert.equal(before.status, 'available');
        assert.equal(before.activated_at, null);
        assert.equal(before.expires_at, null);
        assert.equal((await call(uid, path)).data.gift, null);
        assert.equal((await claim(uid, id)).data.gift, null);
        assert.equal((await stored(id)).metadata, before.metadata);
        const activation = await call(uid, '/platform/rewards', {
          operation: 'activate',
          passId: id,
        });
        assert.equal(activation.status, 200);
        assert.equal(activation.data.pass.status, 'active');
        assert.equal((await claim(uid, id)).data.gift, null);
        assert.equal(
          JSON.parse((await stored(id)).metadata).giftPopupSeenAt,
          metadata.giftPopupSeenAt,
        );
      },
    );
    await t.test(
      'only available administrator gifts notify; eligibility is rechecked when claiming a stale read',
      async () => {
        for (const status of ['active', 'used', 'expired', 'cancelled']) {
          const id = await gift(uid, status);
          assert.equal((await claim(uid, id)).data.gift, null);
        }
        const earned = await gift(uid, 'available', 'credits');
        assert.equal((await claim(uid, earned)).data.gift, null);
        assert.equal((await call(uid, path)).data.gift, null);
        const stale = await gift();
        assert.equal((await call(uid, path)).data.gift.id, stale);
        await db
          .prepare("UPDATE reward_passes SET status='cancelled' WHERE id=?")
          .bind(stale)
          .run();
        assert.equal((await claim(uid, stale)).data.gift, null);
        assert.equal((await call(uid, path)).data.gift, null);
        const fresh = await gift();
        assert.equal((await call(uid, path)).data.gift.id, fresh);
        await claim(uid, fresh);
      },
    );
    await t.test(
      'legacy browser history migrates once without modifying foreign gifts, credits rewards or activation',
      async () => {
        const seen = await gift(),
          foreign = await gift(other),
          earned = await gift(uid, 'available', 'credits');
        const body = {
          operation: 'migrate-seen',
          passIds: [seen, seen, foreign, earned],
        };
        const result = await call(uid, path, body);
        assert.equal(result.status, 200);
        const metadata = (await stored(seen)).metadata;
        assert.ok(JSON.parse(metadata).giftPopupSeenAt);
        assert.equal((await stored(seen)).status, 'available');
        assert.equal(
          JSON.parse((await stored(foreign)).metadata).giftPopupSeenAt,
          undefined,
        );
        assert.equal(
          JSON.parse((await stored(earned)).metadata).giftPopupSeenAt,
          undefined,
        );
        assert.equal((await call(uid, path, body)).data.unchanged, true);
        assert.equal((await stored(seen)).metadata, metadata);
        assert.equal((await call(uid, path)).data.gift, null);
        for (const passIds of [
          null,
          ['x'.repeat(161)],
          [4],
          Array(101).fill(seen),
        ])
          assert.equal(
            (await call(uid, path, { operation: 'migrate-seen', passIds }))
              .status,
            400,
          );
      },
    );
    await t.test(
      'grant and presentation events reach the owner; a failed claim leaves the gift eligible',
      async () => {
        const connection = await mf.dispatchFetch(
          'https://qraft.test/api/cloudflare/realtime?channel=' +
            encodeURIComponent(`user:${uid}`),
          {
            headers: {
              cookie: `__Host-qraft_session=fixture-${uid}`,
              origin: 'https://qraft.test',
              Upgrade: 'websocket',
            },
          },
        );
        assert.equal(connection.status, 101);
        connection.webSocket.accept();
        try {
          const grantedEvent = receive(connection.webSocket);
          const grant = await call('admin', '/platform/economy-admin', {
            operation: 'grant-reward',
            userId: uid,
            plan: 'full_monthly',
            duration: 1,
            durationUnit: 'month',
            days: 7,
            reason: 'Gift popup delivery verification',
          });
          assert.equal(grant.status, 200);
          assert.ok((await grantedEvent).resources.includes('reward-gift'));
          const id = grant.data.pass.id;
          await db.exec(
            `CREATE TRIGGER fail_gift_claim BEFORE UPDATE ON reward_passes WHEN NEW.id='${id}' AND json_extract(NEW.metadata,'$.giftPopupSeenAt') IS NOT NULL BEGIN SELECT RAISE(ABORT,'GIFT_CLAIM_FAILURE'); END;`,
          );
          try {
            assert.equal((await claim(uid, id)).status, 500);
            assert.equal((await call(uid, path)).data.gift.id, id);
          } finally {
            await db.exec('DROP TRIGGER fail_gift_claim;');
          }
          const claimedEvent = receive(connection.webSocket);
          assert.equal((await claim(uid, id)).data.gift.id, id);
          assert.deepEqual((await claimedEvent).resources, [
            'gift-notification',
          ]);
        } finally {
          connection.webSocket.close();
        }
      },
    );
    await t.test(
      'the gift link includes its owned pass even outside the recent fifty, without exposing other wallets',
      async () => {
        const old = await gift(
          uid,
          'available',
          'admin',
          '2000-01-01T00:00:00.000Z',
        );
        for (let index = 0; index < 52; index++)
          await gift(
            uid,
            'used',
            'credits',
            new Date(Date.now() + index * 1000).toISOString(),
          );
        const foreign = await gift(
          other,
          'available',
          'admin',
          '1999-01-01T00:00:00.000Z',
        );
        const ordinary = (await call(uid, '/platform/contributions')).data;
        assert.equal(ordinary.rewardPasses.length, 50);
        assert.equal(
          ordinary.rewardPasses.some((pass) => pass.id === old),
          false,
        );
        const focused = (await call(uid, `/platform/contributions?gift=${old}`))
          .data;
        assert.equal(focused.rewardPasses.length, 51);
        assert.equal(
          focused.rewardPasses.filter((pass) => pass.id === old).length,
          1,
        );
        assert.equal(
          (
            await call(uid, `/platform/contributions?gift=${foreign}`)
          ).data.rewardPasses.some((pass) => pass.id === foreign),
          false,
        );
        assert.equal(
          (await call(uid, '/platform/contributions?gift=' + 'x'.repeat(161)))
            .status,
          400,
        );
      },
    );
  } finally {
    await db
      .prepare('DELETE FROM reward_passes WHERE user_id IN (?,?)')
      .bind(uid, other)
      .run();
    await db
      .prepare('DELETE FROM sessions WHERE user_id IN (?,?)')
      .bind(uid, other)
      .run();
    await db
      .prepare('DELETE FROM profiles WHERE uid IN (?,?)')
      .bind(uid, other)
      .run();
  }
}
