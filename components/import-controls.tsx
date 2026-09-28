'use client';
import { useEffect, useState } from 'react';
import { api, invalidateApiResources } from '@/lib/api-client';
import type { MemberProfile } from '@/lib/medguard-types';
import { DEFAULT_IMPORT_SETTINGS, type ImportSettings } from '@/features/imports/domain/import-settings';

export function ImportControls({ members }: { members: MemberProfile[] }) {
  const [pipeline, setPipeline] = useState<ImportSettings>(DEFAULT_IMPORT_SETTINGS);
  const [userId, setUserId] = useState(members[0]?.uid ?? '');
  const [questions, setQuestions] = useState('150'),
    [times, setTimes] = useState('5'),
    [days, setDays] = useState('7');
  const [globalQuestions, setGlobalQuestions] = useState(''),
    [globalTimes, setGlobalTimes] = useState('');
  const [reason, setReason] = useState(''),
    [endsAt, setEndsAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void api<ImportSettings>('/platform/import-settings').then(value => { if (active) setPipeline(value); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    void api<{
      questionsPerImport: number | null;
      importsPerDay: number | null;
    }>('/platform/import-defaults')
      .then((data) => {
        if (active) {
          setGlobalQuestions(
            data.questionsPerImport === null
              ? ''
              : String(data.questionsPerImport),
          );
          setGlobalTimes(
            data.importsPerDay === null ? '' : String(data.importsPerDay),
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void api<{
      importLimits: { questionsPerImport: number; importsPerDay: number };
      endsAt: string | null;
    }>(`/platform/import-controls?userId=${encodeURIComponent(userId)}`)
      .then((data) => {
        if (active) {
          setQuestions(String(data.importLimits.questionsPerImport));
          setTimes(String(data.importLimits.importsPerDay));
          setEndsAt(data.endsAt);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);
  async function save(operation: string) {
    if (reason.trim().length < 3) {
      setError('Enter a reason (at least 3 characters).');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const defaults = operation === 'defaults';
      const result = await api<{ suspension?: { ends_at: string } }>(
        operation === 'pipeline' ? '/platform/import-settings' : defaults ? '/platform/import-defaults' : '/platform/economy-admin',
        {
          method: operation === 'pipeline' ? 'PUT' : 'POST',
          body: JSON.stringify(
            operation === 'pipeline' ? { settings: pipeline, reason } : defaults
              ? {
                  questionsPerImport:
                    globalQuestions === '' ? null : Number(globalQuestions),
                  importsPerDay:
                    globalTimes === '' ? null : Number(globalTimes),
                  reason,
                }
              : {
                  operation,
                  userId,
                  reason,
                  questionsPerImport: Number(questions),
                  importsPerDay: Number(times),
                  days: Number(days),
                },
          ),
        },
      );
      invalidateApiResources(['economy', 'import-status']);
      if (defaults) {
        const updated = await api<{
          importLimits: { questionsPerImport: number; importsPerDay: number };
        }>(`/platform/import-controls?userId=${encodeURIComponent(userId)}`);
        setQuestions(String(updated.importLimits.questionsPerImport));
        setTimes(String(updated.importLimits.importsPerDay));
      }
      if (operation === 'suspend-json')
        setEndsAt(result.suspension?.ends_at ?? null);
      if (operation === 'remove-json-suspension') setEndsAt(null);
      setMessage('Import settings saved.');
      setReason('');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unable to save import settings.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
      <h2 className="text-xl font-bold">Import limits & access</h2>
      <label className="q-ops-field">
        Reason
        <input
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <fieldset disabled={busy} className="space-y-3 rounded-xl border p-4">
        <legend className="px-2 font-semibold">JSON reading & duplicate review</legend>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={pipeline.enabled} onChange={event => setPipeline({ ...pipeline, enabled: event.target.checked })} />Allow JSON imports for users</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="q-ops-field">Maximum user file size (MB)<input type="number" min="0.5" max="50" step="0.5" value={pipeline.maxFileMegabytes} onChange={event => setPipeline({ ...pipeline, maxFileMegabytes: Number(event.target.value) })} /></label>
          <label className="q-ops-field">Questions per duplicate scan request<select value={pipeline.previewBatchSize} onChange={event => setPipeline({ ...pipeline, previewBatchSize: Number(event.target.value) })}><option value="25">25 · smaller requests</option><option value="50">50 · balanced</option><option value="100">100 · fewer requests</option></select></label>
        </div>
        <p className="text-xs text-muted-foreground">Superadmin can still import when user imports are paused. Administrative files are limited to 50 MB; uploads are split into bounded batches. Existing account quotas and suspensions remain available below.</p>
        <button className="q-button min-h-11 w-full border" onClick={() => void save('pipeline')}>Save JSON settings</button>
      </fieldset>
      <div className="grid gap-5 lg:grid-cols-2">
        <fieldset
          disabled={busy}
          className="min-w-0 space-y-3 rounded-xl border p-4"
        >
          <legend className="px-2 font-semibold">
            Default limits for all users
          </legend>
          <label className="q-ops-field">
            Total questions per import
            <input
              type="number"
              min="1"
              max="5000"
              placeholder="Use subscription limit"
              value={globalQuestions}
              onChange={(e) => setGlobalQuestions(e.target.value)}
            />
          </label>
          <label className="q-ops-field">
            Imports per user / day (UTC)
            <input
              type="number"
              min="1"
              max="100"
              placeholder="Use subscription limit"
              value={globalTimes}
              onChange={(e) => setGlobalTimes(e.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Blank values use subscription limits. Account overrides take
            precedence. Superadmin imports use the administrative path.
          </p>
          <button
            className="q-button min-h-11 w-full border"
            onClick={() => void save('defaults')}
          >
            Save default limits
          </button>
        </fieldset>
        <fieldset
          disabled={busy}
          className="min-w-0 space-y-3 rounded-xl border p-4"
        >
          <legend className="px-2 font-semibold">Individual user</legend>
          <label className="q-ops-field">
            Account
            <select
              value={userId}
              onChange={(e) => {
                setBusy(true);
                setUserId(e.target.value);
              }}
            >
              {members.map((m) => (
                <option key={m.uid} value={m.uid}>
                  {m.displayName} · {m.email}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="q-ops-field">
              Questions per import
              <input
                type="number"
                min="1"
                max="5000"
                value={questions}
                onChange={(e) => setQuestions(e.target.value)}
              />
            </label>
            <label className="q-ops-field">
              Imports per day (UTC)
              <input
                type="number"
                min="1"
                max="100"
                value={times}
                onChange={(e) => setTimes(e.target.value)}
              />
            </label>
          </div>
          <button
            disabled={!userId}
            className="q-button min-h-11 w-full border"
            onClick={() => void save('import-limits')}
          >
            Save account limits
          </button>
          <label className="q-ops-field">
            Suspension days
            <input
              type="number"
              min="1"
              max="365"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
          {endsAt && (
            <p className="text-sm text-destructive">
              Suspended until {new Date(endsAt).toLocaleString()}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              disabled={!userId}
              className="q-button min-h-11 border text-destructive"
              onClick={() => void save('suspend-json')}
            >
              Suspend import
            </button>
            <button
              disabled={!userId || !endsAt}
              className="q-button min-h-11 border"
              onClick={() => void save('remove-json-suspension')}
            >
              Remove suspension
            </button>
          </div>
        </fieldset>
      </div>
      {busy && <output className="block text-sm">Saving / loading…</output>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <output className="block text-sm text-emerald-600">{message}</output>
      )}
    </section>
  );
}
