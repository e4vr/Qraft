import type { NoteImage } from '@/lib/medguard-types';

export const NOTE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const IMAGE_TYPES = new Set(NOTE_IMAGE_ACCEPT.split(','));
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_IMAGES = 5;

// Each successful upload remains usable even if another file fails. Sequential
// uploads bound resource use and avoid discarding an entire partially saved batch.
export async function uploadSharedNoteImages(
  files: readonly File[],
  upload: (file: File) => Promise<string>,
): Promise<{ images: NoteImage[]; errors: string[] }> {
  const images: NoteImage[] = [];
  const errors: string[] = [];
  if (files.length > MAX_BATCH_IMAGES)
    errors.push('Only the first 5 images were processed. Add the remaining images in another batch.');
  for (const file of files.slice(0, MAX_BATCH_IMAGES)) {
    if (!IMAGE_TYPES.has(file.type)) {
      errors.push(`${file.name}: use a JPEG, PNG, WebP, or GIF image.`);
      continue;
    }
    if (!file.size || file.size > MAX_FILE_BYTES) {
      errors.push(`${file.name}: choose a non-empty image up to 10 MB.`);
      continue;
    }
    try {
      const url = await upload(file);
      images.push({ id: crypto.randomUUID(), url, name: file.name, caption: '' });
    } catch (error) {
      errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Image upload failed. Try again.'}`);
    }
  }
  return { images, errors };
}
