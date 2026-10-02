import { env } from 'cloudflare:workers';
import { importKeyStatement } from '@/features/imports/server/import-search';
import { json } from '@/server/http/response';
import { optionLabel, type AppUser, type Question } from '@/lib/medguard-types';
import { readQuestionSource, validateQuestionSource } from '@/features/qbanks/domain/question-source';
import { validOptionalExplanationImages } from '@/features/media/domain/image-attachments';

// An explicit administrative edit path. Creation and user contributions still
// use their existing review workflow; pending proposals are never touched here.
export async function directQuestionEdit(user: AppUser, input: Record<string, unknown>) {
  if (user.role !== 'super_admin' || !user.mfaEnrolled || !user.mfaVerified)
    return json({ error: 'Verified Superadmin access required.' }, 403);
  const payload = input.payload as Record<string, unknown> | undefined;
  if (typeof input.qbankId !== 'string' || typeof input.questionId !== 'string' ||
      !Number.isInteger(input.baseRevision) || !payload || Array.isArray(payload) ||
      typeof payload.stem !== 'string' || !payload.stem.trim() ||
      !Array.isArray(payload.options) || payload.options.length < 2 || payload.options.length > 10 ||
      !payload.options.every(option => typeof option === 'string' && option.trim()) ||
      !Number.isInteger(payload.answer) || (payload.answer as number) < 0 || (payload.answer as number) >= payload.options.length ||
      typeof payload.explanation !== 'string' ||
      !validOptionalExplanationImages(payload.explanationImages) ||
      !Array.isArray(payload.images) ||
      !payload.images.every(image => image && typeof image === 'object' &&
        ['id', 'url', 'name', 'caption'].every(key => typeof image[key] === 'string')))
    return json({ error: 'Invalid question edit.' }, 400);
  let source: ReturnType<typeof validateQuestionSource>;
  try { source = validateQuestionSource(payload); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid source.' }, 400); }
  const row = await env.DB.prepare("SELECT payload FROM records WHERE type='sharedQuestions' AND id=? AND qbank_id=?")
    .bind(input.questionId, input.qbankId).first<{ payload: string }>();
  if (!row) return json({ error: 'Question not found in this QBank.' }, 404);
  const existing = JSON.parse(row.payload) as Question;
  source = validateQuestionSource({ ...payload, originalQuestionNumber: payload.originalQuestionNumber ?? readQuestionSource(existing).originalQuestionNumber });
  const next: Question = {
    ...existing,
    stem: payload.stem.trim(),
    options: (payload.options as string[]).map(option => option.trim()),
    answer: payload.answer as number,
    answerLetter: optionLabel(payload.answer as number),
    explanation: payload.explanation.trim(),
    explanationImages: (payload.explanationImages as Question['explanationImages']) ?? existing.explanationImages ?? [],
    ...source,
    sourcePage: source.sourcePage,
    images: payload.images as Question['images'],
    revision: existing.revision + 1,
  };
  const fields = ['stem', 'options', 'answer', 'explanation', 'explanationImages', 'sourceFile', 'sourcePage', 'originalQuestionNumber', 'sourceReference', 'images'] as const;
  if (fields.every(field => JSON.stringify(field === 'explanationImages' ? existing[field] ?? [] : existing[field]) === JSON.stringify(next[field])))
    return json({ ok: true, question: existing, unchanged: true }, 200, { 'x-qraft-unchanged': '1' });
  if (existing.revision !== input.baseRevision)
    return json({ error: 'This question changed. Refresh it before saving; your draft has been kept.' }, 409);
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const audit = {
    id: auditId, action: 'superadmin_question_edited', entityType: 'question', entityId: existing.id,
    actorId: user.uid, actorName: user.displayName, createdAt: now,
    detail: JSON.stringify({ qbankId: input.qbankId, previousRevision: existing.revision, revision: next.revision, bypassReview: true }),
  };
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE records SET payload=?,updated_at=? WHERE type='sharedQuestions' AND id=? AND qbank_id=? AND payload=?")
      .bind(JSON.stringify(next), now, existing.id, input.qbankId, row.payload),
    // changes() refers to the immediately preceding update in this transaction.
    // A losing concurrent edit must not create a successful audit entry.
    env.DB.prepare("INSERT INTO records(type,id,owner_id,payload,updated_at) SELECT 'auditLog',?,?,?,? WHERE changes()=1")
      .bind(auditId, user.uid, JSON.stringify(audit), now),
    await importKeyStatement([{ collection: 'sharedQuestions', id: next.id, payload: JSON.stringify(next) }]),
  ]);
  // D1 metadata includes changes made by database triggers as well.
  if (results[0].meta.changes < 1)
    return json({ error: 'This question changed. Refresh it before saving; your draft has been kept.' }, 409);
  return json({ ok: true, question: next });
}
