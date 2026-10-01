# Database schema ownership

Numbered SQL migrations in `drizzle/` are the authoritative D1 history. Apply them in order through the existing migration commands. Do not rewrite old migrations or generate a replacement database from `db/schema.ts`.

`db/schema.ts` describes all ordinary tables, columns, foreign keys and query indexes. `npm run db:check` builds the complete SQL history and the declaration in two disposable SQLite databases, then compares them. The same check runs as part of `npm test`. It never reads a local, staging or production application database.

FTS5 virtual tables, their internal tables, business triggers and SQL-only checks remain owned by reviewed SQL. `db/sql-managed-objects.json` inventories the virtual table and current trigger names. Existing behavioral database/API tests verify their effects; the schema comparison does not prove every trigger or check's behavior.

SQLite-generated names for UNIQUE constraints and duplicate equivalent UNIQUE indexes are compared by semantics. Column order is not treated as a contract. Boolean defaults are normalized to 0/1. Drizzle requires NOT NULL on primary-key declarations while some historical SQLite tables omit that spelling: the comparison accepts this documented difference and does not rebuild those tables. Code must continue supplying real primary keys. Index columns, direction, collation, predicates and expressions are checked.

The historical `drizzle/meta` journal/snapshots stop at 0004. They are retained as historical artifacts, not a usable generation baseline. `npm run db:generate` deliberately refuses automatic generation instead of proposing destructive changes against that old baseline. Restoring automatic generation requires a separately reviewed baseline that includes SQL-owned objects; updating journal entries alone is insufficient. The installed drizzle-kit version also emits broken SQL for comma-containing expression indexes, so the comparison reconstructs index DDL from its structured snapshot in memory only.

For a database change: add the next numbered SQL migration, update the declaration and any SQL-owned object inventory, add behavior tests, run `npm run db:check`, both Python migration suites, the migration splitter, API tests and a local build. Review and back up the target database before the separate release/migration operation.

## 0029 collaboration assertion

`0029_collaboration_write_guard.sql` adds one empty assertion table. A save inserts a row only if all targeted stored payloads still match the versions read during authorization; the same atomic D1 batch mutates records, writes audit entries and removes the assertion. Failure rolls back everything and returns a conflict. Answer-selection patches retain the existing atomic per-user merge and do not need this assertion.

The current client sends a SHA-256 fingerprint of each editable record's base rather than a second copy of its content. A stale base is rejected, the existing recovery flow preserves the complete draft, and unrelated banks can still synchronize. Legacy shared-note version checks remain accepted and are protected by the transaction assertion. Legacy clients without a base may create records or replay identical writes, but must refresh before replacing/deleting existing records; their rejected drafts are preserved. Share links are derived from the parent bank operation and remain in its protected transaction.

Apply 0029 to the target database before releasing the updated application. This implementation task only applies migrations to disposable test databases and does not deploy or migrate a live environment.

D1 atomic batch behavior: [Cloudflare D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Migration ownership: [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/).
