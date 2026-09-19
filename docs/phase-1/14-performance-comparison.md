# Performance Comparison

## Build baseline

| Metric | Before Phase 1 | After Phase 1 |
| --- | ---: | ---: |
| Build outcome | PASS | Pending |
| Build duration | about 22.9 s | Pending |
| Client modules | 2,158 | Pending |
| Client output files | 42 | Pending |
| Total client output | 3,724,763 bytes | Pending |
| Main application chunk | 702,656 bytes | Pending |
| Framework chunk | 190,109 bytes | Pending |
| Vinext chunk | 132,652 bytes | Pending |

The build reported the existing warning that the main application chunk exceeds 500 kB. Phase 1 will avoid performance regressions; changing loading or caching behavior is `DEFERRED_TO_PHASE_2` unless a behavior-neutral module move improves the result naturally.

## Network and write baseline

Use the Phase 0 measurements in `docs/audit/21-performance-baseline.md`. No persistent-data or production-network load tests are authorized for this refactor.

