'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { subscribeLive } from '@/lib/realtime-client';
type Reviewer = { id: string; name: string; today: number; month: number; approved: number; edited: number; rejected: number };
export function ReviewerPerformance() {
  const [data, setData] = useState<{ reviewers: Reviewer[]; timeZone: string }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = useCallback(async (force = false) => {
    await Promise.resolve();
    const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Riyadh';
    setBusy(true);
    setError('');
    try {
      setData(await api<{ reviewers: Reviewer[]; timeZone: string }>(`/platform/reviewer-performance?timeZone=${encodeURIComponent(timeZone)}`, {
        forceRefresh: force,
        requestReason: force ? 'explicit-refresh' : undefined,
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load performance.');
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const stop = subscribeLive(() => void load(), ['reviewer-performance']);
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [load]);
  return <section className="min-w-0 rounded-2xl border bg-card p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Reviewer Performance</h2><button disabled={busy} className="q-button q-button-secondary" onClick={() => void load(true)}>{busy ? 'Loading…' : 'Refresh'}</button></div>
    <p className="my-3 text-sm text-muted-foreground">Completed reviewer decisions. Breakdown is for this month; Edited means an approved correction. Each independent high-risk approval counts once. Time zone: {data?.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
    {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
    <div className="max-w-full overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Reviewer','Today','This Month','Approved','Edited','Rejected'].map((heading, index) => <th key={heading} scope="col" className={`whitespace-nowrap border-b px-3 py-3 ${index ? 'text-right' : 'text-left'}`}>{heading}</th>)}</tr></thead><tbody>
      {data?.reviewers.map(row => <tr key={row.id}><th scope="row" className="border-b px-3 py-3 text-left font-medium">{row.name}</th>{[row.today,row.month,row.approved,row.edited,row.rejected].map((value,index) => <td key={index} className="border-b px-3 py-3 text-right tabular-nums">{value}</td>)}</tr>)}
      {data?.reviewers.length === 0 && <tr><td colSpan={6} className="p-5 text-center text-muted-foreground">No reviewers yet.</td></tr>}
    </tbody></table></div>
  </section>;
}
