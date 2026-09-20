# Unresolved and Unverified Items

| ID | Severity | Origin | Status | Reason / next action |
| --- | --- | --- | --- | --- |
| P2-U01 | LOGIC-HIGH | PRE-EXISTING | PARTIAL | Independent same-account edits to whole personal-state collections can use newest-snapshot wins. A product conflict/tombstone model is required before changing semantics. |
| P2-U02 | LOGIC-HIGH | PRE-EXISTING | PARTIAL | R2 object deletion and D1 QBank deletion cannot be one atomic transaction. Design a deletion job/outbox with retry and orphan reconciliation. |
| P2-U03 | LOGIC-MEDIUM | PRE-EXISTING | NOT VERIFIED | Standard preview is blocked by compatibility-date drift. Align package/runtime in a tooling-only change. |
| P2-U04 | LOGIC-MEDIUM | UNKNOWN ORIGIN | NOT VERIFIED | Physical iPhone/iPad/Android multi-device and background/eviction behavior was unavailable. Execute the Phase 5 device matrix. |

## Additional product/operations boundaries

- Positive-price purchase remains manual WhatsApp coordination; refund/renewal reconciliation is external and unverified.
- Existing production data cardinality and integrity were not inspected.
- Generic taxonomy relationships still rely primarily on server application checks rather than relational foreign keys.
- The collaboration outbox preserves and retries authorized operations; a user-visible conflict-resolution policy for irreconcilable simultaneous edits remains undefined.
