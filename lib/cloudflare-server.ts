import { auditStatement } from './platform-server';
import {
  bankAccessState,
  bankAccessStates,
} from './qbank-access-repository';
import { allocateQuestionIds } from './question-id-repository';
import { env } from 'cloudflare:workers';
import {
  hasR2Storage,
  R2QuotaExceededError,
  r2StorageService,
} from './storage-service';
import {
  canAccessBank,
  canEditBank,
  canManageBank,
  canReviewBank,
  hasAccessManagerRole,
  hasModeratorRole,
  isBankMembershipRole,
  isPlatformRole,
} from '@/features/access/domain/access-policy';
import {
  initialAppState,
  initialCollaborationState,
  normalizeCollaborationState,
  normalizeAppState,
  normalizeEmail,
  normalizePhone,
  normalizeUniversityId,
  type AppState,
  type AppUser,
  type CollaborationState,
  type MemberProfile,
  type QBank,
  type QuestionProposal,
} from './medguard-types';
import { applyEffectiveEntitlement } from './entitlement-server';
import {
  getPlanLimits,
  utcMonthStart,
} from '@/features/subscriptions/domain/plan-config';
import {
  assertSameOrigin,
  readJson,
  readLimitedBytes,
} from '@/server/http/request';
import { json } from '@/server/http/response';

export { assertSameOrigin, readJson } from '@/server/http/request';
export { json } from '@/server/http/response';

const SESSION_COOKIE = '__Host-qraft_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 100_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const PREFORMED_MEDIA_PREFIX = 'preformed-';

function preformedMediaTestId(scopeId: string) {
  return scopeId.startsWith(PREFORMED_MEDIA_PREFIX)
    ? scopeId.slice(PREFORMED_MEDIA_PREFIX.length)
    : '';
}

async function preformedMediaTest(scopeId: string) {
  const testId = preformedMediaTestId(scopeId);
  if (!testId) return null;
  return env.DB.prepare('SELECT owner_id,status,visibility,version FROM preformed_tests WHERE id=?')
    .bind(testId)
    .first<{
      owner_id: string;
      status: 'draft' | 'published' | 'paused' | 'hidden';
      visibility: 'public' | 'private';
      version: number;
    }>();
}

type RecordOperation = {
  type: 'set' | 'delete';
  collection: string;
  id: string;
  value?: unknown;
};
type StoredRecord = {
  type: string;
  id: string;
  qbank_id: string | null;
  owner_id: string | null;
  email: string | null;
  payload: string;
  updated_at: string;
};

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
  const response = await fetch(
    `https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: { authorization, accept: 'application/json' },
    },
  );
  return response.ok || response.status === 404;
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function secureEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1)
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return mismatch === 0;
}

async function sha256(value: string) {
  return bytesToHex(
    await crypto.subtle.digest('SHA-256', encoder.encode(value)),
  );
}

async function sha256Bytes(value: ArrayBuffer) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', value));
}

function detectedImageMime(bytes: ArrayBuffer): string | undefined {
  const value = new Uint8Array(bytes);
  if (value.length >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff)
    return 'image/jpeg';
  if (
    value.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => value[index] === byte,
    )
  )
    return 'image/png';
  const header = decoder.decode(value.slice(0, 12));
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif';
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

async function hashPassword(
  password: string,
  salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18))),
) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    256,
  );
  return { salt, hash: bytesToHex(derived) };
}

function cookieValue(request: Request, name: string) {
  const source = request.headers.get('cookie') ?? '';
  return source
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function sessionCookie(token: string, maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function safeProfile(
  profile: MemberProfile,
  mfaEnrolled: boolean,
  mfaVerified = true,
): Promise<AppUser> {
  const isAdmin = hasAccessManagerRole(profile);
  return applyEffectiveEntitlement({
    ...profile,
    isAdmin,
    provider: 'cloudflare',
    mfaEnrolled,
    mfaVerified,
  });
}

function enrolledTotpSecret(secret: string | null) {
  return secret && !secret.startsWith('pending:') ? secret : undefined;
}

async function profileByEmail(email: string) {
  return env.DB.prepare('SELECT * FROM profiles WHERE email = ? LIMIT 1')
    .bind(normalizeEmail(email))
    .first<{
      uid: string;
      email: string;
      password_hash: string;
      password_salt: string;
      profile_json: string;
      totp_secret: string | null;
    }>();
}

export async function profileById(uid: string) {
  return env.DB.prepare('SELECT * FROM profiles WHERE uid = ? LIMIT 1')
    .bind(uid)
    .first<{
      uid: string;
      email: string;
      password_hash: string;
      password_salt: string;
      profile_json: string;
      totp_secret: string | null;
    }>();
}

const currentUserRequests = new WeakMap<
  object,
  Map<boolean, Promise<AppUser | undefined>>
>();

export function shareCurrentUserRequest(
  source: object,
  target: object,
) {
  const cached = currentUserRequests.get(source);
  if (cached) currentUserRequests.set(target, cached);
}

async function resolveCurrentUser(
  request: Request,
  requireVerified = true,
): Promise<AppUser | undefined> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return undefined;
  const tokenHash = await sha256(token);
  const row =
    await env.DB.prepare(`SELECT p.uid,p.profile_json,p.totp_secret,s.verified,subscription.expires_at
    FROM sessions s JOIN profiles p ON p.uid = s.user_id
    LEFT JOIN subscriptions AS subscription
      ON subscription.user_id=p.uid
      AND subscription.status IN ('active','manually_activated')
    WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`)
      .bind(tokenHash, Math.floor(Date.now() / 1000))
      .first<{
        uid: string;
        profile_json: string;
        totp_secret: string | null;
        verified: number;
        expires_at: string | null;
      }>();
  if (!row || (requireVerified && row.verified !== 1)) return undefined;
  const profile = JSON.parse(row.profile_json) as MemberProfile;
  if (profile.suspended) return undefined;
  return await safeProfile(
    profile,
    Boolean(enrolledTotpSecret(row.totp_secret)),
    row.verified === 1,
  );
}

export function currentUser(
  request: Request,
  requireVerified = true,
): Promise<AppUser | undefined> {
  let requests = currentUserRequests.get(request);
  if (!requests) {
    requests = new Map();
    currentUserRequests.set(request, requests);
  }
  let user = requests.get(requireVerified);
  if (!user) {
    user = resolveCurrentUser(request, requireVerified);
    requests.set(requireVerified, user);
  }
  return user;
}

async function createSession(
  userId: string,
  verified: boolean,
  lifetimeSeconds = SESSION_SECONDS,
) {
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, verified, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(
      await sha256(token),
      userId,
      Math.floor(Date.now() / 1000) + lifetimeSeconds,
      verified ? 1 : 0,
      now,
    )
    .run();
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
  for (let index = 0; index < output.length; index += 1)
    output[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  return output;
}

function encodeBase32(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  bytes.forEach((byte) => {
    bits += byte.toString(2).padStart(8, '0');
  });
  let output = '';
  for (let index = 0; index < bits.length; index += 5)
    output +=
      alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  return output;
}

async function totp(secret: string, offset = 0) {
  const counter = Math.floor(Date.now() / 30_000) + offset;
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey(
    'raw',
    decodeBase32(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, message),
  );
  const position = signature.at(-1)! & 0x0f;
  const number =
    ((signature[position] & 0x7f) << 24) |
    (signature[position + 1] << 16) |
    (signature[position + 2] << 8) |
    signature[position + 3];
  return String(number % 1_000_000).padStart(6, '0');
}

async function verifyTotp(secret: string, code: string) {
  const candidates = await Promise.all(
    [-1, 0, 1].map((offset) => totp(secret, offset)),
  );
  return candidates.some((candidate) => secureEqual(candidate, code));
}

export async function register(request: Request) {
  assertSameOrigin(request);
  const input = await readJson<{
    name?: string;
    email?: string;
    password?: string;
    universityId?: string;
    phone?: string;
    setupToken?: string;
  }>(request);
  const email = normalizeEmail(input.email ?? '');
  const name = input.name?.trim() ?? '';
  const password = input.password ?? '';
  const universityId = normalizeUniversityId(input.universityId ?? '');
  const phone = normalizePhone(input.phone ?? '');
  let universityIdRegistered = false;
  if (
    !name ||
    name.length > 120 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 10 ||
    password.length > 128
  )
    return json(
      {
        error:
          'Enter a valid name, email, and a password between 10 and 128 characters.',
      },
      400,
    );
  if (await profileByEmail(email))
    return json({ error: 'An account with this email already exists.' }, 409);
  const rootEmail = normalizeEmail(env.ROOT_ADMIN_EMAIL ?? '');
  const isRoot = Boolean(rootEmail && email === rootEmail);
  if (
    isRoot &&
    (!env.ROOT_ADMIN_SETUP_TOKEN || env.ROOT_ADMIN_SETUP_TOKEN.length < 24)
  )
    return json(
      { error: 'Superadmin registration is not configured securely.' },
      503,
    );
  if (
    isRoot &&
    (!env.ROOT_ADMIN_SETUP_TOKEN ||
      !secureEqual(input.setupToken ?? '', env.ROOT_ADMIN_SETUP_TOKEN))
  )
    return json({ error: 'The Superadmin setup code is invalid.' }, 403);
  if (isRoot) {
    const security = await env.DB.prepare(
      "SELECT payload FROM records WHERE type = 'system' AND id = 'security'",
    ).first<{ payload: string }>();
    if (
      security &&
      (JSON.parse(security.payload) as { superAdminUid?: string }).superAdminUid
    )
      return json(
        { error: 'The Superadmin account has already been created.' },
        409,
      );
  }
  if (!isRoot) {
    if (!universityId || phone.length < 7)
      return json(
        { error: 'A valid university ID and mobile number are required.' },
        400,
      );
    const control = await env.DB.prepare(
      "SELECT payload FROM records WHERE type = 'system' AND id = 'accessControl'",
    ).first<{ payload: string }>();
    const blocked = control
      ? (JSON.parse(control.payload) as CollaborationState['blockedAccess'])
      : { emails: [], phones: [], universityIds: [] };
    if (
      blocked.emails.includes(email) ||
      blocked.phones.includes(phone) ||
      blocked.universityIds.includes(universityId)
    )
      return json(
        { error: 'This email, university ID, or mobile number is blocked.' },
        403,
      );
    const existingClaim = await env.DB.prepare(
      'SELECT user_id FROM university_claims WHERE university_id = ?',
    )
      .bind(universityId)
      .first<{ user_id: string }>();
    if (existingClaim)
      return json({ error: 'This university ID has already been used.' }, 409);
    const allowed = await env.DB.prepare(
      "SELECT payload FROM records WHERE type = 'universityIds' AND id = ?",
    )
      .bind(universityId)
      .first<{ payload: string }>();
    if (
      allowed &&
      (JSON.parse(allowed.payload) as { claimedById?: string | null })
        .claimedById
    )
      return json({ error: 'This university ID has already been used.' }, 409);
    universityIdRegistered = Boolean(allowed);
  }
  const now = new Date().toISOString();
  const uid = crypto.randomUUID();
  const passwordData = await hashPassword(password);
  const profile: MemberProfile = {
    uid,
    email,
    displayName: name,
    universityId: isRoot ? 'SUPERADMIN' : universityId,
    phone,
    role: isRoot ? 'super_admin' : 'student',
    status: isRoot ? 'approved' : 'pending',
    createdAt: now,
    tier: 'free',
    platformRoles: [],
    universityIdRegistered: isRoot ? true : universityIdRegistered,
  };
  const statements = [
    env.DB.prepare(
      'INSERT INTO profiles (uid, email, password_hash, password_salt, profile_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      uid,
      email,
      passwordData.hash,
      passwordData.salt,
      JSON.stringify(profile),
      now,
      now,
    ),
  ];
  if (isRoot)
    statements.push(
      env.DB.prepare(
        "INSERT INTO records (type, id, payload, updated_at) VALUES ('system', 'security', ?, ?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
      ).bind(JSON.stringify({ superAdminUid: uid, updatedAt: now }), now),
    );
  else {
    const allowed = {
      id: universityId,
      claimedById: uid,
      claimedByName: name,
      claimedAt: now,
    };
    statements.push(
      env.DB.prepare(
        'INSERT INTO university_claims (university_id, user_id, claimed_at) VALUES (?, ?, ?)',
      ).bind(universityId, uid, now),
    );
    statements.push(
      env.DB.prepare(
        "UPDATE records SET payload = ?, updated_at = ? WHERE type = 'universityIds' AND id = ? AND json_extract(payload, '$.claimedById') IS NULL",
      ).bind(JSON.stringify(allowed), now, universityId),
    );
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (
      error instanceof Error &&
      /profiles\.email|idx_profiles_email/i.test(error.message)
    )
      return json({ error: 'An account with this email already exists.' }, 409);
    if (
      !isRoot &&
      error instanceof Error &&
      /university_claims|university id|constraint/i.test(error.message)
    )
      return json({ error: 'This university ID has already been used.' }, 409);
    throw error;
  }
  const token = await createSession(
    uid,
    !isRoot,
    isRoot ? 300 : SESSION_SECONDS,
  );
  return json({ user: await safeProfile(profile, false, !isRoot) }, 201, {
    'set-cookie': sessionCookie(token, isRoot ? 300 : SESSION_SECONDS),
  });
}

export async function login(request: Request) {
  assertSameOrigin(request);
  const input = await readJson<{ email?: string; password?: string }>(request);
  const row = await profileByEmail(input.email ?? '');
  if (!row) {
    // Keep the unknown-account path computationally comparable to a real
    // password check so login timing does not become an email oracle.
    await hashPassword(input.password ?? '', 'qraft-login-timing-v1');
    return json({ error: 'Incorrect email or password.' }, 401);
  }
  const calculated = await hashPassword(
    input.password ?? '',
    row.password_salt,
  );
  if (!secureEqual(calculated.hash, row.password_hash))
    return json({ error: 'Incorrect email or password.' }, 401);
  const profile = JSON.parse(row.profile_json) as MemberProfile;
  if (profile.suspended)
    return json({ error: 'This account has been suspended.' }, 403);
  const mfaSecret = enrolledTotpSecret(row.totp_secret);
  const isRoot = profile.role === 'super_admin';
  const needsMfa = isRoot && Boolean(mfaSecret);
  const token = await createSession(
    row.uid,
    !isRoot,
    isRoot ? 300 : SESSION_SECONDS,
  );
  if (needsMfa)
    return json({ error: 'MFA_REQUIRED' }, 428, {
      'set-cookie': sessionCookie(token, 300),
    });
  return json({ user: await safeProfile(profile, Boolean(mfaSecret), !isRoot) }, 200, {
    'set-cookie': sessionCookie(token, isRoot ? 300 : SESSION_SECONDS),
  });
}

export async function verifyMfa(request: Request) {
  assertSameOrigin(request);
  const token = cookieValue(request, SESSION_COOKIE);
  const input = await readJson<{ code?: string }>(request);
  if (!token) return json({ error: 'Start sign-in again.' }, 401);
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT p.uid,p.profile_json,p.totp_secret FROM sessions s JOIN profiles p ON p.uid = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`,
  )
    .bind(tokenHash, Math.floor(Date.now() / 1000))
    .first<{ uid: string; profile_json: string; totp_secret: string | null }>();
  const secret = enrolledTotpSecret(row?.totp_secret ?? null);
  if (!row || !secret || !(await verifyTotp(secret, input.code?.trim() ?? '')))
    return json({ error: 'The authenticator code is invalid.' }, 401);
  const replacementToken = bytesToBase64Url(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO sessions (token_hash,user_id,expires_at,verified,created_at) VALUES (?,?,?,?,?)',
    ).bind(
      await sha256(replacementToken),
      row.uid,
      Math.floor(Date.now() / 1000) + SESSION_SECONDS,
      1,
      now,
    ),
    env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash),
  ]);
  return json(
    {
      user: await safeProfile(
        JSON.parse(row.profile_json) as MemberProfile,
        true,
      ),
    },
    200,
    { 'set-cookie': sessionCookie(replacementToken) },
  );
}

export async function beginMfa(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request, false);
  if (
    !user ||
    user.role !== 'super_admin' ||
    (user.mfaEnrolled && !user.mfaVerified)
  )
    return json({ error: 'Superadmin authentication is required.' }, 403);
  const secret = encodeBase32(crypto.getRandomValues(new Uint8Array(20)));
  await env.DB.prepare(
    'UPDATE profiles SET totp_secret = ?, updated_at = ? WHERE uid = ?',
  )
    .bind(`pending:${secret}`, new Date().toISOString(), user.uid)
    .run();
  return json({
    secretKey: secret,
    qrUrl: `otpauth://totp/Qraft:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Qraft&algorithm=SHA1&digits=6&period=30`,
  });
}

export async function completeMfa(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request, false);
  if (!user || user.role !== 'super_admin')
    return json({ error: 'Superadmin authentication is required.' }, 403);
  const row = await profileById(user.uid);
  const secret = row?.totp_secret?.startsWith('pending:')
    ? row.totp_secret.slice(8)
    : undefined;
  const input = await readJson<{ code?: string }>(request);
  if (!secret || !(await verifyTotp(secret, input.code?.trim() ?? '')))
    return json({ error: 'The authenticator code is invalid.' }, 400);
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return json({ error: 'Start sign-in again.' }, 401);
  const tokenHash = await sha256(token);
  const replacementToken = bytesToBase64Url(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE profiles SET totp_secret = ?, updated_at = ? WHERE uid = ?',
    ).bind(secret, now, user.uid),
    env.DB.prepare(
      'INSERT INTO sessions (token_hash,user_id,expires_at,verified,created_at) VALUES (?,?,?,?,?)',
    ).bind(
      await sha256(replacementToken),
      user.uid,
      Math.floor(Date.now() / 1000) + SESSION_SECONDS,
      1,
      now,
    ),
    env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash),
  ]);
  return json({ ok: true }, 200, {
    'set-cookie': sessionCookie(replacementToken),
  });
}

export async function logout(request: Request) {
  assertSameOrigin(request);
  const token = cookieValue(request, SESSION_COOKIE);
  if (token)
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256(token))
      .run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

export async function cleanDeletedState(state: AppState): Promise<AppState> {
  const rows = await env.DB.prepare('SELECT id FROM retired_questions').all<{
    id: string;
  }>();
  const deleted = new Set(rows.results.map((x) => x.id));
  const keep = (id: string) => !deleted.has(id);
  return {
    ...state,
    customQuestions: (state.customQuestions ?? []).filter((q) => keep(q.id)),
    questionOverrides: Object.fromEntries(
      Object.entries(state.questionOverrides ?? {}).filter(([id]) => keep(id)),
    ),
    progress: Object.fromEntries(
      Object.entries(state.progress ?? {}).filter(([id]) => keep(id)),
    ),
    reports: (state.reports ?? []).map((r) =>
      keep(r.questionId) ? r : { ...r, questionId: '#deleted' },
    ),
    revisions: (state.revisions ?? []).map((r) =>
      keep(r.questionId) ? r : { ...r, questionId: '#deleted' },
    ),
    tests: state.tests.map((t) => ({
      ...t,
      questionIds: t.questionIds.filter(keep),
      currentIndex: Math.max(
        0,
        Math.min(t.currentIndex, t.questionIds.filter(keep).length - 1),
      ),
      answers: Object.fromEntries(
        Object.entries(t.answers).filter(([id]) => keep(id)),
      ),
      revealed: t.revealed.filter(keep),
      graded: t.graded.filter(keep),
    })),
  };
}

export async function loadState(request: Request) {
  const user = await currentUser(request);
  if (!user) return json({ error: 'Authentication required.' }, 401);
  const row = await env.DB.prepare(
    'SELECT payload,revision,updated_at FROM app_states WHERE user_id = ?',
  )
    .bind(user.uid)
    .first<{ payload: string; revision: number; updated_at: string }>();
  return json({
    state: row
      ? await cleanDeletedState(JSON.parse(row.payload) as AppState)
      : null,
    revision: row?.revision ?? 0,
    updatedAt: row?.updated_at,
  });
}

export async function saveState(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved')
    return json({ error: 'Approved account required.' }, 403);
  const input = await readJson<{
    state?: AppState;
    baseRevision?: number;
    operationId?: string;
  }>(request, 2_000_000);
  if (!input.state || input.state.version !== 1)
    return json({ error: 'Invalid state payload.' }, 400);
  const operationId = typeof input.operationId === 'string' && /^[a-f0-9-]{20,80}$/i.test(input.operationId)
    ? input.operationId
    : crypto.randomUUID();
  const effectivePlan = user.effectivePlan ?? user.tier;
  const planLimits = getPlanLimits(effectivePlan);
  const storedStateRow = await env.DB.prepare(
    'SELECT payload,revision,last_operation_id,updated_at FROM app_states WHERE user_id=?',
  )
    .bind(user.uid)
    .first<{ payload: string; revision: number; last_operation_id: string | null; updated_at: string }>();
  const storedState = storedStateRow
    ? (JSON.parse(storedStateRow.payload) as AppState)
    : undefined;
  const currentRevision = storedStateRow?.revision ?? 0;
  const alreadyApplied = await env.DB.prepare(
    'SELECT revision FROM state_sync_operations WHERE user_id=? AND operation_id=?',
  ).bind(user.uid, operationId).first<{ revision: number }>();
  if (alreadyApplied)
    return json({
      ok: true,
      state: storedState ?? input.state,
      revision: currentRevision,
      updatedAt: storedStateRow?.updated_at ?? new Date().toISOString(),
      duplicate: true,
    });
  if (input.baseRevision !== undefined && input.baseRevision !== currentRevision)
    return json({
      error: 'STATE_CONFLICT',
      state: storedState ?? initialAppState(),
      revision: currentRevision,
      updatedAt: storedStateRow?.updated_at,
    }, 409);
  input.state.settings.theme = 'system';
  if (
    !Array.isArray(input.state.tests) ||
    input.state.tests.some(
      (t) =>
        !t ||
        typeof t.id !== 'string' ||
        !t.id ||
        !Array.isArray(t.questionIds) ||
        t.questionIds.some((id) => typeof id !== 'string' || !id) ||
        new Set(t.questionIds).size !== t.questionIds.length,
    ) ||
    new Set(input.state.tests.map((test) => test.id)).size !==
      input.state.tests.length
  )
    return json({ error: 'Invalid tests.' }, 400);
  const flashcardDecks = input.state.flashcardDecks ?? [];
  const flashcards = input.state.flashcards ?? [];
  const flashcardSchedules = input.state.flashcardSchedules ?? {};
  const flashcardReviewLog = input.state.flashcardReviewLog ?? [];
  const flashcardSettings = input.state.flashcardSettings;
  if (
    !Array.isArray(flashcardDecks) ||
    flashcardDecks.length > 500 ||
    flashcardDecks.some(
      (deck) =>
        !deck ||
        typeof deck.id !== 'string' ||
        !deck.id ||
        typeof deck.name !== 'string' ||
        !deck.name.trim() ||
        deck.name.length > 120 ||
        typeof deck.qbankId !== 'string',
    ) ||
    !Array.isArray(flashcards) ||
    flashcards.length > 5_000 ||
    flashcards.some(
      (card) =>
        !card ||
        typeof card.id !== 'string' ||
        !card.id ||
        typeof card.deckId !== 'string' ||
        typeof card.qbankId !== 'string' ||
        !['basic', 'cloze', 'image'].includes(card.type) ||
        typeof card.front !== 'string' ||
        !card.front.trim() ||
        card.front.length > 20_000 ||
        typeof card.back !== 'string' ||
        !card.back.trim() ||
        card.back.length > 40_000 ||
        !Array.isArray(card.tags) ||
        card.tags.length > 20 ||
        card.tags.some((tag) => typeof tag !== 'string' || tag.length > 80) ||
        (card.image !== undefined &&
          (!card.image ||
            typeof card.image.url !== 'string' ||
            !/^https:\/\//i.test(card.image.url))),
    ) ||
    !flashcardSchedules ||
    typeof flashcardSchedules !== 'object' ||
    Array.isArray(flashcardSchedules) ||
    Object.keys(flashcardSchedules).length > 5_000 ||
    !Array.isArray(flashcardReviewLog) ||
    flashcardReviewLog.length > 5_000 ||
    (flashcardSettings !== undefined &&
      (!Number.isFinite(flashcardSettings.desiredRetention) ||
        flashcardSettings.desiredRetention < 0.75 ||
        flashcardSettings.desiredRetention > 0.99 ||
        !Number.isInteger(flashcardSettings.dailyNewLimit) ||
        flashcardSettings.dailyNewLimit < 1 ||
        flashcardSettings.dailyNewLimit > 500 ||
        !Number.isInteger(flashcardSettings.dailyReviewLimit) ||
        flashcardSettings.dailyReviewLimit < 1 ||
        flashcardSettings.dailyReviewLimit > 1_000))
  )
    return json({ error: 'Invalid flashcard data.' }, 400);
  const decksById = new Map(flashcardDecks.map((deck) => [deck.id, deck]));
  const cardsById = new Map(flashcards.map((card) => [card.id, card]));
  if (
    decksById.size !== flashcardDecks.length ||
    cardsById.size !== flashcards.length ||
    flashcardDecks.some(
      (deck) =>
        deck.parentId === deck.id ||
        (deck.parentId !== undefined &&
          decksById.get(deck.parentId)?.qbankId !== deck.qbankId),
    ) ||
    flashcards.some(
      (card) => decksById.get(card.deckId)?.qbankId !== card.qbankId,
    )
  )
    return json({ error: 'Every flashcard must belong to a valid deck.' }, 400);
  for (const deck of flashcardDecks) {
    const ancestors = new Set<string>([deck.id]);
    let parentId = deck.parentId;
    while (parentId) {
      if (ancestors.has(parentId))
        return json({ error: 'Flashcard deck nesting cannot contain a cycle.' }, 400);
      ancestors.add(parentId);
      parentId = decksById.get(parentId)?.parentId;
    }
  }
  if (
    Object.entries(flashcardSchedules).some(
      ([id, schedule]) =>
        !cardsById.has(id) ||
        !schedule ||
        schedule.cardId !== id ||
        !Number.isFinite(Date.parse(schedule.due)) ||
        !['new', 'learning', 'review', 'relearning'].includes(schedule.state) ||
        !Number.isFinite(schedule.stability) ||
        !Number.isFinite(schedule.difficulty) ||
        !Number.isFinite(schedule.scheduledDays) ||
        !Number.isInteger(schedule.reps) ||
        !Number.isInteger(schedule.lapses),
    ) ||
    flashcardReviewLog.some(
      (log) =>
        !log ||
        !cardsById.has(log.cardId) ||
        !['again', 'hard', 'good', 'easy'].includes(log.rating) ||
        !Number.isFinite(Date.parse(log.reviewedAt)),
    )
  )
    return json({ error: 'Invalid flashcard review history.' }, 400);
  const importedGuids = flashcards
    .map((card) => card.importedGuid)
    .filter((guid): guid is string => Boolean(guid));
  if (new Set(importedGuids).size !== importedGuids.length)
    return json(
      { error: 'Duplicate imported flashcards are not allowed.' },
      409,
    );
  const oldDeckCount = storedState?.flashcardDecks?.length ?? 0;
  const oldCardCount = storedState?.flashcards?.length ?? 0;
  if (
    flashcardDecks.length > Math.max(oldDeckCount, planLimits.maxFlashcardDecks) ||
    flashcards.length > Math.max(oldCardCount, planLimits.maxFlashcards)
  )
    return json(
      {
        error: planLimits.canUseFlashcards
          ? `Your ${planLimits.name} plan allows ${planLimits.maxFlashcardDecks} decks and ${planLimits.maxFlashcards} cards.`
          : 'Flashcards are available with Pro.',
      },
      403,
    );
  if (
    !planLimits.canUsePrivateNotes &&
    Object.entries(input.state.progress).some(
      ([questionId, progress]) => {
        const previous = storedState?.progress?.[questionId];
        return (
          (progress.note ?? '') !== (previous?.note ?? '') ||
          JSON.stringify(progress.noteImages ?? []) !==
            JSON.stringify(previous?.noteImages ?? [])
        );
      },
    )
  )
    return json({ error: 'Private Notes are available with Pro.' }, 403);
  const normalizedTestTitles = input.state.tests.map((test) =>
    typeof test.title === 'string'
      ? test.title.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
      : '',
  );
  const namedTests = normalizedTestTitles.filter(Boolean);
  if (new Set(namedTests).size !== namedTests.length)
    return json(
      { error: 'Test titles must be unique. Choose a different title.' },
      409,
    );
  input.state = await cleanDeletedState(input.state);
  if (storedState && sameJson(input.state, storedState))
    return json({
      ok: true,
      state: storedState,
      revision: currentRevision,
      updatedAt: storedStateRow?.updated_at,
      unchanged: true,
    }, 200, { 'x-qraft-unchanged': '1' });
  const oldTests = await env.DB.prepare(
    'SELECT test_id,question_count,started_at FROM test_registry WHERE user_id=?',
  )
    .bind(user.uid)
    .all<{ test_id: string; question_count: number; started_at: string | null }>();
  const known = new Map(
    oldTests.results.map((t) => [t.test_id, t.question_count]),
  );
  if (
    input.state.tests.some(
      (test) =>
        test.questionIds.length >
        Math.max(planLimits.maxQuestionsPerExam, known.get(test.id) ?? 0),
    )
  )
    return json(
      {
        error: `${planLimits.name} allows ${planLimits.maxQuestionsPerExam} questions per exam.`,
      },
      403,
    );
  const newTests = input.state.tests.filter((test) => !known.has(test.id));
  const lifetimeStarted = oldTests.results.length;
  if (
    planLimits.lifetimeExamLimit !== null &&
    lifetimeStarted + newTests.length > planLimits.lifetimeExamLimit
  )
    return json(
      { error: "You've reached your lifetime exam limit." },
      403,
    );
  const monthStart = utcMonthStart();
  const monthlyStarted = oldTests.results.filter(
    (test) => (test.started_at ?? '') >= monthStart,
  ).length;
  if (
    planLimits.monthlyExamLimit !== null &&
    monthlyStarted + newTests.length > planLimits.monthlyExamLimit
  )
    return json(
      { error: "You've reached your monthly exam limit." },
      403,
    );
  const now = new Date().toISOString();
  const nextRevision = currentRevision + 1;
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO test_registry(user_id,test_id,question_count,started_at) SELECT ?,json_extract(value,'$.id'),json_array_length(value,'$.questionIds'),coalesce(json_extract(value,'$.startedAt'),?) FROM json_each(?)",
      ).bind(user.uid, now, JSON.stringify(input.state.tests)),
      env.DB.prepare(
        'INSERT INTO app_states (user_id,payload,updated_at,revision,last_operation_id) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,revision=excluded.revision,last_operation_id=excluded.last_operation_id',
      ).bind(user.uid, JSON.stringify(input.state), now, nextRevision, operationId),
      env.DB.prepare(
        'INSERT INTO state_sync_operations(user_id,operation_id,revision,created_at) VALUES(?,?,?,?)',
      ).bind(user.uid, operationId, nextRevision, now),
    ]);
  } catch (error) {
    const duplicate = await env.DB.prepare(
      'SELECT revision FROM state_sync_operations WHERE user_id=? AND operation_id=?',
    ).bind(user.uid, operationId).first<{ revision: number }>();
    const latest = await env.DB.prepare(
      'SELECT payload,revision,updated_at FROM app_states WHERE user_id=?',
    ).bind(user.uid).first<{ payload: string; revision: number; updated_at: string }>();
    if (duplicate && latest)
      return json({ ok: true, state: JSON.parse(latest.payload), revision: latest.revision, updatedAt: latest.updated_at, duplicate: true });
    if (String(error).includes('APP_STATE_CONFLICT') && latest)
      return json({ error: 'STATE_CONFLICT', state: JSON.parse(latest.payload), revision: latest.revision, updatedAt: latest.updated_at }, 409);
    throw error;
  }
  return json({ ok: true, state: input.state, revision: nextRevision, updatedAt: now });
}

export async function saveStatePatch(
  request: Request,
  kind: 'exam' | 'flashcards' | 'daily-goal',
) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved')
    return json({ error: 'Approved account required.' }, 403);
  const input = await readJson<Record<string, unknown>>(request, 2_000_000);
  const row = await env.DB.prepare('SELECT payload FROM app_states WHERE user_id=?')
    .bind(user.uid)
    .first<{ payload: string }>();
  const state = row ? normalizeAppState(JSON.parse(row.payload) as AppState) : initialAppState();
  if (kind === 'exam') {
    if (!Array.isArray(input.tests) || !isRecord(input.progress))
      return json({ error: 'Invalid exam checkpoint.' }, 400);
    Object.assign(state, {
      tests: input.tests,
      progress: input.progress,
      reports: Array.isArray(input.reports) ? input.reports : state.reports,
      revisions: Array.isArray(input.revisions) ? input.revisions : state.revisions,
      questionOverrides: isRecord(input.questionOverrides) ? input.questionOverrides : state.questionOverrides,
      customQuestions: Array.isArray(input.customQuestions) ? input.customQuestions : state.customQuestions,
      flashcardDecks: Array.isArray(input.flashcardDecks) ? input.flashcardDecks : state.flashcardDecks,
      flashcards: Array.isArray(input.flashcards) ? input.flashcards : state.flashcards,
      studyStreak: isRecord(input.studyStreak)
        ? normalizeAppState({ studyStreak: input.studyStreak as unknown as AppState['studyStreak'] }).studyStreak
        : state.studyStreak,
      clientUpdatedAt: typeof input.clientUpdatedAt === 'string' ? input.clientUpdatedAt : state.clientUpdatedAt,
    });
  } else if (kind === 'flashcards') {
    if (!isRecord(input.flashcardSchedules) || !Array.isArray(input.flashcardReviewLog))
      return json({ error: 'Invalid flashcard checkpoint.' }, 400);
    Object.assign(state, {
      flashcardSchedules: input.flashcardSchedules,
      flashcardReviewLog: input.flashcardReviewLog,
      clientUpdatedAt: typeof input.clientUpdatedAt === 'string' ? input.clientUpdatedAt : state.clientUpdatedAt,
    });
  } else if (kind === 'daily-goal') {
    const dailyGoal = Number(input.dailyGoal);
    if (!Number.isInteger(dailyGoal) || dailyGoal < 5 || dailyGoal > 100 || dailyGoal % 5 !== 0)
      return json({ error: 'Choose a daily goal between 5 and 100.' }, 400);
    state.settings = { ...state.settings, dailyGoal };
    state.clientUpdatedAt = new Date().toISOString();
  }
  const answerSelections = input.answerSelections;
  if (
    kind === 'exam' &&
    answerSelections !== undefined &&
    (!Array.isArray(answerSelections) ||
      answerSelections.length > 500 ||
      answerSelections.some(
        (item) =>
          !isRecord(item) ||
          typeof item.qbankId !== 'string' ||
          !item.qbankId ||
          typeof item.questionId !== 'string' ||
          !item.questionId ||
          !Number.isInteger(Number(item.answer)) ||
          Number(item.answer) < 0 ||
          Number(item.answer) > 25,
      ))
  )
    return json({ error: 'Invalid answer statistics checkpoint.' }, 400);
  const forwarded = new Request(request.url, {
    method: 'PUT',
    headers: request.headers,
    body: JSON.stringify({
      state,
      baseRevision: input.baseRevision,
      operationId: input.operationId,
    }),
  });
  shareCurrentUserRequest(request, forwarded);
  const stateResponse = await saveState(forwarded);
  if (!stateResponse.ok || kind !== 'exam' || !Array.isArray(answerSelections))
    return stateResponse;
  const selections = answerSelections
    .filter(isRecord)
    .map(item => ({
      qbankId: typeof item.qbankId === 'string' ? item.qbankId : '',
      questionId: typeof item.questionId === 'string' ? item.questionId : '',
      answer: Number(item.answer),
    }));
  if (!selections.length) return stateResponse;
  const ids = selections.map(item => `${item.qbankId}:${item.questionId}`);
  const rows = await env.DB.prepare(
    "SELECT id,payload FROM records WHERE type='answerStats' AND id IN (SELECT value FROM json_each(?))",
  ).bind(JSON.stringify(ids)).all<{ id: string; payload: string }>();
  const existing = new Map(rows.results.map(row => [row.id, JSON.parse(row.payload) as { selections?: Record<string, number> }]));
  const operations = selections.map(item => {
    const id = `${item.qbankId}:${item.questionId}`;
    return {
      collection: 'answerStats',
      id,
      type: 'set',
      value: {
        id,
        qbankId: item.qbankId,
        questionId: item.questionId,
        selections: { ...existing.get(id)?.selections, [user.uid]: item.answer },
      },
    };
  });
  const collaborationRequest = new Request(request.url, {
    method: 'PUT',
    headers: request.headers,
    body: JSON.stringify({ operations }),
  });
  shareCurrentUserRequest(request, collaborationRequest);
  const collaborationResponse = await saveCollaboration(collaborationRequest);
  return collaborationResponse.ok ? stateResponse : collaborationResponse;
}

export async function cleanStateSyncOperations() {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM state_sync_operations WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days')",
    ),
    env.DB.prepare(
      "DELETE FROM classification_operations WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days')",
    ),
  ]);
}

function recordData(value: Record<string, unknown>) {
  return {
    qbankId: typeof value.qbankId === 'string' ? value.qbankId : undefined,
    ownerId:
      typeof value.ownerId === 'string'
        ? value.ownerId
        : typeof value.createdById === 'string'
          ? value.createdById
          : typeof value.proposedById === 'string'
            ? value.proposedById
            : undefined,
    email:
      typeof value.email === 'string' ? normalizeEmail(value.email) : undefined,
  };
}

async function recordsByTypes(types: string[]) {
  const placeholders = types.map(() => '?').join(',');
  const result = await env.DB.prepare(
    `SELECT type,id,payload FROM records WHERE type IN (${placeholders})`,
  )
    .bind(...types)
    .all<StoredRecord>();
  return result.results.map((row) => ({
    collection: row.type,
    id: row.id,
    value: JSON.parse(row.payload) as unknown,
  }));
}

async function scopedRecordsByTypes(
  qbankIds: Iterable<string>,
  types: string[],
) {
  const ids = [...new Set([...qbankIds].filter(Boolean))];
  const scope = ids.length
    ? `qbank_id IS NULL OR qbank_id IN (${ids.map(() => '?').join(',')})`
    : 'qbank_id IS NULL';
  const requestedTypes = types.map(() => '?').join(',');
  const result = await env.DB.prepare(
    `SELECT type,id,payload FROM records WHERE (${scope}) AND type IN (${requestedTypes})`,
  )
    .bind(...ids, ...types)
    .all<StoredRecord>();
  return result.results.map((row) => ({
    collection: row.type,
    id: row.id,
    value: JSON.parse(row.payload) as unknown,
  }));
}

function recordsToState(
  rows: Awaited<ReturnType<typeof scopedRecordsByTypes>>,
  profilesRows: MemberProfile[] = [],
) {
  const state = initialCollaborationState();
  const recordsByType = new Map<string, typeof rows>();
  for (const row of rows) {
    const records = recordsByType.get(row.collection);
    if (records) records.push(row);
    else recordsByType.set(row.collection, [row]);
  }
  const values = <T>(type: string) =>
    (recordsByType.get(type) ?? []).map((row) => row.value as T);
  const one = <T>(type: string, id: string) =>
    recordsByType.get(type)?.find((row) => row.id === id)?.value as
      | T
      | undefined;
  const qbanks = values<QBank>('qbanks');
  state.qbanks = [
    ...state.qbanks.filter(
      (bank) => !qbanks.some((stored) => stored.id === bank.id),
    ),
    ...qbanks,
  ];
  state.qbankFolders = values<CollaborationState['qbankFolders'][number]>('qbankFolders');
  state.memberships =
    values<CollaborationState['memberships'][number]>('qbankMemberships');
  state.invitations =
    values<CollaborationState['invitations'][number]>('qbankInvitations');
  state.members = profilesRows;
  state.allowedUniversityIds =
    values<CollaborationState['allowedUniversityIds'][number]>('universityIds');
  const registeredUniversityIds = new Set(
    state.allowedUniversityIds.map((item) => normalizeUniversityId(item.id)),
  );
  state.members = state.members.map((member) => ({
    ...member,
    universityIdRegistered:
      member.role === 'super_admin' ||
      registeredUniversityIds.has(normalizeUniversityId(member.universityId)),
  }));
  state.adminInvites =
    values<CollaborationState['adminInvites'][number]>('adminInvites');
  state.proposals =
    values<CollaborationState['proposals'][number]>('questionProposals');
  state.roleApplications =
    values<CollaborationState['roleApplications'][number]>('roleApplications');
  state.approvedQuestions =
    values<CollaborationState['approvedQuestions'][number]>('sharedQuestions');
  state.specialties =
    values<CollaborationState['specialties'][number]>('qbankSpecialties');
  state.topics = values<CollaborationState['topics'][number]>('qbankTopics');
  state.answerStats = Object.fromEntries(
    values<CollaborationState['answerStats'][string]>('answerStats').map(
      (item) => [item.id, item],
    ),
  );
  state.sharedNotes = Object.fromEntries(
    values<CollaborationState['sharedNotes'][string]>('sharedNotes').map(
      (item) => [item.id, item],
    ),
  );
  state.auditLog = values<CollaborationState['auditLog'][number]>('auditLog');
  state.blockedAccess =
    one<CollaborationState['blockedAccess']>('system', 'accessControl') ??
    state.blockedAccess;
  state.security =
    one<CollaborationState['security']>('system', 'security') ?? state.security;
  state.lastSyncAt = new Date().toISOString();
  return normalizeCollaborationState(state);
}

type StateRecord = {
  collection: string;
  id: string;
  value: unknown;
};

async function recordsByKeys(
  keys: Array<{ collection: string; id: string }>,
): Promise<StateRecord[]> {
  const unique = [
    ...new Map(
      keys
        .filter((key) => key.collection && key.id)
        .map((key) => [`${key.collection}\u0000${key.id}`, key]),
    ).values(),
  ];
  if (!unique.length) return [];
  const result = await env.DB.prepare(
    `SELECT record.type,record.id,record.payload
      FROM json_each(?) AS requested
      CROSS JOIN records AS record INDEXED BY idx_records_type_id
      WHERE record.type=json_extract(requested.value,'$.collection')
        AND record.id=json_extract(requested.value,'$.id')`,
  )
    .bind(JSON.stringify(unique))
    .all<{ type: string; id: string; payload: string }>();
  return result.results.map((row) => ({
    collection: row.type,
    id: row.id,
    value: JSON.parse(row.payload) as unknown,
  }));
}

async function collaborationStateForOperations(
  user: AppUser,
  operations: RecordOperation[],
) {
  const requested = operations
    .filter((operation) => operation.collection !== 'profiles')
    .map((operation) => ({
      collection: operation.collection,
      id: operation.id,
    }));
  for (const operation of operations) {
    if (operation.type !== 'set' || !isRecord(operation.value)) continue;
    if (
      operation.collection === 'qbankMemberships' &&
      typeof operation.value.inviteId === 'string'
    )
      requested.push({
        collection: 'qbankInvitations',
        id: operation.value.inviteId,
      });
    if (
      operation.collection === 'answerStats' &&
      typeof operation.value.questionId === 'string'
    )
      requested.push({
        collection: 'sharedQuestions',
        id: operation.value.questionId,
      });
  }
  if (operations.some((operation) => operation.collection === 'roleApplications'))
    requested.push({ collection: 'system', id: 'security' });

  const directRows = await recordsByKeys(requested);
  const qbankIds = new Set<string>();
  for (const operation of operations) {
    if (operation.collection === 'qbanks') qbankIds.add(operation.id);
    if (
      operation.type === 'set' &&
      isRecord(operation.value) &&
      typeof operation.value.qbankId === 'string'
    )
      qbankIds.add(operation.value.qbankId);
  }
  for (const row of directRows) {
    if (isRecord(row.value) && typeof row.value.qbankId === 'string')
      qbankIds.add(row.value.qbankId);
  }

  const access = await bankAccessStates(qbankIds);
  const accessRows: StateRecord[] = [
    ...access.qbanks.map((value) => ({
      collection: 'qbanks',
      id: value.id,
      value,
    })),
    ...access.memberships.map((value) => ({
      collection: 'qbankMemberships',
      id: value.id,
      value,
    })),
  ];

  const needsAllProfiles =
    hasAccessManagerRole(user) ||
    operations.some((operation) => operation.collection === 'system');
  const profileIds = operations
    .filter((operation) => operation.collection === 'profiles')
    .map((operation) => operation.id);
  const profilesResult = needsAllProfiles
    ? await env.DB.prepare('SELECT profile_json FROM profiles').all<{
        profile_json: string;
      }>()
    : profileIds.length
      ? await env.DB.prepare(
          `SELECT profile_json FROM profiles WHERE uid IN (${profileIds.map(() => '?').join(',')})`,
        )
          .bind(...profileIds)
          .all<{ profile_json: string }>()
      : { results: [] as Array<{ profile_json: string }> };
  const profiles = profilesResult.results.map(
    (row) => JSON.parse(row.profile_json) as MemberProfile,
  );
  const profileContextRows = profiles.length
    ? await recordsByTypes(['universityIds'])
    : [];
  const folderContextRows = operations.some(
    (operation) =>
      operation.collection === 'qbankFolders' ||
      operation.collection === 'qbanks',
  )
    ? await recordsByTypes(['qbankFolders'])
    : [];
  const rows = [
    ...new Map(
      [...directRows, ...accessRows, ...profileContextRows, ...folderContextRows].map((row) => [
        `${row.collection}\u0000${row.id}`,
        row,
      ]),
    ).values(),
  ];
  return recordsToState(rows, profiles);
}

export async function updateOwnProfile(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user) return json({ error: 'Authentication required.' }, 401);
  const input = await readJson<{ displayName?: string; phone?: string }>(
    request,
  );
  const displayName = input.displayName?.trim() ?? '';
  const phone = normalizePhone(input.phone ?? '');
  if (
    displayName.length < 2 ||
    displayName.length > 120 ||
    (user.role !== 'super_admin' && (phone.length < 7 || phone.length > 20))
  )
    return json({ error: 'Enter a valid name and mobile number.' }, 400);
  const row = await profileById(user.uid);
  if (!row) return json({ error: 'Account not found.' }, 404);
  const profile = JSON.parse(row.profile_json) as MemberProfile;
  if (phone && phone !== profile.phone) {
    const control = await env.DB.prepare(
      "SELECT payload FROM records WHERE type='system' AND id='accessControl'",
    ).first<{ payload: string }>();
    const blocked = control
      ? (JSON.parse(control.payload) as CollaborationState['blockedAccess'])
      : { emails: [], phones: [], universityIds: [] };
    if (blocked.phones.includes(phone))
      return json({ error: 'This mobile number is blocked.' }, 403);
  }
  const next: MemberProfile = {
    ...profile,
    displayName,
    phone: user.role === 'super_admin' && !phone ? profile.phone : phone,
  };
  if (next.displayName === profile.displayName && next.phone === profile.phone)
    return json({
      user: await safeProfile(
        profile,
        Boolean(enrolledTotpSecret(row.totp_secret)),
        user.mfaVerified,
      ),
      unchanged: true,
    }, 200, { 'x-qraft-unchanged': '1' });
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE profiles SET profile_json=?,updated_at=? WHERE uid=?',
    ).bind(JSON.stringify(next), now, user.uid),
    auditStatement(
      user,
      'profile_self_updated',
      user.uid,
      { displayName: profile.displayName, phone: profile.phone },
      { displayName: next.displayName, phone: next.phone },
    ),
  ]);
  return json({
    user: await safeProfile(
      next,
      Boolean(enrolledTotpSecret(row.totp_secret)),
      user.mfaVerified,
    ),
  });
}

export async function changeOwnPassword(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user) return json({ error: 'Authentication required.' }, 401);
  const input = await readJson<{
    currentPassword?: string;
    newPassword?: string;
  }>(request);
  const currentPassword = input.currentPassword ?? '';
  const newPassword = input.newPassword ?? '';
  if (newPassword.length < 10 || newPassword.length > 128)
    return json(
      { error: 'Use a new password between 10 and 128 characters.' },
      400,
    );
  const row = await profileById(user.uid);
  if (!row) return json({ error: 'Account not found.' }, 404);
  const current = await hashPassword(currentPassword, row.password_salt);
  if (!secureEqual(current.hash, row.password_hash))
    return json({ error: 'Current password is incorrect.' }, 401);
  const replacement = await hashPassword(newPassword);
  if (
    secureEqual(
      replacement.hash,
      (await hashPassword(currentPassword, replacement.salt)).hash,
    )
  )
    return json(
      { error: 'Choose a password different from your current password.' },
      400,
    );
  const token = cookieValue(request, SESSION_COOKIE);
  const tokenHash = token ? await sha256(token) : '';
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE profiles SET password_hash=?,password_salt=?,updated_at=? WHERE uid=?',
    ).bind(replacement.hash, replacement.salt, now, user.uid),
    env.DB.prepare(
      'DELETE FROM sessions WHERE user_id=? AND token_hash<>?',
    ).bind(user.uid, tokenHash),
    auditStatement(user, 'password_self_changed', user.uid, null, {
      otherSessionsSignedOut: true,
    }),
  ]);
  return json({ ok: true });
}

function accessManagerProfile(
  member: MemberProfile,
): MemberProfile {
  return {
    uid: member.uid,
    displayName: member.displayName,
    email: member.email,
    universityId: member.universityId,
    role: member.role,
    tier: member.tier,
    platformRoles: member.platformRoles,
    status: member.status,
    suspended: member.suspended,
    universityIdRegistered: member.universityIdRegistered,
    universityIdVerifiedManually: member.universityIdVerifiedManually,
  } as MemberProfile;
}

export async function loadCollaboration(request: Request) {
  const user = await currentUser(request);
  if (!user || user.status !== 'approved')
    return json({ error: 'Approved account required.' }, 403);
  const catalogRows = await recordsByTypes([
    'qbanks',
    'qbankFolders',
    'qbankMemberships',
  ]);
  const catalog = recordsToState(catalogRows);
  const invitedRowsResult = await env.DB.prepare(
    "SELECT type,id,payload FROM records INDEXED BY idx_records_type_email WHERE type='qbankInvitations' AND email=?",
  )
    .bind(user.email)
    .all<StoredRecord>();
  const invitedRows = invitedRowsResult.results.map((row) => ({
    collection: row.type,
    id: row.id,
    value: JSON.parse(row.payload) as unknown,
  }));
  const invitedBankIds = new Set(
    invitedRows
      .map((row) =>
        isRecord(row.value) && typeof row.value.qbankId === 'string'
          ? row.value.qbankId
          : '',
      )
      .filter(Boolean),
  );
  const allowedBankIds = new Set(
    catalog.qbanks
      .filter(
        (bank) =>
          canAccessBank(user, bank, catalog.memberships) ||
          canReviewBank(user, bank, catalog.memberships) ||
          canManageBank(user, bank),
      )
      .map((bank) => bank.id),
  );
  allowedBankIds.add('smle-gs');
  const scopedRows = await scopedRecordsByTypes(allowedBankIds, [
    'qbankMemberships',
    'qbankInvitations',
    'universityIds',
    'adminInvites',
    'questionProposals',
    'roleApplications',
    'sharedQuestions',
    'qbankSpecialties',
    'qbankTopics',
    'answerStats',
    'sharedNotes',
    'system',
  ]);
  const scopedKeys = new Set(
    scopedRows.map((row) => `${row.collection}\0${row.id}`),
  );
  const rows = [
    ...catalogRows.filter(
      (row) => row.collection === 'qbanks' || row.collection === 'qbankFolders',
    ),
    ...scopedRows,
    ...invitedRows.filter(
      (row) => !scopedKeys.has(`${row.collection}\0${row.id}`),
    ),
  ];
  const profileResult =
    hasAccessManagerRole(user)
      ? await env.DB.prepare('SELECT profile_json FROM profiles').all<{
          profile_json: string;
        }>()
      : { results: [] as { profile_json: string }[] };
  const state = recordsToState(
    rows,
    profileResult.results.map(
      (row) => JSON.parse(row.profile_json) as MemberProfile,
    ),
  );
  const revisions = await env.DB.prepare(
    `SELECT qbank_id,revision FROM qbank_classification_revisions
     WHERE qbank_id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify([...allowedBankIds])).all<{ qbank_id: string; revision: number }>();
  state.classificationRevisions = Object.fromEntries(
    revisions.results.map((item) => [item.qbank_id, item.revision]),
  );
  const accessibleIds = new Set(
    state.qbanks
      .filter((bank) => canAccessBank(user, bank, state.memberships))
      .map((bank) => bank.id),
  );
  const reviewIds = new Set(
    state.qbanks
      .filter((bank) => canReviewBank(user, bank, state.memberships))
      .map((bank) => bank.id),
  );
  const manageIds = new Set(
    state.qbanks
      .filter((bank) => canManageBank(user, bank))
      .map((bank) => bank.id),
  );
  const editIds = new Set(
    state.qbanks
      .filter((bank) => canEditBank(user, bank, state.memberships))
      .map((bank) => bank.id),
  );
  state.qbanks = state.qbanks.filter(
    (bank) =>
      accessibleIds.has(bank.id) ||
      reviewIds.has(bank.id) ||
      invitedBankIds.has(bank.id),
  );
  state.memberships = state.memberships.filter(
    (item) => item.userId === user.uid || editIds.has(item.qbankId),
  );
  state.invitations = state.invitations.filter(
    (item) =>
      item.email === user.email ||
      item.invitedById === user.uid ||
      manageIds.has(item.qbankId),
  );
  state.proposals = state.proposals.filter(
    (item) => item.proposedById === user.uid || reviewIds.has(item.qbankId),
  );
  state.approvedQuestions = state.approvedQuestions.filter(
    (item) =>
      accessibleIds.has(item.qbankId ?? 'smle-gs') ||
      reviewIds.has(item.qbankId ?? 'smle-gs'),
  );
  state.specialties = state.specialties.filter((item) =>
    accessibleIds.has(item.qbankId) || reviewIds.has(item.qbankId),
  );
  state.topics = state.topics.filter((item) =>
    accessibleIds.has(item.qbankId) || reviewIds.has(item.qbankId),
  );
  state.answerStats = Object.fromEntries(
    Object.entries(state.answerStats).filter(([, item]) =>
      accessibleIds.has(item.qbankId),
    ),
  );
  state.sharedNotes = Object.fromEntries(
    Object.entries(state.sharedNotes).filter(([, item]) =>
      accessibleIds.has(item.qbankId),
    ),
  );
  state.roleApplications = state.roleApplications.filter(
    (item) => item.userId === user.uid || hasModeratorRole(user),
  );
  if (user.role !== 'super_admin') {
    state.allowedUniversityIds = [];
    state.adminInvites = [];
    state.auditLog = [];
  }
  if (!hasAccessManagerRole(user)) {
    state.members = [];
    state.blockedAccess = { emails: [], phones: [], universityIds: [] };
  }
  if (user.role !== 'super_admin' && hasAccessManagerRole(user)) {
    state.members = state.members.map((member) =>
      accessManagerProfile(member),
    );
    state.blockedAccess.phones = [];
  }
  return json({ collaboration: state });
}

function bankIdForOperation(
  operation: RecordOperation,
  value: Record<string, unknown>,
  state: CollaborationState,
) {
  if (operation.collection === 'qbanks') return operation.id;
  if (typeof value.qbankId === 'string') return value.qbankId;
  if (operation.collection === 'qbankMemberships')
    return state.memberships.find((item) => item.id === operation.id)?.qbankId;
  if (operation.collection === 'qbankInvitations')
    return state.invitations.find((item) => item.id === operation.id)?.qbankId;
  if (operation.collection === 'questionProposals')
    return state.proposals.find((item) => item.id === operation.id)?.qbankId;
  if (operation.collection === 'sharedQuestions')
    return (
      state.approvedQuestions.find((item) => item.id === operation.id)
        ?.qbankId ?? 'smle-gs'
    );
  if (operation.collection === 'qbankSpecialties')
    return state.specialties.find((item) => item.id === operation.id)?.qbankId;
  if (operation.collection === 'qbankTopics')
    return state.topics.find((item) => item.id === operation.id)?.qbankId;
  if (operation.collection === 'answerStats')
    return state.answerStats[operation.id]?.qbankId;
  if (operation.collection === 'sharedNotes')
    return state.sharedNotes[operation.id]?.qbankId;
  return undefined;
}

function profileUpdateAllowed(
  user: AppUser,
  operation: RecordOperation,
  value: Record<string, unknown>,
  state: CollaborationState,
) {
  if (operation.type !== 'set' || value.uid !== operation.id) return false;
  const existing = state.members.find((member) => member.uid === operation.id);
  if (!existing || existing.role === 'super_admin') return false;
  const mutable = new Set<string>();
  if (hasAccessManagerRole(user)) {
    [
      'status',
      'suspended',
      'approvedAt',
      'approvedById',
      'approvedByName',
      'universityIdVerifiedManually',
    ].forEach((key) => mutable.add(key));
  }
  if (hasModeratorRole(user)) mutable.add('platformRoles');
  if (!mutable.size) return false;
  if (
    'platformRoles' in value &&
    (!Array.isArray(value.platformRoles) ||
      value.platformRoles.length > 3 ||
      new Set(value.platformRoles).size !== value.platformRoles.length ||
      !value.platformRoles.every(isPlatformRole))
  )
    return false;
  const keys = new Set([...Object.keys(existing), ...Object.keys(value)]);
  return [...keys].every(
    (key) =>
      mutable.has(key) ||
      sameJson(value[key], existing[key as keyof MemberProfile]),
  );
}

function invitedUserChangeAllowed(
  user: AppUser,
  operation: RecordOperation,
  value: Record<string, unknown>,
  state: CollaborationState,
) {
  const existing = state.invitations.find((item) => item.id === operation.id);
  if (
    !existing ||
    normalizeEmail(existing.email) !== user.email ||
    operation.type !== 'set'
  )
    return false;
  return (
    value.id === existing.id &&
    value.qbankId === existing.qbankId &&
    value.email === existing.email &&
    value.role === existing.role &&
    value.invitedById === existing.invitedById &&
    value.invitedByName === existing.invitedByName &&
    value.createdAt === existing.createdAt &&
    value.status === 'accepted' &&
    value.acceptedById === user.uid &&
    typeof value.acceptedAt === 'string'
  );
}

function selfMembershipChangeAllowed(
  user: AppUser,
  operation: RecordOperation,
  value: Record<string, unknown>,
  state: CollaborationState,
) {
  const current = state.memberships.find((item) => item.id === operation.id);
  if (operation.type === 'delete') return current?.userId === user.uid;
  if (value.userId !== user.uid || value.id !== operation.id) return false;
  if (current) return sameJson(value, current);
  const invite = state.invitations.find((item) => item.id === value.inviteId);
  return Boolean(
    invite &&
    invite.status === 'pending' &&
    normalizeEmail(invite.email) === user.email &&
    invite.qbankId === value.qbankId &&
    invite.role === value.role,
  );
}

function proposalPayloadIsComplete(proposal: Record<string, unknown>) {
  const payload = isRecord(proposal.payload) ? proposal.payload : undefined;
  const options = Array.isArray(payload?.options) ? payload.options : [];
  return (
    Array.isArray(proposal.editKinds) &&
    proposal.editKinds.length > 0 &&
    proposal.editKinds.every((item) => typeof item === 'string') &&
    typeof payload?.explanation === 'string' &&
    typeof payload.sourceReference === 'string' &&
    Boolean(payload.sourceReference.trim()) &&
    typeof payload.stem === 'string' &&
    Boolean(payload.stem.trim()) &&
    options.length >= 2 &&
    options.length <= 10 &&
    options.every((item) => typeof item === 'string' && item.trim()) &&
    typeof payload.answer === 'number' &&
    Number.isInteger(payload.answer) &&
    payload.answer >= 0 &&
    payload.answer < options.length
  );
}

function proposalRequiresTwoReviewers(proposal: QuestionProposal) {
  return (
    proposal.type === 'question_edit' &&
    (proposal.editKinds.includes('correct_answer') ||
      (!proposal.editKinds.includes('typo_formatting') &&
        (proposal.editKinds.includes('question_text') ||
          proposal.editKinds.includes('options'))))
  );
}

function proposalChangeAllowed(
  user: AppUser,
  operation: RecordOperation,
  value: Record<string, unknown>,
  state: CollaborationState,
  canReview: boolean,
) {
  const current = state.proposals.find((item) => item.id === operation.id);
  if (operation.type === 'delete')
    return Boolean(canReview || current?.proposedById === user.uid);
  if (value.id !== operation.id || !proposalPayloadIsComplete(value))
    return false;
  if (!current)
    return value.proposedById === user.uid && value.status === 'pending';
  if (canReview) {
    if (
      proposalRequiresTwoReviewers(current) &&
      value.status === 'approved'
    )
      return false;
    const immutable = [
      'id',
      'qbankId',
      'type',
      'editKinds',
      'payload',
      'currentSnapshot',
      'rationale',
      'submissionMethod',
      'importBatchId',
      'duplicateInfo',
      'proposedById',
      'proposedByName',
      'proposedAt',
    ];
    const questionIdAllowed =
      current.type === 'new_question'
        ? value.status === 'approved'
          ? typeof value.questionId === 'string' && value.questionId.length > 0
          : value.questionId === current.questionId
        : value.questionId === current.questionId;
    return (
      current.status === 'pending' &&
      current.proposedById !== user.uid &&
      questionIdAllowed &&
      immutable.every((key) =>
        sameJson(value[key], current[key as keyof typeof current]),
      ) &&
      (value.status === 'approved' || value.status === 'rejected') &&
      value.reviewedById === user.uid &&
      typeof value.reviewedAt === 'string'
    );
  }
  return (
    current.proposedById === user.uid &&
    current.status !== 'approved' &&
    value.proposedById === user.uid &&
    value.qbankId === current.qbankId &&
    value.proposedAt === current.proposedAt &&
    value.status === 'pending'
  );
}

function sharedNoteChangeAllowed(
  user: AppUser,
  operation: RecordOperation,
  value: Record<string, unknown>,
  state: CollaborationState,
  canManage: boolean,
) {
  const current = state.sharedNotes[operation.id];
  if (operation.type === 'delete') return canManage;
  if (
    value.id !== operation.id ||
    value.updatedById !== user.uid ||
    !Array.isArray(value.history)
  )
    return false;
  if (!current) return value.version === 1 && value.history.length === 0;
  return (
    value.qbankId === current.qbankId &&
    value.questionId === current.questionId &&
    value.version === current.version + 1 &&
    value.history.length === current.history.length + 1
  );
}

function answerStatChangeAllowed(
  user: AppUser,
  operation: RecordOperation,
  value: Record<string, unknown>,
  state: CollaborationState,
) {
  if (
    operation.type !== 'set' ||
    value.id !== operation.id ||
    !isRecord(value.selections)
  )
    return false;
  const existing = state.answerStats[operation.id];
  if (
    existing &&
    (value.qbankId !== existing.qbankId ||
      value.questionId !== existing.questionId)
  )
    return false;
  const question = state.approvedQuestions.find(
    (q) => q.id === value.questionId && q.qbankId === value.qbankId,
  );
  const selections = value.selections;
  const answer = selections[user.uid];
  if (
    !question ||
    typeof answer !== 'number' ||
    !Number.isInteger(answer) ||
    answer < 0 ||
    answer >= question.options.length
  )
    return false;
  const before = existing?.selections ?? {};
  return [
    ...new Set([...Object.keys(before), ...Object.keys(selections)]),
  ].every((uid) => uid === user.uid || before[uid] === selections[uid]);
}

function roleApplicationChangeAllowed(
  user: AppUser,
  operation: RecordOperation,
  value: Record<string, unknown>,
  state: CollaborationState,
  canManageRoles: boolean,
) {
  const current = state.roleApplications.find(
    (item) => item.id === operation.id,
  );
  if (current && !isPlatformRole(current.requestedRole)) return false;
  if (operation.type === 'delete') return canManageRoles;
  if (value.id !== operation.id) return false;
  if (canManageRoles) {
    if (!current) return false;
    const immutable = [
      'id',
      'userId',
      'userName',
      'userEmail',
      'requestedRole',
      'qbankId',
      'reason',
      'createdAt',
      'superAdminUid',
    ];
    return (
      immutable.every((key) =>
        sameJson(value[key], current[key as keyof typeof current]),
      ) &&
      (value.status === 'approved' || value.status === 'rejected') &&
      value.reviewedById === user.uid &&
      typeof value.reviewedAt === 'string'
    );
  }
  if (
    value.userId !== user.uid ||
    value.status !== 'pending' ||
    !isPlatformRole(value.requestedRole) ||
    value.superAdminUid !== state.security.superAdminUid ||
    typeof value.reason !== 'string' ||
    !value.reason.trim()
  )
    return false;
  return (
    !current ||
    (current.userId === user.uid &&
      current.status !== 'approved' &&
      value.createdAt === current.createdAt &&
      value.requestedRole === current.requestedRole)
  );
}

function recordAllowed(
  user: AppUser,
  operation: RecordOperation,
  state: CollaborationState,
) {
  if (
    !operation.id ||
    operation.id.length > 200 ||
    !operation.collection ||
    operation.collection.length > 50 ||
    (operation.type !== 'set' && operation.type !== 'delete')
  )
    return false;
  if (operation.type === 'set' && !isRecord(operation.value)) return false;
  const value = isRecord(operation.value) ? operation.value : {};
  const existing = state.qbanks.find(
    (bank) => bank.id === bankIdForOperation(operation, value, state),
  );
  const isRoot = user.role === 'super_admin';
  const accessManager = hasAccessManagerRole(user);
  const canManageRoles = hasModeratorRole(user);
  const limits = getPlanLimits(user.effectivePlan ?? user.tier);
  const canManage = existing
    ? isRoot || canManageBank(user, existing)
    : false;
  const canEdit = existing
    ? isRoot || canEditBank(user, existing, state.memberships)
    : false;
  const canReview = existing
    ? canReviewBank(user, existing, state.memberships)
    : false;
  const canAccess = existing
    ? canAccessBank(user, existing, state.memberships)
    : false;
  if (operation.collection === 'qbanks') {
    if (operation.type === 'set' && !existing)
      return (
        value.id === operation.id &&
        limits.canCreateQBank &&
        (value.visibility !== 'private' || limits.canCreatePrivateQBank) &&
        value.ownerId === user.uid &&
        (isRoot || value.folderId === undefined) &&
        (value.essential !== true || isRoot)
      );
    if (!existing) return false;
    if (operation.type === 'delete') return canManage;
    if (!canEdit) return false;
    const editorFieldsStayImmutable =
      canManage ||
      (value.id === existing.id &&
        value.createdAt === existing.createdAt &&
        value.createdById === existing.createdById &&
        value.createdByName === existing.createdByName &&
        value.ownerName === existing.ownerName &&
        value.shareEnabled === existing.shareEnabled &&
        value.shareToken === existing.shareToken &&
        sameJson(value.reviewerIds, existing.reviewerIds) &&
        sameJson(value.viewerIds, existing.viewerIds));
    return (
      editorFieldsStayImmutable &&
      (isRoot ||
        (value.ownerId === existing.ownerId &&
        value.essential === existing.essential &&
        value.folderId === existing.folderId))
    );
  }
  if (operation.collection === 'qbankFolders') {
    if (!isRoot || operation.type === 'delete') return false;
    return (
      value.id === operation.id &&
      typeof value.name === 'string' &&
      Boolean(value.name.trim()) &&
      value.name.length <= 80 &&
      Number.isInteger(value.order) &&
      value.parentId !== value.id &&
      (value.parentId === null || typeof value.parentId === 'string')
    );
  }
  if (operation.collection === 'qbankMemberships')
    return (
      (operation.type === 'set' && !isBankMembershipRole(value.role))
        ? false
        : canManage || selfMembershipChangeAllowed(user, operation, value, state)
    );
  if (operation.collection === 'qbankInvitations')
    return (
      (operation.type === 'set' && !isBankMembershipRole(value.role))
        ? false
        : canManage || invitedUserChangeAllowed(user, operation, value, state)
    );
  if (operation.collection === 'qbankShareLinks') return canManage;
  if (operation.collection === 'qbankSpecialties' || operation.collection === 'qbankTopics')
    return canEdit;
  if (operation.collection === 'questionProposals')
    return (
      (canAccess || canReview) &&
      (state.proposals.some((item) => item.id === operation.id) ||
        (value.type === 'new_question'
          ? limits.canAddQuestions
          : limits.canSuggestCorrections)) &&
      proposalChangeAllowed(user, operation, value, state, canReview)
    );
  if (operation.collection === 'sharedQuestions')
    return operation.type === 'delete' ? canEdit : canReview;
  if (operation.collection === 'answerStats')
    return operation.type === 'delete'
      ? canManage
      : canAccess && answerStatChangeAllowed(user, operation, value, state);
  if (operation.collection === 'sharedNotes')
    return (
      canAccess &&
      sharedNoteChangeAllowed(user, operation, value, state, canManage)
    );
  if (operation.collection === 'roleApplications')
    return roleApplicationChangeAllowed(
      user,
      operation,
      value,
      state,
      canManageRoles,
    );
  if (operation.collection === 'profiles')
    return accessManager && profileUpdateAllowed(user, operation, value, state);
  if (
    operation.collection === 'universityIds' ||
    operation.collection === 'adminInvites'
  )
    return isRoot;
  if (operation.collection === 'system')
    return operation.id === 'accessControl' ? accessManager : isRoot;
  // Audit entries are evidence, not collaborative content. Every accepted
  // mutation is recorded below from the authenticated server context.
  if (operation.collection === 'auditLog') return false;
  return false;
}

function reviewedQuestionWriteAllowed(
  user: AppUser,
  operation: RecordOperation,
  operations: RecordOperation[],
) {
  if (
    operation.collection !== 'sharedQuestions' ||
    operation.type !== 'set' ||
    !isRecord(operation.value)
  )
    return true;
  const question = operation.value;
  if (
    question.reviewedById !== user.uid ||
    typeof question.reviewedByName !== 'string' ||
    typeof question.reviewedAt !== 'string' ||
    typeof question.writtenById !== 'string' ||
    typeof question.writtenByName !== 'string'
  )
    return false;
  return operations.some((candidate) => {
    if (
      candidate.collection !== 'questionProposals' ||
      candidate.type !== 'set' ||
      !isRecord(candidate.value)
    )
      return false;
    return (
      candidate.value.status === 'approved' &&
      candidate.value.reviewedById === user.uid &&
      candidate.value.questionId === operation.id &&
      candidate.value.qbankId === question.qbankId
    );
  });
}

function collaborationValue(state: CollaborationState, collection: string, id: string): unknown {
  const arrays: Record<string, unknown[]> = {
    qbanks: state.qbanks,
    qbankFolders: state.qbankFolders,
    qbankMemberships: state.memberships,
    qbankInvitations: state.invitations,
    profiles: state.members,
    universityIds: state.allowedUniversityIds,
    adminInvites: state.adminInvites,
    questionProposals: state.proposals,
    roleApplications: state.roleApplications,
    sharedQuestions: state.approvedQuestions,
    qbankSpecialties: state.specialties,
    qbankTopics: state.topics,
    auditLog: state.auditLog,
  };
  if (collection === 'answerStats') return state.answerStats[id];
  if (collection === 'sharedNotes') return state.sharedNotes[id];
  if (collection === 'system' && id === 'accessControl') return state.blockedAccess;
  if (collection === 'system' && id === 'security') return state.security;
  return arrays[collection]?.find(value => isRecord(value) && (value.id === id || value.uid === id));
}

function qbankFolderChangeSetValid(
  operations: RecordOperation[],
  state: CollaborationState,
) {
  const folders = new Map(state.qbankFolders.map((folder) => [folder.id, folder]));
  for (const operation of operations) {
    if (operation.collection !== 'qbankFolders') continue;
    if (operation.type === 'delete') folders.delete(operation.id);
    else if (isRecord(operation.value))
      folders.set(
        operation.id,
        operation.value as unknown as CollaborationState['qbankFolders'][number],
      );
  }
  const names = new Set<string>();
  for (const folder of folders.values()) {
    const parent = folder.parentId ? folders.get(folder.parentId) : undefined;
    if (folder.parentId && (!parent || parent.parentId !== null)) return false;
    const key = `${folder.parentId ?? 'root'}\u0000${folder.name.trim().toLocaleLowerCase()}`;
    if (names.has(key)) return false;
    names.add(key);
  }
  const validFolderIds = new Set(folders.keys());
  return operations.every((operation) => {
    if (
      operation.collection !== 'qbanks' ||
      operation.type !== 'set' ||
      !isRecord(operation.value)
    )
      return true;
    return (
      operation.value.folderId === undefined ||
      operation.value.folderId === null ||
      (typeof operation.value.folderId === 'string' &&
        validFolderIds.has(operation.value.folderId))
    );
  });
}

function qbankMembershipChangeSetValid(
  operations: RecordOperation[],
  state: CollaborationState,
) {
  const memberships = new Map(
    state.memberships.map((membership) => [membership.id, membership]),
  );
  for (const operation of operations) {
    if (operation.collection !== 'qbankMemberships') continue;
    if (operation.type === 'delete') memberships.delete(operation.id);
    else if (isRecord(operation.value))
      memberships.set(
        operation.id,
        operation.value as unknown as CollaborationState['memberships'][number],
      );
  }
  const identities = new Set<string>();
  for (const membership of memberships.values()) {
    if (
      !membership.id ||
      !membership.qbankId ||
      !membership.userId ||
      !isBankMembershipRole(membership.role)
    )
      return false;
    const identity = `${membership.qbankId}\u0000${membership.userId}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}

export async function saveCollaboration(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved')
    return json({ error: 'Approved account required.' }, 403);
  const input = await readJson<{ operations?: RecordOperation[] }>(
    request,
    1_800_000,
  );
  if (!Array.isArray(input.operations) || input.operations.length > 500)
    return json({ error: 'Invalid collaboration change set.' }, 400);
  const state = await collaborationStateForOperations(user, input.operations);
  if (!qbankFolderChangeSetValid(input.operations, state))
    return json(
      {
        error:
          'Folder names must be unique per level, and folders support two levels only.',
      },
      400,
    );
  if (user.role !== 'super_admin' && hasAccessManagerRole(user)) {
    const mutable = new Set<string>([
      'status',
      'suspended',
      'approvedAt',
      'approvedById',
      'approvedByName',
      'universityIdVerifiedManually',
    ]);
    if (hasModeratorRole(user)) mutable.add('platformRoles');
    for (const operation of input.operations) {
      if (operation.collection === 'profiles') {
        const existing = state.members.find(
          (member) => member.uid === operation.id,
        );
        if (!existing || existing.role === 'super_admin')
          return json({ error: 'This account cannot be modified.' }, 403);
        if (operation.type !== 'set' || !isRecord(operation.value))
          return json({ error: 'Invalid account update.' }, 403);
        const visible = accessManagerProfile(
          existing,
        ) as unknown as Record<string, unknown>;
        if (
          Object.entries(operation.value).some(
            ([key, value]) =>
              !mutable.has(key) && !sameJson(value, visible[key]),
          )
        )
          return json({ error: 'Account field cannot be modified.' }, 403);
        operation.value = {
          ...existing,
          ...Object.fromEntries(
            Object.entries(operation.value).filter(([key]) => mutable.has(key)),
          ),
        };
      }
      if (
        operation.collection === 'system' &&
        operation.id === 'accessControl'
      ) {
        if (operation.type !== 'set' || !isRecord(operation.value))
          return json({ error: 'Invalid access control update.' }, 403);
        const value = operation.value;
        if (
          !Array.isArray(value.emails) ||
          !Array.isArray(value.universityIds) ||
          !Array.isArray(value.phones) ||
          value.phones.length
        )
          return json(
            { error: 'Access Managers cannot manage phone blocks.' },
            403,
          );
        operation.value = {
          emails: value.emails,
          universityIds: value.universityIds,
          phones: state.blockedAccess.phones,
        };
      }
    }
  }
  if (
    !input.operations.every(
      (operation) =>
        recordAllowed(user, operation, state) &&
        reviewedQuestionWriteAllowed(user, operation, input.operations!),
    )
  )
    return json({ error: 'One or more changes are not permitted.' }, 403);
  if (!qbankMembershipChangeSetValid(input.operations, state))
    return json(
      { error: 'Each account can have only one membership per QBank.' },
      409,
    );
  input.operations = input.operations.filter(operation => {
    const current = collaborationValue(state, operation.collection, operation.id);
    return operation.type === 'delete' ? current !== undefined : !sameJson(operation.value, current);
  });
  if (!input.operations.length) return json({ ok: true, unchanged: true, operations: [] }, 200, { 'x-qraft-unchanged': '1' });
  for (const operation of input.operations.filter(
    (o) => o.collection === 'sharedQuestions' && o.type === 'set',
  )) {
    const question = operation.value as Record<string, unknown>;
    const existing = state.approvedQuestions.find((q) => q.id === operation.id);
    if (
      question.id !== operation.id ||
      (existing && question.questionId !== existing.questionId)
    )
      return json({ error: 'Question identity cannot change.' }, 409);
    if (!existing) {
      const reservation = await env.DB.prepare(
        'SELECT created_by_id,qbank_id FROM question_ids WHERE question_id=?',
      )
        .bind(String(question.questionId))
        .first<{ created_by_id: string; qbank_id: string }>();
      if (
        !reservation ||
        reservation.created_by_id !== user.uid ||
        reservation.qbank_id !== question.qbankId
      )
        return json({ error: 'Reserve a Question ID before approval.' }, 409);
    }
    const proposal = input.operations.find(
      (o) =>
        o.collection === 'questionProposals' &&
        o.type === 'set' &&
        (o.value as Record<string, unknown>).questionId === operation.id,
    )?.value as { payload?: Record<string, unknown> } | undefined;
    if (
      !proposal?.payload ||
      [
        'stem',
        'options',
        'answer',
        'specialty',
        'topic',
        'explanation',
        'sourceReference',
        'images',
      ].some(
        (key) =>
          !sameJson(
            question[key] ?? (key === 'images' ? [] : undefined),
            proposal.payload![key] ?? (key === 'images' ? [] : undefined),
          ),
      )
    )
      return json(
        { error: 'Published content must match the reviewed proposal.' },
        409,
      );
  }
  const now = new Date().toISOString();
  const profileSets = input.operations
    .filter(
      (operation) =>
        operation.collection === 'profiles' && operation.type === 'set',
    )
    .map((operation) => ({
      id: operation.id,
      payload: JSON.stringify(operation.value),
    }));
  const recordDeletes = input.operations
    .filter(
      (operation) =>
        operation.collection !== 'profiles' && operation.type === 'delete',
    )
    .map((operation) => ({
      collection: operation.collection,
      id: operation.id,
    }));
  const recordSets = input.operations
    .filter(
      (operation) =>
        operation.collection !== 'profiles' && operation.type === 'set',
    )
    .map((operation) => {
      const value = operation.value as Record<string, unknown>;
      const metadata = recordData(value);
      return {
        collection: operation.collection,
        id: operation.id,
        qbankId: metadata.qbankId ?? null,
        ownerId: metadata.ownerId ?? null,
        email: metadata.email ?? null,
        payload: JSON.stringify(value),
      };
    });
  const statements: D1PreparedStatement[] = [];
  const deletedQBankIds = input.operations
    .filter(
      (operation) =>
        operation.collection === 'qbanks' && operation.type === 'delete',
    )
    .map((operation) => operation.id);
  if (deletedQBankIds.length) {
    const encodedIds = JSON.stringify(deletedQBankIds);
    statements.push(
      env.DB.prepare(`DELETE FROM records WHERE
        qbank_id IN (SELECT value FROM json_each(?)) OR
        (type='qbankShareLinks' AND json_extract(payload,'$.qbankId') IN (SELECT value FROM json_each(?)))`).bind(
        encodedIds,
        encodedIds,
      ),
      env.DB.prepare(
        'DELETE FROM qbank_classification_revisions WHERE qbank_id IN (SELECT value FROM json_each(?))',
      ).bind(encodedIds),
      env.DB.prepare(
        'DELETE FROM classification_operations WHERE qbank_id IN (SELECT value FROM json_each(?))',
      ).bind(encodedIds),
    );
  }
  if (recordDeletes.length)
    statements.push(
      env.DB.prepare(`DELETE FROM records WHERE rowid IN (
        SELECT record.rowid
        FROM json_each(?) AS change
        CROSS JOIN records AS record INDEXED BY idx_records_type_id
        WHERE record.type=json_extract(change.value, '$.collection')
          AND record.id=json_extract(change.value, '$.id')
      )`).bind(JSON.stringify(recordDeletes)),
    );
  if (profileSets.length)
    statements.push(
      env.DB.prepare(`UPDATE profiles SET
    profile_json = (SELECT json_extract(change.value, '$.payload') FROM json_each(?) AS change WHERE json_extract(change.value, '$.id') = profiles.uid),
    updated_at = ?
    WHERE uid IN (SELECT json_extract(change.value, '$.id') FROM json_each(?) AS change)`).bind(
        JSON.stringify(profileSets),
        now,
        JSON.stringify(profileSets),
      ),
    );
  if (recordSets.length)
    statements.push(
      env.DB.prepare(`INSERT INTO records (type, id, qbank_id, owner_id, email, payload, updated_at)
    SELECT json_extract(change.value, '$.collection'), json_extract(change.value, '$.id'), json_extract(change.value, '$.qbankId'),
      json_extract(change.value, '$.ownerId'), json_extract(change.value, '$.email'), json_extract(change.value, '$.payload'), ?
    FROM json_each(?) AS change WHERE 1
    ON CONFLICT(type,id) DO UPDATE SET qbank_id=excluded.qbank_id, owner_id=excluded.owner_id, email=excluded.email, payload=excluded.payload, updated_at=excluded.updated_at`).bind(
        now,
        JSON.stringify(recordSets),
      ),
    );
  for (const operation of input.operations.filter(
    (o) => o.collection !== 'auditLog',
  ))
    statements.push(
      auditStatement(
        user,
        `${operation.collection}_${operation.type}`,
        operation.id,
        state.members.find((m) => m.uid === operation.id) ?? null,
        operation.type === 'delete'
          ? null
          : { collection: operation.collection },
      ),
    );
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true, operations: input.operations });
}

export async function reserveIds(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved')
    return json({ error: 'Approved account required.' }, 403);
  const input = await readJson<{
    count?: number;
    qbankId?: string;
    highestKnown?: number;
  }>(request);
  const count = input.count ?? 0;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 200 ||
    !input.qbankId ||
    input.qbankId.length > 200 ||
    (input.highestKnown !== undefined &&
      (!Number.isInteger(input.highestKnown) ||
        input.highestKnown < 0 ||
        input.highestKnown > 99_999))
  )
    return json({ error: 'Invalid ID reservation.' }, 400);
  const state = await bankAccessState(input.qbankId);
  const bank = state.qbanks.find((item) => item.id === input.qbankId);
  if (!bank || !canReviewBank(user, bank, state.memberships))
    return json({ error: 'Reviewer access required.' }, 403);
  const ids = await allocateQuestionIds(count, input.qbankId, user.uid);
  if (ids.length !== count)
    return json({ error: 'Question ID capacity reached.' }, 409);
  return json({ ids });
}

export async function joinBank(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved')
    return json({ error: 'Approved account required.' }, 403);
  const input = await readJson<{ qbankId?: string; token?: string }>(request);
  const row = await env.DB.prepare(
    "SELECT payload FROM records WHERE type = 'qbankShareLinks' AND id = ?",
  )
    .bind(input.token ?? '')
    .first<{ payload: string }>();
  const link = row
    ? (JSON.parse(row.payload) as {
        qbankId: string;
        enabled: boolean;
        ownerId: string;
        ownerName: string;
        bankName?: string;
        description?: string;
      })
    : undefined;
  if (!link?.enabled || link.qbankId !== input.qbankId)
    return json(
      { error: 'This QBank link is invalid or no longer active.' },
      404,
    );
  const createdAt = new Date().toISOString();
  const membership = {
    id: `${link.qbankId}_${user.uid}`,
    qbankId: link.qbankId,
    userId: user.uid,
    userName: user.displayName,
    role: 'viewer',
    grantedById: link.ownerId,
    grantedByName: link.ownerName,
    createdAt,
    viaLink: true,
    accessToken: input.token,
  };
  await env.DB.prepare(
    "INSERT INTO records (type, id, qbank_id, owner_id, payload, updated_at) VALUES ('qbankMemberships', ?, ?, ?, ?, ?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
  )
    .bind(
      membership.id,
      link.qbankId,
      user.uid,
      JSON.stringify(membership),
      createdAt,
    )
    .run();
  return json({ membership });
}

export async function previewBankInvite(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user || user.status !== 'approved')
    return json({ error: 'Approved account required.' }, 403);
  const input = await readJson<{ qbankId?: string; token?: string }>(request);
  const row = await env.DB.prepare(
    "SELECT payload FROM records WHERE type = 'qbankShareLinks' AND id = ?",
  )
    .bind(input.token ?? '')
    .first<{ payload: string }>();
  const link = row
    ? (JSON.parse(row.payload) as {
        qbankId: string;
        enabled: boolean;
        ownerId: string;
        ownerName: string;
        bankName?: string;
        description?: string;
      })
    : undefined;
  if (!link?.enabled || link.qbankId !== input.qbankId)
    return json(
      { error: 'This QBank invitation is invalid or no longer active.' },
      404,
    );
  const bankRow = await env.DB.prepare(
    "SELECT payload FROM records WHERE type = 'qbanks' AND id = ?",
  )
    .bind(link.qbankId)
    .first<{ payload: string }>();
  const bank = bankRow
    ? (JSON.parse(bankRow.payload) as Partial<QBank>)
    : undefined;
  return json({
    invitation: {
      qbankId: link.qbankId,
      bankName:
        typeof bank?.name === 'string' && bank.name.trim()
          ? bank.name
          : link.bankName?.trim() || 'Shared QBank',
      description:
        typeof bank?.description === 'string'
          ? bank.description
          : (link.description ?? ''),
      ownerName: link.ownerName,
      role: 'viewer',
    },
  });
}

export async function uploadMedia(
  request: Request,
  kind: 'notes' | 'questions',
) {
  assertSameOrigin(request);
  const authorization = imageKitAuthorization();
  if (!hasR2Storage() && !authorization)
    return json(
      { error: 'Asset storage is not configured on this deployment.' },
      503,
    );
  const user = await currentUser(request);
  if (!user || user.status !== 'approved')
    return json({ error: 'Approved account required.' }, 403);
  const limits = getPlanLimits(user.effectivePlan ?? user.tier);
  if (!limits.canUploadImages || (kind === 'notes' && !limits.canUsePrivateNotes))
    return json(
      {
        error:
          kind === 'notes'
            ? 'Private Notes are available with Pro.'
            : 'Image Upload is available with Pro.',
      },
      403,
    );
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data'))
    return json({ error: 'Upload a valid multipart image request.' }, 400);
  let uploadBody: ArrayBuffer;
  try {
    uploadBody = await readLimitedBytes(request, 11 * 1024 * 1024);
  } catch (error) {
    if (error instanceof Response)
      return json({ error: 'Upload a valid image smaller than 10 MB.' }, 413);
    throw error;
  }
  const form = await new Request('https://qraft.internal/upload', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: uploadBody,
  }).formData();
  const file = form.get('file');
  const qbankValue = form.get('qbankId');
  const questionValue = form.get('questionId');
  const qbankId = typeof qbankValue === 'string' ? qbankValue : '';
  const questionId =
    typeof questionValue === 'string' ? questionValue : 'general';
  const permittedTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ]);
  if (
    !(file instanceof File) ||
    !permittedTypes.has(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    return json(
      { error: 'Upload a JPEG, PNG, WebP, or GIF image smaller than 10 MB.' },
      400,
    );
  const readyMadeTest = await preformedMediaTest(qbankId);
  const state = readyMadeTest ? null : await bankAccessState(qbankId);
  const bank = state?.qbanks.find((item) => item.id === qbankId);
  const permitted = readyMadeTest
    ? kind === 'questions' && readyMadeTest.owner_id === user.uid
    : bank && state && (kind === 'questions'
      ? canReviewBank(user, bank, state.memberships)
      : canAccessBank(user, bank, state.memberships));
  if (!permitted)
    return json(
      {
        error:
          kind === 'questions'
            ? 'Reviewer access required.'
            : 'QBank access required.',
      },
      403,
    );
  const bytes = await file.arrayBuffer();
  if (detectedImageMime(bytes) !== file.type)
    return json(
      { error: 'The file content does not match its declared image type.' },
      400,
    );
  const usage = await env.DB.prepare(
    "SELECT coalesce(sum(size),0) AS bytes FROM media WHERE owner_id=? AND status='ready'",
  )
    .bind(user.uid)
    .first<{ bytes: number }>();
  if (Number(usage?.bytes ?? 0) + file.size > limits.maxImageStorageBytes)
    return json(
      {
        error: `Your ${limits.name} image storage allowance has been reached. Delete unused images before uploading more.`,
      },
      413,
    );
  const fileHash = await sha256Bytes(bytes);
  const duplicate = await env.DB.prepare(
    "SELECT key,provider FROM media WHERE owner_id=? AND qbank_id=? AND file_hash=? AND provider='r2' AND status='ready' LIMIT 1",
  )
    .bind(user.uid, qbankId, fileHash)
    .first<{ key: string; provider: string }>();
  if (duplicate)
    return json({
      url:
        duplicate.provider === 'r2'
          ? `/api/cloudflare/media/${duplicate.key
              .split('/')
              .map(encodeURIComponent)
              .join('/')}`
          : duplicate.key,
      duplicate: true,
    });

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const now = new Date().toISOString();
  if (hasR2Storage()) {
    const extension =
      file.type === 'image/jpeg'
        ? 'jpg'
        : file.type === 'image/png'
          ? 'png'
          : file.type === 'image/gif'
            ? 'gif'
            : 'webp';
    const safeQbank = qbankId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const safeQuestion = questionId.replace(/[^a-zA-Z0-9_-]/g, '-');
    const key = `${kind}/${safeQbank}/${safeQuestion}/${fileHash.slice(0, 16)}-${crypto.randomUUID()}.${extension}`;
    let stored;
    try {
      stored = await r2StorageService.upload(key, bytes, {
        contentType: file.type,
        cacheControl: 'private, max-age=31536000, immutable',
        ownerId: user.uid,
        qbankId,
        size: file.size,
      });
    } catch (error) {
      if (error instanceof R2QuotaExceededError)
        return json({ error: error.message }, 429);
      if (
        error instanceof Error &&
        error.message.startsWith('The 3 GB image storage safety limit')
      )
        return json({ error: error.message }, 413);
      throw error;
    }
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO media (key,qbank_id,owner_id,content_type,size,provider,storage_key,file_hash,original_name,purpose,status,created_at,updated_at) VALUES (?,?,?,?,?,'r2',?,?,?,?, 'ready',?,?)",
        ).bind(
          stored.key,
          qbankId,
          user.uid,
          file.type,
          stored.size,
          stored.key,
          fileHash,
          safeName,
          kind,
          now,
          now,
        ),
      ]);
    } catch (error) {
      await r2StorageService.delete(stored.key, stored.size);
      throw error;
    }
    return json(
      {
        url: `/api/cloudflare/media/${stored.key
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
      },
      201,
    );
  }

  const upload = new FormData();
  upload.append('file', new File([bytes], safeName, { type: file.type }), safeName);
  upload.append('fileName', `${Date.now()}-${crypto.randomUUID()}-${safeName}`);
  upload.append('folder', `/qraft/qbanks/${qbankId}/${kind}/${questionId}`);
  upload.append('useUniqueFileName', 'true');
  upload.append('tags', `qraft,${kind},${qbankId}`);
  const response = await fetch(
    'https://upload.imagekit.io/api/v1/files/upload',
    {
      method: 'POST',
      headers: { authorization: authorization!, accept: 'application/json' },
      body: upload,
    },
  );
  const result = (await response.json().catch(() => null)) as {
    fileId?: string;
    url?: string;
    message?: string;
  } | null;
  if (!response.ok || !result?.fileId || !result.url) {
    return json(
      { error: result?.message || 'ImageKit rejected the image upload.' },
      502,
    );
  }
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO media (key,qbank_id,owner_id,content_type,size,provider,storage_key,file_hash,original_name,purpose,status,created_at,updated_at) VALUES (?,?,?,?,?,'imagekit',?,?,?,?, 'ready',?,?)",
      ).bind(result.fileId, qbankId, user.uid, file.type, file.size, result.fileId, fileHash, safeName, kind, now, now),
      env.DB.prepare(
        "INSERT INTO counters(id,value,updated_at) VALUES('media-bytes',?,?) ON CONFLICT(id) DO UPDATE SET value=value+excluded.value,updated_at=excluded.updated_at",
      ).bind(file.size, now),
    ]);
  } catch (error) {
    await deleteImageKitFile(result.fileId);
    throw error;
  }
  return json({ url: result.url }, 201);
}

export async function serveMedia(request: Request, key: string) {
  const user = await currentUser(request);
  const metadata = await env.DB.prepare(
    'SELECT qbank_id,provider,storage_key,status FROM media WHERE key = ?',
  )
    .bind(key)
    .first<{ qbank_id: string; provider: string; storage_key: string | null; status: string }>();
  if (!metadata || metadata.status === 'account_deleted') return new Response('Not found.', { status: 404 });
  const readyMadeTest = await preformedMediaTest(metadata.qbank_id);
  if (readyMadeTest) {
    const owner = Boolean(user && readyMadeTest.owner_id === user.uid);
    if (!owner) {
      if (readyMadeTest.status !== 'published')
        return new Response('Forbidden.', { status: 403 });
      let permitted = readyMadeTest.visibility === 'public';
      if (!permitted && user) {
        const participation = await env.DB.prepare(
          'SELECT 1 AS allowed FROM preformed_participation WHERE test_id=? AND version=? AND user_id=? LIMIT 1',
        )
          .bind(
            preformedMediaTestId(metadata.qbank_id),
            readyMadeTest.version,
            user.uid,
          )
          .first<{ allowed: number }>();
        permitted = Boolean(participation);
      }
      if (!permitted) {
        const attempt = new URL(request.url).searchParams.get('attempt') ?? '';
        if (/^[a-f0-9]{64}$/i.test(attempt)) {
          const token = await env.DB.prepare(
            `SELECT 1 AS allowed FROM preformed_attempt_tokens
             WHERE token_hash=? AND test_id=? AND version=? AND expires_at>?
               AND (user_id IS NULL OR user_id=?) LIMIT 1`,
          )
            .bind(
              await sha256(attempt),
              preformedMediaTestId(metadata.qbank_id),
              readyMadeTest.version,
              new Date().toISOString(),
              user?.uid ?? '',
            )
            .first<{ allowed: number }>();
          permitted = Boolean(token);
        }
      }
      if (!permitted) return new Response('Forbidden.', { status: 403 });
    }
  } else {
    if (!user) return new Response('Authentication required.', { status: 401 });
    const state = await bankAccessState(metadata.qbank_id);
    const bank = state.qbanks.find((item) => item.id === metadata.qbank_id);
    if (!bank || !canAccessBank(user, bank, state.memberships))
      return new Response('Forbidden.', { status: 403 });
  }
  if (metadata.provider !== 'r2' || !metadata.storage_key)
    return new Response('This legacy asset is served by its original URL.', {
      status: 410,
    });
  let object;
  try {
    object = await r2StorageService.get(metadata.storage_key);
  } catch (error) {
    if (error instanceof R2QuotaExceededError)
      return new Response(error.message, {
        status: 429,
        headers: { 'cache-control': 'no-store' },
      });
    throw error;
  }
  if (!object) return new Response('Not found.', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'private, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { headers });
}

async function removeBankMedia(qbankIds: string[]) {
  if (!qbankIds.length) return;
  const rows = await env.DB.prepare(
    'SELECT key,provider,storage_key,size FROM media WHERE qbank_id IN (SELECT value FROM json_each(?))',
  )
    .bind(JSON.stringify(qbankIds))
    .all<{
      key: string;
      provider: string;
      storage_key: string | null;
      size: number;
    }>();
  if (rows.results.some((row) => row.provider === 'r2') && !hasR2Storage())
    return json({ error: 'R2 storage is not configured.' }, 503);
  if (
    rows.results.some((row) => row.provider !== 'r2') &&
    !imageKitAuthorization()
  )
    return json(
      { error: 'Legacy ImageKit storage is not configured.' },
      503,
    );
  for (let offset = 0; offset < rows.results.length; offset += 50) {
    const deletions = await Promise.all(
      rows.results.slice(offset, offset + 50).map(async (row) => {
        if (row.provider === 'r2' && row.storage_key && hasR2Storage()) {
          await r2StorageService.delete(row.storage_key, Number(row.size || 0));
          return true;
        }
        return deleteImageKitFile(row.key);
      }),
    );
    if (deletions.some((deleted) => !deleted))
      return json(
        { error: 'Some images could not be deleted from ImageKit. Try again.' },
        502,
      );
  }
  const removedLegacyBytes = rows.results.reduce(
    (total, row) =>
      row.provider === 'r2' ? total : total + Number(row.size || 0),
    0,
  );
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM media WHERE qbank_id IN (SELECT value FROM json_each(?))',
    ).bind(JSON.stringify(qbankIds)),
    env.DB.prepare(
      "UPDATE counters SET value=max(0,value-?),updated_at=? WHERE id='media-bytes'",
    ).bind(removedLegacyBytes, new Date().toISOString()),
  ]);
}

export async function deleteBankMedia(request: Request, qbankId: string) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  const readyMadeTest = await preformedMediaTest(qbankId);
  const state = readyMadeTest ? null : await bankAccessState(qbankId);
  const bank = state?.qbanks.find((item) => item.id === qbankId);
  if (
    !user ||
    (readyMadeTest
      ? readyMadeTest.owner_id !== user.uid
      : !bank ||
        (user.role !== 'super_admin' && !canManageBank(user, bank)))
  )
    return json({ error: readyMadeTest ? 'Test owner access required.' : 'QBank management access required.' }, 403);
  const mediaError = await removeBankMedia([qbankId]);
  if (mediaError) return mediaError;
  return json({ ok: true });
}

export async function deleteQBankFolder(request: Request, folderId: string) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (
    !user ||
    user.status !== 'approved' ||
    user.role !== 'super_admin' ||
    !user.mfaVerified
  )
    return json({ error: 'Verified Superadmin access required.' }, 403);
  const input = await readJson<{
    mode?: 'move' | 'cascade';
    targetFolderId?: string | null;
    confirmation?: string;
  }>(request);
  const folderRows = await recordsByTypes(['qbankFolders']);
  const folders = folderRows.map(
    (row) => row.value as CollaborationState['qbankFolders'][number],
  );
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return json({ error: 'Folder not found.' }, 404);
  const folderIds = new Set([
    folder.id,
    ...folders
      .filter((item) => item.parentId === folder.id)
      .map((item) => item.id),
  ]);
  const targetFolderId = input.targetFolderId ?? null;
  if (input.mode === 'move') {
    if (targetFolderId && folderIds.has(targetFolderId))
      return json({ error: 'Choose a folder outside the deleted branch.' }, 400);
    if (targetFolderId && !folders.some((item) => item.id === targetFolderId))
      return json({ error: 'Destination folder not found.' }, 404);
  } else if (input.mode !== 'cascade' || input.confirmation !== 'حذف') {
    return json({ error: 'Type حذف to confirm permanent deletion.' }, 400);
  }
  const bankRows = await recordsByTypes(['qbanks']);
  const banks = bankRows
    .map((row) => row.value as QBank)
    .filter((bank) => bank.folderId && folderIds.has(bank.folderId));
  if (input.mode === 'cascade' && banks.some((bank) => bank.essential))
    return json(
      { error: 'Essential QBanks must be moved or removed independently.' },
      409,
    );
  if (input.mode === 'cascade') {
    const mediaError = await removeBankMedia(banks.map((bank) => bank.id));
    if (mediaError) return mediaError;
  }
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const bankIds = banks.map((bank) => bank.id);
  const folderIdList = [...folderIds];
  const statements: D1PreparedStatement[] = [];
  const relatedTables = new Set<string>();
  if (input.mode === 'cascade' && bankIds.length) {
    const available = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('question_ids','qbank_classification_revisions','user_topic_stats','qbank_stats','classification_operations')",
    ).all<{ name: string }>();
    available.results.forEach((row) => relatedTables.add(row.name));
  }
  if (input.mode === 'move' && bankIds.length) {
    statements.push(
      targetFolderId
        ? env.DB.prepare(`UPDATE records SET payload=json_set(payload,'$.folderId',?),updated_at=?
            WHERE type='qbanks' AND id IN (SELECT value FROM json_each(?))`).bind(
            targetFolderId,
            now,
            JSON.stringify(bankIds),
          )
        : env.DB.prepare(`UPDATE records SET payload=json_remove(payload,'$.folderId'),updated_at=?
            WHERE type='qbanks' AND id IN (SELECT value FROM json_each(?))`).bind(
            now,
            JSON.stringify(bankIds),
          ),
    );
  }
  if (input.mode === 'cascade' && bankIds.length) {
    statements.push(
      env.DB.prepare(`DELETE FROM records WHERE
        qbank_id IN (SELECT value FROM json_each(?)) OR
        (type='qbanks' AND id IN (SELECT value FROM json_each(?)))`).bind(
        JSON.stringify(bankIds),
        JSON.stringify(bankIds),
      ),
    );
    if (relatedTables.has('question_ids'))
      statements.push(
        env.DB.prepare(
          'DELETE FROM question_ids WHERE qbank_id IN (SELECT value FROM json_each(?))',
        ).bind(JSON.stringify(bankIds)),
      );
    if (relatedTables.has('qbank_classification_revisions'))
      statements.push(
        env.DB.prepare(
          'DELETE FROM qbank_classification_revisions WHERE qbank_id IN (SELECT value FROM json_each(?))',
        ).bind(JSON.stringify(bankIds)),
      );
    if (relatedTables.has('user_topic_stats'))
      statements.push(
        env.DB.prepare(
          'DELETE FROM user_topic_stats WHERE qbank_id IN (SELECT value FROM json_each(?))',
        ).bind(JSON.stringify(bankIds)),
      );
    if (relatedTables.has('qbank_stats'))
      statements.push(
        env.DB.prepare(
          'DELETE FROM qbank_stats WHERE qbank_id IN (SELECT value FROM json_each(?))',
        ).bind(JSON.stringify(bankIds)),
      );
    if (relatedTables.has('classification_operations'))
      statements.push(
        env.DB.prepare(
          'DELETE FROM classification_operations WHERE qbank_id IN (SELECT value FROM json_each(?))',
        ).bind(JSON.stringify(bankIds)),
      );
  }
  statements.push(
    env.DB.prepare(
      "DELETE FROM records WHERE type='qbankFolders' AND id IN (SELECT value FROM json_each(?))",
    ).bind(JSON.stringify(folderIdList)),
    env.DB.prepare(
      'INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES(?,?,?,?,?)',
    ).bind(
      'auditLog',
      auditId,
      user.uid,
      JSON.stringify({
        id: auditId,
        action:
          input.mode === 'cascade'
            ? 'qbank_folder_cascade_deleted'
            : 'qbank_folder_moved_deleted',
        entityType: 'qbank',
        entityId: folder.id,
        actorId: user.uid,
        actorName: user.displayName,
        createdAt: now,
        detail: `${folder.name}: ${banks.length} QBank(s), ${folderIds.size} folder(s).`,
      }),
      now,
    ),
  );
  await env.DB.batch(statements);
  return json({
    ok: true,
    deletedFolderIds: folderIdList,
    deletedBankIds: input.mode === 'cascade' ? bankIds : [],
    movedBankIds: input.mode === 'move' ? bankIds : [],
  });
}
