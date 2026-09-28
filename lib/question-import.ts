import { jsonrepair } from 'jsonrepair';
import { optionLabel, type QuestionProposalPayload } from './medguard-types';

export const QUESTION_JSON_PROMPT = `The import interface reads a single valid JSON object, without Markdown fences or commentary. Its supported structure is:
{"format":"qraft-question-bank-v1","sourceFile":"Lecture or bank filename.pdf","questions":[{"originalQuestionNumber":"37","stem":"Complete question text","options":["Option A","Option B","Option C","Option D"],"correctAnswer":"A","specialty":"General","topic":"Topic","explanation":"A sufficient explanation of the answer","sourcePage":12,"images":[]}],"skipped":[]}.
sourceFile identifies the original lecture title or bank filename; sourcePage is the actual page or slide number, and originalQuestionNumber preserves the source number when available. Unknown source details belong in skipped with a brief reason rather than an invented citation. correctAnswer uses the letter of an existing option, such as A or B; the importer handles options in that exact order. Application question IDs are allocated by Qraft after import, so they are absent from this extraction format. Image links, when available, have an HTTPS url, name and caption; an empty images array is valid. Questions with unreadable or ambiguous answer keys belong in skipped while the remaining readable questions are retained. A parseable file has escaped quotes and line breaks inside strings, and no comments or trailing commas.`;

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
    ? `This guide asks you to build a JSON file that will be uploaded to an electronic question platform. The goal is accurate, complete conversion of the first ${count} questions in the supplied existing bank, in their original order. The bank is authoritative for question content and answer keys; missing source content is reported transparently rather than invented.

READ AND TRANSCRIBE THE BANK
Accurate transcription includes the complete question, clinical details, tables and relevant captions. Selectable text is the preferred source; OCR is appropriate for scanned material, followed by contextual checking of spelling and ambiguous characters. Clinical meaning, numbers, decimal points, units, laterality, negation and the recorded correct answer stay faithful to the source.

BUILD THE OPTIONS
The target is four close, logical and plausible options. Existing source options and the correct answer retain their meaning; additional distractors are appropriate when needed to complete four choices, with the same clinical focus and reasonable difficulty. An uncertain answer key is reported for human review rather than guessed.

RECORD THE SOURCE AND EXPLAIN THE ANSWER
The original question number and actual page identify each bank question. Existing explanations are retained; when absent, a useful explanation describes the reasoning behind the keyed answer. Knowledge outside the bank only for this explanation can fill that gap, with uncertainty made clear and the original question and citation preserved.`
    : `This guide asks you to build a JSON file that will be uploaded to an electronic question platform. The goal is useful questions grounded in the supplied lecture or scientific material. The supplied material is the exclusive source of examinable facts, answer keys and explanations.

FOLLOW THE CUSTOMIZATION
${countMode === 'per_slide' ? `The target is one question per substantive slide, up to ${perSlideLimit} questions, excluding title-only and empty slides.` : `The target is ${count} questions, with distinct learning objectives where the source supports them.`}
Question type: ${kind === 'clinical' ? 'Clinical questions with clinical vignettes.' : 'Direct knowledge questions.'}
Question length: ${length === 'short' ? 'Short, approximately 15–40 words.' : length === 'long' ? 'Long, approximately 90–150 words.' : 'Medium, approximately 40–90 words.'}
Each question has ${optionCount} distinct answer options, with plausible distractors and one source-supported correct answer. The selected option count takes precedence over the default of four.

RECORD THE SOURCE AND EXPLAIN THE ANSWER
The lecture name and actual page or slide number accompany every question. Useful explanations connect the keyed answer to the supplied material and, where supported, explain why the other choices are less suitable. The question, options and explanation are mutually consistent and grounded in that material.`;
  return `${instructions}

CLASSIFICATION
A concise English specialty and topic accompany every question, using consistent names for the same subject. General and Unclassified are valid when a more precise classification is unavailable.

READABLE QUESTION TEXT
Prose flows in complete sentences within paragraphs. PDF column wraps and OCR line endings are layout artifacts, not meaningful sentence breaks. Real paragraphs, lists, laboratory rows and tables retain their structure. Labels such as A. and B. are represented by the options array order rather than repeated inside option text. The stem contains the question itself, without repeated headers, footers or answer labels. Medical symbols and values remain unchanged.

BUILD AND CHECK THE FILE
${QUESTION_JSON_PROMPT}
A useful final quality check compares every stem, its options, answer key, explanation and citation with the source. The JSON questions array contains the readable questions, and skipped explains each source item that could not be represented reliably. The final artifact is the JSON file contents, ready for import.`;
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

export function importedSourceReference(fileName: string, page: number, originalQuestionNumber?: string) {
  return compactSourceReference(fileName, page) + (originalQuestionNumber ? ` - Q.${originalQuestionNumber.slice(0, 80)}` : '');
}

// OCR wraps prose at the edge of a page. Preserve actual paragraphs, lists,
// tables and labelled findings rather than making every PDF line a paragraph.
export function normalizeQuestionText(value: string): string {
  const lines = value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').split('\n');
  const structured = (line: string) => /^(?:[-*•]\s|\d+[.)]\s|[A-J][.)]\s|[^:]{1,60}:\s|\|)/.test(line) || /\t|\S {2,}\S/.test(line);
  let result = '';
  let previous = '';
  let paragraph = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { paragraph = Boolean(result); continue; }
    if (result) result += paragraph ? '\n\n' : structured(line) || structured(previous) || previous.endsWith(':') ? '\n' : ' ';
    result += line;
    previous = line;
    paragraph = false;
  }
  return result.trim();
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
  const original = value as Record<string, unknown>;
  const item = {
    ...original,
    stem: original.stem ?? original.question ?? original.questionText,
    options: original.options ?? original.choices,
    correctAnswer: original.correctAnswer ?? original.correct_answer ?? original.answer,
    sourcePage: original.sourcePage ?? original.page ?? original.slideNumber,
  } as Record<string, unknown>;
  if (item.options && typeof item.options === 'object' && !Array.isArray(item.options)) {
    const choices = item.options as Record<string, unknown>;
    const keys = Object.keys(choices).sort();
    if (keys.length >= 2 && keys.every((key, i) => key.toUpperCase() === optionLabel(i)))
      item.options = keys.map(key => choices[key]);
  }
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
    return normalizeQuestionText(item[key]);
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
  const options = (item.options as string[]).map((x, i) => normalizeQuestionText(x).replace(new RegExp(`^${optionLabel(i)}[.)]\\s+`, 'i'), ''));
  if (options.some(option => !option)) return fail('options (non-empty answer text)');
  const raw = item.correctAnswer ?? item.answer;
  const numeric =
    typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
  const label = typeof raw === 'string' ? raw.trim().match(/^([A-J])(?:[.)]|$)/i)?.[1]?.toUpperCase() : undefined;
  const answer =
    typeof numeric === 'number'
      ? numeric
      : options.findIndex(
          (option, i) => optionLabel(i) === label || option === normalizeQuestionText(String(raw)).replace(/^[A-J][.)]\s+/i, ''),
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
    sourceReference: importedSourceReference(fileName, Number(page), typeof item.originalQuestionNumber === 'string' || typeof item.originalQuestionNumber === 'number' ? String(item.originalQuestionNumber) : undefined),
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
          'The JSON could not be repaired and no recoverable questions were found.',
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
  return {
    questions, skipped,
    sourceFile: sourceFile || questions[0]?.sourceFile || '',
    repaired,
  };
}
