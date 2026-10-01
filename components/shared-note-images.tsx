'use client';

import type { NoteImage } from '@/lib/medguard-types';

export function SharedNoteImages({ images, onZoom }: {
  images: NoteImage[];
  onZoom: (url: string) => void;
}) {
  if (!images.length) return null;
  return (
    <div aria-label="Shared explanation images" className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
      {images.map(image => (
        <figure key={image.id} className="min-w-0 overflow-hidden rounded-xl border bg-muted/20">
          <button type="button" onClick={() => onZoom(image.url)} aria-label={`Enlarge image: ${image.caption || image.name}`} className="block w-full cursor-zoom-in p-2 focus-visible:outline-2 focus-visible:outline-primary">
            {/* Uploaded media is served by the protected application endpoint. */}
            {/* oxlint-disable-next-line next/no-img-element */}
            <img src={image.url} alt={image.caption || image.name} loading="lazy" className="max-h-72 w-full object-contain" />
          </button>
          {image.caption && <figcaption dir="auto" className="whitespace-pre-wrap break-words border-t px-3 py-2 text-sm leading-6">{image.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
