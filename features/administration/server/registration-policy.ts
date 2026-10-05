import { env } from 'cloudflare:workers';
import type { AppUser, AuditEntry } from '@/lib/medguard-types';
import { assertSameOrigin, readJson } from '@/server/http/request';
import { json } from '@/server/http/response';
import { publishChanges } from '@/lib/realtime-server';
import {
  pendingRegistrationApprovalStatements,
  notifyApprovedRegistrations,
} from '@/features/auth/server/registration-approval';
import {
  DEFAULT_REGISTRATION_POLICY,
  REGISTRATION_POLICY_ID,
  normalizeRegistrationPolicy,
  type RegistrationPolicy,
} from '../domain/registration-policy';

export async function registrationPolicy(): Promise<RegistrationPolicy> {
  const row = await env.DB.prepare(
    "SELECT payload FROM records WHERE type='system' AND id=?",
  )
    .bind(REGISTRATION_POLICY_ID)
    .first<{ payload: string }>();
  return row
    ? normalizeRegistrationPolicy(
        JSON.parse(row.payload) as Partial<RegistrationPolicy>,
      )
    : { ...DEFAULT_REGISTRATION_POLICY };
}

// operationsApi checks approved Superadmin status and enrolled, verified MFA.
export async function registrationPolicyApi(request: Request, user: AppUser) {
  if (request.method === 'GET') return json(await registrationPolicy());
  if (request.method !== 'PUT')
    return json({ error: 'Method not allowed.' }, 405);
  assertSameOrigin(request);
  const input = await readJson<{
    autoApproveUniversityIds?: unknown;
    revision?: unknown;
  }>(request, 1000);
  if (
    typeof input.autoApproveUniversityIds !== 'boolean' ||
    typeof input.revision !== 'number' ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0
  )
    return json(
      { error: 'Choose a valid approval setting and revision.' },
      400,
    );
  const previous = await registrationPolicy();
  if (input.revision !== previous.revision)
    return json(
      {
        error:
          'Registration settings changed. Review the latest setting before saving.',
        policy: previous,
      },
      409,
    );
  if (input.autoApproveUniversityIds === previous.autoApproveUniversityIds)
    return json({ ...previous, unchanged: true }, 200, {
      'x-qraft-unchanged': '1',
    });
  const now = new Date().toISOString(),
    writeId = crypto.randomUUID();
  const next: RegistrationPolicy = {
    autoApproveUniversityIds: input.autoApproveUniversityIds,
    revision: previous.revision + 1,
    updatedAt: now,
  };
  const payload = { ...next, updatedById: user.uid, writeId };
  const audit: AuditEntry = {
    id: crypto.randomUUID(),
    action: 'registration_policy_changed',
    entityType: 'admin',
    entityId: REGISTRATION_POLICY_ID,
    actorId: user.uid,
    actorName: user.displayName,
    createdAt: now,
    detail: JSON.stringify({ previous, next }),
  };
  const approvalStatements = next.autoApproveUniversityIds
    ? pendingRegistrationApprovalStatements(now, { writeId })
    : [];
  const results = await env.DB.batch<{ uid: string }>([
    env.DB.prepare(`INSERT INTO records(type,id,payload,updated_at)
      SELECT 'system',?,?,? WHERE coalesce((SELECT json_extract(payload,'$.revision') FROM records WHERE type='system' AND id=?),0)=?
      ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at
      WHERE coalesce(json_extract(records.payload,'$.revision'),0)=?`).bind(
      REGISTRATION_POLICY_ID,
      JSON.stringify(payload),
      now,
      REGISTRATION_POLICY_ID,
      input.revision,
      input.revision,
    ),
    ...approvalStatements,
    env.DB.prepare(`INSERT INTO records(type,id,owner_id,payload,updated_at)
      SELECT 'auditLog',?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE type='system' AND id=? AND json_extract(payload,'$.writeId')=?)`).bind(
      audit.id,
      user.uid,
      JSON.stringify(audit),
      now,
      REGISTRATION_POLICY_ID,
      writeId,
    ),
  ]);
  if (!results[0].meta.changes)
    return json(
      {
        error:
          'Registration settings changed. Review the latest setting before saving.',
        policy: await registrationPolicy(),
      },
      409,
    );
  const approvedIds = approvalStatements.length
    ? (results[2].results ?? []).map((row) => row.uid)
    : [];
  await notifyApprovedRegistrations(approvedIds);
  await publishChanges(
    ['admin'],
    ['registration-policy', 'audit'],
    request.headers.get('x-qraft-client-id') ?? '',
  );
  return json({ ...next, approvedCount: approvedIds.length });
}
