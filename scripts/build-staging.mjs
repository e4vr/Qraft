import { validateBuiltConfigs, validateSourceConfigs } from './release-config.mjs';
import { npm, run } from './process.mjs';

validateSourceConfigs();
run(npm, ['run', 'build'], { env: { ...process.env, CLOUDFLARE_ENV: 'staging' } });
validateBuiltConfigs();
console.log('Staging artifact bindings verified.');
