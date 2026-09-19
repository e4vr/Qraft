# Authentication and Authorization Boundaries

## Authentication boundary

Browser authentication operations are owned by `features/auth/client/auth-client.ts`. Server identity/session operations are exposed through `features/auth/server/auth-service.ts`. Cookie names, PBKDF2 parameters, MFA enrollment/sign-in flow, session duration, cache invalidation, and profile response shapes were not changed.

## Authorization boundary

Pure platform-role and QBank-access decisions are canonical in `features/access/domain/access-policy.ts`:

- `hasModeratorRole`
- `hasReviewerRole`
- `hasAccessManagerRole`
- `bankRoleFor`
- `canAccessBank`
- `canManageBank`
- `canEditBank`
- `canReviewBank`

The legacy type module re-exports these names so existing call sites and external imports remain source-compatible. Server operations still make final authorization decisions after loading server-owned identity and persisted QBank state.

## Entitlement boundary

Plan order, limits, feature gates, contribution credits, rewards, and abuse limits are canonical in `features/subscriptions/domain/plan-config.ts`. The server continues to calculate effective entitlements through `lib/entitlement-server.ts`; client checks remain advisory where they were advisory before.

## Verification

- Domain-policy tests cover public/private access, editor/owner differences, reviewer inheritance, root access, plan ordering, limits, and feature gates.
- The full Miniflare suite covers final server enforcement for Lite/Free/Pro, roles, ownership, flashcards, imports, reviews, coupons/rewards, and expiry.

## Security deferral

No security rule was strengthened or weakened in Phase 1. Phase 0 security findings are listed verbatim in the Phase 3 handoff and marked `SECURITY — DEFERRED TO PHASE_3`.
