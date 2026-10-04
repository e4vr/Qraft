import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

await mkdir('.ui-review', { recursive: true });
await build({
  stdin: { contents: `export {FormattedQuestionText} from './components/formatted-question-text';
    export {HighlightedText} from './components/highlighted-question-text';
    export {boldTextSegments,boldTextSourceOffset} from './features/qbanks/domain/bold-text';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react'],
  outfile: '.ui-review/bold-question-text.mjs',
});
const { FormattedQuestionText, HighlightedText, boldTextSegments, boldTextSourceOffset } = await import('../.ui-review/bold-question-text.mjs');
const render = (text, props) => renderToStaticMarkup(createElement(props ? HighlightedText : FormattedQuestionText, { text, ...props }));
const visible = text => boldTextSegments(text).map(segment => segment.text).join('');

void test('question and explanation bold renders Arabic, single letters, and multiple paragraphs without markers', () => {
  assert.equal(render('Which nerve is **most likely** injured?'), 'Which nerve is <strong class="font-bold">most likely</strong> injured?');
  assert.equal(render('- **A:** Tibial nerve\n- **B:** Deep peroneal nerve'), '- <strong class="font-bold">A:</strong> Tibial nerve\n- <strong class="font-bold">B:</strong> Deep peroneal nerve');
  assert.equal(render('هذا **نص عريض**\n**A**'), 'هذا <strong class="font-bold">نص عريض</strong>\n<strong class="font-bold">A</strong>');
  assert.equal(visible('**First line\nsecond line**'), 'First line\nsecond line');
});

void test('plain, incomplete, empty, and escaped markup remain readable and imported HTML is escaped', () => {
  for (const text of ['', 'plain\n0.5 mg', '**unfinished', 'tail**', '****', '** spaced **', '\\**literal**', '2 * 3']) {
    assert.equal(visible(text), text);
    assert.doesNotMatch(render(text), /<strong/);
  }
  const html = render('**<script>alert(1)</script>** <img src=x onerror=alert(1)>');
  assert.match(html, /<strong class="font-bold">&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|<img/);
});

void test('selection offsets preserve original source coordinates before, within, and after bold text', () => {
  const text = 'A **bold** tail';
  assert.equal(boldTextSourceOffset(text, 0, 'start'), 0);
  assert.equal(boldTextSourceOffset(text, 2, 'start'), 4);
  assert.equal(boldTextSourceOffset(text, 2, 'end'), 2);
  assert.equal(boldTextSourceOffset(text, 4, 'start'), 6);
  assert.equal(boldTextSourceOffset(text, 6, 'end'), 8);
  assert.equal(boldTextSourceOffset(text, 6, 'start'), 10);
  assert.equal(boldTextSourceOffset(text, 11, 'end'), text.length);
  assert.equal(boldTextSourceOffset('**A****B**', 1, 'start'), 7);
});

void test('existing highlights cross bold boundaries and new selections highlight the intended text', () => {
  const text = 'A **bold** tail';
  const start = boldTextSourceOffset(text, 3, 'start');
  const end = boldTextSourceOffset(text, 5, 'end');
  const inside = render(text, { ranges: [{ start, end }], interactive: false });
  assert.match(inside, /<strong class="font-bold">b<mark[^>]*>ol<\/mark>d<\/strong>/);
  const crossing = render(text, { ranges: [{ start: 0, end: text.length }], interactive: false });
  assert.equal((crossing.match(/<mark/g) ?? []).length, 3);
  assert.doesNotMatch(crossing, /\*\*/);
  const removable = render(text, { ranges: [{ start: 4, end: 8 }] });
  assert.match(removable, /aria-label="Remove highlight: bold"/);
  assert.equal(render('plain', { ranges: [], interactive: false }), 'plain');
});
