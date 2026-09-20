# Unresolved risks

| ID | Severity | Risk | Current containment | Recommendation |
|---|---|---|---|---|
| R-401 | High | Ready-made-test answer keys reach the browser and guest score inputs are client supplied; privacy is enforced but rankings are not cheat resistant. | Attempt tokens, version binding, receipts and rate limits | Decide product trust model; if competitive, grade authoritative answers server-side without shipping keys |
| R-402 | Medium / launch config | Production `BACKUP_SIGNING_KEY` presence is unverified; rotation would invalidate old backups. | Missing key fails export/restore closed with 503 | Provision unique secret and define versioned key-rotation/retention policy |
| R-403 | Medium | CSP permits inline script/style and has no report endpoint. | No eval/wildcards; other directives are strict | Migrate bootstrap/runtime to nonce/hash after compatibility tests; deploy report-only telemetry first |
| R-404 | Medium | Live Cloudflare WAF, TLS, DNS, routes, caching and rate-limit behavior were not inspected. | Repository configuration and dry-run passed | Complete account-level checklist and deployed-host tests |
| R-405 | Medium | Four development-only advisories remain through Drizzle → esbuild; npm proposes an incompatible downgrade. | Zero production advisories; tooling should remain local/trusted | Track upstream compatible release; do not expose Drizzle dev server publicly |
| R-406 | Low | No MFA recovery/backup-code workflow was found. | Root bootstrap and TOTP are tightly gated | Define controlled recovery with dual evidence and audit trail |
| R-407 | Low | Audit events are server-authored but D1 is not immutable/tamper-evident. | Client forgery blocked; privileged operations logged | Export/retain critical events in an append-only external sink when operations mature |
| R-408 | Low | Private media attempt token is a URL query bearer capability. | Short-lived, hashed, version/resource bound; strict referrer policy and query redaction | Keep TTL minimal and exclude query strings from all telemetry |
| R-409 | Low | IP limiting relies on Cloudflare client IP; stronger account-aware distributed auth throttling is not present. | Auth/API/mutation edge limiters | Validate live behavior, then add account/device signals if abuse warrants it |

Source-map/log sanitization, production monitoring/alerting, and real-device account switching remain unverified rather than presumed safe.
