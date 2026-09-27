'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileJson,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, invalidateApiResources } from '@/lib/api-client';
import { subscribeLive } from '@/lib/realtime-client';
import type { CollaborationState } from '@/lib/medguard-types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ImportControls } from '@/components/import-controls';
import { cn } from '@/lib/utils';

type ImportRunStatus =
  | 'processing'
  | 'completed'
  | 'partial'
  | 'duplicate_only'
  | 'rejected'
  | 'failed';

type ImportRun = {
  id: string;
  user_id: string;
  user_email?: string;
  user_name?: string;
  qbank_id: string;
  qbank_name?: string;
  file_name: string;
  file_hash: string;
  source_file: string;
  status: ImportRunStatus;
  chunk_count: number;
  completed_chunks: number;
  total_count: number;
  successful_count: number;
  invalid_count: number;
  skipped_duplicate_count: number;
  flagged_duplicate_count: number;
  repaired: number;
  error_code?: string | null;
  error_message?: string | null;
  started_at: string;
  updated_at: string;
  completed_at?: string | null;
  legacy: number;
  stale: number;
  same_hash_count: number;
};

type ImportAttempt = {
  request_id: string;
  chunk_index: number;
  chunk_hash: string;
  status: ImportRunStatus;
  total_count: number;
  successful_count: number;
  invalid_count: number;
  skipped_duplicate_count: number;
  flagged_duplicate_count: number;
  report_json: string;
  error_code?: string | null;
  error_message?: string | null;
  started_at: string;
  updated_at: string;
};

type MonitorResponse = {
  runs: ImportRun[];
  summary: {
    runs: number;
    successful: number;
    invalid: number;
    duplicates: number;
    flagged: number;
    failed: number;
  };
  page: number;
  pageSize: number;
  total: number;
};

const statusLabels: Record<ImportRunStatus, string> = {
  processing: 'Processing',
  completed: 'Completed',
  partial: 'Partial',
  duplicate_only: 'Duplicate only',
  rejected: 'Rejected',
  failed: 'Failed',
};

function statusClass(status: ImportRunStatus) {
  if (status === 'completed')
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200';
  if (status === 'processing')
    return 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200';
  if (status === 'partial' || status === 'duplicate_only')
    return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200';
  return 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function skippedItems(attempt: ImportAttempt) {
  try {
    const parsed = JSON.parse(attempt.report_json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item),
        )
      : [];
  } catch {
    return [];
  }
}

function reportText(value: unknown, fallback = '') {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}

export function JsonImportMonitor({
  qbanks,
  members,
}: {
  qbanks: CollaborationState['qbanks'];
  members:CollaborationState['members'];
}) {
  const [data, setData] = useState<MonitorResponse>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [qbankId, setQbankId] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<{
    run: ImportRun;
    attempts: ImportAttempt[];
  }>();
  const [detailBusy, setDetailBusy] = useState(false);
  const [removing, setRemoving] = useState('');
  const [confirmRemove, confirmationDialog] = useConfirmationDialog();

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '25',
    });
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    if (qbankId) params.set('qbankId', qbankId);
    return `/platform/json-imports?${params}`;
  }, [page, qbankId, search, status]);

  const load = useCallback(
    async (force = false) => {
      setBusy(true);
      setError('');
      try {
        const next = await api<MonitorResponse>(query, {
          forceRefresh: force,
          requestReason: force ? 'explicit-refresh' : undefined,
        });
        setData(next);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load Import activity.',
        );
      } finally {
        setBusy(false);
      }
    },
    [query],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(
    () =>
      subscribeLive(
        (topic) => {
          if (topic !== 'json-import-monitor') return;
          invalidateApiResources(['json-import-monitor'], 'server-invalidation');
          void load(true);
        },
        ['json-import-monitor'],
      ),
    [load],
  );

  async function openDetails(run: ImportRun) {
    setDetailBusy(true);
    setError('');
    try {
      const detail = await api<{ run: ImportRun; attempts: ImportAttempt[] }>(
        `/platform/json-imports?run=${encodeURIComponent(run.id)}`,
        { forceRefresh: true, requestReason: 'explicit-refresh' },
      );
      setSelected(detail);
    } catch (detailError) {
      setError(
        detailError instanceof Error
          ? detailError.message
          : 'Unable to load import details.',
      );
    } finally {
      setDetailBusy(false);
    }
  }

  async function removeRun(run: ImportRun) {
    const confirmed = await confirmRemove({
      title: `Remove ${run.file_name} from monitoring?`,
      description:
        'This hides only the monitoring record. Imported questions, retry protection, usage limits and audit evidence remain unchanged.',
      confirmLabel: 'Remove record',
      tone: 'destructive',
    });
    if (!confirmed) return;
    setRemoving(run.id);
    setError('');
    try {
      await api('/platform/json-imports', {
        method: 'DELETE',
        body: JSON.stringify({ runId: run.id }),
      });
      if (selected?.run.id === run.id) setSelected(undefined);
      await load(true);
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : 'Unable to remove this monitoring record.',
      );
    } finally {
      setRemoving('');
    }
  }

  const summary = data?.summary ?? {
    runs: 0,
    successful: 0,
    invalid: 0,
    duplicates: 0,
    flagged: 0,
    failed: 0,
  };
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 25));

  return (
    <>
      <div className="grid gap-4">
        <ImportControls members={members} />
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {[
            ['Runs', summary.runs],
            ['Accepted', summary.successful],
            ['Invalid', summary.invalid],
            ['Exact duplicates', summary.duplicates],
            ['Needs review', summary.flagged],
            ['Failed', summary.failed],
          ].map(([label, value]) => (
            <article
              key={String(label)}
              className="rounded-2xl bg-card p-4 ring-1 ring-border"
            >
              <span className="text-xs font-semibold text-muted-foreground">
                {label}
              </span>
              <strong className="mt-2 block text-2xl">
                {Number(value).toLocaleString()}
              </strong>
            </article>
          ))}
        </section>

        <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          <div className="grid gap-3 border-b p-4 lg:grid-cols-[minmax(0,1fr)_13rem_13rem_auto]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
              <input
                aria-label="Search Imports"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="File, email, hash or run ID…"
                className="h-11 w-full rounded-xl border bg-background pl-10 pr-3 text-sm"
              />
            </label>
            <select
              aria-label="Import status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
              className="h-11 rounded-xl border bg-background px-3 text-sm font-semibold"
            >
              <option value="">All statuses</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="QBank"
              value={qbankId}
              onChange={(event) => {
                setQbankId(event.target.value);
                setPage(0);
              }}
              className="h-11 rounded-xl border bg-background px-3 text-sm font-semibold"
            >
              <option value="">All QBanks</option>
              {qbanks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={busy}
              className="q-button q-button-secondary"
            >
              <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
              Refresh
            </button>
          </div>

          {error && (
            <p role="alert" className="border-b bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200">
              {error}
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">File</th>
                  <th className="px-4 py-3">Account / QBank</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Accepted</th>
                  <th className="px-4 py-3">Invalid</th>
                  <th className="px-4 py-3">Duplicates</th>
                  <th className="px-4 py-3">Uploaded</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data?.runs.map((run) => (
                  <tr key={run.id} className="align-top">
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => void openDetails(run)}
                        className="max-w-72 text-left font-bold text-primary hover:underline"
                      >
                        {run.file_name}
                      </button>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        {run.file_hash.slice(0, 16)}…
                        {run.same_hash_count > 1
                          ? ` · seen ${run.same_hash_count} times`
                          : ''}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <strong className="block">{run.user_name || run.user_id}</strong>
                      <span className="block text-xs text-muted-foreground">
                        {run.user_email || 'Unknown account'}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {run.qbank_name || run.qbank_id || 'Deleted QBank'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase',
                          statusClass(run.stale ? 'failed' : run.status),
                        )}
                      >
                        {run.stale ? 'Interrupted' : statusLabels[run.status]}
                      </span>
                      {run.legacy ? (
                        <span className="mt-2 block text-[10px] font-bold uppercase text-muted-foreground">
                          Legacy record
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-4 font-bold text-emerald-700 dark:text-emerald-300">
                      {run.successful_count}
                    </td>
                    <td className="px-4 py-4">{run.invalid_count}</td>
                    <td className="px-4 py-4">{run.skipped_duplicate_count}</td>
                    <td className="px-4 py-4 text-xs text-muted-foreground">
                      {formatDate(run.started_at)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void openDetails(run)}
                          disabled={detailBusy}
                          className="q-button q-button-secondary"
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${run.file_name} from monitoring`}
                          disabled={
                            (run.status === 'processing' && !run.stale) ||
                            removing === run.id
                          }
                          onClick={() => void removeRun(run)}
                          className="grid size-10 place-items-center rounded-xl border text-red-600 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-500/10"
                        >
                          {removing === run.id ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!busy && !data?.runs.length && (
            <div className="p-12 text-center">
              <FileJson className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-semibold">No matching import activity.</p>
            </div>
          )}
          {busy && !data && (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <LoaderCircle className="mx-auto size-6 animate-spin" />
              <p className="mt-3">Loading server import activity…</p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t p-4 text-xs text-muted-foreground">
            <span>
              Page {Math.min(page + 1, pages)} of {pages} · {data?.total ?? 0}{' '}
              runs
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 0 || busy}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
                className="q-button q-button-secondary"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page + 1 >= pages || busy}
                onClick={() => setPage((value) => value + 1)}
                className="q-button q-button-secondary"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(undefined)}>
        <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto">
          <DialogTitle>Import details</DialogTitle>
          {selected && (
            <div className="space-y-5">
              <section className="grid gap-3 rounded-2xl border bg-muted/20 p-4 sm:grid-cols-2">
                <div>
                  <span className="text-xs text-muted-foreground">File</span>
                  <strong className="mt-1 block break-all">{selected.run.file_name}</strong>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Last server outcome</span>
                  <strong className="mt-1 block">
                    {selected.run.stale
                      ? 'Interrupted'
                      : statusLabels[selected.run.status]}
                  </strong>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-xs text-muted-foreground">SHA-256</span>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-lg bg-background p-2 text-xs">
                      {selected.run.file_hash}
                    </code>
                    <button
                      type="button"
                      aria-label="Copy file hash"
                      onClick={() => void navigator.clipboard.writeText(selected.run.file_hash)}
                      className="grid size-10 place-items-center rounded-xl border"
                    >
                      <Copy className="size-4" />
                    </button>
                  </div>
                </div>
                <p className="sm:col-span-2 rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
                  Re-upload is allowed. The server compares current questions,
                  skips exact matches, imports new content and flags possible
                  duplicates for review.
                </p>
                {(selected.run.error_code || selected.run.error_message) && (
                  <p className="sm:col-span-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200">
                    <strong>{selected.run.error_code || 'IMPORT_ERROR'}</strong>
                    {selected.run.error_message
                      ? ` · ${selected.run.error_message}`
                      : ''}
                  </p>
                )}
                {selected.run.stale &&
                  !selected.run.error_code &&
                  !selected.run.error_message && (
                    <p className="sm:col-span-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                      UPLOAD_INTERRUPTED · No server batch arrived for more than
                      30 minutes. This monitoring record can be removed safely.
                    </p>
                  )}
              </section>

              <section className="space-y-3">
                <h3 className="font-bold">Server batches</h3>
                {selected.attempts.map((attempt) => {
                  const skipped = skippedItems(attempt);
                  return (
                    <article key={attempt.request_id} className="rounded-2xl border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <strong>Chunk {attempt.chunk_index + 1}</strong>
                          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                            {attempt.request_id}
                          </p>
                        </div>
                        <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-bold uppercase', statusClass(attempt.status))}>
                          {statusLabels[attempt.status]}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                        <span>Total <strong className="block text-base">{attempt.total_count}</strong></span>
                        <span>Accepted <strong className="block text-base">{attempt.successful_count}</strong></span>
                        <span>Invalid <strong className="block text-base">{attempt.invalid_count}</strong></span>
                        <span>Exact duplicates <strong className="block text-base">{attempt.skipped_duplicate_count}</strong></span>
                        <span>Flagged <strong className="block text-base">{attempt.flagged_duplicate_count}</strong></span>
                      </div>
                      {(attempt.error_code || attempt.error_message) && (
                        <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-200">
                          {attempt.error_code || 'IMPORT_ERROR'}
                          {attempt.error_message ? ` · ${attempt.error_message}` : ''}
                        </p>
                      )}
                      {skipped.length > 0 && (
                        <details className="mt-3 rounded-xl bg-muted/30 p-3">
                          <summary className="cursor-pointer text-xs font-bold">
                            {skipped.length} invalid item reason{skipped.length === 1 ? '' : 's'}
                          </summary>
                          <div className="mt-3 space-y-2">
                            {skipped.slice(0, 100).map((item, index) => (
                              <p key={`${attempt.request_id}-${index}`} className="text-xs leading-5 text-muted-foreground">
                                #{reportText(item.originalQuestionNumber, String(index + 1))}
                                {reportText(item.page)
                                  ? ` · page ${reportText(item.page)}`
                                  : ''}
                                {' · '}
                                {reportText(item.reason, 'Invalid question.')}
                              </p>
                            ))}
                          </div>
                        </details>
                      )}
                    </article>
                  );
                })}
                {!selected.attempts.length && (
                  <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                    <AlertTriangle className="mr-2 inline size-4" />
                    This legacy record predates batch-level monitoring.
                  </p>
                )}
              </section>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="size-4 text-emerald-600" />
                Removing this monitor record never deletes imported content.
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {confirmationDialog}
    </>
  );
}
