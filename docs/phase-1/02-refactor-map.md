# Refactor Map

| Before | Current owner | Compatibility surface | Evidence |
| --- | --- | --- | --- |
| `app/api/cloudflare/[...path]/route.ts` owned routing, limits, errors, notifications | `server/api/cloudflare-router.ts` and `server/api/request-lifecycle.ts` | Route re-exports method handlers | `tests/architecture-boundaries.test.mjs` |
| HTTP parsing/origin/JSON helpers in `lib/cloudflare-server.ts` | `server/http/request.ts`, `server/http/response.ts` | Re-exported by `lib/cloudflare-server.ts` | Typecheck, full API suite |
| Access policy mixed into `lib/medguard-types.ts` | `features/access/domain/access-policy.ts` | Type module re-exports legacy names | Domain tests, API suite |
| Plans and limits in `lib/plan-config.ts` | `features/subscriptions/domain/plan-config.ts` | `lib/plan-config.ts` is a re-export facade | Domain tests, subscription suite |
| All browser integrations in `lib/cloudflare-client.ts` | Feature client modules | Seven-line compatibility facade | Architecture tests, build |
| Root application imported one broad client facade | `lib/application-services.ts` composes explicit feature clients | UI imports remain stable | Typecheck, build |
| Server route imported large implementation directly | Feature server services for auth, state, collaboration, QBank, media | Feature services temporarily re-export the implementation | Architecture tests, Miniflare API suite |
| Exam range/title/category helpers in root React file | `features/exams/domain/*` | None | Domain tests |
| Cross-device answer preservation in root React file | `features/collaboration/domain/preserve-personal-answers.ts` | None | Domain and live-merge tests |
| Implicit Worker handler typing | `ExportedHandler<Cloudflare.Env>` and `DurableObject<Cloudflare.Env>` | None | Typecheck and build |

## New feature boundaries

```text
features/
  access/domain/access-policy.ts
  auth/client/auth-client.ts
  auth/server/auth-service.ts
  collaboration/client/collaboration-client.ts
  collaboration/domain/preserve-personal-answers.ts
  collaboration/server/collaboration-service.ts
  exams/client/exam-client.ts
  exams/domain/exam-presenters.ts
  exams/domain/highlight-ranges.ts
  media/server/media-service.ts
  qbanks/client/qbank-client.ts
  qbanks/server/qbank-service.ts
  state/client/state-sync-client.ts
  state/server/state-service.ts
  subscriptions/domain/plan-config.ts
```

## Import direction

Framework routes depend on server routing; server routing depends on feature services; feature services depend on domain policy and infrastructure. Browser components depend on feature clients/domain policy and never import server or Cloudflare modules. These rules are executable in `tests/architecture-boundaries.test.mjs`.

