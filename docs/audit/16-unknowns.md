# Unverified and unknown items

## Infrastructure and production

- **NOT VERIFIED:** actual deployed commit, Worker versions, production domain/DNS, Cloudflare dashboard bindings, secret presence, D1 migration level, R2 lifecycle/access policy, cron executions, rate-limit behavior and observability logs.
- **NOT VERIFIED:** production data cardinality, query latency, R2 usage, orphan incidence and real account distribution.
- **NOT VERIFIED:** ImageKit legacy records still present or reachable.
- **NOT FOUND:** CI/CD pipeline definition in this repository.

## Authentication, billing and administration

- **NOT VERIFIED:** root bootstrap in a clean production-like environment.
- **NOT VERIFIED:** real authenticator-app enrollment/recovery and clock-skew behavior.
- **NOT VERIFIED:** operational process after the WhatsApp payment handoff, refund/cancellation/renewal handling, or billing reconciliation.
- **NOT VERIFIED:** whether every current production admin understands the distinction between legacy and platform roles.

## Devices and PWA

- **NOT VERIFIED — ENVIRONMENT UNAVAILABLE:** installed PWA on physical iPhone, iPad or Android; notch/Dynamic Island, home indicator, rubber-band scrolling, status bar, orientation, software keyboard and splash/install behavior.
- **NOT VERIFIED:** Safari-specific IndexedDB eviction, background suspension and WebSocket reconnect behavior.
- **NOT VERIFIED:** actual touch/assistive-technology experience; source includes focus/reduced-motion/touch rules but no manual screen-reader session was available.
- **NOT VERIFIED:** slow 3G, CPU throttling, memory pressure, INP, LCP and CLS on a production build.

## Personas and workflows

- **VERIFIED locally:** a Pro learner fixture and superadmin fixture in an existing ignored ephemeral preview.
- **NOT VERIFIED visually:** real Lite/Free, reviewer-only, access-manager-only, QBank owner/editor/reviewer, expired, coupon-activated, manually activated and mixed-role personas.
- The preview control labelled “Lite” is actually seeded with `tier: 'pro'`; it is unsuitable for Lite conclusions.
- **NOT VERIFIED end to end:** destructive deletes, subscription redemption/activation, role mutations, coupon use, production notifications and backup restore. These were deliberately not run.

## Runtime measurements

- Browser DOM width/overflow was measured for representative viewports and major pages in the local preview.
- Objective bundle sizes were measured from existing `dist`.
- Navigation timing, LCP, CLS and INP were not available through the safe browser inspection surface and were not approximated.
- Existing `dist` and `.ui-review` are generated/ignored artifacts and may be older than the audited source commit; results using them are labelled preview evidence.

## Proposed Phase 5 tests (not run)

1. Seed all role/plan combinations in a disposable D1 and exercise every matrix cell through API and UI.
2. Simulate two devices editing separate personal-state fields, then force out-of-order sync.
3. Make collaboration edits offline, reconnect, and verify server/outbox behavior.
4. Run account/QBank/question deletion with foreign-key/orphan assertions and R2 cleanup verification.
5. Exercise expiry, coupon, reward, override and hidden-tab account invalidation transitions.
6. Install on physical iPhone/iPad/Android and capture orientation/keyboard/safe-area traces.

