import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['features/exams/domain/test-history.ts'], bundle: true, format: 'esm', platform: 'browser', write: false });
const { groupHistoryTests, filterHistoryTests, sortHistoryTests } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const date = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour);
const entry = (id, startedAt, extra = {}) => ({ id, title: id, startedAt: startedAt.toISOString(), mode: 'timed', status: 'completed', ...extra });

void test('history keeps recent tests visible and folds older tests by month then year without losing sessions', () => {
  const now = date(2026, 9, 30);
  const tests = [entry('recent', date(2026, 9, 20)), entry('august-a', date(2026, 8, 2)), entry('august-b', date(2026, 8, 12)), entry('july', date(2026, 7, 1)), entry('old-a', date(2025, 8, 2)), entry('old-b', date(2025, 7, 2)), entry('older', date(2024, 5, 2))];
  const grouped = groupHistoryTests(tests, now);
  assert.deepEqual(grouped.recent.map(t => t.id), ['recent']);
  assert.deepEqual(grouped.months.map(m => [m.key, m.tests.map(t => t.id)]), [['2026-08', ['august-b', 'august-a']], ['2026-07', ['july']]]);
  assert.deepEqual(grouped.years.map(y => [y.key, y.count, y.months.map(m => m.key)]), [['2025', 2, ['2025-08', '2025-07']], ['2024', 1, ['2024-05']]]);
  const all = [...grouped.recent, ...grouped.months.flatMap(m => m.tests), ...grouped.years.flatMap(y => y.months.flatMap(m => m.tests)), ...grouped.undated];
  assert.equal(new Set(all.map(t => t.id)).size, tests.length);
  assert.equal(all.length, tests.length);
});

void test('stacking begins at exactly one calendar month and one calendar year', () => {
  const now = date(2026, 9, 30);
  const grouped = groupHistoryTests([entry('month', date(2026, 8, 30)), entry('month-plus-second', new Date(date(2026, 8, 30).getTime() + 1000)), entry('year', date(2025, 9, 30)), entry('year-plus-second', new Date(date(2025, 9, 30).getTime() + 1000))], now);
  assert.deepEqual(grouped.recent.map(t => t.id), ['month-plus-second']);
  assert.deepEqual(grouped.months.flatMap(m => m.tests).map(t => t.id), ['month', 'year-plus-second']);
  assert.deepEqual(grouped.years.flatMap(y => y.months.flatMap(m => m.tests)).map(t => t.id), ['year']);
});

void test('calendar cutoffs clamp short months and leap years', () => {
  const march = groupHistoryTests([entry('february', date(2026, 2, 28)), entry('after-cutoff', new Date(date(2026, 2, 28).getTime() + 1000))], date(2026, 3, 31));
  assert.deepEqual(march.months.flatMap(m => m.tests).map(t => t.id), ['february']);
  assert.deepEqual(march.recent.map(t => t.id), ['after-cutoff']);
  const leap = groupHistoryTests([entry('previous-year', date(2023, 2, 28))], date(2024, 2, 29));
  assert.equal(leap.years[0].key, '2023');
});

void test('opening an old test never changes its original calendar group and input order stays intact', () => {
  const tests = [entry('old', date(2025, 4, 1), { updatedAt: date(2026, 9, 30).toISOString() }), entry('new', date(2026, 9, 1))];
  assert.deepEqual(sortHistoryTests(tests).map(t => t.id), ['new', 'old']);
  assert.equal(groupHistoryTests(tests, date(2026, 9, 30)).years[0].months[0].key, '2025-04');
  assert.deepEqual(tests.map(t => t.id), ['old', 'new']);
});

void test('live search finds tests in every age group by title, mode, status, month and date', () => {
  const tests = [entry('old', date(2024, 5, 2), { title: 'Cardiology review' }), entry('recent', date(2026, 9, 1), { title: 'Pediatrics', mode: 'tutor', status: 'active' })];
  for (const query of ['CARDIOLOGY', 'cardiology may 2024', '2024-05-02', 'cardiology completed']) assert.deepEqual(filterHistoryTests(tests, query).map(t => t.id), ['old']);
  for (const query of ['pediatrics tutor', 'not completed', 'resume']) assert.deepEqual(filterHistoryTests(tests, query).map(t => t.id), ['recent']);
  assert.deepEqual(filterHistoryTests(tests, '  '), tests);
  assert.deepEqual(filterHistoryTests(tests, 'unmatched'), []);
});

void test('undated sessions remain accessible and searchable instead of disappearing', () => {
  const tests = [{ id: 'legacy', title: 'Legacy test', startedAt: 'invalid', mode: 'timed', status: 'active' }];
  assert.deepEqual(groupHistoryTests(tests, date(2026, 9, 30)).undated, tests);
  assert.deepEqual(filterHistoryTests(tests, 'legacy'), tests);
});
