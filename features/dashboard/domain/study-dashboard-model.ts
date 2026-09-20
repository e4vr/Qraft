import { emptyProgress, type AppState, type Question } from '@/lib/medguard-types';
import { localStudyDay, visibleStudyStreak } from '@/lib/study-streak';

export interface StudyDashboardModel {
  completed: number;
  correct: number;
  flagged: number;
  ready: number;
  accuracy: number | null;
  todayCompleted: number;
  goal: number;
  completionPercent: number;
  dailyPercent: number;
  streak: number;
  bestStreak: number;
  studiedToday: boolean;
  activeTest?: AppState['tests'][number];
  quickCount: number;
  firstName?: string;
  dueFlashcards: number;
}

export function buildStudyDashboardModel(
  state: AppState,
  questions: Question[],
  name?: string,
  now = new Date(),
): StudyDashboardModel {
  const progress = questions.map((question) => ({
    question,
    progress: state.progress[question.id] ?? emptyProgress(),
  }));
  const completed = progress.filter(({ progress: item }) => item.attempts > 0).length;
  const correct = progress.filter(
    ({ question, progress: item }) =>
      item.attempts > 0 && item.lastAnswer === question.answer,
  ).length;
  const flagged = progress.filter(({ progress: item }) => item.flagged).length;
  const today = now.toDateString();
  const todayCompleted = progress.filter(
    ({ progress: item }) =>
      item.lastAnsweredAt && new Date(item.lastAnsweredAt).toDateString() === today,
  ).length;
  const goal = Math.max(1, state.settings.dailyGoal);
  const specialty = questions[0]?.specialty;
  const newQuestions = progress.filter(
    ({ question, progress: item }) => !item.attempts && question.specialty === specialty,
  );
  const nowMs = now.getTime();
  const dueFlashcards = state.flashcards.filter((card) => {
    if (card.suspended) return false;
    const schedule = state.flashcardSchedules[card.id];
    return !schedule || new Date(schedule.due).getTime() <= nowMs;
  }).length;

  return {
    completed,
    correct,
    flagged,
    ready: Math.max(0, questions.length - completed),
    accuracy: completed ? Math.round((correct / completed) * 100) : null,
    todayCompleted,
    goal,
    completionPercent: questions.length
      ? Math.round((completed / questions.length) * 100)
      : 0,
    dailyPercent: Math.min(100, Math.round((todayCompleted / goal) * 100)),
    streak: visibleStudyStreak(state.studyStreak, now),
    bestStreak: state.studyStreak.best,
    studiedToday: state.studyStreak.lastActivityDate === localStudyDay(now),
    activeTest: state.tests.find((test) => test.status === 'active'),
    quickCount: Math.min(goal, newQuestions.length),
    firstName: name?.trim().split(/\s+/)[0],
    dueFlashcards,
  };
}

