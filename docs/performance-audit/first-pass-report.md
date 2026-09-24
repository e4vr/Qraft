# Qraft performance, reliability and cost audit — first pass

## Scope and status

Phases 0–9 are complete. This pass inspected code, ran the existing tests and production build, captured read-only production D1 plans/aggregates, and measured write behavior locally. **No application code, schema, production data or runtime configuration was changed. Phase 10 is awaiting approval.**

## Executive summary

The abnormal usage is not explained by traffic volume. Qraft handles only about 2,085 Worker invocations/day, yet each invocation averages 22,062 D1 rows read and 48.4 rows written.

The strongest proven read root cause is `GET /collaboration`: two SQL statements scan the entire polymorphic `records` table. In a representative production scope they read 11,326 rows to return 1,101 records. Rewriting only the SQL shape to use existing indexes reduces that to about 1,142 rows, an 89.9% endpoint-query reduction, with no schema change.

The write volume is structurally plausible rather than a render loop. An exam checkpoint stores a generic `answerStats` record and a generic audit record per changed answer. Each generic record maintains several indexes. A local D1 billing probe measured about 12 rows written per changed answer before personal-state writes. Imports and bulk review use the same record/audit pattern and can multiply writes further.

Worker CPU errors cannot be attributed to a route because only 1% of Worker events are sampled. The highest-confidence CPU candidate is duplicate detection: it compares every incoming question with every candidate and an existing 20 x 5,000 scale test took roughly 1.1 seconds in the baseline run. Large collaboration JSON processing, full-state serialization and backup compression are additional candidates.

The high disconnect counts are not evidence of 880 server defects. Cloudflare defines `clientDisconnected` as the client leaving before completion and `responseStreamDisconnected` as termination during deferred/proxied response handling ([Workers error documentation](https://developers.cloudflare.com/workers/observability/errors/)). Qraft does not generally abort API fetches itself. Navigation, tab closure, PWA/network suspension and multi-channel WebSocket reconnects can produce expected disconnects. Route and response-size correlation is required before fixing a specific path.

Workers + D1 remains appropriate. Current aggregate use fits comfortably in the Paid plan's included D1/request allowances, while the Free D1 cap has already produced a hard query-limit error. The likely production minimum is about $5/month plus any measured R2/DO usage.

## Ranked root causes

| Rank | Finding | Evidence | Impact | Confidence | Regression risk |
|---:|---|---|---|---|---|
| 1 | Collaboration full-table scans | Production plans show two `SCAN records`; 11,326 current vs 1,142 indexed rows | Very high reads; response/CPU latency | High | Low for existing-index SQL rewrite |
| 2 | Generic record + per-operation audit write multiplication | Local D1: 1,200 billed rows for 100 answers + 100 audits | High writes for checkpoints/import/review | High | Medium/high because audit semantics matter |
| 3 | Duplicate detection is incoming x candidates | 100,000 comparisons in about 1.1 s baseline; flat map + similarity + sort | Likely Worker CPU/resource errors on imports/scans | High for complexity; medium for production attribution | Medium |
| 4 | Large collaboration serialization | Representative raw payload at least 728 KB; 1,090 JSON records parsed then permission-filtered | Worker CPU, transfer, disconnect exposure | High for size; medium for error attribution | Medium because response slicing affects contracts |
| 5 | One reconnect reconciliation per channel | Code emits generic `connected` for every channel and root refreshes account + collaboration | Duplicate requests and D1 reads after resume | High | Low |
| 6 | Full personal-state JSON read/normalize/write | Up to 2 MB accepted; whole state is parsed, validated and serialized | CPU and growing payload per checkpoint | High design evidence; unknown daily contribution | Medium/high |
| 7 | Authentication/entitlement query count | Request-scoped auth is memoized, but protected requests still perform several indexed lookups | D1 query count/latency, not main rows-read issue | Medium | Medium |
| 8 | Awaited realtime publication | Successful mutations await notification routing/DO RPC | Adds response tail latency; may amplify disconnect exposure | Medium | Medium; delivery semantics |
| 9 | `ORDER BY random()` and rare JSON-expression scans | 1,107 reads for 10 current questions; ticket audit lookup read 2,832 | Linear growth/rare spikes | High for plan, low current frequency | Medium |

## Phase findings

### Phases 0–2: architecture, network and tracing

- The application has an event-driven client cache with canonical keys and single-flight deduplication. It does not use React Query and has no generic focus or interval refetch.
- The service worker skips `/api/*`; it is not duplicating API reads.
- Search paths inspected are debounced.
- Initial authenticated hydration is approximately session, announcement, personal state and collaboration.
- Equivalent component-level collaboration loads are normally served by cache/single-flight and are not physical duplicates.
- Reconnect reconciliation is the confirmed frontend duplication path.
- Idle pages should produce zero HTTP requests once hydrated; this needs a ten-minute browser acceptance trace.
- Major action traces are recorded in [request-traces.md](./request-traces.md).

### Phases 3–4: D1 reads and writes

- Production `records` contains 5,663 rows, including 2,831 audits and 1,124 shared questions.
- The collaboration catalog and scoped queries both perform full scans.
- Existing indexes can provide the same measured rows with 89.9% fewer D1 row reads for the pair.
- Adding indexes first would be wasteful because existing indexes already cover the predicates.
- No general render-triggered or GET-triggered collaboration write was found. R2 media accounting intentionally updates a D1 counter on reads.
- State equality and operation-id guards prevent identical replay writes.
- Per-answer auditing doubles logical generic records and both records maintain multiple indexes.
- Full details are in [d1-query-analysis.md](./d1-query-analysis.md).

### Phase 5: Worker CPU

High-risk paths:

1. duplicate scanning/import: O(incoming x candidates) similarity work and match sorting;
2. collaboration load: parse 1,090 JSON payloads, build full state, permission-filter, then serialize a large response;
3. question/personal backups: assemble, stringify, HMAC/compress payloads up to configured limits;
4. state checkpoints: parse/normalize/compare/stringify a full AppState up to 2 MB;
5. test-pool selection: JSON/classification SQL plus `ORDER BY random()`;
6. large bulk review/import batches and their audit/reward construction.

The baseline suite's two slow integration paths were a 500-question pool scenario (~22.6 s including fixture insertion and multiple calls) and the Superadmin import-cap scenario (~24.2 s including setup and multiple imports). These are suite timings, not route latency, so they identify profiling targets but do not prove production CPU duration.

### Phase 6: disconnects

- No broad application `AbortController` pattern explains the counts.
- WebSocket reconnect/close events are expected on offline/online and component lifecycle changes.
- A large or CPU-slow response gives the client more time to navigate away, but this link is unproven.
- The two Cloudflare categories may overlap the same requests and must not be added as unique failures.
- Do not suppress or retry legitimate cancellation automatically.

### Phase 7: API efficiency

- Resource cache keys include scope, method, canonical parameters and body; private data is not globally cached.
- Mutation/realtime invalidation has explicit tags and initiating-client exclusion.
- The first safe gains are better D1 selection and reconnect coalescing.
- Auth-query consolidation, response slicing, post-response realtime publication and conditional responses require telemetry/contract tests before change.
- Any future cache must state key, user/bank scope, TTL/freshness mechanism, invalidation, privacy and stale-data behavior. The existing no-TTL/event-invalidation model is defensible.

### Phase 8: Cloudflare architecture

- The Durable Object uses WebSocket hibernation correctly and isolates audiences; it is not a global bottleneck.
- Multiple sockets per user raise authentication/request/disconnect counts, but consolidating audiences would complicate authorization and is not justified yet.
- D1 is small and indexed; the main issue is query shape and JSON record modeling, not platform capacity.
- Static asset delivery and PWA caching are reasonable, though the 746 KB main client chunk merits a browser-load trace.
- No evidence supports adding KV, Queues, another database or a different hosting stack.
- Cloudflare advises avoiding unnecessary global state, using `waitUntil` for work that may continue after the response when semantics allow, and instrumenting Workers appropriately ([Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [metrics and analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)).

### Phase 9: cost

- Free D1 reads are exceeded by about 9.2x and writes by about 1%; Free Worker CPU has recorded failures.
- The production read limit was encountered during this read-only audit, proving Free-tier hard-failure risk.
- On the observed aggregate counts, Paid included usage is ample; likely base cost is about $5/month before R2/DO usage.
- See [cost-model.md](./cost-model.md) for formulas and scenarios.

## Proposed Phase 10 change queue

The ranking uses impact x frequency x confidence divided by regression risk. It is a proposal, not authorization to implement.

| Order | Proposed change | Why first/next | Validation |
|---:|---|---|---|
| 1 | Rewrite catalog and scoped collaboration SQL to use existing indexes and split the `OR` scope | Largest directly measured saving; no schema change | exact authorized result equality; D1 rows <=1,150; query-plan regression tests |
| 2 | Coalesce generic reconnect reconciliation across channels | Confirmed duplicate source; client-only behavior can preserve topic invalidation | browser test: one account + one collaboration fetch per resume; realtime mutation tests |
| 3 | Add stable route/query resource telemetry and a controlled high-sampling run | Required to attribute CPU, writes and disconnects | no PII; reconcile aggregate counters; sampled journey matrix |
| 4 | Bound/optimize duplicate candidate work | Likely CPU failure source | compare exact/near-duplicate results against current fixtures; CPU budgets at 1/50/200 x 1,124/5,000 |
| 5 | Decide answer-stat audit granularity | Needed before meaningful write reduction | explicit product/security choice; audit and retry tests; rows-written target |
| 6 | Reduce collaboration payload/Worker transforms by resource slicing | Potential CPU/transfer gain after SQL fix | backward-compatible endpoints or versioned rollout; permission parity |
| 7 | Consolidate entitlement lookups | Reduce indexed query count per protected request | all role/plan transition tests; freshness parity |
| 8 | Consider `waitUntil` for post-commit realtime publication | Reduce mutation response tail | prove eventual notification/reconnect recovery and retain failure telemetry |
| 9 | Profile then address random selection, audit recovery and reviewer index | Avoid optimizing rare/currently cheap paths | route frequency + D1 meta thresholds before index/design changes |

## Changes implemented in this pass

Documentation only:

- `docs/performance-audit/README.md`
- `docs/performance-audit/baseline.md`
- `docs/performance-audit/request-traces.md`
- `docs/performance-audit/d1-query-analysis.md`
- `docs/performance-audit/measurement-plan.md`
- `docs/performance-audit/cost-model.md`
- `docs/performance-audit/first-pass-report.md`

No source, test, schema, Worker configuration or production data change was made.

## Verification baseline

- `npm.cmd test`: 125 passed, 0 failed, about 73.7 seconds.
- `npm.cmd run build`: passed; build emitted a >500 KB chunk warning.
- Production D1 probes: read-only; halted on Free daily rows-read limit.
- Local plan fixture: all migrations plus 17,234 synthetic records.
- Local D1 write probe: exact generic `records`/audit shape with 100 answer operations.

## Regression risks and unknowns

- The working tree may not match the deployed production commit.
- Aggregate production metrics do not identify routes, users or workload mix.
- 1% sampling is too sparse to explain seven resource errors.
- Collaboration query timing came from single probes; only row reads/result equality are strong evidence.
- R2 and Durable Object analytics were unavailable.
- Audit retention/granularity is a product and security policy, not merely a performance decision.
- Large-state and payload slicing changes can affect offline/realtime consistency and require focused tests.

## Cloudflare recommendation

Keep Workers, D1, R2 and the hibernating Durable Object architecture. Move production off Free limits for reliability, implement the measured query/request fixes, and collect route-level evidence before considering deeper storage or realtime changes. No architectural migration is justified by the current data.

## Approval boundary

This is the required stop before Phase 10. No proposed change should be applied until the first implementation group and its acceptance criteria are approved.
