'use client';

import { useState } from 'react';
import type { NoteImage } from '@/lib/medguard-types';
import { SharedNoteImages } from '@/components/shared-note-images';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export function ExplanationImages({ images = [] }: { images?: NoteImage[] }) {
  const [zoom, setZoom] = useState('');
  if (!images.length) return null;
  return <div>
    <SharedNoteImages images={images} onZoom={setZoom} />
    <Dialog open={Boolean(zoom)} onOpenChange={open => { if (!open) setZoom(''); }}>
      <DialogContent className="sm:max-w-4xl"><DialogTitle>Explanation illustration</DialogTitle>
        {/* oxlint-disable-next-line next/no-img-element */}
        <img src={zoom || undefined} alt="Enlarged explanation illustration" className="max-h-[75dvh] w-full object-contain" />
      </DialogContent>
    </Dialog>
  </div>;
}
