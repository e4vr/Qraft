import { Fragment, type ReactNode } from 'react';
import { boldTextSegments } from '@/features/qbanks/domain/bold-text';

export function FormattedQuestionText({
  text,
  renderSegment = value => value,
}: {
  text: string;
  renderSegment?: (value: string, sourceStart: number) => ReactNode;
}) {
  return boldTextSegments(text).map(segment => segment.bold ? (
    <strong key={segment.start} className="font-bold">{renderSegment(segment.text, segment.start)}</strong>
  ) : (
    <Fragment key={segment.start}>{renderSegment(segment.text, segment.start)}</Fragment>
  ));
}
