# Qraft Phase 11 staging validation — stopped

Current RC2 evidence is in [RC2 readiness](rc2-readiness.md). The original RC1 tables and NO-GO decision below remain historical. RC2 is staged for approval of full Phase 11; production is not approved.

## Decision and stop condition

**PHASE 11 NO-GO (2026-09-24).** The staging deployment passed the pinned version and schema checks, but it is not the final website identified by the user. Browser validation stopped as soon as this discrepancy was reported. No production deployment or data mutation occurred; this run made no staging deployment, schema change, or answer write.

This is a release-content mismatch, not an observed browser-cache failure. Live responses reported `x-qraft-build: 68a97cc9cfd478846a469bb7056a2da37bc17b10`. That candidate has service-worker shell `qraft-shell-v3.0.0` and lacks `components/brand/qraft-brand.tsx` and `public/qraft-mark.svg`. The current working website has shell `qraft-shell-v4.4.1`, those brand assets, and a 2,759-line working-tree diff in `components/medguard-app.tsx`. The current site's UI and behavior cannot be certified by the pinned candidate.

## Exact target and pre-validation health

| Item | Verified value |
|---|---|
| Candidate | `68a97cc9cfd478846a469bb7056a2da37bc17b10` |
| Evidence commit before this run | `99ee63a2804e9cec59ff69c72190e816f75deeb1` |
| App | `qraft-staging`, `https://qraft-staging.eduhelp.workers.dev` |
| Active app version | `fa427ae6-7c7e-4274-98dd-1935c20e5ad0`, 100% |
| Active realtime version | `c44eac2b-aaf5-4b78-8315-91274c6697a8`, 100% |
| D1 / R2 | `qraft-qbank-staging` (`f788be6b-f763-49e8-840b-4c107c7e5874`) / `qraft-assets-staging` |
| Schema | Migrations `0000`–`0020`; no pending remote migration |
| Build timestamp | `2026-09-24T16:45:01.748Z` |
| Phase 11A checks | 120/120 Node tests, 9/9 database tests, typecheck, lint, builds and dry runs passed |

The detached candidate checkout was clean. All API probes used only the three synthetic `*.staging.qraft.invalid` accounts. The browser was closed after the stop condition.

## Collaboration evidence obtained before the stop

At approximately 16:57–16:59 UTC, five `GET /api/cloudflare/collaboration` requests per synthetic account returned HTTP 200 and the pinned build header. Staging had **242 `records` rows**: 220 questions, two banks, two memberships, 16 topics, one specialty, and one proposal. Each response contained 220 approved questions.

| Account | n | HTTP median | HTTP p95, nearest rank | Response bytes |
|---|---:|---:|---:|---:|
| Owner | 5 | 339.77 ms | 694.48 ms | 189,319 |
| Reviewer | 5 | 307.61 ms | 397.94 ms | 189,319 |
| Student | 5 | 336.73 ms | 359.09 ms | 189,077 |

With n=5, p95 equals the maximum and is descriptive only. These are end-to-end client timings, not Worker CPU or D1 durations. Full route query count and D1 metadata were not captured.

Read-only remote D1 probes executed the exact two optimized SQL shapes from `lib/cloudflare-server.ts` and forced full-scan comparison shapes. Each optimized/comparison pair returned the same ordered rows and payload hash. These are **SQL-probe results, not full HTTP-route totals**.

| Query pair | Rows returned | Optimized rows read | Full-scan comparison rows read | Optimized SQL duration, single sample |
|---|---:|---:|---:|---:|
| Catalog | 4 | 13 | 242 | 0.518 ms |
| Scoped records | 240 | 526 | 242 | 6.907 ms |
| Combined | 244 | **539** | **484** | 7.425 ms sum; illustrative only |

At this cardinality the optimized pair read **55 more rows (+11.4%)** than the full-scan comparison. Repeated indexed seeks across requested types and three bank scopes outweigh a scan of only 242 rows. This does not refute the earlier production-sized reduction, but it disproves a universal claim that the rewrite reduces billed rows at every size. The catalog plan used `SEARCH records USING INDEX idx_records_type_id`; both scoped branches used `SEARCH records USING INDEX idx_records_qbank_type`. `SCAN (subquery-2)` scans the UNION output before ordering, not the `records` base table. No new index is justified here.

## Test matrix at stop

| # | Group | Result |
|---:|---|---|
| 1 | Collaboration D1 | Partial: five HTTP samples per role, response counts/bytes, remote SQL rows and indexed plans. No route-level D1 or CPU telemetry. |
| 2 | Warm navigation | Stopped before final-site traces. |
| 3 | Preloaded exam navigation | Not run. Seed exam has only two questions; Q10 needs a larger synthetic fixture. |
| 4 | Exam persistence | Not run; no answer write was made. |
| 5 | Ten-minute idle | Not run; no idle request count exists. |
| 6 | Focus/PWA lifecycle | Not run; candidate service worker differs from intended site. |
| 7 | Realtime synchronization | Not run. |
| 8 | Reconnect 1/5/20 | Not run; Phase 10 deterministic test remains local evidence only. |
| 9 | Duplicate detection | No Worker workload. Source search found `detectDuplicateReview` only in its domain module and tests, not a deployed request path; Phase 10 CPU savings cannot be attributed to the Worker. |
| 10 | Error correlation | Not run; no correlated Worker outcome sample. |
| 11 | Request amplification | Partial collaboration HTTP and SQL probes only; no complete action-to-D1 table. |
| 12 | Cache/privacy | Three authorized roles returned expected cardinality. Cross-user cache, logout, outsider-bank and subscription boundaries were not tested. |
| 13 | Loading experience | Old UI was visible but is ineligible as final-site UX evidence. |
| 14 | Database scaling | Indexed plan observed at 242 records; no 2×/5×/10× workload. |
| 15 | Cost | No representative complete Worker/D1/DO/R2 telemetry; no final-site projection. |

## Required metric table

| Metric | Phase 0–9 baseline | Phase 10 local/expected | Phase 11 staging measured | Change | Evidence type | Status |
|---|---:|---:|---:|---:|---|---|
| Collaboration rows read, query pair | 11,326 at 5,663 records | 1,142 at production-sized shape | 539 optimized vs 484 scan comparison at 242 records | +11.4% on small staging set | Remote SQL probe | Partially validated; size-dependent |
| Collaboration duration | 48.68 ms two single SQL probes | 2.63 ms two single SQL probes | HTTP median 307.61–339.77 ms by role; SQL pair 7.425 ms one probe | Not comparable | Remote HTTP/SQL | Insufficient comparison |
| Collaboration Worker CPU | Unknown | Expected lower | — | — | No CPU trace | Insufficient evidence |
| Warm-navigation requests | Unknown | Zero redundant expected | — | — | Stopped | Insufficient evidence |
| Cached-route revisit requests | Unknown | 0 expected | — | — | Stopped | Insufficient evidence |
| Exam-navigation fetches | Unknown | 0 full refetch expected | — | — | Stopped | Insufficient evidence |
| Idle requests / 10 minutes | Unknown | Approximately 0 expected | — | — | No idle run | Insufficient evidence |
| Reconnect logical reconciliations, 1/5/20 | Up to 1/5/20 | 1/1/1 local | — | — | Local test only | Insufficient evidence |
| Reconnect physical requests | Unknown | At most one account and collaboration refresh | — | — | Stopped | Insufficient evidence |
| Realtime update latency | Unknown | Targeted sync expected | — | — | Stopped | Insufficient evidence |
| Duplicate duration | 625.5111 ms local / 100k comparisons | 241.6257 ms local | — | — | No Worker path measured | Not validated |
| Duplicate Worker CPU | Unknown | Expected lower | — | — | No Worker workload | Not validated |
| Changed-answer writes | About 12 billed rows before state sync | Unchanged by design | — | — | No staging write | Insufficient evidence |
| Same-answer replay work | One collaboration entry | Zero local | — | — | No staging replay | Insufficient evidence |
| `exceededResources` | 7/day aggregate | Expected lower | — | — | No correlated tail | Insufficient evidence |
| `clientDisconnected` | Aggregate only | No numeric claim | — | — | No correlated tail | Insufficient evidence |
| `responseStreamDisconnected` | Aggregate only | No numeric claim | — | — | No correlated tail | Insufficient evidence |

No staging rollback was triggered: this run made no staging change and found no unsafe data or answer state. The identity mismatch requires a new release candidate, not rollback of an unchanged test environment.

Reconcile the intended final website into a reviewed, clean commit; repeat the Phase 11A build, tests, isolation and deployment proof; record new version IDs and rollback point; then restart the full Phase 11 matrix. Do not deploy this pinned staging candidate to production as the final website.

## Phase 11B reconciliation (2026-09-27)

RC1 evidence above is historical. The intended website is now reconciled on `audit/rc2-final-website`, with PWA v4.4.1, current branding/product flows, Phase 10 safeguards and required migrations 0021–0023. The new detached proof, deployed identity and smoke results will be appended after verification. Do not reuse RC1 measurements as RC2 evidence or automatically run the full Phase 11 matrix.

## RC2 deployed evidence

RC2 source `a957ef47825a6876f1f0bff41b175b8b0c62707b` passed a fresh detached release gate: 135 Node tests, 10 database tests, TypeScript, lint, ordinary/staging builds and all Cloudflare dry runs. Staging app is `0d45ea60-3601-4aff-9236-e1823a6b50a2`; realtime is `e814712f-4c03-44c5-9aea-20f257fed8c0`, both active at 100%. D1 has 0000–0023 applied, R2 is `qraft-assets-staging`, and PWA is v4.4.1. Public identity includes exact SHA, build time, package, SW and schema versions.

Authentication/banks/exam/realtime/R2 and current-asset smoke passed. Same browser session moved from old assets to current RC2 assets and retained them after reload; worker harness verifies cache upgrade/offline semantics. Browser cache enumeration/installed-device coverage is not claimed. 10,000 generated questions and 1,000 proposals are prepared in isolated staging; independent 100/1,000-question scenarios validated locally. These are readiness checks, not performance results.

RC1 rollback IDs remain `fa427ae6-7c7e-4274-98dd-1935c20e5ad0` / `c44eac2b-aaf5-4b78-8315-91274c6697a8`. Keep forward schema on rollback. RC1 measurements and the earlier mismatch NO-GO are historical; no RC2 production GO is implied. Full Phase 11 awaits user approval. Complete scope, evidence and limits: [RC2 readiness](rc2-readiness.md).

## Final constitutional gate — stopped (2026-09-27)

The supplied constitution was read in full. Fresh staging headers still identify pinned RC2. An isolated local endpoint reproduction accepts/persists 151 Superadmin import questions despite section 20's technical maximum of 150. Section 51 also conflicts with the currently enforced paid-plan quotas and commercial periods. Sections 79/87 require stopping for explicit reconciliation; no implementation or staging/production change was made. Final technical decision and all evidence boundaries are in [Phase 11 final constitutional validation](phase-11-final-constitutional-validation.md). Prior RC1 history and RC2 staging readiness remain intact; staging readiness is not final rollout approval.

## Amended constitution and clarified backend target

See [amended-policy review](phase-11-amended-policy-review.md). The count-only Superadmin objection is withdrawn. A new isolated 151-question serial-chunk/retry/history test passes. The constitution is the newly approved backend target, with frontend alignment later; pinned RC2 still enforces the previous subscription model. No implementation or deployment change occurred. Historical findings above remain preserved.
