# Qraft change-driven data architecture

This report is the implementation inventory and as-built policy for the request-reduction refactor. The inventory and classifications were completed before code changes, then verified against the finished implementation. It is intentionally organized by authoritative resource rather than by screen.

## Request budget

| Interaction | Budget |
|---|---:|
| Cached navigation | 0 requests |
| First use of an uncached resource | 1 query |
| UI-only test-builder change | 0 requests |
| One real edit | 1 mutation, normally 0 follow-up queries |
| Identical concurrent reads | 1 physical request |
| Remote change, hidden consumer | 1 small event, 0 immediate queries |
| Remote change, visible consumer | 1 small event and at most 1 deduplicated query |
| Reconnect after a gap | Targeted stale-resource reconciliation only |

## Resource inventory and classification

| Resource | Class | Source of truth / tables | API and consumers | Mutated or invalidated by | Previous request behavior | Policy |
|---|---|---|---|---|---|---|
| Authenticated user, roles and effective plan | Session-cached | `profiles`, `sessions`, `subscriptions`, `reward_passes`, `admin_plan_entitlements`, `account_plan_overrides` | `GET /auth/session`; app shell, account and entitlement gates | login/logout, profile/password/MFA, subscription/reward/admin-plan changes, suspension | initial GET plus an extra GET on window focus and after entitlement actions | Fetch once per session; invalidate on `account`; never focus-refetch |
| Personal study state | Session-cached + transactional | IndexedDB first; `app_states`, `test_registry` | `GET/PUT /state`; dashboard, exams, progress, private notes, flashcards | local study changes and explicit/lifecycle checkpoint | local save after 200 ms; guarded cloud checkpoint; server rewrote identical payloads | Keep local-first; dirty/equality guard on client and server; retain useful local data on failure |
| QBank catalog and memberships | Session-cached / event-driven | `records` types `qbanks`, `qbankMemberships`, `qbankInvitations`, `qbankShareLinks` | `GET/PUT /collaboration`, join/invite APIs; sidebar, library, managers | QBank or access mutation | monolithic collaboration GET cached for only 10 seconds; broad refresh on most socket changes | Cache for the session; invalidate catalog/access specifically; one in-flight query per canonical key |
| Questions and QBank metadata/counts | Event-driven | `records.sharedQuestions`, `question_registry`, bundled questions | collaboration and `platform/question`; library, test builder, manager | approved review, add/edit/delete/import | included in broad collaboration reload; counts often derived from loaded objects | Directly merge local mutation results; remote event marks catalog stale; refresh only a visible question consumer |
| Review queue (main and Super Admin) | Event-driven | `records.questionProposals`, `contribution_reviews`, `review_completion_claims` | shared collaboration resource and `POST /platform/bulk-review`; both review workspaces | submission, review decision/edit/delete/status change | broad collaboration GET after every review and after all collaboration events | One canonical queue; mutation returns updated proposals/questions/deltas; visible queue reconciles once, hidden queue only becomes stale |
| Review history preference | Event-driven / transactional | `records.reviewHistoryPreferences` | `GET/POST /platform/review-history`; review workspace | clear history | GET on every review-workspace mount | Session cache; mutation response is canonical and updates cache/UI |
| Reviewer performance | Event-driven | `contribution_reviews`, reviewer roster in `profiles`/memberships | `GET /platform/reviewer-performance`; admin overview | completed reviewer decision or reviewer-role change | GET on every component mount/manual refresh | Cache until reviewer event; explicit refresh may force one query |
| Eligible question count | Parameter-driven, locally derived | already-loaded questions + local progress | previously `POST /platform/test-pool`; Create Test | QBank/question pool, specialty/topic/status filters, progress/entitlement | POST after mount and whenever a broad serialized dependency changed | Compute count locally; title/count/mode/UI state never contacts server; server is used once for authoritative random selection |
| Test selection/start | Transactional | `records`, `app_states`, `test_registry` | `POST /platform/test-pool` with `select`, `POST /platform/exam-start` | user starts a test | count requests plus selection and registration | One authoritative selection and one idempotent registration; navigation between questions is local |
| Contribution wallet, credits and rewards | Event-driven / transactional | `contribution_accounts`, `credit_transactions`, `reward_passes`, proposals | contributions/rewards APIs; Contribution Center | approved contribution, redeem/activate, admin grant/adjustment | GET on mount and GET again after every reward mutation | Cache; mutation returns canonical pass/balance/status and patches local cache; remote reward event invalidates |
| Economy administration per user | Parameter-driven + event-driven | contribution/reward/review/suspension tables | `GET/POST /platform/economy-admin`; economy admin | credit/reward/suspension/review changes for selected user | GET on user change and another GET after each mutation | Key by selected user; apply deterministic mutation result locally; invalidate other cached selections only |
| Plans and plan status | Session-cached / event-driven | plan constants, `plan_prices`, entitlement tables and usage tables | `GET /platform/plan-status`; gates/settings | exam/import/media/subscription/reward changes | on-demand aggregate batch | Cache until a relevant transaction; no navigation refresh |
| Price quote | Parameter-driven | `plan_prices`, `discount_codes`, `subscription_events` | `POST /platform/quote`; Subscribe | plan/code parameters or pricing/discount mutation | repeated on Subscribe mounts and live events | Canonical query key from normalized plan/code; single-flight and invalidated by `pricing` |
| Discount codes, usage and base price | Parameter-driven + event-driven | `discount_codes`, `subscription_events`, `subscription_settings` | `GET/mutation /platform/discounts`; Super Admin | create/edit/toggle/delete/redemption/price | debounced GET on mount/filter/page and forced GET after save | Cache each canonical filter/page; no-op guard; return canonical row; patch current page, invalidate other variants |
| Subscribers and subscriptions | Parameter-driven + event-driven | profiles plus all entitlement tables | `GET/mutation /platform/subscriptions`; Super Admin | creation/upgrade/renewal/expiry/cancel/admin override/reward | GET on mount/filter/page and forced GET after save; **GET also executed expiry writes** | Cached canonical pages; no writes on GET; scheduled expiry only; mutation patches current row and invalidates other variants |
| Announcement | Event-driven | `records.system/announcement` | `GET/PUT /platform/announcement`; app shell and admin | Super Admin edit | GET on every authenticated app/admin mount | Cache; mutation returns canonical value; no-op save produces zero writes; event invalidates other clients |
| Legal links | Static / long-lived | `records.system/legalLinks` | `GET/PUT /platform/legal-links`; settings/admin | Super Admin edit | GET on mount in app and admin | Long-lived cache; mutation response updates it; no-op save produces zero writes |
| Audit week | Parameter-driven | `records.auditLog` | `GET /platform/audit-week`; admin overview/audit | audited mutation in selected week | refetched when tab toggled between Overview/Audit | Cache by week signature; invalidated only by audit-bearing transactions |
| Contact tickets/messages | Parameter-driven + event-driven | `tickets`, `ticket_messages`, question registry | `/contact`; contact workspace | ticket/message/status/delete | debounced query on mount/search/page and live revision | Cache by query; contact event marks stale; only mounted matching consumer refreshes |
| Reviewer search/assignment | Parameter-driven + transactional | `profiles`, membership records | `/platform/reviewers`; QBank manager | search/bank, reviewer assignment/access change | query on mount and search changes | Canonical key by bank/search; debounce; mutation returns membership and updates collaboration |
| Import status and imports | Session-cached / transactional | `json_import_suspensions`, `imported_files`, `import_batches`, proposals | json-import status/import APIs | suspension/import/review | status GET on import-review mount; POST for import | Cache status until economy/access event; idempotent import request ID; return created proposals |
| Media | Transactional / immutable | R2 objects plus `media`, `r2_usage_periods` | media upload/serve/delete; question/note tools | explicit upload/delete/account deletion | one request per real file action; immutable browser caching on reads | Preserve permission checks and hard quotas; no generic authenticated edge cache |
| App shell and static assets | Static / long-lived | deployment assets/service worker cache | service worker; all pages | deployment/service-worker version | cache-first app shell; API excluded | Preserve app-shell cache; never cache private API responses in the service worker |
| Backups | Transactional/on-demand | D1 and private R2 snapshots | content/personal backup endpoints and scheduled Worker | explicit export/import; daily scheduled backup | only explicit user action/schedule | Never prefetch or navigation-load; keep permission and size checks |

## Central policy

`lib/resource-data.ts` owns canonical query keys, resource classification, in-memory freshness, single-flight requests, tag invalidation, initiating-client cache updates, and development request metrics. Pages request data; they do not assign a time-to-live. Event-driven and session resources remain fresh until a real mutation or reconnect marks their tag stale. Parameter resources change only when their normalized server parameters change.

Canonical keys are `scope | METHOD | normalized pathname/query | normalized JSON body`. Account-scoped resources use the authenticated UID as scope; public/static resources use the empty scope. Permissions are enforced by the Worker/D1 query on every network read and by the authorized realtime channel before an event is delivered. A hidden or unconsumed resource is marked stale only; it is fetched when a visible consumer actually requests that canonical key.

Realtime packets remain content-free invalidations. Permission checks happen before WebSocket connection and every data refresh still passes through the authorized API. A socket event first marks matching cache tags stale. Mounted consumers may reconcile; unmounted consumers cause no request.

## Invalidation matrix

| Tag/resource | Invalidated by events/actions |
|---|---|
| `account` / session | profile, MFA, subscription, plan override, reward activation, suspension/account status |
| `collaboration` | broad access, QBank, membership, invitation, profile/governance changes |
| `question-catalog` | approved question create/edit/delete, approved import/review |
| `review-queue` | proposal submission/deletion/status or review decision |
| `reviewer-performance` | completed review or reviewer-role change |
| `contributions` / `economy` | contribution approval, credit adjustment, reward redemption/grant/activation, suspension |
| `pricing` / `discounts` | price or discount create/edit/toggle/delete/redemption |
| `subscriptions` | subscription, override, reward activation or expiry transition |
| `announcement` | announcement edit |
| `legal-links` | legal-link edit |
| `contact` | ticket/message/status/delete |
| `audit` | any audited mutation affecting a loaded week |
| `review-history` | current user clears review history |
| `test-pool` | question catalog/progress/entitlement change; count itself is locally derived |

## D1 policy

 Hot queries must use focused columns and pagination. Indexes are added only for repeated owner/status/time and membership lookup shapes observed in the server. Expiry is not a read-side mutation. No derived aggregate table is written on personal-state or collaboration saves; counts are computed from authoritative records or local state.

## As-built changes

- Added a central, session-long resource cache with canonical keys, single-flight reads, tag invalidation, and request diagnostics. There are no arbitrary freshness timers.
- Removed the focus-triggered session query and the ten-second collaboration cache expiry.
- Made the Create Test eligible count local. Title, count, mode, specialty, topic, status, and progress-display changes do not request the server; the server remains authoritative when a test is actually selected and started.
- Added client and server equality guards for personal state, collaboration deltas, profile fields, announcement, legal links, discount settings, and subscription mutations.
- Expanded review, reward, economy, pricing, discount, and subscription mutation responses so the initiating client patches its cache without a follow-up GET.
- Replaced broad single-topic realtime messages with batched resource invalidations and suppressed echo to the initiating browser tab. Hidden consumers do not fetch; visible consumers reconcile through the shared single-flight cache.
- Removed subscription-expiry writes from authenticated reads. The scheduled Worker now performs the transition and emits targeted account/subscription invalidations only for affected users.
- Added focused D1 indexes for owner/type/time, pending review queue, membership lookup, test registry, imported files, and contribution review history.
- Removed the unused `sync_operations`, `sync_changes`, `user_topic_stats`, `qbank_stats`, and `user_stats` projections. Migration `0016_remove_unused_derived_state.sql` drops only those unused tables; authoritative records and user state remain intact.
- Removed the client WebSocket heartbeat and visibility-driven socket teardown. Durable Objects now carry content-free invalidations only; API authorization remains the source of truth.
- Removed the 30-minute personal-state write timer. Cloud checkpoints are debounced from actual state changes and still flush on explicit/lifecycle boundaries.

## Main modified areas

| Area | Files |
|---|---|
| Resource cache and API policy | `lib/resource-data.ts`, `lib/api-client.ts`, `lib/cloudflare-client.ts` |
| Realtime invalidation | `lib/realtime-client.ts`, `lib/realtime-server.ts`, `workers/realtime.ts`, API route |
| Read/write behavior | `lib/cloudflare-server.ts`, `lib/platform-server.ts`, `worker.ts` |
| Consumers | app shell, Create Test, review workspaces, reviewer performance, contribution/economy, subscription/discount, profile and collaboration settings |
| Storage | `drizzle/0015_change_driven_data.sql`, `db/schema.ts` |
| Verification | platform API contract tests and `tests/resource-data.test.mjs` |

## Expected request reduction by interaction

| Interaction | Before | After |
|---|---:|---:|
| Return to an already loaded resource | 1 query per mount/focus | 0 |
| Create Test UI/filter/count change | up to 1 pool query per reactive change | 0 |
| Review/reward/economy/admin mutation | 1 mutation + 1 broad follow-up query | 1 mutation |
| Same canonical read requested concurrently | N physical queries | 1 physical query |
| Remote change while consumer is hidden | 1 event + broad collaboration query | 1 small event + 0 queries |
| Remote change while consumer is visible | 1 event + potentially repeated queries | 1 event + at most 1 deduplicated query |
| Subscription list read with expired rows | 1 query plus expiry writes | 1 read-only query; transition runs on schedule |

## Intentional remaining requests and risks

- Authentication, initial uncached resources, explicit refresh, changed server parameters, test selection/start, uploads, imports, checkout, exports, and backups still require requests because they are authoritative or transactional.
- Realtime remains one authorized Durable Object socket per audience channel, not a single global socket. This preserves the existing per-user/per-bank/admin permission boundary; invalidation and request deduplication are centralized even when a user legitimately has multiple audience channels.
- Collaboration hydration still returns one state envelope for the current UI model, but its D1 read is limited to explicit state-bearing record types and accessible QBank scopes; unrelated audit, share-link, and other system records are excluded.
- The primary cache is in memory; a full reload performs initial authorized reads again. Personal state and collaboration data retain their existing IndexedDB path. Sensitive in-memory data is cleared on logout/account change and is never placed in the service-worker asset cache.
- Batched mutation responses are intentionally larger than `{ok:true}`. They eliminate a second database/API round trip; unusually large review batches remain capped at 200 items.

## Verification evidence

The automated suite passes all 70 tests, including canonical-key ordering, single-flight reads, stale-tag behavior, no-op mutations, live-channel authorization, and the session-generation race guard. TypeScript, lint, production build, and Wrangler dry-run also pass.

The development deployment is live at `https://qraft.eduhelp.workers.dev` (Worker version `39716b71-e325-4d7d-8bd2-2dd189d1a690`; realtime version `f7a30f57-9e00-4645-bdab-4480047e3819`). Migrations `0015` and `0016` are applied remotely, with no pending migrations. Live checks observed HTTP 200 for the application and session endpoint, `Cache-Control: no-store` on the session response, service-worker version `qraft-shell-v1.0.4`, and explicit `/api/` exclusion. The public browser had no authenticated session, so role-specific navigation and two-client realtime request counts remain verified by automated contracts rather than a live authenticated browser trace.

Remote `EXPLAIN QUERY PLAN` checks confirmed indexed searches for pending proposal ownership, membership user/role/QBank lookup, and covering-index scans for monthly test starts and import usage. No tested hot query shape performed a full-table scan.
