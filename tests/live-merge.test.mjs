import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

void test('Live updates merge independent edits without clearing drafts or resurrecting deleted records', async () => {
  const { code } = await transform(await readFile('lib/merge-live-state.ts', 'utf8'), { loader: 'ts', format: 'esm' });
  const { mergeLiveState } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const before = { notes: [{ id: 'q1', text: 'Old', title: 'Old title' }], stats: { q1: { selections: { one: 0 } } } };
  const local = { notes: [{ id: 'q1', text: 'My unsaved draft', title: 'Old title' }], stats: { q1: { selections: { one: 1 } } } };
  const remote = { notes: [{ id: 'q1', text: 'Old', title: 'New title' }, { id: 'q2', text: 'New question' }], stats: { q1: { selections: { one: 0, two: 2 } } } };
  const merged = mergeLiveState(before, local, remote);
  assert.deepEqual(merged.notes, [{ id: 'q1', text: 'My unsaved draft', title: 'New title' }, { id: 'q2', text: 'New question' }]);
  assert.deepEqual(merged.stats.q1.selections, { one: 1, two: 2 });
  assert.deepEqual(mergeLiveState(before, local, { ...remote, notes: [] }).notes, []);
  assert.deepEqual(mergeLiveState(before, before, remote), remote);
});
