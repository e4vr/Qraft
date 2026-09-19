# Codebase map

## Important tree

```text
app/
├─ app/
│  ├─ api/cloudflare/[...path]/route.ts   # catch-all Worker API dispatcher/rate limits
│  ├─ Admin/page.tsx                      # superadmin route
│  ├─ offline/page.tsx                    # PWA offline fallback
│  ├─ error.tsx / not-found.tsx
│  ├─ layout.tsx                          # metadata, viewport, iOS installed-PWA guard
│  └─ page.tsx                            # main app entry
├─ components/                            # user/admin workspaces and UI primitives
│  ├─ medguard-app.tsx                    # primary SPA coordinator (6,891 lines)
│  ├─ preformed-tests-workspace.tsx       # preformed tests (2,217)
│  ├─ flashcards-workspace.tsx            # flashcards/FSRS (1,598)
│  ├─ collaboration-dashboard.tsx         # admin UI (1,206)
│  ├─ qbank-workspace.tsx                 # QBank library/access (1,183)
│  ├─ qbank-management.tsx                # bank/question management (856)
│  ├─ review-workspace.tsx                # proposal review (832)
│  ├─ subscription-workspace.tsx          # plans/checkout (761)
│  └─ ui/                                 # Base UI/shadcn-style primitives
├─ db/schema.ts                           # Drizzle D1 schema
├─ drizzle/0000…0019.sql                  # migration history and seed data
├─ data/questions.json                    # 217 seeded General Surgery questions
├─ hooks/use-mobile.ts
├─ lib/
│  ├─ cloudflare-server.ts                # auth/state/collaboration/media (3,050)
│  ├─ platform-server.ts                  # platform/admin/entitlement APIs (1,929)
│  ├─ preformed-test-server.ts            # preformed test API (903)
│  ├─ entitlement-server.ts / plan-config.ts
│  ├─ cloudflare-client.ts / api-client.ts / resource-data.ts
│  ├─ local-db.ts / merge-app-state.ts / merge-live-state.ts / tab-sync.ts
│  ├─ realtime-client.ts / realtime-server.ts
│  ├─ storage-service.ts / question-backup.ts
│  └─ focused repositories and validators
├─ public/
│  ├─ manifest.webmanifest / sw.js / icons
│  └─ static brand/social assets
├─ tests/                                 # static, unit and Miniflare integration tests
├─ worker.ts                              # Vinext Worker + cleanup + scheduled jobs
├─ workers/realtime.ts                    # Durable Object WebSocket fan-out
├─ wrangler.jsonc / wrangler.realtime.jsonc
├─ vite.config.ts / next.config.ts / tsconfig.json
└─ README.md / ARCHITECTURE.md / REALTIME.md / analysis notes
```

## Repository-wide observations

- **Frontend routing:** only `/` and `/Admin` are meaningful page routes. Most product “pages” are a `View` state inside `medguard-app.tsx`, so browser history/deep-link behavior is limited.
- **Backend routing:** one dynamic route dispatches many endpoints. There is no separately deployable conventional backend service.
- **Database access:** direct SQL is spread across server modules; Drizzle defines schema but most runtime queries use `env.DB.prepare()`.
- **Legacy artifacts:** migration `0007` introduced derived sync/stat tables; `0016` removed them. Deletion code still defensively detects old tables. Existing `.ui-review` and `dist` are ignored/generated audit or build artifacts, not source-of-truth.
- **CI/CD:** **NOT FOUND** in the repository (`.github/workflows`, other pipeline definitions absent).
- **Queues/background workers:** no Cloudflare Queue binding. Background work is the daily cron and realtime Durable Object.

## Configuration files

| File | Responsibility |
| --- | --- |
| `package.json` / lock | versions and commands |
| `vite.config.ts` / `next.config.ts` | Vinext/Vite application build |
| `wrangler.jsonc` | main Worker, D1, R2, DO service binding, rate limits, cron |
| `wrangler.realtime.jsonc` | realtime Worker and DO migration |
| `db/schema.ts` | current intended D1 schema |
| `drizzle/*.sql` | deployed migration history |
| `.env.example`, `.dev.vars.example` | environment-variable contract |
| `worker-configuration.d.ts` | generated binding types; includes names not present in active Wrangler configuration |

