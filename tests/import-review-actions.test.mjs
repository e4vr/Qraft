import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

await mkdir('.ui-review', { recursive: true });
await build({ entryPoints: ['components/import-review-actions.tsx'], bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react', 'react-dom', 'lucide-react'], outfile: '.ui-review/import-review-actions.mjs' });
const { ImportReviewActions } = await import('../.ui-review/import-review-actions.mjs');
const defaults = { busy: false, checking: false, stage: 'preparing', completed: 0, total: 0, previousDisabled: false, hasDuplication: true, saveDisabled: false, onPrevious() {}, onNext() {}, onCompare() {}, onSave() {} };
const render = props => renderToStaticMarkup(createElement(ImportReviewActions, { ...defaults, ...props }));

void test('saving replaces the submit button immediately, and preparation stays indeterminate', () => {
  const html = render({ busy: true });
  assert.match(html, /Preparing your import/);
  assert.match(html, /<progress[^>]*aria-label="Import upload progress"/);
  assert.doesNotMatch(html.match(/<progress[^>]*>/)[0], / value=/);
  assert.doesNotMatch(html, /Save import|Retry remaining batches|[0-9]+%/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3);
});

void test('upload progress advances only with acknowledged batches and never claims an extra batch', () => {
  for (const [completed, percent, label] of [[0, 0, 'Uploading batch 1 of 4'], [1, 25, 'Uploading batch 2 of 4'], [3, 75, 'Uploading batch 4 of 4'], [4, 100, 'Import saved']]) {
    const html = render({ busy: true, stage: 'uploading', completed, total: 4 });
    assert.ok(html.includes(`${percent}%`));
    assert.ok(html.includes(label));
    assert.match(html, new RegExp(`max="4" value="${completed}"`));
    assert.ok(html.includes(`${completed} of 4 batches saved`));
    assert.doesNotMatch(html, /batch 5|Save import/);
  }
});

void test('a failed partial upload restores retry with its saved count; rechecking is indeterminate', () => {
  const paused = render({ completed: 2, total: 4 });
  assert.match(paused, /2 of 4 batches saved\. Retry continues/);
  assert.match(paused, /Retry remaining batches/);
  assert.doesNotMatch(paused, /<progress/);
  const retry = render({ busy: true, stage: 'checking', completed: 2, total: 4 });
  assert.match(retry, /Checking edited questions/);
  assert.doesNotMatch(retry, /50%| value="2"/);
  const resumed = render({ busy: true, stage: 'uploading', completed: 2, total: 4 });
  assert.match(resumed, /50%/);
  assert.match(resumed, /Uploading batch 3 of 4/);
});

void test('save prerequisites and scanning disable submission; comparison controls match the question state', () => {
  for (const props of [{ saveDisabled: true }, { checking: true }]) {
    assert.match(render(props), /<button[^>]*disabled=""[^>]*q-import-save/);
  }
  const plain = render({ hasDuplication: false, previousDisabled: true });
  assert.match(plain, /Next/);
  assert.doesNotMatch(plain, /Keep both|View the duplication/);
  assert.match(plain, /<button[^>]*disabled=""[^>]*>.*?Previous/s);
});
