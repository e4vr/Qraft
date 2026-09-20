# Edge Cases and Final Logic Matrix

| Domain | Normal flow | Edge cases | Concurrency | Multi-role | Result |
| --- | --- | --- | --- | --- | --- |
| Account/session | login/return/logout/delete | pending, suspended, MFA, deletion rollback | session invalidation | user/access/root | PASS |
| QBank | create/share/join/manage/delete | private, invalid link, duplicate member, cascade | deterministic join, atomic D1 delete | owner/editor/reviewer/viewer | FIXED |
| Questions/import | reserve/submit/review/publish/delete | malformed/duplicate/import retry/deleted refs | allocator + idempotent import | author/reviewer/root | PASS |
| Exam | create/answer/checkpoint/finish/review | duplicate IDs, invalid stats, deleted questions | revisions/operation IDs | Free/Lite/Pro/Unlimited | FIXED |
| Flashcards | create/study/rate/delete | missing parent, cycles, malformed schedule | state revision | Lite denied; Pro allowed | FIXED |
| Review | queue/decision/credit/history | stale/duplicate/high-risk/two reviewers | status predicates + batch | bank/platform reviewer | PASS |
| Plans | upgrade/override/reward/expiry | exact limits, downgrade, fallback | trigger/batch | learner/root | PASS |
| Coupon | create/quote/redeem | dates, exhaustion, per-user, repeat | trigger + request ID | learner/root | FIXED |
| Preformed | create/publish/open/submit/rank | repeat ID, reused token, version reset | unique token claim | owner/participant/root | FIXED |
| Local-first | offline edit/reconnect | startup failure, newer remote, deletion | outbox + three-way merge | account-scoped | PARTIAL |
| Search/pagination | filters/pages/counts | empty, combined, >50 rows | stable tie-break IDs | scoped admin/user | PASS |
| Physical multi-device | synchronized state | iOS/iPad eviction/background | not executed | persona matrix | NOT VERIFIED |

No NaN/Infinity path was found in server-stored percentage calculations; ready-made results explicitly return 0% for zero questions, while test creation requires content before normal publication/submission paths.
