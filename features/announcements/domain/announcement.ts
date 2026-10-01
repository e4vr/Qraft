import type { NoteImage } from '@/lib/medguard-types';

export type SiteAnnouncement = {
  enabled: boolean;
  title: string;
  content: string;
  href: string;
  images: NoteImage[];
  displayMode: 'once' | 'visit';
  revision: string;
  dismissed?: boolean;
};
export const DEFAULT_ANNOUNCEMENT: SiteAnnouncement = {
  enabled: false,
  title: '',
  content: '',
  href: '',
  images: [],
  displayMode: 'once',
  revision: '',
};
export const DEFAULT_COMMUNITY_LINKS = {
  telegramUrl: 'https://t.me/QraftQBanks',
};

export function announcementIdentity(value: SiteAnnouncement): string {
  return (
    value.revision ||
    JSON.stringify([
      value.title,
      value.content,
      value.href,
      value.images,
      value.displayMode,
    ])
  );
}
export function validAnnouncementLink(value: string): boolean {
  if (!value) return true;
  if (/[\s\\]/.test(value)) return false;
  if (value.startsWith('/')) return !value.startsWith('//');
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function validTelegramLink(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['t.me', 'telegram.me'].includes(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password &&
      /^\/[A-Za-z0-9_+]+$/.test(url.pathname) &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
