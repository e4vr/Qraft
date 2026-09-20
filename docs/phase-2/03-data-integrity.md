# Data Integrity Audit

## Schema protections

- Relational tables use foreign keys for sessions, app state, preformed tests/results and several economy entities.
- Question identity is guarded by registry/retirement triggers.
- Exam limits, import limits, discount redemption, review completion and state revisions have D1 triggers.
- Generic collaborative records cannot express QBank foreign keys in SQLite; server validation and coordinated cascades remain required.

## Phase 2 changes

- Migration `0020_phase2_logic_integrity.sql` adds a nullable token hash to historical submission receipts and a unique index for all new attempt claims. Existing receipts remain valid.
- Direct QBank deletion now removes all `qbank_id` records, share links, classification revisions and classification operation history in the same D1 batch.
- Membership change sets are validated for unique `(qbankId,userId)` identity.
- App-state writes reject duplicate/cyclic structural identities.

## Read-only checks

`scripts/data-integrity-checks.sql` contains SELECT/PRAGMA-only checks for:

- foreign-key violations;
- QBank, membership, question-identity and taxonomy orphans;
- duplicate memberships and display question IDs;
- negative counters;
- invalid subscription states/dates;
- expired-but-untransitioned subscriptions;
- orphan review completions and ready-made submissions.

The test suite proves the file is read-only and executes every statement against the full local fixture. Final result: **zero contradiction rows**.

## Production caution

Production was not queried or modified. Run the read-only script against a controlled D1 export or approved read replica first. If rows appear, preserve a snapshot, classify each relationship, and use a reviewed one-purpose migration; do not bulk-delete unknown records.
