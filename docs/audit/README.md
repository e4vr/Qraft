# Qraft Phase 0 audit

**Audit date:** 2026-09-19  
**Repository:** `C:\Users\Khaled\Desktop\Medguard\app`  
**Git branch:** `main`  
**Audited commit:** `b874cb60675b964a95e61868cfa07653ee6b49a8`  
**Commit subject:** `feat: add QBank editor role and refine iOS PWA`

## Scope and freeze

This folder is the only repository change made for Phase 0. Application source, database schema/data, dependencies, generated deployment configuration, authentication, authorization, entitlements, and production resources were not changed.

Method: **Discover → Map → Trace → Cross-check → Document → Risk-classify → Handoff**.

Evidence labels used throughout:

- **VERIFIED:** established from executable code, schema, configuration, a passing local test, or a read-only local runtime observation.
- **LIKELY:** strongly indicated by code, but not exercised end to end.
- **UNCLEAR / NOT VERIFIED:** unavailable environment or insufficient evidence.
- **NOT FOUND:** searched for but absent from the audited repository.

## Verification summary

| Check | Result |
| --- | --- |
| Git baseline | Clean `main` at the commit above before documentation was added |
| Static source/config/schema inspection | Completed across the repository, excluding generated dependencies and build artifacts except for bundle-size measurement |
| Existing automated tests | **80 passed, 0 failed** (`npm test`) using in-memory/ephemeral fixtures |
| Lint | Passed (`npm run lint`) |
| Normal local development command | **Blocked**: configured Cloudflare compatibility date `2026-09-09` exceeds the installed local workerd maximum `2026-09-07` |
| Safe local visual preview | Completed using the existing ignored `.ui-review/production-preview.mjs` harness and ephemeral D1 data |
| Production data mutation | Not performed |
| Real iPhone/iPad/Android installed-PWA testing | **NOT VERIFIED — ENVIRONMENT UNAVAILABLE** |

## Deliverables

The numbered documents `00`–`17` satisfy the core Phase 0 deliverables. Documents `18`–`22` cover the mandatory cross-device, UI, PWA, local-account, performance, and Phase 4 additions.

## Important limitations

- The local preview harness is ignored by Git and is not a production authentication path. It exposes two ephemeral fixtures, but the fixture labelled “Lite” is actually stored as `pro`; therefore it is not valid evidence for the Lite visual experience.
- Reviewer, owner, editor, expired, coupon, and manually activated visual personas were not available without creating new fixtures or changing source. Their behavior is mapped from code and tests and is explicitly labelled as such.
- The browser environment could inspect and render screenshots, but could not persist new screenshot bytes into the repository. One pre-existing preview snapshot is retained under `screenshots/`; other viewport observations are recorded as measurements in `18-ui-pwa-audit.md` and `19-responsive-issues.md`.
- No payment provider, production Cloudflare dashboard, production D1/R2 contents, DNS, analytics dashboard, or real device was accessed.

