'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { loadArchivedCollaboration } from '@/lib/local-db';

export function ContributionDraftHistory({
  uid,
  refreshKey,
}: {
  uid: string;
  refreshKey: string;
}) {
  const [history, setHistory] = useState<{ uid: string; count: number }>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void loadArchivedCollaboration(uid)
      .then((drafts) => {
        if (active) {
          setHistory({ uid, count: drafts.length });
          setError('');
        }
      })
      .catch(() => {
        if (active)
          setError(
            'Unable to read preserved contribution drafts. Refresh this page to retry.',
          );
      });
    return () => {
      active = false;
    };
  }, [uid, refreshKey]);
  if (history?.uid !== uid || !history.count)
    return error ? (
      <p role="alert" className="mt-3 text-sm text-destructive">
        {error}
      </p>
    ) : null;
  return (
    <section className="mt-4 rounded-xl border bg-muted/30 p-4">
      <h3 className="text-sm font-semibold">
        Older contribution drafts · {history.count}
      </h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        These edits belong to contributions whose review has already ended. They
        were preserved here without changing the reviewed contributions and no
        longer block synchronization.
      </p>
      <button
        type="button"
        className="q-button q-button-secondary mt-3"
        onClick={() => {
          setError('');
          void loadArchivedCollaboration(uid)
            .then((drafts) => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(drafts, null, 2)], {
                  type: 'application/json',
                }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = 'qraft-preserved-contribution-history.json';
              link.click();
              URL.revokeObjectURL(url);
            })
            .catch(() =>
              setError(
                'Unable to download preserved drafts. Retry on this device.',
              ),
            );
        }}
      >
        <Download className="size-4" />
        Download preserved drafts
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
