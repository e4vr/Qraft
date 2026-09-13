'use client';

import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

export function WorkspaceHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  leading,
  showMenu = true,
  onOpenMenu,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  showMenu?: boolean;
  onOpenMenu?: () => void;
  className?: string;
}) {
  return (
    <header className={cn('workspace-header', className)}>
      <div className="workspace-header-primary">
        {leading ??
          (showMenu ? (
            <button
              type="button"
              aria-label="Open navigation"
              className="q-icon workspace-header-menu lg:hidden"
              onClick={
                onOpenMenu ??
                (() => window.dispatchEvent(new Event('medguard-open-menu')))
              }
            >
              <Menu className="size-5" />
            </button>
          ) : null)}
        <div className="min-w-0">
          {eyebrow && <p className="q-eyebrow workspace-header-eyebrow">{eyebrow}</p>}
          <h1 className="workspace-header-title">{title}</h1>
          {subtitle && <p className="workspace-header-subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="workspace-header-actions">{actions}</div>}
    </header>
  );
}
