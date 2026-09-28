import { env } from 'cloudflare:workers';
import { r2StorageService } from '@/lib/storage-service';

type PendingMedia = { key: string; storage_key: string | null; provider: string; size: number };

async function removeMarkedObject(row: PendingMedia) {
  try {
    if (row.provider === 'r2') await r2StorageService.delete(row.storage_key ?? row.key);
    else {
      if (!env.IMAGEKIT_PRIVATE_KEY) throw new Error('Legacy storage unavailable');
      const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(row.storage_key ?? row.key)}`, {
        method: 'DELETE', signal: AbortSignal.timeout(5000),
        headers: { authorization: `Basic ${btoa(`${env.IMAGEKIT_PRIVATE_KEY}:`)}` },
      });
      if (!response.ok && response.status !== 404) throw new Error('Legacy cleanup deferred');
    }
    // Metadata and its counter commit together. An R2 success followed by a DB
    // failure, or two cleanup workers, must never subtract storage twice.
    await env.DB.batch([
      env.DB.prepare("UPDATE counters SET value=max(0,value-?),updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM media WHERE key=? AND status IN ('account_deleted','delete_pending'))")
        .bind(row.size, new Date().toISOString(), row.provider === 'r2' ? 'r2-storage-bytes' : 'media-bytes', row.key),
      env.DB.prepare("DELETE FROM media WHERE key=? AND status IN ('account_deleted','delete_pending')").bind(row.key),
    ]);
  } catch {
    // Keep the durable marker. Rotating a failed item prevents one unavailable
    // provider from starving all other deletion work in the bounded queue.
    await env.DB.prepare("UPDATE media SET updated_at=? WHERE key=? AND status IN ('account_deleted','delete_pending')")
      .bind(new Date().toISOString(), row.key).run().catch(() => undefined);
  }
}

export async function cleanPendingMedia() {
  const started = Date.now();
  // Invoked through waitUntil after committed deletions, and by the daily cron.
  // At most 500 objects, four storage operations at a time, per invocation.
  for (let batch = 0; batch < 10 && Date.now() - started < 20_000; batch++) {
    const rows = await env.DB.prepare("SELECT key,storage_key,provider,size FROM media WHERE status IN ('account_deleted','delete_pending') ORDER BY updated_at,key LIMIT 50").all<PendingMedia>();
    for (let offset = 0; offset < rows.results.length; offset += 4) {
      if (Date.now() - started >= 20_000) return;
      await Promise.all(rows.results.slice(offset, offset + 4).map(removeMarkedObject));
    }
    if (rows.results.length < 50) return;
  }
}
