import { readFileSync, readdirSync } from 'node:fs';

export function releaseMetadata() {
  const serviceWorker = readFileSync('public/sw.js', 'utf8').match(/qraft-shell-(v[\d.]+)/)?.[1];
  const schema = readdirSync('drizzle').filter(name => /^\d+.*\.sql$/.test(name)).sort().at(-1);
  const packageVersion = readJson('package.json').version;
  if (!serviceWorker || !schema || !packageVersion) throw new Error('Missing release metadata.');
  return { serviceWorker, schema, packageVersion };
}

export const releaseResources = Object.freeze({
  production: Object.freeze({
    app: 'qraft', realtime: 'qraft-realtime', database: 'qraft-qbank',
    databaseId: '7f288176-8ed7-490c-bd44-d6e78577413d', bucket: 'qraft-assets',
  }),
  staging: Object.freeze({
    app: 'qraft-staging', realtime: 'qraft-realtime-staging', database: 'qraft-qbank-staging',
    databaseId: 'f788be6b-f763-49e8-840b-4c107c7e5874', bucket: 'qraft-assets-staging',
  }),
});

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual ?? '<missing>'}`);
}

export function validateSourceConfigs(appPath = 'wrangler.jsonc', realtimePath = 'wrangler.realtime.jsonc') {
  const app = readJson(appPath);
  const realtime = readJson(realtimePath);
  const staging = app.env?.staging;
  const stagingRealtime = realtime.env?.staging;
  if (!staging || !stagingRealtime) throw new Error('Both Workers must define env.staging.');

  equal(app.name, releaseResources.production.app, 'production app Worker');
  equal(app.d1_databases?.[0]?.database_id, releaseResources.production.databaseId, 'production D1 id');
  equal(app.r2_buckets?.[0]?.bucket_name, releaseResources.production.bucket, 'production R2 bucket');
  equal(realtime.name, releaseResources.production.realtime, 'production realtime Worker');
  equal(app.analytics_engine_datasets?.[0]?.dataset, 'qraft_usage', 'production analytics dataset');

  equal(staging.name, releaseResources.staging.app, 'staging app Worker');
  equal(staging.d1_databases?.[0]?.database_name, releaseResources.staging.database, 'staging D1 name');
  equal(staging.d1_databases?.[0]?.database_id, releaseResources.staging.databaseId, 'staging D1 id');
  equal(staging.r2_buckets?.[0]?.bucket_name, releaseResources.staging.bucket, 'staging R2 bucket');
  equal(staging.durable_objects?.bindings?.[0]?.script_name, releaseResources.staging.realtime, 'staging realtime service');
  equal(stagingRealtime.name, releaseResources.staging.realtime, 'staging realtime Worker');
  equal(staging.analytics_engine_datasets?.[0]?.dataset, 'qraft_usage_staging', 'staging analytics dataset');
  equal(staging.vars?.MONITORING_WORKER_NAME, releaseResources.staging.app, 'staging metrics Worker');
  equal(staging.vars?.MONITORING_D1_ID, releaseResources.staging.databaseId, 'staging metrics D1');
  equal(staging.vars?.MONITORING_R2_BUCKET, releaseResources.staging.bucket, 'staging metrics R2');
  if (staging.workers_dev !== true || stagingRealtime.workers_dev !== true)
    throw new Error('Staging Workers must use workers.dev hostnames.');
  if ((staging.triggers?.crons ?? []).length) throw new Error('Staging must not schedule cron triggers.');
  const namespaces = staging.ratelimits?.map(item => item.namespace_id) ?? [];
  if (namespaces.length !== 3 || namespaces.some(id => ['1001', '1002', '1003'].includes(id)))
    throw new Error('Staging rate-limit namespaces must be complete and distinct from production.');
  return { app, realtime };
}

export function validateBuiltConfigs(appPath = 'dist/server/wrangler.json', realtimePath = 'dist/qraft_realtime/wrangler.json') {
  const app = readJson(appPath);
  const realtime = readJson(realtimePath);
  equal(app.name, releaseResources.staging.app, 'built app Worker');
  equal(app.d1_databases?.[0]?.database_name, releaseResources.staging.database, 'built D1 name');
  equal(app.d1_databases?.[0]?.database_id, releaseResources.staging.databaseId, 'built D1 id');
  equal(app.r2_buckets?.[0]?.bucket_name, releaseResources.staging.bucket, 'built R2 bucket');
  equal(app.services?.[0]?.service ?? app.durable_objects?.bindings?.[0]?.script_name, releaseResources.staging.realtime, 'built realtime service');
  equal(realtime.name, releaseResources.staging.realtime, 'built realtime Worker');
  equal(app.analytics_engine_datasets?.[0]?.dataset, 'qraft_usage_staging', 'built analytics dataset');
  equal(app.vars?.MONITORING_WORKER_NAME, releaseResources.staging.app, 'built metrics Worker');
  equal(app.vars?.MONITORING_D1_ID, releaseResources.staging.databaseId, 'built metrics D1');
  equal(app.vars?.MONITORING_R2_BUCKET, releaseResources.staging.bucket, 'built metrics R2');
  return { app, realtime };
}

export function validateProductionBuiltConfigs(appPath = 'dist/server/wrangler.json', realtimePath = 'dist/qraft_realtime/wrangler.json') {
  const app = readJson(appPath);
  const realtime = readJson(realtimePath);
  equal(app.name, releaseResources.production.app, 'built production app Worker');
  equal(app.d1_databases?.[0]?.database_id, releaseResources.production.databaseId, 'built production D1 id');
  equal(app.r2_buckets?.[0]?.bucket_name, releaseResources.production.bucket, 'built production R2 bucket');
  equal(realtime.name, releaseResources.production.realtime, 'built production realtime Worker');
  equal(app.analytics_engine_datasets?.[0]?.dataset, 'qraft_usage', 'built production analytics dataset');
  return { app, realtime };
}
