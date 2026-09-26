import type {
  AppUser,
  BankRole,
  MemberProfile,
  PlatformRole,
  QBank,
  QBankMembership,
} from '@/lib/medguard-types';

type RoleSubject = Pick<AppUser | MemberProfile, 'role' | 'platformRoles'>;

export const PLATFORM_ROLES = [
  'moderator',
  'reviewer',
  'access_manager',
] as const satisfies readonly PlatformRole[];

export function isPlatformRole(value: unknown): value is PlatformRole {
  return PLATFORM_ROLES.includes(value as PlatformRole);
}

export function hasModeratorRole(user: RoleSubject): boolean {
  return (
    user.role === 'super_admin' ||
    user.role === 'admin' ||
    user.platformRoles.includes('moderator')
  );
}

export function hasReviewerRole(user: RoleSubject): boolean {
  return (
    hasModeratorRole(user) ||
    user.role === 'reviewer' ||
    user.platformRoles.includes('reviewer')
  );
}

export function hasAccessManagerRole(user: RoleSubject): boolean {
  return (
    hasModeratorRole(user) ||
    user.role === 'access_manager' ||
    user.platformRoles.includes('access_manager')
  );
}

export function administrativeRoleLabels(user: RoleSubject): string[] {
  if (hasModeratorRole(user)) return ['Moderator'];
  const labels: string[] = [];
  if (hasReviewerRole(user)) labels.push('Reviewer');
  if (hasAccessManagerRole(user)) labels.push('Access Manager');
  return labels;
}

export function bankRoleFor(
  user: AppUser,
  bank: QBank,
  memberships: QBankMembership[],
): BankRole | undefined {
  if (bank.ownerId === user.uid) return 'owner';
  const role = memberships.find(
    (item) => item.qbankId === bank.id && item.userId === user.uid,
  )?.role;
  return isBankMembershipRole(role) ? role : undefined;
}

export function isBankMembershipRole(
  value: unknown,
): value is Exclude<BankRole, 'owner'> {
  return value === 'editor' || value === 'reviewer' || value === 'viewer';
}

export function canAccessBank(
  user: AppUser,
  bank: QBank,
  memberships: QBankMembership[],
): boolean {
  return (
    user.role === 'super_admin' ||
    bank.visibility === 'public' ||
    Boolean(bankRoleFor(user, bank, memberships))
  );
}

export function canManageBank(user: AppUser, bank: QBank): boolean {
  if (bank.essential || bank.id === 'smle-gs')
    return user.role === 'super_admin';
  return bank.ownerId === user.uid;
}

export function canEditBank(
  user: AppUser,
  bank: QBank,
  memberships: QBankMembership[],
): boolean {
  if (canManageBank(user, bank)) return true;
  if (bank.essential || bank.id === 'smle-gs') return false;
  return bankRoleFor(user, bank, memberships) === 'editor';
}

export function canReviewBank(
  user: AppUser,
  bank: QBank,
  memberships: QBankMembership[],
): boolean {
  if (user.role === 'super_admin') return true;
  const bankRole = bankRoleFor(user, bank, memberships);
  if (
    bankRole === 'owner' ||
    bankRole === 'editor' ||
    bankRole === 'reviewer'
  )
    return true;
  return bank.visibility === 'public' && hasReviewerRole(user);
}
