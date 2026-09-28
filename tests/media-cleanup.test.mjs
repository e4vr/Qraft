import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

void test('media cleanup retries object/DB partial failures without losing live images or subtracting storage twice', async t => {
  await mkdir('.ui-review', { recursive: true });
  await build({ stdin: { contents: `import {cleanPendingMedia} from './features/media/server/media-cleanup'; export default {async fetch(){await cleanPendingMedia();return Response.json({ok:true})}}`, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], outfile: '.ui-review/media-cleanup-worker.mjs' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: '.ui-review/media-cleanup-worker.mjs', compatibilityDate: '2026-09-07', d1Databases: { DB: 'cleanup-test' }, r2Buckets: { ASSETS: 'cleanup-assets' } }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const assets = await mf.getR2Bucket('ASSETS');
  for (const sql of [
    'CREATE TABLE media(key TEXT PRIMARY KEY,storage_key TEXT,provider TEXT,size INTEGER,status TEXT,updated_at TEXT)',
    'CREATE TABLE counters(id TEXT PRIMARY KEY,value INTEGER,updated_at TEXT)',
    "INSERT INTO media VALUES('retired','retired','r2',15,'delete_pending','2026-01-01'),('live','live','r2',20,'ready','2026-01-01')",
    "INSERT INTO counters VALUES('r2-storage-bytes',35,'2026-01-01')",
    "CREATE TRIGGER fail_metadata_cleanup BEFORE DELETE ON media BEGIN SELECT RAISE(ABORT,'CLEANUP_FAILURE_FIXTURE'); END",
  ]) await db.prepare(sql).run();
  await assets.put('retired', 'retired-content');
  await assets.put('live', 'protected-content');
  assert.equal((await mf.dispatchFetch('https://cleanup.test/')).status, 200);
  assert.equal(await assets.head('retired'), null, 'object removal happened before the injected DB failure');
  assert.equal((await db.prepare("SELECT status FROM media WHERE key='retired'").first()).status, 'delete_pending');
  assert.equal((await db.prepare("SELECT value FROM counters WHERE id='r2-storage-bytes'").first()).value, 35, 'failed transaction must retain the counter');
  await db.prepare('DROP TRIGGER fail_metadata_cleanup').run();
  await Promise.all([mf.dispatchFetch('https://cleanup.test/'), mf.dispatchFetch('https://cleanup.test/')]);
  assert.equal(await db.prepare("SELECT status FROM media WHERE key='retired'").first(), null);
  assert.equal((await db.prepare("SELECT value FROM counters WHERE id='r2-storage-bytes'").first()).value, 20);
  await mf.dispatchFetch('https://cleanup.test/');
  assert.equal((await db.prepare("SELECT value FROM counters WHERE id='r2-storage-bytes'").first()).value, 20);
  assert.ok(await assets.head('live'));
  assert.equal((await db.prepare("SELECT status FROM media WHERE key='live'").first()).status, 'ready');
});
