import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

// Exercise the component's lifecycle without a browser dependency. UI primitives
// are inert; state, effects, storage, and API acknowledgement are controlled.
const compiled = await build({
  entryPoints: ['components/site-announcement.tsx'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  banner: {
    js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(import.meta.url)});`,
  },
  plugins: [
    {
      name: 'announcement-lifecycle-fixture',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(react|@\/lib\/api-client|@\/lib\/realtime-client|@\/components\/ui\/dialog)$/,
          },
          (args) => {
            if (!args.importer.endsWith('site-announcement.tsx')) return;
            return { path: args.path, namespace: 'announcement-fixture' };
          },
        );
        builder.onLoad(
          { filter: /.*/, namespace: 'announcement-fixture' },
          ({ path }) => ({
            contents:
              path === 'react'
                ? `
        export const useState = value => globalThis.__announcementFixture.hooks.useState(value);
        export const useEffect = (effect, deps) => globalThis.__announcementFixture.hooks.useEffect(effect, deps);
      `
                : path.endsWith('api-client')
                  ? `export const api = (path, init) => globalThis.__announcementFixture.api(path, init);`
                  : path.endsWith('realtime-client')
                    ? 'export const subscribeLive = () => () => {};'
                    : 'export const Dialog = () => null; export const DialogContent = () => null; export const DialogTitle = () => null;',
            loader: 'js',
          }),
        );
      },
    },
  ],
});
const { SiteAnnouncement } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

function lifecycle() {
  const slots = [];
  let cursor = 0;
  let pending = [];
  return {
    start() {
      cursor = 0;
    },
    useState(initial) {
      const index = cursor++;
      slots[index] ??= {
        value: typeof initial === 'function' ? initial() : initial,
      };
      return [
        slots[index].value,
        (next) => {
          slots[index].value =
            typeof next === 'function' ? next(slots[index].value) : next;
        },
      ];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i])))
        return;
      pending.push(() => {
        previous?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    },
    commit() {
      const effects = pending;
      pending = [];
      for (const effect of effects) effect();
    },
    dispose() {
      for (const slot of slots) slot.cleanup?.();
    },
  };
}

void test('popup waits for sign-in, appears once per account and activation, and survives reload without repeating', async () => {
  const oldGlobals = Object.fromEntries(
    ['window', 'document', 'localStorage', '__announcementFixture'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
    ),
  );
  const storage = new Map();
  const seen = new Map();
  const writes = [];
  const reads = [];
  let announcement = {
    enabled: true,
    title: 'News',
    content: 'Study news',
    href: '',
    images: [],
    displayMode: 'visit', // Legacy records must still obey once-per-account policy.
    revision: 'first',
  };
  const listeners = new Map();
  const surface = {
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
  const fixture = {
    hooks: lifecycle(),
    async api(path, init) {
      if (path.endsWith('announcement-dismiss')) {
        const { revision } = JSON.parse(init.body);
        writes.push(revision);
        seen.set(init.expectedUserId, revision);
        return { ok: true };
      }
      reads.push(init.cacheScope);
      assert.equal(init.expectedUserId, init.cacheScope);
      return {
        ...announcement,
        dismissed: seen.get(init.cacheScope) === announcement.revision,
      };
    },
  };
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: surface },
    document: {
      configurable: true,
      value: { ...surface, visibilityState: 'visible' },
    },
    localStorage: {
      configurable: true,
      value: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    },
    __announcementFixture: { configurable: true, value: fixture },
  });
  const settle = async (props = { userId: 'learner' }) => {
    let output;
    for (let pass = 0; pass < 5; pass++) {
      fixture.hooks.start();
      output = SiteAnnouncement(props);
      fixture.hooks.commit();
      await Promise.resolve();
    }
    return output;
  };
  try {
    assert.equal((await settle({})).props.open, false);
    assert.deepEqual(reads, [], 'visitors must not fetch or acknowledge announcements');
    assert.deepEqual(writes, []);
    const first = await settle();
    assert.equal(first.props.open, true);
    assert.deepEqual(writes, ['first']);
    assert.equal(storage.get('qraft-announcement:learner'), 'first');
    assert.equal(
      (await settle()).props.open,
      true,
      'saving the impression must not close the visible dialog',
    );
    first.props.onOpenChange(false);
    assert.equal((await settle()).props.open, false);
    announcement = { ...announcement, content: 'Edited during the same activation' };
    listeners.get('visibilitychange')();
    assert.equal((await settle()).props.open, false, 'editing an active announcement must not replay it');
    assert.equal((await settle({ userId: '' })).props.open, false, 'sign-out must hide the popup');
    assert.equal((await settle()).props.open, false, 'signing back in must honor the same impression');
    fixture.hooks.dispose();
    fixture.hooks = lifecycle();
    storage.clear();
    assert.equal(
      (await settle()).props.open,
      false,
      'a fresh device must honor the account acknowledgement',
    );
    assert.deepEqual(writes, ['first']);
    announcement = { ...announcement, enabled: false };
    listeners.get('visibilitychange')();
    assert.equal((await settle()).props.open, false, 'disabled announcements must stay hidden');
    announcement = {
      ...announcement,
      enabled: true,
      revision: 'second',
      content: 'New announcement',
    };
    listeners.get('visibilitychange')();
    const second = await settle();
    assert.equal(second.props.open, true);
    assert.deepEqual(writes, ['first', 'second']);
    fixture.hooks.dispose();
    fixture.hooks = lifecycle();
    assert.equal(
      (await settle({ userId: 'another', defer: true })).props.open,
      false,
    );
    assert.equal(
      seen.has('another'),
      false,
      'a deferred popup must not mark the announcement as seen',
    );
    assert.equal(
      (await settle({ userId: 'another', defer: false })).props.open,
      true,
    );
    assert.equal(seen.get('another'), 'second');

    // A response initiated for a signed-in account must be ignored after logout.
    fixture.hooks.dispose();
    fixture.hooks = lifecycle();
    const originalApi = fixture.api.bind(fixture);
    let resolveRead;
    fixture.api = () => new Promise(resolve => { resolveRead = resolve; });
    assert.equal((await settle({ userId: 'late' })).props.open, false);
    assert.equal((await settle({ userId: '' })).props.open, false);
    resolveRead({ ...announcement, dismissed: false });
    assert.equal((await settle({ userId: '' })).props.open, false);
    assert.equal(seen.has('late'), false);
    fixture.api = originalApi;
  } finally {
    fixture.hooks.dispose();
    for (const [key, descriptor] of Object.entries(oldGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
