# PWA and runtime performance baseline

## Objective build measurements

Measurements are from the existing `dist/client` artifact. Because `dist` is generated/ignored, compare commit/build provenance before treating it as a release baseline.

| Asset | Uncompressed bytes |
| --- | ---: |
| Main `medguard-app` JS chunk | 702,656 |
| React/framework chunk | 190,109 |
| Vinext chunk | 132,652 |
| index chunk | 111,099 |
| SQL.js loader chunk | 39,743 |
| SQL.js WASM | 658,410 |
| Global CSS | 174,582 |
| Open Graph image | 1,456,385 |
| 512px app icon | 20,923 |
| Entire client artifact | 42 files / 3,724,476 bytes |

## Observed local page resource baseline

The locally rendered superadmin page exposed 18 observed assets/resources through the browser inventory:

- 9 scripts
- 1 stylesheet
- 1 image
- 7 “other” resources, including session, announcement, state, collaboration, Admin RSC, audit-week and root RSC requests
- 42 inline SVGs (mostly icon components; not separate requests)

This is an observed inventory, not a complete network waterfall. Transfer compression, cache hits and timing were not available.

## Network-related

- Initial app hydration requests session, announcement, personal state and collaboration.
- Admin route additionally requests route data and weekly audit data.
- Resource reads are single-flight and tag-invalidation-driven; tests prove duplicate calls are avoided within a session.
- Realtime WebSockets replace polling for change notification. Preformed active sessions have a periodic timer, but no broad recurring API poll was found.
- Page-hide/visibility-hide performs best-effort state save with keepalive.
- APIs are deliberately excluded from service-worker caching.

## Rendering-related

- The app shell uses nested scroll containers and fixed viewport ownership, avoiding body reflow but increasing complexity.
- Dashboard at all measured widths had no document horizontal overflow.
- Large admin tables use inner horizontal scrolling.
- Main coordinator state can cause broad render dependency; an exact React profiler trace was not captured.
- Reduced-motion styles are present.

## JavaScript-related

- The 702 KB main chunk is the primary low-end concern.
- Most product pages are state branches in one client coordinator rather than route-level chunks; broad imports reduce lazy-loading opportunity.
- SQL.js/WASM should only be loaded for import paths; actual lazy-load timing was not measured.
- Several components exceed 800–2,000 lines and may create expensive render trees in populated states.

## Database/API-related

- Hot-path index usage has a characterization test.
- Full collaboration snapshots and generic JSON records can produce larger parse/serialization work than narrow relational endpoints.
- State checkpoints reduce full-state write frequency during exams/flashcards.
- D1 query count/latency on production-scale data is **NOT VERIFIED**.

## PWA/cache-related

- Static assets are cache-first after first fetch; navigation is network-first with `/offline` fallback.
- Only core shell/offline assets are precached; this is not a fully precached offline application.
- Cache version is `qraft-shell-v1.0.5`; activation removes other named caches and claims clients immediately.
- No explicit “update available” user flow was found.

## Device-specific / low-end considerations

- Large initial JS parse/evaluate and the optional 658 KB SQL WASM are the clearest low-memory/CPU risks.
- Populated question, admin, review, and flashcard lists may render substantial DOM; fixtures were mostly empty.
- Fixed/nested scrolling and backdrop blur can be more costly on older iOS devices.
- Realtime reconnect uses exponential backoff up to ~30 seconds plus jitter, avoiding a tight loop.

## Metrics unavailable in Phase 0

| Metric | Status |
| --- | --- |
| FCP/LCP/CLS/INP | **NOT VERIFIED — safe inspection environment did not expose timing entries** |
| Time to interactive | **NOT VERIFIED** |
| Compressed transferred bytes | **NOT VERIFIED** |
| Route transition timing | **NOT VERIFIED** |
| CPU/memory/long tasks | **NOT VERIFIED** |
| Production D1 latency/query count | **NOT VERIFIED** |

## Comparison protocol

Future measurements should use the same authenticated fixture dataset, clean/cached runs, exact viewport/device, throttling profile and build mode. Record three medians for: root load, Admin load, test builder open, exam start, flashcard workspace, populated review table, and offline resume. Compare **before refactor → after refactor → after UI/PWA optimization**.

