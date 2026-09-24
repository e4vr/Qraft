import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);

function trackedMigrations() {
  return execFileSync(
    'git',
    ['-c', `safe.directory=${rootPath}`, 'ls-files', '--', 'drizzle/*.sql'],
    { cwd: root, encoding: 'utf8' },
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => path.replaceAll('\\', '/'));
}

async function filesBelow(relativeDirectory, suffixes) {
  const directory = new URL(`${relativeDirectory}/`, root);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesBelow(relative, suffixes));
    else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) files.push(relative);
  }
  return files;
}

void test('referenced migration files are committed release inputs', async () => {
  const tracked = new Set(trackedMigrations());
  const inputs = [
    ...await filesBelow('tests', ['.mjs', '.js', '.ts']),
    ...await filesBelow('scripts', ['.mjs', '.js', '.ts']),
  ];
  const missing = [];
  for (const input of inputs) {
    const source = await readFile(new URL(input, root), 'utf8');
    for (const match of source.matchAll(/drizzle\/(\d{4}_[A-Za-z0-9_-]+\.sql)/g)) {
      const migration = `drizzle/${match[1]}`;
      if (!tracked.has(migration)) missing.push(`${input} -> ${migration}`);
    }
  }
  assert.deepEqual(missing, []);
});

void test('committed migrations have unique increasing numeric prefixes', () => {
  const migrations = trackedMigrations().sort();
  const prefixes = migrations.map((path) => Number(path.match(/\/(\d{4})_/)[1]));
  assert.equal(new Set(prefixes).size, prefixes.length);
  assert.deepEqual(prefixes, [...prefixes].sort((left, right) => left - right));
});
