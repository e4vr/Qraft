'use client';

import type { ReactNode } from 'react';
import { usePresentationEnvironment } from '@/features/presentation/presentation-context';
import { cn } from '@/lib/utils';

export function QraftAppShell({
  navigation,
  handheldNavigation,
  tabletNavigation,
  announcement,
  navigationOpen,
  contentKey,
  children,
}: {
  navigation: ReactNode;
  handheldNavigation: ReactNode;
  tabletNavigation: ReactNode;
  announcement?: ReactNode;
  navigationOpen: boolean;
  contentKey: string;
  children: ReactNode;
}) {
  const { mode, standalone, keyboardOpen } = usePresentationEnvironment();
  return (
    <main
      className="q-shell bg-background text-foreground"
      data-presentation={mode}
      data-standalone={standalone ? 'true' : 'false'}
      data-keyboard={keyboardOpen ? 'open' : 'closed'}
      data-navigation-open={navigationOpen ? 'true' : 'false'}
    >
      <a className="skip-navigation" href="#main-content">
        Skip to content
      </a>
      {mode === 'handheld' && handheldNavigation}
      {mode === 'tablet' && tabletNavigation}
      <div
        className={cn(
          'q-frame flex',
          mode === 'desktop' && 'q-frame-desktop',
          mode === 'tablet' && 'q-frame-tablet',
        )}
      >
        {navigation}
        <section
          id="main-content"
          tabIndex={-1}
          key={contentKey}
          className="q-stage q-enter"
        >
          {announcement}
          {children}
        </section>
      </div>
    </main>
  );
}
