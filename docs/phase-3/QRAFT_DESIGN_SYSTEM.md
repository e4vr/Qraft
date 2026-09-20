# Qraft Design System

## Product character

Qraft is a focused medical study environment: calm, precise, trustworthy and fast. Educational content is visually dominant. Color communicates state and hierarchy rather than decoration.

## Token families

The implementation uses centralized CSS custom properties consumed by Tailwind aliases and component classes.

| Family | Contract |
| --- | --- |
| color | canvas, surface, elevated surface, text tiers, border, brand, study, success, warning, danger and information |
| typography | caption, label, body, body-strong, title, display; system font stack with tabular numerals where needed |
| spacing | 4px base rhythm with named component gaps and page gutters |
| radius | control, card, dialog/sheet and pill |
| elevation | low surface, raised overlay and navigation chrome |
| motion | fast feedback, standard transition and deliberate sheet transition; reduced-motion override |
| layout | readable text width, workspace max width, desktop navigation, mobile top/bottom bars |
| interaction | 44px minimum coarse-pointer target, visible focus, pressed/loading/disabled/error/success states |
| safe area | top/right/bottom/left plus a single owner for every fixed edge |
| layers | content, sticky, navigation, scrim, sheet/dialog, toast |

## Component layers

Implemented primitives include the existing button/input/dialog set plus `Sheet` and `AdaptiveOverlay`. Adaptive overlays resolve to bottom sheets on handheld and dialogs on tablet/desktop without changing feature actions.

```text
tokens
  → Button / IconButton / Input / TextArea / Surface / Badge / Divider
  → Header / EmptyState / ErrorState / Sheet / Dialog / Toast / SegmentedControl
  → QBank / Exam / Flashcard / Review feature components
  → Desktop, tablet and handheld flows
  → routes
```

## Interaction contract

Every mutating control must expose:

- an immediate pressed or selected response;
- a busy state when work is asynchronous;
- duplicate-trigger prevention;
- a success result that does not unexpectedly clear context;
- a visible recoverable failure;
- an offline/queued state when the shared core supports replay.

## Accessibility contract

- semantic native controls by default;
- no global zoom prevention;
- WCAG-compatible contrast for normal text and state indicators;
- status is never represented by color alone;
- visible keyboard focus and logical focus restoration;
- VoiceOver labels for icon-only controls and counts;
- support text scaling and wrapping without clipping;
- reduced-motion respected globally;
- answer options and common study actions use the complete visible row as the hit target.

## Content patterns

- question content uses a readable line length and supports selectable text;
- medical images fit the content width and can open in a zoomable viewer;
- tables use an explicit horizontal overflow container, never page overflow;
- long options preserve letter alignment and state icon placement;
- mobile summary comes before detailed metrics;
- empty states explain both the state and the next valid action.
