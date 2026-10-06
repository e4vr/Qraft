import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { withLocalImportMatches } from '../domain/local-import-duplicates';
import { localImportBlob, validateImportRow, MAX_LOCAL_MEDIA_BYTES, type ImportDraft } from '../domain/import-workspace';
import { validImageAttachments } from '@/features/media/domain/image-attachments';

const MAX_BACKUP_BYTES = 160 * 1024 * 1024;
const worker = self as unknown as { onmessage: (event: MessageEvent) => void; postMessage: (data: unknown, transfer?: Transferable[]) => void };
worker.onmessage = async ({ data }) => {
  try {
    if (data.action === 'duplicates') {
      const matches = withLocalImportMatches(data.questions, []).map(list => list.map(({ payload: _payload, ...match }) => match));
      worker.postMessage({ matches });
    } else if (data.action === 'backup') {
      const draft = data.draft as ImportDraft;
      const files: Record<string, Uint8Array> = {};
      const attachments: Array<{ id: string; path: string; type: string }> = [];
      let bytes = 0;
      for (const id of Object.keys(draft.media)) {
        const blob = localImportBlob(draft.media, id); if (!blob) continue;
        bytes += blob.size; if (bytes > MAX_LOCAL_MEDIA_BYTES) throw new Error('The local image budget has been exceeded.');
        const path = `media/${attachments.length}`;
        files[path] = new Uint8Array(await blob.arrayBuffer()); attachments.push({ id, path, type: blob.type });
      }
      files['manifest.json'] = strToU8(JSON.stringify({ format: 'qraft-import-backup-v1', draft: { ...draft, storageRevision: undefined, media: undefined }, attachments }));
      if (Object.values(files).reduce((total, file) => total + file.byteLength, 0) > MAX_BACKUP_BYTES - 1_000_000) throw new Error('This full backup exceeds 160 MB. Download the question JSON and review report separately.');
      const output = zipSync(files, { level: 0 }); worker.postMessage({ backup: output }, [output.buffer]);
    } else if (data.action === 'restore') {
      if (data.bytes.byteLength > MAX_BACKUP_BYTES) throw new Error('Choose a full backup up to 160 MB.');
      let total = 0;
      const files = unzipSync(new Uint8Array(data.bytes), { filter: file => {
        if (file.name !== 'manifest.json' && !/^media\/\d+$/.test(file.name)) throw new Error('Unexpected file in the backup.');
        total += file.originalSize; if (total > MAX_BACKUP_BYTES) throw new Error('The expanded backup exceeds 160 MB.'); return true;
      } });
      if (!files['manifest.json']) throw new Error('This is not a Qraft full backup.');
      const saved = JSON.parse(strFromU8(files['manifest.json'])); const draft = saved.draft as ImportDraft;
      if (saved.format !== 'qraft-import-backup-v1' || draft?.version !== 1 || typeof draft.bankId !== 'string' || !Array.isArray(draft.rows) || draft.rows.length > 10_000 || !Array.isArray(saved.attachments)) throw new Error('Invalid full backup.');
      const ids = new Set<string>();
      for (const row of draft.rows) {
        const q = row?.question;
        if (typeof row.id !== 'string' || row.id.length > 100 || ids.has(row.id) || !Number.isSafeInteger(row.position) || row.position < 1 || typeof row.excluded !== 'boolean' || typeof row.reviewed !== 'boolean' || row.unresolvedMedia !== undefined && (!Array.isArray(row.unresolvedMedia) || row.unresolvedMedia.some(field => !['images', 'explanationImages'].includes(field))) || !q || !['stem', 'specialty', 'topic', 'explanation', 'sourceFile'].every(key => typeof (q as unknown as Record<string, unknown>)[key] === 'string') || !Array.isArray(q.options) || q.options.length > 100 || q.options.some(option => typeof option !== 'string') || !Number.isInteger(q.answer) || !Array.isArray(q.images) || !Array.isArray(q.explanationImages ?? []) || typeof row.notes !== 'string') throw new Error('Invalid question structure in the backup.');
        const validSection = (images: typeof q.images) => validImageAttachments(images.map(image => ({ ...image, url: image.url?.startsWith('local-import:') ? 'https://local-preview.invalid/image' : image.url })));
        if (!validSection(q.images) || !validSection(q.explanationImages ?? [])) throw new Error('Invalid image entries in the backup.'); ids.add(row.id);
      }
      draft.media = Object.create(null); let mediaBytes = 0;
      const mediaIds = new Set<string>();
      for (const attachment of saved.attachments) {
        if (typeof attachment.id !== 'string' || mediaIds.has(attachment.id) || !/^media\/\d+$/.test(attachment.path) || !files[attachment.path] || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(attachment.type)) throw new Error('Invalid media in the backup.');
        const bytes = files[attachment.path]; mediaBytes += bytes.byteLength;
        if (bytes.byteLength > 10 * 1024 * 1024 || mediaBytes > MAX_LOCAL_MEDIA_BYTES) throw new Error('The backup exceeds the local image budget.');
        mediaIds.add(attachment.id); draft.media[attachment.id] = new Blob([bytes], { type: attachment.type });
      }
      if (typeof draft.fileName !== 'string' || typeof draft.rawFile !== 'string' || !/^[a-f0-9]{64}$/.test(draft.fileHash) || !Array.isArray(draft.skipped) || !draft.checks || !draft.decisions || draft.accountId !== undefined && typeof draft.accountId !== 'string') throw new Error('Invalid draft metadata in the backup.');
      const validBatches = (batches: unknown): boolean => {
        if (!Array.isArray(batches) || batches.length > 1000) return false;
        const requests = new Set<string>(), rows = new Set<string>();
        return batches.every(batch => {
          if (!batch || !/^[a-zA-Z0-9-]{20,80}$/.test(batch.requestId) || requests.has(batch.requestId) || !Array.isArray(batch.rowIds) || !Array.isArray(batch.questions) || !Array.isArray(batch.choices) || batch.rowIds.length !== batch.questions.length || batch.choices.length !== batch.questions.length || !batch.questions.length || batch.questions.length > 25) return false;
          requests.add(batch.requestId);
          return batch.rowIds.every((id: unknown, i: number) => {
            if (typeof id !== 'string' || !ids.has(id) || rows.has(id)) return false;
            rows.add(id); const question = batch.questions[i];
            return question && Number.isInteger(question.answer) && !validateImportRow({ id, position: i + 1, question, notes: '', reviewed: false, excluded: false }).error;
          });
        });
      };
      if (draft.submission && (!draft.accountId || !validBatches(draft.submission.batches) || !Number.isInteger(draft.submission.completed) || draft.submission.completed < 0 || draft.submission.completed > draft.submission.batches.length || !/^[a-zA-Z0-9-]{20,80}$/.test(draft.submission.sessionId))) throw new Error('Invalid submission recovery data.');
      if (draft.resume && (!draft.accountId || !validBatches(draft.resume.savedBatches) || !/^[a-zA-Z0-9-]{20,80}$/.test(draft.resume.sessionId))) throw new Error('Invalid partial submission recovery data.');
      const allQuestions = [...draft.rows.map(row => row.question), ...(draft.submission?.batches ?? draft.resume?.savedBatches ?? []).flatMap(batch => batch.questions)];
      if (allQuestions.some(question => [...question.images, ...(question.explanationImages ?? [])].some(image => image.url.startsWith('local-import:') && !localImportBlob(draft.media, image.id)))) throw new Error('This backup is missing a local image. Restore a complete backup; your current draft is preserved.');
      // An external archive cannot certify server writes. Reconfirm preserved
      // request IDs only on explicit Submit; successful replays never add rows.
      draft.checks = {}; draft.decisions = {}; draft.safetyVersion = 2;
      const recovered = draft.submission?.batches ?? draft.resume?.savedBatches ?? [];
      const recoveryIds = new Set(recovered.flatMap(batch => batch.rowIds));
      draft.rows = draft.rows.map(row => recoveryIds.has(row.id) ? { ...row, submitted: false, frozen: true, excluded: true } : row);
      if (draft.submission) { draft.submission.completed = 0; draft.submission.successful = 0; }
      if (draft.resume) { draft.resume.confirmedCount = 0; draft.resume.successful = 0; }
      draft.storageRevision = undefined; worker.postMessage({ draft });
    } else throw new Error('Unknown local operation.');
  } catch (error) { worker.postMessage({ error: error instanceof Error ? error.message : 'Local processing failed. Your current draft is preserved.' }); }
};
