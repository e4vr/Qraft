export type TestMode = 'tutor' | 'timed';
export type QuestionStatus = 'new' | 'previous' | 'correct' | 'incorrect' | 'flagged';
export type UserRole = 'super_admin' | 'admin' | 'student';
export type AccountStatus = 'pending' | 'approved' | 'rejected';
export type ProposalStatus = 'pending' | 'approved' | 'rejected';

export interface Question {
  id: string;
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
  completedAt?: string;
  status: 'active' | 'completed';
  qbankId?: string;
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
  createdAt?: string;
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
}

export interface MemberProfile {
  uid: string;
  email: string;
  displayName: string;
  universityId: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: string;
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
}

export interface QuestionProposal {
  id: string;
  qbankId: string;
  type: 'new_question' | 'question_edit';
  questionId?: string;
  payload: QuestionProposalPayload;
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
  entityType: 'account' | 'admin' | 'university_id' | 'qbank' | 'question' | 'note';
  entityId: string;
  actorId: string;
  actorName: string;
  createdAt: string;
  detail: string;
}

export interface CollaborationState {
  qbanks: QBank[];
  members: MemberProfile[];
  allowedUniversityIds: AllowedUniversityId[];
  adminInvites: AdminInvite[];
  proposals: QuestionProposal[];
  approvedQuestions: Question[];
  sharedNotes: Record<string, SharedQuestionNote>;
  auditLog: AuditEntry[];
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
      createdByName: 'MedGuard',
      archived: false,
    }],
    members: [],
    allowedUniversityIds: [],
    adminInvites: [],
    proposals: [],
    approvedQuestions: [],
    sharedNotes: {},
    auditLog: [],
  };
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
