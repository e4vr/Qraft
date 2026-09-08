export function reviewerPeriods(timeZone: string, now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateAt = (date: Date) => {
    const parts = formatter.formatToParts(date);
    return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)!.value).join('-');
  };
  const today = dateAt(now);
  const [year, month, day] = today.split('-').map(Number);
  const isoDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  // Find the first actual instant of the local date, including DST transitions
  // and zones whose clocks advance at midnight. Never assume a 24-hour day.
  const start = (date: string) => {
    let low = Date.parse(`${date}T00:00:00Z`) - 36 * 3600_000;
    let high = low + 72 * 3600_000;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (dateAt(new Date(mid)) < date) low = mid + 1; else high = mid;
    }
    return new Date(low).toISOString();
  };
  return { timeZone, todayStart: start(today), todayEnd: start(isoDate(year, month, day + 1)), monthStart: start(isoDate(year, month, 1)), monthEnd: start(isoDate(year, month + 1, 1)) };
}
