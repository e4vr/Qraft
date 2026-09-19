# Client state and local-first map

## Storage inventory

| Store | Keys/content | Lifetime | Sync behavior |
| --- | --- | --- | --- |
| React/in-memory state | account, view, personal state, collaboration, active test/UI state | tab | orchestrates all views |
| IndexedDB | database `medguard-qbank`, object store `key-value`; user state, collaboration snapshot, classification drafts, preformed attempts/code references, pending cloud state | persistent | primary local workspace/offline cache |
| localStorage | active/per-account theme, contribution celebration memory, guest preformed participant key/attempt counters | persistent | mostly intentionally local |
| sessionStorage | `qraft-client-instance` | tab/session | request origin/loop identification |
| BroadcastChannel | `qraft-state-sync` | live tabs | same-browser state notices |
| Cache API | service-worker shell/static asset cache | persistent | no API response cache |
| Map cache | `resource-data.ts` request results/metrics | session memory | tag-invalidated, single-flight |

`navigator.locks` serializes same-account state sync where supported.

## Action persistence map

| Action | Immediate local | Server timing | Cross-device |
| --- | --- | --- | --- |
| Exam navigation/selected answers/marks | IndexedDB immediately (0 ms path) | exam checkpoints and leave/hide save | yes after successful sync |
| Notes/note images | IndexedDB | full/checkpoint state; media uploads immediate | yes after sync; Pro+ intended |
| Daily goal | IndexedDB | dedicated PUT immediately | yes |
| Flashcard CRUD/rating | IndexedDB immediately | checkpoint/full save; CRUD debounce ~800 ms | yes after sync |
| Theme | localStorage | server state theme is normalized to `system` | intentionally per-device |
| Contribution/shared QBank edits | local collaboration snapshot | diff save ~150 ms while online | realtime invalidation/refetch |
| Classification draft | IndexedDB | only when submitted | local until submit |
| Preformed attempt | IndexedDB/localStorage token references | submit endpoint | server participation/result after submit |

## Merge behavior

- `merge-app-state.ts` selects the newest whole snapshot for tests, progress, custom questions, and flashcards.
- Reports, revision information, and review logs are unioned/merged.
- Exact timestamp ties prefer the server.
- `merge-live-state.ts` performs three-way merging for selected collaboration data so local drafts can survive unrelated remote changes and remote deletions remain authoritative.

## Offline behavior

- When browser offline state is detected, the app shows `SystemStatePage`. “Continue offline” is offered only when account and both local state domains are hydrated.
- Local personal changes are saved to IndexedDB. Pending personal cloud state is replayed on the `online` event.
- New exam start is blocked offline to preserve usage-limit registration.
- APIs are never cached by the service worker.
- Collaborative changes made offline are saved locally but are not added to the personal state outbox. No explicit collaboration replay occurs in the `online` handler. This is RISK-SYNC-001.

## Conflict scenarios

| Scenario | Current behavior | Risk |
| --- | --- | --- |
| Two tabs, same account | BroadcastChannel + lock + revisions | comparatively controlled |
| Two devices edit same whole personal collection | newest snapshot wins | older independent edits can be lost |
| Two users edit collaboration | operation validation + three-way live merge | conflicts rejected/merged by record/version |
| Offline personal edits then reconnect | outbox flush | retry expected |
| Offline collaboration edit then reconnect | local snapshot retained; replay not explicit | may remain local until another trigger/manual sync |
| Plan/role changes while hidden | cache invalidated; account refresh callback skips hidden document | visible UI refresh timing not proven |
