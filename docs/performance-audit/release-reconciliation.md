# Qraft Phase 11A release reconciliation

## Decision

The release candidate is derived from commit `0c68d6e` in a separate clean branch. None of the uncommitted development-checkout changes are included wholesale. Two Phase 10 provenance defects were isolated: a future-work integration assertion accidentally committed with the duplicate-detection domain tests, and two detector-only TypeScript contracts that existed only within a much larger dirty type-file change. The assertion is removed and only the two required contracts are restored. The Phase 10 algorithm, semantic cases, large-candidate regression, and all three performance-regression tests remain.

Classifications use the Phase 11A labels. “Included” refers to the release-candidate branch, not the dirty development checkout.

| File | Classification | Reason | Included? | Dependency | Risk |
|---|---|---|---|---|---|
| `app/admin.css` | E — unrelated work | New brand treatment | No | New mark component/assets | UI-only but outside performance scope |
| `app/globals.css` | E — unrelated work | Large PWA safe-area, exam and responsive styling revision | No | Presentation/exam component rewrite | High visual regression surface |
| `app/layout.tsx` | E — unrelated work | Branding, PWA and metadata changes | No | New brand assets | Changes public shell metadata |
| `components/collaboration-dashboard.tsx` | E — unrelated work | Large collaboration/dashboard UX rewrite | No | New collaboration/progress behavior | Large behavioral surface |
| `components/medguard-app.tsx` | E — unrelated work | Exam, progress, sync, navigation, backup and branding changes | No | Several new components/domain modules | Very large application-state change |
| `components/preformed-tests-workspace.tsx` | E — unrelated work | JSON/AI import and editor UX | No | Import parsing and navigator component | New feature behavior |
| `components/qbank-management.tsx` | E — unrelated work | Presentation/branding adjustment | No | Broader UI work | Outside release scope |
| `components/question-import-review.tsx` | E — unrelated work | Expanded import review and monitoring UI | No | `json-import-monitor.tsx`, migration `0023` | Requires future schema/API |
| `components/question-tools.tsx` | E — unrelated work | UI adjustment | No | Broader question UX | Outside release scope |
| `components/review-workspace.tsx` | E — unrelated work | Duplicate-review workflow UI | No | Migrations `0021`/`0022`, server changes | Requires coordinated feature release |
| `components/study-mobile-nav.tsx` | E — unrelated work | Mobile navigation redesign | No | Presentation changes | UI regression surface |
| `components/system-state-page.tsx` | E — unrelated work | State/admin UI adjustment | No | Broader state changes | Outside release scope |
| `db/schema.ts` | E — unrelated work | Models duplicate review and JSON import observability | No | Migrations `0021` and `0023` | Schema release not approved here |
| `features/access/domain/access-policy.ts` | E — unrelated work | Access-policy changes/formatting | No | Authorization feature work | Security-sensitive |
| `features/collaboration/client/collaboration-client.ts` | E — unrelated work | Collaboration synchronization changes | No | New outbox/realtime behavior | Consistency-sensitive |
| `features/exams/domain/exam-presenters.ts` | E — unrelated work | Exam presentation behavior | No | Exam UI rewrite | Scoring/navigation risk |
| `features/presentation/presentation-context.tsx` | E — unrelated work | PWA/device lifecycle behavior | No | Safe-area/PWA changes | Platform-specific risk |
| `features/subscriptions/domain/plan-config.ts` | E — unrelated work | Plan-limit change | No | Subscription/product decision | Commercial-policy risk |
| `lib/api-client.ts` | E — unrelated work | Export/API surface adjustment | No | Uncommitted clients | Outside release scope |
| `lib/application-services.ts` | E — unrelated work | Export/service surface adjustment | No | Uncommitted services | Outside release scope |
| `lib/cloudflare-server.ts` | E — unrelated work | Duplicate-review integration plus unrelated server changes | No | `0021`, modified schema/UI/tests | Authorization and persistence risk |
| `lib/medguard-types.ts` | A/E — split | Most dirty changes describe future duplicate/import/UI features; `DuplicateCandidate` and `DuplicateReview` are required by the already committed Phase 10 detector | Required two-interface subset only | Phase 10 detector | Low for isolated contracts; high if entire dirty file were included |
| `lib/platform-server.ts` | E — unrelated work | Advanced duplicate workflow and JSON-import observability | No | `0021`-`0023`, new UI/tests | Large API/persistence change |
| `lib/preformed-test-types.ts` | E — unrelated work | Type/export adjustment | No | Preformed-test import work | Outside release scope |
| `lib/question-import.ts` | E — unrelated work | Import report/parser changes | No | New import UX | Behavior change |
| `lib/realtime-server.ts` | E — unrelated work | New realtime topics/behavior | No | Collaboration/import work | Realtime semantics change |
| `lib/resource-data.ts` | E — unrelated work | Cache API/export adjustment | No | Uncommitted sync changes | Cache semantics risk |
| `lib/test-pool-server.ts` | E — unrelated work | Test-pool behavior changes | No | Exam/product work | Exam-selection risk |
| `public/11.svg` | E — unrelated work | Deleted legacy asset | No | Branding replacement | Could break references |
| `public/2222.svg` | E — unrelated work | Deleted legacy asset | No | Branding replacement | Could break references |
| `public/favicon.svg` | E — unrelated work | Deleted legacy asset | No | New mark asset | Public asset change |
| `public/manifest.webmanifest` | E — unrelated work | Branding/PWA manifest revision | No | New generated icons | Install metadata change |
| `public/og.png` | E — unrelated work | Replaced social image | No | Branding work | Binary public asset |
| `public/pwa-icon-source.svg` | E — unrelated work | Deleted icon source | No | New branding generator | Build asset change |
| `public/sw.js` | E — unrelated work | PWA lifecycle/cache revision | No | New shell assets and update behavior | Offline/update risk |
| `scripts/build-pwa-icons.mjs` | E — unrelated work | New brand icon generation | No | New SVG assets | Generated asset pipeline |
| `tests/collaboration-security.test.mjs` | E — unrelated work | Tests future collaboration/duplicate behavior | No | Uncommitted server/UI work | Would misstate candidate coverage |
| `tests/data-integrity.test.mjs` | E — unrelated work | Tests new integrity/progress behavior | No | Uncommitted domain changes | Future coverage |
| `tests/domain-policies.test.mjs` | E — unrelated work | Tests changed plan/exam/access policies | No | Uncommitted policy changes | Future coverage |
| `tests/improvements-api.mjs` | E — unrelated work | Adds future test-pool topic cases beyond committed replay regression | No | Uncommitted pool changes | Future coverage |
| `tests/phase3-presentation.test.mjs` | E — unrelated work | Tests PWA/presentation redesign | No | Uncommitted UI changes | Future coverage |
| `tests/platform-api.test.mjs` | E — unrelated work | Large future duplicate/import/API suite | No | `0021`-`0023` and server changes | Cannot be split safely into Phase 10 |
| `components/brand/qraft-brand.tsx` | E — unrelated work | New brand component | No | New SVG assets | UI-only future work |
| `components/exams/question-navigator.tsx` | E — unrelated work | Extracted exam navigator | No | Exam UI rewrite | Navigation behavior |
| `components/json-import-monitor.tsx` | E — unrelated work | New import-monitor UI | No | Migration `0023` and APIs | Requires future schema |
| `docs/SAAS_LAUNCH_READINESS.ar.html` | E — unrelated work | Separate launch-readiness artifact | No | None | Documentation outside this release |
| `docs/SAAS_LAUNCH_READINESS.ar.md` | E — unrelated work | Separate launch-readiness report | No | None | Documentation outside this release |
| `drizzle/0021_duplicate_review_system.sql` | E — unrelated work | Adds advanced duplicate decisions, claims and scan runs | No | Uncommitted duplicate-review server/UI | Additive, but feature ownership is outside Phase 10 |
| `drizzle/0022_question_level_import_deduplication.sql` | E — unrelated work | Drops file-name/hash uniqueness to permit question-level dedupe | No | Uncommitted import semantics | Rollback may require deduplicating new rows |
| `drizzle/0023_json_import_observability.sql` | E — unrelated work | Adds import runs/attempts and legacy backfill | No | Uncommitted import monitoring | Adds/backfills telemetry tables |
| `features/progress/domain/qbank-classification.ts` | E — unrelated work | New progress classification domain module | No | Progress UI/server changes | Future feature |
| `public/qraft-mark.svg` | E — unrelated work | New brand mark | No | Layout/PWA assets | Future branding |
| `public/qraft-wordmark.svg` | E — unrelated work | New brand wordmark | No | Brand component/assets | Future branding |
| `tests/collaboration-sync.test.mjs` | E — unrelated work | Tests uncommitted collaboration synchronization | No | Client/server sync changes | Future behavior |
| `tests/superadmin-json-import.test.mjs` | E — unrelated work | Tests import monitoring and administration | No | Migration `0023`, server/UI work | Future feature coverage |

## Migration review

### `0021_duplicate_review_system.sql`

Creates `duplicate_pair_decisions`, `duplicate_resolution_claims`, and `duplicate_scan_runs` plus indexes. It is additive and does not transform existing rows, but its only application consumers are in the uncommitted duplicate-review workflow. The Phase 10 detector optimization has no database dependency. **Excluded.**

### `0022_question_level_import_deduplication.sql`

Drops the unique `(user_id, normalized_name)` and `(user_id, file_hash)` indexes from `imported_files`. This intentionally changes import policy from file-level rejection to question-level deduplication. The corresponding API changes are uncommitted. Recreating the indexes later could fail if repeated imports create duplicate rows, so rollback may require data reconciliation. **Excluded.**

### `0023_json_import_observability.sql`

Defensively repeats the `0022` index drops, creates `json_import_runs` and `json_import_attempts`, adds indexes, and backfills legacy import history. It depends on uncommitted monitoring APIs, UI, schema types, and tests. Reverting it would discard staging telemetry rows and would need an explicit migration. **Excluded.**

The current release schema remains committed migrations `0000` through `0020`. No migration is renamed, copied, or applied by Phase 11A reconciliation.

## Candidate-only corrections

| File | Classification | Reason | Included? | Dependency | Risk |
|---|---|---|---|---|---|
| `tests/duplicate-detection.test.mjs` | B — required test correction | Removes the future integration assertion while retaining all Phase 10 algorithm/semantic/performance coverage | Yes | Phase 10 detector | Low; narrows test to shipped behavior |
| `tests/release-provenance.test.mjs` | B — required release guard | Fails when tests/scripts reference an untracked migration and checks migration prefix ordering | Yes | Git checkout | Low |
| `lib/medguard-types.ts` detector contracts | A — required release source | Restores the two interfaces imported by the committed Phase 10 detector so clean TypeScript builds reproduce | Yes | `features/duplicates/domain/duplicate-detection.ts` | Low; type-only contract |
