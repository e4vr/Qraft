'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import type { NoteImage } from '@/lib/medguard-types';
import { uploadSharedNoteImage } from '@/features/qbanks/client/qbank-client';
import { NOTE_IMAGE_ACCEPT, uploadSharedNoteImages } from '@/features/media/client/shared-note-images';
import { SharedNoteImages } from '@/components/shared-note-images';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export function ExplanationImageEditor({ uid, qbankId, questionId, images, onChange, onBusyChange, disabled = false, maximum = 10, upload, label = 'Explanation images' }: {
  uid: string;
  qbankId: string;
  questionId: string;
  images: NoteImage[];
  onChange: (images: NoteImage[]) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
  maximum?: number;
  upload?: (file: File) => Promise<string>;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState('');
  const active = useRef(false);
  const inFlight = useRef(false);
  const latestImages = useRef(images);
  const latestOnChange = useRef(onChange);
  useEffect(() => { latestOnChange.current = onChange; }, [onChange]);
  useEffect(() => { latestImages.current = images; }, [images]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (inFlight.current) onBusyChange(false);
    };
  }, [onBusyChange]);
  async function attach(files: File[]) {
    if (!files.length || disabled || inFlight.current) return;
    const remaining = Math.max(0, maximum - latestImages.current.length);
    if (!remaining) { setError(`Keep at most ${maximum} images.`); return; }
    inFlight.current = true;
    setBusy(true); onBusyChange(true); setError('');
    try {
      const result = await uploadSharedNoteImages(files.slice(0, remaining), upload ?? (file => uploadSharedNoteImage(uid, file, qbankId, questionId)));
      if (!active.current) return;
      const next = [...latestImages.current, ...result.images];
      latestImages.current = next;
      latestOnChange.current(next);
      setError([...result.errors, ...(files.length > remaining ? [`Keep at most ${maximum} images; add fewer files.`] : [])].join('\n'));
    } finally {
      inFlight.current = false;
      if (active.current) { onBusyChange(false); setBusy(false); }
    }
  }
  return (
    // This region accepts native clipboard and file drops; its controls remain separately accessible.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section aria-label={`${label} attachments`} className="mt-3 rounded-xl border bg-muted/10 p-3"
      onPaste={event => { const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void attach(files); } }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void attach(Array.from(event.dataTransfer.files)); } }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">{label}</strong>
        <label className={`relative flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${disabled || busy ? 'opacity-50' : 'cursor-pointer text-primary hover:bg-primary/5'}`}>
          <ImagePlus className="size-4" />Add {label.toLowerCase()}
          <input aria-label={`Add ${label.toLowerCase()}`} className="sr-only" type="file" accept={NOTE_IMAGE_ACCEPT} multiple disabled={disabled || busy || images.length >= maximum} onChange={event => { void attach(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        </label>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Choose, paste, or drop images · 5 per upload · 10 MB each · {images.length}/{maximum}.</p>
      {busy && <output className="mt-2 flex items-center gap-2 text-xs"><RefreshCw className="size-3 animate-spin" />Uploading images…</output>}
      {error && <p role="alert" className="mt-2 whitespace-pre-wrap text-sm text-destructive">{error}</p>}
      <SharedNoteImages images={images} onZoom={setZoom} />
      {images.map(image => <div key={image.id} className="mt-2 flex items-center gap-2">
        <input aria-label={`Caption for ${image.name}`} disabled={disabled || busy} value={image.caption} maxLength={4000} placeholder={`Caption for ${image.name}`} className="min-h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm" onChange={event => onChange(images.map(item => item.id === image.id ? { ...item, caption: event.target.value } : item))} />
        <button type="button" disabled={disabled || busy} aria-label={`Remove ${label === 'Explanation images' ? 'explanation' : 'announcement'} image ${image.name}`} className="grid size-11 shrink-0 place-items-center rounded-xl border text-destructive" onClick={() => onChange(images.filter(item => item.id !== image.id))}><Trash2 className="size-4" /></button>
      </div>)}
      <Dialog open={Boolean(zoom)} onOpenChange={open => { if (!open) setZoom(''); }}><DialogContent className="sm:max-w-4xl"><DialogTitle>{label}</DialogTitle>{/* oxlint-disable-next-line next/no-img-element */}<img src={zoom || undefined} alt={`Enlarged ${label.toLowerCase()}`} className="max-h-[75dvh] w-full object-contain" /></DialogContent></Dialog>
    </section>
  );
}
