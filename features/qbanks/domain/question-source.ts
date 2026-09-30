export type QuestionSourceInput = {
  sourceFile?: unknown;
  sourcePage?: unknown;
  sourceReference?: unknown;
  originalQuestionNumber?: unknown;
};

function sourceText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return Array.from(value.normalize('NFKC'), character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('').trim().replace(/\s+/g, ' ');
}

export function sourceName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = /^https?:\/\//i.test(value.trim()) ? value : value.split(/[\\/]/).pop() ?? '';
  return sourceText(name);
}

function splitReference(value: unknown) {
  const text = sourceText(value);
  // Only explicit page labels are separators; editions/numbers in filenames
  // and ambiguous free-text citations are never stripped.
  const match = text.match(/^(.+?)\s*(?:[-–—,|]\s*|\s+)(?:p(?:age)?\.?|slide|صفحة|ص\.?)\s*[:.]?\s*(\d+)(?:\s*[-–—,|]\s*Q\.?\s*(.+))?$/iu);
  const questionOnly = match ? undefined : text.match(/^(.+?)\s*[-–—,|]\s*Q\.?\s*(.+)$/iu);
  return { file: match?.[1]?.trim() ?? questionOnly?.[1]?.trim() ?? text, page: match ? Number(match[2]) : undefined, number: match?.[3] ?? questionOnly?.[2] };
}

export function formatQuestionSource(file: string, page?: number, number?: string): string {
  return sourceText(file) + (Number.isInteger(page) && Number(page) > 0 ? ` - p.${page}` : '') + (number ? ` - Q.${number.slice(0, 80)}` : '');
}

export function readQuestionSource(input: QuestionSourceInput, fallbackFile = '') {
  const file = splitReference(sourceName(input.sourceFile));
  const reference = splitReference(input.sourceReference);
  const fallback = splitReference(sourceName(fallbackFile));
  const sourceFile = file.file || reference.file || fallback.file;
  const rawPage = input.sourcePage;
  const explicitPage = typeof rawPage === 'string' && /^\d+$/.test(rawPage.trim()) ? Number(rawPage) : rawPage;
  const inferredPage = file.page ?? reference.page ?? fallback.page;
  const page = explicitPage === null || explicitPage === '' ? undefined : explicitPage === undefined || explicitPage === 0 ? inferredPage : explicitPage;
  const sourcePage = typeof page === 'number' && Number.isInteger(page) && page > 0 && page <= 100_000 ? page : undefined;
  const originalQuestionNumber = typeof input.originalQuestionNumber === 'string' || typeof input.originalQuestionNumber === 'number'
    ? String(input.originalQuestionNumber).slice(0, 80) : file.number ?? reference.number;
  return { sourceFile, sourcePage, originalQuestionNumber, sourceReference: formatQuestionSource(sourceFile, sourcePage, originalQuestionNumber) };
}

export function validateQuestionSource(input: QuestionSourceInput, fallbackFile = '') {
  if (input.sourceFile !== undefined && input.sourceFile !== null && typeof input.sourceFile !== 'string')
    throw new Error('sourceFile must be a source name.');
  const source = readQuestionSource(input, fallbackFile);
  if (!source.sourceFile || source.sourceFile.length > 240) throw new Error('A sourceFile name of 1–240 characters is required.');
  const rawPage = input.sourcePage;
  if (rawPage !== undefined && rawPage !== null && rawPage !== '') {
    const page = typeof rawPage === 'string' && /^\d+$/.test(rawPage.trim()) ? Number(rawPage) : rawPage;
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 100_000)
      throw new Error('sourcePage must be a whole number from 1 to 100000 when provided.');
  }
  return { sourceFile: source.sourceFile, ...(source.sourcePage === undefined ? {} : { sourcePage: source.sourcePage }), sourceReference: source.sourceReference,
    ...(source.originalQuestionNumber ? { originalQuestionNumber: source.originalQuestionNumber } : {}) };
}

export function questionSourceKey(input: QuestionSourceInput): string {
  return readQuestionSource(input).sourceFile.toLowerCase();
}

export function questionSourceOptions(questions: QuestionSourceInput[]) {
  const sources = new Map<string, { key: string; name: string; count: number }>();
  for (const question of questions) {
    const key = questionSourceKey(question);
    const current = sources.get(key);
    if (current) current.count++;
    else sources.set(key, { key, name: readQuestionSource(question).sourceFile || 'Unspecified source', count: 1 });
  }
  return [...sources.values()].sort((a, b) => a.name.localeCompare(b.name));
}
