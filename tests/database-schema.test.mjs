import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { checkDatabaseSchema } from '../scripts/database-schema.mjs';

void test('SQL migrations and the declarative schema agree on tables, columns, keys and indexes', async () => {
  const result = await checkDatabaseSchema();
  assert.equal(result.ok, true);
  assert.ok(result.tables > 40);
  assert.equal(result.sqlManagedTriggers, 22);
});
void test('automatic generation refuses the obsolete journal instead of creating destructive migrations', () => {
  const result = spawnSync(process.execPath, ['scripts/database-schema.mjs', 'generate'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /historical Drizzle journal/);
});
