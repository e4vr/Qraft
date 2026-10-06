import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function accountBoundDiscountTests(
  t,
  { db, call, account, user },
) {
  const body = (overrides = {}) => ({
    id: randomUUID(),
    code: 'MEMBER_' + randomUUID().replaceAll('-', '').slice(0, 12),
    kind: 'percent',
    amount: 25,
    enabled: true,
    max_uses: 10,
    per_user: 1,
    starts_at: null,
    expires_at: null,
    allowedPlans: ['full_monthly'],
    ...overrides,
  });
  const manual = (uid, code, paid = 7500) => ({
    operation: 'grant',
    userId: uid,
    requestId: randomUUID(),
    duration: 1,
    unit: 'month',
    paid,
    label: 'Synthetic discount',
    discountCode: code,
  });
  await t.test(
    'discount account selection is validated; edits and legacy toggles preserve the restriction',
    async () => {
      const uid = await account(undefined, { displayName: 'Discount Owner' }),
        other = await account();
      for (const [restriction, status] of [
        [{ audience: 'member', bound_user_id: null }, 400],
        [{ audience: 'member', bound_user_id: ' ' }, 400],
        [{ audience: 'member', bound_user_id: { uid } }, 400],
        [{ audience: 'member', bound_user_id: 'missing-member' }, 404],
        [{ audience: 'member', bound_user_id: 'admin' }, 400],
        [{ audience: 'any', bound_user_id: uid }, 400],
        [{ audience: ['member'], bound_user_id: uid }, 400],
      ])
        assert.equal(
          (await call('admin', '/platform/discounts', body(restriction)))
            .status,
          status,
        );
      const coupon = body({ audience: 'member', bound_user_id: uid });
      const created = await call('admin', '/platform/discounts', coupon);
      assert.equal(created.status, 200, JSON.stringify(created));
      assert.equal(created.data.code.bound_user_id, uid);
      assert.equal(created.data.code.bound_user_name, 'Discount Owner');
      assert.equal(
        (await call(other, '/platform/discounts', coupon)).status,
        403,
      );
      assert.equal(
        (await call('admin', '/platform/discounts', coupon)).data.unchanged,
        true,
      );
      const { audience: _audience, bound_user_id: _boundUserId, ...legacy } = coupon;
      const disabled = await call('admin', '/platform/discounts', {
        ...legacy,
        enabled: false,
      });
      assert.equal(disabled.status, 200);
      assert.equal(disabled.data.code.bound_user_id, uid);
      const rebound = await call('admin', '/platform/discounts', {
        ...coupon,
        bound_user_id: other,
      });
      assert.equal(rebound.status, 200);
      assert.ok(!rebound.data.unchanged);
      assert.equal(rebound.data.code.bound_user_id, other);
      const unrestricted = await call('admin', '/platform/discounts', {
        ...coupon,
        audience: 'any',
        bound_user_id: null,
      });
      assert.equal(unrestricted.status, 200);
      assert.equal(unrestricted.data.code.bound_user_id, null);
      assert.equal(
        (
          await call(other, '/platform/quote', {
            code: coupon.code,
            plan: 'full_monthly',
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    'bound discounts enforce session identity and manual target; rejected attempts never consume usage',
    async () => {
      const uid = await account(undefined, {
          displayName: 'Private Promotion Member',
        }),
        other = await account();
      const coupon = body({ audience: 'member', bound_user_id: uid });
      assert.equal(
        (await call('admin', '/platform/discounts', coupon)).status,
        200,
      );
      for (const search of [
        'Private Promotion Member',
        uid + '@example.test',
        uid,
      ]) {
        const listing = await call(
          'admin',
          '/platform/discounts?search=' + encodeURIComponent(search),
        );
        assert.equal(listing.status, 200, JSON.stringify(listing));
        const row = listing.data.codes.find((item) => item.id === coupon.id);
        assert.equal(row.bound_user_id, uid);
        assert.equal(row.bound_user_name, 'Private Promotion Member');
        assert.equal(row.bound_user_email, uid + '@example.test');
      }
      assert.equal((await call(other, '/platform/discounts')).status, 403);
      for (const [caller, path, payload] of [
        [
          other,
          '/platform/quote',
          { code: coupon.code, plan: 'full_monthly', userId: uid },
        ],
        [
          other,
          '/platform/checkout',
          {
            code: coupon.code,
            plan: 'full_monthly',
            userId: uid,
            requestId: randomUUID(),
            acceptedTerms: true,
          },
        ],
        [
          'admin',
          '/platform/access-admin',
          { ...manual(other, coupon.code), operation: 'quote' },
        ],
        ['admin', '/platform/access-admin', manual(other, coupon.code)],
      ])
        assert.equal((await call(caller, path, payload)).status, 400);
      assert.equal(
        (
          await db
            .prepare('SELECT uses FROM discount_codes WHERE id=?')
            .bind(coupon.id)
            .first()
        ).uses,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM subscription_events WHERE code_id=?',
            )
            .bind(coupon.id)
            .first()
        ).n,
        0,
      );
      assert.equal((await user(other)).effectivePlan, 'free');
      await db
        .prepare(
          "UPDATE profiles SET email=?,profile_json=json_set(profile_json,'$.email',?,'$.displayName',?) WHERE uid=?",
        )
        .bind(
          'renamed-discount-owner@example.test',
          'renamed-discount-owner@example.test',
          'Renamed Discount Owner',
          uid,
        )
        .run();
      const quote = await call(uid, '/platform/quote', {
        code: coupon.code.toLowerCase(),
        plan: 'full_monthly',
      });
      assert.equal(quote.status, 200, JSON.stringify(quote));
      assert.equal(quote.data.final, 7500);
      const checkout = await call(uid, '/platform/checkout', {
        code: coupon.code,
        plan: 'full_monthly',
        requestId: randomUUID(),
        acceptedTerms: true,
      });
      assert.equal(checkout.status, 200);
      assert.ok(checkout.data.url.startsWith('https://wa.me/'));
      assert.equal(
        (
          await db
            .prepare('SELECT uses FROM discount_codes WHERE id=?')
            .bind(coupon.id)
            .first()
        ).uses,
        0,
      );
      const request = manual(uid, coupon.code);
      assert.equal(
        (await call('admin', '/platform/access-admin', request)).status,
        200,
      );
      assert.equal(
        (await call('admin', '/platform/access-admin', request)).data.duplicate,
        true,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT uses FROM discount_codes WHERE id=?')
            .bind(coupon.id)
            .first()
        ).uses,
        1,
      );
      assert.equal(
        (
          await call(
            'admin',
            '/platform/access-admin',
            manual(uid, coupon.code),
          )
        ).status,
        400,
      );
      assert.equal((await user(uid)).effectivePlan, 'full_monthly');
      assert.equal((await user(other)).effectivePlan, 'free');
    },
  );
  await t.test(
    'changing discount ownership after quoting is checked atomically with grants, payments and usage',
    async () => {
      const uid = await account(),
        other = await account(),
        coupon = body({ audience: 'member', bound_user_id: uid });
      assert.equal(
        (await call('admin', '/platform/discounts', coupon)).status,
        200,
      );
      const quoted = await call(uid, '/platform/quote', {
        code: coupon.code,
        plan: 'full_monthly',
      });
      assert.equal(quoted.status, 200);
      await db
        .prepare('UPDATE discount_codes SET bound_user_id=? WHERE id=?')
        .bind(other, coupon.id)
        .run();
      const now = new Date().toISOString(),
        grantId = randomUUID(),
        eventId = randomUUID();
      await assert.rejects(
        db.batch([
          db
            .prepare(
              "INSERT INTO access_grants(id,user_id,source,source_id,label,plan,duration,duration_unit,starts_at,expires_at,created_at,created_by) VALUES(?,?,'manual',?,'In-flight old quote','full_monthly',1,'month',?,'2030-01-01',?,'admin')",
            )
            .bind(grantId, uid, grantId, now, now),
          db
            .prepare(
              'INSERT INTO access_payments(id,grant_id,user_id,amount,reference,confirmed_at,confirmed_by) VALUES(?,?,?,?,?,?,?)',
            )
            .bind(eventId, grantId, uid, 7500, 'Synthetic', now, 'admin'),
          db
            .prepare(
              "INSERT INTO subscription_events(id,user_id,email,name,code_id,code,action,original,discount,final,status,created_at,plan) VALUES(?,?,?,?,?,?,'discount_redeemed',10000,2500,7500,'success',?,'full_monthly')",
            )
            .bind(
              eventId,
              uid,
              uid + '@example.test',
              uid,
              coupon.id,
              coupon.code,
              now,
            ),
        ]),
        /DISCOUNT_UNAVAILABLE/,
      );
      for (const [table, id] of [
        ['access_grants', grantId],
        ['access_payments', eventId],
        ['subscription_events', eventId],
      ])
        assert.equal(
          (
            await db
              .prepare(`SELECT count(*) AS n FROM ${table} WHERE id=?`)
              .bind(id)
              .first()
          ).n,
          0,
        );
      assert.equal(
        (
          await db
            .prepare('SELECT uses FROM discount_codes WHERE id=?')
            .bind(coupon.id)
            .first()
        ).uses,
        0,
      );
      assert.equal(
        (
          await call(
            'admin',
            '/platform/access-admin',
            manual(other, coupon.code),
          )
        ).status,
        200,
      );
    },
  );
}
