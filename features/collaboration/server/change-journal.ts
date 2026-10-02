import { env } from 'cloudflare:workers';
import { deltaCollections } from '../domain/collaboration-delta';

export type JournalChange = {
  collection: string;
  record_id: string;
  qbank_id: string | null;
  owner_id: string | null;
  reset_required: number;
};

export async function readChangeWindow(request: Request, uid: string) {
  // Read the watermark BEFORE records. A write during snapshot construction is
  // replayed on the next request, never skipped by a later watermark.
  const head = await env.DB.prepare("SELECT coalesce((SELECT seq FROM sqlite_sequence WHERE name='collaboration_changes'),0) AS head,coalesce((SELECT min(sequence) FROM collaboration_changes),0) AS oldest")
    .first<{ head: number; oldest: number }>();
  const url = new URL(request.url);
  const raw = url.searchParams.get('since');
  const since = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
  const cursor = { version: 1 as const, sequence: head?.head ?? 0, uid, scope: '' };
  if (url.searchParams.get('syncUid') !== uid || !Number.isSafeInteger(since) || since < 0 || since > cursor.sequence || since < (head?.oldest ?? 0) - 1 ||
      (cursor.sequence > since && head?.oldest === 0))
    return { cursor, changes: undefined };
  const [retention, result] = await env.DB.batch([
    env.DB.prepare('SELECT coalesce(min(sequence),0) AS oldest FROM collaboration_changes'),
    env.DB.prepare('SELECT collection,record_id,qbank_id,owner_id,reset_required FROM collaboration_changes WHERE sequence>? AND sequence<=? ORDER BY sequence LIMIT 2001')
      .bind(since, cursor.sequence),
  ]);
  // Check retention in the same transaction as the journal read. Pruning
  // between the earlier watermark and this read must cause a full snapshot.
  const oldest = Number((retention.results[0] as { oldest?: number } | undefined)?.oldest ?? 0);
  if (since < oldest - 1 || (oldest === 0 && cursor.sequence > since))
    return { cursor, changes: undefined };
  const changes = result.results as JournalChange[];
  if (changes.length > 2000 || changes.some(row => row.reset_required ||
      (!(row.collection in deltaCollections) && !['qbanks', 'qbankTombstones', 'qbankFolders'].includes(row.collection))))
    return { cursor, changes: undefined };
  return { cursor, changes: [...new Map(changes.map(row => [`${row.collection}\0${row.record_id}`, row])).values()] };
}

export async function cleanCollaborationChanges() {
  // Bounded retention with a full snapshot fallback for older clients. The
  // AUTOINCREMENT sequence survives pruning, so cursors are never reused.
  await env.DB.prepare("DELETE FROM collaboration_changes WHERE sequence < coalesce((SELECT seq FROM sqlite_sequence WHERE name='collaboration_changes'),0)-50000").run();
}
