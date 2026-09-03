import {
  initialCollaborationState,
  type AppState,
  type AppUser,
  type CollaborationState,
  type MemberProfile,
} from './medguard-types';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseEnabled = Object.values(firebaseConfig).every(Boolean);

let servicesPromise: ReturnType<typeof createServices> | undefined;

async function createServices() {
  if (!firebaseEnabled) throw new Error('Firebase is not configured.');
  const [{ initializeApp, getApps, getApp }, authModule, firestoreModule, storageModule] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
    import('firebase/storage'),
  ]);
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const auth = authModule.getAuth(app);
  let db;
  try {
    db = firestoreModule.initializeFirestore(app, {
      localCache: firestoreModule.persistentLocalCache({ tabManager: firestoreModule.persistentMultipleTabManager() }),
    });
  } catch {
    db = firestoreModule.getFirestore(app);
  }
  const storage = storageModule.getStorage(app);
  return { auth, db, storage, authModule, firestoreModule, storageModule };
}

async function services() {
  servicesPromise ??= createServices();
  return servicesPromise;
}

function baseUser(user: { uid: string; email: string | null; displayName: string | null }): AppUser {
  const email = user.email ?? '';
  const configuredRoot = Boolean(process.env.NEXT_PUBLIC_ADMIN_EMAIL && email.toLowerCase() === process.env.NEXT_PUBLIC_ADMIN_EMAIL.toLowerCase());
  return {
    uid: user.uid,
    email,
    displayName: user.displayName ?? email.split('@')[0] ?? 'Student',
    isAdmin: configuredRoot,
    provider: 'firebase',
    role: configuredRoot ? 'super_admin' : 'student',
    status: configuredRoot ? 'approved' : 'pending',
  };
}

async function mapUser(user: { uid: string; email: string | null; displayName: string | null }): Promise<AppUser> {
  const mapped = baseUser(user);
  const { db, firestoreModule } = await services();
  const profileSnapshot = await firestoreModule.getDoc(firestoreModule.doc(db, 'profiles', user.uid));
  if (!profileSnapshot.exists()) return mapped;
  const profile = profileSnapshot.data() as MemberProfile;
  return {
    ...mapped,
    displayName: profile.displayName || mapped.displayName,
    universityId: profile.universityId,
    role: profile.role,
    status: profile.status,
    createdAt: profile.createdAt,
    isAdmin: profile.role === 'admin' || profile.role === 'super_admin',
  };
}

export async function observeFirebaseUser(callback: (user?: AppUser) => void): Promise<() => void> {
  const { auth, authModule } = await services();
  return authModule.onAuthStateChanged(auth, (user) => {
    if (!user) { callback(undefined); return; }
    void mapUser(user).then(callback).catch(() => callback(baseUser(user)));
  });
}

export async function signInFirebase(email: string, password: string): Promise<AppUser> {
  const { auth, authModule } = await services();
  const result = await authModule.signInWithEmailAndPassword(auth, email, password);
  return mapUser(result.user);
}

export async function createFirebaseAccount(name: string, email: string, password: string, universityId: string): Promise<AppUser> {
  const { auth, authModule } = await services();
  const result = await authModule.createUserWithEmailAndPassword(auth, email, password);
  const normalizedId = universityId.replace(/\s+/g, '').toUpperCase();
  try {
    await authModule.updateProfile(result.user, { displayName: name });
    const { db, firestoreModule } = await services();
    const now = new Date().toISOString();
    await firestoreModule.runTransaction(db, async (transaction) => {
      const allowedRef = firestoreModule.doc(db, 'universityIds', normalizedId);
      const allowed = await transaction.get(allowedRef);
      if (!allowed.exists() || allowed.data().claimedById) throw new Error('This university ID is not eligible or has already been used.');
      const profile: MemberProfile = {
        uid: result.user.uid,
        email: result.user.email ?? email.trim().toLowerCase(),
        displayName: name.trim(),
        universityId: normalizedId,
        role: 'student',
        status: 'pending',
        createdAt: now,
      };
      transaction.update(allowedRef, { claimedById: result.user.uid, claimedByName: name.trim(), claimedAt: now });
      transaction.set(firestoreModule.doc(db, 'profiles', result.user.uid), profile);
    });
    return mapUser({ ...result.user, displayName: name });
  } catch (error) {
    await authModule.deleteUser(result.user).catch(() => undefined);
    throw error;
  }
}

export async function signInFirebaseWithGoogle(): Promise<AppUser> {
  const { auth, authModule } = await services();
  const result = await authModule.signInWithPopup(auth, new authModule.GoogleAuthProvider());
  return mapUser(result.user);
}

export async function signOutFirebase(): Promise<void> {
  const { auth, authModule } = await services();
  await authModule.signOut(auth);
}

export async function loadCloudState(uid: string): Promise<AppState | undefined> {
  const { db, firestoreModule } = await services();
  const snapshot = await firestoreModule.getDoc(firestoreModule.doc(db, 'users', uid, 'data', 'state'));
  return snapshot.exists() ? (snapshot.data().payload as AppState) : undefined;
}

export async function saveCloudState(uid: string, state: AppState): Promise<void> {
  const { db, firestoreModule } = await services();
  await firestoreModule.setDoc(
    firestoreModule.doc(db, 'users', uid, 'data', 'state'),
    { payload: state, updatedAt: firestoreModule.serverTimestamp() },
    { merge: true },
  );
  await firestoreModule.waitForPendingWrites(db);
}

export async function uploadNoteImage(uid: string, file: File, qbankId = 'smle-gs', questionId = 'general'): Promise<string> {
  const { storage, storageModule } = await services();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `qbanks/${qbankId}/notes/${questionId}/${uid}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const reference = storageModule.ref(storage, path);
  await storageModule.uploadBytes(reference, file, { contentType: file.type });
  return storageModule.getDownloadURL(reference);
}

function changed<T>(next: T[], previous: T[], key: (item: T) => string) {
  const old = new Map(previous.map((item) => [key(item), JSON.stringify(item)]));
  return next.filter((item) => old.get(key(item)) !== JSON.stringify(item));
}

export async function loadCollaborationState(user: AppUser): Promise<CollaborationState> {
  const { db, firestoreModule } = await services();
  const state = initialCollaborationState();
  const read = async (name: string) => (await firestoreModule.getDocs(firestoreModule.collection(db, name))).docs.map((item) => ({ id: item.id, ...item.data() }));
  const [qbanks, proposals, questions, notes] = await Promise.all([
    read('qbanks'),
    read('questionProposals'),
    read('sharedQuestions'),
    read('sharedNotes'),
  ]);
  state.qbanks = qbanks.length ? qbanks as CollaborationState['qbanks'] : state.qbanks;
  state.proposals = proposals as CollaborationState['proposals'];
  state.approvedQuestions = questions as CollaborationState['approvedQuestions'];
  state.sharedNotes = Object.fromEntries((notes as CollaborationState['sharedNotes'][string][]).map((note) => [note.id, note]));
  if (user.isAdmin) {
    const [members, ids, invites, audit] = await Promise.all([read('profiles'), read('universityIds'), read('adminInvites'), read('auditLog')]);
    state.members = members as unknown as CollaborationState['members'];
    state.allowedUniversityIds = ids as CollaborationState['allowedUniversityIds'];
    state.adminInvites = invites as CollaborationState['adminInvites'];
    state.auditLog = (audit as CollaborationState['auditLog']).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  state.lastSyncAt = new Date().toISOString();
  return state;
}

export async function saveCollaborationState(next: CollaborationState, previous: CollaborationState): Promise<void> {
  const { db, firestoreModule } = await services();
  const writes: Array<{ collection: string; id: string; value: unknown }> = [];
  const collect = <T>(collection: string, values: T[], old: T[], key: (item: T) => string) => {
    changed(values, old, key).forEach((item) => writes.push({ collection, id: key(item), value: item }));
  };
  collect('qbanks', next.qbanks, previous.qbanks, (item) => item.id);
  collect('profiles', next.members, previous.members, (item) => item.uid);
  collect('universityIds', next.allowedUniversityIds, previous.allowedUniversityIds, (item) => item.id);
  collect('adminInvites', next.adminInvites, previous.adminInvites, (item) => item.id);
  collect('questionProposals', next.proposals, previous.proposals, (item) => item.id);
  collect('sharedQuestions', next.approvedQuestions, previous.approvedQuestions, (item) => item.id);
  collect('sharedNotes', Object.values(next.sharedNotes), Object.values(previous.sharedNotes), (item) => item.id);
  collect('auditLog', next.auditLog, previous.auditLog, (item) => item.id);
  for (let start = 0; start < writes.length; start += 400) {
    const batch = firestoreModule.writeBatch(db);
    writes.slice(start, start + 400).forEach((write) => batch.set(firestoreModule.doc(db, write.collection, write.id), write.value as Record<string, unknown>, { merge: true }));
    await batch.commit();
  }
}
