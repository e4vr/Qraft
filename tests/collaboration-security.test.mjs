import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

void test('collaborative governance is enforced by the Cloudflare API', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  assert.match(server, /user\.status !== 'approved'/);
  assert.match(server, /user\.role === 'super_admin'/);
  assert.match(server, /hasAccessManagerRole\(user\)/);
  assert.match(server, /canReviewBank\(user, existing, state\.memberships\)/);
  assert.match(server, /proposalChangeAllowed/);
  assert.match(server, /value\.version === current\.version \+ 1/);
  assert.match(
    server,
    /value\.history\.length === current\.history\.length \+ 1/,
  );
});

void test('any university ID can request registration while IDs remain single-claim', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const schema = await readFile(new URL('db/schema.ts', root), 'utf8');
  const migration = await readFile(
    new URL('drizzle/0003_open_registration.sql', root),
    'utf8',
  );
  assert.match(schema, /universityClaims/);
  assert.match(
    migration,
    /DROP TRIGGER IF EXISTS `trg_validate_university_claim`/,
  );
  assert.match(server, /INSERT INTO university_claims/);
  assert.match(server, /universityIdRegistered = Boolean\(allowed\)/);
  assert.doesNotMatch(server, /not eligible or has already been used/);
  assert.match(server, /status: isRoot \? 'approved' : 'pending'/);
});

void test('the registration dashboard highlights IDs that need manual verification', async () => {
  const dashboard = await readFile(
    new URL('components/collaboration-dashboard.tsx', root),
    'utf8',
  );
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  assert.match(types, /universityIdRegistered\?: boolean/);
  assert.match(types, /universityIdVerifiedManually\?: boolean/);
  assert.match(dashboard, /IDs need manual verification/);
  assert.match(dashboard, /NOT REGISTERED · VERIFY MANUALLY/);
  assert.match(dashboard, /Verify & approve/);
  assert.match(dashboard, /MANUALLY VERIFIED/);
});

void test('platform roles are managed independently from subscriptions', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  const dashboard = await readFile(
    new URL('components/collaboration-dashboard.tsx', root),
    'utf8',
  );
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const entitlements = await readFile(
    new URL('lib/entitlement-server.ts', root),
    'utf8',
  );
  assert.match(app, /Request role/);
  assert.match(app, /option value="moderator">Moderator/);
  assert.match(app, /superAdminUid: current\.security\.superAdminUid/);
  assert.match(dashboard, /Role management/);
  assert.match(dashboard, /toggleAccountRole/);
  assert.match(dashboard, /saveAccountRoles/);
  assert.match(dashboard, /Moderator includes Reviewer and Access Manager permissions/);
  assert.doesNotMatch(dashboard, /toggleAccountRole\(member, 'pro'\)/);
  assert.match(dashboard, /disabled={!unsaved}/);
  assert.match(dashboard, /account_roles_saved/);
  assert.match(dashboard, /Manage roles/);
  assert.match(server, /profileUpdateAllowed/);
  assert.match(server, /isPlatformRole\(value\.requestedRole\)/);
  assert.match(
    server,
    /value\.superAdminUid !== state\.security\.superAdminUid/,
  );
  assert.doesNotMatch(entitlements, /reviewerBenefit/);
  assert.doesNotMatch(entitlements, /profile\.role/);
});

void test('separate QBanks and attributed shared notes are present', async () => {
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  assert.match(types, /activeQBankId: 'smle-gs'/);
  assert.match(types, /interface SharedQuestionNote/);
  assert.match(types, /updatedByName: string/);
  assert.match(app, /Save shared note/);
  assert.match(app, /Submit for review/);
});

void test('private banks, per-bank roles, and owner boundaries are enforced', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  assert.match(
    types,
    /type AccountTier = 'free' \| 'lite' \| 'pro' \| 'unlimited'/,
  );
  assert.match(types, /type BankRole = 'owner' \| 'reviewer' \| 'viewer'/);
  assert.match(server, /canAccessBank\(user, existing/);
  assert.match(server, /value\.ownerId === user\.uid/);
  assert.match(server, /operation\.collection === 'qbankShareLinks'/);
});

void test('edit proposals require classified changes, a source, and review', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  const review = await readFile(
    new URL('components/review-workspace.tsx', root),
    'utf8',
  );
  assert.match(server, /proposal\.editKinds\.length > 0/);
  assert.match(server, /typeof payload\?\.explanation === 'string'/);
  assert.match(server, /payload\.sourceReference\.trim/);
  assert.match(app, /Suggest Edit → Review → Approve\s*\/\s*Reject/);
  assert.match(review, /Proposed · \{label\}/);
});

void test('study experience includes persistent marker, answer statistics, dark mode, and collapsed topics', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  assert.match(app, /MARKER ON/);
  assert.match(app, /copySelectionAndMark/);
  assert.match(app, /answerStats/);
  assert.match(app, /prefers-color-scheme:\s*dark/);
  assert.match(app, /<details\s+key=\{topic\.topic\}/);
});

void test('QBank switching, review counters, random tests, private notes, labs, and grouped progress are integrated', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  const review = await readFile(
    new URL('components/review-workspace.tsx', root),
    'utf8',
  );
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  assert.doesNotMatch(
    app,
    /onSelectQBank\(event\.target\.value\);\s*navigate\('dashboard'\)/,
  );
  assert.match(app, /pendingReviewCount/);
  assert.match(review, /activeQBankId/);
  assert.match(app, /Random QBank Test/);
  assert.match(app, /nextTestTitle/);
  assert.match(app, /Private Note/);
  assert.match(app, /Laboratory reference values/);
  assert.match(app, /mainProgressCategory/);
  assert.match(types, /highlightSections/);
});

void test('private flashcards support decks, Anki import, question conversion, and FSRS review', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  const flashcards = await readFile(
    new URL('components/flashcards-workspace.tsx', root),
    'utf8',
  );
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  assert.match(app, /label: 'Flashcards'/);
  assert.match(app, /dueFlashcardCount/);
  assert.match(app, /QuestionFlashcardDialog/);
  assert.match(flashcards, /Import Anki/);
  assert.match(flashcards, /collection\.anki21/);
  assert.match(flashcards, /Support older Anki versions/);
  assert.match(flashcards, /ignoredAudio/);
  assert.match(flashcards, /request_retention/);
  assert.match(flashcards, /Rating\.Again/);
  assert.match(types, /interface FlashcardDeck/);
  assert.match(types, /flashcardSchedules/);
  assert.match(server, /Invalid flashcard data/);
});

void test('collaboration reads are scoped to the user\'s accessible QBanks', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const migration = await readFile(
    new URL('drizzle/0006_scope_collaboration_reads.sql', root),
    'utf8',
  );
  assert.match(server, /recordsByTypes/);
  assert.match(server, /qbank_id IN/);
  assert.match(server, /allowedBankIds\.add\('smle-gs'\)/);
  assert.match(migration, /idx_records_qbank_type/);
  assert.match(migration, /json_extract\(payload, '\$\.qbankId'\)/);
});

void test('ending a test uses the branded save confirmation instead of a browser alert', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  assert.doesNotMatch(app, /window\.confirm\(/);
  assert.match(app, /role="alertdialog"/);
  assert.match(app, /allQuestionsAnswered/);
  assert.match(app, /Continue Later and Save/);
  assert.match(app, /End and Save/);
  assert.match(app, /status: 'active',[\s\S]*completedAt: undefined/);
  assert.match(app, /Keep studying/);
});

void test('the sidebar keeps navigation scrollable and the account footer visible', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  assert.match(app, /h-dvh/);
  assert.match(app, /min-h-0 flex-1 space-y-1 overflow-y-auto/);
  assert.match(app, /<footer className="shrink-0 border-t/);
  assert.match(app, /aria-current=\{view === item\.id \? 'page'/);
});

void test('the singleton Superadmin is gated by authenticator-app MFA', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  assert.match(server, /ROOT_ADMIN_EMAIL/);
  assert.match(server, /ROOT_ADMIN_SETUP_TOKEN/);
  assert.match(server, /MFA_REQUIRED/);
  assert.match(server, /enrolledTotpSecret/);
  assert.match(server, /existing\.role === 'super_admin'/);
});

void test('password hashing stays within the Cloudflare Workers PBKDF2 limit', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  assert.match(server, /PBKDF2_ITERATIONS = 100_000/);
  assert.doesNotMatch(server, /iterations:\s*210_000/);
});

void test('QBank owners can manage access, links, questions, and deletion', async () => {
  const manager = await readFile(
    new URL('components/qbank-management.tsx', root),
    'utf8',
  );
  const workspace = await readFile(
    new URL('components/qbank-workspace.tsx', root),
    'utf8',
  );
  const cloud = await readFile(
    new URL('lib/cloudflare-client.ts', root),
    'utf8',
  );
  assert.match(workspace, /My QBanks/);
  assert.match(workspace, /onManageBank/);
  assert.match(manager, /Change link/);
  assert.match(manager, /Revoke access/);
  assert.match(manager, /Delete permanently/);
  assert.match(manager, /Add question manually/);
  assert.match(cloud, /deleteQBankImages/);
});

void test('Question IDs are reserved atomically and released only by hard deletion', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const cloud = await readFile(
    new URL('lib/cloudflare-client.ts', root),
    'utf8',
  );
  const allocator = await readFile(
    new URL('lib/question-id-repository.ts', root),
    'utf8',
  );
  const migration = await readFile(
    new URL('drizzle/0004_subscriptions_support.sql', root),
    'utf8',
  );
  const efficientMigration = await readFile(
    new URL('drizzle/0009_efficient_d1_access.sql', root),
    'utf8',
  );
  assert.match(migration, /question_identity_delete/);
  assert.match(migration, /retired_questions/);
  assert.match(allocator, /INSERT INTO question_ids/);
  assert.match(allocator, /RETURNING question_id/);
  assert.match(efficientMigration, /question_id_release_to_pool/);
  assert.match(cloud, /reserveQuestionIds/);
  assert.match(allocator, /99999/);
  assert.doesNotMatch(server, /WITH RECURSIVE numbers/);
});

void test('D1 hot paths use indexed lookups instead of correlated full scans', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const realtime = await readFile(
    new URL('lib/realtime-client.ts', root),
    'utf8',
  );
  assert.doesNotMatch(server, /SELECT \* FROM records/);
  assert.doesNotMatch(server, /DELETE FROM records WHERE EXISTS/);
  assert.match(server, /INDEXED BY idx_records_type_id/);
  assert.doesNotMatch(realtime, /const fallback = setInterval/);
});

void test('review workspace, test deletion, question images, and Qraft JSON import are available', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  const review = await readFile(
    new URL('components/review-workspace.tsx', root),
    'utf8',
  );
  const manager = await readFile(
    new URL('components/qbank-management.tsx', root),
    'utf8',
  );
  const importReview = await readFile(
    new URL('components/question-import-review.tsx', root),
    'utf8',
  );
  const platform = await readFile(
    new URL('lib/platform-server.ts', root),
    'utf8',
  );
  const storage = await readFile(
    new URL('lib/storage-service.ts', root),
    'utf8',
  );
  assert.match(app, />\s*Review\s*<\/span>/);
  assert.match(app, /Delete this test\?/);
  assert.match(app, /Question ID/);
  assert.match(app, /Edit & resubmit/);
  assert.match(app, /aria-label="Question images"/);
  assert.match(review, /Awaiting review ·\s*\{pending\.length\}/);
  assert.match(
    review,
    /Reviewed ·\s*\{historyReady \? reviewed\.length : '…'\}/,
  );
  assert.match(importReview, /QuestionImportReview/);
  assert.match(importReview, /One question per slide/);
  assert.match(manager, /QuestionImportReview/);
  assert.match(platform, /questionId:\s*status === 'approved'/);
  assert.match(review, /Bulk review/);
  assert.match(review, /Select latest/);
  assert.match(review, /Approve selected/);
  assert.match(review, /Reject selected/);
  assert.match(review, /submissionMethod/);
  assert.match(platform, /action === 'bulk-review'/);
  assert.match(platform, /rawProposalIds\.length > 200/);
  assert.match(server, /current\.status !== 'approved'/);
  assert.match(storage, /HARD_STORAGE_CAP_BYTES = 3 \* 1024 \* 1024 \* 1024/);
  assert.match(server, /upload\.imagekit\.io\/api\/v1\/files\/upload/);
});

void test('access blocklist covers phone, university ID, and email registrations', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  const dashboard = await readFile(
    new URL('components/collaboration-dashboard.tsx', root),
    'utf8',
  );
  assert.match(types, /interface AccessBlocklist/);
  assert.match(dashboard, /Blocked access list/);
  assert.match(dashboard, /Mobile numbers/);
  assert.match(dashboard, /University IDs/);
  assert.match(dashboard, /Email addresses/);
  assert.match(
    server,
    /This email, university ID, or mobile number is blocked/,
  );
  assert.match(server, /type = 'system' AND id = 'accessControl'/);
});

void test('test sessions can restart, pause, resume, and be completed later', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  assert.match(app, /Restart this question/);
  assert.match(app, /revealed: current\.revealed\.filter/);
  assert.match(app, /graded: current\.graded\.filter/);
  assert.match(app, /Continue Later and Save/);
  assert.match(app, /Pause timer/);
  assert.match(app, /Continue test and resume timer/);
  assert.match(app, /backdrop-blur-xl/);
  assert.match(types, /timerPaused\?: boolean/);
  assert.match(types, /elapsedSeconds\?: number/);
});

void test('the revealed explanation is read-only and resizable', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  assert.match(app, /ResizablePanelGroup/);
  assert.match(app, /<ResizableHandle\s+withHandle/);
  assert.match(app, /READ ONLY/);
  assert.match(app, /Drag the divider to control the explanation space/);
  assert.match(
    app,
    /sharedNote\?\.content\.trim\(\)\s*\|\|\s*question\?\.explanation/,
  );
  assert.match(app, /Save shared note/);
});

void test('questions and JSON prompts support a configurable number of options', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  const manager = await readFile(
    new URL('components/qbank-management.tsx', root),
    'utf8',
  );
  const importReview = await readFile(
    new URL('components/question-import-review.tsx', root),
    'utf8',
  );
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  assert.match(types, /function optionLabel/);
  assert.match(importReview, /Options per question/);
  const importer = await readFile(
    new URL('lib/question-import.ts', root),
    'utf8',
  );
  assert.match(importer, /exactly \$\{optionCount\} distinct/);
  assert.match(
    importer,
    /options.length < 2\s*\|\|\s*item.options.length > 10/,
  );
  assert.match(manager, /Add option/);
  assert.match(app, /proposedOptions\.length >= 10/);
  assert.match(app, /options\.length >= 10/);
});

void test('Essential QBanks are managed only by Superadmin while other users submit proposals', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  const workspace = await readFile(
    new URL('components/qbank-workspace.tsx', root),
    'utf8',
  );
  const manager = await readFile(
    new URL('components/qbank-management.tsx', root),
    'utf8',
  );
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  assert.match(types, /essential: boolean/);
  assert.match(types, /essential: true/);
  assert.match(types, /function canManageBank/);
  assert.match(workspace, /Check to make it an Essential QBank/);
  assert.match(manager, /ESSENTIAL · SUPERADMIN/);
  assert.match(app, /canManageBank\(user, qbank\)/);
  assert.match(server, /value\.essential !== true \|\| isRoot/);
  assert.match(server, /value\.essential === existing\.essential/);
});

void test('Every subscription can contribute questions and redeem earned rewards', async () => {
  const plans = await readFile(new URL('lib/plan-config.ts', root), 'utf8');
  for (const plan of ['free', 'lite', 'pro', 'unlimited']) {
    const block = plans.match(
      new RegExp(`${plan}: \\{([\\s\\S]*?)\\n  \\},`),
    )?.[1];
    assert.ok(block, `${plan} plan configuration is present`);
    assert.match(block, /canAddQuestions: true/);
    assert.match(block, /canContribute: true/);
  }
  const lite = plans.match(/lite: \{([\s\S]*?)\n  \},/)?.[1];
  assert.ok(lite, 'Lite plan configuration is present');
  assert.match(lite, /canCreateQBank: false/);
  assert.match(lite, /canCreatePrivateQBank: false/);
  assert.match(lite, /canAddQuestions: true/);
  assert.match(plans, /REWARD_CATALOG/);
});

void test('QBank library uses a categorized list with favorites and pins', async () => {
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  const workspace = await readFile(
    new URL('components/qbank-workspace.tsx', root),
    'utf8',
  );
  assert.match(types, /favoriteQBankIds: string\[\]/);
  assert.match(types, /pinnedQBankIds: string\[\]/);
  assert.match(types, /qbankCategoryById: Record<string, string>/);
  assert.match(workspace, /New subcategory/);
  assert.match(workspace, /toggleList\('favoriteIds'/);
  assert.match(workspace, /toggleList\('pinnedIds'/);
  assert.match(workspace, /\{questions\} questions/);
  assert.match(workspace, /by \{bank\.ownerName\}/);
});

void test('shared QBank links require an explicit accept or decline decision', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  assert.match(server, /previewBankInvite/);
  assert.match(app, /QBank invitation/);
  assert.match(app, />\s*Decline\s*</);
  assert.match(app, /'Joining…' : 'Accept'/);
  assert.match(app, /await joinCloudflareQBankByLink/);
  assert.match(app, /url\.searchParams\.delete\('join_qbank'\)/);
  assert.match(app, /handledInvitationLink\.current = linkKey;\s*clearInvitationLink\(\);/);
  assert.match(app, /collaboration\.memberships\.some/);
});

void test('every question change requires independent review with durable attribution', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  const manager = await readFile(
    new URL('components/qbank-management.tsx', root),
    'utf8',
  );
  const review = await readFile(
    new URL('components/review-workspace.tsx', root),
    'utf8',
  );
  const platform = await readFile(
    new URL('lib/platform-server.ts', root),
    'utf8',
  );
  assert.match(types, /writtenByName\?: string/);
  assert.match(types, /reviewedByName\?: string/);
  assert.match(types, /hasReviewerRole\(user\)/);
  assert.match(server, /current\.proposedById !== user\.uid/);
  assert.match(server, /reviewedQuestionWriteAllowed/);
  assert.match(manager, /QuestionImportReview/);
  assert.doesNotMatch(manager, /questions_json_imported/);
  assert.match(review, /proposal\.reviewedById === user\.uid/);
  assert.match(platform, /writtenByName:\s*proposal\.type === 'new_question'/);
  assert.match(app, /Written by/);
  assert.match(app, /Reviewed by/);
});
