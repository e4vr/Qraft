# Executive summary

## Current technical state

Qraft is a single-deployment React 19 application built with Vinext/Vite and hosted on Cloudflare Workers. A catch-all server route implements authentication, application state, collaborative QBank records, media, subscriptions, rewards, imports, admin operations, and preformed tests. D1 is the authoritative server store, R2 stores media and question backups, and a separate Durable Object Worker distributes read-only invalidation events over WebSockets.

The product surface is broad and materially implemented: custom authentication/MFA, QBank creation and sharing, question contribution/review, exams, local/cloud progress, flashcards, subscriptions/coupons/rewards, contact tickets, admin/superadmin tools, and PWA behavior. Existing tests provide useful coverage: all 80 tests passed in the isolated audit run.

The principal architectural risk is concentration. `components/medguard-app.tsx` (6,891 lines), `lib/cloudflare-server.ts` (3,050), and `lib/platform-server.ts` (1,929) mix orchestration, policy, persistence, state transitions, and UI. The generic JSON `records` table provides flexibility but moves referential integrity and many invariants from D1 into application code.

## Highest-priority findings

No **CRITICAL** issue was confirmed without exploit testing. The following **HIGH** findings have direct code evidence:

1. **Audit-log integrity:** any approved user can submit an `auditLog` record when `actorId` equals their own UID; action/detail contents are otherwise client-controlled (`lib/cloudflare-server.ts:2174`).
2. **Private-note entitlement mismatch:** the full-state save blocks changes to private notes only when a prior server state exists. A first state save has no prior state and can include notes (`lib/cloudflare-server.ts:949`).
3. **Preformed leaderboard scope:** any approved user who knows a non-hidden test ID can read its leaderboard; the endpoint does not require ownership, publication, or public visibility (`lib/preformed-test-server.ts:554`).
4. **Offline collaboration durability:** collaborative edits are saved locally while offline but are not placed in the personal-state outbox, and the `online` handler flushes only personal state. Automatic replay of an unchanged offline collaboration snapshot is therefore not assured (`components/medguard-app.tsx:6025`, `6099`).

Important **MEDIUM** risks include development-runtime incompatibility, whole-snapshot last-write-wins merging for some cross-device state, generic-record orphan risk, oversized modules and bundle, manual checkout coordination through WhatsApp, and accessibility impact from disabling pinch zoom in installed iOS mode.

## What is working well

- Server-side session verification, secure cookie flags, rate-limit bindings, origin checks on mutations, and PBKDF2 password hashing are present.
- Important plan limits are generally enforced on the server and reinforced by D1 triggers for exam/import/economy paths.
- QBank ownership, editor, reviewer, access-manager, moderator, and superadmin decisions are represented in server policy helpers rather than UI-only checks.
- Question identity is protected by registry/retirement tables and triggers.
- Realtime messages are invalidations, not authoritative data payloads; the client refetches server state.
- Test fixtures verify important authorization, atomicity, idempotency, R2 privacy, account deletion, and subscription behavior.

## Phase readiness

Qraft is ready for a **carefully sequenced Phase 1 refactor**, provided Phase 1 begins with characterization tests and extraction around existing behavior rather than schema or policy redesign. Security/entitlement issues above should be reserved for the authorized security phase, except where Phase 1 needs protective tests to prevent accidental regression. Production migration, role redesign, plan redesign, and UI redesign should remain out of the first refactor slice.

