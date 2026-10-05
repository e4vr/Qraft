import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export async function deletedRegistrationApiTests(t, { db, call, fetch }) {
  const now = new Date().toISOString();
  const identity = 'deleted-user';
  async function profile(uid, deleted = false) {
    const value = {
      uid,
      email: `${uid}@${deleted ? 'deleted.invalid' : 'example.test'}`,
      displayName: deleted ? 'Deleted user' : uid,
      universityId: '',
      role: 'student',
      status: deleted ? 'rejected' : 'approved',
      suspended: deleted,
      tier: 'free',
      platformRoles: [],
      createdAt: now,
      ...(deleted ? { deletedAt: now } : {}),
    };
    await db
      .prepare(
        'INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(
        uid,
        value.email,
        deleted ? '!' : 'unused',
        deleted ? '!' : 'unused',
        JSON.stringify(value),
        now,
        now,
      )
      .run();
    if (deleted)
      await db
        .prepare('INSERT INTO account_deletions VALUES(?,?,1)')
        .bind(uid, now)
        .run();
    else
      await db
        .prepare(
          'INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,1,?)',
        )
        .bind(
          createHash('sha256').update(`fixture-${uid}`).digest('hex'),
          uid,
          Math.floor(Date.now() / 1000) + 3600,
          now,
        )
        .run();
    return value;
  }
  async function record(type, value, owner = null) {
    await db
      .prepare(
        'INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        type,
        value.id,
        value.qbankId ?? (type === 'qbanks' ? value.id : null),
        owner,
        JSON.stringify(value),
        now,
      )
      .run();
  }
  const bank = (id, ownerId) => ({
    id,
    ownerId,
    ownerName: ownerId,
    createdById: ownerId,
    createdByName: ownerId,
    name: id,
    shortName: id,
    visibility: 'public',
    viewerIds: [],
    reviewerIds: [],
    essential: false,
    shareEnabled: false,
    createdAt: now,
  });
  const readRecord = async (type, id) =>
    JSON.parse(
      (
        await db
          .prepare('SELECT payload FROM records WHERE type=? AND id=?')
          .bind(type, id)
          .first()
      ).payload,
    );
  async function evidence(prefix, owners) {
    const proposal = {
      id: `${prefix}-proposal`,
      qbankId: `${prefix}-bank`,
      proposedById: owners[0],
      proposedByName: 'Deleted user',
      status: 'approved',
      type: 'new_question',
      payload: {
        stem: 'Historical proposal',
        options: ['A', 'B'],
        answer: 0,
        explanation: '',
        sourceReference: 'Fixture',
      },
      history: owners.map((uid) => ({ reviewerId: uid, reviewerName: uid })),
      proposedAt: now,
    };
    await record('questionProposals', proposal, owners[0]);
    for (const [index, uid] of owners.entries()) {
      await db
        .prepare('INSERT INTO contribution_reviews VALUES(?,?,?,?,?,?,?,?)')
        .bind(
          `${prefix}-review-${index}`,
          proposal.id,
          owners[0],
          uid,
          'approved',
          1,
          now,
          '{}',
        )
        .run();
      await db
        .prepare(
          'INSERT INTO credit_transactions(id,user_id,amount,lifetime_delta,type,reason,reference_type,reference_id,created_by,created_at,metadata) VALUES(?,?,5,5,?,?,?,?,?,?,?)',
        )
        .bind(
          `${prefix}-ledger-${index}`,
          uid,
          'approved_review',
          'Historical review reward',
          'questionProposal',
          proposal.id,
          'admin',
          now,
          '{}',
        )
        .run();
    }
    return proposal;
  }

  await t.test(
    'new deletions reuse one inert identity, retain separate votes and ledger entries, and hide it from registration lists',
    async () => {
      const owners = ['central-delete-a', 'central-delete-b'];
      for (const uid of owners) await profile(uid);
      await record('qbanks', bank('central-delete-bank', owners[0]), owners[0]);
      const proposal = await evidence('central-delete', owners);
      for (const uid of owners)
        assert.equal(
          (
            await call(
              uid,
              '/auth/account',
              { confirmation: 'DELETE' },
              'DELETE',
            )
          ).status,
          200,
        );
      const stored = await db
        .prepare('SELECT * FROM profiles WHERE uid=?')
        .bind(identity)
        .first();
      assert.equal(stored.password_hash, '!');
      assert.equal(stored.password_salt, '!');
      assert.equal(stored.totp_secret, null);
      assert.equal(JSON.parse(stored.profile_json).suspended, true);
      assert.equal(
        (await readRecord('qbanks', 'central-delete-bank')).ownerId,
        identity,
      );
      for (const uid of owners)
        assert.equal(
          await db
            .prepare('SELECT uid FROM profiles WHERE uid=?')
            .bind(uid)
            .first(),
          null,
        );
      const votes = (
        await db
          .prepare(
            'SELECT * FROM contribution_reviews WHERE proposal_id=? ORDER BY id',
          )
          .bind(proposal.id)
          .all()
      ).results;
      assert.equal(votes.length, 2);
      assert.equal(new Set(votes.map((v) => v.reviewer_id)).size, 2);
      assert.ok(
        votes.every(
          (v) =>
            v.author_id === identity &&
            v.reviewer_id.startsWith('deleted-reviewer-'),
        ),
      );
      const ledger = (
        await db
          .prepare('SELECT * FROM credit_transactions WHERE reference_id=?')
          .bind(proposal.id)
          .all()
      ).results;
      assert.equal(ledger.length, 2);
      assert.equal(
        ledger.reduce((sum, row) => sum + row.amount, 0),
        10,
      );
      assert.ok(
        ledger.every(
          (row) =>
            row.user_id === identity &&
            JSON.parse(row.metadata).deletedAccountReferenceType ===
              'questionProposal',
        ),
      );
      const saved = await readRecord('questionProposals', proposal.id);
      assert.equal(saved.proposedById, identity);
      assert.equal(new Set(saved.history.map((v) => v.reviewerId)).size, 2);
      const loaded = await call('admin', '/collaboration');
      assert.equal(loaded.status, 200, JSON.stringify(loaded.data));
      const members = loaded.data.collaboration.members;
      assert.equal(
        members.some((member) => member.uid === identity),
        false,
      );
      assert.equal(
        (
          await call(
            'admin',
            '/platform/deleted-registration',
            { userId: identity, confirmation: 'DELETE' },
            'DELETE',
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            'admin',
            '/platform/account-block',
            {
              userId: identity,
              blocked: false,
              days: 1,
              reason: 'Cannot restore identity',
            },
            'POST',
          )
        ).status,
        403,
      );
      assert.equal(
        (await db.prepare('PRAGMA foreign_key_check').all()).results.length,
        0,
      );
    },
  );

  await t.test(
    'Superadmin consolidation migrates legacy ownership atomically, preserves independent votes and shared content, and replays without extra writes',
    async () => {
      const owners = ['deleted-legacy-a', 'deleted-legacy-b'];
      const profiles = await Promise.all(
        owners.map((uid) => profile(uid, true)),
      );
      await record('qbanks', bank('legacy-merge-bank', owners[0]), owners[0]);
      await record(
        'qbanks',
        { ...bank('legacy-other-owner', 'free'), createdById: owners[0] },
        'free',
      );
      await record(
        'sharedQuestions',
        {
          id: 'legacy-merge-question',
          questionId: 'legacy-merge-display-id',
          number: 1,
          qbankId: 'legacy-merge-bank',
          stem: 'Preserved public question',
          options: ['A', 'B'],
          answer: 0,
          explanation: '',
          specialty: 'Surgery',
          topic: 'Fixture',
          writtenById: owners[0],
          writtenByName: 'Deleted user',
        },
        owners[0],
      );
      const proposal = await evidence('legacy-merge', owners);
      const payload = { userId: owners[0], confirmation: 'DELETE' };
      const path = '/platform/deleted-registration';
      for (const uid of [
        'free',
        'reviewer',
        'moderator',
        'access',
        'missing-session',
      ])
        assert.equal((await call(uid, path, payload, 'DELETE')).status, 403);
      assert.equal(
        (
          await call(
            'admin',
            path,
            { userId: 'free', confirmation: 'DELETE' },
            'DELETE',
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await call(
            'admin',
            path,
            { userId: 'admin', confirmation: 'DELETE' },
            'DELETE',
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await call(
            'admin',
            path,
            { userId: owners[0], confirmation: 'cancel' },
            'DELETE',
          )
        ).status,
        400,
      );
      const crossOrigin = await fetch(
        'https://qraft.test/api/cloudflare' + path,
        {
          method: 'DELETE',
          headers: {
            cookie: '__Host-qraft_session=fixture-admin',
            origin: 'https://other.test',
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      assert.equal(crossOrigin.status, 403);
      await db
        .prepare('UPDATE sessions SET verified=0 WHERE user_id=?')
        .bind('admin')
        .run();
      try {
        assert.equal(
          (await call('admin', path, payload, 'DELETE')).status,
          403,
        );
      } finally {
        await db
          .prepare('UPDATE sessions SET verified=1 WHERE user_id=?')
          .bind('admin')
          .run();
      }
      await db.exec(
        "CREATE TRIGGER block_legacy_cleanup BEFORE DELETE ON profiles WHEN OLD.uid='deleted-legacy-a' BEGIN SELECT RAISE(ABORT,'TEST_ROLLBACK'); END;",
      );
      try {
        assert.equal(
          (await call('admin', path, payload, 'DELETE')).status,
          500,
        );
        assert.equal(
          (await readRecord('qbanks', 'legacy-merge-bank')).ownerId,
          owners[0],
        );
        assert.equal(
          (
            await db
              .prepare('SELECT profile_json FROM profiles WHERE uid=?')
              .bind(owners[0])
              .first()
          ).profile_json,
          JSON.stringify(profiles[0]),
        );
        assert.equal(
          (
            await db
              .prepare('SELECT user_id FROM credit_transactions WHERE id=?')
              .bind('legacy-merge-ledger-0')
              .first()
          ).user_id,
          owners[0],
        );
      } finally {
        await db.exec('DROP TRIGGER block_legacy_cleanup;');
      }
      for (const uid of owners) {
        const deleted = await call(
          'admin',
          path,
          { userId: uid, confirmation: 'DELETE' },
          'DELETE',
        );
        assert.equal(deleted.status, 200);
        assert.equal(deleted.data.userId, uid);
        assert.equal(
          await db
            .prepare('SELECT uid FROM profiles WHERE uid=?')
            .bind(uid)
            .first(),
          null,
        );
        const count = (
          await db
            .prepare(
              "SELECT count(*) AS n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='deleted_registration_consolidated'",
            )
            .first()
        ).n;
        const replay = await call(
          'admin',
          path,
          { userId: uid, confirmation: 'DELETE' },
          'DELETE',
        );
        assert.equal(replay.status, 200);
        assert.equal(replay.data.unchanged, true);
        assert.equal(
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='deleted_registration_consolidated'",
              )
              .first()
          ).n,
          count,
        );
      }
      assert.equal(
        (await readRecord('qbanks', 'legacy-merge-bank')).ownerId,
        identity,
      );
      assert.equal(
        (await readRecord('qbanks', 'legacy-other-owner')).ownerId,
        'free',
      );
      assert.equal(
        (await readRecord('qbanks', 'legacy-other-owner')).createdById,
        identity,
      );
      assert.equal(
        (await readRecord('sharedQuestions', 'legacy-merge-question'))
          .writtenById,
        identity,
      );
      const votes = (
        await db
          .prepare('SELECT * FROM contribution_reviews WHERE proposal_id=?')
          .bind(proposal.id)
          .all()
      ).results;
      assert.equal(votes.length, 2);
      assert.equal(new Set(votes.map((row) => row.reviewer_id)).size, 2);
      const ledger = (
        await db
          .prepare('SELECT * FROM credit_transactions WHERE reference_id=?')
          .bind(proposal.id)
          .all()
      ).results;
      assert.equal(ledger.length, 2);
      assert.ok(ledger.every((row) => row.user_id === identity));
      const loaded = await call('admin', '/collaboration');
      assert.equal(loaded.status, 200, JSON.stringify(loaded.data));
      const current = loaded.data.collaboration;
      assert.ok(
        owners.every(
          (uid) => !current.members.some((member) => member.uid === uid),
        ),
      );
      assert.ok(
        current.approvedQuestions.some(
          (question) => question.id === 'legacy-merge-question',
        ),
      );
      assert.equal(
        (await db.prepare('PRAGMA foreign_key_check').all()).results.length,
        0,
      );
    },
  );
}
