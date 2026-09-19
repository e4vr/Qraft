# Known Issues and Deferred Work

## DEFERRED_TO_PHASE_2

- Physically split `cloudflare-server.ts`, `platform-server.ts`, and `preformed-test-server.ts` behind the new feature boundaries.
- Extract root React orchestration into feature hooks/components after adding browser persistence timing tests.
- Add workspace-level lazy loading and measure bundle/request improvements.
- Resolve the local Wrangler/workerd compatibility-date mismatch through an explicit toolchain decision.
- Expand browser automation across all major personas and offline/reconnect sequences.
- Measure production-like request/write counts and D1 query profiles.

## SECURITY — DEFERRED TO PHASE_3

- Client-authored collaborative audit entries can be accepted as generic operations.
- The first persisted personal-state write requires revalidation of private-note entitlement behavior.
- Preformed leaderboard/read scope requires an explicit privacy decision and server-policy review.
- Offline collaboration replay and stale authorization need replay hardening.
- Generic-record lifecycle can permit orphaned references where D1 foreign keys do not apply.
- Authentication/session/coupon/role hardening must be handled as security work, not hidden inside refactoring.

## DEFERRED_TO_PHASE_4

- Mobile/desktop visual redesign, navigation redesign, safe-area changes, and account-experience redesign.

## NOT VERIFIED

- Physical iPhone/iPad/Android behavior after refactor.
- Production Cloudflare bindings, live datasets, and external ImageKit behavior.
- Full manual smoke coverage for every persona; automated integration coverage is complete, but device/persona fixtures are limited.
