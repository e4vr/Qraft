# Risk register

No Critical issue was confirmed during observation-only Phase 0. Security concerns were not exploited.

| ID | Severity | Area | Location | Finding and evidence | Potential impact | Recommended phase |
| --- | --- | --- | --- | --- | --- | --- |
| RISK-AUTH-001 | HIGH | Audit integrity | `lib/cloudflare-server.ts:2174-2175` | `auditLog` set is allowed for any approved user when `value.actorId === user.uid`; action/entity/detail are not server-derived in that branch | misleading/forged administrative history under the user’s identity | Phase 3 |
| RISK-ENT-001 | HIGH | Entitlements | `lib/cloudflare-server.ts:949-958` | private-note comparison runs only when `storedState` exists; first full-state save can contain note text without equivalent check | Lite/Free entitlement bypass and unexpected private data persistence | Phase 3 |
| RISK-PRIV-001 | HIGH | Data privacy | `lib/preformed-test-server.ts:554-563` | leaderboard requires only an approved account and a non-hidden known ID; no owner/public/published test check | exposure of participant names/scores for private or draft tests to another approved user who knows the ID | Phase 3 |
| RISK-SYNC-001 | HIGH | Offline collaboration | `components/medguard-app.tsx:6025-6027, 6097-6113` | offline collaboration saves locally, while online handler flushes personal state only; no collaboration operation outbox | edits can remain local or be overwritten after reconnect | Phase 2/5 |
| RISK-DATA-001 | HIGH | Referential integrity | `db/schema.ts:records`, `cloudflare-server.ts` record deletes | generic QBank-related rows lack FKs/cascades; cleanup is client/server operation coordination | orphan memberships/proposals/notes/media or partial deletion after unusual API sequence | Phase 2 |
| RISK-SYNC-002 | MEDIUM | Cross-device state | `lib/merge-app-state.ts` | tests/progress/custom questions/flashcards choose a whole newest snapshot | independent edits on two devices can be lost | Phase 2/5 |
| RISK-DEV-001 | MEDIUM | Reproducibility | Wrangler configs vs installed workerd | `npm run dev` fails: config date 2026-09-09 > local max 2026-09-07 | blocks standard local onboarding/audit and can mask environment drift | Phase 1 tooling slice |
| RISK-ARCH-001 | MEDIUM | Maintainability | 6,891/3,050/1,929-line core files | UI, policy, persistence and orchestration are concentrated | high regression radius, slow reviews, duplicated guards | Phase 1 |
| RISK-PERF-001 | MEDIUM | JavaScript | `dist/client/.../medguard-app-*.js` | main app chunk is 702,656 bytes uncompressed; single state-router imports broad product surface | slow parse/evaluation on low-end devices; expensive initial load | Phase 1/4 |
| RISK-PWA-001 | MEDIUM | Accessibility/iOS PWA | `app/layout.tsx` iOS guard | installed-iOS code adds `user-scalable=no`, maximum-scale and prevents gesture/double-tap/ctrl-wheel zoom | users needing zoom can be blocked; gesture side effects | Phase 4 |
| RISK-PWA-002 | MEDIUM | Offline | `public/sw.js` | only offline shell/core assets are precached; navigation falls back to `/offline`, API is network-only | cold/offline product use is limited despite local-first state | Phase 4/product decision |
| RISK-ROLE-001 | MEDIUM | Authorization clarity | role helpers and `user.isAdmin` | legacy roles, platform roles and bank roles overlap; `isAdmin` means access-manager hierarchy | wrong future guard/visible navigation if developer assumes the name literally | Phase 1/3 |
| RISK-BILL-001 | MEDIUM | Billing operations | platform checkout | positive-price flow only creates a WhatsApp coordination URL | external/manual activation can be delayed or inconsistent; no payment webhook source | Product/Phase 2 |
| RISK-CACHE-001 | MEDIUM | Account refresh | `medguard-app.tsx:6147` | hidden document skips account refresh; invalidation is stale-mark only | plan/role/status badge or navigation can remain stale until later read/refresh | Phase 2/5 |
| RISK-UI-001 | MEDIUM | Responsive/admin tables | `collaboration-dashboard.tsx:857` | root members table has `min-width:1120px` and relies on horizontal scroll container | dense mobile/tablet management and discoverability burden | Phase 4 |
| RISK-UI-002 | LOW | Design consistency | global CSS + direct utility classes | action controls use 38/40/42/44+ px heights and multiple radii | visual/touch inconsistency | Phase 4 |
| RISK-INFRA-001 | LOW | Config hygiene | examples/types | `R2_PUBLIC_URL` and several generated binding names have no active source/config counterpart | operator confusion | Phase 1 after deployment verification |

