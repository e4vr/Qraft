import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export async function improvementsApiTests(t, db, call, runtime) {
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
    'Direct QBank deletion atomically removes related generic records and classification state',
    async () => {
      await account('direct-delete-owner');
      const bank = makeBank('direct-delete-bank', 'direct-delete-owner', 'private');
      await record('qbanks', bank, 'direct-delete-owner');
      await record('qbankMemberships', {
        id: 'direct-delete-membership',
        qbankId: bank.id,
        userId: 'free',
        userName: 'free',
        role: 'viewer',
        grantedById: 'direct-delete-owner',
        grantedByName: 'Owner',
        createdAt: now,
      });
      await record('questionProposals', {
        id: 'direct-delete-proposal',
        qbankId: bank.id,
        type: 'new_question',
        editKinds: ['question_text'],
        payload: { stem: 'Pending', options: ['A', 'B'], answer: 0, explanation: '', sourceReference: 'Fixture' },
        proposedById: 'free',
        proposedByName: 'free',
        proposedAt: now,
        status: 'pending',
      }, 'free');
      await db.prepare(
        'INSERT INTO qbank_classification_revisions(qbank_id,revision,updated_at) VALUES(?,?,?)',
      ).bind(bank.id, 1, now).run();

      const duplicateMembership = await call(
        'direct-delete-owner',
        '/collaboration',
        {
          operations: [{
            collection: 'qbankMemberships',
            id: 'direct-delete-membership-duplicate',
            type: 'set',
            value: {
              id: 'direct-delete-membership-duplicate',
              qbankId: bank.id,
              userId: 'free',
              userName: 'free',
              role: 'reviewer',
              grantedById: 'direct-delete-owner',
              grantedByName: 'Owner',
              createdAt: now,
            },
          }],
        },
        'PUT',
      );
      assert.equal(duplicateMembership.status, 409, JSON.stringify(duplicateMembership));

      const deleted = await call(
        'direct-delete-owner',
        '/collaboration',
        { operations: [{ collection: 'qbanks', id: bank.id, type: 'delete' }] },
        'PUT',
      );
      assert.equal(deleted.status, 200, JSON.stringify(deleted));
      assert.equal(
        (
          await db.prepare(
            'SELECT count(*) AS n FROM records WHERE qbank_id=? OR (type=\'qbanks\' AND id=?)',
          ).bind(bank.id, bank.id).first()
        ).n,
        0,
      );
      assert.equal(
        await db.prepare(
          'SELECT qbank_id FROM qbank_classification_revisions WHERE qbank_id=?',
        ).bind(bank.id).first(),
        null,
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
      const surgeryTopic = { specialty: 'Surgery', topic: 'Topic A' };
      const medicineTopic = { specialty: 'Medicine', topic: 'Topic A' };
      assert.equal((await pool({ includedTopics: [surgeryTopic] })).data.eligible, 250);
      assert.equal((await pool({ includedTopics: [medicineTopic] })).data.eligible, 250);
      assert.equal((await pool({ includedTopics: [surgeryTopic, medicineTopic] })).data.eligible, 500);
      assert.equal((await pool({ includedTopics: [{ specialty: 'Surgery', topic: 'missing' }] })).data.eligible, 0);
      assert.equal((await pool({ includedTopics: [{ specialty: 1, topic: 'Topic A' }] })).status, 400);
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
      const selectedSurgery = await pool(
        { includedTopics: [surgeryTopic], count: 10 },
        { select: true },
      );
      assert.equal(selectedSurgery.status, 200, JSON.stringify(selectedSurgery));
      assert.ok(selectedSurgery.data.questions.every((q) =>
        q.specialty === 'Surgery' && q.topic === 'Topic A',
      ));
      const selectedAcrossSpecialties = await pool(
        { includedTopics: [surgeryTopic, medicineTopic], count: 10 },
        { select: true },
      );
      assert.equal(selectedAcrossSpecialties.status, 200, JSON.stringify(selectedAcrossSpecialties));
      assert.equal(selectedAcrossSpecialties.data.questions.length, 10);
      assert.ok(selectedAcrossSpecialties.data.questions.every((q) =>
        (q.specialty === 'Surgery' || q.specialty === 'Medicine') && q.topic === 'Topic A',
      ));
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
      const superseded = await call(uid, '/state', { state: initialState,
        baseRevision: goal.data.revision, operationId: randomUUID() }, 'PUT');
      assert.equal(superseded.status, 200);
      assert.equal(superseded.data.superseded, true);
      assert.equal(superseded.data.state.settings.dailyGoal, 35);

      const examTime = new Date(Date.parse(goal.data.state.clientUpdatedAt) + 1000).toISOString();
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
      const auditBeforeReplay = await db
        .prepare("SELECT count(*) AS value FROM records WHERE type='auditLog'")
        .first();
      const operationsBeforeReplay = await db
        .prepare(
          'SELECT count(*) AS value FROM state_sync_operations WHERE user_id=?',
        )
        .bind(uid)
        .first();
      const replay = await call(
        uid,
        '/state/exam',
        {
          tests: exam.data.state.tests,
          progress: exam.data.state.progress,
          clientUpdatedAt: examTime,
          answerSelections: [
            { qbankId: bank.id, questionId: approvedQuestion.id, answer: 1 },
          ],
          baseRevision: exam.data.revision,
          operationId: randomUUID(),
        },
        'PUT',
      );
      assert.equal(replay.status, 200, JSON.stringify(replay));
      assert.equal(replay.data.unchanged, true);
      assert.equal(
        (
          await db
            .prepare("SELECT count(*) AS value FROM records WHERE type='auditLog'")
            .first()
        ).value,
        auditBeforeReplay.value,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS value FROM state_sync_operations WHERE user_id=?',
            )
            .bind(uid)
            .first()
        ).value,
        operationsBeforeReplay.value,
      );
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
      const questionId = randomUUID();
      const mediaKey = `questions/preformed-${base.id}/${questionId}/fixture.png`;
      await runtime.assets.put(
        mediaKey,
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        { httpMetadata: { contentType: 'image/png' } },
      );
      await db
        .prepare(
          "INSERT INTO media(key,qbank_id,owner_id,content_type,size,provider,storage_key,file_hash,original_name,purpose,status,created_at,updated_at) VALUES(?,?,?,?,?,'r2',?,?,?,?, 'ready',?,?)",
        )
        .bind(
          mediaKey,
          `preformed-${base.id}`,
          'preformed-owner',
          'image/png',
          8,
          mediaKey,
          '0'.repeat(64),
          'fixture.png',
          'questions',
          now,
          now,
        )
        .run();
      const questions = [
        {
          id: questionId,
          stem: 'Which option is correct?',
          options: ['Correct', 'Wrong'],
          answer: 0,
          explanation: 'A short explanation.',
          sourceReference: 'Fixture',
          images: [
            {
              id: randomUUID(),
              url: `/api/cloudflare/media/${mediaKey}`,
              name: 'fixture.png',
              caption: '',
            },
          ],
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
      assert.equal(
        (await call('free', `/preformed/leaderboard?id=${base.id}`)).status,
        403,
      );
      assert.equal(
        (
          await call(
            'preformed-owner',
            `/preformed/leaderboard?id=${base.id}`,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await runtime.fetch(
            `https://qraft.test/api/cloudflare/media/${mediaKey}`,
          )
        ).status,
        403,
      );
      await db
        .prepare('UPDATE r2_usage_periods SET class_b_operations=0')
        .run();
      assert.equal(
        (
          await runtime.fetch(
            `https://qraft.test/api/cloudflare/media/${mediaKey}`,
            {
              headers: {
                cookie: '__Host-qraft_session=fixture-preformed-owner',
              },
            },
          )
        ).status,
        200,
      );

      const privatePublished = await call(
        'preformed-owner',
        '/preformed/save',
        {
          test: {
            ...savedQuestion.data.test,
            visibility: 'private',
            status: 'published',
          },
        },
        'PUT',
      );
      assert.equal(privatePublished.status, 200, JSON.stringify(privatePublished));
      const privateOpened = await call(
        'free',
        `/preformed/open?code=${privatePublished.data.test.code}`,
      );
      assert.equal(privateOpened.status, 200, JSON.stringify(privateOpened));
      const securedImageUrl = privateOpened.data.test.questions[0].images[0].url;
      assert.match(securedImageUrl, /\?attempt=[a-f0-9]{64}$/);
      await db
        .prepare('UPDATE r2_usage_periods SET class_b_operations=0')
        .run();
      assert.equal(
        (
          await runtime.fetch(`https://qraft.test${securedImageUrl}`, {
            headers: { cookie: '__Host-qraft_session=fixture-free' },
          })
        ).status,
        200,
      );

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
      assert.equal(opened.data.test.questions[0].answer, -1);
      assert.equal(opened.data.test.questions[0].explanation, '');
      const tokenIssued = await db.prepare('SELECT issued_at FROM preformed_attempt_tokens WHERE token_hash=?')
        .bind(createHash('sha256').update(opened.data.test.attemptToken).digest('hex')).first();
      await db.prepare('UPDATE preformed_attempt_tokens SET issued_at=? WHERE token_hash=?')
        .bind(new Date(Date.now() - 60_000).toISOString(), createHash('sha256').update(opened.data.test.attemptToken).digest('hex')).run();
      const submissionId = randomUUID();
      const submitted = await call('free', '/preformed/submit', {
        submissionId,
        attemptToken: opened.data.test.attemptToken,
        answers: { [questions[0].id]: 0 },
        durationSeconds: 12,
      });
      assert.equal(submitted.status, 200, JSON.stringify(submitted));
      assert.equal(submitted.data.score, 1);
      assert.equal(submitted.data.questions[0].answer, 0);
      const persistedDuration = await db.prepare('SELECT duration_seconds FROM preformed_leaderboard WHERE id=?').bind(submissionId).first();
      assert.ok(persistedDuration.duration_seconds >= 60, JSON.stringify(persistedDuration));
      assert.ok(tokenIssued.issued_at);
      const otherOpened = await call('preformed-owner', `/preformed/open?code=${test.code}`);
      assert.equal((await call('preformed-owner', '/preformed/submit', {
        submissionId, attemptToken: otherOpened.data.test.attemptToken, answers: {},
      })).status, 403);
      assert.equal((await call('preformed-owner', '/preformed/submit', {
        submissionId: randomUUID(), attemptToken: opened.data.test.attemptToken, answers: {},
      })).status, 403);
      const guestOpened = await call('unknown-guest', `/preformed/open?code=${test.code}`);
      assert.equal(guestOpened.status, 200);
      assert.equal((await call('unknown-guest', '/preformed/submit', {
        submissionId: randomUUID(), attemptToken: guestOpened.data.test.attemptToken,
        participantName: 'Guest', participantKey: randomUUID(), guestScore: 1,
      })).status, 400);
      const guestResult = await call('unknown-guest', '/preformed/submit', {
        submissionId: randomUUID(), attemptToken: guestOpened.data.test.attemptToken,
        participantName: 'Guest', participantKey: randomUUID(), guestScore: 1,
        answers: { [questionId]: 1 }, durationSeconds: 0,
      });
      assert.equal(guestResult.status, 200, JSON.stringify(guestResult));
      assert.equal(guestResult.data.score, 0);
      // Remove only this guest fixture before the existing count assertions.
      await db.prepare("DELETE FROM preformed_leaderboard WHERE test_id=? AND guest=1").bind(test.id).run();
      await db.prepare('DELETE FROM preformed_submission_receipts WHERE test_id=? AND user_id IS NULL').bind(test.id).run();
      const duplicate = await call('free', '/preformed/submit', {
        submissionId,
        attemptToken: opened.data.test.attemptToken,
        answers: { [questions[0].id]: 0 },
        durationSeconds: 12,
      });
      assert.equal(duplicate.status, 200, JSON.stringify(duplicate));
      assert.equal(duplicate.data.duplicate, true);
      assert.equal(
        (await call('free', `/preformed/leaderboard?id=${test.id}`)).status,
        200,
      );
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

      const secondAttempt = await call(
        'free',
        `/preformed/open?code=${test.code}`,
      );
      const concurrent = await Promise.all(
        [randomUUID(), randomUUID()].map((id) =>
          call('free', '/preformed/submit', {
            submissionId: id,
            attemptToken: secondAttempt.data.test.attemptToken,
            answers: { [questions[0].id]: 0 },
            durationSeconds: 10,
          }),
        ),
      );
      assert.deepEqual(
        concurrent.map((result) => result.status).sort((left, right) => left - right),
        [200, 409],
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM preformed_submission_receipts WHERE test_id=?',
            )
            .bind(test.id)
            .first()
        ).n,
        2,
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

  await t.test('deleting a participant removes identifying results and updates other participants ranks and aggregates', async () => {
    await account('privacy-participant');
    await account('privacy-other');
    const created = await call('preformed-owner', '/preformed/create', {});
    const base = created.data.test;
    const questions = [{ id: randomUUID(), stem: 'Participant privacy fixture?', options: ['Yes', 'No'], answer: 0, explanation: 'Yes.', sourceReference: '', images: [] }];
    const published = await call('preformed-owner', '/preformed/save', { test: {
      ...base, title: 'Privacy test', status: 'published', visibility: 'public', questions,
      settings: { ...base.settings, maxAttempts: null, attemptResultPolicy: 'all' },
    } }, 'PUT');
    assert.equal(published.status, 200, JSON.stringify(published));
    const test = published.data.test;
    let participantToken;
    for (const uid of ['privacy-participant', 'privacy-other']) {
      const opened = await call(uid, `/preformed/open?code=${test.code}`);
      const token = opened.data.test.attemptToken;
      if (uid === 'privacy-participant') participantToken = token;
      const resumed = await runtime.fetch(`https://qraft.test/api/cloudflare/preformed/open?code=${test.code}`, {
        headers: { cookie: `__Host-qraft_session=fixture-${uid}`, 'x-qraft-attempt-token': token },
      });
      assert.equal(resumed.status, 200);
      const resumedBody = await resumed.json();
      assert.equal(resumedBody.test.attemptToken, token);
      assert.equal(resumedBody.test.attemptStartedAt, opened.data.test.attemptStartedAt);
      const result = await call(uid, '/preformed/submit', { submissionId: randomUUID(), attemptToken: token,
        answers: { [questions[0].id]: uid === 'privacy-participant' ? 0 : 1 }, durationSeconds: 0 });
      assert.equal(result.status, 200, JSON.stringify(result));
    }
    const before = await call('preformed-owner', `/preformed/leaderboard?id=${test.id}`);
    assert.equal(before.data.leaderboard.length, 2);
    assert.equal(before.data.leaderboard.find(row => row.participantUserId === 'privacy-other').rank, 2);
    // Simulate receipt retention expiring: a consumed token stays single-use,
    // and deleting the account must still remove its exact aggregate counts.
    await db.prepare('DELETE FROM preformed_submission_receipts WHERE user_id=?').bind('privacy-participant').run();
    assert.equal((await call('privacy-participant', '/preformed/submit', {
      submissionId: randomUUID(), attemptToken: participantToken, answers: {},
    })).status, 409);
    const removed = await call('privacy-participant', '/auth/account', { confirmation: 'DELETE' }, 'DELETE');
    assert.equal(removed.status, 200, JSON.stringify(removed));
    const after = await call('preformed-owner', `/preformed/leaderboard?id=${test.id}`);
    assert.equal(after.data.leaderboard.length, 1);
    assert.equal(after.data.leaderboard[0].participantUserId, 'privacy-other');
    assert.equal(after.data.leaderboard[0].rank, 1);
    for (const [table, column] of [['preformed_leaderboard', 'participant_user_id'], ['preformed_submission_receipts', 'user_id'], ['preformed_attempt_tokens', 'user_id']])
      assert.equal((await db.prepare(`SELECT count(*) n FROM ${table} WHERE ${column}=?`).bind('privacy-participant').first()).n, 0);
    const stats = await db.prepare('SELECT submissions,correct FROM preformed_question_stats WHERE test_id=?').bind(test.id).first();
    assert.equal(stats.submissions, 1);
    assert.equal(stats.correct, 0);
  });

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
