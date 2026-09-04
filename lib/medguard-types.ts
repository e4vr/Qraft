export type TestMode = 'tutor' | 'timed';
export type QuestionStatus = 'new' | 'previous' | 'correct' | 'incorrect' | 'flagged';
export type UserRole = 'super_admin' | 'admin' | 'reviewer' | 'access_manager' | 'student';
export type AccountTier = 'lite' | 'pro';
export type PlatformRole = 'reviewer' | 'access_manager';
export type BankRole = 'owner' | 'reviewer' | 'viewer';
export type QBankVisibility = 'public' | 'private';
export type AccountStatus = 'pending' | 'approved' | 'rejected';
export type ProposalStatus = 'pending' | 'approved' | 'rejected';
export type ProposalEditKind = 'question_text' | 'options' | 'correct_answer' | 'explanation' | 'source' | 'typo_formatting' | 'duplicate' | 'outdated_guideline';

export interface Question {
  id: string;
  questionId: string;
  number: number;
  specialty: string;
  topic: string;
  stem: string;
  options: string[];
  answer: number;
  answerLetter: string;
  sourcePage: number;
  sourceFile: string;
  revision: number;
  isCustom?: boolean;
  qbankId?: string;
  explanation?: string;
  sourceReference?: string;
  images: NoteImage[];
}

export interface HighlightRange {
  start: number;
  end: number;
}

export interface NoteImage {
  id: string;
  url: string;
  name: string;
  caption: string;
}

export interface QuestionProgress {
  attempts: number;
  correctAttempts: number;
  incorrectAttempts: number;
  lastAnswer?: number;
  lastAnsweredAt?: string;
  flagged: boolean;
  highlights: HighlightRange[];
  note: string;
  noteImages: NoteImage[];
}

export interface TestSession {
  id: string;
  title: string;
  mode: TestMode;
  questionIds: string[];
  currentIndex: number;
  answers: Record<string, number>;
  revealed: string[];
  graded: string[];
  startedAt: string;
  updatedAt: string;
  elapsedSeconds?: number;
  timerStartedAt?: string;
  timerPaused?: boolean;
  completedAt?: string;
  status: 'active' | 'completed';
  qbankId?: string;
}

export function optionLabel(index: number): string {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export interface ErrorReport {
  id: string;
  questionId: string;
  message: string;
  suggestedAnswer?: number;
  status: 'open' | 'resolved';
  createdAt: string;
}

export interface RevisionEntry {
  id: string;
  questionId: string;
  previousAnswer: number;
  nextAnswer: number;
  reason: string;
  createdAt: string;
}

export interface AppSettings {
  dailyGoal: number;
  theme: 'light' | 'dark' | 'system';
  autoSync: boolean;
  activeQBankId: string;
}

export interface AppState {
  version: 1;
  progress: Record<string, QuestionProgress>;
  tests: TestSession[];
  reports: ErrorReport[];
  revisions: RevisionEntry[];
  questionOverrides: Record<string, Partial<Question>>;
  customQuestions: Question[];
  settings: AppSettings;
  lastSyncAt?: string;
}

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  provider: 'firebase' | 'local';
  role: UserRole;
  status: AccountStatus;
  universityId?: string;
  phone?: string;
  createdAt?: string;
  tier: AccountTier;
  platformRoles: PlatformRole[];
  suspended?: boolean;
  mfaEnrolled?: boolean;
  mfaVerified?: boolean;
}

export interface QBank {
  id: string;
  name: string;
  shortName: string;
  description: string;
  createdAt: string;
  createdById: string;
  createdByName: string;
  archived: boolean;
  ownerId: string;
  ownerName: string;
  visibility: QBankVisibility;
  shareEnabled: boolean;
  shareToken?: string;
  reviewerIds: string[];
  viewerIds: string[];
}

export interface QBankMembership {
  id: string;
  qbankId: string;
  userId: string;
  userName: string;
  role: BankRole;
  grantedById: string;
  grantedByName: string;
  createdAt: string;
  viaLink?: boolean;
  accessToken?: string;
  inviteId?: string;
}

export interface QBankInvitation {
  id: string;
  qbankId: string;
  email: string;
  role: Exclude<BankRole, 'owner'>;
  invitedById: string;
  invitedByName: string;
  createdAt: string;
  status: 'pending' | 'accepted' | 'revoked';
  acceptedById?: string;
  acceptedAt?: string;
}

export interface MemberProfile {
  uid: string;
  email: string;
  displayName: string;
  universityId: string;
  phone?: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: string;
  tier: AccountTier;
  platformRoles: PlatformRole[];
  suspended?: boolean;
  mfaEnrolled?: boolean;
  approvedAt?: string;
  approvedById?: string;
  approvedByName?: string;
}

export interface AllowedUniversityId {
  id: string;
  addedAt: string;
  addedById: string;
  claimedById?: string | null;
  claimedByName?: string | null;
  claimedAt?: string | null;
}

export interface AccessBlocklist {
  phones: string[];
  universityIds: string[];
  emails: string[];
}

export interface AdminInvite {
  id: string;
  email: string;
  createdAt: string;
  createdById: string;
  createdByName: string;
  status: 'pending' | 'accepted' | 'revoked';
}

export interface QuestionProposalPayload {
  stem: string;
  options: string[];
  answer: number;
  specialty: string;
  topic: string;
  explanation: string;
  sourceReference: string;
  images: NoteImage[];
}

export interface QuestionProposal {
  id: string;
  qbankId: string;
  type: 'new_question' | 'question_edit';
  editKinds: ProposalEditKind[];
  questionId?: string;
  payload: QuestionProposalPayload;
  currentSnapshot?: QuestionProposalPayload;
  rationale: string;
  status: ProposalStatus;
  proposedById: string;
  proposedByName: string;
  proposedAt: string;
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export interface RoleApplication {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  requestedRole: 'pro' | PlatformRole;
  qbankId?: string;
  reason: string;
  status: ProposalStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewedById?: string;
  reviewedByName?: string;
}

export interface AnswerStat {
  id: string;
  qbankId: string;
  questionId: string;
  selections: Record<string, number>;
}

export interface PlatformSecurity {
  superAdminUid: string;
  updatedAt: string;
}

export interface SharedNoteRevision {
  id: string;
  content: string;
  images: NoteImage[];
  editedById: string;
  editedByName: string;
  editedAt: string;
}

export interface SharedQuestionNote {
  id: string;
  qbankId: string;
  questionId: string;
  content: string;
  images: NoteImage[];
  version: number;
  updatedById: string;
  updatedByName: string;
  updatedAt: string;
  history: SharedNoteRevision[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: 'account' | 'admin' | 'university_id' | 'access_block' | 'qbank' | 'question' | 'note' | 'role' | 'sharing';
  entityId: string;
  actorId: string;
  actorName: string;
  createdAt: string;
  detail: string;
}

export interface CollaborationState {
  qbanks: QBank[];
  memberships: QBankMembership[];
  invitations: QBankInvitation[];
  members: MemberProfile[];
  allowedUniversityIds: AllowedUniversityId[];
  blockedAccess: AccessBlocklist;
  adminInvites: AdminInvite[];
  proposals: QuestionProposal[];
  roleApplications: RoleApplication[];
  approvedQuestions: Question[];
  answerStats: Record<string, AnswerStat>;
  sharedNotes: Record<string, SharedQuestionNote>;
  auditLog: AuditEntry[];
  security: PlatformSecurity;
  lastSyncAt?: string;
}

export interface TestBuilderConfig {
  mode: TestMode;
  statuses: QuestionStatus[];
  specialty: string;
  topics: string[];
  count: number;
}

export function emptyProgress(): QuestionProgress {
  return {
    attempts: 0,
    correctAttempts: 0,
    incorrectAttempts: 0,
    flagged: false,
    highlights: [],
    note: '',
    noteImages: [],
  };
}

export function initialAppState(): AppState {
  return {
    version: 1,
    progress: {},
    tests: [],
    reports: [],
    revisions: [],
    questionOverrides: {},
    customQuestions: [],
    settings: { dailyGoal: 20, theme: 'light', autoSync: true, activeQBankId: 'smle-gs' },
  };
}

export function initialCollaborationState(): CollaborationState {
  return {
    qbanks: [{
      id: 'smle-gs',
      name: 'SMLE · General Surgery',
      shortName: 'SMLE GS',
      description: 'General Surgery question bank for SMLE preparation.',
      createdAt: '2026-09-02T00:00:00.000Z',
      createdById: 'system',
      createdByName: 'Qraft',
      archived: false,
      ownerId: 'system',
      ownerName: 'Qraft',
      visibility: 'public',
      shareEnabled: false,
      reviewerIds: [],
      viewerIds: [],
    }],
    memberships: [],
    invitations: [],
    members: [],
    allowedUniversityIds: [],
    blockedAccess: { phones: [], universityIds: [], emails: [] },
    adminInvites: [],
    proposals: [],
    roleApplications: [],
    approvedQuestions: [],
    answerStats: {},
    sharedNotes: {},
    auditLog: [],
    security: { superAdminUid: '', updatedAt: '2026-09-02T00:00:00.000Z' },
  };
}

export function normalizeCollaborationState(input?: Partial<CollaborationState>): CollaborationState {
  const base = initialCollaborationState();
  if (!input) return base;
  const qbanks = (input.qbanks?.length ? input.qbanks : base.qbanks).map((bank) => ({
    ...bank,
    ownerId: bank.ownerId ?? bank.createdById,
    ownerName: bank.ownerName ?? bank.createdByName,
    visibility: bank.visibility ?? 'public',
    shareEnabled: bank.shareEnabled ?? false,
    reviewerIds: bank.reviewerIds ?? [],
    viewerIds: bank.viewerIds ?? [],
  }));
  return {
    ...base,
    ...input,
    qbanks,
    memberships: input.memberships ?? [],
    invitations: input.invitations ?? [],
    members: (input.members ?? []).map((member) => ({ ...member, tier: member.tier ?? 'lite', platformRoles: member.platformRoles ?? [] })),
    blockedAccess: {
      phones: [...new Set((input.blockedAccess?.phones ?? base.blockedAccess.phones).map((value) => value.replace(/\D/g, '')).filter(Boolean))],
      universityIds: [...new Set((input.blockedAccess?.universityIds ?? base.blockedAccess.universityIds).map((value) => value.replace(/\s+/g, '').toUpperCase()).filter(Boolean))],
      emails: [...new Set((input.blockedAccess?.emails ?? base.blockedAccess.emails).map((value) => value.trim().toLowerCase()).filter(Boolean))],
    },
    proposals: (input.proposals ?? []).map((proposal) => ({ ...proposal, editKinds: proposal.editKinds ?? (proposal.type === 'new_question' ? ['question_text'] : ['typo_formatting']), payload: { ...proposal.payload, explanation: proposal.payload.explanation ?? '', sourceReference: proposal.payload.sourceReference ?? proposal.rationale ?? '', images: proposal.payload.images ?? [] }, currentSnapshot: proposal.currentSnapshot ? { ...proposal.currentSnapshot, images: proposal.currentSnapshot.images ?? [] } : undefined })),
    roleApplications: input.roleApplications ?? [],
    approvedQuestions: (input.approvedQuestions ?? []).map((question, index) => ({ ...question, questionId: question.questionId ?? String(218 + index).padStart(5, '0'), images: question.images ?? [] })),
    answerStats: input.answerStats ?? {},
    sharedNotes: input.sharedNotes ?? {},
    auditLog: input.auditLog ?? [],
    security: input.security ?? base.security,
  };
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeUniversityId(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function bankRoleFor(user: AppUser, bank: QBank, memberships: QBankMembership[]): BankRole | undefined {
  if (bank.ownerId === user.uid) return 'owner';
  return memberships.find((item) => item.qbankId === bank.id && item.userId === user.uid)?.role;
}

export function canAccessBank(user: AppUser, bank: QBank, memberships: QBankMembership[]): boolean {
  return user.role === 'super_admin' || bank.visibility === 'public' || Boolean(bankRoleFor(user, bank, memberships));
}

export function canReviewBank(user: AppUser, bank: QBank, memberships: QBankMembership[]): boolean {
  const bankRole = bankRoleFor(user, bank, memberships);
  if (bankRole === 'owner' || bankRole === 'reviewer') return true;
  return bank.visibility === 'public' && (user.role === 'super_admin' || user.platformRoles.includes('reviewer'));
}

export function normalizeAppState(input?: Partial<AppState>): AppState {
  const base = initialAppState();
  if (!input) return base;
  return {
    ...base,
    ...input,
    version: 1,
    settings: { ...base.settings, ...input.settings },
    progress: input.progress ?? {},
    tests: input.tests ?? [],
    reports: input.reports ?? [],
    revisions: input.revisions ?? [],
    questionOverrides: input.questionOverrides ?? {},
    customQuestions: input.customQuestions ?? [],
  };
}
