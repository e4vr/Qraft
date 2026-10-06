import { normalizeImportedQuestion, parseQuestionImportReport, type QuestionImportReport, type SkippedImportedQuestion } from '@/lib/question-import';
import { duplicateFingerprint } from '@/features/duplicates/domain/duplicate-detection';
import { withLocalImportMatches, type ImportMatch } from './local-import-duplicates';
import { exactImportIdentity } from './exact-import-duplicates';
import type { QuestionProposalPayload } from '@/lib/medguard-types';
import { validImageAttachments } from '@/features/media/domain/image-attachments';

export interface ImportRow {
  id: string;
  position: number;
  question: QuestionProposalPayload;
  original?: QuestionProposalPayload;
  raw?: unknown;
  pendingRaw?: string;
  repairError?: string;
  excluded: boolean;
  reviewed: boolean;
  notes: string;
  submitted?: boolean;
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
  resume?: Pick<ImportSubmission, 'sessionId' | 'successful'> & { savedBatches: ImportSubmission['batches'] };
  questionLimit?: number;
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
    const recovered = normalizeImportedQuestion({ ...item, stem: q.stem || 'Temporary validation text', sourceFile: q.sourceFile || 'Temporary validation source', sourcePage: undefined }, 0);
    q.options = recovered.options; q.answer = recovered.answer; q.images = recovered.images; q.explanationImages = recovered.explanationImages;
  } catch { /* Ambiguous answers remain unselected for explicit correction. */ }
  try {
    const media = normalizeImportedQuestion({ ...item, stem: 'Temporary validation text', sourceFile: 'Temporary validation source', sourcePage: undefined, options: ['Temporary first', 'Temporary second'], correctAnswer: 'A', correct_answer: undefined, answer: undefined, specialty: 'General', topic: 'General', explanation: '' }, 0);
    q.images = media.images; q.explanationImages = media.explanationImages;
  } catch { /* Malformed image entries remain available in Original JSON. */ }
  return q;
}

export function draftFromReport(report: QuestionImportReport, bankId: string, fileName: string, fileHash: string, rawFile: string): ImportDraft {
  const entries = report.entries ?? report.questions.map((question, index) => ({ inputIndex: index + 1, value: question, question, error: undefined }));
  return { version: 1, bankId, fileName, fileHash, rawFile, repaired: report.repaired,
    rows: entries.map(entry => ({ id: crypto.randomUUID(), position: entry.inputIndex, question: entry.question ?? editableQuestion(entry.value, report.sourceFile), original: entry.question, raw: entry.value, repairError: entry.error, excluded: false, reviewed: false, notes: '' })),
    // Invalid rows remain editable; only extraction-declared skipped items stay here.
    skipped: report.skipped.filter(item => item.inputIndex === undefined), checks: {}, decisions: {}, media: {} };
}

export function validateImportRow(row: ImportRow): { question?: QuestionProposalPayload; error?: string } {
  if (row.pendingRaw !== undefined) return { error: 'Apply or discard the pending Original JSON edits before checking this question.' };
  if (row.repairError) return { error: row.repairError };
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

export function workspaceReadiness(draft: ImportDraft) {
  const active = draft.rows.filter(row => !row.excluded);
  const matches = workspaceMatches(draft);
  const invalid = active.filter(row => validateImportRow(row).error);
  const unchecked = active.filter(row => draft.checks[row.id]?.fingerprint !== importRowFingerprint(row));
  const unresolved = active.filter(row => matches[row.id]?.length && !decisionIsCurrent(row, matches[row.id], draft.decisions[row.id]));
  const limitExceeded = draft.questionLimit !== undefined && active.length + (draft.resume?.successful ?? 0) > draft.questionLimit;
  return { active, invalid, unchecked, unresolved, matches, limitExceeded, ready: active.length > 0 && !invalid.length && !unchecked.length && !unresolved.length && !limitExceeded };
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

export function skipWorkspaceExact(draft: ImportDraft): ImportDraft {
  const matches = workspaceMatches(draft);
  const kept = new Set<string>();
  return { ...draft, rows: draft.rows.map(row => {
    if (row.excluded || validateImportRow(row).error) return row;
    const identity = exactImportIdentity(row.question);
    if (!identity) return row;
    const bankMatch = (matches[row.id] ?? []).some(match => match.draftIndex === undefined && exactImportIdentity(match.payload) === identity);
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
  return { ...row, question: report.questions[0], raw: report.entries?.[0].value, pendingRaw: undefined, repairError: undefined, reviewed: false };
}

export function makeImportSubmission(draft: ImportDraft): ImportSubmission {
  const readiness = workspaceReadiness(draft);
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
  return { sessionId: draft.resume?.sessionId ?? crypto.randomUUID(), batches: [...(draft.resume?.savedBatches ?? []), ...batches], completed: draft.resume?.savedBatches.length ?? 0, successful: draft.resume?.successful ?? 0 };
}
