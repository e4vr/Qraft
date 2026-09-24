# Qraft isolated staging runbook

Run every command from the repository root. Commands that mutate Cloudflare name the `staging` environment or consume a generated config whose resource names have already passed the binding guard.

## Local credentials and Worker secrets

Generate an ignored local credential file without printing values, then apply the three required secrets only to `qraft-staging`:

```powershell
node scripts/staging-secrets.mjs prepare
node scripts/staging-secrets.mjs apply
```

Required Worker secrets are `ROOT_ADMIN_EMAIL`, `ROOT_ADMIN_SETUP_TOKEN`, and `BACKUP_SIGNING_KEY`. `IMAGEKIT_PRIVATE_KEY` is intentionally absent because staging uses its dedicated R2 bucket. The generated `QRAFT_STAGING_SEED_PASSWORD` remains local and is never uploaded as a Worker secret.

## Database plan and seed

First list unapplied migrations. Review the output before applying anything:

```powershell
node scripts/staging-database.mjs status
npm.cmd run db:migrate:staging
npm.cmd run db:seed:staging
```

Both mutation scripts hard-code `qraft-qbank-staging`, validate D1 ID `f788be6b-f763-49e8-840b-4c107c7e5874`, and reject the production name or ID. The committed migration set is `0000` through `0020`.

## Build and deploy

The deployment command refuses a dirty Git tree, builds with `CLOUDFLARE_ENV=staging`, validates generated bindings, deploys realtime first, and adds the Git SHA and UTC build timestamp to app responses:

```powershell
npm.cmd run deploy:staging
```

After deployment, check the `x-qraft-build` and `x-qraft-build-time` headers, list Worker versions, and confirm the app binding inventory:

```powershell
npx.cmd wrangler versions list --name qraft-staging --json
npx.cmd wrangler versions list --name qraft-realtime-staging --json
npx.cmd wrangler deployments list --name qraft-staging --json
npx.cmd wrangler deployments list --name qraft-realtime-staging --json
```

## Rollback

For an existing staging deployment, restore its recorded version IDs independently:

```powershell
npx.cmd wrangler rollback <APP_VERSION_ID> --name qraft-staging --message "Phase 11A rollback" --yes
npx.cmd wrangler rollback <REALTIME_VERSION_ID> --name qraft-realtime-staging --message "Phase 11A rollback" --yes
```

For a first deployment with no earlier version, disable the app by deleting the two staging Workers. This affects no production resource:

```powershell
npx.cmd wrangler delete qraft-staging
npx.cmd wrangler delete qraft-realtime-staging
```

Do not delete the staging D1 database during a Worker rollback. D1 migrations `0000`–`0020` are forward-only and additive to an initially empty staging database; the rollback is to remove/revert the Workers and recreate the isolated staging database if schema reset is required.

## Isolation check

The expected chain is `qraft-staging` → `qraft-qbank-staging`, `qraft-assets-staging`, and `qraft-realtime-staging`. Any production resource name in a generated staging config is a stop condition. `npm.cmd run cloudflare:check` builds and dry-runs both environments and verifies this binding graph.
