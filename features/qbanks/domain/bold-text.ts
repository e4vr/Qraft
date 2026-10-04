export type BoldTextSegment = { text: string; start: number; bold: boolean };

/** Keep stored text intact; only paired ** markers affect presentation. */
export function boldTextSegments(text: string): BoldTextSegment[] {
  const segments: BoldTextSegment[] = [];
  const pattern = /(?<!\\)\*\*(?!\*)((?=\S)[\s\S]*?\S)\*\*/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), start: cursor, bold: false });
    segments.push({ text: match[1], start: start + 2, bold: true });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), start: cursor, bold: false });
  return segments;
}

/** Highlights are persisted against the original text, including its markers. */
export function boldTextSourceOffset(text: string, visibleOffset: number, edge: 'start' | 'end') {
  let visible = 0;
  const segments = boldTextSegments(text);
  for (const segment of segments) {
    const end = visible + segment.text.length;
    if (visibleOffset < end || (visibleOffset === end && edge === 'end')) {
      return segment.start + Math.max(0, visibleOffset - visible);
    }
    visible = end;
  }
  const last = segments.at(-1);
  return last ? last.start + last.text.length : 0;
}
