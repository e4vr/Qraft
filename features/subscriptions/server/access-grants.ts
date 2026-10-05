import { env } from 'cloudflare:workers';
import type { AppUser } from '@/lib/medguard-types';
import { accessGenerationSql } from './access-sources';

type Actor = Pick<AppUser, 'uid' | 'displayName'>;
function auditPayload(actor: Actor, id: string, action: string, target: string, now: string) {
  return JSON.stringify({ id, action, entityType: 'account', entityId: target,
    actorId: actor.uid, actorName: actor.displayName, createdAt: now });
}

export async function revokeCurrentAccess(actor: Actor, uid: string, reason: string, requestId: string) {
  const now = new Date().toISOString(), auditId = `access-revoke-${uid}-${requestId}`;
  // The audit ID is the durable retry key. A replay cannot revoke a gift that
  // activated after this request, even if another revocation happened meanwhile.
  const missingAudit = "NOT EXISTS(SELECT 1 FROM records WHERE type='auditLog' AND id=?)";
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO account_access_revisions(user_id,generation,revoked_at,revoked_by)
      SELECT ?,1,?,? WHERE ${missingAudit}
      ON CONFLICT(user_id) DO UPDATE SET generation=account_access_revisions.generation+1,
        revoked_at=excluded.revoked_at,revoked_by=excluded.revoked_by`).bind(uid, now, actor.uid, auditId),
    env.DB.prepare(`INSERT INTO account_plan_overrides(user_id,plan,expires_at,reason,updated_by,updated_at,access_generation)
      SELECT ?,'free',NULL,?,?,?,${accessGenerationSql('?')} WHERE ${missingAudit}
      ON CONFLICT(user_id) DO UPDATE SET plan='free',expires_at=NULL,reason=excluded.reason,
        updated_by=excluded.updated_by,updated_at=excluded.updated_at,access_generation=excluded.access_generation`)
      .bind(uid, reason, actor.uid, now, uid, auditId),
    env.DB.prepare(`INSERT INTO records(type,id,owner_id,payload,updated_at)
      SELECT 'auditLog',?,?,json_set(?,'$.detail',printf('%s',json_object(
        'previous',json_object('accessRevision',a.generation-1),
        'next',json_object('plan','free','accessRevision',a.generation,'reason',?), 'status','success'))),?
      FROM account_access_revisions a WHERE a.user_id=? AND ${missingAudit}`)
      .bind(auditId, actor.uid, auditPayload(actor, auditId, 'subscription_plan_overridden', uid, now), reason, now, uid, auditId),
  ]);
  return { unchanged: !results[0].meta.changes };
}

export async function activateRewardAccess(actor: Actor, pass: { id: string; plan: string }, now: string, expiresAt: string) {
  const activationId = crypto.randomUUID(), auditId = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE reward_passes SET status='active',activated_at=?,expires_at=?,
      access_generation=${accessGenerationSql('?')},metadata=json_set(metadata,'$.activationId',?)
      WHERE id=? AND user_id=? AND status='available'`).bind(now, expiresAt, actor.uid, activationId, pass.id, actor.uid),
    env.DB.prepare(`INSERT INTO records(type,id,owner_id,payload,updated_at)
      SELECT 'auditLog',?,?,json_set(?,'$.detail',printf('%s',json_object('previous',NULL,
        'next',json_object('plan',r.plan,'expiresAt',r.expires_at,'accessRevision',r.access_generation),'status','success'))),?
      FROM reward_passes r WHERE r.id=? AND r.user_id=? AND json_extract(r.metadata,'$.activationId')=?`)
      .bind(auditId, actor.uid, auditPayload(actor, auditId, 'reward_activated', pass.id, now), now, pass.id, actor.uid, activationId),
    env.DB.prepare("UPDATE reward_passes SET status='expired' WHERE user_id=? AND status='active' AND expires_at<=?").bind(actor.uid, now),
  ]);
  return Boolean(results[0].meta.changes);
}
