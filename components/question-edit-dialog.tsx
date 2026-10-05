'use client';

import { Check, FileText, MessageSquareText, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { QuestionSourceFields } from '@/components/question-source-fields';
import { optionLabel, type ProposalEditKind } from '@/lib/medguard-types';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { ExplanationImageEditor } from '@/components/explanation-image-editor';
import type { NoteImage } from '@/lib/medguard-types';
import { PROPOSAL_EDIT_KINDS } from '@/features/contributions/domain/proposal-filters';

export interface QuestionEditDraft {
  stem: string;
  options: string[];
  answer: number | undefined;
  explanation: string;
  explanationImages: NoteImage[];
  sourceFile: string;
  sourcePage: string;
  rationale: string;
  kinds: ProposalEditKind[];
}

export function QuestionEditDialog({ open, onClose, questionNumber, immediate, draft, onChange, busy, error, onSubmit, uid, qbankId, questionId }: {
  open: boolean;
  onClose: () => void;
  questionNumber: number;
  immediate: boolean;
  draft: QuestionEditDraft;
  onChange: (changes: Partial<QuestionEditDraft>) => void;
  busy: boolean;
  error: string;
  onSubmit: () => Promise<void>;
  uid: string;
  qbankId: string;
  questionId: string;
}) {
  const [imagesBusy, setImagesBusy] = useState(false);
  const blocked = busy || imagesBusy;
  const valid = draft.stem.trim() && draft.sourceFile.trim() && draft.rationale.trim()
    && draft.kinds.length > 0 && draft.options.length >= 2 && draft.options.length <= 10
    && draft.options.every(option => option.trim()) && draft.answer !== undefined
    && draft.answer >= 0 && draft.answer < draft.options.length;

  function removeOption(index: number) {
    const answer = draft.answer === undefined ? undefined
      : draft.answer === index ? 0 : draft.answer > index ? draft.answer - 1 : draft.answer;
    onChange({ options: draft.options.filter((_, i) => i !== index), answer });
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !blocked) onClose(); }}>
      <DialogContent showCloseButton={false} className="q-question-edit-dialog flex h-[min(920px,calc(100dvh-2rem))] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-6xl">
        <form onSubmit={event => { event.preventDefault(); if (valid && !blocked) void onSubmit(); }} className="flex min-h-0 flex-1 flex-col">
          <header className="q-edit-dialog-header flex shrink-0 items-start justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Question {questionNumber} · {immediate ? 'Direct edit' : 'Edit request'}</p>
              <DialogTitle className="mt-1 text-xl font-bold leading-tight">{immediate ? 'Edit question' : 'Suggest an edit'}</DialogTitle>
              <DialogDescription className="mt-1.5 text-xs leading-5">{immediate ? 'Changes are saved immediately.' : 'Your suggestion will be reviewed before publishing.'}</DialogDescription>
            </div>
            <button type="button" disabled={blocked} onClick={onClose} aria-label="Close question edit" className="q-edit-dialog-close"><X className="size-5" /></button>
          </header>

          <fieldset disabled={busy} className="q-edit-dialog-body min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
            <section className="q-edit-panel mb-5" aria-labelledby="edit-kind-heading">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 id="edit-kind-heading" className="q-edit-heading">What needs to change?</h3>
                <span className="q-edit-field-note">Select one or more</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {PROPOSAL_EDIT_KINDS.map(([kind, label]) => (
                  <button key={kind} type="button" aria-pressed={draft.kinds.includes(kind)} onClick={() => onChange({ kinds: draft.kinds.includes(kind) ? draft.kinds.filter(value => value !== kind) : [...draft.kinds, kind] })} className={cn('q-edit-kind', draft.kinds.includes(kind) && 'q-edit-kind-selected')}>
                    {draft.kinds.includes(kind) && <Check className="size-3.5" />}{label}
                  </button>
                ))}
              </div>
            </section>

            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-5">
                <section className="q-edit-panel" aria-labelledby="edit-content-heading">
                  <h3 id="edit-content-heading" className="q-edit-heading mb-4"><FileText className="size-4 text-primary" />Question content</h3>
                  <label className="block">
                    <span className="q-edit-label">Proposed question text <span className="q-edit-field-note">Required</span></span>
                    <textarea required dir="auto" rows={5} value={draft.stem} onChange={event => onChange({ stem: event.target.value })} className="q-edit-input min-h-32 w-full resize-y" />
                    <span className="mt-2 block text-xs text-muted-foreground">Use **text** for bold in the question and explanation.</span>
                  </label>
                  <div className="mt-5">
                    <div className="q-edit-label">Answer options <span className="q-edit-field-note">{draft.options.length} / 10</span></div>
                    <p className="mb-3 text-xs leading-5 text-muted-foreground">Select the letter beside the correct answer.</p>
                    <div className="space-y-2.5">
                      {draft.options.map((option, index) => (
                        <div key={index} className={cn('q-edit-option', draft.answer === index && 'q-edit-option-correct')}>
                          <label className="q-question-answer-selector">
                            <input type="radio" name="proposed-correct-answer" checked={draft.answer === index} onChange={() => onChange({ answer: index })} aria-label={`Mark proposed option ${optionLabel(index)} as correct`} className="peer sr-only" />
                            <span className="q-question-answer-letter peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary">{optionLabel(index)}</span>
                          </label>
                          <div className="min-w-0 flex-1">
                            <textarea required dir="auto" rows={1} value={option} aria-label={`Proposed option ${optionLabel(index)}`} onChange={event => onChange({ options: draft.options.map((value, i) => i === index ? event.target.value : value) })} className="q-edit-option-input w-full resize-y" />
                            {draft.answer === index && <span className="q-edit-correct-label"><Check className="size-3.5" />Correct answer</span>}
                          </div>
                          <button type="button" aria-label={`Remove proposed option ${optionLabel(index)}`} title={`Remove option ${optionLabel(index)}`} disabled={draft.options.length <= 2} onClick={() => removeOption(index)} className="q-question-remove-option disabled:opacity-30"><Trash2 className="size-4" /></button>
                        </div>
                      ))}
                    </div>
                    <button type="button" disabled={draft.options.length >= 10} onClick={() => onChange({ options: [...draft.options, ''] })} className="q-edit-add-option mt-3"><Plus className="size-4" />Add option</button>
                  </div>
                </section>

                <section className="q-edit-panel">
                  <label className="block">
                    <span className="q-edit-label">Explanation <span className="q-edit-field-note">Optional</span></span>
                    <textarea dir="auto" rows={4} value={draft.explanation} onChange={event => onChange({ explanation: event.target.value })} placeholder="Explain the medically correct answer." className="q-edit-input min-h-28 w-full resize-y" />
                  </label>
                  {!draft.explanation.trim() && <p className="mt-2 text-xs leading-5 text-muted-foreground">You can save without an explanation. Leaving this empty removes the existing explanation text.</p>}
                  <ExplanationImageEditor key={`${qbankId}:${questionId}`} uid={uid} qbankId={qbankId} questionId={questionId} images={draft.explanationImages} onChange={explanationImages => onChange({ explanationImages })} onBusyChange={setImagesBusy} disabled={busy} />
                </section>
              </div>

              <aside className="min-w-0 space-y-5" aria-label="Source and change details">
                <section className="q-edit-panel q-edit-source-fields">
                  <h3 className="q-edit-heading mb-4">Source details</h3>
                  <QuestionSourceFields sourceFile={draft.sourceFile} sourcePage={draft.sourcePage} onChange={source => onChange(source)} />
                </section>
                <section className="q-edit-panel">
                  <label className="block">
                    <span className="q-edit-label"><span className="flex items-center gap-2"><MessageSquareText className="size-4 text-primary" />Reason for the change</span><span className="q-edit-field-note">Required</span></span>
                    <p className="mb-3 text-xs leading-5 text-muted-foreground">{immediate ? 'Describe the correction for the change record.' : 'Give the reviewer enough context to decide.'}</p>
                    <textarea required dir="auto" rows={5} value={draft.rationale} onChange={event => onChange({ rationale: event.target.value })} placeholder={immediate ? 'Describe your correction.' : 'Explain what should change and why.'} className="q-edit-input min-h-32 w-full resize-y" />
                  </label>
                </section>
                <div className={cn('q-edit-workflow-note', immediate && 'q-edit-workflow-immediate')}>
                  <ShieldCheck className="size-5 shrink-0" />
                  <div><strong className="block text-xs font-bold">{immediate ? 'Saved immediately' : 'Reviewed before publishing'}</strong><p className="mt-1 text-xs leading-5">{immediate ? 'No review is required. Existing pending proposals can replace these changes when accepted.' : 'An authorized reviewer will compare your proposed changes before approving or rejecting them.'}</p></div>
                </div>
              </aside>
            </div>
          </fieldset>

          <footer className="q-edit-dialog-footer shrink-0 px-4 py-3 sm:px-6 sm:py-4">
            {error && <p role="alert" className="mb-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">{error}</p>}
            <div className="flex flex-wrap items-center justify-end gap-3">
              <p className="mr-auto text-xs text-muted-foreground">{immediate ? 'Changes apply to this question.' : 'Your request stays pending until reviewed.'}</p>
              <button type="button" disabled={blocked} onClick={onClose} className="q-button q-button-secondary">Cancel</button>
              <button type="submit" disabled={blocked || !valid} className="q-button q-button-primary"><Save className="size-4" />{busy ? 'Saving…' : immediate ? 'Save changes now' : 'Submit for review'}</button>
            </div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
