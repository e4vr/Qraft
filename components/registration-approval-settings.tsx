'use client';

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError, setApiCache } from '@/lib/api-client';
import { subscribeLive } from '@/lib/realtime-client';
import type { AppUser } from '@/lib/medguard-types';
import type { RegistrationPolicy } from '@/features/administration/domain/registration-policy';

export function RegistrationApprovalSettings({
  user,
  refreshRevision,
}: {
  user: AppUser;
  refreshRevision: number;
}) {
  const [policy, setPolicy] = useState<RegistrationPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const busy = useRef(false);
  const pendingReload = useRef(false);
  const readRevision = useRef(0);
  const currentUser = useRef(user.uid);
  const permitted =
    user.role === 'super_admin' &&
    Boolean(user.mfaEnrolled && user.mfaVerified);

  useEffect(() => {
    currentUser.current = user.uid;
    let active = true;
    if (!permitted) return;
    const load = () => {
      if (busy.current) {
        pendingReload.current = true;
        return;
      }
      const revision = ++readRevision.current;
      void api<RegistrationPolicy>('/platform/registration-policy', {
        forceRefresh: true,
        cacheScope: user.uid,
        expectedUserId: user.uid,
      })
        .then((next) => {
          if (active && revision === readRevision.current) {
            setPolicy(next);
            setError('');
            setMessage('');
          }
        })
        .catch((failure) => {
          if (active && revision === readRevision.current)
            setError(
              failure instanceof Error
                ? failure.message
                : 'Unable to load registration settings.',
            );
        });
    };
    load();
    const stop = subscribeLive(load, ['registration-policy', 'connected']);
    return () => {
      active = false;
      stop();
    };
  }, [user.uid, permitted, refreshRevision, retry]);

  async function toggleApproval() {
    if (!permitted || !policy || error || busy.current) return;
    const uid = user.uid;
    busy.current = true;
    readRevision.current++;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const next = await api<RegistrationPolicy & { approvedCount?: number }>(
        '/platform/registration-policy',
        {
          method: 'PUT',
          expectedUserId: uid,
          body: JSON.stringify({
            autoApproveUniversityIds: !policy.autoApproveUniversityIds,
            revision: policy.revision,
          }),
        },
      );
      if (currentUser.current !== uid) return;
      setPolicy(next);
      setApiCache('/platform/registration-policy', next, { cacheScope: uid });
      setMessage(
        next.autoApproveUniversityIds
          ? `Automatic approval enabled. ${next.approvedCount ?? 0} matching pending registrations approved.`
          : 'Automatic approval disabled. New registrations require manual approval.',
      );
    } catch (failure) {
      if (currentUser.current !== uid) return;
      if (
        failure instanceof ApiError &&
        failure.status === 409 &&
        failure.payload.policy
      ) {
        setPolicy(failure.payload.policy as RegistrationPolicy);
        setError(
          'The setting changed elsewhere. The latest setting is shown; review it before trying again.',
        );
      } else {
        setPolicy(null);
        setError(
          failure instanceof Error
            ? failure.message
            : 'Unable to confirm the registration setting. Reload before trying again.',
        );
      }
    } finally {
      busy.current = false;
      setSaving(false);
      if (pendingReload.current) {
        pendingReload.current = false;
        setRetry((value) => value + 1);
      }
    }
  }

  return (
    <div className="border-b p-5" aria-busy={saving}>
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <ShieldCheck className="size-4 text-primary" />
            Automatic registration approval
          </h3>
          <p
            id="registration-approval-description"
            className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground"
          >
            Approve new and pending registrations when their university ID
            matches the Student IDs list, including IDs added while enabled.
            Unlisted IDs stay pending; blocked and rejected accounts remain
            excluded. Disabling stops automatic approval and preserves previous
            approvals.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Automatic registration approval"
          aria-describedby="registration-approval-description"
          aria-checked={policy?.autoApproveUniversityIds === true}
          disabled={!permitted || !policy || Boolean(error) || saving}
          onClick={() => void toggleApproval()}
          className="q-button q-button-secondary disabled:opacity-50"
        >
          <span
            aria-hidden="true"
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${policy?.autoApproveUniversityIds ? 'bg-primary' : 'bg-muted-foreground/40'}`}
          >
            <span
              className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${policy?.autoApproveUniversityIds ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
            />
          </span>
          {saving
            ? 'Saving…'
            : !permitted
              ? 'MFA required'
              : !policy
                ? 'Unavailable'
                : policy.autoApproveUniversityIds
                  ? 'Enabled'
                  : 'Disabled'}
        </button>
      </div>
      {!policy && permitted && !error && (
        <output className="mt-2 block text-xs text-muted-foreground">
          Loading registration settings…
        </output>
      )}
      {!permitted && (
        <p className="mt-2 text-xs text-muted-foreground">
          An enrolled and verified Superadmin MFA session is required to change
          this setting.
        </p>
      )}
      {message && (
        <output
          aria-live="polite"
          className="mt-3 block text-xs text-emerald-600 dark:text-emerald-300"
        >
          {message}
        </output>
      )}
      {error && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p role="alert" className="text-xs text-red-600 dark:text-red-300">
            {error}
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setPolicy(null);
              setError('');
              setMessage('');
              setRetry((value) => value + 1);
            }}
            className="q-button q-button-secondary"
          >
            Reload setting
          </button>
        </div>
      )}
    </div>
  );
}
