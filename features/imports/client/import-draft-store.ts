import type { ImportDraft } from '../domain/import-workspace';

const DATABASE = 'qraft-local-imports';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other import tabs to enable local saving.'));
  });
}
const key = (uid: string, bankId: string) => {
  if (!uid) throw new Error('A private local workspace identity is required.');
  return JSON.stringify([uid, bankId]);
};
export class ImportDraftConflict extends Error {
  constructor() { super('Another tab saved a newer draft. Download a full backup of your edits before reloading. This tab has not overwritten the newer draft.'); this.name = 'ImportDraftConflict'; }
}

export async function loadImportDraft(uid: string, bankId: string): Promise<ImportDraft | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readonly');
    const request = tx.objectStore('drafts').get(key(uid, bankId));
    request.onsuccess = () => {
      const value = request.result as ImportDraft | undefined;
      resolve(value?.version === 1 && value.bankId === bankId && Array.isArray(value.rows) ? { ...value, storageRevision: value.storageRevision ?? 'legacy' } : undefined);
    };
    tx.oncomplete = () => db.close();
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function saveImportDraft(uid: string, draft: ImportDraft, expectedRevision: string | null = draft.storageRevision ?? null): Promise<string> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts'); const request = store.get(key(uid, draft.bankId));
    const revision = crypto.randomUUID(); let conflict = false;
    request.onsuccess = () => {
      const previous = request.result as ImportDraft | undefined;
      if ((previous ? previous.storageRevision ?? 'legacy' : null) !== expectedRevision) { conflict = true; tx.abort(); return; }
      store.put({ ...draft, storageRevision: revision }, key(uid, draft.bankId));
    };
    tx.oncomplete = () => { db.close(); resolve(revision); };
    tx.onabort = tx.onerror = () => { db.close(); reject(conflict ? new ImportDraftConflict() : tx.error ?? new Error('Local storage is unavailable. Download a full backup before leaving.')); };
  });
}

export async function discardImportDraft(uid: string, bankId: string, expectedRevision: string | null): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
    const request = store.get(key(uid, bankId)); let conflict = false;
    request.onsuccess = () => {
      const previous = request.result as ImportDraft | undefined;
      if ((previous ? previous.storageRevision ?? 'legacy' : null) !== expectedRevision) { conflict = true; tx.abort(); return; }
      store.delete(key(uid, bankId));
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(conflict ? new ImportDraftConflict() : tx.error ?? new Error('Could not discard the local draft. Your work is preserved.')); };
  });
}

export async function bindImportDraftScope(oldScope: string, uid: string, draft: ImportDraft, oldRevision: string | null, targetRevision: string | null): Promise<string> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
    const previous = store.get(key(oldScope, draft.bankId)), target = store.get(key(uid, draft.bankId));
    let ready = 0, conflict = false; const revision = crypto.randomUUID();
    const complete = () => {
      if (++ready !== 2) return;
      const storedRevision = (value: ImportDraft | undefined) => value ? value.storageRevision ?? 'legacy' : null;
      if (storedRevision(previous.result) !== oldRevision || storedRevision(target.result) !== targetRevision) { conflict = true; tx.abort(); return; }
      store.put({ ...draft, accountId: uid, storageRevision: revision }, key(uid, draft.bankId));
      store.delete(key(oldScope, draft.bankId));
    };
    previous.onsuccess = target.onsuccess = complete;
    tx.oncomplete = () => { db.close(); resolve(revision); };
    tx.onabort = tx.onerror = () => { db.close(); reject(conflict ? new ImportDraftConflict() : tx.error ?? new Error('Could not bind the local draft. Your original local copy is preserved.')); };
  });
}
