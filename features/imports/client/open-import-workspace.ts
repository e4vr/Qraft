import type { AppUser, CollaborationState } from '@/lib/medguard-types';
import { importBankClassifications, mergeImportClassifications, type ImportClassificationCatalog } from '../domain/import-classifications';

export interface ImportWorkspaceContext { uid: string; bankName: string; classifications?: ImportClassificationCatalog }

export function openImportWorkspace(user: Pick<AppUser, 'uid'>, bankId: string, bankName?: string, structure?: Pick<CollaborationState, 'specialties' | 'topics'>) {
  try { localStorage.setItem('qraft-current-account', user.uid); } catch { /* Display binding only. */ }
  // This is display/account-binding context, never server-side authorization.
  try { sessionStorage.setItem(`qraft-import-context:${bankId}`, JSON.stringify({ uid: user.uid, bankName: bankName || bankId, ...(structure ? { classifications: importBankClassifications(bankId, structure.specialties, structure.topics) } : {}) })); } catch { /* Editing also works without storage. */ }
  window.location.assign(`/qbanks/${encodeURIComponent(bankId)}/import`);
}

export function bindImportWorkspace(bankId: string, uid: string, bankName: string, classifications?: ImportClassificationCatalog) {
  const previous = importWorkspaceContext(bankId);
  const catalog = classifications ?? (previous.uid === uid ? previous.classifications : undefined);
  try { sessionStorage.setItem(`qraft-import-context:${bankId}`, JSON.stringify({ uid, bankName, ...(catalog ? { classifications: catalog } : {}) })); } catch { /* The in-memory account guard remains authoritative for this page. */ }
}

export function importWorkspaceContext(bankId: string): ImportWorkspaceContext {
  try {
    const value = JSON.parse(sessionStorage.getItem(`qraft-import-context:${bankId}`) || 'null');
    const current = localStorage.getItem('qraft-current-account');
    if (value && typeof value.uid === 'string' && typeof value.bankName === 'string' && (current === null || current === value.uid)) return { uid: value.uid, bankName: value.bankName, ...(value.classifications ? { classifications: mergeImportClassifications(value.classifications) } : {}) };
    if (current) return { uid: current, bankName: bankId };
  } catch { /* Direct links can still open a local draft. */ }
  return { uid: '', bankName: bankId };
}

export function unboundImportScope(bankId: string): string {
  const key = `qraft-import-unbound:${bankId}`;
  try { const existing = sessionStorage.getItem(key); if (existing && /^unbound:[a-f0-9-]{36}$/.test(existing)) return existing;
    const id = `unbound:${crypto.randomUUID()}`; sessionStorage.setItem(key, id); return id;
  } catch { return `unbound:${crypto.randomUUID()}`; }
}
