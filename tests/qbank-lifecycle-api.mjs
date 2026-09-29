import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function qbankLifecycleApiTests(t, { db, call }) {
  const draft = (owner, changes = {}) => ({
    id: `lifecycle-${randomUUID()}`,
    name: 'Lifecycle bank',
    shortName: 'LIFECYCLE',
    description: '',
    ownerId: owner,
    ownerName: owner,
    createdById: owner,
    createdByName: owner,
    createdAt: new Date().toISOString(),
    visibility: 'public',
    essential: false,
    shareEnabled: false,
    reviewerIds: [],
    viewerIds: [],
    archived: false,
    ...changes,
  });
  const put = (uid, operations) =>
    call(uid, '/collaboration', { operations }, 'PUT');
  const set = (collection, value) => ({
    collection,
    id: value.id,
    type: 'set',
    value,
  });

  await t.test(
    'Superadmin creates public, private and essential banks independently of the subscription and immediately adds content',
    async () => {
      for (const changes of [
        {},
        { visibility: 'private' },
        { essential: true },
      ]) {
        const bank = draft('admin', changes);
        const created = await call('admin', '/qbanks', { bank });
        assert.equal(created.status, 200, JSON.stringify(created));
        assert.equal(created.data.bank.ownerId, 'admin');
        assert.equal((await call('admin', '/qbanks', { bank })).status, 200);
        const read = (await call('other', '/collaboration')).data.collaboration;
        assert.equal(
          read.qbanks.some((item) => item.id === bank.id),
          changes.visibility !== 'private',
        );
        const classification = await call(
          'admin',
          '/platform/classification',
          {
            qbankId: bank.id,
            operationId: randomUUID(),
            baseRevision: 0,
            specialties: [
              {
                id: `${bank.id}-specialty`,
                qbankId: bank.id,
                name: 'General',
                order: 0,
                createdAt: bank.createdAt,
                updatedAt: bank.createdAt,
              },
            ],
            topics: [],
            assignments: [],
          },
          'PUT',
        );
        assert.equal(
          classification.status,
          200,
          JSON.stringify(classification),
        );
        assert.equal(
          (await call('admin', '/ids/reserve', { count: 1, qbankId: bank.id }))
            .status,
          200,
        );
        const proposal = {
          id: randomUUID(),
          qbankId: bank.id,
          type: 'new_question',
          status: 'pending',
          editKinds: ['question_text'],
          proposedById: 'admin',
          proposedByName: 'admin',
          proposedAt: bank.createdAt,
          payload: {
            stem: 'A newly created bank accepts this question.',
            options: ['One', 'Two'],
            answer: 0,
            specialty: 'General',
            topic: 'General',
            explanation: 'A valid explanation.',
            sourceReference: 'Fixture source',
            images: [],
          },
        };
        assert.equal(
          (await put('admin', [set('questionProposals', proposal)])).status,
          200,
        );
        assert.equal(
          (
            await call('admin', '/collaboration')
          ).data.collaboration.proposals.some(
            (item) => item.id === proposal.id,
          ),
          true,
        );
        assert.equal(
          (await call('admin', `/qbanks/${bank.id}`, undefined, 'DELETE'))
            .status,
          200,
        );
      }
      assert.equal(
        (await call('lite', '/qbanks', { bank: draft('lite') })).status,
        403,
      );
    },
  );

  await t.test(
    'only the owner and Superadmin can delete; rank, editor and reviewer memberships do not grant deletion',
    async () => {
      const bank = draft('pro', { visibility: 'private' });
      assert.equal((await call('pro', '/qbanks', { bank })).status, 200);
      for (const [uid, role] of [
        ['editor', 'editor'],
        ['reviewer', 'reviewer'],
        ['other', 'viewer'],
      ]) {
        const membership = {
          id: randomUUID(),
          qbankId: bank.id,
          userId: uid,
          role,
          grantedById: 'pro',
          createdAt: bank.createdAt,
        };
        assert.equal(
          (await put('pro', [set('qbankMemberships', membership)])).status,
          200,
        );
      }
      for (const uid of [
        'other',
        'editor',
        'reviewer',
        'moderator',
        'access',
        'lite',
      ]) {
        assert.equal(
          (await call(uid, `/qbanks/${bank.id}`, undefined, 'DELETE')).status,
          403,
          uid,
        );
        assert.equal(
          (
            await put(uid, [
              { collection: 'qbanks', id: bank.id, type: 'delete' },
            ])
          ).status,
          403,
          uid,
        );
      }
      assert.equal(
        (await call('pro', `/qbanks/${bank.id}`, undefined, 'DELETE')).status,
        200,
      );
      assert.equal(
        (await call('pro', `/qbanks/${bank.id}`, undefined, 'DELETE')).status,
        200,
      );
      assert.equal(
        (await call('other', `/qbanks/${bank.id}`, undefined, 'DELETE')).status,
        403,
      );
      assert.equal(
        (await put('pro', [set('qbanks', bank)])).status,
        403,
        'offline snapshots cannot resurrect deleted banks',
      );
      const foreign = draft('pro');
      assert.equal(
        (await call('pro', '/qbanks', { bank: foreign })).status,
        200,
      );
      assert.equal(
        (await call('admin', `/qbanks/${foreign.id}`, undefined, 'DELETE'))
          .status,
        200,
      );
      const legacy = draft('pro');
      assert.equal(
        (await call('pro', '/qbanks', { bank: legacy })).status,
        200,
      );
      assert.equal(
        (
          await put('pro', [
            { collection: 'qbanks', id: legacy.id, type: 'delete' },
          ])
        ).status,
        200,
      );
    },
  );

  await t.test(
    'sharing and creation in the same batch, link rotation and legacy cascading deletion are authorized',
    async () => {
      const bank = draft('admin', {
        shareEnabled: true,
        shareToken: randomUUID(),
      });
      const link = {
        id: bank.shareToken,
        qbankId: bank.id,
        ownerId: 'admin',
        enabled: true,
      };
      assert.equal(
        (
          await put('admin', [
            set('qbanks', bank),
            set('qbankShareLinks', link),
          ])
        ).status,
        200,
      );
      const token = randomUUID();
      assert.equal(
        (
          await put('admin', [
            {
              collection: 'qbankShareLinks',
              id: bank.shareToken,
              type: 'delete',
            },
            set('qbanks', { ...bank, shareToken: token }),
            set('qbankShareLinks', { ...link, id: token }),
          ])
        ).status,
        200,
      );
      const deletion = [
        { collection: 'qbanks', id: bank.id, type: 'delete' },
        { collection: 'qbankShareLinks', id: token, type: 'delete' },
      ];
      assert.equal((await put('admin', deletion)).status, 200);
      assert.equal((await put('admin', deletion)).status, 200);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM records WHERE type='qbankShareLinks' AND json_extract(payload,'$.qbankId')=?",
            )
            .bind(bank.id)
            .first()
        ).n,
        0,
      );
    },
  );

  await t.test(
    'one deletion removes hundreds of bank records and is atomic when D1 fails',
    async () => {
      const bank = draft('admin');
      assert.equal((await call('admin', '/qbanks', { bank })).status, 200);
      await db.batch(
        Array.from({ length: 610 }, (_, i) =>
          db
            .prepare(
              "INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES('sharedNotes',?,?,?,?)",
            )
            .bind(
              `${bank.id}:${i}`,
              bank.id,
              JSON.stringify({ id: `${bank.id}:${i}`, qbankId: bank.id }),
              bank.createdAt,
            ),
        ),
      );
      await db
        .prepare(`CREATE TRIGGER lifecycle_delete_fault BEFORE DELETE ON records
      WHEN OLD.type='qbanks' AND OLD.id='${bank.id}' BEGIN SELECT RAISE(ABORT,'fixture deletion failure'); END`)
        .run();
      try {
        assert.equal(
          (await call('admin', `/qbanks/${bank.id}`, undefined, 'DELETE'))
            .status,
          500,
        );
        assert.equal(
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM records WHERE type='qbankTombstones' AND id=?",
              )
              .bind(bank.id)
              .first()
          ).n,
          0,
        );
        assert.equal(
          (
            await db
              .prepare('SELECT count(*) AS n FROM records WHERE qbank_id=?')
              .bind(bank.id)
              .first()
          ).n,
          610,
        );
      } finally {
        await db.prepare('DROP TRIGGER lifecycle_delete_fault').run();
      }
      assert.equal(
        (await call('admin', `/qbanks/${bank.id}`, undefined, 'DELETE')).status,
        200,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM records WHERE qbank_id=?')
            .bind(bank.id)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (await call('other', '/collaboration')).data.collaboration.qbanks.some(
          (item) => item.id === bank.id,
        ),
        false,
      );
    },
  );

  await t.test(
    'rejected synchronization identifies the change and does not commit the rest of its dependent batch',
    async () => {
      const bank = draft('pro');
      const rejected = await put('pro', [
        set('qbanks', bank),
        {
          collection: 'profiles',
          id: 'admin',
          type: 'set',
          value: { uid: 'admin', role: 'student' },
        },
      ]);
      assert.equal(rejected.status, 403);
      assert.equal(rejected.data.code, 'COLLABORATION_REJECTED');
      assert.deepEqual(
        rejected.data.rejected.map((item) => item.collection),
        ['profiles'],
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM records WHERE type='qbanks' AND id=?",
            )
            .bind(bank.id)
            .first()
        ).n,
        0,
      );
    },
  );

  await t.test(
    'deleting the default Essential bank is durable across catalog loads, authorization and retries',
    async () => {
      assert.equal(
        (await call('admin', '/qbanks/smle-gs', undefined, 'DELETE')).status,
        200,
      );
      assert.equal(
        (await call('admin', '/qbanks/smle-gs', undefined, 'DELETE')).status,
        200,
      );
      for (const uid of ['admin', 'pro', 'other'])
        assert.equal(
          (await call(uid, '/collaboration')).data.collaboration.qbanks.some(
            (item) => item.id === 'smle-gs',
          ),
          false,
        );
      assert.equal(
        (await call('admin', '/ids/reserve', { count: 1, qbankId: 'smle-gs' }))
          .status,
        403,
      );
    },
  );
}
