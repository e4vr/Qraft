import type { QuestionImportReport } from '@/lib/question-import';

export async function readImportFile(file: File, signal?: AbortSignal): Promise<{ report: QuestionImportReport; hash: string; content: string }> {
  const bytes = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import-file-worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { finish(); reject(new DOMException('File reading cancelled. Your current draft is preserved.', 'AbortError')); };
    const timer = setTimeout(() => { finish(); reject(new Error('File processing took too long. Try a smaller file.')); }, 60_000);
    if (signal?.aborted) { abort(); return; } signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.onerror = () => { finish(); reject(new Error('Unable to read the file. Please try again.')); };
    // The uploaded JSON filename is not evidence of the original source.
    worker.postMessage({ bytes, fallbackSourceFile: '' }, [bytes]);
  });
}
