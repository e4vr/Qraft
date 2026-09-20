# Qraft Phase 3 Migration Status

Baseline: `d4e45394ad50f61e75bf3a2de83dd63e30ee2b3d`  
Branch: `phase-3/ux-pwa-reconstruction`

| Stage | Status | Evidence |
| --- | --- | --- |
| A — Discovery | Complete | Functional parity matrix and device/UI audit |
| B — Architecture | Complete | One capability-based presentation resolver, shared product core, semantic route adapter |
| C — Design system | Complete | Central layout, spacing, radius, motion, layer, safe-area and viewport tokens; sheets and adaptive overlays |
| D — Application shells | Complete | Persistent desktop sidebar, tablet rail and five-destination handheld bottom navigation |
| E — Student core | Complete | Dedicated handheld Home, mobile QBank cards/actions, progressive test builder and summary-first Progress |
| F — Study engine | Complete | Handheld tool sheet, adaptive notes/Labs/explanation overlays, focused actions and preserved shared exam state |
| G — Additional learning | Complete | Mobile flashcard management sheet and compact summaries; existing study/review logic retained |
| H — Privileged experiences | Verified compatible | Reviewer/admin authorization and shared workflows unchanged; responsive existing presentations retained |
| I — Edge-state completion | Complete within local scope | Empty QBank/flashcard/progress states, missing exam fallback, route guards, offline/update surfaces |
| J — Verification | Complete with physical-device exceptions | 102/102 automated tests, TypeScript, lint, production build and emulated viewport audit pass |
| K — Cleanup | Complete | Obsolete `use-mobile` hook removed; device decisions constrained by tests to presentation boundaries |

## Migrated presentation surfaces

- shared shell selection: desktop, tablet and handheld;
- semantic routes for study, QBanks, exams, history, flashcards, progress, review, settings, account, subscription, support and contribution areas;
- purpose-built handheld Home and Progress;
- progressive handheld test creation;
- handheld exam tools and adaptive sheets;
- mobile QBank action hierarchy and adaptive create/quick-access overlays;
- mobile flashcard action hierarchy;
- explicit service-worker update prompt.

## Deliberately retained shared/responsive surfaces

Authentication, account, subscriptions, contribution, reviewer, administration, support and ready-made tests retain their current feature components. Their rules and mutations were not forked. They run inside the new shells and were protected by the full regression suite.

## Remaining verification gate

Physical iPhone/iPad testing remains required for Safari installation prompts, Dynamic Island/home-indicator rendering, hardware keyboard transitions, background suspension/resume and native VoiceOver gestures. These are recorded as unverified, not silently treated as passed.
