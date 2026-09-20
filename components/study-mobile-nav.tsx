'use client';

import {
  BarChart3,
  ClipboardPlus,
  Ellipsis,
  House,
  Layers3,
  Library,
} from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

const primaryItems = [
  { id: 'dashboard', label: 'Home', icon: House },
  { id: 'library', label: 'QBanks', icon: Library },
  { id: 'create', label: 'Study', icon: ClipboardPlus, emphasized: true },
  { id: 'flashcards', label: 'Cards', icon: Layers3 },
  { id: 'progress', label: 'Progress', icon: BarChart3 },
] as const;

type PrimaryView = (typeof primaryItems)[number]['id'];

export function StudyMobileNav({
  view,
  onNavigate,
}: {
  view: string;
  onNavigate: (view: PrimaryView) => void;
}) {
  return (
    <nav className="q-mobile-nav" aria-label="Primary navigation">
      {primaryItems.map((item) => (
        <button
          type="button"
          key={item.id}
          aria-current={view === item.id ? 'page' : undefined}
          className={cn(item.id === 'create' && 'mobile-start')}
          onClick={() => onNavigate(item.id)}
        >
          <item.icon aria-hidden="true" className="size-5" />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function StudyTabletRail({
  view,
  onNavigate,
  onMore,
}: {
  view: string;
  onNavigate: (view: PrimaryView) => void;
  onMore: () => void;
}) {
  return (
    <nav className="q-tablet-rail" aria-label="Primary navigation">
      <Image src="/favicon.svg" alt="Qraft" width={36} height={36} className="mx-auto mb-3 size-9" />
      {primaryItems.map((item) => (
        <button
          type="button"
          key={item.id}
          aria-label={item.label}
          title={item.label}
          aria-current={view === item.id ? 'page' : undefined}
          onClick={() => onNavigate(item.id)}
        >
          <item.icon aria-hidden="true" className="size-5" />
          <span>{item.label}</span>
        </button>
      ))}
      <button type="button" aria-label="More" title="More" onClick={onMore}>
        <Ellipsis aria-hidden="true" className="size-5" />
        <span>More</span>
      </button>
    </nav>
  );
}
