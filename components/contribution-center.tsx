'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Check, Coins, Gift, LoaderCircle, Play, WalletCards } from 'lucide-react';
import { CelebrationArtwork } from '@/components/reward-celebration-artwork';
import { rewardPassLabel as rewardLabel, type RewardPass } from '@/features/contributions/domain/reward-pass';
import { api, setApiCache } from '@/lib/api-client';
import {
  PLAN_LIMITS,
  rewardDurationLabel,
  type RewardCatalogEntry,
  type PlanId,
} from '@/features/subscriptions/domain/plan-config';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { subscribeLive } from '@/lib/realtime-client';
import type { AppUser } from '@/lib/medguard-types';

type CreditTransaction = {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
};

type Reward = RewardCatalogEntry;

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

type Celebration = {
  id: string;
  kind: 'goal' | 'redeemed';
  title: string;
  description: string;
  rewardLabel: string;
};

type CelebrationMemory = {
  lastBalance: number;
  seenAdminGiftIds: string[];
};

function findNewCelebrations(data: CenterData, userId: string): Celebration[] {
  const storageKey = `qraft-reward-celebration:${userId}`;
  let memory: CelebrationMemory = { lastBalance: 0, seenAdminGiftIds: [] };
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<CelebrationMemory>;
      memory = {
        lastBalance: Number.isFinite(parsed.lastBalance) ? Number(parsed.lastBalance) : 0,
        seenAdminGiftIds: Array.isArray(parsed.seenAdminGiftIds)
          ? parsed.seenAdminGiftIds.filter((id): id is string => typeof id === 'string')
          : [],
      };
    }
  } catch {
    // Private browsing can make localStorage unavailable; the celebration still works for this visit.
  }

  const queued: Celebration[] = [];
  const reachedReward = [...data.rewards]
    .filter((reward) => memory.lastBalance < reward.credits && data.creditsBalance >= reward.credits)
    .sort((a, b) => b.credits - a.credits)[0];
  if (reachedReward) {
    queued.push({
      id: `goal:${reachedReward.id}:${data.creditsBalance}`,
      kind: 'goal',
      title: 'You reached your reward goal!',
      description: 'Your contributions earned enough credits for this reward. It is ready to redeem now.',
      rewardLabel: `${PLAN_LIMITS[reachedReward.plan].name} · ${rewardDurationLabel(reachedReward)}`,
    });
  }

  memory.lastBalance = data.creditsBalance;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(memory));
  } catch {
    // The popup must not block the contribution center when storage is unavailable.
  }
  return queued;
}

export function ContributionCenter({
  userId,
  onEntitlementChange,
  focusedGiftId,
  deferCelebrations = false,
}: {
  userId: string;
  onEntitlementChange: (user: AppUser) => void;
  focusedGiftId?: string;
  deferCelebrations?: boolean;
}) {
  const [data, setData] = useState<CenterData>();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const contributionPath = `/platform/contributions${focusedGiftId ? `?gift=${encodeURIComponent(focusedGiftId)}` : ''}`;
  const load = useCallback(async () => {
    try {
      const next = await api<CenterData>(contributionPath, { cacheScope: userId, expectedUserId: userId });
      setData(next);
      const queued = findNewCelebrations(next, userId);
      if (queued.length) {
        setCelebrations((current) => {
          const known = new Set(current.map((item) => item.id));
          return [...current, ...queued.filter((item) => !known.has(item.id))];
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load contribution activity.');
    }
  }, [userId, contributionPath]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = subscribeLive(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 80);
    }, ['reward', 'reward-gift']);
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [load]);
  const nextReward = useMemo(
    () => data?.rewards.find((reward) => reward.credits > data.creditsBalance),
    [data],
  );

  const currentCelebration = celebrations[0];
  useEffect(() => {
    if (!focusedGiftId || !data?.rewardPasses.some(pass => pass.id === focusedGiftId)) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`reward-pass-${focusedGiftId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedGiftId, data]);

  async function redeem(rewardId: string) {
    setBusy(`redeem:${rewardId}`);
    setError('');
    setMessage('');
    try {
      const result = await api<{ pass: RewardPass; creditsBalance: number; duplicate?: boolean }>('/platform/rewards', {
        method: 'POST',
        expectedUserId: userId,
        body: JSON.stringify({ operation: 'redeem', rewardId, requestId: crypto.randomUUID() }),
      });
      setData(current => {
        if (!current) return current;
        const next = {
          ...current,
          creditsBalance: result.creditsBalance,
          rewardPasses: [result.pass, ...current.rewardPasses.filter(pass => pass.id !== result.pass.id)],
          transactions: current.transactions,
        };
        setApiCache(contributionPath, next, { cacheScope: userId });
        return next;
      });
      setMessage('Reward added to your wallet. Activate it whenever you are ready.');
      if (!result.duplicate) {
        setCelebrations((current) => [{
          id: `redeemed:${result.pass.id}`,
          kind: 'redeemed',
          title: 'Reward secured!',
          description: 'Your credits were redeemed successfully and the Reward Pass is now safely stored in your wallet.',
          rewardLabel: rewardLabel(result.pass),
        }, ...current.filter((item) => item.id !== `redeemed:${result.pass.id}`)]);
      }
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
      const result = await api<{ pass: RewardPass; effectivePlan: PlanId; user: AppUser }>('/platform/rewards', {
        method: 'POST',
        expectedUserId: userId,
        body: JSON.stringify({ operation: 'activate', passId }),
      });
      setData(current => {
        if (!current) return current;
        const next = { ...current, rewardPasses: current.rewardPasses.map(pass => pass.id === passId ? result.pass : pass) };
        setApiCache(contributionPath, next, { cacheScope: userId });
        return next;
      });
      setMessage('Reward Pass activated. Your effective plan has been refreshed.');
      onEntitlementChange(result.user);
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
      <Dialog
        open={Boolean(currentCelebration) && !deferCelebrations}
        onOpenChange={(open) => {
          if (!open) setCelebrations((current) => current.slice(1));
        }}
      >
        <DialogContent className="overflow-hidden border-0 bg-card p-0 shadow-[0_28px_90px_rgba(7,35,62,.3)] sm:max-w-md" showCloseButton={false}>
          {currentCelebration && (
            <>
              <CelebrationArtwork kind={currentCelebration.kind} />
              <div className="px-6 pb-6 pt-2 text-center sm:px-8 sm:pb-8">
                <DialogTitle className="text-2xl font-black tracking-tight sm:text-[1.75rem]">
                  {currentCelebration.title}
                </DialogTitle>
                <DialogDescription className="mx-auto mt-3 max-w-sm text-sm leading-6">
                  {currentCelebration.description}
                </DialogDescription>
                <div className="mx-auto mt-5 flex w-fit items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">
                  <Gift className="size-4" />
                  {currentCelebration.rewardLabel}
                </div>
                <button
                  className="q-button mt-6 w-full justify-center bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  onClick={() => setCelebrations((current) => current.slice(1))}
                >
                  {currentCelebration.kind === 'goal' ? 'View rewards' : 'Awesome, thank you!'}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <p className="text-sm text-muted-foreground">Credits can be redeemed. Lifetime contribution never decreases.</p>
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
                <span>{nextReward.credits - data.creditsBalance} credits left for {PLAN_LIMITS[nextReward.plan].name} · {rewardDurationLabel(nextReward)}</span>
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
                      <strong className="block">{PLAN_LIMITS[reward.plan].name} · {rewardDurationLabel(reward)}</strong>
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
                  <div key={pass.id} id={`reward-pass-${pass.id}`} className={`rounded-xl border p-3 ${pass.id === focusedGiftId ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : ''}`}>
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <strong>{rewardLabel(pass)}</strong>
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
