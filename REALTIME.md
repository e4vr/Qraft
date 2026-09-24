# Live synchronization

Changes are saved to D1 first, then the API sends a content-free invalidation through a Durable Object channel for the affected bank/account/admin audience. Clients re-fetch authorized data and merge unchanged fields with their local drafts. This covers collaboration, registration approvals, contact tickets, and subscription administration. Personal study state remains on its existing save path.

The application Worker handles `/api/cloudflare/realtime` before vinext dispatch: vinext's route response wrapping does not preserve WebSocket HTTP 101 upgrades. All other routes continue through vinext.

Connections renew authorization every five minutes, reconnect with backoff, and refresh after returning from the background. Ping/pong uses the hibernation API. A 15-second refresh fallback runs only while an expected socket is unavailable. No question text, account information or ticket content is broadcast through channels.

## Deployment order

Run from the application directory:

```powershell
npm.cmd run deploy:staging
```

The staging command builds with `CLOUDFLARE_ENV=staging`, verifies every generated binding, refuses a dirty Git tree, and deploys `qraft-realtime-staging` before `qraft-staging`. Production entry points are deliberately named `deploy:production:realtime` and `deploy:production:app`; Phase 11A does not run them.

`npm.cmd run dev` runs both Workers through the Vite plugin. `npm.cmd start` runs both built Workers locally. Tests use isolated databases and synthetic accounts:

```powershell
node --test tests/platform-api.test.mjs tests/live-merge.test.mjs
$env:PLATFORM_TEST_BUILT = '1'
node --test tests/platform-api.test.mjs
```

The built-mode check verifies actual production routing and the separate Durable Object Worker, including HTTP 101, two-session delivery and forbidden subscriptions. It requires a current build.
