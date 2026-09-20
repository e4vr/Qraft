# Phase 5 handoff

Phase 4 is ready to hand off as **PARTIAL**, contingent on the production checklist. Do not reopen the corrected authorization model during unrelated work.

## Preserve

- Session-derived identity and fresh D1 authorization on every protected request.
- Separation of subscription plan, platform role and QBank relationship.
- MFA session rotation and the unverified five-minute root bootstrap/enrollment boundary.
- Server-only audit authorship.
- Signed, owner-bound personal backup contract (`hmac-sha256-v1`).
- Ready-test leaderboard/media object authorization.
- Same-origin mutation checks, private `no-store` APIs, realtime channel authorization and response headers.
- All 106 passing regression tests.

## Phase 5 candidates

1. Staging/production readiness validation from `19-production-security-checklist.md`.
2. Product decision and possible architecture for server-authoritative ready-test grading.
3. CSP nonce/hash migration with report-only rollout and PWA regression.
4. Real-device installed-PWA account switching, revocation and offline-cache tests.
5. Security observability/alerting and optional append-only privileged-event retention.
6. Compatible Drizzle/esbuild tooling update when upstream resolves the advisory chain.
7. Performance follow-up for the >500 kB client chunk, without weakening authorization.

## Do not perform automatically

No production deployment, secret creation, Cloudflare dashboard mutation, data migration, destructive test, pricing change, or Phase 5 implementation is authorized by this document. Require explicit approval and use staging/local fixtures first.
