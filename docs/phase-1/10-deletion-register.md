# Deletion Register

Phase 1 removed implementations only after establishing a canonical replacement and verifying all imports. No feature, API, database field, route, migration, asset, or package was deleted.

| Removed implementation | Replacement | Proof |
| --- | --- | --- |
| Route-local dispatch/lifecycle functions | `server/api/cloudflare-router.ts`, `request-lifecycle.ts` | Architecture test; full API suite |
| Access-policy function bodies from `lib/medguard-types.ts` | `features/access/domain/access-policy.ts` | Import search; domain/API tests |
| Plan implementation from `lib/plan-config.ts` | `features/subscriptions/domain/plan-config.ts` | Facade contains re-export only; plan tests |
| Mixed implementation from `lib/cloudflare-client.ts` | Five feature client modules | Facade contains re-exports only; build/tests |
| HTTP primitive bodies from `lib/cloudflare-server.ts` | `server/http/*` | Import search; build/API tests |
| Pure exam/collaboration helper bodies from root component | Feature domain modules | Typecheck, domain/live-merge tests |

## Intentionally retained

- Compatibility facades were retained because removing their paths could break unenumerated consumers.
- Large server and root component implementations were retained behind new boundaries because their stateful internals were not proven dead.
- No apparently unused migration, record type, or PWA asset was removed.

