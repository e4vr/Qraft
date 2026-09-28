import { parseQuestionImportReport } from '@/lib/question-import';

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<{ bytes: ArrayBuffer; fallbackSourceFile: string }>) => void) | null;
  postMessage: (value: unknown) => void;
};
worker.onmessage = async ({ data }) => {
  try {
    const bytes = new Uint8Array(data.bytes);
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    const content = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').trim();
    const report = parseQuestionImportReport(content, data.fallbackSourceFile, Number.POSITIVE_INFINITY);
    const digest = await crypto.subtle.digest('SHA-256', data.bytes);
    const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    worker.postMessage({ report, hash });
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : 'Unable to read this JSON file.' });
  }
};
