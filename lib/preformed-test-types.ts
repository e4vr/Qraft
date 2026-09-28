import type { NoteImage } from './medguard-types';

export interface PreformedQuestion {
  id: string;
  stem: string;
  options: string[];
  answer: number;
  explanation: string;
  sourceReference: string;
  images: NoteImage[];
}

export interface PreformedTestSettings {
  mode: 'practice' | 'exam';
  durationMinutes: number | null;
  maxAttempts: number | null;
  attemptResultPolicy: 'highest' | 'latest' | 'all';
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  opensAt: string | null;
  closesAt: string | null;
  passingPercent: number;
  allowBackNavigation: boolean;
}

export interface PreformedTestSummary {
  id: string;
  code: string;
  title: string;
  description: string;
  ownerId: string;
  ownerName: string;
  visibility: 'public' | 'private';
  status: 'draft' | 'published' | 'paused' | 'hidden';
  version: number;
  editRevision?: number;
  questionCount: number;
  settings: PreformedTestSettings;
  createdAt: string;
  updatedAt: string;
  participantCount: number;
  reportCount?: number;
}

export interface PreformedTestDocument extends PreformedTestSummary {
  questions: PreformedQuestion[];
  hasPasscode: boolean;
  attemptToken?: string;
  attemptStartedAt?: string;
  answersHidden?: boolean;
}

export interface PreformedLeaderboardEntry {
  id: string;
  participantName: string;
  participantUserId: string | null;
  guest: boolean;
  score: number;
  questionCount: number;
  percentage: number;
  durationSeconds: number;
  attemptNumber: number;
  submittedAt: string;
  rank: number;
}

export interface PreformedQuestionStat {
  questionId: string;
  submissions: number;
  correct: number;
}

export interface PreformedLocalAttempt {
  test: PreformedTestDocument;
  participantName: string;
  answers: Record<string, number>;
  currentIndex?: number;
  questionOrder: string[];
  optionOrder: Record<string, number[]>;
  submissionId: string;
  participantKey: string;
  startedAt: string;
  elapsedSeconds: number;
  submittedAt?: string;
  submissionPending?: boolean;
  result?: { score: number; questionCount: number; percentage: number; rank: number | null; leaderboard: boolean };
  score?: number;
}
