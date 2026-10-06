import { env } from 'cloudflare:workers';
import { classificationCleanupStatements } from '@/features/qbanks/server/classification-cleanup';
import type {
  AppUser,
  DuplicateCandidate,
  QBank,
  QBankMembership,
  QBankSpecialty,
  QBankTopic,
  Question,
  QuestionProposal,
  QuestionProposalPayload,
} from '@/lib/medguard-types';
import {
  prepareDuplicateCandidate,
  duplicateFingerprint,
  normalizeDuplicateText,
  type PreparedDuplicateCandidate,
} from '@/features/duplicates/domain/duplicate-detection';
import {
  canAccessBank,
  canEditBank,
  canReviewBank,
} from '@/features/access/domain/access-policy';
import { bankAccessState } from '@/lib/qbank-access-repository';
import { json } from '@/server/http/response';
import { getPlanLimits } from '@/features/subscriptions/domain/plan-config';
import { readQuestionSource } from '@/features/qbanks/domain/question-source';
import { ImportDuplicateIndex } from '@/features/imports/domain/import-duplicate-index';
import { exactImportIdentity } from '@/features/imports/domain/exact-import-duplicates';
import { importBankClassifications } from '@/features/imports/domain/import-classifications';
import { cachedImportSearch, importSearchKey, importSearchRevision } from './import-search';
export { ImportDuplicateIndex };
import { detectImportDuplication } from '../domain/detect-import-duplication';
export { detectImportDuplication };

export async function importLimits(user: AppUser) {
  const policy = await env.DB.prepare(
    'SELECT questions_per_import,imports_per_day FROM import_policies WHERE user_id=?',
  )
    .bind(user.uid)
    .first<{ questions_per_import: number; imports_per_day: number }>();
  const defaults = await env.DB.prepare(
    'SELECT questions_per_import,imports_per_day FROM import_defaults WHERE id=1',
  ).first<{
    questions_per_import: number | null;
    imports_per_day: number | null;
  }>();
  const limits =
    user.planLimits ?? getPlanLimits(user.effectivePlan ?? user.tier);
  return {
    questionsPerImport:
      policy?.questions_per_import ??
      defaults?.questions_per_import ??
      limits.jsonQuestionsPerImport,
    importsPerDay:
      policy?.imports_per_day ??
      defaults?.imports_per_day ??
      limits.jsonImportDailyLimit,
  };
}
type ImportCandidate = PreparedDuplicateCandidate & { fullPayload?: QuestionProposalPayload | Question; ownerId?: string };

export async function publicImportMatches(user: AppUser, bank: QBank, memberships: QBankMembership[], findings: DuplicateCandidate[], candidates: ImportCandidate[]) {
  const byIdentity = new Map(candidates.map(c => [`${c.entityType}:${c.entityId}`, c]));
  const reviewer = canReviewBank(user, bank, memberships);
  return Promise.all(findings.map(async finding => {
    const candidate = byIdentity.get(`${finding.entityType}:${finding.entityId}`);
    if (!candidate) throw new Error('Duplicate candidate changed. Retry the scan.');
    if (candidate.entityType === 'pending_proposal' && candidate.ownerId !== user.uid && !reviewer) {
      // Domain-separated HMAC prevents guessed answer keys or known legacy IDs
      // from revealing private content through its deterministic fingerprint.
      const secret = env.BACKUP_SIGNING_KEY?.trim();
      if (!secret || secret.length < 32) throw json({ error: 'Private duplicate review is temporarily unavailable. Your draft is preserved.', code: 'IMPORT_SIGNING_KEY_UNAVAILABLE' }, 503);
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const opaque = async (value: unknown) => [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(['qraft-private-import-v1', value]))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      return { entityId: `restricted:${await opaque([user.uid, bank.id, candidate.entityId])}`, entityType: 'pending_proposal' as const,
        candidateFingerprint: `restricted:${await opaque([user.uid, bank.id, candidate.entityId, candidate.fullPayload ?? candidate.payload])}`,
        classification: 'possible' as const, similarity: 0, detectedAt: finding.detectedAt,
        signals: { stem: 0, optionsSet: 0, optionsOrdered: 0, correctAnswer: 0, specialty: 0, topic: 0 }, restricted: true, canDelete: false };
    }
    const payload = (candidate.fullPayload ?? candidate.payload) as QuestionProposalPayload;
    return { ...finding, payload: { ...payload, sourceReference: readQuestionSource(payload).sourceReference },
      canDelete: canEditBank(user, bank, memberships) || candidate.ownerId === user.uid };
  }));
}

export async function importCandidates(
  bankId: string,
  questions: QuestionProposalPayload[],
  actorId = '',
  revision?: number,
) {
  const unique = new Map<
    string,
    { id: string; type: string; payload: string }
  >();
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const stems = [
    ...new Set(questions.map((q) => normalizeDuplicateText(q.stem))),
  ];
  const corpusRevision = revision ?? await importSearchRevision();
  const searches: Promise<{ id: string; type: string; payload: string }[]>[] = [];
  const keys = await Promise.all(questions.map(async question => ({
    stem: await importSearchKey(normalizeDuplicateText(question.stem)),
    content: exactImportIdentity(question) ? await importSearchKey(exactImportIdentity(question)!) : null,
  })));
  const exactRows = await env.DB.batch<{ id: string; type: string; payload: string }>([
    env.DB.prepare(`SELECT r.id,r.type,r.payload
    FROM import_question_keys k JOIN records r ON r.type=k.record_type AND r.id=k.record_id
    WHERE k.qbank_id=? AND k.content_key IN (SELECT json_extract(value,'$.content') FROM json_each(?))
      AND (r.type='sharedQuestions' OR json_extract(r.payload,'$.status')='pending') LIMIT 1000`)
      .bind(bankId, JSON.stringify(keys)),
    env.DB.prepare(`SELECT r.id,r.type,r.payload
    FROM import_question_keys k JOIN records r ON r.type=k.record_type AND r.id=k.record_id
    WHERE k.qbank_id=? AND k.stem_key IN (SELECT json_extract(value,'$.stem') FROM json_each(?))
      AND (r.type='sharedQuestions' OR json_extract(r.payload,'$.status')='pending') LIMIT 1000`)
      .bind(bankId, JSON.stringify(keys)),
  ]);
  for (const result of exactRows) for (const row of result.results) unique.set(`${row.type}:${row.id}`, row);
  // One indexed full-text query per 25-question batch, with a bounded result.
  for (let offset = 0; offset < stems.length; offset += 25) {
    const phrases = stems.slice(offset, offset + 25).flatMap((stem) => {
      const words = stem.match(/[\p{L}\p{N}]+/gu) ?? [];
      return words.length
        ? [quote(words.join(' ')), quote(words.slice(0, 6).join(' ')), quote(words.slice(-6).join(' '))]
        : [];
    });
    if (!phrases.length) continue;
    const query = `bank:${quote(bankId)} AND stem:(${[...new Set(phrases)].join(' OR ')})`;
    searches.push(cachedImportSearch(actorId, bankId, query, corpusRevision));
  }
  if (searches.length) {
    const results = await Promise.all(searches);
    for (const result of results) for (const row of result) unique.set(`${row.type}:${row.id}`, row);
  }
  return [...unique.values()].map((row) => {
    const parsed = JSON.parse(row.payload) as Question & QuestionProposal;
    return {
      ...prepareDuplicateCandidate({
        entityId: row.id,
        entityType:
          row.type === 'sharedQuestions'
            ? 'approved_question'
            : 'pending_proposal',
        qbankId: bankId,
        questionId:
          row.type === 'sharedQuestions' ? parsed.questionId : undefined,
        payload: row.type === 'sharedQuestions' ? parsed : parsed.payload,
      }),
      fullPayload: row.type === 'sharedQuestions' ? parsed : parsed.payload,
      ownerId: parsed.proposedById,
    };
  });
}
export async function importPreview(
  user: AppUser,
  questions: QuestionProposalPayload[],
  bankId: string,
  policy?: Record<string, unknown>,
) {
  const state = await bankAccessState(bankId),
    bank = state.qbanks.find((b) => b.id === bankId);
  if (!bank || !canAccessBank(user, bank, state.memberships))
    return json({ error: 'QBank access required.' }, 403);
  if (questions.length > 100)
    return json({ error: 'Review at most 100 questions per request.' }, 400);
  let revision = await importSearchRevision();
  let candidates = await importCandidates(bankId, questions, user.uid, revision);
  const currentRevision = await importSearchRevision();
  if (currentRevision !== revision) {
    revision = currentRevision;
    candidates = await importCandidates(bankId, questions, user.uid, revision);
  }
  const index = new ImportDuplicateIndex(candidates);
  // Refresh only the selected bank's published taxonomy with the first explicit
  // Check request. Typing never calls this endpoint or loads question contents.
  const classificationRows = policy ? (await env.DB.prepare("SELECT type,payload FROM records WHERE qbank_id=? AND type IN ('qbankSpecialties','qbankTopics') ORDER BY type,id LIMIT 20000").bind(bank.id).all<{ type: string; payload: string }>()).results : undefined;
  const classifications = classificationRows ? importBankClassifications(bank.id,
    classificationRows.filter(row => row.type === 'qbankSpecialties').map(row => JSON.parse(row.payload) as QBankSpecialty),
    classificationRows.filter(row => row.type === 'qbankTopics').map(row => JSON.parse(row.payload) as QBankTopic)) : undefined;
  return json(
    {
      userId: user.uid,
      bankName: bank.name,
      ...policy,
      ...(classifications ? { classifications } : {}),
      matches: await Promise.all(questions.map(async (payload) => {
        const review = detectImportDuplication(payload, bankId, candidates, '', index);
        return publicImportMatches(user, bank, state.memberships, review?.candidates ?? [], candidates);
      })),
    },
    200,
    { 'x-qraft-unchanged': '1' },
  );
}
export async function deleteImportDuplicate(
  user: AppUser,
  input: Record<string, unknown>,
) {
  const id = typeof input.entityId === 'string' ? input.entityId : '',
    type =
      input.entityType === 'approved_question'
        ? 'sharedQuestions'
        : 'questionProposals';
  const row = await env.DB.prepare(
    'SELECT payload,qbank_id,owner_id FROM records WHERE type=? AND id=?',
  )
    .bind(type, id)
    .first<{ payload: string; qbank_id: string; owner_id: string }>();
  if (!row || row.qbank_id !== input.qbankId)
    return json({ error: 'Question no longer exists.' }, 409);
  const state = await bankAccessState(row.qbank_id),
    bank = state.qbanks.find((b) => b.id === row.qbank_id);
  if (
    !bank ||
    !canAccessBank(user, bank, state.memberships) ||
    !(
      canEditBank(user, bank, state.memberships) ||
      (type === 'questionProposals' && row.owner_id === user.uid)
    )
  )
    return json({ error: 'You cannot delete this question.' }, 403);
  const parsed = JSON.parse(row.payload),
    payload = type === 'sharedQuestions' ? parsed : parsed.payload;
  if (
    duplicateFingerprint(payload) !== input.candidateFingerprint ||
    (type === 'questionProposals' && parsed.status !== 'pending')
  )
    return json(
      { error: 'The question changed. Review it again before deleting.' },
      409,
    );
  const now = new Date().toISOString(),
    auditId = crypto.randomUUID();
  const result = await env.DB.batch([
    // Audit only the exact version that is deleted, in the same transaction.
    env.DB.prepare(
      "INSERT INTO records(type,id,owner_id,payload,updated_at) SELECT 'auditLog',?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE type=? AND id=? AND payload=?)",
    ).bind(
      auditId,
      user.uid,
      JSON.stringify({
        id: auditId,
        action: 'import_duplicate_deleted',
        actorId: user.uid,
        actorName: user.displayName,
        entityId: id,
        previous: { entityType: input.entityType },
        createdAt: now,
        status: 'success',
      }),
      now,
      type,
      id,
      row.payload,
    ),
    env.DB.prepare(
      'DELETE FROM records WHERE type=? AND id=? AND payload=?',
    ).bind(type, id, row.payload),
    ...(type === 'sharedQuestions' ? classificationCleanupStatements(env.DB, [row.qbank_id], now) : []),
  ]);
  return result[1].meta.changes
    ? json({ ok: true })
    : json({ error: 'The question changed. Review it again.' }, 409);
}
