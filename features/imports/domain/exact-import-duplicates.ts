import { normalizeDuplicateFormatting } from '@/features/duplicates/domain/duplicate-detection';
import type { QuestionProposalPayload } from '@/lib/medguard-types';
import type { ImportMatch } from './local-import-duplicates';

type ImportContent = Pick<
  QuestionProposalPayload,
  'stem' | 'options' | 'answer'
>;

// Source, explanation and classification do not change a question's identity.
// Compare the correct answer's text so reordered, relabelled options still match.
export function exactImportIdentity(
  payload: ImportContent,
): string | undefined {
  // Leading decimals/doses must never be mistaken for question/option numbers.
  const stem = normalizeDuplicateFormatting(payload.stem);
  const options = payload.options.map((option) =>
    normalizeDuplicateFormatting(option).replace(/^\s*[a-j][.)]\s+/i, ''),
  );
  if (
    !stem ||
    options.length < 2 ||
    options.some((option) => !option) ||
    !Number.isInteger(payload.answer) ||
    payload.answer < 0 ||
    payload.answer >= options.length
  )
    return undefined;
  return JSON.stringify({
    stem,
    options: [...options].sort(),
    correctAnswer: options[payload.answer],
  });
}

export function planExactImportSkip(
  questions: QuestionProposalPayload[],
  matches: ImportMatch[][],
  excluded: number[] = [],
  dirty: number[] = [],
) {
  const removed = new Set(excluded),
    edited = new Set(dirty);
  const first = new Set<string>();
  const indexes: number[] = [];
  let bankMatches = 0,
    fileMatches = 0;
  questions.forEach((payload, index) => {
    if (removed.has(index)) return;
    const identity = exactImportIdentity(payload);
    if (!identity) return;
    const inBank =
      !edited.has(index) &&
      (matches[index] ?? []).some(
        (match) =>
          match.draftIndex === undefined &&
          exactImportIdentity(match.payload) === identity,
      );
    if (inBank || first.has(identity)) {
      indexes.push(index);
      if (inBank) bankMatches++;
      else fileMatches++;
    } else first.add(identity);
  });
  return { indexes, bankMatches, fileMatches };
}
