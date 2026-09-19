# Phase 4 — UI / responsive / PWA handoff

## Priority inputs

1. Restore accessible zoom on installed iOS while preserving accidental-zoom controls only where essential.
2. Validate fixed-body/nested-scroll/safe-area ownership on real iPhone/iPad with keyboard and orientation changes.
3. Decide a tablet navigation strategy for 768–1023px and smooth the 1023→1024 transition.
4. Redesign admin tables for narrow screens instead of relying only on 680/1120px horizontal canvases.
5. Establish one component dimension system for buttons, icons, inputs, radii, spacing, headers and touch targets.
6. Reduce initial JS and route/view coupling before or alongside major visual work.
7. Decide the intended offline product promise; current service worker supports a shell/fallback, not cold full-app offline use.

## Suggested design-system targets

These are handoff targets, not Phase 0 changes:

- Named control sizes (for example compact 36, standard 44, large 48) with coarse-pointer minimum 44.
- Semantic radii and spacing tokens rather than ad hoc `xl/2xl/3xl` selection.
- One workspace header contract and one mobile action-overflow pattern.
- Explicit phone/tablet/desktop navigation modes based on content needs, not a single breakpoint alone.
- Responsive data-table alternatives (priority columns, details rows/cards) with preserved desktop density.
- Modal/drawer primitives tested against safe areas and virtual keyboard.
- Formal typography scale including long medical content, options, explanations and monospace identifiers.
- A documented offline/update/install state model.

## iPhone-specific handoff

- Test 320/375/390/430 widths on Safari and installed mode.
- Test notch/Dynamic Island, status bar, home indicator, bottom navigation and question drawer.
- Test text selection, pinch zoom, VoiceOver, double-tap, rubber-band and page restore.
- Test input focus in auth, question editor, notes, contact and admin search.

## iPad-specific handoff

- Test 768/820/1024 portrait plus landscape, split view and Stage Manager.
- Decide whether 820px should remain phone navigation and whether 1024px sidebar density is appropriate.
- Test exam explanation panels, question navigation, flashcards, modals and admin tables with touch/keyboard.

## Desktop preservation

- Preserve the 254px persistent sidebar, 1256px content cap, dense admin overview, keyboard focus/skip link, resizable explanation panel and non-clipped tables at 1280–1920px unless a measured redesign supersedes them.
- Mobile safe-area and touch CSS must not enlarge or pad desktop layouts unexpectedly.

## Performance guardrails

- Treat 702,656-byte main JS and 174,582-byte CSS as the current uncompressed comparison points.
- Preserve or improve the observed initial request/resource count.
- Add reproducible FCP/LCP/CLS/INP measurements before redesign work.
- Profile populated rather than empty dashboards, questions, review queues and admin lists.

## Visual baseline references

- Stored artifact: `screenshots/mobile/dashboard-390-preview.png` (pre-existing preview; provenance caveat in README).
- Recorded viewport measurements: `18-ui-pwa-audit.md`.
- Issue IDs and exact future phases: `19-responsive-issues.md`.
- Runtime visual inspection covered learner desktop/mobile/tablet dashboard and superadmin desktop/mobile, but new images could not be persisted by the safe browser surface.

## Phase 4 acceptance preparation

Before implementation, create a disposable fixture set for Free/Lite/Pro/Unlimited, reviewer, owner/editor/reviewer memberships, access manager and superadmin; then capture every page/state at the mandated viewport matrix. Phase 4 must not infer Lite visuals from the current mislabeled Pro fixture.

