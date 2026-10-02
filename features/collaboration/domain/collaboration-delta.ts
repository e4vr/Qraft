import type { CollaborationState } from '@/lib/medguard-types';

export const deltaCollections = {
  questionProposals: 'proposals',
  sharedQuestions: 'approvedQuestions',
  qbankSpecialties: 'specialties',
  qbankTopics: 'topics',
  answerStats: 'answerStats',
  sharedNotes: 'sharedNotes',
} as const;

export type CollaborationCursor = { version: 1; sequence: number; uid: string; scope: string };
export type CollaborationDelta = {
  cursor: CollaborationCursor;
  syncedAt: string;
  resetBanks: string[];
  catalog: Pick<CollaborationState, 'qbanks' | 'qbankFolders' | 'memberships'>;
  changes: Pick<CollaborationState, typeof deltaCollections[keyof typeof deltaCollections] | 'classificationRevisions'>;
  removed: Array<{ collection: keyof typeof deltaCollections; id: string }>;
};
export type CollaborationReadResponse =
  | { collaboration: CollaborationState; cursor: CollaborationCursor }
  | { delta: CollaborationDelta };

// Apply to a confirmed server snapshot. Unsaved drafts are merged separately by
// the existing three-way merge; tombstones must never resurrect local records.
export function applyCollaborationDelta(base: CollaborationState, delta: CollaborationDelta): CollaborationState {
  const next = { ...base, ...delta.catalog, lastSyncAt: delta.syncedAt, classificationRevisions: delta.changes.classificationRevisions };
  const resetBanks = new Set(delta.resetBanks);
  for (const [collection, field] of Object.entries(deltaCollections)) {
    const removed = new Set(delta.removed.filter(item => item.collection === collection).map(item => item.id));
    if (field === 'answerStats' || field === 'sharedNotes') {
      const values = Object.fromEntries(Object.entries(base[field]).filter(([, item]) => !resetBanks.has(item.qbankId)));
      for (const id of removed) delete values[id];
      Object.assign(values, delta.changes[field]);
      // Each field has a distinct value type; the values retain that type.
      Object.assign(next, { [field]: values });
    } else {
      const values = new Map(base[field].filter(item => !removed.has(item.id) && !resetBanks.has(item.qbankId ?? 'smle-gs')).map(item => [item.id, item]));
      for (const item of delta.changes[field]) values.set(item.id, item);
      Object.assign(next, { [field]: [...values.values()] });
    }
  }
  return next;
}
