import assert from 'node:assert/strict';
import { build } from 'esbuild';

export async function registrationPolicyApiTests(t, { db, call, fetch }) {
  const path = '/platform/registration-policy',
    now = new Date().toISOString();
  let serial = 0;
  const profileByEmail = async (email) => {
    const row = await db
      .prepare('SELECT profile_json FROM profiles WHERE email=?')
      .bind(email)
      .first();
    return row ? JSON.parse(row.profile_json) : null;
  };
  const roster = async (id) =>
    db
      .prepare(
        "INSERT INTO records(type,id,payload,updated_at) VALUES('universityIds',?,?,?)",
      )
      .bind(id, JSON.stringify({ id, claimedById: null }), now)
      .run();
  const signup = async (universityId, extra = {}) => {
    const email = `registration-policy-${++serial}@example.test`;
    const result = await call('anonymous', '/auth/register', {
      name: 'Policy test',
      email,
      password: 'Local-policy-password-2026',
      phone: '0500006543',
      universityId,
      ...extra,
    });
    return { ...result, email: extra.email ?? email };
  };
  async function toggle(enabled, revision) {
    if (revision === undefined)
      revision = (await call('admin', path)).data.revision;
    return call(
      'admin',
      path,
      { autoApproveUniversityIds: enabled, revision },
      'PUT',
    );
  }
  const stored = await db
    .prepare(
      "SELECT * FROM records WHERE type='system' AND id='registrationPolicy'",
    )
    .first();
  await db
    .prepare(
      "DELETE FROM records WHERE type='system' AND id='registrationPolicy'",
    )
    .run();
  try {
    await t.test(
      'automatic registration approval defaults off and requires approved Superadmin MFA through its dedicated endpoint',
      async () => {
        const initial = await call('admin', path);
        assert.equal(initial.status, 200);
        assert.equal(initial.data.autoApproveUniversityIds, false);
        assert.equal(initial.data.revision, 0);
        for (const uid of [
          'free',
          'moderator',
          'access',
          'reviewer',
          'missing-session',
        ]) {
          assert.equal((await call(uid, path)).status, 403);
          assert.equal(
            (
              await call(
                uid,
                path,
                { autoApproveUniversityIds: true, revision: 0 },
                'PUT',
              )
            ).status,
            403,
          );
        }
        await db
          .prepare('UPDATE sessions SET verified=0 WHERE user_id=?')
          .bind('admin')
          .run();
        try {
          assert.equal((await toggle(true, 0)).status, 403);
        } finally {
          await db
            .prepare('UPDATE sessions SET verified=1 WHERE user_id=?')
            .bind('admin')
            .run();
        }
        const root = await db
          .prepare('SELECT totp_secret FROM profiles WHERE uid=?')
          .bind('admin')
          .first();
        await db
          .prepare('UPDATE profiles SET totp_secret=NULL WHERE uid=?')
          .bind('admin')
          .run();
        try {
          assert.equal((await toggle(true, 0)).status, 403);
        } finally {
          await db
            .prepare('UPDATE profiles SET totp_secret=? WHERE uid=?')
            .bind(root.totp_secret, 'admin')
            .run();
        }
        for (const enabled of ['true', 1, null])
          assert.equal(
            (
              await call(
                'admin',
                path,
                { autoApproveUniversityIds: enabled, revision: 0 },
                'PUT',
              )
            ).status,
            400,
          );
        assert.equal(
          (
            await call(
              'admin',
              path,
              { autoApproveUniversityIds: true, revision: 0 },
              'POST',
            )
          ).status,
          405,
        );
        assert.equal(
          (
            await call(
              'admin',
              path,
              { autoApproveUniversityIds: true, revision: 0 },
              'DELETE',
            )
          ).status,
          405,
        );
        const cross = await fetch('https://qraft.test/api/cloudflare' + path, {
          method: 'PUT',
          headers: {
            cookie: '__Host-qraft_session=fixture-admin',
            origin: 'https://other.test',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ autoApproveUniversityIds: true, revision: 0 }),
        });
        assert.equal(cross.status, 403);
        const bypass = await call(
          'admin',
          '/collaboration',
          {
            operations: [
              {
                collection: 'system',
                id: 'registrationPolicy',
                type: 'set',
                baseValue: null,
                value: { autoApproveUniversityIds: true, revision: 0 },
              },
            ],
          },
          'PUT',
          { withBaseValues: false },
        );
        assert.equal(bypass.status, 403);
        assert.equal(
          (await call('admin', path)).data.autoApproveUniversityIds,
          false,
        );
      },
    );

    await t.test(
      'disabled and unlisted registrations remain pending; enabled roster matches enter immediately without new privileges',
      async () => {
        await roster('POLICY-DEFAULT');
        const pending = await signup('policy-default', {
          status: 'approved',
          universityIdRegistered: true,
          autoApproveUniversityIds: true,
          role: 'super_admin',
          platformRoles: ['moderator'],
        });
        assert.equal(pending.status, 201);
        assert.equal(pending.data.user.status, 'pending');
        assert.equal(pending.data.user.universityIdRegistered, true);
        const enabled = await toggle(true);
        assert.equal(enabled.status, 200);
        assert.equal(
          (await profileByEmail(pending.email)).status,
          'approved',
          'enabling must approve matching pending registrations',
        );
        assert.ok(enabled.data.approvedCount >= 1);
        await roster('POLICY-MATCHED');
        const approved = await signup(' policy-matched ');
        assert.equal(approved.status, 201);
        assert.equal(approved.data.user.status, 'approved');
        assert.equal(approved.data.user.role, 'student');
        assert.deepEqual(approved.data.user.platformRoles, []);
        assert.equal(approved.data.user.tier, 'free');
        const saved = await profileByEmail(approved.email);
        assert.equal(saved.approvalMethod, 'university_id_match');
        assert.equal(saved.approvedByName, 'Automatic university ID match');
        const login = await fetch(
          'https://qraft.test/api/cloudflare/auth/login',
          {
            method: 'POST',
            headers: {
              origin: 'https://qraft.test',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              email: approved.email,
              password: 'Local-policy-password-2026',
            }),
          },
        );
        assert.equal(login.status, 200);
        const cookie = login.headers.get('set-cookie').split(';')[0];
        const access = await fetch(
          'https://qraft.test/api/cloudflare/collaboration',
          { headers: { cookie } },
        );
        assert.equal(access.status, 200);
        const unmatched = await signup('POLICY-UNLISTED', {
          status: 'approved',
          universityIdRegistered: true,
        });
        assert.equal(unmatched.status, 201);
        assert.equal(unmatched.data.user.status, 'pending');
        assert.equal(unmatched.data.user.universityIdRegistered, false);
        const disabled = await toggle(false);
        assert.equal(disabled.status, 200);
        await roster('POLICY-DISABLED');
        const manual = await signup('POLICY-DISABLED');
        assert.equal(manual.data.user.status, 'pending');
        assert.equal(
          (await profileByEmail(approved.email)).status,
          'approved',
          'disabling cannot revoke existing approvals',
        );
      },
    );

    await t.test(
      'pending approvals respect rejection, suspension, blocklists and real ID claims; roster imports only approve while enabled',
      async () => {
        const candidates = [];
        for (const kind of [
          'eligible',
          'rejected',
          'suspended',
          'expired',
          'blocklisted',
          'claimed-elsewhere',
        ]) {
          const id = 'POLICY-PENDING-' + kind.toUpperCase();
          const registered = await signup(id);
          assert.equal(registered.data.user.status, 'pending');
          candidates.push({ kind, id, ...registered });
          await roster(id);
          if (kind === 'rejected')
            await db
              .prepare(
                "UPDATE profiles SET profile_json=json_set(profile_json,'$.status','rejected') WHERE email=?",
              )
              .bind(registered.email)
              .run();
          if (kind === 'suspended' || kind === 'expired')
            await db
              .prepare(
                "UPDATE profiles SET profile_json=json_set(profile_json,'$.suspended',json('true'),'$.suspendedUntil',?) WHERE email=?",
              )
              .bind(
                kind === 'expired'
                  ? '2020-01-01T00:00:00Z'
                  : '2099-01-01T00:00:00Z',
                registered.email,
              )
              .run();
          if (kind === 'claimed-elsewhere')
            await db
              .prepare(
                "UPDATE records SET payload=json_set(payload,'$.claimedById','free') WHERE type='universityIds' AND id=?",
              )
              .bind(id)
              .run();
        }
        const control = await db
          .prepare(
            "SELECT payload FROM records WHERE type='system' AND id='accessControl'",
          )
          .first();
        const blocked = candidates.find((c) => c.kind === 'blocklisted');
        await db
          .prepare(
            "INSERT INTO records(type,id,payload,updated_at) VALUES('system','accessControl',?,?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload",
          )
          .bind(
            JSON.stringify({
              emails: [blocked.email],
              phones: [],
              universityIds: [],
            }),
            now,
          )
          .run();
        try {
          const enabled = await toggle(true);
          assert.equal(enabled.status, 200);
          for (const candidate of candidates) {
            const profile = await profileByEmail(candidate.email);
            assert.equal(
              profile.status,
              ['eligible', 'expired'].includes(candidate.kind)
                ? 'approved'
                : candidate.kind === 'rejected'
                  ? 'rejected'
                  : 'pending',
            );
            assert.deepEqual(profile.platformRoles, []);
            assert.equal(profile.role, 'student');
          }
        } finally {
          await db
            .prepare(
              "DELETE FROM records WHERE type='system' AND id='accessControl'",
            )
            .run();
          if (control)
            await db
              .prepare(
                "INSERT INTO records(type,id,payload,updated_at) VALUES('system','accessControl',?,?)",
              )
              .bind(control.payload, now)
              .run();
        }
        const newlyListed = await signup('POLICY-IMPORT-ACTIVE');
        const add = await call(
          'admin',
          '/collaboration',
          {
            operations: [
              {
                collection: 'universityIds',
                id: 'POLICY-IMPORT-ACTIVE',
                type: 'set',
                value: {
                  id: 'POLICY-IMPORT-ACTIVE',
                  addedAt: now,
                  addedById: 'admin',
                  claimedById: null,
                },
              },
            ],
          },
          'PUT',
        );
        assert.equal(add.status, 200);
        assert.equal(
          (await profileByEmail(newlyListed.email)).status,
          'approved',
        );
        assert.equal(
          (
            await db
              .prepare(
                "SELECT json_extract(payload,'$.claimedById') AS uid FROM records WHERE type='universityIds' AND id='POLICY-IMPORT-ACTIVE'",
              )
              .first()
          ).uid,
          newlyListed.data.user.uid,
        );
        const login = await fetch(
          'https://qraft.test/api/cloudflare/auth/login',
          {
            method: 'POST',
            headers: {
              origin: 'https://qraft.test',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              email: newlyListed.email,
              password: 'Local-policy-password-2026',
            }),
          },
        );
        const session = await fetch(
          'https://qraft.test/api/cloudflare/auth/session',
          {
            headers: { cookie: login.headers.get('set-cookie').split(';')[0] },
          },
        );
        assert.equal((await session.json()).user.status, 'approved');
        assert.equal((await toggle(false)).status, 200);
        const stillPending = await signup('POLICY-IMPORT-DISABLED');
        assert.equal(
          (
            await call(
              'admin',
              '/collaboration',
              {
                operations: [
                  {
                    collection: 'universityIds',
                    id: 'POLICY-IMPORT-DISABLED',
                    type: 'set',
                    value: {
                      id: 'POLICY-IMPORT-DISABLED',
                      addedAt: now,
                      addedById: 'admin',
                      claimedById: null,
                    },
                  },
                ],
              },
              'PUT',
            )
          ).status,
          200,
        );
        assert.equal(
          (await profileByEmail(stillPending.email)).status,
          'pending',
        );
      },
    );

    await t.test(
      'policy revisions reject stale writes and audit failure rolls back the setting; repeated saves do not add audit rows',
      async () => {
        const before = (await call('admin', path)).data;
        const count = async () =>
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='registration_policy_changed'",
              )
              .first()
          ).n;
        const unchangedCount = await count();
        const rollbackPending = await signup('POLICY-AUDIT-ROLLBACK');
        await roster('POLICY-AUDIT-ROLLBACK');
        const unchanged = await toggle(
          before.autoApproveUniversityIds,
          before.revision,
        );
        assert.equal(unchanged.data.unchanged, true);
        assert.equal(await count(), unchangedCount);
        await db.exec(
          "CREATE TRIGGER fail_registration_policy_audit BEFORE INSERT ON records WHEN NEW.type='auditLog' AND json_extract(NEW.payload,'$.action')='registration_policy_changed' BEGIN SELECT RAISE(ABORT,'POLICY_AUDIT_FAILURE'); END;",
        );
        try {
          assert.equal((await toggle(true, before.revision)).status, 500);
          assert.deepEqual((await call('admin', path)).data, before);
          assert.equal(
            (await profileByEmail(rollbackPending.email)).status,
            'pending',
          );
          assert.equal(
            (
              await db
                .prepare(
                  "SELECT json_extract(payload,'$.claimedById') AS claimed FROM records WHERE type='universityIds' AND id='POLICY-AUDIT-ROLLBACK'",
                )
                .first()
            ).claimed,
            null,
          );
        } finally {
          await db.exec('DROP TRIGGER fail_registration_policy_audit;');
        }
        const enabled = await toggle(true, before.revision);
        assert.equal(enabled.status, 200);
        assert.equal(enabled.data.revision, before.revision + 1);
        assert.equal(
          (await profileByEmail(rollbackPending.email)).status,
          'approved',
        );
        const stale = await toggle(false, before.revision);
        assert.equal(stale.status, 409);
        assert.equal(stale.data.policy.autoApproveUniversityIds, true);
        const revision = enabled.data.revision;
        const competing = await Promise.all([
          toggle(false, revision),
          toggle(false, revision),
        ]);
        assert.ok(competing.every((r) => [200, 409].includes(r.status)));
        assert.equal((await call('admin', path)).data.revision, revision + 1);
        assert.equal(await count(), unchangedCount + 2);
      },
    );

    await t.test(
      'roster matches cannot bypass email, phone or university ID blocklists, claim uniqueness or rejected registration writes',
      async () => {
        assert.equal((await toggle(true)).status, 200);
        const previous = await db
          .prepare(
            "SELECT payload FROM records WHERE type='system' AND id='accessControl'",
          )
          .first();
        try {
          for (const kind of ['emails', 'phones', 'universityIds']) {
            const id = 'POLICY-BLOCK-' + kind.toUpperCase(),
              email = 'policy-block-' + kind + '@example.test';
            await roster(id);
            const blocked = { emails: [], phones: [], universityIds: [] };
            blocked[kind].push(
              kind === 'emails' ? email : kind === 'phones' ? '0500006543' : id,
            );
            await db
              .prepare(
                "INSERT INTO records(type,id,payload,updated_at) VALUES('system','accessControl',?,?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload",
              )
              .bind(JSON.stringify(blocked), now)
              .run();
            const denied = await signup(id, { email });
            assert.equal(denied.status, 403);
            assert.equal(await profileByEmail(email), null);
          }
        } finally {
          await db
            .prepare(
              "DELETE FROM records WHERE type='system' AND id='accessControl'",
            )
            .run();
          if (previous)
            await db
              .prepare(
                "INSERT INTO records(type,id,payload,updated_at) VALUES('system','accessControl',?,?)",
              )
              .bind(previous.payload, now)
              .run();
        }
        await roster('POLICY-SINGLE-CLAIM');
        const competing = await Promise.all([
          signup('POLICY-SINGLE-CLAIM'),
          signup('POLICY-SINGLE-CLAIM'),
        ]);
        assert.deepEqual(
          competing.map((r) => r.status).sort((a, b) => a - b),
          [201, 409],
        );
        assert.equal(
          competing.find((r) => r.status === 201).data.user.status,
          'approved',
        );
        assert.equal(
          await profileByEmail(competing.find((r) => r.status === 409).email),
          null,
        );
        assert.equal((await signup('POLICY-SINGLE-CLAIM')).status, 409);
        await roster('POLICY-ROLLBACK');
        await db.exec(
          "CREATE TRIGGER fail_policy_claim BEFORE INSERT ON university_claims WHEN NEW.university_id='POLICY-ROLLBACK' BEGIN SELECT RAISE(ABORT,'TEST_POLICY_ROLLBACK'); END;",
        );
        try {
          const failed = await signup('POLICY-ROLLBACK');
          assert.ok(failed.status >= 400);
          assert.equal(await profileByEmail(failed.email), null);
          assert.equal(
            (
              await db
                .prepare(
                  "SELECT json_extract(payload,'$.claimedById') AS claimed FROM records WHERE type='universityIds' AND id='POLICY-ROLLBACK'",
                )
                .first()
            ).claimed,
            null,
          );
        } finally {
          await db.exec('DROP TRIGGER fail_policy_claim;');
        }
        assert.equal(
          (await db.prepare('PRAGMA foreign_key_check').all()).results.length,
          0,
        );
      },
    );

    await t.test(
      'transaction uses the current policy and roster even when they change after pre-validation',
      async () => {
        // Build the production statement before changes, then execute it after
        // the changes commit, as a request delayed during password hashing does.
        globalThis.__registrationPolicyTest = { DB: db };
        const built = await build({
          entryPoints: ['features/auth/server/registration-approval.ts'],
          bundle: true,
          format: 'esm',
          platform: 'node',
          write: false,
          plugins: [
            {
              name: 'local-bindings',
              setup(build) {
                build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
                  path: 'env',
                  namespace: 'fixture',
                }));
                build.onResolve({ filter: /realtime-server$/ }, () => ({
                  path: 'realtime',
                  namespace: 'fixture',
                }));
                build.onLoad(
                  { filter: /.*/, namespace: 'fixture' },
                  (args) => ({
                    contents:
                      args.path === 'env'
                        ? 'export const env=globalThis.__registrationPolicyTest'
                        : 'export async function publishChanges(){}',
                    loader: 'js',
                  }),
                );
              },
            },
          ],
        });
        const { registrationProfileStatement } = await import(
          'data:text/javascript;base64,' +
            Buffer.from(built.outputFiles[0].text).toString('base64')
        );
        const queued = (id) => {
          const profile = {
            uid: id,
            email: id.toLowerCase() + '@example.test',
            displayName: 'Queued registration',
            universityId: id,
            phone: '0500006543',
            role: 'student',
            status: 'pending',
            tier: 'free',
            platformRoles: [],
            createdAt: now,
          };
          return {
            profile,
            statements: [
              registrationProfileStatement(
                profile,
                { hash: 'test-hash', salt: 'test-salt' },
                now,
              ),
              db
                .prepare(
                  'INSERT INTO university_claims(university_id,user_id,claimed_at) VALUES(?,?,?)',
                )
                .bind(id, id, now),
            ],
          };
        };
        try {
          await roster('POLICY-LATE-DISABLE');
          assert.equal((await toggle(true)).status, 200);
          const disabled = queued('POLICY-LATE-DISABLE');
          assert.equal((await toggle(false)).status, 200);
          await db.batch(disabled.statements);
          assert.equal(
            (await profileByEmail(disabled.profile.email)).status,
            'pending',
          );
          await roster('POLICY-LATE-REMOVE');
          assert.equal((await toggle(true)).status, 200);
          const removed = queued('POLICY-LATE-REMOVE');
          await db
            .prepare("DELETE FROM records WHERE type='universityIds' AND id=?")
            .bind(removed.profile.universityId)
            .run();
          await db.batch(removed.statements);
          const saved = await profileByEmail(removed.profile.email);
          assert.equal(saved.status, 'pending');
          assert.equal(saved.universityIdRegistered, false);
        } finally {
          delete globalThis.__registrationPolicyTest;
        }
      },
    );

    await t.test(
      'approving a pending registration notifies its open session and permits access without another login',
      async () => {
        assert.equal((await toggle(false)).status, 200);
        await roster('POLICY-LIVE-APPROVAL');
        const registered = await signup('POLICY-LIVE-APPROVAL');
        const login = await fetch(
          'https://qraft.test/api/cloudflare/auth/login',
          {
            method: 'POST',
            headers: {
              origin: 'https://qraft.test',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              email: registered.email,
              password: 'Local-policy-password-2026',
            }),
          },
        );
        assert.equal((await login.json()).user.status, 'pending');
        const cookie = login.headers.get('set-cookie').split(';')[0];
        const connection = await fetch(
          'https://qraft.test/api/cloudflare/realtime?channel=' +
            encodeURIComponent('user:' + registered.data.user.uid),
          {
            headers: {
              cookie,
              origin: 'https://qraft.test',
              Upgrade: 'websocket',
            },
          },
        );
        assert.equal(connection.status, 101);
        connection.webSocket.accept();
        try {
          const notification = new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(Error('Missing approval notification')),
              5000,
            );
            connection.webSocket.addEventListener(
              'message',
              (event) => {
                clearTimeout(timer);
                resolve(JSON.parse(event.data));
              },
              { once: true },
            );
          });
          assert.equal((await toggle(true)).status, 200);
          assert.deepEqual((await notification).resources, ['account']);
          const session = await fetch(
            'https://qraft.test/api/cloudflare/auth/session',
            { headers: { cookie } },
          );
          assert.equal((await session.json()).user.status, 'approved');
          assert.equal(
            (
              await fetch('https://qraft.test/api/cloudflare/collaboration', {
                headers: { cookie },
              })
            ).status,
            200,
          );
        } finally {
          connection.webSocket.close();
        }
      },
    );

    await t.test(
      'only a real boolean true enables approval; deleting the setting returns immediately to manual approval',
      async () => {
        await db
          .prepare(
            "UPDATE records SET payload=json_set(payload,'$.autoApproveUniversityIds','true') WHERE type='system' AND id='registrationPolicy'",
          )
          .run();
        await roster('POLICY-MALFORMED');
        assert.equal(
          (await call('admin', path)).data.autoApproveUniversityIds,
          false,
        );
        const result = await signup('POLICY-MALFORMED');
        assert.equal(result.data.user.status, 'pending');
        await db
          .prepare(
            "DELETE FROM records WHERE type='system' AND id='registrationPolicy'",
          )
          .run();
        await roster('POLICY-MISSING');
        assert.equal(
          (await signup('POLICY-MISSING')).data.user.status,
          'pending',
        );
      },
    );
  } finally {
    await db
      .prepare(
        "DELETE FROM records WHERE type='system' AND id='registrationPolicy'",
      )
      .run();
    if (stored)
      await db
        .prepare(
          "INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES('system','registrationPolicy',?,?,?)",
        )
        .bind(stored.owner_id, stored.payload, stored.updated_at)
        .run();
  }
}
