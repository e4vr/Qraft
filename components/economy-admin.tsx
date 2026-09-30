'use client';

import { useEffect, useState } from 'react';
import { api, setApiCache } from '@/lib/api-client';
import type { MemberProfile } from '@/lib/medguard-types';
import type { PlanId } from '@/features/subscriptions/domain/plan-config';

type EconomyData = {
  importLimits:{questionsPerImport:number;importsPerDay:number}|null;
  account: { credits_balance: number; lifetime_score: number; trust_score: number } | null;
  ledger: Array<{ id: string; amount: number; reason: string; created_at: string; created_by: string }>;
  rewardHistory: Array<{ id: string; plan: string; status: string; created_at: string; expires_at: string | null }>;
  duplicateAbuse: Array<{ id: string; reason: string; starts_at: string; ends_at: string; removed_at: string | null }>;
  reviewerActivity: Array<{ id: string; proposal_id: string; reviewer_id: string; decision: string; created_at: string }>;
  contributionHistory: Array<{ id: string; status: string; type: string; updated_at: string }>;
  collusionFlags: Array<{ reviewer_id: string; author_id: string; approvals: number; percentage: number }>;
};

export function EconomyAdmin({ members }: { members: MemberProfile[] }) {
  const [userId, setUserId] = useState(members[0]?.uid ?? '');
  const [data, setData] = useState<EconomyData>();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState<Exclude<PlanId, 'free'>>('full_monthly');
  const [giftDays, setGiftDays] = useState('30');
  const [importQuestions,setImportQuestions]=useState('150');
  const [importTimes,setImportTimes]=useState('5');
  const [blockDays, setBlockDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load(target = userId) {
    if (!target) return;
    try {
      const result=await api<EconomyData>(`/platform/economy-admin?userId=${encodeURIComponent(target)}`);
      setData(result);setImportQuestions(String(result.importLimits?.questionsPerImport??150));setImportTimes(String(result.importLimits?.importsPerDay??5));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load account economy.');
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(userId), 0);
    return () => window.clearTimeout(timer);
  }, [userId]);

  async function mutate(operation: string, extra: Record<string, unknown> = {}) {
    if (!reason.trim()) {
      setError('A reason is required for every manual action.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{
        importLimits?:EconomyData['importLimits'];
        accountDelta?: number;
        transaction?: EconomyData['ledger'][number];
        pass?: EconomyData['rewardHistory'][number];
        suspension?: EconomyData['duplicateAbuse'][number];
        removedAt?: string;
      }>('/platform/economy-admin', {
        method: 'POST',
        body: JSON.stringify({ operation, userId, reason, ...extra }),
      });
      setMessage('Action saved with an audit trail.');
      setAmount('');
      setReason('');
      setData(current => {
        if (!current) return current;
        const next: EconomyData = {
          ...current,
          importLimits:result.importLimits??current.importLimits,
          account: result.accountDelta === undefined
            ? current.account
            : { credits_balance: (current.account?.credits_balance ?? 0) + result.accountDelta, lifetime_score: current.account?.lifetime_score ?? 0, trust_score: current.account?.trust_score ?? 100 },
          ledger: result.transaction ? [result.transaction, ...current.ledger] : current.ledger,
          rewardHistory: result.pass ? [result.pass, ...current.rewardHistory] : current.rewardHistory,
          duplicateAbuse: result.suspension
            ? [result.suspension, ...current.duplicateAbuse]
            : result.removedAt
              ? current.duplicateAbuse.map(item => item.removed_at ? item : { ...item, removed_at: result.removedAt! })
              : current.duplicateAbuse,
        };
        setApiCache(`/platform/economy-admin?userId=${encodeURIComponent(userId)}`, next);
        return next;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save this action.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">Contribution economy</h2>
        <p className="mt-1 text-sm text-muted-foreground">Credits, reward passes, Import suspensions, reviewer activity and trust status.</p>
      </div>
      <label className="block text-sm font-semibold">
        Account
        <select className="mt-2 h-11 w-full rounded-xl border bg-card px-3" value={userId} onChange={(event) => setUserId(event.target.value)}>
          {members.map((member) => <option key={member.uid} value={member.uid}>{member.displayName} · {member.email}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {message && <output className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{message}</output>}
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <article className="rounded-xl border bg-card p-4"><span className="text-xs text-muted-foreground">Credits</span><strong className="mt-1 block text-2xl">{data.account?.credits_balance ?? 0}</strong></article>
          <article className="rounded-xl border bg-card p-4"><span className="text-xs text-muted-foreground">Lifetime contribution</span><strong className="mt-1 block text-2xl">{data.account?.lifetime_score ?? 0}</strong></article>
          <article className="rounded-xl border bg-card p-4"><span className="text-xs text-muted-foreground">Trust status</span><strong className="mt-1 block text-2xl">{(data.account?.trust_score ?? 100) >= 70 ? 'Normal' : 'Review'}</strong></article>
        </div>
      )}
      <label className="block text-sm font-semibold">
        Required reason
        <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} className="mt-2 h-11 w-full rounded-xl border bg-card px-3" placeholder="Manual community reward" />
      </label>
      <div className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border bg-card p-4">
          <h3 className="font-bold">Adjust credits</h3>
          <input type="number" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-3 h-11 w-full rounded-xl border bg-background px-3" placeholder="+100 or -25" />
          <button disabled={busy || !amount} onClick={() => void mutate('adjust-credits', { amount: Number(amount), requestId: crypto.randomUUID() })} className="q-button mt-3 w-full bg-primary text-primary-foreground">Apply adjustment</button>
        </article>
        <article className="rounded-2xl border bg-card p-4">
          <h3 className="font-bold">Grant stored reward</h3>
          <select value={plan} onChange={(event) => setPlan(event.target.value as typeof plan)} className="mt-3 h-11 w-full rounded-xl border bg-background px-3"><option value="full_monthly">Full Access · 1 month</option><option value="full_quarterly">Full Access · 3 months</option></select>
          <label className="q-ops-field">Gift days<input type="number" min="1" max="730" value={giftDays} onChange={event => setGiftDays(event.target.value)} /></label>
          <button disabled={busy || !Number.isInteger(Number(giftDays)) || Number(giftDays)<1 || Number(giftDays)>730} onClick={() => void mutate('grant-reward', { plan, days:Number(giftDays) })} className="q-button mt-3 w-full border">Grant {giftDays || '…'} days</button>
        </article>
        <article className="rounded-2xl border bg-card p-4">
          <h3 className="font-bold">Import limits & access</h3>
          <label className="q-ops-field">Total questions per import<input type="number" min="1" max="5000" value={importQuestions} onChange={e=>setImportQuestions(e.target.value)} /></label>
          <label className="q-ops-field">Imports per user / day (UTC)<input type="number" min="1" max="100" value={importTimes} onChange={e=>setImportTimes(e.target.value)} /></label>
          <button disabled={busy} className="q-button mt-3 w-full border" onClick={()=>void mutate('import-limits',{questionsPerImport:Number(importQuestions),importsPerDay:Number(importTimes)})}>Save import limits</button>
          <label className="q-ops-field">Suspension days<input type="number" min="1" max="365" value={blockDays} onChange={event => setBlockDays(event.target.value)} /></label>
          <button disabled={busy || !Number.isInteger(Number(blockDays)) || Number(blockDays)<1 || Number(blockDays)>365} onClick={() => void mutate('suspend-json', { days:Number(blockDays) })} className="q-button mt-3 w-full border text-destructive">Suspend for {blockDays || '…'} days</button>
          <button disabled={busy} onClick={() => void mutate('remove-json-suspension')} className="q-button mt-2 w-full border">Remove suspension</button>
        </article>
      </div>
      {data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border bg-card p-4"><h3 className="font-bold">Credit ledger</h3><div className="mt-3 divide-y text-sm">{data.ledger.slice(0, 20).map((item) => <div key={item.id} className="flex gap-3 py-2"><span className="min-w-0 flex-1">{item.reason}</span><strong>{item.amount > 0 ? '+' : ''}{item.amount}</strong></div>)}</div></section>
          <section className="rounded-2xl border bg-card p-4"><h3 className="font-bold">Reward history</h3><div className="mt-3 divide-y text-sm">{data.rewardHistory.slice(0, 20).map((item) => <div key={item.id} className="flex gap-3 py-2"><span className="min-w-0 flex-1 capitalize">{item.plan}</span><strong className="uppercase">{item.status}</strong></div>)}</div></section>
          <section className="rounded-2xl border bg-card p-4"><h3 className="font-bold">Manual import suspensions</h3><div className="mt-3 divide-y text-sm">{data.duplicateAbuse.slice(0, 20).map((item) => <div key={item.id} className="py-2"><strong>{item.removed_at ? 'Removed' : 'Active/expired'}</strong><p className="text-muted-foreground">{item.reason}</p></div>)}</div></section>
          <section className="rounded-2xl border bg-card p-4"><h3 className="font-bold">Reviewer activity</h3><div className="mt-3 divide-y text-sm">{data.reviewerActivity.slice(0, 20).map((item) => <div key={item.id} className="flex gap-3 py-2"><span className="min-w-0 flex-1">{item.proposal_id}</span><strong className="uppercase">{item.decision}</strong></div>)}</div></section>
          <section className="rounded-2xl border bg-card p-4"><h3 className="font-bold">Contribution history</h3><div className="mt-3 divide-y text-sm">{data.contributionHistory.slice(0, 20).map((item) => <div key={item.id} className="flex gap-3 py-2"><span className="min-w-0 flex-1 capitalize">{item.type.replace('_', ' ')}</span><strong className="uppercase">{item.status}</strong></div>)}</div></section>
          {data.collusionFlags.length > 0 && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:bg-amber-500/10 lg:col-span-2"><h3 className="font-bold text-amber-900 dark:text-amber-100">Approval pattern flags</h3><div className="mt-3 divide-y text-sm">{data.collusionFlags.map((flag) => <div key={`${flag.reviewer_id}:${flag.author_id}`} className="py-2">Reviewer {flag.reviewer_id} approved author {flag.author_id} {flag.approvals} times ({flag.percentage}%). Manual review recommended.</div>)}</div></section>}
        </div>
      )}
    </section>
  );
}
