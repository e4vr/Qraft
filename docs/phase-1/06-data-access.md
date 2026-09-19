# Data Access and Persistence Boundaries

## Server persistence

No database schema, migration, D1 statement semantics, R2 key, Durable Object identity, or deletion cascade was changed.

- D1 repositories and transactional statements remain in their audited modules.
- `qbank-access-repository.ts` remains the read boundary for QBank-scoped authorization context.
- `question-id-repository.ts` remains the atomic identity allocator.
- `storage-service.ts` remains the R2 accounting and quota boundary.
- Generic collaborative records remain validated and written by the existing collaboration implementation.

## Client persistence

No IndexedDB schema or local-storage key changed.

- `local-db.ts` remains the durable browser adapter.
- `features/state/client/state-sync-client.ts` owns the personal-state outbox and revision protocol.
- `features/collaboration/client/collaboration-client.ts` computes the same record-level collaboration change set.
- The personal/collaborative state split remains unchanged.

## Data invariants preserved

- Existing question IDs and retired-ID behavior.
- Existing QBank ownership, membership roles, visibility, and share tokens.
- Existing personal-state revision and operation idempotency.
- Existing flashcard privacy and deck/card constraints.
- Existing subscription, reward, and override precedence.
- Existing media hashing, deduplication, provider, and cleanup markers.

## Deferred data work

Optimization of D1 query shapes, collaboration batching, and client sync frequency is `DEFERRED_TO_PHASE_2`. Orphan prevention, audit-event authority, private-note first-write enforcement, and replay hardening are `SECURITY — DEFERRED TO PHASE_3` because they change validation or data policy.
