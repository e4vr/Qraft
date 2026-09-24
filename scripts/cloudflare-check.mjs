import { rmSync } from 'node:fs';
import { validateBuiltConfigs, validateProductionBuiltConfigs, validateSourceConfigs } from './release-config.mjs';
import { npm, npx, run } from './process.mjs';

validateSourceConfigs();
rmSync('.wrangler/dry-run', { recursive: true, force: true });

run(npm, ['run', 'build']);
validateProductionBuiltConfigs();
run(npx, ['wrangler', 'deploy', '--dry-run', '--config', 'dist/qraft_realtime/wrangler.json', '--outdir', '.wrangler/dry-run/realtime-production']);
run(npx, ['wrangler', 'deploy', '--dry-run', '--config', 'dist/server/wrangler.json', '--outdir', '.wrangler/dry-run/app-production']);

run(npm, ['run', 'build:staging']);
validateBuiltConfigs();
run(npx, ['wrangler', 'deploy', '--dry-run', '--config', 'dist/qraft_realtime/wrangler.json', '--outdir', '.wrangler/dry-run/realtime-staging']);
run(npx, ['wrangler', 'deploy', '--dry-run', '--config', 'dist/server/wrangler.json', '--outdir', '.wrangler/dry-run/app-staging']);
console.log('Production and staging Cloudflare configurations passed dry-run validation.');
