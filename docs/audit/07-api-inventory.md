# API inventory

All endpoints are served under `/api/cloudflare` by `app/api/cloudflare/[...path]/route.ts`. Unless noted, mutations apply same-origin validation and rate limiting. `R` and `W` abbreviate reads and writes.

## Authentication and state

| Method | Endpoint | Purpose | Auth / role / plan | R | W |
| --- | --- | --- | --- | --- | --- |
| GET | `/auth/session` | current verified account/effective plan | session | profiles, sessions, entitlement tables | expired session cleanup possible |
| POST | `/auth/register` | create pending user or singleton root | public; setup token for root | profiles/claims/security | profiles, claim, session |
| POST | `/auth/login` | password login | public | profile | session |
| POST | `/auth/mfa` | verify login TOTP | pending verified-stage session | profile/session | session verified/expiry |
| POST | `/auth/mfa-begin` | issue TOTP enrolment | authenticated root | profile | profile pending secret |
| POST | `/auth/mfa-complete` | confirm TOTP enrolment | authenticated root | profile | profile/session |
| POST | `/auth/logout` | revoke current session | session | session | session delete |
| PUT | `/auth/profile` | update own profile | approved self | profile | profile |
| PUT | `/auth/password` | change password | approved self + current password | profile/session | password + session cleanup |
| DELETE | `/auth/account` | delete own account | approved self + confirmation | broad account data | atomic deletion/anonymization |
| GET | `/state` | personal cloud state | approved | app state | — |
| PUT | `/state` | revisioned full state | approved + plan limits | state/test registry | state/sync/test registry |
| PUT | `/state/exam` | exam checkpoint | approved | app state | partial state/sync |
| PUT | `/state/flashcards` | flashcard checkpoint | approved + plan limits | app state | partial state/sync |
| PUT | `/state/daily-goal` | daily-goal checkpoint | approved | app state | partial state/sync |

## Collaboration, QBank and media

| Method | Endpoint | Purpose | Auth / role / plan | R | W |
| --- | --- | --- | --- | --- | --- |
| GET | `/collaboration` | scoped collaborative snapshot | approved; bank/role filtering | records/profiles/classification | — |
| PUT | `/collaboration` | record-operation batch | approved; `recordAllowed` per item | records/profiles | records + audit + revisions |
| POST | `/ids/reserve` | reserve question display IDs | approved contributor/editor | allocators/registry | reservations |
| POST | `/qbanks/invite-preview` | resolve invite/share | approved | QBank/invite/share records | — |
| POST | `/qbanks/join` | accept invite/share | approved + valid grant | records | membership/use counters |
| POST | `/media/notes` | upload private-note image | approved, Pro+ | plan/R2 usage | R2 + media row |
| POST | `/media/questions` | upload question image | approved + bank contribution access | bank/R2 usage | R2 + media row |
| GET | `/media/:key` | stream authorized media | context-specific; published preformed exception | media/test/access | R2 class-B usage |
| DELETE | `/media/:qbankId` | remove QBank media | owner/root | media/bank | R2 + metadata |
| DELETE | `/qbank-folders/:id` | delete/move/cascade folder | root, confirmed mode | folders/banks | records + audit |
| GET (upgrade) | `/realtime` | WebSocket invalidations | session + channel authorization | access records | DO socket |
| GET/POST/DELETE | `/contact` | own tickets/create/delete; root listing/status/reply | approved; root for global admin | tickets/messages | tickets/messages |

## Platform operations

| Method | Endpoint | Purpose | Auth / role / plan | Reads | Writes |
| --- | --- | --- | --- | --- | --- |
| GET | `/platform/reviewer-performance` | reviewer aggregates | `isAdmin` + verified session | proposals/claims/profiles | — |
| POST | `/platform/test-pool` | select filtered pool | approved | questions/progress | — |
| PUT | `/platform/classification` | update taxonomy | bank editor/manager | revisions/records | records/revisions |
| GET | `/platform/json-import-status` | usage/suspension status | approved | import tables | — |
| GET/PUT | `/platform/announcement` | read/publish announcement | approved read; root+MFA write | records | records/audit |
| GET | `/platform/audit-week` | weekly audit records | root+MFA | audit records | — |
| GET/PUT | `/platform/content-backup` | export/restore shared content | root+MFA | records/content | records |
| GET/PUT | `/platform/personal-backup` | export/restore own state | Pro+ | app state | app state |
| GET/PUT | `/platform/legal-links` | read/manage terms/privacy links | approved read; root+MFA write | records | records |
| GET | `/platform/plan-status` | effective plan/usage | approved | entitlement/usage tables | — |
| POST | `/platform/exam-start` | register exam start | approved + limit | registry/state | registry |
| GET | `/platform/contributions` | account/review contribution state | approved | economy/review tables | — |
| GET/POST | `/platform/rewards` | catalog/activate reward | approved + credits | catalog/account | reward/ledger |
| GET/POST | `/platform/economy-admin` | inspect/grant economy | root+MFA | economy tables | ledger/entitlements |
| POST | `/platform/bulk-review` | atomic decisions up to 200 | reviewer per bank | proposals | proposals/questions/claims |
| GET/POST | `/platform/review-history` | list/clear own review history | reviewer | records/claims | preference record |
| POST | `/platform/quote` | calculate plan price/code | approved | prices/codes | — |
| POST | `/platform/checkout` | free activation or WhatsApp handoff | approved | quote inputs | events/subscription when free |
| GET/POST/PUT/DELETE | `/platform/discounts` | list/create/update/delete codes/usage | root+MFA | discount/events | discount/audit |
| GET/POST/PUT | `/platform/subscriptions` | list/activate/update plans | root+MFA | entitlement sources | subscription/override/audit |
| GET/DELETE | `/platform/question` | inspect or hard-delete question | access/reviewer read; editor delete | records/registry/tickets | records/registry/media |
| POST | `/platform/import` | validate/import question JSON | Pro/Unlimited + bank edit/contribution | import/records | batch/files/proposals |
| GET/POST | `/platform/reviewers` | search/add bank reviewer | bank owner/manager | profiles/memberships | membership/audit |

## Preformed tests

| Method | Endpoint | Purpose | Auth / role / plan | Reads | Writes |
| --- | --- | --- | --- | --- | --- |
| GET | `/preformed/catalog` | own + published public catalog | approved | tests/counts | — |
| GET | `/preformed/open` | open published test or owner preview | guest/user; code/passcode/token | tests/participation | attempt token as applicable |
| POST | `/preformed/create` | create test | approved Pro+ | plan/question access | test |
| PUT | `/preformed/save` | edit/version test | owner | test | test + resets stats on content change |
| POST | `/preformed/rotate-code` | rotate share code | owner | test | test |
| GET | `/preformed/leaderboard` | ranked results | any approved user; non-hidden ID | test/leaderboard | — |
| GET | `/preformed/manage` | owner analytics/document | owner | test/stats/results | — |
| POST | `/preformed/submit` | score idempotent attempt | valid signed-in/guest attempt | test/token/receipt | receipt/participation/stats/leaderboard |
| POST | `/preformed/report` | report test | participant/user | test | report |
| GET | `/preformed/reports` | moderation queue | root | reports/tests | — |
| PUT | `/preformed/moderate` | resolve/hide report/test | root | reports/test | report/test/audit |
| DELETE | `/preformed/delete` | delete test | owner/root as implemented | test | related test data |

## API-level observations

- The catch-all route and three very large server modules create broad responsibilities and repeated guard patterns.
- Authentication is centralized in `currentUser`, but role/plan/ownership decisions are distributed among helpers and branches.
- The generic collaboration PUT endpoint has the widest policy surface; every new record type must be added correctly to `recordAllowed`, serialization, filtering, audit, and realtime tags.
- No clearly duplicate public endpoint path was found, but state has full-save plus three checkpoint forms that intentionally overlap.
- Two authorization concerns are listed in the risk register: user-authored audit records and preformed leaderboard scope.

