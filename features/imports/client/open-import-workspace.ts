import type { AppUser } from '@/lib/medguard-types';

export function openImportWorkspace(user: Pick<AppUser, 'uid'>, bankId: string, bankName?: string) {
  // This is display/account-binding context, never server-side authorization.
  try { sessionStorage.setItem(`qraft-import-context:${bankId}`, JSON.stringify({ uid: user.uid, bankName: bankName || bankId })); } catch { /* Editing also works without storage. */ }
  window.location.assign(`/qbanks/${encodeURIComponent(bankId)}/import`);
}

export function importWorkspaceContext(bankId: string): { uid: string; bankName: string } {
  try {
    const value = JSON.parse(sessionStorage.getItem(`qraft-import-context:${bankId}`) || 'null');
    if (value && typeof value.uid === 'string' && typeof value.bankName === 'string') return value;
  } catch { /* Direct links can still open a local draft. */ }
  return { uid: '', bankName: bankId };
}
