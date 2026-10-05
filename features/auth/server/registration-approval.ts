import { env } from 'cloudflare:workers';
import type { MemberProfile } from '@/lib/medguard-types';
import { REGISTRATION_POLICY_ID } from '@/features/administration/domain/registration-policy';
import { publishChanges } from '@/lib/realtime-server';

const blockedPredicate = `EXISTS(SELECT 1 FROM records b WHERE b.type='system' AND b.id='accessControl' AND (
  EXISTS(SELECT 1 FROM json_each(b.payload,'$.emails') WHERE value=?) OR
  EXISTS(SELECT 1 FROM json_each(b.payload,'$.phones') WHERE value=?) OR
  EXISTS(SELECT 1 FROM json_each(b.payload,'$.universityIds') WHERE value=?)))`;

// Run after the policy/roster write in the same batch. Join through the unique
// university claim so an ID cannot approve a second account. No profile scan or
// background job is needed when importing additional roster IDs.
export function pendingRegistrationApprovalStatements(
  now: string,
  options: { writeId?: string; universityIds?: string[] } = {},
) {
  const eligibility = `SELECT p.uid FROM university_claims c
    JOIN records r ON r.type='universityIds' AND r.id=c.university_id
    JOIN profiles p ON p.uid=c.user_id
    WHERE json_extract(p.profile_json,'$.status')='pending'
      AND json_extract(p.profile_json,'$.role')='student'
      AND json_extract(p.profile_json,'$.universityId')=c.university_id
      AND coalesce(json_extract(r.payload,'$.claimedById'),'') IN ('',p.uid)
      AND (coalesce(json_extract(p.profile_json,'$.suspended'),0)=0
        OR julianday(json_extract(p.profile_json,'$.suspendedUntil'))<=julianday(?))
      AND NOT EXISTS(SELECT 1 FROM records b WHERE b.type='system' AND b.id='accessControl' AND (
        EXISTS(SELECT 1 FROM json_each(b.payload,'$.emails') WHERE value=p.email) OR
        EXISTS(SELECT 1 FROM json_each(b.payload,'$.phones') WHERE value=json_extract(p.profile_json,'$.phone')) OR
        EXISTS(SELECT 1 FROM json_each(b.payload,'$.universityIds') WHERE value=c.university_id)))
      AND EXISTS(SELECT 1 FROM records s WHERE s.type='system' AND s.id=?
        AND json_type(s.payload,'$.autoApproveUniversityIds')='true'
        ${options.writeId ? "AND json_extract(s.payload,'$.writeId')=?" : ''})
      ${options.universityIds ? 'AND c.university_id IN (SELECT value FROM json_each(?))' : ''}`;
  const bindings = [
    now,
    REGISTRATION_POLICY_ID,
    ...(options.writeId ? [options.writeId] : []),
    ...(options.universityIds ? [JSON.stringify(options.universityIds)] : []),
  ];
  return [
    env.DB.prepare(`UPDATE records SET payload=json_set(payload,
      '$.claimedById',(SELECT c.user_id FROM university_claims c WHERE c.university_id=records.id),
      '$.claimedByName',(SELECT json_extract(p.profile_json,'$.displayName') FROM university_claims c JOIN profiles p ON p.uid=c.user_id WHERE c.university_id=records.id),
      '$.claimedAt',(SELECT c.claimed_at FROM university_claims c WHERE c.university_id=records.id)),updated_at=?
      WHERE type='universityIds' AND coalesce(json_extract(payload,'$.claimedById'),'')=''
      AND id IN (SELECT university_id FROM university_claims WHERE user_id IN (${eligibility}))`).bind(
      now,
      ...bindings,
    ),
    env.DB.prepare(`UPDATE profiles SET profile_json=json_set(profile_json,
      '$.status','approved','$.universityIdRegistered',json('true'),'$.approvalMethod','university_id_match',
      '$.approvedByName','Automatic university ID match','$.approvedAt',?),updated_at=?
      WHERE uid IN (${eligibility}) RETURNING uid`).bind(now, now, ...bindings),
  ];
}

export async function notifyApprovedRegistrations(userIds: string[]) {
  if (!userIds.length) return;
  // Include the administrator who initiated the change: their local operation
  // did not contain the server-generated profile approvals.
  await publishChanges(['admin'], ['collaboration']);
  await publishChanges(
    userIds.map((id) => `user:${id}`),
    ['account'],
  );
}

export async function registrationIsBlocked(
  email: string,
  phone: string,
  universityId: string,
) {
  const row = await env.DB.prepare(`SELECT ${blockedPredicate} AS blocked`)
    .bind(email, phone, universityId)
    .first<{ blocked: number }>();
  return row?.blocked === 1;
}

// Evaluate the current policy, roster and blocklist in the registration batch,
// after password hashing. A completed disable cannot be bypassed by an older
// registration request or client-provided status. The claim's unique key and FK
// roll back the entire batch if another registration won the same university ID.
export function registrationProfileStatement(
  profile: MemberProfile,
  password: { hash: string; salt: string },
  now: string,
) {
  return env.DB.prepare(`WITH registration_state AS (SELECT ? AS profile_json,
    EXISTS(SELECT 1 FROM records WHERE type='universityIds' AND id=? AND coalesce(json_extract(payload,'$.claimedById'),'')='') AS matched,
    EXISTS(SELECT 1 FROM records WHERE type='system' AND id=? AND json_type(payload,'$.autoApproveUniversityIds')='true') AS automatic,
    ${blockedPredicate} AS blocked,
    EXISTS(SELECT 1 FROM records WHERE type='universityIds' AND id=? AND coalesce(json_extract(payload,'$.claimedById'),'')<>'') AS claimed)
  INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,created_at,updated_at)
  SELECT ?,?,?,?,CASE WHEN matched AND automatic THEN json_set(profile_json,
    '$.status','approved','$.universityIdRegistered',json('true'),'$.approvalMethod','university_id_match',
    '$.approvedByName','Automatic university ID match','$.approvedAt',?)
    ELSE json_set(profile_json,'$.universityIdRegistered',json(CASE WHEN matched THEN 'true' ELSE 'false' END)) END,?,?
  FROM registration_state WHERE NOT blocked AND NOT claimed RETURNING profile_json`).bind(
    JSON.stringify(profile),
    profile.universityId,
    REGISTRATION_POLICY_ID,
    profile.email,
    profile.phone ?? '',
    profile.universityId,
    profile.universityId,
    profile.uid,
    profile.email,
    password.hash,
    password.salt,
    now,
    now,
    now,
  );
}
