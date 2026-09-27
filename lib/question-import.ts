import { jsonrepair } from 'jsonrepair';
import { optionLabel, type QuestionProposalPayload } from './medguard-types';

export const QUESTION_JSON_PROMPT = `Return strict JSON only, with no Markdown or commentary, using this structure:
{"format":"qraft-question-bank-v1","sourceFile":"Lecture or bank filename.pdf","questions":[{"originalQuestionNumber":"37","stem":"Complete question text","options":["Option A","Option B","Option C","Option D"],"correctAnswer":"A","specialty":"General","topic":"Topic","explanation":"A sufficient explanation of the answer","sourcePage":12,"images":[]}],"skipped":[]}.
Use the original lecture title or bank filename for sourceFile. Include the actual page or slide number as sourcePage and, for existing banks, the original question number as originalQuestionNumber. Do not invent a page or question number. correctAnswer must map to an option (A, B, C, D, or the corresponding label when customized). Images, when available as links, use HTTPS url, name and caption. Do not assign application question IDs. Include all question information in the supported fields. If an item cannot be read accurately, add it to skipped with its originalQuestionNumber, page and reason, and continue with the remaining items. Validate the JSON before returning it: no comments, trailing commas, or text outside the JSON object.`;

export interface QuestionPromptSettings {
  source: 'qbank' | 'lecture';
  kind: 'clinical' | 'direct';
  length: 'short' | 'medium' | 'long';
  countMode: 'fixed' | 'per_slide';
  count: number;
  optionCount: number;
}

export interface SkippedImportedQuestion {
  originalQuestionNumber?: string;
  page?: number;
  fileName: string;
  reason: string;
}

export interface QuestionImportReport {
  questions: QuestionProposalPayload[];
  skipped: SkippedImportedQuestion[];
  sourceFile: string;
  repaired: boolean;
}

export function buildQuestionPrompt(settings: QuestionPromptSettings, perSlideLimit = 200): string {
  const { source, kind, length, countMode, count, optionCount } = settings;
  if (!Number.isInteger(count) || count < 1 || count > 200)
    throw new Error('Choose a whole number from 1 to 200 questions.');
  if (
    source === 'lecture' &&
    (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 10)
  )
    throw new Error('Choose a whole number from 2 to 10 options.');
  const instructions = source === 'qbank'
    ? `This guide asks you to build a JSON file that will be uploaded to an electronic question platform. Convert the supplied existing question bank accurately and carefully, without using outside sources or hallucinating source content. Include all information present in the file. Convert the first ${count} questions in their original order.

READ AND TRANSCRIBE THE BANK
Read the complete question, including its clinical details, tables, captions and any relevant information. If the text is selectable, copy it completely and check spelling errors, correcting them according to the correct context. If the text cannot be copied, use OCR to extract it carefully. Preserve the question's meaning, numbers, units, negation and recorded correct answer.

BUILD THE OPTIONS
Include four answer options. When the source does not provide four options, build four close, logical and plausible options so that the question has reasonable difficulty. Retain the source's correct answer and do not change what the question asks.

RECORD THE SOURCE AND EXPLAIN THE ANSWER
For every question, include its original question number and its page number in the bank. Copy the explanation when it is provided. Otherwise, provide a sufficient explanation of how to solve the question; you may use knowledge outside the bank only for this explanation when the bank does not contain one. Do not use outside material to rewrite the question or its source information.`
    : `This guide asks you to build a JSON file that will be uploaded to an electronic question platform. Build questions from the supplied lecture or scientific material, in the requested number, and verify that every question agrees with the source. Do not use any external sources.

FOLLOW THE CUSTOMIZATION
${countMode === 'per_slide' ? `Build one question per substantive slide, up to ${perSlideLimit} questions.` : `Build ${count} questions.`}
Question type: ${kind === 'clinical' ? 'Clinical questions with clinical vignettes.' : 'Direct knowledge questions.'}
Question length: ${length === 'short' ? 'Short, approximately 15–40 words.' : length === 'long' ? 'Long, approximately 90–150 words.' : 'Medium, approximately 40–90 words.'}
Use exactly ${optionCount} distinct answer options per question (four by default, with the current customization taking precedence). Make the options logical and plausible, with one correct answer supported by the source.

RECORD THE SOURCE AND EXPLAIN THE ANSWER
Include the lecture name and the actual page or slide number for every question. Provide a sufficient explanation of the correct answer and why it follows from the supplied material. Ensure the question, options and explanation agree with the source; do not introduce outside information.`;
  return `${instructions}

CLASSIFICATION
Include a concise English specialty and topic for every question, using consistent names. Use General and Unclassified if a precise classification is unavailable.

BUILD AND CHECK THE FILE
${QUESTION_JSON_PROMPT}
Check each complete question, its options, correct answer, source and explanation against the instructions above. The final response must contain only the JSON file contents.`;
}

function shortFileName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const result = value.trim().split(/[\\/]/).pop()?.trim() ?? '';
  let clean = '';
  for (const character of result) {
    if (character.charCodeAt(0) >= 32) clean += character;
  }
  return clean.slice(0, 240);
}

function sourceParts(item: Record<string, unknown>, fallbackFile = '') {
  const reference =
    typeof item.sourceReference === 'string' ? item.sourceReference.trim() : '';
  const match = reference.match(/^(.+?)\s*-\s*p(?:age)?\.?\s*(\d+)\b/i);
  const fileName =
    shortFileName(item.sourceFile) ||
    shortFileName(fallbackFile) ||
    shortFileName(match?.[1]);
  const rawPage =
    item.sourcePage ?? item.page ?? (match ? Number(match[2]) : undefined);
  const page =
    typeof rawPage === 'string' && /^\d+$/.test(rawPage.trim())
      ? Number(rawPage)
      : rawPage;
  return { fileName, page };
}

export function compactSourceReference(fileName: string, page: number) {
  return `${shortFileName(fileName)} - p.${page}`;
}

export function normalizeImportedQuestion(
  value: unknown,
  index: number,
  fallbackSourceFile = '',
): QuestionProposalPayload {
  const fail = (field: string): never => {
    throw new Error(`Question ${index + 1}: invalid or missing ${field}.`);
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('question object');
  const item = value as Record<string, unknown>;
  const string = (key: string, fallback?: string, optional = false) => {
    if (item[key] === undefined || item[key] === null) {
      if (fallback !== undefined) return fallback;
      if (optional) return '';
      return fail(key);
    }
    if (
      typeof item[key] !== 'string' ||
      (!optional && !item[key].trim()) ||
      item[key].length > 30000
    )
      return fail(key);
    return item[key].trim();
  };
  if (
    !Array.isArray(item.options) ||
    item.options.length < 2 ||
    item.options.length > 10 ||
    item.options.some(
      (x) => typeof x !== 'string' || !x.trim() || x.length > 10000,
    )
  )
    return fail('options (2–10 non-empty strings)');
  const options = (item.options as string[]).map((x) => x.trim());
  const raw = item.correctAnswer ?? item.answer;
  const numeric =
    typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
  const answer =
    typeof numeric === 'number'
      ? numeric
      : options.findIndex(
          (_, i) => optionLabel(i) === String(raw).trim().toUpperCase(),
        );
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length)
    return fail('answer');
  const { fileName, page } = sourceParts(item, fallbackSourceFile);
  if (!fileName) return fail('sourceFile');
  if (!Number.isInteger(page) || Number(page) < 1 || Number(page) > 100000)
    return fail('sourcePage');
  if (item.images !== undefined && !Array.isArray(item.images))
    return fail('images');
  const images = ((item.images ?? []) as unknown[]).map((value, imageIndex) => {
    if (!value || typeof value !== 'object')
      return fail(`images[${imageIndex}]`);
    const image = value as Record<string, unknown>;
    if (typeof image.url !== 'string' || !/^https:\/\//i.test(image.url))
      return fail(`images[${imageIndex}].url (HTTPS required)`);
    try {
      new URL(image.url);
    } catch {
      return fail(`images[${imageIndex}].url`);
    }
    return {
      id: typeof image.id === 'string' ? image.id : crypto.randomUUID(),
      url: image.url,
      name: typeof image.name === 'string' ? image.name : 'Question image',
      caption: typeof image.caption === 'string' ? image.caption : '',
    };
  });
  if (images.length > 10) return fail('images (maximum 10)');
  return {
    stem: string('stem'),
    options,
    answer,
    specialty: string('specialty', 'General'),
    topic: string('topic', 'Unclassified'),
    explanation: string('explanation', '', true),
    sourceFile: fileName,
    sourcePage: Number(page),
    ...(typeof item.originalQuestionNumber === 'string' || typeof item.originalQuestionNumber === 'number' ? { originalQuestionNumber: String(item.originalQuestionNumber).slice(0,80) } : {}),
    sourceReference: compactSourceReference(fileName, Number(page)) + (typeof item.originalQuestionNumber === 'string' || typeof item.originalQuestionNumber === 'number' ? ` - Q.${String(item.originalQuestionNumber).slice(0,80)}` : ''),
    images,
  };
}

function skippedFrom(
  value: unknown,
  fallbackFile: string,
  fallbackReason: string,
): SkippedImportedQuestion {
  const item =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const { fileName, page } = sourceParts(item, fallbackFile);
  const number =
    item.originalQuestionNumber ?? item.questionNumber ?? item.number;
  const reason =
    typeof item.reason === 'string' && item.reason.trim()
      ? item.reason.trim()
      : fallbackReason;
  return {
    ...(typeof number === 'string' || typeof number === 'number'
      ? { originalQuestionNumber: String(number).slice(0, 80) }
      : {}),
    ...(Number.isInteger(page) && Number(page) > 0
      ? { page: Number(page) }
      : {}),
    fileName,
    reason: reason.slice(0, 500),
  };
}

function parseWithRepair(raw: string): { value: unknown; repaired: boolean } {
  try {
    return { value: JSON.parse(raw), repaired: false };
  } catch {
    const repaired = jsonrepair(raw);
    return { value: JSON.parse(repaired), repaired: true };
  }
}

function salvageQuestionObjects(raw: string): unknown[] {
  const key = raw.search(/["']questions["']\s*:/i);
  const start = raw.indexOf('[', Math.max(0, key));
  if (key < 0 || start < 0) return [];
  const candidates: string[] = [];
  let depth = 0,
    objectStart = -1,
    quote = '',
    escaped = false;
  for (let i = start + 1; i < raw.length; i += 1) {
    const char = raw[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') {
      if (depth === 0) objectStart = i;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && objectStart >= 0)
        candidates.push(raw.slice(objectStart, i + 1));
    } else if (char === ']' && depth === 0) break;
  }
  return candidates.flatMap((candidate) => {
    try {
      return [parseWithRepair(candidate).value];
    } catch {
      return [];
    }
  });
}

export function parseQuestionImportReport(
  input: unknown,
  fallbackSourceFile = '',
  maxEntries = 200,
): QuestionImportReport {
  let parsed = input;
  let repaired = false;
  if (typeof input === 'string') {
    try {
      const result = parseWithRepair(input.replace(/^\uFEFF/, '').trim());
      parsed = result.value;
      repaired = result.repaired;
    } catch {
      const salvaged = salvageQuestionObjects(input);
      if (!salvaged.length)
        throw new Error(
          'تعذر إصلاح بنية JSON أو العثور على أسئلة قابلة للاسترداد.',
        );
      const sourceMatch = input.match(
        /["']sourceFile["']\s*:\s*["']([^"'\r\n]+)["']/i,
      );
      parsed = { sourceFile: sourceMatch?.[1], questions: salvaged };
      repaired = true;
    }
  }
  const envelope =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const sourceFile =
    shortFileName(envelope.sourceFile) || shortFileName(fallbackSourceFile);
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(envelope.questions)
      ? envelope.questions
      : [parsed];
  const declaredSkipped = Array.isArray(envelope.skipped)
    ? envelope.skipped
    : [];
  if (rows.length + declaredSkipped.length < 1 || rows.length + declaredSkipped.length > maxEntries)
    throw new Error(`Provide 1–${maxEntries} combined questions and skipped entries per import.`);
  const questions: QuestionProposalPayload[] = [];
  const skipped = declaredSkipped.map((value) =>
    skippedFrom(value, sourceFile, 'Skipped by extraction model.'),
  );
  rows.forEach((row, index) => {
    try {
      questions.push(normalizeImportedQuestion(row, index, sourceFile));
    } catch (error) {
      skipped.push(
        skippedFrom(
          row,
          sourceFile,
          error instanceof Error
            ? error.message.replace(/^Question \d+:\s*/, '')
            : 'Invalid question.',
        ),
      );
    }
  });
  const canonical = JSON.stringify({ questions, skipped });
  const verified = JSON.parse(canonical) as {
    questions: QuestionProposalPayload[];
    skipped: SkippedImportedQuestion[];
  };
  verified.questions.forEach((question, index) =>
    normalizeImportedQuestion(question, index, sourceFile),
  );
  return {
    ...verified,
    sourceFile: sourceFile || verified.questions[0]?.sourceFile || '',
    repaired,
  };
}
