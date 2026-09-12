import type { AppSettings } from './medguard-types';

export type LocalTheme = AppSettings['theme'];
const activeThemeKey = 'qraft-theme-active';

function accountThemeKey(uid: string) {
  return `qraft-theme:${uid}`;
}

function validTheme(value: string | null): value is LocalTheme {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function loadLocalTheme(uid: string): LocalTheme | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const value = window.localStorage.getItem(accountThemeKey(uid));
    return validTheme(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveLocalTheme(uid: string, theme: LocalTheme) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(accountThemeKey(uid), theme);
    window.localStorage.setItem(activeThemeKey, theme);
  } catch { /* The in-memory theme still applies for this visit. */ }
}

export function loadActiveLocalTheme(): LocalTheme {
  if (typeof window === 'undefined') return 'system';
  try {
    const value = window.localStorage.getItem(activeThemeKey);
    return validTheme(value) ? value : 'system';
  } catch {
    return 'system';
  }
}
