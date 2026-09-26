# Qraft Phase 11A readiness

Current RC2 evidence is in [RC2 readiness](rc2-readiness.md). The original RC1 tables and NO-GO decision below remain historical. RC2 is staged for approval of full Phase 11; production is not approved.

The release candidate was proved in a brand-new detached worktree with no pre-existing `node_modules` or `dist`. The deployed build headers resolve to the same candidate SHA.

| # | Required result | Status |
|---:|---|---|
| 1 | Candidate SHA | `68a97cc9cfd478846a469bb7056a2da37bc17b10` |
| 2 | `git status --short` | Empty in release branch and detached proof worktree |
| 3 | Final test count | 120 Node tests plus 9 database tests |
| 4 | Test result | 120/120 passed; database 9/9 passed |
| 5 | TypeScript result | `npx.cmd tsc --noEmit` passed |
| 6 | Lint result | `npm.cmd run lint` passed |
| 7 | Build result | Production and staging Vinext builds passed |
| 8 | Cloudflare config check | Passed all four generated-artifact dry runs; staging inventory contained only staging bindings |
| 9 | Included migrations | `0000`–`0020`; local migration-only schema tests passed; remote staging has no pending migrations |
| 10 | Explanation of `0021`–`0023` | Excluded future feature work; detailed in `release-reconciliation.md` |
| 11 | Staging app Worker | `qraft-staging` |
| 12 | Staging realtime Worker | `qraft-realtime-staging` |
| 13 | Staging D1 | `qraft-qbank-staging` / `f788be6b-f763-49e8-840b-4c107c7e5874` |
| 14 | Staging R2 | `qraft-assets-staging` |
| 15 | Staging hostname | `https://qraft-staging.eduhelp.workers.dev` |
| 16 | Seed-data status | Passed twice idempotently; 3 synthetic accounts, 8 fixed synthetic records, 1 synthetic exam |
| 17 | Environment isolation | Passed source, generated artifact and deployed-binding checks; 3/3 profiles use `.invalid`; production-named synthetic query returned 0 |
| 18 | Rollback procedure | App → `77b9aa6f-ea44-49c9-ab7f-7e749859f457`; realtime → `1910720b-b0b4-45d6-ba77-4bba51cbd197`; exact commands in `staging-runbook.md` |
| 19 | Smoke-test result | Passed page/build identity, login, D1/QBanks, exam load/start, realtime ping/pong, and R2 upload/read/delete |
| 20 | Blocker | None. Phase 11 has not been started. |

## Test-count reconciliation

The original dirty working-tree report of 129 tests included future feature work. The clean Phase 11 baseline contained 117 tests: 116 passed and one accidental assertion referenced an untracked future migration. Removing that assertion produced 116; two migration-provenance tests and two staging-isolation tests bring the reviewed candidate to 120. All Phase 10 detector semantic/performance cases and all three performance-regression tests remain.

## Non-blocking observations

`npm ci` reported four moderate dependency audit findings. Vinext reported a chunk-size warning. Wrangler enabled preview URLs by default for the workers.dev deployment. None caused a gate or smoke failure; Phase 11A made no performance changes in response.

## Phase 11B reconciliation (2026-09-27)

RC1 evidence above is historical. The intended website is now reconciled on `audit/rc2-final-website`, with PWA v4.4.1, current branding/product flows, Phase 10 safeguards and required migrations 0021–0023. The new detached proof, deployed identity and smoke results will be appended after verification. Do not reuse RC1 measurements as RC2 evidence or automatically run the full Phase 11 matrix.

## RC2 deployed evidence

RC2 source `a957ef47825a6876f1f0bff41b175b8b0c62707b` passed a fresh detached release gate: 135 Node tests, 10 database tests, TypeScript, lint, ordinary/staging builds and all Cloudflare dry runs. Staging app is `0d45ea60-3601-4aff-9236-e1823a6b50a2`; realtime is `e814712f-4c03-44c5-9aea-20f257fed8c0`, both active at 100%. D1 has 0000–0023 applied, R2 is `qraft-assets-staging`, and PWA is v4.4.1. Public identity includes exact SHA, build time, package, SW and schema versions.

Authentication/banks/exam/realtime/R2 and current-asset smoke passed. Same browser session moved from old assets to current RC2 assets and retained them after reload; worker harness verifies cache upgrade/offline semantics. Browser cache enumeration/installed-device coverage is not claimed. 10,000 generated questions and 1,000 proposals are prepared in isolated staging; independent 100/1,000-question scenarios validated locally. These are readiness checks, not performance results.

RC1 rollback IDs remain `fa427ae6-7c7e-4274-98dd-1935c20e5ad0` / `c44eac2b-aaf5-4b78-8315-91274c6697a8`. Keep forward schema on rollback. RC1 measurements and the earlier mismatch NO-GO are historical; no RC2 production GO is implied. Full Phase 11 awaits user approval. Complete scope, evidence and limits: [RC2 readiness](rc2-readiness.md).
