import { env } from 'cloudflare:workers';
import type { AppUser, QBank } from '@/lib/medguard-types';

// Keep a small tombstone so old offline clients cannot recreate a deleted bank,
// and so retries can be authorized against its original owner.
export function bankDeletionStatements(
  user: AppUser,
  bank: QBank,
  now: string,
) {
  const id = bank.id;
  return [
    env.DB.prepare(`INSERT INTO records(type,id,owner_id,payload,updated_at)
      VALUES('qbankTombstones',?,?,CASE WHEN ? OR EXISTS (
        SELECT 1 FROM records WHERE type='qbanks' AND id=?
          AND coalesce(json_extract(payload,'$.ownerId'),json_extract(payload,'$.createdById'))=?
      ) OR EXISTS (
        SELECT 1 FROM records WHERE type='qbankTombstones' AND id=? AND owner_id=?
      ) THEN ? ELSE NULL END,?) ON CONFLICT(type,id) DO NOTHING`).bind(
      id,
      bank.ownerId,
      user.role === 'super_admin' ? 1 : 0,
      id,
      user.uid,
      id,
      user.uid,
      JSON.stringify({
        id,
        ownerId: bank.ownerId,
        deletedById: user.uid,
        deletedAt: now,
      }),
      now,
    ),
    env.DB.prepare(
      "UPDATE media SET status='delete_pending',updated_at=? WHERE qbank_id=? AND status='ready'",
    ).bind(now, id),
    env.DB.prepare(
      "DELETE FROM review_completion_claims WHERE proposal_id IN (SELECT id FROM records WHERE type='questionProposals' AND qbank_id=?)",
    ).bind(id),
    env.DB.prepare(`DELETE FROM records WHERE qbank_id=?
      OR (type='qbanks' AND id=?)
      OR (type='qbankShareLinks' AND json_extract(payload,'$.qbankId')=?)`).bind(
      id,
      id,
      id,
    ),
    ...[
      'qbank_classification_revisions',
      'classification_operations',
      'question_ids',
      'duplicate_pair_decisions',
      'duplicate_scan_runs',
    ].map((table) =>
      env.DB.prepare(`DELETE FROM ${table} WHERE qbank_id=?`).bind(id),
    ),
    // Historical ready-made exams and personal answers are independent records.
    env.DB.prepare(`INSERT INTO records(type,id,owner_id,payload,updated_at)
      VALUES('auditLog',?,?,?,?) ON CONFLICT(type,id) DO NOTHING`).bind(
      `qbank-deleted-${id}`,
      user.uid,
      JSON.stringify({
        id: `qbank-deleted-${id}`,
        action: 'qbank_deleted',
        entityType: 'qbank',
        entityId: id,
        actorId: user.uid,
        actorName: user.displayName,
        createdAt: now,
        detail: JSON.stringify({
          previous: { ownerId: bank.ownerId },
          next: null,
          status: 'success',
        }),
      }),
      now,
    ),
  ];
}
