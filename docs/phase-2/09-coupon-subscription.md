# Coupon and Subscription Audit

## Coupon lifecycle

Creation/update validates code, kind, amount, allowed plans, dates and usage limits. Quote rechecks enabled/start/end/global/per-user limits. A zero-price redemption writes the event and activation atomically; trigger checks prevent exhausted or repeated use. Repeating the same request ID is idempotent.

## Subscription lifecycle

- Positive-price checkout only returns the established WhatsApp coordination URL.
- Manual Superadmin activation writes subscription, event and audit in one batch.
- Cancellation/expiry changes the effective-plan calculation without rewriting unrelated entitlement sources.
- Scheduled expiry is idempotently audited.

## Phase 2 date repairs

- Accepted coupon/subscription timestamps are normalized to UTC ISO strings before storage.
- Comparisons use parsed instants rather than raw input text.
- One-month/one-year calendar durations clamp Jan 31 and Feb 29 to the target month's last day rather than overflowing into March.

## Concurrency result

Coupon redemption, credit reward redemption and activation remain atomically/idempotently tested. External manual payment reconciliation is a product/operations boundary, not repaired here.
