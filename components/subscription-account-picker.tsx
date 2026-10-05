'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

export function SubscriptionAccountPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (uid: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [rows, setRows] = useState<
      { uid: string; name: string; email: string; role: string }[]
    >([]),
    [error, setError] = useState('');
  useEffect(() => {
    if (value || query.trim().length < 2) return;
    let alive = true;
    const timer = setTimeout(() => {
      void api<{ members: typeof rows }>(
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
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, value]);
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">
        Restrict to a member · optional
        <input
          aria-label="Find member for activation code"
          disabled={Boolean(value)}
          placeholder="Search name or email; leave blank for any account"
          className="mt-1.5 min-h-11 w-full rounded-xl border bg-background px-3 text-sm"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setRows([]);
          }}
        />
      </label>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/5 p-3 text-xs">
          <span>This code is restricted to the selected member.</span>
          <button
            type="button"
            className="font-semibold text-primary"
            onClick={() => {
              onChange('');
              setQuery('');
              setRows([]);
            }}
          >
            Clear restriction
          </button>
        </div>
      ) : (
        query.trim().length >= 2 && (
          <div className="max-h-48 overflow-y-auto rounded-xl border">
            {rows.length ? (
              rows.map((member) => (
                <button
                  type="button"
                  className="block w-full p-3 text-left hover:bg-muted"
                  key={member.uid}
                  onClick={() => {
                    onChange(member.uid);
                    setQuery(`${member.name} · ${member.email}`);
                  }}
                >
                  <strong className="block text-sm">{member.name}</strong>
                  <small className="text-muted-foreground">
                    {member.email}
                  </small>
                </button>
              ))
            ) : (
              <p className="p-3 text-xs text-muted-foreground">
                {error ||
                  'Search for a member, then choose the matching account.'}
              </p>
            )}
          </div>
        )
      )}
      <p className="text-xs text-muted-foreground">
        {value
          ? 'Only this account can redeem it, once.'
          : 'Any approved account can redeem it. One use globally.'}
      </p>
    </div>
  );
}
