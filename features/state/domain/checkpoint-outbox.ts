import type { StateSyncOperation } from '@/lib/local-db';

type Selection = { qbankId: string; questionId: string; answer: number };

/** Never change an attempted operation: its server acknowledgement may be lost. */
export function coalesceStateCheckpoints(pending: StateSyncOperation[], next: StateSyncOperation) {
  const replaceable = pending.filter(item => item.kind === next.kind && item.attempts === 0);
  const ordered = [...replaceable, next].sort((a, b) => {
    const freshness = (item: StateSyncOperation) => {
      const value = item.payload.clientUpdatedAt ?? (item.payload.state as { clientUpdatedAt?: string } | undefined)?.clientUpdatedAt;
      return typeof value === 'string' ? value : item.createdAt;
    };
    return freshness(a).localeCompare(freshness(b));
  });
  const newest = ordered.at(-1)!;
  if (next.kind === 'exam') {
    if (pending.some(item => item.kind === 'exam' && JSON.stringify(item.payload) === JSON.stringify(next.payload))) return pending;
    const selections = new Map<string, Selection>();
    for (const item of ordered) {
      for (const selection of (item.payload.answerSelections ?? []) as Selection[])
        selections.set(JSON.stringify([selection.qbankId, selection.questionId]), selection);
    }
    // The endpoint deliberately caps one checkpoint at 500 selections.
    if (selections.size > 500) return [...pending, next];
    next = { ...next, payload: { ...newest.payload, answerSelections: [...selections.values()] } };
  } else next = { ...next, payload: newest.payload };
  return [...pending.filter(item => item.kind !== next.kind || item.attempts > 0), next]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
