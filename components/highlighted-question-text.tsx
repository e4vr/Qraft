import { useRef, type ReactNode } from 'react';
import { FormattedQuestionText } from '@/components/formatted-question-text';
import { mergeRanges } from '@/features/exams/domain/highlight-ranges';
import type { HighlightRange } from '@/lib/medguard-types';

export function HighlightedText({ text, ranges, onRemove, interactive = true }: {
  text: string;
  ranges: HighlightRange[];
  onRemove?: (range: HighlightRange) => void;
  interactive?: boolean;
}) {
  const suppressRemoval = useRef(false);
  const removable = interactive && Boolean(onRemove);
  const valid = mergeRanges(ranges).filter(range => range.start < text.length);
  return <FormattedQuestionText text={text} renderSegment={(value, sourceStart) => {
    const output: ReactNode[] = [];
    let cursor = 0;
    for (const range of valid) {
      const start = Math.max(0, range.start - sourceStart);
      const end = Math.min(value.length, range.end - sourceStart);
      if (start >= end) continue;
      if (start > cursor) output.push(value.slice(cursor, start));
      const marked = value.slice(start, end);
      if (!removable) {
        output.push(<mark key={`${range.start}-${range.end}`} className="q-text-highlight q-compact-touch">{marked}</mark>);
        cursor = end;
        continue;
      }
      // A native button forms an atomic text box even across lines. Keep the
      // mark inline while exposing keyboard removal to assistive technology.
      /* oxlint-disable jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role */
      output.push(<mark
        key={`${range.start}-${range.end}`}
        className="q-text-highlight q-compact-touch"
        role="button"
        tabIndex={removable ? 0 : undefined}
        title={removable ? 'Click or press Enter to remove highlight' : undefined}
        aria-label={removable ? `Remove highlight: ${marked}` : undefined}
        onPointerDown={removable ? () => { suppressRemoval.current = false; } : undefined}
        onPointerUp={removable ? () => {
          // The paragraph applies and clears the selection next. Keep its click
          // from removing a marker when a drag ends over highlighted text.
          suppressRemoval.current = Boolean(window.getSelection()?.toString());
        } : undefined}
        onClick={removable ? () => {
          if (suppressRemoval.current || window.getSelection()?.toString()) return;
          onRemove?.(range);
        } : undefined}
        onKeyDown={removable ? (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onRemove?.(range);
        } : undefined}
      >{marked}</mark>);
      /* oxlint-enable jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role */
      cursor = end;
    }
    if (cursor < value.length) output.push(value.slice(cursor));
    return output;
  }} />;
}
