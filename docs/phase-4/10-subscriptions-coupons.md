# Subscription and coupon security

Authoritative subscription/coupon data resides in D1 and is resolved by server policy. Profile/local cached plan data is not sufficient to use a protected capability.

Subscription activation and explicit overrides require MFA-verified Superadmin authority. The target user, plan, duration and dates are validated. Expiration is reevaluated and recorded server-side; an existing session cannot indefinitely retain Pro. Paid request preparation does not activate service by itself.

Coupon/redemption flow validates code, expiry, global/per-user restrictions and usage before consuming and activating the intended entitlement. D1 atomic batches/constraints provide replay and concurrency resistance. Free and credit reward redemption is idempotent and preserves fallback plan state.

Tests cover invalid/expired states, independent pagination, timestamp canonicalization, direct Lite denial, Free atomic redemption, earned credits, paid preparation without upgrade, exact Pro limit, expiry fallback, and Superadmin override behavior. No payment processor or production coupon was invoked.
