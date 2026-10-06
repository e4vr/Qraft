import { api, ApiError, type ApiRequestInit } from '@/lib/api-client';

// Import POSTs use stable request IDs, so a throttled chunk can safely resume.
// Preview requests are read-only. Keep waits on the client rather than Workers.
export async function importRequest<T>(path: string, init: ApiRequestInit): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abort(); else init.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('The request timed out. Retry with this draft; confirmed batches will not be duplicated.', 'TimeoutError')), 45_000);
    try { return await api<T>(path, { ...init, signal: controller.signal }); }
    catch (error) {
      const searchConflict = error instanceof ApiError && error.status === 409 && error.payload.code === 'IMPORT_SEARCH_CONFLICT';
      if (!(error instanceof ApiError) || (!searchConflict && error.status !== 429) || attempt >= 2) throw error;
      const delay = searchConflict ? 250 : error.retryAfterMs ?? 2000;
      if (delay > 60_000) throw error;
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(wait); reject(init.signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
        const wait = setTimeout(() => { init.signal?.removeEventListener('abort', stop); resolve(); }, Math.max(250, delay) + 100);
        if (init.signal?.aborted) stop(); else init.signal?.addEventListener('abort', stop, { once: true });
      });
    }
    finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); }
  }
}
