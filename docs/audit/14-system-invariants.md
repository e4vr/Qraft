# Current system invariants

## Verified current behavior

These behaviors are supported by code plus the passing audit test suite and must survive refactoring:

1. Existing question IDs remain stable; IDs are atomically reserved and released only through the hard-deletion path.
2. The 217 seeded General Surgery questions retain their keyed IDs, display IDs, source ordering and answer consistency.
3. A session token is stored only as a SHA-256 hash server-side; the browser receives a secure host cookie.
4. Suspended, rejected, pending, expired-session and unverified-superadmin sessions cannot use approved-user APIs.
5. A singleton superadmin is bootstrapped only with root email/setup proof, and enrolled superadmin login requires TOTP verification.
6. Platform roles do not change the subscription plan.
7. Explicit superadmin plan override wins over other entitlements, including a downgrade to Free.
8. Paid checkout coordination does not activate a plan; 100%-discount redemption is atomic/idempotent and can activate one year.
9. Expired subscriptions fall back to remaining/base entitlement and are audited by scheduled expiry.
10. Free exam allowance is lifetime-based; Lite/Pro/Unlimited limits are enforced server-side, with D1 trigger protection for registry writes.
11. QBank owners retain ownership; only owner/root manages membership/share/deletion, while editor scope excludes those controls.
12. Essential QBank management remains superadmin-only; ordinary changes use proposals/review.
13. Collaboration reads return only accessible QBanks and role-appropriate member fields.
14. Every protected question change carries durable attribution/review history; high-risk corrections require independent review as tested.
15. Bulk review is capped and atomic.
16. Flashcards are private personal state, with deck deletion cascading through child decks/cards/schedules/log while preserving other banks.
17. Exam answers and navigation are saved locally immediately and checkpointed to the server when allowed.
18. Live channels are authenticated, read-only from the client, and distribute invalidations rather than authoritative application data.
19. Preformed submissions are idempotent, version-scoped and ranked atomically; content edits reset relevant result data.
20. Account deletion is atomic for database data, preserves/anonymizes shared/public history, and schedules/attempts media cleanup.
21. API responses are not service-worker cached.
22. Mobile widths use a bottom navigation/drawer; desktop at 1024px and above uses the persistent sidebar.
23. Shared notes auto-open after grading on desktop only, according to existing characterization tests.

## Expected/intended behavior inferred from code/comments

The following are not fully runtime-verified and should be preserved provisionally until product confirmation:

- Offline personal-state outbox eventually restores all personal changes after connectivity returns.
- Private QBank share codes are intentionally “possession grants” even when the catalog hides the bank.
- Theme is intentionally a per-device local preference while cloud state stores `system`.
- Manual WhatsApp payment coordination is the intended production purchase flow.
- R2 question backup retention and size limits are correctly enforced in the deployed scheduled environment.
- Hidden-tab realtime invalidations are safely refreshed on the next relevant account/resource read.

