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
  const review = await readFile(new URL('components/review-workspace.tsx', root), 'utf8');
  assert.match(rules, /editKinds\.size\(\) > 0/);
  assert.match(rules, /payload\.explanation\.size\(\) > 0/);
  assert.match(rules, /payload\.sourceReference\.size\(\) > 0/);
  assert.match(app, /Suggest Edit → Review → Approve\s*\/\s*Reject/);
  assert.match(review, /Proposed · \{label\}/);
});

test('study experience includes persistent marker, answer statistics, dark mode, and collapsed topics', async () => {
  const app = await readFile(new URL('components/medguard-app.tsx', root), 'utf8');
  assert.match(app, /MARKER ON/);
  assert.match(app, /copySelectionAndMark/);
  assert.match(app, /answerStats/);
  assert.match(app, /prefers-color-scheme:\s*dark/);
  assert.match(app, /<details\s+key=\{topic\.topic\}/);
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

test('QBank owners can manage access, links, questions, and deletion', async () => {
  const manager = await readFile(new URL('components/qbank-management.tsx', root), 'utf8');
  const workspace = await readFile(new URL('components/qbank-workspace.tsx', root), 'utf8');
  const cloud = await readFile(new URL('lib/firebase-client.ts', root), 'utf8');
  assert.match(workspace, /My QBanks/);
  assert.match(workspace, /onManageBank/);
  assert.match(manager, /Change link/);
  assert.match(manager, /Revoke access/);
  assert.match(manager, /Delete permanently/);
  assert.match(manager, /Add question manually/);
  assert.match(cloud, /deleteQBankImages/);
});

test('Question IDs are globally reserved and never reused', async () => {
  const rules = await readFile(new URL('firestore.rules', root), 'utf8');
  const cloud = await readFile(new URL('lib/firebase-client.ts', root), 'utf8');
  assert.match(rules, /match \/system\/questionCounter/);
  assert.match(rules, /match \/questionIds\/\{questionId\}/);
  assert.match(rules, /questionId\.matches\('\^\[0-9\]\{5\}\$'\)/);
  assert.match(cloud, /reserveQuestionIds/);
  assert.match(cloud, /end > 99999/);
});

test('review workspace, test deletion, question images, and Qraft JSON import are available', async () => {
  const app = await readFile(new URL('components/medguard-app.tsx', root), 'utf8');
  const review = await readFile(new URL('components/review-workspace.tsx', root), 'utf8');
  const manager = await readFile(new URL('components/qbank-management.tsx', root), 'utf8');
  assert.match(app, />\s*Review\s*<\/span>/);
  assert.match(app, /Delete this test\?/);
  assert.match(app, /Question ID/);
  assert.match(app, /aria-label="Question images"/);
  assert.match(review, /New ·\s*\{pending\.length\}/);
  assert.match(review, /Reviewed ·\s*\{reviewed\.length\}/);
  assert.match(manager, /qraft-question-bank-v1/);
  assert.match(manager, /One question per slide/);
  assert.match(manager, /Upload Qraft JSON/);
  assert.match(review, /questionId: status === 'approved'/);
});

test('access blocklist covers phone, university ID, and email registrations', async () => {
  const rules = await readFile(new URL('firestore.rules', root), 'utf8');
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  const dashboard = await readFile(new URL('components/collaboration-dashboard.tsx', root), 'utf8');
  const localDb = await readFile(new URL('lib/local-db.ts', root), 'utf8');
  assert.match(types, /interface AccessBlocklist/);
  assert.match(dashboard, /Blocked access list/);
  assert.match(dashboard, /Mobile numbers/);
  assert.match(dashboard, /University IDs/);
  assert.match(dashboard, /Email addresses/);
  assert.match(localDb, /This email, university ID, or mobile number is blocked/);
  assert.match(rules, /match \/system\/accessControl/);
  assert.match(rules, /accessBlocked\(request\.resource\.data\)/);
});
