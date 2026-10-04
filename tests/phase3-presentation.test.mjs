import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

async function codeFiles(path) {
  const entries = await readdir(new URL(path, root), {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`);
}

void test('presentation mode has one canonical resolver and shell boundary', async () => {
  const resolver = await source('features/presentation/presentation-context.tsx');
  const shell = await source('components/presentation/qraft-app-shell.tsx');

  assert.match(resolver, /type PresentationMode = 'desktop' \| 'tablet' \| 'handheld'/);
  assert.match(resolver, /useSyncExternalStore/);
  assert.match(resolver, /visualViewport/);
  assert.match(shell, /mode === 'handheld'/);
  assert.match(shell, /mode === 'tablet'/);
  assert.equal((shell.match(/className="q-stage q-enter"/g) ?? []).length, 1);
});

void test('device decisions do not leak into feature components', async () => {
  const files = await codeFiles('components');
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    assert.doesNotMatch(content, /\bisMobile\b/, file);
    assert.doesNotMatch(content, /window\.innerWidth/, file);
    assert.doesNotMatch(content, /navigator\.userAgent/, file);
  }
});

void test('desktop and handheld dashboards share one domain model', async () => {
  const desktop = await source('components/study-dashboard.tsx');
  const mobile = await source('components/presentation/mobile-study-dashboard.tsx');
  const model = await source('features/dashboard/domain/study-dashboard-model.ts');

  assert.match(desktop, /buildStudyDashboardModel/);
  assert.match(mobile, /StudyDashboardModel/);
  assert.match(model, /completed/);
  assert.match(model, /accuracy/);
  assert.doesNotMatch(model, /window\.|document\.|@\/components\//);
});

void test('iPad rail exposes ten ordered destinations without changing phone navigation', async () => {
  const navigation = await source('components/study-mobile-nav.tsx');
  const app = await source('components/medguard-app.tsx');
  const shell = await source('components/presentation/qraft-app-shell.tsx');
  const styles = await source('app/globals.css');

  const handheldBlock = navigation.match(/const primaryItems = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
  assert.deepEqual(
    [...handheldBlock.matchAll(/id: '([^']+)'/g)].map((match) => match[1]),
    ['dashboard', 'library', 'create', 'flashcards', 'progress'],
  );
  const tabletBlock = navigation.match(/const tabletCoreItems = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
  assert.deepEqual(
    [...tabletBlock.matchAll(/id: '([^']+)'/g)].map((match) => match[1]),
    ['dashboard', 'library', 'create', 'preformed', 'history', 'flashcards', 'progress', 'settings'],
  );
  assert.match(navigation, /const TABLET_RAIL_ITEM_LIMIT = 10/);
  assert.match(navigation, /\.\.\.tabletCoreItems,[\s\S]*showReview[\s\S]*tabletContactItem[\s\S]*showSubscribe[\s\S]*\.\.\.tabletCommunityItems,[\s\S]*\.slice\(0, TABLET_RAIL_ITEM_LIMIT\)/);
  assert.match(navigation, /\{primaryItems\.map\(\(item\) =>/);
  assert.match(navigation, /\{tabletItems\.map\(\(item\) =>/);
  assert.match(navigation, /aria-label="More"[\s\S]*onClick=\{onMore\}/);
  assert.match(app, /showReview=\{showReview\}/);
  assert.match(app, /showSubscribe=\{user\.role !== 'super_admin'\}/);
  assert.match(shell, /mode === 'handheld' && handheldNavigation/);
  assert.match(shell, /mode === 'tablet' && tabletNavigation/);
  assert.match(styles, /\.q-tablet-rail \{[\s\S]*gap: clamp\(2px, \.55vh, var\(--q-space-2\)\)/);
  assert.match(styles, /\.q-tablet-rail button \{[\s\S]*min-height: clamp\(48px, 6vh, 56px\)/);
});

void test('semantic study destinations are directly routable', async () => {
  const routes = [
    'study/page.tsx',
    'qbanks/page.tsx',
    'qbanks/[id]/page.tsx',
    'exams/new/page.tsx',
    'exams/[id]/page.tsx',
    'history/page.tsx',
    'flashcards/page.tsx',
    'progress/page.tsx',
    'review/page.tsx',
    'settings/page.tsx',
  ];
  for (const path of routes) {
    const route = await source(`app/${path}`);
    assert.match(route, /QraftRoute/);
  }
});

void test('PWA locks installed-mode zoom and exposes controlled update behavior', async () => {
  const layout = await source('app/layout.tsx');
  const presentation = await source('features/presentation/presentation-context.tsx');
  const guards = await source('features/presentation/standalone-touch-guards.ts');
  const manifest = JSON.parse(await source('public/manifest.webmanifest'));
  const worker = await source('public/sw.js');

  assert.doesNotMatch(layout, /maximumScale|userScalable/);
  assert.doesNotMatch(layout, /user-scalable=no|maximum-scale=1|minimum-scale=1/);
  assert.match(presentation, /if \(!environment\.standalone\) return/);
  assert.match(presentation, /installStandaloneTouchGuards/);
  assert.match(guards, /event\.touches\.length > 1/);
  assert.match(guards, /\['gesturestart', prevent\]/);
  assert.ok(manifest.display_override.includes('standalone'));
  assert.ok(manifest.shortcuts.some((item) => item.url === '/exams/new'));
  assert.match(worker, /QRAFT_SKIP_WAITING/);
  assert.match(worker, /QRAFT_SW_ACTIVATED/);
  assert.match(worker, /clients\.claim/);
});
