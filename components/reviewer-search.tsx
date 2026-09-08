'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import type { QBankMembership } from '@/lib/medguard-types';
export function ReviewerSearch({
  bankId,
  onAdded,
}: {
  bankId: string;
  onAdded: (membership: QBankMembership) => void;
}) {
  const [search, setSearch] = useState(''),
    [open, setOpen] = useState(false),
    [users, setUsers] = useState<
      { uid: string; email: string; name: string }[]
    >([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (!open || !bankId) return;
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      api<{ users: typeof users }>(
        `/platform/reviewers?bank=${encodeURIComponent(bankId)}&search=${encodeURIComponent(search)}`,
      )
        .then((r) => {
          if (live) setUsers(r.users);
        })
        .catch((e) => {
          if (live) setMessage(e.message);
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [bankId, search, open]);
  async function add(uid: string) {
    setBusy(true);
    try {
      const r = await api<{ membership: QBankMembership }>(
        '/platform/reviewers',
        { method: 'POST', body: JSON.stringify({ bankId, userId: uid }) },
      );
      onAdded(r.membership);
      setMessage('Reviewer added.');
      setOpen(false);
      setSearch('');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to add reviewer.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="relative min-w-0">
      <label className="sr-only" htmlFor={`reviewer-${bankId}`}>
        Search reviewer by name or email
      </label>
      <input
        id={`reviewer-${bankId}`}
        disabled={!bankId}
        className="w-full rounded-xl border bg-background px-3 py-3"
        placeholder="Search reviewer name or email"
        value={search}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-xl border bg-popover p-2 shadow-lg">
          <p className="px-2 py-1 text-xs font-bold text-muted-foreground">
            {search ? 'Matching accounts' : 'Recently Added'}
          </p>
          {users.map((u) => (
            <button
              disabled={busy}
              key={u.uid}
              onClick={() => void add(u.uid)}
              className="block w-full rounded-lg px-3 py-3 text-start hover:bg-muted"
            >
              <strong className="block truncate text-sm">{u.name}</strong>
              <span className="block break-all text-xs text-muted-foreground">
                {u.email}
              </span>
            </button>
          ))}
          {!users.length && !busy && (
            <p className="p-3 text-sm">No users found.</p>
          )}
          {busy && <output className="p-3">Loading…</output>}
          <button className="q-button border" onClick={() => setOpen(false)}>
            Close suggestions
          </button>
        </div>
      )}
      {message && <output className="mt-2 text-xs">{message}</output>}
    </div>
  );
}
