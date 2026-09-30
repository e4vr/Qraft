'use client';

import {
  Award,
  BarChart3,
  BookOpenCheck,
  CircleAlert,
  ClipboardList,
  ClipboardPlus,
  Ellipsis,
  Globe2,
  House,
  Layers3,
  Library,
  ScanSearch,
  Settings,
  Sparkles,
} from 'lucide-react';
import { QraftBrand } from '@/components/brand/qraft-brand';
import { cn } from '@/lib/utils';

const primaryItems = [
  { id: 'dashboard', label: 'Home', icon: House },
  { id: 'library', label: 'QBanks', icon: Library },
  { id: 'create', label: 'Study', icon: ClipboardPlus, emphasized: true },
  { id: 'flashcards', label: 'Cards', icon: Layers3 },
  { id: 'progress', label: 'Progress', icon: BarChart3 },
] as const;

type PrimaryView = (typeof primaryItems)[number]['id'];

const tabletCoreItems = [
  { id: 'dashboard', label: 'Home', icon: House },
  { id: 'library', label: 'QBanks', icon: Library },
  { id: 'create', label: 'Study', icon: ClipboardPlus },
  { id: 'preformed', label: 'Preformed', icon: Globe2 },
  { id: 'history', label: 'History', icon: BookOpenCheck },
  { id: 'flashcards', label: 'Cards', icon: Layers3 },
  { id: 'progress', label: 'Progress', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

const tabletReviewItem = { id: 'review', label: 'Review', icon: ScanSearch } as const;
const tabletContactItem = { id: 'contact', label: 'Contact', icon: CircleAlert } as const;
const tabletSubscribeItem = { id: 'subscribe', label: 'Plans', icon: Sparkles } as const;
const tabletCommunityItems = [
  { id: 'contribution-center', label: 'Contribute', icon: Award },
  { id: 'manager', label: 'Add', icon: ClipboardList },
] as const;
const TABLET_RAIL_ITEM_LIMIT = 10;

type TabletView =
  | (typeof tabletCoreItems)[number]['id']
  | typeof tabletReviewItem.id
  | typeof tabletContactItem.id
  | typeof tabletSubscribeItem.id
  | (typeof tabletCommunityItems)[number]['id'];

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
  showReview,
  showSubscribe,
}: {
  view: string;
  onNavigate: (view: TabletView) => void;
  onMore: () => void;
  showReview: boolean;
  showSubscribe: boolean;
}) {
  const tabletItems = [
    ...tabletCoreItems,
    ...(showReview ? [tabletReviewItem] : []),
    tabletContactItem,
    ...(showSubscribe ? [tabletSubscribeItem] : []),
    ...tabletCommunityItems,
  ].slice(0, TABLET_RAIL_ITEM_LIMIT);

  return (
    <nav className="q-tablet-rail" aria-label="Primary navigation">
      <span className="q-brand-badge mx-auto mb-3 grid size-10 place-items-center rounded-xl bg-[#f3fafa] p-1.5">
        <QraftBrand variant="mark" className="size-full" />
      </span>
      {tabletItems.map((item) => (
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
