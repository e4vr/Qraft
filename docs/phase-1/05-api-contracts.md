# API Contracts

## Contract status

All Phase 0 endpoints retain the same HTTP method, path, input body, status behavior, response shape, cache headers, rate-limit behavior, and realtime invalidation behavior.

| Scope | Router owner | Feature boundary | Contract change |
| --- | --- | --- | --- |
| `/auth/*` | `server/api/cloudflare-router.ts` | `features/auth/server/auth-service.ts` | None |
| `/state` and `/state/*` | same | `features/state/server/state-service.ts` | None |
| `/collaboration` | same | `features/collaboration/server/collaboration-service.ts` | None |
| `/qbanks/*`, `/ids/reserve`, `/qbank-folders/*` | same | `features/qbanks/server/qbank-service.ts` | None |
| `/media/*` | same | `features/media/server/media-service.ts` | None |
| `/platform/*` | same | existing platform API | None |
| `/preformed/*` | same | existing preformed API | None |
| `/contact` | same | existing contact API | None |
| `/realtime` | same | existing realtime service | None |

## Lifecycle preservation

- General rate limiting still applies before dispatch.
- A second mutation limit still applies to non-GET requests.
- Authentication endpoints retain the dedicated authentication limiter.
- Successful, changed mutations still emit realtime invalidation.
- `x-qraft-unchanged: 1` still suppresses invalidation.
- Thrown `Response` objects retain their status/body; unknown failures still return the generic 500 response.

The Miniflare integration suite exercises authentication, plans, state checkpoints, collaboration, roles, QBank ownership, reviews, media, preformed tests, and account deletion through the route itself.

