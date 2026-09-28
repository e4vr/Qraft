import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  validateProductionBuiltConfigs,
  validateSourceConfigs,
} from '../scripts/release-config.mjs';

void test('production release rejects staging database and realtime bindings', async () => {
  const { app, realtime } = validateSourceConfigs();
  await mkdir('.ui-review/production-config', { recursive: true });
  const appPath = '.ui-review/production-config/app.json';
  const realtimePath = '.ui-review/production-config/realtime.json';
  await writeFile(realtimePath, JSON.stringify(realtime));
  await writeFile(appPath, JSON.stringify(app));
  assert.doesNotThrow(() =>
    validateProductionBuiltConfigs(appPath, realtimePath),
  );
  const wrongDatabase = structuredClone(app);
  wrongDatabase.d1_databases = app.env.staging.d1_databases;
  await writeFile(appPath, JSON.stringify(wrongDatabase));
  assert.throws(
    () => validateProductionBuiltConfigs(appPath, realtimePath),
    /D1/,
  );
  const wrongRealtime = structuredClone(app);
  wrongRealtime.durable_objects = app.env.staging.durable_objects;
  await writeFile(appPath, JSON.stringify(wrongRealtime));
  assert.throws(
    () => validateProductionBuiltConfigs(appPath, realtimePath),
    /realtime service/,
  );
});
