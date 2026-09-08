'use client';

/* oxlint-disable next/no-img-element */

import {
  Check,
  CheckSquare2,
  Clock3,
  FileCheck2,
  FileJson,
  History,
  Layers3,
  ListChecks,
  Menu,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { QuestionPreview } from '@/components/question-tools';
import { api } from '@/lib/api-client';
import { loadCollaborationState } from '@/lib/application-services';
import { subscribeLive } from '@/lib/realtime-client';
import {
  canReviewBank,
  optionLabel,
  type AppUser,
  type CollaborationState,
  type QuestionProposal,
} from '@/lib/medguard-types';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function formatDate(value?: string) {
  return value
    ? new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : '—';
}

function DiffField({
  label,
  current,
  proposed,
}: {
  label: string;
  current: string;
  proposed: string;
}) {
  const changed = current !== proposed;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-xl border bg-muted/25 p-3">
        <span className="text-xs font-bold uppercase text-muted-foreground">
          Current · {label}
        </span>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
          {current || '—'}
        </p>
      </div>
      <div
        className={cn(
          'rounded-xl border p-3',
          changed
            ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10'
            : 'bg-muted/25',
        )}
      >
        <span
          className={cn(
            'text-xs font-bold uppercase',
            changed
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-muted-foreground',
          )}
        >
          Proposed · {label}
          {changed ? ' · changed' : ''}
        </span>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
          {proposed || '—'}
        </p>
      </div>
    </div>
  );
}

function proposalMethod(proposal: QuestionProposal): 'json' | 'manual' {
  return proposal.submissionMethod === 'json' ||
    Boolean(proposal.importBatchId) ||
    proposal.rationale === 'Imported from JSON.'
    ? 'json'
    : 'manual';
}

export function ReviewWorkspace({
  user,
  collaboration,
  update: _update,
  replaceFromServer,
  activeQBankId,
  embedded = false,
}: {
  user: AppUser;
  collaboration: CollaborationState;
  update: (
    updater: (current: CollaborationState) => CollaborationState,
  ) => void;
  replaceFromServer: (next: CollaborationState) => void;
  activeQBankId?: string;
  embedded?: boolean;
}) {
  const [section, setSection] = useState<'pending' | 'reviewed'>('pending');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [historyPreference, setHistoryPreference] = useState<{
    userId: string;
    clearedAt: string;
  }>();
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedProposalIds, setSelectedProposalIds] = useState<string[]>([]);
  const [latestCount, setLatestCount] = useState('20');
  const [submitterPreset, setSubmitterPreset] = useState('');
  const [methodPreset, setMethodPreset] = useState('');
  const [bulkDecision, setBulkDecision] = useState<'approved' | 'rejected'>();
  const [bulkBusy, setBulkBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await api<{ clearedAt: string }>(
          '/platform/review-history',
        );
        if (active)
          setHistoryPreference((previous) => ({
            userId: user.uid,
            clearedAt:
              previous?.userId === user.uid &&
              previous.clearedAt > result.clearedAt
                ? previous.clearedAt
                : result.clearedAt,
          }));
      } catch {
        if (active)
          setError(
            'Unable to load your review history preferences. Please try again.',
          );
      }
    };
    void load();
    const unsubscribe = subscribeLive(() => void load());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user.uid]);
  async function clearHistory() {
    if (
      clearing ||
      !window.confirm(
        'Clear your review history? This only clears history for your account. Questions, review decisions and other accounts are unaffected.',
      )
    )
      return;
    setClearing(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ clearedAt: string }>(
        '/platform/review-history',
        { method: 'POST', body: '{}' },
      );
      setHistoryPreference({ userId: user.uid, clearedAt: result.clearedAt });
      setNotice('تم مسح سجل المراجعة لحسابك فقط.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to clear history.');
    } finally {
      setClearing(false);
    }
  }
  const reviewableBanks = useMemo(
    () =>
      collaboration.qbanks.filter(
        (bank) =>
          (!activeQBankId || bank.id === activeQBankId) &&
          canReviewBank(user, bank, collaboration.memberships),
      ),
    [activeQBankId, collaboration.memberships, collaboration.qbanks, user],
  );
  const bankIds = useMemo(
    () => new Set(reviewableBanks.map((bank) => bank.id)),
    [reviewableBanks],
  );
  const pending = collaboration.proposals
    .filter(
      (proposal) =>
        proposal.status === 'pending' &&
        proposal.proposedById !== user.uid &&
        bankIds.has(proposal.qbankId),
    )
    .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
  const historyReady = historyPreference?.userId === user.uid;
  const reviewed = collaboration.proposals
    .filter(
      (proposal) =>
        historyReady &&
        proposal.status !== 'pending' &&
        proposal.reviewedById === user.uid &&
        bankIds.has(proposal.qbankId) &&
        (!historyPreference.clearedAt ||
          (proposal.reviewedAt ?? '') > historyPreference.clearedAt),
    )
    .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''));
  const visible = section === 'pending' ? pending : reviewed;
  const selectedProposals = pending.filter((proposal) =>
    selectedProposalIds.includes(proposal.id),
  );
  const submitters = [
    ...new Map(
      pending.map((proposal) => [
        proposal.proposedById,
        proposal.proposedByName,
      ]),
    ).entries(),
  ];

  function selectProposals(proposals: QuestionProposal[]) {
    setSelectedProposalIds(
      proposals.slice(0, 200).map((proposal) => proposal.id),
    );
    setSection('pending');
  }

  function toggleProposal(id: string) {
    setSelectedProposalIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function submitBulkReview() {
    if (!bulkDecision || !selectedProposals.length || bulkBusy) return;
    setBulkBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ reviewed: number; awaitingSecondReview: number }>('/platform/bulk-review', {
        method: 'POST',
        body: JSON.stringify({
          proposalIds: selectedProposals.map((proposal) => proposal.id),
          status: bulkDecision,
        }),
      });
      const next = await loadCollaborationState(user);
      replaceFromServer(next);
      setSelectedProposalIds([]);
      setSubmitterPreset('');
      setMethodPreset('');
      setBulkDecision(undefined);
      setNotice(
        `${result.reviewed} questions ${bulkDecision === 'approved' ? 'approved' : 'rejected'} successfully.${result.awaitingSecondReview ? ` ${result.awaitingSecondReview} high-risk changes await a second independent reviewer.` : ''}`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to complete the bulk review.',
      );
      setBulkDecision(undefined);
    } finally {
      setBulkBusy(false);
    }
  }

  async function reviewProposal(
    proposal: QuestionProposal,
    status: 'approved' | 'rejected',
  ) {
    if (busyId) return;
    setBusyId(proposal.id);
    setError('');
    setNotice('');
    try {
      const result = await api<{ reviewed: number; awaitingSecondReview: number }>(
        '/platform/bulk-review',
        {
          method: 'POST',
          body: JSON.stringify({ proposalIds: [proposal.id], status }),
        },
      );
      replaceFromServer(await loadCollaborationState(user));
      setNotice(
        result.awaitingSecondReview
          ? 'First approval recorded. This high-risk medical change now requires a second independent reviewer.'
          : `Question ${status} successfully.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to review this question.',
      );
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      {!embedded && (
        <header className="workspace-header">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-label="Open navigation"
              onClick={() =>
                window.dispatchEvent(new Event('medguard-open-menu'))
              }
              className="grid size-10 place-items-center rounded-xl border lg:hidden"
            >
              <Menu className="size-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold tracking-tight">
                Review
              </h1>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Compare each change, check its source, then approve or return
                it.
              </p>
            </div>
          </div>
        </header>
      )}
      <div
        className={cn('mx-auto max-w-[1180px]', embedded ? '' : 'p-4 sm:p-7')}
      >
        <QuestionPreview />
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            aria-pressed={section === 'pending'}
            onClick={() => setSection('pending')}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-bold',
              section === 'pending' &&
                'border-primary bg-primary text-primary-foreground',
            )}
          >
            <Clock3 className="size-4" />
            Awaiting review · {pending.length}
          </button>
          <button
            aria-pressed={section === 'reviewed'}
            onClick={() => setSection('reviewed')}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-bold',
              section === 'reviewed' &&
                'border-primary bg-primary text-primary-foreground',
            )}
          >
            <History className="size-4" />
            Reviewed · {historyReady ? reviewed.length : '…'}
          </button>
          {section === 'reviewed' && (
            <button
              type="button"
              disabled={clearing || !historyReady || !reviewed.length}
              onClick={() => void clearHistory()}
              className="q-button q-button-secondary"
            >
              {clearing ? 'Clearing…' : 'Clear history'}
            </button>
          )}
        </div>
        {section === 'pending' && pending.length > 0 && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-violet-500/5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-primary/15 p-4 sm:p-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                  <CheckSquare2 className="size-5" />
                </span>
                <div>
                  <h2 className="font-bold">Bulk review</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Select a trusted batch, submitter, method, or the newest
                    questions—then approve or reject once.
                  </p>
                </div>
              </div>
              <div className="rounded-xl bg-card px-4 py-2 text-center ring-1 ring-border">
                <strong className="block text-xl tabular-nums text-primary">
                  {selectedProposals.length}
                </strong>
                <span className="text-xs text-muted-foreground">selected</span>
              </div>
            </div>
            <div className="grid gap-3 p-4 sm:p-5 lg:grid-cols-3">
              <label className="min-w-0 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <span className="mb-2 flex items-center gap-2">
                  <UserRound className="size-4" /> Submitter
                </span>
                <select
                  value={submitterPreset}
                  onChange={(event) => {
                    const id = event.target.value;
                    setSubmitterPreset(id);
                    if (id)
                      selectProposals(
                        pending.filter(
                          (proposal) => proposal.proposedById === id,
                        ),
                      );
                  }}
                  className="h-11 w-full rounded-xl border bg-card px-3 text-sm font-semibold normal-case text-foreground"
                >
                  <option value="">Choose a submitter…</option>
                  {submitters.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name} ·{' '}
                      {
                        pending.filter(
                          (proposal) => proposal.proposedById === id,
                        ).length
                      }
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-0 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <span className="mb-2 flex items-center gap-2">
                  <FileJson className="size-4" /> Submission method
                </span>
                <select
                  value={methodPreset}
                  onChange={(event) => {
                    const method = event.target.value;
                    setMethodPreset(method);
                    if (method === 'json' || method === 'manual')
                      selectProposals(
                        pending.filter(
                          (proposal) => proposalMethod(proposal) === method,
                        ),
                      );
                  }}
                  className="h-11 w-full rounded-xl border bg-card px-3 text-sm font-semibold normal-case text-foreground"
                >
                  <option value="">Choose a method…</option>
                  <option value="json">
                    JSON import ·{' '}
                    {
                      pending.filter(
                        (proposal) => proposalMethod(proposal) === 'json',
                      ).length
                    }
                  </option>
                  <option value="manual">
                    Manual submission ·{' '}
                    {
                      pending.filter(
                        (proposal) => proposalMethod(proposal) === 'manual',
                      ).length
                    }
                  </option>
                </select>
              </label>
              <div className="min-w-0 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <span className="mb-2 flex items-center gap-2">
                  <Layers3 className="size-4" /> Newest questions
                </span>
                <div className="flex gap-2">
                  <input
                    aria-label="Number of newest questions"
                    type="number"
                    min={1}
                    max={Math.min(200, pending.length)}
                    value={latestCount}
                    onChange={(event) => setLatestCount(event.target.value)}
                    className="h-11 min-w-0 flex-1 rounded-xl border bg-card px-3 text-sm font-semibold normal-case text-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const count = Math.max(
                        1,
                        Math.min(200, pending.length, Number(latestCount) || 1),
                      );
                      setLatestCount(String(count));
                      selectProposals(pending.slice(0, count));
                    }}
                    className="q-button q-button-secondary whitespace-nowrap"
                  >
                    Select latest
                  </button>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-primary/15 bg-card/60 p-4 sm:px-5">
              <button
                type="button"
                onClick={() => selectProposals(pending)}
                className="q-button q-button-secondary"
              >
                <ListChecks className="size-4" /> Select{' '}
                {pending.length > 200 ? 'first 200' : `all ${pending.length}`}
              </button>
              <button
                type="button"
                disabled={!selectedProposals.length}
                onClick={() => setSelectedProposalIds([])}
                className="q-button q-button-secondary"
              >
                Clear
              </button>
              <span className="hidden flex-1 sm:block" />
              <button
                type="button"
                disabled={!selectedProposals.length || bulkBusy}
                onClick={() => setBulkDecision('rejected')}
                className="q-button q-button-danger"
              >
                <X className="size-4" /> Reject selected
              </button>
              <button
                type="button"
                disabled={!selectedProposals.length || bulkBusy}
                onClick={() => setBulkDecision('approved')}
                className="q-button q-button-study"
              >
                <Check className="size-4" /> Approve selected
              </button>
            </div>
          </section>
        )}
        {notice && (
          <output className="mb-4 block text-sm text-emerald-600" dir="auto">
            {notice}
          </output>
        )}
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
          >
            {error}
          </p>
        )}
        <section className="space-y-4">
          {visible.length ? (
            visible.map((proposal) => {
              const current = proposal.currentSnapshot ?? proposal.payload;
              const bank = collaboration.qbanks.find(
                (item) => item.id === proposal.qbankId,
              );
              return (
                <article
                  key={proposal.id}
                  className={cn(
                    'rounded-2xl bg-card p-5 ring-1 sm:p-6',
                    selectedProposalIds.includes(proposal.id)
                      ? 'ring-2 ring-primary shadow-md shadow-primary/10'
                      : 'ring-border',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {proposal.status === 'pending' && (
                      <label
                        className="grid size-9 cursor-pointer place-items-center rounded-xl border bg-background"
                        title="Select for bulk review"
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select proposal by ${proposal.proposedByName}`}
                          checked={selectedProposalIds.includes(proposal.id)}
                          onChange={() => toggleProposal(proposal.id)}
                          className="size-4 accent-primary"
                        />
                      </label>
                    )}
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                      {proposal.type === 'new_question'
                        ? 'NEW QUESTION'
                        : 'SUGGEST EDIT'}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-xs font-bold',
                        proposalMethod(proposal) === 'json'
                          ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
                          : 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
                      )}
                    >
                      {proposalMethod(proposal) === 'json'
                        ? 'JSON IMPORT'
                        : 'MANUAL'}
                    </span>
                    {proposal.editKinds.map((kind) => (
                      <span
                        key={kind}
                        className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold"
                      >
                        {kind.replaceAll('_', ' ')}
                      </span>
                    ))}
                    {proposal.duplicateInfo && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                        Possible duplicate · {proposal.duplicateInfo.similarity}%
                      </span>
                    )}
                    <span className="ml-auto text-sm text-muted-foreground">
                      {bank?.shortName} · {proposal.proposedByName} ·{' '}
                      {formatDate(proposal.proposedAt)}
                    </span>
                  </div>
                  <div className="mt-5 space-y-3">
                    <DiffField
                      label="Question"
                      current={current.stem}
                      proposed={proposal.payload.stem}
                    />
                    <DiffField
                      label="Options"
                      current={current.options
                        .map((item, index) => `${optionLabel(index)}. ${item}`)
                        .join('\n')}
                      proposed={proposal.payload.options
                        .map((item, index) => `${optionLabel(index)}. ${item}`)
                        .join('\n')}
                    />
                    <DiffField
                      label="Correct answer"
                      current={optionLabel(current.answer)}
                      proposed={optionLabel(proposal.payload.answer)}
                    />
                    <DiffField
                      label="Explanation"
                      current={current.explanation}
                      proposed={proposal.payload.explanation}
                    />
                    <DiffField
                      label="Source"
                      current={current.sourceReference}
                      proposed={proposal.payload.sourceReference}
                    />
                  </div>
                  {proposal.payload.images?.length > 0 && (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {proposal.payload.images.map((image) => (
                        <figure
                          key={image.id}
                          className="overflow-hidden rounded-xl border bg-muted/20"
                        >
                          <img
                            src={image.url}
                            alt={image.caption || image.name}
                            className="aspect-video w-full object-contain"
                          />
                          <figcaption className="p-2 text-xs text-muted-foreground">
                            {image.caption || image.name}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                  <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                    <strong>Submitter rationale:</strong> {proposal.rationale}
                  </p>
                  {proposal.status === 'pending' ? (
                    <div className="mt-5 flex justify-end gap-2">
                      <button
                        disabled={Boolean(busyId)}
                        onClick={() =>
                          void reviewProposal(proposal, 'rejected')
                        }
                        className="q-button q-button-danger"
                      >
                        <X className="mr-1 inline size-4" />
                        Reject
                      </button>
                      <button
                        disabled={Boolean(busyId)}
                        onClick={() =>
                          void reviewProposal(proposal, 'approved')
                        }
                        className="q-button q-button-study"
                      >
                        <Check className="mr-1 inline size-4" />
                        Approve changes
                      </button>
                    </div>
                  ) : (
                    <div className="mt-5 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
                      <FileCheck2 className="size-4" />
                      <strong
                        className={
                          proposal.status === 'approved'
                            ? 'text-emerald-600 dark:text-emerald-300'
                            : 'text-red-600 dark:text-red-300'
                        }
                      >
                        {proposal.status.toUpperCase()}
                      </strong>{' '}
                      by {proposal.reviewedByName} ·{' '}
                      {formatDate(proposal.reviewedAt)}
                    </div>
                  )}
                </article>
              );
            })
          ) : (
            <div className="grid min-h-64 place-items-center rounded-2xl bg-card text-sm text-muted-foreground ring-1 ring-border">
              <div className="text-center">
                <FileCheck2 className="mx-auto mb-3 size-9 text-emerald-500" />
                {section === 'pending'
                  ? 'No new questions are waiting for review.'
                  : 'No reviewed questions yet.'}
              </div>
            </div>
          )}
        </section>
      </div>
      <AlertDialog
        open={Boolean(bulkDecision)}
        onOpenChange={(open) => {
          if (!open && !bulkBusy) setBulkDecision(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia
              className={
                bulkDecision === 'approved'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
              }
            >
              {bulkDecision === 'approved' ? (
                <CheckSquare2 className="size-5" />
              ) : (
                <X className="size-5" />
              )}
            </AlertDialogMedia>
            <AlertDialogTitle>
              {bulkDecision === 'approved' ? 'Approve' : 'Reject'}{' '}
              {selectedProposals.length} selected questions?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDecision === 'approved'
                ? 'The selected questions will be published together with permanent Question IDs and your reviewer attribution.'
                : 'The selected proposals will be rejected together and remain visible in your review history.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl bg-muted p-3 text-sm">
            <strong>
              {
                new Set(
                  selectedProposals.map((proposal) => proposal.proposedById),
                ).size
              }
            </strong>{' '}
            submitter(s) ·{' '}
            <strong>
              {
                selectedProposals.filter(
                  (proposal) => proposalMethod(proposal) === 'json',
                ).length
              }
            </strong>{' '}
            from JSON ·{' '}
            <strong>
              {
                new Set(selectedProposals.map((proposal) => proposal.qbankId))
                  .size
              }
            </strong>{' '}
            QBank(s)
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy}
              onClick={() => void submitBulkReview()}
              className={
                bulkDecision === 'rejected'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : ''
              }
            >
              {bulkBusy
                ? 'Processing…'
                : `Confirm ${bulkDecision === 'approved' ? 'approval' : 'rejection'}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
