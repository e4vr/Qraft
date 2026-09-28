# Qraft Collaborative QBank

The canonical checkout is `app`; previous release worktrees have been consolidated.
All changes follow [QRAFT_ENGINEERING_CONSTITUTION.md](QRAFT_ENGINEERING_CONSTITUTION.md).
See [SaaS readiness and validation](docs/SAAS_READINESS_2026-09-27.ar.md) for the 100-user local scenario, current safeguards, and remaining cloud launch checks.
See [the current foundation decisions](docs/QRAFT_FOUNDATION_2026-09-27.ar.md) for synchronization, participant privacy, server grading, and the transitional data capacity policy.

Qraft 1.0.0 is a private, installable medical QBank PWA. It supports collaborative question authoring and review, personal study progress, subscriptions, account administration, support tickets, and live invalidation across active sessions.

## Main capabilities

- Public and private QBanks with owner, reviewer, and viewer access.
- Tutor and timed tests, progress history, flags, highlights, notes, and answer statistics.
- Reviewed question proposals with field-by-field comparison and durable attribution.
- JSON question import with a review step before submission.
- Lite and Pro subscriptions, discount codes, and Superadmin subscription management.
- Registration approval, university-ID claiming, access blocking, and MFA-protected Superadmin actions.
- Private support tickets optionally linked to stable question UUIDs.
- IndexedDB local-first persistence, Cloudflare D1 data, Cloudflare R2 media storage, and an installable PWA shell. Existing ImageKit records remain compatible during migration.
- Hard R2 guards stop site traffic before 3 GiB storage, 800k monthly Class A operations, or 8M monthly Class B operations.
- Authorized real-time invalidation through a Durable Object worker; data is always re-fetched through the protected API.

## Architecture

- React 19, TypeScript, Tailwind CSS 4, and vinext/Vite.
- `components/medguard-app.tsx` owns the main client state and screen navigation.
- `app/api/cloudflare/[...path]/route.ts` routes authentication, collaboration, platform, contact, and media requests.
- `lib/cloudflare-server.ts` enforces authentication and collaborative record permissions.
- `lib/application-services.ts` and `lib/api-client.ts` keep UI components independent from the current provider implementation.
- `lib/storage-service.ts` isolates object storage behind a small R2 adapter.
- `lib/platform-server.ts` handles subscriptions, imports, question lifecycle, and reviewer management.
- `lib/contact-server.ts` handles private support tickets.
- Cloudflare D1 stores profiles, sessions, personal state, shared records, subscriptions, question identities, and tickets.
- `workers/realtime.ts` provides authenticated change notifications without exposing record content.

The 217 initial General Surgery questions are preserved in `data/questions.json` and seeded into D1 by migration `drizzle/0004_subscriptions_support.sql`.

## Local setup

1. Copy `.dev.vars.example` to `.dev.vars` and replace the sample values.
2. Install dependencies and initialize the local D1 database:

   ```bash
   npm install
   npm run db:migrate:local
   npm run dev
   ```

3. Open `http://localhost:3000` and register the configured Superadmin account.
4. Complete authenticator-app MFA enrollment, then approve user registrations.

## Deployment

Create the `qraft-assets` R2 bucket, configure `ROOT_ADMIN_EMAIL` and `ROOT_ADMIN_SETUP_TOKEN` as Worker secrets, and apply all D1 migrations before deploying. `IMAGEKIT_PRIVATE_KEY` is optional and retained only for deleting legacy ImageKit assets. See `ARCHITECTURE.md` for the exact safe order.

Deploy the real-time worker before the application worker:

```bash
npm run deploy:production
```

The production command requires a clean committed checkout, rebuilds against production resources, validates bindings, deploys realtime first, and records the commit/PWA/schema identity. Run the validation commands and validate the same commit in staging before production. Database backups and migrations remain explicit operations before deployment.

## Validation

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run cloudflare:check
```

`npm run test:saas` runs focused reliability and API tests, including 100 concurrent synthetic accounts against a disposable local D1 database. It writes `outputs/saas-local-load.json`. Local results do not certify production capacity; use an isolated staging environment before a paid launch. Subscription activation remains an audited administrator workflow.
