# Question Lifecycle Audit

## Verified flow

1. Reviewer-authorized reservation allocates a unique display ID.
2. New content or an edit enters a pending proposal with source and classification data.
3. Review validates author independence and, for high-risk corrections, two independent reviewers.
4. Approval publishes exactly the reviewed payload and records attribution/history.
5. Hard deletion retires the UUID, releases the numeric display ID through the intended pool, removes answer/note records, and rewrites historical references to `#deleted` where defined.

## Integrity boundaries

- `question_ids`, allocator/free-pool, registry and retired tables are server/trigger-owned.
- Imported candidates use file/content identities and operation records to prevent accidental duplicates.
- Bulk review is limited to 200 and applied in one D1 batch.
- Topic/specialty classification updates use a revision and operation ID.

## Results

- ID uniqueness, concurrent allocation, import retry, question deletion, ticket survival, review payload matching and high-risk review all pass.
- Historical reports/tickets retain interpretable references after deletion.
- No Phase 2 question-identity migration was required.
