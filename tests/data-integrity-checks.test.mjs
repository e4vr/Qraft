import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

void test('Phase 2 data-integrity checks are read-only', async () => {
  const source = await readFile('scripts/data-integrity-checks.sql', 'utf8');
  const executable = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(
    executable,
    /\b(?:insert|update|delete|replace|alter|drop|create|attach|detach|vacuum)\b/i,
  );
  const statements = executable
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.ok(statements.length >= 10);
  for (const statement of statements)
    assert.match(statement, /^(?:select|with|pragma)\b/i);
});
