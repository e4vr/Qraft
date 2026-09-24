'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type PresentationMode = 'desktop' | 'tablet' | 'handheld';

export interface PresentationEnvironment {
  mode: PresentationMode;
  standalone: boolean;
  coarsePointer: boolean;
  hover: boolean;
  keyboardOpen: boolean;
}

const DESKTOP_QUERY = '(min-width: 1180px) and (hover: hover) and (pointer: fine)';
const HANDHELD_QUERY =
  '(max-width: 560px), (max-width: 767px) and (hover: none), (max-width: 767px) and (pointer: coarse)';
const STANDALONE_QUERY = '(display-mode: standalone)';

function standaloneMode() {
  return (
    window.matchMedia(STANDALONE_QUERY).matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function isIPad() {
  return (
    /iPad/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function installStandaloneTouchGuards() {
  let startY = 0;

  const prevent = (event: Event) => event.preventDefault();
  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length === 1) startY = event.touches[0].clientY;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault();
      return;
    }
    if (event.touches.length !== 1 || event.touches[0].clientY <= startY) return;

    let element = event.target instanceof Element ? event.target : null;
    while (element && element !== document.documentElement) {
      if (element.scrollHeight > element.clientHeight + 1 && element.scrollTop > 0)
        return;
      element = element.parentElement;
    }
    event.preventDefault();
  };
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  };

  const passive = { passive: false } as const;
  document.addEventListener('gesturestart', prevent, passive);
  document.addEventListener('gesturechange', prevent, passive);
  document.addEventListener('gestureend', prevent, passive);
  document.addEventListener('dblclick', prevent, passive);
  document.addEventListener('touchstart', onTouchStart, passive);
  document.addEventListener('touchmove', onTouchMove, passive);
  document.addEventListener('wheel', onWheel, passive);
  return () => {
    document.removeEventListener('gesturestart', prevent);
    document.removeEventListener('gesturechange', prevent);
    document.removeEventListener('gestureend', prevent);
    document.removeEventListener('dblclick', prevent);
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('wheel', onWheel);
  };
}

function currentEnvironment(): PresentationEnvironment {
  const standalone = standaloneMode();
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const hover = window.matchMedia('(hover: hover)').matches;
  const handheld =
    window.matchMedia(HANDHELD_QUERY).matches ||
    (standalone && window.matchMedia('(max-width: 899px)').matches);
  const desktop = window.matchMedia(DESKTOP_QUERY).matches;
  const viewport = window.visualViewport;
  const keyboardOpen = Boolean(
    viewport && window.innerHeight - viewport.height > 140,
  );
  return {
    mode: handheld ? 'handheld' : desktop ? 'desktop' : 'tablet',
    standalone,
    coarsePointer,
    hover,
    keyboardOpen,
  };
}

const serverSnapshot: PresentationEnvironment = {
  mode: 'desktop',
  standalone: false,
  coarsePointer: false,
  hover: true,
  keyboardOpen: false,
};

function serialize(environment: PresentationEnvironment) {
  return [
    environment.mode,
    environment.standalone ? '1' : '0',
    environment.coarsePointer ? '1' : '0',
    environment.hover ? '1' : '0',
    environment.keyboardOpen ? '1' : '0',
  ].join('|');
}

function parse(serialized: string): PresentationEnvironment {
  const [mode, standalone, coarsePointer, hover, keyboardOpen] = serialized.split('|');
  return {
    mode: mode as PresentationMode,
    standalone: standalone === '1',
    coarsePointer: coarsePointer === '1',
    hover: hover === '1',
    keyboardOpen: keyboardOpen === '1',
  };
}

const serverSnapshotKey = serialize(serverSnapshot);
const snapshot = () => serialize(currentEnvironment());

function subscribe(onChange: () => void) {
  const queries = [
    DESKTOP_QUERY,
    HANDHELD_QUERY,
    STANDALONE_QUERY,
    '(pointer: coarse)',
    '(hover: hover)',
  ].map((query) => window.matchMedia(query));
  const notify = () => onChange();
  queries.forEach((query) => query.addEventListener('change', notify));
  window.addEventListener('resize', notify);
  window.visualViewport?.addEventListener('resize', notify);
  window.visualViewport?.addEventListener('scroll', notify);
  return () => {
    queries.forEach((query) => query.removeEventListener('change', notify));
    window.removeEventListener('resize', notify);
    window.visualViewport?.removeEventListener('resize', notify);
    window.visualViewport?.removeEventListener('scroll', notify);
  };
}

const PresentationContext = createContext<PresentationEnvironment>(serverSnapshot);

export function PresentationProvider({ children }: { children: ReactNode }) {
  const serialized = useSyncExternalStore(subscribe, snapshot, () => serverSnapshotKey);
  const environment = useMemo(() => parse(serialized), [serialized]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.presentation = environment.mode;
    root.dataset.standalone = environment.standalone ? 'true' : 'false';
    root.dataset.keyboard = environment.keyboardOpen ? 'open' : 'closed';
    root.dataset.ipad = isIPad() ? 'true' : 'false';

    const applyVisualViewport = () => {
      const viewport = window.visualViewport;
      root.style.setProperty(
        '--q-visual-height',
        `${viewport?.height ?? window.innerHeight}px`,
      );
    };
    applyVisualViewport();
    window.visualViewport?.addEventListener('resize', applyVisualViewport);
    window.visualViewport?.addEventListener('scroll', applyVisualViewport);
    return () => {
      window.visualViewport?.removeEventListener('resize', applyVisualViewport);
      window.visualViewport?.removeEventListener('scroll', applyVisualViewport);
    };
  }, [environment]);

  useEffect(() => {
    if (!environment.standalone) return;
    const removeTouchGuards = installStandaloneTouchGuards();
    return removeTouchGuards;
  }, [environment.standalone]);

  return (
    <PresentationContext.Provider value={environment}>
      {children}
    </PresentationContext.Provider>
  );
}

export function usePresentationEnvironment() {
  return useContext(PresentationContext);
}
