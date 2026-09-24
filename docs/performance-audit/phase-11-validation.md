# Qraft Phase 11 validation record

## Status

**Stopped at the pre-deployment gate on 2026-09-24. No staging, canary, or production deployment was performed. No Cloudflare data was queried or changed.**

Phase 11 requires one reproducible build, a green pre-deployment gate, isolated Cloudflare resources, and a known rollback version. The pinned Phase 10 commit is not self-contained and the repository has no configured staging environment. Continuing against the production-only bindings would violate the validation safety rules.

## Pinned candidate

| Item | Pinned value | Evidence/limitation |
|---|---|---|
| Branch | `audit/performance-first-pass` | Source branch in the development checkout |
| Candidate commit | `d8969e1eb9bd0bb1a4d7e6391072318d1d2c6aaa` | Tested in a detached clean worktree |
| Source rollback boundary | `5d1d3dfd282fec0108247ba97f2b8e0e8094d22f` | Parent baseline before the performance-audit commits; not confirmed as the currently deployed Worker version |
| Package/build version | `1.0.0` | `package.json`; no independent client build identifier exists |
| Node/npm | Node `22.14.0`, npm `10.9.2` | Local pre-deployment environment |
| Wrangler dependency | `4.135.0` requested | `package.json`; lockfile contains the project installation |
| Tracked D1 schema | Through `0020_phase2_logic_integrity.sql` | Clean candidate contains no `0021`-`0023` files |
| Dirty-checkout schema files | `0021`, `0022`, `0023` | Present only as untracked files; therefore not part of the candidate |
| Durable Object migration | `v1`, `RealtimeChannel` | `wrangler.realtime.jsonc` |
| Compatibility date | `2026-09-09` | Both Wrangler configurations |
| App Worker | `qraft` | Default configuration; production deployment version was not queried after the stop gate |
| Realtime Worker | `qraft-realtime` | Default configuration; `workers_dev` is false |
| D1 binding | `DB` -> `qraft-qbank` / `7f288176-8ed7-490c-bd44-d6e78577413d` | The only configured database; treated as production and not used in this attempt |
| R2 binding | `ASSETS` -> `qraft-assets` | The only configured bucket; treated as production and not used |
| Service binding | `REALTIME` -> `qraft-realtime` | The only configured realtime service |
| Staging environment | **Absent** | No `env.staging`, staging Worker, staging D1, staging R2, or staging realtime binding is configured |

## Test accounts and data policy

No test account was created and no user data was read. No synthetic records were sent to Cloudflare. A future run must use dedicated staging accounts and clearly identifiable synthetic records in an isolated staging D1 database and R2 bucket. Production credentials, cookies, request bodies, question text, email addresses, and search input must not enter telemetry.

## Pre-deployment gate

The candidate was checked out into an isolated detached worktree. Dependencies were installed from the lockfile with `npm.cmd ci --ignore-scripts`. The first test attempt used a dependency junction and failed before test execution because the sandbox could not resolve the junction; that environmental attempt is excluded from the application result.

The valid clean-worktree result was:

```text
npm.cmd test
tests: 117
passed: 116
failed: 1
duration: 78.8798261 seconds
```

The failing test was `integration skips exact imported questions, reviews near matches, and preserves reviewer decisions`. It attempts to read `drizzle/0021_duplicate_review_system.sql`, which is absent from the committed candidate.

TypeScript, lint, production build, and Cloudflare dry-run were not run after this failure because the Phase 11 gate says to stop on any unexplained failure and not deploy the candidate.

## Contradiction with the Phase 10 engineering baseline

Phase 10 reported 129 passing tests from the working development checkout. A clean checkout of the exact reported candidate discovers 117 tests and fails one. The difference is caused by uncommitted repository content, including migrations `0021`-`0023` and additional tests. Therefore:

- the Phase 10 implementation measurements remain useful local engineering evidence;
- `129 passing` is not reproducible from commit `d8969e1` alone;
- the candidate cannot be attributed to one build/schema version;
- a canary built from the dirty checkout would mix Phase 10 with unrelated work;
- a canary built from the commit would omit a migration required by its committed test.

This is a release-provenance failure, not evidence that the collaboration, reconnect, duplicate-detection, or answer-replay changes are behaviorally wrong.

## Canary feasibility assessment

The repository configures only the production-named resources. Cloudflare bindings are non-inheritable across Wrangler environments, so a safe staging environment needs explicit D1, R2, Durable Object/service, variables, secrets, and route definitions. Cloudflare documents named Wrangler environments for persistent staging Workers and deploys them with `--env staging` ([Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)).

No safe write-validation surface or exact deployed rollback version is recorded. Phase 11 therefore stopped instead of pointing a validation build at `qraft-qbank`, `qraft-assets`, or `qraft-realtime`.

## Scenario disposition

| Test group | Phase 11 execution | Result |
|---|---|---|
| 1. Collaboration D1 | Not executed | Insufficient evidence; no deployed planner or route telemetry |
| 2. Warm navigation | Not executed | Insufficient evidence; no isolated deployed browser target |
| 3. Exam navigation | Not executed | Insufficient evidence |
| 4. Exam persistence | Not executed | Insufficient evidence; production writes prohibited and no staging D1 exists |
| 5. Ten-minute idle | Not executed | Insufficient evidence |
| 6. Focus/PWA lifecycle | Not executed | Insufficient evidence |
| 7. Realtime events | Not executed | Insufficient evidence; no staging realtime Worker/accounts |
| 8. Reconnect 1/5/20 | Not executed | Insufficient evidence; Phase 10 deterministic test remains local only |
| 9. Duplicate detection 1/50/200 | Not executed on Workers | Local benchmark remains partially validated engineering evidence |
| 10. Error correlation | Not executed | Current 1% sampling and absent canary prevent route attribution |
| 11. Request amplification | Not executed | Insufficient evidence |
| 12. Cache correctness | Not executed in browser | API/local tests are not a deployed cross-account browser test |
| 13. Authorization under cache | Not executed in browser | Insufficient evidence |
| 14. Loading UX | Not executed | Insufficient evidence |
| 15. Database growth | Not recalculated | Requires deployed query behavior; Phase 0-10 projections remain projections |
| 16. Cost validation | Not recalculated from canary | No measured canary resource activity |

## Consolidated metric table

| Metric | Phase 0-9 baseline | Phase 10 expected/local | Phase 11 measured | Change | Evidence type | Status |
|---|---:|---:|---:|---:|---|---|
| `/collaboration` rows read | 11,326 | 1,142 | — | — | Production read-only before + local plan after | Insufficient evidence |
| `/collaboration` duration | 48.68 ms single probe | 2.63 ms single probe | — | — | Single read-only SQL probes | Insufficient evidence |
| `/collaboration` Worker CPU | Unknown | Expected lower | — | — | Engineering inference | Insufficient evidence |
| Warm-navigation requests | Unknown | No redundant reload expected | — | — | Policy/test inference | Insufficient evidence |
| Cached-route revisit requests | Unknown | 0 expected | — | — | Deterministic cache test | Insufficient evidence |
| Exam-navigation fetches | Unknown | 0 full question-set fetches expected | — | — | Source/test inference | Insufficient evidence |
| Idle HTTP requests / 10 min | Unknown | Approximately 0 expected | — | — | Source inference | Insufficient evidence |
| Reconnect generic syncs, 1 channel | 1 upper bound | 1 | — | — | Deterministic test only | Partially validated |
| Reconnect generic syncs, 5 channels | Up to 5 | 1 | — | — | Formula/deterministic test | Partially validated |
| Reconnect generic syncs, 20 channels | Up to 20 | 1 | — | — | Formula/deterministic test | Partially validated |
| Reconnect physical requests | Unknown | At most one account + one collaboration logical refresh | — | — | Engineering inference | Insufficient evidence |
| Duplicate duration, 100,000 comparisons | 625.5111 ms | 241.6257 ms | — | -61.37% local only | Local Node benchmark | Partially validated |
| Duplicate Worker CPU | Unknown | Expected lower | — | — | Engineering inference | Insufficient evidence |
| Changed-answer billed writes | About 12 before state-sync | Unchanged by design | — | — | Local D1 probe | Partially validated |
| Identical replay new audit/state-sync rows | 0 | 0 | — | — | Deterministic integration test | Partially validated |
| Identical replay collaboration entry | 1 | 0 | — | — | Source regression | Partially validated |
| Worker `exceededResources` | 7/day aggregate | Expected lower on duplicate workload | — | — | Production aggregate before only | Insufficient evidence |
| `clientDisconnected` | Aggregate only | No numeric claim | — | — | Production aggregate before only | Insufficient evidence |
| `responseStreamDisconnected` | Aggregate only | No numeric claim | — | — | Production aggregate before only | Insufficient evidence |

No row in the Phase 11 measured column contains a canary value because no candidate passed the deployment gate.

## Required procedure for the next validation attempt

### 1. Create a reproducible release candidate

1. Decide which currently uncommitted migrations, source files, and tests belong to the release.
2. Commit them in reviewed, purpose-specific commits. Do not copy the dirty checkout into a deployment artifact.
3. Ensure every committed test references only committed fixtures and migrations.
4. Record the new candidate SHA and ensure `git status --short` is empty in a detached worktree.

Run from that clean worktree:

```powershell
npm.cmd ci
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
npm.cmd run cloudflare:check
```

All checks must pass. The test count must be explained and at least cover the 129-test Phase 10 working-tree baseline.

### 2. Add isolated Cloudflare staging resources

Add explicit `env.staging` or dedicated staging configs for both Workers. Bindings must point to:

- an app Worker distinct from `qraft`;
- a realtime Worker distinct from `qraft-realtime`;
- a D1 database distinct from id `7f288176-8ed7-490c-bd44-d6e78577413d`;
- an R2 bucket distinct from `qraft-assets`;
- a staging-only hostname or workers.dev preview;
- staging-only secrets and test accounts.

Bindings and variables must be repeated in the named environment because Wrangler does not inherit bindings into environments. Confirm the generated `dist` configs retain the staging definitions before deployment.

### 3. Pin rollback and schema state

Before deploying, capture:

```powershell
npx.cmd wrangler deployments list --name qraft-staging --json
npx.cmd wrangler deployments list --name qraft-realtime-staging --json
npx.cmd wrangler d1 info qraft-qbank-staging --json
npx.cmd wrangler d1 migrations list qraft-qbank-staging --remote --env staging
```

Save the active app and realtime version ids. Apply migrations only to the staging database after reviewing the list:

```powershell
npx.cmd wrangler d1 migrations apply qraft-qbank-staging --remote --env staging
```

Cloudflare captures a backup around migration application, but this does not authorize production migration ([D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)).

### 4. Deploy staging in dependency order

After the build generates configs with staging bindings:

```powershell
npx.cmd wrangler deploy --config dist/qraft_realtime/wrangler.json --env staging
npx.cmd wrangler deploy --config dist/server/wrangler.json --env staging --keep-vars
```

Record both resulting version ids, the D1 migration list, hostname, build SHA, and test-account dataset cardinalities.

### 5. Execute the Phase 11 matrix

Run all 16 groups from the Phase 11 specification. Use five samples where practical, report median and p95, and capture stable route/query labels, D1 metadata, Worker CPU, duration, response bytes, request reason, and a non-secret correlation id. Large 50/200-by-5,000 duplicate workloads and all write scenarios must stay in staging.

### 6. Roll back on any gate failure

Cloudflare's current Wrangler rollback form is:

```powershell
npx.cmd wrangler rollback <PREVIOUS_APP_VERSION_ID> --name qraft-staging --message "Phase 11 rollback"
npx.cmd wrangler rollback <PREVIOUS_REALTIME_VERSION_ID> --name qraft-realtime-staging --message "Phase 11 rollback"
```

A rollback immediately creates a deployment using the selected version ([Workers rollback documentation](https://developers.cloudflare.com/workers/wrangler/commands/workers/#rollback)). Phase 10 itself has no schema migration, so its code rollback should not require D1 reversal. If the future candidate includes migrations `0021`-`0023`, their forward/backward compatibility must be reviewed independently before deployment.

## Evidence classification

| Phase 10 hypothesis | Phase 11 classification |
|---|---|
| Collaboration indexed read reduction | **Insufficient evidence** |
| Existing request cache prevents warm-navigation duplication | **Insufficient evidence** |
| Reconnect coordination reduces one wave to one generic reconciliation | **Partially validated** by deterministic test; realistic trace absent |
| Duplicate-detection CPU reduction | **Partially validated** by local benchmark; Worker CPU absent |
| Identical answer replay avoids collaboration persistence | **Partially validated** by deterministic integration/source tests; deployed D1 telemetry absent |
| Changed-answer audit semantics remain intact | **Partially validated** locally; deployed write telemetry absent |
| Phase 10 candidate is release-reproducible | **Regressed / disproved** |

## Limitations

- No deployed Worker version, CPU, latency, D1 metadata, response bytes, realtime latency, or route-level error data was collected.
- No browser, PWA, network-transition, idle, warm-navigation, cache-isolation, or loading-UX scenario was run.
- No production or staging cost was measured.
- No inference in this document should be presented as a production/canary improvement.
