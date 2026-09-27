import { releaseResources, validateSourceConfigs } from './release-config.mjs';
import { npx, run } from './process.mjs';

validateSourceConfigs();
if (process.argv[2] !== 'status' && process.argv[2] !== 'migrate')
  throw new Error('Usage: node scripts/staging-database.mjs <status|migrate>');
const base = ['wrangler', 'd1', 'migrations'];
const target = [releaseResources.staging.database, '--remote', '--env', 'staging', '--config', 'wrangler.jsonc'];
run(npx, [...base, 'list', ...target]);
if (process.argv[2] === 'migrate') {
  run(npx, [...base, 'apply', ...target]);
  run(npx, [...base, 'list', ...target]);
}
