'use client';

import { ArrowLeft, ArrowRight, CheckCheck, Eye, LoaderCircle, RotateCcw, Upload } from 'lucide-react';

export type ImportSaveStage = 'preparing' | 'checking' | 'uploading';

export function ImportReviewActions({
  busy, checking, stage, completed, total, previousDisabled, hasDuplication, saveDisabled,
  onPrevious, onNext, onCompare, onSave,
}: {
  busy: boolean;
  checking: boolean;
  stage: ImportSaveStage;
  completed: number;
  total: number;
  previousDisabled: boolean;
  hasDuplication: boolean;
  saveDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onCompare: () => void;
  onSave: () => void;
}) {
  // Only acknowledged batches contribute to the percentage; preparation has no estimated progress.
  const saved = Math.min(total, Math.max(0, completed));
  const determinate = stage === 'uploading' && total > 0;
  const percent = determinate ? Math.floor(saved / total * 100) : 0;
  const label = stage === 'checking' ? 'Checking edited questions…'
    : !determinate ? 'Preparing your import…'
    : saved === total ? 'Import saved' : `Uploading batch ${saved + 1} of ${total}…`;

  return <div className="q-import-actions grid grid-cols-2 gap-3 border-t pt-4">
    <button type="button" disabled={busy || checking || previousDisabled} className="q-button q-button-secondary q-import-action" onClick={onPrevious}>
      <ArrowLeft aria-hidden="true" className="size-4" /> Previous
    </button>
    <button type="button" disabled={busy || checking} className={`q-button q-button-secondary q-import-action ${hasDuplication ? 'q-import-keep' : ''}`} onClick={onNext}>
      {checking ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : hasDuplication ? <CheckCheck aria-hidden="true" className="size-4" /> : <ArrowRight aria-hidden="true" className="size-4" />}
      {checking ? 'Checking…' : hasDuplication ? 'Keep both' : 'Next'}
    </button>
    {hasDuplication && <button type="button" disabled={busy || checking} className="q-button q-button-secondary q-import-action q-import-compare col-span-2" onClick={onCompare}>
      <Eye aria-hidden="true" className="size-4" /> View the duplication
    </button>}
    {busy ? <div className="q-import-progress col-span-2" aria-busy="true">
      <div className="flex items-center justify-between gap-3">
        <output className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" /> {label}
        </output>
        {determinate && <span className="shrink-0 text-sm font-bold tabular-nums">{percent}%</span>}
      </div>
      <progress aria-label="Import upload progress" aria-valuetext={determinate ? `${saved} of ${total} batches saved` : label} max={total || 1} value={determinate ? saved : undefined} className="q-import-progress-bar mt-3 w-full" />
      <p className="mt-2 text-xs text-muted-foreground">{determinate ? `${saved} of ${total} batches saved · Please keep this window open.` : 'Please wait while your questions are checked and prepared.'}</p>
    </div> : <>
      {saved > 0 && total > 0 && <output className="col-span-2 text-sm text-muted-foreground">{saved} of {total} batches saved. Retry continues from the remaining batches.</output>}
      <button type="button" disabled={checking || saveDisabled} className="q-button q-button-primary q-import-action q-import-save col-span-2" onClick={onSave}>
        {saved > 0 ? <RotateCcw aria-hidden="true" className="size-5" /> : <Upload aria-hidden="true" className="size-5" />}
        {saved > 0 ? 'Retry remaining batches' : 'Save import'}
      </button>
    </>}
  </div>;
}
