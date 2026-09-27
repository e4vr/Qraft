import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

void test('Superadmin has no JSON question cap while Pro and Unlimited retain their plan caps', async (t) => {
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
  for (const uid of ['admin', 'pro', 'unlimited']) {
    const now = new Date().toISOString();
    const profile = {
      uid, email: `${uid}@example.test`, displayName: uid,
      tier: uid === 'admin' ? 'free' : uid,
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
  assert.equal((await call('pro', '/platform/json-import-status')).status, 200);
  assert.equal((await call('unlimited', '/platform/json-import-status')).status, 200);
  assert.equal((await call('pro', '/platform/import', forPlan('pro', 1))).status, 200);
  assert.equal((await call('unlimited', '/platform/import', forPlan('unlimited', 1))).status, 200);
  assert.equal((await call('pro', '/platform/import', forPlan('pro', 76))).status, 403);
  assert.equal((await call('unlimited', '/platform/import', forPlan('unlimited', 151))).status, 403);
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
  assert.equal(repeat.data.successful, 0);
  assert.equal(repeat.data.skippedDuplicates, 201);
  const newQuestion = { ...request.questions[0], stem: `A distinct clinical question ${marker}` };
  const sameName = await call('admin', '/platform/import', {
    ...request,
    requestId: randomUUID(),
    fileHash: createHash('sha256').update(`updated-${marker}`).digest('hex'),
    questions: [request.questions[0], newQuestion],
  });
  assert.equal(sameName.status, 200, JSON.stringify(sameName.data));
  assert.equal(sameName.data.successful, 1);
  assert.equal(sameName.data.skippedDuplicates, 1);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM duplicate_attempts WHERE user_id='admin' AND kind='file'").first()).count, 0);

  const now = new Date().toISOString();
  let recreatedBank = {
    id: `recreated-bank-${randomUUID()}`,
    name: 'Recreated import bank',
    shortName: 'RECREATE',
    description: 'Verifies that deleted JSON imports can be uploaded again.',
    createdAt: now,
    createdById: 'pro',
    createdByName: 'pro',
    ownerId: 'pro',
    ownerName: 'pro',
    visibility: 'public',
    shareEnabled: false,
    reviewerIds: [],
    viewerIds: [],
    archived: false,
    essential: false,
  };
  const saveBank = () => call('pro', '/collaboration', {
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

  const removeBank = await call('admin', '/collaboration', {
    operations: [{ collection: 'qbanks', id: recreatedBank.id, type: 'delete' }],
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

  assert.equal((await call('pro', '/platform/json-imports')).status, 403);
  const rejectedPlanImport = await call(
    'admin',
    `/platform/json-imports?search=${encodeURIComponent(`pro-76-${marker}.json`)}`,
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
});
