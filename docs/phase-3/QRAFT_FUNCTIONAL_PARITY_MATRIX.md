# Qraft Functional Parity Matrix

Baseline commit: `d4e45394ad50f61e75bf3a2de83dd63e30ee2b3d`  
Phase 3 branch: `phase-3/ux-pwa-reconstruction`

This is the Phase 3 migration contract captured before implementation. The `Migration` column preserves that discovery snapshot so the original gap is auditable; the completed disposition is recorded after the matrices and in `QRAFT_MIGRATION_STATUS.md`.

## Routes and shell states

| Feature | Route | Roles | Tiers | Current behavior / input → output | API dependency | Persistence | Edge states | Criticality | Migration | Desktop | Mobile/PWA | Regression |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Main application shell | `/` | approved users | all | Session resolves into dashboard and in-memory workspace views | auth session, collaboration, state | IndexedDB + D1 | loading, offline, suspended | Critical | Baseline | Existing sidebar | Existing compressed shell | 97-test baseline |
| Superadmin portal | `/Admin` | verified superadmin | effective plan independent | Separate portal prop renders platform administration | platform/collaboration APIs | D1 | denied, MFA required | Critical | Baseline | Existing admin shell | Stacked fallback | covered |
| Offline fallback | `/offline` | public | all | Service-worker navigation failure displays an offline page | none | Cache API | cold offline | High | Baseline | Existing | Existing | structural |
| Not found/error | framework routes | public | all | Shared branded system-state pages | none | none | missing/error/retry | High | Baseline | Existing | Existing | structural |
| Authentication | `/` gate | logged out | all | Register/login, invitation/test code entry → authenticated session | `/auth/register`, `/auth/login`, `/auth/session` | cookie session | invalid, pending, suspended | Critical | Baseline | Existing card | Existing card | covered |
| Superadmin MFA enrollment | `/` gate | superadmin | all | TOTP setup/verify before workspace access | `/auth/mfa/*` | session + D1 | expired/invalid code | Critical | Baseline | Existing gate | Existing gate | covered |
| Pending approval | `/` gate | pending/suspended | all | Status and sign-out surface | auth session/logout | session | suspension/rejection | Critical | Baseline | Existing | Existing | covered |

## Student experience

| Feature | Route/view | Roles | Tiers | Current behavior / input → output | API dependency | Persistence | Edge states | Criticality | Migration | Desktop | Mobile/PWA | Regression |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Study home | `dashboard` | approved | all | Progress, streak, daily goal, resume/quick test | state read | local + D1 | empty/new user, no questions | High | Baseline | Existing dashboard | Vertically adapted desktop | covered |
| QBank library | `library` | approved | all | Browse, search, select, favorite, pin, quick access, bookmarks | collaboration reads/writes | local organization + D1 records | no banks, empty search | Critical | Baseline | Existing cards/lists | Responsive same tree | covered |
| QBank create/manage | `qbank-management` | owner/editor/superadmin | Pro/Unlimited to create | Create/edit bank, access, sharing, questions, classification, delete | collaboration, media, question APIs | D1 + R2 | forbidden, conflict, delete confirmation | Critical | Baseline | Existing multi-section page | Same page stacked | covered |
| Invitation accept/decline | query token | approved | all | Preview invitation → explicit accept or decline | invite preview/join | D1 | expired/used/invalid | Critical | Baseline | Alert dialog | Alert dialog | covered |
| Test builder | `create` | approved | all | Select scope/mode/count → create local exam under plan limits | pool/start/state | local + D1 registry | empty pool, limit, validation | Critical | Baseline | Existing single page | Same long form | covered |
| Exam runner | `test` | approved | all | Select answer, navigate, reveal/grade, pause, complete | exam checkpoint/state | immediate local + background D1 | offline, stale state, long content | Critical | Baseline | Existing split/panels | Conditional sections in same component | covered |
| Question marking | exam | approved | all | Toggle flag immediately | checkpoint state | local + D1 | repeated tap/offline | High | Baseline | Toolbar | Same toolbar | covered |
| Question highlights | exam | approved | all | Select stem text → store/remove ranges | checkpoint state | local + D1 | overlapping/touch selection | High | Baseline | Mouse-capable flow | Not touch-specific | domain covered |
| Private notes | exam | approved | Pro/Unlimited | Edit text/images/captions → save to personal progress | state + media | local + D1 + R2 | downgrade, upload/save failure | Critical | Baseline | Side/panel | Conditional panel | covered |
| Shared notes | exam | approved | all | Read/add attributed shared notes according to access | collaboration | D1 records | empty/permission/offline | High | Baseline | Panel and auto-open | Same content flow | covered |
| Labs/reference | exam | approved | all | Open reference panel without changing exam state | local UI | memory | return context | Medium | Baseline | Resizable panel | Conditional panel | structural |
| Explanation/distribution | exam/review | approved | all | Reveal result, explanation and answer statistics | collaboration stats | local + D1 | missing explanation/stats | Critical | Baseline | Resizable section | Inline conditional section | covered |
| Question navigator | exam/review | approved | all | Jump by status/current/marked | local exam state | local + D1 checkpoint | large exam | High | Baseline | Drawer/grid | Drawer reused | covered |
| Exam submission | exam | approved | all | Warn unanswered/marked → complete exactly once → results | checkpoint/state | local + D1 | duplicate tap/failure/retry | Critical | Baseline | Confirmation dialog | Confirmation dialog | covered |
| History/results/review | `history` / exam | approved | all | Open completed test, inspect outcomes, delete test | state | local + D1 | empty/missing questions | Critical | Baseline | Existing list/review | Responsive same tree | covered |
| Progress | `progress` | approved | all | Aggregated performance by bank/category | state | local + D1 | no progress | High | Baseline | Dense cards/tables | Shrunk/stacked presentation | covered |
| Daily goal/streak | dashboard/settings | approved | all | Set goal, count local study day, persist | daily-goal/state | local + D1 | timezone/day boundary | High | Baseline | Inline/settings | Same flow | covered |
| Flashcards | `flashcards` | approved | Pro/Unlimited | Deck CRUD/import/question conversion/study/rating | personal state + media | local + D1 + R2 | empty, due=0, limits, delete tree | Critical | Baseline | Existing workspace | Responsive same tree | covered |
| Ready-made tests | `preformed` / join query | public/approved | Pro+ create; participants run | Create/publish/share/join/run/rank/report/moderate | `/preformed/*` | local attempt + D1 | guest, expired token, duplicate submit | Critical | Baseline | Existing large workspace | Responsive same tree | covered |

## Account, collaboration and privileged experience

| Feature | Route/view | Roles | Tiers | Current behavior / input → output | API dependency | Persistence | Edge states | Criticality | Migration | Desktop | Mobile/PWA | Regression |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Account profile/password | `account` | self | all | Edit identity fields/change password | profile/password | D1 | validation/session expiry | Critical | Baseline | Existing forms | Same forms | covered |
| Account deletion | settings/account | self | all | Confirm destructive deletion/anonymization | account delete | D1 + R2 cleanup | partial external cleanup | Critical | Baseline | Dialog | Dialog | covered |
| Settings/theme/sync | `settings` | self | all | Local theme, daily goal, manual sync, role request | state/collaboration | localStorage + IndexedDB + D1 | offline/conflict | High | Baseline | Existing sections | Responsive same sections | covered |
| Subscription/upgrade | `subscribe` + global dialog | self | all | Compare plans, quote coupon, manual paid coordination/free activation | platform billing APIs | D1 | invalid coupon, expiry, limit | Critical | Baseline | Existing plan workspace | Responsive same tree | covered |
| Contribution center | `contribution-center` | approved | all | Credits, rewards, contribution activity | economy APIs | D1 | empty/limit/error | High | Baseline | Existing workspace | Same page | covered |
| Add questions/import | `manager` | contributor/editor | plan/role scoped | Manual question proposals and JSON import | import/media/collaboration | D1 + R2 + local draft | invalid JSON, caps, upload failure | Critical | Baseline | Existing editor | Long responsive form | covered |
| Reviewer queue | `review` | bank/platform reviewer | plan independent | Filter queue, inspect source/change, approve/reject/bulk decide | collaboration/review | D1 | empty, stale claim, permission revoked | Critical | Baseline | Existing workspace | Responsive same tree | covered |
| Access administration | `admin` | access manager/moderator | plan independent | Approve/suspend users and assign allowed roles | collaboration/platform | D1 | protected root, stale records | Critical | Baseline | Existing dashboard | Stacked/tables scroll | covered |
| Superadmin economy/coupons | `/Admin` | MFA superadmin | independent | Manage plans, coupons, rewards, prices and subscription state | platform APIs | D1 | duplicate/race/expiry | Critical | Baseline | Existing admin tabs | Mobile fallback | covered |
| Support/contact | `contact` | self; root sees all | all | Create/read/reply/delete own tickets; root administration | contact APIs | D1 | missing/deleted question | High | Baseline | Existing workspace | Same page | covered |
| Announcements | global shell | approved | all | Server-configured banner with optional link | collaboration records | D1 | hidden/long text | Medium | Baseline | Top banner | Top banner | structural |

## Shared state and interaction contracts

| State/capability | Authoritative ownership | Immediate behavior | Network behavior | Failure/recovery | Phase 3 rule |
| --- | --- | --- | --- | --- | --- |
| Identity/roles/plan | authenticated server session | shell/nav recompute | session refresh + realtime invalidation | gate or retain safe last view | never duplicated in presentation |
| Exam answer/current question/mark | shared application state | optimistic local update | checkpoint in background | retry/outbox/visible sync state | desktop/mobile consume same actions |
| Personal state | IndexedDB working copy + D1 revision | local-first | debounced/checkpoint/full sync | merge/retry; documented multi-device risk | presentation must not block on save |
| Collaboration state | D1 records + local read model | optimistic where allowed | server reauthorizes; durable outbox offline | replay/reload on conflict | presentation shows queued/error status |
| Theme | per-account local preference | immediate DOM class | no server authority | system fallback | presentation-only preference |
| Shell navigation/sheets/panels | presentation layer | immediate | none | route fallback | must not enter shared domain state |

## Phase 3 parity disposition

| Baseline gap | Disposition |
| --- | --- |
| View-only React state and limited deep links | Closed: semantic route adapters and history/popstate synchronization added |
| Presentation mixed into the coordinator | Reduced: environment, shells, Home/Progress models and adaptive overlays extracted; coordinator decomposition remains future maintainability work |
| Scattered mobile flags | Closed: one presentation environment; obsolete hook removed; architecture test prevents reintroduction |
| Abrupt tablet breakpoint | Closed: tablet is a first-class mode with its own navigation rail |
| UA detection and zoom/gesture blocking | Closed: capability/media selection and accessible viewport metadata |
| Physical Apple hardware verification | Open and explicitly unverified |

## Final migration summary

The functional inventory remains the parity contract. Product rules, role/plan checks, server authorization, synchronization, exam persistence and collaboration data were not forked. New presentation-specific composition is limited to shell/navigation, handheld Home, test creation, exam tools, QBank actions, flashcard management and Progress. All retained features passed the 102-test regression suite.
