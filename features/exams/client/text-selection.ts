import { boldTextSegments, boldTextSourceOffset } from '@/features/qbanks/domain/bold-text';
import type { HighlightRange } from '@/lib/medguard-types';

/** Read DOM text offsets before changing markup; persisted offsets refer to the source. */
export function selectedTextRange(root: HTMLElement, source: string, selection: Selection | null): HighlightRange | undefined {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
  if (!range.toString().trim()) return;
  // Ignore stale markup or a selection containing a different question/section.
  const visible = boldTextSegments(source).map(segment => segment.text).join('');
  if (root.textContent !== visible) return;
  const before = root.ownerDocument.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const offset = before.toString().length;
  const start = boldTextSourceOffset(source, offset, 'start');
  const end = boldTextSourceOffset(source, offset + range.toString().length, 'end');
  return end > start && start >= 0 && end <= source.length ? { start, end } : undefined;
}
