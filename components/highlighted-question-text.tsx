import type { ReactNode } from 'react';
import { FormattedQuestionText } from '@/components/formatted-question-text';
import { mergeRanges } from '@/features/exams/domain/highlight-ranges';
import type { HighlightRange } from '@/lib/medguard-types';

export function HighlightedText({ text, ranges, onRemove, interactive = true }: {
  text: string;
  ranges: HighlightRange[];
  onRemove?: (range: HighlightRange) => void;
  interactive?: boolean;
}) {
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
      output.push(<mark key={`${range.start}-${range.end}`} className="rounded-sm bg-[#ffe66d] px-0.5 text-slate-900">
        {interactive ? <button type="button" title="Click to remove marker" aria-label={`Remove highlight: ${marked}`} onClick={() => onRemove?.(range)} className="cursor-pointer text-inherit">{marked}</button> : marked}
      </mark>);
      cursor = end;
    }
    if (cursor < value.length) output.push(value.slice(cursor));
    return output;
  }} />;
}
