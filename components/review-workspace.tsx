'use client';
import { FormattedQuestionText } from '@/components/formatted-question-text';
import { ExplanationImages } from '@/components/explanation-images';
import { readQuestionSource } from '@/features/qbanks/domain/question-source';
import { ReviewFilters } from '@/components/review-filters';
import {
  matchesProposalFilters,
  proposalEditKindLabel,
  type ReportKindFilter,
  type ReviewCategory,
} from '@/features/contributions/domain/proposal-filters';

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
  ScanSearch,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { QuestionPreview } from '@/components/question-tools';
import { WorkspaceHeader } from '@/components/workspace-header';
import { api } from '@/lib/api-client';
import { loadCollaborationState } from '@/lib/application-services';
import { subscribeLive } from '@/lib/realtime-client';
import { canReviewBank } from '@/features/access/domain/access-policy';
import {
  optionLabel,
  type AppUser,
  type CollaborationState,
  type DuplicateCandidate,
  type Question,
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
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';

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
          <FormattedQuestionText text={current || '—'} />
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
          <FormattedQuestionText text={proposed || '—'} />
        </p>
      </div>
    </div>
  );
}

function HighlightedDifference({ value, other }: { value: string; other: string }) {
  const otherTokens = new Set(other.toLocaleLowerCase().match(/[\p{L}\p{N}.+%-]+|[^\s]/gu) ?? []);
  return (
    <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
      <FormattedQuestionText text={value || '—'} renderSegment={segment => (segment.match(/[\p{L}\p{N}.+%-]+|\s+|[^\s]/gu) ?? []).map((token, index) =>
        /\s+/.test(token) || otherTokens.has(token.toLocaleLowerCase()) ? token : (
          <mark key={`${token}-${index}`} className="rounded bg-amber-200 px-0.5 text-foreground dark:bg-amber-500/35">
            {token}
          </mark>
        ),
      )} />
    </p>
  );
}

function DuplicateQuestionPanel({
  title,
  payload,
  compareWith,
  questionId,
}: {
  title: string;
  payload: QuestionProposal['payload'];
  compareWith: QuestionProposal['payload'];
  questionId?: string;
}) {
  return (
    <section className="min-w-0 rounded-2xl border bg-background p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="font-bold">{title}</h4>
        {questionId && <span className="text-xs font-bold text-muted-foreground">#{questionId}</span>}
      </div>
      <span className="text-xs font-bold uppercase text-muted-foreground">Stem</span>
      <HighlightedDifference value={payload.stem} other={compareWith.stem} />
      <div className="mt-4 space-y-2">
        {payload.options.map((option, index) => (
          <div key={`${index}-${option}`} className={cn('rounded-xl border p-2 text-sm', index === payload.answer && 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10')}>
            <strong>{optionLabel(index)}.</strong>{' '}
            <HighlightedDifference value={option} other={compareWith.options[index] ?? ''} />
          </div>
        ))}
      </div>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-bold text-muted-foreground">Correct answer</dt><dd>{payload.options[payload.answer] ?? optionLabel(payload.answer)}</dd></div>
        <div><dt className="text-xs font-bold text-muted-foreground">Specialty / topic</dt><dd>{payload.specialty} · {payload.topic}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs font-bold text-muted-foreground">Explanation</dt><dd className="whitespace-pre-wrap"><FormattedQuestionText text={payload.explanation || 'No explanation provided.'} /><ExplanationImages images={payload.explanationImages} /></dd></div>
        <div className="sm:col-span-2"><dt className="text-xs font-bold text-muted-foreground">Source</dt><dd>{readQuestionSource(payload).sourceReference || '—'}</dd></div>
      </dl>
      {payload.images?.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {payload.images.map((image) => <img key={image.id} src={image.url} alt={image.caption || image.name} className="aspect-video w-full rounded-lg border object-contain" />)}
        </div>
      )}
    </section>
  );
}

function legacyDuplicateCandidate(proposal: QuestionProposal): DuplicateCandidate | undefined {
  if (!proposal.duplicateInfo?.matchedQuestionId) return undefined;
  return {
    entityId: proposal.duplicateInfo.matchedQuestionId,
    entityType: 'approved_question',
    similarity: proposal.duplicateInfo.similarity,
    classification: 'possible',
    signals: { stem: proposal.duplicateInfo.similarity, optionsSet: 0, optionsOrdered: 0, correctAnswer: 0, specialty: 0, topic: 0 },
    candidateFingerprint: '',
    detectedAt: proposal.proposedAt,
  };
}

function proposalDuplicateCandidates(proposal: QuestionProposal) {
  return proposal.duplicateReview?.candidates ?? (legacyDuplicateCandidate(proposal) ? [legacyDuplicateCandidate(proposal)!] : []);
}

function isFlaggedDuplicate(proposal: QuestionProposal) {
  return proposal.duplicateReview?.status === 'flagged' || (!proposal.duplicateReview && Boolean(proposal.duplicateInfo));
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
  const [category, setCategory] = useState<ReviewCategory>('all');
  const [reportKind, setReportKind] = useState<ReportKindFilter>('all');
  const [duplicateSort, setDuplicateSort] = useState<'similarity' | 'newest' | 'oldest'>('similarity');
  const [duplicateNotes, setDuplicateNotes] = useState<Record<string, string>>({});
  const [scanProgress, setScanProgress] = useState<{ runId: string; cursor: number; status: 'running' | 'completed'; scanned: number; flagged: number }>();
  const [scanBusy, setScanBusy] = useState(false);
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
  const [confirmAction, confirmationDialog] = useConfirmationDialog();
  type ReviewResult = {
    reviewed: number;
    awaitingSecondReview: number;
    reconciled?: boolean;
    updatedProposals: QuestionProposal[];
    updatedQuestions: Question[];
    queueDelta: number;
    reviewerCompletedDelta: number;
  };
  const applyReviewResult = (result: ReviewResult) => {
    const proposals = new Map(result.updatedProposals.map(proposal => [proposal.id, proposal]));
    const questions = new Map(result.updatedQuestions.map(question => [question.id, question]));
    replaceFromServer({
      ...collaboration,
      proposals: collaboration.proposals.map(proposal => proposals.get(proposal.id) ?? proposal),
      approvedQuestions: [
        ...collaboration.approvedQuestions.filter(question => !questions.has(question.id)),
        ...result.updatedQuestions,
      ],
    });
  };
  useEffect(() => {
    let active = true;
    const reconcile = () => {
      void loadCollaborationState(user).then(next => {
        if (active) replaceFromServer(next);
      }).catch(() => undefined);
    };
    reconcile();
    const stop = subscribeLive(reconcile, ['review-queue', 'question-catalog']);
    return () => { active = false; stop(); };
  }, [user, replaceFromServer]);
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
    const unsubscribe = subscribeLive(() => void load(), ['review-history']);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user.uid]);
  useEffect(() => {
    if (!activeQBankId) {
      return;
    }
    let active = true;
    void api<{ run: { runId: string; cursor: number; status: 'running' | 'completed'; scanned: number; flagged: number } | null }>(
      `/platform/duplicate-scan?qbankId=${encodeURIComponent(activeQBankId)}`,
    ).then((result) => {
      if (active) setScanProgress(result.run ?? undefined);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [activeQBankId]);
  async function clearHistory() {
    if (clearing) return;
    if (!(await confirmAction({
      title: 'Clear your review history?',
      description: 'This only clears history for your account. Questions, review decisions and other accounts are unaffected.',
      confirmLabel: 'Clear history',
      tone: 'destructive',
    }))) return;
    setClearing(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ clearedAt: string }>(
        '/platform/review-history',
        { method: 'POST', body: '{}' },
      );
      setHistoryPreference({ userId: user.uid, clearedAt: result.clearedAt });
      setNotice('Your review history has been cleared for this account.');
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
  const pending = useMemo(
    () =>
      collaboration.proposals
        .filter(
          (proposal) =>
            proposal.status === 'pending' &&
            proposal.proposedById !== user.uid &&
            bankIds.has(proposal.qbankId),
        )
        .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt)),
    [bankIds, collaboration.proposals, user.uid],
  );
  const bulkEligible = useMemo(
    () => pending.filter((proposal) => !isFlaggedDuplicate(proposal)),
    [pending],
  );
  const historyReady = historyPreference?.userId === user.uid;
  const clearedAt = historyPreference?.clearedAt ?? '';
  const reviewed = useMemo(
    () =>
      collaboration.proposals
        .filter(
          (proposal) =>
            historyReady &&
            proposal.status !== 'pending' &&
            proposal.reviewedById === user.uid &&
            bankIds.has(proposal.qbankId) &&
            (!clearedAt || (proposal.reviewedAt ?? '') > clearedAt),
        )
        .sort((a, b) =>
          (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''),
        ),
    [
      bankIds,
      collaboration.proposals,
      clearedAt,
      historyReady,
      user.uid,
    ],
  );
  const visible = useMemo(() => {
    const source = section === 'pending' ? pending : reviewed;
    const filtered = source.filter((proposal) => matchesProposalFilters(
      proposal, category, reportKind, proposalDuplicateCandidates(proposal).length > 0,
    ));
    if (category !== 'duplicates') return filtered;
    return [...filtered].sort((left, right) => {
      if (duplicateSort === 'newest') return right.proposedAt.localeCompare(left.proposedAt);
      if (duplicateSort === 'oldest') return left.proposedAt.localeCompare(right.proposedAt);
      const leftScore = Math.max(0, ...proposalDuplicateCandidates(left).map((item) => item.similarity));
      const rightScore = Math.max(0, ...proposalDuplicateCandidates(right).map((item) => item.similarity));
      return rightScore - leftScore || right.proposedAt.localeCompare(left.proposedAt);
    });
  }, [category, reportKind, duplicateSort, pending, reviewed, section]);
  const selectedProposals = useMemo(
    () =>
      bulkEligible.filter((proposal) => selectedProposalIds.includes(proposal.id)),
    [bulkEligible, selectedProposalIds],
  );
  const submitters = [
    ...new Map(
      bulkEligible.map((proposal) => [
        proposal.proposedById,
        proposal.proposedByName,
      ]),
    ).entries(),
  ];

  function selectProposals(proposals: QuestionProposal[]) {
    setSelectedProposalIds(
      proposals.filter((proposal) => !isFlaggedDuplicate(proposal)).slice(0, 200).map((proposal) => proposal.id),
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
      const result = await api<ReviewResult>('/platform/bulk-review', {
        method: 'POST',
        body: JSON.stringify({
          proposalIds: selectedProposals.map((proposal) => proposal.id),
          status: bulkDecision,
        }),
      });
      applyReviewResult(result);
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
      const result = await api<ReviewResult>(
        '/platform/bulk-review',
        {
          method: 'POST',
          body: JSON.stringify({ proposalIds: [proposal.id], status }),
        },
      );
      applyReviewResult(result);
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

  async function resolveDuplicate(
    proposal: QuestionProposal,
    candidateEntityId: string,
    decision: 'kept_both' | 'rejected_as_duplicate',
  ) {
    if (busyId) return;
    setBusyId(proposal.id);
    setError('');
    setNotice('');
    try {
      const result = await api<ReviewResult>('/platform/duplicate-resolve', {
        method: 'POST',
        body: JSON.stringify({
          proposalId: proposal.id,
          candidateEntityId,
          decision,
          note: duplicateNotes[proposal.id] ?? '',
        }),
      });
      applyReviewResult(result);
      setNotice(result.reconciled
        ? 'The previously matched proposal was rejected. This case has been refreshed; review its remaining matches or continue with normal medical review.'
        : decision === 'kept_both'
        ? proposal.duplicateScanId
          ? 'KEEP BOTH recorded. The existing questions remain unchanged.'
          : 'KEEP BOTH recorded. Duplicate review is resolved; the proposal can continue through medical review.'
        : 'The incoming proposal was rejected as a reviewer-confirmed duplicate. The existing question was not changed.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to resolve this duplicate case.');
    } finally {
      setBusyId('');
    }
  }

  async function scanExistingQuestions() {
    if (!activeQBankId || scanBusy) return;
    setScanBusy(true);
    setError('');
    try {
      const result = await api<{
        runId: string;
        cursor: number;
        status: 'running' | 'completed';
        scanned: number;
        flagged: number;
        proposals: QuestionProposal[];
      }>('/platform/duplicate-scan', {
        method: 'POST',
        body: JSON.stringify({
          qbankId: activeQBankId,
          runId: scanProgress?.status === 'running' ? scanProgress.runId : undefined,
          cursor: scanProgress?.status === 'running' ? scanProgress.cursor : 0,
          batchSize: 50,
        }),
      });
      setScanProgress({
        runId: result.runId,
        cursor: result.cursor,
        status: result.status,
        scanned: (scanProgress?.status === 'running' ? scanProgress.scanned : 0) + result.scanned,
        flagged: (scanProgress?.status === 'running' ? scanProgress.flagged : 0) + result.flagged,
      });
      replaceFromServer({
        ...collaboration,
        proposals: [
          ...result.proposals,
          ...collaboration.proposals.filter((proposal) => !result.proposals.some((next) => next.id === proposal.id)),
        ],
      });
      setNotice(`Scanned ${result.scanned} existing questions; created ${result.flagged} reviewer-controlled duplicate case(s).${result.status === 'completed' ? ' Scan complete.' : ''}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to scan this QBank.');
    } finally {
      setScanBusy(false);
    }
  }

  return (
    <>
      {!embedded && (
        <WorkspaceHeader
          title="Review"
          subtitle="Compare each change, check its source, then approve or return it."
        />
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
        <ReviewFilters
          category={category}
          onCategoryChange={setCategory}
          kind={reportKind}
          onKindChange={setReportKind}
          duplicateCount={(section === 'pending' ? pending : reviewed).filter((proposal) => matchesProposalFilters(proposal, 'duplicates', reportKind, proposalDuplicateCandidates(proposal).length > 0)).length}
        >
          {category === 'duplicates' ? <>
            <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
              Sort
              <select value={duplicateSort} onChange={(event) => setDuplicateSort(event.target.value as typeof duplicateSort)} className="h-9 rounded-lg border bg-background px-2 text-sm text-foreground">
                <option value="similarity">Highest similarity</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </label>
            {activeQBankId && (
              <button type="button" disabled={scanBusy} onClick={() => void scanExistingQuestions()} className="q-button q-button-secondary">
                <ScanSearch className="size-4" />
                {scanBusy ? 'Scanning…' : scanProgress?.status === 'running' ? `Scan next batch · ${scanProgress.cursor} checked` : scanProgress?.status === 'completed' ? `Rescan existing QBank · last found ${scanProgress.flagged}` : 'Scan existing QBank'}
              </button>
            )}
          </> : null}
        </ReviewFilters>
        {section === 'pending' && bulkEligible.length > 0 && (
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
                        bulkEligible.filter(
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
                        bulkEligible.filter(
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
                        bulkEligible.filter(
                          (proposal) => proposalMethod(proposal) === method,
                        ),
                      );
                  }}
                  className="h-11 w-full rounded-xl border bg-card px-3 text-sm font-semibold normal-case text-foreground"
                >
                  <option value="">Choose a method…</option>
                  <option value="json">
                    Import ·{' '}
                    {
                      bulkEligible.filter(
                        (proposal) => proposalMethod(proposal) === 'json',
                      ).length
                    }
                  </option>
                  <option value="manual">
                    Manual submission ·{' '}
                    {
                        bulkEligible.filter(
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
                    max={Math.min(200, bulkEligible.length)}
                    value={latestCount}
                    onChange={(event) => setLatestCount(event.target.value)}
                    className="h-11 min-w-0 flex-1 rounded-xl border bg-card px-3 text-sm font-semibold normal-case text-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const count = Math.max(
                        1,
                        Math.min(200, bulkEligible.length, Number(latestCount) || 1),
                      );
                      setLatestCount(String(count));
                      selectProposals(bulkEligible.slice(0, count));
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
                onClick={() => selectProposals(bulkEligible)}
                className="q-button q-button-secondary"
              >
                <ListChecks className="size-4" /> Select{' '}
                {bulkEligible.length > 200 ? 'first 200' : `all ${bulkEligible.length}`}
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
        {notice && !error && (
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
              const current = (section === 'pending' && proposal.type === 'question_edit'
                ? collaboration.approvedQuestions.find(question => question.id === proposal.questionId)
                : undefined) ?? proposal.currentSnapshot ?? proposal.payload;
              const duplicateCandidates = proposalDuplicateCandidates(proposal);
              const duplicateFlagged = isFlaggedDuplicate(proposal);
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
                    {proposal.status === 'pending' && !duplicateFlagged && (
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
                        {proposalEditKindLabel(kind)}
                      </span>
                    ))}
                    {duplicateCandidates.length > 0 && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                        {proposal.duplicateReview?.status === 'resolved' ? 'DUPLICATE REVIEWED' : duplicateCandidates[0].classification.replace('_', ' ').toUpperCase()} · {Math.max(...duplicateCandidates.map((item) => item.similarity))}%
                      </span>
                    )}
                    <span className="ml-auto text-sm text-muted-foreground">
                      {bank?.shortName} · {proposal.proposedByName} ·{' '}
                      {formatDate(proposal.proposedAt)}
                    </span>
                  </div>
                  {duplicateFlagged && (
                    <section className="mt-5 space-y-4 rounded-2xl border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
                      <div>
                        <h3 className="font-bold text-amber-900 dark:text-amber-200">Possible duplicate — reviewer confirmation required</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Similarity is evidence, not medical certainty. Compare meaning-sensitive differences before deciding.</p>
                      </div>
                      {duplicateCandidates.map((finding, candidateIndex) => {
                        const candidateQuestion = finding.entityType === 'approved_question'
                          ? collaboration.approvedQuestions.find((question) => question.id === finding.entityId)
                          : collaboration.proposals.find((item) => item.id === finding.entityId)?.payload;
                        if (!candidateQuestion) return (
                          <p key={finding.entityId} className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">Candidate {finding.entityId} is unavailable. Refresh before deciding.</p>
                        );
                        const candidatePayload: QuestionProposal['payload'] = {
                          ...candidateQuestion,
                          explanation: candidateQuestion.explanation ?? '',
                          explanationImages: candidateQuestion.explanationImages ?? [],
                          sourceReference: readQuestionSource(candidateQuestion).sourceReference,
                          images: candidateQuestion.images ?? [],
                        };
                        return (
                          <div key={finding.entityId} className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                              <span className="rounded-full bg-amber-200 px-2.5 py-1 text-amber-950 dark:bg-amber-500/25 dark:text-amber-100">Candidate {candidateIndex + 1} · {finding.classification.replace('_', ' ')}</span>
                              <span>Similarity score {finding.similarity}%</span>
                              <span>Stem {finding.signals.stem}%</span>
                              <span>Options {finding.signals.optionsSet}%</span>
                              {finding.signals.specialty === 100 && <span>Same specialty</span>}
                              {finding.signals.topic === 100 && <span>Same topic</span>}
                            </div>
                            <div className="grid gap-3 lg:grid-cols-2">
                              <DuplicateQuestionPanel title={finding.entityType === 'approved_question' ? 'Existing question' : 'Pending proposal'} payload={candidatePayload} compareWith={proposal.payload} questionId={finding.questionId ?? ('questionId' in candidateQuestion ? candidateQuestion.questionId : undefined)} />
                              <DuplicateQuestionPanel title={proposal.duplicateScanId ? 'Scanned question' : 'Incoming question'} payload={proposal.payload} compareWith={candidatePayload} />
                            </div>
                          </div>
                        );
                      })}
                      <label className="block text-sm font-bold">
                        Review note <span className="font-normal text-muted-foreground">(optional)</span>
                        <textarea value={duplicateNotes[proposal.id] ?? ''} onChange={(event) => setDuplicateNotes((currentNotes) => ({ ...currentNotes, [proposal.id]: event.target.value }))} maxLength={1000} rows={2} className="mt-2 w-full rounded-xl border bg-background p-3 font-normal" placeholder="Record the meaningful difference or duplicate rationale…" />
                      </label>
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button disabled={Boolean(busyId) || !duplicateCandidates[0]} onClick={() => duplicateCandidates[0] && void resolveDuplicate(proposal, duplicateCandidates[0].entityId, 'rejected_as_duplicate')} className="q-button q-button-danger">
                          <X className="size-4" /> Reject new as duplicate
                        </button>
                        <button disabled={Boolean(busyId) || !duplicateCandidates[0]} onClick={() => duplicateCandidates[0] && void resolveDuplicate(proposal, duplicateCandidates[0].entityId, 'kept_both')} className="q-button q-button-secondary">
                          <Check className="size-4" /> Keep both
                        </button>
                      </div>
                    </section>
                  )}
                  {proposal.duplicateReview?.status === 'resolved' && proposal.status === 'pending' && (
                    <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
                      <strong>KEEP BOTH recorded.</strong> This unchanged pair is suppressed. Continue with the normal medical review below.
                    </p>
                  )}
                  {!duplicateFlagged && <div className="mt-5 space-y-3">
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
                      current={current.explanation ?? ''}
                      proposed={proposal.payload.explanation}
                    />
                    <DiffField
                      label="Source"
                      current={readQuestionSource(current).sourceReference}
                      proposed={readQuestionSource(proposal.payload).sourceReference}
                    />
                    <section className="rounded-xl border p-3"><h4 className="text-sm font-bold">Explanation images · current</h4><ExplanationImages images={current.explanationImages} /><h4 className="mt-3 text-sm font-bold">Explanation images · proposed</h4><ExplanationImages images={proposal.payload.explanationImages ?? current.explanationImages} /></section>
                  </div>}
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
                  {proposal.status === 'pending' && !duplicateFlagged ? (
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
                  ) : proposal.status !== 'pending' ? (
                    <div className="mt-5 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
                      <FileCheck2 className="size-4" />
                      <strong
                        className={
                          proposal.status === 'approved'
                            ? 'text-emerald-600 dark:text-emerald-300'
                            : 'text-red-600 dark:text-red-300'
                        }
                      >
                        {proposal.duplicateReview?.resolutions?.at(-1)?.decision === 'kept_both'
                          ? proposal.duplicateScanId ? 'KEPT BOTH' : `${proposal.status.toUpperCase()} · KEPT BOTH`
                          : proposal.duplicateReview?.resolutions?.at(-1)?.decision === 'rejected_as_duplicate'
                            ? 'REJECTED AS DUPLICATE'
                            : proposal.status.toUpperCase()}
                      </strong>{' '}
                      by {proposal.reviewedByName} ·{' '}
                      {formatDate(proposal.reviewedAt)}
                    </div>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="grid min-h-64 place-items-center rounded-2xl bg-card text-sm text-muted-foreground ring-1 ring-border">
              <div className="text-center">
                <FileCheck2 className="mx-auto mb-3 size-9 text-emerald-500" />
                {category !== 'all' || reportKind !== 'all'
                  ? 'No requests match these filters.'
                  : section === 'pending'
                    ? 'No requests are waiting for review.'
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
      {confirmationDialog}
    </>
  );
}
