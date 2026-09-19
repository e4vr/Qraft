# ADR 001: Domain-oriented boundaries

## Status

Accepted for Phase 1.

## Context

Phase 0 found business rules distributed across framework routes, `lib/cloudflare-server.ts`, `lib/platform-server.ts`, `lib/preformed-test-server.ts`, `lib/medguard-types.ts`, and the root React application. This makes ownership and final authorization decisions difficult to locate.

## Decision

New and migrated code is grouped by capability under `features/`. Framework routes delegate to `server/api`; domain policy stays pure; Cloudflare storage details stay in repositories/adapters. Existing large implementations may remain behind compatibility façades during Phase 1 when a physical move would mix refactoring with behavioral risk.

## Consequences

- Import direction becomes testable and ownership becomes discoverable.
- Incremental façades temporarily add a small amount of indirection.
- A file is not considered migrated until its callers use the feature boundary and the old public surface is no longer needed.

