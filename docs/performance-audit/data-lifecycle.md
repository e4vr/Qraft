# Qraft data lifecycle

| Resource | Owner | Authoritative source | Cache scope | Freshness | Invalidation trigger | Realtime behavior | Navigation behavior | Reconnect behavior |
|---|---|---|---|---|---|---|---|---|
| Account/session | Auth client + root app | D1 session/profile/entitlement state | Current browser account, memory | Session-bound; explicit account events | Auth/profile/subscription/access mutation, logout | `account`/`access` marks account tags stale | Reused across routes | One coordinated account reconciliation |
| Announcement | Platform resource client | D1 platform configuration | Public/session memory | Event-driven, very stable | Admin announcement mutation | `announcement` invalidates only announcement | Reused | Fetched only if stale/consumed |
| Legal links | Platform resource client | D1 platform configuration | Public/session memory | Static/event-driven | Admin legal-links mutation | `legal-links` only | Reused | Fetched only if stale/consumed |
| QBank catalog/folders | Collaboration resource owner | D1 `records` catalog collections | Authenticated account; IndexedDB + memory | Semi-stable | Bank/folder/membership/invitation changes | `catalog` invalidates catalog/collaboration tags | Reused immediately | Included in one collaboration reconciliation |
| Collaboration snapshot | Root collaboration owner | Permission-filtered D1 records | Authenticated account; IndexedDB + memory | Realtime/event-driven | Relevant collaboration mutation or reconnect | Topic-specific invalidation; full snapshot only on next required read | Reused across route mounts | One coordinated refresh because no ordered cursor exists |
| Questions | Collaboration/question resource owner | Approved question records and targeted question API | Account + bank/question parameters | Semi-stable/realtime | Question approval/edit/delete, classification change | `question-catalog` invalidates question/test-pool tags | Loaded bank/exam questions remain usable | Refresh only after relevant invalidation |
| Topics/specialties | Collaboration/classification owner | D1 records + classification revisions | Account + bank | Very stable/event-driven | Classification mutation | `question-catalog`/`collaboration` | Reused | Reconcile only when stale |
| Review queue | Review workspace resource | D1 pending proposal records | Reviewer + bank/query | Realtime/event-driven | Proposal/review/import mutation | `review-queue` only, plus affected question tags | Reused until invalidated | Targeted read when consumed |
| Reviewer history/performance | Review workspace resource | D1 review/ledger tables | Reviewer/admin parameters | Event-driven | Completed review/explicit history mutation | Dedicated history/performance topics | Reused | Read if stale and visible |
| Personal state | Root state owner | D1 `app_states`; IndexedDB working copy | User id | Session-bound with revisions | User checkpoint/full state mutation | Not globally reloaded by unrelated events | Retained across routes | Sync outbox/revision protocol resumes safely |
| Active exam | Root app/TestView | Personal state plus preloaded questions | Current user + exam id, in memory/IndexedDB state | Session-bound | Explicit exam mutation/checkpoint | No remote event drives question navigation | Next/Previous/navigator are local | Preserve locally, then reconcile state once |
| Exam answers/statistics | TestView + state checkpoint service | Local active exam immediately; D1 checkpoint authoritative across devices | User + exam/question | Critical persistence | Answer change and checkpoint | Other clients receive `question-stats` invalidation | Never refetch for question navigation | Idempotent checkpoint/revision handling |
| Flashcards | Flashcard workspace/personal state | Personal state; local schedules/log | User | Session-bound | Review/deck/card mutation | No broad collaboration refresh | Retained across routes when state remains mounted | Existing state sync protocol |
| Progress | Derived from personal state and question hierarchy | Personal state + collaboration classification | User + bank | Derived/session-bound | Answer/checkpoint or classification change | Relevant state/question invalidation only | Recomputed locally from retained inputs | Inputs reconcile; no standalone poll |
| Test pool | Test builder resource | D1 eligibility query | User + bank/filter/count parameters | Parameter-driven | Filter/plan/question catalog change | Question/account tags invalidate | Same parameters reuse cache | Read only when stale and requested |
| Preformed tests | Preformed resource client | Dedicated D1 preformed tables | Visibility/user + test parameters; IndexedDB where configured | Event-driven | Preformed mutation | `preformed-tests` only | Reused | Read if stale and visible |
| Subscription/pricing | Subscription resource client | D1 subscriptions/discounts/plan policy | User or public quote parameters | Parameter/event-driven | Subscription, discount, reward activation | Account/subscription/pricing topics | Reused | Targeted account/resource reconciliation |
| Contributions/economy | Contribution resource client | D1 reward/ledger/import status | User/admin parameters | Event-driven | Review, reward, import mutation | Contribution/economy topics | Reused | Read if stale and visible |
| Contact tickets | Contact resource client | D1 ticket tables | User/admin + search/page | Parameter/event-driven | Ticket mutation | `contact` only | Reused per key | Read if stale and visible |
| Media | Browser URL + media service | Private R2 object authorized through D1 metadata | Object key and authorization | Immutable by key until delete | Upload/delete | Parent resource invalidation | Browser cache rules apply | Re-request only when needed |
| Static shell/assets | Browser/service worker | Deployed build assets | Build URL | Build-version stable | Service-worker update | None | Stale-while-revalidate | Normal PWA update lifecycle |

## Ownership rules

- The root application owns account, personal state, collaboration and active-exam lifetime.
- Workspaces request only their parameterized or feature-specific resources.
- Components may consume the same resource, but the shared resource cache owns the physical request.
- IndexedDB provides startup/offline continuity; it does not override newer server revisions.
- Cache cleanup occurs on account/session change and normal browser lifecycle. Unlimited cross-session retention is prohibited.
