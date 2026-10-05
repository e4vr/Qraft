import { env } from 'cloudflare:workers';
import type { MemberProfile } from '@/lib/medguard-types';
import { json } from '@/server/http/response';
import {
  DELETED_USER_ID,
  isDeletedAccountProfile,
} from '../domain/deleted-registration';

export async function deletedUserIdentityStatement(now: string) {
  const existing = await env.DB.prepare(
    'SELECT email,password_hash,password_salt,totp_secret,profile_json FROM profiles WHERE uid=?',
  )
    .bind(DELETED_USER_ID)
    .first<{
      email: string;
      password_hash: string;
      password_salt: string;
      totp_secret: string | null;
      profile_json: string;
    }>();
  const storedProfile = existing
    ? (JSON.parse(existing.profile_json) as MemberProfile)
    : undefined;
  if (
    existing &&
    (existing.email !== `${DELETED_USER_ID}@deleted.invalid` ||
      existing.password_hash !== '!' ||
      existing.password_salt !== '!' ||
      existing.totp_secret ||
      storedProfile?.uid !== DELETED_USER_ID ||
      storedProfile.email !== existing.email ||
      !isDeletedAccountProfile(storedProfile))
  )
    throw json(
      { error: 'The historical Deleted user identity is not safe to use.' },
      409,
    );
  const profile: MemberProfile = {
    uid: DELETED_USER_ID,
    email: `${DELETED_USER_ID}@deleted.invalid`,
    displayName: 'Deleted user',
    universityId: '',
    role: 'student',
    status: 'rejected',
    suspended: true,
    tier: 'free',
    platformRoles: [],
    createdAt: now,
    deletedAt: now,
  };
  return env.DB.prepare(`INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(uid) DO NOTHING`).bind(
    DELETED_USER_ID,
    profile.email,
    '!',
    '!',
    JSON.stringify(profile),
    now,
    now,
  );
}

export function historicalIdentityStatements(
  uid: string,
  reviewerId: string,
  receiptId: string,
  preserveLegacyContent = false,
): D1PreparedStatement[] {
  const toShared = (sql: string) =>
    env.DB.prepare(sql).bind(DELETED_USER_ID, uid);
  return [
    // The per-user unique reference must not collapse different people's ledger
    // entries. Preserve its original type in metadata and namespace its key.
    env.DB.prepare(`UPDATE credit_transactions SET user_id=?,
      metadata=json_set(metadata,'$.deletedAccountReferenceType',reference_type),
      reference_type=? || ':' || coalesce(reference_type,'') WHERE user_id=?`).bind(
      DELETED_USER_ID,
      `deleted:${receiptId}`,
      uid,
    ),
    toShared('UPDATE credit_transactions SET created_by=? WHERE created_by=?'),
    env.DB.prepare(`UPDATE contribution_reviews SET author_id=CASE WHEN author_id=? THEN ? ELSE author_id END,
      reviewer_id=CASE WHEN reviewer_id=? THEN ? ELSE reviewer_id END WHERE author_id=? OR reviewer_id=?`).bind(
      uid,
      DELETED_USER_ID,
      uid,
      reviewerId,
      uid,
      uid,
    ),
    env.DB.prepare(
      'UPDATE review_completion_claims SET reviewer_id=? WHERE reviewer_id=?',
    ).bind(reviewerId, uid),
    env.DB.prepare(
      'UPDATE duplicate_pair_decisions SET reviewer_id=? WHERE reviewer_id=?',
    ).bind(reviewerId, uid),
    env.DB.prepare(
      'UPDATE duplicate_resolution_claims SET reviewer_id=? WHERE reviewer_id=?',
    ).bind(reviewerId, uid),
    toShared('UPDATE duplicate_scan_runs SET started_by=? WHERE started_by=?'),
    toShared(
      "UPDATE subscription_events SET user_id=?,email='',name='Deleted user',detail='Account deleted; transaction retained for audit' WHERE user_id=?",
    ),
    toShared('UPDATE subscription_events SET admin_id=? WHERE admin_id=?'),
    toShared('UPDATE access_operations SET user_id=? WHERE user_id=?'),
    toShared('UPDATE access_operations SET actor_id=? WHERE actor_id=?'),
    toShared('UPDATE access_payments SET user_id=? WHERE user_id=?'),
    toShared('UPDATE access_payments SET confirmed_by=? WHERE confirmed_by=?'),
    toShared('UPDATE activation_codes SET redeemed_by=? WHERE redeemed_by=?'),
    toShared('UPDATE activation_codes SET created_by=? WHERE created_by=?'),
    env.DB.prepare('UPDATE activation_codes SET disabled_at=coalesce(disabled_at,?) WHERE bound_user_id=? AND redeemed_at IS NULL').bind(new Date().toISOString(), uid),
    toShared('UPDATE access_grants SET created_by=? WHERE created_by=?'),
    toShared('UPDATE access_grants SET revoked_by=? WHERE revoked_by=?'),
    toShared('UPDATE question_ids SET created_by_id=? WHERE created_by_id=?'),
    toShared('UPDATE ticket_messages SET user_id=? WHERE user_id=?'),
    // Only legacy inert profiles may carry retained content. Self-deletion
    // preserves its existing personal-test/import cleanup through FK cascades.
    ...(preserveLegacyContent
      ? [
          toShared(
            "UPDATE preformed_tests SET owner_id=?,owner_name='Deleted user' WHERE owner_id=?",
          ),
          toShared('UPDATE json_import_runs SET user_id=? WHERE user_id=?'),
          toShared('UPDATE json_import_attempts SET user_id=? WHERE user_id=?'),
          toShared('UPDATE imported_files SET user_id=? WHERE user_id=?'),
          toShared('UPDATE import_batches SET user_id=? WHERE user_id=?'),
          toShared('UPDATE media SET owner_id=? WHERE owner_id=?'),
          toShared('UPDATE tickets SET user_id=? WHERE user_id=?'),
        ]
      : []),
    toShared(
      'UPDATE admin_plan_entitlements SET granted_by=? WHERE granted_by=?',
    ),
    toShared(
      'UPDATE json_import_suspensions SET created_by=? WHERE created_by=?',
    ),
    toShared(
      'UPDATE json_import_suspensions SET removed_by=? WHERE removed_by=?',
    ),
    toShared(
      'UPDATE account_plan_overrides SET updated_by=? WHERE updated_by=?',
    ),
    toShared(
      'UPDATE account_access_revisions SET revoked_by=? WHERE revoked_by=?',
    ),
  ];
}
