'use client';

import type { ReactNode } from 'react';
import { ScanSearch } from 'lucide-react';
import {
  PROPOSAL_EDIT_KINDS,
  type ReportKindFilter,
  type ReviewCategory,
} from '@/features/contributions/domain/proposal-filters';
import { cn } from '@/lib/utils';

export function ReviewFilters({
  category,
  onCategoryChange,
  kind,
  onKindChange,
  duplicateCount,
  children,
}: {
  category: ReviewCategory;
  onCategoryChange: (category: ReviewCategory) => void;
  kind: ReportKindFilter;
  onKindChange: (kind: ReportKindFilter) => void;
  duplicateCount: number;
  children?: ReactNode;
}) {
  return (
    <div className="q-review-filter-bar mb-5 rounded-2xl border bg-card p-2">
      <div className="q-review-filter-main">
        <fieldset
          className="q-review-filter-tabs"
          aria-label="Request types"
        >
          {(
            [
              ['all', 'All'],
              ['new', 'New question'],
              ['edits', 'Reports and edits'],
              ['duplicates', 'Duplications'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={category === value}
              onClick={() => onCategoryChange(value)}
              className={cn(
                'rounded-xl px-3 py-2 text-sm font-bold',
                category === value
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted',
              )}
            >
              {value === 'duplicates' && (
                <ScanSearch className="mr-1 inline size-4" />
              )}
              {label}
              {value === 'duplicates' && (
                <span className="ml-1.5 tabular-nums">· {duplicateCount}</span>
              )}
            </button>
          ))}
        </fieldset>
        <label className="q-review-kind-filter">
          <span className="sr-only">Report type</span>
          <select
            value={category === 'new' ? 'all' : kind}
            disabled={category === 'new'}
            onChange={(event) =>
              onKindChange(event.target.value as ReportKindFilter)
            }
            className="h-10 w-full rounded-xl border bg-background px-3 text-sm font-semibold text-foreground disabled:opacity-50"
          >
            <option value="all">ALL</option>
            {PROPOSAL_EDIT_KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {children && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 border-t pt-2">
          {children}
        </div>
      )}
    </div>
  );
}
