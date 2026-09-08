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
    const store = transaction.objectStore(STORE);
    const uid = key.slice(key.indexOf(':') + 1);
    const marker = store.get(`deleted:${uid}`);
    marker.onsuccess = () => { if (!marker.result) store.put(value, key); };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function loadLocalState(uid: string): Promise<AppState | undefined> {
  return readValue<AppState>(`state:${uid}`);
}

export async function loadLocalCollaboration(uid: string): Promise<CollaborationState | undefined> {
  const state = await readValue<CollaborationState>(`collaboration:${uid}`);
  return state ? normalizeCollaborationState(state) : undefined;
}

export async function saveLocalCollaboration(state: CollaborationState, uid: string): Promise<void> {
  await writeValue(`collaboration:${uid}`, state);
}

export async function saveLocalState(uid: string, state: AppState): Promise<void> {
  await writeValue(`state:${uid}`, state);
}

export async function forgetLocalUser(uid: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    store.put(true, `deleted:${uid}`);
    store.delete(`state:${uid}`);
    store.delete(`collaboration:${uid}`);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}
