import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseMetadata, releaseResources, validateSourceConfigs } from '../scripts/release-config.mjs';

void test('staging resources are isolated from production and have no cron', () => {
  const { app } = validateSourceConfigs();
  const staging = app.env.staging;
  assert.notEqual(releaseResources.staging.databaseId, releaseResources.production.databaseId);
  assert.notEqual(releaseResources.staging.bucket, releaseResources.production.bucket);
  assert.notEqual(releaseResources.staging.app, releaseResources.production.app);
  assert.deepEqual(staging.triggers.crons, []);
});

void test('staging exposes build identity without storing release secrets', () => {
  const { app } = validateSourceConfigs();
  assert.equal(app.env.staging.vars.BUILD_VERSION, 'unset');
  assert.equal(app.env.staging.vars.BUILD_TIMESTAMP, 'unset');
  for (const secret of ['ROOT_ADMIN_SETUP_TOKEN', 'BACKUP_SIGNING_KEY', 'IMAGEKIT_PRIVATE_KEY'])
    assert.equal(Object.hasOwn(app.env.staging.vars, secret), false);
});

void test('release metadata identifies current PWA and schema inputs', () => {
  const metadata = releaseMetadata();
  assert.equal(metadata.serviceWorker, 'v4.7.14');
  assert.equal(metadata.schema, '0035_unified_subscription_access.sql');
  assert.equal(metadata.packageVersion, '1.2.0');
});
