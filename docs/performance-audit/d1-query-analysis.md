# Phases 3–4: D1 read and write analysis

## Executive finding

The primary confirmed read amplifier is the collaboration snapshot. Its two main `records` queries use SQL shapes that make production D1 scan all 5,663 records twice. A representative one-bank load therefore reads 11,326 rows to return 1,101 records and parses at least 728,470 bytes of JSON before response shaping.

The same logical rows can be selected with existing indexes in about 1,142 D1 row reads, an **89.9% reduction for this endpoint query pair**. No new index is required.

The primary confirmed write amplifier is exam checkpointing. Each changed answer selection upserts a polymorphic `records` row and creates a separate audit row. Because D1 bills affected table and index rows, a local Miniflare/D1 probe measured 1,200 rows written for 100 answer-stat upserts plus their 100 audits: about **12 billed row writes per changed answer**, before personal-state synchronization writes.

## Method and safety

- Production work was limited to `SELECT`, aggregate payload length, and `EXPLAIN QUERY PLAN`.
- No production table, schema or data was modified.
- Production plans were captured against 5,663 `records` rows in WEUR/AMS.
- Proposed plans were executed as read-only alternatives using indexes that already exist.
- A local SQLite database with all migrations and 17,234 synthetic records provided broader plan inspection.
- A local D1/Miniflare probe measured billed `rows_written` for the exact generic record/audit shape.
- Probing stopped when Cloudflare returned the Free daily D1 row-read-limit error.

Cloudflare documents that a plan showing `SCAN` reads every row in the scanned table/index while `SEARCH ... USING INDEX` narrows the work. It also documents that `ORDER BY RANDOM()` becomes expensive as a table grows. See [D1 index best practices](https://developers.cloudflare.com/d1/best-practices/use-indexes/) and [D1 metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/).

## Production collaboration evidence

### Catalog query

Current source (`lib/cloudflare-server.ts:1319-1325`):

```sql
SELECT type,id,payload
FROM records
WHERE type IN ('qbanks','qbankFolders','qbankMemberships');
```

Production plan:

```text
SCAN records
```

Observed single probe:

- 5,663 rows read;
- 11 rows returned;
- 3,155 payload bytes;
- 43.47 ms reported query duration.

Existing-index form:

```sql
SELECT type,id,payload
FROM records INDEXED BY idx_records_type_id
WHERE type IN ('qbanks','qbankFolders','qbankMemberships');
```

Observed result: the same 11 rows and 3,155 bytes, 17 rows read, 0.754 ms in that single probe.

### Scoped collaboration query

Current source (`lib/cloudflare-server.ts:1333-1346`) builds:

```sql
SELECT type,id,payload
FROM records
WHERE (qbank_id IS NULL OR qbank_id IN ('smle-gs'))
  AND type IN (...eleven requested types...);
```

Production plan:

```text
SCAN records
```

Observed single probe:

- 5,663 rows read;
- 1,090 rows returned;
- 725,315 payload bytes;
- 5.21 ms reported query duration.

The `OR` between `qbank_id IS NULL` and scoped ids prevents the existing `(qbank_id,type)` index from giving the desired plan. Split it into two index-forced branches and preserve set semantics:

```sql
SELECT type,id,payload
FROM records INDEXED BY idx_records_qbank_type
WHERE qbank_id IN ('smle-gs') AND type IN (...)
UNION ALL
SELECT type,id,payload
FROM records INDEXED BY idx_records_qbank_type
WHERE qbank_id IS NULL AND type IN (...);
```

Observed result: the same 1,090 rows and 725,315 bytes, 1,125 rows read, 1.878 ms in that single probe.

### Combined impact

| Measure | Current | Existing-index rewrite | Difference |
|---|---:|---:|---:|
| D1 rows read | 11,326 | 1,142 | -10,184 (-89.9%) |
| Rows returned | 1,101 | 1,101 | unchanged |
| Raw payload bytes | 728,470 | 728,470 | unchanged |
| Sum of single-run SQL durations | 48.68 ms | 2.63 ms | illustrative only |

The timing comparison is not a repeated latency benchmark. The row counts and identical result cardinality are the reliable findings.

## Query inventory and recommendations

| Query family | Frequency | Purpose | Current plan/evidence | Problem | Recommendation | Expected impact |
|---|---|---|---|---|---|---|
| Collaboration catalog | Each cold/stale collaboration load | Discover banks, folders and memberships | Production `SCAN records`; 5,663 read/11 returned | Full table scan for three types | Force existing `idx_records_type_id` or equivalent plan-safe shape | 99.7% fewer rows for this statement in measured snapshot |
| Scoped collaboration | Each cold/stale collaboration load | Load authorized bank/global collaboration state | Production `SCAN records`; 5,663 read/1,090 returned | `OR` scope defeats useful index | `UNION ALL` bank-specific and `IS NULL` branches using existing `idx_records_qbank_type` | 80.1% fewer rows for this statement |
| Invitation by email | Collaboration load | Add invited banks | `idx_records_type_email` explicitly selected | Appropriate point lookup | Keep | No change |
| Classification revisions by bank ids | Collaboration load | Validate client classification cache | Primary/indexed ids via `json_each` | Bounded by accessible banks | Keep; capture meta | Low priority |
| Records by `(type,id)` keys | Mutation authorization and details | Load exact affected records | Existing unique index; tests enforce explicit use | Efficient | Keep | None |
| Bank access state | API and WebSocket bank authorization | Load bank/membership records | Existing index-forced paths | Repeated once per bank socket connection | Keep correctness; measure socket-auth query count before consolidation | Request-count opportunity, not scan root cause |
| Session/profile and entitlements | Every protected request | Authenticate and enforce plan/roles | Indexed lookups; approximately session/profile plus entitlement batch | Query/round-trip count, not high row count | Measure, then consider one entitlement SQL statement | Modest latency/subrequest reduction |
| Answer stats by ids | Exam checkpoint | Merge user selections | `type='answerStats' AND id IN json_each(?)`, compatible with `(type,id)` | Reads existing payloads and rewrites shared JSON record | Keep until write-model decision; capture rows read/written | Correctness-sensitive |
| Ticket-deletion audit recovery | Contact deletion notification edge case | Recover deleted ticket owner | Production read 2,832 rows and returned none; JSON expression filters + sort | Scans nearly all audit entries for rare edge path | Measure frequency; later add dedicated structured owner reference or narrowly justified expression index | Avoid blind index/write overhead |
| Random shared questions | Test selection path | Pick bounded random sample | Production 1,107 rows read for 10 from 1,124 questions; 0.36 ms single run | `ORDER BY random()` is O(eligible pool) | Keep at current size; benchmark 5k/50k and replace only at threshold | Not today's primary issue |
| Test-pool eligibility CTE | Exam creation | Apply bank/topic/specialty/history constraints | JSON functions, classification lookups, random order; 500-question scale test suite path is slow | Possible SQL + Worker CPU at scale; suite timing includes setup/multiple calls | Capture D1 meta and route CPU by fixture; optimize concrete stage only | Uncertain until route trace |
| Reviewer monthly performance | Admin reporting | Aggregate reviews for time window | `(reviewer_id,created_at)` is not ideal for created-at-first global range | Potential growing scan | Add `(created_at,reviewer_id)` only if measured admin frequency/table size justifies write cost | Deferred |
| Pending proposal by owner/update | Review/contribution pages | List pending work | Specialized partial/index expression exists | Appropriate | Keep | None |
| Leading-wildcard profile/contact search | Admin/support search | User-entered substring search | `%term%` cannot use a normal prefix index | Scan scales with profiles/tickets | Current cardinality is small; retain debounce and add pagination/FTS only with growth evidence | Low current impact |
| Question backup pagination | Daily/on-demand backup | Stream pages of question records | Type/id ordered pages | Bounded and scheduled | Keep; measure CPU/compression/R2 separately | Low query concern |

## JavaScript filtering after D1

`loadCollaboration` parses all returned record payloads into a complete state and then filters memberships, invitations, proposals, questions, classifications, answer stats and notes by authorized bank sets (`lib/cloudflare-server.ts:1770-1842`). The D1 rewrite removes unrelated `records` rows but still returns a roughly 725 KB one-bank payload in the observed snapshot. A later response-slicing proposal may reduce Worker JSON work, but it changes data contracts and should follow the safe query rewrite and route profiling.

## Index decision record

### Use existing indexes first

- `idx_records_type_id (type,id)` covers the catalog type predicate.
- `idx_records_qbank_type (qbank_id,type)` covers each half of the scoped query.
- This has no migration, storage increase, backfill, or extra write amplification.

### Do not add these yet

- **Audit JSON expression index:** one rare query is expensive, but every audit mutation would pay the additional index write. Instrument frequency first; structured columns may be cleaner if the path is material.
- **Reviewer `(created_at,reviewer_id)`:** potentially useful for global monthly aggregation, but unproven at current scale.
- **Leading-wildcard search index:** a normal B-tree cannot solve `%term%`; adding one would add cost without changing the plan.
- **Random-selection index:** no B-tree removes `ORDER BY random()` sorting. Sampling design, not another index, is required if this grows.

## Write path inventory

| Source | D1 writes per action | Existing protection | Finding |
|---|---|---|---|
| Personal state save/checkpoint | `test_registry` insert-ignore, `app_states` upsert, `state_sync_operations` insert | full-state equality no-op, revision conflict and operation-id idempotency | Rewrites a potentially large JSON row; not the dominant row-count explanation by itself |
| Exam answer stats | one generic record upsert per changed question, batched in one SQL statement | collaboration state comparison filters unchanged operations | High index/audit multiplication |
| Collaboration audit | one `auditLog` record for every non-audit operation | only emitted for operations that survive no-op filtering | Doubles logical records and their index maintenance; required semantics need owner decision |
| JSON import | proposal/duplicate/reward bookkeeping plus audit per proposal | attempt/idempotency controls and batches | Large imports can create many indexed rows and audits |
| Bulk review | proposal updates, published question/review/ledger/reward/audit writes | transactional batches/claims | Expected high writes; profile batch sizes |
| R2 media read accounting | D1 usage counter update on each object read | intentional quota enforcement | Read request causes a write by design; low likely volume at current invocation count |
| Auth/session/profile | session/profile lifecycle writes | scoped to explicit auth/account actions | Expected |
| Cleanup cron | deletes expired operation rows/media metadata/subscriptions | scheduled daily | Necessary housekeeping; capture rows written in cron telemetry |

No general GET endpoint that mutates collaboration or personal state was found. The R2 usage counter is the explicit read-side exception.

## Measured write amplification

`saveStatePatch` reads existing answer-stat payloads, creates one collaboration operation per selection (`lib/cloudflare-server.ts:1215-1289`), and calls `saveCollaboration`. That function adds one generic-record upsert and one audit statement per operation (`lib/cloudflare-server.ts:2812-2837`).

Local D1 billing metadata for 100 changed answers:

| Work | Billed rows written |
|---|---:|
| 100 `answerStats` upserts | 600 |
| 100 per-answer audit inserts | 600 |
| One isolated audit insert | 6 |
| Combined | 1,200 |

The approximate six rows per generic record reflect the table row plus maintained indexes. The exact count can change with schema/indexes and conflict behavior; the measured local schema is the relevant baseline.

## Write proposals requiring a separate decision

These are estimates for 100 changed answers and exclude state-sync writes:

| Option | Estimated billed rows | Reduction from measured 1,200 | Tradeoff |
|---|---:|---:|---|
| Preserve current model | 1,200 | 0% | Existing per-answer audit granularity |
| One checkpoint audit instead of 100 answer audits | about 606 | about 49.5% | Changes audit granularity; product/security approval required |
| Omit audit for answer statistics only | about 600 | about 50% | Explicit audit-policy exception |
| Normalize user answer selections plus checkpoint audit | about 206 | about 82.8% | Migration/backfill and new read model; architectural follow-up |

No write proposal belongs in the first safe query-fix group. The expected daily 101,000 rows written is plausible with only dozens of large checkpoints/imports because each logical generic record can cost six billed rows and each audit costs another six. Route-level write attribution is still required to determine the actual mix.

## Conclusions

1. Read amplification is proven in the collaboration query, and an existing-index rewrite has a directly measured row-read benefit.
2. Write amplification is structurally explained and locally measured, but the production share by route remains unknown.
3. More indexes are not the immediate answer. The safest high-impact read fix changes SQL shape only.
4. Audit and answer-stat storage changes need an explicit semantics decision plus migration/test design.
