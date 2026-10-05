# Database schema ownership

Numbered SQL migrations in `drizzle/` are the authoritative D1 history. Apply them in order through the existing migration commands. Do not rewrite old migrations or generate a replacement database from `db/schema.ts`.

`db/schema.ts` describes all ordinary tables, columns, foreign keys and query indexes. `npm run db:check` builds the complete SQL history and the declaration in two disposable SQLite databases, then compares them. The same check runs as part of `npm test`. It never reads a local, staging or production application database.

FTS5 virtual tables, their internal tables, business triggers and SQL-only checks remain owned by reviewed SQL. `db/sql-managed-objects.json` inventories the virtual table and current trigger names. Existing behavioral database/API tests verify their effects; the schema comparison does not prove every trigger or check's behavior.

SQLite-generated names for UNIQUE constraints and duplicate equivalent UNIQUE indexes are compared by semantics. Column order is not treated as a contract. Boolean defaults are normalized to 0/1. Drizzle requires NOT NULL on primary-key declarations while some historical SQLite tables omit that spelling: the comparison accepts this documented difference and does not rebuild those tables. Code must continue supplying real primary keys. Index columns, direction, collation, predicates and expressions are checked.

The historical `drizzle/meta` journal/snapshots stop at 0004. They are retained as historical artifacts, not a usable generation baseline. `npm run db:generate` deliberately refuses automatic generation instead of proposing destructive changes against that old baseline. Restoring automatic generation requires a separately reviewed baseline that includes SQL-owned objects; updating journal entries alone is insufficient. The installed drizzle-kit version also emits broken SQL for comma-containing expression indexes, so the comparison reconstructs index DDL from its structured snapshot in memory only.

For a database change: add the next numbered SQL migration, update the declaration and any SQL-owned object inventory, add behavior tests, run `npm run db:check`, both Python migration suites, the migration splitter, API tests and a local build. Review and back up the target database before the separate release/migration operation.

## 0036 account-bound discounts

`0036_account_bound_discounts.sql` adds a nullable account UID to discount codes. Existing promotions keep their prices, limits, usage and unrestricted audience. The `redeem_discount_account` trigger validates the account inside the manual confirmation transaction, alongside the existing price and usage trigger. Failed ownership checks roll back access grants, payment records and discount consumption together. Apply this additive migration before releasing the matching administration UI and API.

## 0029 collaboration assertion

`0029_collaboration_write_guard.sql` adds one empty assertion table. A save inserts a row only if all targeted stored payloads still match the versions read during authorization; the same atomic D1 batch mutates records, writes audit entries and removes the assertion. Failure rolls back everything and returns a conflict. Answer-selection patches retain the existing atomic per-user merge and do not need this assertion.

The current client sends a SHA-256 fingerprint of each editable record's base rather than a second copy of its content. A stale base is rejected, the existing recovery flow preserves the complete draft, and unrelated banks can still synchronize. Legacy shared-note version checks remain accepted and are protected by the transaction assertion. Legacy clients without a base may create records or replay identical writes, but must refresh before replacing/deleting existing records; their rejected drafts are preserved. Share links are derived from the parent bank operation and remain in its protected transaction.

Apply 0029 to the target database before releasing the updated application. This implementation task only applies migrations to disposable test databases and does not deploy or migrate a live environment.

D1 atomic batch behavior: [Cloudflare D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Migration ownership: [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/).

## 0030 indexed question deletion

`0030_index_question_deletion.sql` indexes the JSON question and audit references used by `question_identity_delete`, legacy share-link bank references, and question-ID reservations by bank. Previously each deleted shared question scanned unrelated answer statistics, notes, proposals and audit history. A local Miniflare fixture with 600 deleted questions and 6,000 unrelated history records consumed 3,609,823 D1 rows read before the change and 8,405 afterward. These are synthetic local measurements, not a replay of the production incident; the fixture excludes personal states, tickets and media.

Bank cleanup uses separate indexed deletions for bank-scoped records, the bank itself and legacy share links. They remain in the same atomic D1 batch with authorization, the tombstone, ID release and audit entry. Existing question retirement and personal-state cleanup triggers remain unchanged. `tests/qbank-deletion-cost.test.mjs` verifies a read budget and related-record cleanup with 100 deleted questions and 6,000 unrelated records; the lifecycle API tests cover rollback and authorization.

Apply 0030 before releasing the updated application. No production migration or deployment is performed by this implementation. This change does not replenish an exhausted daily D1 quota, and the investigation has not established equivalent amplification from creating an empty bank.

## 0031 collaboration journal and 0032 import integrity

`0031_collaboration_change_journal.sql` tracks record/profile mutations with SQL triggers in the writer's transaction. Its integer primary key supports bounded cursor reads; unused secondary indexes are absent to avoid unnecessary writes. Read the watermark before records. Check retention in the same batch as the change window. Unknown scopes, expired cursors, global permissions changes and windows exceeding 2,000 entries fall back to the authorized full snapshot. Stable, fully observed catalog changes can reset only the affected bank. Persist confirmed client state and cursor together, separately from drafts. Daily cleanup retains at least the latest 50,000 entries and never resets `sqlite_sequence`.

`0032_import_search_integrity.sql` adds bank-scoped stem/content keys, a corpus revision and an empty assertion table. SQL invalidates keys after identity/status/bank edits and deletion for every writer; metadata-only edits preserve keys but advance the search revision. Supported writers populate keys in their record transaction. Missing legacy keys retain FTS fallback. Administrative backfill verifies the source payload before inserting a key and never edits a question. The global revision covers BM25 statistics across banks. Bounded per-account Worker cache reuse requires an identical revision. Import saves assert it within the atomic batch and roll back on conflict, including skip-only batches.

Apply 0030–0032 before releasing the application. Deploy the realtime Worker first; legacy socket attachments retain their previous invalidations. The new objects are additive and owned by migrations/schema inventory. The old application remains compatible for code rollback. The implementation report records final local measurements including increased writes; the earlier 0030-only figure above remains an intermediate result. No live migration or deployment was performed.

## 0033 occupied bank classifications

`0033_remove_empty_classifications.sql` removes existing specialties/topics without published bank questions and advances affected classification revisions. It preserves proposal payloads, questions, progress and history. Existing journal triggers record the removals. This data migration adds no schema objects.

Content writers append `classificationCleanupStatements` to their atomic D1 batch, after all question changes. The helper restores missing IDs/names when proposals are published, preserves occupied classifications and their metadata, then removes empty classifications within each affected bank. Replaying unchanged cleanup does not advance revisions. Legacy questions without IDs resolve by their specialty/topic names. Pending proposals keep their classification in their payload and do not create visible bank classifications. Draft editor entries can remain empty until save; empty saved entries are removed.

Publication resolves older proposal IDs against the current bank structure and shares identities across the published batch, preventing new duplicate classifications after cleanup. Content restores finish all chunks before cleanup, preserving classification metadata and ordering that may precede questions in the backup. Text-only direct question edits and pending JSON imports do not scan bank classification for cleanup because they cannot remove published classification membership.

Bank selectors and Progress also derive visible classification from published questions, so the originating browser immediately removes a classification after its last question leaves. Unedited classification editors adopt remote cleanup; actual unsaved drafts remain protected. Apply 0033 to the target database as part of the separate release operation; implementation tests use disposable databases only.
