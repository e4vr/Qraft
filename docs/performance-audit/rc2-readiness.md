# Qraft RC2 readiness — 2026-09-27

**RC2 READY — FINAL WEBSITE STAGED FOR PHASE 11**

Staging only. Full Phase 11 validation and production rollout have not been approved or executed. This readiness decision covers the clean release gate, isolated deployment and bounded smoke checks; it is not a production performance verdict.

| # | Required result | Evidence / outcome |
|---:|---|---|
| 1 | Final source reconciliation | All 80 development-vs-RC1 path differences classified in `rc2-content-reconciliation.md`. Current intended website combined with Phase 10 and RC1 staging safeguards; no unresolved category J. Dirty development checkout preserved. |
| 2 | RC2 source SHA | `a957ef47825a6876f1f0bff41b175b8b0c62707b`; branch `audit/rc2-final-website`. Brand-new detached proof: `C:/Users/Khaled/Desktop/Medguard/phase-11b-proof-a957ef4`. Both trees clean before deployment; proof remains at this SHA. |
| 3 | Included since 68a97cc | Current UI/study/navigation/progress, brand/PWA, import monitor, duplicate-review/import APIs, schema 0021–0023, supporting tests, direct locked icon-generator dependency, staging identity and deterministic synthetic preparation. Indexed collaboration reads, ownership policy, reconnect coordinator, optimized detector and unchanged-answer fast path preserved. RC1 historical evidence retained. |
| 4 | Excluded differences | Arabic editorial launch-readiness `.md`/`.html` have no runtime dependency. Ignore generated build/runtime/local credential files. Preserve RC1 release/configuration safeguards rather than stale/missing development copies. Reject stale database fixtures through semantic merge. Full file-level inventory records each decision. |
| 5 | Service worker | `qraft-shell-v4.4.1`; served bytes match committed source. |
| 6 | Brand assets | Current mark/wordmark/manifest/OG and four PNG icons match deployed bytes. Icons regenerate identically using locked sharp. Obsolete SVG references removed after reference search. No new branding invented. |
| 7 | Migrations | 0000–0023 committed; only reviewed delta 0021–0023 applied to staging. Upgrade preserves old import history, backfills new history and accepts distinct repeat batches. No rows/tables dropped. File name/hash unique indexes removed intentionally; batch identity retained. |
| 8 | Node suite | 135/135 passed, zero failed/skipped/cancelled, from new detached checkout. |
| 9 | Database suite | 10/10 passed: all nine RC1 compatible cases plus RC1→RC2 history/backfill upgrade. |
| 10 | TypeScript | Passed `tsc --noEmit`. |
| 11 | Lint | Passed. |
| 12 | Builds / lockfile | Fresh `npm ci` (503 packages) passed. Ordinary build and staging build passed. Deployment rebuilt the same clean SHA with guarded staging configuration. |
| 13 | Cloudflare check | Passed source/generated isolation checks and all four app/realtime, production/staging dry runs. Production was built/dry-run locally only. |
| 14 | Staging app version | `0d45ea60-3601-4aff-9236-e1823a6b50a2`, confirmed active at 100%. |
| 15 | Staging realtime version | `e814712f-4c03-44c5-9aea-20f257fed8c0`, confirmed active at 100%. |
| 16 | Staging D1 | `qraft-qbank-staging` / `f788be6b-f763-49e8-840b-4c107c7e5874`; 24 migrations through `0023_json_import_observability.sql`; no pending migration; foreign-key check empty. |
| 17 | R2 binding | `qraft-assets-staging`; disposable PNG upload/read/delete passed; post-delete fetch returned 404. |
| 18 | PWA upgrade | Same logged-in RC1 browser reopened after deployment: `/favicon.svg` and `/11.svg` replaced by `/qraft-mark.svg` and `/qraft-wordmark.svg`; old index/vinext scripts replaced with RC2 scripts; reload retains correct current UI. VM regression verifies old Qraft-cache deletion, unrelated-cache retention, precache, skipWaiting, claim, activation message, API bypass and no v3 static response. Supplemental offline harness passed fallback/error cases. See limits below. |
| 19 | RC2 smoke | Passed page/identity, student and owner login, dashboard/QBanks, synthetic question availability, API exam start, browser resume/next/previous/question navigator/pause, realtime ping/pong and R2 cycle. Student sees exactly 1,000 of the 10,000 generated questions in its one permitted private bank; no inaccessible scale bank leakage. |
| 20 | Cross-environment isolation | Guarded source/generated configurations and deployment binding inventories resolve only staging app→staging D1/R2/realtime. Staging profiles 3/3 use `@staging.qraft.invalid`. No production mutation or production data copy. |
| 21 | Rollback points | RC1 app `fa427ae6-7c7e-4274-98dd-1935c20e5ad0`, realtime `c44eac2b-aaf5-4b78-8315-91274c6697a8`. Earlier points `77b9aa6f-ea44-49c9-ab7f-7e749859f457` / `1910720b-b0b4-45d6-ba77-4bba51cbd197` preserved. RC2 IDs above are the new known-good staging points. Keep forward schema during Worker rollback; do not automatically recreate removed unique indexes. |
| 22 | Synthetic readiness | Deterministic independent 100/1,000/10,000-question scenarios validated locally against committed migrations. Largest applied once remotely: 10,000 questions, 1,000 proposals, 10 private banks, one student membership. Staging total 11,253 records / 10,220 questions; DB 15.25 MB. Schema supports indexed bank/type lookup; EXPLAIN returns index search plus temporary ORDER BY tree. No claim that index is faster, and no full Phase 11 comparison run. |
| 23 | Blocker | No release/build/schema/binding blocker found. Instrumentation/device limitations below remain for the separately approved validation phase. |

## Deployed identity

Hostname: https://qraft-staging.eduhelp.workers.dev/

- `x-qraft-build`: `a957ef47825a6876f1f0bff41b175b8b0c62707b`
- `x-qraft-build-time`: `2026-09-26T23:14:31.215Z` (2026-09-27 in Riyadh)
- `x-qraft-app-version`: `1.0.0`
- `x-qraft-sw`: `v4.4.1`
- `x-qraft-schema`: `0023_json_import_observability.sql`

## Test-count reconciliation

RC1 had 120 Node cases. RC2 has 135: current shared exam navigator/pool/resume behavior, collaboration sync, canonical branding, progress hierarchy, duplicate decisions, iPad navigation, expanded platform/import cases, Superadmin import limits, PWA upgrade and release metadata add a net 15. Renamed PWA and test-finish assertions reflect the current intended product behavior; multiline formatting does not remove the existing platform cases. All three Phase 10 performance regressions and the detector semantic coverage remain. The stale development Python suite would have regressed seven fixtures; the semantic repair preserves all nine compatible cases and adds one meaningful migration upgrade test.

## Evidence boundaries and remaining Phase 11 work

The browser visibly advanced from RC1 assets to current RC2 and retained them after reload. Browser tooling did not expose CacheStorage/controller inspection or offline network emulation. Actual browser cache enumeration and installed-device offline behavior are therefore not claimed as observed; cache cleanup/offline semantics were exercised in the local worker harness. Pointer automation did not reliably activate controls; focused keyboard activation verified resume, question navigation, navigator and pause. No application console error was observed in the checked session. A real-device/touch/pointer matrix remains Phase 11 work.

Chrome DevTools telemetry was unavailable in this tool session. CPU/request counts, idle/reconnect matrices, load/latency distributions, comparative D1 performance and cost are still unmeasured for RC2. The synthetic sizes are controlled scale scenarios, not a claim about exact production cardinality; vary selectivity and compare independent smaller local datasets with the large isolated staging fixture after approval. An indexed plan alone does not establish a performance win.

RC1's 15 HTTP requests and its 539-versus-484 small-table SQL result remain historical only. They are not reused for or against this website. The previous final-site mismatch NO-GO is preserved in `phase-11-validation.md`; RC2 resolves source identity but does not grant a production GO.

Non-blocking release observations: npm reported four moderate dependency findings already present in the locked dependency graph; the build emitted a chunk-size warning; Wrangler reported a newer CLI release. No forced dependency update was made during reconciliation.

## Reproduction and rollback

Use committed staging scripts from the clean RC2 SHA. Do not deploy the dirty `app` checkout. The app-managed worktree tool reported “Not a git repository” for the outer workspace, so Git created the required detached checkout inside the workspace. Install/test/build logs, binding inventories, migration output, synthetic import/counts and deployment lists are saved under the proof checkout's ignored `.wrangler/rc2-evidence/`. Local credentials remain ignored and are not part of the evidence commit.

To restore RC1 Workers, use the staging-only rollback commands in `staging-runbook.md` with the recorded RC1 IDs. Schema stays at 0023; additional tables are compatible with the older Worker, but filename/hash import uniqueness remains removed. Review any future index restoration against repeat imports first. Never delete staging history or reverse migrations automatically.

**Stop here. Approval is required before executing the full Phase 11 validation matrix.**
