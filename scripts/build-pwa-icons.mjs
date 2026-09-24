import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Every generated product image is derived from the approved Qraft assets.
const source = await readFile(
  new URL('../public/qraft-mark.svg', import.meta.url),
  'utf8',
);
const paths = source.match(/<path\s[^>]+\/>/g).join('\n');
for (const [file, size, scale] of [
  ['icon-192.png', 192, 2.65],
  ['icon-512.png', 512, 2.65],
  ['apple-touch-icon.png', 180, 2.65],
  ['icon-maskable-512.png', 512, 2.1],
]) {
  const x = 512 - 165 * scale;
  const y = 512 - 182 * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#f3fafa"/><g transform="translate(${x} ${y}) scale(${scale})">${paths}</g></svg>`;
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(`../public/${file}`, import.meta.url)));
}

const wordmark = await readFile(
  new URL('../public/qraft-wordmark.svg', import.meta.url),
  'utf8',
);
const wordmarkData = Buffer.from(wordmark).toString('base64');
const social = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop stop-color="#f8fcfc"/><stop offset="1" stop-color="#e5f4f2"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1080" cy="90" r="260" fill="#228e85" opacity=".08"/>
  <circle cx="80" cy="610" r="240" fill="#07233e" opacity=".06"/>
  <rect x="132" y="132" width="936" height="366" rx="52" fill="#fff" opacity=".94"/>
  <image href="data:image/svg+xml;base64,${wordmarkData}" x="220" y="205" width="760" height="246" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
await sharp(Buffer.from(social))
  .png()
  .toFile(fileURLToPath(new URL('../public/og.png', import.meta.url)));
