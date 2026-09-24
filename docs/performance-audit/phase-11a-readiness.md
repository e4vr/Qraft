# Qraft Phase 11A readiness

This evidence record is completed only after the clean detached-worktree gate and staging smoke test.

| # | Required result | Status |
|---:|---|---|
| 1 | Candidate SHA | Pending |
| 2 | `git status --short` | Pending clean gate |
| 3 | Final test count | Pending clean gate |
| 4 | Test result | Pending clean gate |
| 5 | TypeScript result | Pending clean gate |
| 6 | Lint result | Pending clean gate |
| 7 | Build result | Pending clean gate |
| 8 | Cloudflare config check | Pending clean gate |
| 9 | Included migrations | `0000`–`0020`; pending clean schema proof |
| 10 | Explanation of `0021`–`0023` | Excluded future feature work; detailed in `release-reconciliation.md` |
| 11 | Staging app Worker | `qraft-staging` |
| 12 | Staging realtime Worker | `qraft-realtime-staging` |
| 13 | Staging D1 | `qraft-qbank-staging` / `f788be6b-f763-49e8-840b-4c107c7e5874` |
| 14 | Staging R2 | `qraft-assets-staging` |
| 15 | Staging hostname | Pending deployment |
| 16 | Seed-data status | Reproducible guarded mechanism committed; pending migration and seed |
| 17 | Environment isolation | Source and generated-config guards pass; pending deployed-binding verification |
| 18 | Rollback procedure | First-release Worker deletion; exact commands in `staging-runbook.md` |
| 19 | Smoke-test result | Pending deployment |
| 20 | Blocker | None at configuration stage; remaining gates are clean proof, migration, deployment and smoke test |

Phase 11 must not resume until every pending field has final evidence.
