import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

void test('Superadmin has no JSON question cap while Full Access retains bounded import batches', async (t) => {
  await mkdir('.ui-review', { recursive: true });
  await build({
    stdin: {
      contents: "export {RealtimeChannel} from './workers/realtime.ts'; import {GET,POST,PUT,DELETE} from './app/api/cloudflare/[...path]/route.ts'; export default {fetch(request){return ({GET,POST,PUT,DELETE})[request.method](request)}}",
      resolveDir: process.cwd(),
      sourcefile: 'superadmin-import-worker.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    external: ['cloudflare:workers'],
    outfile: '.ui-review/superadmin-import-worker.mjs',
  });
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: '.ui-review/superadmin-import-worker.mjs',
    compatibilityDate: '2026-09-09',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'superadmin-import-test' },
    r2Buckets: { ASSETS: 'assets-test' },
    durableObjects: { REALTIME: { className: 'RealtimeChannel', useSQLite: true } },
    bindings: { ROOT_ADMIN_EMAIL: 'admin@example.test' },
  }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const statements = JSON.parse(execFileSync('python', ['-c', `import sqlite3,json,pathlib
out=[]
for f in sorted(pathlib.Path('drizzle').glob('*.sql')):
 s=''
 for ch in f.read_text(encoding='utf-8'):
  s+=ch
  if ch==';' and sqlite3.complete_statement(s):
   out.append(s);s=''
print(json.dumps(out))`], { encoding: 'utf8' }));
  for (const sql of statements) await db.prepare(sql).run();
  for (const uid of ['admin', 'monthly', 'quarterly']) {
    const now = new Date().toISOString();
    const profile = {
      uid, email: `${uid}@example.test`, displayName: uid,
      tier: uid === 'admin' ? 'free' : uid === 'quarterly' ? 'full_quarterly' : 'full_monthly',
      role: uid === 'admin' ? 'super_admin' : 'student',
      platformRoles: [], phone: `private-${uid}`, universityId: uid,
      status: 'approved', createdAt: now,
    };
    await db.prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)')
      .bind(uid, profile.email, 'unused', 'unused', JSON.stringify(profile), uid === 'admin' ? 'fixture-mfa' : null, now, now).run();
    await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,1,?)')
      .bind(createHash('sha256').update(`fixture-${uid}`).digest('hex'), uid, Math.floor(Date.now() / 1000) + 3600, now).run();
  }
  const call = async (uid, path, body, method = body ? 'POST' : 'GET') => {
    const response = await mf.dispatchFetch(`https://qraft.test/api/cloudflare${path}`, {
      method,
      headers: { cookie: `__Host-qraft_session=fixture-${uid}`, origin: 'https://qraft.test', 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const marker = randomUUID();
  const request = {
    qbankId: 'smle-gs', requestId: randomUUID(),
    fileName: `large-${marker}.json`,
    fileHash: createHash('sha256').update(marker).digest('hex'),
    rightsConfirmed: true,
    questions: Array.from({ length: 201 }, (_, index) => ({
      stem: `Unique clinical import fixture ${marker} question ${index}`,
      options: [`Answer ${index}`, `Alternative ${index}`],
      answer: 0, specialty: 'General', topic: 'Import QA',
      sourceFile: 'fixture.pdf', sourcePage: index + 1,
    })),
  };
  const forPlan = (plan, count) => ({
    ...request,
    requestId: randomUUID(),
    fileName: `${plan}-${count}-${marker}.json`,
    fileHash: createHash('sha256').update(`${plan}-${count}-${marker}`).digest('hex'),
    questions: request.questions.slice(0, count).map((question) => ({
      ...question,
      stem: `${plan} ${question.stem}`,
    })),
  });
  assert.equal((await call('monthly', '/platform/json-import-status')).status, 200);
  assert.equal((await call('quarterly', '/platform/json-import-status')).status, 200);
  assert.equal((await call('monthly', '/platform/import', forPlan('monthly', 1))).status, 200);
  assert.equal((await call('quarterly', '/platform/import', forPlan('quarterly', 1))).status, 200);
  assert.equal((await call('monthly', '/platform/import', forPlan('monthly', 151))).status, 403);
  assert.equal((await call('quarterly', '/platform/import', forPlan('quarterly', 151))).status, 403);
  assert.equal((await call('admin', '/platform/json-import-status')).status, 200);
  const imported = await call('admin', '/platform/import', request);
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  assert.equal(imported.data.successful, 201);
  assert.equal(imported.data.proposals.length, 201);
  const saved = await db.prepare("SELECT count(*) AS count FROM records WHERE type='questionProposals' AND owner_id='admin' AND json_extract(payload,'$.importBatchId')=?")
    .bind(request.requestId).first();
  assert.equal(saved.count, 201);
  const repeat = await call('admin', '/platform/import', {
    ...request,
    requestId: randomUUID(),
    fileName: `renamed-${marker}.json`,
  });
  assert.equal(repeat.status, 200, JSON.stringify(repeat.data));
  assert.equal(repeat.data.successful, 201);
  assert.equal(repeat.data.skippedDuplicates, 0);
  assert.equal(repeat.data.flaggedDuplicates,201);
  const newQuestion = { ...request.questions[0], stem: `A distinct clinical question ${marker}` };
  const sameName = await call('admin', '/platform/import', {
    ...request,
    requestId: randomUUID(),
    fileHash: createHash('sha256').update(`updated-${marker}`).digest('hex'),
    questions: [request.questions[0], newQuestion],
  });
  assert.equal(sameName.status, 200, JSON.stringify(sameName.data));
  assert.equal(sameName.data.successful, 2);
  assert.equal(sameName.data.skippedDuplicates, 0);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='duplicate_attempts'").first()).count, 1);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM duplicate_attempts').first()).count, 0);

  const now = new Date().toISOString();
  let recreatedBank = {
    id: `recreated-bank-${randomUUID()}`,
    name: 'Recreated import bank',
    shortName: 'RECREATE',
    description: 'Verifies that deleted JSON imports can be uploaded again.',
    createdAt: now,
    createdById: 'monthly',
    createdByName: 'monthly',
    ownerId: 'monthly',
    ownerName: 'monthly',
    visibility: 'public',
    shareEnabled: false,
    reviewerIds: [],
    viewerIds: [],
    archived: false,
    essential: false,
  };
  const saveBank = () => call('monthly', '/collaboration', {
    operations: [{ collection: 'qbanks', id: recreatedBank.id, type: 'set', value: recreatedBank }],
  }, 'PUT');
  assert.equal((await saveBank()).status, 200);

  const reusableFileName = `reusable-${marker}.json`;
  const reusableFileHash = createHash('sha256').update(`reusable-${marker}`).digest('hex');
  const reusableQuestion = {
    stem: `A reusable import question ${marker}`,
    options: ['Correct', 'Incorrect'],
    answer: 0,
    specialty: 'General',
    topic: 'Import lifecycle',
    sourceFile: reusableFileName,
    sourcePage: 1,
  };
  const reusableImport = () => {
    const requestId = randomUUID();
    return call('admin', '/platform/import', {
      qbankId: recreatedBank.id,
      requestId,
      uploadSessionId: randomUUID(),
      fileName: reusableFileName,
      originalFileName: reusableFileName,
      fileHash: reusableFileHash,
      originalFileHash: reusableFileHash,
      chunkIndex: 0,
      chunkCount: 1,
      rightsConfirmed: true,
      questions: [reusableQuestion],
    });
  };

  const firstReusableImport = await reusableImport();
  assert.equal(firstReusableImport.status, 200, JSON.stringify(firstReusableImport.data));
  assert.equal(firstReusableImport.data.successful, 1);

  const currentBank = (await call('admin', '/collaboration')).data.collaboration.qbanks.find(bank => bank.id === recreatedBank.id);
  const removeBank = await call('admin', '/collaboration', {
    operations: [{ collection: 'qbanks', id: recreatedBank.id, type: 'delete', baseValue: currentBank }],
  }, 'PUT');
  assert.equal(removeBank.status, 200, JSON.stringify(removeBank.data));
  assert.equal((await db.prepare("SELECT count(*) AS count FROM records WHERE qbank_id=?").bind(recreatedBank.id).first()).count, 0);

  recreatedBank = {
    ...recreatedBank,
    id: `recreated-bank-${randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
  assert.equal((await saveBank()).status, 200);
  const secondReusableImport = await reusableImport();
  assert.equal(secondReusableImport.status, 200, JSON.stringify(secondReusableImport.data));
  assert.equal(secondReusableImport.data.successful, 1);
  assert.equal(secondReusableImport.data.skippedDuplicates, 0);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM imported_files WHERE user_id='admin' AND normalized_name=? AND file_hash=?")
    .bind(reusableFileName, reusableFileHash).first()).count, 2);

  assert.equal((await call('monthly', '/platform/json-imports')).status, 403);
  const rejectedPlanImport = await call(
    'admin',
    `/platform/json-imports?search=${encodeURIComponent(`monthly-151-${marker}.json`)}`,
  );
  assert.equal(rejectedPlanImport.status, 200, JSON.stringify(rejectedPlanImport.data));
  assert.equal(rejectedPlanImport.data.total, 1);
  assert.equal(rejectedPlanImport.data.runs[0].status, 'rejected');
  assert.equal(rejectedPlanImport.data.runs[0].error_code, 'QUESTION_LIMIT_REACHED');

  const monitored = await call('admin', `/platform/json-imports?search=${encodeURIComponent(reusableFileName)}`);
  assert.equal(monitored.status, 200, JSON.stringify(monitored.data));
  assert.equal(monitored.data.total, 2);
  assert.deepEqual(monitored.data.runs.map((run) => run.status).sort(), ['completed', 'completed']);
  assert.ok(monitored.data.runs.every((run) => run.same_hash_count === 2));

  const removedRunId = monitored.data.runs[0].id;
  const removeRun = await call('admin', '/platform/json-imports', { runId: removedRunId }, 'DELETE');
  assert.equal(removeRun.status, 200, JSON.stringify(removeRun.data));
  assert.equal((await call('admin', `/platform/json-imports?run=${removedRunId}`)).status, 404);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM imported_files WHERE user_id='admin' AND normalized_name=? AND file_hash=?")
    .bind(reusableFileName, reusableFileHash).first()).count, 2);

  const interruptedRunId = randomUUID();
  await db.prepare(`INSERT INTO json_import_runs(
    id,user_id,qbank_id,file_name,normalized_name,file_hash,status,chunk_count,started_at,updated_at
  ) VALUES(?,?,?,?,?,?,'processing',2,?,?)`)
    .bind(interruptedRunId, 'admin', recreatedBank.id, 'interrupted.json', 'interrupted.json', reusableFileHash, now, now).run();
  assert.equal((await call('admin', '/platform/json-imports', { runId: interruptedRunId }, 'DELETE')).status, 409);
  await db.prepare('UPDATE json_import_runs SET updated_at=? WHERE id=?')
    .bind(new Date(Date.now() - 31 * 60 * 1000).toISOString(), interruptedRunId).run();
  const interrupted = await call('admin', `/platform/json-imports?run=${interruptedRunId}`);
  assert.equal(interrupted.status, 200, JSON.stringify(interrupted.data));
  assert.equal(interrupted.data.run.stale, 1);
  assert.equal((await call('admin', '/platform/json-imports', { runId: interruptedRunId }, 'DELETE')).status, 200);
  await t.test('Import controls, duplication review, deletion rights and chunk quotas', async()=>{
    await build({stdin:{contents:"export {duplicateFingerprint} from './features/duplicates/domain/duplicate-detection'; export {buildQuestionPrompt,parseQuestionImportReport} from './lib/question-import';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',outfile:'.ui-review/import-domain.mjs'});
    const {duplicateFingerprint,buildQuestionPrompt,parseQuestionImportReport}=await import('../.ui-review/import-domain.mjs');
    const guide=buildQuestionPrompt({source:'qbank',kind:'clinical',length:'medium',countMode:'fixed',count:12,optionCount:4});
    assert.match(guide,/electronic question platform/);assert.match(guide,/OCR/);assert.match(guide,/outside the bank only for this explanation/);assert.match(guide,/four close, logical and plausible options/);
    const lecture=buildQuestionPrompt({source:'lecture',kind:'direct',length:'short',countMode:'fixed',count:8,optionCount:4});
    assert.match(lecture,/target is 8 questions/);assert.match(lecture,/4 distinct answer options/);assert.match(lecture,/exclusive source/);
    const sourceReport=parseQuestionImportReport({sourceFile:'Bank.pdf',questions:[{...reusableQuestion,originalQuestionNumber:'37'}]});
    assert.match(sourceReport.questions[0].sourceReference,/Q.37/);
    assert.equal((await call('monthly','/platform/import-defaults')).status,403);
    assert.equal((await call('monthly','/platform/import-controls?userId=monthly')).status,403);
    assert.equal((await call('monthly','/platform/economy-admin',{operation:'import-limits',userId:'monthly',reason:'test',questionsPerImport:5000,importsPerDay:100})).status,403);
    assert.equal((await call('admin','/platform/import-defaults',{questionsPerImport:27,importsPerDay:10,reason:'Import QA defaults'})).status,200);
    assert.equal((await call('monthly','/platform/json-import-status')).data.questionsPerImport,27);
    assert.equal((await call('admin','/platform/economy-admin',{operation:'import-limits',userId:'monthly',reason:'Import QA override',questionsPerImport:28,importsPerDay:12})).status,200);
    assert.equal((await call('monthly','/platform/json-import-status')).data.questionsPerImport,28);
    assert.equal((await call('admin','/platform/import-controls?userId=monthly')).data.importLimits.questionsPerImport,28);
    assert.equal((await call('monthly','/platform/plan-status')).data.limits.jsonQuestionsPerImport,28);
    assert.equal((await call('admin','/platform/economy-admin',{operation:'import-limits',userId:'monthly',reason:'invalid cap',questionsPerImport:5001,importsPerDay:12})).status,400);
    const logicalId=randomUUID(),hash=createHash('sha256').update(logicalId).digest('hex');
    const metadata={qbankId:'smle-gs',uploadSessionId:logicalId,originalFileName:'same-name.json',originalFileHash:hash,fileName:'same-name.json',fileHash:hash,chunkCount:3,rightsConfirmed:true};
    const makeQuestions=(start,count)=>Array.from({length:count},(_,i)=>({...reusableQuestion,stem:`Quota clinical patient ${marker} with measurement ${start+i}`,sourcePage:start+i+1}));
    const firstChunk={...metadata,requestId:randomUUID(),chunkIndex:0,questions:makeQuestions(0,25)};
    assert.equal((await call('monthly','/platform/import',firstChunk)).status,200);
    assert.equal((await call('monthly','/platform/import',{...metadata,requestId:randomUUID(),chunkIndex:1,questions:makeQuestions(25,3)})).status,200);
    assert.equal((await call('monthly','/platform/import',{...metadata,requestId:randomUUID(),chunkIndex:2,questions:makeQuestions(28,1)})).status,403);
    const before=await db.prepare("SELECT count(*) AS value FROM records WHERE type='questionProposals' AND owner_id='monthly'").first();
    assert.equal((await call('monthly','/platform/import',firstChunk)).status,200);
    assert.equal((await db.prepare("SELECT count(*) AS value FROM records WHERE type='questionProposals' AND owner_id='monthly'").first()).value,before.value);
    assert.equal((await db.prepare("SELECT count(DISTINCT run_id) AS value FROM imported_files WHERE user_id='monthly' AND run_id=?").bind(logicalId).first()).value,1);
    const duplicate={...firstChunk.questions[0],options:['Different correct choice','Different distractor'],answer:1};
    const preview=await call('monthly','/platform/import-preview',{qbankId:'smle-gs',questions:[duplicate]});
    assert.equal(preview.status,200,JSON.stringify(preview));assert.ok(preview.data.matches[0].length);
    const match=preview.data.matches[0][0];assert.equal(match.payload.stem,duplicate.stem);
    assert.equal((await call('quarterly','/platform/import-delete-duplicate',{qbankId:'smle-gs',...match})).status,403);
    assert.equal((await call('monthly','/platform/import-delete-duplicate',{qbankId:'smle-gs',...match,candidateFingerprint:'changed'})).status,409);
    const keep=await call('monthly','/platform/import',{...metadata,uploadSessionId:randomUUID(),chunkCount:1,chunkIndex:0,requestId:randomUUID(),questions:[duplicate],duplicateChoices:[{sourceFingerprint:duplicateFingerprint(duplicate),candidateFingerprints:preview.data.matches[0].map(m=>m.candidateFingerprint)}]});
    assert.equal(keep.status,200,JSON.stringify(keep));assert.equal(keep.data.successful,1);assert.equal(keep.data.skippedDuplicates,0);assert.equal(keep.data.proposals[0].duplicateReview.status,'resolved');
    assert.equal((await call('monthly','/platform/import-delete-duplicate',{qbankId:'smle-gs',...match})).status,200);
    assert.equal((await db.prepare("SELECT count(*) AS value FROM records WHERE type='questionProposals' AND id=?").bind(match.entityId).first()).value,0);
    assert.equal((await db.prepare('SELECT count(*) AS value FROM import_question_search WHERE entity_id=?').bind(match.entityId).first()).value,0);
    const normalizedPreview=await call('monthly','/platform/import-preview',{qbankId:'smle-gs',questions:[{...duplicate,stem:`37. ${duplicate.stem.replaceAll(' ','  ')}`} ]});
    assert.equal(normalizedPreview.status,200);assert.ok(normalizedPreview.data.matches[0].length);
    assert.equal((await call('admin','/platform/economy-admin',{operation:'suspend-json',userId:'monthly',reason:'Manual suspension QA',days:9})).status,200);
    const status=(await call('monthly','/platform/json-import-status')).data;assert.equal(status.suspended,true);assert.ok(Math.abs(Date.parse(status.endsAt)-Date.now()-9*86400000)<5000);
    assert.equal((await call('monthly','/platform/import-preview',{qbankId:'smle-gs',questions:[duplicate]})).status,403);
    assert.equal((await call('admin','/platform/economy-admin',{operation:'remove-json-suspension',userId:'monthly',reason:'End QA suspension'})).status,200);
    assert.equal((await call('monthly','/platform/json-import-status')).data.suspended,false);
    assert.equal((await db.prepare("SELECT count(*) AS value FROM json_import_suspensions WHERE created_by='system' AND removed_at IS NULL").first()).value,0);
  });

  await t.test('Superadmin controls JSON availability and bounded scan batches without bypassing account limits', async () => {
    for (const uid of ['monthly', 'quarterly']) {
      assert.equal((await call(uid, '/platform/import-settings')).status, 403);
      assert.equal((await call(uid, '/platform/import-settings', { settings: { enabled: false, maxFileMegabytes: 50, previewBatchSize: 100 }, reason: 'Forbidden override' }, 'PUT')).status, 403);
    }
    const original = (await call('admin', '/platform/import-settings')).data;
    assert.equal(original.previewBatchSize, 50);
    for (const settings of [{ ...original, previewBatchSize: 1000 }, { ...original, maxFileMegabytes: 51 }, { ...original, enabled: 'yes' }])
      assert.equal((await call('admin', '/platform/import-settings', { settings, reason: 'Invalid settings' }, 'PUT')).status, 400);
    const changed = { enabled: false, maxFileMegabytes: 10, previewBatchSize: 100 };
    assert.equal((await call('admin', '/platform/import-settings', { settings: changed, reason: 'Pause for maintenance' }, 'PUT')).status, 200);
    assert.deepEqual((await call('monthly', '/platform/json-import-status')).data.settings, changed);
    assert.equal((await call('monthly', '/platform/import-preview', { qbankId: 'smle-gs', questions: [reusableQuestion] })).status, 403);
    const pausedImport = await call('monthly', '/platform/import', { ...forPlan('paused', 1), sourceFile: 'fixture.pdf' });
    assert.equal(pausedImport.status, 403);
    assert.equal(pausedImport.data.code, 'IMPORT_PAUSED');
    const hundred = Array.from({ length: 100 }, (_, i) => ({ ...reusableQuestion, stem: `Scan batch item ${i}` }));
    const preview = await call('admin', '/platform/import-preview', { qbankId: 'smle-gs', questions: hundred });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.equal(preview.data.matches.length, 100);
    assert.equal((await call('admin', '/platform/import-preview', { qbankId: 'smle-gs', questions: [...hundred, reusableQuestion] })).status, 400);
    assert.equal((await call('admin', '/platform/import-settings', { settings: original, reason: 'Restore import settings' }, 'PUT')).status, 200);
    assert.equal((await db.prepare("SELECT count(*) n FROM records WHERE type='auditLog' AND json_extract(payload,'$.action')='import_settings_updated'").first()).n, 2);
    const renamed = await call('admin', '/platform/import', { ...forPlan('renamed-source', 1), questions: [{ ...reusableQuestion, sourceFile: 'Reviewed source title', originalQuestionNumber: '17' }] });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
    assert.match(renamed.data.proposals[0].payload.sourceReference, /^Reviewed source title - p\.1 - Q\.17$/);
  });
  await t.test('source-only JSON imports and publishes without a fabricated page', async () => {
    const imported = await call('monthly', '/platform/import', {
      ...forPlan('source-only', 1),
      sourceFile: 'Unified source.pdf',
      questions: [{ ...reusableQuestion, stem: `Source optional page ${marker}`, sourceFile: undefined, sourcePage: undefined }],
    });
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    assert.equal(imported.data.proposals[0].payload.sourceFile, 'Unified source.pdf');
    assert.equal(Object.hasOwn(imported.data.proposals[0].payload, 'sourcePage'), false);
    assert.equal(imported.data.proposals[0].payload.sourceReference, 'Unified source.pdf');
    const reviewed = await call('admin', '/platform/bulk-review', { proposalIds: [imported.data.proposals[0].id], status: 'approved' });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
    const question = reviewed.data.updatedQuestions[0];
    assert.equal(question.sourceFile, 'Unified source.pdf');
    assert.equal(Object.hasOwn(question, 'sourcePage'), false);
    assert.equal(question.sourceReference, 'Unified source.pdf');
  });
});
