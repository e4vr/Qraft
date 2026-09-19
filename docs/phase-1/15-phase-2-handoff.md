# Recommended Input for Phase 2 — Performance and Scale

## Objective

Improve loading, request efficiency, write efficiency, and server scalability using the Phase 1 feature boundaries without changing product behavior.

## Recommended sequence

1. **Restore a reproducible preview runtime.** Align the local workerd/Wrangler capability with the configured compatibility date through an explicit package/tooling decision.
2. **Expand measurement.** Capture workspace-level bundle ownership, Core Web Vitals, request counts, D1 query counts, and writes for login, dashboard, exam, flashcards, collaboration, review, and admin.
3. **Split browser workspaces.** Lazy-load administration, preformed tests, flashcards, review, and management surfaces; preserve loading and error behavior.
4. **Extract root orchestration.** Move auth bootstrap, personal-state sync, collaboration sync, realtime subscription, and navigation into separately tested feature hooks.
5. **Physically decompose server implementations.** Move one feature at a time behind the existing server façades, beginning with auth/session and personal state, then collaboration/media.
6. **Optimize measured hot paths only.** Address proven duplicate reads/writes or broad invalidations while preserving idempotency and authorization.
7. **Repeat the Phase 1 regression/performance matrix.** Reject any change that loses offline writes, changes permission outcomes, or worsens the measured baseline without justification.

## Dependencies

- Code splitting depends on a working preview and route/workspace smoke automation.
- Root hook extraction depends on tests for exact persistence and retry timing.
- Server physical splits depend on characterization tests for transaction boundaries and error responses.
- D1 changes depend on query evidence and belong in isolated migrations with rollback planning.

## Areas to keep untouched initially

- Question ID allocation and retired-ID triggers.
- Account deletion transaction and media cleanup markers.
- Effective-entitlement precedence and reward redemption transactions.
- Collaboration authorization predicates and high-risk two-reviewer workflow.
- Service-worker caching and IndexedDB schema.

## Success criteria

- Lower main application chunk and faster measured workspace startup.
- Fewer duplicate requests/writes on measured workflows.
- No change in 89 Phase 1 tests, API contracts, data invariants, roles, plans, or offline durability.

