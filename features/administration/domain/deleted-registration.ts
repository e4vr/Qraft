import type { AppUser, MemberProfile } from '@/lib/medguard-types';

export const DELETED_USER_ID = 'deleted-user';

export function isDeletedAccountProfile(profile: MemberProfile): boolean {
  return (
    profile.uid.startsWith('deleted-') &&
    profile.email === `${profile.uid}@deleted.invalid` &&
    Boolean(
      profile.deletedAt && Number.isFinite(Date.parse(profile.deletedAt)),
    ) &&
    profile.role === 'student' &&
    profile.status === 'rejected' &&
    profile.suspended === true &&
    (profile.platformRoles ?? []).length === 0
  );
}

/** Preserve authorship centrally and independent review evidence anonymously. */
export function anonymizeDeletedAttribution(
  value: unknown,
  user: Pick<AppUser, 'uid' | 'email' | 'phone' | 'universityId'>,
  reviewerId: string,
): unknown {
  if (typeof value === 'string') {
    if (value === user.uid) return DELETED_USER_ID;
    if (
      value === user.email ||
      value === user.phone ||
      value === user.universityId
    )
      return '';
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        return JSON.stringify(
          anonymizeDeletedAttribution(JSON.parse(value), user, reviewerId),
        );
      } catch {
        /* ordinary text */
      }
    }
    return value;
  }
  if (Array.isArray(value))
    return value.map((item) =>
      anonymizeDeletedAttribution(item, user, reviewerId),
    );
  if (!value || typeof value !== 'object') return value;
  const original = value as Record<string, unknown>;
  const next = Object.fromEntries(
    Object.entries(original).map(([key, item]) => [
      key,
      anonymizeDeletedAttribution(item, user, reviewerId),
    ]),
  );
  for (const [idKey, nameKey] of Object.entries({
    uid: 'displayName',
    userId: 'userName',
    ownerId: 'ownerName',
    actorId: 'actorName',
    writtenById: 'writtenByName',
    reviewedById: 'reviewedByName',
    reviewerId: 'reviewerName',
    proposedById: 'proposedByName',
    createdById: 'createdByName',
    grantedById: 'grantedByName',
    invitedById: 'invitedByName',
    editedById: 'editedByName',
    updatedById: 'updatedByName',
    approvedById: 'approvedByName',
    claimedById: 'claimedByName',
  })) {
    if (original[idKey] === user.uid) {
      next[idKey] = idKey === 'reviewerId' ? reviewerId : DELETED_USER_ID;
      next[nameKey] = 'Deleted user';
    }
  }
  if (original.uid === user.uid || original.userId === user.uid) {
    for (const key of [
      'email',
      'userEmail',
      'phone',
      'universityId',
      'passwordHash',
      'passwordSalt',
      'totpSecret',
    ])
      if (key in next) next[key] = '';
  }
  for (const key of ['viewerIds', 'reviewerIds'])
    if (Array.isArray(original[key]))
      next[key] = original[key].filter((id) => id !== user.uid);
  return next;
}
