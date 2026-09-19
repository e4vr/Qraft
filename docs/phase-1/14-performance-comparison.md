# Performance Comparison

## Production build

| Metric | Before Phase 1 | After Phase 1 | Delta |
| --- | ---: | ---: | ---: |
| Build outcome | PASS | PASS | none |
| Client output files | 42 | 42 | 0 |
| Total client output | 3,724,763 bytes | 3,724,763 bytes | 0 |
| Main application chunk | 702,656 bytes | 702,656 bytes | 0 |
| Framework chunk | 190,109 bytes | 190,109 bytes | 0 |
| Vinext chunk | 132,652 bytes | 132,652 bytes | 0 |
| Index chunk | 111,099 bytes | 111,099 bytes | 0 |

Chunk hashes changed as modules moved, but byte sizes did not. The existing warning for a main chunk above 500 kB remains.

## Module counts

Module counts rose slightly because large mixed files were divided into feature modules. This is expected structural overhead and did not increase emitted client bytes:

- Baseline client modules: 2,158
- Final client modules: 2,166

Build duration varied between runs and was not treated as a reliable performance result on the shared development machine. Representative end-to-end builds remained successful and within the same range.

## Network and persistence

Endpoint paths, request counts by code path, payload shapes, cache behavior, invalidation behavior, outbox ordering, and write timing were not intentionally changed. The Phase 0 baseline in `docs/audit/21-performance-baseline.md` remains authoritative.

## Assessment

Phase 1 caused no measured bundle regression. It created boundaries that make code splitting and targeted profiling possible in Phase 2. Actual runtime/network optimization is `DEFERRED_TO_PHASE_2`.

