import { env } from 'cloudflare:workers';
import { currentUser } from '@/features/auth/server/auth-service';
import { assertSameOrigin, readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import type { AppUser, QBank } from './medguard-types';
import { publishChanges } from './realtime-server';

export { cleanPendingMedia as cleanDeletedAccountMedia } from '@/features/media/server/media-cleanup';

type Row = { type: string; id: string; qbank_id: string | null; owner_id: string | null; email: string | null; payload: string };

/** Strip attribution details, including structured JSON nested in audit.detail. */
function anonymize(value: unknown, user: AppUser, anonymousId: string): unknown {
  if (typeof value === 'string') {
    if (value === user.uid) return anonymousId;
    if (value === user.email || value === user.phone || value === user.universityId) return '';
    if (value.startsWith('{') || value.startsWith('[')) {
      try { return JSON.stringify(anonymize(JSON.parse(value), user, anonymousId)); } catch { /* ordinary text */ }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(item => anonymize(item, user, anonymousId));
  if (!value || typeof value !== 'object') return value;
  const original = value as Record<string, unknown>;
  const next = Object.fromEntries(Object.entries(original).map(([key, item]) => [key, anonymize(item, user, anonymousId)]));
  for (const [idKey, nameKey] of Object.entries({ uid: 'displayName', userId: 'userName', ownerId: 'ownerName', actorId: 'actorName', writtenById: 'writtenByName', reviewedById: 'reviewedByName', proposedById: 'proposedByName', createdById: 'createdByName', grantedById: 'grantedByName', invitedById: 'invitedByName', editedById: 'editedByName', updatedById: 'updatedByName', approvedById: 'approvedByName', claimedById: 'claimedByName' })) {
    if (original[idKey] === user.uid) next[nameKey] = 'Deleted user';
  }
  if (original.uid === user.uid || original.userId === user.uid) {
    for (const key of ['email', 'userEmail', 'phone', 'universityId', 'passwordHash', 'passwordSalt', 'totpSecret']) if (key in next) next[key] = '';
  }
  for (const key of ['viewerIds', 'reviewerIds']) if (Array.isArray(original[key])) next[key] = original[key].filter(id => id !== user.uid);
  return next;
}

export async function deleteOwnAccount(request: Request) {
  assertSameOrigin(request);
  const user = await currentUser(request);
  if (!user) return json({ error: 'Sign in to delete your account.' }, 401);
  const input = await readJson<{ confirmation?: string }>(request, 1000);
  if (input.confirmation !== 'DELETE') return json({ error: 'Type DELETE to confirm.' }, 400);
  const successor = await env.DB.prepare("SELECT uid,profile_json FROM profiles WHERE uid<>? AND json_extract(profile_json,'$.role')='super_admin' AND json_extract(profile_json,'$.status')='approved' AND coalesce(json_extract(profile_json,'$.suspended'),0)=0 ORDER BY created_at LIMIT 1")
    .bind(user.uid).first<{ uid: string; profile_json: string }>();
  // Include all access records and content for these banks in the snapshot so a
  // concurrent share cannot turn a deletable bank into someone else's data loss.
  const predicate = `(owner_id=? OR email=? OR instr(payload,?)>0 OR instr(payload,?)>0 OR qbank_id IN (SELECT id FROM records WHERE type='qbanks' AND (json_extract(payload,'$.ownerId')=? OR json_extract(payload,'$.createdById')=?)))`;
  const bindings = [user.uid, user.email, user.uid, user.email, user.uid, user.uid];
  const rows = (await env.DB.prepare(`SELECT type,id,qbank_id,owner_id,email,payload FROM records WHERE ${predicate}`).bind(...bindings).all<Row>()).results;
  const banks = rows.filter(row => row.type === 'qbanks').map(row => JSON.parse(row.payload) as QBank);
  const deletedBanks = new Set<string>();
  const ownedTests = await env.DB.prepare('SELECT id FROM preformed_tests WHERE owner_id=?')
    .bind(user.uid).all<{ id: string }>();
  const deletedMediaScopes = ownedTests.results.map(test => `preformed-${test.id}`);
  const transferredBanks = new Set<string>();
  for (const bank of banks) {
    if (bank.ownerId !== user.uid && bank.createdById !== user.uid) continue;
    const shared = bank.shareEnabled || bank.viewerIds.some(id => id !== user.uid) || bank.reviewerIds.some(id => id !== user.uid) || rows.some(row => row.qbank_id === bank.id && (
      (row.type === 'qbankMemberships' && JSON.parse(row.payload).userId !== user.uid) || row.type === 'qbankInvitations'));
    // A bank already transferred to another owner is always retained.
    if (bank.visibility === 'private' && !shared && bank.ownerId === user.uid && !bank.essential) deletedBanks.add(bank.id);
    else if (bank.ownerId === user.uid) transferredBanks.add(bank.id);
  }
  if ((user.role === 'super_admin' || transferredBanks.size) && !successor)
    return json({ error: 'Another active Superadmin is required to preserve administration and shared QBanks. Assign a successor before deleting this account.' }, 409);
  const now = new Date().toISOString();
  const anonymousId = `deleted-${crypto.randomUUID()}`;
  const anonymousProfile = { uid: anonymousId, email: `${anonymousId}@deleted.invalid`, displayName: 'Deleted user', role: 'student', status: 'rejected', suspended: true, isAdmin: false, provider: 'cloudflare', tier: 'free', platformRoles: [], deletedAt: now };
  const successorName = successor ? (JSON.parse(successor.profile_json) as AppUser).displayName : '';
  const snapshot = JSON.stringify(rows);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO account_deletions(id,completed_at,snapshot_valid) SELECT ?,?,
      (SELECT count(*) FROM records WHERE ${predicate})=json_array_length(?) AND NOT EXISTS (
        SELECT 1 FROM json_each(?) s LEFT JOIN records r ON r.type=json_extract(s.value,'$.type') AND r.id=json_extract(s.value,'$.id')
        WHERE r.payload IS NOT json_extract(s.value,'$.payload') OR r.owner_id IS NOT json_extract(s.value,'$.owner_id') OR r.qbank_id IS NOT json_extract(s.value,'$.qbank_id') OR r.email IS NOT json_extract(s.value,'$.email'))`)
      .bind(anonymousId, now, ...bindings, snapshot, snapshot),
    // This inert identity exists solely for historical foreign keys. It has no
    // usable credentials, sessions, roles, entitlements or personal information.
    env.DB.prepare('INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .bind(anonymousId, anonymousProfile.email, '!', '!', JSON.stringify(anonymousProfile), now, now),
  ];
  if (successor && transferredBanks.size) statements.push(env.DB.prepare(`UPDATE account_deletions SET snapshot_valid=EXISTS(
    SELECT 1 FROM profiles WHERE uid=? AND json_extract(profile_json,'$.role')='super_admin'
      AND json_extract(profile_json,'$.status')='approved' AND coalesce(json_extract(profile_json,'$.suspended'),0)=0
  ) WHERE id=?`).bind(successor.uid, anonymousId));
  const deletes: Array<{ type: string; id: string }> = [];
  const updates: Array<{ type: string; id: string; payload: string; ownerId: string | null; email: string | null }> = [];
  const deletedQuestions = new Set(rows.filter(row => row.type === 'sharedQuestions' && row.qbank_id && deletedBanks.has(row.qbank_id)).map(row => row.id));
  for (const row of rows) {
    const original = JSON.parse(row.payload) as Record<string, unknown>;
    const remove = (row.qbank_id && deletedBanks.has(row.qbank_id) && !['auditLog', 'questionProposals'].includes(row.type)) || (row.type === 'qbanks' && deletedBanks.has(row.id)) ||
      (['qbankMemberships', 'roleApplications', 'reviewHistoryPreferences'].includes(row.type) && (original.userId === user.uid || row.owner_id === user.uid)) ||
      (['qbankInvitations', 'adminInvites'].includes(row.type) && (row.email === user.email || original.email === user.email));
    if (remove) { deletes.push({ type: row.type, id: row.id }); continue; }
    const next = anonymize(original, user, anonymousId) as Record<string, unknown>;
    let ownerId = row.owner_id === user.uid ? anonymousId : row.owner_id;
    if ((row.type === 'qbanks' && transferredBanks.has(row.id)) || (row.type === 'qbankShareLinks' && transferredBanks.has(String(original.qbankId)))) {
      next.ownerId = successor!.uid; next.ownerName = successorName; ownerId = successor!.uid;
    }
    if (row.type === 'universityIds' && original.claimedById === user.uid) { next.claimedById = null; next.claimedByName = null; }
    if (row.type === 'questionProposals' && deletedQuestions.has(String(original.questionId))) next.questionId = '#deleted';
    if (row.type === 'auditLog' && deletedQuestions.has(String(original.entityId))) next.entityId = '#deleted';
    updates.push({ type: row.type, id: row.id, payload: JSON.stringify(next), ownerId, email: row.email === user.email ? null : row.email });
  }
  if (deletes.length) statements.push(env.DB.prepare(`DELETE FROM records WHERE rowid IN (
    SELECT r.rowid FROM json_each(?) d JOIN records r ON r.type=json_extract(d.value,'$.type') AND r.id=json_extract(d.value,'$.id')
  )`).bind(JSON.stringify(deletes)));
  if (updates.length) statements.push(env.DB.prepare(`WITH changes AS (
    SELECT r.rowid AS record_rowid,json_extract(u.value,'$.payload') AS payload,json_extract(u.value,'$.ownerId') AS owner_id,json_extract(u.value,'$.email') AS email
    FROM json_each(?) u JOIN records r ON r.type=json_extract(u.value,'$.type') AND r.id=json_extract(u.value,'$.id')
  ) UPDATE records SET payload=c.payload,owner_id=c.owner_id,email=c.email,updated_at=? FROM changes c WHERE records.rowid=c.record_rowid`)
    .bind(JSON.stringify(updates), now));
  const bindUser = (sql: string) => env.DB.prepare(sql).bind(user.uid);
  statements.push(
    // Legacy participation has no attributable per-question counts. Reset only
    // those affected aggregates; new participation can be subtracted exactly.
    bindUser(`DELETE FROM preformed_question_stats WHERE test_id IN (
      SELECT p.test_id FROM preformed_participation p WHERE p.user_id=? AND
        p.attempts > coalesce((SELECT max(s.submissions) FROM preformed_participant_question_stats s
          WHERE s.user_id=p.user_id AND s.test_id=p.test_id AND s.version=p.version),0)
    )`),
    bindUser(`WITH removed AS (
      SELECT test_id,version,question_id,submissions,correct
      FROM preformed_participant_question_stats WHERE user_id=?
    ) UPDATE preformed_question_stats AS s SET
      submissions=max(0,s.submissions-r.submissions),correct=max(0,s.correct-r.correct)
      FROM removed r WHERE s.test_id=r.test_id AND s.version=r.version AND s.question_id=r.question_id`),
    bindUser('DELETE FROM preformed_leaderboard WHERE participant_user_id=?'),
    bindUser('DELETE FROM preformed_submission_receipts WHERE user_id=?'),
    bindUser('DELETE FROM preformed_attempt_tokens WHERE user_id=?'),
    bindUser('DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id=?)'),
    bindUser('DELETE FROM tickets WHERE user_id=?'),
    env.DB.prepare('UPDATE ticket_messages SET user_id=? WHERE user_id=?').bind(anonymousId, user.uid),
    bindUser('DELETE FROM subscriptions WHERE user_id=?'), bindUser('DELETE FROM test_registry WHERE user_id=?'),
    bindUser('DELETE FROM reward_passes WHERE user_id=?'),
    env.DB.prepare('UPDATE credit_transactions SET user_id=? WHERE user_id=?').bind(anonymousId, user.uid),
    env.DB.prepare('UPDATE credit_transactions SET created_by=? WHERE created_by=?').bind(anonymousId, user.uid),
    env.DB.prepare('UPDATE contribution_reviews SET author_id=CASE WHEN author_id=? THEN ? ELSE author_id END,reviewer_id=CASE WHEN reviewer_id=? THEN ? ELSE reviewer_id END WHERE author_id=? OR reviewer_id=?').bind(user.uid, anonymousId, user.uid, anonymousId, user.uid, user.uid),
    env.DB.prepare('UPDATE review_completion_claims SET reviewer_id=? WHERE reviewer_id=?').bind(anonymousId, user.uid),
    env.DB.prepare("UPDATE subscription_events SET user_id=?,email='',name='Deleted user',detail='Account deleted; transaction retained for audit' WHERE user_id=?").bind(anonymousId, user.uid),
    env.DB.prepare('UPDATE subscription_events SET admin_id=? WHERE admin_id=?').bind(anonymousId, user.uid),
    bindUser('DELETE FROM university_claims WHERE user_id=?'), bindUser('DELETE FROM import_batches WHERE user_id=?'),
    env.DB.prepare('UPDATE question_ids SET created_by_id=? WHERE created_by_id=?').bind(anonymousId, user.uid),
    // Durable cleanup markers survive object storage failures after D1 commits.
    env.DB.prepare("UPDATE media SET status=CASE WHEN purpose IN ('note','notes') OR qbank_id IN (SELECT value FROM json_each(?)) THEN 'account_deleted' ELSE status END,expires_at=CASE WHEN purpose IN ('note','notes') OR qbank_id IN (SELECT value FROM json_each(?)) THEN ? ELSE expires_at END,owner_id=?,original_name=NULL WHERE owner_id=?")
      .bind(JSON.stringify([...deletedBanks, ...deletedMediaScopes]), JSON.stringify([...deletedBanks, ...deletedMediaScopes]), now, anonymousId, user.uid),
    bindUser('DELETE FROM profiles WHERE uid=?'),
  );
  try { await env.DB.batch(statements); }
  catch (error) {
    if (String(error).includes('snapshot_valid')) return json({ error: 'Your shared data changed. Nothing was deleted. Please try again.' }, 409);
    throw error;
  }
  await publishChanges(['catalog', 'admin'], ['preformed-tests', 'collaboration'], request.headers.get('x-qraft-client-id') ?? '');
  return json({ ok: true }, 200, { 'set-cookie': '__Host-qraft_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
}
