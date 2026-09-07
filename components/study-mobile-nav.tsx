'use client';

import { BookOpenCheck, ClipboardPlus, LayoutDashboard, Library } from 'lucide-react';

const items = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'library', label: 'QBanks', icon: Library },
  { id: 'create', label: 'New test', icon: ClipboardPlus },
  { id: 'history', label: 'History', icon: BookOpenCheck },
] as const;

export function StudyMobileNav({ view, onNavigate }: { view: string; onNavigate: (view: typeof items[number]['id']) => void }) {
  return <nav className="q-mobile-nav" aria-label="Quick navigation">
    {items.map((item) => <button key={item.id} aria-current={view === item.id ? 'page' : undefined} className={item.id === 'create' ? 'mobile-start' : undefined} onClick={() => onNavigate(item.id)}><item.icon className="size-5" /><span>{item.label}</span></button>)}
  </nav>;
}
