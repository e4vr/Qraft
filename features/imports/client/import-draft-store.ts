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
const key = (uid: string, bankId: string) => JSON.stringify([uid || 'local', bankId]);

export async function loadImportDraft(uid: string, bankId: string): Promise<ImportDraft | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readonly');
    const request = tx.objectStore('drafts').get(key(uid, bankId));
    request.onsuccess = () => {
      const value = request.result as ImportDraft | undefined;
      resolve(value?.version === 1 && value.bankId === bankId && Array.isArray(value.rows) ? value : undefined);
    };
    tx.oncomplete = () => db.close();
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function saveImportDraft(uid: string, draft: ImportDraft): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    tx.objectStore('drafts').put(draft, key(uid, draft.bankId));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Local storage is unavailable. Download your work before leaving.')); };
  });
}
