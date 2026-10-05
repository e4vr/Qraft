import type {
  QBank,
  Question,
  QuestionProgress,
  TestSession,
} from '@/lib/medguard-types';

export interface BookmarkedQBank {
  bank: QBank;
  questions: Question[];
}

export function groupBookmarkedQuestions(
  accessibleBanks: readonly QBank[],
  questionPool: readonly Question[],
  bookmarkedQuestionIds: readonly string[],
): BookmarkedQBank[] {
  const bookmarked = new Set(bookmarkedQuestionIds);
  if (!bookmarked.size) return [];
  const groups = new Map(
    accessibleBanks.map((bank) => [
      bank.id,
      { bank, questions: [] as Question[] },
    ]),
  );
  for (const question of questionPool) {
    if (bookmarked.has(question.id))
      groups.get(question.qbankId ?? 'smle-gs')?.questions.push(question);
  }
  return [...groups.values()].filter((group) => group.questions.length > 0);
}

export function createBookmarkStudySession({
  bankId,
  questionIds,
  questionsById,
  progress,
  title,
}: {
  bankId: string;
  questionIds: readonly string[];
  questionsById: ReadonlyMap<string, Question>;
  progress: Readonly<Record<string, Pick<QuestionProgress, 'bookmarked'>>>;
  title: string;
}): TestSession | undefined {
  const selectedIds = [...new Set(questionIds)].filter((id) => {
    const question = questionsById.get(id);
    return (
      question &&
      (question.qbankId ?? 'smle-gs') === bankId &&
      progress[id]?.bookmarked
    );
  });
  if (!selectedIds.length) return undefined;
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    mode: 'tutor',
    questionIds: selectedIds,
    currentIndex: 0,
    answers: {},
    revealed: [],
    graded: [],
    startedAt: now,
    updatedAt: now,
    elapsedSeconds: 0,
    timerStartedAt: now,
    timerPaused: false,
    status: 'active',
    origin: 'bookmarks',
    qbankId: bankId,
  };
}
