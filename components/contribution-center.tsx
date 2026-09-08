'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Check, Coins, Gift, LoaderCircle, Play, WalletCards } from 'lucide-react';
import { api } from '@/lib/api-client';
import { PLAN_LIMITS, type PlanId } from '@/lib/plan-config';

type CreditTransaction = {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
};

type RewardPass = {
  id: string;
  plan: Exclude<PlanId, 'free'>;
  duration: number;
  duration_unit: 'month' | 'year';
  status: 'available' | 'active' | 'used' | 'expired' | 'cancelled';
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
  source: string;
};

type Reward = {
  id: string;
  plan: Exclude<PlanId, 'free'>;
  credits: number;
  duration: number;
  durationUnit: 'month' | 'year';
};

type CenterData = {
  creditsBalance: number;
  lifetimeContributionScore: number;
  badge: string | null;
  pendingSubmissions: number;
  transactions: CreditTransaction[];
  rewardPasses: RewardPass[];
  submissions: Array<{
    id: string;
    status: 'pending' | 'rejected' | 'needs_changes';
    type: 'new_question' | 'question_edit';
    updated_at: string;
  }>;
  rewards: Reward[];
};

export function ContributionCenter({
  onEntitlementChange,
}: {
  onEntitlementChange: () => void;
}) {
  const [data, setData] = useState<CenterData>();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setData(await api<CenterData>('/platform/contributions'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load contribution activity.');
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const nextReward = useMemo(
    () => data?.rewards.find((reward) => reward.credits > data.creditsBalance),
    [data],
  );

  async function redeem(rewardId: string) {
    setBusy(`redeem:${rewardId}`);
    setError('');
    setMessage('');
    try {
      await api('/platform/rewards', {
        method: 'POST',
        body: JSON.stringify({ operation: 'redeem', rewardId, requestId: crypto.randomUUID() }),
      });
      setMessage('Reward added to your wallet. Activate it whenever you are ready.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to redeem this reward.');
    } finally {
      setBusy('');
    }
  }

  async function activate(passId: string) {
    setBusy(`activate:${passId}`);
    setError('');
    setMessage('');
    try {
      await api('/platform/rewards', {
        method: 'POST',
        body: JSON.stringify({ operation: 'activate', passId }),
      });
      setMessage('Reward Pass activated. Your effective plan has been refreshed.');
      await load();
      onEntitlementChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to activate this reward.');
    } finally {
      setBusy('');
    }
  }

  if (!data && !error)
    return <div className="grid min-h-[50dvh] place-items-center"><LoaderCircle className="size-7 animate-spin text-primary" /></div>;

  return (
    <section className="q-page mx-auto w-full max-w-6xl space-y-6">
      <header>
        <p className="q-eyebrow">Contribution Center</p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Your contribution wallet</h1>
        <p className="mt-2 text-muted-foreground">Credits can be redeemed. Lifetime contribution never decreases.</p>
      </header>
      {error && <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}
      {message && <output className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300"><Check className="size-4" />{message}</output>}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              [Coins, 'Current Credits', data.creditsBalance.toLocaleString()],
              [Award, 'Lifetime Contribution', data.lifetimeContributionScore.toLocaleString()],
              [WalletCards, 'Status', data.badge ?? 'Getting started'],
            ].map(([Icon, label, value]) => (
              <article key={String(label)} className="rounded-2xl border bg-card p-5">
                <Icon className="size-5 text-primary" />
                <p className="mt-4 text-sm text-muted-foreground">{String(label)}</p>
                <strong className="mt-1 block text-2xl">{String(value)}</strong>
              </article>
            ))}
          </div>
          {nextReward && (
            <article className="rounded-2xl border bg-card p-5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <strong>Next reward</strong>
                <span>{nextReward.credits - data.creditsBalance} credits left for {PLAN_LIMITS[nextReward.plan].name} {nextReward.durationUnit}</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (data.creditsBalance / nextReward.credits) * 100)}%` }} />
              </div>
            </article>
          )}
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-2xl border bg-card p-5">
              <h2 className="flex items-center gap-2 font-bold"><Gift className="size-5 text-primary" />Rewards</h2>
              <div className="mt-4 space-y-2">
                {data.rewards.map((reward) => (
                  <div key={reward.id} className="flex items-center gap-3 rounded-xl border p-3">
                    <div className="min-w-0 flex-1">
                      <strong className="block">{PLAN_LIMITS[reward.plan].name} · {reward.duration} {reward.durationUnit}</strong>
                      <span className="text-sm text-muted-foreground">{reward.credits.toLocaleString()} credits</span>
                    </div>
                    <button className="q-button bg-primary text-primary-foreground" disabled={busy !== '' || data.creditsBalance < reward.credits} onClick={() => void redeem(reward.id)}>
                      {busy === `redeem:${reward.id}` ? 'Redeeming…' : 'Redeem'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-2xl border bg-card p-5">
              <h2 className="font-bold">Reward Pass wallet</h2>
              <div className="mt-4 space-y-2">
                {data.rewardPasses.length ? data.rewardPasses.map((pass) => (
                  <div key={pass.id} className="rounded-xl border p-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <strong>{PLAN_LIMITS[pass.plan].name} · {pass.duration} {pass.duration_unit}</strong>
                        <p className="mt-1 text-xs uppercase text-muted-foreground">{pass.status}{pass.expires_at ? ` · until ${new Date(pass.expires_at).toLocaleDateString()}` : ''}</p>
                      </div>
                      {pass.status === 'available' && (
                        <button className="q-button border" disabled={busy !== ''} onClick={() => void activate(pass.id)}><Play className="size-4" />Activate Now</button>
                      )}
                    </div>
                  </div>
                )) : <p className="text-sm text-muted-foreground">Redeemed rewards will stay here until you activate them.</p>}
              </div>
            </section>
          </div>
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="font-bold">Recent activity</h2>
            <p className="mt-1 text-sm text-muted-foreground">{data.pendingSubmissions} submission{data.pendingSubmissions === 1 ? '' : 's'} awaiting review</p>
            <div className="mt-4 divide-y">
              {data.submissions.map((submission) => (
                <div key={submission.id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="min-w-0 flex-1 capitalize">{submission.type.replace('_', ' ')}<span className="ml-2 text-xs text-muted-foreground">{new Date(submission.updated_at).toLocaleDateString()}</span></span>
                  <strong className="uppercase text-muted-foreground">{submission.status.replace('_', ' ')} · +0</strong>
                </div>
              ))}
              {data.transactions.length ? data.transactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="min-w-0 flex-1">{transaction.reason}<span className="ml-2 text-xs text-muted-foreground">{new Date(transaction.created_at).toLocaleDateString()}</span></span>
                  <strong className={transaction.amount > 0 ? 'text-emerald-600' : 'text-amber-700'}>{transaction.amount > 0 ? '+' : ''}{transaction.amount}</strong>
                </div>
              )) : <p className="py-4 text-sm text-muted-foreground">Approved contributions and redemptions will appear here.</p>}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
