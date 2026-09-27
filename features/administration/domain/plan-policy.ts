import { type PlanLimits } from '@/features/subscriptions/domain/plan-config';
export const POLICY_NUMBERS = {
  monthlyExamLimit: { label: 'Exams / month', max: 10_000, nullable: true },
  lifetimeExamLimit: { label: 'Lifetime exams', max: 10_000, nullable: true },
  maxQuestionsPerExam: { label: 'Questions / exam', max: 500, nullable: false },
  jsonImportDailyLimit: { label: 'Imports / day', max: 50, nullable: false },
  jsonQuestionsPerImport: {
    label: 'Questions / import',
    max: 150,
    nullable: false,
  },
  maxPendingReviewQuestions: {
    label: 'Pending review questions',
    max: 5_000,
    nullable: false,
  },
  maxFlashcardDecks: { label: 'Flashcard decks', max: 500, nullable: false },
  maxFlashcards: { label: 'Flashcards', max: 5_000, nullable: false },
} as const;
export const POLICY_FEATURES = {
  canCreateQBank: 'Create QBanks',
  canCreatePrivateQBank: 'Private QBanks',
  canAddQuestions: 'Add questions',
  canUseJsonImport: 'Imports',
  canUsePrivateNotes: 'Private notes',
  canUseFlashcards: 'Flashcards',
  canContribute: 'Contributions',
  canSuggestCorrections: 'Suggest corrections',
} as const;
export function validatePlanPolicy(
  input: unknown,
  current: PlanLimits,
): Partial<PlanLimits> & { description?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid plan details.');
  const source = input as Record<string, unknown>,
    allowed = new Set([
      'name',
      'description',
      ...Object.keys(POLICY_NUMBERS),
      ...Object.keys(POLICY_FEATURES),
    ]);
  if (Object.keys(source).some((key) => !allowed.has(key)))
    throw new Error('Unsupported plan setting.');
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'name' || key === 'description') {
      if (
        typeof value !== 'string' ||
        (key === 'name' && !value.trim()) ||
        value.length > (key === 'name' ? 40 : 240)
      )
        throw new Error('Check the plan name and description.');
      result[key] = value.trim();
      continue;
    }
    if (key in POLICY_FEATURES) {
      if (typeof value !== 'boolean')
        throw new Error('Features must be on or off.');
      result[key] = value;
      continue;
    }
    const rule = POLICY_NUMBERS[key as keyof typeof POLICY_NUMBERS];
    if (value === null && rule.nullable) {
      result[key] = null;
      continue;
    }
    // Existing larger limits are grandfathered. Raising limits past implemented storage is refused.
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      (key === 'maxQuestionsPerExam' && value < 1) ||
      (value > rule.max && value !== current[key as keyof PlanLimits])
    )
      throw new Error(`${rule.label} exceeds its supported safety range.`);
    result[key] = value;
  }
  const next = { ...current, ...result };
  if (next.canCreatePrivateQBank && !next.canCreateQBank)
    throw new Error('Private QBanks require QBank creation.');
  if (
    next.canUseJsonImport &&
    (!next.jsonImportDailyLimit || !next.jsonQuestionsPerImport)
  )
    throw new Error('Enabled imports need non-zero limits.');
  if (next.canUseFlashcards && (!next.maxFlashcards || !next.maxFlashcardDecks))
    throw new Error('Enabled flashcards need non-zero limits.');
  return result;
}
