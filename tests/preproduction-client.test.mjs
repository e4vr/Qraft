import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['lib/api-client.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const client = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

void test('API errors provide actionable English messages without claiming unsaved data is safe', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(client.api('/contact', { method: 'POST', body: '{}' }), error => error instanceof client.ApiError && error.status === 0 && /Check your connection/.test(error.message));
  globalThis.fetch = async () => new Response('<html>Unavailable</html>', { status: 503 });
  await assert.rejects(client.api('/contact', { method: 'POST', body: '{}' }), error => error.status === 503 && !/saved locally/.test(error.message));
  globalThis.fetch = async () => new Response('Too many requests', { status: 429, headers: { 'retry-after': '7' } });
  await assert.rejects(client.api('/contact', { method: 'POST', body: '{}' }), error => error.status === 429 && error.retryAfterMs === 7000 && /wait/.test(error.message));
  const aborted = new DOMException('Cancelled', 'AbortError');
  globalThis.fetch = async () => { throw aborted; };
  await assert.rejects(client.api('/contact', { method: 'POST', body: '{}' }), error => error === aborted);
});

void test('an unreadable successful mutation is not acknowledged or cached', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  client.clearResourceCache();
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(requests === 1 ? '{' : '{"ok":true}'); };
  await assert.rejects(client.api('/contact', { method: 'POST', body: '{}' }), error => error.status === 502);
  assert.deepEqual(await client.api('/contact', { method: 'POST', body: '{}' }), { ok: true });
  assert.equal(requests, 2);
});
