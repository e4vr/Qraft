# Qraft Phase 11 rollout readiness

## Decision

**NO-GO.** Do not deploy or expand Phase 10 from the current branch.

The decision is based on explicit Phase 11 gates rather than elapsed time or a subjective UI review. The pinned candidate fails its clean pre-deployment test, is missing a migration required by a committed test, has no isolated staging configuration, and has no captured Cloudflare rollback version.

## Blocking issues

1. **The candidate is not reproducible.** Commit `d8969e1` produces 116 passes and one failure from 117 tests. The reported 129-pass result depends on uncommitted files.
2. **The committed test depends on an uncommitted migration.** `tests/duplicate-detection.test.mjs` requires `drizzle/0021_duplicate_review_system.sql`; the commit tracks schema only through `0020`.
3. **There is no staging environment.** The only configured D1, R2, and realtime bindings use production names/identity.
4. **The deployed rollback version is unknown.** Source commit `5d1d3df` is the Phase 10 code boundary, but it has not been proven to be the active Cloudflare version.
5. **Required canary telemetry is absent.** Real Worker CPU, D1 rows/query, route correlation, physical request counts, and realtime timing cannot be measured safely on the current setup.

Any one of items 1-4 is sufficient to block deployment.

## Non-blocking observations

- Phase 10 has strong local evidence for the collaboration SQL shape and duplicate CPU reduction.
- Deterministic tests support reconnect coordination and identical-answer replay behavior.
- Phase 10 contains no schema migration, so the performance commits themselves are straightforward to revert in source.
- No Phase 11 action changed production data, configuration, traffic, or deployments.

## Rollback point

No canary was deployed, so no rollback was needed.

- Candidate source: `d8969e1eb9bd0bb1a4d7e6391072318d1d2c6aaa`
- Source boundary before the performance-audit series: `5d1d3dfd282fec0108247ba97f2b8e0e8094d22f`
- Exact current production Worker version: **unknown**
- Exact future staging rollback version: must be captured with `wrangler deployments list --json` before deployment

Do not use the source boundary as a production rollback command until it is matched to an actual Cloudflare version id. Workers rollback operates on deployed version ids.

## Gate status

| Gate | Required | Current status |
|---|---|---|
| Clean tests, typecheck, lint, build | All green | **Fail** at tests; remaining checks stopped |
| One attributable build/schema | Exact committed source | **Fail** |
| Isolated staging resources | Separate Worker/D1/R2/DO | **Fail** |
| Authorization/cache correctness | Browser and API pass | Not measured |
| Collaboration result equality | Exact authorized result | Not measured |
| D1 amplification acceptable | Comparable deployed metrics | Not measured |
| Worker CPU/error rate acceptable | Route-correlated canary data | Not measured |
| Realtime behavior correct | 1/5/20-channel traces | Not measured |
| Exam persistence correct | First/change/replay/rapid/reconnect | Not measured |
| Rollback tested and version pinned | App + realtime ids | **Fail** |

## Required sequence before reconsidering rollout

1. Produce a clean release candidate containing every required migration, fixture, source file, and test.
2. Pass the full gate from a detached checkout installed from `package-lock.json`.
3. Add and review explicit staging bindings for app Worker, realtime Worker, D1, R2, secrets, and hostname.
4. Capture existing staging deployment ids and prove rollback before test traffic.
5. Deploy only to staging and execute all Phase 11 groups with five samples where practical.
6. Hold exposure if any authorization, exam, realtime, request-storm, resource, or result-equivalence gate fails.
7. Reissue this readiness document with measured median/p95 values and a new GO/NO-GO decision.
8. Seek explicit approval before any production rollout.

## Monitoring required for a future canary

- stable route template and non-secret request correlation id;
- request reason category without user content;
- Worker status, outcome, wall duration, CPU, and response bytes;
- stable logical D1 query labels, query count, rows read/returned/written, and duration;
- realtime event type, targeted resource, fetch count, and visible-update latency;
- `exceededResources`, `clientDisconnected`, and `responseStreamDisconnected` correlated by route;
- alerts for authorization mismatch, exam persistence failure, request storms, and unexpected D1 amplification.

Sampling and temporary instrumentation must be easy to disable and must exclude cookies, tokens, bodies, question text, email addresses, and search input.

## Candidate Phase 12 work

Do not begin a new optimization phase yet. First complete the release-engineering prerequisite and rerun Phase 11. After real canary evidence exists, Phase 12 may address only confirmed findings such as planner divergence, route-specific Worker CPU cliffs, broad realtime invalidation, or measured answer-write amplification. Collaboration data-model redesign, audit-policy changes, and new indexes remain out of scope without that evidence.
