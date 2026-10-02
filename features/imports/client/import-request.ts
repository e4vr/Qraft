import { api, ApiError, type ApiRequestInit } from '@/lib/api-client';

// Import POSTs use stable request IDs, so a throttled chunk can safely resume.
// Preview requests are read-only. Keep waits on the client rather than Workers.
export async function importRequest<T>(path: string, init: ApiRequestInit): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await api<T>(path, init); }
    catch (error) {
      const searchConflict = error instanceof ApiError && error.status === 409 && error.payload.code === 'IMPORT_SEARCH_CONFLICT';
      if (!(error instanceof ApiError) || (!searchConflict && error.status !== 429) || attempt >= 2) throw error;
      const delay = searchConflict ? 250 : error.retryAfterMs ?? 2000;
      if (delay > 60_000) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.max(250, delay) + 100));
    }
  }
}
