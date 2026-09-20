# Qraft PWA Architecture

## Context model

Qraft distinguishes three independent facts:

1. presentation size/capability: desktop, tablet or handheld;
2. browser display mode: browser tab or standalone PWA;
3. connection state: online or offline.

Installed mode does not imply iPhone, and handheld mode does not imply installation.

## Startup and shell selection

An inline capability bootstrap writes coarse presentation hints to the root element before React paints. The React presentation environment then subscribes to the same media queries. CSS can paint the correct initial shell while account and local state hydrate, preventing a desktop-to-mobile flash.

User-agent parsing is not used for presentation selection. Zoom remains available. `viewport-fit=cover`, dynamic viewport units and visual-viewport measurement provide the required iOS behavior without gesture interception.

## Viewport and keyboard

- use `100dvh`/`100svh` with a percentage-height fallback;
- expose visual viewport height and top offset as CSS custom properties;
- hide or relocate bottom navigation only when visual viewport occlusion indicates an open keyboard;
- scroll focused fields into view using browser behavior and a safe scroll margin;
- avoid hardcoded keyboard heights.

## Offline and resume

- local study state remains immediately usable where the shared core already supports it;
- collaboration mutations use the Phase 2 IndexedDB outbox;
- network-dependent operations present explicit queued/offline/error states;
- service worker caches versioned shell assets and uses network-first navigation with an offline fallback;
- the app does not claim a cold, fully offline product data experience;
- `visibilitychange`, `pagehide`, `online` and `offline` continue to drive checkpoint/replay behavior.

## Update policy

The service worker owns a versioned shell cache, deletes obsolete caches on activation and notifies clients when a new worker controls the page. The UI announces that an update is ready, lets the user dismiss it, sends `QRAFT_SKIP_WAITING` only after an explicit update action and reloads after `controllerchange`.

## Installation metadata

- manifest uses a stable app id/scope/start URL;
- maskable and Apple touch icons remain available;
- theme colors track light/dark shell surfaces;
- standalone navigation stays within application scope;
- no orientation lock is imposed.

## Verification boundaries

Automated browser emulation can verify viewport composition, overflow, safe-area variables, keyboard simulations, route startup, console output and network behavior. Dynamic Island, real home-indicator spacing, Safari text selection, installation prompts and background process suspension require physical iPhone/iPad testing and must remain explicitly labelled until completed.
