import type { Question, TestSession } from '@/lib/medguard-types';

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

export function mainProgressCategory(question: Question): string {
  const value = `${question.specialty} ${question.topic}`.toLocaleLowerCase(
    'en-US',
  );
  if (/p(a?ediatr|ediatric|child|neonat)/.test(value)) return 'Pediatrics';
  if (/obstetric|gyne|gynae|ob\/gyn|maternal|pregnan|labor|labour/.test(value))
    return 'OB/GYN';
  if (
    /anatom|physiolog|patholog|pharmacol|microbi|biochem|immunolog|genetic|histolog|embryolog|basic/.test(
      value,
    )
  )
    return 'Basics';
  if (
    /surg|orthop|urolog|neurosurg|ent\b|ophthalm|trauma|vascular|plastic|anesth/.test(
      value,
    )
  )
    return 'Surgery';
  if (
    /medicine|cardio|respirat|pulmon|gastro|nephro|renal|endocr|rheumat|hemat|infect|neurolog|dermat|psychiatr|emergency|family/.test(
      value,
    )
  )
    return 'Medicine';
  return question.specialty.trim() || 'Other';
}
