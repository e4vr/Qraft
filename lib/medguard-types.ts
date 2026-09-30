import { isBankMembershipRole } from '@/features/access/domain/access-policy';
import type { PlanLimits } from '@/features/subscriptions/domain/plan-config';

export type TestMode = 'tutor' | 'timed';
export type QuestionStatus =
  | 'new'
  | 'previous'
  | 'correct'
  | 'incorrect'
  | 'flagged';
export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'reviewer'
  | 'access_manager'
  | 'student';
export type AccountTier = 'free' | 'full_monthly' | 'full_quarterly';
export type PlatformRole = 'moderator' | 'reviewer' | 'access_manager';
export type BankRole = 'owner' | 'editor' | 'reviewer' | 'viewer';
export type QBankVisibility = 'public' | 'private';
export type AccountStatus = 'pending' | 'approved' | 'rejected';
export type ProposalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'needs_changes';
export type ProposalEditKind =
  | 'question_text'
  | 'options'
  | 'correct_answer'
  | 'explanation'
  | 'source'
  | 'typo_formatting'
  | 'duplicate'
  | 'outdated_guideline';

export {
  PLATFORM_ROLES,
  administrativeRoleLabels,
  bankRoleFor,
  canAccessBank,
  canEditBank,
  canManageBank,
  canReviewBank,
  hasAccessManagerRole,
  hasModeratorRole,
  hasReviewerRole,
  isPlatformRole,
} from '@/features/access/domain/access-policy';

export { isBankMembershipRole };

export interface Question {
  id: string;
  questionId: string;
  number: number;
  specialty: string;
  topic: string;
  specialtyId?: string;
  topicId?: string;
  stem: string;
  options: string[];
  answer: number;
  answerLetter: string;
  sourcePage?: number;
  sourceFile: string;
  originalQuestionNumber?: string;
  revision: number;
  isCustom?: boolean;
  qbankId?: string;
  explanation?: string;
  sourceReference?: string;
  images: NoteImage[];
  writtenById?: string;
  writtenByName?: string;
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: string;
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
  bookmarked: boolean;
  highlights: HighlightRange[];
  highlightSections?: Record<string, HighlightRange[]>;
  note: string;
  noteImages: NoteImage[];
  updatedAt?: string;
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
  origin?: 'bookmarks';
}

export interface StudyStreak {
  current: number;
  best: number;
  lastActivityDate: string;
  updatedAt?: string;
}

export type FlashcardType = 'basic' | 'cloze' | 'image';
export type FlashcardRating = 'again' | 'hard' | 'good' | 'easy';
export type FlashcardLearningState =
  | 'new'
  | 'learning'
  | 'review'
  | 'relearning';

export interface FlashcardDeck {
  id: string;
  name: string;
  qbankId: string;
  parentId?: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  importedFrom?: string;
}

export interface Flashcard {
  id: string;
  deckId: string;
  qbankId: string;
  type: FlashcardType;
  front: string;
  back: string;
  tags: string[];
  image?: NoteImage;
  sourceQuestionId?: string;
  importedGuid?: string;
  reverseOfId?: string;
  suspended?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlashcardSchedule {
  cardId: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: FlashcardLearningState;
  lastReview?: string;
}

export interface FlashcardReviewLog {
  id: string;
  cardId: string;
  rating: FlashcardRating;
  reviewedAt: string;
  scheduledDays: number;
}

export interface FlashcardSettings {
  desiredRetention: number;
  dailyNewLimit: number;
  dailyReviewLimit: number;
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
  favoriteQBankIds: string[];
  pinnedQBankIds: string[];
  quickAccessQBankIds: string[];
  qbankOrderBySection: {
    mine: string[];
    shared: string[];
  };
}

export interface AppState {
  version: 1;
  clientUpdatedAt?: string;
  progress: Record<string, QuestionProgress>;
  tests: TestSession[];
  reports: ErrorReport[];
  revisions: RevisionEntry[];
  questionOverrides: Record<string, Partial<Question>>;
  customQuestions: Question[];
  flashcardDecks: FlashcardDeck[];
  flashcards: Flashcard[];
  flashcardSchedules: Record<string, FlashcardSchedule>;
  flashcardReviewLog: FlashcardReviewLog[];
  flashcardSettings: FlashcardSettings;
  settings: AppSettings;
  studyStreak: StudyStreak;
  lastSyncAt?: string;
}

export interface AppUser {
  planLimits?: PlanLimits;
  uid: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  provider: 'cloudflare';
  role: UserRole;
  status: AccountStatus;
  universityId?: string;
  phone?: string;
  createdAt?: string;
  tier: AccountTier;
  effectivePlan?: AccountTier;
  adminOverridePlan?: AccountTier | null;
  effectivePlanExpiresAt?: string | null;
  subscriptionPlan?: AccountTier | null;
  rewardPlan?: AccountTier | null;
  adminPlan?: AccountTier | null;
  platformRoles: PlatformRole[];
  suspended?: boolean;
  suspendedUntil?: string;
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
  essential: boolean;
  ownerId: string;
  ownerName: string;
  visibility: QBankVisibility;
  shareEnabled: boolean;
  shareToken?: string;
  reviewerIds: string[];
  viewerIds: string[];
  folderId?: string;
}

export interface QBankFolder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface QBankMembership {
  id: string;
  qbankId: string;
  userId: string;
  userName: string;
  role: Exclude<BankRole, 'owner'>;
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
  suspendedUntil?: string;
  mfaEnrolled?: boolean;
  approvedAt?: string;
  approvedById?: string;
  approvedByName?: string;
  universityIdRegistered?: boolean;
  universityIdVerifiedManually?: boolean;
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
  originalQuestionNumber?: string;
  stem: string;
  options: string[];
  answer: number;
  specialty: string;
  topic: string;
  specialtyId?: string;
  topicId?: string;
  explanation: string;
  sourceReference: string;
  sourceFile?: string;
  sourcePage?: number;
  images: NoteImage[];
}

export type DuplicateClassification = 'exact' | 'high_confidence' | 'possible';

export interface DuplicateCandidate {
  entityId: string;
  entityType: 'approved_question' | 'pending_proposal';
  questionId?: string;
  similarity: number;
  classification: DuplicateClassification;
  signals: {
    stem: number;
    optionsSet: number;
    optionsOrdered: number;
    correctAnswer: number;
    specialty: number;
    topic: number;
  };
  candidateFingerprint: string;
  detectedAt: string;
}

export interface DuplicateResolution {
  decision: 'kept_both' | 'rejected_as_duplicate';
  candidateEntityId: string;
  reviewerId: string;
  reviewerName: string;
  reviewedAt: string;
  note?: string;
}

export interface DuplicateReview {
  status: 'flagged' | 'resolved';
  detectorVersion: string;
  sourceFingerprint: string;
  detectedAt: string;
  candidates: DuplicateCandidate[];
  resolutions?: DuplicateResolution[];
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
  submissionMethod?: 'manual' | 'json';
  importBatchId?: string;
  duplicateScanId?: string;
  duplicateInfo?: {
    type: 'possible';
    similarity: number;
    matchedQuestionId?: string;
  };
  /** Reviewer-controlled duplicate evidence. duplicateInfo remains for legacy records. */
  duplicateReview?: DuplicateReview;
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
  requestedRole: PlatformRole;
  superAdminUid: string;
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
  entityType:
    | 'account'
    | 'admin'
    | 'university_id'
    | 'access_block'
    | 'qbank'
    | 'question'
    | 'note'
    | 'role'
    | 'sharing';
  entityId: string;
  actorId: string;
  actorName: string;
  createdAt: string;
  detail: string;
}

export interface CollaborationState {
  qbanks: QBank[];
  qbankFolders: QBankFolder[];
  memberships: QBankMembership[];
  invitations: QBankInvitation[];
  members: MemberProfile[];
  allowedUniversityIds: AllowedUniversityId[];
  blockedAccess: AccessBlocklist;
  adminInvites: AdminInvite[];
  proposals: QuestionProposal[];
  roleApplications: RoleApplication[];
  approvedQuestions: Question[];
  specialties: QBankSpecialty[];
  topics: QBankTopic[];
  classificationRevisions: Record<string, number>;
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
  includedTopics?: Array<{ specialty: string; topic: string }>;
  count: number;
  randomAll?: boolean;
  title?: string;
}

export function emptyProgress(): QuestionProgress {
  return {
    attempts: 0,
    correctAttempts: 0,
    incorrectAttempts: 0,
    flagged: false,
    bookmarked: false,
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
    flashcardDecks: [],
    flashcards: [],
    flashcardSchedules: {},
    flashcardReviewLog: [],
    flashcardSettings: {
      desiredRetention: 0.9,
      dailyNewLimit: 20,
      dailyReviewLimit: 200,
    },
    settings: {
      dailyGoal: 20,
      theme: 'light',
      autoSync: true,
      activeQBankId: 'smle-gs',
      favoriteQBankIds: [],
      pinnedQBankIds: [],
      quickAccessQBankIds: [],
      qbankOrderBySection: { mine: [], shared: [] },
    },
    studyStreak: {
      current: 0,
      best: 0,
      lastActivityDate: '',
    },
  };
}

export function initialCollaborationState(): CollaborationState {
  return {
    qbanks: [
      {
        id: 'smle-gs',
        name: 'SMLE · General Surgery',
        shortName: 'SMLE GS',
        description: 'General Surgery question bank for SMLE preparation.',
        createdAt: '2026-09-02T00:00:00.000Z',
        createdById: 'system',
        createdByName: 'Qraft',
        archived: false,
        essential: true,
        ownerId: 'system',
        ownerName: 'Qraft',
        visibility: 'public',
        shareEnabled: false,
        reviewerIds: [],
        viewerIds: [],
      },
    ],
    qbankFolders: [],
    memberships: [],
    invitations: [],
    members: [],
    allowedUniversityIds: [],
    blockedAccess: { phones: [], universityIds: [], emails: [] },
    adminInvites: [],
    proposals: [],
    roleApplications: [],
    approvedQuestions: [],
    specialties: [],
    topics: [],
    classificationRevisions: {},
    answerStats: {},
    sharedNotes: {},
    auditLog: [],
    security: { superAdminUid: '', updatedAt: '2026-09-02T00:00:00.000Z' },
  };
}

export function normalizeCollaborationState(
  input?: Partial<CollaborationState>,
): CollaborationState {
  const base = initialCollaborationState();
  if (!input) return base;
  const qbanks = (input.qbanks ?? base.qbanks).map(
    (bank) => ({
      ...bank,
      ownerId: bank.ownerId ?? bank.createdById,
      ownerName: bank.ownerName ?? bank.createdByName,
      visibility: bank.visibility ?? 'public',
      shareEnabled: bank.shareEnabled ?? false,
      essential: bank.essential ?? bank.id === 'smle-gs',
      reviewerIds: bank.reviewerIds ?? [],
      viewerIds: bank.viewerIds ?? [],
    }),
  );
  const specialties = input.specialties ?? [];
  const topics = input.topics ?? [];
  const rawFolders = (input.qbankFolders ?? []).filter(
    (folder) =>
      typeof folder?.id === 'string' &&
      Boolean(folder.id) &&
      typeof folder.name === 'string' &&
      Boolean(folder.name.trim()) &&
      folder.name.length <= 80 &&
      (folder.parentId === null || typeof folder.parentId === 'string') &&
      folder.parentId !== folder.id &&
      Number.isInteger(folder.order),
  );
  const rootIds = new Set(
    rawFolders
      .filter((folder) => folder.parentId === null)
      .map((folder) => folder.id),
  );
  const seenFolderIds = new Set<string>();
  const seenFolderNames = new Set<string>();
  const qbankFolders = rawFolders.filter((folder) => {
    if (folder.parentId !== null && !rootIds.has(folder.parentId)) return false;
    const nameKey = `${folder.parentId ?? 'root'}\u0000${folder.name.trim().toLocaleLowerCase()}`;
    if (seenFolderIds.has(folder.id) || seenFolderNames.has(nameKey))
      return false;
    seenFolderIds.add(folder.id);
    seenFolderNames.add(nameKey);
    return true;
  });
  const validFolderIds = new Set(qbankFolders.map((folder) => folder.id));
  const normalizedQBanks = qbanks.map((bank) =>
    bank.folderId && !validFolderIds.has(bank.folderId)
      ? { ...bank, folderId: undefined }
      : bank,
  );
  const specialtyById = new Map(specialties.map((item) => [item.id, item]));
  const topicById = new Map(topics.map((item) => [item.id, item]));
  const resolveClassification = <T extends Question | QuestionProposalPayload>(
    value: T,
  ): T => {
    const topic = value.topicId ? topicById.get(value.topicId) : undefined;
    const specialty = topic
      ? specialtyById.get(topic.specialtyId)
      : value.specialtyId
        ? specialtyById.get(value.specialtyId)
        : undefined;
    return {
      ...value,
      specialtyId: specialty?.id ?? value.specialtyId,
      topicId: topic?.id ?? value.topicId,
      specialty: specialty?.name ?? value.specialty,
      topic: topic?.name ?? value.topic,
    };
  };
  return {
    ...base,
    ...input,
    qbanks: normalizedQBanks,
    qbankFolders,
    memberships: (input.memberships ?? []).filter((item) =>
      isBankMembershipRole(item.role),
    ),
    invitations: (input.invitations ?? []).filter((item) =>
      isBankMembershipRole(item.role),
    ),
    members: (input.members ?? []).map((member) => ({
      ...member,
      tier: member.tier ?? 'free',
      platformRoles: member.platformRoles ?? [],
    })),
    blockedAccess: {
      phones: [
        ...new Set(
          (input.blockedAccess?.phones ?? base.blockedAccess.phones)
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.replace(/\D/g, ''))
            .filter(Boolean),
        ),
      ],
      universityIds: [
        ...new Set(
          (
            input.blockedAccess?.universityIds ??
            base.blockedAccess.universityIds
          )
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.replace(/\s+/g, '').toUpperCase())
            .filter(Boolean),
        ),
      ],
      emails: [
        ...new Set(
          (input.blockedAccess?.emails ?? base.blockedAccess.emails)
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
        ),
      ],
    },
    proposals: (input.proposals ?? []).map((proposal) => ({
      ...proposal,
      editKinds:
        proposal.editKinds ??
        (proposal.type === 'new_question'
          ? ['question_text']
          : ['typo_formatting']),
      payload: {
        ...resolveClassification(proposal.payload),
        explanation: proposal.payload.explanation ?? '',
        sourceReference:
          proposal.payload.sourceReference ?? proposal.rationale ?? '',
        images: proposal.payload.images ?? [],
      },
      currentSnapshot: proposal.currentSnapshot
        ? {
            ...proposal.currentSnapshot,
            images: proposal.currentSnapshot.images ?? [],
          }
        : undefined,
    })),
    roleApplications: input.roleApplications ?? [],
    specialties,
    topics,
    classificationRevisions: input.classificationRevisions ?? {},
    approvedQuestions: (input.approvedQuestions ?? []).map(
      (question, index) => ({
        ...resolveClassification(question),
        questionId: question.questionId ?? String(218 + index).padStart(5, '0'),
        images: question.images ?? [],
      }),
    ),
    answerStats: input.answerStats ?? {},
    sharedNotes: input.sharedNotes ?? {},
    auditLog: input.auditLog ?? [],
    security: input.security ?? base.security,
  };
}

export function normalizePhone(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

export interface QBankSpecialty {
  id: string;
  qbankId: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface QBankTopic {
  id: string;
  qbankId: string;
  specialtyId: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export function normalizeUniversityId(value: string): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

export function normalizeEmail(value: string): string {
  return (value ?? '').trim().toLowerCase();
}

export function normalizeAppState(input?: Partial<AppState>): AppState {
  const base = initialAppState();
  if (!input) return base;
  const stringIds = (values: unknown, limit = Number.MAX_SAFE_INTEGER) =>
    Array.isArray(values)
      ? [
          ...new Set(
            values.filter(
              (value): value is string =>
                typeof value === 'string' && Boolean(value),
            ),
          ),
        ].slice(0, limit)
      : [];
  return {
    ...base,
    ...input,
    version: 1,
    settings: {
      ...base.settings,
      ...input.settings,
      favoriteQBankIds: stringIds(input.settings?.favoriteQBankIds),
      pinnedQBankIds: stringIds(input.settings?.pinnedQBankIds),
      quickAccessQBankIds: stringIds(input.settings?.quickAccessQBankIds, 5),
      qbankOrderBySection: {
        mine: stringIds(input.settings?.qbankOrderBySection?.mine),
        shared: stringIds(input.settings?.qbankOrderBySection?.shared),
      },
    },
    studyStreak: {
      current: Math.max(0, Math.trunc(Number(input.studyStreak?.current) || 0)),
      best: Math.max(
        0,
        Math.trunc(Number(input.studyStreak?.best) || 0),
        Math.trunc(Number(input.studyStreak?.current) || 0),
      ),
      lastActivityDate:
        typeof input.studyStreak?.lastActivityDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(input.studyStreak.lastActivityDate)
          ? input.studyStreak.lastActivityDate
          : '',
      updatedAt:
        typeof input.studyStreak?.updatedAt === 'string'
          ? input.studyStreak.updatedAt
          : undefined,
    },
    progress: Object.fromEntries(
      Object.entries(input.progress ?? {}).map(([id, progress]) => [
        id,
        {
          ...emptyProgress(),
          ...progress,
          highlights: progress.highlights ?? [],
          highlightSections: progress.highlightSections ?? {},
        },
      ]),
    ),
    tests: input.tests ?? [],
    reports: input.reports ?? [],
    revisions: input.revisions ?? [],
    questionOverrides: input.questionOverrides ?? {},
    customQuestions: input.customQuestions ?? [],
    flashcardDecks: input.flashcardDecks ?? [],
    flashcards: (input.flashcards ?? []).map((card) => ({
      ...card,
      tags: card.tags ?? [],
    })),
    flashcardSchedules: input.flashcardSchedules ?? {},
    flashcardReviewLog: input.flashcardReviewLog ?? [],
    flashcardSettings: {
      ...base.flashcardSettings,
      ...input.flashcardSettings,
    },
  };
}
