import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

void test('constitutional 150-question server import safety boundary', async (t) => {
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
    questions: Array.from({ length: 151 }, (_, index) => ({
      stem: `Unique clinical import fixture ${marker} question ${index}`,
      options: [`Answer ${index}`, `Alternative ${index}`],
      answer: 0, specialty: 'General', topic: 'Import QA',
      sourceFile: 'fixture.pdf', sourcePage: index + 1,
    })),
  };
  const _forPlan = (plan, count) => ({
    ...request,
    requestId: randomUUID(),
    fileName: `${plan}-${count}-${marker}.json`,
    fileHash: createHash('sha256').update(`${plan}-${count}-${marker}`).digest('hex'),
    questions: request.questions.slice(0, count).map((question) => ({
      ...question,
      stem: `${plan} ${question.stem}`,
    })),
  });
  const imported = await call('admin', '/platform/import', request);
  const saved = await db.prepare("SELECT count(*) AS count FROM records WHERE type='questionProposals' AND owner_id='admin' AND json_extract(payload,'$.importBatchId')=?").bind(request.requestId).first();
  console.log(JSON.stringify({evidence:'LOCAL DETERMINISTIC ENDPOINT TEST',requestedQuestions:request.questions.length,status:imported.status,successful:imported.data.successful,persistedProposals:saved.count,constitutionalMaximum:150}));
  assert.equal(imported.status >= 400, true, 'Server must reject an oversized operation regardless of administrator role');
});
