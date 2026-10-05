import { env } from 'cloudflare:workers';
import type { AppUser, AuditEntry, MemberProfile } from '@/lib/medguard-types';
import { publishChanges } from '@/lib/realtime-server';
import { assertSameOrigin, readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import {
  DELETED_USER_ID,
  anonymizeDeletedAttribution,
  isDeletedAccountProfile,
} from '../domain/deleted-registration';
import {
  deletedUserIdentityStatement,
  historicalIdentityStatements,
} from './deleted-user-identity';

type Row = {
  type: string;
  id: string;
  owner_id: string | null;
  email: string | null;
  qbank_id: string | null;
  payload: string;
};

// Called only after operationsApi has verified an approved Superadmin with MFA.
export async function removeDeletedRegistration(
  request: Request,
  user: AppUser,
) {
  assertSameOrigin(request);
  const input = await readJson<{ userId?: unknown; confirmation?: unknown }>(
    request,
    1000,
  );
  if (
    typeof input.userId !== 'string' ||
    input.userId.length > 200 ||
    input.userId === DELETED_USER_ID ||
    input.confirmation !== 'DELETE'
  )
    return json(
      { error: 'Choose a legacy deleted account and confirm DELETE.' },
      400,
    );
  const row =
    await env.DB.prepare(`SELECT p.uid,p.email,p.password_hash,p.password_salt,p.totp_secret,p.profile_json,
    d.snapshot_valid AS deletion_confirmed FROM profiles p LEFT JOIN account_deletions d ON d.id=p.uid WHERE p.uid=?`)
      .bind(input.userId)
      .first<{
        uid: string;
        email: string;
        password_hash: string;
        password_salt: string;
        totp_secret: string | null;
        profile_json: string;
        deletion_confirmed: number | null;
      }>();
  if (!row) {
    const receipt = await env.DB.prepare(
      'SELECT id FROM account_deletions WHERE id=? AND snapshot_valid=1',
    )
      .bind(input.userId)
      .first();
    return receipt
      ? json({ ok: true, userId: input.userId, unchanged: true }, 200, {
          'x-qraft-unchanged': '1',
        })
      : json({ error: 'Account record not found.' }, 404);
  }
  const profile = JSON.parse(row.profile_json) as MemberProfile;
  if (
    row.deletion_confirmed !== 1 ||
    row.uid !== profile.uid ||
    row.email !== profile.email ||
    row.password_hash !== '!' ||
    row.password_salt !== '!' ||
    row.totp_secret ||
    !isDeletedAccountProfile(profile)
  )
    return json(
      {
        error: 'Only records of already deleted accounts can be consolidated.',
      },
      403,
    );

  const predicate = '(owner_id=? OR email=? OR instr(payload,?)>0)';
  const bindings = [profile.uid, profile.email, profile.uid];
  const rows = (
    await env.DB.prepare(
      `SELECT type,id,owner_id,email,qbank_id,payload FROM records WHERE ${predicate}`,
    )
      .bind(...bindings)
      .all<Row>()
  ).results;
  const snapshot = JSON.stringify(rows),
    now = new Date().toISOString(),
    receiptId = `deleted-merge-${crypto.randomUUID()}`;
  const reviewerId = `deleted-reviewer-${profile.uid.slice('deleted-'.length)}`;
  const changes = rows.map((record) => ({
    type: record.type,
    id: record.id,
    payload: JSON.stringify(
      anonymizeDeletedAttribution(
        JSON.parse(record.payload),
        profile,
        reviewerId,
      ),
    ),
    ownerId:
      record.owner_id === profile.uid ? DELETED_USER_ID : record.owner_id,
    email: record.email === profile.email ? null : record.email,
  }));
  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    action: 'deleted_registration_consolidated',
    entityType: 'account',
    entityId: profile.uid,
    actorId: user.uid,
    actorName: user.displayName,
    createdAt: now,
    detail:
      'Transferred historical attribution to the shared Deleted user identity and removed the legacy account record.',
  };
  const statements: D1PreparedStatement[] = [
    // Compare the exact profile and records inside the same transaction. A
    // concurrent ownership/content change aborts before any transfer or delete.
    env.DB.prepare(`INSERT INTO account_deletions(id,completed_at,snapshot_valid) SELECT ?,?,
      (SELECT profile_json FROM profiles WHERE uid=?) IS ? AND
      (SELECT count(*) FROM records WHERE ${predicate})=json_array_length(?) AND NOT EXISTS (
        SELECT 1 FROM json_each(?) s LEFT JOIN records r ON r.type=json_extract(s.value,'$.type') AND r.id=json_extract(s.value,'$.id')
        WHERE r.payload IS NOT json_extract(s.value,'$.payload') OR r.owner_id IS NOT json_extract(s.value,'$.owner_id')
          OR r.qbank_id IS NOT json_extract(s.value,'$.qbank_id') OR r.email IS NOT json_extract(s.value,'$.email'))`).bind(
      receiptId,
      now,
      profile.uid,
      row.profile_json,
      ...bindings,
      snapshot,
      snapshot,
    ),
    await deletedUserIdentityStatement(now),
  ];
  if (changes.length)
    statements.push(
      env.DB.prepare(`WITH changes AS (
    SELECT r.rowid AS record_rowid,json_extract(c.value,'$.payload') AS payload,json_extract(c.value,'$.ownerId') AS owner_id,json_extract(c.value,'$.email') AS email
    FROM json_each(?) c JOIN records r ON r.type=json_extract(c.value,'$.type') AND r.id=json_extract(c.value,'$.id')
  ) UPDATE records SET payload=c.payload,owner_id=c.owner_id,email=c.email,updated_at=? FROM changes c WHERE records.rowid=c.record_rowid`).bind(
        JSON.stringify(changes),
        now,
      ),
    );
  statements.push(
    ...historicalIdentityStatements(profile.uid, reviewerId, profile.uid, true),
    env.DB.prepare('DELETE FROM subscriptions WHERE user_id=?').bind(
      profile.uid,
    ),
    env.DB.prepare('DELETE FROM test_registry WHERE user_id=?').bind(
      profile.uid,
    ),
    env.DB.prepare('DELETE FROM university_claims WHERE user_id=?').bind(
      profile.uid,
    ),
    env.DB.prepare('DELETE FROM profiles WHERE uid=?').bind(profile.uid),
    env.DB.prepare(
      "INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES('auditLog',?,?,?,?)",
    ).bind(entry.id, user.uid, JSON.stringify(entry), now),
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes('snapshot_valid'))
      return json(
        {
          error:
            'The account or historical content changed. Nothing was removed. Refresh and retry.',
        },
        409,
      );
    throw error;
  }
  await publishChanges(
    ['admin', 'catalog'],
    ['collaboration'],
    request.headers.get('x-qraft-client-id') ?? '',
  );
  return json({ ok: true, userId: profile.uid, audit: entry });
}
