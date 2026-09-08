export const PLAN_ORDER = ['free', 'lite', 'pro', 'unlimited'] as const;
export type PlanId = (typeof PLAN_ORDER)[number];

export type PlanFeature =
  | 'createQBank'
  | 'createPrivateQBank'
  | 'addQuestions'
  | 'jsonImport'
  | 'uploadImages'
  | 'privateNotes'
  | 'flashcards'
  | 'contribute';

export type PlanLimits = {
  name: string;
  priceSarYear: number;
  monthlyExamLimit: number | null;
  lifetimeExamLimit: number | null;
  maxQuestionsPerExam: number;
  canCreateQBank: boolean;
  canCreatePrivateQBank: boolean;
  canAddQuestions: boolean;
  canUseJsonImport: boolean;
  jsonImportDailyLimit: number;
  jsonQuestionsPerImport: number;
  maxPendingReviewQuestions: number;
  canUploadImages: boolean;
  maxImageStorageBytes: number;
  canUsePrivateNotes: boolean;
  canUseFlashcards: boolean;
  maxFlashcardDecks: number;
  maxFlashcards: number;
  canContribute: boolean;
  canSuggestCorrections: boolean;
  fairUse: boolean;
};

const GIB = 1024 ** 3;

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    name: 'Free',
    priceSarYear: 0,
    monthlyExamLimit: null,
    lifetimeExamLimit: 2,
    maxQuestionsPerExam: 15,
    canCreateQBank: false,
    canCreatePrivateQBank: false,
    canAddQuestions: false,
    canUseJsonImport: false,
    jsonImportDailyLimit: 0,
    jsonQuestionsPerImport: 0,
    maxPendingReviewQuestions: 0,
    canUploadImages: false,
    maxImageStorageBytes: 0,
    canUsePrivateNotes: false,
    canUseFlashcards: false,
    maxFlashcardDecks: 0,
    maxFlashcards: 0,
    canContribute: false,
    canSuggestCorrections: true,
    fairUse: false,
  },
  lite: {
    name: 'Lite',
    priceSarYear: 15,
    monthlyExamLimit: 30,
    lifetimeExamLimit: null,
    maxQuestionsPerExam: 50,
    canCreateQBank: false,
    canCreatePrivateQBank: false,
    canAddQuestions: false,
    canUseJsonImport: false,
    jsonImportDailyLimit: 0,
    jsonQuestionsPerImport: 0,
    maxPendingReviewQuestions: 0,
    canUploadImages: false,
    maxImageStorageBytes: 0,
    canUsePrivateNotes: false,
    canUseFlashcards: false,
    maxFlashcardDecks: 0,
    maxFlashcards: 0,
    canContribute: false,
    canSuggestCorrections: true,
    fairUse: false,
  },
  pro: {
    name: 'Pro',
    priceSarYear: 50,
    monthlyExamLimit: 250,
    lifetimeExamLimit: null,
    maxQuestionsPerExam: 200,
    canCreateQBank: true,
    canCreatePrivateQBank: true,
    canAddQuestions: true,
    canUseJsonImport: true,
    jsonImportDailyLimit: 3,
    jsonQuestionsPerImport: 75,
    maxPendingReviewQuestions: 300,
    canUploadImages: true,
    maxImageStorageBytes: GIB,
    canUsePrivateNotes: true,
    canUseFlashcards: true,
    maxFlashcardDecks: 3,
    maxFlashcards: 2_000,
    canContribute: true,
    canSuggestCorrections: true,
    fairUse: true,
  },
  unlimited: {
    name: 'Unlimited',
    priceSarYear: 99,
    monthlyExamLimit: 1_000,
    lifetimeExamLimit: null,
    maxQuestionsPerExam: 500,
    canCreateQBank: true,
    canCreatePrivateQBank: true,
    canAddQuestions: true,
    canUseJsonImport: true,
    jsonImportDailyLimit: 5,
    jsonQuestionsPerImport: 150,
    maxPendingReviewQuestions: 1_000,
    canUploadImages: true,
    maxImageStorageBytes: 5 * GIB,
    canUsePrivateNotes: true,
    canUseFlashcards: true,
    maxFlashcardDecks: 25,
    maxFlashcards: 20_000,
    canContribute: true,
    canSuggestCorrections: true,
    fairUse: true,
  },
};

export const CONTRIBUTION_CREDITS = {
  newQuestion: 1,
  typoFormatting: 2,
  sourceReference: 3,
  validReport: 3,
  explanationImprovement: 5,
  substantialCorrection: 10,
  medicalFactOrCorrectAnswer: 15,
} as const;

export const REWARD_CATALOG = [
  { id: 'lite-month', plan: 'lite', credits: 150, duration: 1, durationUnit: 'month' },
  { id: 'pro-month', plan: 'pro', credits: 300, duration: 1, durationUnit: 'month' },
  { id: 'unlimited-month', plan: 'unlimited', credits: 700, duration: 1, durationUnit: 'month' },
  { id: 'pro-year', plan: 'pro', credits: 3_000, duration: 1, durationUnit: 'year' },
  { id: 'unlimited-year', plan: 'unlimited', credits: 7_000, duration: 1, durationUnit: 'year' },
] as const satisfies readonly {
  id: string;
  plan: PlanId;
  credits: number;
  duration: number;
  durationUnit: 'month' | 'year';
}[];

export const CONTRIBUTION_BADGES = [
  { score: 7_000, name: 'Master Contributor' },
  { score: 3_000, name: 'Elite Contributor' },
  { score: 1_000, name: 'Trusted Contributor' },
  { score: 250, name: 'Active Contributor' },
  { score: 50, name: 'Contributor' },
] as const;

export const ABUSE_LIMITS = {
  confirmedDuplicateAttempts: 10,
  rollingWindowDays: 30,
  jsonImportSuspensionDays: 7,
  nearDuplicateSimilarity: 0.82,
} as const;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && PLAN_ORDER.includes(value as PlanId);
}

export function getPlanLimits(plan: PlanId): PlanLimits {
  return PLAN_LIMITS[plan];
}

export function highestPlan(...plans: Array<PlanId | undefined | null>): PlanId {
  return plans.reduce<PlanId>(
    (best, plan) =>
      plan && PLAN_ORDER.indexOf(plan) > PLAN_ORDER.indexOf(best) ? plan : best,
    'free',
  );
}

export function hasFeature(plan: PlanId, feature: PlanFeature): boolean {
  const limits = getPlanLimits(plan);
  return {
    createQBank: limits.canCreateQBank,
    createPrivateQBank: limits.canCreatePrivateQBank,
    addQuestions: limits.canAddQuestions,
    jsonImport: limits.canUseJsonImport,
    uploadImages: limits.canUploadImages,
    privateNotes: limits.canUsePrivateNotes,
    flashcards: limits.canUseFlashcards,
    contribute: limits.canContribute,
  }[feature];
}

export function contributionBadge(score: number): string | undefined {
  return CONTRIBUTION_BADGES.find((badge) => score >= badge.score)?.name;
}

export function utcDayStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function utcMonthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
