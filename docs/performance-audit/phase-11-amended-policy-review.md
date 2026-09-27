# Phase 11 amended-policy review

**PHASE 11 NO-GO — pinned RC2 does not yet implement the new backend subscription policy.**

The previous objection based solely on a Superadmin operation exceeding 150 questions is withdrawn. This does not certify the full system matrix or change the pinned release. No implementation, migration, staging deployment or production change occurred.

## Policy revision and user clarification

The complete revised constitution was read. SHA-256: `A79E7C880D1C3FBBCC96556EA38D8BC908055223C8437C811AA1BBD1521B71A0`. Its appended Superadmin rules explicitly permit privileged administrative bulk work and require server authorization, auditability and engineering safety boundaries. The user additionally specified: regular imports ≤150; Superadmin bulk imports >150 allowed through controlled internal batching.

The user clarified that the constitution is the new backend policy, with frontend updates to follow later. Therefore the subscription difference is an implementation gap against the newly approved backend target, rather than an unresolved commercial-policy choice. No repeat request to choose between legacy tiers and the new constitution is required.

## Administrative import evidence

**VALIDATED — LOCAL DETERMINISTIC ENDPOINT TEST:** 151 synthetic questions were submitted through seven sequential chunks `[25,25,25,25,25,25,1]` to pinned RC2's actual authenticated API handler and isolated local D1. All 151 were persisted. Replaying the first request returned HTTP 200 without increasing the proposal count. The import monitor recorded seven completed chunks, 151 successes and zero invalid items.

The run status was `partial` because 150 similar synthetic items were flagged for duplicate review. An initial test expectation of `completed` was corrected after inspecting those counters. No product implementation was changed to make the test pass; duplicate-review classification is intended behavior.

The current frontend contains the corresponding sequential 25-question / 900,000-byte chunking code with upload-session/chunk metadata, progress and retry state. Ordinary Pro/Unlimited caps are 75/150, both within the ordinary ceiling. The earlier local acceptance of 151 in one Superadmin request is no longer itself a constitutional failure.

**PARTIALLY VALIDATED — STATIC ANALYSIS:** the server authenticates authoritative Superadmin role plus MFA, enforces a 2,000,000-byte platform request limit, records import/audit metadata and uses a database batch transaction. Thus it is incorrect to describe RC2 as lacking every server-side bound. However, a D1 batch transaction is not a bounded processing pipeline: a direct administrative request still prepares the entire input/candidate bank in memory and compares incoming items in one synchronous loop. The independent proof of controlled chunks was driven by the application-shaped client workflow; it does not establish server-internal subdivision or CPU/backpressure protection for a direct large request. No resource outage, runaway concurrency or CPU cliff has been measured here. Those remain evidence/design gaps, not inferred incidents.

Reproducer: [administrative chunks](evidence/phase11-administrative-chunks.mjs). Run with pinned RC2 as the working directory and its locked dependencies: `node --test <absolute-path-to-reproducer>`. Output: 1/1 passed. Original 151-rejection reproducer remains historical and is no longer an acceptance test under the amended policy.

## Remaining release blocker

**REGRESSED against the new backend target — STATIC ANALYSIS:** section 51 still specifies Full Access at 100 SAR/month or 230 SAR/3 months without arbitrary paid monthly exam quotas. Pinned RC2 still uses the annual Lite/Pro/Unlimited model and enforces monthly exam ceilings through `/platform/exam-start`. The user's clarification confirms that the constitution is the target backend contract; future frontend changes do not make current backend enforcement conform to that target.

Changing these entitlements/periods requires coordinated backend policy, subscription-record compatibility, enforcement tests and eventual frontend alignment. It is not a small import-limit correction and cannot be silently applied while claiming to validate the pinned SHA. It belongs in a focused policy implementation phase and a new clean candidate, followed by resumed validation. No customer entitlement or persisted subscription was modified.

## Final evidence disposition

The current candidate remains `a957ef47825a6876f1f0bff41b175b8b0c62707b`. The earlier constitutional report is historical; its import-cap rationale and unresolved-policy wording are superseded by this review. Prior RC2 clean gate and staging readiness remain factual, but they do not prove conformity with the new backend policy.

- Import privilege distinction: VALIDATED; administrative total above 150 is intentional.
- Sequential chunk durability/retry/history: VALIDATED locally at 151 questions, not a staging CPU/load benchmark.
- Large direct administrative execution safety: PARTIALLY VALIDATED; request-byte and transaction safeguards exist, server-internal work/CPU/concurrency coverage remains insufficient.
- New backend subscription policy: REGRESSED / not implemented in pinned RC2.
- Remaining request, exam, Ready Test, realtime, device and scaling matrix: unchanged evidence limits from the previous report; not newly executed or certified.
- Cost/observability: insufficient fresh attribution for revised operating-cost numbers; no fabricated estimate.
- Corrective commits: evidence only. No deployed corrective release.

Recommended next implementation scope: adopt the approved backend subscription contract with compatibility tests; define and enforce server-side administrative work batching/budgets while preserving privileged bulk import and audit/retry semantics; produce a new clean release candidate; then execute the remaining smallest sufficient Phase 11 system matrix. Do not roll out pinned RC2 as compliant with the newly approved backend contract.
