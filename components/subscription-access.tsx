'use client';
import { useEffect, useRef, useState } from 'react';
import { Crown, KeyRound } from 'lucide-react';
import { api } from '@/lib/api-client';
import { setAuthenticatedUserCache } from '@/lib/application-services';
import { subscribeLive } from '@/lib/realtime-client';
import type { AppUser } from '@/lib/medguard-types';
import {
  durationText,
  grantStatus,
  type AccessGrant,
} from '@/features/subscriptions/domain/access-model';

export function SubscriptionAccess({
  user,
  onUser,
}: {
  user: AppUser;
  onUser: (user: AppUser) => void;
}) {
  const [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const [grants, setGrants] = useState<(AccessGrant & { status: string })[]>(
    [],
  );
  const requestId = useRef(crypto.randomUUID()),
    flight = useRef(false),
    accountId = useRef(user.uid);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void api<{ grants: (AccessGrant & { status: string })[] }>(
        '/platform/access-account',
        { cacheScope: user.uid, expectedUserId: user.uid },
      )
        .then((result) => {
          if (alive) setGrants(result.grants);
        })
        .catch(() => undefined);
    };
    load();
    const stop = subscribeLive(load, ['subscriptions', 'account']);
    return () => {
      alive = false;
      stop();
    };
  }, [user.uid]);
  useEffect(() => {
    accountId.current = user.uid;
    return () => {
      accountId.current = '';
    };
  }, [user.uid]);
  async function activate() {
    if (flight.current) return;
    const uid = user.uid;
    flight.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await api<{ user: AppUser; grant: AccessGrant }>(
        '/platform/activation-code',
        {
          method: 'POST',
          headers: { 'x-qraft-account': uid },
          body: JSON.stringify({ code, requestId: requestId.current }),
        },
      );
      if (accountId.current !== uid) return;
      setAuthenticatedUserCache(result.user);
      onUser(result.user);
      setSuccess(
        result.user.effectivePlanExpiresAt
          ? `Full Access activated. Your access ends ${new Date(result.user.effectivePlanExpiresAt).toLocaleString('en-GB')}.`
          : 'This activation was already processed. Your current access is shown above.',
      );
      const history = await api<{
        grants: (AccessGrant & { status: string })[];
      }>('/platform/access-account', {
        cacheScope: uid,
        expectedUserId: uid,
      }).catch(() => null);
      if (accountId.current !== uid) return;
      setGrants(
        (previous) =>
          history?.grants ?? [
            { ...result.grant, status: grantStatus(result.grant) },
            ...previous.filter((grant) => grant.id !== result.grant.id),
          ],
      );
      setCode('');
      requestId.current = crypto.randomUUID();
    } catch (caught) {
      if (accountId.current === uid)
        setError(
          caught instanceof Error
            ? caught.message
            : 'Unable to activate this code.',
        );
    } finally {
      flight.current = false;
      if (accountId.current === uid) setBusy(false);
    }
  }
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-primary/10 p-3 text-primary">
          <Crown className="size-5" />
        </span>
        <div>
          <h2 className="font-bold">Your access</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {user.role === 'super_admin'
              ? 'Permanent Superadmin access'
              : (user.effectivePlan ?? user.tier) === 'free'
                ? 'Free trial · 2 lifetime tests, up to 15 questions each'
                : `Full Access until ${user.effectivePlanExpiresAt ? new Date(user.effectivePlanExpiresAt).toLocaleString('en-GB') : '—'}`}
          </p>
        </div>
      </div>
      {user.role !== 'super_admin' && (
        <form
          className="space-y-2 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void activate();
          }}
        >
          <label
            htmlFor="subscription-activation-code"
            className="text-sm font-semibold"
          >
            Have an activation code?
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="subscription-activation-code"
              required
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="min-h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 font-mono text-sm"
              placeholder="Enter your code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                requestId.current = crypto.randomUUID();
                setError('');
              }}
            />
            <button
              className="q-button q-button-primary inline-flex items-center justify-center gap-2"
              disabled={busy || !code.trim()}
            >
              <KeyRound className="size-4" />
              {busy ? 'Activating…' : 'Activate access'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            The code supplies its duration. Any remaining access is extended
            automatically.
          </p>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {success && (
        <output className="block text-sm text-emerald-700 dark:text-emerald-300">
          {success}
        </output>
      )}
      {grants.length > 0 && (
        <details className="border-t pt-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Activation history
          </summary>
          <div className="mt-3 space-y-2">
            {grants.map((grant) => (
              <div
                key={grant.id}
                className="rounded-xl bg-muted/30 p-3 text-xs"
              >
                <div className="flex justify-between gap-2">
                  <strong>
                    {grant.label} ·{' '}
                    {durationText(grant.duration, grant.duration_unit)}
                  </strong>
                  <span className="capitalize text-muted-foreground">
                    {grant.status}
                  </span>
                </div>
                <p className="mt-2 text-muted-foreground">
                  {new Date(grant.starts_at).toLocaleString('en-GB')} →{' '}
                  {new Date(grant.expires_at).toLocaleString('en-GB')}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
