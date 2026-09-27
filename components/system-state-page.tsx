'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { QraftBrand } from '@/components/brand/qraft-brand';
import {
  ArrowLeft,
  Home,
  RefreshCw,
  SearchX,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';

type StateKind = 'not-found' | 'error' | 'offline';

const content = {
  'not-found': {
    code: '404',
    eyebrow: 'Page not found',
    title: 'This page wandered off.',
    description:
      'The address may have changed, or the page may no longer exist.',
    icon: SearchX,
    tone: 'text-violet-700 bg-violet-500/10 dark:text-violet-300',
  },
  error: {
    code: 'Oops',
    eyebrow: 'Something went wrong',
    title: 'Qraft hit an unexpected problem.',
    description:
      'Your saved work is safe. Try again, or return to the workspace.',
    icon: TriangleAlert,
    tone: 'text-amber-700 bg-amber-500/10 dark:text-amber-300',
  },
  offline: {
    code: 'Offline',
    eyebrow: 'Connection unavailable',
    title: 'We can’t reach Qraft right now.',
    description:
      'Check your internet connection, then try again. Saved work on this device remains safe.',
    icon: WifiOff,
    tone: 'text-sky-700 bg-sky-500/10 dark:text-sky-300',
  },
} satisfies Record<
  StateKind,
  {
    code: string;
    eyebrow: string;
    title: string;
    description: string;
    icon: typeof SearchX;
    tone: string;
  }
>;

export function SystemStatePage({
  kind,
  onRetry,
  onContinue,
}: {
  kind: StateKind;
  onRetry?: () => void;
  onContinue?: () => void;
}) {
  const item = content[kind];
  const Icon = item.icon;
  const [checking, setChecking] = useState(false);
  const [stillOffline, setStillOffline] = useState(false);
  useEffect(() => {
    if (kind !== 'offline') return;
    const reconnect = () => {
      setStillOffline(false);
      setChecking(false);
      onRetry?.();
    };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [kind, onRetry]);
  function retry() {
    if (kind === 'offline' && !navigator.onLine) {
      setChecking(true);
      setStillOffline(true);
      window.setTimeout(() => setChecking(false), 700);
      return;
    }
    onRetry?.();
  }
  return (
    <main className="relative grid min-h-screen overflow-hidden bg-background p-5 text-foreground sm:p-8">
      <div className="pointer-events-none absolute -left-28 -top-28 size-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-36 -right-24 size-[28rem] rounded-full bg-violet-500/10 blur-3xl" />
      <section className="relative m-auto w-full max-w-2xl overflow-hidden rounded-[32px] border bg-card/90 shadow-[0_30px_100px_rgba(15,35,58,.16)] backdrop-blur-xl">
        <div className="border-b bg-gradient-to-br from-primary/10 via-card to-violet-500/5 p-7 sm:p-10">
          <div className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-2 text-sm font-black tracking-tight text-primary">
              <span className="q-brand-badge grid size-10 place-items-center rounded-xl bg-[#f3fafa] p-1.5 shadow-sm ring-1 ring-border/70">
                <QraftBrand variant="mark" className="size-full" />
              </span>
              Qraft
            </span>
            <span className="text-4xl font-black tracking-tighter text-muted-foreground/20 sm:text-6xl">
              {item.code}
            </span>
          </div>
          <span
            className={`mt-10 grid size-16 place-items-center rounded-2xl ${item.tone}`}
          >
            <Icon className="size-8" />
          </span>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-primary">
            {item.eyebrow}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            {item.title}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
            {item.description}
          </p>
        </div>
        <div className="flex flex-col gap-3 p-7 sm:flex-row sm:p-10">
          {kind === 'not-found' ? (
            <>
              <Link
                href="/"
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-bold text-primary-foreground"
              >
                <Home className="size-4" />
                Return home
              </Link>
              <button
                onClick={() => history.back()}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border bg-card px-5 font-bold"
              >
                <ArrowLeft className="size-4" />
                Go back
              </button>
            </>
          ) : (
            <>
              <button
                onClick={retry}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-bold text-primary-foreground"
              >
                <RefreshCw
                  className={`size-4 ${checking ? 'animate-spin' : ''}`}
                />
                Try again
              </button>
              {onContinue ? (
                <button
                  onClick={onContinue}
                  className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border bg-card px-5 font-bold"
                >
                  Continue with saved data
                </button>
              ) : (
                <Link
                  href="/"
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border bg-card px-5 font-bold"
                >
                  <Home className="size-4" />
                  Return home
                </Link>
              )}
            </>
          )}
        </div>
        {stillOffline && (
          <output className="mx-7 mb-7 block rounded-xl bg-sky-500/10 p-3 text-center text-sm text-sky-700 dark:text-sky-300 sm:mx-10 sm:mb-10">
            Still offline. Check Wi-Fi or mobile data and try again.
          </output>
        )}
      </section>
    </main>
  );
}
