# Plans, subscriptions, and entitlements

## Plan → feature matrix

Values come from `lib/plan-config.ts`.

| Feature / limit | Free | Lite | Pro | Unlimited | Enforcement |
| --- | ---: | ---: | ---: | ---: | --- |
| Price SAR/year (default) | 0 | 15 | 50 | 99 | quote server; configurable prices table |
| Exam allowance | 2 lifetime | 30/month | 250/month | 1,000/month | client + server + D1 trigger |
| Questions/test | 15 | 50 | 200 | 500 | client + server + D1 trigger |
| Create QBank | No | No | Yes | Yes | client + collaboration server |
| Private QBank | No | No | Yes | Yes | client + collaboration server |
| Add/contribute questions | Yes | Yes | Yes | Yes | server policy |
| JSON import | No | No | 3/day, 75/file, 300 pending | 5/day, 150/file, 1,000 pending | client + server + triggers |
| Upload question images | Yes | Yes | Yes | Yes | server; deployment-wide R2 cap |
| Private notes | No | No | Yes | Yes | client + server, with first-save mismatch |
| Flashcards | No | No | 3 decks / 2,000 cards | 25 decks / 20,000 cards | client + full-state server check |
| Personal backup | No | No | Yes | Yes | server |
| Preformed test creation | No | No | Yes | Yes | server |
| Rewards/contributions | Yes | Yes | Yes | Yes | server/economy triggers |

Roles do not inherently change plan. Reviewer, owner, editor, moderator, and access-manager users retain the effective plan calculated for their account. Superadmin can assign an explicit override.

## Effective-plan calculation

Authoritative calculation: `lib/entitlement-server.ts`.

1. Start with base `profiles.profile_json.tier`.
2. Consider active `subscriptions`.
3. Consider active `reward_passes`.
4. Consider active `admin_plan_entitlements`.
5. Select the highest plan by `PLAN_ORDER`.
6. If `account_plan_overrides` exists, it wins even when it is a downgrade.
7. Return the effective plan and relevant expiry to the session profile.

Subscription expiry is applied by the scheduled job and also effectively ignored when inactive/expired by entitlement calculation. The main Worker cron runs daily at 01:30 UTC.

## Activation paths

| Path | Behavior |
| --- | --- |
| 100% discount/free checkout | Server atomically activates one year and records the event |
| Positive-price checkout | Generates a WhatsApp coordination URL; no payment is recorded and no upgrade occurs automatically |
| Superadmin action | Creates/updates subscription, reward, entitlement, or explicit override |
| Contribution reward | Credits purchase a separately activated reward pass |
| Expiry | Cron marks subscriptions expired; remaining/base entitlement becomes effective |

## Entitlement enforcement comparison

| Restricted feature | UI | API/server | D1 | Result |
| --- | --- | --- | --- | --- |
| QBank/private QBank create | hidden/upgrade prompts | `recordAllowed` plan check | no dedicated QBank table trigger | Aligned |
| Exam count/size | builder clamps/prompts | state and exam-start checks | triggers protect registry | Aligned |
| JSON import | hidden/status/limits | import validates all limits | triggers protect caps | Aligned |
| Flashcards | hidden/upgrade surface | full-state deck/card comparison | none specific | Aligned for existing state |
| Private-note media | hidden | media route checks plan | metadata/storage path | Aligned |
| Private-note text on first state | hidden | prior-state comparison is skipped when no stored state | none | **ENTITLEMENT MISMATCH** |
| Personal backup | hidden/upgrade | plan check | n/a | Aligned |
| Preformed creation | UI gating | server Pro+ check | n/a | Aligned |

## Plan-state refresh

- `currentUser()` recalculates effective entitlement on authenticated server reads.
- Subscription/economy mutations publish user-channel invalidations.
- Visible sessions refetch account data after relevant WebSocket events.
- If the document is hidden, the refresh callback returns early. The cache is marked stale, but immediate visible UI refresh on returning to the page was not proven.
- Local same-tab admin actions also dispatch an account-updated event.

**NOT VERIFIED:** visual behavior for real Lite, expired, coupon-activated, or manually activated personas because the existing preview fixture named Lite is actually Pro.
