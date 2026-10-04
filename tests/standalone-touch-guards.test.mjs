import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['features/presentation/standalone-touch-guards.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { installStandaloneTouchGuards } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

class Target extends EventTarget {
  constructor(native = false, parent = null) { super(); this.native = native; this.parentElement = parent; this.scrollHeight = this.clientHeight = 100; this.scrollTop = 0; }
  closest(selector) { return selector === 'label' ? null : this.native ? this : this.parentElement?.closest(selector) ?? null; }
}

void test('installed touch guards preserve text interactions, click tolerance and native scrolling', t => {
  const previous = { document: globalThis.document, Element: globalThis.Element, HTMLLabelElement: globalThis.HTMLLabelElement };
  const listeners = new Map();
  globalThis.Element = Target;
  globalThis.HTMLLabelElement = class extends Target {};
  globalThis.document = { documentElement: new Target(), addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name) };
  t.after(() => Object.assign(globalThis, previous));
  const remove = installStandaloneTouchGuards();
  const send = (type, target, properties = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'target', { value: target }); Object.assign(event, properties);
    listeners.get(type)?.(event); return event.defaultPrevented;
  };
  const touch = (x, y) => [{ clientX: x, clientY: y }];
  const area = new Target(), input = new Target(true), textChild = new Target(false, input);
  for (const target of [input, textChild]) {
    send('touchstart', target, { touches: touch(50, 50) });
    assert.equal(send('touchmove', target, { touches: touch(50, 100) }), false);
    assert.equal(send('touchmove', target, { touches: [...touch(50, 50), ...touch(80, 80)] }), false);
    assert.equal(send('dblclick', target), false);
  }
  send('touchstart', area, { touches: touch(50, 50) });
  assert.equal(send('touchmove', area, { touches: touch(50, 50.25) }), false);
  assert.equal(send('touchmove', area, { touches: touch(50, 57) }), false);
  assert.equal(send('touchmove', area, { touches: touch(80, 60) }), false);
  assert.equal(send('touchmove', area, { touches: touch(50, 40) }), false);
  assert.equal(send('touchmove', area, { touches: touch(50, 70) }), true);
  area.scrollHeight = 200; area.scrollTop = 15;
  assert.equal(send('touchmove', area, { touches: touch(50, 70) }), false);
  assert.equal(send('touchmove', area, { touches: [...touch(50, 50), ...touch(80, 80)] }), true);
  assert.equal(send('dblclick', area), true);
  assert.equal(send('wheel', area, { ctrlKey: false }), false);
  assert.equal(send('wheel', area, { ctrlKey: true }), true);
  assert.equal(send('wheel', input, { ctrlKey: true }), false);
  remove(); assert.equal(listeners.size, 0);
});
