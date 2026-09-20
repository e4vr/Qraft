# State Machines

## Account

- Valid states: pending, approved, rejected; approved may be suspended.
- Transitions: registration → pending; access manager/root → approved/rejected; approved ↔ suspended; account → deleted/anonymized.
- Invalid: deleted session remaining usable; non-approved account using approved APIs.
- Terminal: deleted. Recovery from rejection/suspension requires an authorized account-state change.

## QBank and membership

- QBank: created → active/public-or-private → archived or hard-deleted.
- Membership: absent → viewer/editor/reviewer → changed/revoked/left.
- Invalid: multiple memberships for one bank/user, membership to a missing bank, non-owner access management.
- Phase 2 prevents duplicate memberships and cascades related D1 records on direct bank deletion.

## Question/suggestion/review

- Proposal: pending → approved or rejected.
- High-risk correction: pending → first independent review recorded → second independent decision → approved/rejected.
- Question: reserved ID → reviewed publication → edits through proposals → hard delete/retired identity.
- Invalid: approved proposal edited back to pending, author self-approving, reviewed payload differing from published payload, reused retired UUID.
- Terminal: rejected proposal or retired question identity; a new proposal is the recovery path.

## Exam

- active → paused/resumed locally → completed.
- State changes are local immediately and checkpointed/server-synchronized according to context.
- Invalid: duplicate session IDs, duplicate question IDs within a session, oversized tests, partial checkpoint success reported as failure.
- Completed sessions remain historical/reviewable; restart creates/reset semantics in the client rather than reopening the same completed result.

## Flashcard

- Card schedule: new → learning → review; review may return to relearning.
- Deck/card create/update/delete; deck deletion cascades its tree, schedules and logs in client state.
- Invalid: missing parent, cross-bank parent, cyclic parent graph, duplicate deck/card identity, schedule for missing card.

## Subscription/reward/coupon

- Subscription: absent → active/manually_activated → expired/cancelled → renewed active.
- Reward pass: available → active → expired.
- Coupon: scheduled/active/disabled/exhausted/expired; successful redemption is immutable history.
- Explicit plan override is independently active until expiry/removal and wins over other sources.
- Recovery: renewal, new reward activation, or authorized override; no automatic paid activation follows the WhatsApp handoff.

## Ready-made test attempt

- token issued → submission receipt + result → token consumed.
- Repeating the same submission ID returns the stored result.
- Reusing the same token with another submission ID is invalid; Phase 2 adds a unique token claim.
