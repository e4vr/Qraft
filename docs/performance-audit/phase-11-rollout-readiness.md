# Qraft Phase 11 rollout readiness

## Technical status

**PHASE 11 NO-GO — the validated staging target is not the intended final website.** This is a release-content gate, not a judgement that the final site's performance failed. The user identified the staging browser page as an old version on 2026-09-24. Source inspection confirmed the clean candidate omits substantial current website changes. Stop final-site UX, caching, persistence and cost claims until a new clean candidate is staged and measured.

| Release field | Exact value |
|---|---|
| Candidate actually deployed and partially probed | `68a97cc9cfd478846a469bb7056a2da37bc17b10` |
| App version | `fa427ae6-7c7e-4274-98dd-1935c20e5ad0` |
| Realtime version | `c44eac2b-aaf5-4b78-8315-91274c6697a8` |
| D1 | `qraft-qbank-staging` / `f788be6b-f763-49e8-840b-4c107c7e5874` |
| R2 | `qraft-assets-staging` |
| Schema | `0000`–`0020`; no pending migration |
| App rollback version | `77b9aa6f-ea44-49c9-ab7f-7e749859f457` |
| Realtime rollback version | `1910720b-b0b4-45d6-ba77-4bba51cbd197` |

The staging app and realtime versions were each active at 100%. The live app build header matched the candidate SHA. No deployment or migration occurred in this Phase 11 attempt, so rollback was not needed and should not be performed merely because the target is outdated.

## Measurement method and scope

The isolated staging checks used three synthetic approved accounts, five serial collaboration HTTP samples per role, and read-only Wrangler D1 SQL probes against 242 `records` rows. The SQL probes compared the exact indexed collaboration catalog/scoped statements with forced full scans and inspected `EXPLAIN QUERY PLAN`. HTTP probes captured status, build SHA, response bytes, elapsed time, and collection cardinalities. The five-sample p95 is a nearest-rank maximum. No credentials, cookies, SQL parameters, question content, or user data were recorded in documentation.

Results: all 15 collaboration HTTP samples returned 200 with the pinned SHA and 220 questions. Median latency was 339.77 ms owner, 307.61 ms reviewer, and 336.73 ms student. The optimized SQL pair read 539 rows versus 484 for forced scans at this small staging size, with equal ordered results. Both scoped branches used the expected index. These are query-pair probes; full route D1 rows and Worker CPU remain unknown. See [phase-11-validation.md](phase-11-validation.md).

## Test matrix disposition

| Area | Status |
|---|---|
| Collaboration result/plan | Partial: correct ordered SQL output, indexed base-table path, small-cardinality row-read counterexample; no complete route telemetry |
| Warm navigation / cached revisit | Not validated against final site |
| Exam navigation / persistence | Not validated against final site |
| Ten-minute idle | Not measured |
| Focus / PWA lifecycle | Not validated; candidate service worker differs |
| Realtime event / reconnect 1, 5, 20 | Not measured |
| Duplicate detection Worker CPU | Not validated; optimized detector lacks a located runtime call site in pinned source |
| Error correlation / request amplification | Not measured beyond collaboration probes |
| Cache privacy / authorization / loading | Not validated against final site |
| 2×/5×/10× scaling / cost | Not measured or defensibly projected for final site |

## Blocking issue and smallest corrective action

The deployed candidate represents an older website. The current working tree changes the application shell, service worker, brand assets, and large parts of the UI; those changes are not in `68a97cc`. The Phase 11 target therefore cannot establish readiness for the website the user intends to release. The smallest release-process correction is to review and commit the intended final source and migrations as a new clean candidate, rerun the Phase 11A gates, deploy that candidate **only to isolated staging**, pin its new app/realtime versions and rollback IDs, and repeat the full Phase 11 validation matrix. Do not transplant the dirty working tree directly into the existing pinned deployment.

The SQL probe's +11.4% row-read result at 242 rows is explained by repeated indexed seeks and is a measurement caveat, not an authorization or data-integrity failure. It should be retested at representative cardinalities after the target is corrected. The absent runtime reference to `detectDuplicateReview` requires a trace of the intended import path before making Worker CPU claims; do not integrate it as an unmeasured Phase 11 fix.

## Non-blocking items

Phase 11A recorded four moderate dependency audit findings, a Vinext chunk-size warning, and enabled workers.dev preview URLs. Keep them tracked separately. No dependency upgrade or bundle refactor is justified by this stopped validation.

## Production monitoring required before rollout

Capture a non-sensitive correlation ID and stable route/query labels for HTTP → Worker → D1, with Worker CPU, duration, response bytes, outcomes, D1 rows read/written, and returned row counts. For browser journeys, record request reason and count, targeted realtime event/refetch, reconnect-wave size, visible update latency, cache scope, and answer-state correctness. Correlate `exceededResources`, `clientDisconnected`, and `responseStreamDisconnected` with route and outcome. Exclude credentials, bodies, email, question text, and search input. Confirm idle and warm-navigation behavior with repeatable browser traces before promotion.

## Rollback point

If a *future staging change* causes an unsafe state, use the recorded rollback versions above per [staging-runbook.md](staging-runbook.md). A new release candidate needs a fresh rollback capture. No production deployment is authorized by this document.
