import {
  releaseMetadata,
  validateProductionBuiltConfigs,
  validateSourceConfigs,
} from './release-config.mjs';
import { npx, npm, run } from './process.mjs';

const target = process.argv[2] ?? 'all';
if (!['all', 'realtime', 'app'].includes(target))
  throw new Error('Choose all, realtime, or app.');
validateSourceConfigs();
const git = ['-c', `safe.directory=${process.cwd()}`];
if (run('git', [...git, 'status', '--porcelain'], { capture: true }))
  throw new Error(
    'Refusing to deploy: commit the reviewed changes and use a clean release checkout.',
  );
const sha = run('git', [...git, 'rev-parse', 'HEAD'], { capture: true });
const metadata = releaseMetadata();
// cloudflare:check ends with staging artifacts. Never deploy those by accident,
// or inherit CLOUDFLARE_ENV=staging from the caller's terminal.
const productionEnv = { ...process.env };
delete productionEnv.CLOUDFLARE_ENV;
run(npm, ['run', 'build'], { env: productionEnv });
validateProductionBuiltConfigs();
if (target !== 'app')
  run(
    npx,
    ['wrangler', 'deploy', '--config', 'dist/qraft_realtime/wrangler.json'],
    { env: productionEnv },
  );
if (target !== 'realtime')
  run(
    npx,
    [
      'wrangler',
      'deploy',
      '--config',
      'dist/server/wrangler.json',
      '--keep-vars',
      '--var',
      `BUILD_VERSION:${sha}`,
      '--var',
      `BUILD_TIMESTAMP:${new Date().toISOString()}`,
      '--var',
      `BUILD_SERVICE_WORKER:${metadata.serviceWorker}`,
      '--var',
      `BUILD_SCHEMA:${metadata.schema}`,
      '--var',
      `BUILD_PACKAGE_VERSION:${metadata.packageVersion}`,
    ],
    { env: productionEnv },
  );
console.log(`Deployed production ${target} from ${sha}.`);
