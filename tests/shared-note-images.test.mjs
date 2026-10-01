import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents: `
      export * from './features/media/client/shared-note-images';
      export * from './features/media/domain/image-attachments';
      export { parseQuestionImportReport } from './lib/question-import';
      export { ExplanationImageEditor } from './components/explanation-image-editor';
      export { ExplanationImages } from './components/explanation-images';
      export { SharedNoteImages } from './components/shared-note-images';
      export { createElement } from 'react';
      export { renderToStaticMarkup } from 'react-dom/server';
      export { mergeLiveState } from './lib/merge-live-state';
    `,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
  banner: { js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(import.meta.url)});` },
});
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const file = (name, type = 'image/png') => new File(['image-bytes'], name, { type });

void test('explanation image validation accepts old records, bounds attachments and rejects unsafe links', () => {
  const image = { id: 'solution', url: 'https://example.test/solution.png', name: 'solution.png', caption: 'Caption' };
  assert.equal(m.validOptionalExplanationImages(undefined), true);
  assert.equal(m.validImageAttachments([image]), true);
  assert.equal(m.validImageAttachments([{ ...image, url: '/api/cloudflare/media/shared-notes/photo.png' }]), true);
  for (const value of [null, {}, [null], [image, image], [{ ...image, url: 'javascript:alert(1)' }], [{ ...image, url: 'data:image/png;base64,abc' }], [{ ...image, caption: null }], [{ ...image, caption: 'a'.repeat(4001) }]]) assert.equal(m.validOptionalExplanationImages(value), false);
  const images = Array.from({ length: 6 }, (_, n) => ({ ...image, id: String(n) }));
  assert.equal(m.validImageAttachments(images), true);
  assert.equal(m.validImageAttachments(images, 5), false);
});

void test('JSON imports preserve explanation images separately from question images and retain legacy absence', () => {
  const image = { id: 'solution', url: '/api/cloudflare/media/shared-notes/photo.png', name: 'solution.png', caption: 'Reasoning' };
  const question = { stem: 'Question?', options: ['A', 'B'], answer: 0, explanation: 'Reasoning', sourceFile: 'Original.pdf', images: [] };
  const report = m.parseQuestionImportReport({ questions: [{ ...question, explanationImages: [image] }, question] });
  assert.equal(report.questions.length, 2);
  assert.deepEqual(report.questions[0].explanationImages, [image]);
  assert.deepEqual(report.questions[0].images, []);
  assert.equal(Object.hasOwn(report.questions[1], 'explanationImages'), false);
  const invalid = m.parseQuestionImportReport({ questions: [{ ...question, explanationImages: [{ ...image, url: 'javascript:alert(1)' }] }] });
  assert.equal(invalid.questions.length, 0);
  assert.match(invalid.skipped[0].reason, /explanationImages/);
});

void test('reusable question editors show upload, preview, caption and removal controls with upload limits', () => {
  const image = { id: 'solution', url: 'https://example.test/solution.png', name: 'solution.png', caption: 'Reasoning' };
  const html = m.renderToStaticMarkup(m.createElement(m.ExplanationImageEditor, { uid: 'u', qbankId: 'bank', questionId: 'question', images: [image], onChange() {}, onBusyChange() {} }));
  for (const label of ['Add explanation images', 'Caption for solution.png', 'Remove explanation image solution.png', 'Enlarge image:']) assert.ok(html.includes(label));
  assert.match(html, /1\/10/);
  const disabled = m.renderToStaticMarkup(m.createElement(m.ExplanationImageEditor, { uid: 'u', qbankId: 'bank', questionId: 'question', images: [image], maximum: 1, disabled: true, onChange() {}, onBusyChange() {} }));
  assert.match(disabled, /disabled=""/);
  assert.equal(m.renderToStaticMarkup(m.createElement(m.ExplanationImages, {})), '');
  assert.match(m.renderToStaticMarkup(m.createElement(m.ExplanationImages, { images: [image] })), /Reasoning/);
});

void test('shared image batches preserve successful uploads when another upload fails and bound concurrency', async () => {
  let active = 0, peak = 0;
  const result = await m.uploadSharedNoteImages([file('one.png'), file('failed.png'), file('three.png')], async file => {
    active++; peak = Math.max(peak, active);
    await Promise.resolve(); active--;
    if (file.name === 'failed.png') throw new Error('Connection unavailable');
    return `/api/cloudflare/media/shared-notes/bank/${file.name}`;
  });
  assert.deepEqual(result.images.map(image => image.name), ['one.png', 'three.png']);
  assert.equal(new Set(result.images.map(image => image.id)).size, 2);
  assert.equal(peak, 1);
  assert.match(result.errors[0], /failed.png: Connection unavailable/);
});

void test('unsupported, empty and oversized images never reach the upload endpoint', async () => {
  const sent = [];
  const result = await m.uploadSharedNoteImages([
    file('scan.svg', 'image/svg+xml'), new File([], 'empty.png', { type: 'image/png' }),
    new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    file('valid.webp', 'image/webp'),
  ], async file => { sent.push(file.name); return '/api/cloudflare/media/shared-notes/test.webp'; });
  assert.deepEqual(sent, ['valid.webp']);
  assert.equal(result.images.length, 1);
  assert.equal(result.errors.length, 3);
});

void test('extra files receive an explicit warning instead of silently disappearing', async () => {
  const result = await m.uploadSharedNoteImages(Array.from({ length: 7 }, (_, i) => file(`${i}.png`)), async file => `/api/cloudflare/media/shared-notes/${file.name}`);
  assert.equal(result.images.length, 5);
  assert.match(result.errors[0], /remaining images/);
});

void test('saved explanation images render with accessible enlargement and escaped captions', () => {
  const image = { id: 'photo', url: '/api/cloudflare/media/shared-notes/photo.png', name: 'scan.png', caption: '<script>caption</script>' };
  const html = m.renderToStaticMarkup(m.createElement(m.SharedNoteImages, { images: [image], onZoom() {} }));
  assert.match(html, /aria-label="Shared explanation images"/);
  assert.match(html, /aria-label="Enlarge image:/);
  assert.match(html, /shared-notes\/photo.png/);
  assert.match(html, /<figcaption/);
  assert.match(html, /&lt;script&gt;caption&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(m.renderToStaticMarkup(m.createElement(m.SharedNoteImages, { images: [], onZoom() {} })), '');
});

void test('a remote note refresh preserves unsaved local images and reconciles saved captions', () => {
  const saved = { id: 'saved', url: '/image', name: 'scan.png', caption: '' };
  const draft = { id: 'draft', url: '/draft', name: 'draft.png', caption: 'Local draft' };
  const result = m.mergeLiveState([saved], [saved, draft], [{ ...saved, caption: 'Remote caption' }]);
  assert.deepEqual(result, [{ ...saved, caption: 'Remote caption' }, draft]);
});
