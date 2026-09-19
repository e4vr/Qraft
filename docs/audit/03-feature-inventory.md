# Feature inventory

Status reflects code present at the audited commit, not product intent.

| Feature | Frontend | Backend/API | Database | Permission / plan | Status |
| --- | --- | --- | --- | --- | --- |
| Registration/login/logout | auth forms in `medguard-app.tsx` | `/auth/register`, `/login`, `/logout`, `/session` | profiles/sessions/claims | public; account-status gates | Implemented |
| Superadmin TOTP MFA | login/enrolment screens | `/auth/mfa*` | profile JSON + verified session | singleton superadmin | Implemented |
| Profile/password/account deletion | account/settings | profile/password/account routes | profiles + anonymization/deletion tables | self; server verified | Implemented |
| QBank library/folders/bookmarks | `qbank-workspace.tsx` | collaboration + folder delete | `records` | approved user; folder scope varies | Implemented |
| Public/private QBank creation | QBank management | collaboration record operations | `records:qbanks` | Pro+; private Pro+ | Implemented |
| Share links/invites/join | QBank access UI | invite-preview/join + collaboration | records | owner creates; server validates | Implemented |
| QBank owner/editor/reviewer/viewer | management/review/nav UI | record policy helpers | membership records + owner ID | per-bank | Implemented |
| Question create/edit/delete | manager/editor surfaces | collaboration + platform question | records + identity registries | contributor/editor/reviewer/owner | Implemented |
| Stable question IDs | displayed/imported | reserve/release repository | registry/allocator/free-pool/retired | server + triggers | Implemented |
| JSON question import | management import | platform import/status | import tables + proposals | Pro/Unlimited limits | Implemented |
| Images/media | question/note UI | media upload/read/delete | R2 + media metadata | access + kind/plan checks | Implemented |
| Edit suggestions/reviewer queue | contribution/review workspaces | collaboration + bulk review/history | proposal records/claims | reviewer or bank reviewer | Implemented |
| Question reports | exam/preformed UI | contact/preformed report APIs | tickets/preformed_reports | participant/approved user | Implemented |
| Test builder/random/custom tests | `CreateTest` in main app | test-pool/exam-start | test registry/app state | plan count/size limits | Implemented |
| Tutor/timed exam session | main test screen | checkpoint state routes | app state + sync operations | authenticated/plan | Implemented |
| Navigation/answers/marking/notes/labs | main test screen | state checkpoints/full save | app state | private notes Pro+ | Implemented |
| Results/history/review/distributions | main app + answerStats | state/collaboration | app state + records | bank access | Implemented |
| Progress/daily goal/streak | dashboard/progress/settings | state/daily-goal | app state | self | Implemented |
| Flashcards/decks/import/FSRS | flashcard workspace | personal state | app state | Pro+ and deck/card caps | Implemented |
| Preformed tests/guest attempts | preformed workspace | `/preformed/*` | dedicated tables | create Pro+; owner manage | Implemented |
| Realtime invalidation | invisible client integration | realtime endpoint + DO | socket state only | authenticated channels | Implemented |
| Search | admin, reviewer, library/local filters | scoped reads/search helpers | several sources | role-specific | Implemented, fragmented |
| Contact/support tickets | contact workspace | `/contact` | tickets/messages | self; root administration | Implemented |
| Subscriptions/upgrade | subscribe workspace | quote/checkout/subscriptions | dedicated tables | self/root | Implemented; paid path is manual |
| Coupons/discounts | subscription/admin UI | quote/checkout/discounts | discount/event tables | root manages; user redeems | Implemented |
| Contribution rewards/credits | contribution/admin UI | rewards/economy endpoints | economy tables | all plans contribute; root administers | Implemented |
| Admin/access management | collaboration dashboard | collaboration/platform APIs | profiles/records | moderator/access manager | Implemented |
| Superadmin platform management | `/Admin` | root APIs | all relevant sources | superadmin + MFA where required | Implemented |
| PWA install/offline shell | manifest/service worker/system page | static Worker response | browser caches/IndexedDB | all users | Partially implemented offline-first |
| Light/dark/system mode | global UI/settings | server forces state theme to system; local preference used | localStorage | self | Implemented with split source |
| Notifications | announcement bar and in-app status/toasts | announcement/realtime invalidation | records | root publishes | Partially implemented; no push/email system found |

## Not found

- External payment gateway or webhook.
- Email/SMS delivery provider.
- Cloudflare Queues or Vectorize.
- Push Notification API registration.
- General collaborative document editing beyond record operations/invalidation.

