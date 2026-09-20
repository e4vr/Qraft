# Entitlement model

The authoritative effective plan is calculated server-side from profile, subscription, expiry, earned reward, and explicit Superadmin override data. Client cache/local storage can display a plan but cannot grant access.

| Capability / limit | Free | Lite | Pro | Unlimited / Superadmin override | Enforcement |
|---|---:|---:|---:|---:|---|
| Core study/QBank access | ALLOW | ALLOW | ALLOW | ALLOW | Server resource access plus UI |
| Lifetime free exam allowance | Limited | Product rule | — | — | Server atomic counter; boundary test |
| Monthly Pro exam starts | — | — | 250 | Explicit configured rule | Server; 249/250/251-style coverage |
| Lite saved-state/private limits | Lower limits | Enforced | Higher limits | Override-derived | Server; rejected writes preserve prior state |
| Contribution and earned reward | ALLOW | ALLOW | ALLOW | ALLOW | Server transactions |
| Administrative/reviewer actions | DENY | DENY | DENY by plan alone | Role required | Role policy, never plan inheritance |

`getEffectiveEntitlement` is the canonical resolver. Explicit overrides win, including an explicit downgrade. Expired active/manually activated subscriptions are marked expired and access falls back to the remaining valid entitlement. Protected endpoints reevaluate current D1 state; stale tabs or installed PWAs cannot keep server privilege.

Regression coverage includes Free lifetime limits, exact Pro monthly limit, Lite limits, expiry, reward activation/fallback, role/plan separation, and Superadmin overrides. No new entitlement network round trip was added.
