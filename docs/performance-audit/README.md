# Qraft performance audit

Status: **Phases 0-10 complete on the audit branch; not deployed**.

This directory records the production performance, reliability, and cost investigation requested for Qraft. Phases 0-9 established the read-only baseline. Phase 10 implemented the approved query, request, reconnect, CPU, and idempotency changes in separate commits and recorded their evidence without deploying them.

## Documents

- [Baseline](./baseline.md) — architecture, routes, runtime mechanisms, production metrics, build and test baseline.
- [Request traces](./request-traces.md) — major UI-to-D1 flows and frontend network classifications.
- [D1 query analysis](./d1-query-analysis.md) — production query plans, read and write amplification, and index decisions.
- [Measurement plan](./measurement-plan.md) — instrumentation, representative journeys, and acceptance thresholds for a before/after comparison.
- [Cost model](./cost-model.md) — present usage, Cloudflare allowance comparison, and scenario estimates.
- [First-pass report](./first-pass-report.md) — ranked root causes and the proposed Phase 10 implementation queue.
- [Request policy](./request-policy.md) — allowed request reasons, cache scope, invalidation, retry, cancellation and reconnect rules.
- [Data lifecycle](./data-lifecycle.md) — resource ownership, authority, freshness and navigation behavior.
- [Phase 10 results](./results.md) — implemented changes, before/after evidence, validation and remaining risks.
- [Phase 11 validation](./phase-11-validation.md) — pinned-build gate, canary feasibility, evidence classifications and rerun procedure.
- [Phase 11 rollout readiness](./phase-11-rollout-readiness.md) — NO-GO decision, blockers, rollback requirements and monitoring gates.

## Guardrails and outcome

- No implementation code or schema was changed during Phases 0-9.
- No write was issued to production D1. Production probes were `SELECT` and `EXPLAIN QUERY PLAN` only.
- Production probing stopped when D1 reported that the Free daily row-read allowance had been exhausted.
- Phase 10 made no schema change, production write, runtime configuration change or deployment.
- Every Phase 10 wave passed tests, TypeScript, lint and a production build; the final suite has 129 passing tests.
- The checked-out source has extensive pre-existing uncommitted work. Every future measurement must pin the deployed commit and D1 schema version because the working tree may not equal production.

## Next decision gate

Review and approve the Phase 10 branch before any staging, canary or production rollout. Deeper write-model, payload-slicing, delta-sync, schema and audit-semantics changes remain separate decisions.

Phase 11 found that the current candidate is not reproducible from a clean checkout and that no isolated staging environment is configured. The rollout decision is **NO-GO** until the blockers in the rollout-readiness document are closed.
