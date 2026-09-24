import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import test from 'node:test';

const root = new URL('../', import.meta.url);

void test('collaboration reads use existing indexes without changing row order', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  assert.match(
    server,
    /FROM records INDEXED BY idx_records_type_id[\s\S]*WHERE type IN \(\$\{placeholders\}\) ORDER BY rowid/,
  );
  assert.match(
    server,
    /FROM records INDEXED BY idx_records_qbank_type[\s\S]*qbank_id IN[\s\S]*UNION ALL[\s\S]*qbank_id IS NULL[\s\S]*ORDER BY source_rowid/,
  );

  const script = String.raw`
import json, sqlite3, sys
db = sqlite3.connect(':memory:')
db.executescript('''
CREATE TABLE records (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  qbank_id TEXT,
  payload TEXT NOT NULL,
  PRIMARY KEY(type,id)
);
CREATE INDEX idx_records_qbank_type ON records(qbank_id,type);
''')
rows = [
  ('system','global',None,'{}'),
  ('sharedQuestions','q-2','bank-b','{"n":2}'),
  ('qbanks','bank-a','bank-a','{"n":3}'),
  ('sharedQuestions','q-1','bank-a','{"n":4}'),
  ('qbankMemberships','m-1','bank-a','{"n":5}'),
  ('sharedQuestions','q-global',None,'{"n":6}'),
]
db.executemany('INSERT INTO records VALUES (?,?,?,?)', rows)
types = ('sharedQuestions','qbankMemberships','system')
current = db.execute('''
  SELECT type,id,payload FROM records NOT INDEXED
  WHERE (qbank_id IS NULL OR qbank_id IN (?))
    AND type IN (?,?,?)
''', ('bank-a', *types)).fetchall()
optimized = db.execute('''
  SELECT type,id,payload FROM (
    SELECT rowid AS source_rowid,type,id,payload
    FROM records INDEXED BY idx_records_qbank_type
    WHERE qbank_id IN (?) AND type IN (?,?,?)
    UNION ALL
    SELECT rowid AS source_rowid,type,id,payload
    FROM records INDEXED BY idx_records_qbank_type
    WHERE qbank_id IS NULL AND type IN (?,?,?)
  ) ORDER BY source_rowid
''', ('bank-a', *types, *types)).fetchall()
plan = db.execute('''EXPLAIN QUERY PLAN
  SELECT type,id,payload FROM (
    SELECT rowid AS source_rowid,type,id,payload
    FROM records INDEXED BY idx_records_qbank_type
    WHERE qbank_id IN (?) AND type IN (?,?,?)
    UNION ALL
    SELECT rowid AS source_rowid,type,id,payload
    FROM records INDEXED BY idx_records_qbank_type
    WHERE qbank_id IS NULL AND type IN (?,?,?)
  ) ORDER BY source_rowid
''', ('bank-a', *types, *types)).fetchall()
print(json.dumps({'current': current, 'optimized': optimized, 'plan': plan}))
`;
  const run = spawnSync('python', ['-c', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  const result = JSON.parse(run.stdout);
  assert.deepEqual(result.optimized, result.current);
  assert.ok(
    result.plan.filter((entry) => entry[3].includes('idx_records_qbank_type'))
      .length >= 2,
    JSON.stringify(result.plan),
  );
  assert.equal(
    result.plan.some((entry) => entry[3] === 'SCAN records'),
    false,
    JSON.stringify(result.plan),
  );
});

void test('one reconnect wave produces one reconciliation', async () => {
  await mkdir('.ui-review', { recursive: true });
  const output = '.ui-review/realtime-client-performance-test.mjs';
  await build({
    entryPoints: ['lib/realtime-client.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: output,
  });
  const { createReconnectCoordinator } = await import(
    `${pathToFileURL(output).href}?test=${Date.now()}`
  );
  let reconciliations = 0;
  const coordinator = createReconnectCoordinator(() => {
    reconciliations += 1;
  });

  coordinator.disconnected('user:1');
  coordinator.disconnected('catalog');
  coordinator.disconnected('bank:1');
  coordinator.connected('catalog');
  coordinator.connected('user:1');
  coordinator.connected('bank:1');
  assert.equal(reconciliations, 1);

  coordinator.disconnected('bank:1');
  coordinator.disconnected('bank:1');
  coordinator.connected('bank:1');
  assert.equal(reconciliations, 2, 'a later recovery remains observable');
});
