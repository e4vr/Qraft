# Source-of-truth map

| Concept | Authoritative source | Cached/projected sources | Conflict assessment |
| --- | --- | --- | --- |
| User identity | verified D1 session → `profiles` | React user, resource cache | clear |
| Account status/suspension | profile JSON | collaboration member projection/UI | same originating row, but cached |
| Legacy/platform role | profile JSON | client `isAdmin`, tab visibility | helper-derived; naming conflict risk |
| Effective plan | `applyEffectiveEntitlement()` over five sources | `user.tier/effectivePlan`, badges, local UI | **SOURCE-OF-TRUTH CONFLICT** if base tier is treated as effective plan outside calculator |
| Plan expiry | active entitlement row(s) selected by calculator | user `planExpiresAt`, subscription UI | multiple sources by design |
| QBank ownership | QBank record `ownerId` | UI props | clear |
| QBank membership role | membership record | QBank `reviewerIds`/`viewerIds` arrays | **SOURCE-OF-TRUTH CONFLICT** / duplicate projection |
| Question identity | `question_registry` / retirement tables | shared-question JSON `id/questionId` | registry must win |
| Question content/status | `records:sharedQuestions` and proposal history | seeded JSON/build data; local collaboration | runtime records authoritative after seed |
| Classification | specialty/topic records and revision | question string labels/IDs | **SOURCE-OF-TRUTH CONFLICT** requiring synchronization |
| Review status/history | proposal JSON + completion claims | review workspace cache/preferences | durable proposal/claim wins |
| Exam state | server `app_states` after revisioned sync | IndexedDB and React snapshot | newest/revision merge; offline local can temporarily lead |
| Exam usage limit | `test_registry` | tests array/app UI count | registry/trigger wins |
| Flashcard state | personal `app_states` after sync | IndexedDB/React | newest snapshot merge |
| Progress/daily goal | personal `app_states` | IndexedDB/React/dashboard | server after sync; local while offline |
| Shared answer distributions | `records:answerStats` | collaboration local cache | server record wins after merge |
| Private notes | personal `app_states.progress` | IndexedDB/React | server after sync; local while offline |
| Shared notes | `records:sharedNotes` | collaboration local cache | server record wins after merge |
| Theme | localStorage per-account/active key | server state field forced to `system` | **SOURCE-OF-TRUTH CONFLICT**, apparently intentional per-device preference |
| Audit history | `records:auditLog` | admin weekly read | intended source has client-write integrity weakness |
| Media object | R2 object + D1 `media` metadata | URLs inside content/state | dual consistency required |

## Rules for future work

- Do not infer effective plan from `profiles.profile_json.tier` alone.
- Do not renumber/recreate question identity from question JSON.
- Do not make membership arrays authoritative without reconciling membership records.
- Do not treat IndexedDB as disposable while offline/dirty state may be newer than D1.
- Do not remove legacy schema compatibility checks until deployed databases are inventoried.

