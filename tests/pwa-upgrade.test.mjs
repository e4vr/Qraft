import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

void test('v4.6.0 service worker replaces only Qraft shell caches and avoids mixed static assets', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const listeners = new Map();
  const buckets = new Map();
  const deleted = [];
  const messages = [];
  let claimed = 0;
  let skipped = 0;
  let fetches = 0;
  const makeCache = (name) => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    const bucket = buckets.get(name);
    return {
      async addAll(paths) { for (const path of paths) bucket.set(path, new Response(`cached:${name}:${path}`)); },
      async match(request) { return bucket.get(typeof request === 'string' ? request : new URL(request.url).pathname)?.clone(); },
      async put(request, response) { bucket.set(new URL(request.url).pathname, response.clone()); },
    };
  };
  makeCache('qraft-shell-v3.0.0');
  buckets.get('qraft-shell-v3.0.0').set('/chunks/current.js', new Response('old script'));
  makeCache('unrelated-cache');
  const caches = {
    async open(name) { return makeCache(name); },
    async keys() { return [...buckets.keys()]; },
    async delete(name) { deleted.push(name); return buckets.delete(name); },
    async match(path) { for (const cache of buckets.values()) if (cache.has(path)) return cache.get(path).clone(); },
  };
  const self = {
    location: { origin: 'https://staging.test' },
    addEventListener(name, handler) { listeners.set(name, handler); },
    skipWaiting() { skipped++; },
    clients: {
      claim() { claimed++; },
      async matchAll() { return [{ postMessage(value) { messages.push(value); } }]; },
    },
  };
  vm.runInNewContext(source, {
    self, caches, URL, Response,
    async fetch(request) { fetches++; return new Response(`new:${new URL(request.url).pathname}`); },
  });
  const lifecycleEvent = () => ({ waitUntil(promise) { this.promise = promise; } });
  const install = lifecycleEvent();
  listeners.get('install')(install);
  await install.promise;
  assert.equal(skipped, 1);
  assert.ok(buckets.get('qraft-shell-v4.6.0').has('/qraft-mark.svg'));

  const activate = lifecycleEvent();
  listeners.get('activate')(activate);
  await activate.promise;
  assert.deepEqual(deleted, ['qraft-shell-v3.0.0']);
  assert.ok(buckets.has('unrelated-cache'));
  assert.equal(claimed, 1);
  assert.equal(messages[0].type, 'QRAFT_SW_ACTIVATED');

  const request = { url: 'https://staging.test/chunks/current.js', method: 'GET', destination: 'script' };
  const fetchEvent = () => ({ request, respondWith(promise) { this.promise = promise; } });
  const first = fetchEvent();
  listeners.get('fetch')(first);
  assert.equal(await (await first.promise).text(), 'new:/chunks/current.js');
  const second = fetchEvent();
  listeners.get('fetch')(second);
  assert.equal(await (await second.promise).text(), 'new:/chunks/current.js');
  assert.equal(fetches, 1, 'v4 cache hit does not refetch or return v3 script');

  const api = { request: { ...request, url: 'https://staging.test/api/cloudflare/state' }, respondWith() { throw new Error('API must bypass SW'); } };
  listeners.get('fetch')(api);
});
