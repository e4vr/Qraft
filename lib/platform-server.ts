import { quote, type Discount } from '@/features/subscriptions/server/discount-quote';
import { AccessError, subscriptionApi } from '@/features/subscriptions/server/subscription-service';
import { detectImportDuplication, ImportDuplicateIndex, importLimits, importCandidates, importPreview, deleteImportDuplicate } from '@/features/imports/server/import-service';
import { importKeyStatement, importSearchRevision, importSearchGuard, releaseImportSearchGuard } from '@/features/imports/server/import-search';
import { env } from 'cloudflare:workers';
import { DEFAULT_LEGAL_LINKS } from './legal-links';
import { DEFAULT_ANNOUNCEMENT, DEFAULT_COMMUNITY_LINKS, validAnnouncementLink, validTelegramLink } from '@/features/announcements/domain/announcement';
import { announcementSettings } from '@/features/announcements/server/announcement-settings';
import { validImageAttachments } from '@/features/media/domain/image-attachments';
import { contributionReward } from '@/features/contributions/domain/contribution-reward';
import { giftNotificationApi } from '@/features/contributions/server/gift-notification';
import { readQuestionSource } from '@/features/qbanks/domain/question-source';
import { directQuestionEdit } from '@/features/qbanks/server/direct-question-edit';
import { classificationCleanupStatements } from '@/features/qbanks/server/classification-cleanup';
import { publicationClassificationResolver } from '@/features/qbanks/server/publication-classification';
import { importSettings } from '@/features/imports/server/import-settings';
import { validImportSettings } from '@/features/imports/domain/import-settings';
import { emitUsage } from '@/features/administration/server/usage-telemetry';
import { listAdminSubscribers } from './admin-subscribers';
import { reviewerPerformance } from './reviewer-performance-server';
import { testPool } from './test-pool-server';
import { exactImportIdentity } from '@/features/imports/domain/exact-import-duplicates';
import {
  currentUser,
  profileById,
} from '@/features/auth/server/auth-service';
import { assertSameOrigin, readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { ValidationError } from '@/server/http/errors';
import {
  canAccessBank,
  canEditBank,
  canManageBank,
  canReviewBank,
} from '@/features/access/domain/access-policy';
import {
  optionLabel,
  type AppUser,
  type MemberProfile,
  type QBankSpecialty,
  type QBankTopic,
  type Question,
  type QuestionProposal,
} from './medguard-types';
import { parseQuestionImportReport } from './question-import';
import { bankAccessState } from './qbank-access-repository';
import { allocateQuestionIds } from './question-id-repository';
import { applyEffectiveEntitlement, getEffectiveEntitlement } from './entitlement-server';
import {
  REWARD_CATALOG,
  PLAN_DURATION_MONTHS,
  contributionBadge,
  getPlanLimits,
  isPlanId,
  utcDayStart,
  utcMonthStart,
  type PlanId,
} from '@/features/subscriptions/domain/plan-config';
import { rewardWalletFields } from '@/features/subscriptions/server/access-sources';
import { activateRewardAccess } from '@/features/subscriptions/server/access-grants';
import {
  compareDuplicateContent,
  detectDuplicateReview,
  DUPLICATE_DETECTION_CONFIG,
  duplicateFingerprint,
  normalizeDuplicateText,
  prepareDuplicateCandidate,
} from '@/features/duplicates/domain/duplicate-detection';

function validatedImportReport(...args: Parameters<typeof parseQuestionImportReport>) {
  try { return parseQuestionImportReport(...args); }
  catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Invalid question file.'); }
}

type FinalizedDuplicateCandidate = {
  status: 'approved' | 'rejected';
  question?: Question;
};

function rebasePendingDuplicateReview(
  proposal: QuestionProposal,
  finalized: Map<string, FinalizedDuplicateCandidate>,
  now: string,
): QuestionProposal | undefined {
  const review = proposal.duplicateReview;
  if (proposal.status !== 'pending' || review?.status !== 'flagged') return undefined;
  let changed = false;
  const candidates = review.candidates.flatMap((finding) => {
    if (finding.entityType !== 'pending_proposal') return [finding];
    const outcome = finalized.get(finding.entityId);
    if (!outcome) return [finding];
    changed = true;
    if (outcome.status === 'rejected' || !outcome.question) return [];
    const question = outcome.question;
    const replacement = detectDuplicateReview({
      incoming: proposal.payload,
      qbankId: proposal.qbankId,
      sourceEntityId: proposal.id,
      now,
      candidates: [prepareDuplicateCandidate({
        entityId: question.id,
        entityType: 'approved_question',
        questionId: question.questionId,
        qbankId: question.qbankId ?? proposal.qbankId,
        payload: question,
      })],
    })?.candidates[0];
    return replacement ? [replacement] : [];
  });
  if (!changed) return undefined;
  return {
    ...proposal,
    duplicateReview: candidates.length ? { ...review, candidates } : undefined,
  };
}

const backupEncoder = new TextEncoder();

type PersonalBackupPayload = {
  format: 'qraft-personal-backup-v1';
  signatureVersion: 'hmac-sha256-v1';
  ownerId: string;
  exportedAt: string;
  flashcards: Record<string, unknown> | null;
  records: Array<Record<string, unknown>>;
};

function backupSigningKey() {
  const value = env.BACKUP_SIGNING_KEY?.trim() ?? '';
  return value.length >= 32 ? value : undefined;
}

function bytesToHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function signPersonalBackup(
  payload: PersonalBackupPayload,
  secret: string,
) {
  const key = await crypto.subtle.importKey(
    'raw',
    backupEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      backupEncoder.encode(JSON.stringify(payload)),
    ),
  );
}

async function personalBackupSignatureIsValid(
  payload: PersonalBackupPayload,
  signature: unknown,
  secret: string,
) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature))
    return false;
  const expected = await signPersonalBackup(payload, secret);
  let mismatch = expected.length ^ signature.length;
  for (let index = 0; index < expected.length; index += 1)
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}

export function auditStatement(
  user: Pick<AppUser, 'uid' | 'displayName'>,
  action: string,
  target: string,
  previous: unknown,
  next: unknown,
  status = 'success',
) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return env.DB.prepare(
    'INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES(?,?,?,?,?)',
  ).bind(
    'auditLog',
    id,
    user.uid,
    JSON.stringify({
      id,
      action,
      entityType: 'account',
      entityId: target,
      actorId: user.uid,
      actorName: user.displayName,
      createdAt: now,
      detail: JSON.stringify({ previous, next, status }),
    }),
    now,
  );
}

export async function expireSubscriptions() {
  const now = new Date().toISOString();
  const expiring = await env.DB.prepare(`SELECT g.id,g.user_id FROM access_grants g WHERE g.revoked_at IS NULL AND g.expires_at<=?
    AND NOT EXISTS(SELECT 1 FROM records r WHERE r.type='auditLog' AND r.id='expired-ledger-'||g.id) ORDER BY g.expires_at LIMIT 1000`).bind(now).all<{id:string;user_id:string}>();
  if (!expiring.results.length) return [];
  await env.DB.prepare(`INSERT INTO records(type,id,owner_id,payload,updated_at)
    SELECT 'auditLog','expired-ledger-'||id,user_id,json_object('id','expired-ledger-'||id,'action','access_expired','entityType','account','entityId',user_id,'actorId','system','actorName','Qraft','createdAt',?,'detail','Access grant expired'),?
    FROM access_grants WHERE id IN (SELECT value FROM json_each(?)) AND revoked_at IS NULL AND expires_at<=?
    ON CONFLICT(type,id) DO NOTHING`).bind(now,now,JSON.stringify(expiring.results.map(grant => grant.id)),now).run();
  return [...new Set(expiring.results.map(grant => grant.user_id))];
}

function paidPlan(value: string): Exclude<PlanId, 'free'> {
  if (!value) return 'full_monthly';
  if (!isPlanId(value) || value === 'free') throw new ValidationError('Choose a Full Access subscription period.');
  return value;
}

function normalizeClassificationName(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function validClassificationName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 120;
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

type ImportAttemptStatus =
  | 'completed'
  | 'partial'
  | 'duplicate_only'
  | 'rejected'
  | 'failed';

type ImportMonitorContext = {
  runId: string;
  requestId: string;
  userId: string;
  qbankId: string;
  fileName: string;
  normalizedName: string;
  fileHash: string;
  chunkHash: string;
  sourceFile: string;
  chunkIndex: number;
  chunkCount: number;
  startedAt: string;
};

type ImportMonitorOutcome = {
  status: ImportAttemptStatus;
  total?: number;
  successful?: number;
  invalid?: number;
  skippedDuplicates?: number;
  flaggedDuplicates?: number;
  repaired?: boolean;
  report?: unknown[];
  errorCode?: string;
  errorMessage?: string;
};

function importRunRefreshStatement(runId: string, now: string) {
  return env.DB.prepare(`UPDATE json_import_runs AS run SET
    completed_chunks=(SELECT count(*) FROM json_import_attempts WHERE run_id=run.id),
    total_count=coalesce((SELECT sum(total_count) FROM json_import_attempts WHERE run_id=run.id),0),
    successful_count=coalesce((SELECT sum(successful_count) FROM json_import_attempts WHERE run_id=run.id),0),
    invalid_count=coalesce((SELECT sum(invalid_count) FROM json_import_attempts WHERE run_id=run.id),0),
    skipped_duplicate_count=coalesce((SELECT sum(skipped_duplicate_count) FROM json_import_attempts WHERE run_id=run.id),0),
    flagged_duplicate_count=coalesce((SELECT sum(flagged_duplicate_count) FROM json_import_attempts WHERE run_id=run.id),0),
    error_code=(SELECT error_code FROM json_import_attempts WHERE run_id=run.id AND error_code IS NOT NULL ORDER BY updated_at DESC LIMIT 1),
    error_message=(SELECT error_message FROM json_import_attempts WHERE run_id=run.id AND error_message IS NOT NULL ORDER BY updated_at DESC LIMIT 1),
    status=CASE
      WHEN EXISTS(SELECT 1 FROM json_import_attempts WHERE run_id=run.id AND status='failed') THEN 'failed'
      WHEN EXISTS(SELECT 1 FROM json_import_attempts WHERE run_id=run.id AND status='rejected')
       AND coalesce((SELECT sum(successful_count) FROM json_import_attempts WHERE run_id=run.id),0)=0 THEN 'rejected'
      WHEN EXISTS(SELECT 1 FROM json_import_attempts WHERE run_id=run.id AND status='rejected') THEN 'partial'
      WHEN (SELECT count(*) FROM json_import_attempts WHERE run_id=run.id)<run.chunk_count THEN 'processing'
      WHEN coalesce((SELECT sum(successful_count) FROM json_import_attempts WHERE run_id=run.id),0)=0
       AND coalesce((SELECT sum(skipped_duplicate_count) FROM json_import_attempts WHERE run_id=run.id),0)>0
       AND NOT EXISTS(SELECT 1 FROM json_import_attempts WHERE run_id=run.id AND status='rejected') THEN 'duplicate_only'
      WHEN EXISTS(SELECT 1 FROM json_import_attempts WHERE run_id=run.id AND status='partial')
        OR coalesce((SELECT sum(invalid_count+skipped_duplicate_count+flagged_duplicate_count) FROM json_import_attempts WHERE run_id=run.id),0)>0 THEN 'partial'
      ELSE 'completed'
    END,
    completed_at=CASE
      WHEN (SELECT count(*) FROM json_import_attempts WHERE run_id=run.id)>=run.chunk_count THEN ?
      ELSE NULL
    END,
    updated_at=?
    WHERE run.id=?`).bind(now, now, runId);
}

async function beginImportMonitoring(context: ImportMonitorContext) {
  const existing = await env.DB.prepare(
    'SELECT user_id,qbank_id,normalized_name,file_hash FROM json_import_runs WHERE id=?',
  )
    .bind(context.runId)
    .first<{
      user_id: string;
      qbank_id: string;
      normalized_name: string;
      file_hash: string;
    }>();
  if (
    existing &&
    (existing.user_id !== context.userId ||
      existing.qbank_id !== context.qbankId ||
      existing.normalized_name !== context.normalizedName ||
      existing.file_hash !== context.fileHash)
  )
    throw new ValidationError('Invalid or reused upload session ID.');
  const write = await env.DB.prepare(`INSERT INTO json_import_runs(
    id,user_id,qbank_id,file_name,normalized_name,file_hash,source_file,status,
    chunk_count,started_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,'processing',?,?,?)
  ON CONFLICT(id) DO UPDATE SET
    qbank_id=excluded.qbank_id,
    file_name=excluded.file_name,
    normalized_name=excluded.normalized_name,
    file_hash=excluded.file_hash,
    source_file=CASE WHEN excluded.source_file<>'' THEN excluded.source_file ELSE json_import_runs.source_file END,
    chunk_count=max(json_import_runs.chunk_count,excluded.chunk_count),
    updated_at=excluded.updated_at
  WHERE json_import_runs.user_id=excluded.user_id
    AND json_import_runs.qbank_id=excluded.qbank_id
    AND json_import_runs.normalized_name=excluded.normalized_name
    AND json_import_runs.file_hash=excluded.file_hash`)
    .bind(
      context.runId,
      context.userId,
      context.qbankId,
      context.fileName,
      context.normalizedName,
      context.fileHash,
      context.sourceFile,
      context.chunkCount,
      context.startedAt,
      context.startedAt,
    )
    .run();
  if ((write.meta.changes ?? 0) === 0)
    throw new ValidationError('Invalid or reused upload session ID.');
}

function importMonitoringStatements(
  context: ImportMonitorContext,
  outcome: ImportMonitorOutcome,
) {
  const now = new Date().toISOString();
  const total = Math.max(0, outcome.total ?? 0);
  const successful = Math.max(0, outcome.successful ?? 0);
  const invalid = Math.max(0, outcome.invalid ?? 0);
  const skippedDuplicates = Math.max(0, outcome.skippedDuplicates ?? 0);
  const flaggedDuplicates = Math.max(0, outcome.flaggedDuplicates ?? 0);
  return [
    env.DB.prepare(`UPDATE json_import_runs SET
      source_file=CASE WHEN ?<>'' THEN ? ELSE source_file END,
      repaired=max(repaired,?),updated_at=? WHERE id=?`)
      .bind(
        context.sourceFile,
        context.sourceFile,
        outcome.repaired ? 1 : 0,
        now,
        context.runId,
      ),
    env.DB.prepare(`INSERT INTO json_import_attempts(
      request_id,run_id,user_id,chunk_index,chunk_hash,status,total_count,
      successful_count,invalid_count,skipped_duplicate_count,
      flagged_duplicate_count,report_json,error_code,error_message,started_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(request_id) DO UPDATE SET
      run_id=excluded.run_id,
      chunk_index=excluded.chunk_index,
      chunk_hash=excluded.chunk_hash,
      status=excluded.status,
      total_count=excluded.total_count,
      successful_count=excluded.successful_count,
      invalid_count=excluded.invalid_count,
      skipped_duplicate_count=excluded.skipped_duplicate_count,
      flagged_duplicate_count=excluded.flagged_duplicate_count,
      report_json=excluded.report_json,
      error_code=excluded.error_code,
      error_message=excluded.error_message,
      updated_at=excluded.updated_at`)
      .bind(
        context.requestId,
        context.runId,
        context.userId,
        context.chunkIndex,
        context.chunkHash,
        outcome.status,
        total,
        successful,
        invalid,
        skippedDuplicates,
        flaggedDuplicates,
        JSON.stringify(outcome.report ?? []),
        outcome.errorCode ?? null,
        outcome.errorMessage?.slice(0, 500) ?? null,
        context.startedAt,
        now,
      ),
    importRunRefreshStatement(context.runId, now),
  ];
}

async function rejectImport(
  context: ImportMonitorContext,
  errorCode: string,
  errorMessage: string,
  status: number,
  outcome: Omit<ImportMonitorOutcome, 'status' | 'errorCode' | 'errorMessage'> = {},
) {
  await env.DB.batch(
    importMonitoringStatements(context, {
      ...outcome,
      status: 'rejected',
      errorCode,
      errorMessage,
    }),
  );
  return json({ error: errorMessage, code: errorCode }, status);
}

export async function platformApi(request: Request, action: string) {
  if (request.method !== 'GET') assertSameOrigin(request);
  if (action === 'announcement' && request.method === 'GET' && new URL(request.url).searchParams.get('manage') !== '1') {
    const viewer = await currentUser(request);
    if (!viewer || viewer.status !== 'approved' || viewer.suspended) return json(DEFAULT_ANNOUNCEMENT);
    const current = await announcementSettings();
    if (!current.enabled) return json(DEFAULT_ANNOUNCEMENT);
    const seen = await env.DB.prepare("SELECT json_extract(payload,'$.revision') AS revision FROM records WHERE type='announcementDismissals' AND id=? AND owner_id=?").bind(viewer.uid, viewer.uid).first<{ revision: string }>();
    return json({ ...current, dismissed: seen?.revision === current.revision });
  }
  const user = await currentUser(request);
  if (!user || user.status !== 'approved' || user.suspended)
    return json({ error: 'Approved account required.' }, 403);
  const url = new URL(request.url);
  const input =
    request.method === 'GET'
      ? {}
      : await readJson<Record<string, unknown>>(
          request,
          action === 'content-backup' || action === 'personal-backup'
            ? 50_000_000
            : 2_000_000,
        );
  const text = (key: string) =>
    typeof input[key] === 'string' ? (input[key] as string).trim() : '';
  const root =
    user.role === 'super_admin' && user.mfaEnrolled && user.mfaVerified;
  let activeImportContext: ImportMonitorContext | undefined;
  try {
    if (['access-account','access-admin','activation-code','activation-codes'].includes(action)) return subscriptionApi(request, action, user, input);
    if (action === 'gift-notification') return giftNotificationApi(request, user.uid, input);
    if (action === 'announcement-dismiss') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const current = await announcementSettings();
      if (!current.enabled || text('revision') !== current.revision) return json({ error: 'This announcement changed. Refresh before dismissing it.' }, 409);
      const now = new Date().toISOString();
      const result = await env.DB.prepare("INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES('announcementDismissals',?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at WHERE json_extract(records.payload,'$.revision')!=json_extract(excluded.payload,'$.revision')").bind(user.uid, user.uid, JSON.stringify({ revision: current.revision }), now).run();
      return json({ ok: true }, 200, result.meta.changes ? undefined : { 'x-qraft-unchanged': '1' });
    }
    if (action === 'question-edit') {
      if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
      return directQuestionEdit(user, input);
    }
    if (action === 'reviewer-performance' && request.method === 'GET') return reviewerPerformance(user, url);
    if (action === 'test-pool' && request.method === 'POST') return testPool(user, input);
    if (action === 'classification' && request.method === 'PUT') {
      const qbankId = text('qbankId');
      const operationId = text('operationId');
      const baseRevision = input.baseRevision;
      const specialties = input.specialties as QBankSpecialty[] | undefined;
      const topics = input.topics as QBankTopic[] | undefined;
      const assignments = input.assignments as Array<{ questionId: string; topicId: string }> | undefined;
      if (
        !qbankId ||
        !/^[a-zA-Z0-9-]{20,100}$/.test(operationId) ||
        !Number.isInteger(baseRevision) ||
        (baseRevision as number) < 0 ||
        !Array.isArray(specialties) ||
        specialties.length > 250 ||
        !Array.isArray(topics) ||
        topics.length > 2_000 ||
        !Array.isArray(assignments) ||
        assignments.length > 500
      ) return json({ error: 'Invalid classification change set.' }, 400);
      const state = await bankAccessState(qbankId);
      const bank = state.qbanks.find((item) => item.id === qbankId);
      if (!bank || !canEditBank(user, bank, state.memberships))
        return json({ error: 'QBank editing access is required to change its classification structure.' }, 403);
      if (bank.essential && user.role !== 'super_admin')
        return json({ error: 'Only Superadmin can change an Essential QBank structure.' }, 403);

      const previousOperation = await env.DB.prepare(
        'SELECT revision FROM classification_operations WHERE operation_id=? AND user_id=? AND qbank_id=?',
      ).bind(operationId, user.uid, qbankId).first<{ revision: number }>();
      const currentRows = await env.DB.prepare(
        "SELECT type,payload FROM records WHERE qbank_id=? AND type IN ('qbankSpecialties','qbankTopics')",
      ).bind(qbankId).all<{ type: string; payload: string }>();
      const currentSpecialties = currentRows.results
        .filter((row) => row.type === 'qbankSpecialties')
        .map((row) => JSON.parse(row.payload) as QBankSpecialty);
      const currentTopics = currentRows.results
        .filter((row) => row.type === 'qbankTopics')
        .map((row) => JSON.parse(row.payload) as QBankTopic);
      const currentRevision = await env.DB.prepare(
        'SELECT revision FROM qbank_classification_revisions WHERE qbank_id=?',
      ).bind(qbankId).first<{ revision: number }>();
      if (previousOperation) {
        const savedAssignments = await env.DB.prepare(`SELECT id AS questionId,
          json_extract(payload,'$.topicId') AS topicId,json_extract(payload,'$.topic') AS topic,
          json_extract(payload,'$.specialtyId') AS specialtyId,json_extract(payload,'$.specialty') AS specialty
          FROM records WHERE type='sharedQuestions' AND qbank_id=? AND id IN (SELECT value FROM json_each(?))`)
          .bind(qbankId, JSON.stringify(assignments.map(item => item?.questionId).filter(id => typeof id === 'string'))).all();
        return json({ ok: true, revision: currentRevision?.revision ?? previousOperation.revision,
          specialties: currentSpecialties, topics: currentTopics, assignments: savedAssignments.results,
          unchanged: true }, 200, { 'x-qraft-unchanged': '1' });
      }
      if ((currentRevision?.revision ?? 0) !== baseRevision)
        return json({
          error: 'The classification structure changed on another device. Your draft was kept; review the latest version and try again.',
          code: 'CLASSIFICATION_CONFLICT',
          revision: currentRevision?.revision ?? 0,
          specialties: currentSpecialties,
          topics: currentTopics,
        }, 409);

      const specialtyIds = new Set<string>();
      const topicIds = new Set<string>();
      if (specialties.some((item) =>
        !item || typeof item.id !== 'string' || !item.id || item.id.length > 200 ||
        item.qbankId !== qbankId || !validClassificationName(item.name) ||
        specialtyIds.has(item.id) || (specialtyIds.add(item.id), false)
      )) return json({ error: 'A specialty is invalid or repeated.' }, 400);
      if (topics.some((item) =>
        !item || typeof item.id !== 'string' || !item.id || item.id.length > 200 ||
        item.qbankId !== qbankId || !specialtyIds.has(item.specialtyId) ||
        !validClassificationName(item.name) || topicIds.has(item.id) ||
        (topicIds.add(item.id), false)
      )) return json({ error: 'A topic is invalid, repeated, or has no specialty.' }, 400);
      const foreignId = await env.DB.prepare(
        `SELECT id FROM records WHERE type IN ('qbankSpecialties','qbankTopics')
         AND id IN (SELECT value FROM json_each(?)) AND qbank_id<>? LIMIT 1`,
      ).bind(JSON.stringify([...specialtyIds, ...topicIds]), qbankId).first<{ id: string }>();
      if (foreignId) return json({ error: 'A classification ID belongs to another QBank.' }, 409);

      const validateNewUniqueness = <T extends { id: string; name: string }>(
        next: T[],
        current: T[],
        parent: (item: T) => string,
        label: string,
      ) => {
        const nextGroups = new Map<string, T[]>();
        for (const item of next) {
          const key = `${parent(item)}\u0000${normalizeClassificationName(item.name)}`;
          nextGroups.set(key, [...(nextGroups.get(key) ?? []), item]);
        }
        const currentById = new Map(current.map((item) => [item.id, item]));
        for (const group of nextGroups.values()) {
          if (group.length < 2) continue;
          const grandfathered = group.every((item) => {
            const old = currentById.get(item.id);
            return old && old.name === item.name && parent(old) === parent(item);
          });
          if (!grandfathered) return `${label} names must be unique in their parent. Choose Merge or Change name.`;
        }
        return '';
      };
      const duplicateError =
        validateNewUniqueness(specialties, currentSpecialties, () => qbankId, 'Specialty') ||
        validateNewUniqueness(topics, currentTopics, (item) => item.specialtyId, 'Topic');
      if (duplicateError) return json({ error: duplicateError, code: 'DUPLICATE_CLASSIFICATION' }, 409);

      const assignmentByQuestion = new Map<string, string>();
      for (const assignment of assignments) {
        if (!assignment || typeof assignment.questionId !== 'string' ||
            typeof assignment.topicId !== 'string' || !topicIds.has(assignment.topicId) ||
            assignmentByQuestion.has(assignment.questionId))
          return json({ error: 'A question assignment is invalid or repeated.' }, 400);
        assignmentByQuestion.set(assignment.questionId, assignment.topicId);
      }
      const questionRows = await env.DB.prepare(
        "SELECT id,payload FROM records WHERE type='sharedQuestions' AND qbank_id=?",
      ).bind(qbankId).all<{ id: string; payload: string }>();
      const topicById = new Map(topics.map((item) => [item.id, item]));
      const specialtyById = new Map(specialties.map((item) => [item.id, item]));
      const assignmentValues: Array<{ questionId: string; topicId: string; topic: string; specialtyId: string; specialty: string }> = [];
      for (const row of questionRows.results) {
        const question = JSON.parse(row.payload) as Question;
        let targetId = assignmentByQuestion.get(row.id) ?? question.topicId;
        if (!targetId) {
          targetId = topics.find((topic) => {
            const specialty = specialtyById.get(topic.specialtyId);
            return topic.name === question.topic && specialty?.name === question.specialty;
          })?.id;
        }
        if (!targetId || !topicById.has(targetId))
          return json({ error: `Question ${question.questionId ?? row.id} needs a destination before its classification can be removed.` }, 409);
        if (assignmentByQuestion.has(row.id)) {
          const topic = topicById.get(targetId)!;
          const specialty = specialtyById.get(topic.specialtyId)!;
          assignmentValues.push({ questionId: row.id, topicId: topic.id, topic: topic.name, specialtyId: specialty.id, specialty: specialty.name });
        }
      }
      if ([...assignmentByQuestion.keys()].some((id) => !questionRows.results.some((row) => row.id === id)))
        return json({ error: 'One or more selected questions no longer exist.' }, 409);

      const now = new Date().toISOString();
      const nextRevision = (baseRevision as number) + 1;
      const stampedSpecialties = specialties.map((item, order) => ({ ...item, order, updatedAt: now }));
      const stampedTopics = topics.map((item, order) => ({ ...item, order, updatedAt: now }));
      try {
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO qbank_classification_revisions(qbank_id,revision,updated_at) VALUES(?,?,?)
            ON CONFLICT(qbank_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at`)
            .bind(qbankId, nextRevision, now),
          env.DB.prepare(`DELETE FROM records WHERE qbank_id=? AND type='qbankTopics'
            AND id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))`)
            .bind(qbankId, JSON.stringify(stampedTopics)),
          env.DB.prepare(`DELETE FROM records WHERE qbank_id=? AND type='qbankSpecialties'
            AND id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))`)
            .bind(qbankId, JSON.stringify(stampedSpecialties)),
          env.DB.prepare(`INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at)
            SELECT 'qbankSpecialties',json_extract(value,'$.id'),?,?,value,? FROM json_each(?) WHERE 1
            ON CONFLICT(type,id) DO UPDATE SET qbank_id=excluded.qbank_id,owner_id=excluded.owner_id,payload=excluded.payload,updated_at=excluded.updated_at`)
            .bind(qbankId, user.uid, now, JSON.stringify(stampedSpecialties)),
          env.DB.prepare(`INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at)
            SELECT 'qbankTopics',json_extract(value,'$.id'),?,?,value,? FROM json_each(?) WHERE 1
            ON CONFLICT(type,id) DO UPDATE SET qbank_id=excluded.qbank_id,owner_id=excluded.owner_id,payload=excluded.payload,updated_at=excluded.updated_at`)
            .bind(qbankId, user.uid, now, JSON.stringify(stampedTopics)),
          env.DB.prepare(`UPDATE records SET payload=json_set(
              payload,'$.topicId',(SELECT json_extract(value,'$.topicId') FROM json_each(?) WHERE json_extract(value,'$.questionId')=records.id),
              '$.topic',(SELECT json_extract(value,'$.topic') FROM json_each(?) WHERE json_extract(value,'$.questionId')=records.id),
              '$.specialtyId',(SELECT json_extract(value,'$.specialtyId') FROM json_each(?) WHERE json_extract(value,'$.questionId')=records.id),
              '$.specialty',(SELECT json_extract(value,'$.specialty') FROM json_each(?) WHERE json_extract(value,'$.questionId')=records.id)
            ),updated_at=? WHERE type='sharedQuestions' AND qbank_id=?
              AND id IN (SELECT json_extract(value,'$.questionId') FROM json_each(?))`)
            .bind(JSON.stringify(assignmentValues), JSON.stringify(assignmentValues), JSON.stringify(assignmentValues), JSON.stringify(assignmentValues), now, qbankId, JSON.stringify(assignmentValues)),
          env.DB.prepare('INSERT INTO classification_operations(operation_id,user_id,qbank_id,revision,created_at) VALUES(?,?,?,?,?)')
            .bind(operationId, user.uid, qbankId, nextRevision, now),
          auditStatement(user, 'qbank_classification_saved', qbankId, { revision: baseRevision }, { revision: nextRevision, specialties: stampedSpecialties.length, topics: stampedTopics.length, assignments: assignmentValues.length }),
          ...classificationCleanupStatements(env.DB, [qbankId], now),
        ]);
      } catch (error) {
        if (String(error).includes('CLASSIFICATION_CONFLICT')) {
          const latestRows = await env.DB.prepare(
            "SELECT type,payload FROM records WHERE qbank_id=? AND type IN ('qbankSpecialties','qbankTopics')",
          ).bind(qbankId).all<{ type: string; payload: string }>();
          const latestRevision = await env.DB.prepare(
            'SELECT revision FROM qbank_classification_revisions WHERE qbank_id=?',
          ).bind(qbankId).first<{ revision: number }>();
          return json({
            error: 'The classification structure changed on another device. Your draft was kept.',
            code: 'CLASSIFICATION_CONFLICT',
            revision: latestRevision?.revision ?? 0,
            specialties: latestRows.results.filter((row) => row.type === 'qbankSpecialties').map((row) => JSON.parse(row.payload)),
            topics: latestRows.results.filter((row) => row.type === 'qbankTopics').map((row) => JSON.parse(row.payload)),
          }, 409);
        }
        throw error;
      }
      const [savedRows, savedRevision] = await env.DB.batch([
        env.DB.prepare("SELECT type,payload FROM records WHERE qbank_id=? AND type IN ('qbankSpecialties','qbankTopics')").bind(qbankId),
        env.DB.prepare('SELECT revision FROM qbank_classification_revisions WHERE qbank_id=?').bind(qbankId),
      ]);
      const savedClassifications = savedRows.results as Array<{ type: string; payload: string }>;
      return json({ ok: true,
        revision: (savedRevision.results[0] as { revision: number }).revision,
        specialties: savedClassifications.filter(row => row.type === 'qbankSpecialties').map(row => JSON.parse(row.payload)),
        topics: savedClassifications.filter(row => row.type === 'qbankTopics').map(row => JSON.parse(row.payload)),
        assignments: assignmentValues });
    }
    if (action === 'import-preview' && request.method === 'POST') {
      if (!root && !(user.planLimits ?? getPlanLimits(user.effectivePlan ?? user.tier)).canUseJsonImport)
        return json({ error: 'Import is available with Full Access.' }, 403);
      const settings = await importSettings();
      if (!root && !settings.enabled) return json({ error: 'JSON import is temporarily paused by Superadmin.' }, 403);
      const now = new Date().toISOString();
      const suspension = await env.DB.prepare('SELECT ends_at FROM json_import_suspensions WHERE user_id=? AND removed_at IS NULL AND starts_at<=? AND ends_at>? LIMIT 1')
        .bind(user.uid, now, now).first<{ ends_at: string }>();
      if (suspension) return json({ error: `Import is suspended until ${suspension.ends_at}.` }, 403);
      if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > settings.previewBatchSize)
        return json({ error: `Review between 1 and ${settings.previewBatchSize} questions per request.` }, 400);
      const report=validatedImportReport({sourceFile:text('sourceFile'),questions:input.questions},'',settings.previewBatchSize);
      if(report.skipped.length) return json({error:'Correct the invalid question before checking duplication.'},400);
      return importPreview(user,report.questions,text('qbankId'));
    }
    if (action === 'import-delete-duplicate' && request.method === 'POST') return deleteImportDuplicate(user,input);
    if (action === 'json-import-status' && request.method === 'GET') {
      const now = new Date().toISOString();
      const suspension = await env.DB.prepare(
        'SELECT ends_at FROM json_import_suspensions WHERE user_id=? AND removed_at IS NULL AND starts_at<=? AND ends_at>? ORDER BY ends_at DESC LIMIT 1',
      )
        .bind(user.uid, now, now)
        .first<{ ends_at: string }>();
      return json({
        suspended: Boolean(suspension),
        endsAt: suspension?.ends_at ?? null,
        ...(await importLimits(user)),
        settings: await importSettings(),
        isSuperadmin: root,
      });
    }
    if (action === 'json-imports') {
      if (!root)
        return json({ error: 'Verified Superadmin access required.' }, 403);
      if (request.method === 'GET') {
        const runId = (url.searchParams.get('run') ?? '').trim();
        if (runId) {
          const run = await env.DB.prepare(`SELECT
            run.*,
            profile.email AS user_email,
            json_extract(profile.profile_json,'$.displayName') AS user_name,
            json_extract(bank.payload,'$.name') AS qbank_name,
            CASE WHEN run.status='processing'
              AND julianday(run.updated_at)<julianday('now','-30 minutes')
              THEN 1 ELSE 0 END AS stale,
            (SELECT count(*) FROM json_import_runs AS sibling
             WHERE sibling.file_hash=run.file_hash AND sibling.deleted_at IS NULL) AS same_hash_count
          FROM json_import_runs AS run
          LEFT JOIN profiles AS profile ON profile.uid=run.user_id
          LEFT JOIN records AS bank ON bank.type='qbanks' AND bank.id=run.qbank_id
          WHERE run.id=? AND run.deleted_at IS NULL LIMIT 1`)
            .bind(runId)
            .first<Record<string, unknown>>();
          if (!run) return json({ error: 'Import run not found.' }, 404);
          const attempts = await env.DB.prepare(`SELECT
            request_id,chunk_index,chunk_hash,status,total_count,
            successful_count,invalid_count,skipped_duplicate_count,
            flagged_duplicate_count,report_json,error_code,error_message,
            started_at,updated_at
          FROM json_import_attempts WHERE run_id=? ORDER BY chunk_index,started_at`)
            .bind(runId)
            .all<Record<string, unknown>>();
          return json({ run, attempts: attempts.results });
        }

        const requestedPage = Number(url.searchParams.get('page') ?? 0);
        const page = Number.isInteger(requestedPage)
          ? Math.max(0, Math.min(10_000, requestedPage))
          : 0;
        const requestedPageSize = Number(url.searchParams.get('pageSize') ?? 25);
        const pageSize = Number.isInteger(requestedPageSize)
          ? Math.max(10, Math.min(100, requestedPageSize))
          : 25;
        const status = (url.searchParams.get('status') ?? '').trim();
        const qbankId = (url.searchParams.get('qbankId') ?? '').trim();
        const userId = (url.searchParams.get('userId') ?? '').trim();
        const search = (url.searchParams.get('search') ?? '')
          .trim()
          .slice(0, 120);
        const validStatuses = new Set([
          'processing',
          'completed',
          'partial',
          'duplicate_only',
          'rejected',
          'failed',
        ]);
        if (status && !validStatuses.has(status))
          return json({ error: 'Invalid import status filter.' }, 400);
        const clauses = ['run.deleted_at IS NULL'];
        const bindings: Array<string | number> = [];
        if (status) {
          clauses.push('run.status=?');
          bindings.push(status);
        }
        if (qbankId) {
          clauses.push('run.qbank_id=?');
          bindings.push(qbankId);
        }
        if (userId) {
          clauses.push('run.user_id=?');
          bindings.push(userId);
        }
        if (search) {
          clauses.push(`(
            instr(lower(run.file_name),lower(?))>0 OR
            instr(lower(run.file_hash),lower(?))>0 OR
            instr(lower(run.id),lower(?))>0 OR
            instr(lower(profile.email),lower(?))>0 OR
            instr(lower(json_extract(profile.profile_json,'$.displayName')),lower(?))>0
          )`);
          bindings.push(search, search, search, search, search);
        }
        const where = clauses.join(' AND ');
        const rows = await env.DB.prepare(`SELECT
          run.*,
          profile.email AS user_email,
          json_extract(profile.profile_json,'$.displayName') AS user_name,
          json_extract(bank.payload,'$.name') AS qbank_name,
          CASE WHEN run.status='processing'
            AND julianday(run.updated_at)<julianday('now','-30 minutes')
            THEN 1 ELSE 0 END AS stale,
          (SELECT count(*) FROM json_import_runs AS sibling
           WHERE sibling.file_hash=run.file_hash AND sibling.deleted_at IS NULL) AS same_hash_count
        FROM json_import_runs AS run
        LEFT JOIN profiles AS profile ON profile.uid=run.user_id
        LEFT JOIN records AS bank ON bank.type='qbanks' AND bank.id=run.qbank_id
        WHERE ${where}
        ORDER BY run.started_at DESC,run.id DESC LIMIT ? OFFSET ?`)
          .bind(...bindings, pageSize, page * pageSize)
          .all<Record<string, unknown>>();
        const count = await env.DB.prepare(`SELECT count(*) AS value
          FROM json_import_runs AS run
          LEFT JOIN profiles AS profile ON profile.uid=run.user_id
          WHERE ${where}`)
          .bind(...bindings)
          .first<{ value: number }>();
        const summary = await env.DB.prepare(`SELECT
          count(*) AS runs,
          coalesce(sum(successful_count),0) AS successful,
          coalesce(sum(invalid_count),0) AS invalid,
          coalesce(sum(skipped_duplicate_count),0) AS duplicates,
          coalesce(sum(flagged_duplicate_count),0) AS flagged,
          coalesce(sum(CASE
            WHEN status IN ('rejected','failed') THEN 1
            WHEN status='processing'
              AND julianday(updated_at)<julianday('now','-30 minutes') THEN 1
            ELSE 0 END),0) AS failed
        FROM json_import_runs WHERE deleted_at IS NULL`)
          .first<Record<string, number>>();
        return json({
          runs: rows.results,
          summary: summary ?? {
            runs: 0,
            successful: 0,
            invalid: 0,
            duplicates: 0,
            flagged: 0,
            failed: 0,
          },
          page,
          pageSize,
          total: count?.value ?? 0,
        });
      }
      if (request.method === 'DELETE') {
        const runId = text('runId');
        if (!/^[a-zA-Z0-9:-]{20,120}$/.test(runId))
          return json({ error: 'Invalid import run.' }, 400);
        const now = new Date().toISOString();
        const existing = await env.DB.prepare(
          'SELECT status,file_name,updated_at FROM json_import_runs WHERE id=? AND deleted_at IS NULL',
        )
          .bind(runId)
          .first<{ status: string; file_name: string; updated_at: string }>();
        if (!existing) return json({ error: 'Import run not found.' }, 404);
        const staleBefore = Date.now() - 30 * 60 * 1000;
        if (
          existing.status === 'processing' &&
          Date.parse(existing.updated_at) >= staleBefore
        )
          return json({ error: 'A running import cannot be removed.' }, 409);
        await env.DB.batch([
          env.DB.prepare(
            'UPDATE json_import_runs SET deleted_at=?,deleted_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL',
          ).bind(now, user.uid, now, runId),
          auditStatement(user, 'json_import_history_removed', runId, null, {
            fileName: existing.file_name,
            contentPreserved: true,
          }),
        ]);
        return json({ ok: true });
      }
      return json({ error: 'Method not allowed.' }, 405);
    }
    if (action === 'announcement') {
      if (!root) return json({ error: 'Superadmin access required.' }, 403);
      const current = await announcementSettings();
      if (request.method === 'GET') return json(current);
      if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
      const href = text('href');
      const images = input.images === undefined ? current.images : input.images;
      if (!validImageAttachments(images, 5) || !validAnnouncementLink(href) || href.length > 1000 || text('content').length > 5000 || text('title').length > 120 || (input.displayMode !== undefined && input.displayMode !== 'once' && input.displayMode !== 'visit'))
        return json({ error: 'Use valid announcement text, links and up to 5 images.' }, 400);
      for (const image of images) {
        if (!image.url.startsWith('/')) continue;
        if (!image.url.startsWith('/api/cloudflare/media/announcements/')) return json({ error: 'Upload announcement images using the announcement editor.' }, 400);
        let key: string;
        try { key = decodeURIComponent(image.url.slice('/api/cloudflare/media/'.length)); }
        catch { return json({ error: 'Use a valid announcement image URL.' }, 400); }
        if (image.url !== `/api/cloudflare/media/${key.split('/').map(encodeURIComponent).join('/')}`) return json({ error: 'Use the original announcement image URL.' }, 400);
        const media = await env.DB.prepare("SELECT 1 AS valid FROM media WHERE key=? AND purpose='announcements' AND status='ready'").bind(key).first();
        if (!media) return json({ error: 'An announcement image is missing. Upload it again.' }, 400);
      }
      const next = {
        enabled: input.enabled === true,
        title: input.title === undefined ? current.title : text('title'),
        content: text('content'),
        href,
        images,
        displayMode: 'once' as const,
        revision: current.revision,
      };
      if (next.enabled && !next.content && !next.images.length)
        return json({ error: 'Enter announcement content or add images before enabling it.' }, 400);
      if (JSON.stringify(next) === JSON.stringify(current)) return json({ ...next, unchanged: true }, 200, { 'x-qraft-unchanged': '1' });
      // One identity per activation. Editing a live announcement must not
      // replay it to accounts that already saw it; disabling then enabling does.
      if (next.enabled && (!current.enabled || !current.revision))
        next.revision = crypto.randomUUID();
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES('system','announcement',?,?,?) ON CONFLICT(type,id) DO UPDATE SET owner_id=excluded.owner_id,payload=excluded.payload,updated_at=excluded.updated_at",
        ).bind(user.uid, JSON.stringify(next), now),
        auditStatement(user, 'announcement_updated', 'announcement', current, next),
      ]);
      return json(next);
    }
    if (action === 'community-links') {
      const row = await env.DB.prepare("SELECT payload FROM records WHERE type='system' AND id='communityLinks' LIMIT 1").first<{ payload: string }>();
      const current = row ? { ...DEFAULT_COMMUNITY_LINKS, ...JSON.parse(row.payload) } : DEFAULT_COMMUNITY_LINKS;
      if (request.method === 'GET') return json(current);
      if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
      if (!root) return json({ error: 'Superadmin access required.' }, 403);
      const next = { telegramUrl: text('telegramUrl') };
      if (next.telegramUrl.length > 1000 || !validTelegramLink(next.telegramUrl)) return json({ error: 'Use a secure Telegram channel link beginning with https://t.me/.' }, 400);
      if (JSON.stringify(current) === JSON.stringify(next)) return json({ ...next, unchanged: true }, 200, { 'x-qraft-unchanged': '1' });
      await env.DB.batch([
        env.DB.prepare("INSERT INTO records(type,id,payload,updated_at) VALUES('system','communityLinks',?,?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(JSON.stringify(next), new Date().toISOString()),
        auditStatement(user, 'community_links_updated', 'communityLinks', current, next),
      ]);
      return json(next);
    }
    if (action === 'audit-week' && request.method === 'GET') {
      if (!root) return json({ error: 'Superadmin access required.' }, 403);
      const start = url.searchParams.get('start') ?? '';
      const parsed = new Date(`${start}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(parsed.getTime()))
        return json({ error: 'Choose a valid week.' }, 400);
      const end = new Date(parsed.getTime() + 7 * 86_400_000).toISOString();
      const rows = await env.DB.prepare(
        "SELECT payload FROM records WHERE type='auditLog' AND updated_at>=? AND updated_at<? ORDER BY updated_at DESC LIMIT 250",
      ).bind(parsed.toISOString(), end).all<{ payload: string }>();
      return json({
        start,
        end: end.slice(0, 10),
        entries: rows.results.map((row) => JSON.parse(row.payload)),
        limited: rows.results.length === 250,
      });
    }
    if (action === 'content-backup') {
      if (!root) return json({ error: 'Superadmin access required.' }, 403);
      const allowedTypes = ['qbanks', 'qbankFolders', 'sharedQuestions', 'questionProposals', 'sharedNotes', 'qbankMemberships'];
      if (request.method === 'GET') {
        const placeholders = allowedTypes.map(() => '?').join(',');
        const rows = await env.DB.prepare(
          `SELECT type,id,qbank_id,owner_id,payload,updated_at FROM records WHERE type IN (${placeholders}) ORDER BY type,id`,
        ).bind(...allowedTypes).all<{ type: string; id: string; qbank_id: string | null; owner_id: string | null; payload: string; updated_at: string }>();
        return json({
          format: 'qraft-content-backup-v1',
          exportedAt: new Date().toISOString(),
          records: rows.results.map((row) => ({ ...row, payload: JSON.parse(row.payload) })),
        });
      }
      if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
      const backup = input as { format?: string; records?: Array<{ type?: string; id?: string; qbank_id?: string | null; owner_id?: string | null; payload?: unknown; updated_at?: string }> };
      if (backup.format !== 'qraft-content-backup-v1' || !Array.isArray(backup.records) || backup.records.length > 50_000)
        return json({ error: 'Invalid or oversized Qraft content backup.' }, 400);
      const valid = backup.records.filter((record) => record && allowedTypes.includes(record.type ?? '') && typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 200 && record.payload && typeof record.payload === 'object');
      if (valid.length !== backup.records.length) return json({ error: 'Backup contains invalid records.' }, 400);
      const now = new Date().toISOString();
      for (let offset = 0; offset < valid.length; offset += 400) {
        const chunk = valid.slice(offset, offset + 400);
        await env.DB.batch([...chunk.map((record) => {
          const value = record.payload as Record<string, unknown>;
          const qbankId = typeof value.qbankId === 'string' ? value.qbankId : record.qbank_id ?? null;
          const ownerId = typeof value.ownerId === 'string' ? value.ownerId : record.owner_id ?? null;
          return env.DB.prepare(
            'INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET qbank_id=excluded.qbank_id,owner_id=excluded.owner_id,payload=excluded.payload,updated_at=excluded.updated_at',
          ).bind(record.type!, record.id!, qbankId, ownerId, JSON.stringify(record.payload), record.updated_at || now);
        }), await importKeyStatement(chunk.map(record => ({ collection: record.type!, id: record.id!, payload: JSON.stringify(record.payload) })))]);
      }
      // Restore all content chunks before pruning so classification ordering and
      // metadata are not discarded before their questions arrive.
      const restoredBankIds = [...new Set(valid.filter(record => ['sharedQuestions','qbankSpecialties','qbankTopics'].includes(record.type!))
        .map(record => typeof (record.payload as Record<string, unknown>).qbankId === 'string' ? (record.payload as { qbankId: string }).qbankId : (record as { qbank_id?: string }).qbank_id ?? '').filter(Boolean))];
      for (let offset = 0; offset < restoredBankIds.length; offset += 50)
        await env.DB.batch(classificationCleanupStatements(env.DB, restoredBankIds.slice(offset, offset + 50), now));
      await auditStatement(user, 'content_backup_restored', 'content-backup', null, { records: valid.length }).run();
      return json({ ok: true, restored: valid.length });
    }
    if (action === 'personal-backup') {
      const plan = user.effectivePlan ?? user.tier;
      const limits = user.planLimits ?? getPlanLimits(plan);
      if (!limits.canUseFlashcards && !limits.canCreatePrivateQBank)
        return json({ error: 'Backup is available with Flashcards or Private QBanks access.' }, 403);
      const signingKey = backupSigningKey();
      if (!signingKey)
        return json(
          { error: 'Personal backup signing is not configured.' },
          503,
        );
      if (request.method === 'GET') {
        const state = limits.canUseFlashcards
          ? await env.DB.prepare('SELECT payload FROM app_states WHERE user_id=?').bind(user.uid).first<{ payload: string }>()
          : null;
        const banks = limits.canCreatePrivateQBank
          ? await env.DB.prepare("SELECT id,payload FROM records WHERE type='qbanks' AND owner_id=? AND json_extract(payload,'$.visibility')='private'").bind(user.uid).all<{ id: string; payload: string }>()
          : { results: [] as Array<{ id: string; payload: string }> };
        const bankIds = banks.results.map((bank) => bank.id);
        const related = bankIds.length
          ? await env.DB.prepare(`SELECT type,id,qbank_id,owner_id,payload,updated_at FROM records WHERE qbank_id IN (${bankIds.map(() => '?').join(',')}) AND type IN ('sharedQuestions','questionProposals','sharedNotes','qbankMemberships') ORDER BY type,id`).bind(...bankIds).all<{ type: string; id: string; qbank_id: string | null; owner_id: string | null; payload: string; updated_at: string }>()
          : { results: [] as Array<{ type: string; id: string; qbank_id: string | null; owner_id: string | null; payload: string; updated_at: string }> };
        const app = state ? JSON.parse(state.payload) as Record<string, unknown> : {};
        const payload: PersonalBackupPayload = {
          format: 'qraft-personal-backup-v1',
          signatureVersion: 'hmac-sha256-v1',
          ownerId: user.uid,
          exportedAt: new Date().toISOString(),
          flashcards: limits.canUseFlashcards ? {
            flashcardDecks: app.flashcardDecks ?? [], flashcards: app.flashcards ?? [], flashcardSchedules: app.flashcardSchedules ?? {}, flashcardReviewLog: app.flashcardReviewLog ?? [], flashcardSettings: app.flashcardSettings,
          } : null,
          records: [...banks.results.map((bank) => ({ type: 'qbanks', id: bank.id, qbank_id: bank.id, owner_id: user.uid, payload: JSON.parse(bank.payload), updated_at: new Date().toISOString() })), ...related.results.map((row) => ({ ...row, payload: JSON.parse(row.payload) }))],
        };
        return json({
          ...payload,
          signature: await signPersonalBackup(payload, signingKey),
        });
      }
      if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
      const backup = input as { format?: string; signatureVersion?: string; signature?: string; ownerId?: string; exportedAt?: string; flashcards?: Record<string, unknown> | null; records?: Array<{ type?: string; id?: string; payload?: unknown; updated_at?: string }> };
      if (
        backup.format !== 'qraft-personal-backup-v1' ||
        backup.signatureVersion !== 'hmac-sha256-v1' ||
        backup.ownerId !== user.uid ||
        !backup.exportedAt ||
        !Number.isFinite(Date.parse(backup.exportedAt)) ||
        !Array.isArray(backup.records) ||
        backup.records.length > 20_000
      )
        return json({ error: 'This backup does not belong to the signed-in account.' }, 403);
      const signedPayload: PersonalBackupPayload = {
        format: backup.format,
        signatureVersion: backup.signatureVersion,
        ownerId: backup.ownerId,
        exportedAt: backup.exportedAt,
        flashcards: backup.flashcards ?? null,
        records: backup.records as Array<Record<string, unknown>>,
      };
      if (!(await personalBackupSignatureIsValid(signedPayload, backup.signature, signingKey)))
        return json({ error: 'This personal backup is unsigned or has been changed.' }, 403);
      const bankRecords = backup.records.filter((record) => record.type === 'qbanks');
      const bankIds = new Set(bankRecords.map((record) => record.id).filter((id): id is string => Boolean(id)));
      if (
        bankIds.size !== bankRecords.length ||
        [...bankRecords].some((record) =>
          !record.payload ||
          typeof record.payload !== 'object' ||
          record.id !== (record.payload as Record<string, unknown>).id ||
          (record.payload as Record<string, unknown>).ownerId !== user.uid ||
          (record.payload as Record<string, unknown>).visibility !== 'private',
        )
      )
        return json({ error: 'Private QBank ownership could not be verified.' }, 403);
      const allowedRecordTypes = new Set(['qbanks', 'sharedQuestions', 'questionProposals', 'sharedNotes', 'qbankMemberships']);
      const records = backup.records.filter((record) => {
        const value = record.payload && typeof record.payload === 'object'
          ? (record.payload as Record<string, unknown>)
          : undefined;
        const qbankId = value?.qbankId;
        return allowedRecordTypes.has(record.type ?? '') &&
          typeof record.id === 'string' &&
          record.id.length > 0 &&
          record.id.length <= 200 &&
          value &&
          value.id === record.id &&
          (record.type === 'qbanks' || (typeof qbankId === 'string' && bankIds.has(qbankId)));
      });
      const identities = records.map((record) => `${record.type}\u0000${record.id}`);
      if (records.length !== backup.records.length || new Set(identities).size !== identities.length)
        return json({ error: 'Backup contains data outside its private QBanks.' }, 403);
      const existingRows: Array<{
        type: string;
        id: string;
        qbank_id: string | null;
        owner_id: string | null;
        payload: string;
      }> = [];
      for (let offset = 0; offset < records.length; offset += 400) {
        const keys = records.slice(offset, offset + 400).map((record) => ({
          type: record.type,
          id: record.id,
        }));
        const rows = await env.DB.prepare(`SELECT record.type,record.id,record.qbank_id,record.owner_id,record.payload
          FROM json_each(?) AS change
          JOIN records AS record INDEXED BY idx_records_type_id
            ON record.type=json_extract(change.value,'$.type')
           AND record.id=json_extract(change.value,'$.id')`)
          .bind(JSON.stringify(keys))
          .all<(typeof existingRows)[number]>();
        existingRows.push(...rows.results);
      }
      const ownedExistingBanks = new Set(
        existingRows
          .filter((row) => row.type === 'qbanks')
          .filter((row) => {
            const value = JSON.parse(row.payload) as { ownerId?: string };
            return value.ownerId === user.uid;
          })
          .map((row) => row.id),
      );
      if (
        existingRows.some((row) =>
          row.type === 'qbanks'
            ? !ownedExistingBanks.has(row.id)
            : !row.qbank_id ||
              !bankIds.has(row.qbank_id) ||
              !ownedExistingBanks.has(row.qbank_id),
        )
      )
        return json(
          { error: 'Backup record IDs conflict with data owned by another account.' },
          409,
        );
      const now = new Date().toISOString();
      for (let offset = 0; offset < records.length; offset += 400) {
        const chunk = records.slice(offset, offset + 400);
        await env.DB.batch([...chunk.map((record) => {
          const value = record.payload as Record<string, unknown>;
          const qbankId = record.type === 'qbanks' ? record.id! : String(value.qbankId);
          return env.DB.prepare(`INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(?,?,?,?,?,?)
            ON CONFLICT(type,id) DO UPDATE SET qbank_id=excluded.qbank_id,owner_id=excluded.owner_id,payload=excluded.payload,updated_at=excluded.updated_at
            WHERE (records.type='qbanks' AND json_extract(records.payload,'$.ownerId')=?)
               OR (records.type<>'qbanks' AND records.qbank_id=excluded.qbank_id AND EXISTS(
                 SELECT 1 FROM records AS bank
                 WHERE bank.type='qbanks' AND bank.id=excluded.qbank_id AND json_extract(bank.payload,'$.ownerId')=?
               ))`).bind(record.type!, record.id!, qbankId, user.uid, JSON.stringify(record.payload), record.updated_at || now, user.uid, user.uid);
        }), await importKeyStatement(chunk.map(record => ({ collection: record.type!, id: record.id!, payload: JSON.stringify(record.payload) })))]);
      }
      // Restore all content chunks before pruning so classification ordering and
      // metadata are not discarded before their questions arrive.
      const restoredBankIds = [...new Set(records.filter(record => ['sharedQuestions','qbankSpecialties','qbankTopics'].includes(record.type!))
        .map(record => typeof (record.payload as Record<string, unknown>).qbankId === 'string' ? (record.payload as { qbankId: string }).qbankId : (record as { qbank_id?: string }).qbank_id ?? '').filter(Boolean))];
      for (let offset = 0; offset < restoredBankIds.length; offset += 50)
        await env.DB.batch(classificationCleanupStatements(env.DB, restoredBankIds.slice(offset, offset + 50), now));
      if (limits.canUseFlashcards && backup.flashcards) {
        const stored = await env.DB.prepare('SELECT payload,revision FROM app_states WHERE user_id=?').bind(user.uid).first<{ payload: string; revision: number }>();
        const app = stored ? JSON.parse(stored.payload) as Record<string, unknown> : { version: 1 };
        const merged = { ...app, ...backup.flashcards };
        await env.DB.prepare('INSERT INTO app_states(user_id,payload,updated_at,revision) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,revision=app_states.revision+1').bind(user.uid, JSON.stringify(merged), now, (stored?.revision ?? -1) + 1).run();
      }
      await auditStatement(user, 'personal_backup_restored', user.uid, null, { records: records.length }).run();
      return json({ ok: true, restored: records.length });
    }
    if (action === 'legal-links') {
      const defaults = DEFAULT_LEGAL_LINKS;
      const record = await env.DB.prepare(
        "SELECT payload FROM records WHERE type='system' AND id='legalLinks' LIMIT 1",
      ).first<{ payload: string }>();
      const current = record
        ? { ...defaults, ...(JSON.parse(record.payload) as Partial<typeof defaults>) }
        : defaults;
      if (request.method === 'GET') return json(current);
      if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
      if (!root) return json({ error: 'Superadmin access required.' }, 403);
      const validLink = (value: string) => {
        if (!value) return true;
        if (value.startsWith('/') && !value.startsWith('//')) return true;
        try {
          return new URL(value).protocol === 'https:';
        } catch {
          return false;
        }
      };
      const next = {
        termsUrl: text('termsUrl').slice(0, 1000),
        privacyUrl: text('privacyUrl').slice(0, 1000),
        refundUrl: input.refundUrl === undefined ? current.refundUrl : text('refundUrl').slice(0, 1000),
      };
      if (!validLink(next.termsUrl) || !validLink(next.privacyUrl) || !validLink(next.refundUrl))
        return json({ error: 'Use a secure HTTPS URL or an internal path beginning with /.' }, 400);
      if (JSON.stringify(next) === JSON.stringify(current)) return json({ ...next, unchanged: true }, 200, { 'x-qraft-unchanged': '1' });
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES('system','legalLinks',?,?,?) ON CONFLICT(type,id) DO UPDATE SET owner_id=excluded.owner_id,payload=excluded.payload,updated_at=excluded.updated_at",
        ).bind(user.uid, JSON.stringify(next), now),
        auditStatement(user, 'legal_links_updated', 'legalLinks', current, next),
      ]);
      return json(next);
    }
    if (action === 'plan-status' && request.method === 'GET') {
      const plan = user.effectivePlan ?? user.tier;
      const limits = user.planLimits ?? getPlanLimits(plan);
      const controlledImports=await importLimits(user);
      const monthStart = utcMonthStart();
      const dayStart = utcDayStart();
      const [lifetime, monthly, imports, pending, media] = await env.DB.batch([
        env.DB.prepare('SELECT count(*) AS value FROM test_registry WHERE user_id=?').bind(user.uid),
        env.DB.prepare('SELECT count(*) AS value FROM test_registry WHERE user_id=? AND started_at>=?').bind(user.uid, monthStart),
        env.DB.prepare('SELECT count(DISTINCT coalesce(run_id,id)) AS value FROM imported_files WHERE user_id=? AND uploaded_at>=?').bind(user.uid, dayStart),
        env.DB.prepare("SELECT count(*) AS value FROM records WHERE type='questionProposals' AND owner_id=? AND json_extract(payload,'$.status')='pending'").bind(user.uid),
        env.DB.prepare("SELECT coalesce(sum(size),0) AS value FROM media WHERE owner_id=? AND status='ready'").bind(user.uid),
      ]);
      const value = (result: D1Result<unknown>) => Number((result.results[0] as { value?: number } | undefined)?.value ?? 0);
      return json({
        plan,
        limits: root
          ? { ...limits, canUseJsonImport: true, jsonImportDailyLimit: Number.MAX_SAFE_INTEGER, jsonQuestionsPerImport: Number.MAX_SAFE_INTEGER, maxPendingReviewQuestions: Number.MAX_SAFE_INTEGER }
          : {...limits,jsonQuestionsPerImport:controlledImports.questionsPerImport,jsonImportDailyLimit:controlledImports.importsPerDay},
        usage: {
          lifetimeStartedExams: value(lifetime),
          monthlyStartedExams: value(monthly),
          dailyJsonImports: value(imports),
          pendingReviewQuestions: value(pending),
          activeImageStorageBytes: value(media),
        },
      });
    }
    if (action === 'exam-start' && request.method === 'POST') {
      const testId = text('testId');
      const questionCount = Number(input.questionCount);
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(testId) || !Number.isInteger(questionCount) || questionCount < 1)
        return json({ error: 'Invalid exam start request.' }, 400);
      const existing = await env.DB.prepare(
        'SELECT question_count,started_at FROM test_registry WHERE user_id=? AND test_id=?',
      ).bind(user.uid, testId).first<{ question_count: number; started_at: string }>();
      if (existing)
        return existing.question_count === questionCount
          ? json({ started: true, startedAt: existing.started_at, duplicate: true })
          : json({ error: 'This exam ID was already used.' }, 409);
      const plan = user.effectivePlan ?? user.tier;
      const limits = user.planLimits ?? getPlanLimits(plan);
      if (questionCount > limits.maxQuestionsPerExam)
        return json({ error: `${limits.name} allows ${limits.maxQuestionsPerExam} questions per exam.`, code: 'EXAM_QUESTION_LIMIT_REACHED', maxQuestions: limits.maxQuestionsPerExam }, 403);
      const now = new Date().toISOString();
      const lifetimeLimit = limits.lifetimeExamLimit ?? -1;
      const monthlyLimit = limits.monthlyExamLimit ?? -1;
      const inserted = await env.DB.prepare(`INSERT INTO test_registry(user_id,test_id,question_count,started_at,plan_at_start)
        SELECT ?,?,?,?,?
        WHERE (?<0 OR (SELECT count(*) FROM test_registry WHERE user_id=?)<?)
          AND (?<0 OR (SELECT count(*) FROM test_registry WHERE user_id=? AND started_at>=?)<?)`)
        .bind(
          user.uid,
          testId,
          questionCount,
          now,
          plan,
          lifetimeLimit,
          user.uid,
          lifetimeLimit,
          monthlyLimit,
          user.uid,
          utcMonthStart(),
          monthlyLimit,
        )
        .run();
      if (!inserted.meta.changes) {
        const counts = await env.DB.batch([
          env.DB.prepare('SELECT count(*) AS value FROM test_registry WHERE user_id=?').bind(user.uid),
          env.DB.prepare('SELECT count(*) AS value FROM test_registry WHERE user_id=? AND started_at>=?').bind(user.uid, utcMonthStart()),
        ]);
        const lifetime = Number((counts[0].results[0] as { value?: number } | undefined)?.value ?? 0);
        const monthly = Number((counts[1].results[0] as { value?: number } | undefined)?.value ?? 0);
        return json(
          {
            error:
              limits.lifetimeExamLimit !== null && lifetime >= limits.lifetimeExamLimit
                ? "You've reached your lifetime exam limit."
                : "You've reached your monthly exam limit.",
            usage: { lifetimeStartedExams: lifetime, monthlyStartedExams: monthly },
            code: 'EXAM_LIMIT_REACHED',
          },
          403,
        );
      }
      await emitUsage(user.uid,{testsCreated:1});
      return json({ started: true, startedAt: now }, 201);
    }
    if (action === 'contributions' && request.method === 'GET') {
      const focusedGiftId = url.searchParams.get('gift') ?? '';
      if (focusedGiftId.length > 160) return json({ error: 'Invalid gift.' }, 400);
      const [account, transactions, passes, pending, submissions] = await env.DB.batch([
        env.DB.prepare('SELECT credits_balance,lifetime_score FROM contribution_accounts WHERE user_id=?').bind(user.uid),
        env.DB.prepare('SELECT id,amount,type,reason,reference_type,reference_id,created_at FROM credit_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 30').bind(user.uid),
        focusedGiftId ? env.DB.prepare(`SELECT * FROM (SELECT ${rewardWalletFields()} FROM reward_passes r WHERE r.user_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 50)
          UNION SELECT ${rewardWalletFields()} FROM reward_passes r WHERE r.id=? AND r.user_id=? ORDER BY created_at DESC,id DESC`).bind(user.uid, focusedGiftId, user.uid)
          : env.DB.prepare(`SELECT ${rewardWalletFields()} FROM reward_passes r WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 50`).bind(user.uid),
        env.DB.prepare("SELECT count(*) AS value FROM records WHERE type='questionProposals' AND owner_id=? AND json_extract(payload,'$.status')='pending'").bind(user.uid),
        env.DB.prepare("SELECT id,json_extract(payload,'$.status') AS status,json_extract(payload,'$.type') AS type,updated_at FROM records WHERE type='questionProposals' AND owner_id=? AND json_extract(payload,'$.status')<>'approved' ORDER BY updated_at DESC LIMIT 20").bind(user.uid),
      ]);
      const summary = (account.results[0] as { credits_balance?: number; lifetime_score?: number } | undefined) ?? {};
      const score = Number(summary.lifetime_score ?? 0);
      return json({
        creditsBalance: Number(summary.credits_balance ?? 0),
        lifetimeContributionScore: score,
        badge: contributionBadge(score) ?? null,
        pendingSubmissions: Number((pending.results[0] as { value?: number } | undefined)?.value ?? 0),
        transactions: transactions.results,
        rewardPasses: passes.results,
        submissions: submissions.results,
        rewards: REWARD_CATALOG,
      });
    }
    if (action === 'rewards') {
      if (request.method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT ${rewardWalletFields()} FROM reward_passes r WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 100`,
        ).bind(user.uid).all();
        return json({ rewards: REWARD_CATALOG, passes: rows.results });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const operation = text('operation');
      if (operation === 'redeem') {
        const requestId = text('requestId');
        const reward = REWARD_CATALOG.find((item) => item.id === text('rewardId'));
        if (!reward || !/^[a-zA-Z0-9-]{20,80}$/.test(requestId))
          return json({ error: 'Invalid reward request.' }, 400);
        const passId = `reward-${requestId}`;
        const prior = await env.DB.prepare(`SELECT ${rewardWalletFields()} FROM reward_passes r WHERE r.id=? AND r.user_id=?`)
          .bind(passId, user.uid).first();
        if (prior) {
          const account = await env.DB.prepare('SELECT credits_balance FROM contribution_accounts WHERE user_id=?').bind(user.uid).first<{ credits_balance: number }>();
          return json({ pass: prior, creditsBalance: account?.credits_balance ?? 0, duplicate: true });
        }
        const now = new Date().toISOString();
        try {
          await env.DB.batch([
            env.DB.prepare('INSERT INTO credit_transactions(id,user_id,amount,lifetime_delta,type,reason,reference_type,reference_id,created_by,created_at,metadata) VALUES(?,?,?,0,?,?,?,?,?,?,?)')
              .bind(requestId, user.uid, -reward.credits, 'reward_redemption', `Redeemed ${reward.id}`, 'reward', requestId, user.uid, now, JSON.stringify({ rewardId: reward.id })),
            env.DB.prepare("INSERT INTO reward_passes(id,user_id,plan,duration,duration_unit,duration_days,status,created_at,source,credit_transaction_id,metadata) VALUES(?,?,?,?,?,?,'available',?,'credits',?,?)")
              .bind(passId, user.uid, reward.plan, reward.duration, reward.durationUnit, reward.durationDays, now, requestId, JSON.stringify({ rewardId: reward.id })),
            auditStatement(user, 'reward_redeemed', passId, null, { rewardId: reward.id, credits: reward.credits }),
          ]);
        } catch (error) {
          const recovered = await env.DB.prepare(`SELECT ${rewardWalletFields()} FROM reward_passes r WHERE r.id=? AND r.user_id=?`)
            .bind(passId, user.uid).first();
          if (recovered) return json({ pass: recovered, duplicate: true });
          if (String(error).includes('INSUFFICIENT_CREDITS'))
            return json({ error: 'You do not have enough credits for this reward.' }, 409);
          throw error;
        }
        const [passResult, accountResult] = await env.DB.batch([
          env.DB.prepare(`SELECT ${rewardWalletFields()} FROM reward_passes r WHERE r.id=?`).bind(passId),
          env.DB.prepare('SELECT credits_balance FROM contribution_accounts WHERE user_id=?').bind(user.uid),
        ]);
        return json({ pass: passResult.results[0], creditsBalance: Number((accountResult.results[0] as { credits_balance?: number } | undefined)?.credits_balance ?? 0) }, 201);
      }
      if (operation === 'activate') {
        const passId = text('passId');
        const pass = await env.DB.prepare(
          "SELECT id,plan,duration,duration_unit,duration_days,status FROM reward_passes WHERE id=? AND user_id=?",
        ).bind(passId, user.uid).first<{ id: string; plan: Exclude<PlanId, 'free'>; duration: number; duration_unit: 'month' | 'year'; duration_days: number | null; status: string }>();
        if (!pass) return json({ error: 'Reward pass not found.' }, 404);

        const activated = await activateRewardAccess(user, pass);
        const walletPass = await env.DB.prepare(`SELECT ${rewardWalletFields()} FROM reward_passes r WHERE r.id=? AND r.user_id=?`).bind(passId, user.uid).first();
        const entitlement = await getEffectiveEntitlement(user);
        return json({
          activated: true,
          duplicate: Boolean(activated.duplicate),
          expiresAt: activated.expiresAt,
          startsAt: activated.startsAt,
          effectivePlan: entitlement.effectivePlan,
          user: await applyEffectiveEntitlement(user),
          pass: walletPass,
        });
      }
      return json({ error: 'Invalid reward operation.' }, 400);
    }
    if (action === 'import-settings') {
      if (!root) return json({ error: 'Superadmin MFA required.' }, 403);
      if (request.method === 'GET') return json(await importSettings());
      if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
      if (!validImportSettings(input.settings) || text('reason').length < 3)
        return json({ error: 'Choose valid file and scan settings and provide an audit reason.' }, 400);
      const previous = await importSettings();
      const next = { enabled: input.settings.enabled, maxFileMegabytes: input.settings.maxFileMegabytes, previewBatchSize: input.settings.previewBatchSize };
      await env.DB.batch([
        env.DB.prepare("INSERT INTO records(type,id,payload,updated_at) VALUES('system','importSettings',?,?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at")
          .bind(JSON.stringify(next), new Date().toISOString()),
        auditStatement(user, 'import_settings_updated', 'importSettings', previous, { ...next, reason: text('reason') }),
      ]);
      return json(next);
    }
    if (action === 'import-controls' && request.method === 'GET') {
      if(!root) return json({error:'Superadmin MFA required.'},403);
      const targetId=url.searchParams.get('userId')??'';
      const target=await profileById(targetId);
      if(!target)return json({error:'Account not found.'},404);
      const effective=await applyEffectiveEntitlement(JSON.parse(target.profile_json));
      const suspension=await env.DB.prepare('SELECT ends_at FROM json_import_suspensions WHERE user_id=? AND removed_at IS NULL AND starts_at<=? AND ends_at>? ORDER BY ends_at DESC LIMIT 1').bind(targetId,new Date().toISOString(),new Date().toISOString()).first<{ends_at:string}>();
      return json({importLimits:await importLimits(effective),endsAt:suspension?.ends_at??null});
    }
    if (action === 'import-defaults') {
      if(!root) return json({error:'Superadmin MFA required.'},403);
      if(request.method==='GET') return json(await env.DB.prepare('SELECT questions_per_import AS questionsPerImport,imports_per_day AS importsPerDay FROM import_defaults WHERE id=1').first());
      if(request.method!=='POST') return json({error:'Method not allowed.'},405);
      const q=input.questionsPerImport,t=input.importsPerDay;
      if((q!==null&&(!Number.isInteger(q)||Number(q)<1||Number(q)>5000))||(t!==null&&(!Number.isInteger(t)||Number(t)<1||Number(t)>100))||text('reason').length<3) return json({error:'Choose 1–5000 questions, 1–100 imports per day, and an audit reason.'},400);
      await env.DB.batch([env.DB.prepare('UPDATE import_defaults SET questions_per_import=?,imports_per_day=? WHERE id=1').bind(q,t),auditStatement(user,'import_defaults_updated','all-users',null,{questionsPerImport:q,importsPerDay:t,reason:text('reason')})]);
      return json({questionsPerImport:q,importsPerDay:t});
    }
    if (action === 'economy-admin') {
      if (!root) return json({ error: 'Superadmin MFA required.' }, 403);
      const targetUserId = url.searchParams.get('userId') || text('userId');
      if (!targetUserId) return json({ error: 'Choose a user.' }, 400);
      if (request.method === 'GET') {
        const [account, ledger, passes, suspensions, reviews, collusionFlags, contributionHistory] = await env.DB.batch([
          env.DB.prepare('SELECT * FROM contribution_accounts WHERE user_id=?').bind(targetUserId),
          env.DB.prepare('SELECT * FROM credit_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(targetUserId),
          env.DB.prepare(`SELECT ${rewardWalletFields()},r.user_id,r.credit_transaction_id,r.metadata,r.access_generation FROM reward_passes r WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 100`).bind(targetUserId),
          env.DB.prepare('SELECT * FROM json_import_suspensions WHERE user_id=? ORDER BY starts_at DESC LIMIT 50').bind(targetUserId),
          env.DB.prepare('SELECT * FROM contribution_reviews WHERE author_id=? OR reviewer_id=? ORDER BY created_at DESC LIMIT 100').bind(targetUserId, targetUserId),
          env.DB.prepare(`SELECT reviewer_id,author_id,count(*) AS approvals,
            round(100.0*count(*)/(SELECT count(*) FROM contribution_reviews total WHERE total.reviewer_id=contribution_reviews.reviewer_id AND total.decision='approved'),1) AS percentage
            FROM contribution_reviews WHERE decision='approved' AND (reviewer_id=? OR author_id=?)
            GROUP BY reviewer_id,author_id
            HAVING count(*)>=5 AND percentage>=80`).bind(targetUserId, targetUserId),
          env.DB.prepare("SELECT id,json_extract(payload,'$.status') AS status,json_extract(payload,'$.type') AS type,updated_at FROM records WHERE type='questionProposals' AND owner_id=? ORDER BY updated_at DESC LIMIT 100").bind(targetUserId),
        ]);
        const target=await profileById(targetUserId);
        const policy=target ? await importLimits(await applyEffectiveEntitlement(JSON.parse(target.profile_json))) : null;
        return json({ importLimits:policy, account: account.results[0] ?? null, ledger: ledger.results, rewardHistory: passes.results, duplicateAbuse: suspensions.results, reviewerActivity: reviews.results, collusionFlags: collusionFlags.results, contributionHistory: contributionHistory.results });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const operation = text('operation');
      const reason = text('reason');
      if (!reason) return json({ error: 'A reason is required.' }, 400);
      const now = new Date().toISOString();
      if (operation === 'reset-import-limits') {
        await env.DB.batch([env.DB.prepare('DELETE FROM import_policies WHERE user_id=?').bind(targetUserId),auditStatement(user,'import_limits_reset',targetUserId,null,{reason})]);
        return json({ok:true});
      }
      if (operation === 'import-limits') {
        const questions=Number(input.questionsPerImport), times=Number(input.importsPerDay);
        if(!Number.isInteger(questions)||questions<1||questions>5000||!Number.isInteger(times)||times<1||times>100) return json({error:'Choose 1–5000 questions and 1–100 imports per day.'},400);
        if(!(await profileById(targetUserId))) return json({error:'Account not found.'},404);
        await env.DB.batch([
          env.DB.prepare('INSERT INTO import_policies(user_id,questions_per_import,imports_per_day,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET questions_per_import=excluded.questions_per_import,imports_per_day=excluded.imports_per_day,updated_at=excluded.updated_at').bind(targetUserId,questions,times,now),
          auditStatement(user,'import_limits_updated',targetUserId,null,{questionsPerImport:questions,importsPerDay:times,reason})
        ]);
        return json({ok:true,importLimits:{questionsPerImport:questions,importsPerDay:times}});
      }
      if (operation === 'adjust-credits') {
        const amount = Number(input.amount);
        if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000)
          return json({ error: 'Enter a non-zero whole credit amount.' }, 400);
        const id = text('requestId') || crypto.randomUUID();
        try {
          await env.DB.batch([
            env.DB.prepare('INSERT INTO credit_transactions(id,user_id,amount,lifetime_delta,type,reason,reference_type,reference_id,created_by,created_at,metadata) VALUES(?,?,?,0,?,?,?,?,?,?,?)')
              .bind(id, targetUserId, amount, 'admin_adjustment', reason, 'admin', id, user.uid, now, '{}'),
            auditStatement(user, 'credit_adjustment', targetUserId, null, { amount, reason, transactionId: id }),
          ]);
        } catch (error) {
          if (String(error).includes('INSUFFICIENT_CREDITS'))
            return json({ error: 'This adjustment would make the balance negative.' }, 409);
          if (String(error).includes('UNIQUE constraint')) return json({ ok: true, duplicate: true });
          throw error;
        }
        return json({ ok: true, accountDelta: amount, transaction: { id, amount, reason, created_at: now, created_by: user.uid } });
      }
      if (operation === 'grant-reward') {
        const plan = text('plan');
        const duration = Number(input.duration ?? 1);
        const durationUnit = text('durationUnit') || 'month';
        const days = input.days === undefined ? null : Number(input.days);
        if (days !== null && (!Number.isInteger(days) || days < 1 || days > 730)) return json({error:'Gift duration must be 1–730 days.'},400);
        if (!isPlanId(plan) || plan === 'free' || !Number.isInteger(duration) || duration < 1 || duration > 24 || !['month', 'year'].includes(durationUnit))
          return json({ error: 'Invalid reward pass.' }, 400);
        const id = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare("INSERT INTO reward_passes(id,user_id,plan,duration,duration_unit,duration_days,status,created_at,source,metadata) VALUES(?,?,?,?,?,?,'available',?,'admin',?)")
            .bind(id, targetUserId, plan, duration, durationUnit, days, now, JSON.stringify({ reason, grantedBy: user.uid })),
          auditStatement(user, 'reward_granted', targetUserId, null, { passId: id, plan, duration, durationUnit, days, reason }),
        ]);
        return json({ ok: true, pass: { id, plan, duration, duration_unit: durationUnit, duration_days:days, status: 'available', created_at: now, expires_at: null } });
      }
      if (operation === 'suspend-json') {
        const days = Number(input.days ?? 7);
        if (!Number.isInteger(days) || days < 1 || days > 365)
          return json({ error: 'Invalid suspension duration.' }, 400);
        const endsAt = new Date(Date.now() + days * 86_400_000).toISOString();
        const id = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare('INSERT INTO json_import_suspensions(id,user_id,reason,starts_at,ends_at,created_by) VALUES(?,?,?,?,?,?)')
            .bind(id, targetUserId, reason, now, endsAt, user.uid),
          auditStatement(user, 'json_import_suspended', targetUserId, null, { id, reason, endsAt }),
        ]);
        return json({ ok: true, suspension: { id, reason, starts_at: now, ends_at: endsAt, removed_at: null } });
      }
      if (operation === 'remove-json-suspension') {
        await env.DB.batch([
          env.DB.prepare('UPDATE json_import_suspensions SET removed_at=?,removed_by=? WHERE user_id=? AND removed_at IS NULL AND ends_at>?')
            .bind(now, user.uid, targetUserId, now),
          auditStatement(user, 'json_import_suspension_removed', targetUserId, null, { reason }),
        ]);
        return json({ ok: true, removedAt: now });
      }
      return json({ error: 'Invalid admin operation.' }, 400);
    }
    if (action === 'duplicate-scan') {
      const qbankId = request.method === 'GET' ? (url.searchParams.get('qbankId') ?? '') : text('qbankId');
      if (request.method === 'GET') {
        const state = await bankAccessState(qbankId);
        const bank = state.qbanks.find((item) => item.id === qbankId);
        if (!bank || !canReviewBank(user, bank, state.memberships))
          return json({ error: 'Reviewer access is required to inspect this QBank scan.' }, 403);
        const run = await env.DB.prepare(
          "SELECT id AS runId,cursor,scanned_count AS scanned,flagged_count AS flagged,status,detector_version AS detectorVersion,updated_at AS updatedAt FROM duplicate_scan_runs WHERE qbank_id=? AND started_by=? ORDER BY created_at DESC LIMIT 1",
        ).bind(qbankId, user.uid).first();
        return json({ run: run ?? null });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const requestedRunId = text('runId');
      const cursor = Math.max(0, Math.trunc(Number(input.cursor) || 0));
      const batchSize = Math.min(100, Math.max(1, Math.trunc(Number(input.batchSize) || 50)));
      const state = await bankAccessState(qbankId);
      const bank = state.qbanks.find((item) => item.id === qbankId);
      if (!bank || !canReviewBank(user, bank, state.memberships))
        return json({ error: 'Reviewer access is required to scan this QBank.' }, 403);
      const contentRows = await env.DB.prepare(
        "SELECT type,payload FROM records WHERE qbank_id=? AND type IN ('sharedQuestions','questionProposals')",
      ).bind(qbankId).all<{ type: string; payload: string }>();
      const questions = contentRows.results
        .filter((row) => row.type === 'sharedQuestions')
        .map((row) => JSON.parse(row.payload) as Question)
        .sort((left, right) => left.id.localeCompare(right.id));
      if (cursor > questions.length) return json({ error: 'The scan cursor is stale.' }, 409);
      const runId = requestedRunId || crypto.randomUUID();
      if (requestedRunId) {
        const existingRun = await env.DB.prepare('SELECT qbank_id,cursor,status FROM duplicate_scan_runs WHERE id=?')
          .bind(runId).first<{ qbank_id: string; cursor: number; status: string }>();
        if (!existingRun || existingRun.qbank_id !== qbankId || existingRun.cursor !== cursor || existingRun.status !== 'running')
          return json({ error: 'This maintenance scan changed or already finished.' }, 409);
      }
      const priorCases = new Set(
        contentRows.results
          .filter((row) => row.type === 'questionProposals')
          .map((row) => JSON.parse(row.payload) as QuestionProposal)
          .filter((proposal) => proposal.duplicateScanId && proposal.questionId)
          .flatMap((proposal) => (proposal.duplicateReview?.candidates ?? []).map((candidate) =>
            `${proposal.questionId}|${candidate.entityId}|${proposal.duplicateReview?.sourceFingerprint}`,
          )),
      );
      const prepared = questions.map((question) => prepareDuplicateCandidate({
        entityId: question.id,
        entityType: 'approved_question',
        questionId: question.questionId,
        qbankId,
        payload: question,
      }));
      const now = new Date().toISOString();
      const proposals: QuestionProposal[] = [];
      const end = Math.min(questions.length, cursor + batchSize);
      for (let index = cursor; index < end; index += 1) {
        const source = questions[index];
        const sourceFingerprint = duplicateFingerprint(source);
        const review = detectDuplicateReview({
          incoming: source,
          qbankId,
          sourceEntityId: source.id,
          now,
          candidates: prepared.slice(index + 1).filter((candidate) =>
            !priorCases.has(`${source.id}|${candidate.entityId}|${sourceFingerprint}`),
          ),
        });
        if (!review) continue;
        proposals.push({
          id: `duplicate-scan-${crypto.randomUUID()}`,
          qbankId,
          type: 'question_edit',
          editKinds: ['duplicate'],
          questionId: source.id,
          payload: {
            stem: source.stem,
            options: source.options,
            answer: source.answer,
            specialty: source.specialty,
            topic: source.topic,
            specialtyId: source.specialtyId,
            topicId: source.topicId,
            explanation: source.explanation ?? '',
            explanationImages: source.explanationImages ?? [],
            sourceReference: source.sourceReference ?? source.sourceFile,
            sourceFile: source.sourceFile,
            sourcePage: source.sourcePage,
            images: source.images ?? [],
          },
          currentSnapshot: {
            stem: source.stem,
            options: source.options,
            answer: source.answer,
            specialty: source.specialty,
            topic: source.topic,
            specialtyId: source.specialtyId,
            topicId: source.topicId,
            explanation: source.explanation ?? '',
            explanationImages: source.explanationImages ?? [],
            sourceReference: source.sourceReference ?? source.sourceFile,
            sourceFile: source.sourceFile,
            sourcePage: source.sourcePage,
            images: source.images ?? [],
          },
          rationale: 'Controlled existing-QBank duplicate scan. No content was changed or deleted.',
          submissionMethod: 'manual',
          duplicateScanId: runId,
          duplicateReview: review,
          status: 'pending',
          proposedById: 'system:duplicate-scan',
          proposedByName: 'Qraft duplicate scan',
          proposedAt: now,
        });
      }
      const nextCursor = end;
      const status = nextCursor >= questions.length ? 'completed' : 'running';
      const statements: D1PreparedStatement[] = [];
      if (proposals.length)
        statements.push(env.DB.prepare(
          "INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) SELECT 'questionProposals',json_extract(value,'$.id'),?,json_extract(value,'$.proposedById'),value,? FROM json_each(?)",
        ).bind(qbankId, now, JSON.stringify(proposals)));
      if (requestedRunId)
        statements.push(env.DB.prepare(
          'UPDATE duplicate_scan_runs SET cursor=?,scanned_count=scanned_count+?,flagged_count=flagged_count+?,status=?,updated_at=? WHERE id=? AND cursor=? AND status=\'running\'',
        ).bind(nextCursor, end - cursor, proposals.length, status, now, runId, cursor));
      else
        statements.push(env.DB.prepare(
          'INSERT INTO duplicate_scan_runs(id,qbank_id,started_by,cursor,scanned_count,flagged_count,status,detector_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        ).bind(runId, qbankId, user.uid, nextCursor, end - cursor, proposals.length, status, DUPLICATE_DETECTION_CONFIG.detectorVersion, now, now));
      statements.push(auditStatement(user, 'duplicate_qbank_scan_batch', qbankId, null, {
        runId, cursor, nextCursor, scanned: end - cursor, flagged: proposals.length, status,
        detectorVersion: DUPLICATE_DETECTION_CONFIG.detectorVersion,
      }));
      statements.push(await importKeyStatement(proposals.map(proposal => ({ collection: 'questionProposals', id: proposal.id, payload: JSON.stringify(proposal) }))));
      await env.DB.batch(statements);
      return json({ ok: true, runId, cursor: nextCursor, status, scanned: end - cursor, flagged: proposals.length, proposals });
    }
    if (action === 'duplicate-resolve') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const proposalId = text('proposalId');
      const candidateEntityId = text('candidateEntityId');
      const decision = text('decision');
      const note = text('note').slice(0, 1_000);
      if (!proposalId || !candidateEntityId || (decision !== 'kept_both' && decision !== 'rejected_as_duplicate'))
        return json({ error: 'Choose KEEP BOTH or REJECT NEW AS DUPLICATE.' }, 400);
      const proposalRow = await env.DB.prepare(
        "SELECT payload FROM records WHERE type='questionProposals' AND id=?",
      ).bind(proposalId).first<{ payload: string }>();
      if (!proposalRow) return json({ error: 'This proposal no longer exists.' }, 409);
      const proposal = JSON.parse(proposalRow.payload) as QuestionProposal;
      const state = await bankAccessState(proposal.qbankId);
      const bank = state.qbanks.find((item) => item.id === proposal.qbankId);
      if (!bank || !canReviewBank(user, bank, state.memberships))
        return json({ error: 'Reviewer access is required for this QBank.' }, 403);
      if (proposal.status !== 'pending' || proposal.proposedById === user.uid)
        return json({ error: 'This case was resolved or was submitted by you. Refresh and try again.' }, 409);
      const previousReview = await env.DB.prepare(
        'SELECT 1 AS value FROM contribution_reviews WHERE proposal_id=? AND reviewer_id=? LIMIT 1',
      ).bind(proposal.id, user.uid).first<{ value: number }>();
      if (previousReview)
        return json({ error: 'You have already reviewed this submission.' }, 409);

      const richCandidates = proposal.duplicateReview?.candidates ?? [];
      const legacyCandidateId = proposal.duplicateInfo?.matchedQuestionId;
      const selectedFinding = richCandidates.find((item) => item.entityId === candidateEntityId)
        ?? (legacyCandidateId === candidateEntityId ? {
          entityId: candidateEntityId,
          entityType: 'approved_question' as const,
          questionId: undefined,
          similarity: proposal.duplicateInfo?.similarity ?? 0,
          classification: 'possible' as const,
          signals: { stem: proposal.duplicateInfo?.similarity ?? 0, optionsSet: 0, optionsOrdered: 0, correctAnswer: 0, specialty: 0, topic: 0 },
          candidateFingerprint: '',
          detectedAt: proposal.proposedAt,
        } : undefined);
      if (!selectedFinding)
        return json({ error: 'The selected duplicate candidate is no longer part of this case.' }, 409);
      const findingsToValidate = decision === 'kept_both' && richCandidates.length
        ? richCandidates
        : [selectedFinding];
      const candidateRows = await env.DB.prepare(
        "SELECT id,type,qbank_id,payload FROM records WHERE id IN (SELECT value FROM json_each(?)) AND type IN ('sharedQuestions','questionProposals')",
      ).bind(JSON.stringify(findingsToValidate.map((item) => item.entityId))).all<{
        id: string;
        type: string;
        qbank_id: string | null;
        payload: string;
      }>();
      const candidateById = new Map(candidateRows.results.map((row) => [row.id, row]));
      const sourceFingerprint = duplicateFingerprint(proposal.payload);
      if (proposal.duplicateReview?.sourceFingerprint && proposal.duplicateReview.sourceFingerprint !== sourceFingerprint)
        return json({ error: 'The incoming question changed. Refresh to run duplicate detection again.' }, 409);
      const validated = [] as Array<{
        originalEntityId: string;
        finding: typeof selectedFinding;
        candidateFingerprint: string;
      }>;
      for (const finding of findingsToValidate) {
        const row = candidateById.get(finding.entityId);
        if (!row || row.qbank_id !== proposal.qbankId)
          return json({ error: 'A matched question changed or was removed. Refresh this case.' }, 409);
        if ((finding.entityType === 'approved_question') !== (row.type === 'sharedQuestions'))
          return json({ error: 'A matched question changed status. Refresh this case.' }, 409);
        const parsed = JSON.parse(row.payload) as Question | QuestionProposal;
        let currentFinding = finding;
        let payload = row.type === 'questionProposals' ? (parsed as QuestionProposal).payload : (parsed as Question);
        if (row.type === 'questionProposals' && (parsed as QuestionProposal).status !== 'pending') {
          const reviewedCandidate = parsed as QuestionProposal;
          if (reviewedCandidate.status === 'rejected') {
            const refreshedAt = new Date().toISOString();
            const rebased = rebasePendingDuplicateReview(
              proposal,
              new Map([[finding.entityId, { status: 'rejected' }]]),
              refreshedAt,
            );
            if (rebased) {
              const update = await env.DB.prepare(
                "UPDATE records SET payload=?,updated_at=? WHERE type='questionProposals' AND id=? AND payload=?",
              ).bind(JSON.stringify(rebased), refreshedAt, proposal.id, proposalRow.payload).run();
              if (update.meta.changes) {
                await auditStatement(user, 'duplicate_case_rebased_after_matched_rejection', proposal.id, null, {
                  rejectedCandidateId: finding.entityId,
                  remainingCandidates: rebased.duplicateReview?.candidates.length ?? 0,
                }).run();
                return json({
                  ok: true,
                  reconciled: true,
                  updatedProposals: [rebased],
                  updatedQuestions: [],
                  reviewed: 0,
                  awaitingSecondReview: 0,
                  queueDelta: 0,
                  reviewerCompletedDelta: 0,
                });
              }
            }
            return json({ error: 'This duplicate case changed while you were reviewing it. Refresh and try again.' }, 409);
          }
          if (reviewedCandidate.status !== 'approved' || !reviewedCandidate.questionId)
            return json({ error: 'A matched proposal changed. Refresh this case to review the remaining matches.' }, 409);
          const approvedRow = await env.DB.prepare(
            "SELECT qbank_id,payload FROM records WHERE type='sharedQuestions' AND id=?",
          ).bind(reviewedCandidate.questionId).first<{ qbank_id: string | null; payload: string }>();
          if (!approvedRow || approvedRow.qbank_id !== proposal.qbankId)
            return json({ error: 'The approved matched question is unavailable. Refresh this case.' }, 409);
          const approvedQuestion = JSON.parse(approvedRow.payload) as Question;
          currentFinding = {
            ...finding,
            entityType: 'approved_question',
            entityId: reviewedCandidate.questionId,
            questionId: approvedQuestion.questionId,
          };
          payload = approvedQuestion;
        }
        const comparison = compareDuplicateContent(proposal.payload, payload);
        if (finding.candidateFingerprint && finding.candidateFingerprint !== comparison.candidateFingerprint)
          return json({ error: 'A matched question changed. Refresh to compare its latest content.' }, 409);
        validated.push({ originalEntityId: finding.entityId, finding: currentFinding, candidateFingerprint: comparison.candidateFingerprint });
      }
      const selectedCurrentFinding = validated.find((item) => item.originalEntityId === candidateEntityId)?.finding ?? selectedFinding;
      const now = new Date().toISOString();
      const resolutions = validated.map(({ finding }) => ({
        decision: decision as 'kept_both' | 'rejected_as_duplicate',
        candidateEntityId: finding.entityId,
        reviewerId: user.uid,
        reviewerName: user.displayName,
        reviewedAt: now,
        note: note || undefined,
      }));
      const reviewedProposal: QuestionProposal = {
        ...proposal,
        duplicateReview: {
          status: 'resolved',
          detectorVersion: proposal.duplicateReview?.detectorVersion ?? 'legacy-v0',
          sourceFingerprint,
          detectedAt: proposal.duplicateReview?.detectedAt ?? proposal.proposedAt,
          candidates: richCandidates.length
            ? richCandidates.map((candidate) => validated.find((item) => item.originalEntityId === candidate.entityId)?.finding ?? candidate)
            : [validated[0].finding],
          resolutions: [...(proposal.duplicateReview?.resolutions ?? []), ...resolutions],
        },
        status: decision === 'rejected_as_duplicate' ? 'rejected' : proposal.duplicateScanId ? 'approved' : 'pending',
        reviewedById: decision === 'rejected_as_duplicate' || proposal.duplicateScanId ? user.uid : proposal.reviewedById,
        reviewedByName: decision === 'rejected_as_duplicate' || proposal.duplicateScanId ? user.displayName : proposal.reviewedByName,
        reviewedAt: decision === 'rejected_as_duplicate' || proposal.duplicateScanId ? now : proposal.reviewedAt,
        reviewNote: note || (decision === 'rejected_as_duplicate'
          ? `Rejected as duplicate of ${selectedCurrentFinding.questionId ? `Question #${selectedCurrentFinding.questionId}` : selectedCurrentFinding.entityId}.`
          : proposal.reviewNote),
      };
      const statements: D1PreparedStatement[] = [
        env.DB.prepare('INSERT INTO duplicate_resolution_claims(proposal_id,source_fingerprint,reviewer_id,created_at) VALUES(?,?,?,?)')
          .bind(proposal.id, sourceFingerprint, user.uid, now),
        ...validated.map(({ finding, candidateFingerprint }) => env.DB.prepare(
          'INSERT INTO duplicate_pair_decisions(id,qbank_id,proposal_id,source_fingerprint,candidate_entity_type,candidate_entity_id,candidate_fingerprint,classification,similarity,detector_version,decision,reviewer_id,review_note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          crypto.randomUUID(), proposal.qbankId, proposal.id, sourceFingerprint,
          finding.entityType, finding.entityId, candidateFingerprint, finding.classification,
          finding.similarity, proposal.duplicateReview?.detectorVersion ?? 'legacy-v0', decision,
          user.uid, note || null, now,
        )),
        env.DB.prepare(
          "UPDATE records SET payload=?,updated_at=? WHERE type='questionProposals' AND id=? AND json_extract(payload,'$.status')='pending' AND (json_extract(payload,'$.duplicateReview.sourceFingerprint')=? OR (json_extract(payload,'$.duplicateReview.sourceFingerprint') IS NULL AND json_extract(payload,'$.duplicateInfo') IS NOT NULL))",
        ).bind(JSON.stringify(reviewedProposal), now, proposal.id, sourceFingerprint),
        auditStatement(user, decision === 'kept_both' ? 'duplicate_pair_kept' : 'proposal_rejected_as_duplicate', proposal.id, null, {
          qbankId: proposal.qbankId,
          candidates: validated.map(({ finding }) => ({ id: finding.entityId, type: finding.entityType, similarity: finding.similarity, classification: finding.classification })),
          detectorVersion: proposal.duplicateReview?.detectorVersion ?? 'legacy-v0',
          note: note || undefined,
        }),
      ];
      if (decision === 'rejected_as_duplicate') {
        statements.push(
          // The existing finalized-proposal trigger creates the canonical
          // rejected review/completion rows. Enrich that row instead of
          // racing the trigger's unique constraints.
          env.DB.prepare('UPDATE contribution_reviews SET metadata=? WHERE proposal_id=? AND reviewer_id=?')
            .bind(JSON.stringify({ duplicateDecision: 'rejected_as_duplicate', candidateEntityId: selectedCurrentFinding.entityId, detectorVersion: proposal.duplicateReview?.detectorVersion ?? 'legacy-v0' }), proposal.id, user.uid),
        );
      }
      try {
        await env.DB.batch(statements);
      } catch (error) {
        if (String(error).includes('UNIQUE constraint failed'))
          return json({ error: 'Another reviewer already resolved this duplicate case. Refresh and try again.' }, 409);
        throw error;
      }
      const saved = await env.DB.prepare("SELECT payload FROM records WHERE type='questionProposals' AND id=?")
        .bind(proposal.id).first<{ payload: string }>();
      const savedProposal = saved ? JSON.parse(saved.payload) as QuestionProposal : undefined;
      if (!savedProposal || savedProposal.duplicateReview?.sourceFingerprint !== sourceFingerprint || savedProposal.duplicateReview.status !== 'resolved')
        return json({ error: 'This duplicate finding became stale. Refresh before deciding.' }, 409);
      return json({
        ok: true,
        decision,
        updatedProposals: [savedProposal],
        updatedQuestions: [],
        reviewed: decision === 'rejected_as_duplicate' || proposal.duplicateScanId ? 1 : 0,
        awaitingSecondReview: 0,
        queueDelta: decision === 'rejected_as_duplicate' || proposal.duplicateScanId ? -1 : 0,
        reviewerCompletedDelta: decision === 'rejected_as_duplicate' || proposal.duplicateScanId ? 1 : 0,
      });
    }
    if (action === 'bulk-review') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const rawProposalIds = input.proposalIds;
      if (!Array.isArray(rawProposalIds) || rawProposalIds.length < 1 || rawProposalIds.length > 200 || rawProposalIds.some(id => typeof id !== 'string' || id.length < 1 || id.length > 200))
        return json({ error: 'Choose between 1 and 200 pending questions.' }, 400);
      const proposalIds = [...new Set(rawProposalIds as string[])];
      const status = text('status');
      if ((status !== 'approved' && status !== 'rejected'))
        return json({ error: 'Choose between 1 and 200 pending questions.' }, 400);

      const rows = await env.DB.prepare(
        "SELECT id,payload FROM records WHERE type='questionProposals' AND id IN (SELECT value FROM json_each(?))",
      ).bind(JSON.stringify(proposalIds)).all<{ id: string; payload: string }>();
      if (rows.results.length !== proposalIds.length) return json({ error: 'One or more proposals no longer exist. Refresh and try again.' }, 409);
      const proposals = rows.results.map(row => JSON.parse(row.payload) as QuestionProposal);
      if (proposals.some((proposal) =>
        proposal.duplicateReview?.status === 'flagged' ||
        (!proposal.duplicateReview && Boolean(proposal.duplicateInfo)),
      ))
        return json({ error: 'Resolve possible duplicate cases with KEEP BOTH or REJECT NEW AS DUPLICATE before normal review.' }, 409);
      const bankStates = new Map<string, Awaited<ReturnType<typeof bankAccessState>>>();
      for (const bankId of new Set(proposals.map(proposal => proposal.qbankId))) {
        const state = await bankAccessState(bankId);
        const bank = state.qbanks.find(item => item.id === bankId);
        if (!bank || !canReviewBank(user, bank, state.memberships)) return json({ error: 'Reviewer access is required for every selected QBank.' }, 403);
        bankStates.set(bankId, state);
      }
      if (proposals.some(proposal => proposal.status !== 'pending' || proposal.proposedById === user.uid))
        return json({ error: 'Some selected questions were already reviewed or were submitted by you. Refresh and try again.' }, 409);

      const reviewRows = await env.DB.prepare(
        "SELECT proposal_id,reviewer_id,decision FROM contribution_reviews WHERE proposal_id IN (SELECT value FROM json_each(?))",
      ).bind(JSON.stringify(proposalIds)).all<{ proposal_id: string; reviewer_id: string; decision: string }>();
      if (reviewRows.results.some((review) => review.reviewer_id === user.uid))
        return json({ error: 'You have already reviewed one or more selected submissions.' }, 409);
      const highRisk = new Set(
        proposals
          .filter(proposalRequiresTwoReviewers)
          .map((proposal) => proposal.id),
      );
      const awaitingSecond = new Set<string>();
      if (status === 'approved') {
        for (const proposal of proposals) {
          if (
            highRisk.has(proposal.id) &&
            !reviewRows.results.some(
              (review) => review.proposal_id === proposal.id && review.decision === 'approved',
            )
          )
            awaitingSecond.add(proposal.id);
        }
      }
      const proposalsToFinalize = proposals.filter(
        (proposal) => !awaitingSecond.has(proposal.id),
      );

      const existingIds = [...new Set(proposalsToFinalize.filter(proposal => proposal.type === 'question_edit').map(proposal => proposal.questionId).filter((id): id is string => Boolean(id)))];
      const existingRows = existingIds.length
        ? await env.DB.prepare("SELECT id,payload FROM records WHERE type='sharedQuestions' AND id IN (SELECT value FROM json_each(?))")
            .bind(JSON.stringify(existingIds)).all<{ id: string; payload: string }>()
        : { results: [] as Array<{ id: string; payload: string }> };
      const existingQuestions = new Map(existingRows.results.map(row => [row.id, JSON.parse(row.payload) as Question]));
      if (proposalsToFinalize.some(proposal => proposal.type === 'question_edit' && (!proposal.questionId || !existingQuestions.has(proposal.questionId))))
        return json({ error: 'A question changed or was deleted while you were reviewing it. Refresh and try again.' }, 409);

      const reservedByBank = new Map<string, string[]>();
      if (status === 'approved') {
        for (const bankId of new Set(proposalsToFinalize.filter(proposal => proposal.type === 'new_question').map(proposal => proposal.qbankId))) {
          const count = proposalsToFinalize.filter(proposal => proposal.type === 'new_question' && proposal.qbankId === bankId).length;
          const allocated = await allocateQuestionIds(count, bankId, user.uid);
          if (allocated.length !== count) return json({ error: 'Question ID capacity reached.' }, 409);
          reservedByBank.set(bankId, allocated);
        }
      }

      const now = new Date().toISOString();
      const nextNumbers = new Map<string, number>();
      const classifyPublishedQuestion = status === 'approved' && proposalsToFinalize.length > 0
        ? await publicationClassificationResolver(env.DB, proposalsToFinalize.map(proposal => proposal.qbankId))
        : (question: Question) => question;
      const updatedProposals: QuestionProposal[] = [];
      const updatedQuestions: Question[] = [];
      if (status === 'approved') {
        for (const bankId of new Set(proposalsToFinalize.map(proposal => proposal.qbankId))) {
          const maximum = await env.DB.prepare("SELECT coalesce(max(CAST(json_extract(payload,'$.number') AS INTEGER)),0) AS value FROM records WHERE type='sharedQuestions' AND qbank_id=?")
            .bind(bankId).first<{ value: number }>();
          nextNumbers.set(bankId, maximum?.value ?? 0);
        }
      }
      const statements: D1PreparedStatement[] = [];
      for (const proposal of proposals.filter((item) => awaitingSecond.has(item.id))) {
        statements.push(
          env.DB.prepare(
            "INSERT INTO contribution_reviews(id,proposal_id,author_id,reviewer_id,decision,high_risk,created_at,metadata) VALUES(?,?,?,?, 'approved',1,?,?)",
          ).bind(
            crypto.randomUUID(),
            proposal.id,
            proposal.proposedById,
            user.uid,
            now,
            JSON.stringify({ awaitingSecondReviewer: true }),
          ),
          auditStatement(user, 'high_risk_review_first_approval', proposal.id, null, {
            authorId: proposal.proposedById,
            awaitingSecondReviewer: true,
          }),
        );
      }
      for (const proposal of proposalsToFinalize) {
        statements.push(env.DB.prepare('INSERT INTO review_completion_claims(proposal_id,reviewer_id,created_at) VALUES(?,?,?)').bind(proposal.id, user.uid, now));
        const existing = proposal.questionId ? existingQuestions.get(proposal.questionId) : undefined;
        const internalId = proposal.type === 'new_question' ? `shared-${crypto.randomUUID()}` : proposal.questionId!;
        const reviewedProposal: QuestionProposal = {
          ...proposal,
          status,
          questionId: status === 'approved' ? internalId : proposal.questionId,
          reviewedById: user.uid,
          reviewedByName: user.displayName,
          reviewedAt: now,
        };
        updatedProposals.push(reviewedProposal);
        statements.push(
          env.DB.prepare(
            'INSERT INTO contribution_reviews(id,proposal_id,author_id,reviewer_id,decision,high_risk,created_at,metadata) VALUES(?,?,?,?,?,?,?,?)',
          ).bind(
            crypto.randomUUID(),
            proposal.id,
            proposal.proposedById,
            user.uid,
            status,
            highRisk.has(proposal.id) ? 1 : 0,
            now,
            '{}',
          ),
        );
        statements.push(env.DB.prepare("UPDATE records SET payload=?,updated_at=? WHERE type='questionProposals' AND id=? AND json_extract(payload,'$.status')='pending'")
          .bind(JSON.stringify(reviewedProposal), now, proposal.id));
        if (status === 'approved') {
          const number = existing?.number ?? (nextNumbers.set(proposal.qbankId, (nextNumbers.get(proposal.qbankId) ?? 0) + 1), nextNumbers.get(proposal.qbankId)!);
          const displayId = existing?.questionId ?? reservedByBank.get(proposal.qbankId)!.shift()!;
          const question: Question = {
            id: internalId,
            questionId: displayId,
            number,
            qbankId: proposal.qbankId,
            specialtyId: proposal.payload.specialtyId ?? existing?.specialtyId,
            specialty: proposal.payload.specialty,
            topicId: proposal.payload.topicId ?? existing?.topicId,
            topic: proposal.payload.topic,
            stem: proposal.payload.stem,
            options: proposal.payload.options,
            answer: proposal.payload.answer,
            answerLetter: optionLabel(proposal.payload.answer),
            explanation: proposal.payload.explanation,
            explanationImages: proposal.payload.explanationImages ?? existing?.explanationImages ?? [],
            ...readQuestionSource(proposal.payload),
            revision: (existing?.revision ?? 0) + 1,
            isCustom: true,
            images: proposal.payload.images ?? existing?.images ?? [],
            writtenById: proposal.type === 'new_question' ? proposal.proposedById : (existing?.writtenById ?? 'system'),
            writtenByName: proposal.type === 'new_question' ? proposal.proposedByName : (existing?.writtenByName ?? 'Qraft'),
            reviewedById: user.uid,
            reviewedByName: user.displayName,
            reviewedAt: now,
          };
          const publishedQuestion = classifyPublishedQuestion(question);
          updatedQuestions.push(publishedQuestion);
          statements.push(env.DB.prepare("INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES('sharedQuestions',?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET qbank_id=excluded.qbank_id,payload=excluded.payload,updated_at=excluded.updated_at")
            .bind(publishedQuestion.id, publishedQuestion.qbankId, JSON.stringify(publishedQuestion), now));
          const reward = contributionReward(proposal);
          if (reward.amount > 0) statements.push(
            env.DB.prepare(
              'INSERT OR IGNORE INTO credit_transactions(id,user_id,amount,lifetime_delta,type,reason,reference_type,reference_id,created_by,created_at,metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            ).bind(
              `contribution-${proposal.id}`,
              proposal.proposedById,
              reward.amount,
              reward.amount,
              'approved_contribution',
              reward.reason,
              'questionProposal',
              proposal.id,
              user.uid,
              now,
              JSON.stringify({ editKinds: proposal.editKinds, qbankId: proposal.qbankId }),
            ),
          );
        }
      }
      const publishedQuestions = new Map(updatedQuestions.map((question) => [question.id, question]));
      const finalized = new Map<string, FinalizedDuplicateCandidate>(
        updatedProposals.map((proposal) => [proposal.id, {
          status,
          question: proposal.questionId ? publishedQuestions.get(proposal.questionId) : undefined,
        }]),
      );
      const dependentRows = finalized.size
        ? await env.DB.prepare(
          `SELECT source.id,source.payload FROM records AS source
           WHERE source.type='questionProposals'
             AND json_extract(source.payload,'$.status')='pending'
             AND json_extract(source.payload,'$.duplicateReview.status')='flagged'
             AND EXISTS (
               SELECT 1 FROM json_each(source.payload,'$.duplicateReview.candidates') AS candidate
               WHERE json_extract(candidate.value,'$.entityType')='pending_proposal'
                 AND json_extract(candidate.value,'$.entityId') IN (SELECT value FROM json_each(?))
             )`,
        ).bind(JSON.stringify([...finalized.keys()])).all<{ id: string; payload: string }>()
        : { results: [] as Array<{ id: string; payload: string }> };
      const dependentUpdates: Array<{ statementIndex: number; proposal: QuestionProposal }> = [];
      for (const row of dependentRows.results) {
        const rebased = rebasePendingDuplicateReview(
          JSON.parse(row.payload) as QuestionProposal, finalized, now,
        );
        if (!rebased) continue;
        dependentUpdates.push({ statementIndex: statements.length, proposal: rebased });
        statements.push(env.DB.prepare(
          "UPDATE records SET payload=?,updated_at=? WHERE type='questionProposals' AND id=? AND payload=?",
        ).bind(JSON.stringify(rebased), now, row.id, row.payload));
      }
      statements.push(auditStatement(user, `questions_bulk_${status}`, crypto.randomUUID(), null, {
        count: proposals.length,
        proposalIds,
        submitters: [...new Set(proposals.map(proposal => proposal.proposedById))],
        rebasedDuplicateCases: dependentUpdates.length,
      }));
      statements.push(await importKeyStatement([
        ...updatedQuestions.map(question => ({ collection: 'sharedQuestions', id: question.id, payload: JSON.stringify(question) })),
        ...updatedProposals.map(proposal => ({ collection: 'questionProposals', id: proposal.id, payload: JSON.stringify(proposal) })),
        ...dependentUpdates.map(({ proposal }) => ({ collection: 'questionProposals', id: proposal.id, payload: JSON.stringify(proposal) })),
      ]));
      statements.push(...classificationCleanupStatements(env.DB, updatedQuestions.map(question => question.qbankId ?? 'smle-gs'), now));
      const batchResults = await env.DB.batch(statements);
      await emitUsage(user.uid, { reviewContributions: proposalsToFinalize.length + awaitingSecond.size });
      return json({
        ok: true,
        reviewed: proposalsToFinalize.length,
        awaitingSecondReview: awaitingSecond.size,
        updatedProposals: [
          ...updatedProposals,
          ...dependentUpdates
            .filter(({ statementIndex }) => batchResults[statementIndex]?.meta.changes)
            .map(({ proposal }) => proposal),
        ],
        updatedQuestions,
        queueDelta: -proposalsToFinalize.length,
        reviewerCompletedDelta: proposalsToFinalize.length,
      });
    }
    if (action === 'review-history') {
      if (request.method === 'GET') {
        const record = await env.DB.prepare("SELECT payload FROM records WHERE type='reviewHistoryPreferences' AND id=? AND owner_id=?").bind(user.uid, user.uid).first<{ payload: string }>();
        return json(record ? JSON.parse(record.payload) : { clearedAt: '' });
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const clearedAt = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES('reviewHistoryPreferences',?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at")
          .bind(user.uid, user.uid, JSON.stringify({ clearedAt }), clearedAt),
        auditStatement(user, 'review_history_cleared', user.uid, null, { clearedAt }),
      ]);
      return json({ clearedAt });
    }
    if (action === 'quote' && request.method === 'POST') {
      const requestedPlan = text('plan');
      return json(
        await quote(
          user,
          text('code'),
          paidPlan(requestedPlan),
        ),
      );
    }
    if (action === 'checkout' && request.method === 'POST') {
      const id = text('requestId');
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(id))
        return json({ error: 'Invalid request ID.' }, 400);
      const prior = await env.DB.prepare(
        'SELECT status,user_id FROM subscription_events WHERE id=?',
      )
        .bind(id)
        .first<{ status: string; user_id: string }>();
      if (prior)
        return prior.user_id === user.uid && prior.status === 'success'
          ? json({ upgraded: true, user: await applyEffectiveEntitlement(user) })
          : json({ error: 'Please retry with a new request.' }, 409);
      const requestedPlan = text('plan');
      const plan = paidPlan(requestedPlan);
      const price = await quote(user, text('code'), plan);
      if (input.acceptedTerms !== true)
        return json({ error: 'Please read and agree to all terms and policies before continuing to WhatsApp.' }, 400);
      const message = `I would like a ${PLAN_DURATION_MONTHS[plan]}-month ${price.planName} subscription.\nName: ${user.displayName}\nEmail: ${user.email}\nUser ID: ${user.uid}\nOriginal: ${price.original / 100} SAR\nCode: ${price.code || 'None'}\nDiscount: ${price.discount / 100} SAR\nFinal: ${price.final / 100} SAR`;
      return json({
        url: `https://wa.me/966537043984?text=${encodeURIComponent(message)}`,
      });
    }
    if (action === 'discounts') {
      if (!root) return json({ error: 'Superadmin MFA required.' }, 403);
      if (request.method === 'GET') {
        const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
        const usageOffset = Math.max(0, Math.floor(Number(url.searchParams.get('usageOffset')) || 0));
        const search = `%${(url.searchParams.get('search') || '').slice(0, 100)}%`;
        const status = url.searchParams.get('status') || '';
        const now = new Date().toISOString();
        const where = `WHERE code LIKE ? AND (?='' OR (?='disabled' AND enabled=0) OR (?='active' AND enabled=1 AND (starts_at IS NULL OR starts_at<=?) AND (expires_at IS NULL OR expires_at>?) AND (max_uses IS NULL OR uses<max_uses)) OR (?='expired' AND expires_at<=?) OR (?='scheduled' AND starts_at>?) OR (?='exhausted' AND max_uses IS NOT NULL AND uses>=max_uses))`;
        const args = [search,status,status,status,now,now,status,now,status,now,status];
        const [rows, totals] = await env.DB.batch([
          env.DB.prepare(`SELECT * FROM discount_codes ${where} ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?`).bind(...args,offset),
          env.DB.prepare(`SELECT count(*) AS total,coalesce(sum(enabled=1),0) AS enabled,coalesce(sum(uses),0) AS uses FROM discount_codes ${where}`).bind(...args),
        ]);
        const events = url.searchParams.get('id')
          ? await env.DB.prepare('SELECT * FROM subscription_events WHERE code_id=? ORDER BY created_at DESC,id LIMIT 51 OFFSET ?').bind(url.searchParams.get('id'),usageOffset).all()
          : { results: [] };
        return json({ codes: rows.results, events: events.results, summary: totals.results[0], price: (await env.DB.prepare('SELECT price FROM subscription_settings WHERE id=1').first<{ price: number }>())!.price });
      }
      if (text('operation') === 'price') {
        return json({error:'Manage each plan price from Pricing & plans.'},409);
      }
      const id = text('id') || crypto.randomUUID();
      const old = await env.DB.prepare(
        'SELECT * FROM discount_codes WHERE id=?',
      )
        .bind(id)
        .first<Discount>();
      if (request.method === 'DELETE') {
        if (!old) return json({ ok: true, unchanged: true, deletedId: id }, 200, { 'x-qraft-unchanged': '1' });
        await env.DB.batch([
          env.DB.prepare('DELETE FROM discount_codes WHERE id=?').bind(id),
          auditStatement(user, 'discount_deleted', id, old, null),
        ]);
        return json({ ok: true, deletedId: id });
      }
      const code = text('code').toUpperCase(),
        kind = text('kind'),
        amount = Number(input.amount);
      const startsInput = text('starts_at'),
        expiresInput = text('expires_at');
      const starts = startsInput && Number.isFinite(Date.parse(startsInput))
        ? new Date(startsInput).toISOString()
        : startsInput || null;
      const expires = expiresInput && Number.isFinite(Date.parse(expiresInput))
        ? new Date(expiresInput).toISOString()
        : expiresInput || null;
      const allowedPlans = Array.isArray(input.allowedPlans)
        ? [...new Set(input.allowedPlans.filter((plan): plan is PlanId => isPlanId(plan) && plan !== 'free'))]
        : old
          ? (JSON.parse(old.allowed_plans || '[]') as PlanId[])
          : ['full_monthly', 'full_quarterly'];
      const max =
          input.max_uses === null || input.max_uses === ''
            ? null
            : Number(input.max_uses),
        per =
          input.per_user === null || input.per_user === ''
            ? null
            : Number(input.per_user);
      if (
        !/^[A-Z0-9_-]{2,40}$/.test(code) ||
        !['percent', 'fixed'].includes(kind) ||
        !Number.isInteger(amount) ||
        amount < 0 ||
        (kind === 'percent' && amount > 100) ||
        amount > 10000000 ||
        [max, per].some((x) => x !== null && (!Number.isInteger(x) || x < 1)) ||
        [startsInput, expiresInput].some((x) => x && !Number.isFinite(Date.parse(x))) ||
        (starts && expires && Date.parse(starts) >= Date.parse(expires))
        || !allowedPlans.length
      )
        throw new ValidationError('Check code, discount amount, dates and usage limits.');
      const next = {
        code,
        kind,
        amount,
        enabled: input.enabled ? 1 : 0,
        starts,
        expires,
        max,
        per,
        allowedPlans,
      };
      const unchanged = Boolean(old &&
        old.code === code && old.kind === kind && old.amount === amount && old.enabled === next.enabled &&
        old.starts_at === starts && old.expires_at === expires && old.max_uses === max && old.per_user === per &&
        JSON.stringify(JSON.parse(old.allowed_plans || '[]')) === JSON.stringify(allowedPlans));
      if (unchanged) return json({ ok: true, unchanged: true, code: old }, 200, { 'x-qraft-unchanged': '1' });
      const updatedAt = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO discount_codes(id,code,kind,amount,enabled,starts_at,expires_at,max_uses,per_user,updated_at,allowed_plans) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,kind=excluded.kind,amount=excluded.amount,enabled=excluded.enabled,starts_at=excluded.starts_at,expires_at=excluded.expires_at,max_uses=excluded.max_uses,per_user=excluded.per_user,updated_at=excluded.updated_at,allowed_plans=excluded.allowed_plans',
        ).bind(
          id,
          code,
          kind,
          amount,
          next.enabled,
          starts,
          expires,
          max,
          per,
          updatedAt,
          JSON.stringify(allowedPlans),
        ),
        auditStatement(
          user,
          old ? 'discount_updated' : 'discount_created',
          id,
          old,
          next,
        ),
      ]);
      return json({
        ok: true,
        code: {
          id, code, kind, amount, enabled: next.enabled, starts_at: starts,
          expires_at: expires, max_uses: max, per_user: per,
          uses: old?.uses ?? 0, updated_at: updatedAt,
          allowed_plans: JSON.stringify(allowedPlans),
        },
      });
    }
    if (action === 'subscriptions') {
      if (!root) return json({ error: 'Superadmin MFA required.' }, 403);
      if (request.method === 'GET') return json(await listAdminSubscribers(url));
      return json({ error: 'Use the unified subscription manager.', code: 'SUBSCRIPTION_MANAGER_MOVED' }, 410);
    }
    if (action === 'question') {
      const number = (url.searchParams.get('id') || text('id'))
        .replace(/^#/, '')
        .padStart(5, '0');
      const row = await env.DB.prepare(
        "SELECT r.payload,q.uuid,q.created_at FROM question_registry q JOIN records r ON r.id=q.id AND r.type='sharedQuestions' WHERE q.question_id=?",
      )
        .bind(number)
        .first<{ payload: string; uuid: string; created_at: string }>();
      if (!row) return json({ error: 'Question not found' }, 404);
      const question = JSON.parse(row.payload) as Question;
      const state = await bankAccessState(question.qbankId ?? 'smle-gs');
      const bank = state.qbanks.find((x) => x.id === question.qbankId);
      if (
        !bank ||
        !(
          canAccessBank(user, bank, state.memberships) ||
          canReviewBank(user, bank, state.memberships)
        )
      )
        return json({ error: 'Question not found' }, 404);
      if (request.method === 'DELETE') {
        if (!canEditBank(user, bank, state.memberships))
          return json({ error: 'QBank editing access required.' }, 403);
        await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM records WHERE type='sharedQuestions' AND id=?",
          ).bind(question.id),
          auditStatement(
            user,
            'question_deleted',
            '#deleted',
            { internalId: question.id },
            null,
          ),
          ...classificationCleanupStatements(env.DB, [bank.id], new Date().toISOString()),
        ]);
        return json({ ok: true });
      }
      return json({
        question,
        details: canReviewBank(user, bank, state.memberships)
          ? {
              bank: bank.name,
              creator: question.writtenByName ?? 'Qraft',
              createdAt: row.created_at,
              updatedAt: question.reviewedAt,
              status: 'approved',
            }
          : null,
      });
    }
    if (action === 'import' && request.method === 'POST') {
      if (user.role === 'super_admin' && !root)
        return json({ error: 'Superadmin verification required.' }, 403);
      if (input.skipExactDuplicates !== undefined && typeof input.skipExactDuplicates !== 'boolean')
        throw new ValidationError('Invalid exact-duplicate skipping option.');
      const batchId = text('requestId');
      if (!/^[a-zA-Z0-9-]{20,80}$/.test(batchId))
        throw new ValidationError('Invalid import ID.');
      const previous = await env.DB.prepare(
        'SELECT user_id,result FROM import_batches WHERE id=?',
      )
        .bind(batchId)
        .first<{ user_id: string; result: string }>();
      if (previous)
        return previous.user_id === user.uid
          ? json(JSON.parse(previous.result), 200, { 'x-qraft-unchanged': '1' })
          : json({ error: 'Invalid import ID.' }, 409);
      const plan = user.effectivePlan ?? user.tier;
      const limits = user.planLimits ?? getPlanLimits(plan);
      const now = new Date().toISOString();
      const uploadedFileName = text('fileName')
        .split(/[\\/]/)
        .pop()
        ?.trim()
        .slice(0, 240) ?? '';
      const fileHash = text('fileHash').toLowerCase();
      const originalFileName = (text('originalFileName') || uploadedFileName)
        .split(/[\\/]/)
        .pop()
        ?.trim()
        .slice(0, 240) ?? '';
      const originalFileHash = (
        text('originalFileHash') || fileHash
      ).toLowerCase();
      const uploadSessionId = text('uploadSessionId') || batchId;
      const chunkIndex = Number(input.chunkIndex ?? 0);
      const chunkCount = Number(input.chunkCount ?? 1);
      if (
        !uploadedFileName ||
        !originalFileName ||
        !/^[a-f0-9]{64}$/.test(fileHash) ||
        !/^[a-f0-9]{64}$/.test(originalFileHash) ||
        !/^[a-zA-Z0-9-]{20,80}$/.test(uploadSessionId) ||
        !Number.isInteger(chunkIndex) ||
        chunkIndex < 0 ||
        !Number.isInteger(chunkCount) ||
        chunkCount < 1 ||
        chunkCount > 10_000 ||
        chunkIndex >= chunkCount
      )
        return json(
          { error: 'The file or import metadata is invalid.', code: 'INVALID_IMPORT_METADATA' },
          400,
        );
      const context: ImportMonitorContext = {
        runId: uploadSessionId,
        requestId: batchId,
        userId: user.uid,
        qbankId: text('qbankId'),
        fileName: originalFileName,
        normalizedName: originalFileName.toLocaleLowerCase('en-US'),
        fileHash: originalFileHash,
        chunkHash: fileHash,
        sourceFile: text('sourceFile').slice(0, 240),
        chunkIndex,
        chunkCount,
        startedAt: now,
      };
      await beginImportMonitoring(context);
      activeImportContext = context;
      if (!root && !limits.canUseJsonImport)
        return rejectImport(
          context,
          'PLAN_ACCESS_DENIED',
          'Import is available with Full Access.',
          403,
        );
      if (!root && !(await importSettings()).enabled)
        return rejectImport(context, 'IMPORT_PAUSED', 'JSON import is temporarily paused by Superadmin.', 403);
      if (input.rightsConfirmed === false)
        return rejectImport(
          context,
          'RIGHTS_CONFIRMATION_REQUIRED',
          'Confirm that you have the right to share this content.',
          400,
        );
      const suspension = await env.DB.prepare(
        'SELECT ends_at,reason FROM json_import_suspensions WHERE user_id=? AND removed_at IS NULL AND starts_at<=? AND ends_at>? ORDER BY ends_at DESC LIMIT 1',
      ).bind(user.uid, now, now).first<{ ends_at: string; reason: string }>();
      if (suspension)
        return rejectImport(
          context,
          'IMPORT_SUSPENDED',
          `Import is suspended until ${suspension.ends_at}.`,
          403,
        );
      const state = await bankAccessState(text('qbankId'));
      const bank = state.qbanks.find((x) => x.id === text('qbankId'));
      if (!bank || !canAccessBank(user, bank, state.memberships) || (!root && !limits.canAddQuestions))
        return rejectImport(
          context,
          bank ? 'QBANK_ACCESS_DENIED' : 'QBANK_NOT_FOUND',
          bank
            ? 'Question contribution access requires Full Access.'
            : 'The target QBank no longer exists.',
          bank ? 403 : 404,
        );
      const normalizedName = uploadedFileName.toLocaleLowerCase('en-US');
      const rawImport = typeof input.questions === 'string'
        ? input.questions
        : { sourceFile: text('sourceFile'), questions: input.questions, skipped: input.skipped };
      const report = validatedImportReport(rawImport, '', root ? 500 : 200);
      context.sourceFile = report.sourceFile;
      if (!report.questions.length)
        return rejectImport(
          context,
          'NO_VALID_QUESTIONS',
          'No complete, valid questions were found to import.',
          400,
          {
            total: report.skipped.length,
            invalid: report.skipped.length,
            repaired: report.repaired || input.repaired === true,
            report: report.skipped,
          },
        );
      const controlledLimits=await importLimits(user);
      if(root && report.questions.length>250) return rejectImport(context,'ADMIN_BATCH_LIMIT','Administrative batches allow at most 250 questions; split the file into smaller batches.',400);
      if (!root && report.questions.length > Math.min(150,controlledLimits.questionsPerImport))
        return rejectImport(
          context,
          'QUESTION_LIMIT_REACHED',
          `This account allows at most ${controlledLimits.questionsPerImport} questions per import; upload in batches of at most 150.`,
          403,
        );
      const searchRevision = await importSearchRevision();
      const candidates = await importCandidates(bank.id,report.questions,user.uid,searchRevision);
      const preparedCandidates: ReturnType<typeof prepareDuplicateCandidate>[] = [...candidates];
      const duplicateIndex = new ImportDuplicateIndex(preparedCandidates);
      let skippedDuplicates = 0;
      const accepted: Array<{
        id: string;
        payload: QuestionProposal['payload'];
        duplicateReview?: QuestionProposal['duplicateReview'];
      }> = [];
      for (const [index, payload] of report.questions.entries()) {
        const identity = exactImportIdentity(payload);
        if (input.skipExactDuplicates === true && identity &&
            duplicateIndex.exact(bank.id, normalizeDuplicateText(payload.stem))
              .some(candidate => exactImportIdentity(candidate.payload) === identity)) {
          skippedDuplicates++;
          continue;
        }
        const proposalId = `${batchId}-${index}`;
        const prepared = prepareDuplicateCandidate({
          entityId: proposalId,
          entityType: 'pending_proposal',
          qbankId: bank.id,
          payload,
        });
        let duplicateReview: QuestionProposal['duplicateReview'] = detectImportDuplication(payload,bank.id,preparedCandidates,proposalId,duplicateIndex);
        const choice=Array.isArray(input.duplicateChoices)?input.duplicateChoices[index]:undefined;
        if(duplicateReview && choice?.sourceFingerprint===duplicateFingerprint(payload) && Array.isArray(choice.candidateFingerprints) && duplicateReview.candidates.every(candidate=>choice.candidateFingerprints.includes(candidate.candidateFingerprint))) {
          duplicateReview={...duplicateReview,status:'resolved',resolutions:duplicateReview.candidates.map(candidate=>({decision:'kept_both',candidateEntityId:candidate.entityId,reviewerId:user.uid,reviewerName:user.displayName,reviewedAt:now,note:'Author explicitly selected Save as duplication during import review.'}))};
        }
        accepted.push({
          id: proposalId,
          payload,
          duplicateReview,
        });
        preparedCandidates.push(prepared);
        duplicateIndex.add(prepared);
      }
      if (!root && accepted.length) {
        const dailyImports = await env.DB.prepare(
          'SELECT count(DISTINCT coalesce(run_id,id)) AS value FROM imported_files WHERE user_id=? AND uploaded_at>=? AND coalesce(run_id,id)<>?',
        ).bind(user.uid, utcDayStart(),uploadSessionId).first<{ value: number }>();
        if ((dailyImports?.value ?? 0) >= controlledLimits.importsPerDay)
          return rejectImport(
            context,
            'DAILY_LIMIT_REACHED',
            `You've reached your daily import limit (${controlledLimits.importsPerDay}).`,
            403,
          );
      }
      if (!root) {
        const pending = await env.DB.prepare(
          "SELECT count(*) AS value FROM records WHERE type='questionProposals' AND owner_id=? AND json_extract(payload,'$.status')='pending'",
        ).bind(user.uid).first<{ value: number }>();
        if ((pending?.value ?? 0) + accepted.length > limits.maxPendingReviewQuestions)
          return rejectImport(
            context,
            'PENDING_QUEUE_FULL',
            'Your submission queue is full. Please wait until some questions are reviewed before importing more.',
            403,
          );
      }
      const classificationRows = await env.DB.prepare(
        "SELECT type,payload FROM records WHERE qbank_id=? AND type IN ('qbankSpecialties','qbankTopics')",
      ).bind(bank.id).all<{ type: string; payload: string }>();
      const importSpecialties = classificationRows.results
        .filter((row) => row.type === 'qbankSpecialties')
        .map((row) => JSON.parse(row.payload) as QBankSpecialty);
      const importTopics = classificationRows.results
        .filter((row) => row.type === 'qbankTopics')
        .map((row) => JSON.parse(row.payload) as QBankTopic);
      const createdSpecialties: QBankSpecialty[] = [];
      const createdTopics: QBankTopic[] = [];
      for (const item of accepted) {
        const specialtyName = (item.payload.specialty.trim().replace(/\s+/g, ' ') || 'General').slice(0, 120);
        let specialty = [...importSpecialties, ...createdSpecialties].find((candidate) => candidate.name === specialtyName)
          ?? [...importSpecialties, ...createdSpecialties].find((candidate) => normalizeClassificationName(candidate.name) === normalizeClassificationName(specialtyName));
        if (!specialty) {
          specialty = {
            id: crypto.randomUUID(), qbankId: bank.id, name: specialtyName,
            order: importSpecialties.length + createdSpecialties.length,
            createdAt: now, updatedAt: now,
          };
          createdSpecialties.push(specialty);
        }
        const topicName = (item.payload.topic.trim().replace(/\s+/g, ' ') || 'General').slice(0, 120);
        let topic = [...importTopics, ...createdTopics].find((candidate) => candidate.specialtyId === specialty.id && candidate.name === topicName)
          ?? [...importTopics, ...createdTopics].find((candidate) => candidate.specialtyId === specialty.id && normalizeClassificationName(candidate.name) === normalizeClassificationName(topicName));
        if (!topic) {
          topic = {
            id: crypto.randomUUID(), qbankId: bank.id, specialtyId: specialty.id,
            name: topicName, order: importTopics.length + createdTopics.length,
            createdAt: now, updatedAt: now,
          };
          createdTopics.push(topic);
        }
        item.payload = {
          ...item.payload,
          specialtyId: specialty.id,
          specialty: specialty.name,
          topicId: topic.id,
          topic: topic.name,
        };
      }
      const proposals = accepted.map(({ id, payload, duplicateReview }) => ({
        id,
        qbankId: bank.id,
        type: 'new_question',
        editKinds: [
          'question_text',
          'options',
          'correct_answer',
          'explanation',
          'source',
        ],
        payload,
        rationale: 'Imported from JSON.',
        submissionMethod: 'json',
        importBatchId: batchId,
        duplicateReview,
        status: 'pending',
        proposedById: user.uid,
        proposedByName: user.displayName,
        proposedAt: now,
      }));
      const result = {
        proposals,
        // Pending proposals retain their classification in their payload. The
        // bank structure contains only classifications with published questions.
        specialties: [] as QBankSpecialty[],
        topics: [] as QBankTopic[],
        uploadSessionId: context.runId,
        requestId: context.requestId,
        chunkIndex: context.chunkIndex,
        chunkCount: context.chunkCount,
        reuploadPolicy: 'question-text-review' as const,
        total: proposals.length + skippedDuplicates + report.skipped.length,
        successful: proposals.length,
        failed: report.skipped.length,
        skippedDuplicates,
        flaggedDuplicates: proposals.filter((proposal) => proposal.duplicateReview).length,
        pendingReview: proposals.length,
        skipped: report.skipped,
        repaired: report.repaired || input.repaired === true,
      };
      const attemptStatus: ImportAttemptStatus = !proposals.length && skippedDuplicates
        ? 'duplicate_only'
        : report.skipped.length || skippedDuplicates || result.flaggedDuplicates
          ? 'partial'
          : 'completed';
      const monitoringStatements = importMonitoringStatements(context, {
        status: attemptStatus,
        total: result.total,
        successful: result.successful,
        invalid: result.failed,
        skippedDuplicates,
        flaggedDuplicates: result.flaggedDuplicates,
        repaired: result.repaired,
        report: report.skipped,
      });
      if (skippedDuplicates) monitoringStatements.push(auditStatement(user,
        'import_exact_duplicates_skipped', bank.id, null,
        { batchId, skippedDuplicates, explicitlyRequested: true }));
      if (!proposals.length) {
        try { await env.DB.batch([
          importSearchGuard(batchId, searchRevision),
          env.DB.prepare(
            'INSERT INTO import_batches(id,user_id,result) VALUES(?,?,?)',
          ).bind(batchId, user.uid, JSON.stringify(result)),
          ...monitoringStatements,
          releaseImportSearchGuard(batchId),
        ]); } catch (error) {
          if (String(error).includes('import_search_snapshot_matches')) {
            activeImportContext = undefined;
            return rejectImport(context, 'IMPORT_SEARCH_CONFLICT', 'Questions changed during duplicate review. Retry this preserved batch.', 409);
          }
          throw error;
        }
        activeImportContext = undefined;
      await emitUsage(user.uid, { questionsImported:proposals.length });
        return json(result, 200, { 'x-qraft-import-content-changed': '0' });
      }
      try {
        await env.DB.batch([
          importSearchGuard(batchId, searchRevision),
          env.DB.prepare(
            'INSERT INTO import_batches(id,user_id,result) VALUES(?,?,?)',
          ).bind(batchId, user.uid, JSON.stringify(result)),
          env.DB.prepare(
            'INSERT INTO imported_files(id,user_id,file_name,normalized_name,file_hash,batch_id,source_file,successful_count,skipped_count,report_json,uploaded_at,daily_limit,pending_limit,run_id,question_limit) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ).bind(crypto.randomUUID(), user.uid, uploadedFileName, normalizedName, fileHash, batchId, report.sourceFile, proposals.length, report.skipped.length, JSON.stringify(report.skipped), now, root ? Number.MAX_SAFE_INTEGER : controlledLimits.importsPerDay, root ? Number.MAX_SAFE_INTEGER : limits.maxPendingReviewQuestions, uploadSessionId, root ? Number.MAX_SAFE_INTEGER : controlledLimits.questionsPerImport),
          env.DB.prepare(
            "INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) SELECT 'questionProposals',json_extract(value,'$.id'),?,?,value,? FROM json_each(?)",
          ).bind(bank.id, user.uid, now, JSON.stringify(proposals)),
          await importKeyStatement(proposals.map(proposal => ({ collection: 'questionProposals', id: proposal.id, payload: JSON.stringify(proposal) }))),
          auditStatement(user, 'questions_json_imported', bank.id, null, {
            batchId, fileName: uploadedFileName, fileHash, count: proposals.length, skipped: report.skipped.length,
            skippedDuplicates,
            duplicateCandidates: proposals.filter((proposal) => proposal.duplicateReview).length,
          }),
          ...(proposals.some((proposal) => proposal.duplicateReview)
            ? [auditStatement(user, 'duplicate_candidate_flagged', batchId, null, {
                qbankId: bank.id,
                source: 'json_import',
                detectorVersion: DUPLICATE_DETECTION_CONFIG.detectorVersion,
                count: proposals.filter((proposal) => proposal.duplicateReview).length,
              })]
            : []),
          ...monitoringStatements,
          releaseImportSearchGuard(batchId),
        ]);
      } catch (error) {
        if (String(error).includes('import_search_snapshot_matches')) {
          activeImportContext = undefined;
          return rejectImport(context, 'IMPORT_SEARCH_CONFLICT', 'Questions changed during duplicate review. Retry this preserved batch.', 409);
        }
        if (String(error).includes('JSON_IMPORT_QUESTION_LIMIT')) return rejectImport(context,'QUESTION_LIMIT_REACHED',`This account allows ${controlledLimits.questionsPerImport} questions per import.`,403);
        if (String(error).includes('JSON_IMPORT_DAILY_LIMIT'))
          return rejectImport(
            context,
            'DAILY_LIMIT_REACHED',
            `You've reached your daily import limit (${controlledLimits.importsPerDay}).`,
            403,
          );
        if (String(error).includes('JSON_IMPORT_PENDING_LIMIT'))
          return rejectImport(
            context,
            'PENDING_QUEUE_FULL',
            'Your submission queue is full. Please wait until some questions are reviewed before importing more.',
            403,
          );
        if (
          String(error).includes('idx_imported_files_user_name') ||
          String(error).includes('idx_imported_files_user_hash') ||
          String(error).includes('imported_files.user_id, imported_files.normalized_name') ||
          String(error).includes('imported_files.user_id, imported_files.file_hash')
        )
          return rejectImport(
            context,
            'LEGACY_FILE_CONSTRAINT',
            'A legacy file-history constraint is still active. Apply the latest D1 migrations; the file itself is allowed to be imported again.',
            409,
          );
        if (String(error).includes('UNIQUE constraint failed'))
          return rejectImport(
            context,
            'DATABASE_CONFLICT',
            'This batch could not be saved because of a concurrent change. Retry using the same draft.',
            409,
          );
        throw error;
      }
      activeImportContext = undefined;
      await emitUsage(user.uid, { questionsImported:proposals.length });
      return json(result);
    }
    if (action === 'import-search-reindex') {
      if (!root) return json({ error: 'Verified Superadmin access required.' }, 403);
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const collection = input.collection ?? 'sharedQuestions';
      const cursor = input.cursor ?? '';
      if (typeof collection !== 'string' || !['sharedQuestions', 'questionProposals'].includes(collection) || typeof cursor !== 'string' || cursor.length > 200)
        throw new ValidationError('Invalid indexing cursor.');
      const rows = await env.DB.prepare(`SELECT type,id,payload FROM records INDEXED BY idx_records_type_id
        WHERE type=? AND id>? ORDER BY id LIMIT 200`)
        .bind(collection, cursor).all<{ type: string; id: string; payload: string }>();
      if (rows.results.length) {
        const statement = await importKeyStatement(rows.results.map(row => ({ collection: row.type, id: row.id, payload: row.payload })));
        await statement.run();
      }
      const nextCollection = rows.results.length < 200 && collection === 'sharedQuestions' ? 'questionProposals' : collection;
      return json({ collection: nextCollection,
        cursor: nextCollection !== collection ? '' : rows.results.at(-1)?.id ?? cursor,
        processed: rows.results.length, done: rows.results.length < 200 && collection === 'questionProposals' },
        200, { 'x-qraft-unchanged': '1' });
    }
    if (action === 'reviewers') {
      const bankId = url.searchParams.get('bank') || text('bankId');
      const state = await bankAccessState(bankId);
      const bank = state.qbanks.find((x) => x.id === bankId);
      if (!bank || !canManageBank(user, bank))
        return json({ error: 'Bank manager required.' }, 403);
      if (request.method === 'GET') {
        const search = (url.searchParams.get('search') || '').slice(0, 100);
        const rows = search
          ? await env.DB.prepare(
              "SELECT uid,email,json_extract(profile_json,'$.displayName') AS name FROM profiles WHERE json_extract(profile_json,'$.status')='approved' AND coalesce(json_extract(profile_json,'$.suspended'),0)=0 AND (email LIKE ? OR json_extract(profile_json,'$.displayName') LIKE ?) ORDER BY email LIMIT 10",
            )
              .bind(`%${search}%`, `%${search}%`)
              .all()
          : await env.DB.prepare(
              "SELECT p.uid,p.email,json_extract(p.profile_json,'$.displayName') AS name FROM profiles p JOIN records r ON r.type='qbankMemberships' AND json_extract(r.payload,'$.userId')=p.uid WHERE json_extract(r.payload,'$.role')='reviewer' AND json_extract(r.payload,'$.grantedById')=? GROUP BY p.uid ORDER BY max(r.updated_at) DESC LIMIT 10",
            )
              .bind(user.uid)
              .all();
        return json({ users: rows.results });
      }
      const target = await profileById(text('userId'));
      if (!target) throw new ValidationError('User not found.');
      const profile = JSON.parse(target.profile_json) as MemberProfile;
      if (profile.status !== 'approved' || profile.suspended)
        throw new ValidationError('User is not active.');
      if (
        bank.ownerId === profile.uid ||
        state.memberships.some(
          (x) =>
            x.qbankId === bank.id &&
            x.userId === profile.uid &&
            x.role === 'reviewer',
        )
      )
        throw new ValidationError('This reviewer is already added.');
      const now = new Date().toISOString();
      const membership = {
        id: `reviewer-${bank.id}-${profile.uid}`,
        qbankId: bank.id,
        userId: profile.uid,
        userName: profile.displayName,
        role: 'reviewer',
        grantedById: user.uid,
        grantedByName: user.displayName,
        createdAt: now,
      };
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM records WHERE type='qbankMemberships' AND qbank_id=? AND json_extract(payload,'$.userId')=?",
        ).bind(bank.id, profile.uid),
        env.DB.prepare(
          "INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES('qbankMemberships',?,?,?,?,?)",
        ).bind(
          membership.id,
          bank.id,
          user.uid,
          JSON.stringify(membership),
          now,
        ),
        auditStatement(user, 'reviewer_added', bank.id, null, {
          userId: profile.uid,
        }),
      ]);
      return json({ membership });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    if (error instanceof Response) return error;
    if (activeImportContext) {
      const message =
        error instanceof ValidationError
          ? error.message
          : 'The import could not be completed.';
      try {
        await env.DB.batch(
          importMonitoringStatements(activeImportContext, {
            status: 'failed',
            errorCode: 'IMPORT_PROCESSING_FAILED',
            errorMessage: message,
          }),
        );
      } catch {
        console.error(
          JSON.stringify({ event: 'json_import_monitoring_failed' }),
        );
      }
    }
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    if (error instanceof ValidationError) return json({ error: error.message }, 400);
    throw error;
  }
}
