# Qraft request-management policy

This is the Phase 10 operational policy for browser, PWA, API and realtime requests. It documents the existing resource cache model and the constraints that future features must follow.

## Every request needs a reason

Allowed request reasons are:

1. `initial-cache-miss` — required data is absent for the authenticated scope;
2. `eligibility-parameters-changed` — a parameter changes the authoritative result;
3. `user-transaction` — the user intentionally performs a mutation;
4. `server-invalidation` — a relevant realtime/mutation signal marked the resource stale;
5. `reconnect-reconciliation` — one coordinated recovery after connectivity returns;
6. `explicit-refresh` — a deliberate user or diagnostic action.

Component mount, rerender, route return, focus, visibility change and unrelated realtime events are not request reasons on their own.

## Read decision order

For a data requirement:

1. use valid local/session/resource-cache data;
2. apply the authoritative mutation response when the client already has the resource;
3. share an identical in-flight request;
4. fetch one targeted entity;
5. fetch a small related set;
6. revalidate a stale resource after a relevant signal;
7. load a full snapshot only when the contract requires it.

## Request identity and privacy

`lib/resource-data.ts` constructs identity from authenticated cache scope, method, canonical path/query and canonical body. Identical reads share one Promise. Private data must never share a scope across accounts. Login, logout and account changes clear the cache generation so an older request cannot repopulate the new session.

Mutation requests are never automatically deduplicated by the read cache. Mutations rely on operation ids, constraints and server idempotency where required.

## Navigation

- Navigation does not invalidate valid data.
- A route return renders existing state immediately.
- Parameterized resources receive distinct keys; an older response cannot overwrite another key.
- Active exam navigation uses the retained exam and question arrays. Next, Previous, navigator, explanation, notes, highlight and mark operations do not fetch the question set.
- Leaving an exam may start a persistence checkpoint, but the critical mutation is not canceled because navigation occurred.
- Resource caches are bounded by the browser session/account lifecycle and explicit invalidation. They are not retained across users.

## Freshness and invalidation

- No generic time-based TTL is applied to authenticated resources.
- Mutations invalidate only policy tags derived from the changed endpoint/collections.
- Realtime events invalidate only their mapped resource tags.
- Invalidation marks data stale; it does not automatically fetch every consumer.
- The initiating browser is excluded from its own realtime broadcast and should use the mutation response/local state.
- Unrelated events must not invalidate collaboration, account or question data.

## Realtime and reconnect

- Realtime is an invalidation transport, not a global-refresh command.
- Topic events remain immediate and targeted.
- Multiple channel reconnects in one recovery period produce one generic reconciliation event.
- Reconciliation may refresh the account and collaboration snapshot once because the invalidation-only protocol has no ordered event cursor.
- Delta recovery is deferred until the server has a durable, ordered, authorization-safe cursor. A timestamp is not a sufficient substitute.
- No polling is added to compensate for WebSocket behavior.

## Retry and cancellation

- Validation, authentication, authorization and other deterministic 4xx responses are not blindly retried.
- 429 handling must respect `Retry-After` if a retrying caller is introduced.
- Transient reads may use bounded exponential backoff with jitter when a feature proves it necessary.
- Critical mutations are not automatically retried unless they carry a stable idempotency key.
- Superseded parameterized reads may be aborted when the caller owns their lifecycle; shared in-flight reads are not canceled by one consumer.
- A request failure must never create an unbounded loop.

## Idle and PWA behavior

- A stable visible page with no relevant event produces no application HTTP requests.
- The service worker continues to bypass `/api/*`.
- Offline/resume keeps usable in-memory and IndexedDB state.
- Online recovery is coordinated through realtime reconnect; focus or PWA foregrounding does not reload the application.

## Observability

Development diagnostics expose request method counts, cache hits/misses, deduplicated reads, invalidation fetches and avoided network calls through `window.__QRAFT_DATA_DIAGNOSTICS__`.

Future production instrumentation may record route template, request category, cache result, duration, status, D1 rows and realtime publication count. It must not log cookies, tokens, request bodies, question content, email addresses or user-entered search text.

## Review checklist

Before adding a request, answer:

- Who owns this resource?
- What is its cache key and authenticated scope?
- Why is current cached data invalid?
- Can an existing mutation response or targeted entity read satisfy the need?
- What event invalidates it?
- What happens during navigation, account change, offline use and reconnect?
- Is the request safe to cancel or retry?
- Can a regression test verify the request budget?
