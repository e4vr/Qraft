'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowUpRight,
  Database,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Upload,
  Wrench,
  CreditCard,
  Download,
  AlertTriangle,
} from 'lucide-react';
import { api, setApiCache } from '@/lib/api-client';
import { subscribeLive } from '@/lib/realtime-client';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  PLAN_LIMITS,
  type PlanId,
} from '@/features/subscriptions/domain/plan-config';
import {
  emptyUsage,
  INFRA_KEYS,
  USAGE_KEYS,
  type MonitoringSnapshot,
  type UsageUser,
  type InfraCounts,
} from '@/features/administration/domain/monitoring';
import type { MemberProfile } from '@/lib/medguard-types';
import {
  POLICY_FEATURES,
  POLICY_NUMBERS,
} from '@/features/administration/domain/plan-policy';

const format = (value?: number) =>
  value === undefined
    ? '—'
    : value.toLocaleString('en', { maximumFractionDigits: 2 });
const date = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : 'No snapshot yet';
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'The operation could not be completed.';
const usageLabels = {
  testsCreated: 'Tests created',
  testsCompleted: 'Tests completed',
  questionsAnswered: 'Questions answered',
  questionsImported: 'Questions imported',
  privateBanksCreated: 'Private QBanks created',
  flashcardsCreated: 'Flashcards created',
  reviewContributions: 'Review contributions',
};
const infraLabels = {
  workerRequests: 'Worker requests',
  workerErrors: 'Worker errors',
  cpuP99Ms: 'CPU p99 upper envelope (ms)',
  exceededResources: 'Exceeded resources',
  d1Reads: 'D1 read queries',
  d1Writes: 'D1 write queries',
  rowsRead: 'D1 rows read',
  rowsWritten: 'D1 rows written',
  r2StorageBytes: 'R2 current storage (bytes)',
  r2Operations: 'R2 operations',
};
type MonitoringResponse = {
  snapshot: MonitoringSnapshot | null;
  source: string;
  refreshedAt: string | null;
  nextRefreshAt: string | null;
  health: { status: 'Healthy' | 'Attention' | 'Critical'; reasons: string[] };
  connected: boolean;
  telemetry: boolean;
  budget: {
    used: number;
    dailyLimit: number;
    refreshMinutes: number;
    telemetryDailyCap: number;
    telemetryMonthlyCap: number;
  };
};

function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <p
      className={`q-ops-notice ${error ? 'is-error' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      {children}
    </p>
  );
}
function Metric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: typeof Activity;
}) {
  return (
    <article className="q-ops-metric">
      <span>
        <Icon size={17} />
        {label}
      </span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}
function Trend({ snapshot }: { snapshot: MonitoringSnapshot }) {
  const activity = snapshot.days.map((day) =>
    day.usage
      ? USAGE_KEYS.reduce((sum, key) => sum + day.usage![key], 0)
      : undefined,
  );
  const requests = snapshot.days.map(
    (day) => day.infrastructure?.workerRequests,
  );
  const draw = (values: (number | undefined)[]) => {
    const ceiling = Math.max(1, ...values.map((value) => value ?? 0));
    return values
      .map((value, index) =>
        value === undefined
          ? null
          : `${30 + (index * 540) / Math.max(1, values.length - 1)},${170 - (value * 140) / ceiling}`,
      )
      .filter(Boolean)
      .join(' ');
  };
  return (
    <section className="q-ops-panel">
      <div className="q-ops-panel-heading">
        <div>
          <h3>Activity & infrastructure</h3>
          <p>Daily movement · each series uses its own scale</p>
        </div>
        <span className="q-ops-legend">
          <i />
          Qraft activity <i />
          Worker requests
        </span>
      </div>
      <div className="q-ops-chart">
        <svg
          viewBox="0 0 600 210"
          aria-label="Daily Qraft activity and Worker requests on independent scales"
        >
          <title>
            Qraft activity and Worker requests; independent normalized scales
          </title>
          {[30, 100, 170].map((y) => (
            <line
              key={y}
              x1="30"
              y1={y}
              x2="570"
              y2={y}
              className="q-ops-gridline"
            />
          ))}
          {activity.some((value) => value !== undefined) && (
            <polyline points={draw(activity)} className="q-ops-line activity" />
          )}
          {requests.some((value) => value !== undefined) && (
            <polyline points={draw(requests)} className="q-ops-line requests" />
          )}
          <text x="30" y="199">
            {snapshot.days[0]?.date}
          </text>
          <text x="570" y="199" textAnchor="end">
            {snapshot.days.at(-1)?.date}
          </text>
        </svg>
      </div>
      {!activity.some((value) => value !== undefined) && (
        <p className="q-ops-muted">
          User activity is not available in this snapshot.
        </p>
      )}
      <details className="q-ops-details">
        <summary>View exact daily values</summary>
        <div className="q-control-table-scroll">
          <table className="q-control-table">
            <thead>
              <tr>
                <th>Date (UTC)</th>
                <th>Activity</th>
                <th>Worker requests</th>
                <th>D1 rows read</th>
                <th>D1 rows written</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.days.map((day, index) => (
                <tr key={day.date}>
                  <td>{day.date}</td>
                  <td>{format(activity[index])}</td>
                  <td>{format(requests[index])}</td>
                  <td>{format(day.infrastructure?.rowsRead)}</td>
                  <td>{format(day.infrastructure?.rowsWritten)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
export function MonitoringUsage() {
  const [period, setPeriod] = useState(7),
    [data, setData] = useState<MonitoringResponse>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [onlyAlerts, setOnlyAlerts] = useState(true),
    [selected, setSelected] = useState<UsageUser | null>(null);
  const [importDraft, setImportDraft] = useState<unknown>(),
    [importName, setImportName] = useState(''),
    [reason, setReason] = useState('');
  const path = `/platform/monitoring?period=${period}`;
  useEffect(() => {
    let active = true;
    const load = () =>
      void api<MonitoringResponse>(path)
        .then((value) => {
          if (active) setData(value);
        })
        .catch((error) => {
          if (active) setError(errorMessage(error));
        });
    load();
    const stop = subscribeLive(load, ['monitoring', 'connected']);
    return () => {
      active = false;
      stop();
    };
  }, [path]);
  async function update(operation: 'sync' | 'import') {
    setBusy(true);
    setError('');
    try {
      const value = await api<MonitoringResponse>(path, {
        method: 'POST',
        body: JSON.stringify({
          operation,
          ...(operation === 'import' ? { snapshot: importDraft, reason } : {}),
        }),
      });
      setData(value);
      setApiCache(path, value);
      if (operation === 'import') {
        setImportDraft(undefined);
        setImportName('');
        setReason('');
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function template() {
    const to = new Date(),
      from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    from.setUTCDate(from.getUTCDate() - period + 1);
    const body = {
      format: 'qraft-monitoring-v1',
      from: from.toISOString(),
      to: to.toISOString(),
      days: [
        {
          date: to.toISOString().slice(0, 10),
          infrastructure: {
            workerRequests: 0,
            workerErrors: 0,
            rowsRead: 0,
            rowsWritten: 0,
          },
        },
      ],
      queries: [],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'qraft-monitoring-template.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const snapshot = data?.snapshot;
  const usage = snapshot?.days.reduce((counts, day) => {
    for (const key of USAGE_KEYS) counts[key] += day.usage?.[key] ?? 0;
    return counts;
  }, emptyUsage());
  const infra = snapshot?.days.reduce((counts, day) => {
    for (const key of INFRA_KEYS)
      if (day.infrastructure?.[key] !== undefined)
        counts[key] =
          key === 'cpuP99Ms' || key === 'r2StorageBytes'
            ? Math.max(counts[key] ?? 0, day.infrastructure[key]!)
            : (counts[key] ?? 0) + day.infrastructure[key]!;
    return counts;
  }, {} as InfraCounts);
  const users = (snapshot?.users ?? []).filter(
    (user) =>
      (!onlyAlerts || user.reasons?.length) &&
      `${user.name} ${user.userId}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const activity =
    usage && USAGE_KEYS.reduce((sum, key) => sum + usage[key], 0);
  return (
    <div className="q-ops-workspace">
      <div className="q-ops-topline">
        <div className="q-ops-periods" aria-label="Monitoring period">
          {[
            [1, 'Today'],
            [7, '7 days'],
            [30, '30 days'],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={period === value}
              disabled={busy}
              onClick={() => {
                setData(undefined);
                setError('');
                setPeriod(Number(value));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="q-ops-button"
          disabled={busy || !data?.connected}
          onClick={() => void update('sync')}
        >
          <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
          {busy ? 'Updating…' : 'Sync Cloudflare'}
        </button>
      </div>
      {error && <Notice error>{error}</Notice>}
      <section
        className="q-ops-health"
        data-health={data?.health.status ?? 'Attention'}
      >
        <div className="q-ops-health-icon">
          <ShieldCheck size={25} />
        </div>
        <div>
          <span className="q-ops-eyebrow">SYSTEM HEALTH</span>
          <h2>{data?.health.status ?? 'Checking snapshot…'}</h2>
          <ul>
            {data?.health.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
        <div className="q-ops-source">
          <strong>
            {data?.source === 'cloudflare'
              ? 'Cloudflare snapshot'
              : data?.source === 'manual'
                ? 'Manual infrastructure import'
                : 'Awaiting connection'}
          </strong>
          <span>Updated {date(data?.refreshedAt)}</span>
          <span>
            {data?.connected
              ? 'Read token configured on server'
              : 'Server connection not configured'}
          </span>
        </div>
      </section>
      <div className="q-ops-metrics">
        <Metric
          icon={Activity}
          label="Active users"
          value={format(snapshot?.activeUsers)}
          detail="Unique users with recorded activity"
        />
        <Metric
          icon={Gauge}
          label="Worker requests"
          value={format(infra?.workerRequests)}
          detail={
            infra?.workerErrors === undefined
              ? 'Errors unavailable'
              : `${format(infra.workerErrors)} errors`
          }
        />
        <Metric
          icon={Database}
          label="D1 rows read"
          value={format(infra?.rowsRead)}
          detail={`Rows written: ${format(infra?.rowsWritten)}`}
        />
        <Metric
          icon={ArrowUpRight}
          label="Requests / 1,000 activities"
          value={
            activity && infra?.workerRequests !== undefined
              ? format((infra.workerRequests / activity) * 1000)
              : '—'
          }
          detail="Trend indicator; not per-user billing"
        />
      </div>
      {snapshot ? (
        <Trend snapshot={snapshot} />
      ) : (
        <section className="q-ops-empty">
          <Activity size={34} />
          <h3>Your monitoring starts here</h3>
          <p>
            Connect the server read token, then sync. You can also import
            infrastructure metrics below.
          </p>
        </section>
      )}
      <div className="q-ops-columns">
        <section className="q-ops-panel">
          <div className="q-ops-panel-heading">
            <h3>User usage analytics</h3>
            <span className="q-ops-chip">
              {data?.telemetry ? 'Collection enabled' : 'Collection disabled'}
            </span>
          </div>
          <dl className="q-ops-values">
            {USAGE_KEYS.map((key) => (
              <div key={key}>
                <dt>{usageLabels[key]}</dt>
                <dd>
                  {snapshot?.days.some((day) => day.usage)
                    ? format(usage?.[key])
                    : '—'}
                </dd>
              </div>
            ))}
          </dl>
          <p className="q-ops-muted">
            Server-accepted activity metadata only. No question text, answers,
            notes or email addresses are sent to Analytics Engine. Counts may be
            sampled or capped.
          </p>
        </section>
        <section className="q-ops-panel">
          <div className="q-ops-panel-heading">
            <h3>Backend / Cloudflare</h3>
            <span className="q-ops-chip">UTC</span>
          </div>
          <dl className="q-ops-values">
            {INFRA_KEYS.map((key) => (
              <div key={key}>
                <dt>{infraLabels[key]}</dt>
                <dd>{format(infra?.[key])}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <section className="q-ops-panel">
        <div className="q-ops-panel-heading">
          <div>
            <h3>Usage review</h3>
            <p>Relative anomaly alerts · no automatic restrictions</p>
          </div>
          <span className="q-ops-chip">
            {snapshot?.users.filter((user) => user.reasons?.length).length ?? 0}{' '}
            alerts
          </span>
        </div>
        <div className="q-ops-filters">
          <input
            aria-label="Search usage users"
            placeholder="Search name or user ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="q-ops-check">
            <input
              type="checkbox"
              checked={onlyAlerts}
              onChange={(event) => setOnlyAlerts(event.target.checked)}
            />
            Unusual usage only
          </label>
        </div>
        <div className="q-control-table-scroll">
          <table className="q-control-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Activity checkpoints</th>
                <th>Answered</th>
                <th>Imported</th>
                <th>Review status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {users.slice(0, 100).map((user) => (
                <tr key={user.telemetryId}>
                  <td>
                    <strong>{user.name}</strong>
                    <small>{user.userId}</small>
                  </td>
                  <td>{format(user.events)}</td>
                  <td>{format(user.questionsAnswered)}</td>
                  <td>{format(user.questionsImported)}</td>
                  <td>
                    {user.reasons?.length ? 'Attention' : 'Within cohort range'}
                  </td>
                  <td>
                    <button
                      className="q-ops-button"
                      onClick={() => setSelected(user)}
                    >
                      Open activity
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!users.length && (
          <p className="q-ops-muted">
            {snapshot?.users.length
              ? 'No users match this filter.'
              : 'User activity becomes available after collection and synchronization.'}
          </p>
        )}
        {users.length > 100 && (
          <p className="q-ops-muted">
            Showing the first 100 results; refine the search.
          </p>
        )}
      </section>
      <section className="q-ops-panel">
        <div className="q-ops-panel-heading">
          <div>
            <h3>Query Insights</h3>
            <p>
              Top statements by total execution time · fingerprints protect
              private values
            </p>
          </div>
          <Database size={19} />
        </div>
        <div className="q-control-table-scroll">
          <table className="q-control-table">
            <thead>
              <tr>
                <th>Query fingerprint</th>
                <th>Executions</th>
                <th>Total time (ms)</th>
                <th>Rows read</th>
                <th>Rows written</th>
              </tr>
            </thead>
            <tbody>
              {snapshot?.queries.map((query) => (
                <tr key={query.fingerprint}>
                  <td>
                    <code title={query.fingerprint}>
                      {query.fingerprint.slice(0, 16)}
                    </code>
                  </td>
                  <td>{format(query.executions)}</td>
                  <td>{format(query.totalMs)}</td>
                  <td>{format(query.rowsRead)}</td>
                  <td>{format(query.rowsWritten)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!snapshot?.queries.length && (
          <p className="q-ops-muted">
            No Query Insights data. Dataset access depends on your Cloudflare
            account and selected period.
          </p>
        )}
      </section>
      {snapshot?.unavailable.length ? (
        <Notice>
          <strong>Data coverage</strong>
          <ul>
            {snapshot.unavailable.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <div className="q-ops-columns">
        <section className="q-ops-panel">
          <div className="q-ops-panel-heading">
            <h3>Manual fallback</h3>
            <Upload size={19} />
          </div>
          <p className="q-ops-muted">
            Import normalized Cloudflare metrics as JSON (100 KB maximum). This
            replaces this period&apos;s snapshot and keeps the original
            observation dates.
          </p>
          <button className="q-ops-button" onClick={template}>
            <Download size={16} />
            Download JSON template
          </button>
          <label className="q-ops-field">
            Infrastructure file
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setError('');
                setImportDraft(undefined);
                setImportName('');
                try {
                  if (file.size > 100_000)
                    throw new Error('Maximum import size is 100 KB.');
                  setImportDraft(JSON.parse(await file.text()));
                  setImportName(file.name);
                } catch (error) {
                  setError(errorMessage(error));
                }
                event.target.value = '';
              }}
            />
          </label>
          {importName && (
            <p className="q-ops-muted">Ready to validate: {importName}</p>
          )}
          <label className="q-ops-field">
            Import reason
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
            />
          </label>
          <button
            className="q-ops-button primary"
            disabled={busy || !importDraft || !reason.trim()}
            onClick={() => void update('import')}
          >
            Validate & import
          </button>
        </section>
        <section className="q-ops-panel">
          <div className="q-ops-panel-heading">
            <h3>Cost & collection policy</h3>
            <ShieldCheck size={19} />
          </div>
          <dl className="q-ops-values">
            <div>
              <dt>External query budget today</dt>
              <dd>{data?.budget.used ?? 0} / 60</dd>
            </div>
            <div>
              <dt>Refresh cooldown per period</dt>
              <dd>30 minutes</dd>
            </div>
            <div>
              <dt>Telemetry cap</dt>
              <dd>20,000 / day</dd>
            </div>
            <div>
              <dt>Monthly telemetry cap</dt>
              <dd>500,000</dd>
            </div>
            <div>
              <dt>Next refresh available</dt>
              <dd>{data?.nextRefreshAt ? date(data.nextRefreshAt) : 'Now'}</dd>
            </div>
          </dl>
          <p className="q-ops-muted">
            Observe real Qraft usage for 30–60 days before setting Fair Use
            thresholds. Alerts do not alter plans. No background polling or
            dense telemetry in D1.
          </p>
          <p className="q-ops-muted">
            Caps cover this Qraft integration. Cloudflare allowances are shared
            with other apps and account usage; pricing must be reviewed before
            enabling collection.
          </p>
        </section>
      </div>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogTitle>Activity · {selected?.name}</DialogTitle>
          <p className="q-ops-muted">
            {selected?.userId} · {snapshot?.from.slice(0, 10)} to{' '}
            {snapshot?.to.slice(0, 10)} UTC
          </p>
          <dl className="q-ops-values">
            {USAGE_KEYS.map((key) => (
              <div key={key}>
                <dt>{usageLabels[key]}</dt>
                <dd>{format(selected?.[key])}</dd>
              </div>
            ))}
          </dl>
          {selected?.reasons?.map((reason) => (
            <Notice key={reason}>{reason}</Notice>
          ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SiteSettings = {
  maintenance: number;
  message: string;
  ends_at: string | null;
  revision: number;
  updated_at: string;
};
export function SiteOperationsAdmin() {
  const [observedNow, setObservedNow] = useState(() => Date.now());
  const [settings, setSettings] = useState<SiteSettings>(),
    [message, setMessage] = useState(''),
    [endsAt, setEndsAt] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState('');
  useEffect(() => {
    let active = true;
    const load = () =>
      void api<SiteSettings>('/platform/site-operations')
        .then((value) => {
          if (active) {
            setSettings(value);
            setMessage(value.message);
            setEndsAt(
              value.ends_at
                ? new Date(
                    Date.parse(value.ends_at) -
                      new Date(value.ends_at).getTimezoneOffset() * 60_000,
                  )
                    .toISOString()
                    .slice(0, 16)
                : '',
            );
          }
        })
        .catch((error) => {
          if (active) setError(errorMessage(error));
        });
    load();
    const stop = subscribeLive(load, ['site-operations', 'connected']);
    return () => {
      active = false;
      stop();
    };
  }, []);
  const active =
    settings?.maintenance === 1 &&
    (!settings.ends_at || Date.parse(settings.ends_at) > observedNow);
  useEffect(() => {
    if (!settings?.ends_at) return;
    const timer = window.setTimeout(
      () => setObservedNow(Date.now()),
      Math.max(0, Date.parse(settings.ends_at) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [settings?.ends_at]);
  async function save(maintenance: boolean) {
    if (!settings) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const value = await api<SiteSettings>('/platform/site-operations', {
        method: 'PUT',
        body: JSON.stringify({
          maintenance,
          message,
          endsAt: maintenance && endsAt ? new Date(endsAt).toISOString() : null,
          reason,
          revision: settings.revision,
        }),
      });
      setSettings(value);
      setApiCache('/platform/site-operations', value);
      setReason('');
      setSaved(
        maintenance
          ? 'Maintenance is active. Your Superadmin access remains available.'
          : 'The site is open.',
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="q-ops-workspace">
      {error && <Notice error>{error}</Notice>}
      {saved && <Notice>{saved}</Notice>}
      <section
        className="q-ops-health"
        data-health={active ? 'Attention' : 'Healthy'}
      >
        <div className="q-ops-health-icon">
          <Wrench size={25} />
        </div>
        <div>
          <span className="q-ops-eyebrow">SITE AVAILABILITY</span>
          <h2>
            {settings
              ? active
                ? 'Maintenance mode'
                : 'Site is open'
              : 'Loading…'}
          </h2>
          <p>
            Learner pages and API actions pause during maintenance. Superadmin
            and secure sign-in remain available.
          </p>
        </div>
      </section>
      <div className="q-ops-columns">
        <section className="q-ops-panel">
          <h3>Maintenance settings</h3>
          <label className="q-ops-field">
            Message to visitors
            <textarea
              maxLength={500}
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <label className="q-ops-field">
            Automatically reopen (optional, local time)
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </label>
          <label className="q-ops-field">
            Required audit reason
            <input
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="q-ops-actions">
            <button
              className="q-ops-button danger"
              disabled={
                busy || !settings || !message.trim() || reason.trim().length < 3
              }
              onClick={() => void save(true)}
            >
              <Wrench size={16} />
              {active ? 'Update maintenance' : 'Pause site'}
            </button>
            <button
              className="q-ops-button primary"
              disabled={busy || !settings || reason.trim().length < 3}
              onClick={() => void save(false)}
            >
              Reopen site
            </button>
          </div>
        </section>
        <section className="q-ops-panel">
          <h3>What visitors see</h3>
          <div className="q-ops-preview">
            <span className="q-ops-eyebrow">QRAFT · SYSTEM UPDATE</span>
            <h2>We&apos;ll be back shortly</h2>
            <p dir="auto">{message || 'Enter a maintenance message.'}</p>
            {endsAt && (
              <small>
                Expected return: {date(new Date(endsAt).toISOString())}
              </small>
            )}
          </div>
          <p className="q-ops-muted">
            Maintenance uses HTTP 503 and prevents new writes. Existing offline
            content may still be visible until the next connection. It does not
            delete any data.
          </p>
        </section>
      </div>
    </div>
  );
}

type CatalogPlan = (typeof PLAN_LIMITS)[PlanId] & {
  id: PlanId;
  price: number;
  description?: string;
};
export function PricingAdmin() {
  const [plans, setPlans] = useState<CatalogPlan[]>([]),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState('');
  useEffect(() => {
    let active = true;
    void api<{ plans: CatalogPlan[] }>('/platform/plan-pricing')
      .then((result) => {
        if (active) {
          setPlans(result.plans);
          setDrafts(
            Object.fromEntries(
              result.plans.map((plan) => [
                plan.id,
                (plan.price / 100).toFixed(2),
              ]),
            ),
          );
        }
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);
  const valid =
    plans.length === 4 &&
    plans
      .filter((plan) => plan.id !== 'free')
      .every(
        (plan) =>
          /^\d{1,6}(\.\d{1,2})?$/.test(drafts[plan.id] ?? '') &&
          Number(drafts[plan.id]) >= 0.01 &&
          Number(drafts[plan.id]) <= 100_000,
      );
  async function save() {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const result = await api<{ plans: CatalogPlan[] }>(
        '/platform/plan-pricing',
        {
          method: 'PUT',
          body: JSON.stringify({
            plans: plans.map((plan) => ({
              id: plan.id,
              price:
                plan.id === 'free'
                  ? 0
                  : Math.round(Number(drafts[plan.id]) * 100),
              policy: Object.fromEntries(
                [
                  'name',
                  'description',
                  ...Object.keys(POLICY_NUMBERS),
                  ...Object.keys(POLICY_FEATURES),
                ].map((key) => [key, plan[key as keyof CatalogPlan]]),
              ),
            })),
            reason,
          }),
        },
      );
      setPlans(result.plans);
      setApiCache('/platform/plan-pricing', result);
      setSaved(
        'Plan prices and details are published. Server limits apply on the next request.',
      );
      setReason('');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="q-ops-workspace">
      {error && <Notice error>{error}</Notice>}
      {saved && <Notice>{saved}</Notice>}
      <Notice>
        <CreditCard size={17} />
        All prices are annual in SAR. Changes affect new quotes; existing paid
        access and gifts keep their dates.
      </Notice>
      <div className="q-ops-pricing">
        {plans.map((plan) => (
          <article className="q-ops-panel" key={plan.id}>
            <span className="q-ops-eyebrow">
              {plan.id === 'free' ? 'STARTER ACCESS' : 'ANNUAL SUBSCRIPTION'}
            </span>
            <h2>{plan.name}</h2>
            <label className="q-ops-field">
              Price (SAR / year)
              <input
                type="number"
                min={plan.id === 'free' ? 0 : 0.01}
                max="100000"
                step="0.01"
                disabled={plan.id === 'free' || busy}
                value={drafts[plan.id] ?? ''}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [plan.id]: event.target.value,
                  }))
                }
              />
            </label>
            <dl className="q-ops-values">
              <div>
                <dt>Exams</dt>
                <dd>
                  {plan.lifetimeExamLimit
                    ? `${plan.lifetimeExamLimit} lifetime`
                    : `${plan.monthlyExamLimit} / month`}
                </dd>
              </div>
              <div>
                <dt>Questions / exam</dt>
                <dd>{plan.maxQuestionsPerExam}</dd>
              </div>
              <div>
                <dt>Private QBanks</dt>
                <dd>{plan.canCreatePrivateQBank ? 'Included' : '—'}</dd>
              </div>
              <div>
                <dt>Flashcards</dt>
                <dd>{format(plan.maxFlashcards)}</dd>
              </div>
              <div>
                <dt>JSON imports / day</dt>
                <dd>{plan.jsonImportDailyLimit}</dd>
              </div>
            </dl>
            <details className="q-ops-details">
              <summary>Edit plan details & limits</summary>
              <label className="q-ops-field">
                Display name
                <input
                  maxLength={40}
                  value={plan.name}
                  onChange={(event) =>
                    setPlans((current) =>
                      current.map((row) =>
                        row.id === plan.id
                          ? { ...row, name: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </label>
              <label className="q-ops-field">
                Description
                <textarea
                  rows={3}
                  maxLength={240}
                  value={plan.description ?? ''}
                  onChange={(event) =>
                    setPlans((current) =>
                      current.map((row) =>
                        row.id === plan.id
                          ? { ...row, description: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </label>
              {Object.entries(POLICY_NUMBERS).map(([key, rule]) => (
                <label className="q-ops-field" key={key}>
                  {rule.label}
                  <input
                    type="number"
                    min={key === 'maxQuestionsPerExam' ? 1 : 0}
                    max={Math.max(
                      rule.max,
                      Number(plan[key as keyof CatalogPlan]) || 0,
                    )}
                    value={
                      plan[key as keyof CatalogPlan] === null
                        ? ''
                        : Number(plan[key as keyof CatalogPlan])
                    }
                    placeholder={rule.nullable ? 'No limit' : ''}
                    onChange={(event) =>
                      setPlans((current) =>
                        current.map((row) =>
                          row.id === plan.id
                            ? {
                                ...row,
                                [key]:
                                  rule.nullable && event.target.value === ''
                                    ? null
                                    : Number(event.target.value),
                              }
                            : row,
                        ),
                      )
                    }
                  />
                  {rule.nullable && (
                    <small>
                      Leave empty for no plan limit; technical safety caps still
                      apply.
                    </small>
                  )}
                </label>
              ))}
              <div className="q-ops-feature-list">
                {Object.entries(POLICY_FEATURES).map(([key, label]) => (
                  <label className="q-ops-check" key={key}>
                    <input
                      type="checkbox"
                      checked={Boolean(plan[key as keyof CatalogPlan])}
                      onChange={(event) =>
                        setPlans((current) =>
                          current.map((row) =>
                            row.id === plan.id
                              ? { ...row, [key]: event.target.checked }
                              : row,
                          ),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="q-ops-muted">
                Existing data is retained when lowering quotas. Safety caps
                cannot be raised here. New flashcard limits above 5,000 await
                the storage upgrade.
              </p>
            </details>
          </article>
        ))}
      </div>
      <section className="q-ops-panel">
        <h3>Publish pricing & details</h3>
        <label className="q-ops-field">
          Required audit reason
          <input
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Annual pricing update"
          />
        </label>
        <div className="q-ops-actions">
          <button
            className="q-ops-button primary"
            disabled={busy || !valid || reason.trim().length < 3}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Publish plans'}
          </button>
          <span className="q-ops-muted">
            Free access stays at 0 SAR. Limits and features are checked by the
            backend.
          </span>
        </div>
      </section>
    </div>
  );
}

export function AccountBlockAdmin({
  members,
  onUpdated,
}: {
  members: MemberProfile[];
  onUpdated: (profile: MemberProfile) => void;
}) {
  const [userId, setUserId] = useState(''),
    [days, setDays] = useState('7'),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState('');
  async function save(blocked: boolean) {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const result = await api<{ profile: MemberProfile }>(
        '/platform/account-block',
        {
          method: 'POST',
          body: JSON.stringify({ userId, blocked, days: Number(days), reason }),
        },
      );
      onUpdated(result.profile);
      setSaved(
        blocked
          ? `Account paused until ${date(result.profile.suspendedUntil)}.`
          : 'Account access restored.',
      );
      setReason('');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="q-ops-panel">
      <div className="q-ops-panel-heading">
        <div>
          <h3>Timed account block</h3>
          <p>
            Expires automatically · independent of the permanent identity
            blocklist below
          </p>
        </div>
        <AlertTriangle size={19} />
      </div>
      {error && <Notice error>{error}</Notice>}
      {saved && <Notice>{saved}</Notice>}
      <div className="q-ops-form-grid">
        <label className="q-ops-field">
          Account
          <select
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          >
            <option value="">Choose an account</option>
            {members
              .filter((member) => member.role !== 'super_admin')
              .map((member) => (
                <option key={member.uid} value={member.uid}>
                  {member.displayName} · {member.email}
                </option>
              ))}
          </select>
        </label>
        <label className="q-ops-field">
          Block days
          <input
            type="number"
            min="1"
            max="365"
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
        </label>
        <label className="q-ops-field">
          Required reason
          <input
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </div>
      <div className="q-ops-actions">
        <button
          className="q-ops-button danger"
          disabled={
            busy ||
            !userId ||
            reason.trim().length < 3 ||
            !Number.isInteger(Number(days)) ||
            Number(days) < 1 ||
            Number(days) > 365
          }
          onClick={() => void save(true)}
        >
          Block account
        </button>
        <button
          className="q-ops-button"
          disabled={busy || !userId || reason.trim().length < 3}
          onClick={() => void save(false)}
        >
          Restore account
        </button>
      </div>
    </section>
  );
}
