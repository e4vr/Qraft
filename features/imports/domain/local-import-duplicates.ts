import { duplicateFingerprint, normalizeDuplicateText } from '@/features/duplicates/domain/duplicate-detection';
import type { DuplicateCandidate, QuestionProposalPayload } from '@/lib/medguard-types';

export type ImportMatch = DuplicateCandidate & { payload: QuestionProposalPayload; canDelete: boolean; draftIndex?: number };

export function withLocalImportMatches(questions: QuestionProposalPayload[], matches: ImportMatch[][], excluded: number[] = []): ImportMatch[][] {
  const removed = new Set(excluded);
  const first = new Map<string, number>();
  const now = new Date().toISOString();
  return questions.map((payload, index) => {
    const existing = (matches[index] ?? []).filter(match => match.draftIndex === undefined);
    if (removed.has(index)) return existing;
    const stem = normalizeDuplicateText(payload.stem);
    const previous = first.get(stem);
    if (previous === undefined) { first.set(stem, index); return existing; }
    return [...existing, {
      entityId: `draft:${previous}`, entityType: 'pending_proposal',
      candidateFingerprint: duplicateFingerprint(questions[previous]), payload: questions[previous], canDelete: true, draftIndex: previous,
      classification: 'exact', similarity: 100, detectedAt: now,
      signals: { stem: 100, optionsSet: 0, optionsOrdered: 0, correctAnswer: 0, specialty: 0, topic: 0 },
    }];
  });
}
