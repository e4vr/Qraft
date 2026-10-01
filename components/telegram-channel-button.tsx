'use client';

import { validTelegramLink } from '@/features/announcements/domain/announcement';

export function TelegramLogo() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-7 shrink-0"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M21.95 3.08c.29-.21.64-.08.54.4l-3.4 16.03c-.24 1.13-.86 1.4-1.74.87l-5.17-3.81-2.5 2.4c-.28.28-.52.52-1.06.52l.37-5.27 9.59-8.67c.42-.37-.09-.58-.65-.21L6.08 12.81.89 11.19c-1.12-.35-1.14-1.12.24-1.66L21.95 3.08Z" />
    </svg>
  );
}
export function TelegramChannelButton({ href }: { href: string }) {
  if (!href || !validTelegramLink(href)) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-[#229ED9] px-5 py-4 text-center text-sm font-semibold leading-6 text-white shadow-sm transition hover:bg-[#168bc4] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#229ED9] sm:text-base"
    >
      <TelegramLogo />
      <span>Join our Telegram channel for news and updates</span>
    </a>
  );
}
