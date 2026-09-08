'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Check, Coins, Gift, LoaderCircle, PartyPopper, Play, Sparkles, Trophy, WalletCards } from 'lucide-react';
import { api } from '@/lib/api-client';
import { PLAN_LIMITS, type PlanId } from '@/lib/plan-config';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { subscribeLive } from '@/lib/realtime-client';

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

type Celebration = {
  id: string;
  kind: 'goal' | 'redeemed' | 'admin-gift';
  title: string;
  description: string;
  rewardLabel: string;
};

type CelebrationMemory = {
  lastBalance: number;
  seenAdminGiftIds: string[];
};

function rewardLabel(reward: Pick<RewardPass, 'plan' | 'duration' | 'duration_unit'>) {
  return `${PLAN_LIMITS[reward.plan].name} · ${reward.duration} ${reward.duration_unit}`;
}

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
  const unseenGift = data.rewardPasses.find(
    (pass) => pass.source === 'admin' && !memory.seenAdminGiftIds.includes(pass.id),
  );
  if (unseenGift) {
    queued.push({
      id: `admin-gift:${unseenGift.id}`,
      kind: 'admin-gift',
      title: 'A gift is waiting for you',
      description: 'The Qraft team has added a reward to your wallet. You can activate it whenever you are ready.',
      rewardLabel: rewardLabel(unseenGift),
    });
    memory.seenAdminGiftIds = [unseenGift.id, ...memory.seenAdminGiftIds].slice(0, 100);
  }

  const reachedReward = [...data.rewards]
    .filter((reward) => memory.lastBalance < reward.credits && data.creditsBalance >= reward.credits)
    .sort((a, b) => b.credits - a.credits)[0];
  if (reachedReward) {
    queued.push({
      id: `goal:${reachedReward.id}:${data.creditsBalance}`,
      kind: 'goal',
      title: 'You reached your reward goal!',
      description: 'Your contributions earned enough credits for this reward. It is ready to redeem now.',
      rewardLabel: `${PLAN_LIMITS[reachedReward.plan].name} · ${reachedReward.duration} ${reachedReward.durationUnit}`,
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

function CelebrationArtwork({ kind }: { kind: Celebration['kind'] }) {
  const Icon = kind === 'goal' ? Trophy : kind === 'admin-gift' ? Gift : PartyPopper;
  const pieces = [
    ['12%', '18%', '#5ee0bd', '0ms'],
    ['24%', '64%', '#ffffff', '180ms'],
    ['38%', '12%', '#fbbf24', '340ms'],
    ['55%', '72%', '#67e8f9', '90ms'],
    ['69%', '19%', '#ffffff', '260ms'],
    ['82%', '58%', '#5ee0bd', '420ms'],
    ['91%', '27%', '#fbbf24', '140ms'],
  ] as const;

  return (
    <div className="relative grid min-h-48 place-items-center overflow-hidden bg-[radial-gradient(circle_at_50%_20%,rgba(94,224,189,0.34),transparent_42%),linear-gradient(135deg,#07233e,#0c4f60_58%,#228e85)] px-6 py-9 text-white">
      <div aria-hidden="true" className="absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      {pieces.map(([left, top, color, delay], index) => (
        <span
          aria-hidden="true"
          className="q-celebration-confetti absolute h-2.5 w-1.5 rounded-full"
          key={`${left}:${top}`}
          style={{ left, top, backgroundColor: color, animationDelay: delay, rotate: `${index * 23}deg` }}
        />
      ))}
      <div className="relative flex flex-col items-center">
        <div className="grid size-20 place-items-center rounded-[1.75rem] border border-white/35 bg-white/15 shadow-[0_18px_55px_rgba(0,0,0,.28)] backdrop-blur-md">
          <Icon className="size-10" strokeWidth={1.8} />
        </div>
        <div className="mt-5 flex items-center gap-2 text-[11px] font-black tracking-[0.24em] text-emerald-100">
          <Sparkles className="size-3.5" /> CONGRATULATIONS <Sparkles className="size-3.5" />
        </div>
      </div>
    </div>
  );
}

export function ContributionCenter({
  userId,
  onEntitlementChange,
}: {
  userId: string;
  onEntitlementChange: () => void;
}) {
  const [data, setData] = useState<CenterData>();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const load = useCallback(async () => {
    try {
      const next = await api<CenterData>('/platform/contributions');
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
  }, [userId]);
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

  async function redeem(rewardId: string) {
    setBusy(`redeem:${rewardId}`);
    setError('');
    setMessage('');
    try {
      const result = await api<{ pass: RewardPass; duplicate?: boolean }>('/platform/rewards', {
        method: 'POST',
        body: JSON.stringify({ operation: 'redeem', rewardId, requestId: crypto.randomUUID() }),
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
      <Dialog
        open={Boolean(currentCelebration)}
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
