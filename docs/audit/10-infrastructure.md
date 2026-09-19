# Infrastructure map

## Cloudflare resources

| Resource | Binding/name | Use |
| --- | --- | --- |
| Main Worker | `qraft`, `worker.ts` | Vinext app/API, account-delete media cleanup, scheduled jobs |
| Realtime Worker | `qraft-realtime`, `workers/realtime.ts` | Durable Object WebSocket fan-out |
| D1 | `DB` → `qraft-qbank` | authoritative relational/JSON persistence |
| R2 | `ASSETS` → `qraft-assets` | question/note images and question backups |
| Durable Object service binding | `REALTIME` / `RealtimeChannel` | authenticated invalidation channels |
| Rate limits | API 300/min, mutation 120/min, auth 20/min | route-level throttling |
| Cron | `30 1 * * *` | subscription expiry, session/sync/token cleanup, question backup |
| Observability | enabled, 1% sampling, query-string redaction | Worker telemetry |

No Cloudflare KV, Queue, Vectorize, Hyperdrive, AI binding, or container is configured.

## External services

- **ImageKit:** only a legacy account-deletion fallback, controlled by `IMAGEKIT_PRIVATE_KEY`. New storage is R2.
- **WhatsApp URL:** positive-price checkout redirects/coordinates manually through a hard-coded business number; it is not a payment processor.
- No email/SMS, analytics SDK, error-tracking SaaS, or payment gateway integration was found.

## Environment-variable inventory

Values were not exposed.

| Name | Purpose | Consumption/config |
| --- | --- | --- |
| `ROOT_ADMIN_EMAIL` | singleton root identity | auth registration/login policy |
| `ROOT_ADMIN_SETUP_TOKEN` | root bootstrap proof | root registration only |
| `IMAGEKIT_PRIVATE_KEY` | legacy media deletion | account-deletion service |
| `R2_PUBLIC_URL` | documented public base URL | **NOT FOUND in active source consumption** |
| `R2_BILLING_CYCLE_DAY` | usage period boundary | storage accounting |
| `R2_STORAGE_CAP_BYTES` | deployment storage cap | media/storage service |
| `R2_CLASS_A_MONTHLY_CAP` | write-operation cap | R2 usage guard |
| `R2_CLASS_B_MONTHLY_CAP` | read-operation cap | R2 usage guard |
| `QUESTION_BACKUP_RETENTION_DAYS` | backup retention | scheduled question backup |
| `QUESTION_BACKUP_MAX_BYTES` | backup size guard | scheduled question backup |
| `NEXT_PUBLIC_SITE_URL` | canonical/public site URL | build/client metadata paths |

Generated `worker-configuration.d.ts` also names `AI_SEARCH`, `BLOG_SEARCH`, `FLAGS`, `MEMORY`, `STREAM`, and `WEBSEARCH`; no matching active Wrangler bindings or runtime usage was found.

## Deployment commands

- Build: `npm run build`
- Local built Worker: `npm start`
- Dry run: `npm run cloudflare:check`
- Deploy realtime first: `npm run deploy:realtime`
- Deploy app: `npm run deploy:app`

**Reproducibility issue:** `npm run dev` failed during the audit because installed workerd supports compatibility dates only through `2026-09-07`, while both Wrangler configs specify `2026-09-09`. No package or config was changed.

## Production verification

Production resource existence, binding contents, deployed versions, domain/DNS, R2 lifecycle rules, D1 migrations applied, secrets, observability output, and cron execution are **NOT VERIFIED**. Configuration proves intended bindings, not deployed state.

