import type {
  DuplicateCandidate,
  DuplicateReview,
  QuestionProposalPayload,
} from '@/lib/medguard-types';

/** The single source of truth for deterministic duplicate detection. */
export const DUPLICATE_DETECTION_CONFIG = {
  detectorVersion: 'v1',
  highConfidenceThreshold: 0.9,
  possibleThreshold: 0.76,
  maximumCandidates: 3,
  scope: 'same_qbank' as const,
  weights: {
    stem: 0.62,
    optionsSet: 0.16,
    optionsOrdered: 0.08,
    correctAnswer: 0.09,
    specialty: 0.025,
    topic: 0.025,
  },
};

export type DuplicateComparable = Pick<
  QuestionProposalPayload,
  'stem' | 'options' | 'answer' | 'specialty' | 'topic'
>;

export type PreparedDuplicateCandidate = {
  entityId: string;
  entityType: DuplicateCandidate['entityType'];
  qbankId: string;
  questionId?: string;
  payload: DuplicateComparable;
  prepared: PreparedContent;
};

type PreparedContent = {
  stem: string;
  options: string[];
  sortedOptions: string[];
  correctAnswer: string;
  specialty: string;
  topic: string;
  stemTokens: string[];
  stemBigrams: string[];
  optionTokens: string[][];
  optionBigrams: string[][];
  correctAnswerTokens: string[];
  correctAnswerBigrams: string[];
  importantValues: Set<string>;
  fingerprint: string;
};

const IMPORTANT_WORDS = new Set([
  'not', 'except', 'most', 'least', 'first', 'next', 'best', 'right', 'left',
  'bilateral', 'unilateral', 'increase', 'decrease', 'positive', 'negative',
  'before', 'after', 'with', 'without',
]);

/** Formatting-only normalization. Meaningful punctuation, signs and numbers survive. */
export function normalizeDuplicateText(value: string) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^\s*(?:q(?:uestion)?\s*)?\d+\s*[.)\-:]\s*/i, '')
    .replace(/\s+([,;:?!])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDuplicateOption(value: string) {
  return normalizeDuplicateText(value).replace(/^\s*(?:[a-j]|\d{1,2})\s*[.)\-:]\s*/i, '');
}

function stableHash(value: string) {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

function tokens(value: string) {
  return value.match(/[\p{L}]+|[+−-]?\d+(?:\.\d+)?(?:\s*(?:-|–|—|to)\s*\d+(?:\.\d+)?)?|[%°]|[<>]=?/gu) ?? [];
}

function bigrams(value: string) {
  return Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2));
}

function collectImportantValues(stemTokens: string[]) {
  const values = new Set(stemTokens.filter(token => IMPORTANT_WORDS.has(token)));
  for (const token of stemTokens) {
    if (/^[+−-]?\d/.test(token) || /^(?:mg|mcg|g|kg|ml|l|mm|cm|mmhg|bpm|days?|weeks?|months?|years?)$/i.test(token))
      values.add(token);
  }
  return values;
}

function prepare(payload: DuplicateComparable): PreparedContent {
  const stem = normalizeDuplicateText(payload.stem);
  const options = payload.options.map(normalizeDuplicateOption);
  const correctAnswer = options[payload.answer] ?? '';
  const specialty = normalizeDuplicateText(payload.specialty);
  const topic = normalizeDuplicateText(payload.topic);
  const sortedOptions = [...options].sort();
  const canonical = JSON.stringify({ stem, options: sortedOptions, correctAnswer });
  const stemTokens = tokens(stem).sort();
  return {
    stem,
    options,
    sortedOptions,
    correctAnswer,
    specialty,
    topic,
    stemTokens,
    stemBigrams: bigrams(stem).sort(),
    optionTokens: options.map(value => tokens(value).sort()),
    optionBigrams: options.map(value => bigrams(value).sort()),
    correctAnswerTokens: tokens(correctAnswer).sort(),
    correctAnswerBigrams: bigrams(correctAnswer).sort(),
    importantValues: collectImportantValues(stemTokens),
    fingerprint: `${DUPLICATE_DETECTION_CONFIG.detectorVersion}:${stableHash(canonical)}`,
  };
}

export function duplicateFingerprint(payload: DuplicateComparable) {
  return prepare(payload).fingerprint;
}

function dice(left: string[], right: string[]) {
  if (!left.length || !right.length) return left.length === right.length ? 1 : 0;
  let overlap = 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      overlap += 1;
      leftIndex += 1;
      rightIndex += 1;
    } else if (left[leftIndex] < right[rightIndex]) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return (2 * overlap) / (left.length + right.length);
}

function preparedTextSimilarity(
  left: string,
  right: string,
  leftTokens: string[],
  rightTokens: string[],
  leftBigrams: string[],
  rightBigrams: string[],
) {
  return left === right ? 1 : dice(leftTokens, rightTokens) * 0.72 + dice(leftBigrams, rightBigrams) * 0.28;
}

function preparedOptionSetScore(left: PreparedContent, right: PreparedContent) {
  if (!left.options.length || !right.options.length)
    return left.options.length === right.options.length ? 1 : 0;
  const remaining = right.options.map((_, index) => index);
  let total = 0;
  for (let leftIndex = 0; leftIndex < left.options.length; leftIndex += 1) {
    let bestIndex = -1;
    let best = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      const rightIndex = remaining[index];
      const score = preparedTextSimilarity(
        left.options[leftIndex],
        right.options[rightIndex],
        left.optionTokens[leftIndex],
        right.optionTokens[rightIndex],
        left.optionBigrams[leftIndex],
        right.optionBigrams[rightIndex],
      );
      if (score > best) {
        best = score;
        bestIndex = index;
      }
    }
    total += best;
    if (bestIndex >= 0) remaining.splice(bestIndex, 1);
  }
  return total / Math.max(left.options.length, right.options.length);
}

function meaningfulMismatch(left: PreparedContent, right: PreparedContent) {
  const a = left.importantValues;
  const b = right.importantValues;
  return [...a].some(value => !b.has(value)) || [...b].some(value => !a.has(value));
}

export function prepareDuplicateCandidate(input: Omit<PreparedDuplicateCandidate, 'prepared'>) {
  return { ...input, prepared: prepare(input.payload) };
}

export function compareDuplicateContent(
  incoming: DuplicateComparable,
  candidate: DuplicateComparable,
) {
  const left = prepare(incoming);
  const right = prepare(candidate);
  return comparePreparedContent(left, right);
}

function comparePreparedContent(left: PreparedContent, right: PreparedContent) {
  const exact = left.fingerprint === right.fingerprint;
  const stemScore = preparedTextSimilarity(
    left.stem,
    right.stem,
    left.stemTokens,
    right.stemTokens,
    left.stemBigrams,
    right.stemBigrams,
  );
  const minimumStemForPossible =
    (DUPLICATE_DETECTION_CONFIG.possibleThreshold - (1 - DUPLICATE_DETECTION_CONFIG.weights.stem)) /
    DUPLICATE_DETECTION_CONFIG.weights.stem;
  if (!exact && stemScore < minimumStemForPossible) {
    const signals = {
      stem: stemScore,
      optionsSet: 0,
      optionsOrdered: 0,
      correctAnswer: 0,
      specialty: left.specialty === right.specialty ? 1 : 0,
      topic: left.topic === right.topic ? 1 : 0,
    };
    return {
      exact,
      score: stemScore * DUPLICATE_DETECTION_CONFIG.weights.stem + signals.specialty * DUPLICATE_DETECTION_CONFIG.weights.specialty + signals.topic * DUPLICATE_DETECTION_CONFIG.weights.topic,
      signals,
      sourceFingerprint: left.fingerprint,
      candidateFingerprint: right.fingerprint,
    };
  }
  const orderedLength = Math.max(left.options.length, right.options.length);
  let ordered = 1;
  if (orderedLength) {
    let orderedTotal = 0;
    for (let index = 0; index < orderedLength; index += 1)
      orderedTotal += preparedTextSimilarity(
        left.options[index] ?? '',
        right.options[index] ?? '',
        left.optionTokens[index] ?? [],
        right.optionTokens[index] ?? [],
        left.optionBigrams[index] ?? [],
        right.optionBigrams[index] ?? [],
      );
    ordered = orderedTotal / orderedLength;
  }
  const signals = {
    stem: stemScore,
    optionsSet: preparedOptionSetScore(left, right),
    optionsOrdered: ordered,
    correctAnswer: preparedTextSimilarity(
      left.correctAnswer,
      right.correctAnswer,
      left.correctAnswerTokens,
      right.correctAnswerTokens,
      left.correctAnswerBigrams,
      right.correctAnswerBigrams,
    ),
    specialty: left.specialty === right.specialty ? 1 : 0,
    topic: left.topic === right.topic ? 1 : 0,
  };
  const weights = DUPLICATE_DETECTION_CONFIG.weights;
  let score = exact
    ? 1
    : Object.entries(weights).reduce(
        (sum, [key, weight]) => sum + signals[key as keyof typeof signals] * weight,
        0,
      );
  // Similar-looking text with a changed negation, dose, number or laterality is
  // still reviewable, but must not be promoted to high-confidence automatically.
  if (!exact && meaningfulMismatch(left, right)) score = Math.min(score, 0.89);
  return {
    exact,
    score,
    signals,
    sourceFingerprint: left.fingerprint,
    candidateFingerprint: right.fingerprint,
  };
}

export function detectDuplicateReview({
  incoming,
  qbankId,
  sourceEntityId = '',
  candidates,
  now = new Date().toISOString(),
  suppressedPairs = new Set<string>(),
}: {
  incoming: DuplicateComparable;
  qbankId: string;
  sourceEntityId?: string;
  candidates: PreparedDuplicateCandidate[];
  now?: string;
  suppressedPairs?: Set<string>;
}): DuplicateReview | undefined {
  const preparedIncoming = prepare(incoming);
  const sourceFingerprint = preparedIncoming.fingerprint;
  const matches: DuplicateCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.qbankId !== qbankId) continue;
    const suppressionKey = `${sourceEntityId}|${sourceFingerprint}|${candidate.entityType}|${candidate.entityId}|${candidate.prepared.fingerprint}`;
    if (suppressedPairs.has(suppressionKey)) continue;
    const comparison = comparePreparedContent(preparedIncoming, candidate.prepared);
    const classification = comparison.exact
      ? 'exact'
      : comparison.score >= DUPLICATE_DETECTION_CONFIG.highConfidenceThreshold
        ? 'high_confidence'
        : comparison.score >= DUPLICATE_DETECTION_CONFIG.possibleThreshold
          ? 'possible'
          : undefined;
    if (!classification) continue;
    matches.push({
      entityId: candidate.entityId,
      entityType: candidate.entityType,
      questionId: candidate.questionId,
      similarity: Math.round(comparison.score * 100),
      classification,
      signals: Object.fromEntries(
        Object.entries(comparison.signals).map(([key, value]) => [key, Math.round(value * 100)]),
      ) as DuplicateCandidate['signals'],
      candidateFingerprint: comparison.candidateFingerprint,
      detectedAt: now,
    });
  }
  matches.sort((a, b) => b.similarity - a.similarity || a.entityId.localeCompare(b.entityId));
  if (!matches.length) return undefined;
  return {
    status: 'flagged',
    detectorVersion: DUPLICATE_DETECTION_CONFIG.detectorVersion,
    sourceFingerprint,
    detectedAt: now,
    candidates: matches.slice(0, DUPLICATE_DETECTION_CONFIG.maximumCandidates),
  };
}
