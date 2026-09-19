import { env } from 'cloudflare:workers';
import { currentUser } from '@/features/auth/server/auth-service';
import { assertSameOrigin, readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { PLAN_ORDER } from '@/features/subscriptions/domain/plan-config';
import type { AppUser } from './medguard-types';
import type {
  PreformedLeaderboardEntry,
  PreformedQuestion,
  PreformedQuestionStat,
  PreformedTestDocument,
  PreformedTestSettings,
  PreformedTestSummary,
} from './preformed-test-types';

const encoder = new TextEncoder();
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const DEFAULT_SETTINGS: PreformedTestSettings = {
  mode: 'exam',
  durationMinutes: null,
  maxAttempts: 1,
  attemptResultPolicy: 'highest',
  randomizeQuestions: false,
  randomizeOptions: false,
  opensAt: null,
  closesAt: null,
  passingPercent: 60,
  allowBackNavigation: true,
};

type TestRow = {
  id: string;
  code: string;
  owner_id: string;
  owner_name: string;
  title: string;
  description: string;
  visibility: 'public' | 'private';
  status: 'draft' | 'published' | 'paused' | 'hidden';
  version: number;
  questions_json: string;
  settings_json: string;
  passcode_hash: string | null;
  passcode_salt: string | null;
  created_at: string;
  updated_at: string;
  participant_count?: number;
  report_count?: number;
};

function approved(user: AppUser | null | undefined): user is AppUser {
  return Boolean(user && user.status === 'approved' && !user.suspended);
}

function canCreate(user: AppUser) {
  return (
    PLAN_ORDER.indexOf(user.effectivePlan ?? user.tier) >=
    PLAN_ORDER.indexOf('pro')
  );
}

function normalizeCode(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toUpperCase().replace(/\s+/g, '')
    : '';
}

function bytesToHex(value: ArrayBuffer | Uint8Array) {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function digest(value: string) {
  return bytesToHex(
    await crypto.subtle.digest('SHA-256', encoder.encode(value)),
  );
}

async function hashPasscode(passcode: string, salt?: string) {
  const actualSalt =
    salt ?? bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passcode),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(actualSalt),
      iterations: 100_000,
    },
    key,
    256,
  );
  return { hash: bytesToHex(hash), salt: actualSalt };
}

function constantEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function settings(
  value: string | Partial<PreformedTestSettings>,
): PreformedTestSettings {
  const parsed =
    typeof value === 'string'
      ? (JSON.parse(value) as Partial<PreformedTestSettings>)
      : value;
  return { ...DEFAULT_SETTINGS, ...parsed };
}

function summary(row: TestRow): PreformedTestSummary {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    visibility: row.visibility,
    status: row.status,
    version: row.version,
    questionCount: (JSON.parse(row.questions_json) as unknown[]).length,
    settings: settings(row.settings_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    participantCount: Number(row.participant_count ?? 0),
    reportCount: Number(row.report_count ?? 0),
  };
}

function document(row: TestRow): PreformedTestDocument {
  return {
    ...summary(row),
    questions: JSON.parse(row.questions_json) as PreformedQuestion[],
    hasPasscode: Boolean(row.passcode_hash),
  };
}

function validSettings(value: unknown): value is PreformedTestSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const nullableInteger = (entry: unknown, minimum: number, maximum: number) =>
    entry === null ||
    (Number.isInteger(entry) &&
      Number(entry) >= minimum &&
      Number(entry) <= maximum);
  const nullableDate = (entry: unknown) =>
    entry === null ||
    (typeof entry === 'string' && !Number.isNaN(Date.parse(entry)));
  return (
    (item.mode === 'practice' || item.mode === 'exam') &&
    nullableInteger(item.durationMinutes, 1, 300) &&
    nullableInteger(item.maxAttempts, 1, 20) &&
    (item.attemptResultPolicy === 'highest' ||
      item.attemptResultPolicy === 'latest' ||
      item.attemptResultPolicy === 'all') &&
    nullableDate(item.opensAt) &&
    nullableDate(item.closesAt) &&
    Number.isInteger(item.passingPercent) &&
    Number(item.passingPercent) >= 0 &&
    Number(item.passingPercent) <= 100 &&
    typeof item.randomizeQuestions === 'boolean' &&
    typeof item.randomizeOptions === 'boolean' &&
    typeof item.allowBackNavigation === 'boolean' &&
    (item.opensAt === null ||
      item.closesAt === null ||
      (typeof item.opensAt === 'string' &&
        typeof item.closesAt === 'string' &&
        Date.parse(item.opensAt) < Date.parse(item.closesAt)))
  );
}

function validQuestions(value: unknown): value is PreformedQuestion[] {
  if (!Array.isArray(value) || value.length > 35) return false;
  const ids = new Set<string>();
  return value.every((question) => {
    if (!question || typeof question !== 'object' || Array.isArray(question))
      return false;
    const item = question as Record<string, unknown>;
    const options = item.options;
    const images = item.images;
    return (
      typeof item.id === 'string' &&
      Boolean(item.id) &&
      item.id.length <= 100 &&
      !ids.has(item.id) &&
      (ids.add(item.id), true) &&
      typeof item.stem === 'string' &&
      Boolean(item.stem.trim()) &&
      item.stem.length <= 30_000 &&
      Array.isArray(options) &&
      options.length >= 2 &&
      options.length <= 10 &&
      options.every(
        (option) =>
          typeof option === 'string' &&
          Boolean(option.trim()) &&
          option.length <= 10_000,
      ) &&
      Number.isInteger(item.answer) &&
      Number(item.answer) >= 0 &&
      Number(item.answer) < options.length &&
      typeof item.explanation === 'string' &&
      item.explanation.length <= 30_000 &&
      typeof item.sourceReference === 'string' &&
      item.sourceReference.length <= 2_000 &&
      Array.isArray(images) &&
      images.length <= 5 &&
      images.every((image) => {
        if (!image || typeof image !== 'object' || Array.isArray(image))
          return false;
        const entry = image as Record<string, unknown>;
        return (
          typeof entry.id === 'string' &&
          typeof entry.url === 'string' &&
          (entry.url.startsWith('/api/cloudflare/media/') ||
            entry.url.startsWith('https://')) &&
          typeof entry.name === 'string' &&
          typeof entry.caption === 'string'
        );
      })
    );
  });
}

async function uniqueCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = `QF-${[...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')}`;
    const exists = await env.DB.prepare(
      'SELECT 1 FROM preformed_tests WHERE code=?',
    )
      .bind(code)
      .first();
    if (!exists) return code;
  }
  throw new Error('Unable to allocate a test code. Try again.');
}

async function rowById(id: string) {
  return env.DB.prepare('SELECT * FROM preformed_tests WHERE id=?')
    .bind(id)
    .first<TestRow>();
}

function leaderboardEntry(row: {
  id: string;
  participant_name: string;
  participant_user_id: string | null;
  guest: number;
  score: number;
  question_count: number;
  duration_seconds: number;
  attempt_number: number;
  submitted_at: string;
  rank: number;
}): PreformedLeaderboardEntry {
  return {
    id: row.id,
    participantName: row.participant_name,
    participantUserId: row.participant_user_id,
    guest: Boolean(row.guest),
    score: row.score,
    questionCount: row.question_count,
    percentage: row.question_count
      ? Math.round((row.score / row.question_count) * 100)
      : 0,
    durationSeconds: row.duration_seconds,
    attemptNumber: row.attempt_number,
    submittedAt: row.submitted_at,
    rank: row.rank,
  };
}

async function rankedLeaderboard(testId: string, version: number) {
  const rows = await env.DB.prepare(`SELECT *,row_number() OVER (
    ORDER BY score DESC,duration_seconds ASC,submitted_at ASC,id ASC
  ) AS rank FROM preformed_leaderboard WHERE test_id=? AND version=?
  ORDER BY rank LIMIT 70`)
    .bind(testId, version)
    .all<{
      id: string;
      participant_name: string;
      participant_user_id: string | null;
      guest: number;
      score: number;
      question_count: number;
      duration_seconds: number;
      attempt_number: number;
      submitted_at: string;
      rank: number;
    }>();
  return rows.results.map(leaderboardEntry);
}

export async function preformedTestApi(request: Request, action: string) {
  if (request.method !== 'GET') assertSameOrigin(request);
  const user = await currentUser(request);
  const url = new URL(request.url);
  try {
    if (action === 'catalog' && request.method === 'GET') {
      if (!approved(user))
        return json({ error: 'Sign in to browse tests.' }, 401);
      const rows = await env.DB.prepare(`SELECT t.*,
        (SELECT count(*) FROM preformed_leaderboard l WHERE l.test_id=t.id AND l.version=t.version) participant_count,
        (SELECT count(*) FROM preformed_reports r WHERE r.test_id=t.id) report_count
        FROM preformed_tests t
        WHERE t.owner_id=? OR (t.visibility='public' AND t.status='published')
        ORDER BY CASE WHEN t.owner_id=? THEN 0 ELSE 1 END,t.updated_at DESC LIMIT 250`)
        .bind(user.uid, user.uid)
        .all<TestRow>();
      return json({ tests: rows.results.map(summary) });
    }

    if (action === 'open' && request.method === 'GET') {
      const code = normalizeCode(url.searchParams.get('code'));
      if (!/^QF-[A-Z0-9]{6}$/.test(code))
        return json({ error: 'Enter a valid test code.' }, 400);
      const row = await env.DB.prepare(
        'SELECT * FROM preformed_tests WHERE code=?',
      )
        .bind(code)
        .first<TestRow>();
      if (!row) return json({ error: 'Test not found.' }, 404);
      const ownerPreview = approved(user) && row.owner_id === user.uid;
      if (!ownerPreview && row.status !== 'published')
        return json(
          {
            error:
              row.status === 'hidden'
                ? 'This test is unavailable.'
                : 'This test is not accepting participants.',
          },
          403,
        );
      const nowMs = Date.now();
      const testSettings = settings(row.settings_json);
      if (
        !ownerPreview &&
        testSettings.opensAt &&
        nowMs < Date.parse(testSettings.opensAt)
      )
        return json(
          { error: `This test opens at ${testSettings.opensAt}.` },
          403,
        );
      if (
        !ownerPreview &&
        testSettings.closesAt &&
        nowMs >= Date.parse(testSettings.closesAt)
      )
        return json({ error: 'This test has closed.' }, 403);
      if (row.passcode_hash && row.passcode_salt) {
        const passcode = request.headers.get('x-qraft-test-passcode') ?? '';
        const candidate = await hashPasscode(passcode, row.passcode_salt);
        if (!constantEqual(candidate.hash, row.passcode_hash))
          return json(
            {
              error: passcode ? 'Incorrect access code.' : 'PASSCODE_REQUIRED',
              needsPasscode: true,
            },
            401,
          );
      }
      if (approved(user) && testSettings.maxAttempts !== null) {
        const participation = await env.DB.prepare(
          'SELECT attempts FROM preformed_participation WHERE test_id=? AND version=? AND user_id=?',
        )
          .bind(row.id, row.version, user.uid)
          .first<{ attempts: number }>();
        if (Number(participation?.attempts ?? 0) >= testSettings.maxAttempts)
          return json(
            { error: 'You have reached the attempt limit for this test.' },
            409,
          );
      }
      const rawToken = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      const tokenHash = await digest(rawToken);
      const issuedAt = new Date().toISOString();
      const defaultExpiry = nowMs + 7 * 86_400_000;
      const closeExpiry = testSettings.closesAt
        ? Date.parse(testSettings.closesAt) + 15 * 60_000
        : defaultExpiry;
      const expiresAt = new Date(
        Math.min(defaultExpiry, closeExpiry),
      ).toISOString();
      await env.DB.prepare(
        'INSERT INTO preformed_attempt_tokens(token_hash,test_id,version,user_id,issued_at,expires_at) VALUES(?,?,?,?,?,?)',
      )
        .bind(
          tokenHash,
          row.id,
          row.version,
          approved(user) ? user.uid : null,
          issuedAt,
          expiresAt,
        )
        .run();
      return json({ test: { ...document(row), attemptToken: rawToken } }, 200, {
        'cache-control': 'no-store',
      });
    }

    if (action === 'create' && request.method === 'POST') {
      if (!approved(user) || !canCreate(user))
        return json({ error: 'Creating ready-made tests requires Pro.' }, 403);
      const id = crypto.randomUUID();
      const code = await uniqueCode();
      const now = new Date().toISOString();
      await env.DB.prepare(`INSERT INTO preformed_tests(
        id,code,owner_id,owner_name,title,description,visibility,status,version,questions_json,settings_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,'','private','draft',1,'[]',?,?,?)`)
        .bind(
          id,
          code,
          user.uid,
          user.displayName,
          'Untitled ready-made test',
          JSON.stringify(DEFAULT_SETTINGS),
          now,
          now,
        )
        .run();
      return json({ test: document((await rowById(id))!) }, 201);
    }

    if (action === 'save' && request.method === 'PUT') {
      if (!approved(user))
        return json({ error: 'Sign in to edit tests.' }, 401);
      const input = await readJson<{
        test?: Partial<PreformedTestDocument>;
        passcode?: string | null;
      }>(request, 1_800_000);
      const id = input.test?.id ?? '';
      const row = await rowById(id);
      if (!row || row.owner_id !== user.uid)
        return json({ error: 'Test owner access required.' }, 403);
      const title = input.test?.title?.trim() ?? '';
      const description = input.test?.description?.trim() ?? '';
      const visibility = input.test?.visibility;
      const status = input.test?.status;
      const nextQuestions = input.test?.questions;
      const nextSettings = input.test?.settings;
      if (
        !title ||
        title.length > 160 ||
        description.length > 2_000 ||
        (visibility !== 'public' && visibility !== 'private') ||
        (status !== 'draft' && status !== 'published' && status !== 'paused') ||
        !validQuestions(nextQuestions) ||
        !validSettings(nextSettings) ||
        (status === 'published' && nextQuestions.length === 0)
      )
        return json(
          {
            error:
              'Check the title, settings, and questions. Published tests need at least one valid question.',
          },
          400,
        );
      const questionsJson = JSON.stringify(nextQuestions);
      const contentChanged = questionsJson !== row.questions_json;
      let passcodeHash = row.passcode_hash;
      let passcodeSalt = row.passcode_salt;
      if (input.passcode !== undefined) {
        const passcode = input.passcode?.trim() ?? '';
        if (passcode.length > 40)
          return json(
            { error: 'Access code must be 40 characters or fewer.' },
            400,
          );
        if (passcode) {
          const secured = await hashPasscode(passcode);
          passcodeHash = secured.hash;
          passcodeSalt = secured.salt;
        } else {
          passcodeHash = null;
          passcodeSalt = null;
        }
      }
      const now = new Date().toISOString();
      const nextVersion = contentChanged ? row.version + 1 : row.version;
      const statements: D1PreparedStatement[] = [
        env.DB.prepare(
          `UPDATE preformed_tests SET title=?,description=?,visibility=?,status=?,version=?,questions_json=?,settings_json=?,passcode_hash=?,passcode_salt=?,updated_at=? WHERE id=? AND owner_id=?`,
        ).bind(
          title,
          description,
          visibility,
          row.status === 'hidden' ? 'hidden' : status,
          nextVersion,
          questionsJson,
          JSON.stringify(nextSettings),
          passcodeHash,
          passcodeSalt,
          now,
          id,
          user.uid,
        ),
      ];
      if (contentChanged)
        statements.push(
          env.DB.prepare(
            'DELETE FROM preformed_leaderboard WHERE test_id=?',
          ).bind(id),
          env.DB.prepare(
            'DELETE FROM preformed_question_stats WHERE test_id=?',
          ).bind(id),
          env.DB.prepare(
            'DELETE FROM preformed_participation WHERE test_id=?',
          ).bind(id),
          env.DB.prepare(
            'DELETE FROM preformed_attempt_tokens WHERE test_id=?',
          ).bind(id),
          env.DB.prepare(
            'DELETE FROM preformed_submission_receipts WHERE test_id=?',
          ).bind(id),
        );
      await env.DB.batch(statements);
      return json({
        test: document((await rowById(id))!),
        resultsReset: contentChanged,
      });
    }

    if (action === 'rotate-code' && request.method === 'POST') {
      if (!approved(user)) return json({ error: 'Sign in required.' }, 401);
      const input = await readJson<{ id?: string }>(request);
      const row = await rowById(input.id ?? '');
      if (!row || row.owner_id !== user.uid)
        return json({ error: 'Test owner access required.' }, 403);
      const code = await uniqueCode();
      await env.DB.prepare(
        'UPDATE preformed_tests SET code=?,updated_at=? WHERE id=?',
      )
        .bind(code, new Date().toISOString(), row.id)
        .run();
      return json({ code });
    }

    if (action === 'leaderboard' && request.method === 'GET') {
      if (!approved(user))
        return json({ error: 'Sign in to view the leaderboard.' }, 401);
      const id = url.searchParams.get('id') ?? '';
      const row = await rowById(id);
      if (!row || row.status === 'hidden')
        return json({ error: 'Test not found.' }, 404);
      return json({
        leaderboard: await rankedLeaderboard(row.id, row.version),
      });
    }

    if (action === 'manage' && request.method === 'GET') {
      if (!approved(user)) return json({ error: 'Sign in required.' }, 401);
      const row = await rowById(url.searchParams.get('id') ?? '');
      if (!row || row.owner_id !== user.uid)
        return json({ error: 'Test owner access required.' }, 403);
      const statRows = await env.DB.prepare(
        'SELECT question_id,submissions,correct FROM preformed_question_stats WHERE test_id=? AND version=?',
      )
        .bind(row.id, row.version)
        .all<{ question_id: string; submissions: number; correct: number }>();
      const questionStats: PreformedQuestionStat[] = statRows.results.map(
        (item) => ({
          questionId: item.question_id,
          submissions: item.submissions,
          correct: item.correct,
        }),
      );
      return json({
        test: document(row),
        leaderboard: await rankedLeaderboard(row.id, row.version),
        questionStats,
      });
    }

    if (action === 'submit' && request.method === 'POST') {
      const input = await readJson<{
        submissionId?: string;
        attemptToken?: string;
        participantName?: string;
        answers?: Record<string, number>;
        guestScore?: number;
        durationSeconds?: number;
        participantKey?: string;
        attemptNumber?: number;
      }>(request, 128_000);
      const submissionId = input.submissionId ?? '';
      if (
        !/^[a-f0-9-]{20,100}$/i.test(submissionId) ||
        typeof input.attemptToken !== 'string' ||
        input.attemptToken.length !== 64
      )
        return json({ error: 'Invalid submission.' }, 400);
      const tokenHash = await digest(input.attemptToken);
      const token = await env.DB.prepare(
        'SELECT * FROM preformed_attempt_tokens WHERE token_hash=?',
      )
        .bind(tokenHash)
        .first<{
          test_id: string;
          version: number;
          user_id: string | null;
          issued_at: string;
          expires_at: string;
        }>();
      const receipt = await env.DB.prepare(
        'SELECT leaderboard,result_json FROM preformed_submission_receipts WHERE submission_id=?',
      )
        .bind(submissionId)
        .first<{ leaderboard: number; result_json: string | null }>();
      if (receipt) {
        if (!receipt.result_json)
          return json(
            { error: 'This submission is still being finalized. Try again.' },
            409,
          );
        return json({
          ...(JSON.parse(receipt.result_json) as Record<string, unknown>),
          duplicate: true,
        });
      }
      if (!token || Date.parse(token.expires_at) < Date.now())
        return json(
          { error: 'This attempt has expired. Open the test again.' },
          409,
        );
      const signedIn = approved(user);
      if (token.user_id && (!signedIn || token.user_id !== user.uid))
        return json(
          { error: 'This attempt belongs to another participant.' },
          403,
        );
      const row = await rowById(token.test_id);
      if (!row || row.version !== token.version || row.status !== 'published')
        return json(
          {
            error:
              'The test questions changed. This attempt can no longer be submitted.',
          },
          409,
        );
      const questions = JSON.parse(row.questions_json) as PreformedQuestion[];
      const answers =
        input.answers &&
        typeof input.answers === 'object' &&
        !Array.isArray(input.answers)
          ? input.answers
          : {};
      if (
        signedIn &&
        Object.entries(answers).some(
          ([id, answer]) =>
            !questions.some((question) => question.id === id) ||
            !Number.isInteger(answer),
        )
      )
        return json({ error: 'One or more answers are invalid.' }, 400);
      const guestScore = Number(input.guestScore);
      if (
        !signedIn &&
        (!Number.isInteger(guestScore) ||
          guestScore < 0 ||
          guestScore > questions.length)
      )
        return json({ error: 'The local guest result is invalid.' }, 400);
      const score = signedIn
        ? questions.reduce(
            (total, question) =>
              total + (answers[question.id] === question.answer ? 1 : 0),
            0,
          )
        : guestScore;
      const durationSeconds = Math.max(
        0,
        Math.min(7 * 86_400, Math.floor(Number(input.durationSeconds) || 0)),
      );
      const participantName = signedIn
        ? user.displayName
        : (input.participantName?.trim() ?? '').slice(0, 60);
      if (!participantName)
        return json({ error: 'Enter your name before submitting.' }, 400);
      const guestKey =
        typeof input.participantKey === 'string' &&
        /^[a-f0-9-]{20,100}$/i.test(input.participantKey)
          ? input.participantKey
          : '';
      if (!signedIn && !guestKey)
        return json(
          { error: 'This guest attempt is missing its local participant key.' },
          400,
        );
      const participantKey = signedIn
        ? `user:${user.uid}`
        : `guest:${await digest(`${row.id}:${guestKey}`)}`;
      const existingParticipation = signedIn
        ? await env.DB.prepare(
            'SELECT attempts FROM preformed_participation WHERE test_id=? AND version=? AND user_id=?',
          )
            .bind(row.id, row.version, user.uid)
            .first<{ attempts: number }>()
        : null;
      const attemptNumber = signedIn
        ? (existingParticipation?.attempts ?? 0) + 1
        : Math.max(
            1,
            Math.min(20, Math.floor(Number(input.attemptNumber) || 1)),
          );
      const now = new Date().toISOString();
      const preliminaryResult = {
        accepted: true,
        score,
        questionCount: questions.length,
        percentage: questions.length
          ? Math.round((score / questions.length) * 100)
          : 0,
        leaderboard: false,
        rank: null,
      };
      const statements: D1PreparedStatement[] = [
        env.DB.prepare(
          'INSERT INTO preformed_submission_receipts(submission_id,test_id,leaderboard,result_json,created_at) VALUES(?,?,0,?,?)',
        ).bind(submissionId, row.id, JSON.stringify(preliminaryResult), now),
      ];
      if (signedIn)
        statements.push(
          env.DB.prepare(`INSERT INTO preformed_participation(test_id,version,user_id,attempts,updated_at) VALUES(?,?,?,1,?)
          ON CONFLICT(test_id,version,user_id) DO UPDATE SET attempts=preformed_participation.attempts+1,updated_at=excluded.updated_at`).bind(
            row.id,
            row.version,
            user.uid,
            now,
          ),
        );
      if (signedIn) {
        const statValues = questions.map((question) => ({
          questionId: question.id,
          correct: answers[question.id] === question.answer ? 1 : 0,
        }));
        statements.push(
          env.DB.prepare(`INSERT INTO preformed_question_stats(test_id,version,question_id,submissions,correct)
          SELECT ?,?,json_extract(value,'$.questionId'),1,json_extract(value,'$.correct') FROM json_each(?) WHERE 1
          ON CONFLICT(test_id,version,question_id) DO UPDATE SET submissions=preformed_question_stats.submissions+1,correct=preformed_question_stats.correct+excluded.correct`).bind(
            row.id,
            row.version,
            JSON.stringify(statValues),
          ),
        );
      }
      statements.push(
        env.DB.prepare(`INSERT INTO preformed_leaderboard(id,test_id,version,participant_user_id,participant_key,participant_name,guest,score,question_count,duration_seconds,attempt_number,submitted_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          submissionId,
          row.id,
          row.version,
          signedIn ? user.uid : null,
          participantKey,
          participantName,
          signedIn ? 0 : 1,
          score,
          questions.length,
          durationSeconds,
          attemptNumber,
          now,
        ),
      );
      const testSettings = settings(row.settings_json);
      if (testSettings.attemptResultPolicy === 'latest')
        statements.push(
          env.DB.prepare(
            'DELETE FROM preformed_leaderboard WHERE test_id=? AND version=? AND participant_key=? AND id<>?',
          ).bind(row.id, row.version, participantKey, submissionId),
        );
      if (testSettings.attemptResultPolicy === 'highest')
        statements.push(
          env.DB.prepare(`DELETE FROM preformed_leaderboard WHERE test_id=? AND version=? AND participant_key=? AND id NOT IN (
          SELECT id FROM preformed_leaderboard WHERE test_id=? AND version=? AND participant_key=?
          ORDER BY score DESC,duration_seconds ASC,submitted_at ASC,id ASC LIMIT 1
        )`).bind(
            row.id,
            row.version,
            participantKey,
            row.id,
            row.version,
            participantKey,
          ),
        );
      statements.push(
        env.DB.prepare(`DELETE FROM preformed_leaderboard WHERE test_id=? AND version=? AND id NOT IN (
          SELECT id FROM preformed_leaderboard WHERE test_id=? AND version=? ORDER BY score DESC,duration_seconds ASC,submitted_at ASC,id ASC LIMIT 70
        )`).bind(row.id, row.version, row.id, row.version),
        env.DB.prepare(`UPDATE preformed_submission_receipts SET leaderboard=EXISTS(
          SELECT 1 FROM preformed_leaderboard WHERE id=?
        ) WHERE submission_id=?`).bind(submissionId, submissionId),
        env.DB.prepare(
          'DELETE FROM preformed_attempt_tokens WHERE token_hash=?',
        ).bind(tokenHash),
      );
      try {
        await env.DB.batch(statements);
      } catch (error) {
        if (String(error).includes('PREFORMED_ATTEMPT_LIMIT'))
          return json(
            { error: 'You have reached the attempt limit for this test.' },
            409,
          );
        if (!String(error).includes('UNIQUE constraint failed')) throw error;
      }
      const leaderboard = await rankedLeaderboard(row.id, row.version);
      const rank =
        leaderboard.find((entry) => entry.id === submissionId)?.rank ?? null;
      const result = { ...preliminaryResult, leaderboard: rank !== null, rank };
      await env.DB.prepare(
        'UPDATE preformed_submission_receipts SET leaderboard=?,result_json=? WHERE submission_id=?',
      )
        .bind(rank !== null ? 1 : 0, JSON.stringify(result), submissionId)
        .run();
      return json(result);
    }

    if (action === 'report' && request.method === 'POST') {
      if (!approved(user))
        return json({ error: 'Sign in to report a test.' }, 401);
      const input = await readJson<{ id?: string; reason?: string }>(request);
      const row = await rowById(input.id ?? '');
      const reason = input.reason?.trim() ?? '';
      if (
        !row ||
        row.visibility !== 'public' ||
        row.status !== 'published' ||
        !reason ||
        reason.length > 500
      )
        return json(
          { error: 'Choose a valid published public test and reason.' },
          400,
        );
      await env.DB.prepare(
        'INSERT INTO preformed_reports(id,test_id,reporter_id,reason,created_at) VALUES(?,?,?,?,?) ON CONFLICT(reporter_id,test_id) DO UPDATE SET reason=excluded.reason,created_at=excluded.created_at',
      )
        .bind(
          crypto.randomUUID(),
          row.id,
          user.uid,
          reason,
          new Date().toISOString(),
        )
        .run();
      return json({ ok: true });
    }

    if (action === 'reports' && request.method === 'GET') {
      if (!approved(user) || user.role !== 'super_admin' || !user.mfaVerified)
        return json({ error: 'Superadmin access required.' }, 403);
      const rows =
        await env.DB.prepare(`SELECT r.id,r.test_id,r.reporter_id,r.reason,r.created_at,t.title,t.code,t.status
        FROM preformed_reports r JOIN preformed_tests t ON t.id=r.test_id ORDER BY r.created_at DESC LIMIT 200`).all();
      return json({ reports: rows.results });
    }

    if (action === 'moderate' && request.method === 'PUT') {
      if (!approved(user) || user.role !== 'super_admin' || !user.mfaVerified)
        return json({ error: 'Superadmin access required.' }, 403);
      const input = await readJson<{ id?: string; hidden?: boolean }>(request);
      const row = await rowById(input.id ?? '');
      if (!row) return json({ error: 'Test not found.' }, 404);
      await env.DB.prepare(
        'UPDATE preformed_tests SET status=?,updated_at=? WHERE id=?',
      )
        .bind(
          input.hidden === false ? 'published' : 'hidden',
          new Date().toISOString(),
          row.id,
        )
        .run();
      return json({ ok: true });
    }

    if (action === 'delete' && request.method === 'DELETE') {
      if (!approved(user)) return json({ error: 'Sign in required.' }, 401);
      const input = await readJson<{ id?: string }>(request);
      const row = await rowById(input.id ?? '');
      if (!row || row.owner_id !== user.uid)
        return json({ error: 'Test owner access required.' }, 403);
      await env.DB.prepare('DELETE FROM preformed_tests WHERE id=?')
        .bind(row.id)
        .run();
      return json({ ok: true });
    }

    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(
      JSON.stringify({
        event: 'preformed_test_error',
        action,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return json(
      {
        error:
          error instanceof Error && !error.message.includes('D1_')
            ? error.message
            : 'The ready-made test request could not be completed.',
      },
      400,
    );
  }
}

export async function cleanPreformedTestOperations() {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM preformed_attempt_tokens WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    ),
    env.DB.prepare(
      "DELETE FROM preformed_submission_receipts WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')",
    ),
  ]);
}
