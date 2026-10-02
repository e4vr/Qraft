import { env } from 'cloudflare:workers';
import { normalizeDuplicateText } from '@/features/duplicates/domain/duplicate-detection';
import { exactImportIdentity } from '../domain/exact-import-duplicates';
import type { QuestionProposalPayload } from '@/lib/medguard-types';

export async function importSearchKey(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function importKeyStatement(rows: Array<{ collection: string; id: string; payload: string }>) {
  const keys = [];
  for (const row of rows) {
    if (!['sharedQuestions', 'questionProposals'].includes(row.collection)) continue;
    const record = JSON.parse(row.payload);
    if (row.collection === 'questionProposals' && record.status !== 'pending') continue;
    const payload: QuestionProposalPayload = row.collection === 'sharedQuestions' ? record : record.payload;
    // Backups may contain incomplete legacy content. Such rows keep using FTS.
    if (!payload || typeof payload.stem !== 'string' || !Array.isArray(payload.options) ||
        !payload.options.every((option: unknown) => typeof option === 'string')) continue;
    const identity = exactImportIdentity(payload);
    keys.push({ ...row, stemKey: await importSearchKey(normalizeDuplicateText(payload.stem)),
      contentKey: identity ? await importSearchKey(identity) : null });
  }
  return env.DB.prepare(`INSERT INTO import_question_keys(record_type,record_id,qbank_id,stem_key,content_key)
    SELECT record.type,record.id,coalesce(record.qbank_id,'smle-gs'),
      json_extract(key.value,'$.stemKey'),json_extract(key.value,'$.contentKey')
    FROM json_each(?) AS key CROSS JOIN records AS record INDEXED BY idx_records_type_id
    WHERE record.type=json_extract(key.value,'$.collection') AND record.id=json_extract(key.value,'$.id')
      AND record.payload=json_extract(key.value,'$.payload')
    ON CONFLICT(record_type,record_id) DO UPDATE SET qbank_id=excluded.qbank_id,stem_key=excluded.stem_key,content_key=excluded.content_key
      WHERE import_question_keys.qbank_id IS NOT excluded.qbank_id
        OR import_question_keys.stem_key IS NOT excluded.stem_key
        OR import_question_keys.content_key IS NOT excluded.content_key`).bind(JSON.stringify(keys));
}

export async function importSearchRevision() {
  return await env.DB.prepare('SELECT revision FROM import_search_state WHERE id=1').first<number>('revision') ?? 0;
}
export function importSearchGuard(id: string, revision: number) {
  return env.DB.prepare('INSERT INTO import_search_guards(id,valid) SELECT ?,coalesce((SELECT revision FROM import_search_state WHERE id=1),-1)=?').bind(id, revision);
}
export function releaseImportSearchGuard(id: string) {
  return env.DB.prepare('DELETE FROM import_search_guards WHERE id=?').bind(id);
}

type SearchRow = { id: string; type: string; payload: string };
type SearchCache = { revision: number; rows: SearchRow[]; bytes: number };
const searchCache = new Map<string, SearchCache>();
let cacheBytes = 0;
// A best-effort Worker cache is never a durability or correctness authority.
// It is useful only while the SQL corpus revision is identical. BM25 uses
// corpus-wide statistics, so ANY bank's corpus change invalidates it.
export async function cachedImportSearch(actor: string, bank: string, query: string, revision: number) {
  const key = JSON.stringify(['import-stem-v1', actor, bank, query]);
  const cached = searchCache.get(key);
  if (cached?.revision === revision) return cached.rows;
  const result = await env.DB.prepare(`SELECT r.id,r.type,r.payload FROM import_question_search s
    JOIN records r ON r.rowid=s.rowid WHERE import_question_search MATCH ? AND r.qbank_id=?
    AND (r.type='sharedQuestions' OR json_extract(r.payload,'$.status')='pending') ORDER BY s.rank LIMIT 1000`)
    .bind(query, bank).all<SearchRow>();
  const rows = result.results;
  const bytes = rows.reduce((sum, row) => sum + row.payload.length * 2 + 128, 0);
  if (cached) { cacheBytes -= cached.bytes; searchCache.delete(key); }
  if (bytes <= 8_000_000) {
    while (searchCache.size >= 64 || cacheBytes + bytes > 8_000_000) {
      const oldest = searchCache.keys().next().value;
      if (!oldest) break;
      cacheBytes -= searchCache.get(oldest)!.bytes;
      searchCache.delete(oldest);
    }
    searchCache.set(key, { revision, rows, bytes }); cacheBytes += bytes;
  }
  return rows;
}
