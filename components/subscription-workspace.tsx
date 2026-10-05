'use client';

import { useEffect, useRef, useState } from 'react';
import { SubscriptionLegalConsent } from '@/components/subscription-legal-consent';
import { addCalendarDuration } from '@/features/subscriptions/domain/calendar-duration';
import { subscribeLive } from '@/lib/realtime-client';
import { Check, Crown, Eye, X, Search, Ticket, Users, ShieldCheck, Pencil, Plus, ChevronLeft, ChevronRight, History, SlidersHorizontal } from 'lucide-react';
import { api, setApiCache } from '@/lib/api-client';
import { DEFAULT_LEGAL_LINKS, type LegalLinks } from '@/lib/legal-links';
import { setAuthenticatedUserCache } from '@/lib/application-services';
import type { AppUser } from '@/lib/medguard-types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  PLAN_LIMITS,
  PLAN_ORDER,
  PAID_PLAN_IDS,
  PLAN_DURATION_MONTHS,
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
const localDateTime = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
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
          {currentPrice?.final === 0
            ? `${catalogLimits(selectedPlan).name} activates immediately after you confirm the subscription.`
            : 'Subscription requests open EduStack WhatsApp. Paid activation is confirmed by the administrator.'}
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

type Code = {
  id: string;
  code: string;
  kind: string;
  amount: number;
  enabled: number;
  starts_at: string | null;
  expires_at: string | null;
  max_uses: number | null;
  per_user: number | null;
  uses: number;
  allowed_plans: string;
};
type Subscription = {
  uid: string;
  email: string;
  name: string;
  tier: PlanId;
  override_plan: PlanId | null;
  override_expires_at: string | null;
  override_reason: string | null;
  access_revision?: number;
  access_revoked_at?: string | null;
  effective_expires_at?: string | null;
  reward_plan: PlanId | null;
  status: string | null;
  starts_at: string | null;
  expires_at: string | null;
  method: string | null;
  discount_code: string | null;
  paid: number | null;
  plan: PlanId | null;
};
type Usage = {
  id: string;
  user_id: string;
  email: string;
  name: string;
  code: string;
  original: number;
  discount: number;
  final: number;
  status: string;
  created_at: string;
  starts_at: string;
  expires_at: string;
  detail: string;
};
const emptyCode: Code = {
  id: '',
  code: '',
  kind: 'percent',
  amount: 100,
  enabled: 1,
  starts_at: null,
  expires_at: null,
  max_uses: null,
  per_user: 1,
  uses: 0,
  allowed_plans: '["full_monthly","full_quarterly"]',
};
const codeSignature = (code: Code) => JSON.stringify({
  id: code.id,
  code: code.code.trim().toUpperCase(),
  kind: code.kind,
  amount: code.amount,
  enabled: Boolean(code.enabled),
  starts_at: code.starts_at,
  expires_at: code.expires_at,
  max_uses: code.max_uses,
  per_user: code.per_user,
  allowedPlans: [...(JSON.parse(code.allowed_plans || '[]') as string[])].sort(),
});
export function SubscriptionAdmin({
  section,
}: {
  section: 'discounts' | 'subscriptions';
}) {
  const [today] = useState(() => Date.now());
  const [extensionDays, setExtensionDays] = useState('30');
  const [confirmAction, confirmationDialog] = useConfirmationDialog();
  const [codes, setCodes] = useState<Code[]>([]),
    [subscriptions, setSubscriptions] = useState<Subscription[]>([]),
    [events, setEvents] = useState<Usage[]>([]),
    [draft, setDraft] = useState<Code>(emptyCode),
    [originalCode, setOriginalCode] = useState<Code | null>(null),
    [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<Subscription>(),
    [end, setEnd] = useState(''),
    [paid, setPaid] = useState('0'),
    [manualCode, setManualCode] = useState(''),
    [manualPlan, setManualPlan] = useState<PlanId>('full_monthly'),
    [noExpiration, setNoExpiration] = useState(true),
    [reason, setReason] = useState(''),
    [planDrafts, setPlanDrafts] = useState<Record<string, PlanId>>({}),
    [saving, setSaving] = useState(false),
    [summary, setSummary] = useState<Record<string, number>>({}),
    [usageOffset, setUsageOffset] = useState(0),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [sort, setSort] = useState('expiration'),
    [offset, setOffset] = useState(0),
    [usageCode, setUsageCode] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const queryPath = section === 'discounts'
    ? `/platform/discounts?search=${encodeURIComponent(search.trim())}&status=${status}&offset=${offset}&id=${encodeURIComponent(usageCode)}&usageOffset=${usageOffset}`
    : `/platform/subscriptions?search=${encodeURIComponent(search.trim())}&status=${status}&sort=${sort}&offset=${offset}`;
  useEffect(
    () =>
      subscribeLive(
        () => setRevision((revision) => revision + 1),
        [section === 'discounts' ? 'pricing' : 'account'],
      ),
    [section],
  );
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      api<{
        codes?: Code[];
        subscriptions?: Subscription[];
        events?: Usage[];
        price?: number;
        summary?: Record<string, number>;
      }>(queryPath)
        .then((r) => {
          if (!live) return;
          setSummary(r.summary ?? {});
          setCodes(r.codes ?? []);
          setSubscriptions(r.subscriptions ?? []);
          setEvents(r.events ?? []);
          setError('');
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [queryPath, revision]);
  async function save(body: unknown, method = 'POST') {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const accessAssignment = body && typeof body === 'object' && 'operation' in body && body.operation === 'override';
      const revocation = accessAssignment && 'plan' in body && body.plan === 'free';
      const requestBody = revocation ? { ...body, requestId: crypto.randomUUID(), expires_at: null } : body;
      const result = await api<{
        effectivePlan?: PlanId;
        code?: Code;
        deletedId?: string;
        price?: number;
        subscription?: Partial<Subscription>;
        override?: { plan: PlanId; expires_at: string | null; reason: string } | null;
        adminOverridePlan?: PlanId | null;
        effectivePlanExpiresAt?: string | null;
        accessRevision?: number;
        accessRevokedAt?: string | null;
        revoked?: boolean;
        unchanged?: boolean;
      }>(`/platform/${section}`, { method, body: JSON.stringify(requestBody) });
      const override = body && typeof body === 'object' && 'operation' in body && body.operation === 'override';
      setMessage(result.revoked ? 'Current access revoked. Stored gifts can still be activated.' : override ? `${PLAN_LIMITS[result.effectivePlan!].name} access is active now.` : 'Changes saved successfully.');
      setEditing(false);
      setOriginalCode(null);
      setSelected(undefined);
      let nextCodes = codes;
      let nextSubscriptions = subscriptions;
      if (section === 'discounts') {
        if (result.deletedId) nextCodes = codes.filter(code => code.id !== result.deletedId);
        else if (result.code) nextCodes = [result.code, ...codes.filter(code => code.id !== result.code!.id)];
        setCodes(nextCodes);
      }
      if (section === 'subscriptions' && body && typeof body === 'object' && 'userId' in body) {
        const userId = String(body.userId);
        setPlanDrafts(current => { const next = { ...current }; delete next[userId]; return next; });
        if (result.effectivePlan) {
          nextSubscriptions = subscriptions.map(row => row.uid === userId ? {
            ...row,
            ...result.subscription,
            tier: result.effectivePlan!,
            override_plan: result.adminOverridePlan ?? null,
            override_expires_at: result.adminOverridePlan ? result.override?.expires_at ?? row.override_expires_at : null,
            override_reason: result.adminOverridePlan ? result.override?.reason ?? row.override_reason : null,
            access_revision: result.accessRevision,
            access_revoked_at: result.accessRevokedAt,
            effective_expires_at: result.effectivePlanExpiresAt,
          } : row);
          setSubscriptions(nextSubscriptions);
        }
        // Consumers re-fetch the authoritative session; never guess access from a billing action.
        window.dispatchEvent(new CustomEvent('qraft-account-updated', { detail: { userId, ...(result.effectivePlan ? { tier: result.effectivePlan } : {}) } }));
      }
      if (!search && !status && offset === 0 && !usageCode && usageOffset === 0)
        setApiCache(queryPath, section === 'discounts'
          ? { codes: nextCodes, events, summary }
          : { subscriptions: nextSubscriptions, summary });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save.');
    } finally {
      setSaving(false);
    }
  }
  function openSubscription(row: Subscription) {
    setSelected(row); setManualPlan(row.tier); setReason(row.override_reason ?? '');
    setNoExpiration(!row.override_expires_at);
    setEnd((row.override_expires_at || row.expires_at || addCalendarDuration(new Date().toISOString(), PLAN_DURATION_MONTHS[row.tier] || 1, 'month')).slice(0, 10));
    setPaid(String((row.paid ?? 0) / 100)); setManualCode(''); setError(''); setMessage('');
  }
  const date = (value: string | null) => value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const codeStatus = (c: Code) => !c.enabled ? 'Disabled' : c.expires_at && Date.parse(c.expires_at) <= today ? 'Expired' : c.max_uses !== null && c.uses >= c.max_uses ? 'Exhausted' : c.starts_at && Date.parse(c.starts_at) > today ? 'Scheduled' : 'Active';
  const pageRows = section === 'discounts' ? codes : subscriptions;
  const field = 'w-full min-w-0 rounded-xl border bg-background px-3 py-2.5';
  return (
    <section className="q-control-workspace">
      {error && <p role="alert" className="q-control-feedback q-control-error">{error}</p>}
      {message && !error && <output className="q-control-feedback">{message}</output>}
      <div className="q-control-summary">
        {(section === 'discounts' ? [{ label: 'Matching codes', value: summary.total, icon: Ticket }, { label: 'Enabled codes', value: summary.enabled, icon: Check }, { label: 'Total redemptions', value: summary.uses, icon: History }] : [{ label: 'Matching accounts', value: summary.total, icon: Users }, { label: 'Paid-plan access', value: summary.paid, icon: Crown }, { label: 'Admin assignments', value: summary.overrides, icon: ShieldCheck }]).map(item => <div key={item.label}><item.icon className="size-5" /><span>{item.label}</span><strong>{busy ? '…' : (item.value ?? 0).toLocaleString()}</strong></div>)}
      </div>
      <div className="q-control-table-panel">
        <div className="q-control-panel-heading"><div><h2>{section === 'discounts' ? 'Discount codes' : 'Subscribers'}</h2><p>{section === 'discounts' ? 'Promotion rules, availability and usage in one place.' : 'Review effective access and assign any plan immediately.'}</p></div>{section === 'discounts' && <button className="q-button q-button-primary" onClick={() => { setDraft(emptyCode); setOriginalCode(null); setEditing(true); setError(''); }}><Plus className="size-4" />New code</button>}</div>
        <div className="q-control-toolbar">
          <label className="q-control-search"><Search className="size-4" /><input aria-label={section === 'discounts' ? 'Search discount codes' : 'Search subscribers'} placeholder={section === 'discounts' ? 'Search by code…' : 'Search name, email or user ID…'} value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} /></label>
          <select aria-label={section === 'discounts' ? 'Discount status' : 'Subscription filter'} value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}>
            {(section === 'discounts' ? [['','All statuses'],['active','Active'],['disabled','Disabled'],['scheduled','Scheduled'],['expired','Expired'],['exhausted','Usage limit reached']] : [['','All accounts'], ...PLAN_ORDER.map(plan => [plan, PLAN_LIMITS[plan].name]),['override','Admin assigned'],['active','Active billing'],['expired','Expired billing'],['cancelled','Cancelled billing'],['manually_activated','Manual billing'],['none','No billing record']]).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {section === 'subscriptions' && <select aria-label="Sort subscriptions" value={sort} onChange={e => { setSort(e.target.value); setOffset(0); }}><option value="expiration">Expiration date</option><option value="name">Email A–Z</option></select>}
          <span className="q-control-result-count">{summary.total ?? 0} results</span>
        </div>
        <div className="q-control-table-scroll" aria-busy={busy || saving}>
          <table className="q-control-table"><thead><tr>{(section === 'discounts' ? ['Code','Discount & plans','Status','Usage','Validity','Actions'] : ['Member','Effective access','Assign plan','Access / billing dates','Payment record','Actions']).map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>
            {section === 'discounts' ? codes.slice(0,50).map(c => <tr key={c.id}>
              <td data-label="Code"><strong className="q-control-code">{c.code}</strong><small>{c.per_user ?? 'Unlimited'} per member</small></td>
              <td data-label="Discount & plans"><strong>{c.kind === 'percent' ? `${c.amount}% off` : `${sar(c.amount)} off`}</strong><small>{(JSON.parse(c.allowed_plans || '[]') as PlanId[]).map(plan => PLAN_LIMITS[plan]?.name ?? plan).join(' · ') || 'All plans'}</small></td>
              <td data-label="Status"><span className="q-control-badge" data-tone={codeStatus(c) === 'Active' ? 'success' : 'neutral'}>{codeStatus(c)}</span></td>
              <td data-label="Usage"><strong>{c.uses.toLocaleString()} <span className="text-muted-foreground">/ {c.max_uses ?? '∞'}</span></strong><small>redemptions</small></td>
              <td data-label="Validity"><span>{c.starts_at ? date(c.starts_at) : 'Starts immediately'}</span><small>{c.expires_at ? `Until ${date(c.expires_at)}` : 'No expiration'}</small></td>
              <td data-label="Actions"><div className="q-control-row-actions"><button aria-label={`Edit ${c.code}`} onClick={() => { setDraft(c); setOriginalCode(c); setEditing(true); setError(''); }}><Pencil className="size-4" />Edit</button><button aria-label={`Usage history for ${c.code}`} onClick={() => { setUsageCode(c.id); setUsageOffset(0); }}><History className="size-4" />History</button><details><summary aria-label={`More actions for ${c.code}`}><SlidersHorizontal className="size-4" /></summary><div><button disabled={saving} onClick={() => void save({ ...c, enabled: !c.enabled })}>{c.enabled ? 'Disable code' : 'Enable code'}</button><button disabled={saving} className="text-destructive" onClick={async () => { if(await confirmAction({title:`Delete code ${c.code}?`,description:'The discount code will be removed, while its usage history remains available for auditing.',confirmLabel:'Delete code',tone:'destructive'})) void save({id:c.id},'DELETE'); }}>Delete code</button></div></details></div></td>
            </tr>) : subscriptions.slice(0,50).map(row => <tr key={row.uid}>
              <td data-label="Member"><strong>{row.name}</strong><span className="q-control-email">{row.email}</span><small className="q-control-uid" title={row.uid}>{row.uid}</small></td>
              <td data-label="Effective access"><span className="q-control-badge" data-plan={row.tier}>{PLAN_LIMITS[row.tier]?.name ?? row.tier}</span><small>{row.override_plan ? 'Admin assigned' : row.tier === 'free' && (row.access_revision ?? 0)>0 ? 'Current access revoked' : row.reward_plan === row.tier ? 'Reward access' : 'Standard access'}</small></td>
              <td data-label="Assign plan"><div className="q-control-plan-editor"><select aria-label={`Plan for ${row.email}`} disabled={saving} value={planDrafts[row.uid] ?? row.tier} onChange={e => setPlanDrafts(current => ({...current,[row.uid]:e.target.value as PlanId}))}>{PLAN_ORDER.map(plan => <option key={plan} value={plan}>{plan === 'free' ? 'Revoke current access' : `${PLAN_LIMITS[plan].name} · ${planDurationLabel(plan)}`}</option>)}</select><button disabled={saving || !planDrafts[row.uid]} onClick={() => void save({operation:'override',userId:row.uid,plan:planDrafts[row.uid],expires_at:null,reason:'Assigned from subscribers dashboard'})}>Apply</button></div><small>{(planDrafts[row.uid] ?? row.tier) === 'free' ? 'Revokes current access · new gifts allowed' : 'Immediate · no expiration'}</small></td>
              <td data-label="Access / billing dates"><span>{row.tier === 'free' ? 'Free access' : row.effective_expires_at ? `Access until ${date(row.effective_expires_at)}` : 'Access has no expiration'}</span><small>{row.expires_at ? `Billing until ${date(row.expires_at)}` : 'No billing expiration'}</small><small>{row.starts_at ? `Billing since ${date(row.starts_at)}` : 'No billing start date'}</small>{row.expires_at && <small>{Math.max(0,Math.ceil((Date.parse(row.expires_at)-today)/86400000))} billing days left</small>}</td>
              <td data-label="Payment record"><strong>{sar(row.paid ?? 0)}</strong><small>{row.method || 'No payment method'} · {row.status?.replaceAll('_',' ') || 'No billing record'}</small><small>Code: {row.discount_code || '—'}</small></td>
              <td data-label="Actions"><button className="q-control-manage" onClick={() => openSubscription(row)}><SlidersHorizontal className="size-4" />Manage</button></td>
            </tr>)}
            {!busy && !pageRows.length && <tr><td colSpan={6} className="q-control-empty"><Search className="size-6" /><strong>No matching {section === 'discounts' ? 'codes' : 'accounts'}</strong><p>Try another search or clear the filters.</p></td></tr>}
          </tbody></table>
        </div>
        <div className="q-control-pagination"><span>{busy ? 'Updating…' : `Page ${Math.floor(offset/50)+1} · ${summary.total ?? 0} results`}</span><div><button aria-label="Previous page" disabled={busy || saving || offset===0} onClick={() => setOffset(Math.max(0,offset-50))}><ChevronLeft className="size-4" />Previous</button><button aria-label="Next page" disabled={busy || saving || pageRows.length<=50} onClick={() => setOffset(offset+50)}>Next<ChevronRight className="size-4" /></button></div></div>
      </div>
      <Dialog open={Boolean(usageCode)} onOpenChange={open => { if(!open) setUsageCode(''); }}><DialogContent className="sm:max-w-4xl"><DialogTitle>Discount usage · {codes.find(c => c.id === usageCode)?.code ?? 'History'}</DialogTitle><div className="q-control-table-scroll"><table className="q-control-table"><thead><tr>{['Member','Transaction','Amount','Validity'].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{events.slice(0,50).map(event => <tr key={event.id}><td data-label="Member"><strong>{event.name}</strong><span>{event.email}</span><small>{event.user_id}</small></td><td data-label="Transaction"><strong>{event.code}</strong><small>{event.status} · {date(event.created_at)}</small><small>{event.detail}</small></td><td data-label="Amount"><strong>{sar(event.final)}</strong><small>Original: {sar(event.original)}</small><small>Discount: {sar(event.discount)}</small></td><td data-label="Validity">{date(event.starts_at)}<small>Until {date(event.expires_at)}</small></td></tr>)}</tbody></table>{!events.length && <p className="q-control-empty">{busy ? 'Loading history…' : 'No redemptions recorded.'}</p>}</div><div className="q-control-pagination"><span>Page {Math.floor(usageOffset/50)+1}</span><div><button disabled={busy || usageOffset===0} onClick={() => setUsageOffset(Math.max(0,usageOffset-50))}>Previous</button><button disabled={busy || events.length<=50} onClick={() => setUsageOffset(usageOffset+50)}>Next</button></div></div></DialogContent></Dialog>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-xl">
          <DialogTitle>
            {draft.id ? 'Edit' : 'Create'} discount code
          </DialogTitle>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (originalCode && codeSignature(draft) === codeSignature(originalCode)) {
                setEditing(false);
                setMessage('No changes to save.');
                return;
              }
              void save({
                ...draft,
                allowedPlans: JSON.parse(draft.allowed_plans || '[]'),
              });
            }}
          >
            <label>
              Code
              <input
                required
                className={field}
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              />
            </label>
            <label>
              Type
              <select
                className={field}
                value={draft.kind}
                onChange={(e) =>
                  setDraft({ ...draft, kind: e.target.value, amount: 0 })
                }
              >
                <option value="percent">Percentage</option>
                <option value="fixed">Fixed SAR</option>
              </select>
            </label>
            <label>
              {draft.kind === 'percent' ? 'Percentage' : 'Amount (SAR)'}
              <input
                required
                type="number"
                min="0"
                max={draft.kind === 'percent' ? 100 : 100000}
                step={draft.kind === 'percent' ? 1 : 0.01}
                className={field}
                value={
                  draft.kind === 'fixed' ? draft.amount / 100 : draft.amount
                }
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    amount: Math.round(
                      Number(e.target.value) *
                        (draft.kind === 'fixed' ? 100 : 1),
                    ),
                  })
                }
              />
            </label>
            {(['starts_at', 'expires_at'] as const).map((k) => (
              <label key={k}>
                {k === 'starts_at' ? 'Start date' : 'Expiration date'}
                <input
                  type="datetime-local"
                  className={field}
                  value={localDateTime(draft[k])}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [k]: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                    })
                  }
                />
              </label>
            ))}
            {(['max_uses', 'per_user'] as const).map((k) => (
              <label key={k}>
                {k === 'max_uses' ? 'Total uses' : 'Uses per user'}
                <input
                  type="number"
                  min="1"
                  placeholder="Unlimited"
                  className={field}
                  value={draft[k] ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [k]: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </label>
            ))}
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-semibold">Allowed paid plans</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {PAID_PLAN_IDS.map((plan) => {
                  const selected = (JSON.parse(draft.allowed_plans || '[]') as string[]).includes(plan);
                  return (
                    <label key={plan} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm capitalize">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => {
                          const current = new Set(JSON.parse(draft.allowed_plans || '[]') as string[]);
                          if (event.target.checked) current.add(plan);
                          else current.delete(plan);
                          setDraft({ ...draft, allowed_plans: JSON.stringify([...current]) });
                        }}
                      />
                      {plan}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(draft.enabled)}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked ? 1 : 0 })
                }
              />
              Enabled
            </label>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <button
              disabled={busy || saving}
              className="q-button bg-primary text-primary-foreground"
            >
              Save
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(o) => {
          if (!o) setSelected(undefined);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogTitle>Manage access</DialogTitle>
          <div className="q-control-member-heading"><strong>{selected?.name}</strong><span>{selected?.email}</span></div>
          <form className="q-control-access-form" onSubmit={event => { event.preventDefault(); void save({operation:'override',userId:selected?.uid,plan:manualPlan,expires_at:noExpiration ? null : `${end}T23:59:59.999Z`,reason}); }}>
            <p className="q-control-assignment-note"><ShieldCheck className="size-5" />{manualPlan === 'free' ? 'Revoke existing access immediately. Stored gifts and new subscriptions can still be activated later.' : 'Grant Full access. Previously revoked access stays revoked when this grant expires.'}</p>
            <fieldset disabled={saving}><legend>Access action</legend><div className="q-control-plan-options">{PLAN_ORDER.map(plan => <label key={plan} data-selected={manualPlan===plan}><input type="radio" name="override-plan" value={plan} checked={manualPlan===plan} onChange={() => setManualPlan(plan)} /><span>{plan === 'free' ? 'Revoke current access' : `${PLAN_LIMITS[plan].name} · ${planDurationLabel(plan)}`}</span></label>)}</div></fieldset>
            {manualPlan !== 'free' && <>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noExpiration} onChange={event => setNoExpiration(event.target.checked)} />No expiration · keep until changed</label>
              {!noExpiration && <label>Access expiration<input required type="date" className={field} value={end} min={new Date().toISOString().slice(0,10)} onChange={e => setEnd(e.target.value)} /><small>Access remains until 23:59:59 UTC on this date, then returns to the other eligible grants.</small></label>}
              <div className="q-ops-form-grid"><label>Extend by days<input className={field} type="number" min="1" max="730" value={extensionDays} onChange={event=>setExtensionDays(event.target.value)} /></label><button type="button" className="q-ops-button" disabled={saving || !Number.isInteger(Number(extensionDays)) || Number(extensionDays)<1 || Number(extensionDays)>730} onClick={()=>{setNoExpiration(false);setEnd(new Date(Math.max(Date.now(),Number.isFinite(Date.parse(end))?Date.parse(end):Date.now())+Number(extensionDays)*86_400_000).toISOString().slice(0,10));}}>Preview new date</button></div>
            </>}
            <label>Reason <span className="text-muted-foreground">(optional)</span><textarea maxLength={500} rows={2} className={field} value={reason} onChange={e => setReason(e.target.value)} placeholder="Add a note to the audit log…" /></label>
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
            <button disabled={saving} className="q-button q-button-primary w-full" type="submit">{saving ? 'Applying…' : manualPlan === 'free' ? 'Revoke current access now' : `Apply ${PLAN_LIMITS[manualPlan].name} now`}</button>
          </form>
          <details className="q-control-billing-details"><summary>Payment & renewal records</summary><p>Payment history stays separate. A new activation can grant access after revocation.</p><label>Billing expiration<input type="date" className={field} value={end} onChange={e => setEnd(e.target.value)} /></label><button className="q-button border" onClick={() => setEnd(addCalendarDuration(new Date(Math.max(Date.now(), Number.isFinite(Date.parse(end)) ? Date.parse(end) : Date.now())).toISOString(), PLAN_DURATION_MONTHS[manualPlan] || 1, 'month').slice(0,10))}>Extend selected period</button><label>Final amount paid (SAR)<input type="number" min="0" step="0.01" className={field} value={paid} onChange={e => setPaid(e.target.value)} /></label><label>Discount code<input className={field} value={manualCode} onChange={e => setManualCode(e.target.value)} /></label><button disabled={saving || manualPlan==='free' || !end} className="q-button border" onClick={() => void save({userId:selected?.uid,plan:manualPlan,expires_at:`${end}T23:59:59.999Z`,paid:Math.round(Number(paid)*100),code:manualCode})}>Save {PLAN_LIMITS[manualPlan].name} billing record</button><button disabled={saving} className="q-button text-destructive" onClick={() => void save({userId:selected?.uid,operation:'cancel'})}>Cancel paid subscription</button></details>
        </DialogContent>
      </Dialog>
      {confirmationDialog}
    </section>
  );
}
