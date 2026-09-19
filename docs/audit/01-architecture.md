# System architecture map

## Runtime overview

```mermaid
flowchart TD
  U[Browser / installed PWA] --> UI[React 19 single-page workspace]
  UI --> LS[IndexedDB, localStorage, sessionStorage]
  UI --> API[/api/cloudflare catch-all route]
  UI --> SW[Service worker shell/static cache]
  UI --> WS[/api/cloudflare/realtime WebSocket]
  API --> AUTH[Custom session authentication]
  AUTH --> POLICY[Roles, ownership, plans, record policy]
  POLICY --> BIZ[State, QBank, exam, review, billing, admin logic]
  BIZ --> D1[(Cloudflare D1)]
  BIZ --> R2[(Cloudflare R2)]
  BIZ --> IK[ImageKit legacy cleanup fallback]
  WS --> DO[RealtimeChannel Durable Object]
  BIZ --> DO
  CRON[Cloudflare cron 01:30 UTC] --> BIZ
```

## Request path

1. `app/page.tsx` renders `components/medguard-app.tsx`.
2. Client helpers in `lib/api-client.ts` and `lib/cloudflare-client.ts` call `/api/cloudflare/...`.
3. `app/api/cloudflare/[...path]/route.ts` applies route-level rate limits and dispatches by path/method.
4. `lib/cloudflare-server.ts` handles authentication, state, collaboration records, IDs, QBank join/share, and media.
5. `lib/platform-server.ts` handles plan/admin/import/review/backup/economy operations.
6. `lib/preformed-test-server.ts` handles preformed-test lifecycle and guest participation.
7. D1 statements and triggers persist authoritative data; R2 stores binary assets and backups.
8. Successful changes publish invalidation topics through `lib/realtime-server.ts`; `workers/realtime.ts` fans them out to authenticated WebSockets.

## Major subsystem map

| Subsystem | Entry points | Inputs / outputs | Persistence | Final policy decision |
| --- | --- | --- | --- | --- |
| Authentication | `cloudflare-server.ts` auth handlers | Credentials/TOTP ↔ session cookie/profile | `profiles`, `sessions`, `university_claims` | Server |
| Personal study state | `GET/PUT /state`, checkpoint routes | `AppState`, revision, operation ID | `app_states`, `state_sync_operations`, `test_registry` | Server + D1 triggers |
| Collaboration | `GET/PUT /collaboration` | record operations/deltas | generic `records` plus classification tables | `recordAllowed()` on server |
| QBank access | `qbank-access-repository.ts`, collaboration policy | user, bank, memberships | `records` | Server |
| Questions/import | platform `question`, `import`; collaboration records | question/proposal/import JSON | `records`, registries, import tables | Server + D1 triggers |
| Exams | client builder/session, platform `test-pool`/`exam-start` | filters, count, answers/checkpoints | `app_states`, `test_registry` | Server + D1 triggers |
| Flashcards | `components/flashcards-workspace.tsx` | decks/cards/FSRS ratings | personal `app_states` + IndexedDB | Server plan/count checks on full state |
| Review | review workspace, `bulk-review`, collaboration proposals | decision/history | `records`, completion claims | Server per-bank/platform role |
| Subscription/economy | subscription workspace and platform routes | quote/code/reward/admin grant | dedicated subscription/economy tables | Server + triggers |
| Preformed tests | preformed workspace/server | owner document, token, submission | dedicated preformed tables | Server |
| Admin | `/Admin`, collaboration dashboard | management reads/mutations | multiple tables/records | Server; root actions require MFA state |
| Media | `/media/*`, `storage-service.ts` | multipart/image bytes | R2 metadata in D1 | Server bank/plan checks |
| Realtime | `/realtime`, DO Worker | channel subscription/invalidation | Durable Object sockets only | Server authorizes channel |

## Error handling

- Server handlers return JSON with explicit 4xx/5xx statuses; the top-level route logs structured `cloudflare_api_error` events.
- State updates use revisions and operation IDs to reject stale writes and make retries idempotent.
- Client resource reads are single-flight and invalidation-driven (`lib/resource-data.ts`).
- UI has dedicated error, not-found, offline, pending, rejected, and suspended surfaces.
- Error wording and catch behavior are not centralized; individual workspaces frequently own their own strings and retry state.

