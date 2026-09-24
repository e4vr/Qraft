# Phase 0 baseline

Captured 2026-09-24 on branch `audit/performance-first-pass`. This document describes the inspected working tree. It does not assert that the same commit is deployed to production.

## Runtime map

| Area | Current design | Primary code |
|---|---|---|
| Frontend | React 19 client application served through vinext/Vite. Route pages delegate to the shared application shell. | `app/**/page.tsx`, `app/qraft-route.tsx`, `components/medguard-app.tsx` |
| API | One catch-all `/api/cloudflare/[...path]` adapter dispatches by method and path. | `app/api/cloudflare/[...path]/route.ts`, `server/api/cloudflare-router.ts` |
| Worker | Main Worker serves vinext and intercepts realtime; a separate Durable Object Worker owns WebSockets. | `worker.ts`, `workers/realtime.ts` |
| Database | Cloudflare D1. Typed tables cover identity, sessions, state synchronization, classification, duplicates, reviews, billing and operations. A polymorphic `records` table stores many collaboration collections as JSON. | `db/schema.ts`, `drizzle/*.sql`, `lib/cloudflare-server.ts`, `lib/platform-server.ts` |
| Authentication | Cookie session lookup joins the session and profile; a request-scoped `WeakMap` memoizes the result for a request and cloned mutation notification request. MFA is required for privileged Superadmin access. | `features/auth/server/auth-service.ts`, `lib/cloudflare-server.ts:268-324` |
| Authorization | Domain policies check platform roles, memberships, bank access, plan limits and subscription state at the API boundary. | `features/access/domain/access-policy.ts`, `lib/qbank-access-repository.ts`, server services |
| State | Personal state is stored as one normalized JSON document in `app_states` with revision and operation idempotency. Collaboration state is a permission-filtered projection of `records`. | `features/state/**`, `features/collaboration/**`, `lib/cloudflare-server.ts` |
| Client cache | Canonical resource keys, memory cache, mutation/realtime invalidation, and single-flight deduplication. Personal/collaboration/preformed state also has IndexedDB persistence. No React Query/TanStack Query. | `lib/resource-data.ts:24-47`, `lib/resource-data.ts:140-205`, `lib/local-db.ts`, `lib/api-client.ts` |
| Realtime | One Durable Object audience per user, bank, catalog, admin, or access channel. The DO uses the WebSocket hibernation API and broadcasts invalidation topics only. | `lib/realtime-client.ts`, `lib/realtime-server.ts`, `workers/realtime.ts` |
| Object storage | R2 stores media and backups. Media reads increment a D1 usage counter. | `lib/storage-service.ts`, media and backup services |
| PWA | Navigation is network-first with `/offline` fallback; static assets use stale-while-revalidate; `/api/*` requests bypass the service worker. | `public/sw.js:42-76`, `app/offline/page.tsx` |
| Scheduled work | Daily question backup, deleted-media cleanup, state/classification operation cleanup, preformed-operation cleanup, and subscription expiry. | `worker.ts:31-45` |

## Application routes

The main user-facing route families are:

- `/` dashboard/home;
- `/qbanks` and `/qbanks/[id]` bank browsing and management;
- `/exams/new` and `/exams/[id]` test construction and exam session;
- `/history`, `/progress`, `/study`, and `/flashcards` personal study state;
- `/ready-tests` preformed tests;
- `/contribute/questions`, `/contributions`, and `/review` contribution/reviewer flows;
- `/account`, `/settings`, `/subscription`, and `/support` account flows;
- `/access` and `/Admin` privileged operations;
- `/offline` PWA fallback.

Most routes mount `MedGuardApp`. The main component is therefore a shared hydration and realtime boundary, not an independent data-fetching page per URL.

## API surface

All paths below sit under `/api/cloudflare`.

| Family | Methods and purpose |
|---|---|
| `/auth/*` | Register, login, MFA, session, profile/password changes, logout, account deletion. |
| `/state`, `/state/{exam,flashcards,daily-goal}` | Full personal state and scoped checkpoints. |
| `/collaboration` | Permission-filtered collaboration snapshot and batched record mutations. |
| `/platform/*` | Announcement, legal links, questions, test pool, imports, duplicates, review history/performance, subscriptions, discounts, economy, audit and administration. |
| `/preformed/*` | Preformed test list, detail, revisions and mutations. |
| `/qbanks/*`, `/qbank-folders/*`, `/ids/reserve` | Invitations, joining, folder deletion, id allocation. |
| `/contact` | Ticket list, search and mutations. |
| `/media/*` | R2 upload, serve and deletion. |
| `/realtime` | Authenticated WebSocket upgrade routed to an audience Durable Object. |

The router applies three rate-limit bindings, dispatches the handler, then synchronously publishes realtime invalidation for successful changed mutations (`server/api/request-lifecycle.ts`).

## D1 access and schema shape

Most D1 SQL is concentrated in:

- `lib/cloudflare-server.ts`: authentication, state, collaboration, media and qbank operations;
- `lib/platform-server.ts`: administration, imports, reviews, subscriptions and product operations;
- `lib/test-pool-server.ts`: eligible-question selection;
- `lib/qbank-access-repository.ts`: bank and membership authorization state;
- `lib/contact-server.ts`, `lib/preformed-test-server.ts`, backup and storage services.

The central `records` indexes currently include `(type,id)`, `(type,email)`, `(qbank_id,type)`, `(type,updated_at)`, `(type,owner_id,updated_at)`, plus specialized expression/partial indexes. Existing indexes are sufficient for the primary collaboration fix; the current SQL shape prevents SQLite from selecting them efficiently.

## Frontend network baseline

An authenticated cold application hydration is expected to request approximately:

1. `/auth/session`;
2. `/platform/announcement`;
3. `/state`;
4. `/collaboration`;
5. route/RSC/static assets.

The cache is event-driven rather than time-driven. There is no generic window-focus refetch or recurring API polling. Search surfaces inspected use debounce (for example 180 ms or 250 ms). The service worker does not cache API responses. Equivalent concurrent reads are single-flight deduplicated, so multiple consumers can resolve from one physical request.

The idle application has local clocks/timers and open WebSockets. No justified recurring HTTP API request was found for an unchanged visible page. This becomes an explicit Phase 12 acceptance test.

## Realtime baseline

The client opens a user channel, catalog channel, one channel per visible/accessible bank, and privileged admin/access channels when applicable. Each connection authenticates independently; a bank channel also loads bank access state. The Durable Object correctly uses `acceptWebSocket`, serialized attachments and hibernation-compatible event handlers.

Every previously connected channel calls the generic `connected` callback when it reconnects (`lib/realtime-client.ts:52-69`). The application responds by refreshing both account and collaboration (`components/medguard-app.tsx:6806-6809`). Single-flight collapses overlapping refreshes, but staggered socket reconnects can create multiple refresh waves.

## Background and lifecycle behavior

- The daily cron is `30 1 * * *` in `wrangler.jsonc`.
- The service worker refreshes static cached responses in `waitUntil`, uses network-first navigation, and skips API traffic.
- Exam state is checkpointed on exit; flashcards have their own checkpoint path.
- Realtime reconnect uses exponential backoff capped at 30 seconds plus jitter.
- No application API fetch uses a general `AbortController`; most component effects guard completion with an `active`/`stopped` flag.

## Production metric baseline supplied for this audit

| Metric | 24-hour observation | Derived value |
|---|---:|---:|
| Worker invocations | 2,085 | 62,550 per 30 days |
| D1 queries | 16,000 | 7.67 per invocation; 480,000 per 30 days |
| D1 rows read | 46,000,000 | 2,875 per query; 22,062 per invocation; 1.38B per 30 days |
| D1 rows written | 101,000 | 48.4 per invocation; 3.03M per 30 days |
| D1 size | 12.7 MB | small relative to rows scanned |
| `exceededResources` | 7 | 0.34% of invocations if counts share the same window |
| `clientDisconnected` | 454 | 21.8% of invocations; categories may overlap |
| `responseStreamDisconnected` | 426 | 20.4% of invocations; categories may overlap |

These ratios establish abnormal amplification but do not identify routes. Worker observability currently samples only 1% (`wrangler.jsonc:8-12`), which is too sparse to attribute seven daily resource errors reliably.

## Production data snapshot and read-only probes

The production D1 database reported 12,742,656 bytes and 5,663 rows in `records`, including 2,831 `auditLog`, 1,124 `sharedQuestions`, and 52 `answerStats` records. Read-only `EXPLAIN QUERY PLAN` and aggregate probes confirmed the collaboration scans described in [D1 query analysis](./d1-query-analysis.md). Probing stopped when Cloudflare returned the Free daily row-read-limit error.

## Build baseline

`npm.cmd run build` completed successfully. The generated client contains 41 files totaling 2,464,442 bytes uncompressed. Largest assets:

| Asset | Uncompressed | Gzip observed during build |
|---|---:|---:|
| Main MedGuard JavaScript | 745,785 B | 198,997 B |
| SQL.js WASM | 658,410 B | 321,797 B |
| CSS | 197,011 B | 32,394 B |
| React/framework chunk | 190,109 B | 58,914 B |
| vinext chunk | 146,659 B | 43,477 B |

The build warns about chunks over 500 KB. SQL.js is imported for the Anki/flashcard path and emitted as a separate WASM asset; a browser trace is required before claiming it is part of every initial navigation.

## Tests and deployment workflow

Available commands from `package.json`:

- `npm.cmd test` — Node test suite;
- `npm.cmd run lint` — oxlint;
- `npm.cmd run build` — production build;
- `npm.cmd run cloudflare:check` — Wrangler dry-run;
- `npm.cmd run db:migrate:local` — local D1 migrations;
- `npm.cmd run deploy:realtime`, then `npm.cmd run deploy:app` — two-step deployment.

Baseline test result: **125 tests passed, 0 failed** in about 73.7 seconds. The build also passed. No repository CI workflow was found, so deployment appears command-driven and must be confirmed operationally before Phase 10 release planning.

## Baseline limitations

- The supplied 24-hour metrics are aggregate counters and may cover different boundaries or overlapping error categories.
- Current source includes uncommitted work and may differ from the deployed revision.
- Production observability sampling does not provide route-level CPU, query metadata or response sizes.
- Single-run D1 timings are diagnostic examples, not latency distributions.
- The production read quota was exhausted during read-only analysis, so the audit did not continue querying for low-value counts.
