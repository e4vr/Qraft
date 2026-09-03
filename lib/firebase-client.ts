import {
  initialCollaborationState,
  normalizeCollaborationState,
  normalizeEmail,
  normalizePhone,
  normalizeUniversityId,
  canReviewBank,
  type AppState,
  type AppUser,
  type CollaborationState,
  type MemberProfile,
} from './medguard-types';
import type { MultiFactorResolver, TotpSecret } from 'firebase/auth';

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
    tier: configuredRoot ? 'pro' : 'lite',
    platformRoles: [],
  };
}

async function mapUser(user: { uid: string; email: string | null; displayName: string | null }): Promise<AppUser> {
  const mapped = baseUser(user);
  const { auth, authModule, db, firestoreModule } = await services();
  const profileSnapshot = await firestoreModule.getDoc(firestoreModule.doc(db, 'profiles', user.uid));
  if (!profileSnapshot.exists()) return mapped;
  const profile = profileSnapshot.data() as MemberProfile;
  const enrolledFactors = auth.currentUser ? authModule.multiFactor(auth.currentUser).enrolledFactors : [];
  return {
    ...mapped,
    displayName: profile.displayName || mapped.displayName,
    universityId: profile.universityId,
    phone: profile.phone,
    role: profile.role,
    status: profile.status,
    createdAt: profile.createdAt,
    tier: profile.tier ?? (profile.role === 'super_admin' || profile.role === 'admin' ? 'pro' : 'lite'),
    platformRoles: profile.platformRoles ?? (profile.role === 'reviewer' ? ['reviewer'] : profile.role === 'access_manager' || profile.role === 'admin' ? ['access_manager'] : []),
    suspended: profile.suspended,
    mfaEnrolled: enrolledFactors.length > 0,
    mfaVerified: profile.role !== 'super_admin' || enrolledFactors.length > 0,
    isAdmin: profile.role === 'super_admin' || (profile.platformRoles ?? []).length > 0 || ['admin', 'reviewer', 'access_manager'].includes(profile.role),
  };
}

let pendingMfaResolver: MultiFactorResolver | undefined;
let pendingTotpSecret: TotpSecret | undefined;

export async function observeFirebaseUser(callback: (user?: AppUser) => void): Promise<() => void> {
  const { auth, authModule } = await services();
  return authModule.onAuthStateChanged(auth, (user) => {
    if (!user) { callback(undefined); return; }
    void mapUser(user).then(callback).catch(() => callback(baseUser(user)));
  });
}

export async function signInFirebase(email: string, password: string): Promise<AppUser> {
  const { auth, authModule } = await services();
  try {
    const result = await authModule.signInWithEmailAndPassword(auth, email, password);
    return mapUser(result.user);
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/multi-factor-auth-required') {
      pendingMfaResolver = authModule.getMultiFactorResolver(auth, error as never);
      throw new Error('MFA_REQUIRED');
    }
    throw error;
  }
}

export async function completeFirebaseMfaSignIn(code: string): Promise<AppUser> {
  if (!pendingMfaResolver) throw new Error('Start sign-in again before entering an MFA code.');
  const { authModule } = await services();
  const hint = pendingMfaResolver.hints.find((item) => item.factorId === authModule.TotpMultiFactorGenerator.FACTOR_ID);
  if (!hint) throw new Error('No authenticator-app factor is enrolled for this account.');
  const assertion = authModule.TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.trim());
  const result = await pendingMfaResolver.resolveSignIn(assertion);
  pendingMfaResolver = undefined;
  return mapUser(result.user);
}

export async function beginTotpEnrollment(): Promise<{ secretKey: string; qrUrl: string }> {
  const { auth, authModule } = await services();
  if (!auth.currentUser) throw new Error('Sign in before enabling MFA.');
  if (!auth.currentUser.emailVerified) {
    await authModule.sendEmailVerification(auth.currentUser);
    throw new Error('Verify the email message we sent, then sign in again to enable MFA.');
  }
  const session = await authModule.multiFactor(auth.currentUser).getSession();
  pendingTotpSecret = await authModule.TotpMultiFactorGenerator.generateSecret(session);
  return { secretKey: pendingTotpSecret.secretKey, qrUrl: pendingTotpSecret.generateQrCodeUrl(auth.currentUser.email ?? 'admin', 'Qraft') };
}

export async function completeTotpEnrollment(code: string): Promise<void> {
  const { auth, authModule } = await services();
  if (!auth.currentUser || !pendingTotpSecret) throw new Error('Start MFA enrollment again.');
  const assertion = authModule.TotpMultiFactorGenerator.assertionForEnrollment(pendingTotpSecret, code.trim());
  await authModule.multiFactor(auth.currentUser).enroll(assertion, 'Qraft authenticator');
  pendingTotpSecret = undefined;
}

export async function createFirebaseAccount(name: string, email: string, password: string, universityId: string, phone: string): Promise<AppUser> {
  const { auth, authModule } = await services();
  const result = await authModule.createUserWithEmailAndPassword(auth, email, password);
  const normalizedEmail = normalizeEmail(email);
  const normalizedId = normalizeUniversityId(universityId);
  const normalizedPhone = normalizePhone(phone);
  try {
    await authModule.updateProfile(result.user, { displayName: name });
    const { db, firestoreModule } = await services();
    const now = new Date().toISOString();
    await firestoreModule.runTransaction(db, async (transaction) => {
      const allowedRef = firestoreModule.doc(db, 'universityIds', normalizedId);
      const blocklistRef = firestoreModule.doc(db, 'system', 'accessControl');
      const allowed = await transaction.get(allowedRef);
      const blocklist = await transaction.get(blocklistRef);
      if (!allowed.exists() || allowed.data().claimedById) throw new Error('This university ID is not eligible or has already been used.');
      if (blocklist.exists()) {
        const blocked = blocklist.data() as { emails?: string[]; phones?: string[]; universityIds?: string[] };
        if ((blocked.emails ?? []).includes(normalizedEmail) || (blocked.phones ?? []).includes(normalizedPhone) || (blocked.universityIds ?? []).includes(normalizedId)) throw new Error('This email, university ID, or mobile number is blocked.');
      }
      const profile: MemberProfile = {
        uid: result.user.uid,
        email: result.user.email ?? normalizedEmail,
        displayName: name.trim(),
        universityId: normalizedId,
        phone: normalizedPhone,
        role: 'student',
        status: 'pending',
        createdAt: now,
        tier: 'lite',
        platformRoles: [],
      };
      transaction.update(allowedRef, { claimedById: result.user.uid, claimedByName: name.trim(), claimedAt: now });
      transaction.set(firestoreModule.doc(db, 'profiles', result.user.uid), profile);
    });
    await authModule.sendEmailVerification(result.user).catch(() => undefined);
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

export async function uploadQuestionImage(uid: string, file: File, qbankId: string, questionId: string): Promise<string> {
  const { storage, storageModule } = await services();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `qbanks/${qbankId}/questions/${questionId}/${uid}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const reference = storageModule.ref(storage, path);
  await storageModule.uploadBytes(reference, file, { contentType: file.type });
  return storageModule.getDownloadURL(reference);
}

export async function deleteQBankImages(qbankId: string): Promise<void> {
  if (!firebaseEnabled) return;
  const { storage, storageModule } = await services();
  const removeFolder = async (path: string): Promise<void> => {
    const result = await storageModule.listAll(storageModule.ref(storage, path));
    await Promise.all(result.items.map((item) => storageModule.deleteObject(item)));
    await Promise.all(result.prefixes.map((prefix) => removeFolder(prefix.fullPath)));
  };
  await removeFolder(`qbanks/${qbankId}`);
}

export async function reserveQuestionIds(count: number, qbankId: string, user: AppUser, knownQuestionIds: string[]): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error('You can add between 1 and 200 questions at a time.');
  const highestKnown = knownQuestionIds.reduce((highest, value) => /^\d{5}$/.test(value) ? Math.max(highest, Number(value)) : highest, 217);
  if (!firebaseEnabled) {
    const end = highestKnown + count;
    if (end > 99999) throw new Error('The platform has reached the Question ID limit.');
    return Array.from({ length: count }, (_, index) => String(highestKnown + index + 1).padStart(5, '0'));
  }
  const { db, firestoreModule } = await services();
  return firestoreModule.runTransaction(db, async (transaction) => {
    const counterRef = firestoreModule.doc(db, 'system', 'questionCounter');
    const counterSnapshot = await transaction.get(counterRef);
    const storedNext = counterSnapshot.exists() ? Number(counterSnapshot.data().nextNumber) : 218;
    const start = Math.max(highestKnown + 1, Number.isInteger(storedNext) ? storedNext : 218, 218);
    const end = start + count - 1;
    if (end > 99999) throw new Error('The platform has reached the Question ID limit.');
    const createdAt = new Date().toISOString();
    transaction.set(counterRef, { nextNumber: end + 1, lastQBankId: qbankId, lastActorId: user.uid, updatedAt: createdAt }, { merge: true });
    const ids = Array.from({ length: count }, (_, index) => String(start + index).padStart(5, '0'));
    ids.forEach((questionId) => transaction.set(firestoreModule.doc(db, 'questionIds', questionId), { questionId, qbankId, createdById: user.uid, createdAt }));
    return ids;
  });
}

export async function joinFirebaseQBankByLink(user: AppUser, qbankId: string, token: string): Promise<void> {
  const { db, firestoreModule } = await services();
  const link = await firestoreModule.getDoc(firestoreModule.doc(db, 'qbankShareLinks', token));
  if (!link.exists() || link.data().enabled !== true || link.data().qbankId !== qbankId) throw new Error('This QBank link is invalid or no longer active.');
  const createdAt = new Date().toISOString();
  await firestoreModule.setDoc(firestoreModule.doc(db, 'qbankMemberships', `${qbankId}_${user.uid}`), { id: `${qbankId}_${user.uid}`, qbankId, userId: user.uid, userName: user.displayName, role: 'viewer', grantedById: link.data().ownerId, grantedByName: link.data().ownerName, createdAt, viaLink: true, accessToken: token });
}

function changed<T>(next: T[], previous: T[], key: (item: T) => string) {
  const old = new Map(previous.map((item) => [key(item), JSON.stringify(item)]));
  return next.filter((item) => old.get(key(item)) !== JSON.stringify(item));
}

export async function loadCollaborationState(user: AppUser): Promise<CollaborationState> {
  const { db, firestoreModule } = await services();
  const state = initialCollaborationState();
  const read = async (name: string, constraints: ReturnType<typeof firestoreModule.where>[] = []) => {
    const target = constraints.length ? firestoreModule.query(firestoreModule.collection(db, name), ...constraints) : firestoreModule.collection(db, name);
    return (await firestoreModule.getDocs(target)).docs.map((item) => ({ id: item.id, ...item.data() }));
  };
  const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()];
  const isRoot = user.role === 'super_admin';
  const canManageAccess = isRoot || user.platformRoles.includes('access_manager');
  let membershipRows = isRoot ? await read('qbankMemberships') : await read('qbankMemberships', [firestoreModule.where('userId', '==', user.uid)]);
  state.memberships = membershipRows as CollaborationState['memberships'];
  const ownedInvites = user.tier === 'pro' || isRoot ? await read('qbankInvitations', [firestoreModule.where('invitedById', '==', user.uid)]) : [];
  const receivedInvites = user.email ? await read('qbankInvitations', [firestoreModule.where('email', '==', user.email.toLowerCase())]) : [];
  state.invitations = unique([...ownedInvites, ...receivedInvites]) as CollaborationState['invitations'];
  let qbankRows = isRoot ? await read('qbanks') : unique([
    ...await read('qbanks', [firestoreModule.where('visibility', '==', 'public')]),
    ...await read('qbanks', [firestoreModule.where('ownerId', '==', user.uid)]),
  ]);
  if (!isRoot) {
    const missingIds = unique(state.memberships.map((item) => ({ id: item.qbankId }))).filter((item) => !qbankRows.some((bank) => bank.id === item.id));
    const missing = await Promise.all(missingIds.map(async ({ id }) => {
      const snapshot = await firestoreModule.getDoc(firestoreModule.doc(db, 'qbanks', id));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : undefined;
    }));
    qbankRows = unique([...qbankRows, ...missing.filter(Boolean) as { id: string }[]]);
  }
  state.qbanks = qbankRows.length ? qbankRows as CollaborationState['qbanks'] : state.qbanks;
  if (!isRoot) {
    const ownedMemberships: { id: string }[] = [];
    for (const bankItem of state.qbanks.filter((item) => item.ownerId === user.uid)) {
      ownedMemberships.push(...await read('qbankMemberships', [firestoreModule.where('qbankId', '==', bankItem.id)]));
    }
    membershipRows = unique([...membershipRows, ...ownedMemberships]);
    state.memberships = membershipRows as CollaborationState['memberships'];
  }
  const normalized = normalizeCollaborationState(state);
  const questionRows: { id: string }[] = [];
  const noteRows: { id: string }[] = [];
  const statRows: { id: string }[] = [];
  for (const bankItem of normalized.qbanks) {
    questionRows.push(...await read('sharedQuestions', [firestoreModule.where('qbankId', '==', bankItem.id)]));
    noteRows.push(...await read('sharedNotes', [firestoreModule.where('qbankId', '==', bankItem.id)]));
    statRows.push(...await read('answerStats', [firestoreModule.where('qbankId', '==', bankItem.id)]));
  }
  const ownProposals = await read('questionProposals', [firestoreModule.where('proposedById', '==', user.uid)]);
  const reviewRows: { id: string }[] = [];
  for (const bankItem of normalized.qbanks.filter((item) => canReviewBank(user, item, normalized.memberships))) {
    reviewRows.push(...await read('questionProposals', [firestoreModule.where('qbankId', '==', bankItem.id)]));
  }
  state.proposals = unique([...ownProposals, ...reviewRows]) as CollaborationState['proposals'];
  state.approvedQuestions = questionRows as CollaborationState['approvedQuestions'];
  state.answerStats = Object.fromEntries((statRows as CollaborationState['answerStats'][string][]).map((item) => [item.id, item]));
  state.sharedNotes = Object.fromEntries((noteRows as CollaborationState['sharedNotes'][string][]).map((note) => [note.id, note]));
  state.roleApplications = (isRoot ? await read('roleApplications') : await read('roleApplications', [firestoreModule.where('userId', '==', user.uid)])) as CollaborationState['roleApplications'];
  if (canManageAccess) {
    const members = await read('profiles');
    state.members = members as unknown as CollaborationState['members'];
    const blocklistSnapshot = await firestoreModule.getDoc(firestoreModule.doc(db, 'system', 'accessControl'));
    if (blocklistSnapshot.exists()) {
      const blocklist = blocklistSnapshot.data() as Partial<CollaborationState['blockedAccess']>;
      state.blockedAccess = {
        phones: blocklist.phones ?? [],
        universityIds: blocklist.universityIds ?? [],
        emails: blocklist.emails ?? [],
      };
    }
  }
  if (isRoot) {
    const [ids, invites, audit] = await Promise.all([read('universityIds'), read('adminInvites'), read('auditLog')]);
    state.allowedUniversityIds = ids as CollaborationState['allowedUniversityIds'];
    state.adminInvites = invites as CollaborationState['adminInvites'];
    state.auditLog = (audit as CollaborationState['auditLog']).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const securitySnapshot = await firestoreModule.getDoc(firestoreModule.doc(db, 'system', 'security'));
  if (securitySnapshot.exists()) state.security = securitySnapshot.data() as CollaborationState['security'];
  state.lastSyncAt = new Date().toISOString();
  return normalizeCollaborationState(state);
}

export async function saveCollaborationState(next: CollaborationState, previous: CollaborationState): Promise<void> {
  const { db, firestoreModule } = await services();
  const writes: Array<{ collection: string; id: string; value: unknown }> = [];
  const deletes: Array<{ collection: string; id: string }> = [];
  const collect = <T>(collection: string, values: T[], old: T[], key: (item: T) => string, deleteMissing = false) => {
    changed(values, old, key).forEach((item) => writes.push({ collection, id: key(item), value: item }));
    if (deleteMissing) {
      const currentKeys = new Set(values.map(key));
      old.filter((item) => !currentKeys.has(key(item))).forEach((item) => deletes.push({ collection, id: key(item) }));
    }
  };
  collect('qbanks', next.qbanks, previous.qbanks, (item) => item.id, true);
  changed(next.qbanks, previous.qbanks, (item) => item.id).forEach((bank) => {
    if (bank.shareToken) writes.push({ collection: 'qbankShareLinks', id: bank.shareToken, value: { id: bank.shareToken, qbankId: bank.id, ownerId: bank.ownerId, ownerName: bank.ownerName, enabled: bank.shareEnabled, updatedAt: new Date().toISOString() } });
  });
  previous.qbanks.forEach((oldBank) => {
    const nextBank = next.qbanks.find((item) => item.id === oldBank.id);
    if (oldBank.shareToken && oldBank.shareToken !== nextBank?.shareToken) deletes.push({ collection: 'qbankShareLinks', id: oldBank.shareToken });
  });
  collect('qbankMemberships', next.memberships, previous.memberships, (item) => item.id, true);
  collect('qbankInvitations', next.invitations, previous.invitations, (item) => item.id, true);
  collect('profiles', next.members, previous.members, (item) => item.uid);
  collect('universityIds', next.allowedUniversityIds, previous.allowedUniversityIds, (item) => item.id);
  if (JSON.stringify(next.blockedAccess) !== JSON.stringify(previous.blockedAccess)) writes.push({ collection: 'system', id: 'accessControl', value: { id: 'accessControl', ...next.blockedAccess, updatedAt: new Date().toISOString() } });
  collect('adminInvites', next.adminInvites, previous.adminInvites, (item) => item.id);
  collect('questionProposals', next.proposals, previous.proposals, (item) => item.id, true);
  collect('roleApplications', next.roleApplications, previous.roleApplications, (item) => item.id);
  collect('sharedQuestions', next.approvedQuestions, previous.approvedQuestions, (item) => item.id, true);
  collect('answerStats', Object.values(next.answerStats), Object.values(previous.answerStats), (item) => item.id, true);
  collect('sharedNotes', Object.values(next.sharedNotes), Object.values(previous.sharedNotes), (item) => item.id, true);
  collect('auditLog', next.auditLog, previous.auditLog, (item) => item.id);
  const operations = [...deletes.map((item) => ({ ...item, type: 'delete' as const })), ...writes.map((item) => ({ ...item, type: 'set' as const }))];
  for (let start = 0; start < operations.length; start += 400) {
    const batch = firestoreModule.writeBatch(db);
    operations.slice(start, start + 400).forEach((operation) => {
      const reference = firestoreModule.doc(db, operation.collection, operation.id);
      if (operation.type === 'delete') batch.delete(reference);
      else batch.set(reference, operation.value as Record<string, unknown>, { merge: true });
    });
    await batch.commit();
  }
}
