'use client';
import { useEffect, useRef, useState } from 'react';
import {
  SubscriptionAccountPicker,
  type SubscriptionCodeMember,
} from '@/components/subscription-account-picker';
import type { ActivationCodeAudience } from '@/features/subscriptions/domain/access-model';
import {
  Check,
  Search,
  Ticket,
  Pencil,
  Plus,
  ChevronLeft,
  ChevronRight,
  History,
  SlidersHorizontal,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import { subscribeLive } from '@/lib/realtime-client';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  PLAN_LIMITS,
  PAID_PLAN_IDS,
  type PlanId,
} from '@/features/subscriptions/domain/plan-config';
const localDateTime = (value: string | null) =>
  value
    ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : '';
const sar = (value: number) => `${(value / 100).toLocaleString('en')} SAR`;
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
  bound_user_id: string | null;
  bound_user_name?: string | null;
  bound_user_email?: string | null;
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
  bound_user_id: null,
};
const codeSignature = (code: Code) =>
  JSON.stringify({
    id: code.id,
    code: code.code.trim().toUpperCase(),
    kind: code.kind,
    amount: code.amount,
    enabled: Boolean(code.enabled),
    starts_at: code.starts_at,
    expires_at: code.expires_at,
    max_uses: code.max_uses,
    per_user: code.per_user,
    bound_user_id: code.bound_user_id ?? null,
    allowedPlans: [
      ...(JSON.parse(code.allowed_plans || '[]') as string[]),
    ].sort(),
  });
export function DiscountAdmin() {
  const saveFlight = useRef(false);
  const [audience, setAudience] = useState<ActivationCodeAudience>('any');
  const [boundMember, setBoundMember] = useState<SubscriptionCodeMember | null>(
    null,
  );
  const [today] = useState(() => Date.now());
  const [confirmAction, confirmationDialog] = useConfirmationDialog();
  const [codes, setCodes] = useState<Code[]>([]),
    [events, setEvents] = useState<Usage[]>([]),
    [draft, setDraft] = useState<Code>(emptyCode),
    [originalCode, setOriginalCode] = useState<Code | null>(null),
    [editing, setEditing] = useState(false),
    [saving, setSaving] = useState(false),
    [summary, setSummary] = useState<Record<string, number>>({}),
    [usageOffset, setUsageOffset] = useState(0),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [offset, setOffset] = useState(0),
    [usageCode, setUsageCode] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const queryPath = `/platform/discounts?search=${encodeURIComponent(search.trim())}&status=${status}&offset=${offset}&id=${encodeURIComponent(usageCode)}&usageOffset=${usageOffset}`;
  useEffect(
    () => subscribeLive(() => setRevision((value) => value + 1), ['pricing']),
    [],
  );
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      api<{
        codes?: Code[];
        events?: Usage[];
        price?: number;
        summary?: Record<string, number>;
      }>(queryPath)
        .then((r) => {
          if (!live) return;
          setSummary(r.summary ?? {});
          setCodes(r.codes ?? []);
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
    if (saveFlight.current) return;
    saveFlight.current = true;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ code?: Code; deletedId?: string }>(
        '/platform/discounts',
        { method, body: JSON.stringify(body) },
      );
      setMessage('Changes saved successfully.');
      setEditing(false);
      setOriginalCode(null);
      const nextCodes = result.deletedId
        ? codes.filter((code) => code.id !== result.deletedId)
        : result.code
          ? [
              result.code,
              ...codes.filter((code) => code.id !== result.code!.id),
            ]
          : codes;
      setCodes(nextCodes);
      setRevision((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save.');
    } finally {
      saveFlight.current = false;
      setSaving(false);
    }
  }
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : '—';
  const codeStatus = (c: Code) =>
    !c.enabled
      ? 'Disabled'
      : c.expires_at && Date.parse(c.expires_at) <= today
        ? 'Expired'
        : c.max_uses !== null && c.uses >= c.max_uses
          ? 'Exhausted'
          : c.starts_at && Date.parse(c.starts_at) > today
            ? 'Scheduled'
            : 'Active';
  const pageRows = codes;
  const field = 'w-full min-w-0 rounded-xl border bg-background px-3 py-2.5';
  return (
    <section className="q-control-workspace">
      {error && (
        <p role="alert" className="q-control-feedback q-control-error">
          {error}
        </p>
      )}
      {message && !error && (
        <output className="q-control-feedback">{message}</output>
      )}
      <div className="q-control-summary">
        {[
          { label: 'Matching codes', value: summary.total, icon: Ticket },
          { label: 'Enabled codes', value: summary.enabled, icon: Check },
          { label: 'Total redemptions', value: summary.uses, icon: History },
        ].map((item) => (
          <div key={item.label}>
            <item.icon className="size-5" />
            <span>{item.label}</span>
            <strong>{busy ? '…' : (item.value ?? 0).toLocaleString()}</strong>
          </div>
        ))}
      </div>
      <div className="q-control-table-panel">
        <div className="q-control-panel-heading">
          <div>
            <h2>Discount codes</h2>
            <p>
              Promotions adjust a manual payment quote. Use Activation codes to
              grant a saved duration.
            </p>
          </div>
          <button
            className="q-button q-button-primary"
            onClick={() => {
              setDraft(emptyCode);
              setAudience('any');
              setBoundMember(null);
              setOriginalCode(null);
              setEditing(true);
              setError('');
            }}
          >
            <Plus className="size-4" />
            New discount
          </button>
        </div>
        <div className="q-control-toolbar">
          <label className="q-control-search">
            <Search className="size-4" />
            <input
              aria-label="Search discount codes"
              placeholder="Search code or allowed account…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <select
            aria-label="Discount status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            {[
              ['', 'All statuses'],
              ['active', 'Active'],
              ['disabled', 'Disabled'],
              ['scheduled', 'Scheduled'],
              ['expired', 'Expired'],
              ['exhausted', 'Usage limit reached'],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span className="q-control-result-count">
            {summary.total ?? 0} results
          </span>
        </div>
        <div className="q-control-table-scroll" aria-busy={busy || saving}>
          <table className="q-control-table">
            <thead>
              <tr>
                {[
                  'Code',
                  'Discount & plans',
                  'Status',
                  'Usage',
                  'Validity',
                  'Actions',
                ].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.slice(0, 50).map((c) => (
                <tr key={c.id}>
                  <td data-label="Code">
                    <strong className="q-control-code">{c.code}</strong>
                    <small>{c.per_user ?? 'Unlimited'} per member</small>
                    <small>
                      {c.bound_user_id
                        ? `Only ${c.bound_user_name || c.bound_user_email || c.bound_user_id}`
                        : 'Any approved account'}
                    </small>
                    {c.bound_user_email && <small>{c.bound_user_email}</small>}
                  </td>
                  <td data-label="Discount & plans">
                    <strong>
                      {c.kind === 'percent'
                        ? `${c.amount}% off`
                        : `${sar(c.amount)} off`}
                    </strong>
                    <small>
                      {(JSON.parse(c.allowed_plans || '[]') as PlanId[])
                        .map((plan) => PLAN_LIMITS[plan]?.name ?? plan)
                        .join(' · ') || 'All plans'}
                    </small>
                  </td>
                  <td data-label="Status">
                    <span
                      className="q-control-badge"
                      data-tone={
                        codeStatus(c) === 'Active' ? 'success' : 'neutral'
                      }
                    >
                      {codeStatus(c)}
                    </span>
                  </td>
                  <td data-label="Usage">
                    <strong>
                      {c.uses.toLocaleString()}{' '}
                      <span className="text-muted-foreground">
                        / {c.max_uses ?? '∞'}
                      </span>
                    </strong>
                    <small>redemptions</small>
                  </td>
                  <td data-label="Validity">
                    <span>
                      {c.starts_at ? date(c.starts_at) : 'Starts immediately'}
                    </span>
                    <small>
                      {c.expires_at
                        ? `Until ${date(c.expires_at)}`
                        : 'No expiration'}
                    </small>
                  </td>
                  <td data-label="Actions">
                    <div className="q-control-row-actions">
                      <button
                        aria-label={`Edit ${c.code}`}
                        onClick={() => {
                          setDraft(c);
                          setAudience(c.bound_user_id ? 'member' : 'any');
                          setBoundMember(
                            c.bound_user_id
                              ? {
                                  uid: c.bound_user_id,
                                  name:
                                    c.bound_user_name || 'Restricted account',
                                  email: c.bound_user_email || '',
                                  role: 'student',
                                }
                              : null,
                          );
                          setOriginalCode(c);
                          setEditing(true);
                          setError('');
                        }}
                      >
                        <Pencil className="size-4" />
                        Edit
                      </button>
                      <button
                        aria-label={`Usage history for ${c.code}`}
                        onClick={() => {
                          setUsageCode(c.id);
                          setUsageOffset(0);
                        }}
                      >
                        <History className="size-4" />
                        History
                      </button>
                      <details>
                        <summary aria-label={`More actions for ${c.code}`}>
                          <SlidersHorizontal className="size-4" />
                        </summary>
                        <div>
                          <button
                            disabled={saving}
                            onClick={() =>
                              void save({ ...c, enabled: !c.enabled })
                            }
                          >
                            {c.enabled ? 'Disable code' : 'Enable code'}
                          </button>
                          <button
                            disabled={saving}
                            className="text-destructive"
                            onClick={async () => {
                              if (
                                await confirmAction({
                                  title: `Delete code ${c.code}?`,
                                  description:
                                    'The discount code will be removed, while its usage history remains available for auditing.',
                                  confirmLabel: 'Delete code',
                                  tone: 'destructive',
                                })
                              )
                                void save({ id: c.id }, 'DELETE');
                            }}
                          >
                            Delete code
                          </button>
                        </div>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
              {!busy && !pageRows.length && (
                <tr>
                  <td colSpan={6} className="q-control-empty">
                    <Search className="size-6" />
                    <strong>No matching codes</strong>
                    <p>Try another search or clear the filters.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="q-control-pagination">
          <span>
            {busy
              ? 'Updating…'
              : `Page ${Math.floor(offset / 50) + 1} · ${summary.total ?? 0} results`}
          </span>
          <div>
            <button
              aria-label="Previous page"
              disabled={busy || saving || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              <ChevronLeft className="size-4" />
              Previous
            </button>
            <button
              aria-label="Next page"
              disabled={busy || saving || pageRows.length <= 50}
              onClick={() => setOffset(offset + 50)}
            >
              Next
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
      <Dialog
        open={Boolean(usageCode)}
        onOpenChange={(open) => {
          if (!open) setUsageCode('');
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogTitle>
            Discount usage ·{' '}
            {codes.find((c) => c.id === usageCode)?.code ?? 'History'}
          </DialogTitle>
          <div className="q-control-table-scroll">
            <table className="q-control-table">
              <thead>
                <tr>
                  {['Member', 'Transaction', 'Amount', 'Validity'].map(
                    (title) => (
                      <th key={title}>{title}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 50).map((event) => (
                  <tr key={event.id}>
                    <td data-label="Member">
                      <strong>{event.name}</strong>
                      <span>{event.email}</span>
                      <small>{event.user_id}</small>
                    </td>
                    <td data-label="Transaction">
                      <strong>{event.code}</strong>
                      <small>
                        {event.status} · {date(event.created_at)}
                      </small>
                      <small>{event.detail}</small>
                    </td>
                    <td data-label="Amount">
                      <strong>{sar(event.final)}</strong>
                      <small>Original: {sar(event.original)}</small>
                      <small>Discount: {sar(event.discount)}</small>
                    </td>
                    <td data-label="Validity">
                      {date(event.starts_at)}
                      <small>Until {date(event.expires_at)}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!events.length && (
              <p className="q-control-empty">
                {busy ? 'Loading history…' : 'No redemptions recorded.'}
              </p>
            )}
          </div>
          <div className="q-control-pagination">
            <span>Page {Math.floor(usageOffset / 50) + 1}</span>
            <div>
              <button
                disabled={busy || usageOffset === 0}
                onClick={() => setUsageOffset(Math.max(0, usageOffset - 50))}
              >
                Previous
              </button>
              <button
                disabled={busy || events.length <= 50}
                onClick={() => setUsageOffset(usageOffset + 50)}
              >
                Next
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (!saving) setEditing(open);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>
            {draft.id ? 'Edit' : 'Create'} discount code
          </DialogTitle>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (audience === 'member' && !draft.bound_user_id) {
                setError('Select the account allowed to use this discount.');
                return;
              }
              if (
                originalCode &&
                codeSignature(draft) === codeSignature(originalCode)
              ) {
                setEditing(false);
                setMessage('No changes to save.');
                return;
              }
              void save({
                ...draft,
                audience,
                allowedPlans: JSON.parse(draft.allowed_plans || '[]'),
              });
            }}
          >
            <fieldset disabled={saving} className="contents">
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
              <div className="sm:col-span-2">
                <SubscriptionAccountPicker
                  key={draft.id || 'new-discount'}
                  codeKind="discount"
                  audience={audience}
                  value={boundMember}
                  onAudienceChange={(next) => {
                    setAudience(next);
                    setError('');
                  }}
                  onChange={(member) => {
                    setBoundMember(member);
                    setDraft((current) => ({
                      ...current,
                      bound_user_id: member?.uid ?? null,
                      bound_user_name: member?.name ?? null,
                      bound_user_email: member?.email ?? null,
                    }));
                    setError('');
                  }}
                />
              </div>
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-semibold">
                  Allowed paid plans
                </legend>
                <div className="mt-2 flex flex-wrap gap-3">
                  {PAID_PLAN_IDS.map((plan) => {
                    const selected = (
                      JSON.parse(draft.allowed_plans || '[]') as string[]
                    ).includes(plan);
                    return (
                      <label
                        key={plan}
                        className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm capitalize"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) => {
                            const current = new Set(
                              JSON.parse(
                                draft.allowed_plans || '[]',
                              ) as string[],
                            );
                            if (event.target.checked) current.add(plan);
                            else current.delete(plan);
                            setDraft({
                              ...draft,
                              allowed_plans: JSON.stringify([...current]),
                            });
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
                disabled={
                  busy ||
                  saving ||
                  (audience === 'member' && !draft.bound_user_id)
                }
                className="q-button bg-primary text-primary-foreground"
              >
                Save
              </button>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
      {confirmationDialog}
    </section>
  );
}
