import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { npx, run } from './process.mjs';
import { validateSourceConfigs } from './release-config.mjs';

const path = '.dev.vars.staging';
const required = ['ROOT_ADMIN_EMAIL', 'ROOT_ADMIN_SETUP_TOKEN', 'BACKUP_SIGNING_KEY'];

function parse() {
  if (!existsSync(path)) throw new Error(`Missing ${path}; run this script with "prepare" first.`);
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

validateSourceConfigs();
if (process.argv[2] === 'prepare') {
  if (!existsSync(path)) {
    const token = () => randomBytes(32).toString('base64url');
    writeFileSync(path, [
      'ROOT_ADMIN_EMAIL=admin@staging.qraft.invalid',
      `ROOT_ADMIN_SETUP_TOKEN=${token()}`,
      `BACKUP_SIGNING_KEY=${token()}`,
      `QRAFT_STAGING_SEED_PASSWORD=${token()}`,
      '',
    ].join('\n'), { mode: 0o600, flag: 'wx' });
  }
  const values = parse();
  for (const key of [...required, 'QRAFT_STAGING_SEED_PASSWORD'])
    if (!values[key]) throw new Error(`${key} is missing from ${path}.`);
  console.log(`Prepared ignored local staging credentials in ${path}; no values were printed.`);
} else if (process.argv[2] === 'apply') {
  const values = parse();
  for (const key of required) {
    if (!values[key]) throw new Error(`${key} is missing from ${path}.`);
    run(npx, ['wrangler', 'secret', 'put', key, '--env', 'staging', '--config', 'wrangler.jsonc'], { input: `${values[key]}\n` });
  }
  console.log('Applied required secrets to qraft-staging; no values were printed.');
} else {
  throw new Error('Usage: node scripts/staging-secrets.mjs <prepare|apply>');
}
