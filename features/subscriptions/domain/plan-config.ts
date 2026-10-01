export const PLAN_ORDER = ['free', 'full_monthly', 'full_quarterly'] as const;
export type PlanId = (typeof PLAN_ORDER)[number];
export const PAID_PLAN_IDS = ['full_monthly', 'full_quarterly'] as const;
export const PLAN_DURATION_MONTHS: Record<PlanId, number> = { free: 0, full_monthly: 1, full_quarterly: 3 };
export function planDurationLabel(plan: PlanId): string {
  return plan === 'free' ? 'Lifetime trial' : PLAN_DURATION_MONTHS[plan] === 1 ? '1 month' : '3 months';
}

export type PlanFeature =
  | 'createQBank'
  | 'createPrivateQBank'
  | 'addQuestions'
  | 'jsonImport'
  | 'uploadImages'
  | 'privateNotes'
  | 'flashcards'
  | 'readyTests'
  | 'contribute';

export type PlanLimits = {
  name: string;
  priceSarPeriod: number;
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
  maxFlashcardDecks: number | null;
  maxFlashcards: number | null;
  canCreateReadyTests: boolean;
  canContribute: boolean;
  canSuggestCorrections: boolean;
  fairUse: boolean;
};

// Image uploads are part of contributions and are available to every plan.
// The storage service still enforces its deployment-wide safety cap.
const UNLIMITED_IMAGE_STORAGE = Number.MAX_SAFE_INTEGER;

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    name: 'Free trial',
    priceSarPeriod: 0,
    monthlyExamLimit: null,
    lifetimeExamLimit: 2,
    maxQuestionsPerExam: 15,
    canCreateQBank: false,
    canCreatePrivateQBank: false,
    canAddQuestions: true,
    canUseJsonImport: false,
    jsonImportDailyLimit: 0,
    jsonQuestionsPerImport: 0,
    maxPendingReviewQuestions: 0,
    canUploadImages: true,
    maxImageStorageBytes: UNLIMITED_IMAGE_STORAGE,
    canUsePrivateNotes: false,
    canUseFlashcards: false,
    maxFlashcardDecks: 0,
    maxFlashcards: 0,
    canCreateReadyTests: false,
    canContribute: true,
    canSuggestCorrections: true,
    fairUse: false,
  },
  full_monthly: {
    name: 'Qraft Full Access',
    priceSarPeriod: 100,
    monthlyExamLimit: null,
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
    maxImageStorageBytes: UNLIMITED_IMAGE_STORAGE,
    canUsePrivateNotes: true,
    canUseFlashcards: true,
    maxFlashcardDecks: null,
    maxFlashcards: null,
    canCreateReadyTests: true,
    canContribute: true,
    canSuggestCorrections: true,
    fairUse: true,
  },
  full_quarterly: {
    name: 'Qraft Full Access',
    priceSarPeriod: 230,
    monthlyExamLimit: null,
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
    maxImageStorageBytes: UNLIMITED_IMAGE_STORAGE,
    canUsePrivateNotes: true,
    canUseFlashcards: true,
    maxFlashcardDecks: null,
    maxFlashcards: null,
    canCreateReadyTests: true,
    canContribute: true,
    canSuggestCorrections: true,
    fairUse: true,
  },
};

export const CONTRIBUTION_CREDITS = {
  newQuestion: 1,
  importedQuestion: 0,
  typoFormatting: 1,
  sourceReference: 1,
  validReport: 2,
  explanationImprovement: 4,
  substantialCorrection: 8,
  medicalFactOrCorrectAnswer: 10,
} as const;

export type RewardCatalogEntry = {
  id: string;
  plan: Exclude<PlanId, 'free'>;
  credits: number;
  duration: number;
  durationUnit: 'month' | 'year';
  durationDays?: number | null;
};

export const REWARD_CATALOG = [
  {
    id: 'full-access-week',
    plan: 'full_monthly',
    credits: 200,
    duration: 1,
    durationUnit: 'month',
    durationDays: 7,
  },
  {
    id: 'full-access-month',
    plan: 'full_monthly',
    credits: 400,
    duration: 1,
    durationUnit: 'month',
    durationDays: null,
  },
  {
    id: 'full-access-quarter',
    plan: 'full_quarterly',
    credits: 850,
    duration: 3,
    durationUnit: 'month',
    durationDays: null,
  },
] as const satisfies readonly RewardCatalogEntry[];

export function rewardDurationLabel(reward: Pick<RewardCatalogEntry, 'duration' | 'durationUnit' | 'durationDays'>): string {
  if (reward.durationDays === 7) return '1 week (7 days)';
  if (reward.durationDays) return `${reward.durationDays} days`;
  return `${reward.duration} ${reward.durationUnit}${reward.duration === 1 ? '' : 's'}`;
}

export const CONTRIBUTION_BADGES = [
  { score: 7_000, name: 'Master Contributor' },
  { score: 3_000, name: 'Elite Contributor' },
  { score: 1_000, name: 'Trusted Contributor' },
  { score: 250, name: 'Active Contributor' },
  { score: 50, name: 'Contributor' },
] as const;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && PLAN_ORDER.includes(value as PlanId);
}

export function getPlanLimits(plan: PlanId): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

export function highestPlan(
  ...plans: Array<PlanId | undefined | null>
): PlanId {
  return plans.reduce<PlanId>(
    (best, plan) =>
      plan && PLAN_ORDER.indexOf(plan) > PLAN_ORDER.indexOf(best) ? plan : best,
    'free',
  );
}

export function hasFeature(plan: PlanId, feature: PlanFeature, override?: PlanLimits): boolean {
  const limits = override ?? getPlanLimits(plan);
  return {
    createQBank: limits.canCreateQBank,
    createPrivateQBank: limits.canCreatePrivateQBank,
    addQuestions: limits.canAddQuestions,
    jsonImport: limits.canUseJsonImport,
    uploadImages: limits.canUploadImages,
    privateNotes: limits.canUsePrivateNotes,
    flashcards: limits.canUseFlashcards,
    readyTests: limits.canCreateReadyTests,
    contribute: limits.canContribute,
  }[feature];
}

export function contributionBadge(score: number): string | undefined {
  return CONTRIBUTION_BADGES.find((badge) => score >= badge.score)?.name;
}

export function utcDayStart(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

export function utcMonthStart(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}
