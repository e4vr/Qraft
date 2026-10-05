'use client';

import { useEffect, useRef, useState } from 'react';
import { SubscriptionManager } from '@/components/subscription-manager';
import { SubscriptionAccess } from '@/components/subscription-access';
import { SubscriptionLegalConsent } from '@/components/subscription-legal-consent';
import { subscribeLive } from '@/lib/realtime-client';
import { Check, Crown, Eye, X } from 'lucide-react';
import { api } from '@/lib/api-client';
import { DEFAULT_LEGAL_LINKS, type LegalLinks } from '@/lib/legal-links';
import { setAuthenticatedUserCache } from '@/lib/application-services';
import type { AppUser } from '@/lib/medguard-types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  PLAN_LIMITS,
  PLAN_ORDER,
  PAID_PLAN_IDS,
  planDurationLabel,
  type PlanId,
} from '@/features/subscriptions/domain/plan-config';

export const openUpgrade = () =>
  window.dispatchEvent(new Event('qraft-upgrade'));
export function UpgradeButton() {
  return (
    <button
      type="button"
      onClick={openUpgrade}
      className="q-button inline-flex items-center gap-2 border border-amber-400/60 bg-amber-500/10 text-amber-800 dark:text-amber-200"
    >
      <Crown className="size-4" />
      View plans
    </button>
  );
}
type Quote = {
  original: number;
  discount: number;
  final: number;
  code: string;
  percent: number | null;
  plan: PlanId;
};
const sar = (cents: number) =>
  `${(cents / 100).toLocaleString('en', { maximumFractionDigits: 2 })} SAR`;
export function Subscribe({
  user,
  onUser,
}: {
  user: AppUser;
  onUser: (user: AppUser) => void;
}) {
  const [code, setCode] = useState(''),
    [appliedCode, setAppliedCode] = useState(''),
    [price, setPrice] = useState<Quote>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Exclude<PlanId, 'free'>>('full_quarterly');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [legalLinks, setLegalLinks] = useState(DEFAULT_LEGAL_LINKS);
  const [legalLinksReadyFor, setLegalLinksReadyFor] = useState('');
  const legalLinksReady = legalLinksReadyFor === user.uid;
  const [legalLinksError, setLegalLinksError] = useState('');
  const [legalLinksRetry, setLegalLinksRetry] = useState(0);
  const legalSnapshot = useRef({ uid: user.uid, value: JSON.stringify(DEFAULT_LEGAL_LINKS) });
  const actionInFlight = useRef(false);
  const quoteSequence = useRef(0);
  const currentPrice = price?.plan === selectedPlan ? price : undefined;
  const [catalogPlans,setCatalogPlans] = useState<Partial<Record<PlanId, typeof PLAN_LIMITS[PlanId] & {description?:string}>>>({});
  const catalogLimits = (id:PlanId): typeof PLAN_LIMITS[PlanId] & {description?:string} => catalogPlans[id] ?? PLAN_LIMITS[id];
  const [catalogPrices, setCatalogPrices] = useState<Partial<Record<PlanId, number>>>({});
  useEffect(() => {
    let active = true;
    const load = () => {
      void api<LegalLinks>('/platform/legal-links')
        .then(value => {
          if (!active) return;
          const links = { ...DEFAULT_LEGAL_LINKS, ...value };
          const snapshot = JSON.stringify(links);
          if (snapshot !== legalSnapshot.current.value || user.uid !== legalSnapshot.current.uid) setAcceptedTerms(false);
          legalSnapshot.current = { uid: user.uid, value: snapshot };
          setLegalLinks(links);
          setLegalLinksReadyFor(user.uid);
          setLegalLinksError('');
        })
        .catch(() => {
          if (!active) return;
          setLegalLinksReadyFor('');
          setAcceptedTerms(false);
          setLegalLinksError('Unable to load policies. Please try again.');
        });
    };
    load();
    const stop = subscribeLive(load, ['legal-links']);
    return () => { active = false; stop(); };
  }, [user.uid, legalLinksRetry]);
  useEffect(() => {
    let active = true;
    const load = () => void api<{plans:Array<typeof PLAN_LIMITS[PlanId] & {id:PlanId;price:number;description?:string}>}>('/platform/plan-catalog').then(result => { if(active) { setCatalogPrices(Object.fromEntries(result.plans.map(plan=>[plan.id,plan.price/100]))); setCatalogPlans(Object.fromEntries(result.plans.map(plan=>[plan.id,plan]))); } }).catch(error => { if(active) setError(error instanceof Error ? error.message : 'Unable to load plan prices.'); });
    load(); const stop = subscribeLive(load,['pricing']);
    return () => { active=false; stop(); };
  },[]);
  useEffect(() => {
    let active = true;
    const stop = subscribeLive(() => {
      if (actionInFlight.current) return;
      const sequence = ++quoteSequence.current;
      setPrice(undefined);
      void api<Quote>('/platform/quote', { method: 'POST', resourceQuery: true, cacheScope: user.uid, body: JSON.stringify({ code: appliedCode, plan: selectedPlan }) })
        .then(quote => { if (active && sequence === quoteSequence.current) setPrice(quote); })
        .catch(e => { if (active && sequence === quoteSequence.current) setError(e instanceof Error ? e.message : 'Unable to refresh price.'); });
    }, ['pricing']);
    return () => { active = false; stop(); };
  }, [appliedCode, selectedPlan, user.uid]);
  useEffect(() => {
    let live = true;
    const sequence = ++quoteSequence.current;
    api<Quote>('/platform/quote', {
      method: 'POST',
      resourceQuery: true,
      cacheScope: user.uid,
      body: JSON.stringify({ code: '', plan: selectedPlan }),
    })
      .then((q) => {
        if (live && sequence === quoteSequence.current) setPrice(q);
      })
      .catch((e) => {
        if (live && sequence === quoteSequence.current) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [selectedPlan, user.uid]);
  async function apply() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    ++quoteSequence.current;
    setBusy(true);
    setError('');
    setSuccess('');
    setAcceptedTerms(false);
    try {
      setPrice(
        await api<Quote>('/platform/quote', {
          method: 'POST',
          resourceQuery: true,
          cacheScope: user.uid,
          body: JSON.stringify({ code: code.trim().toUpperCase(), plan: selectedPlan }),
        }),
      );
      setAppliedCode(code.trim().toUpperCase());
      setRequestId(crypto.randomUUID());
    } catch (e) {
      setPrice(undefined);
      setError(e instanceof Error ? e.message : 'Unable to apply code.');
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }
  async function subscribe() {
    if (actionInFlight.current || !currentPrice) return;
    if (!acceptedTerms || !legalLinksReady) {
      setError('Please read and agree to all terms and policies before continuing.');
      return;
    }
    actionInFlight.current = true;
    ++quoteSequence.current;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await api<{ upgraded?: boolean; url?: string; user?: AppUser }>(
        '/platform/checkout',
        {
          method: 'POST',
          body: JSON.stringify({ code: currentPrice.code || '', requestId, plan: selectedPlan, acceptedTerms }),
        },
      );
      if (result.upgraded && result.user) {
        setAuthenticatedUserCache(result.user);
        onUser(result.user);
        setSuccess(`${catalogLimits(selectedPlan).name} is now active for ${planDurationLabel(selectedPlan)}.`);
      } else if (result.url) window.location.assign(result.url);
      else throw new Error('The subscription could not be confirmed. Please try again.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to subscribe.');
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-7">
      <SubscriptionAccess key={user.uid} user={user} onUser={onUser} />
      <div>
        <Crown className="mb-3 size-9 text-amber-500" />
        <h1 className="text-2xl font-bold sm:text-3xl">
          Choose the plan that fits your study
        </h1>
        <p className="mt-2 text-muted-foreground">
          Full access to Qraft. Choose one month or three months.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {PAID_PLAN_IDS.map((plan) => {
          const limits = catalogLimits(plan);
          const quarterly = plan === 'full_quarterly';
          const features = [
            limits.monthlyExamLimit === null && limits.lifetimeExamLimit === null ? 'Unlimited tests across your accessible QBanks' : `${limits.lifetimeExamLimit ?? limits.monthlyExamLimit} tests ${limits.lifetimeExamLimit !== null ? 'for account lifetime' : 'per month'}`,
            limits.canCreateReadyTests && 'Create independent Ready Tests',
            limits.canUseFlashcards && 'Turn questions into Flashcards',
            'Bookmark and flag questions',
            'Track daily progress and performance',
            limits.canUsePrivateNotes && 'Private notes and study tools',
            limits.canCreateQBank && 'Create and share QBanks',
            limits.canUseJsonImport && 'Import and contribute questions',
          ].filter((item): item is string => Boolean(item));
          return (
            <button
              type="button"
              key={plan}
              disabled={busy}
              aria-pressed={selectedPlan === plan}
              aria-label={`${limits.name}, ${planDurationLabel(plan)}`}
              onClick={() => {
                if (plan === selectedPlan || actionInFlight.current) return;
                ++quoteSequence.current;
                setPrice(undefined); setCode(''); setAppliedCode(''); setError(''); setSuccess('');
                setRequestId(crypto.randomUUID()); setSelectedPlan(plan);
                setAcceptedTerms(false);
              }}
              className={`relative flex flex-col rounded-3xl border p-6 text-left transition ${quarterly ? 'border-emerald-300 bg-gradient-to-br from-emerald-50/70 to-card dark:border-emerald-800 dark:from-emerald-950/40' : 'border-blue-200 bg-gradient-to-br from-blue-50/70 to-card dark:border-blue-800 dark:from-blue-950/40'} ${selectedPlan === plan ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
            >
              <span className={`mb-4 w-fit rounded-full px-3 py-1 text-xs font-bold ${quarterly ? 'bg-emerald-600 text-white' : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100'}`}>{quarterly ? 'BEST VALUE · 3 MONTHS' : 'MONTHLY PLAN'}</span>
              <strong className="text-2xl font-black">{limits.name}</strong>
              <p className="mt-1 text-muted-foreground">{planDurationLabel(plan)}</p>
              <p className={`my-5 text-4xl font-black ${quarterly ? 'text-emerald-700 dark:text-emerald-400' : 'text-blue-700 dark:text-blue-400'}`}>{catalogPrices[plan] === undefined ? 'Loading price…' : `${catalogPrices[plan]} SAR`}</p>
              {limits.description && <p className="mb-4 text-sm text-muted-foreground">{limits.description}</p>}
              <ul className="mb-6 space-y-3 border-t pt-5 text-sm">
                {features.map(feature => <li key={feature} className="flex items-start gap-2"><Check aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${quarterly ? 'text-emerald-600' : 'text-blue-600'}`} />{feature}</li>)}
              </ul>
              <span className={`mt-auto rounded-xl px-4 py-3 text-center font-semibold ${quarterly ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'}`}>{selectedPlan === plan ? 'Selected' : 'Choose this plan'}</span>
            </button>
          );
        })}
      </div>
      <div className="rounded-2xl border border-violet-300 bg-violet-50/60 p-5 dark:border-violet-800 dark:bg-violet-950/30">
        <strong className="text-lg">{catalogLimits('free').name}</strong>
        <p className="mt-2 text-sm text-muted-foreground">{catalogLimits('free').lifetimeExamLimit === null ? 'No lifetime exam limit' : `${catalogLimits('free').lifetimeExamLimit} tests for the lifetime of your account`}, from any accessible QBank, with up to {catalogLimits('free').maxQuestionsPerExam} questions per test.</p>
      </div>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setDetailsOpen(true)}
          className="q-button inline-flex items-center gap-2 border"
        >
          <Eye className="size-4" />
          Compare plan details
        </button>
      </div>
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[88dvh] overflow-x-hidden overflow-y-auto border-0 bg-[#f7fbfc] p-0 shadow-2xl dark:bg-slate-950 sm:max-w-5xl">
          <div className="border-b bg-gradient-to-br from-[#e8f8f7] via-background to-background px-5 py-7 text-center dark:from-[#0d2c36] sm:px-8">
            <DialogTitle className="px-8 text-2xl font-black tracking-tight text-[#07233d] dark:text-white sm:text-3xl">
              QBank subscription plans
            </DialogTitle>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              Choose the plan that fits how you study and contribute.
            </p>
          </div>
          <div className="px-3 pb-5 pt-4 sm:px-6 sm:pb-7">
          <div className="relative overflow-x-auto rounded-3xl border border-[#d6e8e8] bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <table className="w-full min-w-[700px] border-collapse text-sm">
              <thead className="text-left">
                <tr>
                  <th className="w-[25%] p-4 align-bottom font-semibold text-muted-foreground">Features</th>
                  {PLAN_ORDER.map((plan) => (
                    <th key={plan} className={`p-4 text-center align-bottom ${plan === 'full_quarterly' ? 'border-x-2 border-t-2 border-[#18b39f] bg-[#effcf9] dark:bg-[#123b3b]' : ''}`}>
                      {plan === 'full_quarterly' && <span className="mx-auto mb-2 flex w-fit items-center justify-center whitespace-nowrap rounded-full bg-[#18b39f] px-3 py-1 text-[10px] font-bold leading-4 text-white shadow-sm">Most popular</span>}
                      <span className="block text-lg font-black text-[#07233d] dark:text-white">{catalogLimits(plan).name}</span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">{plan === 'free' ? 'Start free' : catalogPrices[plan] === undefined ? '…' : `${catalogPrices[plan]} SAR / ${planDurationLabel(plan)}`}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Subscription price', (plan: PlanId) => plan === 'free' ? 'Free' : catalogPrices[plan] === undefined ? '…' : `${catalogPrices[plan]} SAR`],
                  ['Exams', (plan: PlanId) => catalogLimits(plan).lifetimeExamLimit !== null ? `${catalogLimits(plan).lifetimeExamLimit} for account lifetime` : catalogLimits(plan).monthlyExamLimit === null ? 'Unlimited' : `${catalogLimits(plan).monthlyExamLimit} per month`],
                  ['Subscription period', (plan: PlanId) => planDurationLabel(plan)],
                  ['Questions per test', (plan: PlanId) => plan === 'free' ? String(catalogLimits(plan).maxQuestionsPerExam) : 'Full question access'],
                  ['Create Ready Tests', (plan: PlanId) => catalogLimits(plan).canCreateReadyTests],
                  ['Create a QBank', (plan: PlanId) => catalogLimits(plan).canCreateQBank],
                  ['Add questions and contributions', (plan: PlanId) => catalogLimits(plan).canAddQuestions && catalogLimits(plan).canContribute],
                  ['Upload contribution images', (plan: PlanId) => catalogLimits(plan).canUploadImages],
                  ['JSON / AI import', (plan: PlanId) => catalogLimits(plan).canUseJsonImport],
                  ['Private notes', (plan: PlanId) => catalogLimits(plan).canUsePrivateNotes],
                  ['Flashcards', (plan: PlanId) => catalogLimits(plan).canUseFlashcards],
                ].map(([label, value]) => (
                  <tr key={String(label)} className="border-t">
                    <td className="border-t p-3 font-medium text-[#344b63] dark:text-slate-200">{String(label)}</td>
                    {PLAN_ORDER.map((plan) => {
                      const result = (value as (plan: PlanId) => string | boolean)(plan);
                      return (
                        <td key={plan} className={`border-t p-3 text-center text-muted-foreground ${plan === 'full_quarterly' ? 'border-x-2 border-x-[#18b39f] bg-[#effcf9] dark:bg-[#123b3b]' : ''}`}>
                          {typeof result === 'boolean' ? (result ? <span className="mx-auto grid size-6 place-items-center rounded-full bg-[#18b39f] text-white"><Check aria-hidden="true" className="size-4" /><span className="sr-only">Included</span></span> : <span className="mx-auto grid size-6 place-items-center rounded-full bg-red-100 text-red-500 dark:bg-red-950"><X aria-hidden="true" className="size-4" /><span className="sr-only">Not included</span></span>) : <span className="font-semibold text-[#07233d] dark:text-slate-100">{result}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        </DialogContent>
      </Dialog>
      <div className="q-subscription-checkout">
        <div className="q-subscription-summary-heading">
          <span>Subscription summary</span>
          <span className="q-subscription-duration">{planDurationLabel(selectedPlan)}</span>
        </div>
        {currentPrice ? (
          <div className="q-subscription-price" aria-live="polite">
            <p className="text-3xl font-black">
              {sar(currentPrice.final)}{' '}
            </p>
            {currentPrice.code && (
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  Original: <s>{sar(currentPrice.original)}</s>
                </p>
                <p>
                  Discount: {sar(currentPrice.discount)}{' '}
                  {currentPrice.percent !== null ? `(${currentPrice.percent}%)` : ''}
                </p>
                <p>Applied: {currentPrice.code}</p>
              </div>
            )}
          </div>
        ) : (
          <output>{error ? 'Price unavailable. Apply a valid code or leave it blank and try again.' : 'Loading price…'}</output>
        )}
        <label
          className="mt-5 block text-sm font-semibold"
          htmlFor="discount-code"
        >
          Discount code
        </label>
        <div className="q-subscription-discount mt-2 flex gap-2">
          <input
            id="discount-code"
            className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-3"
            placeholder="Enter code (optional)"
            maxLength={40}
            value={code}
            disabled={busy}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
          />
          <button
            className="q-button q-subscription-apply"
            disabled={busy}
            onClick={() => void apply()}
          >
            Apply
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {success && (
          <output className="mt-3 text-emerald-600">{success}</output>
        )}
        <SubscriptionLegalConsent links={legalLinks} accepted={acceptedTerms} busy={busy} ready={legalLinksReady} error={legalLinksError} onChange={setAcceptedTerms} onRetry={() => { setAcceptedTerms(false); setLegalLinksReadyFor(''); setLegalLinksError(''); setLegalLinksRetry(current => current + 1); }} />
        <button
          className="q-button q-subscription-submit mt-4 w-full bg-primary text-primary-foreground"
          disabled={busy || !currentPrice || !acceptedTerms || !legalLinksReady}
          onClick={() => void subscribe()}
        >
          {busy
            ? 'Processing…'
            : (user.effectivePlan ?? user.tier) === selectedPlan
              ? 'Renew subscription'
              : 'Subscribe now'}
        </button>
        <p className="q-subscription-payment-note mt-3 text-xs text-muted-foreground">
          Subscription requests open EduStack WhatsApp. Activation is confirmed by the administrator, including fully discounted requests.
        </p>
      </div>
    </section>
  );
}
export function UpgradeDialog({
  user,
  onUser,
}: {
  user: AppUser;
  onUser: (user: AppUser) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('qraft-upgrade', show);
    return () => window.removeEventListener('qraft-upgrade', show);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-3xl">
        <DialogTitle className="sr-only">Qraft Full Access</DialogTitle>
        <Subscribe user={user} onUser={onUser} />
      </DialogContent>
    </Dialog>
  );
}

export function SubscriptionAdmin({ section }: { section: 'discounts' | 'subscriptions' }) {
  return <SubscriptionManager initialTab={section === 'discounts' ? 'discounts' : 'members'} />;
}
