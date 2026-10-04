import { env } from 'cloudflare:workers';
import { classificationCleanupStatements } from '@/features/qbanks/server/classification-cleanup';
import type {
  AppUser,
  Question,
  QuestionProposal,
  QuestionProposalPayload,
} from '@/lib/medguard-types';
import {
  prepareDuplicateCandidate,
  detectDuplicateReview,
  duplicateFingerprint,
  normalizeDuplicateText,
  type PreparedDuplicateCandidate,
} from '@/features/duplicates/domain/duplicate-detection';
import {
  canAccessBank,
  canEditBank,
} from '@/features/access/domain/access-policy';
import { bankAccessState } from '@/lib/qbank-access-repository';
import { json } from '@/server/http/response';
import { getPlanLimits } from '@/features/subscriptions/domain/plan-config';
import { readQuestionSource } from '@/features/qbanks/domain/question-source';
import { ImportDuplicateIndex } from '@/features/imports/domain/import-duplicate-index';
import { exactImportIdentity } from '@/features/imports/domain/exact-import-duplicates';
import { cachedImportSearch, importSearchKey, importSearchRevision } from './import-search';
export { ImportDuplicateIndex };

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
export function detectImportDuplication(
  incoming: QuestionProposalPayload,
  bankId: string,
  candidates: PreparedDuplicateCandidate[],
  sourceEntityId = '',
  index = new ImportDuplicateIndex(candidates),
) {
  const normalized = normalizeDuplicateText(incoming.stem);
  const sameText = index.exact(bankId, normalized);
  if (!sameText.length)
    return detectDuplicateReview({
      incoming,
      qbankId: bankId,
      sourceEntityId,
      candidates: index.near(bankId, normalized),
    });
  // Show full-content matches before stem-only matches in the bounded preview.
  const identity = exactImportIdentity(incoming);
  const matches = [...sameText].sort((left, right) =>
    Number(exactImportIdentity(right.payload) === identity) - Number(exactImportIdentity(left.payload) === identity)
  ).map((c) => ({
    entityId: c.entityId,
    entityType: c.entityType,
    questionId: c.questionId,
    candidateFingerprint: c.prepared.fingerprint,
    classification: 'exact' as const,
    similarity: 100,
    detectedAt: new Date().toISOString(),
    signals: {
      stem: 100,
      optionsSet: 0,
      optionsOrdered: 0,
      correctAnswer: 0,
      specialty: 0,
      topic: 0,
    },
  }));
  return {
    status: 'flagged' as const,
    detectorVersion: 'import-stem-v1',
    sourceFingerprint: duplicateFingerprint(incoming),
    detectedAt: new Date().toISOString(),
    candidates: [...matches].slice(0, 3),
  };
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
  const byIdentity = new Map(candidates.map(candidate => [`${candidate.entityType}:${candidate.entityId}`, candidate]));
  return json(
    {
      matches: questions.map((payload) => {
        const review = detectImportDuplication(payload, bankId, candidates, '', index);
        return (review?.candidates ?? []).map((finding) => {
          const candidate = byIdentity.get(`${finding.entityType}:${finding.entityId}`)!;
          return {
            ...finding,
            payload: {
              ...candidate.fullPayload,
              sourceReference: readQuestionSource(candidate.fullPayload).sourceReference,
            },
            canDelete:
              canEditBank(user, bank, state.memberships) ||
              (candidate.entityType === 'pending_proposal' &&
                candidate.ownerId === user.uid),
          };
        });
      }),
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
