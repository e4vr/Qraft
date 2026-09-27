'use client';
/* oxlint-disable next/no-img-element */
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, FileJson, GraduationCap, Upload, LoaderCircle } from 'lucide-react';
import { duplicateFingerprint, normalizeDuplicateText } from '@/features/duplicates/domain/duplicate-detection';
import { subscribeLive } from '@/lib/realtime-client';
import { api } from '@/lib/api-client';
import {
  parseQuestionImportReport,
  buildQuestionPrompt,
  type SkippedImportedQuestion,
  type QuestionPromptSettings,
} from '@/lib/question-import';
import {
  optionLabel,
  type DuplicateCandidate,
  type QuestionProposal,
  type QuestionProposalPayload,
  type QBankSpecialty,
  type QBankTopic,
} from '@/lib/medguard-types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';

type ImportMatch = DuplicateCandidate & {payload:QuestionProposalPayload;canDelete:boolean;draftIndex?:number};
type ImportChoice = {sourceFingerprint:string;candidateFingerprints:string[]};
const MAX_CHUNK_BYTES = 900_000;
const MAX_CHUNK_QUESTIONS = 25;

function splitImport(
  questions: QuestionProposalPayload[],
  skipped: SkippedImportedQuestion[],
) {
  const encoder = new TextEncoder();
  const chunks: Array<{ questions: QuestionProposalPayload[]; skipped: SkippedImportedQuestion[]; bytes: number }> = [];
  for (const question of questions) {
    const bytes = encoder.encode(JSON.stringify(question)).byteLength + 1;
    if (bytes > MAX_CHUNK_BYTES) throw new Error('One question is too large to upload.');
    let chunk = chunks[chunks.length - 1];
    if (!chunk || chunk.questions.length >= MAX_CHUNK_QUESTIONS || chunk.bytes + bytes > MAX_CHUNK_BYTES) {
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
    const refresh=()=>api<{ suspended: boolean; endsAt: string | null; questionsPerImport:number;importsPerDay:number }>(
      '/platform/json-import-status',
    )
      .then((result) => {
        if (!active) return;
        setLimits({questionsPerImport:result.questionsPerImport,importsPerDay:result.importsPerDay});
        setAccess(
          result.suspended && (!result.endsAt || Date.parse(result.endsAt)>Date.now())
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
      void api<{suspended:boolean;endsAt:string|null}>('/platform/json-import-status',{forceRefresh:true,requestReason:'eligibility-parameters-changed'}).then(result=>setAccess(result.suspended?{status:'suspended',endsAt:result.endsAt}:{status:'allowed'})).catch(()=>setAccess({status:'error',message:'Unable to verify Import access.'}));
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
  async function preview(questions:QuestionProposalPayload[]) {
    const results:ImportMatch[][]=[];
    for(let offset=0;offset<questions.length;offset+=25) {
      const batch=await api<{matches:ImportMatch[][]}>('/platform/import-preview',{method:'POST',body:JSON.stringify({qbankId:bankId,sourceFile,questions:questions.slice(offset,offset+25)})});
      results.push(...batch.matches);
    }
    const seen=new Map<string,number>();
    questions.forEach((payload,i)=>{
      const key=normalizeDuplicateText(payload.stem), previous=seen.get(key);
      if(previous!==undefined) results[i].push({entityId:`draft:${previous}`,entityType:'pending_proposal',candidateFingerprint:duplicateFingerprint(questions[previous]),payload:questions[previous],canDelete:true,draftIndex:previous,classification:'exact',similarity:100,detectedAt:new Date().toISOString(),signals:{stem:100,optionsSet:0,optionsOrdered:0,correctAnswer:0,specialty:0,topic:0}});
      seen.set(key,i);
    });
    return results;
  }
  async function recheck(i:number) {
    if(!dirty.includes(i)) return matches[i]??[];
    setChecking(true);
    try {
      const result=await preview([drafts[i]]);
      const local=drafts.flatMap((payload,n)=>n!==i&&!excluded.includes(n)&&normalizeDuplicateText(payload.stem)===normalizeDuplicateText(drafts[i].stem)?[{entityId:`draft:${n}`,entityType:'pending_proposal' as const,candidateFingerprint:duplicateFingerprint(payload),payload,canDelete:true,draftIndex:n,classification:'exact' as const,similarity:100,detectedAt:new Date().toISOString(),signals:{stem:100,optionsSet:0,optionsOrdered:0,correctAnswer:0,specialty:0,topic:0}}]:[]);
      const found=[...result[0],...local];
      setMatches(current=>current.map((value,n)=>n===i?found:value));
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
    setExcluded(current=>[...new Set([...current,n])]);
    setMatches(current=>current.map(list=>list.filter(m=>m.draftIndex!==n)));
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
      if (!unlimited && file.size > 1500000)
        throw new Error('JSON file must be smaller than 1.5 MB.');
      if (!/\.(json|txt|text)$/i.test(file.name)) throw new Error('اختر ملف JSON أو TXT يحتوي على أسئلة بصيغة JSON.');
      const bytes = await file.arrayBuffer();
      const content = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').trim();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      const report = parseQuestionImportReport(content, '', unlimited ? Number.POSITIVE_INFINITY : limits.questionsPerImport);
      if (!report.questions.length) {
        if (!drafts.length) setSkipped(report.skipped);
        throw new Error('لم يتم العثور على أي سؤال مكتمل وصالح. راجع تقرير الأسئلة المتخطاة أدناه.');
      }
      const findings=await preview(report.questions);
      setMatches(findings);setChoices({});setExcluded([]);setDirty([]);setComparison(false);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON.');
    } finally {
      operation.current = false;
      setReading(false);
    }
  }
  function edit(patch: Partial<QuestionProposalPayload>) {
    if (uploadedChunks.current) return;
    setDirty(current=>[...new Set([...current,index])]);
    setChoices(current=>{const next={...current};delete next[index];return next;});
    setDrafts((current) =>
      current.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  }
  async function submit() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      const checkedMatches=[...matches];
      for(const i of dirty.filter(n=>!excluded.includes(n))) {
        const found=await recheck(i);checkedMatches[i]=found;
        if(found.length){setIndex(i);throw new Error('Review the duplication before saving.');}
      }
      const unresolved=checkedMatches.findIndex((list,i)=>!excluded.includes(i)&&list.length&&!choices[i]);
      if(unresolved>=0){setIndex(unresolved);throw new Error('Choose Save as duplication or View the duplication for this question.');}
      const selected=drafts.filter((_,i)=>!excluded.includes(i));
      const selectedChoices=drafts.flatMap((_,i)=>excluded.includes(i)?[]:[choices[i]]);
      const validated = parseQuestionImportReport({ sourceFile, questions: selected, skipped }, '', unlimited ? Number.POSITIVE_INFINITY : limits.questionsPerImport);
      if (!validated.questions.length) throw new Error('لا يوجد سؤال صالح للإرسال.');
      const chunks = uploadChunks.current ?? splitImport(validated.questions, validated.skipped);
      if(!uploadChunks.current){let offset=0;chunkChoices.current=chunks.map(chunk=>{const list=selectedChoices.slice(offset,offset+chunk.questions.length);offset+=chunk.questions.length;return list;});}
      uploadChunks.current = chunks;
      setUploadTotal(chunks.length);
      if (!batchIds.current.length) batchIds.current = chunks.map((_, chunkIndex) => chunkIndex === 0 ? requestId : crypto.randomUUID());
      for (let chunkIndex = uploadedChunks.current; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        const chunkHash = chunks.length === 1 ? fileHash : [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${fileHash}:${chunkIndex}`)))].map(value => value.toString(16).padStart(2, '0')).join('');
        const chunkName = chunks.length === 1 ? fileName : `${fileName.slice(0, 210)}-part-${chunkIndex + 1}.json`;
        const result = await api<{
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
        'تم إرسال الأسئلة للمراجعة.',
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
        `${e instanceof Error ? e.message : 'تعذر الرفع.'} ${uploadedChunks.current ? `تم حفظ ${uploadedChunks.current} دفعة. اضغط إعادة المحاولة لإكمال البقية دون تكرارها.` : 'بقيت الأسئلة متاحة للتعديل وإعادة المحاولة.'}`,
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
        <h3 className="text-lg font-bold text-destructive">You are suspended</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Import is temporarily unavailable for this account.
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
          <span className="text-base font-bold" dir="auto">ارفع الملف هنا <span dir="ltr">JSON / Text</span></span>
          <span className="text-sm text-muted-foreground" dir="auto">اسحب الملف أو اضغط لاختياره</span>
          <input aria-label="ارفع الملف هنا JSON / Text" type="file" accept="application/json,text/plain,.json,.txt,.text" disabled={busy || reading}
            onDragOver={e => { e.preventDefault(); if (!busy && !reading) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length !== 1) { setError('يرجى رفع ملف واحد في كل مرة.'); return; } void read(e.dataTransfer.files[0]); }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            onChange={e => { void read(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <p className="text-xs text-muted-foreground" dir="auto">{unlimited ? 'JSON أو ملف نصي يحتوي على JSON · الاستيراد الإداري يرفع الأسئلة على دفعات. راجع الأسئلة قبل إرسالها.' : `JSON أو ملف نصي يحتوي على JSON · حتى ${limits.questionsPerImport} سؤال لكل استيراد · ${limits.importsPerDay} مرات يوميًا · حتى 1.5 MB.`}</p>
        {busy && uploadTotal > 0 && <output className="block text-sm">Uploading batch {uploadProgress + 1} of {uploadTotal}…</output>}
        {reading && <output className="block text-sm">Validating file… · جارٍ التحقق من الملف</output>}
        {drafts.length > 0 && <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg bg-muted p-3">
          <p className="min-w-0 flex-1 break-words text-sm">{fileName} · {drafts.length} questions ready for review{skipped.length ? ` · ${skipped.length} skipped` : ''}{repaired ? ' · JSON repaired' : ''}</p>
          <button type="button" disabled={reading || busy} className="q-button min-h-11 border" onClick={() => setOpen(true)}>Resume review · متابعة المراجعة</button>
        </div>}
        {message && <output className="block space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm" dir="rtl">
          <strong className="block text-base text-emerald-700 dark:text-emerald-300">{message}</strong>
          {lastImportCount ? <>
            <span className="block">تم رفع الأسئلة الجديدة وإرسالها إلى فريق المراجعة للتحقق منها قبل إضافتها إلى Q Bank.</span>
            <span className="block">عدم ظهورها مباشرة في البنك أمر طبيعي؛ ستُضاف تلقائيًا بعد اعتماد المراجعين.</span>
          </> : <span className="block">لم تُرسل أسئلة جديدة؛ الأسئلة المطابقة موجودة بالفعل أو قيد المراجعة.</span>}
        </output>}
        {skipped.length > 0 && <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4" dir="rtl">
          <h3 className="font-semibold">لم تتم إضافة {skipped.length} أسئلة بسبب مشاكل في المصدر:</h3>
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
          className={`flex min-h-16 w-full items-center gap-3 p-4 text-start transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${selectedSource === source ? 'bg-primary/5' : 'bg-card'}`} dir="rtl">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{source === 'lecture' ? <GraduationCap className="size-5" /> : <FileJson className="size-5" />}</span>
          <span className="min-w-0 flex-1 text-sm font-semibold leading-6">{source === 'lecture' ? 'ارفع أسئلة مولدة بالذكاء الاصطناعي من المحاضرة (المادة العلمية)' : 'استورد أسئلة بنك الأسئلة بالاستعانة بالذكاء الاصطناعي'}</span>
          <ChevronDown className={`size-5 shrink-0 transition-transform ${selectedSource === source ? 'rotate-180' : ''}`} />
        </button>
      <div id={`${panelId}-${source}`} hidden={selectedSource !== source}>
      {selectedSource === source && <>
      <section className="min-w-0 space-y-4 rounded-xl border bg-card p-3 sm:p-4">
        <div>
          <h3 className="font-semibold">Use AI · إعداد المحتوى</h3>
          <p className="mt-1 text-sm text-muted-foreground" dir="auto">اختر الإعدادات، وانسخ Prompt إلى أداة الذكاء الاصطناعي مع ملفك، ثم ارفع ملف JSON الناتج هنا لمراجعته. لا يتم إرسال ملفك إلى الذكاء الاصطناعي من داخل الموقع.</p>
          <p className="mt-2 text-sm text-muted-foreground" dir="auto">يتضمن Prompt تصنيف كل سؤال إلى تخصص (specialty) وموضوع (topic). يقرأهما الموقع مباشرة من JSON، ويمكنك مراجعتهما وتعديلهما قبل الرفع.</p>
        </div>
        {!lecture && <p className="rounded-lg bg-muted p-3 text-sm" dir="auto">سيطلب Prompt تحويل البنك بدقة، وقراءة النص أو استخدام OCR، وتصحيح الأخطاء الإملائية وفق السياق، وإكمال أربعة خيارات منطقية، وإضافة رقم السؤال والصفحة وشرح الحل.</p>}
        {lecture && <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-semibold">Question type · نوع السؤال
            <select className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" value={settings.kind} onChange={e => setSettings(s => ({ ...s, kind: e.target.value as QuestionPromptSettings['kind'] }))}>
              <option value="clinical">Clinical</option><option value="direct">Direct</option>
            </select>
          </label>
          <label className="min-w-0 text-sm font-semibold">Question length · طول السؤال
            <select className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" value={settings.length} onChange={e => setSettings(s => ({ ...s, length: e.target.value as QuestionPromptSettings['length'] }))}>
              <option value="short">قصير · Short</option><option value="medium">متوسط · Medium</option><option value="long">طويل · Long</option>
            </select>
          </label>
        </div>}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            {lecture && <label className="block text-sm font-semibold">Question count mode
              <select className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" value={settings.countMode} onChange={e => setSettings(s => ({ ...s, countMode: e.target.value as QuestionPromptSettings['countMode'] }))}>
                <option value="fixed">Specific number · عدد محدد</option><option value="per_slide">One question per slide</option>
              </select>
            </label>}
            {(!lecture || settings.countMode === 'fixed') && <label className="block text-sm font-semibold">{lecture ? 'Questions to generate' : 'Questions to extract'} · عدد الأسئلة
              <input type="number" inputMode="numeric" min={1} max={200} step={1} value={countText} onChange={e => setCountText(e.target.value)} aria-invalid={!countValid} className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" />
            </label>}
            <p className="text-xs text-muted-foreground">{unlimited ? 'AI prompt: 1–200 questions at a time. Uploaded JSON files can contain any number of questions.' : '1–200 questions per JSON file.'}</p>
            {!countValid && <p role="alert" className="text-sm text-destructive">اختر عددًا صحيحًا من 1 إلى 200.</p>}
          </div>
          {lecture && <label className="min-w-0 text-sm font-semibold">Options per question · عدد الخيارات
            <input type="number" inputMode="numeric" min={2} max={10} step={1} value={optionsText} onChange={e => setOptionsText(e.target.value)} aria-invalid={!optionsValid} className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3" />
            {!optionsValid && <span role="alert" className="mt-2 block text-sm text-destructive">اختر عددًا صحيحًا من 2 إلى 10.</span>}
          </label>}
        </div>
        <button type="button" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto" disabled={!prompt}
          onClick={async () => { try { await navigator.clipboard.writeText(prompt); setCopiedPrompt(prompt); setCopyError(''); } catch { setCopyError('تعذر النسخ. افتح معاينة Prompt أدناه وانسخ النص يدويًا.'); } }}>
          {copiedPrompt === prompt && prompt ? <Check className="size-5" /> : <Copy className="size-5" />}
          {copiedPrompt === prompt && prompt ? 'تم نسخ Prompt' : 'نسخ تعليمات الذكاء الاصطناعي'}
          <span className="sr-only">Copy AI prompt</span>
        </button>
        {copiedPrompt === prompt && prompt && <output className="block text-sm text-emerald-600" dir="auto">تم النسخ. أرفق المصدر مع التعليمات في أداة AI، ثم ارفع الملف الناتج في المربع بالأعلى.</output>}
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
      <p className="text-xs text-muted-foreground" dir="auto">يمكنك أيضًا رفع JSON جاهز مباشرة. الإعدادات تخص Prompt ولا تعيد كتابة الملف المستورد أو تغيّر إجاباته. راجع الناتج مقابل المصدر قبل الرفع.</p>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!busy) setOpen(o);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogTitle>Import Review</DialogTitle>
          {matches[index]?.length>0&&!excluded.includes(index)&&<span className="w-fit rounded-full bg-amber-500/15 px-3 py-1 text-sm font-semibold text-amber-700 dark:text-amber-300">duplication</span>}
          <p>
            تم اكتشاف {drafts.length} سؤالًا · Question {index + 1} of{' '}
            {drafts.length}
          </p>
          <progress aria-label="Question review progress" max={drafts.length || 1} value={index + 1} className="h-2 w-full accent-primary" />
          {excluded.includes(index)&&<p className="text-sm text-muted-foreground">New question deleted from this import.</p>}
          {draft && (
            <fieldset disabled={busy || uploadProgress > 0} className="min-w-0 space-y-3">
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
              <p className="text-sm font-medium">Answer options · اختر الإجابة الصحيحة</p>
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
                  {k === 'specialty' ? 'Specialty · التخصص' : k === 'topic' ? 'Topic · الموضوع' : k}
                  <textarea
                    dir="auto"
                    className="mt-1 w-full rounded-xl border bg-background p-3"
                    value={draft[k]}
                    onChange={(e) => edit({ [k]: e.target.value })}
                  />
                </label>
              ))}
              <div className="rounded-xl bg-muted p-3 text-sm" dir="auto">
                <span className="font-semibold">Source · المصدر المختصر</span>
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
              {checking?'Checking…':matches[index]?.length&&!excluded.includes(index)?'Save as duplication':'Next'}
            </button>
            {matches[index]?.length>0&&!excluded.includes(index)&&<button disabled={busy||checking} className="q-button col-span-2 min-h-11 border" onClick={()=>{setComparisonIndex(0);setComparison(true);}}>View the duplication</button>}
            <button
              disabled={busy || checking || !rightsConfirmed}
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
            <button disabled={checking||busy||!matches[index]?.[comparisonIndex]?.canDelete} className="q-button min-h-11 border text-destructive" onClick={()=>void deleteOld(matches[index][comparisonIndex])}>Delete old</button>
            <button disabled={checking||busy} className="q-button min-h-11 border" onClick={()=>{setComparison(false);setDirty(current=>[...new Set([...current,index])]);}}>Edit new</button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmationDialog}
    </div>
  );
}
