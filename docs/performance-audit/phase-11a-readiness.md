# Qraft Phase 11A readiness

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
