import type { AppState, AppUser } from './medguard-types';

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

function mapUser(user: { uid: string; email: string | null; displayName: string | null }): AppUser {
  const email = user.email ?? '';
  return {
    uid: user.uid,
    email,
    displayName: user.displayName ?? email.split('@')[0] ?? 'Student',
    isAdmin: Boolean(process.env.NEXT_PUBLIC_ADMIN_EMAIL && email.toLowerCase() === process.env.NEXT_PUBLIC_ADMIN_EMAIL.toLowerCase()),
    provider: 'firebase',
  };
}

export async function observeFirebaseUser(callback: (user?: AppUser) => void): Promise<() => void> {
  const { auth, authModule } = await services();
  return authModule.onAuthStateChanged(auth, (user) => callback(user ? mapUser(user) : undefined));
}

export async function signInFirebase(email: string, password: string): Promise<AppUser> {
  const { auth, authModule } = await services();
  const result = await authModule.signInWithEmailAndPassword(auth, email, password);
  return mapUser(result.user);
}

export async function createFirebaseAccount(name: string, email: string, password: string): Promise<AppUser> {
  const { auth, authModule } = await services();
  const result = await authModule.createUserWithEmailAndPassword(auth, email, password);
  await authModule.updateProfile(result.user, { displayName: name });
  return mapUser({ ...result.user, displayName: name });
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

export async function uploadNoteImage(uid: string, file: File): Promise<string> {
  const { storage, storageModule } = await services();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `users/${uid}/notes/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const reference = storageModule.ref(storage, path);
  await storageModule.uploadBytes(reference, file, { contentType: file.type });
  return storageModule.getDownloadURL(reference);
}
