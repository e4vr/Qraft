import { randomUUID } from 'node:crypto';

// Fixture-only access: a profile tier is deliberately no longer an entitlement.
export async function seedFullAccess(db, uid, plan = 'full_monthly') {
  const id = randomUUID(),
    now = new Date().toISOString();
  await db
    .prepare(`INSERT INTO access_grants(id,user_id,source,source_id,label,plan,duration,duration_unit,starts_at,expires_at,created_at,created_by)
    VALUES(?,?,'fixture',?,'Synthetic Full Access',?,1,'year',?,?,?,'admin')`)
    .bind(
      'fixture-' + id,
      uid,
      id,
      plan,
      now,
      new Date(Date.now() + 365 * 86400000).toISOString(),
      now,
    )
    .run();
}
