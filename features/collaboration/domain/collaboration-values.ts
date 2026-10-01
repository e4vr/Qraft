import type { CollaborationState } from '@/lib/medguard-types';

export function collaborationValue(state: CollaborationState, collection: string, id: string): unknown {
  const arrays: Record<string, unknown[]> = {
    qbanks: state.qbanks, qbankFolders: state.qbankFolders,
    qbankMemberships: state.memberships, qbankInvitations: state.invitations,
    profiles: state.members, universityIds: state.allowedUniversityIds,
    adminInvites: state.adminInvites, questionProposals: state.proposals,
    roleApplications: state.roleApplications, sharedQuestions: state.approvedQuestions,
    qbankSpecialties: state.specialties, qbankTopics: state.topics, auditLog: state.auditLog,
  };
  if (collection === 'answerStats') return state.answerStats[id];
  if (collection === 'sharedNotes') return state.sharedNotes[id];
  if (collection === 'system' && id === 'accessControl') return state.blockedAccess;
  if (collection === 'system' && id === 'security') return state.security;
  return arrays[collection]?.find(value => {
    if (!value || typeof value !== 'object') return false;
    const item = value as { id?: string; uid?: string };
    return item.id === id || item.uid === id;
  });
}

function canonicalCollaborationValue(input: unknown): string | undefined {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
    return value;
  };
  return JSON.stringify(canonical(input));
}

export function sameCollaborationValue(left: unknown, right: unknown): boolean {
  return canonicalCollaborationValue(left) === canonicalCollaborationValue(right);
}

export async function collaborationBaseHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalCollaborationValue(value ?? null)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
