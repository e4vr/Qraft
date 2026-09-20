# Production security checklist

## Verified in repository/local environment

- [x] Authentication and server identity path reviewed.
- [x] Session cookie, expiration, revocation and MFA rotation reviewed.
- [x] Role, ownership and plan decisions enforced server-side.
- [x] Expiry and numeric plan limits tested.
- [x] Private QBank, IDOR/BOLA, reviewer and Superadmin boundaries covered.
- [x] Role self-escalation and mass-assignment paths reviewed.
- [x] Coupons, subscription activation and replay/atomicity reviewed.
- [x] Input, SQL binding, import limits, XSS rendering, CSRF and CORS reviewed.
- [x] Security headers/CSP implemented and locally regression-tested.
- [x] R2, realtime, private cache and error-response behavior reviewed.
- [x] Secret names/current tracked files reviewed without exposing values.
- [x] Production dependency audit is clean; remaining dev advisories classified.
- [x] Security regression tests added; Lite, Pro, Reviewer, Owner and Superadmin paths pass.
- [x] Desktop and iPhone-class unauthenticated smoke checks pass.

## Must complete before public launch

- [ ] Provision a unique 32+ character `BACKUP_SIGNING_KEY` with Cloudflare Secrets; never place it in Git or public env.
- [ ] Verify `ROOT_ADMIN_EMAIL`, `ROOT_ADMIN_SETUP_TOKEN`, optional legacy ImageKit secret, and secret access/rotation policy in the target environment.
- [ ] Build/deploy to a staging hostname and inspect actual cookie attributes, CSP, HSTS, CORS, caching and safe error bodies.
- [ ] Validate WebSocket reconnect/authorization, R2 private media, coupon and subscription boundaries on staging personas.
- [ ] Inspect Cloudflare TLS, custom routes, WAF/bot rules, rate-limit counters, DNS/DNSSEC, log redaction and cron.
- [ ] Confirm no source maps/debug/test helpers or verbose stack/SQL responses are public.
- [ ] Test account A → logout → account B on desktop, installed iPhone PWA and iPad PWA; verify no inherited private cache.
- [ ] Test role/plan revocation with a stale tab and a stale installed PWA.
- [ ] Decide and document whether ready-made-test leaderboards require cheat-resistant server grading.
- [ ] Validate CSP compatibility across all production routes before tightening inline allowances.
- [ ] Establish monitoring/alerting for privileged role, plan, coupon, deletion and repeated auth-denial events.

No schema migration is required by Phase 4. Deployment remains an explicit later action.
