import { detectDuplicateReview, duplicateFingerprint, normalizeDuplicateText, type PreparedDuplicateCandidate } from '@/features/duplicates/domain/duplicate-detection';
import type { QuestionProposalPayload } from '@/lib/medguard-types';
import { ImportDuplicateIndex } from './import-duplicate-index';
import { exactImportIdentity } from './exact-import-duplicates';

// Shared by the browser worker and the final server check.
export function detectImportDuplication(incoming: QuestionProposalPayload, bankId: string, candidates: PreparedDuplicateCandidate[], sourceEntityId = '', index = new ImportDuplicateIndex(candidates)) {
  const sameText = index.exact(bankId, normalizeDuplicateText(incoming.stem));
  if (!sameText.length) return detectDuplicateReview({ incoming, qbankId: bankId, sourceEntityId, candidates: index.near(bankId, normalizeDuplicateText(incoming.stem)) });
  const identity = exactImportIdentity(incoming);
  const matches = [...sameText].sort((left, right) => Number(exactImportIdentity(right.payload) === identity) - Number(exactImportIdentity(left.payload) === identity)).slice(0, 3).map(c => ({
    entityId: c.entityId, entityType: c.entityType, questionId: c.questionId, candidateFingerprint: c.prepared.fingerprint,
    classification: 'exact' as const, similarity: 100, detectedAt: new Date().toISOString(),
    signals: { stem: 100, optionsSet: 0, optionsOrdered: 0, correctAnswer: 0, specialty: 0, topic: 0 },
  }));
  return { status: 'flagged' as const, detectorVersion: 'import-stem-v1', sourceFingerprint: duplicateFingerprint(incoming), detectedAt: new Date().toISOString(), candidates: matches };
}
