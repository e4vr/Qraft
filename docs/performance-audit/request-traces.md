# Phases 1–2: frontend network audit and request-origin traces

## Classification method

Network work is classified as:

1. **required** — necessary for the action and current consistency contract;
2. **intentional realtime/polling** — deliberate background synchronization;
3. **accidental duplicate** — equivalent physical requests caused by lifecycle behavior;
4. **avoidable architecture inefficiency** — required data obtained with excess requests or work;
5. **uncertain** — needs runtime attribution.

## Cross-cutting request lifecycle

```text
UI/component action
  -> feature client or lib/api-client.ts
  -> resource-data canonical key/cache/single-flight
  -> /api/cloudflare/[...path]
  -> server/api/cloudflare-router.ts
  -> feature service / lib platform service
  -> currentUser + authorization
  -> D1/R2/Durable Object
  -> response cache/local state
  -> successful mutation notification
  -> audience DO invalidation
  -> other clients invalidate and read on use
```

The initiating client includes `x-qraft-client-id` and is excluded from its own Durable Object broadcast. This prevents the common mutation-then-self-refetch loop.

## Major flow traces

| User action | Origin to API | Server/D1 path | Classification and observation |
|---|---|---|---|
| Load/login session | `MedGuardApp` initialization -> account client -> `GET /auth/session` | session/profile lookup -> entitlement/profile shaping | Required. Request-scoped auth memoization prevents repeated auth lookup inside the same request. |
| Submit login/MFA | auth view -> `POST /auth/login` or `/auth/mfa` -> refresh session | password hash or TOTP, session mutation, profile | Required. PBKDF2/TOTP cost is intentionally limited to authentication. |
| Cold dashboard | hydration -> `GET /platform/announcement`, `/state`, `/collaboration` | announcement query; app state row; collaboration catalog + scoped records | Required data. Collaboration retrieval is an avoidable database/serialization inefficiency. |
| Cached navigation | route/view state -> shared `MedGuardApp` | normally no physical refetch while resources remain fresh | Required logical reads served from cache. Verify with a browser trace. |
| Browse/open bank | collaboration cache or question endpoint/test pool depending view | bank authorization, scoped questions/classifications | Required. Reusing collaboration cache is intentional; test-pool query needs route metrics at scale. |
| Start exam | exam builder -> test-pool API -> personal-state mutation | eligible-question CTE, random sample, plan checks, state/test registry write | Required. `ORDER BY random()` scales with the eligible pool and should be profiled before replacement. |
| Answer/next/previous | local React state and local collaboration snapshot | no immediate server request for each navigation | Required local interaction; no write-on-render or write-on-every-answer request found. |
| Exit/checkpoint exam | `checkpointPersonalState('exam')` -> `PUT /state/exam` | load/normalize state -> save state/revision/op -> read answerStats -> collaboration upsert + audit per answer | Required persistence with avoidable write amplification. No-op state and collaboration guards prevent exact repeats. |
| Submit/review result | test view updates local result then checkpoint | same state path; result stays in personal state | Required. Full state JSON parsing/serialization can become CPU-heavy as histories grow. |
| Edit questions | management/editor -> `PUT /collaboration` or platform question action | authorization -> record mutation -> audit -> realtime invalidation | Required. Batching exists; every operation intentionally creates an audit record. |
| Reviewer list/detail | review components -> review queue, question detail, history/performance APIs | indexed proposal reads plus role/bank access checks | Required parameter/event-driven resources. Component remount reads are normally cache hits. |
| Bulk review | reviewer action -> platform bulk-review mutation | proposal/question/review/ledger/audit batches -> notification lookup | Required but CPU/write intensive at large batch sizes; benchmark 1/50/200 items. |
| JSON import | import parser -> platform import -> monitor/status reads | validation, duplicate comparison against candidate pool, proposal/audit writes | Required behavior; duplicate detection is CPU-quadratic in incoming x candidate counts. |
| Progress loading | personal state/collaboration-derived progress | cached `/state` and `/collaboration` | Required logical data. No standalone polling loop found. |
| Topic/specialty loading | collaboration or classification endpoint | scoped records/classification revisions | Required. Large collaboration response overfetchs records before Worker filtering. |
| Subscription/admin pages | parameter-driven platform endpoints | session/profile plus entitlement/subscription/admin queries | Required. Search is debounced; leading-wildcard search can scan but current profile cardinality is small. |
| Realtime reconnect | each WebSocket `onopen` after first connection -> generic `connected` | account and collaboration refresh | **Accidental duplicate across channels.** One browser resume can emit once per channel. |

## Repeated-request findings

### Confirmed accidental duplicate: reconnect reconciliation

`openLiveChannels` remembers connectivity separately for every channel. Each reconnected user, catalog, bank, admin, or access socket calls `emit('connected')`. The root application callback invokes both account and collaboration refresh for every emission.

The single-flight cache prevents physical duplicates only while equivalent calls overlap. Socket opens are not guaranteed to overlap, so staggered reconnects can cause repeated account/collaboration reads. This also creates extra Worker invocations and makes browser/network transitions a plausible contributor to disconnect counts.

Proposed Phase 10 behavior-preserving fix: coalesce all channel reconnect events into one reconciliation window per network-resume wave, while retaining immediate topic-specific invalidations. Acceptance: one resume causes at most one session fetch and one collaboration fetch.

### Intentional logical duplicates served from cache

The root hydrator and some mounted workspaces can both call `loadCollaborationState`. `resource-data.ts` canonicalizes the key, returns a fresh cache entry, and shares an in-flight Promise. These are multiple logical consumers but normally zero or one physical request. They should be monitored through `__QRAFT_DATA_DIAGNOSTICS__`, not removed based on source call count alone.

### Mutation invalidation

Realtime messages mark tagged resources stale. Reads occur when the resource is next requested. The originating client is excluded by client id. This is an appropriate consistency mechanism and should remain.

### Search and imports

Contact/admin searches and JSON-import monitor input are debounced in the inspected code. No every-keystroke unbounded request path was found. Runtime testing should still verify one request per stabilized input.

## Idle-page audit

No general `refetchInterval`, focus refetch, visibility-change API fetch, or recurring HTTP polling was found. Local exam/flashcard clocks and WebSocket retry timers do not themselves call application APIs. The service worker bypasses `/api/*` and therefore cannot replay or refresh API reads.

Expected idle behavior after initial hydration:

- WebSockets remain open and may reconnect when the network changes;
- local UI timers may tick;
- zero HTTP API requests during ten unchanged online minutes;
- a genuine realtime mutation may invalidate and refresh an actively consumed resource.

## Cancellation and race behavior

Application fetches generally use lifecycle booleans rather than `AbortController`. Navigation, tab closure, browser suspension, network changes and WebSocket closures can therefore produce legitimate client disconnect telemetry. A component can ignore a late result without canceling the request. Route-level telemetry is required before labeling disconnect events as faults.

## Payload and request-count opportunities

| Opportunity | Evidence | Proposed direction | Confidence |
|---|---|---|---|
| Collaboration query rewrite | Production load returned about 728 KB raw JSON and performed 11,326 row reads | Use existing `(type,id)` and `(qbank_id,type)` indexes and split the `OR` scope | High |
| Reconnect coalescing | One `connected` emission per reconnected channel | One bounded reconciliation wave per resume | High |
| Auth entitlement query consolidation | Protected requests perform session/profile lookup plus several entitlement lookups | Return entitlement sources in one SQL statement while preserving freshness | Medium; measure round trips/CPU first |
| Post-response mutation publication | `notifyMutation` is awaited before returning | Use Worker execution context only after proving post-commit delivery/reconciliation semantics | Medium |
| Selective collaboration payload | Whole allowed state is returned and filtered | Consider endpoint/resource slicing after query rewrite measurements | Medium; response-contract risk |
| Static bundle splitting | Main application chunk is 746 KB uncompressed | Browser coverage/lazy-load trace before changing boundaries | Medium |

## What was not found

- no TanStack Query configuration causing focus/reconnect/polling storms;
- no service-worker API cache;
- no mutation self-broadcast;
- no recurring idle API poll;
- no write triggered merely by rendering;
- no evidence that all disconnect telemetry represents server failure.
