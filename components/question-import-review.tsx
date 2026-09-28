'use client';
/* oxlint-disable next/no-img-element */
import { useEffect, useId, useRef, useState, useMemo } from 'react';
import { Check, ChevronDown, Copy, FileJson, GraduationCap, Upload, LoaderCircle } from 'lucide-react';
import { duplicateFingerprint } from '@/features/duplicates/domain/duplicate-detection';
import { subscribeLive } from '@/lib/realtime-client';
import { api } from '@/lib/api-client';
import { readImportFile } from '@/features/imports/client/read-import-file';
import { importRequest } from '@/features/imports/client/import-request';
import { DEFAULT_IMPORT_SETTINGS, ADMIN_MAX_FILE_BYTES, type ImportSettings } from '@/features/imports/domain/import-settings';
import { withLocalImportMatches, type ImportMatch } from '@/features/imports/domain/local-import-duplicates';
import {
  parseQuestionImportReport,
  buildQuestionPrompt,
  importedSourceReference,
  type SkippedImportedQuestion,
  type QuestionPromptSettings,
} from '@/lib/question-import';
import {
  optionLabel,
  type QuestionProposal,
  type QuestionProposalPayload,
  type QBankSpecialty,
  type QBankTopic,
} from '@/lib/medguard-types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';

type ImportChoice = {sourceFingerprint:string;candidateFingerprints:string[]};
const MAX_CHUNK_BYTES = 900_000;
const MAX_CHUNK_QUESTIONS = 25;

function splitImport(
  questions: QuestionProposalPayload[],
  skipped: SkippedImportedQuestion[],
  questionLimit = MAX_CHUNK_QUESTIONS,
) {
  const encoder = new TextEncoder();
  const chunks: Array<{ questions: QuestionProposalPayload[]; skipped: SkippedImportedQuestion[]; bytes: number }> = [];
  for (const question of questions) {
    const bytes = encoder.encode(JSON.stringify(question)).byteLength + 1;
    if (bytes > MAX_CHUNK_BYTES) throw new Error('One question is too large to upload.');
    let chunk = chunks[chunks.length - 1];
    if (!chunk || chunk.questions.length >= questionLimit || chunk.bytes + bytes > MAX_CHUNK_BYTES) {
      chunk = { questions: [], skipped: [], bytes: 0 };
      chunks.push(chunk);
    }
    chunk.questions.push(question);
    chunk.bytes += bytes;
  }
  let nextChunk = 0;
  for (const item of skipped) {
    const bytes = encoder.encode(JSON.stringify(item)).byteLength + 1;
    while (nextChunk < chunks.length && (chunks[nextChunk].bytes + bytes > MAX_CHUNK_BYTES || chunks[nextChunk].questions.length + chunks[nextChunk].skipped.length >= 200)) nextChunk += 1;
    if (nextChunk >= chunks.length) break;
    chunks[nextChunk].skipped.push(item);
    chunks[nextChunk].bytes += bytes;
  }
  return chunks;
}

export function QuestionImportReview({
  bankId,
  unlimited = false,
  onImported,
}: {
  bankId: string;
  unlimited?: boolean;
  onImported: (result: { proposals: QuestionProposal[]; specialties: QBankSpecialty[]; topics: QBankTopic[]; classificationRevision?: number }) => void;
}) {
  const [drafts, setDrafts] = useState<QuestionProposalPayload[]>([]),
    [index, setIndex] = useState(0),
    [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [uploadSessionId, setUploadSessionId] = useState(() =>
      crypto.randomUUID(),
    );
  const [matches,setMatches]=useState<ImportMatch[][]>([]);
  const [choices,setChoices]=useState<Record<number,ImportChoice>>({});
  const [excluded,setExcluded]=useState<number[]>([]);
  const [dirty,setDirty]=useState<number[]>([]);
  const [comparison,setComparison]=useState(false);
  const [comparisonIndex,setComparisonIndex]=useState(0);
  const [checking,setChecking]=useState(false);
  const [limits,setLimits]=useState({questionsPerImport:150,importsPerDay:5});
  const [importPolicy, setImportPolicy] = useState<ImportSettings>(DEFAULT_IMPORT_SETTINGS);
  const [adminImport, setAdminImport] = useState(unlimited);
  const [scanComplete, setScanComplete] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const chunkChoices=useRef<ImportChoice[][]>([]);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileHash, setFileHash] = useState('');
  const [sourceFile, setSourceFile] = useState('');
  const [skipped, setSkipped] = useState<SkippedImportedQuestion[]>([]);
  const [repaired, setRepaired] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const operation = useRef(false);
  const uploadChunks = useRef<ReturnType<typeof splitImport> | null>(null);
  const uploadedChunks = useRef(0);
  const importedCount = useRef(0);
  const flaggedCount = useRef(0);
  const skippedDuplicateCount = useRef(0);
  const batchIds = useRef<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [lastImportCount, setLastImportCount] = useState<number | null>(null);
  const panelId = useId();
  const [selectedSource, setSelectedSource] = useState<QuestionPromptSettings['source'] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState('');
  const [copyError, setCopyError] = useState('');
  const [access, setAccess] = useState<{
    status: 'checking' | 'allowed' | 'suspended' | 'error';
    endsAt?: string | null;
    message?: string;
  }>({ status: 'checking' });
  const [settings, setSettings] = useState<QuestionPromptSettings>({
    source: 'qbank', kind: 'clinical', length: 'medium', countMode: 'fixed', count: 20, optionCount: 4,
  });
  const [countText, setCountText] = useState('20');
  const [optionsText, setOptionsText] = useState('4');
  const [confirmAction, confirmationDialog] = useConfirmationDialog();
  useEffect(() => {
    let active = true;
    const refresh=()=>api<{ suspended: boolean; endsAt: string | null; questionsPerImport:number;importsPerDay:number; settings: ImportSettings; isSuperadmin: boolean }>(
      '/platform/json-import-status',
    )
      .then((result) => {
        if (!active) return;
        setLimits({questionsPerImport:result.questionsPerImport,importsPerDay:result.importsPerDay});
        setImportPolicy(result.settings);
        setAdminImport(result.isSuperadmin);
        setAccess(
          (!result.settings.enabled && !result.isSuperadmin) ? { status: 'suspended', message: 'JSON import is temporarily paused by Superadmin.' } : result.suspended && (!result.endsAt || Date.parse(result.endsAt)>Date.now())
            ? { status: 'suspended', endsAt: result.endsAt }
            : { status: 'allowed' },
        );
      })
      .catch((error) => {
        if (!active) return;
        setAccess({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to verify Import access.',
        });
      });
    void refresh();
    const unsubscribe=subscribeLive(topic=>{if(topic==='import-status'||topic==='connected')void refresh();},['import-status','connected']);
    return () => {
      active = false;unsubscribe();
    };
  }, []);
  useEffect(()=>{
    if(access.status!=='suspended'||!access.endsAt)return;
    const timer=window.setTimeout(()=>{
      void api<{suspended:boolean;endsAt:string|null;settings:ImportSettings;isSuperadmin:boolean}>('/platform/json-import-status',{forceRefresh:true,requestReason:'eligibility-parameters-changed'}).then(result=>{
        setImportPolicy(result.settings); setAdminImport(result.isSuperadmin);
        setAccess(!result.settings.enabled && !result.isSuperadmin ? {status:'suspended',message:'JSON import is temporarily paused by Superadmin.'} : result.suspended ? {status:'suspended',endsAt:result.endsAt} : {status:'allowed'});
      }).catch(()=>setAccess({status:'error',message:'Unable to verify Import access.'}));
    },Math.max(0,Math.min(2_000_000_000,Date.parse(access.endsAt)-Date.now()+100)));
    return ()=>window.clearTimeout(timer);
  },[access]);
  const lecture = settings.source === 'lecture';
  const countValid = (lecture && settings.countMode === 'per_slide') ||
    (countText.trim() !== '' && Number.isInteger(Number(countText)) && Number(countText) >= 1 && Number(countText) <= 200);
  const optionsValid = !lecture || (optionsText.trim() !== '' && Number.isInteger(Number(optionsText)) && Number(optionsText) >= 2 && Number(optionsText) <= 10);
  const prompt = countValid && optionsValid ? buildQuestionPrompt({
    ...settings, count: lecture && settings.countMode === 'per_slide' ? 20 : Number(countText), optionCount: Number(optionsText),
  }) : '';
  const draft = drafts[index];
  const duplicateSummary = useMemo(() => {
    const active = new Set(drafts.map((_, i) => i).filter(i => !excluded.includes(i)));
    const banks = new Set<string>();
    let bankMatches = 0, fileMatches = 0, unresolved = 0;
    matches.forEach((list, i) => {
      if (!active.has(i)) return;
      const relevant = list.filter(match => match.draftIndex === undefined || active.has(match.draftIndex));
      if (relevant.some(match => match.draftIndex === undefined)) bankMatches++;
      if (relevant.some(match => match.draftIndex !== undefined)) fileMatches++;
      relevant.filter(match => match.draftIndex === undefined).forEach(match => banks.add(match.entityId));
      if (relevant.length && !choices[i]) unresolved++;
    });
    return { bankMatches, fileMatches, existing: banks.size, unresolved };
  }, [drafts, matches, excluded, choices]);
  async function preview(questions:QuestionProposalPayload[]) {
    const results:ImportMatch[][]=[];
    for (const chunk of splitImport(questions, [], importPolicy.previewBatchSize)) {
      const batch=await importRequest<{matches:ImportMatch[][]}>('/platform/import-preview',{method:'POST',body:JSON.stringify({qbankId:bankId,sourceFile,questions:chunk.questions})});
      if (!Array.isArray(batch.matches) || batch.matches.length !== chunk.questions.length) throw new Error('Duplicate scan was not confirmed. Please retry the scan.');
      results.push(...batch.matches);
      setScanProgress(results.length);
    }
    return withLocalImportMatches(questions, results);
  }
  async function scan(questions = drafts) {
    setChecking(true); setScanComplete(false); setScanProgress(0); setError('');
    try {
      const findings = await preview(questions);
      setMatches(findings); setScanComplete(true); setDirty([]);
    } catch (caught) {
      setError(`${caught instanceof Error ? caught.message : 'Duplicate scan could not finish.'} Your questions are still available. Retry the scan before saving.`);
    } finally { setChecking(false); }
  }
  async function recheck(i:number) {
    if(!dirty.includes(i)) return matches[i]??[];
    setChecking(true);
    try {
      const result=await preview([drafts[i]]);
      const updated = withLocalImportMatches(drafts, matches.map((value, n) => n === i ? result[0] : value), excluded);
      const found = updated[i];
      setMatches(updated);
      setDirty(current=>current.filter(n=>n!==i));
      return found;
    } finally {setChecking(false);}
  }
  function advance() {setComparison(false);setComparisonIndex(0);if(index<drafts.length-1)setIndex(index+1);}
  function keepBoth(found=matches[index]??[]) {
    setChoices(current=>({...current,[index]:{sourceFingerprint:duplicateFingerprint(drafts[index]),candidateFingerprints:found.map(m=>m.candidateFingerprint)}}));
    advance();
  }
  async function next() {
    try {const wasDirty=dirty.includes(index),found=await recheck(index);if(wasDirty&&found.length)return;if(found.length)keepBoth(found);else advance();} catch(e){setError(e instanceof Error?e.message:'Unable to check duplication.');}
  }
  function excludeQuestion(n:number) {
    const nextExcluded = [...new Set([...excluded, n])];
    setExcluded(nextExcluded);
    setMatches(current=>withLocalImportMatches(drafts, current, nextExcluded));
    setChoices(current => Object.fromEntries(Object.entries(current).filter(([i]) => Number(i) !== n && !matches[Number(i)]?.some(match => match.draftIndex === n))));
    if(n===index)advance();
  }
  async function deleteOld(match:ImportMatch) {
    setChecking(true);setError('');
    try {
      if(match.draftIndex!==undefined) excludeQuestion(match.draftIndex);
      else {
        await api('/platform/import-delete-duplicate',{method:'POST',body:JSON.stringify({qbankId:bankId,entityId:match.entityId,entityType:match.entityType,candidateFingerprint:match.candidateFingerprint})});
        setMatches(current=>current.map(list=>list.filter(m=>m.entityId!==match.entityId)));
      }
      setComparison(false);setComparisonIndex(0);
    } catch(e){setError(e instanceof Error?e.message:'Unable to delete the old question.');} finally {setChecking(false);}
  }
  async function read(file?: File) {
    if (!file || operation.current) return;
    if (drafts.length && !(await confirmAction({
      title: 'Replace the current import draft?',
      description: 'Your current review edits will be replaced after the new file is validated successfully.',
      confirmLabel: 'Replace draft',
      tone: 'warning',
    }))) return;
    operation.current = true;
    setReading(true);
    setError('');
    setMessage('');
    if (!drafts.length) setSkipped([]);
    try {
      const maximumBytes = adminImport ? ADMIN_MAX_FILE_BYTES : importPolicy.maxFileMegabytes * 1_000_000;
      if (file.size > maximumBytes) throw new Error(`JSON file must be smaller than ${maximumBytes / 1_000_000} MB.`);
      if (!/\.(json|txt|text)$/i.test(file.name)) throw new Error('Choose a JSON or TXT file containing questions in JSON format.');
      const { report, hash } = await readImportFile(file);
      if (!report.questions.length) {
        if (!drafts.length) setSkipped(report.skipped);
        throw new Error('No complete, valid questions were found. Review the skipped questions below.');
      }
      setMatches([]);setChoices({});setExcluded([]);setDirty([]);setComparison(false);setScanComplete(false);
      setSkipped(report.skipped);
      setDrafts(report.questions);
      setFileName(file.name);
      setFileHash(hash);
      setSourceFile(report.sourceFile);
      setRepaired(report.repaired);
      setRightsConfirmed(false);
      setIndex(0);
      setOpen(true);
      setMessage('');
      setRequestId(crypto.randomUUID());
      setUploadSessionId(crypto.randomUUID());
      uploadChunks.current = null;
      uploadedChunks.current = 0;
      importedCount.current = 0;
      flaggedCount.current = 0;
      skippedDuplicateCount.current = 0;
      batchIds.current = [];
      setUploadProgress(0);
      setUploadTotal(0);
      setLastImportCount(null);
      setReading(false);
      await scan(report.questions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON.');
    } finally {
      operation.current = false;
      setReading(false);
    }
  }
  function edit(patch: Partial<QuestionProposalPayload>) {
    if (uploadedChunks.current) return;
    if (Object.keys(patch).some(key => ['stem', 'options', 'answer', 'specialty', 'topic'].includes(key))) {
      setDirty(current=>[...new Set([...current,index])]);
      setChoices(current => Object.fromEntries(Object.entries(current).filter(([i]) => Number(i) !== index && !matches[Number(i)]?.some(match => match.draftIndex === index))));
    }
    const nextDrafts = drafts.map((draft, i) => i === index ? { ...draft, ...patch } : draft);
    setMatches(current => withLocalImportMatches(nextDrafts, current, excluded));
    setDrafts(nextDrafts);
  }
  async function submit() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      if (!scanComplete) throw new Error('Finish the duplicate scan before saving.');
      const checkedMatches=[...matches];
      for(const i of dirty.filter(n=>!excluded.includes(n))) {
        const found=await recheck(i);checkedMatches[i]=found;
        if(found.length){setIndex(i);throw new Error('Review the duplication before saving.');}
      }
      const unresolved=checkedMatches.findIndex((list,i)=>!excluded.includes(i)&&list.length&&!choices[i]);
      if(unresolved>=0){setIndex(unresolved);throw new Error('Choose Save as duplication or View the duplication for this question.');}
      const selected=drafts.filter((_,i)=>!excluded.includes(i));
      const selectedChoices=drafts.flatMap((_,i)=>excluded.includes(i)?[]:[choices[i]]);
      const validated = parseQuestionImportReport({ sourceFile, questions: selected, skipped }, '', Number.POSITIVE_INFINITY);
      if (!validated.questions.length) throw new Error('There are no valid questions to submit.');
      if (validated.questions.length !== selected.length)
        throw new Error('Some edited questions are incomplete. Correct their question text, choices, answer or source before saving; no question has been silently removed.');
      if (!adminImport && validated.questions.length > limits.questionsPerImport) throw new Error(`Your account allows ${limits.questionsPerImport} questions per import. Remove questions or ask Superadmin to adjust your limit.`);
      const chunks = uploadChunks.current ?? splitImport(validated.questions, validated.skipped);
      if(!uploadChunks.current){let offset=0;chunkChoices.current=chunks.map(chunk=>{const list=selectedChoices.slice(offset,offset+chunk.questions.length);offset+=chunk.questions.length;return list;});}
      uploadChunks.current = chunks;
      setUploadTotal(chunks.length);
      if (!batchIds.current.length) batchIds.current = chunks.map((_, chunkIndex) => chunkIndex === 0 ? requestId : crypto.randomUUID());
      for (let chunkIndex = uploadedChunks.current; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        const chunkHash = chunks.length === 1 ? fileHash : [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${fileHash}:${chunkIndex}`)))].map(value => value.toString(16).padStart(2, '0')).join('');
        const chunkName = chunks.length === 1 ? fileName : `${fileName.slice(0, 210)}-part-${chunkIndex + 1}.json`;
        const result = await importRequest<{
          proposals: QuestionProposal[];
          successful: number;
          flaggedDuplicates?: number;
          skippedDuplicates?: number;
          skipped: SkippedImportedQuestion[];
          specialties: QBankSpecialty[];
          topics: QBankTopic[];
          classificationRevision?: number;
        }>('/platform/import', {
          method: 'POST',
          body: JSON.stringify({
            questions: chunk.questions,
            duplicateChoices:chunkChoices.current[chunkIndex],
            skipped: chunk.skipped,
            sourceFile: validated.sourceFile,
            repaired: repaired || validated.repaired,
            fileName: chunkName,
            fileHash: chunkHash,
            originalFileName: fileName,
            originalFileHash: fileHash,
            uploadSessionId,
            chunkIndex,
            chunkCount: chunks.length,
            qbankId: bankId,
            requestId: batchIds.current[chunkIndex],
            rightsConfirmed,
          }),
        });
        onImported({ proposals: result.proposals, specialties: result.specialties ?? [], topics: result.topics ?? [], classificationRevision: result.classificationRevision });
        if (!unlimited) setSkipped(result.skipped);
        importedCount.current += result.successful;
        flaggedCount.current += result.flaggedDuplicates ?? 0;
        skippedDuplicateCount.current += result.skippedDuplicates ?? 0;
        uploadedChunks.current = chunkIndex + 1;
        setUploadProgress(chunkIndex + 1);
      }
      setLastImportCount(importedCount.current);
      setMessage(
        'Questions submitted for review.',
      );
      setOpen(false);
      setDrafts([]);
      uploadChunks.current = null;
      uploadedChunks.current = 0;
      importedCount.current = 0;
      flaggedCount.current = 0;
      skippedDuplicateCount.current = 0;
      batchIds.current = [];
      setUploadProgress(0);
      setUploadTotal(0);
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : 'Unable to upload.'} ${uploadedChunks.current ? `${uploadedChunks.current} batches were saved. Retry to complete the remaining batches without duplicating them.` : 'Your questions remain available to edit and retry.'}`,
      );
      if (!uploadedChunks.current) {
        uploadChunks.current = null;
        batchIds.current = [];
        setUploadTotal(0);
      }
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  if (access.status === 'checking')
    return (
      <section className="rounded-2xl border bg-muted/30 p-6 text-center">
        <LoaderCircle className="mx-auto size-6 animate-spin text-primary" />
        <p className="mt-3 text-sm text-muted-foreground">
          Checking Import access…
        </p>
      </section>
    );
  if (access.status === 'suspended')
    return (
      <section className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-center">
        <h3 className="text-lg font-bold text-destructive">Import temporarily unavailable</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {access.message ?? 'Import is temporarily unavailable for this account.'}
          {access.endsAt
            ? ` Access may return after ${new Date(access.endsAt).toLocaleString()}.`
            : ''}
        </p>
      </section>
    );
  if (access.status === 'error')
    return (
      <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
        {access.message}
      </p>
    );
  return (
    <div className="min-w-0 space-y-4">
      <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3 sm:p-4" aria-busy={reading}>
        <label className={`relative flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-5 text-center transition-colors focus-within:ring-2 focus-within:ring-primary ${dragging ? 'border-primary bg-primary/10' : 'border-primary/30 bg-primary/5 hover:border-primary hover:bg-primary/10'} ${busy || reading ? 'pointer-events-none opacity-60' : ''}`}>
          <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">{reading ? <LoaderCircle className="size-6 animate-spin" /> : <Upload className="size-6" />}</span>
          <span className="text-base font-bold" dir="auto">Upload your file here <span dir="ltr">JSON / Text</span></span>
          <span className="text-sm text-muted-foreground" dir="auto">Drag a file here or click to choose one</span>
          <input aria-label="Upload your file here JSON / Text" type="file" accept="application/json,text/plain,.json,.txt,.text" disabled={busy || reading}
            onDragOver={e => { e.preventDefault(); if (!busy && !reading) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length !== 1) { setError('Please upload one file at a time.'); return; } void read(e.dataTransfer.files[0]); }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            onChange={e => { void read(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <p className="text-xs text-muted-foreground" dir="auto">{adminImport ? 'JSON or text containing JSON · Up to 50 MB · Administrative imports submit questions in batches. Review the questions before submitting.' : `JSON or text containing JSON · Up to ${limits.questionsPerImport} questions per import · ${limits.importsPerDay} imports per day · Up to ${importPolicy.maxFileMegabytes} MB.`}</p>
        {busy && uploadTotal > 0 && <output className="block text-sm">Uploading batch {uploadProgress + 1} of {uploadTotal}…</output>}
        {reading && <output className="block text-sm">Validating file…</output>}
        {drafts.length > 0 && <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg bg-muted p-3">
          <p className="min-w-0 flex-1 break-words text-sm">{fileName} · {drafts.length} questions ready for review{skipped.length ? ` · ${skipped.length} skipped` : ''}{repaired ? ' · JSON repaired' : ''}</p>
          <button type="button" disabled={reading || busy} className="q-button min-h-11 border" onClick={() => setOpen(true)}>Resume review</button>
        </div>}
        {message && !error && <output className="block space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm" dir="ltr">
          <strong className="block text-base text-emerald-700 dark:text-emerald-300">{message}</strong>
          {lastImportCount ? <>
            <span className="block">New questions were submitted to the review team before being added to the QBank.</span>
            <span className="block">They will appear in the bank automatically after reviewer approval.</span>
          </> : <span className="block">No new questions were submitted. Matching questions already exist or are awaiting review.</span>}
        </output>}
        {skipped.length > 0 && <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4" dir="ltr">
          <h3 className="font-semibold">{skipped.length} questions were skipped because of source issues:</h3>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
            {skipped.map((item, itemIndex) => <li key={`${item.originalQuestionNumber ?? 'unknown'}-${item.page ?? 'unknown'}-${itemIndex}`}>
              {item.originalQuestionNumber ? `Question ${item.originalQuestionNumber} — ` : ''}{item.page ? `Page ${item.page}: ` : ''}{item.reason}
            </li>)}
          </ul>
        </section>}
        {error && !open && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      </section>
      <div className="space-y-3">
      {(['lecture', 'qbank'] as const).map(source => <div key={source} className={`min-w-0 overflow-hidden rounded-xl border ${selectedSource === source ? 'border-primary/50' : 'border-border'}`}>
        <button type="button" aria-expanded={selectedSource === source} aria-controls={`${panelId}-${source}`} onClick={() => { setSelectedSource(selectedSource === source ? null : source); setSettings(s => ({ ...s, source })); setCopyError(''); }}
          className={`flex min-h-16 w-full items-center gap-3 p-4 text-start transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${selectedSource === source ? 'bg-primary/5' : 'bg-card'}`} dir="ltr">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{source === 'lecture' ? <GraduationCap className="size-5" /> : <FileJson className="size-5" />}</span>
          <span className="min-w-0 flex-1 text-sm font-semibold leading-6">{source === 'lecture' ? 'Generate questions from lecture material with AI' : 'Convert question bank files with AI'}</span>
          <ChevronDown className={`size-5 shrink-0 transition-transform ${selectedSource === source ? 'rotate-180' : ''}`} />
        </button>
      <div id={`${panelId}-${source}`} hidden={selectedSource !== source}>
      {selectedSource === source && <>
      <section className="min-w-0 space-y-4 rounded-xl border bg-card p-3 sm:p-4">
        <div>
          <h3 className="font-semibold">Prepare content with AI</h3>
          <p className="mt-1 text-sm text-muted-foreground" dir="auto">Choose your settings, copy the prompt into your AI tool with your file, then upload the resulting JSON here for review. Qraft does not send your file to an AI service.</p>
          <p className="mt-2 text-sm text-muted-foreground" dir="auto">The prompt asks for a specialty and topic for each question. Qraft reads these from the JSON so you can review and edit them before submitting.</p>
        </div>
        {!lecture && <p className="rounded-lg bg-muted p-3 text-sm" dir="auto">The prompt asks the AI to convert the bank using text extraction or OCR, correct spelling in context, complete four plausible options, and include the question number, page and explanation.</p>}
        {lecture && <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-semibold">Question type
            <select className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" value={settings.kind} onChange={e => setSettings(s => ({ ...s, kind: e.target.value as QuestionPromptSettings['kind'] }))}>
              <option value="clinical">Clinical</option><option value="direct">Direct</option>
            </select>
          </label>
          <label className="min-w-0 text-sm font-semibold">Question length
            <select className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" value={settings.length} onChange={e => setSettings(s => ({ ...s, length: e.target.value as QuestionPromptSettings['length'] }))}>
              <option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option>
            </select>
          </label>
        </div>}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            {lecture && <label className="block text-sm font-semibold">Question count mode
              <select className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" value={settings.countMode} onChange={e => setSettings(s => ({ ...s, countMode: e.target.value as QuestionPromptSettings['countMode'] }))}>
                <option value="fixed">Specific number</option><option value="per_slide">One question per slide</option>
              </select>
            </label>}
            {(!lecture || settings.countMode === 'fixed') && <label className="block text-sm font-semibold">{lecture ? 'Questions to generate' : 'Questions to extract'}
              <input type="number" inputMode="numeric" min={1} max={200} step={1} value={countText} onChange={e => setCountText(e.target.value)} aria-invalid={!countValid} className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" />
            </label>}
            <p className="text-xs text-muted-foreground">AI prompt: 1–200 questions at a time. The full file loads for review; account import limits apply when saving.</p>
            {!countValid && <p role="alert" className="text-sm text-destructive">Choose a whole number from 1 to 200.</p>}
          </div>
          {lecture && <label className="min-w-0 text-sm font-semibold">Options per question
            <input type="number" inputMode="numeric" min={2} max={10} step={1} value={optionsText} onChange={e => setOptionsText(e.target.value)} aria-invalid={!optionsValid} className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" />
            {!optionsValid && <span role="alert" className="mt-2 block text-sm text-destructive">Choose a whole number from 2 to 10.</span>}
          </label>}
        </div>
        <button type="button" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto" disabled={!prompt}
          onClick={async () => { try { await navigator.clipboard.writeText(prompt); setCopiedPrompt(prompt); setCopyError(''); } catch { setCopyError('Unable to copy. Open the prompt preview below and copy the text manually.'); } }}>
          {copiedPrompt === prompt && prompt ? <Check className="size-5" /> : <Copy className="size-5" />}
          {copiedPrompt === prompt && prompt ? 'Prompt copied' : 'Copy AI prompt'}
          <span className="sr-only">Copy AI prompt</span>
        </button>
        {copiedPrompt === prompt && prompt && <output className="block text-sm text-emerald-600" dir="auto">Copied. Add your source and this prompt to your AI tool, then upload the resulting file above.</output>}
        {copyError && <p role="alert" className="text-sm text-destructive" dir="auto">{copyError}</p>}
        <details className="min-w-0 text-sm">
          <summary className="min-h-11 cursor-pointer py-3">Preview AI prompt</summary>
          <textarea aria-label="Generated AI prompt" readOnly dir="ltr" value={prompt} className="min-h-48 w-full min-w-0 rounded-xl border bg-muted p-3 text-xs" />
        </details>
      </section>
      </>}
      </div>
      </div>)}
      </div>
      <p className="text-xs text-muted-foreground" dir="auto">You can also upload an existing JSON file directly. These settings only affect the prompt; they do not rewrite imported questions or answers. Check the output against your source before uploading.</p>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!busy) setOpen(o);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogTitle>Import Review</DialogTitle>
          <section className="rounded-xl border bg-muted/30 p-4" aria-live="polite">
            {checking && !scanComplete ? <p className="font-semibold">Checking duplication · {scanProgress} / {drafts.length} questions</p> : scanComplete ? <>
              <p className="font-semibold">{duplicateSummary.bankMatches} imported questions have possible matches in this bank · {duplicateSummary.existing} existing or pending matches shown.</p>
              <p className="mt-1 text-sm text-muted-foreground">{duplicateSummary.fileMatches} questions also match earlier questions in this file · {duplicateSummary.unresolved} decisions remaining. Matches are possible duplicates; review before choosing.</p>
              {duplicateSummary.unresolved > 0 && <button type="button" disabled={busy || checking} className="q-button mt-3 min-h-11 border" onClick={() => {
                const nextIndex = matches.findIndex((list, i) => list.length && !excluded.includes(i) && !choices[i]);
                if (nextIndex >= 0) { setIndex(nextIndex); setComparisonIndex(0); setComparison(true); }
              }}>Review duplications</button>}
            </> : <p>Questions are loaded. Complete the duplicate scan before saving.</p>}
            {!checking && !scanComplete && <button type="button" className="q-button mt-3 min-h-11 border" onClick={() => void scan()}>Retry duplicate scan</button>}
          </section>
          <label className="block text-sm font-semibold">Source name for this import
            <input value={sourceFile} disabled={busy || checking || uploadProgress > 0} maxLength={240} className="mt-1 min-h-11 w-full rounded-xl border bg-background px-3" onChange={event => {
              const name = event.target.value;
              setSourceFile(name);
              const renamed = drafts.map(question => ({ ...question, sourceFile: name, sourceReference: importedSourceReference(name, question.sourcePage ?? 0, question.originalQuestionNumber) }));
              setDrafts(renamed);
              setMatches(current => withLocalImportMatches(renamed, current, excluded));
            }} />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">Changes the source title for every question; page numbers and original question numbers stay intact.</span>
          </label>
          {matches[index]?.length>0&&!excluded.includes(index)&&<span className="w-fit rounded-full bg-amber-500/15 px-3 py-1 text-sm font-semibold text-amber-700 dark:text-amber-300">duplication</span>}
          <p>
            {drafts.length} questions found · Question {index + 1} of{' '}
            {drafts.length}
          </p>
          <progress aria-label="Question review progress" max={drafts.length || 1} value={index + 1} className="h-2 w-full accent-primary" />
          {excluded.includes(index)&&<p className="text-sm text-muted-foreground">New question deleted from this import.</p>}
          {draft && (
            <fieldset disabled={busy || checking || uploadProgress > 0 || excluded.includes(index)} className="min-w-0 space-y-3">
              <legend className="sr-only">Review and edit question</legend>
              <label className="block text-sm font-semibold">
                Question
                <textarea
                  dir="auto"
                  className="mt-1 min-h-28 w-full rounded-xl border bg-background p-3"
                  value={draft.stem}
                  onChange={(e) => edit({ stem: e.target.value })}
                />
              </label>
              <p className="text-sm font-medium">Answer options · Select the correct answer</p>
              {draft.options.map((o, i) => (
                <div className="flex items-start gap-2" key={i}>
                  <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg border px-2">
                  <input
                    className="size-4 accent-primary"
                    type="radio"
                    name="import-answer"
                    aria-label={`Correct answer ${optionLabel(i)}`}
                    checked={draft.answer === i}
                    onChange={() => edit({ answer: i })}
                  />
                  <span>{optionLabel(i)}</span>
                  </label>
                  <textarea
                    dir="auto"
                    aria-label={`Option ${optionLabel(i)}`}
                    className="min-w-0 flex-1 rounded-xl border bg-background p-3"
                    value={o}
                    onChange={(e) =>
                      edit({
                        options: draft.options.map((v, n) =>
                          n === i ? e.target.value : v,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              {draft.images.length > 0 && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                {draft.images.map(img => <figure key={img.id} className="min-w-0 rounded-xl border p-2">
                  <a href={img.url} target="_blank" rel="noopener noreferrer" className="block" aria-label={`Open question image: ${img.caption || img.name}`}>
                    <img src={img.url} alt={img.caption || img.name} loading="lazy" className="max-h-64 w-full object-contain" />
                  </a>
                  <figcaption dir="auto" className="mt-2 break-words text-xs text-muted-foreground">{img.caption || img.name} · Open image</figcaption>
                </figure>)}
              </div>}
              {(
                [
                  'specialty',
                  'topic',
                  'explanation',
                ] as const
              ).map((k) => (
                <label className="block text-sm" key={k}>
                  {k === 'specialty' ? 'Specialty' : k === 'topic' ? 'Topic' : k}
                  <textarea
                    dir="auto"
                    className="mt-1 w-full rounded-xl border bg-background p-3"
                    value={draft[k]}
                    onChange={(e) => edit({ [k]: e.target.value })}
                  />
                </label>
              ))}
              <div className="rounded-xl bg-muted p-3 text-sm" dir="auto">
                <span className="font-semibold">Source · Brief reference</span>
                <input aria-label="Question source name" maxLength={240} className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" value={draft.sourceFile ?? ''} onChange={event => edit({ sourceFile: event.target.value, sourceReference: importedSourceReference(event.target.value, draft.sourcePage ?? 0, draft.originalQuestionNumber) })} />
                <p className="mt-1 break-words">{draft.sourceReference}</p>
              </div>
            </fieldset>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <label className="flex items-start gap-3 rounded-xl border bg-muted/30 p-3 text-sm">
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(event) => setRightsConfirmed(event.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>I confirm that I have the right to share this content.</span>
          </label>
          <div className="grid grid-cols-2 gap-2 border-t pt-3">
            <button
              disabled={busy || checking || index === 0}
              className="q-button min-h-11 border"
              onClick={() => setIndex(index - 1)}
            >
              Previous
            </button>
            <button disabled={busy||checking} className="q-button min-h-11 border" onClick={()=>void next()}>
              {checking?'Checking…':matches[index]?.length&&!excluded.includes(index)?'Keep both':'Next'}
            </button>
            {matches[index]?.length>0&&!excluded.includes(index)&&<button disabled={busy||checking} className="q-button col-span-2 min-h-11 border" onClick={()=>{setComparisonIndex(0);setComparison(true);}}>View the duplication</button>}
            <button
              disabled={busy || checking || !rightsConfirmed || !scanComplete || !sourceFile.trim()}
              className="q-button col-span-2 min-h-11 whitespace-normal bg-primary text-primary-foreground"
              onClick={() => void submit()}
            >
              {busy ? 'Uploading…' : uploadProgress > 0 ? 'Retry remaining batches' : index < drafts.length - 1 ? 'Save import' : 'Save import'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={comparison} onOpenChange={setComparison}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
          <DialogTitle>View the duplication</DialogTitle>
          {matches[index]?.length>1&&<select aria-label="Existing question" className="min-h-11 w-full rounded-xl border bg-background px-3" value={comparisonIndex} onChange={e=>setComparisonIndex(Number(e.target.value))}>{matches[index].map((m,n)=><option key={m.entityId} value={n}>Existing question {n+1}</option>)}</select>}
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {[{title:'Existing question',payload:matches[index]?.[comparisonIndex]?.payload},{title:'New question',payload:draft}].map(item=><article key={item.title} className="min-w-0 space-y-3 rounded-xl border p-4"><h3 className="font-bold">{item.title}</h3><p dir="auto" className="whitespace-pre-wrap break-words">{item.payload?.stem}</p><ol className="space-y-2">{item.payload?.options.map((option,n)=><li key={n} dir="auto" className={`break-words rounded-lg p-2 ${item.payload?.answer===n?'bg-emerald-500/15':'bg-muted'}`}>{optionLabel(n)}. {option}{item.payload?.answer===n?' ✓':''}</li>)}</ol><p dir="auto" className="whitespace-pre-wrap break-words text-sm">{item.payload?.explanation}</p><p dir="auto" className="break-words text-xs text-muted-foreground">{item.payload?.sourceReference}</p></article>)}
          </div>
          {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <button disabled={checking||busy} className="q-button min-h-11 bg-primary text-primary-foreground" onClick={()=>keepBoth()}>Keep both</button>
            <button disabled={checking||busy} className="q-button min-h-11 border" onClick={()=>excludeQuestion(index)}>Delete new</button>
            <button disabled={checking||busy} className="q-button min-h-11 border" onClick={()=>{setComparison(false);setDirty(current=>[...new Set([...current,index])]);}}>Edit new</button>
            {matches[index]?.[comparisonIndex]?.canDelete && <button disabled={checking||busy} className="q-button min-h-11 border text-destructive" onClick={()=>void deleteOld(matches[index][comparisonIndex])}>Delete old</button>}
          </div>
        </DialogContent>
      </Dialog>
      {confirmationDialog}
    </div>
  );
}
