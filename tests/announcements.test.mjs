import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents: `
    export * from './features/announcements/domain/announcement';
    export { AnnouncementContent } from './components/site-announcement';
    export { TelegramChannelButton } from './components/telegram-channel-button';
    export { createElement } from 'react';
    export { renderToStaticMarkup } from 'react-dom/server';
  `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  banner: {
    js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(import.meta.url)});`,
  },
});
const m = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

void test('Telegram accepts channel and invitation URLs and rejects unsafe navigation', () => {
  for (const link of [
    '',
    'https://t.me/QraftQBanks',
    'https://t.me/+Invite123',
    'https://telegram.me/QraftQBanks',
  ])
    assert.equal(m.validTelegramLink(link), true);
  for (const link of [
    'javascript:alert(1)',
    '//t.me/Qraft',
    'http://t.me/Qraft',
    'https://t.me.evil.test/Qraft',
    'https://user@t.me/Qraft',
    'https://t.me/Qraft?redirect=example',
    'https://example.test/Qraft',
  ])
    assert.equal(m.validTelegramLink(link), false);
});

void test('announcement action links reject script schemes and external protocol-relative URLs', () => {
  for (const link of ['', '/settings', 'https://qraft.test/news'])
    assert.equal(m.validAnnouncementLink(link), true);
  for (const link of [
    'javascript:alert(1)',
    '//evil.test',
    '/\\evil.test',
    'https://user:password@evil.test',
    'https://example.test/ news',
  ])
    assert.equal(m.validAnnouncementLink(link), false);
});

void test('a new announcement revision changes its identity while acknowledgement does not', () => {
  const value = {
    ...m.DEFAULT_ANNOUNCEMENT,
    content: 'News',
    revision: 'first',
  };
  assert.equal(
    m.announcementIdentity(value),
    m.announcementIdentity({ ...value, dismissed: true }),
  );
  assert.notEqual(
    m.announcementIdentity(value),
    m.announcementIdentity({ ...value, revision: 'second' }),
  );
  assert.notEqual(
    m.announcementIdentity({ ...value, revision: '' }),
    m.announcementIdentity({ ...value, revision: '', content: 'Updated news' }),
  );
});

void test('announcement markup escapes text, renders image-only content and guards preview links', () => {
  const value = {
    ...m.DEFAULT_ANNOUNCEMENT,
    content: '<script>alert(1)</script>',
    href: 'javascript:alert(1)',
    images: [
      {
        id: 'news',
        url: 'https://example.test/news.png',
        name: 'news.png',
        caption: 'Illustration',
      },
    ],
  };
  const html = m.renderToStaticMarkup(
    m.createElement(m.AnnouncementContent, { value }),
  );
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /alt="Illustration"/);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  const imageOnly = m.renderToStaticMarkup(
    m.createElement(m.AnnouncementContent, {
      value: { ...value, content: '', href: '' },
    }),
  );
  assert.match(imageOnly, /<img/);
});

void test('Telegram button is horizontal, includes the logo and opens the configured channel safely', () => {
  const html = m.renderToStaticMarkup(
    m.createElement(m.TelegramChannelButton, {
      href: 'https://t.me/QraftQBanks',
    }),
  );
  for (const text of [
    'https://t.me/QraftQBanks',
    '<svg',
    'Join our Telegram channel for news and updates',
    'noopener noreferrer',
    'min-h-16 w-full',
  ])
    assert.ok(html.includes(text));
  assert.equal(
    m.renderToStaticMarkup(
      m.createElement(m.TelegramChannelButton, { href: '' }),
    ),
    '',
  );
  assert.equal(
    m.renderToStaticMarkup(
      m.createElement(m.TelegramChannelButton, { href: 'javascript:alert(1)' }),
    ),
    '',
  );
});
