import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

void test('resource cache is session-long, invalidation-driven, and single-flight', async () => {
  await mkdir('.ui-review', { recursive: true });
  const output = '.ui-review/resource-data-test.mjs';
  await build({
    entryPoints: ['lib/resource-data.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: output,
  });
  const resources = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  resources.clearResourceCache();
  resources.resetRequestMetrics();

  let loads = 0;
  let finish;
  const deferred = new Promise((resolve) => { finish = resolve; });
  const read = () => resources.readThrough({
    key: 'user|GET|/platform/reviewer-performance|',
    tags: ['reviewer-performance'],
    load: async () => {
      loads += 1;
      await deferred;
      return { total: 7 };
    },
  });
  const first = read();
  const duplicate = read();
  assert.equal(loads, 1);
  finish();
  assert.deepEqual(await Promise.all([first, duplicate]), [{ total: 7 }, { total: 7 }]);

  assert.deepEqual(await read(), { total: 7 });
  assert.equal(loads, 1, 'a page revisit must reuse the fresh resource');
  resources.invalidateTags(['unrelated-resource']);
  assert.deepEqual(await read(), { total: 7 });
  assert.equal(loads, 1, 'unrelated invalidations must not fetch');

  resources.invalidateTags(['reviewer-performance'], 'server');
  assert.equal(loads, 1, 'invalidation marks stale without eager fetching');
  const refreshed = await resources.readThrough({
    key: 'user|GET|/platform/reviewer-performance|',
    tags: ['reviewer-performance'],
    load: async () => {
      loads += 1;
      return { total: 8 };
    },
  });
  assert.deepEqual(refreshed, { total: 8 });
  assert.equal(loads, 2);

  const metrics = resources.getRequestMetrics();
  assert.equal(metrics.deduplicatedRequests, 1);
  assert.equal(metrics.duplicateRequests, 0);
  assert.equal(metrics.networkRequestsAvoided, 3);
});

void test('resource keys canonicalize query and JSON parameter order', async () => {
  const output = '.ui-review/resource-data-test.mjs';
  const resources = await import(`${pathToFileURL(output).href}?keys=${Date.now()}`);
  assert.equal(
    resources.resourceKey('/platform/quote?plan=pro&code=SAVE', 'POST', JSON.stringify({ plan: 'pro', code: 'SAVE' }), 'member'),
    resources.resourceKey('/platform/quote?code=SAVE&plan=pro', 'post', JSON.stringify({ code: 'SAVE', plan: 'pro' }), 'member'),
  );
});

void test('clearing a session prevents an older in-flight read from repopulating the cache', async () => {
  const output = '.ui-review/resource-data-test.mjs';
  const resources = await import(`${pathToFileURL(output).href}?generation=${Date.now()}`);
  let finish;
  const deferred = new Promise((resolve) => { finish = resolve; });
  let loads = 0;
  const read = () => resources.readThrough({
    key: 'account-a|GET|/auth/session|',
    tags: ['account'],
    load: async () => {
      loads += 1;
      if (loads === 1) await deferred;
      return { account: loads };
    },
  });
  const oldSessionRead = read();
  resources.clearResourceCache();
  finish();
  assert.deepEqual(await oldSessionRead, { account: 1 });
  assert.deepEqual(await read(), { account: 2 });
  assert.equal(loads, 2, 'the completed request from the cleared session must not be cached');
});
