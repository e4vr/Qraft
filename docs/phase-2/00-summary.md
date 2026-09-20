# Phase 2 Summary

## Status

**PASS WITH DOCUMENTED LIMITS.** Major Qraft workflows were traced against the Phase 0/1 baseline, eight confirmed pre-existing logic defects were repaired, and no Phase 1 behavioral regression was found.

## Baseline

- Starting commit: `7c64e3f90403617bc48b97f4ff7d5e1674f385eb`
- Branch: `audit/phase-2-logic-integrity`
- Runtime: Node `22.14.0`, npm `10.9.2`
- Starting schema: `0019_preformed_tests.sql`
- Final schema: `0020_phase2_logic_integrity.sql`
- Starting verification: TypeScript PASS, lint PASS, build PASS, 89/89 tests PASS.
- Final verification: TypeScript PASS, lint PASS, build PASS, 97/97 tests PASS, and Cloudflare deployment dry-run PASS without deployment.
- Standard local preview: **BLOCKED by toolchain drift**, because config date `2026-09-09` exceeds the installed workerd maximum `2026-09-07`.
- Local Miniflare integration runtime: PASS using compatibility date `2026-09-07`.

Relevant non-secret bindings/configuration names: `DB`, `ASSETS`, `REALTIME`, `API_RATE_LIMITER`, `MUTATION_RATE_LIMITER`, `AUTH_RATE_LIMITER`, `ROOT_ADMIN_EMAIL`, `ROOT_ADMIN_SETUP_TOKEN`, `IMAGEKIT_PRIVATE_KEY`, `R2_BILLING_CYCLE_DAY`, `R2_STORAGE_CAP_BYTES`, `R2_CLASS_A_MONTHLY_CAP`, `R2_CLASS_B_MONTHLY_CAP`, `QUESTION_BACKUP_RETENTION_DAYS`, `QUESTION_BACKUP_MAX_BYTES`, and `NEXT_PUBLIC_SITE_URL`.

## Findings

| Severity | Fixed | Unresolved logic | Total |
| --- | ---: | ---: | ---: |
| LOGIC-CRITICAL | 0 | 0 | 0 |
| LOGIC-HIGH | 5 | 2 | 7 |
| LOGIC-MEDIUM | 3 | 2 | 5 |
| LOGIC-LOW | 0 | 0 | 0 |

All confirmed defects are `PRE-EXISTING`. No `PHASE-1 REGRESSION` was identified.

## Repaired outcomes

1. Free/Lite first-state saves can no longer persist private notes.
2. Offline collaborative changes enter a durable IndexedDB outbox and replay on startup/reconnect.
3. Direct QBank deletion cascades generic records and classification operation state atomically in D1.
4. Invalid answer-statistics checkpoints are rejected before personal exam state is written.
5. A ready-made-test attempt token can produce only one submission, including concurrent requests.
6. Duplicate exam/question/card/deck identities and cyclic deck trees are rejected.
7. A user cannot have multiple membership records for the same QBank.
8. Coupon/subscription times are canonical UTC, and month/year durations clamp correctly at calendar boundaries.

## Readiness

The tested business workflows are logically consistent enough to proceed to Phase 3. Remaining items need either a product conflict policy, a cross-service deletion protocol, physical-device/browser testing, or deliberate security analysis.
