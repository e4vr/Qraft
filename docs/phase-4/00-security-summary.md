# Phase 4 security summary

## Status: PARTIAL

Phase 4 hardened the local codebase and verified the most important server-side trust boundaries. The result is not a claim that Qraft is "secure" or "100% safe". Production Cloudflare account configuration, WAF/TLS controls, real-device installed-PWA authentication, and production secrets were not inspected.

Baseline: branch `phase-4/security-authorization-hardening`, commit `4a41febee67232467f32222f0a6079dbe796b844`, schema through `drizzle/0020_phase2_logic_integrity.sql`. No migration was added. Authentication uses D1 profiles/sessions, a `__Host-` HttpOnly Secure SameSite=Lax cookie, PBKDF2 passwords, and TOTP MFA for the singleton Superadmin.

## Verified protections

- Identity, platform roles, QBank relationships, subscription state, and effective plan are derived from D1 at the server boundary.
- Collaboration clients cannot create authoritative audit records.
- Personal backups are HMAC signed, owner-bound, structurally validated, and collision checked before restore.
- MFA verification replaces and revokes the temporary session instead of upgrading it in place.
- Private ready-made-test leaderboard and R2 media access require ownership, current-version participation, or a short-lived attempt capability as applicable.
- Cookie mutations require same-origin requests; authenticated JSON responses are `no-store`; WebSocket origins and channel access are validated.
- Central production response headers now include CSP, clickjacking, MIME-sniffing, referrer, permissions, COOP/CORP, and HTTPS HSTS controls.
- Production dependency audit: 0 known vulnerabilities. Full local regression: 106/106 tests passed. Production build and Wrangler dry-run passed.

## Confirmed findings fixed

| Severity | Count | IDs |
|---|---:|---|
| Critical | 2 | SEC-401, SEC-411 |
| High | 4 | SEC-402–SEC-405 |
| Medium | 5 | SEC-406–SEC-410 |
| Low | 0 | — |

## Remaining launch blockers

1. Configure a unique production `BACKUP_SIGNING_KEY` of at least 32 characters before enabling personal backup export/restore. The server fails closed with 503 when absent.
2. Validate the deployed CSP, cookies, WebSockets, caching, WAF/rate-limit behavior, TLS, and headers on the real hostname.
3. Make an explicit product/security decision for ready-made-test anti-cheat: answer keys are delivered to the browser and guest scores are client supplied. Current authorization protects privacy but does not make guest rankings cheat resistant.

No production deployment or destructive production test occurred.
