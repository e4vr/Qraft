export type TestMode = 'tutor' | 'timed';
export type QuestionStatus = 'new' | 'previous' | 'correct' | 'incorrect' | 'flagged';

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
    settings: { dailyGoal: 20, theme: 'light', autoSync: true },
  };
}
