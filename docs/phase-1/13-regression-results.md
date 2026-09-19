# Regression Results

## Automated verification

| Stage | TypeScript | Lint | Build | Tests |
| --- | --- | --- | --- | --- |
| Pre-refactor baseline | PASS | PASS | PASS | 80/80 PASS |
| API/domain foundation | PASS | PASS | PASS | 83/83 PASS |
| Client service split | PASS | PASS | PASS | 84/84 PASS |
| Server boundaries and pure helpers | PASS | PASS | PASS | 89/89 PASS |

Final commands:

```text
npx tsc --noEmit
npm run lint
npm run build
npm test
```

## Coverage exercised

- Framework route and architecture boundaries.
- Registration, login, session, MFA, profile, password, logout, and account deletion.
- Role assignment, access manager, reviewer, moderator, Superadmin, QBank owner/editor/viewer behavior.
- Free/Lite/Pro/Unlimited limits, overrides, rewards, expiry, and exam starts.
- QBank membership, links, questions, imports, reviews, reports/tickets, folders, and media.
- Personal-state full and checkpoint sync, idempotency, stale revision conflict handling, and cross-tab/live merging.
- Flashcard privacy and validation.
- Preformed test publishing, ranking, moderation, and operation cleanup.
- PWA/static configuration assertions and key responsive/touch source assertions.
- Pure access/plan/exam/collaboration domain behavior.

## Manual and device verification

The Phase 0 browser preview remains the available visual baseline. No UI markup or styles were intentionally changed. A production preview could not be started with the standard local command because the configured compatibility date was newer than the bundled local runtime. Physical-device testing was not available.

Status labels:

- Desktop automated application/API behavior: **VERIFIED**
- Production build: **VERIFIED**
- Static PWA/route configuration: **VERIFIED**
- Physical iPhone/iPad/Android behavior: **NOT VERIFIED**
- Live production Cloudflare services/data: **NOT VERIFIED**

## Data safety

Tests used local Miniflare/D1 fixtures. No production users, QBanks, questions, subscriptions, coupons, roles, media, or external notifications were modified.

