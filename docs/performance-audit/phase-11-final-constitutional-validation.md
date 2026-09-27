# Phase 11 initial constitutional validation — historical

**Superseded in part by [amended-policy review](phase-11-amended-policy-review.md).** Superadmin >150 is now explicitly allowed with controlled batching; the old count-only objection is withdrawn. The user confirmed the constitution as the new backend target. Preserve the following original findings as dated evidence, not current import acceptance rules.

**PHASE 11 NO-GO**

Pinned RC2 contains a reproduced server-side import safety-boundary defect under the supplied constitution. A separate subscription-policy conflict requires a product decision. Validation stopped at that gate as constitution sections 79 and 87 require. No implementation change, staging mutation, production deployment or corrective release occurred in this phase.

## Authority and exact candidate

The entire `QRAFT_ENGINEERING_CONSTITUTION.md.md` was read before architecture inspection. Policy SHA-256: `8F8A06B7BD11776FA62F92092E2CEE90F3C8791D37256209F1D0A33FFFFF9FD3`. The supplied policy file is untracked in the RC2 evidence checkout and was preserved untouched; it is not silently included in the pinned release.

Source: `a957ef47825a6876f1f0bff41b175b8b0c62707b`. Clean detached verification checkout: `C:/Users/Khaled/Desktop/Medguard/phase-11b-proof-a957ef4`. Public staging response freshly returned HTTP 200 with that exact build SHA, `x-qraft-sw=v4.4.1`, schema `0023_json_import_observability.sql`, package `1.0.0`, build time `2026-09-26T23:14:31.215Z`. App/realtime version IDs remain the RC2 manifest identities `0d45ea60-3601-4aff-9236-e1823a6b50a2` / `e814712f-4c03-44c5-9aea-20f257fed8c0`; deployment IDs were not independently re-listed during this stopped phase. Staging D1 remains the isolated manifest target `qraft-qbank-staging` / `f788be6b-f763-49e8-840b-4c107c7e5874`.

## Blocking findings and root causes

**B1 — REGRESSED against the new constitutional acceptance criterion; LOCAL DETERMINISTIC ENDPOINT TEST.** Section 20 sets a technical maximum of 150 questions per import operation. RC2's authenticated Superadmin endpoint accepts 151, returns HTTP 200, reports 151 successful items, and durably stores 151 proposals in the isolated local D1 fixture. This is a concrete failure to enforce the technical safety boundary, not a measured Worker outage or an authorization bypass.

Root cause: `lib/platform-server.ts:2650` passes Infinity to the parser for Superadmin; line 2665 applies the per-import cap only when `!root`. The current frontend chunks Superadmin imports at 25 questions / 900,000 bytes and submits serially, but a direct authorized API request bypasses that UI safeguard. Privilege exemption and resource-safety exemption are conflated. The existing committed test explicitly accepts 201 questions, so the earlier 135-test gate proves current semantics, not conformity with this newly supplied policy. RC2 source did not change during this validation; “REGRESSED” here denotes failed acceptance, not a before/after code regression.

Minimal reproduction uses RC2's real API handler, authentication/session checks, all committed migrations, Miniflare and local D1. It submits only synthetic content; no remote content or credentials are used. Result metadata: requested 151, status 200, successful 151, persisted 151, policy maximum 150. The independent boundary assertion fails as expected (0/1 passed). This does not replace or falsify the prior 135/135 clean release suite.

Reproducer: `evidence/phase11-constitutional-import-boundary.mjs`. Run from a checkout of pinned RC2 with its locked dependencies: `node --test <path-to-reproducer>`. The raw local test output is under the proof checkout's ignored `.wrangler/phase11-final/import-boundary.log`.

**B2 — VALIDATED policy contradiction; STATIC ANALYSIS.** Constitution section 51 specifies Full Access at 100 SAR/month or 230 SAR/3 months and says paid users should not have arbitrary public monthly question/test quotas. RC2 instead defines Lite/Pro/Unlimited with annual default prices and monthly exam caps of 30/250/1,000 in `features/subscriptions/domain/plan-config.ts`. `/platform/exam-start` uses those caps in a conditional database insert (`lib/platform-server.ts:1271`) and returns a monthly-limit error when exceeded. This is enforced product behavior, not merely obsolete UI copy. Configurable `plan_prices` can change amounts, but does not resolve the period/plan model or enforced quotas. Whether legacy tiers are grandfathered, replaced, or excluded from “Full Access” is not defined. Changing that would alter business semantics, so it was not inferred or implemented.

## Smallest sufficient plan and execution

Read the complete policy → verify pinned identity → inspect policy-sensitive current architecture → resolve potential contradictions → reproduce the smallest technical boundary violation locally. A 151-question test was sufficient to falsify the 150 ceiling; a larger staging import/load exercise would add cost without strengthening this conclusion. The code inspection also found an unresolved paid-product contract. Sections 79/87 require stopping rather than silently choosing product semantics. Therefore the remaining system matrix was not executed.

When the policy/content decision is resolved, prioritize exam durability and scoring, server authorization/cache isolation, Ready Test membership/content semantics, bank-scoped import/review retries, then measured warm navigation/realtime/reconnect/idle behavior and representative D1/CPU scaling. Reuse unchanged deterministic coverage where justified; add remote measurements only for evidence still missing. Do not repeat a complete install/build gate solely to fill a checklist while the unchanged candidate has a known blocking contract failure.

## Required final findings

| # | Area | Evidence classification and outcome |
|---:|---|---|
| 1 | RC2 identity | VALIDATED, fresh staging build/SW/schema headers plus clean local pinned source. Worker IDs are recorded RC2 evidence, not freshly re-listed. |
| 2 | Critical invariants | REGRESSED: universal technical import cap. VALIDATED contradiction: paid quotas/commercial model. Other invariants are not newly certified. |
| 3 | Plan selection | VALIDATED execution record: constitution-first preflight and minimal isolated boundary reproduction; stop at concrete failure / unresolved product policy. |
| 4 | Backend/database | REGRESSED technical boundary: oversized operation persists 151 proposals. No production/staging database mutation in this phase. |
| 5 | Request management | PARTIALLY VALIDATED by existing RC2 deterministic coverage; no new browser request trace or amplification claim after stop. |
| 6 | Exam/session | PARTIALLY VALIDATED by RC2 prior gate/smoke. Final durability/reconnect/scoring matrix remains unexecuted. Paid exam quota enforcement conflicts with policy. |
| 7 | Ready Tests | INSUFFICIENT EVIDENCE for final constitutional certification. Published membership/order vs live content must be explicitly checked; no redesign made. |
| 8 | Realtime/reconnect | PARTIALLY VALIDATED by prior RC2 smoke/local coverage; event-to-visible-state latency and recovery-wave request counts remain unmeasured. |
| 9 | Duplicate detection | PARTIALLY VALIDATED by existing RC2 semantic tests. No fresh Worker CPU/bank-growth benchmark; no claim that semantics or resource use improved. |
| 10 | Imports | REGRESSED server technical cap. Frontend uses bounded serial chunks (STATIC ANALYSIS); this is not a substitute for backend enforcement. Final concurrency/partial-success/retry matrix deferred. |
| 11 | Authorization/cache isolation | PARTIALLY VALIDATED by existing RC2 coverage; no new cross-user exposure found or claimed. The privileged cap bypass is a resource-policy defect, not proof of access-control bypass. |
| 12 | PWA/frontend lifecycle | PARTIALLY VALIDATED by RC2 asset/upgrade smoke and worker harness. No new real-device, controller/cache or lifecycle-storm evidence. |
| 13 | Worker/D1 amplification | INSUFFICIENT EVIDENCE for quantitative totals. Local test confirms excessive permitted operation size; no measured CPU cliff or unexplained remote read/write ratio claimed. |
| 14 | Scaling | RED: missing universal server import work bound. YELLOW: one-operation safety depends on client behavior. Other 2×/5×/10× projections deferred; no fabricated timings. |
| 15 | Operating cost | INSUFFICIENT EVIDENCE for an updated trustworthy RC2 cost estimate. Historical estimates remain provisional; no new CPU, representative operation mix or attributable D1/DO/R2 totals collected. No Free-tier fit or pricing conclusion asserted. |
| 16 | Observability | Endpoint → local database result correlated with non-content counts. Production/staging operation→CPU/logical-query→D1 attribution and browser traces remain gaps. No sensitive payload logging added. |
| 17 | Corrective commits | None. Evidence/reproduction documentation only; no deployed corrective candidate. |
| 18 | Remaining risks | Import-boundary defect, undefined subscription-policy reconciliation, incomplete final system/device/telemetry matrix. Passing old tests cannot override these. |
| 19 | Phase 12 | After policy approval: reconcile commercial model/migration semantics; enforce server work bounds independently of privileges; assess account-scoped concurrency; complete targeted telemetry and measured scaling work. Larger architecture changes remain out of this stopped validation. |
| 20 | Release decision | PHASE 11 NO-GO. Neither controlled production rollout review nor production deployment is certified by this report. |

## Required decision, options and trade-offs

The stop originates in the supplied constitution, especially section 87: “DO NOT silently violate the constitution” and “and request approval.” The user’s Phase 11 instruction also says to stop when a required product decision is ambiguous. No skill or automatic approval rejection caused this stop.

1. **Bring the release into conformity.** Approve a universal server-side 150-question operation ceiling, while retaining unlimited total Superadmin uploads through sequential chunks. Update the contradictory test and verify 150 accepted / 151 rejected, partial success and retry behavior. Separately define adoption/grandfathering of Full Access pricing/periods and quota removal before altering subscriptions. The import correction is focused; commercial reconciliation may require Phase 12 and a new clean candidate.
2. **Amend the constitution to preserve the current model.** Explicitly define any Superadmin technical exemption and its bounded alternative, and the retained legacy tiers/periods/monthly quotas or grandfathering. This preserves current product behavior but requires a defensible server resource budget; unlimited administrator operation size should not be approved solely because the UI chunks uploads.

No amendment is applied here. Recommended direction: retain unlimited *total* administrative uploads while enforcing a role-independent *operation* safety ceiling, then resolve the paid-plan contract explicitly. Await that decision before changing code or resuming the final matrix.
