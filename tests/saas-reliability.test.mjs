import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { indexedDB } from 'fake-indexeddb';

globalThis.indexedDB = indexedDB;
const compiled = await build({
  stdin: {
    contents: `
export * from './server/http/rate-limit';
export * from './server/http/request';
export * from './lib/resource-data';
export * from './lib/api-client';
export * from './lib/local-db';
export * from './features/state/client/state-sync-client';
export * from './lib/tab-sync';
export * from './lib/realtime-client';
export { initialAppState } from './lib/medguard-types';
`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const m = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

void test('100 authenticated users behind one IP retain independent request budgets', async () => {
  const counts = new Map();
  const binding = {
    async limit({ key }) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= 3 };
    },
  };
  const request = new Request('https://qraft.test/api/cloudflare/state', {
    headers: { 'cf-connecting-ip': '192.0.2.1' },
  });
  await Promise.all(
    Array.from({ length: 100 }, async (_, i) => {
      for (let n = 0; n < 3; n++)
        await m.enforceRequestLimits(
          request,
          ['state'],
          { API_RATE_LIMITER: binding },
          async () => ({ uid: `user-${i}` }),
        );
    }),
  );
  assert.equal(counts.size, 100);
  await assert.rejects(
    m.enforceRequestLimits(
      request,
      ['state'],
      { API_RATE_LIMITER: binding },
      async () => ({ uid: 'user-0' }),
    ),
    (error) =>
      error.status === 429 && error.headers.get('retry-after') === '60',
  );
  // Forged cookies do not create authenticated buckets.
  for (let n = 0; n < 3; n++)
    await m.enforceRequestLimits(
      request,
      ['state'],
      { API_RATE_LIMITER: binding },
      async () => undefined,
    );
  await assert.rejects(
    m.enforceRequestLimits(
      request,
      ['state'],
      { API_RATE_LIMITER: binding },
      async () => undefined,
    ),
    (error) => error.status === 429,
  );
});

void test('authentication is throttled before account resolution, regardless of supplied identity', async () => {
  let resolved = false;
  const request = new Request('https://qraft.test/api/cloudflare/auth/login', {
    method: 'POST',
  });
  await assert.rejects(
    m.enforceRequestLimits(
      request,
      ['auth', 'login'],
      {
        AUTH_RATE_LIMITER: {
          async limit() {
            return { success: false };
          },
        },
      },
      async () => {
        resolved = true;
        return { uid: 'forged' };
      },
    ),
    (error) => error.status === 429,
  );
  assert.equal(resolved, false);
});

void test('invalidation during a first read cannot mark stale data fresh', async () => {
  m.clearResourceCache();
  let finish;
  const options = {
    key: 'question',
    tags: ['questions'],
    load: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  };
  const pending = m.readThrough(options);
  m.invalidateTags(['questions'], 'server');
  finish({ revision: 1 });
  await pending;
  let reads = 0;
  const value = await m.readThrough({
    ...options,
    load: async () => {
      reads++;
      return { revision: 2 };
    },
  });
  assert.equal(reads, 1);
  assert.equal(value.revision, 2);
});

void test('a slow read cannot overwrite an authoritative mutation patch', async () => {
  m.clearResourceCache();
  let finish;
  const options = {
    key: 'state',
    tags: ['state'],
    load: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  };
  const pending = m.readThrough(options);
  m.writeCache('state', { revision: 2 }, ['state']);
  finish({ revision: 1 });
  await pending;
  assert.deepEqual(await m.readThrough(options), { revision: 2 });
});

void test('malformed JSON, cross-site requests and streamed oversized input are rejected', async () => {
  for (const body of ['null', '[]', '1', '"text"', '{'])
    await assert.rejects(
      m.readJson(new Request('https://qraft.test', { method: 'POST', body })),
      (error) => error.status === 400,
    );
  const request = new Request('https://qraft.test', {
    method: 'POST',
    body: JSON.stringify({ note: 'ا'.repeat(30) }),
  });
  await assert.rejects(
    m.readJson(request, 20),
    (error) => error.status === 413,
  );
  assert.throws(
    () =>
      m.assertSameOrigin(
        new Request('https://qraft.test', {
          headers: { 'sec-fetch-site': 'cross-site' },
        }),
      ),
    (error) => error.status === 403,
  );
});

void test('oversized cloned request returns 413 without waiting for its unread notification branch', async () => {
  const request = new Request('https://qraft.test', {
    method: 'POST',
    body: 'x'.repeat(100),
  });
  const copy = request.clone();
  let timer;
  try {
    await assert.rejects(
      Promise.race([
        m.readLimitedBytes(request, 10),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Cancellation deadlocked')),
            1000,
          );
        }),
      ]),
      (error) => error.status === 413,
    );
  } finally {
    clearTimeout(timer);
    await copy.body.cancel();
  }
});

void test('unreadable successful responses preserve the outbox and account binding', async (t) => {
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  const uid = 'durable-user';
  const state = m.initialAppState();
  state.clientUpdatedAt = new Date().toISOString();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(new Headers(init.headers).get('x-qraft-account'), uid);
    return new Response('<html>upstream error</html>', { status: 200 });
  };
  await assert.rejects(
    m.saveCloudState(uid, state),
    (error) => error.status === 502,
  );
  assert.equal(calls, 1, 'mutations must not be blindly retried');
  assert.equal((await m.loadStateSyncOutbox(uid)).length, 1);
  globalThis.fetch = async () => Response.json({});
  await assert.rejects(
    m.flushPendingCloudState(uid),
    (error) => error.status === 502,
  );
  assert.equal((await m.loadStateSyncOutbox(uid)).length, 1);
  globalThis.fetch = async () =>
    Response.json({
      ok: true,
      state,
      revision: 1,
      updatedAt: state.clientUpdatedAt,
    });
  await m.flushPendingCloudState(uid);
  assert.equal((await m.loadStateSyncOutbox(uid)).length, 0);
});

void test('API rate errors retain Retry-After for deliberate recovery without blind retries', async (t) => {
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json(
      { error: 'Slow down' },
      { status: 429, headers: { 'retry-after': '60' } },
    );
  };
  await assert.rejects(
    m.api('/state', { method: 'PUT', body: '{}' }),
    (error) => error.status === 429 && error.retryAfterMs === 60_000,
  );
  assert.equal(calls, 1);
});

void test('fallback state lock serializes writes and recovers after failure', async () => {
  let active = 0,
    maximum = 0;
  const run = async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
  };
  await Promise.all(
    Array.from({ length: 10 }, () => m.withStateSyncLock('same-account', run)),
  );
  assert.equal(maximum, 1);
  await assert.rejects(
    m.withStateSyncLock('same-account', async () => {
      throw new Error('connection lost');
    }),
  );
  await m.withStateSyncLock('same-account', run);
  assert.equal(active, 0);
});

void test('offline to online recovery reconciles once across all active realtime channels', async (t) => {
  const descriptors = Object.fromEntries(
    ['window', 'navigator', 'WebSocket'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const window = new EventTarget();
  window.location = { origin: 'https://qraft.test' };
  const navigator = { onLine: true };
  const sockets = [];
  class Socket {
    constructor() {
      sockets.push(this);
    }
    close() {
      queueMicrotask(() => this.onclose?.());
    }
  }
  for (const [key, value] of Object.entries({
    window,
    navigator,
    WebSocket: Socket,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  let stop = () => undefined;
  t.after(() => {
    stop?.();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  let recoveries = 0;
  stop = m.openLiveChannels(['user:one', 'catalog'], (topic) => {
    if (topic === 'connected') recoveries++;
  });
  sockets.forEach((socket) => socket.onopen());
  assert.equal(recoveries, 0);
  for (let wave = 0; wave < 2; wave++) {
    navigator.onLine = false;
    window.dispatchEvent(new Event('offline'));
    await Promise.resolve();
    navigator.onLine = true;
    window.dispatchEvent(new Event('online'));
    sockets.slice(-2).forEach((socket) => socket.onopen());
    assert.equal(recoveries, wave + 1);
  }
});
