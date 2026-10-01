'use client';

import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { api } from '@/lib/api-client';
import { subscribeLive } from '@/lib/realtime-client';
import {
  announcementIdentity,
  DEFAULT_ANNOUNCEMENT,
  validAnnouncementLink,
  type SiteAnnouncement,
} from '@/features/announcements/domain/announcement';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export function AnnouncementContent({ value }: { value: SiteAnnouncement }) {
  return (
    <>
      {value.content && (
        <p
          dir="auto"
          className="whitespace-pre-wrap break-words text-sm leading-7"
        >
          {value.content}
        </p>
      )}
      <div className="grid gap-4">
        {value.images.map((image) => (
          <figure key={image.id}>
            {/* oxlint-disable-next-line next/no-img-element */}
            <img
              src={image.url}
              alt={image.caption || image.name || 'Announcement image'}
              className="max-h-[55dvh] w-full rounded-xl object-contain"
            />
            {image.caption && (
              <figcaption
                dir="auto"
                className="mt-2 text-center text-xs text-muted-foreground"
              >
                {image.caption}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
      {value.href && validAnnouncementLink(value.href) && (
        <a
          href={value.href}
          target={value.href.startsWith('https:') ? '_blank' : undefined}
          rel="noopener noreferrer"
          className="q-button q-button-primary"
        >
          Learn more
        </a>
      )}
    </>
  );
}

export function SiteAnnouncement({
  userId = '',
  defer = false,
}: {
  userId?: string;
  defer?: boolean;
}) {
  const [value, setValue] = useState(DEFAULT_ANNOUNCEMENT);
  const [dismissed, setDismissed] = useState('');
  const [presented, setPresented] = useState('');
  const [readyFor, setReadyFor] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let requestNumber = 0;
    const refresh = () => {
      const currentRequest = ++requestNumber;
      void api<SiteAnnouncement>('/platform/announcement', {
        forceRefresh: true,
        cacheScope: userId || 'visitor',
      })
        .then((next) => {
          if (!active || currentRequest !== requestNumber) return;
          let seen = next.dismissed;
          const nextIdentity = announcementIdentity(next);
          try {
            seen ||=
              localStorage.getItem(
                `qraft-announcement:${userId || 'visitor'}`,
              ) === nextIdentity;
            if (
              userId &&
              next.enabled &&
              !next.dismissed &&
              next.displayMode === 'once' &&
              localStorage.getItem(`qraft-announcement:${userId}`) ===
                announcementIdentity(next)
            ) {
              void api('/platform/announcement-dismiss', {
                method: 'POST',
                body: JSON.stringify({ revision: next.revision }),
                expectedUserId: userId,
              }).catch(() => undefined);
            }
          } catch {
            /* Use server acknowledgement when browser storage is unavailable. */
          }
          if (!seen)
            setPresented(
              `qraft-announcement:${userId || 'visitor'}:${nextIdentity}`,
            );
          setReadyFor(userId);
          setValue(next);
        })
        .catch(() => undefined);
    };
    refresh();
    const stop = subscribeLive(refresh, ['announcement']);
    const resume = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false;
      stop();
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [userId]);
  const identity = announcementIdentity(value);
  const storageKey = `qraft-announcement:${userId || 'visitor'}`;
  const presentationKey = `${storageKey}:${identity}`;
  let alreadySeen = value.dismissed;
  try {
    if (value.displayMode === 'once' && typeof window !== 'undefined')
      alreadySeen ||= localStorage.getItem(storageKey) === identity;
  } catch {
    /* A blocked storage area must not prevent closing the popup. */
  }
  const open =
    !defer &&
    readyFor === userId &&
    value.enabled &&
    Boolean(value.content || value.images.length) &&
    dismissed !== presentationKey &&
    (!alreadySeen || presented === presentationKey);
  useEffect(() => {
    if (!open || alreadySeen) return;
    // Remember the impression while keeping this dialog open until it is closed.
    // A reload or a different device must not show the same announcement again.
    if (value.displayMode === 'once') {
      try {
        localStorage.setItem(storageKey, identity);
      } catch {
        /* The in-memory close still works. */
      }
      if (userId)
        void api('/platform/announcement-dismiss', {
          method: 'POST',
          body: JSON.stringify({ revision: value.revision }),
          expectedUserId: userId,
        }).catch(() => undefined);
    }
  }, [
    open,
    alreadySeen,
    storageKey,
    identity,
    userId,
    value.displayMode,
    value.revision,
  ]);
  const dismiss = () => setDismissed(presentationKey);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent className="gap-5 rounded-2xl p-6 sm:max-w-xl">
        <DialogTitle
          dir="auto"
          className="flex items-center gap-3 pr-10 text-xl font-bold"
        >
          <Megaphone className="size-6 shrink-0 text-primary" />
          {value.title || 'News & updates'}
        </DialogTitle>
        <AnnouncementContent value={value} />
        <button
          type="button"
          className="q-button q-button-secondary"
          onClick={dismiss}
        >
          Close announcement
        </button>
      </DialogContent>
    </Dialog>
  );
}
