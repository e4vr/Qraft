import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export async function exactImportSkipApiTests(t, { db, call }) {
  const now = new Date().toISOString();
  const bank = {
    id: `exact-skip-${randomUUID()}`,
    name: 'Exact import skip fixture',
    shortName: 'SKIP',
    description: '',
    ownerId: 'admin',
    ownerName: 'Admin',
    createdById: 'admin',
    createdByName: 'Admin',
    createdAt: now,
    visibility: 'private',
    essential: false,
    shareEnabled: false,
    reviewerIds: [],
    viewerIds: [],
  };
  assert.equal((await call('admin', '/qbanks', { bank })).status, 200);
  const question = {
    stem: `Patient ${randomUUID()} asks which medication is indicated.`,
    options: ['First medication', 'Second medication'],
    answer: 1,
    specialty: 'Medicine',
    topic: 'Treatment',
    explanation: 'Fixture explanation.',
    sourceFile: 'Bulk fixture.pdf',
    sourcePage: 1,
    images: [],
  };
  const request = (questions, extra = {}) => {
    const id = randomUUID();
    return {
      qbankId: bank.id,
      requestId: id,
      fileName: `fixture-${id}.json`,
      fileHash: createHash('sha256').update(id).digest('hex'),
      sourceFile: 'Bulk fixture.pdf',
      questions,
      rightsConfirmed: true,
      ...extra,
    };
  };
  const send = (input) => call('admin', '/platform/import', input);

  await t.test(
    'opted-in bulk import skips exact copies and retains different answers and near matches',
    async () => {
      const input = request(
        [
          question,
          question,
          { ...question, answer: 0 },
          {
            ...question,
            stem: question.stem.replace('indicated.', 'NOT indicated.'),
          },
        ],
        { skipExactDuplicates: true },
      );
      const result = await send(input);
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.data.successful, 3);
      assert.equal(result.data.skippedDuplicates, 1);
      assert.equal(result.data.total, 4);
      assert.equal(
        result.data.proposals.filter(
          (item) => item.payload.stem === question.stem,
        ).length,
        2,
      );
      const repeated = await send(input);
      assert.deepEqual(repeated.data, result.data);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM records WHERE type='questionProposals' AND qbank_id=?",
            )
            .bind(bank.id)
            .first()
        ).n,
        3,
      );
    },
  );

  await t.test(
    'subsequent batches check stored pending questions and report an all-duplicate import without changing existing content',
    async () => {
      const before = await db
        .prepare(
          "SELECT id,payload FROM records WHERE type='questionProposals' AND qbank_id=? ORDER BY id",
        )
        .bind(bank.id)
        .all();
      const input = request(
        [
          {
            ...question,
            stem: `  ${question.stem.toUpperCase()}  `,
            options: ['B. Second medication', 'A. First medication'],
            answer: 0,
          },
        ],
        { skipExactDuplicates: true },
      );
      const result = await send(input);
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.data.successful, 0);
      assert.equal(result.data.skippedDuplicates, 1);
      assert.equal(result.data.total, 1);
      const after = await db
        .prepare(
          "SELECT id,payload FROM records WHERE type='questionProposals' AND qbank_id=? ORDER BY id",
        )
        .bind(bank.id)
        .all();
      assert.deepEqual(after.results, before.results);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT status FROM json_import_attempts WHERE request_id=?',
            )
            .bind(input.requestId)
            .first()
        ).status,
        'duplicate_only',
      );
      assert.equal((await send(input)).data.skippedDuplicates, 1);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='import_exact_duplicates_skipped' AND json_extract(payload,'$.detail') LIKE ?",
            )
            .bind(`%${input.requestId}%`)
            .first()
        ).n,
        1,
      );
    },
  );

  await t.test(
    'full-content matches are shown ahead of stem-only variants and server rechecks stale previews',
    async () => {
      const variants = Array.from({ length: 4 }, (_, i) => ({
        ...question,
        options: [`Alternative ${i}`, `Different answer ${i}`],
      }));
      assert.equal((await send(request(variants))).status, 200);
      const preview = await call('admin', '/platform/import-preview', {
        qbankId: bank.id,
        sourceFile: 'Bulk fixture.pdf',
        questions: [question],
      });
      assert.equal(preview.status, 200);
      assert.deepEqual(
        preview.data.matches[0][0].payload.options,
        question.options,
      );
      const edited = {
        ...question,
        options: ['Third medication', 'Fourth medication'],
      };
      const saved = await send(
        request([edited], { skipExactDuplicates: true }),
      );
      assert.equal(saved.status, 200, JSON.stringify(saved));
      assert.equal(saved.data.successful, 1);
      assert.equal(saved.data.skippedDuplicates, 0);
    },
  );

  await t.test(
    'stored approved questions are skipped without modifying their original content',
    async () => {
      const ids = await call('admin', '/ids/reserve', {
        qbankId: bank.id,
        count: 1,
      });
      assert.equal(ids.status, 200);
      const approved = {
        ...question,
        id: randomUUID(),
        stem: `Approved original ${randomUUID()}?`,
        qbankId: bank.id,
        questionId: ids.data.ids[0],
        number: 1,
        isCustom: true,
      };
      const payload = JSON.stringify(approved);
      await db
        .prepare(
          "INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES('sharedQuestions',?,?,?,?)",
        )
        .bind(approved.id, bank.id, payload, now)
        .run();
      const result = await send(
        request([approved], { skipExactDuplicates: true }),
      );
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.data.successful, 0);
      assert.equal(result.data.skippedDuplicates, 1);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT payload FROM records WHERE type='sharedQuestions' AND id=?",
            )
            .bind(approved.id)
            .first()
        ).payload,
        payload,
      );
    },
  );

  await t.test(
    'skipping is bank scoped and opt-in; malformed options and revoked bank access do not bypass validation',
    async () => {
      const otherBank = { ...bank, id: `exact-skip-${randomUUID()}` };
      assert.equal(
        (await call('admin', '/qbanks', { bank: otherBank })).status,
        200,
      );
      const separate = await send(
        request([question], {
          qbankId: otherBank.id,
          skipExactDuplicates: true,
        }),
      );
      assert.equal(separate.data.successful, 1);
      assert.equal(separate.data.skippedDuplicates, 0);
      const normal = await send(request([question]));
      assert.equal(normal.data.successful, 1);
      assert.equal(normal.data.skippedDuplicates, 0);
      assert.equal(
        (await send(request([question], { skipExactDuplicates: 'true' })))
          .status,
        400,
      );
      assert.equal(
        (
          await call(
            'other',
            '/platform/import',
            request([question], { skipExactDuplicates: true }),
          )
        ).status,
        403,
      );
      assert.equal(
        (await call('admin', `/qbanks/${otherBank.id}`, undefined, 'DELETE'))
          .status,
        200,
      );
      assert.equal(
        (
          await send(
            request([question], {
              qbankId: otherBank.id,
              skipExactDuplicates: true,
            }),
          )
        ).status,
        404,
      );
    },
  );
  assert.equal(
    (await call('admin', `/qbanks/${bank.id}`, undefined, 'DELETE')).status,
    200,
  );
}
