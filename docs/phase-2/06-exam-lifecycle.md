# Exam and Local-First Lifecycle Audit

## Flow

Builder → authorized pool → server usage registration → active local session → answer/navigation/mark/note → checkpoint → completion → results/history/review.

## Persistence classes

| State | Class | Persistence |
| --- | --- | --- |
| Answer/navigation/mark | local immediately, server checkpoint | React + IndexedDB + revisioned state |
| Private note | local immediately, server plan-gated | personal state |
| Answer distribution | server synchronized | collaboration record/checkpoint operation |
| Theme | local only | localStorage |
| Daily goal | server synchronized | personal state checkpoint |

## Phase 2 repairs

- Duplicate session IDs and duplicate question references are rejected.
- An invalid answer-statistics payload is validated before the personal checkpoint write, eliminating a response-failed/state-succeeded partial outcome.
- First-state private-note enforcement now compares against an empty prior state.

## Result/statistic boundaries

Existing calculation paths cover empty/unanswered, correct/incorrect, history, elapsed time and deleted-question cleanup. Test creation limits are enforced against `test_registry`, not merely the client list. Whole-snapshot multi-device merging remains the explicit P2-U01 limitation.
