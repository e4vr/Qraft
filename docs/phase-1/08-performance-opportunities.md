# Performance Opportunities

Phase 1 established measurement and boundaries without changing caching, network timing, query behavior, or write frequency.

## Highest-value opportunities

| Opportunity | Evidence | Dependency | Status |
| --- | --- | --- | --- |
| Split the 702,656-byte application chunk by workspace | Build warning and unchanged main chunk | Browser route/workspace smoke suite | `DEFERRED_TO_PHASE_2` |
| Lazy-load administration, preformed tests, flashcards, and review workspaces | Root component imports all workspaces eagerly | Stable loading/error UX | `DEFERRED_TO_PHASE_2` |
| Reduce root React orchestration | `medguard-app.tsx` remains 6,922 lines | Extract hooks with sync timing tests | `DEFERRED_TO_PHASE_2` |
| Physically split large server implementations | 3,095/1,954/932-line server files | Transaction and authorization characterization tests | `DEFERRED_TO_PHASE_2` |
| Profile D1 and collaboration writes | Phase 0 network/write baseline | Production-like read-only telemetry | `DEFERRED_TO_PHASE_2` |
| Review resource-cache invalidation breadth | Session cache is centralized and tested | Request-count measurement | `DEFERRED_TO_PHASE_2` |
| Resolve local dev compatibility-date lag | Local `workerd` supported 2026-09-07 while config used 2026-09-09 | Toolchain decision/package change | `DEFERRED_TO_PHASE_2` |

## Guardrails

Any optimization must preserve offline-first write durability, state revisions, operation IDs, realtime invalidation, session scoping, permission outcomes, and service-worker behavior. Performance work must compare request counts, writes, client output, and user-visible latency against `docs/audit/21-performance-baseline.md` and `14-performance-comparison.md`.

