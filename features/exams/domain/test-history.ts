import type { TestSession } from '@/lib/medguard-types';

type HistoryTest = Pick<TestSession, 'id' | 'title' | 'mode' | 'status' | 'startedAt'>;

export interface HistoryMonth<T> {
  key: string;
  label: string;
  tests: T[];
}

export interface HistoryYear<T> {
  key: string;
  label: string;
  count: number;
  months: HistoryMonth<T>[];
}

// Calendar months, rather than fixed 30/365-day durations, handle leap years
// and end-of-month dates. Use the same local calendar as the displayed dates.
function monthsBefore(now: Date, months: number): Date {
  const result = new Date(now);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() - months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

export function sortHistoryTests<T extends HistoryTest>(tests: readonly T[]): T[] {
  const time = (test: T) => Date.parse(test.startedAt) || 0;
  return [...tests].sort((a, b) => time(b) - time(a));
}

export function groupHistoryTests<T extends HistoryTest>(tests: readonly T[], now = new Date()) {
  const recent: T[] = [];
  const undated: T[] = [];
  const months = new Map<string, HistoryMonth<T>>();
  const years = new Map<string, HistoryYear<T>>();
  const monthCutoff = monthsBefore(now, 1).getTime();
  const yearCutoff = monthsBefore(now, 12).getTime();
  const monthFormatter = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });

  for (const test of sortHistoryTests(tests)) {
    const date = new Date(test.startedAt);
    const time = date.getTime();
    if (!Number.isFinite(time)) {
      undated.push(test);
      continue;
    }
    if (time > monthCutoff) {
      recent.push(test);
      continue;
    }
    const yearKey = String(date.getFullYear());
    const monthKey = `${yearKey}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const month = { key: monthKey, label: monthFormatter.format(date), tests: [] as T[] };
    if (time <= yearCutoff) {
      let year = years.get(yearKey);
      if (!year) {
        year = { key: yearKey, label: yearKey, count: 0, months: [] };
        years.set(yearKey, year);
      }
      let yearMonth = year.months.find((entry) => entry.key === monthKey);
      if (!yearMonth) {
        yearMonth = month;
        year.months.push(yearMonth);
      }
      yearMonth.tests.push(test);
      year.count += 1;
    } else {
      if (!months.has(monthKey)) months.set(monthKey, month);
      months.get(monthKey)!.tests.push(test);
    }
  }
  return { recent, months: [...months.values()], years: [...years.values()], undated };
}

export function filterHistoryTests<T extends HistoryTest>(tests: readonly T[], query: string): T[] {
  const words = query.trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
  if (!words.length) return [...tests];
  const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'long' });
  return tests.filter((test) => {
    const date = new Date(test.startedAt);
    const dateText = Number.isFinite(date.getTime())
      ? `${dateFormatter.format(date)} ${test.startedAt.slice(0, 10)}`
      : '';
    const status = test.status === 'completed' ? 'completed review' : 'active not completed resume';
    const text = `${test.title} ${test.mode} ${status} ${dateText}`.toLocaleLowerCase('en');
    return words.every((word) => text.includes(word));
  });
}
