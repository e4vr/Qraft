# Qraft performance audit

Status: **first pass complete through Phase 9; Phase 10 has not started**.

This directory records the production performance, reliability, and cost investigation requested for Qraft. The first pass is deliberately read-only with respect to application behavior. It adds documentation only and proposes changes for approval.

## Documents

- [Baseline](./baseline.md) — architecture, routes, runtime mechanisms, production metrics, build and test baseline.
- [Request traces](./request-traces.md) — major UI-to-D1 flows and frontend network classifications.
- [D1 query analysis](./d1-query-analysis.md) — production query plans, read and write amplification, and index decisions.
- [Measurement plan](./measurement-plan.md) — instrumentation, representative journeys, and acceptance thresholds for a before/after comparison.
- [Cost model](./cost-model.md) — present usage, Cloudflare allowance comparison, and scenario estimates.
- [First-pass report](./first-pass-report.md) — ranked root causes and the proposed Phase 10 implementation queue.

## Guardrails

- No implementation code or schema was changed during Phases 0–9.
- No write was issued to production D1. Production probes were `SELECT` and `EXPLAIN QUERY PLAN` only.
- Production probing stopped when D1 reported that the Free daily row-read allowance had been exhausted.
- Project tests and a production build were run for baseline validation only.
- The checked-out source has extensive pre-existing uncommitted work. Every future measurement must pin the deployed commit and D1 schema version because the working tree may not equal production.

## Decision gate

Phase 10 may begin only after approval. The recommended first implementation group is limited to:

1. rewrite the collaboration read using existing indexes;
2. coalesce per-channel reconnect reconciliation into one refresh wave;
3. add route/query resource instrumentation and performance regression tests.

Write-model or audit-semantics changes remain separate decisions because they alter storage or audit granularity.
