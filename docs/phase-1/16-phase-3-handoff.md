# Recommended Input for Phase 3 — Security Hardening

## Scope

Handle security and integrity findings explicitly after Phase 2 measurements. Do not mix these policy changes into structural refactoring.

## Priority investigations

1. **Server-authored audit events.** Determine whether clients can create or alter audit-log records through generic collaboration operations; move authoritative audit creation server-side.
2. **Private-note first-write enforcement.** Verify entitlement enforcement when no previous personal-state row exists and add server-side tests for Free/Lite first writes.
3. **Preformed leaderboard privacy.** Define intended public/private scope, participant identity exposure, and server-side read policy.
4. **Offline replay authorization.** Revalidate queued collaboration operations against current role, membership, suspension, ownership, and plan state at replay time.
5. **Generic-record referential integrity.** Identify records whose relationships are application-only and add safe validation/cleanup plans.
6. **Authentication/session hardening.** Review cookie/session rotation, MFA recovery, rate-limit keying, password lifecycle, and privileged-session requirements.
7. **Billing/coupon integrity.** Threat-model activation, redemption idempotency, overrides, expiry, and administrative assignment.

Every item above is `SECURITY — DEFERRED TO PHASE_3`.

## Required method

- Add exploit-resistant server tests before changing policy.
- Use local fixtures only; do not probe production or redeem real coupons.
- Preserve existing legitimate roles, subscriptions, IDs, and ownership.
- Separate confirmed vulnerabilities from intended product policy.
- Document migration/backfill requirements before enforcing new constraints.

## Starting evidence

Use `docs/audit/15-risk-register.md`, `docs/audit/04-roles-permissions.md`, `docs/audit/05-plans-entitlements.md`, and the new canonical policy modules. The Phase 1 boundary tests identify the locations where security checks should be centralized.
