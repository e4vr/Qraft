# Local account and account-experience audit

## Isolated environment

The existing ignored `.ui-review/production-preview.mjs` starts a local Miniflare Worker with ephemeral D1/R2/DO resources and direct local fixture-session routes. It does not alter production and is not shipped as application source.

| Fixture | Actual stored state | Audit use |
| --- | --- | --- |
| `lite` route/control | student, **tier `pro`** | Pro learner visual/runtime inspection only; label is wrong |
| `admin` route/control | `super_admin`, Pro, enrolled/verified fixture MFA | superadmin visual/runtime inspection |

The normal local D1 was queried read-only and contained one approved student; no login credential was discovered or used. No persona or data was created.

## Account experience matrix

Cells marked **Runtime** were seen in the local preview; **Code/test** is not a visual claim.

| Feature / UI | Lite/Free | Pro | Reviewer | QBank owner/editor/reviewer | Superadmin |
| --- | --- | --- | --- | --- | --- |
| Learner navigation | Code: core study + Subscribe, contributions | **Runtime** full learner nav | Code/test adds Review | Code/test adds management/review by membership | **Runtime** learner nav + Review + Superadmin link |
| Dashboard/progress/history | Code/test | Runtime | same plan experience | same plan experience | Runtime |
| Create QBank | hidden/upgrade | Runtime capability | depends on plan | owner role after creation/invite | allowed |
| Private QBank | hidden/upgrade | available | depends on plan | owner manages own | all |
| Exam limit messaging | 2 lifetime / 30 monthly, smaller test | 250/month, 200/test | plan unchanged | plan unchanged | effective plan/override |
| Flashcards/private notes | hidden/upgrade | Runtime nav and empty flashcard page | plan unchanged | plan unchanged | effective plan |
| JSON import | hidden | available in management | plan + bank authority | editor/owner and plan | available |
| Review controls | none unless bank role | none unless role | Code/test reviewer queue | bank-scoped reviewer/editor/owner | Runtime navigation; all scope |
| QBank access controls | join/view only | create/join | role-specific | owner share/members; editor content; reviewer decisions | all |
| Admin controls | none | none | reviewer-only operations, not general admin | none by ownership alone | Runtime full `/Admin` navigation |
| Upgrade/subscription | visible | subscription page/status/extend | plan unchanged | plan unchanged | can administer all plans/codes/economy |
| Account settings | own profile/password/delete | Runtime | same | same | Runtime account + MFA identity |

## Frontend vs backend comparison

| Feature | UI visibility/disable | API authorization | Server entitlement | DB protection | Assessment |
| --- | --- | --- | --- | --- | --- |
| QBank creation | upgrade gate | collaboration endpoint | plan + record policy | generic records only | aligned |
| Exam starts/count | builder clamp/error | test-pool/exam-start/state | plan usage | registry triggers | aligned |
| Flashcards | absent/upgrade below Pro | state endpoint | count/feature check | none specific | aligned for existing server state |
| Private notes | hidden below Pro | state/media | media aligned; first text-state save gap | none | **ENTITLEMENT MISMATCH** |
| JSON import | hidden below Pro | import endpoint | daily/file/pending/suspension checks | triggers | aligned |
| Reviewer/admin tabs | role-gated | route/record helpers | role/ownership | some business rules only in app | server is final authority |
| Subscription admin | hidden | platform routes | root + MFA | transactional tables/triggers | aligned |

## Role and plan combinations

The model allows plan and role to coexist independently. Supported meaningful combinations include Lite/Pro owner, Pro reviewer, reviewer + owner, and platform role + bank role. No code-level prohibition was found. Only Pro learner and superadmin/Pro were visually available.

## Plan/role transition behavior

| Transition | Current mechanism | Expected client refresh from code | Verification |
| --- | --- | --- | --- |
| Lite → Pro / renewal | subscription/reward/override mutation | user-channel invalidation; session refetch; local event for same client | code/tests, not visual |
| Pro → expired | daily cron changes status | user invalidation when job returns affected users; next authenticated read recalculates | code/tests |
| Coupon → Pro | atomic zero-price checkout | mutation response + invalidation/refetch | tests |
| User → reviewer / removed reviewer | profile/platform-role collaboration mutation | account invalidation; navigation recomputed | code only |
| User → QBank owner/editor/reviewer | QBank/membership record change | bank invalidation and collaboration refetch | code/tests |

Hidden documents skip immediate account/collaboration refresh callbacks. The resource cache is marked stale, but the exact time the already-rendered navigation/badge updates after visibility returns is **NOT VERIFIED**.

## Cross-device consistency

| State | Intended scope | Mechanism | Main risk |
| --- | --- | --- | --- |
| Exam/answers/progress/daily goal | account/server synchronized | checkpoints/full state + revisions | whole-snapshot conflict on independent devices |
| Flashcards/ratings | account/server synchronized | app state + merge | newest whole snapshot can win |
| Private notes | account/server synchronized for Pro+ | app state/media | first-save entitlement mismatch; snapshot conflicts |
| QBank/shared changes | server collaborative | record ops + realtime invalidation | offline replay gap |
| Theme | intentionally local | localStorage | expected device difference |
| Preformed guest identity/attempt counters | device/browser local plus server token | localStorage/IndexedDB + token | another device is a distinct guest identity |

## Direct inspection paths

The ignored preview harness exposes local-only routes `/qa/login/lite` and `/qa/login/admin`. They are test harness behavior, not application routes and not suitable for production. Because the “lite” fixture is actually Pro and other personas are absent, these paths must not be documented as complete persona coverage or retained as product backdoors.

