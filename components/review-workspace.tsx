'use client';

/* oxlint-disable next/no-img-element */

import { Check, Clock3, FileCheck2, History, Menu, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import questionData from '@/data/questions.json';
import { reserveQuestionIds } from '@/lib/firebase-client';
import { canReviewBank, type AppUser, type CollaborationState, type Question, type QuestionProposal } from '@/lib/medguard-types';
import { cn } from '@/lib/utils';

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

function DiffField({ label, current, proposed }: { label: string; current: string; proposed: string }) {
  const changed = current !== proposed;
  return <div className="grid gap-2 sm:grid-cols-2"><div className="rounded-xl border bg-muted/25 p-3"><span className="text-xs font-bold uppercase text-muted-foreground">Current · {label}</span><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{current || '—'}</p></div><div className={cn('rounded-xl border p-3', changed ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10' : 'bg-muted/25')}><span className={cn('text-xs font-bold uppercase', changed ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')}>Proposed · {label}{changed ? ' · changed' : ''}</span><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{proposed || '—'}</p></div></div>;
}

export function ReviewWorkspace({ user, collaboration, update, embedded = false }: { user: AppUser; collaboration: CollaborationState; update: (updater: (current: CollaborationState) => CollaborationState) => void; embedded?: boolean }) {
  const [section, setSection] = useState<'pending' | 'reviewed'>('pending');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const reviewableBanks = useMemo(() => collaboration.qbanks.filter((bank) => canReviewBank(user, bank, collaboration.memberships)), [collaboration.memberships, collaboration.qbanks, user]);
  const bankIds = useMemo(() => new Set(reviewableBanks.map((bank) => bank.id)), [reviewableBanks]);
  const pending = collaboration.proposals.filter((proposal) => proposal.status === 'pending' && bankIds.has(proposal.qbankId));
  const reviewed = collaboration.proposals.filter((proposal) => proposal.status !== 'pending' && bankIds.has(proposal.qbankId)).sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''));
  const visible = section === 'pending' ? pending : reviewed;

  async function reviewProposal(proposal: QuestionProposal, status: 'approved' | 'rejected') {
    if (busyId) return;
    setBusyId(proposal.id); setError('');
    try {
      const baseQuestions = questionData as Question[];
      const reservedId = status === 'approved' && proposal.type === 'new_question'
        ? (await reserveQuestionIds(1, proposal.qbankId, user, [...baseQuestions, ...collaboration.approvedQuestions].map((item) => item.questionId)))[0]
        : undefined;
      update((current) => {
        const bank = current.qbanks.find((item) => item.id === proposal.qbankId);
        if (!bank || !canReviewBank(user, bank, current.memberships)) return current;
        let approvedQuestions = current.approvedQuestions;
        if (status === 'approved') {
          const available = [...baseQuestions.map((item) => ({ ...item, qbankId: item.qbankId ?? 'smle-gs' })), ...approvedQuestions];
          const existing = proposal.questionId ? available.find((item) => item.id === proposal.questionId) : undefined;
          const question: Question = {
            id: proposal.questionId ?? `shared-${crypto.randomUUID()}`,
            questionId: existing?.questionId ?? reservedId!,
            number: existing?.number ?? Math.max(0, ...available.filter((item) => item.qbankId === proposal.qbankId).map((item) => item.number)) + 1,
            qbankId: proposal.qbankId,
            specialty: proposal.payload.specialty,
            topic: proposal.payload.topic,
            stem: proposal.payload.stem,
            options: proposal.payload.options,
            answer: proposal.payload.answer,
            answerLetter: 'ABCD'[proposal.payload.answer],
            explanation: proposal.payload.explanation,
            sourceReference: proposal.payload.sourceReference,
            sourcePage: existing?.sourcePage ?? 0,
            sourceFile: existing?.sourceFile ?? proposal.payload.sourceReference,
            revision: (existing?.revision ?? 0) + 1,
            isCustom: true,
            images: proposal.payload.images ?? existing?.images ?? [],
          };
          approvedQuestions = [...approvedQuestions.filter((item) => item.id !== question.id), question];
        }
        const reviewedAt = new Date().toISOString();
        return {
          ...current,
          approvedQuestions,
          proposals: current.proposals.map((item) => item.id === proposal.id ? { ...item, status, reviewedById: user.uid, reviewedByName: user.displayName, reviewedAt } : item),
          auditLog: [{ id: crypto.randomUUID(), action: `question_proposal_${status}`, entityType: 'question', entityId: proposal.id, actorId: user.uid, actorName: user.displayName, createdAt: reviewedAt, detail: `${proposal.editKinds.join(', ')} by ${proposal.proposedByName}.` }, ...current.auditLog],
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to review this question.');
    } finally {
      setBusyId('');
    }
  }

  return <>
    {!embedded && <header className="sticky top-0 z-30 border-b bg-card/90 px-4 py-4 backdrop-blur-xl sm:px-7"><div className="mx-auto flex max-w-[1180px] items-center gap-3"><button aria-label="Open navigation" onClick={() => window.dispatchEvent(new Event('medguard-open-menu'))} className="grid size-10 place-items-center rounded-xl border lg:hidden"><Menu className="size-5" /></button><div><h1 className="font-bold">Review</h1><p className="text-sm text-muted-foreground">Review new questions and proposed changes for your assigned QBanks.</p></div></div></header>}
    <div className={cn('mx-auto max-w-[1180px]', embedded ? '' : 'p-4 sm:p-7')}>
      <div className="mb-5 flex gap-2"><button onClick={() => setSection('pending')} className={cn('inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-bold', section === 'pending' && 'border-primary bg-primary text-primary-foreground')}><Clock3 className="size-4" />New · {pending.length}</button><button onClick={() => setSection('reviewed')} className={cn('inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-bold', section === 'reviewed' && 'border-primary bg-primary text-primary-foreground')}><History className="size-4" />Reviewed · {reviewed.length}</button></div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      <section className="space-y-4">{visible.length ? visible.map((proposal) => {
        const current = proposal.currentSnapshot ?? proposal.payload;
        const bank = collaboration.qbanks.find((item) => item.id === proposal.qbankId);
        return <article key={proposal.id} className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">{proposal.type === 'new_question' ? 'NEW QUESTION' : 'SUGGEST EDIT'}</span>{proposal.editKinds.map((kind) => <span key={kind} className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold">{kind.replaceAll('_', ' ')}</span>)}<span className="ml-auto text-sm text-muted-foreground">{bank?.shortName} · {proposal.proposedByName} · {formatDate(proposal.proposedAt)}</span></div><div className="mt-5 space-y-3"><DiffField label="Question" current={current.stem} proposed={proposal.payload.stem} /><DiffField label="Options" current={current.options.map((item, index) => `${'ABCD'[index]}. ${item}`).join('\n')} proposed={proposal.payload.options.map((item, index) => `${'ABCD'[index]}. ${item}`).join('\n')} /><DiffField label="Correct answer" current={'ABCD'[current.answer]} proposed={'ABCD'[proposal.payload.answer]} /><DiffField label="Explanation" current={current.explanation} proposed={proposal.payload.explanation} /><DiffField label="Source" current={current.sourceReference} proposed={proposal.payload.sourceReference} /></div>{proposal.payload.images?.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{proposal.payload.images.map((image) => <figure key={image.id} className="overflow-hidden rounded-xl border bg-muted/20"><img src={image.url} alt={image.caption || image.name} className="aspect-video w-full object-contain" /><figcaption className="p-2 text-xs text-muted-foreground">{image.caption || image.name}</figcaption></figure>)}</div>}<p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"><strong>Submitter rationale:</strong> {proposal.rationale}</p>{proposal.status === 'pending' ? <div className="mt-5 flex justify-end gap-2"><button disabled={Boolean(busyId)} onClick={() => void reviewProposal(proposal, 'rejected')} className="h-10 rounded-xl border px-4 text-sm font-bold text-red-600 disabled:opacity-50"><X className="mr-1 inline size-4" />Reject</button><button disabled={Boolean(busyId)} onClick={() => void reviewProposal(proposal, 'approved')} className="h-10 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"><Check className="mr-1 inline size-4" />Approve changes</button></div> : <div className="mt-5 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground"><FileCheck2 className="size-4" /><strong className={proposal.status === 'approved' ? 'text-emerald-600' : 'text-red-600'}>{proposal.status.toUpperCase()}</strong> by {proposal.reviewedByName} · {formatDate(proposal.reviewedAt)}</div>}</article>;
      }) : <div className="grid min-h-64 place-items-center rounded-2xl bg-card text-sm text-muted-foreground ring-1 ring-border"><div className="text-center"><FileCheck2 className="mx-auto mb-3 size-9 text-emerald-500" />{section === 'pending' ? 'No new questions are waiting for review.' : 'No reviewed questions yet.'}</div></div>}</section>
    </div>
  </>;
}
