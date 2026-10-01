import type { NoteImage } from '@/lib/medguard-types';

export function validImageAttachments(value: unknown, maximum = 10): value is NoteImage[] {
  if (!Array.isArray(value) || value.length > maximum) return false;
  const ids = new Set<string>();
  return value.every(image => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) return false;
    const entry = image as Record<string, unknown>;
    if (!['id', 'url', 'name', 'caption'].every(key => typeof entry[key] === 'string')) return false;
    const item = image as NoteImage;
    if (!item.id || ids.has(item.id) || item.id.length > 200 || item.url.length > 4000 || item.name.length > 500 || item.caption.length > 4000) return false;
    ids.add(item.id);
    if (item.url.startsWith('/api/cloudflare/media/')) return !/[\s\\]/.test(item.url);
    try { return new URL(item.url).protocol === 'https:'; } catch { return false; }
  });
}

export function validOptionalExplanationImages(value: unknown, maximum = 10): boolean {
  return value === undefined || validImageAttachments(value, maximum);
}
