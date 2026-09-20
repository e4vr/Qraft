# Phase 3 — Security & Entitlements Handoff

Phase 2 did not perform penetration testing. The following trust boundaries require deliberate Phase 3 tests.

## Priority investigations

1. **Client-authored audit entries:** generic collaboration still accepts an `auditLog` record when `actorId` equals the authenticated UID. Determine exploitability and move authoritative event construction server-side.
2. **Ready-made leaderboard privacy:** define owner/public/participant visibility and participant-name exposure; verify every read path.
3. **Offline replay authorization:** the server reauthorizes each replay, but test revoked membership, suspension and plan changes between queue and replay.
4. **Generic-record ownership:** enumerate every type/ID trust boundary and attempt cross-bank/cross-user references with local fixtures only.
5. **Private-note/media entitlement:** Phase 2 fixed first-state note text/image references; verify media upload/read/delete and downgrade behavior adversarially.
6. **Authentication/session/MFA:** review rotation, fixation, recovery, privileged-session expiry and rate-limit identities.
7. **Coupon/subscription abuse:** race global/per-user caps, request-ID collisions, admin activation and override expiry using disposable fixtures.
8. **Superadmin operations:** verify MFA enforcement for every root route and indirect generic-record path.
9. **IDOR candidates:** QBank/media/ticket/preformed/report endpoints require systematic object-scope tests.

## Starting assets

- Canonical access policy: `features/access/domain/access-policy.ts`
- Canonical plans: `features/subscriptions/domain/plan-config.ts`
- Phase 2 integrity queries: `scripts/data-integrity-checks.sql`
- Phase 2 fixed-issue tests in `tests/platform-api.test.mjs` and `tests/improvements-api.mjs`

Do not treat the items above as proven exploits until Phase 3 reproduces unauthorized impact.
