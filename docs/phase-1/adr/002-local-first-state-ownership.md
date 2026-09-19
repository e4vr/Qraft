# ADR 002: Preserve local-first state ownership

## Status

Accepted for Phase 1.

## Context

Qraft intentionally keeps exam answers, navigation state, notes, goals, flashcard progress, and collaboration operations in browser persistence before or alongside server synchronization. Changing ownership or timing can cause silent data loss or cross-device conflicts.

## Decision

Phase 1 may extract pure helpers and adapters, but it will not change IndexedDB names, stores, keys, merge rules, queue ordering, retry timing, write frequency, or the distinction between personal and collaborative state. The root composition can delegate; it cannot acquire a new persistence model.

## Consequences

- Client refactors require regression tests at the persistence boundary.
- Performance opportunities that require new batching or conflict resolution are `DEFERRED_TO_PHASE_2`.
- Offline collaboration reliability findings remain documented rather than silently altered.

