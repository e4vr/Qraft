import { normalizeImportedQuestion, parseQuestionImportReport, type QuestionImportReport, type SkippedImportedQuestion } from '@/lib/question-import';
import { duplicateFingerprint } from '@/features/duplicates/domain/duplicate-detection';
import { withLocalImportMatches, type ImportMatch } from './local-import-duplicates';
import { exactImportIdentity } from './exact-import-duplicates';
import type { QuestionProposalPayload } from '@/lib/medguard-types';
import { validImageAttachments } from '@/features/media/domain/image-attachments';
import type { ImportClassificationCatalog } from './import-classifications';

export interface ImportRow {
  id: string;
  position: number;
  question: QuestionProposalPayload;
  original?: QuestionProposalPayload;
  raw?: unknown;
  pendingRaw?: string;
  repairError?: string;
  unresolvedMedia?: Array<'images' | 'explanationImages'>;
  excluded: boolean;
  reviewed: boolean;
  notes: string;
  submitted?: boolean;
  frozen?: boolean;
}
export type ImportCheck = { fingerprint: string; matches: ImportMatch[] };
export type ImportDecision = { fingerprint: string; candidates: string[] };
export interface ImportSubmission {
  sessionId: string;
  batches: Array<{ requestId: string; rowIds: string[]; questions: QuestionProposalPayload[]; choices: Array<{ sourceFingerprint: string; candidateFingerprints: string[] } | null> }>;
  completed: number;
  successful: number;
}
export interface ImportDraft {
  version: 1;
  storageRevision?: string;
  accountId?: string;
  safetyVersion?: 2;
  bankId: string;
  fileName: string;
  fileHash: string;
  rawFile: string;
  rows: ImportRow[];
  skipped: SkippedImportedQuestion[];
  repaired: boolean;
  checks: Record<string, ImportCheck>;
  decisions: Record<string, ImportDecision>;
  media: Record<string, Blob>;
  submission?: ImportSubmission;
  resume?: Pick<ImportSubmission, 'sessionId' | 'successful'> & { savedBatches: ImportSubmission['batches']; confirmedCount?: number };
  questionLimit?: number;
  classificationCatalog?: ImportClassificationCatalog;
}

export function emptyImportQuestion(sourceFile = ''): QuestionProposalPayload {
  return { stem: '', options: ['', '', '', ''], answer: -1, specialty: 'General', topic: 'Unclassified', explanation: '', sourceFile, sourceReference: sourceFile, images: [], explanationImages: [] };
}

function editableQuestion(value: unknown, sourceFile: string): QuestionProposalPayload {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const q = emptyImportQuestion(sourceFile);
  const text = (v: unknown, fallback: string) => typeof v === 'string' ? v : fallback;
  q.stem = text(item.stem ?? item.question ?? item.questionText, '');
  const choices = item.options ?? item.choices;
  const values = Array.isArray(choices) ? choices : choices && typeof choices === 'object' ? Object.keys(choices).sort().map(key => (choices as Record<string, unknown>)[key]) : [];
  q.options = values.length ? values.map(value => typeof value === 'string' ? value : value && typeof value === 'object' ? text((value as Record<string, unknown>).text, '') : '') : ['', ''];
  q.sourceFile = text(item.sourceFile ?? item.source_file, sourceFile);
  q.specialty = text(item.specialty, q.specialty);
  q.topic = text(item.topic, q.topic);
  q.explanation = text(item.explanation, '');
  if (typeof item.originalQuestionNumber === 'string' || typeof item.originalQuestionNumber === 'number') q.originalQuestionNumber = String(item.originalQuestionNumber);
  if (item.sourcePage !== undefined) q.sourcePage = Number(item.sourcePage);
  try {
    // Recover independently valid choices, answer and media without manufacturing a saved stem/source.
    const recovered = normalizeImportedQuestion({ ...item, images: undefined, explanationImages: undefined, stem: q.stem || 'Temporary validation text', sourceFile: q.sourceFile || 'Temporary validation source', sourcePage: undefined }, 0);
    q.options = recovered.options; q.answer = recovered.answer; q.images = recovered.images; q.explanationImages = recovered.explanationImages;
  } catch { /* Ambiguous answers remain unselected for explicit correction. */ }
  for (const section of ['images', 'explanationImages'] as const) {
    try { q[section] = recoverMedia(item, section); } catch { /* The unresolved field remains an explicit blocker. */ }
  }
  return q;
}

function recoverMedia(item: Record<string, unknown>, section: 'images' | 'explanationImages') {
  return normalizeImportedQuestion({ stem: 'Temporary validation text', sourceFile: 'Temporary validation source', options: ['First', 'Second'], correctAnswer: 'A', [section]: item[section] }, 0)[section] ?? [];
}
export function unresolvedImportMedia(row: ImportRow) {
  if (row.unresolvedMedia) return row.unresolvedMedia;
  const raw = row.raw && typeof row.raw === 'object' ? row.raw as Record<string, unknown> : {};
  return (['images', 'explanationImages'] as const).filter(section => { try { recoverMedia(raw, section); return false; } catch { return true; } });
}
export function localImportBlob(media: Record<string, Blob>, id: string): Blob | undefined {
  return Object.hasOwn(media, id) && media[id] instanceof Blob ? media[id] : undefined;
}
export const MAX_LOCAL_MEDIA_BYTES = 100 * 1024 * 1024;
export function boundedImportHistory(history: ImportDraft[], current: ImportDraft): ImportDraft[] {
  const blobs = new Set<Blob>(), files = new Set<string>(); let bytes = 0;
  const cost = (draft: ImportDraft) => {
    for (const blob of Object.values(draft.media)) if (blob instanceof Blob && !blobs.has(blob)) { blobs.add(blob); bytes += blob.size; }
    if (!files.has(draft.rawFile)) { files.add(draft.rawFile); bytes += draft.rawFile.length * 2; }
  };
  cost(current); const retained: ImportDraft[] = [];
  for (const previous of history.slice(-20).reverse()) { cost(previous); if (bytes > 160 * 1024 * 1024) break; retained.unshift(previous); }
  return retained;
}
export function pruneImportMedia(draft: ImportDraft): ImportDraft {
  const ids = new Set(draft.rows.flatMap(row => [...row.question.images, ...(row.question.explanationImages ?? [])].filter(image => image.url.startsWith('local-import:')).map(image => image.id)));
  for (const batch of draft.submission?.batches ?? draft.resume?.savedBatches ?? []) for (const question of batch.questions) for (const image of [...question.images, ...(question.explanationImages ?? [])]) if (image.url.startsWith('local-import:')) ids.add(image.id);
  const media = Object.fromEntries([...ids].flatMap(id => { const blob = localImportBlob(draft.media, id); return blob ? [[id, blob] as const] : []; }));
  return Object.keys(media).length === Object.keys(draft.media).length ? draft : { ...draft, media };
}

export function draftFromReport(report: QuestionImportReport, bankId: string, fileName: string, fileHash: string, rawFile: string): ImportDraft {
  const entries = report.entries ?? report.questions.map((question, index) => ({ inputIndex: index + 1, value: question, question, error: undefined }));
  return { version: 1, safetyVersion: 2, bankId, fileName, fileHash, rawFile, repaired: report.repaired,
    rows: entries.map(entry => ({ id: crypto.randomUUID(), position: entry.inputIndex, question: entry.question ?? editableQuestion(entry.value, report.sourceFile), original: entry.question, raw: entry.value, repairError: entry.error, excluded: false, reviewed: false, notes: '' })),
    // Invalid rows remain editable; only extraction-declared skipped items stay here.
    skipped: report.skipped.filter(item => item.inputIndex === undefined), checks: {}, decisions: {}, media: {} };
}

export function validateImportRow(row: ImportRow): { question?: QuestionProposalPayload; error?: string } {
  if (row.pendingRaw !== undefined) return { error: 'Apply or discard the pending Original JSON edits before checking this question.' };
  if (row.repairError) return { error: row.repairError };
  const missing = unresolvedImportMedia(row);
  if (missing.length) return { error: `${missing.join(', ')}: original attachments need repair or explicit removal.` };
  try {
    const q = row.question;
    if (q.images.length > 10 || (q.explanationImages?.length ?? 0) > 10) return { error: 'images (maximum 10 per section)' };
    const attachments = (images: QuestionProposalPayload['images']) => images.map(image => image.url.startsWith('local-import:') ? { ...image, url: 'https://local-preview.invalid/image' } : image);
    if (!validImageAttachments(attachments(q.images)) || !validImageAttachments(attachments(q.explanationImages ?? []))) return { error: 'images (check attachment IDs, links, names and captions)' };
    const clean = normalizeImportedQuestion({ ...q, images: q.images.filter(image => !image.url.startsWith('local-import:')), explanationImages: (q.explanationImages ?? []).filter(image => !image.url.startsWith('local-import:')) }, row.position - 1);
    return { question: { ...clean, images: q.images, explanationImages: q.explanationImages ?? [] } };
  } catch (error) { return { error: error instanceof Error ? error.message.replace(/^Question \d+:\s*/, '') : 'Invalid question.' }; }
}

export function importRowFingerprint(row: ImportRow) {
  // Entire payload: edits to explanations/sources also invalidate previously approved decisions.
  return JSON.stringify(row.question);
}

export function workspaceMatches(draft: ImportDraft): Record<string, ImportMatch[]> {
  const active = draft.rows.filter(row => !row.excluded);
  const questions = active.map(row => row.question);
  const matches = withLocalImportMatches(questions, active.map(row => draft.checks[row.id]?.fingerprint === importRowFingerprint(row) ? draft.checks[row.id].matches : []));
  return Object.fromEntries(active.map((row, i) => [row.id, matches[i]]));
}

export function decisionIsCurrent(row: ImportRow, matches: ImportMatch[], decision?: ImportDecision) {
  return !!decision && decision.fingerprint === importRowFingerprint(row) && decision.candidates.length === matches.length && matches.every(match => decision.candidates.includes(match.candidateFingerprint));
}

export function workspaceReadiness(draft: ImportDraft, localMatches?: Record<string, ImportMatch[]>, cached?: { fingerprint: (row: ImportRow) => string; validation: (row: ImportRow) => ReturnType<typeof validateImportRow> }) {
  const active = draft.rows.filter(row => !row.excluded);
  const fingerprint = cached?.fingerprint ?? importRowFingerprint;
  const matches = localMatches ? Object.fromEntries(active.map(row => [row.id, [...(draft.checks[row.id]?.fingerprint === fingerprint(row) ? draft.checks[row.id].matches.filter(match => match.draftIndex === undefined) : []), ...(localMatches[row.id] ?? [])]])) : workspaceMatches(draft);
  const invalid = active.filter(row => (cached?.validation ?? validateImportRow)(row).error);
  const unchecked = active.filter(row => draft.checks[row.id]?.fingerprint !== fingerprint(row));
  const unresolved = active.filter(row => {
    const found = matches[row.id] ?? [], decision = draft.decisions[row.id];
    return found.length && !(decision && decision.fingerprint === fingerprint(row) && decision.candidates.length === found.length && found.every(match => decision.candidates.includes(match.candidateFingerprint)));
  });
  const reserved = draft.resume?.savedBatches.reduce((total, batch) => total + batch.questions.length, 0) ?? 0;
  const recoveredPending = !!draft.resume && (draft.resume.confirmedCount ?? draft.resume.savedBatches.length) < draft.resume.savedBatches.length;
  const limitExceeded = draft.questionLimit !== undefined && active.length + reserved > draft.questionLimit;
  return { active, invalid, unchecked, unresolved, matches, limitExceeded, ready: (active.length > 0 || recoveredPending) && !invalid.length && !unchecked.length && !unresolved.length && !limitExceeded };
}

export function moveImportOption(q: QuestionProposalPayload, index: number, target: number) {
  const options = [...q.options];
  const [moved] = options.splice(index, 1);
  options.splice(target, 0, moved);
  let answer = q.answer;
  if (answer === index) answer = target;
  else if (index < target && answer > index && answer <= target) answer--;
  else if (target < index && answer >= target && answer < index) answer++;
  return { ...q, options, answer };
}

export function skipWorkspaceExact(draft: ImportDraft, matches = workspaceMatches(draft)): ImportDraft {
  const kept = new Set<string>();
  return { ...draft, rows: draft.rows.map(row => {
    if (row.excluded || validateImportRow(row).error) return row;
    const identity = exactImportIdentity(row.question);
    if (!identity) return row;
    const bankMatch = (matches[row.id] ?? []).some(match => match.draftIndex === undefined && match.payload && exactImportIdentity(match.payload) === identity);
    if (bankMatch || kept.has(identity)) return { ...row, excluded: true };
    kept.add(identity); return row;
  }) };
}

export function exportImportDraft(draft: ImportDraft) {
  return JSON.stringify({ format: 'qraft-question-bank-v1', questions: draft.rows.filter(row => !row.excluded).map(row => ({ ...row.question, answer: undefined, correctAnswer: row.question.answer < 0 ? '' : String.fromCharCode(65 + row.question.answer), sourceReference: undefined,
    images: row.question.images.filter(image => !image.url.startsWith('local-import:')), explanationImages: (row.question.explanationImages ?? []).filter(image => !image.url.startsWith('local-import:')) })), skipped: draft.skipped }, null, 2);
}

export function repairImportRow(row: ImportRow, raw: string, fallback = ''): ImportRow {
  const report = parseQuestionImportReport(raw, fallback);
  if (report.questions.length !== 1 || report.skipped.length) throw new Error(report.skipped[0]?.reason ?? 'Provide exactly one complete question.');
  return { ...row, question: report.questions[0], raw: report.entries?.[0].value, pendingRaw: undefined, repairError: undefined, unresolvedMedia: [], reviewed: false };
}

export function makeImportSubmission(draft: ImportDraft, readiness = workspaceReadiness(draft)): ImportSubmission {
  if (readiness.limitExceeded) throw new Error(`Select at most ${draft.questionLimit} questions for this import, including any confirmed batches.`);
  if (!readiness.ready) throw new Error('Correct errors, finish Check duplication, and resolve every match before submitting.');
  const batches: ImportSubmission['batches'] = [];
  let bytes = 0;
  for (const row of readiness.active) {
    const question = validateImportRow(row).question!;
    const size = new TextEncoder().encode(JSON.stringify(question)).byteLength;
    if (size > 850_000) throw new Error(`Question ${row.position} is too large. Shorten it before submitting.`);
    if (!batches.length || batches[batches.length - 1].questions.length >= 25 || bytes + size > 850_000) { batches.push({ requestId: crypto.randomUUID(), rowIds: [], questions: [], choices: [] }); bytes = 0; }
    const batch = batches[batches.length - 1];
    batch.rowIds.push(row.id); batch.questions.push(question); bytes += size;
    const matches = readiness.matches[row.id] ?? [];
    batch.choices.push(matches.length ? { sourceFingerprint: duplicateFingerprint(question), candidateFingerprints: matches.map(match => match.candidateFingerprint) } : null);
  }
  return { sessionId: draft.resume?.sessionId ?? crypto.randomUUID(), batches: [...(draft.resume?.savedBatches ?? []), ...batches], completed: draft.resume?.confirmedCount ?? draft.resume?.savedBatches.length ?? 0, successful: draft.resume?.successful ?? 0 };
}

// Only immutable editor objects use this cache. The standalone validators stay
// uncached for API callers and mutable test fixtures.
export function createImportAnalysisCache() {
  const fingerprints = new WeakMap<QuestionProposalPayload, string>();
  const comparisons = new WeakMap<QuestionProposalPayload, string>();
  const validations = new WeakMap<ImportRow, ReturnType<typeof validateImportRow>>();
  return {
    comparisonKey(row: ImportRow) { let value = comparisons.get(row.question); if (value === undefined) { const q = row.question; value = JSON.stringify([q.stem, q.options, q.answer, q.specialty, q.topic]); comparisons.set(q, value); } return value; },
    fingerprint(row: ImportRow) { let value = fingerprints.get(row.question); if (value === undefined) { value = importRowFingerprint(row); fingerprints.set(row.question, value); } return value; },
    validation(row: ImportRow) { let value = validations.get(row); if (!value) { value = validateImportRow(row); validations.set(row, value); } return value; },
  };
}

export function unlockImportSubmission(draft: ImportDraft): ImportDraft {
  if (!draft.submission) return draft;
  const savedBatches = draft.submission.batches.slice(0, draft.submission.completed);
  const ids = new Set(savedBatches.flatMap(batch => batch.rowIds));
  const snapshots = new Map(draft.submission.batches.flatMap(batch => batch.rowIds.map((id, i) => [id, batch.questions[i]] as const)));
  return { ...draft, rows: draft.rows.map(row => ({ ...row, question: snapshots.get(row.id) ?? row.question, frozen: undefined, ...(ids.has(row.id) ? { submitted: true, excluded: true } : { submitted: false, ...(row.frozen ? { excluded: false } : {}) }) })), submission: undefined,
    resume: { sessionId: draft.submission.sessionId, successful: draft.submission.successful, savedBatches }, checks: {}, decisions: {} };
}
