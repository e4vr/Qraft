export function localImportTask<T>(message: unknown, signal?: AbortSignal, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import-local-worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { finish(); reject(new DOMException('Local operation cancelled. Your draft is preserved.', 'AbortError')); };
    const timer = setTimeout(() => { finish(); reject(new Error('Local processing took too long. Reduce the file size or retry.')); }, 60_000);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => { finish(); if (data.error) reject(new Error(data.error)); else resolve(data); };
    worker.onerror = () => { finish(); reject(new Error('Unable to process the local file. Your current draft is preserved.')); };
    worker.postMessage(message, transfer);
  });
}
