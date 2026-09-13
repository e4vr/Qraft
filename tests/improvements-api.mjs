import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export async function improvementsApiTests(t, db, call) {
  const now = new Date().toISOString();
  async function record(type, value, ownerId = null) {
    await db
      .prepare(
        'INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        type,
        value.id,
        value.qbankId ?? (type === 'qbanks' ? value.id : null),
        ownerId,
        JSON.stringify(value),
        now,
      )
      .run();
  }
  async function account(uid, roles = []) {
    const profile = {
      uid,
      email: `${uid}@example.test`,
      displayName: `Name ${uid}`,
      phone: '0500004321',
      universityId: 'deleted-student-number',
      tier: 'pro',
      status: 'approved',
      role: 'student',
      platformRoles: roles,
      createdAt: now,
    };
    await db
      .prepare(
        'INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(
        uid,
        profile.email,
        'unused',
        'unused',
        JSON.stringify(profile),
        now,
        now,
      )
      .run();
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
    return profile;
  }
  const makeBank = (id, ownerId, visibility = 'public') => ({
    id,
    name: id,
    shortName: id,
    description: '',
    ownerId,
    ownerName: `Name ${ownerId}`,
    createdById: ownerId,
    createdByName: `Name ${ownerId}`,
    visibility,
    reviewerIds: [],
    viewerIds: [],
    shareEnabled: false,
    essential: false,
    archived: false,
    createdAt: now,
  });
  const question = (id, bankId, displayId) => ({
    id,
    questionId: displayId,
    qbankId: bankId,
    number: 1,
    stem: 'A test question',
    options: ['A', 'B'],
    answer: 0,
    answerLetter: 'A',
    explanation: '',
    specialty: 'Surgery',
    topic: 'Topic A',
    sourceFile: 'test',
    sourcePage: 1,
  });

  await t.test(
    'Superadmin QBank folders enforce two levels and confirmed cascade deletion',
    async () => {
      await account('folder-owner');
      const bank = makeBank('folder-bank', 'folder-owner');
      await record('qbanks', bank, 'folder-owner');
      const rootFolder = {
        id: 'folder-root',
        name: 'SMLE',
        parentId: null,
        order: 0,
        createdAt: now,
        updatedAt: now,
      };
      const childFolder = {
        ...rootFolder,
        id: 'folder-child',
        name: 'Clinical',
        parentId: rootFolder.id,
      };
      assert.equal(
        (
          await call(
            'admin',
            '/collaboration',
            {
              operations: [
                { collection: 'qbankFolders', id: rootFolder.id, type: 'set', value: rootFolder },
                { collection: 'qbankFolders', id: childFolder.id, type: 'set', value: childFolder },
              ],
            },
            'PUT',
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            'folder-owner',
            '/collaboration',
            {
              operations: [
                {
                  collection: 'qbanks',
                  id: bank.id,
                  type: 'set',
                  value: { ...bank, folderId: childFolder.id },
                },
              ],
            },
            'PUT',
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await call(
            'admin',
            '/collaboration',
            {
              operations: [
                {
                  collection: 'qbanks',
                  id: bank.id,
                  type: 'set',
                  value: { ...bank, folderId: childFolder.id },
                },
              ],
            },
            'PUT',
          )
        ).status,
        200,
      );
      const thirdLevel = {
        ...rootFolder,
        id: 'folder-third',
        name: 'Too deep',
        parentId: childFolder.id,
      };
      assert.equal(
        (
          await call(
            'admin',
            '/collaboration',
            {
              operations: [
                { collection: 'qbankFolders', id: thirdLevel.id, type: 'set', value: thirdLevel },
              ],
            },
            'PUT',
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            'admin',
            `/qbank-folders/${rootFolder.id}`,
            { mode: 'cascade', confirmation: 'DELETE' },
            'DELETE',
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            'admin',
            `/qbank-folders/${rootFolder.id}`,
            { mode: 'cascade', confirmation: 'حذف' },
            'DELETE',
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT count(*) AS n FROM records WHERE type='qbanks' AND id=?")
            .bind(bank.id)
            .first()
        ).n,
        0,
      );
    },
  );

  await t.test(
    '500-question pool is independent of per-test limits, with matching random and status filters',
    async () => {
      await account('pool-learner');
      await record('qbanks', makeBank('pool-bank', 'admin'));
      for (let start = 0; start < 500; start += 50)
        await db.batch(
          Array.from({ length: 50 }, (_, i) => {
            const n = start + i;
            const q = {
              ...question(`pool-${n}`, 'pool-bank', String(70000 + n)),
              specialty: n < 250 ? 'Surgery' : 'Medicine',
            };
            return db
              .prepare(
                "INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES('sharedQuestions',?,?,?,?)",
              )
              .bind(q.id, q.qbankId, JSON.stringify(q), now);
          }),
        );
      const config = { specialty: '', topics: [], statuses: [], count: 10 };
      const pool = async (changes = {}, other = {}) =>
        call('pool-learner', '/platform/test-pool', {
          qbankId: 'pool-bank',
          config: { ...config, ...changes },
          ...other,
        });
      assert.deepEqual((await pool()).data, { eligible: 500 });
      assert.equal((await pool({ specialty: 'Surgery' })).data.eligible, 250);
      assert.equal((await pool({ topics: ['missing'] })).data.eligible, 0);
      assert.equal(
        (
          await pool({
            randomAll: true,
            specialty: 'missing',
            statuses: ['incorrect'],
          })
        ).data.eligible,
        500,
      );
      const progress = {
        'pool-0': { attempts: 1, lastAnswer: 0, flagged: true },
        'pool-1': { attempts: 1, lastAnswer: 1 },
      };
      assert.equal(
        (await pool({ statuses: ['new'] }, { progress })).data.eligible,
        498,
      );
      assert.equal(
        (await pool({ statuses: ['correct', 'flagged'] }, { progress })).data
          .eligible,
        1,
      );
      assert.equal(
        (await pool({ statuses: ['incorrect'] }, { progress })).data.eligible,
        1,
      );
      assert.equal((await pool({ count: 9999 }, { select: true })).status, 403);
      const selected = await pool(
        { randomAll: true, count: 10 },
        { select: true },
      );
      assert.equal(selected.status, 200, JSON.stringify(selected));
      assert.equal(selected.data.questions.length, 10);
      assert.equal(new Set(selected.data.questions.map((q) => q.id)).size, 10);
      await record('qbanks', makeBank('inaccessible-bank', 'admin', 'private'));
      assert.equal(
        (
          await call('pool-learner', '/platform/test-pool', {
            qbankId: 'inaccessible-bank',
            config,
          })
        ).status,
        403,
      );
    },
  );

  await t.test(
    'Checkpoint state sync is partial, idempotent, and rejects stale versions',
    async () => {
      const uid = 'checkpoint-learner';
      await account(uid);
      const bank = makeBank('checkpoint-bank', 'admin');
      const approvedQuestion = question(
        'checkpoint-question',
        bank.id,
        '79001',
      );
      await record('qbanks', bank, 'admin');
      await record('sharedQuestions', approvedQuestion, 'admin');
      const firstTime = '2026-09-12T08:00:00.000Z';
      const initialState = {
        version: 1,
        clientUpdatedAt: firstTime,
        tests: [],
        progress: {},
        reports: [],
        revisions: [],
        customQuestions: [],
        questionOverrides: {},
        flashcardDecks: [],
        flashcards: [],
        flashcardSchedules: {},
        flashcardReviewLog: [],
        settings: { dailyGoal: 20, theme: 'dark' },
      };
      const first = await call(
        uid,
        '/state',
        {
          state: initialState,
          baseRevision: 0,
          operationId: randomUUID(),
        },
        'PUT',
      );
      assert.equal(first.status, 200, JSON.stringify(first));
      assert.equal(first.data.revision, 1);
      assert.equal(first.data.state.settings.theme, 'system');

      const goalOperation = randomUUID();
      const goal = await call(
        uid,
        '/state/daily-goal',
        {
          dailyGoal: 35,
          baseRevision: 1,
          operationId: goalOperation,
        },
        'PUT',
      );
      assert.equal(goal.status, 200, JSON.stringify(goal));
      assert.equal(goal.data.revision, 2);
      assert.equal(goal.data.state.settings.dailyGoal, 35);
      const duplicate = await call(
        uid,
        '/state/daily-goal',
        {
          dailyGoal: 35,
          baseRevision: 1,
          operationId: goalOperation,
        },
        'PUT',
      );
      assert.equal(duplicate.status, 200, JSON.stringify(duplicate));
      assert.equal(duplicate.data.revision, 2);
      assert.equal(duplicate.data.duplicate, true);

      const stale = await call(
        uid,
        '/state',
        {
          state: {
            ...initialState,
            clientUpdatedAt: '2026-09-12T07:00:00.000Z',
          },
          baseRevision: 1,
          operationId: randomUUID(),
        },
        'PUT',
      );
      assert.equal(stale.status, 409);
      assert.equal(stale.data.state.settings.dailyGoal, 35);

      const examTime = '2026-09-12T09:00:00.000Z';
      const exam = await call(
        uid,
        '/state/exam',
        {
          tests: [
            {
              id: 'checkpoint-test',
              qbankId: bank.id,
              questionIds: [approvedQuestion.id],
              currentIndex: 0,
              answers: { [approvedQuestion.id]: 1 },
              revealed: [approvedQuestion.id],
              graded: [approvedQuestion.id],
              status: 'active',
              createdAt: examTime,
              updatedAt: examTime,
            },
          ],
          progress: {
            [approvedQuestion.id]: {
              attempts: 1,
              lastAnswer: 1,
              updatedAt: examTime,
            },
          },
          clientUpdatedAt: examTime,
          answerSelections: [
            { qbankId: bank.id, questionId: approvedQuestion.id, answer: 1 },
          ],
          baseRevision: 2,
          operationId: randomUUID(),
        },
        'PUT',
      );
      assert.equal(exam.status, 200, JSON.stringify(exam));
      assert.equal(exam.data.revision, 3);
      assert.equal(exam.data.state.settings.dailyGoal, 35);
      const statistic = await db
        .prepare(
          "SELECT payload FROM records WHERE type='answerStats' AND id=?",
        )
        .bind(`${bank.id}:${approvedQuestion.id}`)
        .first();
      assert.equal(JSON.parse(statistic.payload).selections[uid], 1);
    },
  );

  await t.test(
    'Reviewer aggregation counts decisions once, including legacy completion, and refuses students',
    async () => {
      await account('performance-reviewer', ['reviewer']);
      await account('performance-author');
      const proposal = {
        id: 'performance-proposal',
        qbankId: 'pool-bank',
        type: 'new_question',
        status: 'pending',
        proposedById: 'performance-author',
        proposedByName: 'Author',
        proposedAt: now,
        payload: {
          stem: 'Pending',
          options: ['A', 'B'],
          answer: 0,
          specialty: 'Surgery',
          topic: 'Topic A',
          explanation: '',
          sourceReference: '',
        },
      };
      await record('questionProposals', proposal, 'performance-author');
      assert.equal(
        (await call('performance-reviewer', '/platform/reviewer-performance'))
          .status,
        403,
      );
      const before = await call(
        'admin',
        '/platform/reviewer-performance?timeZone=Asia%2FRiyadh',
      );
      assert.equal(before.status, 200, JSON.stringify(before));
      assert.equal(
        before.data.reviewers.find((row) => row.id === 'performance-reviewer')
          .month,
        0,
      );
      const decisions = await Promise.all(
        [1, 2].map(() =>
          call('performance-reviewer', '/platform/bulk-review', {
            proposalIds: [proposal.id],
            status: 'rejected',
          }),
        ),
      );
      assert.equal(
        decisions.filter((result) => result.status === 200).length,
        1,
        JSON.stringify(decisions),
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM contribution_reviews WHERE proposal_id=?',
            )
            .bind(proposal.id)
            .first()
        ).n,
        1,
      );
      // Existing collaboration clients complete a proposal through records updates.
      const legacy = { ...proposal, id: 'legacy-performance' };
      await record('questionProposals', legacy, 'performance-author');
      await db
        .prepare(
          "UPDATE records SET payload=? WHERE type='questionProposals' AND id=?",
        )
        .bind(
          JSON.stringify({
            ...legacy,
            status: 'approved',
            reviewedById: 'performance-reviewer',
            reviewedByName: 'Reviewer',
            reviewedAt: now,
          }),
          legacy.id,
        )
        .run();
      const after = await call(
        'admin',
        '/platform/reviewer-performance?timeZone=Asia%2FRiyadh',
      );
      const row = after.data.reviewers.find(
        (row) => row.id === 'performance-reviewer',
      );
      assert.equal(row.today, 2);
      assert.equal(row.month, 2);
      assert.equal(row.approved, 1);
      assert.equal(row.rejected, 1);
      assert.equal(
        (await call('admin', '/platform/reviewer-performance?timeZone=invalid'))
          .status,
        400,
      );
    },
  );

  await t.test(
    'Ready-made tests stay separate, rank atomically, reset on question edits, and support moderation',
    async () => {
      await account('preformed-owner');
      assert.equal((await call('free', '/preformed/create', {})).status, 403);
      const created = await call('preformed-owner', '/preformed/create', {});
      assert.equal(created.status, 201, JSON.stringify(created));
      const base = created.data.test;
      const settings = {
        mode: 'exam',
        durationMinutes: null,
        maxAttempts: 3,
        attemptResultPolicy: 'highest',
        randomizeQuestions: true,
        randomizeOptions: true,
        opensAt: null,
        closesAt: null,
        passingPercent: 60,
        allowBackNavigation: true,
      };
      const questions = [
        {
          id: randomUUID(),
          stem: 'Which option is correct?',
          options: ['Correct', 'Wrong'],
          answer: 0,
          explanation: 'A short explanation.',
          sourceReference: 'Fixture',
          images: [],
        },
      ];
      const savedQuestion = await call(
        'preformed-owner',
        '/preformed/save',
        {
          test: {
            ...base,
            title: 'Independent test',
            visibility: 'private',
            status: 'draft',
            settings,
            questions,
          },
        },
        'PUT',
      );
      assert.equal(savedQuestion.status, 200, JSON.stringify(savedQuestion));
      assert.equal(savedQuestion.data.resultsReset, true);
      const managedDraft = await call(
        'preformed-owner',
        `/preformed/manage?id=${base.id}`,
      );
      assert.equal(managedDraft.status, 200, JSON.stringify(managedDraft));
      assert.deepEqual(managedDraft.data.test.questions, questions);

      const published = await call(
        'preformed-owner',
        '/preformed/save',
        {
          test: {
            ...savedQuestion.data.test,
            visibility: 'public',
            status: 'published',
          },
        },
        'PUT',
      );
      assert.equal(published.status, 200, JSON.stringify(published));
      assert.equal(published.data.resultsReset, false);
      const test = published.data.test;
      assert.match(test.code, /^QF-[A-Z0-9]{6}$/);
      assert.ok(
        (await call('free', '/preformed/catalog')).data.tests.some(
          (item) => item.id === test.id,
        ),
      );

      const opened = await call('free', `/preformed/open?code=${test.code}`);
      assert.equal(opened.status, 200, JSON.stringify(opened));
      const submissionId = randomUUID();
      const submitted = await call('free', '/preformed/submit', {
        submissionId,
        attemptToken: opened.data.test.attemptToken,
        answers: { [questions[0].id]: 0 },
        durationSeconds: 12,
      });
      assert.equal(submitted.status, 200, JSON.stringify(submitted));
      assert.equal(submitted.data.score, 1);
      const duplicate = await call('free', '/preformed/submit', {
        submissionId,
        attemptToken: opened.data.test.attemptToken,
        answers: { [questions[0].id]: 0 },
        durationSeconds: 12,
      });
      assert.equal(duplicate.status, 200, JSON.stringify(duplicate));
      assert.equal(duplicate.data.duplicate, true);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM preformed_leaderboard WHERE test_id=?',
            )
            .bind(test.id)
            .first()
        ).n,
        1,
      );

      const settingsOnly = await call(
        'preformed-owner',
        '/preformed/save',
        {
          test: {
            ...test,
            description: 'Settings do not erase scores.',
            settings: { ...settings, passingPercent: 70 },
            questions,
          },
        },
        'PUT',
      );
      assert.equal(settingsOnly.status, 200, JSON.stringify(settingsOnly));
      assert.equal(settingsOnly.data.resultsReset, false);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM preformed_leaderboard WHERE test_id=?',
            )
            .bind(test.id)
            .first()
        ).n,
        1,
      );

      const changedQuestions = [
        { ...questions[0], stem: 'Changed question content?' },
      ];
      const reset = await call(
        'preformed-owner',
        '/preformed/save',
        {
          test: { ...settingsOnly.data.test, questions: changedQuestions },
        },
        'PUT',
      );
      assert.equal(reset.status, 200, JSON.stringify(reset));
      assert.equal(reset.data.resultsReset, true);
      for (const table of [
        'preformed_leaderboard',
        'preformed_question_stats',
        'preformed_participation',
        'preformed_submission_receipts',
      ])
        assert.equal(
          (
            await db
              .prepare(`SELECT count(*) AS n FROM ${table} WHERE test_id=?`)
              .bind(test.id)
              .first()
          ).n,
          0,
        );

      assert.equal(
        (
          await call('free', '/preformed/report', {
            id: test.id,
            reason: 'Please review this fixture.',
          })
        ).status,
        200,
      );
      const reports = await call('admin', '/preformed/reports');
      assert.equal(reports.status, 200, JSON.stringify(reports));
      assert.ok(reports.data.reports.some((item) => item.test_id === test.id));
      assert.equal(
        (
          await call(
            'admin',
            '/preformed/moderate',
            { id: test.id, hidden: true },
            'PUT',
          )
        ).status,
        200,
      );
      assert.equal(
        (await call('free', `/preformed/open?code=${test.code}`)).status,
        403,
      );
      assert.equal(
        (await db.prepare('PRAGMA foreign_key_check').all()).results.length,
        0,
      );
    },
  );

  await t.test(
    'Account deletion is atomic, preserves shared/public content and anonymizes reviewer history',
    async () => {
      const uid = 'account-to-delete';
      const profile = await account(uid, ['reviewer']);
      const privateBank = makeBank('delete-private', uid, 'private');
      const sharedBank = makeBank('keep-shared', uid, 'private');
      const publicBank = makeBank('keep-public', uid);
      await record('qbanks', privateBank, uid);
      await record('qbanks', sharedBank, uid);
      await record('qbanks', publicBank, uid);
      // Sharing exists only in membership records, not legacy viewerIds arrays.
      await record(
        'qbankMemberships',
        {
          id: 'shared-member',
          qbankId: sharedBank.id,
          userId: 'pool-learner',
          userName: 'Pool learner',
          role: 'viewer',
          grantedById: uid,
          grantedByName: profile.displayName,
        },
        'pool-learner',
      );
      await record('sharedQuestions', {
        ...question('private-delete-question', privateBank.id, '76001'),
        writtenById: uid,
        writtenByName: profile.displayName,
      });
      await record('sharedQuestions', {
        ...question('shared-keep-question', sharedBank.id, '76002'),
        writtenById: uid,
        writtenByName: profile.displayName,
      });
      await record('sharedQuestions', {
        ...question('public-keep-question', publicBank.id, '76003'),
        writtenById: uid,
        writtenByName: profile.displayName,
      });
      const proposal = {
        id: 'preserved-proposal',
        qbankId: publicBank.id,
        questionId: 'public-keep-question',
        status: 'approved',
        type: 'new_question',
        proposedById: uid,
        proposedByName: profile.displayName,
        reviewedById: uid,
        reviewedByName: profile.displayName,
        reviewedAt: now,
        proposedAt: now,
        payload: {
          stem: 'Public contribution',
          options: ['a', 'b'],
          answer: 0,
        },
      };
      await record('questionProposals', proposal, uid);
      await db
        .prepare('INSERT INTO contribution_reviews VALUES(?,?,?,?,?,?,?,?)')
        .bind(
          'preserved-review',
          proposal.id,
          uid,
          uid,
          'approved',
          0,
          now,
          '{}',
        )
        .run();
      await record(
        'auditLog',
        {
          id: 'preserved-audit',
          actorId: uid,
          actorName: profile.displayName,
          detail: JSON.stringify({ previous: profile }),
          createdAt: now,
        },
        uid,
      );
      const personal = {
        version: 1,
        tests: [],
        customQuestions: [],
        progress: {},
        reports: [],
        revisions: [],
        questionOverrides: {},
        flashcards: [{ id: 'personal-card', deckId: 'personal-deck' }],
        flashcardDecks: [{ id: 'personal-deck' }],
        flashcardSchedules: {},
        flashcardReviewLog: [],
        settings: {},
      };
      await db
        .prepare(
          'INSERT INTO app_states(user_id,payload,updated_at) VALUES(?,?,?)',
        )
        .bind(uid, JSON.stringify(personal), now)
        .run();
      await db
        .prepare('INSERT INTO test_registry VALUES(?,?,?,?)')
        .bind(uid, 'personal-test', 10, now)
        .run();
      await db
        .prepare(
          'INSERT INTO tickets(id,user_id,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?)',
        )
        .bind('personal-ticket', uid, 'Personal ticket', 'open', now, now)
        .run();
      await db
        .prepare('INSERT INTO ticket_messages VALUES(?,?,?,?,?,?)')
        .bind(
          'personal-message',
          'personal-ticket',
          uid,
          'Private text',
          null,
          now,
        )
        .run();
      assert.equal(
        (await call(uid, '/auth/account', { confirmation: 'delete' }, 'DELETE'))
          .status,
        400,
      );
      // Simulate a database failure at the very last step. Everything must roll back.
      await db.exec(
        `CREATE TRIGGER prevent_test_deletion BEFORE DELETE ON profiles WHEN OLD.uid='${uid}' BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END;`,
      );
      assert.equal(
        (await call(uid, '/auth/account', { confirmation: 'DELETE' }, 'DELETE'))
          .status,
        500,
      );
      assert.ok(
        await db
          .prepare('SELECT uid FROM profiles WHERE uid=?')
          .bind(uid)
          .first(),
      );
      assert.ok(
        await db
          .prepare("SELECT id FROM records WHERE type='qbanks' AND id=?")
          .bind(privateBank.id)
          .first(),
      );
      assert.ok(
        await db
          .prepare('SELECT user_id FROM app_states WHERE user_id=?')
          .bind(uid)
          .first(),
      );
      await db.exec('DROP TRIGGER prevent_test_deletion;');
      const result = await call(
        uid,
        '/auth/account',
        { confirmation: 'DELETE' },
        'DELETE',
      );
      assert.equal(result.status, 200, JSON.stringify(result));
      for (const table of [
        'profiles',
        'sessions',
        'app_states',
        'test_registry',
        'tickets',
      ])
        assert.equal(
          (
            await db
              .prepare(
                `SELECT count(*) AS n FROM ${table} WHERE ${table === 'profiles' ? 'uid' : 'user_id'}=?`,
              )
              .bind(uid)
              .first()
          ).n,
          0,
        );
      assert.equal((await call(uid, '/auth/session')).data.user, null);
      assert.equal(
        await db
          .prepare(
            "SELECT id FROM records WHERE type='qbanks' AND id='delete-private'",
          )
          .first(),
        null,
      );
      assert.equal(
        await db
          .prepare(
            "SELECT id FROM records WHERE type='sharedQuestions' AND id='private-delete-question'",
          )
          .first(),
        null,
      );
      for (const id of [sharedBank.id, publicBank.id])
        assert.equal(
          JSON.parse(
            (
              await db
                .prepare(
                  "SELECT payload FROM records WHERE type='qbanks' AND id=?",
                )
                .bind(id)
                .first()
            ).payload,
          ).ownerId,
          'admin',
        );
      for (const id of ['shared-keep-question', 'public-keep-question']) {
        const q = JSON.parse(
          (
            await db
              .prepare(
                "SELECT payload FROM records WHERE type='sharedQuestions' AND id=?",
              )
              .bind(id)
              .first()
          ).payload,
        );
        assert.equal(q.writtenByName, 'Deleted user');
        assert.match(q.writtenById, /^deleted-/);
      }
      const audit = (
        await db
          .prepare(
            "SELECT payload FROM records WHERE type='auditLog' AND id='preserved-audit'",
          )
          .first()
      ).payload;
      assert.ok(!audit.includes(profile.email));
      assert.ok(!audit.includes(profile.phone));
      assert.ok(!audit.includes(profile.displayName));
      const review = await db
        .prepare(
          "SELECT * FROM contribution_reviews WHERE id='preserved-review'",
        )
        .first();
      assert.match(review.reviewer_id, /^deleted-/);
      assert.equal(review.author_id, review.reviewer_id);
      assert.equal(
        (await db.prepare('PRAGMA foreign_key_check').all()).results.length,
        0,
      );
      assert.equal(
        (
          await call(
            'admin',
            '/auth/account',
            { confirmation: 'DELETE' },
            'DELETE',
          )
        ).status,
        409,
      );
    },
  );
}
