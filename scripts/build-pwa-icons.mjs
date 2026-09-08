import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Reuse the original brand paths, without the old inset tile or its padding.
const source = await readFile(new URL('../public/pwa-icon-source.svg', import.meta.url), 'utf8');
const paths = source.match(/<path\s[^>]+\/>/g).join('\n');
for (const [file, size, scale] of [
  ['icon-192.png', 192, 2.65], ['icon-512.png', 512, 2.65],
  ['apple-touch-icon.png', 180, 2.65], ['icon-maskable-512.png', 512, 2.1],
]) {
  const x = 512 - 165 * scale;
  const y = 512 - 182 * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#f3fafa"/><g transform="translate(${x} ${y}) scale(${scale})">${paths}</g></svg>`;
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(fileURLToPath(new URL(`../public/${file}`, import.meta.url)));
}
