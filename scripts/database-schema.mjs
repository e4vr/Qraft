import { build } from 'esbuild';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function checkDatabaseSchema() {
  const built = await build({ entryPoints: ['db/schema.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
  const schema = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const snapshot = await generateSQLiteDrizzleJson(schema);
  const statements = (await generateSQLiteMigration(await generateSQLiteDrizzleJson({}), snapshot))
    .filter(statement => !/^CREATE (UNIQUE )?INDEX /i.test(statement));
  // drizzle-kit 0.31 splits commas inside SQLite expression indexes while
  // emitting DDL. Reconstruct indexes from its structured snapshot, only in
  // the disposable comparison DB; never use this as a migration generator.
  const quote = name => `"${name.replaceAll('"', '""')}"`;
  for (const table of Object.values(snapshot.tables))
    for (const index of Object.values(table.indexes)) {
      const terms = index.columns.map(column => table.columns[column] ? quote(column) : column);
      statements.push(`CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quote(index.name)} ON ${quote(table.name)} (${terms.join(',')})${index.where ? ` WHERE ${index.where}` : ''};`);
    }
  const check = spawnSync('python', ['scripts/check-database-schema.py'], { input: JSON.stringify(statements), encoding: 'utf8' });
  if (check.error) throw check.error;
  if (check.status !== 0) throw new Error(check.stderr || check.stdout || 'Schema comparison failed.');
  return JSON.parse(check.stdout);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] === 'generate') {
    console.error('Automatic generation is disabled: reviewed SQL migrations are authoritative. The historical Drizzle journal is not a current baseline. Run npm run db:check; add a numbered SQL migration with its tests. See docs/DATABASE_SCHEMA_POLICY.md.');
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(await checkDatabaseSchema(), null, 2));
  }
}
