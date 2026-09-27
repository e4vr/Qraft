import { releaseMetadata, validateBuiltConfigs, validateSourceConfigs } from './release-config.mjs';
import { npx, npm, run } from './process.mjs';

validateSourceConfigs();
const gitSafety = [`safe.directory=${process.cwd()}`];
const dirty = run('git', ['-c', ...gitSafety, 'status', '--porcelain'], { capture: true });
if (dirty) throw new Error('Refusing to deploy: the release worktree is not clean.');
const sha = run('git', ['-c', ...gitSafety, 'rev-parse', 'HEAD'], { capture: true });
const timestamp = new Date().toISOString();
const metadata = releaseMetadata();

run(npm, ['run', 'build:staging']);
validateBuiltConfigs();
run(npx, ['wrangler', 'deploy', '--config', 'dist/qraft_realtime/wrangler.json']);
run(npx, [
  'wrangler', 'deploy', '--config', 'dist/server/wrangler.json',
  '--var', `BUILD_VERSION:${sha}`, '--var', `BUILD_TIMESTAMP:${timestamp}`,
  '--var', `BUILD_SERVICE_WORKER:${metadata.serviceWorker}`,
  '--var', `BUILD_SCHEMA:${metadata.schema}`,
  '--var', `BUILD_PACKAGE_VERSION:${metadata.packageVersion}`,
]);
console.log(`Deployed staging commit ${sha}.`);
