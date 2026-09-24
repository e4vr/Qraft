# Measurement plan

This plan turns the Phase 0–9 findings into comparable before/after evidence. Implementation is intentionally deferred until Phase 10 approval.

## Measurement identity

Every result row must include:

- deployed Git commit and build id;
- D1 migration/schema version;
- environment and Cloudflare colo/region;
- dataset cardinalities by relevant table/record type;
- account role, plan, bank count and question count, using synthetic identifiers;
- cold/warm cache state and browser version;
- timestamp and metric window.

The current dirty working tree cannot be treated as the deployed production revision without this identity.

## Temporary observability window

Current Worker head sampling is 1%, which is inadequate for seven resource errors per day. Use a 15–30 minute staging or tightly controlled canary window with 100% sampling, or add structured route metrics at the API lifecycle boundary. Restore the normal rate after capture.

Per request, record:

- request id, deployment id and stable route template;
- method, status and Worker outcome;
- wall duration and CPU time where Cloudflare exposes it;
- response bytes;
- D1 statement count, aggregate rows read/written and SQL duration;
- stable query id, never raw user values or SQL with values;
- cache result/reason (`initial-cache-miss`, invalidation, reconnect, explicit refresh);
- realtime channels published and publication duration;
- disconnect category and whether headers/body had begun.

Do not log cookies, request bodies, question content, emails, search text or record payloads.

## Browser network capture

Capture physical requests, transferred bytes, initiator, response status, cancellation and timing. Pair the trace with `window.__QRAFT_DATA_DIAGNOSTICS__` counters. Run each journey five times when practical and report median and p95; use at least three repetitions for expensive import/review workloads.

## Representative journeys

| Journey | Variants | Measures |
|---|---|---|
| Cold login/dashboard | regular user, reviewer, admin | requests, D1 statements/rows, CPU, response bytes, LCP/main bundle |
| Warm navigation | dashboard -> bank -> progress -> dashboard | physical requests, cache hits, duplicate avoidance |
| Idle page | 10 minutes, visible and unchanged | HTTP requests; WebSocket behavior |
| Network resume | user with 1, 5 and 20 bank channels | reconnect count, account/collaboration fetch count, D1 rows |
| Bank open/question browse | 1,124 and synthetic 5,000-question bank | query plans, rows, payload, CPU |
| Test builder/start | 10, 100 and 500 questions; filtered/unfiltered | test-pool rows, SQL time, CPU, random-selection cost |
| Exam | answer 20, navigate back/forward, exit, resume | requests, state bytes, rows written, idempotent retry behavior |
| Review | individual and bulk 50/200 | writes, CPU, notification overhead, permissions |
| JSON import | 1/50/200 incoming against 1,124 and 5,000 candidates | duplicate comparisons, CPU, writes, errors |
| Admin overview/search | empty and leading-wildcard queries | rows read, payload, debounce request count |
| Backup | representative and configured maximum | CPU, memory, R2 operations, compressed size |
| PWA | install, offline navigation, background/resume | service-worker requests and cancellation classification |

## D1 plan capture

For each stable query id:

1. record `EXPLAIN QUERY PLAN` and explicitly flag `SCAN` versus `SEARCH ... USING INDEX`;
2. execute with the same representative bindings and capture D1 `meta.rows_read`, `rows_written` and duration;
3. record rows returned and serialized bytes;
4. repeat after the proposed SQL/index change on an equivalent database;
5. check mutation write cost when an index is added.

Do not run broad production probes after a quota warning. Prefer a production snapshot or representative staging copy.

## Acceptance thresholds for the first implementation group

| Metric | Before | Phase 10 target |
|---|---:|---:|
| Representative collaboration D1 rows read | 11,326 | <= 1,150 with identical authorized response |
| Reconnect refreshes per network-resume wave | up to one pair per channel | <= 1 session + 1 collaboration physical fetch |
| Idle HTTP API traffic | code inspection predicts zero | zero over 10 unchanged minutes |
| Collaboration result shape | current authorized snapshot | byte/semantic-equivalent contract after normalization |
| Controlled imports | resource errors possible/uncorrelated | no `exceededResources` for agreed 1/50/200 fixtures |
| Regression suite | 125/125 passing | all existing tests plus targeted performance regression tests passing |

An improvement is reportable only when an after measurement exists. Query-plan estimates must remain labeled as estimates.

## Write-decision measurement

The local probe measured 1,200 billed D1 row writes for 100 changed `answerStats` records plus 100 per-operation audit records. Before changing audit behavior, measure production route frequency and separate:

- answer-stat record/index writes;
- audit record/index writes;
- `app_states`, `test_registry`, and `state_sync_operations` writes;
- unchanged/idempotent checkpoints;
- import and bulk-review write volume.

Set a numeric target only after the product/security owner chooses an audit-granularity option. The candidate targets in the cost model are planning estimates, not acceptance claims.

## Disconnect investigation

Correlate Worker outcomes with route, duration, response bytes and browser initiator. Separate:

- navigation/tab-close cancellation;
- network transition/PWA suspension;
- WebSocket close/reconnect;
- client cancellation, if AbortController is later introduced;
- server timeout/resource exhaustion;
- failure after response streaming began.

Do not optimize the raw count. Optimize only repeated work, long responses or server failures tied to a route.

## Regression checks

- identical permissions and bank visibility for each role;
- identical question/exam selection, scoring and progress semantics;
- identical mutation response contracts;
- no stale private data across logout/account switch;
- retry/idempotency and conflict behavior preserved;
- realtime changes still reach other authorized clients;
- no extra index without measured read benefit exceeding its write/storage cost;
- local type/lint/build/test and Cloudflare dry-run before deployment;
- rollback plan for any later migration.
