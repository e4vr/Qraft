# Cloudflare security review

## Repository-verified configuration

Wrangler dry-run passed with version 4.135.0 and no deployment. Bindings:

- D1 `DB` (`qraft-qbank`).
- R2 `ASSETS` (`qraft-assets`).
- Durable Object `REALTIME`.
- Rate limiters: API 300/60s, mutation 120/60s, auth 20/60s.
- Scheduled maintenance at 01:30 UTC.
- Observability sampling with query redaction in repository configuration.
- R2 storage/operation caps and backup size/retention variables.

Secrets are server-side bindings. Current tracked files contain names/placeholders only. A redacted repository scan found no confirmed committed secret; therefore `SECRET ROTATION REQUIRED` is **not** raised by Phase 4. Actual values were neither read nor printed.

`BACKUP_SIGNING_KEY` is newly required, must be unique per environment, and must contain at least 32 characters. It is intentionally absent from source/Wrangler variables. Configure with `wrangler secret put BACKUP_SIGNING_KEY` before production backup use.

## Not verified

Cloudflare dashboard/zone settings, custom-domain routes, Access, DNSSEC, TLS minimum/ciphers, WAF/bot rules, live rate-limit counters, log retention, secret presence, production cron behavior, and public cache rules. These require account-level read access and deployed-host smoke tests.
