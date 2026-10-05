'use client';

import { useEffect, useRef, useState } from 'react';
import { Gift } from 'lucide-react';
import { api, setApiCache } from '@/lib/api-client';
import { subscribeLive } from '@/lib/realtime-client';
import {
  rewardPassLabel,
  type GiftNotification as GiftNotice,
} from '@/features/contributions/domain/reward-pass';
import { CelebrationArtwork } from '@/components/reward-celebration-artwork';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

const endpoint = '/platform/gift-notification';

function anotherDialogIsOpen() {
  return [
    ...document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
  ].some(
    (dialog) =>
      !dialog.hasAttribute('data-gift-notification') &&
      !dialog.hasAttribute('data-closed') &&
      dialog.getAttribute('aria-hidden') !== 'true',
  );
}

export function GiftNotification({
  userId,
  onViewGift,
  onOpenChange,
}: {
  userId: string;
  onViewGift: (passId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [gift, setGift] = useState<GiftNotice | null>(null);
  const close = useRef<() => void>(() => undefined);
  useEffect(() => {
    let active = true,
      busy = false,
      displaying = false,
      migrated = false,
      historyUpdated = false,
      reloadRequested = false;
    let candidate: GiftNotice | null = null,
      claimed: GiftNotice | null = null;
    const ready = () =>
      active &&
      navigator.onLine &&
      document.visibilityState === 'visible' &&
      !anotherDialogIsOpen();
    const present = () => {
      if (!claimed || displaying || !ready()) return;
      displaying = true;
      onOpenChange(true);
      setGift(claimed);
    };
    close.current = () => {
      displaying = false;
      claimed = null;
      candidate = null;
      reloadRequested = false;
      setGift(null);
      onOpenChange(false);
      // Other gifts stay in the wallet. Closing never starts a popup cascade.
    };
    const claim = async () => {
      if (!candidate || busy || claimed || displaying || !ready()) return;
      const next = candidate;
      candidate = null;
      busy = true;
      try {
        const result = await api<{ gift: GiftNotice | null }>(endpoint, {
          method: 'POST',
          expectedUserId: userId,
          body: JSON.stringify({ operation: 'claim', passId: next.id }),
        });
        if (!active) return;
        setApiCache(endpoint, { gift: null }, { cacheScope: userId });
        claimed = result.gift;
        present();
      } catch {
        // Do not show on an ambiguous save: the gift remains in the wallet,
        // while a committed presentation claim must never be shown twice.
      } finally {
        busy = false;
      }
      if (active && !claimed && !displaying && reloadRequested) {
        reloadRequested = false;
        void load(true);
      }
    };
    const migrateHistory = async () => {
      if (migrated) return;
      let ids: string[] = [],
        synced = '';
      const key = `qraft-gift-history-synced:${userId}`;
      try {
        const saved = JSON.parse(
          localStorage.getItem(`qraft-reward-celebration:${userId}`) ?? '{}',
        ) as { seenAdminGiftIds?: unknown };
        if (Array.isArray(saved.seenAdminGiftIds))
          ids = [
            ...new Set(
              saved.seenAdminGiftIds.filter(
                (id): id is string =>
                  typeof id === 'string' && Boolean(id) && id.length <= 160,
              ),
            ),
          ].slice(0, 100);
        synced = localStorage.getItem(key) ?? '';
      } catch {
        /* The server remains authoritative without browser storage. */
      }
      const history = JSON.stringify(ids);
      if (ids.length && synced !== history) {
        await api(endpoint, {
          method: 'POST',
          resourceQuery: true,
          cacheScope: userId,
          expectedUserId: userId,
          body: JSON.stringify({ operation: 'migrate-seen', passIds: ids }),
        });
        if (!active) return;
        historyUpdated = true;
        try {
          localStorage.setItem(key, history);
        } catch {
          /* Idempotent migration can safely retry. */
        }
      }
      migrated = true;
    };
    const load = async (force = false) => {
      if (
        !active ||
        displaying ||
        claimed ||
        !navigator.onLine ||
        document.visibilityState !== 'visible'
      )
        return;
      if (busy) {
        reloadRequested ||= force;
        return;
      }
      busy = true;
      try {
        await migrateHistory();
        if (!active) return;
        const result = await api<{ gift: GiftNotice | null }>(endpoint, {
          forceRefresh: force || historyUpdated,
          cacheScope: userId,
          expectedUserId: userId,
        });
        if (active) candidate = result.gift;
        historyUpdated = false;
      } catch {
        candidate = null;
      } finally {
        busy = false;
      }
      if (!active) return;
      if (reloadRequested) {
        reloadRequested = false;
        void load(true);
        return;
      }
      void claim();
    };
    const observer = new MutationObserver(() => {
      present();
      void claim();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-open', 'data-closed', 'aria-hidden', 'role'],
    });
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      present();
      if (candidate) void claim();
      else void load(true);
    };
    const stop = subscribeLive(
      () => void load(true),
      ['reward-gift', 'connected'],
    );
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    void load();
    return () => {
      active = false;
      observer.disconnect();
      stop();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      if (displaying) onOpenChange(false);
    };
  }, [userId, onOpenChange]);

  return (
    <Dialog
      open={Boolean(gift)}
      onOpenChange={(open) => {
        if (!open) close.current();
      }}
    >
      <DialogContent
        data-gift-notification=""
        className="overflow-x-hidden border-0 bg-card p-0 shadow-[0_28px_90px_rgba(7,35,62,.3)] sm:max-w-md"
        showCloseButton={false}
      >
        {gift && (
          <>
            <CelebrationArtwork kind="admin-gift" />
            <div className="px-6 pb-6 pt-2 text-center sm:px-8 sm:pb-8">
              <DialogTitle className="text-2xl font-black tracking-tight sm:text-[1.75rem]">
                A gift is waiting for you
              </DialogTitle>
              <DialogDescription className="mx-auto mt-3 max-w-sm text-sm leading-6">
                The Qraft team has added a gift to your wallet. Visit
                Contribution Center to activate it whenever you are ready.
              </DialogDescription>
              <div className="mx-auto mt-5 flex w-fit items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">
                <Gift className="size-4" />
                {rewardPassLabel(gift)}
              </div>
              <button
                type="button"
                className="q-button q-button-primary mt-6 w-full"
                onClick={() => {
                  const id = gift.id;
                  close.current();
                  onViewGift(id);
                }}
              >
                View gift
              </button>
              <button
                type="button"
                className="q-button q-button-secondary mt-2 w-full"
                onClick={() => close.current()}
              >
                Not now
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
