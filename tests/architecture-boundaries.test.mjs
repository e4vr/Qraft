import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

async function filesBelow(path) {
  const entries = await readdir(new URL(path, root), {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`);
}

void test('the framework Cloudflare route remains a thin server adapter', async () => {
  const route = await source('app/api/cloudflare/[...path]/route.ts');
  assert.match(route, /from '@\/server\/api\/cloudflare-router'/);
  assert.match(route, /dynamic = 'force-dynamic'/);
  assert.doesNotMatch(route, /cloudflare:workers/);
  assert.doesNotMatch(route, /function (?:route|enforce|safely|pathParts)/);
});

void test('domain policies are pure and have one canonical implementation', async () => {
  const access = await source('features/access/domain/access-policy.ts');
  const plans = await source(
    'features/subscriptions/domain/plan-config.ts',
  );
  const planFacade = await source('lib/plan-config.ts');
  const types = await source('lib/medguard-types.ts');

  for (const domain of [access, plans]) {
    assert.doesNotMatch(domain, /cloudflare:workers/);
    assert.doesNotMatch(domain, /@\/server\//);
    assert.doesNotMatch(domain, /\bfetch\s*\(/);
  }
  assert.match(planFacade, /export \* from '@\/features\/subscriptions\/domain\/plan-config'/);
  assert.doesNotMatch(planFacade, /PLAN_LIMITS\s*=/);
  assert.match(types, /from '@\/features\/access\/domain\/access-policy'/);
  assert.doesNotMatch(types, /function canAccessBank/);
});

void test('browser components do not depend on server or Cloudflare modules', async () => {
  const componentFiles = await filesBelow('components');
  for (const file of componentFiles) {
    const content = await readFile(file, 'utf8');
    assert.doesNotMatch(content, /from ['"]@\/server\//, file);
    assert.doesNotMatch(content, /from ['"]cloudflare:workers['"]/, file);
  }
});

void test('client integrations are owned by feature modules', async () => {
  const facade = await source('lib/cloudflare-client.ts');
  const applicationServices = await source('lib/application-services.ts');

  for (const feature of ['auth', 'collaboration', 'exams', 'qbanks', 'state']) {
    assert.match(facade, new RegExp(`@/features/${feature}/client/`));
    assert.match(applicationServices, new RegExp(`@/features/${feature}/client/`));
  }
  assert.doesNotMatch(facade, /\bfunction\s+/);
  assert.doesNotMatch(applicationServices, /\bfunction\s+/);

  const featureFiles = await filesBelow('features');
  for (const file of featureFiles) {
    const content = await readFile(file, 'utf8');
    assert.doesNotMatch(content, /from ['"]@\/components\//, file);
  }
});
