import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

void test('bank deletion stays within a small D1 read budget with unrelated history', async t => {
  await mkdir('.ui-review', { recursive: true });
  await build({
    stdin: {
      contents: `import {env} from 'cloudflare:workers';
        import {bankDeletionStatements} from './features/qbanks/server/bank-deletion.ts';
        export default {async fetch(){
          const results=await env.DB.batch(bankDeletionStatements(
            {uid:'cost-owner',role:'super_admin',displayName:'Fixture'},
            {id:'cost-bank',ownerId:'cost-owner'},'2026-10-02T00:00:00Z'));
          return Response.json(results.map(result=>result.meta));
        }};`,
      resolveDir: process.cwd(),
      sourcefile: 'qbank-cost-test.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    external: ['cloudflare:workers'],
    outfile: '.ui-review/qbank-deletion-cost-test.mjs',
  });
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: '.ui-review/qbank-deletion-cost-test.mjs',
    compatibilityDate: '2026-09-07',
    d1Databases: { DB: 'qbank-deletion-cost-test' },
  }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort())
    for (const sql of unstable_splitSqlQuery(readFileSync(`drizzle/${name}`, 'utf8')))
      await db.prepare(sql).run();

  const records = Array.from({ length: 6000 }, (_, i) => ({
    id: `unrelated-${i}`,
    type: i % 2 ? 'answerStats' : 'auditLog',
    qbankId: 'unrelated-bank',
    questionId: `unrelated-question-${i}`,
    entityId: `unrelated-question-${i}`,
  }));
  records.push({ id: 'cost-bank', type: 'qbanks', ownerId: 'cost-owner' });
  for (let i = 0; i < 100; i++) records.push({
    id: `cost-question-${i}`, type: 'sharedQuestions',
    qbankId: 'cost-bank', questionId: String(50000 + i),
  });
  records.push(
    { id: 'related-stats', type: 'answerStats', questionId: 'cost-question-0' },
    { id: 'related-note', type: 'sharedNotes', questionId: 'cost-question-0' },
    { id: 'related-audit', type: 'auditLog', entityId: 'cost-question-0' },
    { id: 'related-proposal', type: 'questionProposals', status: 'approved', questionId: 'cost-question-0' },
  );
  await db.prepare(`INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at)
    SELECT json_extract(value,'$.type'),json_extract(value,'$.id'),
      json_extract(value,'$.qbankId'),json_extract(value,'$.ownerId'),
      value,'2026-10-02T00:00:00Z' FROM json_each(?)`)
    .bind(JSON.stringify(records)).run();
  // Old share links may carry the bank only in JSON.
  await db.prepare(`INSERT INTO records(type,id,payload,updated_at)
    VALUES('qbankShareLinks','legacy-link',?,'2026-10-02T00:00:00Z')`)
    .bind(JSON.stringify({ id: 'legacy-link', qbankId: 'cost-bank' })).run();

  const response = await mf.dispatchFetch('https://fixture.test/delete');
  assert.equal(response.status, 200);
  const metadata = await response.json();
  const reads = metadata.reduce((sum, meta) => sum + meta.rows_read, 0);
  // Before 0030 this fixture costs about 600,000 reads for one deletion.
  assert.ok(reads < 5000, `Deletion consumed ${reads} D1 rows read`);
  assert.equal(await db.prepare("SELECT count(*) FROM records WHERE qbank_id='unrelated-bank'").first('count(*)'), 6000);
  assert.equal(await db.prepare("SELECT count(*) FROM records WHERE qbank_id='cost-bank' OR (type='qbanks' AND id='cost-bank') OR id IN ('legacy-link','related-note','related-stats')").first('count(*)'), 0);
  assert.equal(await db.prepare("SELECT count(*) FROM retired_questions WHERE id LIKE 'cost-question-%'").first('count(*)'), 100);
  assert.equal(await db.prepare("SELECT json_extract(payload,'$.entityId') FROM records WHERE type='auditLog' AND id='related-audit'").first("json_extract(payload,'$.entityId')"), '#deleted');
  assert.equal(await db.prepare("SELECT json_extract(payload,'$.questionId') FROM records WHERE type='questionProposals' AND id='related-proposal'").first("json_extract(payload,'$.questionId')"), '#deleted');
  assert.ok(await db.prepare("SELECT id FROM records WHERE type='qbankTombstones' AND id='cost-bank'").first());
});
