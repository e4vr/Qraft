'use client';
import { useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crown,
  Download,
  Gift,
  History,
  KeyRound,
  Plus,
  Search,
  ShieldCheck,
  Ticket,
  Users,
} from 'lucide-react';
import { api, invalidateApiResources } from '@/lib/api-client';
import { subscribeLive } from '@/lib/realtime-client';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  durationEnd,
  durationText,
  type AccessGrant,
  type ActivationCodeAudience,
  type ActivationCodeListing,
  type DurationUnit,
} from '@/features/subscriptions/domain/access-model';
import {
  SubscriptionAccountPicker,
  type SubscriptionCodeMember,
} from '@/components/subscription-account-picker';
import { DiscountAdmin } from '@/components/subscription-discounts';

type Member = {
  uid: string;
  name: string;
  email: string;
  tier: string;
  role: string;
  account_status: string;
  effective_expires_at: string | null;
};
type Code = ActivationCodeListing;
type GeneratedCode = {
  name: string;
  code: string;
  duration: string;
  member: SubscriptionCodeMember | null;
};
type GiftRow = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  duration: number;
  duration_days: number | null;
  duration_unit: DurationUnit;
  status: string;
  created_at: string;
};
type Operation = {
  result_json?: string;
  id: string;
  name?: string;
  email?: string;
  action: string;
  actor_id: string;
  created_at: string;
};
type Account = {
  grants: (AccessGrant & { status: string })[];
  operations: Operation[];
  payments: {
    id: string;
    amount: number;
    reference: string;
    confirmed_at: string;
  }[];
  gifts: GiftRow[];
};
type Summary = {
  accounts: number;
  full: number;
  free: number;
  endingSoon: number;
  unusedCodes: number;
  confirmedPayments: number;
};
type Tab = 'members' | 'codes' | 'gifts' | 'activity' | 'discounts';
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';
const money = (value: number) =>
  `${(value / 100).toLocaleString('en', { maximumFractionDigits: 2 })} SAR`;
const inputClass =
  'min-h-11 w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10';
const actionNames: Record<string, string> = {
  grant: 'Access activated',
  cancel: 'Access cancelled',
  gift: 'Gift issued',
  create_codes: 'Activation codes created',
  disable_code: 'Code disabled',
};
const badge = (status: string) => (
  <span
    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${['active', 'full', 'unused'].includes(status) ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : ['revoked', 'disabled'].includes(status) ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-muted text-muted-foreground'}`}
  >
    {status}
  </span>
);
const tabs = [
  { id: 'members', label: 'Members', icon: Users },
  { id: 'codes', label: 'Activation codes', icon: KeyRound },
  { id: 'gifts', label: 'Gifts', icon: Gift },
  { id: 'activity', label: 'Activity', icon: History },
  { id: 'discounts', label: 'Discounts', icon: Ticket },
] as const;

export function SubscriptionManager({
  initialTab = 'members',
}: {
  initialTab?: Tab;
}) {
  const [clock, setClock] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>(initialTab),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [offset, setOffset] = useState(0);
  const [members, setMembers] = useState<Member[]>([]),
    [codes, setCodes] = useState<Code[]>([]),
    [gifts, setGifts] = useState<GiftRow[]>([]),
    [activity, setActivity] = useState<Operation[]>([]);
  const [summary, setSummary] = useState<Summary>(),
    [prices, setPrices] = useState<Record<string, number>>({
      full_monthly: 10000,
      full_quarterly: 23000,
    });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Member>(),
    [account, setAccount] = useState<Account>(),
    [accountLoading, setAccountLoading] = useState(false);
  const [editor, setEditor] = useState<'grant' | 'gift' | 'codes' | null>(null),
    [name, setName] = useState(''),
    [duration, setDuration] = useState(1),
    [unit, setUnit] = useState<DurationUnit>('month'),
    [paid, setPaid] = useState('100'),
    [reference, setReference] = useState('');
  const [count, setCount] = useState(1),
    [codeAudience, setCodeAudience] = useState<ActivationCodeAudience>('any'),
    [boundMember, setBoundMember] = useState<SubscriptionCodeMember | null>(
      null,
    ),
    [deadline, setDeadline] = useState(''),
    [generated, setGenerated] = useState<GeneratedCode[]>([]);
  const [cancel, setCancel] = useState<{
      member: Member;
      grant?: AccessGrant;
    }>(),
    [reason, setReason] = useState('');
  const [confirm, confirmation] = useConfirmationDialog();
  const pendingCodes = useRef<{ requestId: string; codes: string[] } | null>(
      null,
    ),
    actionFlight = useRef(false);
  const editorRequest = useRef(crypto.randomUUID()),
    cancelRequest = useRef(crypto.randomUUID());
  const [discountCode, setDiscountCode] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(
    () =>
      subscribeLive(
        () => setRevision((value) => value + 1),
        ['subscriptions', 'account', 'economy', 'contributions', 'pricing'],
      ),
    [],
  );
  useEffect(() => {
    let alive = true;
    const parameters = `search=${encodeURIComponent(query)}&offset=${offset}`;
    const load = async () => {
      await Promise.resolve();
      if (!alive) return;
      setLoading(true);
      setError('');
      const base = await api<{
        members: Member[];
        summary: Summary;
        prices: { plan: string; price: number }[];
      }>(
        `/platform/access-admin?${parameters}&status=${tab === 'members' ? filter : 'all'}`,
      );
      if (!alive) return;
      setMembers(base.members);
      setSelected((current) =>
        current
          ? (base.members.find((member) => member.uid === current.uid) ??
            current)
          : current,
      );
      setSummary(base.summary);
      setPrices(
        Object.fromEntries(
          base.prices.map((price) => [price.plan, price.price]),
        ),
      );
      if (tab === 'codes') {
        const result = await api<{ codes: Code[] }>(
          `/platform/activation-codes?${parameters}&status=${filter}`,
        );
        if (alive) setCodes(result.codes);
      }
      if (tab === 'gifts') {
        const result = await api<{ gifts: GiftRow[] }>(
          `/platform/access-admin?view=gifts&${parameters}&status=${filter}`,
        );
        if (alive) setGifts(result.gifts);
      }
      if (tab === 'activity') {
        const result = await api<{ operations: Operation[] }>(
          `/platform/access-admin?view=activity&${parameters}`,
        );
        if (alive) setActivity(result.operations);
      }
    };
    void load()
      .catch((caught) => {
        if (alive)
          setError(
            caught instanceof Error
              ? caught.message
              : 'Unable to load subscriptions.',
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tab, query, filter, offset, revision]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    void Promise.resolve()
      .then(() => {
        if (alive) {
          setAccount(undefined);
          setAccountLoading(true);
        }
        return api<Account>(
          `/platform/access-account?userId=${encodeURIComponent(selected.uid)}`,
        );
      })
      .then((result) => {
        if (alive) setAccount(result);
      })
      .catch((caught) => {
        if (alive) setError(String(caught));
      })
      .finally(() => {
        if (alive) setAccountLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected, revision]);
  const refresh = () => {
    invalidateApiResources(
      ['account', 'subscriptions', 'economy', 'contributions'],
      'subscription-manager',
    );
    setRevision((value) => value + 1);
  };
  const mutate = async (path: string, body: Record<string, unknown>) => {
    if (actionFlight.current) return null;
    actionFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<Record<string, unknown>>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      refresh();
      return result;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to complete this action.',
      );
      return null;
    } finally {
      actionFlight.current = false;
      setBusy(false);
    }
  };
  function openEditor(next: 'grant' | 'gift' | 'codes') {
    editorRequest.current = crypto.randomUUID();
    setClock(Date.now());
    setDiscountCode('');
    setEditor(next);
    setName(
      next === 'grant'
        ? 'Manual subscription'
        : next === 'gift'
          ? 'Administrator gift'
          : '',
    );
    setDuration(1);
    setUnit('month');
    setPaid(String(prices.full_monthly / 100));
    setReference('');
    setCodeAudience('any');
    setBoundMember(null);
    setDeadline('');
    setCount(1);
    pendingCodes.current = null;
    setError('');
  }
  const preset = (value: number, nextUnit: DurationUnit) => {
    setDuration(value);
    setUnit(nextUnit);
    if (nextUnit === 'day') setPaid('0');
    if (nextUnit === 'month')
      setPaid(
        String(
          (value === 3 ? prices.full_quarterly : prices.full_monthly) / 100,
        ),
      );
    pendingCodes.current = null;
  };
  const previewStart =
    selected?.effective_expires_at &&
    Date.parse(selected.effective_expires_at) > clock
      ? selected.effective_expires_at
      : new Date(clock).toISOString();
  let previewEnd = '';
  try {
    previewEnd = durationEnd(previewStart, duration, unit);
  } catch {
    /* Validation stays visible in the form. */
  }
  const saveEditor = async () => {
    if (editor === 'codes') {
      if (codeAudience === 'member' && !boundMember) {
        setError('Select the account allowed to use these codes.');
        return;
      }
      if (!pendingCodes.current)
        pendingCodes.current = {
          requestId: crypto.randomUUID(),
          codes: Array.from({ length: count }, () =>
            Array.from(crypto.getRandomValues(new Uint8Array(20)), (byte) =>
              byte.toString(16).padStart(2, '0'),
            )
              .join('')
              .toUpperCase(),
          ),
        };
      const request = pendingCodes.current;
      const result = await mutate('/platform/activation-codes', {
        operation: 'create',
        ...request,
        name,
        duration,
        unit,
        audience: codeAudience,
        userId: codeAudience === 'member' ? boundMember!.uid : '',
        redeemBefore: deadline ? new Date(deadline).toISOString() : null,
      });
      if (result) {
        setGenerated(
          request.codes.map((code, index) => ({
            name: count === 1 ? name : `${name} · ${index + 1}`,
            code: code.match(/.{1,5}/g)!.join('-'),
            duration: durationText(duration, unit),
            member: codeAudience === 'member' ? boundMember : null,
          })),
        );
        setEditor(null);
        pendingCodes.current = null;
        setNotice(`${count} activation code${count === 1 ? '' : 's'} created.`);
      }
    } else if (selected && editor) {
      const result = await mutate('/platform/access-admin', {
        operation: editor,
        requestId: editorRequest.current,
        userId: selected.uid,
        label: name,
        duration,
        unit,
        paid: editor === 'grant' ? Math.round(Number(paid) * 100) : 0,
        reference,
        discountCode,
      });
      if (result) {
        setEditor(null);
        setNotice(
          editor === 'gift'
            ? 'Gift added to the member’s wallet. Its duration starts when activated.'
            : 'Subscription activated. The duration has been added to the member’s access.',
        );
      }
    }
  };
  const download = () => {
    const csv =
      'Name,Activation code,Duration,Allowed account,Account ID,Email\r\n' +
      generated
        .map((row) =>
          [
            row.name,
            row.code,
            row.duration,
            row.member
              ? row.member.name || row.member.email
              : 'Any approved account',
            row.member?.uid || '',
            row.member?.email || '',
          ]
            .map(
              (value) =>
                `"${(/^[=+@-]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`,
            )
            .join(','),
        )
        .join('\r\n');
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'activation-codes.csv';
    link.click();
    URL.revokeObjectURL(url);
  };
  const rows =
    tab === 'codes'
      ? codes
      : tab === 'gifts'
        ? gifts
        : tab === 'activity'
          ? activity
          : members;
  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Full Access · Administration
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">
            Subscriptions
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Manage member access, issue activation codes and keep every
            activation traceable.
          </p>
        </div>
        <button
          className="q-button q-button-primary inline-flex items-center gap-2"
          onClick={() => openEditor('codes')}
        >
          <Plus className="size-4" />
          Generate codes
        </button>
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Active Full', value: summary?.full, icon: Crown },
          {
            label: 'Ending in 7 days',
            value: summary?.endingSoon,
            icon: CalendarClock,
          },
          {
            label: 'Unused codes',
            value: summary?.unusedCodes,
            icon: KeyRound,
          },
          {
            label: 'Confirmed payments',
            value: summary ? money(summary.confirmedPayments) : undefined,
            icon: ShieldCheck,
          },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">{item.label}</span>
              <item.icon className="size-4" />
            </div>
            <p className="mt-3 text-xl font-bold tabular-nums">
              {item.value ?? '—'}
            </p>
          </div>
        ))}
      </div>
      <div
        className="flex gap-1 overflow-x-auto border-b pb-2"
        role="tablist"
        aria-label="Subscription sections"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => {
              setTab(item.id);
              setOffset(0);
              setSearch('');
              setFilter('all');
            }}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${tab === item.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
          >
            <item.icon className="size-4" />
            {item.label}
          </button>
        ))}
      </div>
      {notice && (
        <output className="block rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm">
          {notice}
        </output>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {tab === 'discounts' ? (
        <DiscountAdmin />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="flex flex-wrap gap-3 border-b p-4">
            <label className="relative min-w-52 flex-1">
              <Search className="absolute left-3 top-3.5 size-4 text-muted-foreground" />
              <input
                aria-label={`Search ${tab}`}
                placeholder={
                  tab === 'codes'
                    ? 'Search code name, ending or allowed account…'
                    : 'Search name, email or account ID…'
                }
                className={`${inputClass} pl-9`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            {tab === 'members' && (
              <select
                aria-label="Filter member access"
                className={`${inputClass.replace('w-full', '')} w-auto`}
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="all">All members</option>
                <option value="full">Full Access</option>
                <option value="free">Free trial</option>
                <option value="pending">Awaiting approval</option>
              </select>
            )}
            {(tab === 'codes' || tab === 'gifts') && (
              <select
                aria-label="Filter status"
                className={`${inputClass.replace('w-full', '')} w-auto`}
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="all">All statuses</option>
                {(tab === 'codes'
                  ? ['unused', 'used', 'disabled', 'expired']
                  : ['available', 'active', 'scheduled', 'expired', 'cancelled']
                ).map((status) => (
                  <option key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>
            )}
          </div>
          {loading ? (
            <output className="block p-10 text-center text-sm text-muted-foreground">
              Loading {tab}…
            </output>
          ) : !rows.length ? (
            <div className="p-12 text-center">
              <Search className="mx-auto mb-3 size-7 text-muted-foreground" />
              <h3 className="font-semibold">
                No {tab === 'codes' ? 'activation codes' : tab} found
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {query
                  ? 'Try another search.'
                  : tab === 'codes'
                    ? 'Generate a code with the exact duration you want to grant.'
                    : 'New records will appear here.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[680px] w-full text-left text-sm">
                <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    {(tab === 'members'
                      ? ['Member', 'Access', 'Access ends', '']
                      : tab === 'codes'
                        ? [
                            'Code',
                            'Duration',
                            'Status',
                            'Allowed account / Redemption',
                            '',
                          ]
                        : tab === 'gifts'
                          ? ['Member', 'Gift duration', 'Status', 'Issued']
                          : ['Action', 'Member', 'Date']
                    ).map((label, index) => (
                      <th
                        key={index}
                        className="whitespace-nowrap px-4 py-3 font-medium"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tab === 'members' &&
                    members.slice(0, 50).map((member) => (
                      <tr key={member.uid} className="hover:bg-muted/20">
                        <td className="px-4 py-4">
                          <strong className="block">{member.name}</strong>
                          <span className="text-xs text-muted-foreground">
                            {member.email}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {badge(
                            member.role === 'super_admin'
                              ? 'permanent'
                              : member.tier === 'free'
                                ? 'free'
                                : 'full',
                          )}
                          {member.account_status !== 'approved' && (
                            <small className="mt-1 block text-muted-foreground">
                              {member.account_status}
                            </small>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          {member.role === 'super_admin'
                            ? 'Permanent · Superadmin'
                            : date(member.effective_expires_at)}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <button
                            className="q-button border text-sm"
                            onClick={() => setSelected(member)}
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))}
                  {tab === 'codes' &&
                    codes.slice(0, 50).map((code) => (
                      <tr key={code.id}>
                        <td className="px-4 py-4">
                          <strong className="block">{code.name}</strong>
                          <span className="font-mono text-xs text-muted-foreground">
                            •••• {code.hint}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Created {date(code.created_at)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {durationText(code.duration, code.duration_unit)}
                        </td>
                        <td className="px-4 py-4">{badge(code.status)}</td>
                        <td className="px-4 py-4 text-xs text-muted-foreground">
                          {code.bound_user_id ? (
                            <div className="mb-2">
                              <strong className="block text-foreground">
                                {code.bound_user_name || 'Restricted account'}
                              </strong>
                              <span className="block break-all">
                                {code.bound_user_email || code.bound_user_id}
                              </span>
                              <span className="block">Only this account</span>
                            </div>
                          ) : (
                            <span className="mb-2 block">
                              Any approved account
                            </span>
                          )}
                          {code.redeemed_at ? (
                            <>
                              Used {date(code.redeemed_at)}
                              <span className="block">{code.redeemed_by}</span>
                            </>
                          ) : (
                            <>
                              <span className="block">
                                {code.redeem_before
                                  ? 'Use before ' + date(code.redeem_before)
                                  : 'No redemption deadline'}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {code.status === 'unused' && (
                            <button
                              className="q-button border"
                              disabled={busy}
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: 'Disable this code?',
                                    description: `${code.name} will no longer activate access.`,
                                    confirmLabel: 'Disable code',
                                    tone: 'destructive',
                                  })
                                )
                                  await mutate('/platform/activation-codes', {
                                    operation: 'disable',
                                    codeId: code.id,
                                    requestId: crypto.randomUUID(),
                                  });
                              }}
                            >
                              Disable
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  {tab === 'gifts' &&
                    gifts.slice(0, 50).map((gift) => (
                      <tr key={gift.id}>
                        <td className="px-4 py-4">
                          <strong className="block">{gift.name}</strong>
                          <span className="text-xs text-muted-foreground">
                            {gift.email}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {durationText(
                            gift.duration_days ?? gift.duration,
                            gift.duration_days ? 'day' : gift.duration_unit,
                          )}
                        </td>
                        <td className="px-4 py-4">{badge(gift.status)}</td>
                        <td className="px-4 py-4">{date(gift.created_at)}</td>
                      </tr>
                    ))}
                  {tab === 'activity' &&
                    activity.slice(0, 50).map((operation) => (
                      <tr key={operation.id}>
                        <td className="px-4 py-4">
                          {actionNames[operation.action] ?? operation.action}
                        </td>
                        <td className="px-4 py-4">
                          <strong className="block">
                            {operation.name ?? operation.actor_id}
                          </strong>
                          <span className="text-xs text-muted-foreground">
                            {operation.email}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {date(operation.created_at)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          <footer className="flex items-center justify-between border-t p-3 text-xs text-muted-foreground">
            <span>
              Page {Math.floor(offset / 50) + 1} ·{' '}
              {tab === 'members' ? (summary?.accounts ?? 0) : '50'}{' '}
              {tab === 'members' ? 'accounts' : 'per page'}
            </span>
            <div className="flex gap-2">
              <button
                aria-label="Previous page"
                className="q-button border"
                disabled={loading || offset === 0}
                onClick={() => setOffset((value) => Math.max(0, value - 50))}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                aria-label="Next page"
                className="q-button border"
                disabled={loading || rows.length <= 50}
                onClick={() => setOffset((value) => value + 50)}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </footer>
        </div>
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(undefined);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogTitle>{selected?.name} · Access history</DialogTitle>
          <p className="text-sm text-muted-foreground">{selected?.email}</p>
          {selected && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <code className="min-w-0 break-all">{selected.uid}</code>
              <button
                className="q-button border"
                aria-label="Copy account ID"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(selected.uid)
                    .then(() => setNotice('Account ID copied.'))
                    .catch(() => setError('Copy failed. Select the ID.'));
                }}
              >
                <Copy className="size-3" />
              </button>
            </div>
          )}
          {selected && (
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-sm font-semibold">
                {selected.role === 'super_admin'
                  ? 'Permanent Superadmin access'
                  : selected.tier === 'free'
                    ? 'Free trial'
                    : 'Full Access'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selected.effective_expires_at
                  ? 'Access until ' + date(selected.effective_expires_at)
                  : 'New durations start when activated.'}
              </p>
            </div>
          )}
          {selected?.role !== 'super_admin' && (
            <div className="flex flex-wrap gap-2">
              <button
                className="q-button q-button-primary"
                disabled={busy || accountLoading}
                onClick={() => openEditor('grant')}
              >
                <Plus className="mr-2 inline size-4" />
                Activate / extend
              </button>
              <button
                className="q-button border"
                disabled={busy}
                onClick={() => openEditor('gift')}
              >
                <Gift className="mr-2 inline size-4" />
                Give a gift
              </button>
              <button
                className="q-button border text-destructive"
                disabled={
                  busy ||
                  !account?.grants.some((grant) =>
                    ['active', 'scheduled'].includes(grant.status),
                  )
                }
                onClick={() => {
                  if (selected) setCancel({ member: selected });
                  cancelRequest.current = crypto.randomUUID();
                  setReason('');
                }}
              >
                Revoke all access
              </button>
            </div>
          )}
          {accountLoading ? (
            <p className="py-6 text-sm text-muted-foreground">
              Loading account history…
            </p>
          ) : (
            <>
              <h3 className="mt-2 font-semibold">Access grants</h3>
              {account?.grants.length ? (
                account.grants.map((grant) => (
                  <div key={grant.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm">{grant.label}</strong>
                      {badge(grant.status)}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {durationText(grant.duration, grant.duration_unit)} ·{' '}
                      {grant.source.replaceAll('_', ' ')}
                    </p>
                    <p className="mt-1 text-xs">
                      {date(grant.starts_at)} → {date(grant.expires_at)}
                    </p>
                    {grant.revoke_reason && (
                      <p className="mt-2 text-xs text-destructive">
                        Cancelled: {grant.revoke_reason} ·{' '}
                        {date(grant.revoked_at)}
                      </p>
                    )}
                    {['active', 'scheduled'].includes(grant.status) && (
                      <button
                        className="mt-3 text-xs font-semibold text-destructive"
                        disabled={busy}
                        onClick={() => {
                          if (selected) setCancel({ member: selected, grant });
                          cancelRequest.current = crypto.randomUUID();
                          setReason('');
                        }}
                      >
                        Cancel this grant
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No grants yet.</p>
              )}
              <h3 className="mt-3 font-semibold">Confirmed payments</h3>
              {account?.payments.length ? (
                account.payments.map((payment) => (
                  <div
                    className="flex justify-between gap-3 rounded-xl border p-3 text-sm"
                    key={payment.id}
                  >
                    <div>
                      <strong>{money(payment.amount)}</strong>
                      <p className="text-xs text-muted-foreground">
                        {payment.reference || 'Manual confirmation'}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {date(payment.confirmed_at)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No payment recorded. Gifts and free activations do not count
                  as payments.
                </p>
              )}
              <h3 className="mt-3 font-semibold">Activity</h3>
              {account?.operations.length ? (
                account.operations.map((operation) => (
                  <div
                    key={operation.id}
                    className="flex justify-between gap-3 rounded-xl bg-muted/30 p-3 text-xs"
                  >
                    <span>
                      {actionNames[operation.action] ?? operation.action}
                      <small className="mt-1 block text-muted-foreground">
                        By {operation.actor_id}
                      </small>
                    </span>
                    <span>{date(operation.created_at)}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No recorded actions yet.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>
            {editor === 'codes'
              ? 'Generate activation codes'
              : editor === 'gift'
                ? 'Give a gift'
                : 'Activate / extend subscription'}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {editor === 'codes'
              ? 'Each code grants its saved duration once. The member enters the code without choosing a plan.'
              : editor === 'gift'
                ? 'The gift stays in the wallet until the member activates it.'
                : 'The selected duration is added to the current access end.'}
          </p>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveEditor();
            }}
          >
            <fieldset disabled={busy} className="space-y-4">
              <label className="block text-sm font-medium">
                {editor === 'codes' ? 'Code name' : 'Label'}
                <input
                  required
                  maxLength={160}
                  className={`${inputClass} mt-1.5`}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    pendingCodes.current = null;
                  }}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 7, unit: 'day', label: '7 days' },
                  { value: 1, unit: 'month', label: '1 month' },
                  { value: 3, unit: 'month', label: '3 months' },
                ].map((item) => (
                  <button
                    type="button"
                    key={item.label}
                    className={`q-button border ${duration === item.value && unit === item.unit ? 'bg-primary/10 text-primary' : ''}`}
                    onClick={() =>
                      preset(item.value, item.unit as DurationUnit)
                    }
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium">
                  Duration
                  <input
                    required
                    type="number"
                    min={1}
                    max={unit === 'day' ? 730 : unit === 'month' ? 24 : 2}
                    className={`${inputClass} mt-1.5`}
                    value={duration}
                    onChange={(event) => {
                      setDuration(Number(event.target.value));
                      pendingCodes.current = null;
                    }}
                  />
                </label>
                <label className="text-sm font-medium">
                  Unit
                  <select
                    className={`${inputClass} mt-1.5`}
                    value={unit}
                    onChange={(event) => {
                      setUnit(event.target.value as DurationUnit);
                      setDuration(1);
                      pendingCodes.current = null;
                    }}
                  >
                    <option value="day">Days</option>
                    <option value="month">Calendar months</option>
                    <option value="year">Calendar years</option>
                  </select>
                </label>
              </div>
              {editor === 'grant' && (
                <>
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
                    <p>Access starts: {date(previewStart)}</p>
                    <p className="mt-1 font-semibold">
                      New access end:{' '}
                      {previewEnd
                        ? date(previewEnd)
                        : 'Choose a valid duration'}
                    </p>
                  </div>
                  <label className="block text-sm font-medium">
                    Confirmed amount paid (SAR)
                    <input
                      required
                      type="number"
                      min={0}
                      step="0.01"
                      className={`${inputClass} mt-1.5`}
                      value={paid}
                      onChange={(event) => setPaid(event.target.value)}
                    />
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      Enter the amount actually received. Use 0 for a free
                      administrative grant.
                    </span>
                  </label>
                  <label className="block text-sm font-medium">
                    Payment reference · optional
                    <input
                      maxLength={240}
                      className={`${inputClass} mt-1.5`}
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                    />
                  </label>
                </>
              )}
              {editor === 'grant' && (
                <label className="block text-sm font-medium">
                  Discount code · optional
                  <div className="mt-1.5 flex gap-2">
                    <input
                      className={inputClass}
                      value={discountCode}
                      onChange={(event) => setDiscountCode(event.target.value)}
                    />
                    <button
                      type="button"
                      className="q-button border"
                      disabled={
                        busy ||
                        !discountCode.trim() ||
                        unit !== 'month' ||
                        ![1, 3].includes(duration)
                      }
                      onClick={async () => {
                        try {
                          const result = await api<{ final: number }>(
                            '/platform/access-admin',
                            {
                              method: 'POST',
                              body: JSON.stringify({
                                operation: 'quote',
                                userId: selected?.uid,
                                requestId: crypto.randomUUID(),
                                duration,
                                unit,
                                discountCode,
                              }),
                            },
                          );
                          setPaid(String(result.final / 100));
                          setError('');
                        } catch (caught) {
                          setError(
                            caught instanceof Error
                              ? caught.message
                              : 'Unable to apply discount.',
                          );
                        }
                      }}
                    >
                      Apply
                    </button>
                  </div>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    For the catalog periods of 1 or 3 months. Usage is recorded
                    only when activation succeeds.
                  </span>
                </label>
              )}
              {editor === 'codes' && (
                <>
                  <label className="block text-sm font-medium">
                    Quantity
                    <input
                      required
                      type="number"
                      min={1}
                      max={25}
                      className={`${inputClass} mt-1.5`}
                      value={count}
                      onChange={(event) => {
                        setCount(Number(event.target.value));
                        pendingCodes.current = null;
                      }}
                    />
                  </label>
                  <SubscriptionAccountPicker
                    audience={codeAudience}
                    onAudienceChange={(audience) => {
                      setCodeAudience(audience);
                      pendingCodes.current = null;
                      setError('');
                    }}
                    value={boundMember}
                    onChange={(member) => {
                      setBoundMember(member);
                      pendingCodes.current = null;
                      setError('');
                    }}
                  />
                  <label className="block text-sm font-medium">
                    Redeem before · optional
                    <input
                      type="datetime-local"
                      className={`${inputClass} mt-1.5`}
                      value={deadline}
                      onChange={(event) => {
                        setDeadline(event.target.value);
                        pendingCodes.current = null;
                      }}
                    />
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      This is the last time the code can be used. It does not
                      shorten the granted duration.
                    </span>
                  </label>
                </>
              )}
            </fieldset>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="q-button q-button-primary w-full"
              disabled={
                busy ||
                !previewEnd ||
                (editor === 'codes' &&
                  codeAudience === 'member' &&
                  !boundMember)
              }
            >
              {busy
                ? 'Saving…'
                : editor === 'codes'
                  ? `Generate ${count} code${count === 1 ? '' : 's'}`
                  : editor === 'gift'
                    ? 'Issue gift'
                    : 'Confirm activation'}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={generated.length > 0}
        onOpenChange={(open) => {
          if (!open) setGenerated([]);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle>Activation codes ready</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Copy or download these codes now. Only their name and masked ending
            appear in the history.
          </p>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {generated.map((row) => (
              <div key={row.code} className="rounded-xl border p-3">
                <p className="mb-2 text-xs font-semibold">{row.name}</p>
                <p className="mb-2 text-xs text-muted-foreground">
                  {row.duration} ·{' '}
                  {row.member
                    ? `Only ${row.member.name || row.member.email} (${row.member.email})`
                    : 'Any approved account'}{' '}
                  · One use
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all text-xs">
                    {row.code}
                  </code>
                  <button
                    className="q-button border"
                    aria-label={`Copy ${row.name}`}
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(row.code)
                        .then(() => setNotice('Code copied.'))
                        .catch(() =>
                          setError(
                            'Copy failed. Select the code or download the file.',
                          ),
                        );
                    }}
                  >
                    <Copy className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            className="q-button q-button-primary inline-flex items-center justify-center gap-2"
            onClick={download}
          >
            <Download className="size-4" />
            Download codes
          </button>
          <p className="text-xs text-muted-foreground">
            A code is not proof of payment. Paid activations are recorded
            separately.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(cancel)}
        onOpenChange={(open) => {
          if (!open && !busy) setCancel(undefined);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>
            {cancel?.grant
              ? 'Cancel this access grant'
              : 'Revoke all current access'}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {cancel?.grant
              ? 'Only this grant is cancelled. Later grants are brought forward; payment history is preserved.'
              : 'All current and scheduled grants end immediately. The member can activate new access later; payment history is preserved.'}
          </p>
          <label className="text-sm font-medium">
            Reason
            <textarea
              required
              maxLength={500}
              rows={3}
              className={`${inputClass} mt-2`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            className="q-button bg-destructive text-white"
            disabled={busy || !reason.trim()}
            onClick={async () => {
              if (!cancel) return;
              const result = await mutate('/platform/access-admin', {
                operation: cancel.grant ? 'cancel' : 'revoke',
                userId: cancel.member.uid,
                grantId: cancel.grant?.id,
                reason,
                requestId: cancelRequest.current,
              });
              if (result) {
                setCancel(undefined);
                setNotice('Access updated. History has been preserved.');
              }
            }}
          >
            Confirm cancellation
          </button>
        </DialogContent>
      </Dialog>
      {confirmation}
    </section>
  );
}
