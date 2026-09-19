# Cross-device, UI and PWA audit

## Method and evidence limits

- Source/CSS/PWA configuration were inspected directly.
- The existing ignored production-preview harness rendered the existing `dist` against ephemeral local D1 fixtures. It is useful visual evidence but may lag the audited source commit.
- Major learner pages were opened at 1440×900 and 390×844. Dashboard overflow/breakpoint measurements covered the full matrix below.
- Superadmin overview was visually inspected on desktop and mobile.
- Physical devices and installed-PWA mode were unavailable and are explicitly not claimed as tested.

## Viewport matrix

| Class | Viewports inspected | Dashboard document result | Navigation result |
| --- | --- | --- | --- |
| Mobile | 320×844, 375×812, 390×844, 430×932 | document width equalled viewport; no horizontal page overflow | bottom navigation + off-canvas 270px drawer |
| Tablet portrait | 768×1024, 820×1180 | document width equalled viewport | mobile/bottom layout |
| Tablet large portrait | 1024×1366 | document width equalled viewport | persistent 254px desktop sidebar |
| Tablet landscape | 1024×768, 1180×820, 1366×1024 | document width equalled viewport | persistent sidebar |
| Desktop | 1280×800, 1440×900, 1920×1080 | document width equalled viewport | persistent sidebar; content max width 1256px |
| Breakpoint probes | 639/640, 767/768, 1023/1024 | no page-width overflow after 250ms transition settle | decisive nav switch occurs at 1024px |

The off-canvas sidebar exists outside the viewport at mobile widths; raw element-bound checks see negative coordinates, but `documentElement.scrollWidth` remains equal to the viewport and does not produce user-visible horizontal scrolling.

## Page-by-page UI audit

Legend: **Runtime** opened in local preview; **Source** inspected structurally only; **N/A** no distinct PWA UI.

| Page/area | Desktop | Mobile | Tablet | PWA | Major issues / limits | Severity |
| --- | --- | --- | --- | --- | --- | --- |
| Authentication/MFA/account gates | Source | Source | Source | Source | physical keyboard/standalone not verified | Unknown |
| Dashboard | Runtime | Runtime | Runtime dashboard | Source | stable widths; iPad portrait uses mobile nav until 1024 | Low |
| QBank library/selection | Runtime | Runtime | Source | N/A | drawer contains full nav; quick bottom nav exposes only core actions | Low |
| QBank management/question editor/import | Source + Pro nav | Source + Pro nav | Source | N/A | long forms/content and keyboard states not runtime-tested | Unknown |
| Test builder | Runtime | Runtime | Source | N/A | many controls on mobile but no document overflow | Low |
| Exam session/question navigation | Source/tests | Source/tests | Source | Source | nested full-height scrollers; real long medical content/keyboard not verified | Medium |
| Results/history/review | Runtime empty/history; source | Runtime empty/history; source | Source | N/A | empty state verified, populated long result not visually exercised | Unknown |
| Flashcards | Runtime empty | Runtime empty | Source | Source | review card has landscape-height override; real image/keyboard unverified | Low/Unknown |
| Progress | Runtime | Runtime | Source | N/A | no document overflow in fixture | Low |
| Reviewer queue | Source/tests | Source/tests | Source | N/A | no reviewer-only visual persona available | Unknown |
| Contribution center/add questions | Runtime | Runtime | Source | N/A | Pro fixture only; long editor content unverified | Low/Unknown |
| Subscription/upgrade | Runtime | Runtime | Source | N/A | real Lite/expired presentation not verified | Unknown |
| Settings/profile | Runtime | Runtime | Source | N/A | destructive dialogs not opened | Low/Unknown |
| Contact/reports | Runtime initial | Runtime initial | Source | N/A | populated ticket thread not exercised | Unknown |
| Admin/superadmin overview | Runtime | Runtime | Source | N/A | mobile layout becomes stacked and usable | Low |
| Admin data tables | Source | Source | Source | N/A | tables intentionally require 680/1120px inner width and horizontal scrolling | Medium |
| Error/not-found/offline/loading | Source/tests; loading observed | Source/tests; loading observed | Source | Source | slow network/offline interaction not browser-emulated | Unknown |

## UI state audit

| State | Evidence | Result |
| --- | --- | --- |
| Initial loading | runtime showed “Syncing your workspace…” | dedicated full-screen branded state |
| Loaded | runtime on learner and admin fixtures | stable at measured widths |
| Empty | preformed, history and flashcards empty fixtures | explicit empty messages/actions |
| Error/not found/offline | source + tests | dedicated `SystemStatePage` variants |
| Disabled/selected/active | source + tests | aria/current, disabled and selected styles present |
| Modal/dropdown/popover | source | Base UI primitives and max-height rules present; keyboard interaction not manually exhaustive |
| Long question/answers/medical images | source CSS | wrapping/max-width rules present; representative extreme content not runtime-tested |
| Slow network | unavailable | **NOT VERIFIED** |
| Mobile software keyboard | unavailable | **NOT VERIFIED** |
| Orientation change | CSS inspected only | **NOT VERIFIED on device** |

## UI consistency inventory

| Element | Current dimensions/variants | Observation |
| --- | --- | --- |
| Primary `.q-button` | min-height 44px, padding 11×18, radius 12px | canonical base |
| Header `.q-button` | 40px / padding 9×14; at ≤639px 38px / 8×11; coarse pointer returns to 44px | same action changes density by context/input |
| Stage buttons/selects ≤700px | min-height 42px | differs from 44px canonical target |
| Icon button `.q-icon` | 42×42, radius 11px | close to, but below 44px touch target unless coarse override applies |
| Text action | min-height 36px | acceptable for secondary desktop text but inconsistent for touch |
| Inputs | common `h-11`/44px; search 56px; some inherited controls | mostly consistent, several direct variants |
| Cards | radii commonly 12/16/24px (`rounded-xl/2xl/3xl`) | multiple densities without named semantic tokens |
| Header | 64px base, 72px under 700px, 60px under 640px | two overlapping mobile rules |
| Sidebar | 254px desktop; 270px drawer | deliberate but different widths |
| Mobile navigation | 50–52px button minimum; 44px in short landscape | height varies with available viewport |
| Content page | max-width 1256px, 32px padding; reduced responsively | clear desktop cap |
| Question drawer | 84vw/420px mobile, 62vw/520px small tablet, 48vw/560px desktop, 440px ≥1280 | well-specified responsive scale |
| Dialogs | max-height `100dvh - safe areas - 2rem` | keyboard-safe intent, physical verification pending |
| Checkboxes/small controls | 24px under coarse-pointer rule | below the 44px target unless label expands the clickable region |
| Typography | 11/12/13/14/16px plus utility heading sizes; weights 600/650/750/black | broad but not yet formalized as named type scale |

## iPhone PWA audit

**Source verified:**

- `viewportFit: cover`, Apple web-app capable metadata, `black-translucent` status bar.
- CSS safe-area variables for all four edges.
- shell/test/dialog/drawer/mobile-nav rules account for safe top/bottom.
- `html`/`body` are fixed and the app owns nested scrolling surfaces with `-webkit-overflow-scrolling: touch`.
- `100dvh` is used for dialogs/short-screen cards; the primary shell uses fixed inset/100% rather than raw `100vh`.
- a standalone-iOS bootstrap detects installed mode, adds `q-ios-pwa`, changes the viewport to disable zoom, and prevents gesture/double-tap/ctrl-wheel zoom.

**Concerns:** disabling user zoom is an accessibility risk; fixed-body/nested scroll can interact poorly with keyboard, selection and Safari restoration; safe-area ownership is complex and should be tested on notch/home-indicator devices.

**NOT VERIFIED — ENVIRONMENT UNAVAILABLE:** actual install, splash, Dynamic Island, home indicator, rubber-band, keyboard, status-bar, rotation and background resume.

## iPad audit

- 768px and 820px portrait deliberately use the mobile/bottom-navigation layout.
- 1024px switches abruptly to the desktop sidebar, including 1024px portrait.
- Tablet-specific CSS removes extra stage bottom padding from 768–1023px.
- Modal and drawer sizes have tablet ranges.

Potential UX issue: 820px portrait has substantial width but still hides most navigation in a drawer. Conversely, 1024px portrait immediately spends 254px on a sidebar. Neither produced horizontal overflow on the dashboard, but the breakpoint choice needs user testing.

**NOT VERIFIED:** installed iPad PWA, keyboard, split view, Stage Manager, touch table interaction and orientation state preservation.

## Desktop preservation requirements

1. Keep the 254px persistent sidebar at ≥1024px unless deliberately redesigned.
2. Preserve max-width 1256px content and current information density at 1280–1920px.
3. Preserve keyboard focus, skip link, hover affordances and visible action labels.
4. Preserve resizable read-only explanation panel and desktop-only shared-note auto-open behavior.
5. Do not let mobile safe-area padding add blank desktop gutters.
6. Preserve table horizontal scrolling rather than clipping columns until tables are redesigned.
7. Keep desktop header/action density separate from coarse-pointer 44px targets.

## Interaction and touch

- Coarse-pointer CSS enlarges buttons/links/inputs to at least 44px in most key surfaces.
- Touch scrolling uses pan/pinch declarations; hover is not the only event path according to existing tests.
- Keyboard-accessible Base UI components, skip link, aria labels/current state and reduced-motion rules are present.
- No swipe/long-press product gesture was found.
- Admin tables and horizontally scrolling header actions have limited visual indication that more content exists.
- Full keyboard tab-order, Escape behavior, screen reader output and real accidental-tap behavior are **NOT VERIFIED**.

