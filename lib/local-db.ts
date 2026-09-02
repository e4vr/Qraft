import type { AppState, AppUser } from './medguard-types';

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

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface LocalAccount extends AppUser { passwordHash: string }

export async function loadSession(): Promise<AppUser | undefined> {
  return readValue<AppUser>('active-session');
}

export async function saveSession(user?: AppUser): Promise<void> {
  await writeValue('active-session', user ?? null);
}

export async function createLocalAccount(name: string, email: string, password: string): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await readValue<LocalAccount>(`account:${normalizedEmail}`);
  if (existing) throw new Error('An account with this email already exists.');
  const accountCount = (await readValue<number>('local-account-count')) ?? 0;
  const user: LocalAccount = {
    uid: `local-${crypto.randomUUID()}`,
    email: normalizedEmail,
    displayName: name.trim() || normalizedEmail.split('@')[0],
    isAdmin: accountCount === 0,
    provider: 'local',
    passwordHash: await sha256(password),
  };
  await writeValue(`account:${normalizedEmail}`, user);
  await writeValue('local-account-count', accountCount + 1);
  const { passwordHash: _, ...safeUser } = user;
  await saveSession(safeUser);
  return safeUser;
}

export async function signInLocal(email: string, password: string): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const account = await readValue<LocalAccount>(`account:${normalizedEmail}`);
  if (!account || account.passwordHash !== (await sha256(password))) {
    throw new Error('Incorrect email or password.');
  }
  const { passwordHash: _, ...safeUser } = account;
  await saveSession(safeUser);
  return safeUser;
}

export async function loadLocalState(uid: string): Promise<AppState | undefined> {
  return readValue<AppState>(`state:${uid}`);
}

export async function saveLocalState(uid: string, state: AppState): Promise<void> {
  await writeValue(`state:${uid}`, state);
}
