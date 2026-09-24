'use client';

import { Bookmark, Check, Circle, Flag, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type QuestionNavigatorItem = {
  id: string;
  preview: string;
  answered: boolean;
  flagged?: boolean;
  bookmarked?: boolean;
  revealed?: boolean;
  result?: 'correct' | 'incorrect';
  disabled?: boolean;
};

type NavigatorAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: ReactNode;
};

const ROW_HEIGHT = 64;
const OVERSCAN = 8;

export function QuestionNavigator({
  open,
  title,
  items,
  currentIndex,
  onSelect,
  onClose,
  secondaryAction,
  primaryAction,
}: {
  open: boolean;
  title: string;
  items: QuestionNavigatorItem[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  secondaryAction?: NavigatorAction;
  primaryAction?: NavigatorAction;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 640 });
  const answeredCount = useMemo(
    () => items.reduce((count, item) => count + Number(item.answered), 0),
    [items],
  );
  const startIndex = Math.max(
    0,
    Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN,
  );
  const endIndex = Math.min(
    items.length,
    Math.ceil((viewport.scrollTop + viewport.height) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleItems = items.slice(startIndex, endIndex);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) {
        const target = Math.max(
          0,
          Math.min(
            currentIndex * ROW_HEIGHT - list.clientHeight / 2 + ROW_HEIGHT / 2,
            items.length * ROW_HEIGHT - list.clientHeight,
          ),
        );
        list.scrollTop = target;
        setViewport({ scrollTop: target, height: list.clientHeight });
      }
      list?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [currentIndex, items.length, open]);

  useEffect(() => {
    if (!open || !listRef.current || typeof ResizeObserver === 'undefined')
      return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport((current) => ({
        scrollTop: current.scrollTop,
        height: entry.contentRect.height,
      }));
    });
    observer.observe(listRef.current);
    return () => observer.disconnect();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-start bg-slate-950/40 backdrop-blur-[1px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog
        open
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby="question-navigator-title"
        className="q-question-drawer relative m-0 flex min-w-0 max-w-none flex-col border-0 border-r bg-card p-0 text-foreground shadow-[20px_0_60px_rgba(2,12,27,.22)]"
      >
        <header className="q-question-drawer-header shrink-0 border-b px-5 pb-4">
          <div className="min-w-0" dir="auto">
            <h2
              id="question-navigator-title"
              className="truncate text-lg font-bold tracking-tight"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {answeredCount} of {items.length} answered
            </p>
          </div>
          <progress
            aria-label="Answered questions"
            max={items.length || 1}
            value={answeredCount}
            className="q-native-progress mt-4 h-1"
          />
        </header>
        <div
          ref={listRef}
          tabIndex={-1}
          className="q-question-drawer-list min-h-0 flex-1 overflow-y-auto"
          dir="ltr"
          aria-label="Questions"
          onScroll={(event) => {
            const scrollTop = event.currentTarget.scrollTop;
            setViewport((current) => ({
              scrollTop,
              height: current.height,
            }));
          }}
        >
          <div
            className="relative w-full"
            style={{ height: `${items.length * ROW_HEIGHT}px` }}
          >
            {visibleItems.map((item, visibleIndex) => {
              const index = startIndex + visibleIndex;
              const current = index === currentIndex;
              const stateLabel = [
                item.answered ? 'answered' : 'unanswered',
                item.flagged ? 'flagged' : '',
                item.bookmarked ? 'bookmarked' : '',
                item.revealed ? 'revealed' : '',
                item.result,
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <button
                  type="button"
                  key={item.id}
                  disabled={item.disabled}
                  onClick={() => {
                    onSelect(index);
                    onClose();
                  }}
                  aria-label={`Question ${index + 1}: ${item.preview}, ${stateLabel}`}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'q-question-navigator-row group absolute left-0 grid w-full grid-cols-[24px_32px_minmax(0,1fr)_44px] items-center gap-2 border-l-[3px] border-b border-l-transparent border-b-border/55 px-5 text-left transition-colors',
                    current
                      ? 'border-l-primary bg-primary/8 text-foreground'
                      : 'hover:bg-muted/60',
                    item.disabled &&
                      'cursor-not-allowed opacity-45 hover:bg-transparent',
                  )}
                  style={{
                    height: `${ROW_HEIGHT}px`,
                    top: `${index * ROW_HEIGHT}px`,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid size-5 place-items-center rounded-full border-2 transition-colors',
                      item.result === 'correct'
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : item.result === 'incorrect'
                          ? 'border-red-500 bg-red-500 text-white'
                          : item.answered
                            ? 'border-primary bg-primary text-primary-foreground'
                            : current
                              ? 'border-primary text-primary'
                              : item.flagged
                                ? 'border-amber-500'
                                : 'border-muted-foreground/70',
                    )}
                  >
                    {item.result === 'incorrect' ? (
                      <X className="size-3" strokeWidth={3} />
                    ) : item.answered || item.result === 'correct' ? (
                      <Check className="size-3" strokeWidth={3} />
                    ) : current ? (
                      <span className="size-1.5 rounded-full bg-current" />
                    ) : (
                      <Circle className="size-0" />
                    )}
                  </span>
                  <span
                    className={cn(
                      'text-sm font-bold tabular-nums',
                      current ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {index + 1}
                  </span>
                  <span
                    dir="auto"
                    className="block min-w-0 truncate text-sm font-medium text-foreground/85"
                  >
                    {item.preview}
                  </span>
                  <span
                    className="flex items-center justify-end gap-1"
                    aria-hidden="true"
                  >
                    {item.bookmarked && (
                      <Bookmark className="size-3.5 fill-primary text-primary" />
                    )}
                    {item.flagged && (
                      <Flag className="size-3.5 fill-amber-400 text-amber-500" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {(secondaryAction || primaryAction) && (
          <footer className="q-question-drawer-footer grid shrink-0 grid-cols-2 gap-2 border-t bg-card px-4 pt-3">
            {secondaryAction && (
              <button
                type="button"
                disabled={secondaryAction.disabled}
                onClick={secondaryAction.onClick}
                className="q-button q-button-secondary min-w-0"
              >
                {secondaryAction.icon}
                <span className="truncate">{secondaryAction.label}</span>
              </button>
            )}
            {primaryAction && (
              <button
                type="button"
                disabled={primaryAction.disabled}
                onClick={primaryAction.onClick}
                className="q-button q-button-primary min-w-0"
              >
                {primaryAction.icon}
                <span className="truncate">{primaryAction.label}</span>
              </button>
            )}
          </footer>
        )}
      </dialog>
    </div>
  );
}
