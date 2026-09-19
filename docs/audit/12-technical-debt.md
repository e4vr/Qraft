# Technical debt map

| Location | Observation | Why it matters | Future phase |
| --- | --- | --- | --- |
| `components/medguard-app.tsx` | 6,891-line SPA coordinator contains routing, dashboard, exam UI, persistence, sync, realtime and plan presentation | very large regression radius; difficult isolated testing | Phase 1 |
| `lib/cloudflare-server.ts` | 3,050-line auth/state/collaboration/media server | policy and persistence changes are tightly coupled | Phase 1, then Phase 3 |
| `lib/platform-server.ts` | 1,929-line switch for unrelated admin, import, review, billing and backup domains | broad endpoint responsibilities and repeated guards | Phase 1 |
| `components/preformed-tests-workspace.tsx` | 2,217 lines combines authoring, catalog, attempt, result and admin flows | high UI/state complexity | Phase 1/4 |
| `records` table + record operations | many logical entities share JSON payload and generic CRUD | no FK/type-level DB integrity; every new type expands a central policy surface | Phase 1/2 |
| roles in profile and helpers | legacy role, platform roles and QBank role coexist | capability reasoning is non-obvious; naming such as `isAdmin` is misleading | Phase 1 characterization, Phase 3 policy review |
| plan sources | base tier, subscription, reward, admin entitlement and override | multiple legitimate sources demand one calculator and careful cache invalidation | Preserve; Phase 1 boundary extraction |
| QBank role projections | owner and membership records plus `reviewerIds`/`viewerIds` projections | synchronization requirements and stale projection risk | Phase 2 |
| classification | string specialty/topic plus IDs/revision tables | duplicate representation can drift | Phase 2 |
| theme | local preference is authoritative in UI while server state is forced to `system` | two representations with different meanings | Phase 1/4 |
| state sync | full snapshots plus three checkpoint endpoints | overlapping logic and divergent validation risk | Phase 1 |
| offline collaboration | local snapshot but no operation outbox | reconnect can leave edits local | Phase 2/5 |
| error handling | workspace-specific strings/catches/toasts | inconsistent retry/user feedback | Phase 1/4 |
| UI dimensions | global `.q-button` plus many direct Tailwind heights/radii | visually similar controls have multiple dimensions | Phase 4 |
| app internal routing | most pages are enum state, not URL routes | poor deep linking/history and one huge initial feature graph | Phase 1/4, preserve behavior first |
| `public/sw.js` | manual cache name and cache-first static assets | update behavior depends on code/version discipline | Phase 4 |
| `app/layout.tsx` iOS guard | mutation observer/event prevention locks zoom in installed iOS | accessibility and gesture side effects | Phase 4 |
| migration 0007/0016 | derived state created then removed; defensive compatibility remains | cleanup cannot be removed until deployed schema versions are proven | Phase 2 |
| generated config typings | names bindings absent from Wrangler config | misleading infrastructure surface | Phase 1 housekeeping after verification |
| checkout | positive-price flow returns WhatsApp URL | business process is manual and state transition external to Qraft | Product/Phase 2, not a refactor-only decision |

## Repeated logic

- Role checks appear in UI tab composition, collaboration record policy, platform routes, realtime authorization, and filtered reads.
- Plan checks appear in UI workspaces, full-state validation, platform endpoints and triggers. This is defense in depth, but policy definitions outside `plan-config.ts` can diverge.
- Record serialization/filtering/auditing/invalidation are repeated around the collaboration collection names.
- API loading/error state is implemented separately by many workspaces despite a shared resource cache.

## Oversized/complex files

| File | Approx. lines | Mixed concerns |
| --- | ---: | --- |
| `components/medguard-app.tsx` | 6,891 | app shell, many pages, exam engine, local/cloud sync |
| `lib/cloudflare-server.ts` | 3,050 | auth, state, collaboration, QBank, IDs, media |
| `components/preformed-tests-workspace.tsx` | 2,217 | owner, participant, leaderboard and reporting UI |
| `lib/platform-server.ts` | 1,929 | admin, plan, import, review, backup, exam operations |
| `components/flashcards-workspace.tsx` | 1,598 | decks, import, FSRS review, editor |
| `components/collaboration-dashboard.tsx` | 1,206 | all administrative areas |

These sizes are not bugs by themselves; they are evidence for extraction boundaries and test-first sequencing.

