export function addCalendarDuration(
  startedAt: string,
  duration: number,
  unit: 'month' | 'year',
): string {
  const expiry = new Date(startedAt);
  if (!Number.isFinite(expiry.getTime()) || !Number.isInteger(duration) || duration < 1)
    throw new Error('Invalid subscription duration.');

  const intendedDay = expiry.getUTCDate();
  expiry.setUTCDate(1);
  if (unit === 'month') expiry.setUTCMonth(expiry.getUTCMonth() + duration);
  else expiry.setUTCFullYear(expiry.getUTCFullYear() + duration);
  const lastDay = new Date(
    Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0),
  ).getUTCDate();
  expiry.setUTCDate(Math.min(intendedDay, lastDay));
  return expiry.toISOString();
}
