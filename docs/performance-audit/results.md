# Qraft Phase 10 performance results

> **Phase 11 staging update, 2026-09-24 — NO-GO for the intended final website.** The pinned staging build `68a97cc` passed version/schema checks and 15 collaboration API samples, but the user identified its UI as an older version. The current website's brand, service worker, and substantial UI changes remain outside that candidate. Browser validation stopped. On the staging database's 242 records, a read-only SQL probe found the indexed collaboration query pair read 539 rows versus 484 for forced full scans while returning identical ordered rows. The Phase 10 11,326 → 1,142 result applies to its production-sized sample and is not a universal per-size reduction. The optimized duplicate detector is referenced only by its domain module and tests in the pinned source, so its local CPU benchmark is not Worker CPU evidence. [Full stopped-run record](phase-11-validation.md) and [rollout decision](phase-11-rollout-readiness.md).

## Scope and outcome

Phase 10 implemented five approved, reversible waves on branch `audit/performance-first-pass`. No schema migration, production write, deployment, audit-policy change, API-contract change, or platform migration was performed.

The strongest measured improvements are:

- representative collaboration D1 rows read: **11,326 -> 1,142 (-89.9%)**;
- duplicate comparison benchmark: **625.5111 ms -> 241.6257 ms (-61.37%)** for 100,000 comparisons;
- generic reconnect reconciliation callbacks for three recovered channels: **3 -> 1 (-66.7%)**;
- identical answer replay now stops before collaboration persistence, while changed-answer audit behavior remains intact.

Production after-metrics are unavailable because this branch was not deployed. The collaboration query result combines read-only production measurements captured during Phases 0-9 with the exact SQL shape now implemented. Duplicate-detection timing is a local Node benchmark. Reconnect and unchanged-answer results are deterministic regression tests and code-path counts. These evidence types are kept separate below.

## Results by optimization

### 1. Collaboration record reads

**Problem.** `GET /collaboration` used two statements that scanned the polymorphic `records` table. A representative authorized production scope returned 1,101 records but billed 11,326 rows read.

**Root cause.** The catalog query did not constrain the planner to the existing `(type, id)` index, while the scoped query combined bank ids with `qbank_id IS NULL` through an `OR`. That shape prevented a selective lookup even though suitable indexes already existed.

**Change.** Commit `67fdc43` makes the catalog query use `idx_records_type_id`, splits bank-scoped and global records into two `UNION ALL` branches using `idx_records_qbank_type`, and restores the prior row order with the source row id. No index or schema was added.

| Measurement | Before | After | Change |
|---|---:|---:|---:|
| D1 rows read, representative query pair | 11,326 | 1,142 | -89.9% |
| Rows returned | 1,101 | 1,101 | unchanged |
| Single-probe SQL duration | 48.68 ms | 2.63 ms | -94.6% illustrative only |

**How measured.** The row-read and timing figures came from read-only production D1 probes during the first pass. The implemented statements match the measured optimized query shape. A local SQLite regression fixture executes both forced plans, checks identical records and order, and requires two indexed searches with no exact `SCAN records` step. The single timing probes are illustrative rather than a latency distribution.

**Correctness and tests.** The regression test compares complete ordered results between old and optimized statements. The existing authorization and collaboration API suites also pass.

**Remaining risk.** Production after-telemetry is still required to confirm the deployed planner, latency distribution, response size, and Worker CPU. Large collaboration payload parsing remains unchanged.

### 2. Request and data ownership policy

**Problem.** Equivalent component reads, navigation, invalidation, and reconnect behavior needed one explicit policy so future changes do not introduce duplicate requests or stale private data.

**Root cause.** The implementation already had canonical authenticated cache keys, shared in-flight promises, event-driven invalidation, and retained root state, but the constraints were distributed across code and tests.

**Change.** Commit `0da252a` records the allowed request reasons, cache/privacy rules, retry and cancellation rules, reconnect behavior, and the owner/freshness/invalidation lifecycle for each major resource in [request-policy.md](./request-policy.md) and [data-lifecycle.md](./data-lifecycle.md). No navigation code changed because the current mechanism already satisfies the policy.

| Deterministic behavior | Before | After |
|---|---:|---:|
| Concurrent identical consumers | 1 physical load | 1 physical load |
| Route revisit with valid cached resource | 0 additional loads | 0 additional loads |
| Unrelated invalidation | 0 relevant reloads | 0 relevant reloads |

**How measured.** Existing resource-data tests exercise single-flight loading, retained values, and tag-scoped invalidation. Source tracing confirms active-exam navigation uses retained question/state arrays.

**Correctness and tests.** The full suite passed without changing cache or navigation behavior.

**Remaining risk.** A ten-minute idle browser trace and representative warm-navigation trace were not available in this local task. The expected idle HTTP count remains zero and must be verified in a deployed canary before it is treated as production evidence.

### 3. Reconnect reconciliation

**Problem.** Each realtime channel that recovered emitted a generic `connected` event. The root handler can reconcile account and collaboration data for every such event.

**Root cause.** Channel state was observed independently, with no coordinator for the logical network-recovery wave.

**Change.** Commit `306d269` adds a reconnect coordinator. All disconnects before the first successful channel recovery belong to one wave; the first recovery emits one generic reconciliation and later channel recoveries in that wave do not. A later failure starts a new wave. Topic-specific invalidation remains unchanged.

| Three-channel recovery | Before | After | Change |
|---|---:|---:|---:|
| Generic reconciliation callbacks | 3 | 1 | -66.7% |
| Logical account refresh upper bound | 3 | 1 | -66.7% |
| Logical collaboration refresh upper bound | 3 | 1 | -66.7% |

For `C` recovered channels in one wave, generic reconciliation changes from `C` callbacks to `1`, a reduction of `(C - 1) / C`. Physical requests could already collapse when their execution overlapped through single-flight; the table therefore reports callback and logical refresh bounds rather than claiming a measured network count.

**How measured.** A pure coordinator regression drives three channel failures and recoveries, verifies one reconciliation, then verifies that a later independent recovery remains observable.

**Correctness and tests.** Existing realtime tests and the full suite pass. Topic events and initiating-client behavior were not changed.

**Remaining risk.** Browser resume traces with 1, 5, and 20 channels are still needed to measure physical requests and recovery latency in production conditions.

### 4. Duplicate-detection CPU

**Problem.** Duplicate scanning compares every incoming question with every candidate. The hot loop repeatedly tokenized text, generated bigrams, allocated arrays, recomputed semantic values, and used intermediate `flatMap` results.

**Root cause.** Candidate-independent and pair-independent work occurred inside the O(incoming x candidates) loop.

**Change.** Commit `f3d6e3f` prepares sorted token/bigram arrays once, uses allocation-free two-pointer Dice comparison, reuses prepared options, precomputes semantic values, avoids ordered-array reduction, checks suppressed pairs before expensive comparison, and accumulates matches directly. Thresholds, weights, suppression rules, ranking, and output shape are unchanged.

| Local benchmark | Before | After | Change |
|---|---:|---:|---:|
| 20 incoming x 5,000 candidates (100,000 comparisons) | 625.5111 ms | 241.6257 ms | -61.37% |

**How measured.** A local Node benchmark used seven warmed samples and reports the sorted median. The same corpus and runtime were used for before and after measurements. This measures algorithm time on the development machine, not Cloudflare Worker CPU.

**Correctness and tests.** Exact, near-duplicate, negation, laterality, decimal, sign, dose, different-answer, and same-concept/different-question cases pass. Ordering and thresholds are covered by the duplicate suite.

**Remaining risk.** Production import candidate distributions, Worker CPU, and memory still need telemetry. The algorithm remains O(incoming x candidates); candidate retrieval or indexing may be needed at much larger scales.

### 5. Identical answer replay

**Problem.** An exam checkpoint that replayed the already stored answer still constructed a collaboration request and entered the collaboration persistence path after the personal-state idempotency check.

**Root cause.** Answer-stat operations were built without first comparing the stored selection for the current user.

**Change.** Commit `4b4f3b6` filters unchanged selections while constructing answer-stat operations and returns the existing state response when none remain. A changed answer follows the original collaboration and per-operation audit path.

| Identical answer replay | Before | After |
|---|---:|---:|
| New answer-stat records | 0 | 0 |
| New audit records | 0 | 0 |
| New state-sync operations | 0 | 0 |
| Downstream collaboration persistence entry | 1 | 0 |

**How measured.** The integration regression replays the same exam state and answer, then verifies an unchanged response and unchanged audit/state-sync row counts. A source regression asserts the early return precedes collaboration request construction. The exact D1 query saving was not instrumented, so none is claimed.

**Correctness and tests.** The changed-answer path continues to update answer statistics. Identical replay remains idempotent and does not create audit or state-sync rows.

**Remaining risk and stop decision.** A changed answer still costs roughly 12 billed D1 row writes in the local first-pass probe because generic answer-stat and per-operation audit records maintain several indexes. Reducing that requires an explicit audit-retention/granularity decision and possibly a normalized answer model. Phase 10 preserves current audit semantics.

## Validation

Each implementation wave was committed separately and validated before the next wave.

| Point | Tests | TypeScript | Lint | Production build |
|---|---:|---|---|---|
| Baseline | 125 passed | pass | pass | pass |
| Collaboration SQL | 126 passed | pass | pass | pass |
| Policy documentation | 126 passed | pass | pass | pass |
| Reconnect coordination | 127 passed | pass | pass | pass |
| Duplicate CPU optimization | 128 passed | pass | pass | pass |
| Identical answer replay | 129 passed | pass | pass | pass |

The production build continues to emit the pre-existing warning that the main client chunk exceeds 500 KB. It completes successfully.

## Commit map

| Commit | Wave |
|---|---|
| `7407138` | Phases 0-9 audit baseline |
| `67fdc43` | Indexed collaboration read shape |
| `0da252a` | Request and data lifecycle policy |
| `306d269` | Reconnect coordination |
| `f3d6e3f` | Duplicate-detection CPU reduction |
| `4b4f3b6` | Identical answer replay short circuit |

## Deferred work

The following changes were intentionally not implemented because their contracts, production frequency, or safety threshold is not yet established:

- collaboration response slicing or delta sync; there is no durable ordered authorization-safe cursor;
- account/entitlement query consolidation;
- post-response realtime publication through `waitUntil`;
- answer-audit batching, retention changes, or normalized answer storage;
- test-pool replacement for `ORDER BY random()`;
- audit JSON-expression indexes;
- main-bundle code splitting;
- new D1 indexes or schema migrations;
- changes to cancellation, automatic retry, or polling behavior.

## Production measurement plan

Before rollout conclusions are made, deploy to staging or a small canary with a pinned commit and schema version, then follow [measurement-plan.md](./measurement-plan.md). The minimum after-measurement set is:

1. collaboration route D1 rows, query plans, CPU, duration, returned rows, and response bytes;
2. browser warm-navigation and ten-minute idle request traces;
3. reconnect traces with 1, 5, and 20 channels;
4. duplicate scans at 1/50/200 incoming against representative 1,124/5,000-candidate banks;
5. changed and replayed exam checkpoints with D1 statements and rows written;
6. route-correlated `exceededResources`, `clientDisconnected`, and `responseStreamDisconnected` outcomes.

Use at least five samples for browser journeys when practical and report median and p95. Do not log cookies, tokens, request bodies, question text, email addresses, or user-entered search values.

## Architecture and cost recommendation

Keep Workers, D1, R2, and the hibernating Durable Object design. The measured problem was query and request shape rather than platform capacity. Production should use Workers Paid because observed Free D1 reads were about 9.2 times the daily allowance and the first-pass audit encountered the hard daily read limit. Current aggregate usage fits within Paid included D1/request allowances; the expected minimum remains about **$5/month**, plus measured R2 and Durable Object usage.

No production deployment was performed as part of this work.

## Phase 11 validation attempt

Phase 11 stopped at the clean pre-deployment gate on 2026-09-24. A detached checkout of commit `d8969e1eb9bd0bb1a4d7e6391072318d1d2c6aaa`, installed from `package-lock.json`, ran 117 tests: 116 passed and one failed because `tests/duplicate-detection.test.mjs` references `drizzle/0021_duplicate_review_system.sql`, which is not committed. The branch tracks migrations only through `0020`; migrations `0021`-`0023` and additional tests exist only in the dirty development checkout.

The 129-test Phase 10 result therefore describes the working checkout used during implementation, not a reproducible clean build of `d8969e1`. This contradicts the required one-build validation identity and blocks canary deployment. TypeScript, lint, build, and dry-run were stopped after the failed gate as required.

The repository also has no isolated staging environment: its only configured bindings point to `qraft-qbank`, `qraft-assets`, and `qraft-realtime`. No Worker was deployed and no Cloudflare data was queried or changed. Consequently, all production/canary claims remain unvalidated. See [Phase 11 validation](./phase-11-validation.md) and [rollout readiness](./phase-11-rollout-readiness.md).
