'use client';
/* oxlint-disable next/no-img-element */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Copy, Download, Eye, FileJson, FolderOpen, ImagePlus, Layers2, ListFilter, LoaderCircle, Plus, Redo2, Search, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { FormattedQuestionText } from './formatted-question-text';
import { WorkspaceHeader } from './workspace-header';
import { useConfirmationDialog } from './ui/confirmation-dialog';
import { readImportFile } from '@/features/imports/client/read-import-file';
import { importRequest } from '@/features/imports/client/import-request';
import { importWorkspaceContext } from '@/features/imports/client/open-import-workspace';
import { loadImportDraft, saveImportDraft } from '@/features/imports/client/import-draft-store';
import { draftFromReport, emptyImportQuestion, exportImportDraft, importRowFingerprint, makeImportSubmission, moveImportOption, repairImportRow, skipWorkspaceExact, validateImportRow, workspaceReadiness, decisionIsCurrent, type ImportDraft, type ImportRow } from '@/features/imports/domain/import-workspace';
import { exactImportIdentity } from '@/features/imports/domain/exact-import-duplicates';
import type { ImportMatch } from '@/features/imports/domain/local-import-duplicates';
import { ApiError } from '@/lib/api-client';
import { buildQuestionPrompt, importedSourceReference, parseQuestionImportReport, type QuestionPromptSettings } from '@/lib/question-import';
import { optionLabel, type NoteImage, type QuestionProposalPayload } from '@/lib/medguard-types';
import { uploadQuestionImage, uploadSharedNoteImage } from '@/features/qbanks/client/qbank-client';
import './import-workspace.css';

type Step = 'edit' | 'duplicates' | 'submit';
type Filter = 'all' | 'errors' | 'unreviewed' | 'duplicates' | 'excluded';
const PAGE_SIZE = 40;

function comparisonDifferences(left: QuestionProposalPayload, right: QuestionProposalPayload) {
  return [left.stem !== right.stem ? 'Question text' : '', JSON.stringify(left.options) !== JSON.stringify(right.options) ? 'Choices / order' : '', left.options[left.answer] !== right.options[right.answer] ? 'Correct answer' : '', left.explanation !== right.explanation ? 'Explanation' : '', left.sourceFile !== right.sourceFile || left.sourcePage !== right.sourcePage ? 'Source' : '', JSON.stringify(left.images) !== JSON.stringify(right.images) || JSON.stringify(left.explanationImages) !== JSON.stringify(right.explanationImages) ? 'Images' : ''].filter(Boolean);
}

function download(name: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function errorHelp(error: string) {
  if (/disagree|conflicting/.test(error)) return 'The answer keys disagree. Select the correct option below, or fix the original JSON.';
  if (/answer/.test(error)) return 'Select one correct answer. Numeric JSON answers use 0 for A and 1 for B; use letters to avoid ambiguity.';
  if (/sourceFile/.test(error)) return 'Enter the original bank or lecture name in Source. The JSON filename is not the source.';
  if (/sourcePage/.test(error)) return 'Enter a whole page number from 1 to 100000, or clear it if unknown.';
  if (/options/.test(error)) return 'Provide 2–10 non-empty choices. Labels must be unique and run from A without gaps.';
  if (/images/.test(error)) return 'Check the image entries in Original JSON. Use valid HTTPS links and at most 10 images per section.';
  if (/stem/.test(error)) return 'Enter the complete question in Question text.';
  return 'Correct the fields below, or edit Original JSON and apply the correction. You do not need to reopen the file.';
}

function QuestionPreview({ question, media = {} }: { question: QuestionProposalPayload; media?: Record<string, Blob> }) {
  return <article className="iw-preview" dir="auto">
    <p className="iw-prose"><FormattedQuestionText text={question.stem || 'Question text will appear here.'} /></p>
    <ol className="iw-preview-options">{question.options.map((option, i) => <li key={i} className={question.answer === i ? 'is-answer' : ''}><b>{optionLabel(i)}</b><span><FormattedQuestionText text={option || 'Empty choice'} /></span>{question.answer === i && <Check size={16} aria-label="Correct answer" />}</li>)}</ol>
    {question.explanation && <div className="iw-prose iw-preview-explanation"><span className="iw-eyebrow">Explanation</span><FormattedQuestionText text={question.explanation} /></div>}
    <div className="iw-image-grid">{[...question.images, ...(question.explanationImages ?? [])].map(image => <figure key={image.id}><LocalImage image={image} blob={media[image.id]} /><figcaption>{image.caption || image.name}</figcaption></figure>)}</div>
    <p className="iw-muted">{importedSourceReference(question.sourceFile || '', question.sourcePage, question.originalQuestionNumber)}</p>
  </article>;
}

function LocalImage({ image, blob }: { image: NoteImage; blob?: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    // Blob URLs synchronize external browser resources with this preview.
    queueMicrotask(() => setUrl(next));
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  // Remote/protected images are opened explicitly rather than fetched during editing.
  return blob && url ? <img src={url} alt={image.caption || image.name} /> : <a href={image.url} target="_blank" rel="noopener noreferrer">Open existing image</a>;
}

function PromptBuilder() {
  const [settings, setSettings] = useState<QuestionPromptSettings>({ source: 'qbank', kind: 'clinical', length: 'medium', countMode: 'fixed', count: 20, optionCount: 4 });
  const [message, setMessage] = useState('');
  const valid = Number.isInteger(settings.count) && settings.count >= 1 && settings.count <= 200 && Number.isInteger(settings.optionCount) && settings.optionCount >= 2 && settings.optionCount <= 10;
  const prompt = valid ? buildQuestionPrompt(settings) : '';
  return <details className="iw-prompt"><summary>Prepare a JSON file with your AI tool</summary><div className="iw-prompt-body">
    <p className="iw-muted">Copy the instructions with your source into your AI tool. This page does not send your source to an AI service.</p>
    <div className="iw-fields"><label>Source type<select value={settings.source} onChange={e => setSettings({ ...settings, source: e.target.value as QuestionPromptSettings['source'] })}><option value="qbank">Existing question bank</option><option value="lecture">Lecture material</option></select></label>
      <label>Question count<input type="number" min={1} max={200} value={settings.count} onChange={e => setSettings({ ...settings, count: Number(e.target.value) })} /></label>
      {settings.source === 'lecture' && <><label>Type<select value={settings.kind} onChange={e => setSettings({ ...settings, kind: e.target.value as QuestionPromptSettings['kind'] })}><option value="clinical">Clinical</option><option value="direct">Direct</option></select></label><label>Length<select value={settings.length} onChange={e => setSettings({ ...settings, length: e.target.value as QuestionPromptSettings['length'] })}><option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option></select></label><label>Count mode<select value={settings.countMode} onChange={e => setSettings({ ...settings, countMode: e.target.value as QuestionPromptSettings['countMode'] })}><option value="fixed">Specific number</option><option value="per_slide">One per slide</option></select></label><label>Options<input type="number" min={2} max={10} value={settings.optionCount} onChange={e => setSettings({ ...settings, optionCount: Number(e.target.value) })} /></label></>}
    </div>
    {!valid && <p role="alert" className="iw-error-text">Choose 1–200 questions and 2–10 options.</p>}
    <button type="button" className="iw-button" disabled={!valid} onClick={async () => { try { await navigator.clipboard.writeText(prompt); setMessage('Prompt copied.'); } catch { setMessage('Copy the prompt manually from the preview below.'); } }}><Copy size={16} />Copy AI prompt</button>
    {message && <output>{message}</output>}<details><summary>Preview instructions</summary><textarea readOnly aria-label="AI prompt" value={prompt} rows={12} /></details>
  </div></details>;
}

export function ImportWorkspace({ bankId }: { bankId: string }) {
  const [context, setContext] = useState({ uid: '', bankName: bankId });
  const [draft, setDraft] = useState<ImportDraft>();
  const draftRef = useRef<ImportDraft | undefined>(undefined);
  const [hydrated, setHydrated] = useState(false);
  const [selected, setSelected] = useState('');
  const [step, setStep] = useState<Step>('edit');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState('');
  const operation = useRef(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [localSave, setLocalSave] = useState('');
  const saveQueue = useRef(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [preview, setPreview] = useState(false);
  const [wholeFile, setWholeFile] = useState('');
  const [dragging, setDragging] = useState(false);
  const [rights, setRights] = useState(false);
  const [bulk, setBulk] = useState({ source: '', specialty: '', topic: '' });
  const [history, setHistory] = useState<ImportDraft[]>([]);
  const [future, setFuture] = useState<ImportDraft[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [confirmAction, confirmationDialog] = useConfirmationDialog();
  const locked = !!busy || !!draft?.submission;
  const readiness = useMemo(() => draft ? workspaceReadiness(draft) : undefined, [draft]);
  const row = draft?.rows.find(item => item.id === selected);
  const rowError = row && !row.excluded ? validateImportRow(row).error : undefined;
  const rawText = row?.pendingRaw ?? (row?.raw === undefined ? '' : JSON.stringify(row.raw, null, 2));
  const matches = row ? readiness?.matches[row.id] ?? [] : [];
  const candidate = matches[Math.min(candidateIndex, matches.length - 1)];
  const decisionCurrent = !!row && decisionIsCurrent(row, matches, draft?.decisions[row.id]);
  const filtered = useMemo(() => draft?.rows.filter(item => {
    const text = `${item.position} ${item.question.originalQuestionNumber || ''} ${item.question.stem} ${item.question.sourceFile || ''} ${item.question.specialty} ${item.question.topic}`.toLowerCase();
    return (!query.trim() || text.includes(query.trim().toLowerCase())) && (filter === 'all' || filter === 'excluded' && item.excluded || !item.excluded && (filter === 'errors' && !!validateImportRow(item).error || filter === 'unreviewed' && !item.reviewed || filter === 'duplicates' && !!readiness?.matches[item.id]?.length));
  }) ?? [], [draft, query, filter, readiness]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));

  useEffect(() => {
    let active = true;
    const info = importWorkspaceContext(bankId);
    void loadImportDraft(info.uid, bankId).then(saved => {
      if (!active) return;
      setContext(info);
      if (saved) { draftRef.current = saved; setDraft(saved); setSelected(saved.rows[0]?.id || ''); setWholeFile(saved.rawFile); setNotice('Your local draft was restored. No file needs to be reopened.'); }
      setHydrated(true);
    }).catch(() => { if (active) { setContext(info); setHydrated(true); setLocalSave('Local saving is unavailable. Download your work before leaving.'); } });
    return () => { active = false; };
  }, [bankId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (operation.current || (draftRef.current && localSave !== 'Saved on this device')) event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [localSave]);

  function persist(next: ImportDraft, immediate = false) {
    setLocalSave('Saving on this device…');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const save = () => {
      // Serialize writes and debounce typing; submission acknowledgements save immediately.
      const task = saveQueue.current.catch(() => {}).then(() => saveImportDraft(context.uid, next));
      saveQueue.current = task;
      void task.then(() => { if (draftRef.current === next) setLocalSave('Saved on this device'); }).catch(() => setLocalSave('Local save failed. Download your work before leaving.'));
      return task;
    };
    if (immediate) return save();
    saveTimer.current = setTimeout(save, 400);
    return Promise.resolve();
  }
  function commit(next: ImportDraft, undoable = true) {
    if (undoable && draftRef.current) { setHistory(old => [...old.slice(-19), draftRef.current!]); setFuture([]); }
    draftRef.current = next; setDraft(next); void persist(next, !undoable); return next;
  }
  function updateRow(id: string, update: (current: ImportRow) => ImportRow) {
    const current = draftRef.current; if (!current || locked) return;
    commit({ ...current, rows: current.rows.map(item => item.id === id && !item.submitted ? update(item) : item) }); setError('');
  }
  function editQuestion(patch: Partial<QuestionProposalPayload>) {
    if (!row) return;
    updateRow(row.id, item => ({ ...item, question: { ...item.question, ...patch }, repairError: undefined, reviewed: false }));
  }
  function selectRow(id: string) { setSelected(id); setCandidateIndex(0); setError(''); }
  function undo(redo = false) {
    if (locked) return;
    const stack = redo ? future : history, next = stack[stack.length - 1]; if (!next || !draft) return;
    if (redo) { setFuture(stack.slice(0, -1)); setHistory(old => [...old, draft]); }
    else { setHistory(stack.slice(0, -1)); setFuture(old => [...old, draft]); }
    commit(next, false); if (!next.rows.some(item => item.id === selected)) setSelected(next.rows[0]?.id || '');
  }

  async function openFile(file?: File) {
    if (!file || operation.current) return;
    if (draft && !(await confirmAction({ title: 'Open a different file?', description: 'The current local draft will be replaced. Download it first if you want to keep a copy.', confirmLabel: 'Open file', tone: 'warning' }))) return;
    operation.current = true; setBusy('Reading your file locally'); setError('');
    try {
      if (!/\.(json|txt|text)$/i.test(file.name)) throw new Error('Choose a .json or .txt file containing JSON questions.');
      if (file.size > 50_000_000) throw new Error('Choose a file up to 50 MB for local review.');
      let next: ImportDraft;
      try {
        const { report, hash, content } = await readImportFile(file);
        next = draftFromReport(report, bankId, file.name, hash, content);
      } catch (caught) {
        const content = await file.text();
        const bytes = await file.arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
        next = draftFromReport({ questions: [], skipped: [], sourceFile: '', repaired: false, entries: [] }, bankId, file.name, hash, content);
        setError(`${caught instanceof Error ? caught.message : 'The JSON could not be read.'} Edit the file contents below and try again; no reupload is required.`);
      }
      commit(next, false); setHistory([]); setFuture([]); setSelected(next.rows[0]?.id || ''); setWholeFile(next.rawFile); setStep('edit'); setFilter('all'); setPage(0); setRights(false);
      setNotice(next.repaired ? 'JSON formatting was repaired locally. Review the questions against your source.' : 'File opened locally. Review and edit before Check duplication.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to read the file.'); }
    finally { operation.current = false; setBusy(''); }
  }
  async function repairFile() {
    if (!draft || locked) return;
    if (draft.rows.length && !(await confirmAction({ title: 'Reparse file contents?', description: 'Replaces the edited questions and duplication decisions with these JSON contents. You can undo this change.', confirmLabel: 'Reparse locally', tone: 'warning' }))) return;
    try {
      const report = parseQuestionImportReport(wholeFile, '', Infinity);
      const next = draftFromReport(report, bankId, draft.fileName, draft.fileHash, wholeFile);
      commit(next); setSelected(next.rows[0]?.id || ''); setError(''); setNotice('File contents parsed locally. Invalid questions remain available to correct.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Check the JSON syntax.'); }
  }
  function addQuestion(copy = false) {
    if (!draft || locked) return;
    const question = copy && row ? structuredClone(row.question) : emptyImportQuestion(row?.question.sourceFile);
    const item: ImportRow = { id: crypto.randomUUID(), position: Math.max(0, ...draft.rows.map(r => r.position)) + 1, question, excluded: false, reviewed: false, notes: '' };
    commit({ ...draft, rows: [...draft.rows, item] }); setSelected(item.id); setFilter('all'); setQuery(''); setPage(Math.floor(draft.rows.length / PAGE_SIZE)); setStep('edit');
  }
  async function applyBulk() {
    if (!draft || locked) return;
    const targets = new Set(filtered.filter(item => !item.excluded).map(item => item.id));
    if (!targets.size || !(bulk.source.trim() || bulk.specialty.trim() || bulk.topic.trim())) { setError('Enter a source, specialty or topic and choose a filter with active questions.'); return; }
    if (!(await confirmAction({ title: `Update ${targets.size} questions?`, description: 'Applies the entered fields to all active questions in the current filtered list. Individual source names will be replaced if Source is entered.', confirmLabel: 'Apply changes', tone: 'warning' }))) return;
    commit({ ...draft, rows: draft.rows.map(item => targets.has(item.id) ? { ...item, reviewed: false, repairError: undefined, question: { ...item.question, ...(bulk.source.trim() ? { sourceFile: bulk.source.trim() } : {}), ...(bulk.specialty.trim() ? { specialty: bulk.specialty.trim() } : {}), ...(bulk.topic.trim() ? { topic: bulk.topic.trim() } : {}) } } : item) });
    setNotice(`${targets.size} questions updated locally. Check duplication will refresh affected questions.`);
  }

  async function checkDuplication() {
    const current = draftRef.current; if (!current || operation.current || current.submission) return;
    const state = workspaceReadiness(current);
    if (!state.active.length) { setError('Restore or add at least one question before checking.'); return; }
    if (state.invalid.length) { setError(`${state.invalid.length} questions need correction or exclusion before Check duplication.`); setSelected(state.invalid[0].id); setFilter('errors'); setStep('edit'); return; }
    operation.current = true; setBusy('Checking duplication in this QBank'); setError(''); setProgress({ done: 0, total: state.unchecked.length });
    let next = current;
    try {
      let processed = 0;
      for (let offset = 0; offset < state.unchecked.length;) {
        const rows: ImportRow[] = []; let bytes = 0;
        while (offset < state.unchecked.length && rows.length < 25) {
          const item = state.unchecked[offset]; const size = new TextEncoder().encode(JSON.stringify(item.question)).byteLength;
          if (size > 850_000) throw new Error(`Question ${item.position} is too large to check. Shorten its text.`);
          if (rows.length && bytes + size > 850_000) break;
          rows.push(item); bytes += size; offset++;
        }
        const result = await importRequest<{ matches: ImportMatch[][]; userId: string; bankName: string; limits?: { questionsPerImport: number }; isSuperadmin?: boolean }>('/platform/import-preview', { method: 'POST', expectedUserId: context.uid || undefined, body: JSON.stringify({ qbankId: bankId, includePolicy: processed === 0, questions: rows.map(item => { const q = validateImportRow(item).question!; return { ...q, images: q.images.filter(image => !image.url.startsWith('local-import:')), explanationImages: q.explanationImages?.filter(image => !image.url.startsWith('local-import:')) }; }) }) });
        if (!Array.isArray(result.matches) || result.matches.length !== rows.length) throw new Error('The duplicate scan was not confirmed. Retry Check duplication; your edits are preserved.');
        if (result.limits && !result.isSuperadmin && state.active.length > result.limits.questionsPerImport) setNotice(`Your account allows ${result.limits.questionsPerImport} questions per import. Exclude extra questions before Submit.`);
        setContext(info => ({ ...info, bankName: result.bankName || info.bankName }));
        const checks = { ...next.checks }; rows.forEach((item, i) => { checks[item.id] = { fingerprint: importRowFingerprint(item), matches: result.matches[i] }; });
        next = commit({ ...next, checks, ...(result.limits ? { questionLimit: result.isSuperadmin ? undefined : result.limits.questionsPerImport } : {}) }, false); await saveQueue.current; processed += rows.length; setProgress({ done: processed, total: state.unchecked.length });
        if (workspaceReadiness(next).limitExceeded) break;
      }
      const checked = workspaceReadiness(next);
      if (checked.limitExceeded) { setStep('edit'); setFilter('all'); setError(`Your account allows ${next.questionLimit} questions for this import. Exclude extra questions locally; no file needs to be reopened.`); return; }
      setStep(checked.unresolved.length ? 'duplicates' : 'submit');
      if (checked.unresolved.length) { setSelected(checked.unresolved[0].id); setFilter('duplicates'); }
      setNotice(checked.unresolved.length ? `${checked.unresolved.length} questions need a duplication decision. No questions have been submitted.` : 'Check duplication is complete. Review the summary before Submit.');
    } catch (caught) { setError(caught instanceof ApiError && caught.status === 403 && /account|session/i.test(caught.message) ? `${caught.message} Sign in through your QBank in another tab, then retry Check duplication here. Your local draft is preserved.` : caught instanceof Error ? `${caught.message} Your local draft is preserved; retry Check duplication when ready.` : 'Unable to finish the scan. Your local draft is preserved.'); }
    finally { operation.current = false; setBusy(''); }
  }

  function keepBoth() {
    if (!draft || !row || locked || !matches.length) return;
    const next = commit({ ...draft, decisions: { ...draft.decisions, [row.id]: { fingerprint: importRowFingerprint(row), candidates: matches.map(match => match.candidateFingerprint) } } });
    const pending = workspaceReadiness(next).unresolved;
    if (pending.length) setSelected(pending[0].id); else { setStep('submit'); setNotice('All duplication decisions are complete. Review the summary before Submit.'); }
  }
  async function skipExact() {
    if (!draft || locked || !readiness || readiness.unchecked.length) return;
    if (!(await confirmAction({ title: 'Exclude exact duplicates?', description: 'Matches require equal question text, choices and correct answer. Explanations and images may differ. Review those differences before excluding. You can restore excluded questions.', confirmLabel: 'Exclude exact matches', tone: 'warning' }))) return;
    const next = commit(skipWorkspaceExact(draft)); const state = workspaceReadiness(next);
    setNotice(`${next.rows.filter(item => item.excluded).length - draft.rows.filter(item => item.excluded).length} exact matches excluded locally.`);
    if (state.unresolved.length) setSelected(state.unresolved[0].id); else if (state.ready) setStep('submit');
  }

  async function addImages(files: FileList | null, section: 'images' | 'explanationImages') {
    if (!files || !row || !draft || locked) return;
    const images = [...(row.question[section] ?? [])], media = { ...draft.media }, errors: string[] = [];
    for (const file of Array.from(files)) {
      if (images.length >= 10) { errors.push('Each section allows at most 10 images.'); break; }
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) { errors.push(`${file.name}: choose a JPEG, PNG, WebP or GIF up to 10 MB.`); continue; }
      const id = crypto.randomUUID(); media[id] = file; images.push({ id, url: `local-import:${id}`, name: file.name, caption: '' });
    }
    commit({ ...draft, media, rows: draft.rows.map(item => item.id === row.id ? { ...item, reviewed: false, repairError: undefined, question: { ...item.question, [section]: images } } : item) }); setError(errors.join(' '));
  }

  async function submit() {
    let current = draftRef.current; if (!current || operation.current || !rights) return;
    operation.current = true; setBusy('Preparing submission'); setError('');
    try {
      const submission = current.submission ?? makeImportSubmission(current);
      current = commit({ ...current, submission }, false); await saveQueue.current;
      setProgress({ done: submission.completed, total: submission.batches.length });
      for (let i = submission.completed; i < submission.batches.length; i++) {
        setBusy(`Submitting batch ${i + 1} of ${submission.batches.length}`);
        const batch = submission.batches[i];
        for (const question of batch.questions) {
          for (const section of ['images', 'explanationImages'] as const) {
            for (const image of question[section] ?? []) {
              if (!image.url.startsWith('local-import:')) continue;
              const blob = current.media[image.id]; if (!blob) throw new Error(`Local image ${image.name} is missing. Preserve this draft and restore the image before retrying.`);
              const upload = section === 'images' ? uploadQuestionImage : uploadSharedNoteImage;
              const url = await upload(context.uid, new File([blob], image.name, { type: blob.type }), bankId, `import-${submission.sessionId}`);
              const updated = { ...current, submission: { ...current.submission!, batches: current.submission!.batches.map((savedBatch, batchIndex) => batchIndex !== i ? savedBatch : { ...savedBatch, questions: savedBatch.questions.map(savedQuestion => ({ ...savedQuestion, [section]: savedQuestion[section]?.map(savedImage => savedImage.id === image.id ? { ...savedImage, url } : savedImage) })) }) } };
              current = commit(updated, false); await saveQueue.current;
            }
          }
        }
        const result = await importRequest<{ successful: number }>('/platform/import', { method: 'POST', expectedUserId: context.uid || undefined, body: JSON.stringify({ qbankId: bankId, questions: current.submission!.batches[i].questions, duplicateChoices: batch.choices, requireDuplicateResolution: true, rightsConfirmed: true,
          sourceFile: batch.questions[0]?.sourceFile || '', fileName: `${current.fileName.slice(0, 200)}-part-${i + 1}.json`, fileHash: current.fileHash, originalFileName: current.fileName, originalFileHash: current.fileHash, uploadSessionId: submission.sessionId, chunkIndex: i, chunkCount: submission.batches.length, requestId: batch.requestId, repaired: current.repaired }) });
        if (!Number.isInteger(result.successful) || result.successful !== batch.questions.length) throw new Error('The saved batch was not confirmed. Retry with the same draft; confirmed batches will not be duplicated.');
        const saved = draftRef.current!;
        current = commit({ ...saved, submission: { ...saved.submission!, completed: i + 1, successful: saved.submission!.successful + result.successful } }, false); await saveQueue.current;
        setProgress({ done: i + 1, total: submission.batches.length });
      }
      setNotice(`${current.submission!.successful} questions submitted for reviewer approval. They will appear in this QBank after approval.`); setStep('submit');
    } catch (caught) {
      if (caught instanceof ApiError && caught.payload.code === 'DUPLICATE_REVIEW_REQUIRED') {
        const saved = draftRef.current!; const batch = saved.submission!.batches[saved.submission!.completed]; const itemId = batch.rowIds[Number(caught.payload.questionIndex)]; const item = saved.rows.find(r => r.id === itemId);
        if (item && Array.isArray(caught.payload.matches)) {
          const completedIds = new Set(saved.submission!.batches.slice(0, saved.submission!.completed).flatMap(b => b.rowIds));
          const rows = saved.rows.map(r => completedIds.has(r.id) ? { ...r, excluded: true, submitted: true } : r);
          // Preserve acknowledged writes; never resend them as new questions.
          const next = { ...saved, rows, submission: undefined, resume: { sessionId: saved.submission!.sessionId, savedBatches: saved.submission!.batches.slice(0, saved.submission!.completed), successful: saved.submission!.successful }, checks: { ...saved.checks, [itemId]: { fingerprint: importRowFingerprint(item), matches: caught.payload.matches as ImportMatch[] } }, decisions: { ...saved.decisions } };
          delete next.decisions[itemId]; commit(next, false); setSelected(itemId); setStep('duplicates'); setFilter('duplicates'); setHistory([]); setFuture([]);
        }
      }
      if (caught instanceof ApiError && (caught.status === 400 || caught.status === 403 || caught.status === 404)) {
        const saved = draftRef.current!;
        if (saved.submission) {
          const completedIds = new Set(saved.submission.batches.slice(0, saved.submission.completed).flatMap(b => b.rowIds));
          commit({ ...saved, rows: saved.rows.map(item => completedIds.has(item.id) ? { ...item, submitted: true, excluded: true } : item), resume: { sessionId: saved.submission.sessionId, successful: saved.submission.successful, savedBatches: saved.submission.batches.slice(0, saved.submission.completed) }, submission: undefined }, false);
          setHistory([]); setFuture([]); setStep('edit');
        }
      }
      setError(caught instanceof Error ? `${caught.message} Your local work is preserved; no file needs to be reopened.` : 'Submission failed. Retry the remaining batches without reopening the file.');
    } finally { operation.current = false; setBusy(''); }
  }

  const done = !!draft?.submission && draft.submission.completed === draft.submission.batches.length;
  const selectedPosition = draft?.rows.findIndex(item => item.id === selected) ?? -1;
  const reviewedCount = readiness?.active.filter(item => item.reviewed).length ?? 0;
  return <main className="iw" aria-busy={!!busy}>
    <WorkspaceHeader className="iw-header" title={<span dir="auto">{context.bankName}</span>} eyebrow="Qraft / Import questions" subtitle={<>Destination QBank{context.bankName !== bankId && <> · <span dir="auto">{bankId}</span></>}</>} showMenu={false} leading={<a className="iw-back" href={`/qbanks/${encodeURIComponent(bankId)}`} aria-label="Return to QBank"><ArrowLeft size={18} /></a>} actions={<div className="iw-local"><ShieldCheck size={16} /><span>{localSave || 'Local editing · no upload yet'}</span></div>} />
    <nav className="iw-steps" aria-label="Import stages">{(['edit', 'duplicates', 'submit'] as const).map((value, i) => <button type="button" key={value} aria-current={step === value ? 'step' : undefined} disabled={!!busy || value === 'duplicates' && (!draft || !!readiness?.unchecked.length) || value === 'submit' && !readiness?.ready && !draft?.submission} onClick={() => setStep(value)}><span className="iw-step-number">{i + 1}</span><span className="iw-step-copy"><strong>{value === 'edit' ? 'Edit & review' : value === 'duplicates' ? 'Resolve duplications' : 'Submit for review'}</strong><small>{value === 'edit' ? 'Your local workspace' : value === 'duplicates' ? 'Compare in this QBank' : 'Send for approval'}</small></span><ChevronRight className="iw-step-chevron" size={16} /></button>)}</nav>
    <div className="iw-content">
      {error && <div className="iw-alert is-error" role="alert"><strong>Action needed</strong><p>{error}</p></div>}
      {notice && <output className="iw-alert iw-output">{notice}</output>}
      {busy && <output className="iw-alert iw-progress"><LoaderCircle size={18} className="animate-spin" /><span>{busy}</span>{progress.total > 0 && <><progress max={progress.total} value={progress.done} aria-label="Import progress" /><b>{progress.done} / {progress.total}</b></>}</output>}
      {!hydrated ? <div className="iw-empty"><LoaderCircle className="animate-spin" /><p>Opening your local workspace…</p></div> : <>
        {(!draft || !draft.rows.length) && <section className="iw-welcome"><div><span className="iw-welcome-icon"><FileJson size={25} /></span><span className="iw-eyebrow">Import to {context.bankName}</span><h2>Review your questions before submitting.</h2><p>Open a JSON file to edit questions, correct errors, and compare duplications. Your work is saved on this device.</p><div className="iw-welcome-features"><span><CheckCircle2 size={16} />Edit without uploading</span><span><ShieldCheck size={16} />Check only your selected QBank</span></div></div><label /* oxlint-disable-line jsx-a11y/no-noninteractive-element-interactions -- The label is the file input drop target. */ className={`iw-drop ${dragging ? 'is-dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length !== 1) { setError('Open one file at a time.'); return; } void openFile(e.dataTransfer.files[0]); }}><span className="iw-drop-icon"><FolderOpen size={30} /></span><strong>Drop your JSON file here</strong><span>or click to browse your files</span><small>JSON / TXT · up to 50 MB locally</small><input type="file" accept=".json,.txt,.text" aria-label="Open JSON file" disabled={!!busy} onChange={e => { void openFile(e.target.files?.[0]); e.target.value = ''; }} /></label><PromptBuilder /></section>}
        {draft && !draft.rows.length && <section className="iw-card iw-file-repair"><h2>Correct the file without reopening it</h2><p className="iw-muted">Your original contents are kept here. Fix the JSON or add the missing questions array, then parse again.</p><textarea aria-label="File JSON contents" value={wholeFile} onChange={e => { setWholeFile(e.target.value); commit({ ...draft, rawFile: e.target.value }, false); }} rows={16} spellCheck={false} /><button type="button" className="iw-button iw-primary" disabled={locked} onClick={() => void repairFile()}>Parse corrected JSON</button></section>}
        {draft && draft.rows.length > 0 && <>
          <div className="iw-summary"><div><FileJson size={19} /><span><strong>{draft.rows.length}</strong><small>Questions</small></span></div><div><CheckCheck size={19} /><span><strong>{readiness?.active.length}</strong><small>Selected</small></span></div><button type="button" className={readiness?.invalid.length ? 'has-errors' : ''} onClick={() => { setFilter('errors'); setStep('edit'); setPage(0); if (readiness?.invalid[0]) selectRow(readiness.invalid[0].id); }}><AlertCircle size={19} /><span><strong>{readiness?.invalid.length}</strong><small>Need correction</small></span></button><button type="button" title="Show questions still awaiting your manual review" onClick={() => { setFilter('unreviewed'); setStep('edit'); setPage(0); }}><CheckCircle2 size={19} /><span><strong>{reviewedCount}</strong><small>Reviewed</small></span></button><div className={readiness?.unresolved.length ? 'has-matches' : ''}><Layers2 size={19} /><span><strong>{readiness?.unresolved.length}</strong><small>Decisions remaining</small></span></div></div>
          <div className="iw-toolbar"><div className="iw-filename"><span className="iw-file-icon"><FileJson size={20} /></span><div><strong>{draft.fileName}</strong><small>{draft.rows.length} questions · Local draft</small></div></div><div className="iw-toolbar-actions"><button type="button" className="iw-button" disabled={locked || !history.length} onClick={() => undo()}><Undo2 size={16} />Undo</button><button type="button" className="iw-button" disabled={locked || !future.length} onClick={() => undo(true)}><Redo2 size={16} />Redo</button><button type="button" className="iw-button" onClick={() => { download('reviewed-questions.json', exportImportDraft(draft)); setNotice(Object.keys(draft.media).length ? 'JSON downloaded. New local images remain in this device draft and are uploaded only during Submit.' : 'Reviewed JSON downloaded.'); }}><Download size={16} />Download JSON</button><button type="button" className="iw-button" onClick={() => download('import-review-report.json', JSON.stringify({ fileName: draft.fileName, qbankId: bankId, skipped: draft.skipped, questions: draft.rows.map(item => ({ position: item.position, originalQuestionNumber: item.question.originalQuestionNumber, excluded: item.excluded, reviewed: item.reviewed, error: validateImportRow(item).error, originalEntry: item.repairError ? item.raw : undefined, pendingJSON: item.pendingRaw, notes: item.notes })) }, null, 2))}><ClipboardList size={16} />Review report</button><label className={`iw-button ${locked ? 'is-disabled' : ''}`}><FolderOpen size={16} />Open another file<input type="file" className="iw-hidden-input" accept=".json,.txt,.text" aria-label="Open another JSON file" disabled={locked} onChange={e => { void openFile(e.target.files?.[0]); e.target.value = ''; }} /></label></div></div>
          {step !== 'submit' && <div className="iw-workbench">
            <aside className="iw-library"><div className="iw-library-head"><h2>Questions <span className="iw-count">{filtered.length}</span></h2><button type="button" className="iw-icon-button" aria-label="Add a question" disabled={locked} onClick={() => addQuestion()}><Plus size={18} /></button></div><label className="iw-search"><Search size={16} /><input aria-label="Search imported questions" placeholder="Search text, source, number…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label><select aria-label="Filter imported questions" value={filter} onChange={e => { setFilter(e.target.value as Filter); setPage(0); }}><option value="all">All questions</option><option value="errors">Need correction</option><option value="unreviewed">Not reviewed</option><option value="duplicates">Possible duplications</option><option value="excluded">Excluded · restore here</option></select><div className="iw-question-list">{filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(item => { const issue = !item.excluded && validateImportRow(item).error; return <button type="button" key={item.id} aria-pressed={selected === item.id} data-status={item.excluded ? undefined : issue ? 'error' : readiness?.matches[item.id]?.length && !decisionIsCurrent(item, readiness.matches[item.id], draft.decisions[item.id]) ? 'match' : item.reviewed ? 'reviewed' : undefined} className={`iw-question-item ${item.excluded ? 'is-excluded' : ''}`} onClick={() => selectRow(item.id)}><span className="iw-number">{item.position}</span><span><strong>{item.question.stem || 'Untitled question'}</strong><small>{item.submitted ? 'Already submitted' : item.excluded ? 'Excluded' : issue ? 'Needs correction' : readiness?.matches[item.id]?.length ? decisionIsCurrent(item, readiness.matches[item.id], draft.decisions[item.id]) ? 'Duplication decided' : 'Review duplication' : item.reviewed ? 'Reviewed' : 'Not reviewed'}</small></span>{item.reviewed && !issue && <Check size={15} />}</button>; })}{!filtered.length && <p className="iw-muted iw-no-results">No questions match this filter.</p>}</div><div className="iw-pagination"><button type="button" className="iw-icon-button" aria-label="Previous list page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{filtered.length ? `${currentPage + 1} / ${Math.ceil(filtered.length / PAGE_SIZE)}` : '0 results'}</span><button type="button" className="iw-icon-button" aria-label="Next list page" disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div></aside>
            <section className="iw-editor">{row ? <>
              <div className="iw-editor-heading"><div><span className="iw-eyebrow">Question {row.position}{row.question.originalQuestionNumber ? ` · Source #${row.question.originalQuestionNumber}` : ''}</span><h2>{step === 'duplicates' ? 'Compare & decide' : 'Question editor'}</h2></div><div className="iw-editor-tools"><button type="button" className="iw-icon-button" aria-label="Previous question" disabled={selectedPosition <= 0} onClick={() => selectRow(draft.rows[selectedPosition - 1].id)}><ChevronLeft size={18} /></button><button type="button" className="iw-icon-button" aria-label="Next question" disabled={selectedPosition === draft.rows.length - 1} onClick={() => selectRow(draft.rows[selectedPosition + 1].id)}><ChevronRight size={18} /></button></div></div>
              {row.excluded && <div className="iw-alert">{row.submitted ? 'This question was already submitted in a confirmed batch.' : 'This question is excluded from submission.'} <button type="button" className="iw-button" disabled={locked || row.submitted} onClick={() => updateRow(row.id, item => ({ ...item, excluded: false }))}><Undo2 size={16} />Restore question</button></div>}
              {rowError && <div className="iw-alert is-error" role="alert"><strong>Question {row.position}: {rowError}</strong><p>{errorHelp(rowError)}</p></div>}
              {step === 'duplicates' ? <>
                {!matches.length ? <div className="iw-empty"><ShieldCheck size={32} /><h3>No active matches for this question</h3><button type="button" className="iw-button" onClick={() => setStep('edit')}>Return to editing</button></div> : <>
                  <div className="iw-match-banner"><span className="iw-badge">{candidate && exactImportIdentity(candidate.payload) === exactImportIdentity(row.question) ? 'Full-content match' : candidate?.signals.stem === 100 ? 'Same question text · content may differ' : `Possible match · ${candidate?.similarity}%`}</span><p className="iw-muted">{candidate?.draftIndex !== undefined ? 'Earlier question in this file' : candidate?.entityType === 'approved_question' ? 'Published question in this QBank' : 'Question awaiting review in this QBank'} · Up to 3 bank candidates are shown per question.</p>{matches.length > 1 && <label>Compare with<select value={candidateIndex} onChange={e => setCandidateIndex(Number(e.target.value))}>{matches.map((m, i) => <option key={`${m.entityId}-${i}`} value={i}>Match {i + 1} · {m.draftIndex !== undefined ? 'This file' : m.entityType === 'approved_question' ? 'Published' : 'Pending'}</option>)}</select></label>}</div>
                  <p className="iw-differences">Differences: {candidate ? comparisonDifferences(candidate.payload, row.question).join(', ') || 'No visible content differences' : 'Select a match'}</p><div className="iw-comparison"><div><h3>Existing question</h3>{candidate && <QuestionPreview question={candidate.payload} />}</div><div><h3>Your new question</h3><QuestionPreview question={row.question} media={draft.media} /></div></div>
                  <div className="iw-decision-actions"><button type="button" className="iw-button iw-primary" disabled={locked || row.excluded} onClick={keepBoth}><CheckCheck size={17} />Keep both</button><button type="button" className="iw-button iw-danger" disabled={locked || row.excluded} onClick={() => { updateRow(row.id, item => ({ ...item, excluded: true })); }}><Trash2 size={17} />Exclude new question</button><button type="button" className="iw-button" disabled={locked} onClick={() => setStep('edit')}>Edit new question</button></div>{decisionCurrent && <p className="iw-success-text">Your decision is saved locally.</p>}
                </>}
              </> : <>
                <div className="iw-editor-actions"><button type="button" className={`iw-button ${preview ? 'iw-primary' : ''}`} onClick={() => setPreview(!preview)}><Eye size={16} />{preview ? 'Edit fields' : 'Preview'}</button><button type="button" className="iw-button" disabled={locked || !!rowError || row.excluded} onClick={() => updateRow(row.id, item => ({ ...item, reviewed: !item.reviewed }))}><Check size={16} />{row.reviewed ? 'Mark unreviewed' : 'Mark reviewed'}</button><button type="button" className="iw-button" disabled={locked} onClick={() => addQuestion(true)}><Copy size={16} />Duplicate draft</button><button type="button" className="iw-button iw-danger" disabled={locked} onClick={() => updateRow(row.id, item => ({ ...item, excluded: !item.excluded }))}>{row.excluded ? 'Restore' : 'Exclude'}</button></div>
                {preview ? <QuestionPreview question={row.question} media={draft.media} /> : <fieldset className="iw-form" disabled={locked || row.excluded}><legend className="sr-only">Edit question {row.position}</legend><label>Question text<textarea rows={6} dir="auto" value={row.question.stem} onChange={e => editQuestion({ stem: e.target.value })} /></label><p className="iw-muted">Use **double asterisks** for bold. Paragraphs and lists are preserved.</p><div className="iw-section-label"><h3>Answer choices</h3><span>Select one correct answer</span></div><div className="iw-options">{row.question.options.map((option, i) => <div className={`iw-option ${row.question.answer === i ? 'is-correct' : ''}`} key={i}><label className="iw-answer"><input type="radio" name={`answer-${row.id}`} aria-label={`Correct answer ${optionLabel(i)}`} checked={row.question.answer === i} onChange={() => editQuestion({ answer: i })} /><b>{optionLabel(i)}</b></label><textarea rows={2} dir="auto" aria-label={`Option ${optionLabel(i)}`} value={option} onChange={e => editQuestion({ options: row.question.options.map((v, n) => n === i ? e.target.value : v) })} /><div className="iw-option-tools"><button type="button" className="iw-icon-button" aria-label={`Move option ${optionLabel(i)} up`} disabled={i === 0} onClick={() => editQuestion(moveImportOption(row.question, i, i - 1))}><ArrowUp size={15} /></button><button type="button" className="iw-icon-button" aria-label={`Move option ${optionLabel(i)} down`} disabled={i === row.question.options.length - 1} onClick={() => editQuestion(moveImportOption(row.question, i, i + 1))}><ArrowDown size={15} /></button><button type="button" className="iw-icon-button" aria-label={`Remove option ${optionLabel(i)}`} disabled={row.question.options.length <= 2} onClick={() => editQuestion({ options: row.question.options.filter((_, n) => n !== i), answer: row.question.answer === i ? -1 : row.question.answer > i ? row.question.answer - 1 : row.question.answer })}><Trash2 size={15} /></button></div></div>)}</div><button type="button" className="iw-button" disabled={row.question.options.length >= 10} onClick={() => editQuestion({ options: [...row.question.options, ''] })}><Plus size={16} />Add choice</button>
                  <div className="iw-fields"><label>Specialty<input value={row.question.specialty} onChange={e => editQuestion({ specialty: e.target.value })} /></label><label>Topic<input value={row.question.topic} onChange={e => editQuestion({ topic: e.target.value })} /></label></div><label>Explanation<textarea rows={5} dir="auto" value={row.question.explanation} onChange={e => editQuestion({ explanation: e.target.value })} /></label>
                  <div className="iw-source-fields"><h3>Original source</h3><label>Source name · required<input maxLength={240} value={row.question.sourceFile || ''} onChange={e => editQuestion({ sourceFile: e.target.value })} placeholder="Original bank or lecture name" /></label><div className="iw-fields"><label>Page · optional<input type="number" min={1} max={100000} value={Number.isFinite(row.question.sourcePage) ? row.question.sourcePage : ''} onChange={e => editQuestion({ sourcePage: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="Unknown: leave empty" /></label><label>Original question number<input maxLength={80} value={row.question.originalQuestionNumber || ''} onChange={e => editQuestion({ originalQuestionNumber: e.target.value || undefined })} /></label></div></div>
                  {(['images', 'explanationImages'] as const).map(section => <section className="iw-images" key={section}><div className="iw-section-label"><h3>{section === 'images' ? 'Question images' : 'Explanation images'}</h3><label className="iw-button"><ImagePlus size={16} />Add images<input type="file" className="iw-hidden-input" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={locked || row.excluded} aria-label={`Add ${section === 'images' ? 'question' : 'explanation'} images`} onChange={e => { void addImages(e.target.files, section); e.target.value = ''; }} /></label></div><p className="iw-muted">New images stay on this device until Submit.</p><div className="iw-image-grid">{(row.question[section] ?? []).map(image => <figure key={image.id}><LocalImage image={image} blob={draft.media[image.id]} /><figcaption>{image.name}</figcaption><input aria-label={`Caption for ${image.name}`} placeholder="Caption" value={image.caption} onChange={e => editQuestion({ [section]: (row.question[section] ?? []).map(img => img.id === image.id ? { ...img, caption: e.target.value } : img) })} /><button type="button" className="iw-button" onClick={() => editQuestion({ [section]: (row.question[section] ?? []).filter(img => img.id !== image.id) })}>Remove image</button></figure>)}</div></section>)}
                </fieldset>}
                <details className="iw-details"><summary>Original JSON · repair this question</summary><p className="iw-muted">Edit the original entry and apply it locally. Keep exactly one question with its source name.</p><textarea aria-label="Original question JSON" rows={10} spellCheck={false} value={rawText} disabled={locked} onChange={e => updateRow(row.id, item => ({ ...item, pendingRaw: e.target.value }))} /><button type="button" className="iw-button" disabled={locked || !rawText.trim()} onClick={() => { try { const fixed = repairImportRow(row, rawText, row.question.sourceFile); updateRow(row.id, () => fixed); setNotice('Question corrected locally.'); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Correct the question JSON.'); } }}>Apply corrected question</button>{row.pendingRaw !== undefined && <button type="button" className="iw-button" disabled={locked} onClick={() => updateRow(row.id, item => ({ ...item, pendingRaw: undefined }))}>Discard pending JSON edits</button>}{row.original && <button type="button" className="iw-button" disabled={locked} onClick={() => updateRow(row.id, item => ({ ...item, question: structuredClone(item.original!), repairError: undefined, reviewed: false }))}>Restore original question</button>}</details>
              </>}
              <label className="iw-notes">Your review notes · local only<textarea rows={2} value={row.notes} disabled={locked} onChange={e => updateRow(row.id, item => ({ ...item, notes: e.target.value }))} placeholder="Things to verify against the source…" /></label>
            </> : <div className="iw-empty">Select a question to begin.</div>}</section>
            <aside className="iw-inspector"><span className="iw-eyebrow">Review overview</span><h2>Your next step</h2><div className="iw-review-progress"><div><span>Manual review</span><strong>{reviewedCount} / {readiness?.active.length}</strong></div><progress max={Math.max(1, readiness?.active.length ?? 0)} value={reviewedCount} aria-label="Questions manually reviewed" /></div><p>{readiness?.invalid.length ? 'Correct the highlighted questions or exclude them from submission.' : readiness?.unchecked.length ? 'Review your questions, then run Check duplication when you are ready.' : readiness?.unresolved.length ? 'Choose how to handle every possible duplication before submitting.' : 'Everything selected is ready for the final submission summary.'}</p><div className="iw-local-guide"><ShieldCheck size={19} /><div><strong>Private local workspace</strong><p>Questions are sent only when you choose Check duplication or Submit.</p></div></div><details className="iw-details"><summary>Update filtered questions</summary><p className="iw-muted">Applies to {filtered.filter(item => !item.excluded).length} active questions in the current filter.</p><label>Source<input value={bulk.source} onChange={e => setBulk({ ...bulk, source: e.target.value })} /></label><label>Specialty<input value={bulk.specialty} onChange={e => setBulk({ ...bulk, specialty: e.target.value })} /></label><label>Topic<input value={bulk.topic} onChange={e => setBulk({ ...bulk, topic: e.target.value })} /></label><button type="button" className="iw-button" disabled={locked} onClick={() => void applyBulk()}>Preview & apply</button></details>{draft.skipped.length > 0 && <details className="iw-details"><summary>{draft.skipped.length} items skipped in the source extraction</summary>{draft.skipped.map((item, i) => <p key={i}>{item.originalQuestionNumber || i + 1}: {item.reason}</p>)}</details>}<details className="iw-details"><summary>Recover / edit full file JSON</summary><p className="iw-muted">Original contents stay available if a question was truncated or could not be recovered. Reparsing replaces this edited list.</p><textarea aria-label="Full file recovery JSON" rows={12} spellCheck={false} disabled={locked} value={wholeFile} onChange={e => { setWholeFile(e.target.value); commit({ ...draft, rawFile: e.target.value }, false); }} /><button type="button" className="iw-button" disabled={locked} onClick={() => void repairFile()}>Reparse locally</button></details><PromptBuilder /></aside>
          </div>}
          {step === 'submit' && <section className="iw-submit iw-card"><ShieldCheck size={42} /><span className="iw-eyebrow">Final review</span><h2>{done ? 'Submitted for review' : 'Ready to send to your QBank?'}</h2><div className="iw-submit-destination"><span>Submit to this QBank</span><strong dir="auto">{context.bankName}</strong>{context.bankName !== bankId && <small dir="auto">{bankId}</small>}</div><div className="iw-submit-counts"><div><strong>{draft.submission?.successful ?? readiness?.active.length}</strong><span>{done ? 'Submitted questions' : 'Selected questions'}</span></div><div><strong>{draft.rows.filter(item => item.excluded).length}</strong><span>Excluded locally</span></div><div><strong>{readiness?.unresolved.length}</strong><span>Unresolved duplications</span></div></div><p className="iw-muted">Submit sends your selected questions for reviewer approval. They appear in the bank after approval. Review notes remain on your device.</p>{!done && <label className="iw-rights"><input type="checkbox" checked={rights} disabled={!!busy} onChange={e => setRights(e.target.checked)} />I confirm that I have the right to share this content.</label>}{draft.submission && !done && <p className="iw-alert">{draft.submission.completed} / {draft.submission.batches.length} batches acknowledged. Retry continues with the remaining batches. Editing is locked to preserve the submission.</p>}{done && <a className="iw-button iw-primary" href={`/qbanks/${encodeURIComponent(bankId)}`}>Return to QBank<ArrowRight size={16} /></a>}</section>}
          <footer className="iw-footer"><div><div className="iw-footer-destination"><span>Destination QBank</span><strong dir="auto">{context.bankName}</strong></div><strong>{step === 'edit' ? 'Review locally, then check' : step === 'duplicates' ? `${readiness?.unresolved.length} decisions remaining` : done ? 'Review team will approve your questions' : 'Confirm and submit'}</strong><span>{step === 'edit' ? 'No questions are sent while you edit.' : step === 'duplicates' ? 'Your decisions stay local until Submit.' : 'Only the selected QBank receives these questions.'}</span></div><div className="iw-footer-actions">{step === 'duplicates' && <button type="button" className="iw-button" disabled={locked || !!readiness?.unchecked.length} onClick={() => void skipExact()}><ListFilter size={16} />Exclude exact matches</button>}{step !== 'submit' && <button type="button" className="iw-button iw-primary" disabled={!!busy || !!draft.submission || !readiness?.active.length} onClick={() => readiness?.limitExceeded ? setError(`Select at most ${draft.questionLimit} questions for this import.`) : readiness?.unchecked.length || readiness?.invalid.length ? void checkDuplication() : readiness?.unresolved.length ? (setStep('duplicates'), setSelected(readiness.unresolved[0].id), setFilter('duplicates')) : setStep('submit')}><ShieldCheck size={17} />{readiness?.limitExceeded ? 'Reduce selected questions' : readiness?.unchecked.length || readiness?.invalid.length ? 'Check duplication' : readiness?.unresolved.length ? 'Resolve duplications' : 'Continue to Submit'}</button>}{step === 'submit' && !done && <><button type="button" className="iw-button" disabled={locked} onClick={() => setStep('edit')}>Back to editing</button><button type="button" className="iw-button iw-primary" disabled={!!busy || !rights || !draft.submission && !readiness?.ready} onClick={() => void submit()}>{busy ? <LoaderCircle size={17} className="animate-spin" /> : <CheckCheck size={17} />}{draft.submission ? 'Retry remaining batches' : 'Submit for review'}</button></>}</div></footer>
        </>}
      </>}
    </div>{confirmationDialog}
  </main>;
}
