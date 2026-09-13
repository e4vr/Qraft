import type { StudyStreak } from './medguard-types';

const DAY_MS = 86_400_000;

export function localStudyDay(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayOrdinal(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  return Math.floor(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS,
  );
}

export function recordStudyActivity(streak: StudyStreak, date = new Date()): StudyStreak {
  const day = localStudyDay(date);
  if (streak.lastActivityDate === day) return streak;
  const currentDay = dayOrdinal(day);
  const previousDay = dayOrdinal(streak.lastActivityDate);
  if (Number.isFinite(previousDay) && currentDay < previousDay) return streak;
  const current = currentDay - previousDay === 1 ? Math.max(1, streak.current) + 1 : 1;
  return {
    current,
    best: Math.max(streak.best, current),
    lastActivityDate: day,
    updatedAt: date.toISOString(),
  };
}

export function visibleStudyStreak(streak: StudyStreak, date = new Date()) {
  if (!streak.lastActivityDate) return 0;
  const difference = dayOrdinal(localStudyDay(date)) - dayOrdinal(streak.lastActivityDate);
  return difference <= 1 ? streak.current : 0;
}
