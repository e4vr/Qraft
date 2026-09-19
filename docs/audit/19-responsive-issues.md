# Responsive and PWA issue register

| ID | Page | Device | Viewport | Problem | Severity | Screenshot/evidence | Future phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PWA-001 | Global installed app | iPhone | installed standalone | zoom is programmatically disabled and gesture events are prevented | Medium | source: `app/layout.tsx`; physical screenshot unavailable | Phase 4 |
| PWA-002 | Global shell | iPhone/iPad | keyboard/orientation | fixed body and nested scroll ownership can interact with software keyboard and Safari restoration | Medium | source/CSS; **NOT VERIFIED on device** | Phase 4/5 |
| PWA-003 | Offline start | all PWA | offline/cold | service worker precaches only shell assets/offline page; product/API is not available for a cold offline start | Medium | `public/sw.js` | Phase 4/product |
| PWA-004 | Updates | all PWA | installed | shell cache version is manual and static assets are cache-first; update UX is implicit | Low | `public/sw.js` | Phase 4 |
| UI-001 | Global navigation | iPad portrait | 768–1023 | wide tablet continues to use phone-style bottom nav/drawer | Medium | viewport measurement | Phase 4 |
| UI-002 | Global navigation | tablet | 1023→1024 | abrupt switch to a 254px sidebar; no intermediate tablet navigation mode | Low | measured settled rects at both widths | Phase 4 |
| UI-003 | Admin tables | phone/tablet | <1120 inner width | root member table requires horizontal scroll (`min-width:1120px`; non-root 680px) | Medium | source: collaboration dashboard | Phase 4 |
| UI-004 | Workspace header | phone | ≤639 | action strip uses max-width 58vw and horizontal scrolling without a strong continuation cue | Low | global CSS | Phase 4 |
| UI-005 | Global controls | touch | several | nominal heights include 38/40/42/44px; icon/text controls differ | Low | UI consistency inventory | Phase 4 |
| UI-006 | Small controls | coarse pointer | mobile/tablet | checkbox/small-target override is 24px; effective label hit area varies by component | Low | global CSS | Phase 4 |
| UI-007 | QBank/editor/test content | mobile | long content | extreme medical text, formulas and image combinations were not available in fixture | Unknown | **NOT VERIFIED** | Phase 4/5 |
| UI-008 | Dialog/forms | mobile | keyboard visible | dialog `100dvh` safeguards exist but actual keyboard repositioning was not tested | Unknown | **NOT VERIFIED** | Phase 4/5 |
| UI-009 | Screenshot baseline | all | desktop/tablet | safe browser inspection could render but not persist new PNG bytes; only one pre-existing mobile image is stored | Low/process | `screenshots/README.md` | Phase 4 |
| PERF-001 | Initial app | low-end phones | all | monolithic 702,656-byte uncompressed app chunk | Medium | existing `dist` measurement | Phase 1/4 |
| PERF-002 | Imports | low-memory device | when used | SQL.js adds 39,743-byte loader plus 658,410-byte WASM asset | Medium | existing `dist` measurement | Phase 4 |
| PERF-003 | Main UI | low-end device | broad workspace | very large components and state coordinator increase parse/render/re-render risk | Medium | file sizes/source | Phase 1/4 |

## Confirmed non-issues within tested scope

- No dashboard document-level horizontal overflow at the exact mobile/tablet/desktop widths in the viewport matrix.
- The 1024px navigation switch settled correctly after transition time: sidebar left `0`, width `254`, mobile nav hidden.
- At 1023px the drawer settled at `left:-270`, and mobile nav was visible.
- Learner pages opened at 390px—dashboard, QBank library, test builder, preformed tests, history, flashcards, progress, settings, contact, subscription, contribution center and add questions—kept document width at 390px.

