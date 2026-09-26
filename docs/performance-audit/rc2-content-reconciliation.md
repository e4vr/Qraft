# RC2 content reconciliation

Compared candidate `68a97cc9cfd478846a469bb7056a2da37bc17b10` with the development working tree on 2026-09-24; reconciliation resumed and reviewed on 2026-09-27. The latter is the source to review, not a deployable artifact. This inventory covers all 80 path differences (tracked modifications/deletions plus untracked files). “Yes (preserve RC1)” means retain the clean candidate file rather than copy the stale development version. No ignored local environment file or generated build output is included.

Category key: A final website, B Phase 10 performance, C supporting test, D migration/schema, E brand/PWA, F staging/release engineering, G future exclude, H experimental exclude, I generated/local exclude, J unresolved. No path remains J.

| File/path | Category | What changed and why it exists | Dependency | Risk | Include in RC2? |
|---|---|---|---|---|---|
| `.github/workflows/release-check.yml` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `.gitignore` | F | Modified; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `app/admin.css` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `app/globals.css` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `app/layout.tsx` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `cloudflare-env.d.ts` | F | Modified; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `components/brand/qraft-brand.tsx` | E | Untracked in development tree; Current approved brand/PWA asset. | manifest, SW and metadata | Medium: stale asset/cache | Yes |
| `components/collaboration-dashboard.tsx` | A | Modified; Current QBank/review/import UI; depends on import monitor and backend. | current application | Medium: behavior/regression | Yes |
| `components/exams/question-navigator.tsx` | A | Untracked in development tree; Current exam navigation component. | current application | Medium: behavior/regression | Yes |
| `components/json-import-monitor.tsx` | A | Untracked in development tree; Current import monitoring UI; depends on 0023 and platform API. | current application | Medium: behavior/regression | Yes |
| `components/medguard-app.tsx` | A | Modified; Current application shell, exams, brand and data lifecycle; depends on new components/domain. | current application | Medium: behavior/regression | Yes |
| `components/preformed-tests-workspace.tsx` | A | Modified; Current preformed-test flow and resume UI. | current application | Medium: behavior/regression | Yes |
| `components/qbank-management.tsx` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `components/question-import-review.tsx` | A | Modified; Current duplicate review controls; depends on 0021 and backend. | current application | Medium: behavior/regression | Yes |
| `components/question-tools.tsx` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `components/review-workspace.tsx` | A | Modified; Current reviewer workflow; depends on duplicate decisions. | current application | Medium: behavior/regression | Yes |
| `components/study-mobile-nav.tsx` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `components/system-state-page.tsx` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `db/schema.ts` | D | Modified; Schema definition supporting current backend. | current backend and tests | High: migration review | Yes |
| `docs/performance-audit/phase-11a-readiness.md` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `docs/performance-audit/release-reconciliation.md` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `docs/performance-audit/staging-data-policy.md` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `docs/performance-audit/staging-release-manifest.md` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `docs/performance-audit/staging-runbook.md` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `docs/SAAS_LAUNCH_READINESS.ar.html` | G | Untracked in development tree; Future Arabic launch-readiness editorial artifact; no runtime dependency. | none | Low | No |
| `docs/SAAS_LAUNCH_READINESS.ar.md` | G | Untracked in development tree; Future Arabic launch-readiness editorial artifact; no runtime dependency. | none | Low | No |
| `drizzle/0021_duplicate_review_system.sql` | D | Untracked in development tree; Durable duplicate decisions/scan tables required by current review API. | current backend and tests | High: migration review | Yes |
| `drizzle/0022_question_level_import_deduplication.sql` | D | Untracked in development tree; Removes old file-level uniqueness locks for current question-level dedupe. | current backend and tests | High: migration review | Yes |
| `drizzle/0023_json_import_observability.sql` | D | Untracked in development tree; Import runs/attempts tables and legacy backfill required by monitor API. | current backend and tests | High: migration review | Yes |
| `features/access/domain/access-policy.ts` | A | Modified; Private/public reviewer authorization refinement. | current application | Medium: behavior/regression | Yes |
| `features/collaboration/client/collaboration-client.ts` | A | Modified; Client change-set/audit semantics; keeps server-authored audit. | current application | Medium: behavior/regression | Yes |
| `features/exams/domain/exam-presenters.ts` | A | Modified; Current exam count guards and progress extraction. | current application | Medium: behavior/regression | Yes |
| `features/presentation/presentation-context.tsx` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `features/progress/domain/qbank-classification.ts` | A | Untracked in development tree; Extracted progress classification used by current dashboard. | current application | Medium: behavior/regression | Yes |
| `features/subscriptions/domain/plan-config.ts` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `lib/api-client.ts` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `lib/application-services.ts` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `lib/cloudflare-server.ts` | A+B | Modified; Current collaboration/answer handling and duplicate detector integration; preserve Phase 10 indexed SQL/replay. | 0021 and Phase 10 code | High: auth/performance | Yes, semantic merge |
| `lib/medguard-types.ts` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `lib/platform-server.ts` | A | Modified; Current duplicate decisions, JSON import monitoring and review APIs; depends on 0021–0023. | current application | Medium: behavior/regression | Yes |
| `lib/preformed-test-types.ts` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `lib/question-import.ts` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `lib/realtime-server.ts` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `lib/resource-data.ts` | A | Modified; Current website UI, client policy, type or backend behavior. | current application | Medium: behavior/regression | Yes |
| `lib/test-pool-server.ts` | A | Modified; Cross-specialty topic selection used by current test builder. | current application | Medium: behavior/regression | Yes |
| `package.json` | F | Modified; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `public/11.svg` | E | Absent from development tree; Obsolete v3 asset removed by current brand. | manifest, SW and metadata | Medium: stale asset/cache | Yes |
| `public/2222.svg` | E | Absent from development tree; Obsolete v3 asset removed by current brand. | manifest, SW and metadata | Medium: stale asset/cache | Yes |
| `public/favicon.svg` | E | Absent from development tree; Obsolete v3 asset removed by current brand. | manifest, SW and metadata | Medium: stale asset/cache | Yes |
| `public/manifest.webmanifest` | E | Modified; Current PWA icon and shortcut references. | manifest, SW and metadata | Medium: stale asset/cache | Yes |
| `public/og.png` | E | Modified; Current branded social image. | manifest, SW and metadata | Medium: stale asset/cache | Yes |
| `public/pwa-icon-source.svg` | E | Absent from development tree; Obsolete v3 asset removed by current brand. | manifest, SW and metadata | Medium: stale asset/cache | Yes |
| `public/qraft-mark.svg` | E | Untracked in development tree; Current approved brand/PWA asset. | manifest, SW and metadata | Medium: stale asset/cache | Yes |
| `public/qraft-wordmark.svg` | E | Untracked in development tree; Current approved brand/PWA asset. | manifest, SW and metadata | Medium: stale asset/cache | Yes |
| `public/sw.js` | E | Modified; Service Worker v4.4.1, upgrade and runtime cache policy. | manifest, SW and metadata | Medium: stale asset/cache | Yes |
| `REALTIME.md` | F | Modified; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `scripts/build-pwa-icons.mjs` | E | Modified; Regenerates current icon/social assets from approved SVGs. | manifest, SW and metadata | Medium: stale asset/cache | Yes |
| `scripts/build-staging.mjs` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `scripts/cloudflare-check.mjs` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `scripts/deploy-staging.mjs` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `scripts/process.mjs` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `scripts/release-config.mjs` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `scripts/seed-staging.mjs` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `scripts/staging-database.mjs` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `scripts/staging-secrets.mjs` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `tests/collaboration-security.test.mjs` | C | Modified; Regression/integration coverage for current website and schema. | application and migrations | Medium: test drift | Yes |
| `tests/collaboration-sync.test.mjs` | C | Untracked in development tree; Regression/integration coverage for current website and schema. | application and migrations | Medium: test drift | Yes |
| `tests/data-integrity.test.mjs` | C | Modified; Regression/integration coverage for current website and schema. | application and migrations | Medium: test drift | Yes |
| `tests/domain-policies.test.mjs` | C | Modified; Regression/integration coverage for current website and schema. | application and migrations | Medium: test drift | Yes |
| `tests/duplicate-detection.test.mjs` | C | Modified; Regression/integration coverage for current website and schema. | application and migrations | Medium: test drift | Yes |
| `tests/improvements-api.mjs` | C | Modified; Regression/integration coverage for current website and schema. | application and migrations | Medium: test drift | Yes |
| `tests/phase3-presentation.test.mjs` | C | Modified; Regression/integration coverage for current website and schema. | application and migrations | Medium: test drift | Yes |
| `tests/platform-api.test.mjs` | C | Modified; Regression/integration coverage for current website and schema. | application and migrations | Medium: test drift | Yes |
| `tests/platform-database.test.py` | C | Development copy regresses RC1 explicit-column fixtures and subscription-plan assertions. Preserve all 9 schema-compatible RC1 tests; add an RC1-to-RC2 migration/backfill test. | migrations 0000–0023 | Medium: positional inserts fail after schema expansion | Yes (semantic merge; reject stale fixtures) |
| `tests/release-provenance.test.mjs` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `tests/staging-release.test.mjs` | F | Absent from development tree; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `tests/superadmin-json-import.test.mjs` | C | Untracked in development tree; Regression/integration coverage for current website and schema. | application and migrations | Medium: test drift | Yes |
| `worker.ts` | F | Modified; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `wrangler.jsonc` | F | Modified; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |
| `wrangler.realtime.jsonc` | F | Modified; RC1 staging/release safeguard absent or stale in development tree; preserve RC1 version. | staging config and provenance | High if overwritten | Yes (preserve RC1) |

## Dependency and exclusion decisions

- The current UI imports the new brand, exam navigator, progress classifier and JSON import monitor. The import monitor/API references `json_import_runs` and `json_import_attempts`; the duplicate reviewer/API references `duplicate_pair_decisions`. Therefore 0021–0023 and their schema/test changes are required for the intended website, not standalone future migrations.
- Phase 10 indexed collaboration reads, reconnect coordination, optimized duplicate detector and unchanged-answer early return remain in the candidate. The current backend also calls the optimized detector. The semantic merge must retain those paths and their tests.
- Development-tree versions of release configuration, provenance header, Git ignore, CI and staging scripts predate RC1. Retain the reviewed RC1 versions. The two Arabic launch-readiness files are editorial work with no runtime or test dependency and remain outside RC2.
- The four raster PWA icons are tracked in RC1 and presently have no path difference, but must be regenerated from the newly included SVGs and committed with the brand update. Add direct `sharp` dependency and lockfile update if needed to make the generator reproducible. Generated `dist`, `.wrangler`, `.ui-review`, `.dev.vars.staging`, and local secrets remain excluded.
- Migration 0022 drops two file-level unique indexes; 0023 repeats the drops idempotently and creates import history tables with a legacy backfill. Review staging migration output and compatibility before application. No production migration is authorized.

## Commit plan

1. Brand/PWA and current UI, including focused SW upgrade correction and regression coverage.
2. Required backend/domain behavior and migration/schema changes.
3. Supporting tests and any lockfile/release integrity adjustments.
4. Final RC2 evidence documents after a clean detached proof and staging deployment.

## Reviewed RC2 resolution

Purpose-specific commits preserve branding/PWA, current website/study flows, required schema, backend/duplicate-review integration, supporting tests, fixture repair, and staging provenance separately. The service worker deletes only obsolete `qraft-shell-*` caches, never unrelated origin caches. Static reads use only the v4.4.1 cache, with network fallback; document requests remain network-first and API requests bypass caching. The VM upgrade regression checks install, activation, claim, unrelated cache retention, obsolete-cache removal, and absence of old static responses.

All nine RC1 database cases remain, with explicit columns and the current subscriptions/plan-prices assertions; the tenth verifies migration upgrade and legacy import backfill. RC1 Node coverage is retained; current product tests, PWA upgrade coverage and release metadata coverage bring the expected final count to 135. The count will be confirmed in the new detached proof worktree.

0021 adds duplicate review decisions, claims and scan history used by the current reviewer/API. 0022 removes per-user filename/hash uniqueness while keeping batch identity; no table or row is deleted. 0023 adds import runs/attempts and backfills successful legacy import history; its repeated index drops are defensive. RC1-to-RC2 upgrade passes with foreign keys enabled. Worker rollback keeps the forward schema; RC1 does not require the new tables, but old filename/hash uniqueness is not restored by Worker rollback. Reinstating those indexes would require duplicate review first. Do not automatically reverse migrations or delete import history.

The four PNG icons regenerated byte-identically from the approved SVG source. The new direct locked `sharp` dependency makes that reproducible. Old SVG references were searched before removal; no active reference remains. The two excluded Arabic editorial reports remain untouched in development. No implementation or ignored local file from the dirty development checkout was committed there.

`synthetic-staging-data.mjs` generates separate deterministic 100/1,000/10,000-question scenarios, each with 10 private banks, 10% scoped access and 10% proposal cardinality. These are scale scenarios, not a measured production population. Local migration/schema checks passed for each. Only the largest scenario is intended for a single bounded staging import before Phase 11; smaller independent scenarios can be loaded into isolated local databases. Compare scope/selectivity, rows read/returned, query plans, duration and Worker impact during the separately approved Phase 11. RC1's 15-request and 539/484-row results remain historical and are not RC2 evidence.
