'use client';
/* oxlint-disable next/no-img-element */
import { useState } from 'react';
import { Check, Copy, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/cloudflare-client';
import { optionLabel, type Question } from '@/lib/medguard-types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export function QuestionOption({text,index,selected=false,correct=false,wrong=false,revealed=false,percent,onSelect}:{text:string;index:number;selected?:boolean;correct?:boolean;wrong?:boolean;revealed?:boolean;percent?:number;onSelect:()=>void}) {
  return <button disabled={revealed} aria-pressed={selected} onClick={onSelect} className={cn('q-answer-option flex min-h-14 w-full items-start gap-3 rounded-xl border p-4 text-start text-base leading-7 transition',correct?'border-emerald-400 bg-emerald-50 text-emerald-950 dark:bg-emerald-500/10 dark:text-emerald-100':wrong?'border-red-400 bg-red-50 text-red-950 dark:bg-red-500/10 dark:text-red-100':selected?'border-primary bg-primary/5 ring-2 ring-primary/10':'bg-card hover:border-primary/35 hover:bg-primary/[0.025]')}><span className={cn('grid size-7 shrink-0 place-items-center rounded-full border text-xs font-bold',correct?'border-emerald-500 bg-emerald-500 text-white':wrong?'border-red-500 bg-red-500 text-white':selected?'border-primary bg-primary text-white':'bg-muted/40')}>{correct?<Check className="size-4"/>:wrong?<X className="size-4"/>:optionLabel(index)}</span><span dir="auto" className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-0.5">{text}</span>{revealed&&percent!==undefined&&<span className="mt-0.5 rounded-full bg-card/80 px-2.5 py-0.5 text-xs font-bold tabular-nums ring-1 ring-current/10">{percent}%</span>}</button>;
}

export function QuestionId({
  value,
  onOpen,
  compact = false,
}: {
  value: string;
  onOpen?: () => void;
  compact?: boolean;
}) {
  const [message, setMessage] = useState('');
  const id = value.replace(/^#/, '');
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2 text-xs">
      <span className={compact ? 'sr-only' : 'text-muted-foreground'}>Question ID</span>
      {onOpen && id !== 'deleted' ? (
        <button className="font-mono font-bold text-primary" onClick={onOpen}>
          #{id}
        </button>
      ) : (
        <strong className="font-mono text-primary">#{id}</strong>
      )}
      {id !== 'deleted' && (
        <button
          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-primary hover:bg-primary/10"
          aria-label="Copy ID"
          onClick={() => {
            navigator.clipboard
              .writeText(id)
              .then(() => setMessage('Question ID copied'))
              .catch(() => setMessage('Copy failed. Select the ID to copy.'));
          }}
        >
          <Copy className="size-3.5" />
          <span className={compact ? 'sr-only' : undefined}>Copy ID</span>
        </button>
      )}
      <output className={compact ? 'sr-only' : 'text-xs text-emerald-600'}>{message}</output>
    </span>
  );
}

export function QuestionPreview() {
  const [id, setId] = useState(''),
    [question, setQuestion] = useState<Question>(),
    [details, setDetails] = useState<Record<string, string> | null>(null),
    [mode, setMode] = useState('student'),
    [selected, setSelected] = useState<number>(),
    [image, setImage] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function search() {
    setBusy(true);
    setError('');
    setQuestion(undefined);
    try {
      const r = await api<{
        question: Question;
        details: Record<string, string> | null;
      }>(`/platform/question?id=${encodeURIComponent(id)}`);
      setQuestion(r.question);
      setDetails(r.details);
      setSelected(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Question not found');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mb-5 rounded-2xl border bg-card p-4 sm:p-6">
      <h2 className="font-bold">Preview by Question ID</h2>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          aria-label="Question ID"
          className="min-w-0 flex-1 rounded-xl border bg-background px-3"
          placeholder="#00125"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <button
          disabled={busy || !id.trim()}
          className="q-button bg-primary text-primary-foreground"
        >
          <Search className="size-4" />
          {busy ? 'Loading…' : 'Preview'}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-destructive">
          {error}
        </p>
      )}
      {question && (
        <>
          <div className="my-4 flex flex-wrap gap-2">
            <button
              className="q-button border"
              aria-pressed={mode === 'student'}
              onClick={() => setMode('student')}
            >
              Student Preview
            </button>
            {details && (
              <button
                className="q-button border"
                aria-pressed={mode === 'details'}
                onClick={() => setMode('details')}
              >
                Question Details
              </button>
            )}
          </div>
          <QuestionId value={question.questionId} />
          {mode === 'details' && details ? (
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              {Object.entries(details).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="break-words">{v || '—'}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <article className="q-student-preview">
              <p
                dir="auto"
                className="my-5 select-text whitespace-pre-wrap break-words text-base leading-[1.85] text-[#1d2e40] dark:text-foreground"
              >
                {question.stem}
              </p>
              {question.images?.map((i) => (
                <button
                  key={i.id}
                  className="block max-w-full"
                  onClick={() => setImage(i.url)}
                >
                  <img
                    src={i.url}
                    alt={i.caption || i.name}
                    className="max-h-96 max-w-full rounded-xl object-contain"
                  />
                </button>
              ))}
              <div className="space-y-3">
                {question.options.map((o, i) => (
                    <QuestionOption key={i} text={o} index={i} selected={selected===i} onSelect={()=>setSelected(i)} />
                ))}
              </div>
            </article>
          )}
        </>
      )}
      <Dialog
        open={Boolean(image)}
        onOpenChange={(o) => {
          if (!o) setImage('');
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogTitle>Question image</DialogTitle>
          <img
            src={image || undefined}
            alt="Enlarged question illustration"
            className="max-h-[75dvh] w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
