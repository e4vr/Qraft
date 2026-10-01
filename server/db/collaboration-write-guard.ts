export type CollaborationWriteSnapshot = { collection: string; id: string; payload: string | null };

export function collaborationWriteGuard(db: D1Database, snapshots: CollaborationWriteSnapshot[], id: string): D1PreparedStatement {
  // This assertion executes inside the SAME atomic batch as every write and
  // audit entry. Reads before the batch alone cannot prevent concurrent loss.
  return db.prepare(`INSERT INTO collaboration_write_guards(id,valid)
    SELECT ?, CASE WHEN EXISTS (
      SELECT 1 FROM json_each(?) AS expected
      LEFT JOIN records AS record INDEXED BY idx_records_type_id
        ON record.type=json_extract(expected.value,'$.collection')
        AND record.id=json_extract(expected.value,'$.id')
      LEFT JOIN profiles AS profile
        ON json_extract(expected.value,'$.collection')='profiles'
        AND profile.uid=json_extract(expected.value,'$.id')
      WHERE CASE WHEN json_extract(expected.value,'$.collection')='profiles'
        THEN profile.profile_json ELSE record.payload END
        IS NOT json_extract(expected.value,'$.payload')
    ) THEN 0 ELSE 1 END`).bind(id, JSON.stringify(snapshots));
}
