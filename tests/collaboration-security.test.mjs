import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('collaborative governance is enforced in Firestore rules', async () => {
  const rules = await readFile(new URL('firestore.rules', root), 'utf8');
  assert.match(rules, /profile\(\)\.status == 'approved'/);
  assert.match(rules, /request\.auth\.uid == rootUid\(\)/);
  assert.match(rules, /profile\(\)\.platformRoles\.hasAny\(\['access_manager'\]\)/);
  assert.match(rules, /profile\(\)\.platformRoles\.hasAny\(\['reviewer'\]\)/);
  assert.match(rules, /match \/questionProposals\/\{proposalId\}/);
  assert.match(rules, /allow update: if canReviewBank\(resource\.data\.qbankId\)/);
  assert.match(rules, /request\.resource\.data\.version == resource\.data\.version \+ 1/);
  assert.match(rules, /request\.resource\.data\.history\.size\(\) == resource\.data\.history\.size\(\) \+ 1/);
});

test('student IDs are single-claim and registration starts pending', async () => {
  const rules = await readFile(new URL('firestore.rules', root), 'utf8');
  const client = await readFile(new URL('lib/firebase-client.ts', root), 'utf8');
  assert.match(rules, /resource\.data\.claimedById == null/);
  assert.match(rules, /request\.resource\.data\.claimedById == request\.auth\.uid/);
  assert.match(client, /if \(!allowed\.exists\(\) \|\| allowed\.data\(\)\.claimedById\)/);
  assert.match(client, /status: 'pending'/);
});

test('separate QBanks and attributed shared notes are present', async () => {
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  const app = await readFile(new URL('components/medguard-app.tsx', root), 'utf8');
  assert.match(types, /activeQBankId: 'smle-gs'/);
  assert.match(types, /interface SharedQuestionNote/);
  assert.match(types, /updatedByName: string/);
  assert.match(app, /Save shared note/);
  assert.match(app, /Submit for review/);
});

test('private banks, per-bank roles, and owner boundaries are enforced', async () => {
  const rules = await readFile(new URL('firestore.rules', root), 'utf8');
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  assert.match(types, /type AccountTier = 'lite' \| 'pro'/);
  assert.match(types, /type BankRole = 'owner' \| 'reviewer' \| 'viewer'/);
  assert.match(rules, /resource\.data\.visibility == 'public'/);
  assert.match(rules, /resource\.data\.ownerId == request\.auth\.uid/);
  assert.match(rules, /bank\(qbankId\)\.visibility == 'public' && \(superAdmin\(\) \|\| globalReviewer\(\)\)/);
  assert.match(rules, /match \/qbankShareLinks\/\{token\}/);
});

test('edit proposals require classified changes, explanation, source, and review', async () => {
  const rules = await readFile(new URL('firestore.rules', root), 'utf8');
  const app = await readFile(new URL('components/medguard-app.tsx', root), 'utf8');
  const admin = await readFile(new URL('components/collaboration-dashboard.tsx', root), 'utf8');
  assert.match(rules, /editKinds\.size\(\) > 0/);
  assert.match(rules, /payload\.explanation\.size\(\) > 0/);
  assert.match(rules, /payload\.sourceReference\.size\(\) > 0/);
  assert.match(app, /Suggest Edit → Review → Approve \/ Reject/);
  assert.match(admin, /Proposed · \{label\}/);
});

test('study experience includes persistent marker, answer statistics, dark mode, and collapsed topics', async () => {
  const app = await readFile(new URL('components/medguard-app.tsx', root), 'utf8');
  assert.match(app, /MARKER ON/);
  assert.match(app, /copySelectionAndMark/);
  assert.match(app, /answerStats/);
  assert.match(app, /prefers-color-scheme: dark/);
  assert.match(app, /<details key=\{topic\.topic\}/);
});

test('ending a test uses the branded save confirmation instead of a browser alert', async () => {
  const app = await readFile(new URL('components/medguard-app.tsx', root), 'utf8');
  assert.doesNotMatch(app, /window\.confirm\(/);
  assert.match(app, /role="alertdialog"/);
  assert.match(app, /End &amp; save/);
  assert.match(app, /Keep studying/);
});

test('the sidebar keeps navigation scrollable and the account footer visible', async () => {
  const app = await readFile(new URL('components/medguard-app.tsx', root), 'utf8');
  assert.match(app, /h-dvh/);
  assert.match(app, /min-h-0 flex-1 space-y-1 overflow-y-auto/);
  assert.match(app, /<footer className="shrink-0 border-t/);
  assert.match(app, /aria-current=\{view === item\.id \? 'page'/);
});

test('the singleton Superadmin is gated by authenticator-app MFA', async () => {
  const auth = await readFile(new URL('lib/firebase-client.ts', root), 'utf8');
  const rules = await readFile(new URL('firestore.rules', root), 'utf8');
  assert.match(auth, /TotpMultiFactorGenerator\.generateSecret/);
  assert.match(auth, /auth\/multi-factor-auth-required/);
  assert.match(auth, /MFA_REQUIRED/);
  assert.match(rules, /request\.auth\.uid == rootUid\(\)/);
  assert.match(rules, /request\.resource\.data\.role != 'super_admin'/);
});
