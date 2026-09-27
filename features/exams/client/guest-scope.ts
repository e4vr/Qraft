let temporaryScope: string | undefined;

export function preformedGuestScope(): string {
  const key = 'qraft-preformed-guest-session';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return `guest:${existing}`;
    const created = crypto.randomUUID();
    sessionStorage.setItem(key, created);
    return `guest:${created}`;
  } catch {
    return temporaryScope ??= `guest:${crypto.randomUUID()}`;
  }
}
