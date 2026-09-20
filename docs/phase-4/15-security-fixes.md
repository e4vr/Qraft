# Security fixes and affected files

| Control | Implementation | Regression evidence |
|---|---|---|
| Server-authored audit only | `lib/cloudflare-server.ts` | `tests/platform-api.test.mjs` |
| Login timing normalization | `lib/cloudflare-server.ts` | Static trust-boundary test + full auth suite |
| MFA session rotation | `lib/cloudflare-server.ts` | Old/new session integration test |
| Unverified five-minute root bootstrap/enrollment session | `lib/cloudflare-server.ts`, `server/api/cloudflare-router.ts` | Direct pre-MFA privileged request denied; enrollment allowed |
| Private ready-test leaderboard | `lib/preformed-test-server.ts` | Owner/unrelated/participant integration paths |
| Private ready-test media | `lib/cloudflare-server.ts`, `lib/preformed-test-server.ts` | Draft/owner/attempt-token R2 reads |
| Signed owner-bound backup | `lib/platform-server.ts` | Unsigned/collision denial + signed self restore |
| Spreadsheet injection defense | `components/preformed-tests-workspace.tsx` | Static security regression |
| Central response headers/CSP/HSTS | `server/http/security-headers.ts`, `worker.ts` | Header-boundary regression/build |
| Environment contract | `.env.example`, `.dev.vars.example`, `cloudflare-env.d.ts`, `ARCHITECTURE.md` | Typecheck/build |
| Cloudflare dependency advisories | `package.json`, `package-lock.json` | npm audit/build/dry-run |

No database migration, plan/pricing change, UI redesign, production configuration mutation, or deployment was performed.
