# Concurrency, Atomicity and Idempotency

| Workflow | Mechanism | Result |
| --- | --- | --- |
| Question ID allocation | D1 allocator/free-pool transaction + unique indexes | PASS |
| Personal sync | revision + operation ID + D1 conflict trigger | PASS |
| Collaboration offline replay | IndexedDB coalesced snapshot outbox + server reauthorization | FIXED |
| QBank join | deterministic membership ID/upsert | PASS |
| Membership update | unique bank/user change-set validation | FIXED |
| Direct QBank delete | single D1 batch cascade | FIXED |
| Coupon redemption | event request ID + D1 triggers/batch | PASS |
| Reward redemption | request ID + balance trigger/batch | PASS |
| Review decision | pending predicate + unique completion/reviewer records + batch | PASS |
| Ready-made submit | submission receipt + unique attempt-token claim | FIXED |
| Exam checkpoint | prevalidation + revisioned state operation | FIXED |

## Multi-tab

Personal state uses a tab lock and BroadcastChannel notifications. Resource reads are single-flight and invalidation-driven. Collaboration outbox coalescing preserves the first server baseline and newest local snapshot, while a flush loop handles an operation queued during an active replay.

## Atomicity limit

D1 batches are atomic within D1. R2 object deletion and D1 record deletion cannot be one transaction; retry/cleanup protocol remains necessary for a fully failure-atomic media cascade.
