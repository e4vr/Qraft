'use client';

import { useEffect, useState } from 'react';
import { subscribeLive } from '@/lib/realtime-client';
import { Crown } from 'lucide-react';
import { api } from '@/lib/api-client';
import { observeCloudflareUser } from '@/lib/application-services';
import type { AppUser } from '@/lib/medguard-types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { PLAN_LIMITS, PLAN_ORDER, type PlanId } from '@/lib/plan-config';

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
    [price, setPrice] = useState<Quote>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<Exclude<PlanId, 'free'>>('pro');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    const stop = subscribeLive(() => {
      if (busy) return;
      void api<Quote>('/platform/quote', { method: 'POST', body: JSON.stringify({ code: price?.code || '', plan: selectedPlan }) })
        .then(quote => { if (active) setPrice(quote); })
        .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to refresh price.'); });
    }, ['pricing']);
    return () => { active = false; stop(); };
  }, [price?.code, busy, selectedPlan]);
  useEffect(() => {
    let live = true;
    api<Quote>('/platform/quote', {
      method: 'POST',
      body: JSON.stringify({ code: '', plan: selectedPlan }),
    })
      .then((q) => {
        if (live) setPrice(q);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [selectedPlan]);
  async function apply() {
    setBusy(true);
    setError('');
    try {
      setPrice(
        await api<Quote>('/platform/quote', {
          method: 'POST',
          body: JSON.stringify({ code, plan: selectedPlan }),
        }),
      );
      setRequestId(crypto.randomUUID());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to apply code.');
    } finally {
      setBusy(false);
    }
  }
  async function subscribe() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ upgraded?: boolean; url?: string }>(
        '/platform/checkout',
        {
          method: 'POST',
          body: JSON.stringify({ code: price?.code || '', requestId, plan: selectedPlan }),
        },
      );
      if (result.upgraded) {
        await observeCloudflareUser((u) => {
          if (u) onUser(u);
        });
        setSuccess(`تم تفعيل ${PLAN_LIMITS[selectedPlan].name} لمدة سنة كاملة`);
      } else if (result.url) window.location.assign(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to subscribe.');
      setRequestId(crypto.randomUUID());
    } finally {
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
          ارتقِ بتجربتك الدراسية — اشتراك لمدة سنة كاملة.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {PLAN_ORDER.map((plan) => {
          const limits = PLAN_LIMITS[plan];
          const selectable = plan !== 'free';
          const descriptions: Record<PlanId, string> = {
            free: 'Try the platform',
            lite: 'For university study',
            pro: 'For serious study and contribution',
            unlimited: 'For major exam preparation and heavy usage',
          };
          return (
            <button
              type="button"
              key={plan}
              disabled={!selectable}
              onClick={() => plan !== 'free' && setSelectedPlan(plan)}
              className={`relative rounded-2xl border p-4 text-left transition ${selectedPlan === plan ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'bg-card'} disabled:cursor-default`}
            >
              {plan === 'pro' && <span className="absolute right-3 top-3 rounded-full bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground">MOST POPULAR</span>}
              <strong className="text-lg">{limits.name}</strong>
              <p className="mt-1 text-2xl font-black">{limits.priceSarYear ? `${limits.priceSarYear} SAR/year` : 'Free'}</p>
              <p className="mt-2 text-sm text-muted-foreground">{descriptions[plan]}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                {limits.lifetimeExamLimit
                  ? `${limits.lifetimeExamLimit} exams for account lifetime`
                  : `${limits.monthlyExamLimit} exams/month`}{' '}
                · {limits.maxQuestionsPerExam} questions/exam
                {limits.fairUse ? ' · Fair Use applies' : ''}
              </p>
            </button>
          );
        })}
      </div>
      <div className="rounded-2xl border border-amber-400/40 bg-card p-5">
        {price ? (
          <div aria-live="polite">
            <p className="text-3xl font-black">
              {sar(price.final)}{' '}
              <span className="text-sm font-normal text-muted-foreground">
                / Year
              </span>
            </p>
            {price.code && (
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  Original: <s>{sar(price.original)}</s>
                </p>
                <p>
                  Discount: {sar(price.discount)}{' '}
                  {price.percent !== null ? `(${price.percent}%)` : ''}
                </p>
                <p>Applied: {price.code}</p>
              </div>
            )}
          </div>
        ) : (
          <p>Loading price…</p>
        )}
        <label
          className="mt-5 block text-sm font-semibold"
          htmlFor="discount-code"
        >
          كود خصم / Discount Code
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="discount-code"
            className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-3"
            maxLength={40}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
          />
          <button
            className="q-button border"
            disabled={busy || !price}
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
        <button
          className="q-button mt-4 w-full bg-primary text-primary-foreground"
          disabled={busy || !price || (user.effectivePlan ?? user.tier) === selectedPlan}
          onClick={() => void subscribe()}
        >
          {busy
            ? 'Processing…'
            : (user.effectivePlan ?? user.tier) === selectedPlan
              ? `${PLAN_LIMITS[selectedPlan].name} active`
              : 'اشترك الآن'}
        </button>
        <p className="mt-3 text-xs text-muted-foreground">
          {price?.final === 0
            ? `يتم تفعيل ${PLAN_LIMITS[selectedPlan].name} مباشرة بعد تأكيد الاشتراك.`
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
        <DialogTitle className="sr-only">Upgrade to Pro</DialogTitle>
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
  tier: string;
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
  allowed_plans: '["lite","pro","unlimited"]',
};
export function SubscriptionAdmin({
  section,
}: {
  section: 'discounts' | 'subscriptions';
}) {
  const [today] = useState(() => Date.now());
  const [codes, setCodes] = useState<Code[]>([]),
    [subscriptions, setSubscriptions] = useState<Subscription[]>([]),
    [events, setEvents] = useState<Usage[]>([]),
    [draft, setDraft] = useState<Code>(emptyCode),
    [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<Subscription>(),
    [end, setEnd] = useState(''),
    [paid, setPaid] = useState('0'),
    [manualCode, setManualCode] = useState(''),
    [manualPlan, setManualPlan] = useState<Exclude<PlanId, 'free'>>('pro'),
    [price, setPrice] = useState('15'),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [sort, setSort] = useState('expiration'),
    [offset, setOffset] = useState(0),
    [usageCode, setUsageCode] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => subscribeLive(() => setRevision(r => r + 1)), []);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      api<{
        codes?: Code[];
        subscriptions?: Subscription[];
        events?: Usage[];
        price?: number;
      }>(
        `/platform/${section}?search=${encodeURIComponent(search)}&status=${status}&sort=${sort}&offset=${offset}&id=${usageCode}`,
      )
        .then((r) => {
          if (!live) return;
          setCodes(r.codes ?? []);
          setSubscriptions(r.subscriptions ?? []);
          setEvents(r.events ?? []);
          if (r.price !== undefined) setPrice(String(r.price / 100));
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
  }, [section, search, status, sort, offset, usageCode, revision]);
  async function save(body: unknown, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      await api(`/platform/${section}`, { method, body: JSON.stringify(body) });
      setMessage('Saved successfully.');
      setEditing(false);
      setSelected(undefined);
      setRevision((r) => r + 1);
      if (
        section === 'subscriptions' &&
        body &&
        typeof body === 'object' &&
        'userId' in body
      )
        window.dispatchEvent(
          new CustomEvent('qraft-account-updated', {
            detail: {
              userId: body.userId,
              tier:
                'operation' in body && body.operation === 'cancel'
                  ? 'free'
                  : 'plan' in body && typeof body.plan === 'string'
                    ? body.plan
                    : 'pro',
            },
          }),
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save.');
    } finally {
      setBusy(false);
    }
  }
  const field = 'w-full min-w-0 rounded-xl border bg-background px-3 py-2.5';
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-bold">
        {section === 'discounts' ? 'Discount Codes' : 'Subscriptions'}
      </h2>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {message && <output className="text-emerald-600">{message}</output>}
      {section === 'discounts' ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label>
              Annual price (SAR)
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={field}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <button
              disabled={busy}
              className="q-button border"
              onClick={() =>
                void save({
                  operation: 'price',
                  price: Math.round(Number(price) * 100),
                })
              }
            >
              Save price
            </button>
            <button
              className="q-button bg-primary text-primary-foreground"
              onClick={() => {
                setDraft(emptyCode);
                setEditing(true);
              }}
            >
              Create discount code
            </button>
          </div>
          {codes.slice(0, 50).map((c) => (
            <article
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4"
            >
              <strong>{c.code}</strong>
              <span>
                {c.kind === 'percent' ? `${c.amount}%` : sar(c.amount)} ·{' '}
                {c.enabled ? 'Active' : 'Disabled'} · {c.uses} uses
              </span>
              <button
                className="q-button border"
                onClick={() => {
                  setDraft(c);
                  setEditing(true);
                }}
              >
                Edit
              </button>
              <button
                disabled={busy}
                className="q-button border"
                onClick={() => void save({ ...c, enabled: !c.enabled })}
              >
                {c.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                className="q-button border"
                onClick={() => {
                  setUsageCode(c.id);
                  setOffset(0);
                }}
              >
                Usage history
              </button>
              <button
                className="q-button text-destructive"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete code ${c.code}? Usage history will be retained.`,
                    )
                  )
                    void save({ id: c.id }, 'DELETE');
                }}
              >
                Delete
              </button>
            </article>
          ))}
          {usageCode && (
            <div className="space-y-3">
              <h3 className="font-bold">Discount usage</h3>
              {events.slice(0, 50).map((e) => (
                <article key={e.id} className="rounded-xl border p-4 text-sm">
                  <p className="break-all font-semibold">
                    {e.name} · {e.email} · {e.user_id}
                  </p>
                  <p>
                    {e.code} · {e.status} ·{' '}
                    {new Date(e.created_at).toLocaleString()}
                  </p>
                  <p>
                    Original {sar(e.original)} · Discount {sar(e.discount)} ·
                    Final {sar(e.final)}
                  </p>
                  <p>
                    {e.starts_at} → {e.expires_at}
                  </p>
                  <p>{e.detail}</p>
                </article>
              ))}
              {!events.length && <p>No uses recorded.</p>}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              className={field}
              placeholder="Search name, email or User ID"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
            <select
              aria-label="Subscription filter"
              className={field}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setOffset(0);
              }}
            >
              {[
                '',
                'lite',
                'pro',
                'active',
                'expired',
                'cancelled',
                'manually_activated',
              ].map((s) => (
                <option key={s} value={s}>
                  {s || 'All accounts'}
                </option>
              ))}
            </select>
            <select
              aria-label="Sort subscriptions"
              className={field}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="expiration">Expiration date</option>
              <option value="name">Email</option>
            </select>
          </div>
          {subscriptions.slice(0, 50).map((s) => (
            <article key={s.uid} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold">{s.name}</h3>
                  <p className="break-all text-sm">{s.email}</p>
                  <p className="break-all text-xs text-muted-foreground">
                    User ID: {s.uid}
                  </p>
                </div>
                <button
                  className="q-button border"
                  onClick={() => {
                    setSelected(s);
                    setEnd(
                      (s.expires_at && s.expires_at > new Date().toISOString()
                        ? s.expires_at
                        : new Date(Date.now() + 365 * 86400000).toISOString()
                      ).slice(0, 10),
                    );
                    setPaid(String((s.paid ?? 0) / 100));
                    setManualPlan(
                      s.plan && s.plan !== 'free' ? s.plan : 'pro',
                    );
                    setManualCode('');
                  }}
                >
                  Manage
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <span>
                  {s.tier.toUpperCase()} · {s.status || 'No subscription'}
                </span>
                <span>Start: {s.starts_at?.slice(0, 10) || '—'}</span>
                <span>Expires: {s.expires_at?.slice(0, 10) || '—'}</span>
                <span>
                  Days remaining:{' '}
                  {s.expires_at
                    ? Math.max(
                        0,
                        Math.ceil(
                          (Date.parse(s.expires_at) - today) / 86400000,
                        ),
                      )
                    : '—'}
                </span>
                <span>Method: {s.method || '—'}</span>
                <span>Code: {s.discount_code || '—'}</span>
                <span>Paid: {sar(s.paid ?? 0)}</span>
              </div>
            </article>
          ))}
        </>
      )}
      {!busy && !(section === 'discounts' ? codes : subscriptions).length && (
        <p>No results.</p>
      )}
      {busy && <output>Loading…</output>}
      <div className="flex gap-3">
        <button
          className="q-button border"
          disabled={busy || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous
        </button>
        <button
          className="q-button border"
          disabled={
            busy ||
            (section === 'discounts'
              ? usageCode
                ? events
                : codes
              : subscriptions
            ).length <= 50
          }
          onClick={() => setOffset(offset + 50)}
        >
          Next
        </button>
      </div>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-xl">
          <DialogTitle>
            {draft.id ? 'Edit' : 'Create'} discount code
          </DialogTitle>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
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
                {(['lite', 'pro', 'unlimited'] as const).map((plan) => {
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
              disabled={busy}
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
        <DialogContent>
          <DialogTitle>Manage subscription</DialogTitle>
          <p className="break-all">{selected?.email}</p>
          <label>
            Plan
            <select
              className={field}
              value={manualPlan}
              onChange={(event) => setManualPlan(event.target.value as typeof manualPlan)}
            >
              <option value="lite">Lite</option>
              <option value="pro">Pro</option>
              <option value="unlimited">Unlimited</option>
            </select>
          </label>
          <label>
            Expiration date
            <input
              type="date"
              className={field}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <button
            className="q-button border"
            onClick={() =>
              setEnd(
                new Date(Math.max(Date.now(), Date.parse(end)) + 365 * 86400000)
                  .toISOString()
                  .slice(0, 10),
              )
            }
          >
            Extend one year
          </button>
          <label>
            Final amount paid (SAR)
            <input
              className={field}
              type="number"
              min="0"
              step="0.01"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
            />
          </label>
          <label>
            Discount code (if applicable)
            <input
              className={field}
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="q-button bg-primary text-primary-foreground"
            onClick={() =>
              void save({
                userId: selected?.uid,
                expires_at: new Date(`${end}T23:59:59Z`).toISOString(),
                paid: Math.round(Number(paid) * 100),
                code: manualCode,
                plan: manualPlan,
              })
            }
          >
            Activate / save {PLAN_LIMITS[manualPlan].name}
          </button>
          <button
            disabled={busy}
            className="q-button text-destructive"
            onClick={() =>
              void save({ userId: selected?.uid, operation: 'cancel' })
            }
          >
            Cancel paid subscription
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
