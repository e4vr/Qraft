import type { QuestionImportReport } from '@/lib/question-import';

export async function readImportFile(file: File): Promise<{ report: QuestionImportReport; hash: string; content: string }> {
  const bytes = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import-file-worker.ts', import.meta.url), { type: 'module' });
    const finish = () => worker.terminate();
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
