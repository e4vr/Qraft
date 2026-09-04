import { normalizeCollaborationState, type AppState, type CollaborationState } from './medguard-types';

const DATABASE = 'medguard-qbank';
const STORE = 'key-value';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readValue<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function writeValue<T>(key: string, value: T): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(value, key);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function loadLocalState(uid: string): Promise<AppState | undefined> {
  return readValue<AppState>(`state:${uid}`);
}

export async function loadLocalCollaboration(): Promise<CollaborationState | undefined> {
  const state = await readValue<CollaborationState>('collaboration:shared');
  return state ? normalizeCollaborationState(state) : undefined;
}

export async function saveLocalCollaboration(state: CollaborationState): Promise<void> {
  await writeValue('collaboration:shared', state);
}

export async function saveLocalState(uid: string, state: AppState): Promise<void> {
  await writeValue(`state:${uid}`, state);
}
