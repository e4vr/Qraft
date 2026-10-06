import { prepareDuplicateCandidate } from '@/features/duplicates/domain/duplicate-detection';
import { detectImportDuplication } from './detect-import-duplication';
import { ImportDuplicateIndex } from './import-duplicate-index';
import type { DuplicateCandidate, QuestionProposalPayload } from '@/lib/medguard-types';

export type ImportMatch = DuplicateCandidate & { payload?: QuestionProposalPayload; restricted?: boolean; canDelete: boolean; draftIndex?: number };

export function withLocalImportMatches(questions: QuestionProposalPayload[], matches: ImportMatch[][], excluded: number[] = []): ImportMatch[][] {
  const removed = new Set(excluded);
  const candidates: ReturnType<typeof prepareDuplicateCandidate>[] = [];
  const search = new ImportDuplicateIndex();
  return questions.map((payload, index) => {
    const existing = (matches[index] ?? []).filter(match => match.draftIndex === undefined);
    if (removed.has(index)) return existing;
    const review = detectImportDuplication(payload, 'local', candidates, '', search);
    const local = (review?.candidates ?? []).map(finding => {
      const previous = Number(finding.entityId.slice(6));
      return { ...finding, payload: questions[previous], canDelete: true, draftIndex: previous };
    });
    const prepared = prepareDuplicateCandidate({ entityId: `draft:${index}`, entityType: 'pending_proposal', qbankId: 'local', payload });
    candidates.push(prepared); search.add(prepared);
    return [...existing, ...local];
  });
}
