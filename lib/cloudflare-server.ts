import { auditStatement, expireSubscriptions } from './platform-server';
import { env } from 'cloudflare:workers';
import {
  canAccessBank,
  canManageBank,
  canReviewBank,
  initialCollaborationState,
  normalizeCollaborationState,
  normalizeEmail,
  normalizePhone,
  normalizeUniversityId,
  type AppState,
  type AppUser,
  type CollaborationState,
  type MemberProfile,
  type QBank,
} from './medguard-types';

const SESSION_COOKIE = '__Host-qraft_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 100_000;
const IMAGEKIT_STORAGE_LIMIT_BYTES = 3 * 1024 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type RecordOperation = { type: 'set' | 'delete'; collection: string; id: string; value?: unknown };
type StoredRecord = { type: string; id: string; qbank_id: string | null; owner_id: string | null; email: string | null; payload: string; updated_at: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function imageKitAuthorization() {
  const privateKey = env.IMAGEKIT_PRIVATE_KEY?.trim();
  return privateKey ? `Basic ${btoa(`${privateKey}:`)}` : undefined;
}

async function deleteImageKitFile(fileId: string) {
  const authorization = imageKitAuthorization();
  if (!authorization) return false;
  const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { authorization, accept: 'application/json' },
  });
  return response.ok || response.status === 404;
}

async function readLimitedText(request: Request, maximumBytes: number) {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > maximumBytes) throw new Response('Request payload is too large.', { status: 413 });
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Response('Request payload is too large.', { status: 413 });
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(body);
}

export async function readJson<T>(request: Request, maximumBytes = 64_000): Promise<T> {
  try {
    return JSON.parse(await readLimitedText(request, maximumBytes)) as T;
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response('Invalid JSON payload.', { status: 400 });
  }
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function secureEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return mismatch === 0;
}

async function sha256(value: string) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hashPassword(password: string, salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)))) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: PBKDF2_ITERATIONS }, material, 256);
  return { salt, hash: bytesToHex(derived) };
}

export function json(value: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('cache-control', 'no-store');
  return Response.json(value, { status, headers: responseHeaders });
}

function cookieValue(request: Request, name: string) {
  const source = request.headers.get('cookie') ?? '';
  return source.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function sessionCookie(token: string, maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new Response('Cross-origin request rejected.', { status: 403 });
}

function safeProfile(profile: MemberProfile, mfaEnrolled: boolean, mfaVerified = true): AppUser {
  const isAdmin = profile.role === 'super_admin' || profile.platformRoles.length > 0;
  return { ...profile, isAdmin, provider: 'cloudflare', mfaEnrolled, mfaVerified };
}

function enrolledTotpSecret(secret: string | null) {
  return secret && !secret.startsWith('pending:') ? secret : undefined;
}

async function profileByEmail(email: string) {
  return env.DB.prepare('SELECT * FROM profiles WHERE email = ? LIMIT 1').bind(normalizeEmail(email)).first<{ uid: string; email: string; password_hash: string; password_salt: string; profile_json: string; totp_secret: string | null }>();
}

export async function profileById(uid: string) {
  return env.DB.prepare('SELECT * FROM profiles WHERE uid = ? LIMIT 1').bind(uid).first<{ uid: string; profile_json: string; totp_secret: string | null }>();
}

export async function currentUser(request: Request, requireVerified = true): Promise<AppUser | undefined> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return undefined;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT p.uid, p.profile_json, p.totp_secret, s.verified
    FROM sessions s JOIN profiles p ON p.uid = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`).bind(tokenHash, Math.floor(Date.now() / 1000)).first<{ uid: string; profile_json: string; totp_secret: string | null; verified: number }>();
  if (!row || (requireVerified && row.verified !== 1)) return undefined;
  let profile = JSON.parse(row.profile_json) as MemberProfile;
  if (profile.suspended) return undefined;
  const subscription = await env.DB.prepare("SELECT expires_at FROM subscriptions WHERE user_id=? AND status IN ('active','manually_activated')").bind(profile.uid).first<{expires_at:string|null}>();
  if (subscription?.expires_at && subscription.expires_at <= new Date().toISOString()) {
    await expireSubscriptions();
    profile = { ...profile, tier: 'lite' };
  }
  return safeProfile(profile, Boolean(enrolledTotpSecret(row.totp_secret)));
}

async function createSession(userId: string, verified: boolean, lifetimeSeconds = SESSION_SECONDS) {
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, verified, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, Math.floor(Date.now() / 1000) + lifetimeSeconds, verified ? 1 : 0, now).run();
  return token;
}

function decodeBase32(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replace(/=+$/g, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid authenticator secret.');
    bits += index.toString(2).padStart(5, '0');
  }
  const output = new Uint8Array(Math.floor(bits.length / 8));
  for (let index = 0; index < output.length; index += 1) output[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  return output;
}

function encodeBase32(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  bytes.forEach((byte) => { bits += byte.toString(2).padStart(8, '0'); });
  let output = '';
  for (let index = 0; index < bits.length; index += 5) output += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  return output;
}

async function totp(secret: string, offset = 0) {
  const counter = Math.floor(Date.now() / 30_000) + offset;
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey('raw', decodeBase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const position = signature.at(-1)! & 0x0f;
  const number = ((signature[position] & 0x7f) << 24) | (signature[position + 1] << 16) | (signature[position + 2] << 8) | signature[position + 3];
  return String(number % 1_000_000).padStart(6, '0');
}

async function verifyTotp(secret: string, code: string) {
  const candidates = await Promise.all([-1, 0, 1].map((offset) => totp(secret, offset)));
  return candidates.some((candidate) => secureEqual(candidate, code));
}

export async function register(request: Request) {
  assertSameOrigin(request);
  const input = await readJson<{ name?: string; email?: string; password?: string; universityId?: string; phone?: string; setupToken?: string }>(request);
  const email = normalizeEmail(input.email ?? '');
  const name = input.name?.trim() ?? '';
  const password = input.password ?? '';
  const universityId = normalizeUniversityId(input.universityId ?? '');
  const phone = normalizePhone(input.phone ?? '');
  let universityIdRegistered = false;
  if (!name || name.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 128) return json({ error: 'Enter a valid name, email, and a password between 10 and 128 characters.' }, 400);
  if (await profileByEmail(email)) return json({ error: 'An account with this email already exists.' }, 409);
  const rootEmail = normalizeEmail(env.ROOT_ADMIN_EMAIL ?? '');
  const isRoot = Boolean(rootEmail && email === rootEmail);
  if (isRoot && (!env.ROOT_ADMIN_SETUP_TOKEN || env.ROOT_ADMIN_SETUP_TOKEN.length < 24)) return json({ error: 'Superadmin registration is not configured securely.' }, 503);
  if (isRoot && (!env.ROOT_ADMIN_SETUP_TOKEN || !secureEqual(input.setupToken ?? '', env.ROOT_ADMIN_SETUP_TOKEN))) return json({ error: 'The Superadmin setup code is invalid.' }, 403);
  if (isRoot) {
    const security = await env.DB.prepare("SELECT payload FROM records WHERE type = 'system' AND id = 'security'").first<{ payload: string }>();
    if (security && (JSON.parse(security.payload) as { superAdminUid?: string }).superAdminUid) return json({ error: 'The Superadmin account has already been created.' }, 409);
  }
  if (!isRoot) {
    if (!universityId || phone.length < 7) return json({ error: 'A valid university ID and mobile number are required.' }, 400);
    const control = await env.DB.prepare("SELECT payload FROM records WHERE type = 'system' AND id = 'accessControl'").first<{ payload: string }>();
    const blocked = control ? JSON.parse(control.payload) as CollaborationState['blockedAccess'] : { emails: [], phones: [], universityIds: [] };
    if (blocked.emails.includes(email) || blocked.phones.includes(phone) || blocked.universityIds.includes(universityId)) return json({ error: 'This email, university ID, or mobile number is blocked.' }, 403);
    const existingClaim = await env.DB.prepare('SELECT user_id FROM university_claims WHERE university_id = ?').bind(universityId).first<{ user_id: string }>();
    if (existingClaim) return json({ error: 'This university ID has already been used.' }, 409);
    const allowed = await env.DB.prepare("SELECT payload FROM records WHERE type = 'universityIds' AND id = ?").bind(universityId).first<{ payload: string }>();
    if (allowed && (JSON.parse(allowed.payload) as { claimedById?: string | null }).claimedById) return json({ error: 'This university ID has already been used.' }, 409);
    universityIdRegistered = Boolean(allowed);
  }
  const now = new Date().toISOString();
  const uid = crypto.randomUUID();
  const passwordData = await hashPassword(password);
  const profile: MemberProfile = { uid, email, displayName: name, universityId: isRoot ? 'SUPERADMIN' : universityId, phone, role: isRoot ? 'super_admin' : 'student', status: isRoot ? 'approved' : 'pending', createdAt: now, tier: isRoot ? 'pro' : 'lite', platformRoles: [], universityIdRegistered: isRoot ? true : universityIdRegistered };
  const statements = [env.DB.prepare('INSERT INTO profiles (uid, email, password_hash, password_salt, profile_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(uid, email, passwordData.hash, passwordData.salt, JSON.stringify(profile), now, now)];
  if (isRoot) statements.push(env.DB.prepare("INSERT INTO records (type, id, payload, updated_at) VALUES ('system', 'security', ?, ?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at").bind(JSON.stringify({ superAdminUid: uid, updatedAt: now }), now));
  else {
    const allowed = { id: universityId, claimedById: uid, claimedByName: name, claimedAt: now };
    statements.push(env.DB.prepare('INSERT INTO university_claims (university_id, user_id, claimed_at) VALUES (?, ?, ?)').bind(universityId, uid, now));
    statements.push(env.DB.prepare("UPDATE records SET payload = ?, updated_at = ? WHERE type = 'universityIds' AND id = ? AND json_extract(payload, '$.claimedById') IS NULL").bind(JSON.stringify(allowed), now, universityId));
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (error instanceof Error && /profiles\.email|idx_profiles_email/i.test(error.message)) return json({ error: 'An account with this email already exists.' }, 409);
    if (!isRoot && error instanceof Error && /university_claims|university id|constraint/i.test(error.message)) return json({ error: 'This university ID has already been used.' }, 409);
    throw error;
  }
  const token = await createSession(uid, true);
  return json({ user: safeProfile(profile, false) }, 201, { 'set-cookie': sessionCookie(token) });
}

export async function login(request: Request) {
  assertSameOrigin(request);
  const input = await readJson<{ email?: string; password?: string }>(request);
  const row = await profileByEmail(input.email ?? '');
  if (!row) return json({ error: 'Incorrect email or password.' }, 401);
  const calculated = await hashPassword(input.password ?? '', row.password_salt);
  if (!secureEqual(calculated.hash, row.password_hash)) return json({ error: 'Incorrect email or password.' }, 401);
  const profile = JSON.parse(row.profile_json) as MemberProfile;
  if (profile.suspended) return json({ error: 'This account has been suspended.' }, 403);
  const mfaSecret = enrolledTotpSecret(row.totp_secret);
  const needsMfa = profile.role === 'super_admin' && Boolean(mfaSecret);
  const token = await createSession(row.uid, !needsMfa, needsMfa ? 300 : SESSION_SECONDS);
  if (needsMfa) return json({ error: 'MFA_REQUIRED' }, 428, { 'set-cookie': sessionCookie(token, 300) });
  return json({ user: safeProfile(profile, Boolean(mfaSecret)) }, 200, { 'set-cookie': sessionCookie(token) });
}

export async function verifyMfa(request: Request) {
  assertSameOrigin(request);
  const token = cookieValue(request, SESSION_COOKIE);
  const input = await readJson<{ code?: string }>(request);
  if (!token) return json({ error: 'Start sign-in again.' }, 401);
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT p.profile_json, p.totp_secret FROM sessions s JOIN profiles p ON p.uid = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`).bind(tokenHash, Math.floor(Date.now() / 1000)).first<{ profile_json: string; totp_secret: string | null }>();
  const secret = enrolledTotpSecret(row?.totp_secret ?? null);
  if (!row || !secret || !(await verifyTotp(secret, input.code?.trim() ?? ''))) return json({ error: 'The authenticator code is invalid.' }, 401);
  await env.DB.prepare('UPDATE sessions SET verified = 1, expires_at = ? WHERE token_hash = ?').bind(Math.floor(Date.now() / 1000) + SESSION_SECONDS, tokenHash).run();
  return json({ user: safeProfile(JSON.parse(row.profile_json) as MemberProfile, true) }, 200, { 'set-cookie': sessionCookie(token) });
}

export async function beginMfa(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.role !== 'super_admin') return json({ error: 'Superadmin authentication is required.' }, 403);
  const secret = encodeBase32(crypto.getRandomValues(new Uint8Array(20)));
  await env.DB.prepare('UPDATE profiles SET totp_secret = ?, updated_at = ? WHERE uid = ?').bind(`pending:${secret}`, new Date().toISOString(), user.uid).run();
  return json({ secretKey: secret, qrUrl: `otpauth://totp/Qraft:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Qraft&algorithm=SHA1&digits=6&period=30` });
}

export async function completeMfa(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.role !== 'super_admin') return json({ error: 'Superadmin authentication is required.' }, 403);
  const row = await profileById(user.uid);
  const secret = row?.totp_secret?.startsWith('pending:') ? row.totp_secret.slice(8) : undefined;
  const input = await readJson<{ code?: string }>(request);
  if (!secret || !(await verifyTotp(secret, input.code?.trim() ?? ''))) return json({ error: 'The authenticator code is invalid.' }, 400);
  await env.DB.prepare('UPDATE profiles SET totp_secret = ?, updated_at = ? WHERE uid = ?').bind(secret, new Date().toISOString(), user.uid).run();
  return json({ ok: true });
}

export async function logout(request: Request) {
  assertSameOrigin(request);
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

export async function cleanDeletedState(state: AppState): Promise<AppState> {
  const rows=await env.DB.prepare('SELECT id FROM retired_questions').all<{id:string}>();
  const deleted=new Set(rows.results.map(x=>x.id));
  const keep=(id:string)=>!deleted.has(id);
  return {...state,customQuestions:(state.customQuestions??[]).filter(q=>keep(q.id)),questionOverrides:Object.fromEntries(Object.entries(state.questionOverrides??{}).filter(([id])=>keep(id))),progress:Object.fromEntries(Object.entries(state.progress??{}).filter(([id])=>keep(id))),reports:(state.reports??[]).map(r=>keep(r.questionId)?r:{...r,questionId:'#deleted'}),revisions:(state.revisions??[]).map(r=>keep(r.questionId)?r:{...r,questionId:'#deleted'}),tests:state.tests.map(t=>({...t,questionIds:t.questionIds.filter(keep),currentIndex:Math.max(0,Math.min(t.currentIndex,t.questionIds.filter(keep).length-1)),answers:Object.fromEntries(Object.entries(t.answers).filter(([id])=>keep(id))),revealed:t.revealed.filter(keep),graded:t.graded.filter(keep)}))};
}

export async function loadState(request: Request) {
  const user = await currentUser(request);
  if (!user) return json({ error: 'Authentication required.' }, 401);
  const row = await env.DB.prepare('SELECT payload FROM app_states WHERE user_id = ?').bind(user.uid).first<{ payload: string }>();
  return json({ state: row ? await cleanDeletedState(JSON.parse(row.payload) as AppState) : null });
}

export async function saveState(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved') return json({ error: 'Approved account required.' }, 403);
  const input = await readJson<{ state?: AppState }>(request, 2_000_000);
  if (!input.state || input.state.version !== 1) return json({ error: 'Invalid state payload.' }, 400);
  if (!Array.isArray(input.state.tests) || input.state.tests.some(t => !t || typeof t.id !== 'string' || !Array.isArray(t.questionIds) || t.questionIds.some(id => typeof id !== 'string'))) return json({error:'Invalid tests.'},400);
  const oldTests = await env.DB.prepare('SELECT test_id,question_count FROM test_registry WHERE user_id=?').bind(user.uid).all<{test_id:string;question_count:number}>();
  const known = new Map(oldTests.results.map(t => [t.test_id,t.question_count]));
  if(user.tier==='lite' && input.state.tests.some(t => t.questionIds.length > Math.max(30,known.get(t.id)??0))) return json({error:'Lite allows 30 questions per test. Upgrade to Pro.'},403);
  const now = new Date().toISOString();
  input.state = await cleanDeletedState(input.state);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO test_registry(user_id,test_id,question_count) SELECT ?,json_extract(value,'$.id'),json_array_length(value,'$.questionIds') FROM json_each(?)").bind(user.uid,JSON.stringify(input.state.tests)),
      env.DB.prepare('INSERT INTO app_states (user_id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at').bind(user.uid, JSON.stringify(input.state), now),
    ]);
  } catch(error) {
    if(error instanceof Error && /LITE_/.test(error.message)) return json({error:'Lite allows 3 tests and 30 questions per test. Upgrade to Pro.'},403);
    throw error;
  }
  return json({ ok: true });
}

function recordData(value: Record<string, unknown>) {
  return {
    qbankId: typeof value.qbankId === 'string' ? value.qbankId : undefined,
    ownerId: typeof value.ownerId === 'string' ? value.ownerId : typeof value.createdById === 'string' ? value.createdById : undefined,
    email: typeof value.email === 'string' ? normalizeEmail(value.email) : undefined,
  };
}

async function allRecords() {
  const result = await env.DB.prepare('SELECT * FROM records').all<StoredRecord>();
  return result.results.map((row) => ({ collection: row.type, id: row.id, value: JSON.parse(row.payload) as unknown }));
}

function recordsToState(rows: Awaited<ReturnType<typeof allRecords>>, profilesRows: MemberProfile[] = []) {
  const state = initialCollaborationState();
  const values = <T>(type: string) => rows.filter((row) => row.collection === type).map((row) => row.value as T);
  const one = <T>(type: string, id: string) => rows.find((row) => row.collection === type && row.id === id)?.value as T | undefined;
  const qbanks = values<QBank>('qbanks');
  state.qbanks = [...state.qbanks.filter((bank) => !qbanks.some((stored) => stored.id === bank.id)), ...qbanks];
  state.memberships = values<CollaborationState['memberships'][number]>('qbankMemberships');
  state.invitations = values<CollaborationState['invitations'][number]>('qbankInvitations');
  state.members = profilesRows;
  state.allowedUniversityIds = values<CollaborationState['allowedUniversityIds'][number]>('universityIds');
  const registeredUniversityIds = new Set(state.allowedUniversityIds.map((item) => normalizeUniversityId(item.id)));
  state.members = state.members.map((member) => ({
    ...member,
    universityIdRegistered: member.role === 'super_admin' || registeredUniversityIds.has(normalizeUniversityId(member.universityId)),
  }));
  state.adminInvites = values<CollaborationState['adminInvites'][number]>('adminInvites');
  state.proposals = values<CollaborationState['proposals'][number]>('questionProposals');
  state.roleApplications = values<CollaborationState['roleApplications'][number]>('roleApplications');
  state.approvedQuestions = values<CollaborationState['approvedQuestions'][number]>('sharedQuestions');
  state.answerStats = Object.fromEntries(values<CollaborationState['answerStats'][string]>('answerStats').map((item) => [item.id, item]));
  state.sharedNotes = Object.fromEntries(values<CollaborationState['sharedNotes'][string]>('sharedNotes').map((item) => [item.id, item]));
  state.auditLog = values<CollaborationState['auditLog'][number]>('auditLog');
  state.blockedAccess = one<CollaborationState['blockedAccess']>('system', 'accessControl') ?? state.blockedAccess;
  state.security = one<CollaborationState['security']>('system', 'security') ?? state.security;
  state.lastSyncAt = new Date().toISOString();
  return normalizeCollaborationState(state);
}

const protectedSubscriptionsSql = "SELECT user_id FROM subscriptions WHERE method != 'manual' OR paid > 0 OR discount_code IS NOT NULL UNION SELECT user_id FROM subscription_events WHERE status='success' AND (final > 0 OR code IS NOT NULL)";
async function protectedSubscriptionUsers() {
  const result = await env.DB.prepare(protectedSubscriptionsSql).all<{ user_id: string }>();
  return new Set(result.results.map(row => row.user_id));
}

function accessManagerProfile(member: MemberProfile, protectedAccount: boolean): MemberProfile {
  return { uid: member.uid, displayName: member.displayName, email: member.email, universityId: member.universityId,
    role: member.role, tier: member.tier, platformRoles: member.platformRoles, status: member.status,
    suspended: member.suspended, universityIdRegistered: member.universityIdRegistered,
    universityIdVerifiedManually: member.universityIdVerifiedManually, subscriptionProtected: protectedAccount } as MemberProfile;
}

export async function loadCollaboration(request: Request) {
  const user = await currentUser(request);
  if (!user || user.status !== 'approved') return json({ error: 'Approved account required.' }, 403);
  const rows = await allRecords();
  const profileResult = user.role === 'super_admin' || user.platformRoles.includes('access_manager')
    ? await env.DB.prepare('SELECT profile_json FROM profiles').all<{ profile_json: string }>()
    : { results: [] as { profile_json: string }[] };
  const state = recordsToState(rows, profileResult.results.map((row) => JSON.parse(row.profile_json) as MemberProfile));
  const accessibleIds = new Set(state.qbanks.filter((bank) => canAccessBank(user, bank, state.memberships)).map((bank) => bank.id));
  const reviewIds = new Set(state.qbanks.filter((bank) => canReviewBank(user, bank, state.memberships)).map((bank) => bank.id));
  const manageIds = new Set(state.qbanks.filter((bank) => canManageBank(user, bank)).map((bank) => bank.id));
  state.qbanks = state.qbanks.filter((bank) => accessibleIds.has(bank.id) || reviewIds.has(bank.id));
  state.memberships = state.memberships.filter((item) => item.userId === user.uid || manageIds.has(item.qbankId));
  state.invitations = state.invitations.filter((item) => item.email === user.email || item.invitedById === user.uid || manageIds.has(item.qbankId));
  state.proposals = state.proposals.filter((item) => item.proposedById === user.uid || reviewIds.has(item.qbankId));
  state.approvedQuestions = state.approvedQuestions.filter((item) => accessibleIds.has(item.qbankId ?? 'smle-gs') || reviewIds.has(item.qbankId ?? 'smle-gs'));
  state.answerStats = Object.fromEntries(Object.entries(state.answerStats).filter(([, item]) => accessibleIds.has(item.qbankId)));
  state.sharedNotes = Object.fromEntries(Object.entries(state.sharedNotes).filter(([, item]) => accessibleIds.has(item.qbankId)));
  state.roleApplications = state.roleApplications.filter((item) => item.userId === user.uid || user.role === 'super_admin');
  if (user.role !== 'super_admin') { state.allowedUniversityIds = []; state.adminInvites = []; state.auditLog = []; }
  if (user.role !== 'super_admin' && !user.platformRoles.includes('access_manager')) { state.members = []; state.blockedAccess = { emails: [], phones: [], universityIds: [] }; }
  if (user.role !== 'super_admin' && user.platformRoles.includes('access_manager')) {
    const protectedUsers = await protectedSubscriptionUsers();
    state.members = state.members.map(member => accessManagerProfile(member, protectedUsers.has(member.uid)));
    state.blockedAccess.phones = [];
  }
  return json({ collaboration: state });
}

export async function storedState() {
  const rows = await allRecords();
  const profilesResult = await env.DB.prepare('SELECT profile_json FROM profiles').all<{ profile_json: string }>();
  return { rows, state: recordsToState(rows, profilesResult.results.map((row) => JSON.parse(row.profile_json) as MemberProfile)) };
}

function bankIdForOperation(operation: RecordOperation, value: Record<string, unknown>, state: CollaborationState) {
  if (operation.collection === 'qbanks') return operation.id;
  if (typeof value.qbankId === 'string') return value.qbankId;
  if (operation.collection === 'qbankMemberships') return state.memberships.find((item) => item.id === operation.id)?.qbankId;
  if (operation.collection === 'qbankInvitations') return state.invitations.find((item) => item.id === operation.id)?.qbankId;
  if (operation.collection === 'questionProposals') return state.proposals.find((item) => item.id === operation.id)?.qbankId;
  if (operation.collection === 'sharedQuestions') return state.approvedQuestions.find((item) => item.id === operation.id)?.qbankId ?? 'smle-gs';
  if (operation.collection === 'answerStats') return state.answerStats[operation.id]?.qbankId;
  if (operation.collection === 'sharedNotes') return state.sharedNotes[operation.id]?.qbankId;
  return undefined;
}

function profileUpdateAllowed(user: AppUser, operation: RecordOperation, value: Record<string, unknown>, state: CollaborationState) {
  if (operation.type !== 'set' || value.uid !== operation.id) return false;
  const existing = state.members.find((member) => member.uid === operation.id);
  if (!existing) return false;
  if (user.role === 'super_admin') {
    if (existing.role === 'super_admin') return value.uid === user.uid && value.role === 'super_admin' && value.email === existing.email && value.createdAt === existing.createdAt;
    return value.role !== 'super_admin' && value.email === existing.email && value.uid === existing.uid && value.createdAt === existing.createdAt;
  }
  if (!user.platformRoles.includes('access_manager')) return false;
  const mutable = new Set(['status', 'suspended', 'approvedAt', 'approvedById', 'approvedByName', 'universityIdVerifiedManually']);
  const keys = new Set([...Object.keys(existing), ...Object.keys(value)]);
  return [...keys].every((key) => mutable.has(key) || sameJson(value[key], existing[key as keyof MemberProfile]));
}

function invitedUserChangeAllowed(user: AppUser, operation: RecordOperation, value: Record<string, unknown>, state: CollaborationState) {
  const existing = state.invitations.find((item) => item.id === operation.id);
  if (!existing || normalizeEmail(existing.email) !== user.email || operation.type !== 'set') return false;
  return value.id === existing.id && value.qbankId === existing.qbankId && value.email === existing.email && value.role === existing.role
    && value.invitedById === existing.invitedById && value.invitedByName === existing.invitedByName && value.createdAt === existing.createdAt
    && value.status === 'accepted' && value.acceptedById === user.uid && typeof value.acceptedAt === 'string';
}

function selfMembershipChangeAllowed(user: AppUser, operation: RecordOperation, value: Record<string, unknown>, state: CollaborationState) {
  const current = state.memberships.find((item) => item.id === operation.id);
  if (operation.type === 'delete') return current?.userId === user.uid;
  if (value.userId !== user.uid || value.id !== operation.id) return false;
  if (current) return sameJson(value, current);
  const invite = state.invitations.find((item) => item.id === value.inviteId);
  return Boolean(invite && invite.status === 'pending' && normalizeEmail(invite.email) === user.email
    && invite.qbankId === value.qbankId && invite.role === value.role);
}

function proposalPayloadIsComplete(proposal: Record<string, unknown>) {
  const payload = isRecord(proposal.payload) ? proposal.payload : undefined;
  const options = Array.isArray(payload?.options) ? payload.options : [];
  return Array.isArray(proposal.editKinds) && proposal.editKinds.length > 0 && proposal.editKinds.every((item) => typeof item === 'string')
    && typeof payload?.explanation === 'string'
    && typeof payload.sourceReference === 'string' && Boolean(payload.sourceReference.trim())
    && typeof payload.stem === 'string' && Boolean(payload.stem.trim())
    && options.length >= 2 && options.length <= 10 && options.every((item) => typeof item === 'string' && item.trim())
    && typeof payload.answer === 'number' && Number.isInteger(payload.answer) && payload.answer >= 0 && payload.answer < options.length;
}

function proposalChangeAllowed(user: AppUser, operation: RecordOperation, value: Record<string, unknown>, state: CollaborationState, canReview: boolean) {
  const current = state.proposals.find((item) => item.id === operation.id);
  if (operation.type === 'delete') return Boolean(canReview || (current?.proposedById === user.uid && current.status !== 'approved'));
  if (value.id !== operation.id || !proposalPayloadIsComplete(value)) return false;
  if (!current) return value.proposedById === user.uid && value.status === 'pending';
  if (canReview) {
    const immutable = ['id', 'qbankId', 'type', 'editKinds', 'payload', 'currentSnapshot', 'rationale', 'submissionMethod', 'importBatchId', 'proposedById', 'proposedByName', 'proposedAt'];
    const questionIdAllowed = current.type === 'new_question'
      ? (value.status === 'approved' ? typeof value.questionId === 'string' && value.questionId.length > 0 : value.questionId === current.questionId)
      : value.questionId === current.questionId;
    return current.status === 'pending' && current.proposedById !== user.uid
      && questionIdAllowed && immutable.every((key) => sameJson(value[key], current[key as keyof typeof current]))
      && (value.status === 'approved' || value.status === 'rejected') && value.reviewedById === user.uid && typeof value.reviewedAt === 'string';
  }
  return current.proposedById === user.uid && current.status !== 'approved' && value.proposedById === user.uid
    && value.qbankId === current.qbankId && value.proposedAt === current.proposedAt && value.status === 'pending';
}

function sharedNoteChangeAllowed(user: AppUser, operation: RecordOperation, value: Record<string, unknown>, state: CollaborationState, canManage: boolean) {
  const current = state.sharedNotes[operation.id];
  if (operation.type === 'delete') return canManage;
  if (value.id !== operation.id || value.updatedById !== user.uid || !Array.isArray(value.history)) return false;
  if (!current) return value.version === 1 && value.history.length === 0;
  return value.qbankId === current.qbankId && value.questionId === current.questionId
    && value.version === current.version + 1 && value.history.length === current.history.length + 1;
}

function answerStatChangeAllowed(user: AppUser, operation: RecordOperation, value: Record<string, unknown>, state: CollaborationState) {
  if(operation.type!=='set'||value.id!==operation.id||!isRecord(value.selections))return false;
  const existing=state.answerStats[operation.id];
  if(existing&&(value.qbankId!==existing.qbankId||value.questionId!==existing.questionId))return false;
  const question=state.approvedQuestions.find(q=>q.id===value.questionId&&q.qbankId===value.qbankId);
  const selections=value.selections;
  const answer=selections[user.uid];
  if(!question||typeof answer!=='number'||!Number.isInteger(answer)||answer<0||answer>=question.options.length)return false;
  const before=existing?.selections??{};
  return [...new Set([...Object.keys(before),...Object.keys(selections)])].every(uid=>uid===user.uid||before[uid]===selections[uid]);
}

function roleApplicationChangeAllowed(user: AppUser, operation: RecordOperation, value: Record<string, unknown>, state: CollaborationState, isRoot: boolean) {
  const current = state.roleApplications.find((item) => item.id === operation.id);
  if (operation.type === 'delete') return isRoot;
  if (value.id !== operation.id) return false;
  if (isRoot) {
    if (!current) return false;
    const immutable = ['id', 'userId', 'userName', 'userEmail', 'requestedRole', 'qbankId', 'reason', 'createdAt', 'superAdminUid'];
    return immutable.every((key) => sameJson(value[key], current[key as keyof typeof current]))
      && (value.status === 'approved' || value.status === 'rejected') && value.reviewedById === user.uid && typeof value.reviewedAt === 'string';
  }
  if (value.userId !== user.uid || value.status !== 'pending' || value.superAdminUid !== state.security.superAdminUid || typeof value.reason !== 'string' || !value.reason.trim()) return false;
  return !current || (current.userId === user.uid && current.status !== 'approved' && value.createdAt === current.createdAt && value.requestedRole === current.requestedRole);
}

function recordAllowed(user: AppUser, operation: RecordOperation, state: CollaborationState) {
  if (!operation.id || operation.id.length > 200 || !operation.collection || operation.collection.length > 50 || (operation.type !== 'set' && operation.type !== 'delete')) return false;
  if (operation.type === 'set' && !isRecord(operation.value)) return false;
  const value = isRecord(operation.value) ? operation.value : {};
  const existing = state.qbanks.find((bank) => bank.id === bankIdForOperation(operation, value, state));
  const isRoot = user.role === 'super_admin';
  const accessManager = isRoot || user.platformRoles.includes('access_manager');
  const canManage = existing ? canManageBank(user, existing) : false;
  const canReview = existing ? canReviewBank(user, existing, state.memberships) : false;
  const canAccess = existing ? canAccessBank(user, existing, state.memberships) : false;
  if (operation.collection === 'qbanks') {
    if (operation.type === 'set' && !existing) return value.id === operation.id && (user.tier === 'pro' || accessManager) && value.ownerId === user.uid && (value.essential !== true || isRoot);
    if (!existing || !canManage) return false;
    if (operation.type === 'delete') return true;
    return isRoot || (value.ownerId === existing.ownerId && value.essential === existing.essential);
  }
  if (operation.collection === 'qbankMemberships') return canManage || selfMembershipChangeAllowed(user, operation, value, state);
  if (operation.collection === 'qbankInvitations') return canManage || invitedUserChangeAllowed(user, operation, value, state);
  if (operation.collection === 'qbankShareLinks') return canManage;
  if (operation.collection === 'questionProposals') return (canAccess || canReview) && proposalChangeAllowed(user, operation, value, state, canReview);
  if (operation.collection === 'sharedQuestions') return operation.type === 'delete' ? canManage : canReview;
  if (operation.collection === 'answerStats') return operation.type === 'delete' ? canManage : canAccess && answerStatChangeAllowed(user, operation, value, state);
  if (operation.collection === 'sharedNotes') return canAccess && sharedNoteChangeAllowed(user, operation, value, state, canManage);
  if (operation.collection === 'roleApplications') return roleApplicationChangeAllowed(user, operation, value, state, isRoot);
  if (operation.collection === 'profiles') return accessManager && profileUpdateAllowed(user, operation, value, state);
  if (operation.collection === 'universityIds' || operation.collection === 'adminInvites') return isRoot;
  if (operation.collection === 'system') return operation.id === 'accessControl' ? accessManager : isRoot;
  if (operation.collection === 'auditLog') return operation.type === 'set' && value.actorId === user.uid;
  return false;
}

function reviewedQuestionWriteAllowed(user: AppUser, operation: RecordOperation, operations: RecordOperation[]) {
  if (operation.collection !== 'sharedQuestions' || operation.type !== 'set' || !isRecord(operation.value)) return true;
  const question = operation.value;
  if (question.reviewedById !== user.uid || typeof question.reviewedByName !== 'string' || typeof question.reviewedAt !== 'string'
    || typeof question.writtenById !== 'string' || typeof question.writtenByName !== 'string') return false;
  return operations.some((candidate) => {
    if (candidate.collection !== 'questionProposals' || candidate.type !== 'set' || !isRecord(candidate.value)) return false;
    return candidate.value.status === 'approved' && candidate.value.reviewedById === user.uid
      && candidate.value.questionId === operation.id && candidate.value.qbankId === question.qbankId;
  });
}

export async function saveCollaboration(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved') return json({ error: 'Approved account required.' }, 403);
  const input = await readJson<{ operations?: RecordOperation[] }>(request, 1_800_000);
  if (!Array.isArray(input.operations) || input.operations.length > 500) return json({ error: 'Invalid collaboration change set.' }, 400);
  const { state } = await storedState();
  if (user.role !== 'super_admin' && user.platformRoles.includes('access_manager')) {
    const protectedUsers = await protectedSubscriptionUsers();
    const mutable = new Set(['status', 'suspended', 'approvedAt', 'approvedById', 'approvedByName', 'universityIdVerifiedManually']);
    for (const operation of input.operations) {
      if (operation.collection === 'profiles') {
        const existing = state.members.find(member => member.uid === operation.id);
        if (!existing || protectedUsers.has(operation.id) || existing.role === 'super_admin') return json({ error: 'Only Superadmin can modify this account or its official subscription.' }, 403);
        if (operation.type !== 'set' || !isRecord(operation.value)) return json({ error: 'Invalid account update.' }, 403);
        const visible = accessManagerProfile(existing, false) as unknown as Record<string, unknown>;
        if (Object.entries(operation.value).some(([key, value]) => !mutable.has(key) && !sameJson(value, visible[key]))) return json({ error: 'Account field cannot be modified.' }, 403);
        operation.value = { ...existing, ...Object.fromEntries(Object.entries(operation.value).filter(([key]) => mutable.has(key))) };
      }
      if (operation.collection === 'system' && operation.id === 'accessControl') {
        if (operation.type !== 'set' || !isRecord(operation.value)) return json({ error: 'Invalid access control update.' }, 403);
        const value = operation.value;
        if (!Array.isArray(value.emails) || !Array.isArray(value.universityIds) || !Array.isArray(value.phones) || value.phones.length) return json({ error: 'Access Managers cannot manage phone blocks.' }, 403);
        const protectedMembers = state.members.filter(member => protectedUsers.has(member.uid) || member.role === 'super_admin');
        const changedProtected = protectedMembers.some(member =>
          (value.emails as unknown[]).some(email => typeof email === 'string' && normalizeEmail(email) === normalizeEmail(member.email)) !== state.blockedAccess.emails.some(email => normalizeEmail(email) === normalizeEmail(member.email)) ||
          (value.universityIds as unknown[]).some(id => typeof id === 'string' && normalizeUniversityId(id) === normalizeUniversityId(member.universityId)) !== state.blockedAccess.universityIds.some(id => normalizeUniversityId(id) === normalizeUniversityId(member.universityId)));
        if (changedProtected) return json({ error: 'Only Superadmin can change blocks for official subscribers.' }, 403);
        operation.value = { emails: value.emails, universityIds: value.universityIds, phones: state.blockedAccess.phones };
      }
    }
  }
  if (!input.operations.every((operation) => recordAllowed(user, operation, state) && reviewedQuestionWriteAllowed(user, operation, input.operations!))) return json({ error: 'One or more changes are not permitted.' }, 403);
  for (const operation of input.operations.filter(o=>o.collection==='sharedQuestions'&&o.type==='set')) {
    const question=operation.value as Record<string,unknown>;
    const existing=state.approvedQuestions.find(q=>q.id===operation.id);
    if(question.id!==operation.id || (existing&&question.questionId!==existing.questionId)) return json({error:'Question identity cannot change.'},409);
    if(!existing) {
      const reservation=await env.DB.prepare('SELECT created_by_id,qbank_id FROM question_ids WHERE question_id=?').bind(String(question.questionId)).first<{created_by_id:string;qbank_id:string}>();
      if(!reservation||reservation.created_by_id!==user.uid||reservation.qbank_id!==question.qbankId) return json({error:'Reserve a Question ID before approval.'},409);
    }
    const proposal=input.operations.find(o=>o.collection==='questionProposals'&&o.type==='set'&&(o.value as Record<string,unknown>).questionId===operation.id)?.value as {payload?:Record<string,unknown>}|undefined;
    if(!proposal?.payload || ['stem','options','answer','specialty','topic','explanation','sourceReference','images'].some(key=>!sameJson(question[key]??(key==='images'?[]:undefined),proposal.payload![key]??(key==='images'?[]:undefined)))) return json({error:'Published content must match the reviewed proposal.'},409);
  }
  const now = new Date().toISOString();
  const profileSets = input.operations
    .filter((operation) => operation.collection === 'profiles' && operation.type === 'set')
    .map((operation) => ({ id: operation.id, payload: JSON.stringify(operation.value) }));
  const recordDeletes = input.operations
    .filter((operation) => operation.collection !== 'profiles' && operation.type === 'delete')
    .map((operation) => ({ collection: operation.collection, id: operation.id }));
  const recordSets = input.operations
    .filter((operation) => operation.collection !== 'profiles' && operation.type === 'set')
    .map((operation) => {
      const value = operation.value as Record<string, unknown>;
      const metadata = recordData(value);
      return { collection: operation.collection, id: operation.id, qbankId: metadata.qbankId ?? null, ownerId: metadata.ownerId ?? null, email: metadata.email ?? null, payload: JSON.stringify(value) };
    });
  const statements: D1PreparedStatement[] = [];
  if (user.role !== 'super_admin' && user.platformRoles.includes('access_manager')) {
    // Recheck inside the atomic batch in case a subscription was purchased after authorization.
    const affected = new Set(input.operations.filter(op => op.collection === 'profiles').map(op => op.id));
    for (const op of input.operations.filter(op => op.collection === 'system' && op.id === 'accessControl')) {
      const next = op.value as CollaborationState['blockedAccess'];
      for (const member of state.members) {
        if (next.emails.some(email => normalizeEmail(email) === normalizeEmail(member.email)) !== state.blockedAccess.emails.some(email => normalizeEmail(email) === normalizeEmail(member.email)) ||
          next.universityIds.some(id => normalizeUniversityId(id) === normalizeUniversityId(member.universityId)) !== state.blockedAccess.universityIds.some(id => normalizeUniversityId(id) === normalizeUniversityId(member.universityId))) affected.add(member.uid);
      }
    }
    if (affected.size) statements.push(env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM (${protectedSubscriptionsSql}) WHERE user_id IN (SELECT value FROM json_each(?))) THEN json('Official subscription changed; Superadmin required') ELSE 1 END`).bind(JSON.stringify([...affected])));
  }
  if (recordDeletes.length) statements.push(env.DB.prepare(`DELETE FROM records WHERE EXISTS (
    SELECT 1 FROM json_each(?) AS change
    WHERE json_extract(change.value, '$.collection') = records.type AND json_extract(change.value, '$.id') = records.id
  )`).bind(JSON.stringify(recordDeletes)));
  for (const op of input.operations.filter(o=>o.collection==='profiles'&&o.type==='set')) {
    const before=state.members.find(m=>m.uid===op.id), after=op.value as MemberProfile;
    if(before && before.tier!==after.tier) {
      const expiry=new Date(now); expiry.setUTCFullYear(expiry.getUTCFullYear()+1);
      statements.push(env.DB.prepare("INSERT INTO subscriptions(user_id,status,starts_at,expires_at,method,paid,updated_at) VALUES(?,?,?,?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,starts_at=excluded.starts_at,expires_at=excluded.expires_at,method=excluded.method,updated_at=excluded.updated_at").bind(op.id,after.tier==='pro'?'manually_activated':'cancelled',now,after.tier==='pro'?expiry.toISOString():now,'manual',now));
      statements.push(auditStatement(user,after.tier==='pro'?'subscription_manually_activated':'subscription_cancelled',op.id,{tier:before.tier},{tier:after.tier,expiresAt:expiry.toISOString()}));
    }
  }
  if (profileSets.length) statements.push(env.DB.prepare(`UPDATE profiles SET
    profile_json = (SELECT json_extract(change.value, '$.payload') FROM json_each(?) AS change WHERE json_extract(change.value, '$.id') = profiles.uid),
    updated_at = ?
    WHERE uid IN (SELECT json_extract(change.value, '$.id') FROM json_each(?) AS change)`)
    .bind(JSON.stringify(profileSets), now, JSON.stringify(profileSets)));
  if (recordSets.length) statements.push(env.DB.prepare(`INSERT INTO records (type, id, qbank_id, owner_id, email, payload, updated_at)
    SELECT json_extract(change.value, '$.collection'), json_extract(change.value, '$.id'), json_extract(change.value, '$.qbankId'),
      json_extract(change.value, '$.ownerId'), json_extract(change.value, '$.email'), json_extract(change.value, '$.payload'), ?
    FROM json_each(?) AS change WHERE 1
    ON CONFLICT(type,id) DO UPDATE SET qbank_id=excluded.qbank_id, owner_id=excluded.owner_id, email=excluded.email, payload=excluded.payload, updated_at=excluded.updated_at`)
    .bind(now, JSON.stringify(recordSets)));
  for (const operation of input.operations.filter(o=>o.collection!=='auditLog')) statements.push(auditStatement(user,`${operation.collection}_${operation.type}`,operation.id,state.members.find(m=>m.uid===operation.id)??null,operation.type==='delete'?null:{collection:operation.collection}));
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true });
}

export async function reserveIds(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved') return json({ error: 'Approved account required.' }, 403);
  const input = await readJson<{ count?: number; qbankId?: string; highestKnown?: number }>(request);
  const count = input.count ?? 0;
  if (!Number.isInteger(count) || count < 1 || count > 200 || !input.qbankId || input.qbankId.length > 200
    || (input.highestKnown !== undefined && (!Number.isInteger(input.highestKnown) || input.highestKnown < 0 || input.highestKnown > 99_999))) return json({ error: 'Invalid ID reservation.' }, 400);
  const state = (await storedState()).state;
  const bank = state.qbanks.find((item) => item.id === input.qbankId);
  if (!bank || !canReviewBank(user, bank, state.memberships)) return json({ error: 'Reviewer access required.' }, 403);
  const now = new Date().toISOString();
  const allocated = await env.DB.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<99999)
    INSERT INTO question_ids(question_id,qbank_id,created_by_id,created_at)
    SELECT printf('%05d',n),?,?,? FROM numbers WHERE NOT EXISTS(SELECT 1 FROM question_ids WHERE question_id=printf('%05d',n)) AND NOT EXISTS(SELECT 1 FROM question_registry WHERE question_id=printf('%05d',n)) ORDER BY n LIMIT ? RETURNING question_id`).bind(input.qbankId,user.uid,now,count).all<{question_id:string}>();
  const ids=allocated.results.map(x=>x.question_id);
  if(ids.length!==count)return json({error:'Question ID capacity reached.'},409);
  return json({ ids });
}

export async function joinBank(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved') return json({ error: 'Approved account required.' }, 403);
  const input = await readJson<{ qbankId?: string; token?: string }>(request);
  const row = await env.DB.prepare("SELECT payload FROM records WHERE type = 'qbankShareLinks' AND id = ?").bind(input.token ?? '').first<{ payload: string }>();
  const link = row ? JSON.parse(row.payload) as { qbankId: string; enabled: boolean; ownerId: string; ownerName: string; bankName?: string; description?: string } : undefined;
  if (!link?.enabled || link.qbankId !== input.qbankId) return json({ error: 'This QBank link is invalid or no longer active.' }, 404);
  const createdAt = new Date().toISOString();
  const membership = { id: `${link.qbankId}_${user.uid}`, qbankId: link.qbankId, userId: user.uid, userName: user.displayName, role: 'viewer', grantedById: link.ownerId, grantedByName: link.ownerName, createdAt, viaLink: true, accessToken: input.token };
  await env.DB.prepare("INSERT INTO records (type, id, qbank_id, owner_id, payload, updated_at) VALUES ('qbankMemberships', ?, ?, ?, ?, ?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at")
    .bind(membership.id, link.qbankId, user.uid, JSON.stringify(membership), createdAt).run();
  return json({ ok: true });
}

export async function previewBankInvite(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved') return json({ error: 'Approved account required.' }, 403);
  const input = await readJson<{ qbankId?: string; token?: string }>(request);
  const row = await env.DB.prepare("SELECT payload FROM records WHERE type = 'qbankShareLinks' AND id = ?").bind(input.token ?? '').first<{ payload: string }>();
  const link = row ? JSON.parse(row.payload) as { qbankId: string; enabled: boolean; ownerId: string; ownerName: string; bankName?: string; description?: string } : undefined;
  if (!link?.enabled || link.qbankId !== input.qbankId) return json({ error: 'This QBank invitation is invalid or no longer active.' }, 404);
  const bankRow = await env.DB.prepare("SELECT payload FROM records WHERE type = 'qbanks' AND id = ?").bind(link.qbankId).first<{ payload: string }>();
  const bank = bankRow ? JSON.parse(bankRow.payload) as Partial<QBank> : undefined;
  return json({
    invitation: {
      qbankId: link.qbankId,
      bankName: typeof bank?.name === 'string' && bank.name.trim() ? bank.name : (link.bankName?.trim() || 'Shared QBank'),
      description: typeof bank?.description === 'string' ? bank.description : (link.description ?? ''),
      ownerName: link.ownerName,
      role: 'viewer',
    },
  });
}

export async function uploadMedia(request: Request, kind: 'notes' | 'questions') {
  assertSameOrigin(request);
  const authorization = imageKitAuthorization();
  if (!authorization) return json({ error: 'ImageKit storage is not configured on this deployment.' }, 503);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved') return json({ error: 'Approved account required.' }, 403);
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > 11 * 1024 * 1024) return json({ error: 'Upload a valid image smaller than 10 MB.' }, 413);
  const form = await request.formData();
  const file = form.get('file');
  const qbankValue = form.get('qbankId');
  const questionValue = form.get('questionId');
  const qbankId = typeof qbankValue === 'string' ? qbankValue : '';
  const questionId = typeof questionValue === 'string' ? questionValue : 'general';
  const permittedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  if (!(file instanceof File) || !permittedTypes.has(file.type) || file.size > 10 * 1024 * 1024) return json({ error: 'Upload a JPEG, PNG, WebP, or GIF image smaller than 10 MB.' }, 400);
  const state = (await storedState()).state;
  const bank = state.qbanks.find((item) => item.id === qbankId);
  const permitted = bank && (kind === 'questions' ? canReviewBank(user, bank, state.memberships) : canAccessBank(user, bank, state.memberships));
  if (!permitted) return json({ error: kind === 'questions' ? 'Reviewer access required.' : 'QBank access required.' }, 403);
  const usage = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM media').first<{ total: number }>();
  const currentBytes = Number(usage?.total ?? 0);
  if (!Number.isFinite(currentBytes) || currentBytes < 0) return json({ error: 'Image storage usage could not be verified.' }, 503);
  if (currentBytes + file.size > IMAGEKIT_STORAGE_LIMIT_BYTES) {
    return json({ error: 'The 3 GB image storage safety limit has been reached. Delete unused images before uploading more.' }, 413);
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const upload = new FormData();
  upload.append('file', file, safeName);
  upload.append('fileName', `${Date.now()}-${crypto.randomUUID()}-${safeName}`);
  upload.append('folder', `/qraft/qbanks/${qbankId}/${kind}/${questionId}`);
  upload.append('useUniqueFileName', 'true');
  upload.append('tags', `qraft,${kind},${qbankId}`);
  const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: { authorization, accept: 'application/json' },
    body: upload,
  });
  const result = await response.json().catch(() => null) as { fileId?: string; url?: string; message?: string } | null;
  if (!response.ok || !result?.fileId || !result.url) {
    return json({ error: result?.message || 'ImageKit rejected the image upload.' }, 502);
  }
  const now = new Date().toISOString();
  try {
    await env.DB.prepare('INSERT INTO media (key, qbank_id, owner_id, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(result.fileId, qbankId, user.uid, file.type, file.size, now).run();
  } catch (error) {
    await deleteImageKitFile(result.fileId);
    throw error;
  }
  return json({ url: result.url }, 201);
}

export async function serveMedia(request: Request, key: string) {
  const user = await currentUser(request);
  if (!user) return new Response('Authentication required.', { status: 401 });
  const metadata = await env.DB.prepare('SELECT qbank_id FROM media WHERE key = ?').bind(key).first<{ qbank_id: string }>();
  if (!metadata) return new Response('Not found.', { status: 404 });
  const state = (await storedState()).state;
  const bank = state.qbanks.find((item) => item.id === metadata.qbank_id);
  if (!bank || !canAccessBank(user, bank, state.memberships)) return new Response('Forbidden.', { status: 403 });
  return new Response('This legacy media URL is no longer available. Re-upload the image to ImageKit.', { status: 410 });
}

export async function deleteBankMedia(request: Request, qbankId: string) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  const state = (await storedState()).state;
  const bank = state.qbanks.find((item) => item.id === qbankId);
  if (!user || !bank || !canManageBank(user, bank)) return json({ error: 'QBank management access required.' }, 403);
  if (!imageKitAuthorization()) return json({ error: 'ImageKit storage is not configured on this deployment.' }, 503);
  const rows = await env.DB.prepare('SELECT key FROM media WHERE qbank_id = ?').bind(qbankId).all<{ key: string }>();
  const deletions = await Promise.all(rows.results.map((row) => deleteImageKitFile(row.key)));
  if (deletions.some((deleted) => !deleted)) return json({ error: 'Some images could not be deleted from ImageKit. Try again.' }, 502);
  await env.DB.prepare('DELETE FROM media WHERE qbank_id = ?').bind(qbankId).run();
  return json({ ok: true });
}
