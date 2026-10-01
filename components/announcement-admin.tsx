'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, Megaphone, Save } from 'lucide-react';
import { api, setApiCache } from '@/lib/api-client';
import {
  DEFAULT_ANNOUNCEMENT,
  DEFAULT_COMMUNITY_LINKS,
  type SiteAnnouncement,
} from '@/features/announcements/domain/announcement';
import { ExplanationImageEditor } from '@/components/explanation-image-editor';
import { AnnouncementContent } from '@/components/site-announcement';
import { TelegramChannelButton } from '@/components/telegram-channel-button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export function AnnouncementAdmin({ uid }: { uid: string }) {
  const [value, setValue] = useState(DEFAULT_ANNOUNCEMENT);
  const [links, setLinks] = useState(DEFAULT_COMMUNITY_LINKS);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<SiteAnnouncement>('/platform/announcement?manage=1'),
      api<typeof links>('/platform/community-links'),
    ])
      .then(([announcement, community]) => {
        if (active) {
          setValue({ ...DEFAULT_ANNOUNCEMENT, ...announcement });
          setLinks(community);
          setReady(true);
          setMessage('');
        }
      })
      .catch((error) => {
        if (active)
          setMessage(
            error instanceof Error ? error.message : 'Unable to load settings.',
          );
      });
    return () => {
      active = false;
    };
  }, [retry]);
  const upload = useCallback(async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return (
      await api<{ url: string }>('/media/announcements', {
        method: 'POST',
        body,
      })
    ).url;
  }, []);
  const save = async () => {
    if (!ready || busy || uploading) return;
    setBusy(true);
    setMessage('');
    try {
      const saved = await api<SiteAnnouncement>('/platform/announcement', {
        method: 'PUT',
        body: JSON.stringify(value),
      });
      setValue(saved);
      setApiCache('/platform/announcement?manage=1', saved);
      setMessage(
        saved.enabled
          ? 'Announcement published.'
          : 'Announcement disabled. Your content is preserved.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to save announcement.',
      );
    } finally {
      setBusy(false);
    }
  };
  const saveChannel = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const saved = await api<typeof links>('/platform/community-links', {
        method: 'PUT',
        body: JSON.stringify(links),
      });
      setLinks(saved);
      setApiCache('/platform/community-links', saved);
      setMessage('Telegram channel link saved.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to save channel link.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5">
      <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
        <h2 className="flex items-center gap-3 font-bold">
          <Megaphone className="size-5 text-primary" />
          Site announcement popup
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Show news when people enter the site. Signed-in users see each new
          announcement once. They can close it at any time.
        </p>
        <fieldset
          disabled={!ready || busy || uploading}
          className="mt-5 grid gap-4 disabled:opacity-60"
        >
          <label className="grid gap-2 text-sm font-semibold">
            Title
            <input
              dir="auto"
              maxLength={120}
              value={value.title}
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              className="h-11 rounded-xl border bg-background px-3 font-normal"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Announcement content
            <textarea
              dir="auto"
              maxLength={5000}
              value={value.content}
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  content: event.target.value,
                }))
              }
              placeholder="Write your announcement…"
              className="min-h-40 rounded-xl border bg-background p-3 font-normal"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Optional action link
            <input
              value={value.href}
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  href: event.target.value,
                }))
              }
              placeholder="https://… or /internal-page"
              className="h-11 rounded-xl border bg-background px-3 font-normal"
            />
          </label>
          <label className="flex min-h-12 items-center gap-3 rounded-xl border p-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  enabled: event.target.checked,
                }))
              }
              className="size-4 accent-primary"
            />
            Enable announcement popup
          </label>
        </fieldset>
        <ExplanationImageEditor
          uid={uid}
          qbankId="system-announcement"
          questionId="general"
          label="Announcement images"
          images={value.images}
          onChange={(images) => setValue((current) => ({ ...current, images }))}
          onBusyChange={setUploading}
          disabled={!ready || busy}
          maximum={5}
          upload={upload}
        />
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!ready || busy || uploading}
            onClick={() => void save()}
            className="q-button q-button-primary"
          >
            <Save className="size-4" />
            {busy ? 'Saving…' : 'Save announcement'}
          </button>
          <button
            type="button"
            disabled={!ready || uploading}
            onClick={() => setPreview(true)}
            className="q-button q-button-secondary"
          >
            <Eye className="size-4" />
            Preview popup
          </button>
        </div>
      </section>
      <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
        <h2 className="font-bold">Telegram channel</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This link appears at the top of Settings. Leave it empty to hide the
          button.
        </p>
        <label className="mt-4 grid gap-2 text-sm font-semibold">
          Channel URL
          <input
            type="url"
            disabled={!ready || busy}
            value={links.telegramUrl}
            onChange={(event) => setLinks({ telegramUrl: event.target.value })}
            placeholder="https://t.me/QraftQBanks"
            className="h-11 rounded-xl border bg-background px-3 font-normal"
          />
        </label>
        <div className="mt-4">
          <TelegramChannelButton href={links.telegramUrl} />
        </div>
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => void saveChannel()}
          className="q-button q-button-primary mt-4"
        >
          <Save className="size-4" />
          Save channel link
        </button>
      </section>
      {message && (
        <output className="rounded-xl border bg-card p-4 text-sm">
          {message}
          {!ready && (
            <button
              type="button"
              className="ml-3 underline"
              onClick={() => setRetry((current) => current + 1)}
            >
              Try again
            </button>
          )}
        </output>
      )}
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="rounded-2xl p-6 sm:max-w-xl">
          <DialogTitle dir="auto" className="pr-10 text-xl font-bold">
            {value.title || 'News & updates'}
          </DialogTitle>
          <AnnouncementContent value={value} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
