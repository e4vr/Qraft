import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { unstable_splitSqlQuery } from 'wrangler';

void test('Wrangler splits every migration into complete SQLite statements', () => {
  const statements = readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort().flatMap(name =>
    unstable_splitSqlQuery(readFileSync(`drizzle/${name}`, 'utf8')).map(sql => ({ name, sql })),
  );
  const result = spawnSync('python', ['-c', `
import json,sqlite3,sys
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for item in json.load(sys.stdin):
 try:
  db.execute(item['sql'])
 except sqlite3.Error as error:
  raise RuntimeError(item['name']+': '+str(error)+'; statement starts: '+item['sql'][:100]) from error
assert db.execute('SELECT count(*) FROM question_registry').fetchone()[0]==217
assert not db.execute('PRAGMA foreign_key_check').fetchall()
db.close()
`], { input: JSON.stringify(statements), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
