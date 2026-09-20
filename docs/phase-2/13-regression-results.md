# Regression Results

## Baseline

| Check | Before Phase 2 |
| --- | --- |
| TypeScript | PASS |
| Lint | PASS |
| Production build | PASS, existing chunk-size warning |
| Tests | 89/89 PASS |
| Standard local preview | BLOCKED by compatibility-date/toolchain mismatch |

## Final coverage

| Check | After Phase 2 |
| --- | --- |
| TypeScript | PASS |
| Lint | PASS |
| Production build | PASS, existing chunk-size warning |
| Tests | 97/97 PASS |
| Cloudflare deployment dry-run | PASS; no deployment performed |

- Authentication/account lifecycle, roles, QBank access and deletion.
- Question IDs, imports, review, reports and classification.
- Exam limits, state checkpoints, stale revisions and answer statistics.
- Flashcard privacy, ownership graph and schedule validation.
- Coupons, rewards, plan overrides, activation and expiry.
- Ready-made-test publication, version reset, ranking, moderation and concurrent token claim.
- Offline collaboration outbox coalescing.
- Read-only integrity query safety and zero-row local-fixture execution.

## Safety

All persistent tests used disposable Miniflare D1/R2/Durable Object fixtures. No production user, QBank, subscription, coupon, role, media object or configuration was modified. Migration generation/deployment was not run against production.

## Environment warning

`npm run dev` still fails because workerd supports through `2026-09-07` while Wrangler config requests `2026-09-09`. This is pre-existing toolchain drift, not a Phase 1 regression or an application logic failure.
