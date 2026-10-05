'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, BookOpenCheck, Check, Crown } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api-client';
import type { AppUser } from '@/lib/medguard-types';
import { getPlanLimits, type PlanId, type PlanLimits } from '@/features/subscriptions/domain/plan-config';
import { exhaustedExamAllowance, type ExamUpgradeReason, type ExamUsage } from '@/features/subscriptions/domain/exam-access';

export interface ExamUpgradeRequest { uid: string; plan: PlanId; reason: ExamUpgradeReason }
const presented = new Set<string>();
interface Status { plan: PlanId; limits: PlanLimits; usage: ExamUsage }
// Let announcements and other existing dialogs finish before showing this one.
const otherDialogOpen = () => Boolean(document.querySelector('[role="dialog"]:not([data-exam-access-dialog]):not([data-closed]), [role="alertdialog"]:not([data-closed])'));
const noDialogOnServer = () => false;
const noSubscription = () => () => undefined;
function watchDialogs(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'data-closed'] });
  return () => observer.disconnect();
}

export function ExamAccessNotice({ user, request, defer, onViewPlans }: {
  user: AppUser;
  request: ExamUpgradeRequest | null;
  defer: boolean;
  onViewPlans: () => void;
}) {
  const plan = user.effectivePlan ?? user.tier;
  const limits = user.planLimits ?? getPlanLimits(plan);
  const limited = limits.lifetimeExamLimit !== null || limits.monthlyExamLimit !== null;
  const blockedByDialog = useSyncExternalStore(limited ? watchDialogs : noSubscription, otherDialogOpen, noDialogOnServer);
  const [snapshot, setSnapshot] = useState<{ uid: string; value: Status } | null>(null);
  const [dismissedRequest, setDismissedRequest] = useState<ExamUpgradeRequest | null>(null);
  const [dismissedAutomatic, setDismissedAutomatic] = useState('');
  const sequence = useRef(0);
  useEffect(() => {
    if (!limited) return;
    let active = true;
    const load = (forceRefresh = false) => {
      const current = ++sequence.current;
      void api<Status>('/platform/plan-status', { cacheScope: user.uid, forceRefresh })
        .then(value => { if (active && current === sequence.current) setSnapshot({ uid: user.uid, value }); })
        .catch(() => undefined);
    };
    load(true);
    const started = (event: Event) => {
      if ((event as CustomEvent<{ uid: string }>).detail?.uid === user.uid) load(true);
    };
    window.addEventListener('qraft-exam-started', started);
    return () => { active = false; window.removeEventListener('qraft-exam-started', started); };
  }, [user.uid, plan, limited, limits.lifetimeExamLimit, limits.monthlyExamLimit]);

  const current = snapshot?.uid === user.uid && snapshot.value.plan === plan ? snapshot.value : null;
  const exhausted = limited && current ? exhaustedExamAllowance(current.limits, current.usage) : null;
  const requested = request?.uid === user.uid && request.plan === plan && (request.reason === 'exams' ? limited : plan === 'free') ? request.reason : null;
  const questionLimit = current?.limits.maxQuestionsPerExam ?? limits.maxQuestionsPerExam;
  const free = plan === 'free';
  const allowance = exhausted ?? (limits.lifetimeExamLimit !== null ? 'lifetime' : 'monthly');
  const period = allowance === 'monthly' ? new Date().toISOString().slice(0, 7) : 'lifetime';
  const automaticKey = JSON.stringify([user.uid, plan, allowance, (current?.limits ?? limits)[allowance === 'monthly' ? 'monthlyExamLimit' : 'lifetimeExamLimit'], period]);
  const explicit = requested && request !== dismissedRequest ? requested : null;
  const prompt = explicit ?? (exhausted && !presented.has(automaticKey) && automaticKey !== dismissedAutomatic ? 'exams' : null);
  const dismiss = () => {
    setDismissedRequest(request);
    if (prompt === 'exams') { presented.add(automaticKey); setDismissedAutomatic(automaticKey); }
  };

  const visible = !defer && (exhausted || requested === 'exams' || (free && requested === 'questions'));
  const viewPlans = () => { dismiss(); onViewPlans(); };
  return <>
    {visible && (
      <div className="px-4 py-3 sm:px-6">
        <button type="button" onClick={viewPlans} aria-label="View subscription plans" className="group flex min-h-12 w-full items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4">
          <Crown className="size-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-sm font-medium">{exhausted || requested === 'exams' ? free ? 'Your free exams are complete. Keep studying with Full.' : 'Your exam allowance is used. View your subscription options.' : `Want more than ${questionLimit} questions? Explore Full.`}</span>
          <span className="hidden shrink-0 text-xs font-semibold text-primary sm:inline">View plans</span><ArrowRight className="size-4 shrink-0 text-primary transition group-hover:translate-x-0.5" />
        </button>
      </div>
    )}
    <Dialog open={prompt !== null && !defer && !blockedByDialog} onOpenChange={open => { if (!open) dismiss(); }}>
      <DialogContent data-exam-access-dialog="true" className="sm:max-w-md">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Crown className="size-6" /></span>
        <DialogTitle className="pr-8 text-xl font-bold">{prompt === 'questions' ? 'Ready for a longer practice session?' : free ? 'Keep your study momentum' : 'Your exam allowance is complete'}</DialogTitle>
        <DialogDescription className="text-sm leading-6">{prompt === 'questions' ? `Your free plan includes up to ${questionLimit} questions per exam. Explore Full for larger practice sessions that fit your study goals.` : free ? 'You’ve used your free practice exams. Continue with Full to create more exams and build larger question sets at your own pace.' : 'You’ve used the exam allowance included in your current plan. Visit your subscription page to explore your options.'}</DialogDescription>
        {free && <div className="space-y-2 rounded-xl bg-muted/40 p-3 text-sm"><p className="flex items-center gap-2"><BookOpenCheck className="size-4 shrink-0 text-primary" />More practice exams and larger question sets</p><p className="flex items-center gap-2"><Check className="size-4 shrink-0 text-primary" />Your progress and saved work stay with you</p><p className="flex items-center gap-2"><Check className="size-4 shrink-0 text-primary" />Choose monthly or 3-month access</p></div>}
        <div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={dismiss} className="min-h-11 rounded-xl border px-4 text-sm font-semibold">Maybe later</button><button type="button" onClick={viewPlans} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">{free ? 'Explore Full plans' : 'View subscription'}<ArrowRight className="size-4" /></button></div>
      </DialogContent>
    </Dialog>
  </>;
}
