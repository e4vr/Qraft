import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

void test('indexed duplicate search preserves medical distinctions, invalidates every writer and guards atomic saves', async t => {
  await mkdir('.ui-review', { recursive: true });
  await build({ stdin: { contents: `import {env} from 'cloudflare:workers';
    import {importCandidates} from './features/imports/server/import-service.ts';
    import {importKeyStatement,importSearchRevision,importSearchGuard,releaseImportSearchGuard} from './features/imports/server/import-search.ts';
    import {exactImportIdentity} from './features/imports/domain/exact-import-duplicates.ts';
    export default {async fetch(request){const input=await request.json(),path=new URL(request.url).pathname;
      if(path==='/keys'){await (await importKeyStatement(input.rows)).run();return Response.json({ok:true});}
      if(path==='/candidates'){const revision=await importSearchRevision();const rows=await importCandidates(input.bank,input.questions,input.actor,revision);
        return Response.json({revision,candidates:rows.map(row=>({id:row.entityId,payload:row.payload,identity:exactImportIdentity(row.payload)}))});}
      if(path==='/guard'){try{await env.DB.batch([importSearchGuard('guard',input.revision),
        env.DB.prepare("INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES('questionProposals','guard-new','bank',?,'now')").bind(JSON.stringify(input.proposal)),
        await importKeyStatement([{collection:'questionProposals',id:'guard-new',payload:JSON.stringify(input.proposal)}]),
        releaseImportSearchGuard('guard')]);return Response.json({ok:true});}catch(error){return Response.json({error:String(error)},{status:409});}}
    }};`, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], outfile: '.ui-review/import-search-integrity.mjs' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: '.ui-review/import-search-integrity.mjs', compatibilityDate: '2026-09-07', d1Databases: { DB: 'search-test' } }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort())
    for (const sql of unstable_splitSqlQuery(readFileSync(`drizzle/${name}`, 'utf8'))) await db.prepare(sql).run();
  const payload = { stem: 'A patient receives 0.5 mg of medication. Which treatment is NOT indicated?', options: ['Continue 0.5 mg', 'Stop medication'], answer: 1, specialty: 'Medicine', topic: 'Therapy', explanation: '', images: [] };
  const variants = [payload, { ...payload, stem: payload.stem.replace('0.5 mg', '5 mg') },
    { ...payload, stem: payload.stem.replace('NOT', 'most') }, { ...payload, answer: 0 },
    { ...payload, options: [...payload.options].reverse(), answer: 0 }];
  const values = variants.map((value, i) => ({ collection: 'sharedQuestions', id: `medical-${i}`, payload: JSON.stringify({ ...value, id: `medical-${i}`, qbankId: 'bank', questionId: String(80000 + i), revision: 1 }) }));
  const put = row => db.prepare('INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload')
    .bind(row.collection, row.id, 'bank', row.payload, 'now').run();
  for (const row of values) await put(row);
  const call = async (path, body) => {
    const response = await mf.dispatchFetch(`https://fixture.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await call('/keys', { rows: values })).status, 200);
  const search = () => call('/candidates', { bank: 'bank', actor: 'author', questions: [payload] });
  const before = (await search()).data;
  const identity = before.candidates.find(row => row.id === 'medical-0').identity;
  assert.deepEqual(before.candidates.filter(row => row.identity === identity).map(row => row.id).sort(), ['medical-0', 'medical-4']);
  await put({ ...values[0], payload: JSON.stringify({ ...JSON.parse(values[0].payload), explanation: 'Updated explanation', topic: 'New classification' }) });
  assert.equal(await db.prepare("SELECT count(*) FROM import_question_keys WHERE record_id='medical-0'").first('count(*)'), 1);
  const metadataEdit = (await search()).data;
  assert.ok(metadataEdit.revision > before.revision);
  assert.equal(metadataEdit.candidates.find(row => row.id === 'medical-0').payload.explanation, 'Updated explanation');
  const altered = { ...values[0], payload: JSON.stringify({ ...JSON.parse(values[0].payload), stem: 'Completely different question about surgery', answer: 0 }) };
  await put(altered); // Simulate ANY external/admin/restore writer, without JS indexing.
  assert.equal(await db.prepare("SELECT count(*) FROM import_question_keys WHERE record_id='medical-0'").first('count(*)'), 0);
  const after = (await search()).data;
  assert.ok(after.revision > before.revision);
  assert.equal(after.candidates.some(row => row.id === 'medical-0'), false);
  const journalBefore = await db.prepare('SELECT count(*) FROM collaboration_changes').first('count(*)');
  const rejected = await call('/guard', { revision: before.revision, proposal: { id: 'guard-new', qbankId: 'bank', status: 'pending', payload } });
  assert.equal(rejected.status, 409);
  assert.match(rejected.data.error, /import_search_snapshot_matches/);
  assert.equal(await db.prepare("SELECT count(*) FROM records WHERE id='guard-new'").first('count(*)'), 0);
  assert.equal(await db.prepare('SELECT count(*) FROM collaboration_changes').first('count(*)'), journalBefore);
  assert.equal(await db.prepare('SELECT count(*) FROM import_search_guards').first('count(*)'), 0);
  assert.equal(await db.prepare("SELECT count(*) FROM import_question_keys WHERE record_id='guard-new'").first('count(*)'), 0);
  const accepted = await call('/guard', { revision: after.revision, proposal: { id: 'guard-new', qbankId: 'bank', status: 'pending', payload } });
  assert.equal(accepted.status, 200);
  assert.equal(await db.prepare("SELECT count(*) FROM import_question_keys WHERE record_id='guard-new'").first('count(*)'), 1);
  await db.prepare("DELETE FROM records WHERE id='guard-new'").run();
  assert.equal(await db.prepare("SELECT count(*) FROM import_question_keys WHERE record_id='guard-new'").first('count(*)'), 0);
  assert.ok((await search()).data.revision > after.revision);
  assert.equal((await call('/candidates', { bank: 'different-bank', actor: 'author', questions: [payload] })).data.candidates.length, 0);

  // Compare actual D1/FTS rankings across the result cap, including score ties.
  await db.prepare(`INSERT INTO records(type,id,qbank_id,payload,updated_at)
    SELECT 'sharedQuestions','dense-'||value,'dense',json_object('id','dense-'||value,'qbankId','dense','questionId',printf('%05d',20000+value),'stem','An adult patient presents with clinical symptoms case '||value||'. What is the most appropriate next step?','options',json('["One","Two"]'),'answer',0),'now'
    FROM json_each(?)`).bind(JSON.stringify(Array.from({ length: 2100 }, (_, i) => i))).run();
  const query = 'bank:"dense" AND stem:("An adult patient presents with clinical symptoms" OR "most appropriate next step")';
  const sql = order => `SELECT r.id,bm25(import_question_search) AS score FROM import_question_search s JOIN records r ON r.rowid=s.rowid WHERE import_question_search MATCH ? AND r.qbank_id='dense' ORDER BY ${order} LIMIT 1000`;
  const old = await db.prepare(sql('bm25(import_question_search)')).bind(query).all();
  const optimized = await db.prepare(sql('s.rank')).bind(query).all();
  assert.deepEqual(optimized.results, old.results);
  assert.ok(optimized.meta.rows_read < old.meta.rows_read, JSON.stringify({ old: old.meta, optimized: optimized.meta }));
});
