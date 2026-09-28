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

void test('collaboration normalization ignores malformed blocked access values', async () => {
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  assert.match(
    types,
    /input\.blockedAccess\?\.phones[\s\S]*filter\(\(value\): value is string => typeof value === 'string'\)/,
  );
  assert.match(
    types,
    /input\.blockedAccess\?\.universityIds[\s\S]*filter\(\(value\): value is string => typeof value === 'string'\)/,
  );
  assert.match(
    types,
    /input\.blockedAccess\?\.emails[\s\S]*filter\(\(value\): value is string => typeof value === 'string'\)/,
  );
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
  assert.match(
    dashboard,
    /Moderator includes Reviewer and Access Manager permissions/,
  );
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
  const access = await readFile(
    new URL('features/access/domain/access-policy.ts', root),
    'utf8',
  );
  assert.match(
    types,
    /type AccountTier = 'free' \| 'lite' \| 'pro' \| 'unlimited'/,
  );
  assert.match(
    types,
    /type BankRole = 'owner' \| 'editor' \| 'reviewer' \| 'viewer'/,
  );
  assert.match(access, /function canEditBank/);
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
  const navigator = await readFile(
    new URL('components/exams/question-navigator.tsx', root),
    'utf8',
  );
  assert.match(app, /MARKER ON/);
  assert.match(app, /copySelectionAndMark/);
  assert.match(app, /answerStats/);
  assert.match(app, /prefers-color-scheme:\s*dark/);
  assert.match(app, /<details\s+key=\{topic\.id\}/);
  assert.match(app, /<QuestionNavigator/);
  assert.match(navigator, /className="q-question-drawer/);
  assert.match(navigator, /aria-labelledby="question-navigator-title"/);
  assert.match(navigator, /\{item\.preview\}/);
  assert.match(navigator, /q-question-drawer-list/);
});

void test('QBank and Preformed exams share the virtualized question navigator', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  const preformed = await readFile(
    new URL('components/preformed-tests-workspace.tsx', root),
    'utf8',
  );
  const navigator = await readFile(
    new URL('components/exams/question-navigator.tsx', root),
    'utf8',
  );
  assert.match(app, /<QuestionNavigator/);
  assert.match(preformed, /<QuestionNavigator/);
  assert.match(app, /aria-label="Open question list"/);
  assert.match(preformed, /aria-label="Open question list"/);
  assert.match(navigator, /const ROW_HEIGHT = 64/);
  assert.match(navigator, /const visibleItems = items\.slice/);
  assert.match(navigator, /currentIndex \* ROW_HEIGHT/);
  assert.match(navigator, /secondaryAction/);
  assert.match(navigator, /primaryAction/);
  assert.match(navigator, /className="block min-w-0 truncate/);
  assert.match(navigator, /style=\{\{[\s\S]*height: `\$\{ROW_HEIGHT\}px`/);
  assert.match(navigator, /top: `\$\{index \* ROW_HEIGHT\}px`/);
  assert.doesNotMatch(navigator, /transform: `translateY\(/);
  assert.match(navigator, /tabIndex=\{-1\}/);
  assert.match(
    navigator,
    /const scrollTop = event\.currentTarget\.scrollTop;[\s\S]*setViewport\(\(current\) => \(\{[\s\S]*scrollTop,/,
  );
  assert.doesNotMatch(
    navigator,
    /setViewport\(\(current\) => \(\{[\s\S]*scrollTop: event\.currentTarget\.scrollTop/,
  );
  assert.doesNotMatch(navigator, /Close question navigator/);
  assert.match(app, /label: 'Close',[\s\S]*label: allQuestionsAnswered \? 'Finish' : 'Continue later'/);
  assert.match(preformed, /label: busy \? 'Saving…' : 'Save & exit',[\s\S]*'Finishing…' : 'Finish'/);
  assert.doesNotMatch(app, /q-test-save-actions/);
  assert.doesNotMatch(app, /aria-label="Exit test"/);
});

void test('QBank test question count follows the filtered pool and plan limit', async () => {
  const app = await readFile(new URL('components/medguard-app.tsx', root), 'utf8');
  assert.match(app, /count: availableExamQuestionLimit\(questions\.length, maxQuestionsPerExam\)/);
  assert.match(app, /const questionLimit = availableExamQuestionLimit\([\s\S]*?eligibleCount,[\s\S]*?maxQuestionsPerExam/);
  assert.match(app, /const selectedCount = countWasEdited\s*\? clampExamQuestionCount\(config\.count, questionLimit\)\s*: questionLimit/);
  assert.match(app, /const count = selectedCount;[\s\S]*onStart\(\{\s*\.\.\.config,\s*count,/);
  assert.match(app, /max=\{questionLimit\}/);
  assert.match(app, /const count = clampExamQuestionCount\(requested, questionLimit\)/);
});

void test('Preformed tests open outside the app shell and resume at the saved question', async () => {
  const app = await readFile(new URL('components/medguard-app.tsx', root), 'utf8');
  const preformed = await readFile(new URL('components/preformed-tests-workspace.tsx', root), 'utf8');
  const attempt = await readFile(new URL('lib/preformed-test-types.ts', root), 'utf8');
  assert.ok(app.indexOf('if (directTestCode) {') < app.indexOf('<QraftAppShell'));
  assert.match(app, /<PreformedTestRunner\s+key=\{`\$\{participant\?\.uid \?\? 'guest'\}:\$\{directTestCode\}`\}/);
  assert.match(app, /onRunTest=\{\(code\) => \{[\s\S]*setDirectTestCode\(code\)/);
  assert.match(app, /const onPopState = \(\) => \{[\s\S]*setDirectTestCode\(/);
  assert.doesNotMatch(preformed, /runningCode|setRunningCode/);
  assert.match(preformed, /q-test-screen q-preformed-runner/);
  assert.match(preformed, /if \(restoring \|\|[\s\S]*Opening saved test/);
  assert.match(preformed, /saved\.currentIndex \?\? 0/);
  assert.match(preformed, /const goToQuestion = \(target: number\) => \{[\s\S]*currentIndex: nextIndex/);
  assert.match(attempt, /currentIndex\?: number/);
});

void test('shared notes open automatically after grading on desktop only', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  assert.match(app, /if \(!handheld\) setNotesOpen\(true\);/);
  assert.match(app, /onClick=\{\(\) => setNotesOpen\(!notesOpen\)\}/);
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
  assert.match(app, /Private note/);
  assert.match(app, /Laboratory reference values/);
  assert.match(app, /groupQuestionsByQBankClassification/);
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

void test("collaboration reads are scoped to the user's accessible QBanks", async () => {
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

void test('the test action finishes answered exams and saves incomplete exams for History', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  assert.doesNotMatch(app, /window\.confirm\(/);
  assert.match(app, /role="alertdialog"/);
  assert.match(app, /allQuestionsAnswered/);
  assert.match(app, /Finish this test\?/);
  assert.match(app, /if \(allQuestionsAnswered\) setFinishConfirmOpen\(true\);[\s\S]*else completeLater\(\);/);
  assert.match(app, /allQuestionsAnswered \? 'Finish' : 'Continue later'/);
  assert.match(app, /status: 'active',[\s\S]*completedAt: undefined/);
  assert.match(app, /onExit\('history'\)/);
  assert.match(app, /test\.origin !== 'bookmarks' \|\| test\.status === 'active'/);
  assert.match(app, /Keep studying/);
});

void test('confirmations share a responsive in-app surface across workspaces', async () => {
  const paths = [
    'components/classification-manager.tsx',
    'components/preformed-tests-workspace.tsx',
    'components/qbank-management.tsx',
    'components/question-import-review.tsx',
    'components/review-workspace.tsx',
    'components/subscription-workspace.tsx',
  ];
  const [files, confirmation, alertDialog, styles] = await Promise.all([
    Promise.all(paths.map((path) => readFile(new URL(path, root), 'utf8'))),
    readFile(new URL('components/ui/confirmation-dialog.tsx', root), 'utf8'),
    readFile(new URL('components/ui/alert-dialog.tsx', root), 'utf8'),
    readFile(new URL('app/globals.css', root), 'utf8'),
  ]);
  assert.doesNotMatch(files.join('\n'), /window\.confirm\(/);
  assert.match(confirmation, /export function useConfirmationDialog/);
  assert.match(alertDialog, /q-confirm-dialog/);
  assert.match(alertDialog, /flex flex-col-reverse[\s\S]*sm:flex-row/);
  assert.match(styles, /\.q-confirm-dialog \{ max-height: calc\(100dvh/);
  assert.match(styles, /\.q-confirm-dialog-wide/);
});

void test('published ready-made tests expose a direct share link', async () => {
  const workspace = await readFile(
    new URL('components/preformed-tests-workspace.tsx', root),
    'utf8',
  );
  assert.match(workspace, /url\.searchParams\.set\('join_test', code\)/);
  assert.match(workspace, /Copy link/);
  assert.match(workspace, /Link copied/);
  assert.match(workspace, /disabled=\{busy \|\| loading \|\| test\.status !== 'published'\}/);
});

void test('the sidebar keeps navigation scrollable and the account footer visible', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  assert.match(app, /h-dvh/);
  assert.match(app, /min-h-0 flex-1 space-y-1 overflow-y-auto/);
  assert.match(
    app,
    /<footer className="[^"]*q-sidebar-footer[^"]*shrink-0 border-t/,
  );
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
  const qbankClient = await readFile(
    new URL('features/qbanks/client/qbank-client.ts', root),
    'utf8',
  );
  assert.match(workspace, /My QBanks/);
  assert.match(workspace, /onManageBank/);
  assert.match(manager, /Change link/);
  assert.match(manager, /Revoke access/);
  assert.match(manager, /Delete permanently/);
  assert.match(manager, /Add question manually/);
  assert.match(qbankClient, /deleteQBankImages/);
});

void test('QBank editors can edit content but owner-only controls stay protected', async () => {
  const access = await readFile(
    new URL('features/access/domain/access-policy.ts', root),
    'utf8',
  );
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const platform = await readFile(
    new URL('lib/platform-server.ts', root),
    'utf8',
  );
  const manager = await readFile(
    new URL('components/qbank-management.tsx', root),
    'utf8',
  );
  const workspace = await readFile(
    new URL('components/qbank-workspace.tsx', root),
    'utf8',
  );
  assert.match(access, /bankRoleFor\(user, bank, memberships\) === 'editor'/);
  assert.match(access, /bankRole === 'editor'/);
  assert.match(server, /operation\.type === 'delete'\) return canManage/);
  assert.match(server, /qbankSpecialties'[\s\S]*return canEdit/);
  assert.match(platform, /canEditBank\(user, bank, state\.memberships\)/);
  assert.match(workspace, /<option value="editor">Editor<\/option>/);
  assert.match(manager, /bankRole === 'editor' \? 'EDITOR' : 'OWNER'/);
  assert.match(manager, /section === 'settings' && canManageAccess/);
  assert.match(manager, /deleteOpen && canManageAccess/);
});

void test('Question IDs are reserved atomically and released only by hard deletion', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const qbankClient = await readFile(
    new URL('features/qbanks/client/qbank-client.ts', root),
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
  assert.match(qbankClient, /reserveQuestionIds/);
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
  const preformed = await readFile(
    new URL('components/preformed-tests-workspace.tsx', root),
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
  assert.match(preformed, /onClick=\{openImport\}/);
  assert.match(preformed, /Import<\/h2>/);
  assert.match(preformed, /Upload your file here/);
  assert.match(preformed, /Questions to generate/);
  assert.match(preformed, /Questions to extract/);
  assert.match(preformed, /Copy AI prompt/);
  assert.match(preformed, /buildQuestionPrompt/);
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
  assert.match(app, /function completeLater\(\)/);
  assert.match(app, /label: 'Close'/);
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
  assert.match(importer, /\$\{optionCount\} distinct answer options/);
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
  const access = await readFile(
    new URL('features/access/domain/access-policy.ts', root),
    'utf8',
  );
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
  assert.match(access, /function canManageBank/);
  assert.match(workspace, /Check to make it an Essential QBank/);
  assert.match(manager, /ESSENTIAL · SUPERADMIN/);
  assert.match(app, /canEditBank\(user, qbank, collaboration\.memberships\)/);
  assert.match(server, /value\.essential !== true \|\| isRoot/);
  assert.match(server, /value\.essential === existing\.essential/);
});

void test('Every subscription can contribute questions and redeem earned rewards', async () => {
  const plans = await readFile(
    new URL('features/subscriptions/domain/plan-config.ts', root),
    'utf8',
  );
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

void test('QBank library uses Superadmin folders, personal shortcuts, and bookmarks', async () => {
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  const workspace = await readFile(
    new URL('components/qbank-workspace.tsx', root),
    'utf8',
  );
  const folderManager = await readFile(
    new URL('components/qbank-folder-manager.tsx', root),
    'utf8',
  );
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  assert.match(types, /favoriteQBankIds: string\[\]/);
  assert.match(types, /pinnedQBankIds: string\[\]/);
  assert.match(types, /quickAccessQBankIds: string\[\]/);
  assert.match(types, /qbankOrderBySection/);
  assert.match(types, /interface QBankFolder/);
  assert.match(types, /bookmarked: boolean/);
  assert.doesNotMatch(types, /qbankCategoryById/);
  assert.match(workspace, /Shared with me/);
  assert.match(workspace, /Public QBanks/);
  assert.match(workspace, /Quick Access QBanks/);
  assert.match(workspace, /Start test/);
  assert.match(workspace, /toggleList\('favoriteIds'/);
  assert.match(workspace, /toggleList\('pinnedIds'/);
  assert.match(workspace, /draggable=\{sortable && !coarsePointer\}/);
  assert.match(
    workspace,
    /function moveBank\(bankId: string, direction: -1 \| 1\)/,
  );
  assert.match(workspace, /q-coarse-pointer-only/);
  assert.match(workspace, /by \{bank\.ownerName\}/);
  assert.match(folderManager, /One global structure, up to two levels/);
  assert.match(folderManager, /Type DELETE to confirm/);
  assert.match(server, /Verified Superadmin access required/);
  assert.match(
    server,
    /Essential QBanks must be moved or removed independently/,
  );
  assert.match(server, /\['DELETE', '\\u062d\\u0630\\u0641'\]\.includes\(String\(input\.confirmation\)\)/);
});

void test('touch input uses one event path, forgiving targets, and touch-safe scrolling', async () => {
  const app = await readFile(
    new URL('components/medguard-app.tsx', root),
    'utf8',
  );
  const styles = await readFile(new URL('app/globals.css', root), 'utf8');
  const presentation = await readFile(
    new URL('features/presentation/presentation-context.tsx', root),
    'utf8',
  );
  assert.doesNotMatch(app, /onTouchEnd=/);
  assert.doesNotMatch(app, /user-scalable=no/);
  assert.doesNotMatch(app, /gesturestart/);
  assert.match(app, /onPointerDown=\{\(event\) => \{/);
  assert.match(styles, /\(hover: none\) and \(pointer: coarse\)/);
  assert.match(
    styles,
    /:not\(\.q-compact-touch\)[^{]*\{[\s\S]*?min-width: 44px;/,
  );
  assert.match(styles, /min-height: 44px;/);
  assert.match(styles, /touch-action: pan-y pinch-zoom;/);
  assert.match(
    styles,
    /html\[data-standalone='true'\][\s\S]*touch-action: pan-x pan-y !important;/,
  );
  assert.match(styles, /data-standalone='true'[\s\S]*scrollbar-width: none !important/);
  assert.match(styles, /\*::-webkit-scrollbar \{ display: none !important/);
  assert.match(presentation, /event\.touches\.length > 1/);
  assert.match(presentation, /element\.scrollTop > 0/);
  assert.match(presentation, /document\.addEventListener\('gesturestart'/);
  assert.match(styles, /q-viewport:has\(> \.q-shell\).*overflow-y: hidden/);
  assert.match(styles, /--q-safe-top: env\(safe-area-inset-top, 0px\)/);
  assert.match(styles, /--q-safe-bottom-raw: env\(safe-area-inset-bottom, 0px\)/);
  assert.match(
    styles,
    /--q-safe-bottom: max\(0px, calc\(var\(--q-safe-bottom-raw\) - var\(--q-safe-bottom-offset\)\)\)/,
  );
  assert.match(styles, /html, body \{ background: var\(--card\); \}/);
  assert.match(styles, /body \{[^}]*position: fixed;[^}]*inset: 0;/);
  assert.match(
    styles,
    /\.q-viewport \{[^}]*position: fixed;[^}]*inset: 0;[^}]*background: var\(--background\);/,
  );
  assert.doesNotMatch(
    styles,
    /\.q-viewport \{[^}]*(?:height: 100dvh|max-height: var\(--q-visual-height\)|top: var\(--q-visual-offset-top\))/,
  );
  assert.doesNotMatch(presentation, /--q-visual-offset-top/);
  assert.doesNotMatch(presentation, /lockViewportZoom|meta\[name=["']viewport/);
  assert.match(
    styles,
    /html\[data-standalone='true'\] body \{[^}]*position: relative;[^}]*height: 100vh;[^}]*max-height: 100vh;/,
  );
  assert.match(
    styles,
    /html\[data-standalone='true'\] \.q-viewport \{[^}]*position: absolute;[^}]*bottom: auto;[^}]*height: 100vh;[^}]*max-height: 100vh;/,
  );
  assert.match(
    styles,
    /html\[data-standalone='true'\] \.q-sidebar \{[^}]*position: absolute;[^}]*height: 100%;/,
  );
  assert.doesNotMatch(
    styles,
    /\.q-viewport \{[^}]*padding-bottom: var\(--q-safe-bottom\)/,
  );
  assert.match(
    styles,
    /\.q-shell \{[^}]*padding-top: var\(--q-safe-top\);[^}]*background: var\(--card\);/,
  );
  assert.match(
    styles,
    /main:not\(\.q-shell\):not\(\.q-test-screen\):not\(\.q-admin-dashboard\)[^{]*\{[^}]*padding-bottom: var\(--q-safe-bottom\)/,
  );
  assert.match(
    styles,
    /--q-control-safe-bottom: max\(8px, var\(--q-safe-bottom\)\)/,
  );
  assert.match(
    styles,
    /data-standalone='true'[\s\S]*--q-control-safe-bottom: max\(8px, var\(--q-safe-bottom\)\)/,
  );
  assert.match(
    styles,
    /data-standalone='true'[\s\S]*--q-safe-bottom-offset: 30px;[\s\S]*--q-navigation-safe-bottom: var\(--q-safe-bottom\)/,
  );
  assert.match(
    styles,
    /\.q-mobile-nav \{[^}]*var\(--q-navigation-safe-bottom\)/,
  );
  assert.match(
    styles,
    /data-standalone='true'\]\[data-ipad='true'\][\s\S]*--q-safe-bottom-offset: 20px/,
  );
  assert.doesNotMatch(styles, /@media \(min-width: 768px\) and \(max-width: 1023px\) \{ \.q-frame > \.q-stage \{ padding-bottom: 0;/);
  assert.doesNotMatch(app, /env\(safe-area-inset-/);
  assert.match(styles, /\.q-safe-fullscreen/);
  assert.match(styles, /\.q-flashcard-review-card/);
  assert.match(app, /function AppLoadingScreen/);
  assert.match(app, /<AppLoadingScreen status="Starting Qraft…"/);
  assert.match(app, /<AppLoadingScreen status="Syncing your workspace…"/);
  assert.doesNotMatch(app, /q-loading-panel/);
  assert.match(
    app,
    /<QraftBrand tone="adaptive" className="q-loading-wordmark/,
  );
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
  assert.match(
    app,
    /handledInvitationLink\.current = linkKey;\s*clearInvitationLink\(\);/,
  );
  assert.match(app, /collaboration\.memberships\.some/);
});

void test('every question change requires independent review with durable attribution', async () => {
  const server = await readFile(
    new URL('lib/cloudflare-server.ts', root),
    'utf8',
  );
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  const access = await readFile(
    new URL('features/access/domain/access-policy.ts', root),
    'utf8',
  );
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
  assert.match(access, /hasReviewerRole\(user\)/);
  assert.match(server, /current\.proposedById !== user\.uid/);
  assert.match(server, /reviewedQuestionWriteAllowed/);
  assert.match(manager, /QuestionImportReview/);
  assert.doesNotMatch(manager, /questions_json_imported/);
  assert.match(review, /proposal\.reviewedById === user\.uid/);
  assert.match(platform, /writtenByName:\s*proposal\.type === 'new_question'/);
  assert.match(app, /Written by/);
  assert.match(app, /Reviewed by/);
});
