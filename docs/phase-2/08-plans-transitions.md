# Plans and Transition Audit

## Effective-plan precedence

Base tier → active subscription/reward/admin grant highest plan → explicit account override. An explicit Free override may intentionally downgrade an otherwise paid account. Roles do not change plans.

## Verified transitions

- Free/Lite/Pro/Unlimited exam count and size limits.
- Lite → Pro through atomic 100% coupon redemption.
- Paid/manual activation → active entitlement.
- Active Pro → expired → remaining/base entitlement.
- Paid plan + active reward → higher reward plan → paid fallback after reward expiry.
- Superadmin override across all four plans, including expiry fallback.

## Boundary behavior

- Free: 2 lifetime exams.
- Lite: 30 monthly, 50 questions/test.
- Pro: 250 monthly, 200 questions/test.
- Unlimited: 1,000 monthly, 500 questions/test.
- Flashcard/private-note/QBank/import gates retain the Phase 0 product rules.

The first-write private-note contradiction was fixed. Deep adversarial entitlement bypass analysis remains Phase 3 scope.
