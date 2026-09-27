import type { TestSession } from '@/lib/medguard-types';

export function formatDate(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

export function normalizedTestTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function availableExamQuestionLimit(
  eligibleCount: number,
  planLimit: number,
): number {
  return Math.max(0, Math.min(Math.trunc(eligibleCount), Math.trunc(planLimit)));
}

export function clampExamQuestionCount(requested: number, limit: number): number {
  if (limit < 1) return 0;
  return Math.min(limit, Math.max(1, Math.trunc(requested) || 1));
}

export function nextTestTitle(
  bankName: string,
  tests: TestSession[],
): string {
  const used = new Set(tests.map((test) => normalizedTestTitle(test.title)));
  let sequence = 1;
  while (used.has(normalizedTestTitle(`${bankName} ${sequence}`)))
    sequence += 1;
  return `${bankName} ${sequence}`;
}
