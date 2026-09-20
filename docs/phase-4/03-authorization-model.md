# Server authorization model

Qraft evaluates protected requests in this order:

```text
authenticated D1 session
  -> approved account status
  -> platform role (if needed)
  -> concrete resource relationship/ownership
  -> effective server-side plan/capability
  -> validated action and state transition
  -> allow; otherwise deny
```

Canonical access policy is concentrated in `features/access-control/domain/access-policy.ts`; plan resolution is in `features/subscriptions/domain/plan-config.ts`. Server feature boundaries call those policies or equally scoped D1 predicates. Missing/unknown role, ownership, plan, or malformed state fails closed.

Important decisions:

- QBank management: owner or explicit bank capability; membership roles do not imply platform roles.
- Essential QBank direct changes: MFA-verified Superadmin; other users submit proposals.
- Reviewer actions: authenticated server role plus valid unresolved proposal/transition; actor identity comes from the session.
- Subscription/role management: MFA-verified Superadmin or the exact access-manager capability for its limited registration scope.
- Personal state: current authenticated `uid`, not payload owner IDs.
- Ready-made tests: owner for authoring; publication/visibility/participation checks for reads.
- Realtime: authenticated origin and per-channel authorization at subscribe/reconnect time.

UI hiding and disabled controls remain convenience only. Direct API negative tests are the security contract.
