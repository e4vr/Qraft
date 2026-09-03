import { initialCollaborationState, normalizeCollaborationState, type AppState, type AppUser, type CollaborationState } from './medguard-types';

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

function normalizeUser(user: AppUser): AppUser {
  const role = user.role ?? (user.isAdmin ? 'super_admin' : 'student');
  const platformRoles: AppUser['platformRoles'] = user.platformRoles ?? (role === 'reviewer' ? ['reviewer'] : role === 'access_manager' || role === 'admin' ? ['access_manager'] : []);
  return { ...user, role, status: user.status ?? 'approved', tier: user.tier ?? (role === 'super_admin' || role === 'admin' || role === 'access_manager' ? 'pro' : 'lite'), platformRoles, isAdmin: role === 'super_admin' || platformRoles.length > 0 };
}

export async function loadSession(): Promise<AppUser | undefined> {
  const user = await readValue<AppUser>('active-session');
  return user ? normalizeUser(user) : undefined;
}

export async function saveSession(user?: AppUser): Promise<void> {
  await writeValue('active-session', user ?? null);
}

export async function createLocalAccount(name: string, email: string, password: string, universityId: string): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedUniversityId = universityId.replace(/\s+/g, '').toUpperCase();
  const existing = await readValue<LocalAccount>(`account:${normalizedEmail}`);
  if (existing) throw new Error('An account with this email already exists.');
  const accountCount = (await readValue<number>('local-account-count')) ?? 0;
  const shared = (await loadLocalCollaboration()) ?? initialCollaborationState();
  const allowed = shared.allowedUniversityIds.find((item) => item.id === normalizedUniversityId);
  if (!allowed || allowed.claimedById) throw new Error('This university ID is not eligible or has already been used.');
  const now = new Date().toISOString();
  const user: LocalAccount = {
    uid: `local-${crypto.randomUUID()}`,
    email: normalizedEmail,
    displayName: name.trim() || normalizedEmail.split('@')[0],
    isAdmin: false,
    provider: 'local',
    role: 'student',
    status: 'pending',
    universityId: normalizedUniversityId,
    createdAt: now,
    tier: 'lite',
    platformRoles: [],
    passwordHash: await sha256(password),
  };
  await writeValue(`account:${normalizedEmail}`, user);
  await writeValue('local-account-count', accountCount + 1);
  const profile = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    universityId: normalizedUniversityId,
    role: user.role,
    status: user.status,
    createdAt: now,
    tier: user.tier,
    platformRoles: user.platformRoles,
  };
  await saveLocalCollaboration({
    ...shared,
    members: [...shared.members, profile],
    allowedUniversityIds: shared.allowedUniversityIds.map((item) => item.id === normalizedUniversityId ? { ...item, claimedById: user.uid, claimedByName: user.displayName, claimedAt: now } : item),
  });
  const { passwordHash: _, ...safeUser } = user;
  await saveSession(safeUser);
  return normalizeUser(safeUser);
}

export async function signInLocal(email: string, password: string): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const account = await readValue<LocalAccount>(`account:${normalizedEmail}`);
  if (!account || account.passwordHash !== (await sha256(password))) {
    throw new Error('Incorrect email or password.');
  }
  const { passwordHash: _, ...safeUser } = account;
  const shared = await loadLocalCollaboration();
  const member = shared?.members.find((item) => item.uid === safeUser.uid);
  const current = member ? { ...safeUser, role: member.role, status: member.status, universityId: member.universityId, tier: member.tier, platformRoles: member.platformRoles, suspended: member.suspended, mfaEnrolled: member.mfaEnrolled, isAdmin: member.role === 'super_admin' || member.platformRoles.length > 0 } : safeUser;
  await saveSession(current);
  return normalizeUser(current);
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
