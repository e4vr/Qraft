'use client';
import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api-client';
import type { ActivationCodeAudience } from '@/features/subscriptions/domain/access-model';

export type SubscriptionCodeMember = {
  uid: string;
  name: string;
  email: string;
  role: string;
};

export function SubscriptionAccountPicker({
  codeKind = 'activation',
  audience,
  onAudienceChange,
  value,
  onChange,
}: {
  codeKind?: 'activation' | 'discount';
  audience: ActivationCodeAudience;
  onAudienceChange: (audience: ActivationCodeAudience) => void;
  value: SubscriptionCodeMember | null;
  onChange: (member: SubscriptionCodeMember | null) => void;
}) {
  const radioName = useId();
  const [query, setQuery] = useState(''),
    [rows, setRows] = useState<SubscriptionCodeMember[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (audience !== 'member' || value || query.trim().length < 2) return;
    let alive = true;
    const timer = setTimeout(() => {
      void api<{ members: SubscriptionCodeMember[] }>(
        `/platform/access-admin?search=${encodeURIComponent(query.trim())}`,
      )
        .then((result) => {
          if (alive) {
            setRows(
              result.members
                .filter((member) => member.role !== 'super_admin')
                .slice(0, 8),
            );
            setError('');
          }
        })
        .catch(() => {
          if (alive) setError('Unable to search members. Try again.');
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [audience, query, value]);
  function clearSelection() {
    onChange(null);
    setQuery('');
    setRows([]);
    setError('');
    setLoading(false);
  }
  return (
    <fieldset className="space-y-3 rounded-2xl border p-4">
      <legend className="px-1 text-sm font-semibold">
        {codeKind === 'discount'
          ? 'Who can use this discount?'
          : 'Who can use these codes?'}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            [
              'any',
              'Any approved account',
              codeKind === 'discount'
                ? 'Available within the configured usage limits.'
                : 'Each code can be used once, globally.',
            ],
            [
              'member',
              'One specific account',
              codeKind === 'discount'
                ? 'Only the selected account can use this discount.'
                : 'Only the selected account can use these codes.',
            ],
          ] as const
        ).map(([scope, title, description]) => (
          <label
            key={scope}
            aria-label={title}
            className={`relative flex cursor-pointer items-start gap-2 rounded-xl border p-3 ${audience === scope ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
          >
            <input
              type="radio"
              name={radioName}
              value={scope}
              checked={audience === scope}
              className="mt-0.5 size-4 shrink-0 accent-primary"
              onChange={() => {
                clearSelection();
                onAudienceChange(scope);
              }}
            />
            <span>
              <strong className="block text-sm">{title}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                {description}
              </span>
            </span>
          </label>
        ))}
      </div>
      {audience === 'member' &&
        (value ? (
          <div className="flex items-start justify-between gap-3 rounded-xl bg-primary/5 p-3">
            <div className="min-w-0">
              <strong className="block break-words text-sm">
                {value.name || value.email}
              </strong>
              <span className="block break-all text-xs text-muted-foreground">
                {value.email}
              </span>
              <span className="mt-1 block break-all text-xs text-muted-foreground">
                Account ID: {value.uid}
              </span>
              <p className="mt-2 text-xs font-medium">
                {codeKind === 'discount'
                  ? 'Only this account can use this discount.'
                  : 'Only this account can activate these codes.'}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs font-semibold text-primary"
              onClick={clearSelection}
            >
              Change account
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-sm font-medium">
              Choose the allowed account
              <input
                aria-label={`Find member for ${codeKind} code`}
                placeholder="Search name, email or account ID"
                className="mt-1.5 min-h-11 w-full rounded-xl border bg-background px-3 text-sm"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setRows([]);
                  setError('');
                  setLoading(event.target.value.trim().length >= 2);
                }}
              />
            </label>
            <div aria-live="polite">
              {query.trim().length >= 2 && (
                <div className="max-h-48 overflow-y-auto rounded-xl border">
                  {rows.length ? (
                    rows.map((member) => (
                      <button
                        type="button"
                        className="block w-full p-3 text-left hover:bg-muted"
                        key={member.uid}
                        onClick={() => {
                          onChange(member);
                          setRows([]);
                          setLoading(false);
                        }}
                      >
                        <strong className="block text-sm">
                          {member.name || member.email}
                        </strong>
                        <span className="block break-all text-xs text-muted-foreground">
                          {member.email}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="p-3 text-xs text-muted-foreground">
                      {error ||
                        (loading
                          ? 'Searching accounts…'
                          : 'No matching accounts. Try another name, email or account ID.')}
                    </p>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {codeKind === 'discount'
                ? 'Select an account from the results before saving the discount.'
                : 'Select an account from the results before generating codes.'}
            </p>
          </div>
        ))}
    </fieldset>
  );
}
