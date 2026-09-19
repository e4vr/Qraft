# Duplication Consolidation

## Consolidated in Phase 1

| Concept | Previous locations | Canonical owner |
| --- | --- | --- |
| Platform/QBank role decisions | `lib/medguard-types.ts` plus broad imports | `features/access/domain/access-policy.ts` |
| Plan constants and feature gates | `lib/plan-config.ts` used as a general library | `features/subscriptions/domain/plan-config.ts` |
| Bounded JSON parsing and origin checks | Large server implementation and imports through it | `server/http/request.ts` |
| No-store JSON responses | Large server implementation and imports through it | `server/http/response.ts` |
| Route path parsing/lifecycle | Framework route | `server/api/*` |
| Client Cloudflare operations | One 395-line mixed module | Feature client modules |
| Exam title/category/range helpers | Root React component | Exam domain modules |

## Compatibility rather than duplication

`lib/plan-config.ts`, `lib/cloudflare-client.ts`, and `lib/application-services.ts` are re-export/composition facades. They contain no second implementation and therefore do not create competing sources of truth.

## Remaining duplication or coupling

- The three large server implementations repeat some dispatch, validation, and D1 record handling patterns.
- Several workspaces repeat form, confirmation, and loading presentation patterns.
- Static source assertions in `collaboration-security.test.mjs` still complement runtime tests and must gradually move to behavioral tests.

Server and UI consolidation above is `DEFERRED_TO_PHASE_2`; visual component standardization that changes appearance is `DEFERRED_TO_PHASE_4`.

