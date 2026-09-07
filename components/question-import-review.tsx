'use client';
/* oxlint-disable next/no-img-element */
import { useId, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, FileJson, GraduationCap, Upload, LoaderCircle } from 'lucide-react';
import { api } from '@/lib/cloudflare-client';
import {
  parseQuestionImportReport,
  buildQuestionPrompt,
  type SkippedImportedQuestion,
  type QuestionPromptSettings,
} from '@/lib/question-import';
import {
  optionLabel,
  type QuestionProposal,
  type QuestionProposalPayload,
} from '@/lib/medguard-types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
export function QuestionImportReview({
  bankId,
  onImported,
}: {
  bankId: string;
  onImported: (proposals: QuestionProposal[]) => void;
}) {
  const [drafts, setDrafts] = useState<QuestionProposalPayload[]>([]),
    [index, setIndex] = useState(0),
    [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileHash, setFileHash] = useState('');
  const [sourceFile, setSourceFile] = useState('');
  const [skipped, setSkipped] = useState<SkippedImportedQuestion[]>([]);
  const [repaired, setRepaired] = useState(false);
  const operation = useRef(false);
  const panelId = useId();
  const [selectedSource, setSelectedSource] = useState<QuestionPromptSettings['source'] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState('');
  const [copyError, setCopyError] = useState('');
  const [settings, setSettings] = useState<QuestionPromptSettings>({
    source: 'qbank', kind: 'clinical', length: 'medium', countMode: 'fixed', count: 20, optionCount: 4,
  });
  const [countText, setCountText] = useState('20');
  const [optionsText, setOptionsText] = useState('4');
  const lecture = settings.source === 'lecture';
  const countValid = (lecture && settings.countMode === 'per_slide') ||
    (countText.trim() !== '' && Number.isInteger(Number(countText)) && Number(countText) >= 1 && Number(countText) <= 200);
  const optionsValid = !lecture || (optionsText.trim() !== '' && Number.isInteger(Number(optionsText)) && Number(optionsText) >= 2 && Number(optionsText) <= 10);
  const prompt = countValid && optionsValid ? buildQuestionPrompt({
    ...settings, count: lecture && settings.countMode === 'per_slide' ? 20 : Number(countText), optionCount: Number(optionsText),
  }) : '';
  const draft = drafts[index];
  async function read(file?: File) {
    if (!file || operation.current) return;
    if (drafts.length && !window.confirm('Replace the current import draft with another file? Your review edits will be replaced only if the new file is valid.')) return;
    operation.current = true;
    setReading(true);
    setError('');
    setMessage('');
    if (!drafts.length) setSkipped([]);
    try {
      if (file.size > 1500000)
        throw new Error('JSON file must be smaller than 1.5 MB.');
      if (!/\.(json|txt|text)$/i.test(file.name)) throw new Error('اختر ملف JSON أو TXT يحتوي على أسئلة بصيغة JSON.');
      const bytes = await file.arrayBuffer();
      const content = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').trim();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      const report = parseQuestionImportReport(content);
      if (!report.questions.length) {
        if (!drafts.length) setSkipped(report.skipped);
        throw new Error('لم يتم العثور على أي سؤال مكتمل وصالح. راجع تقرير الأسئلة المتخطاة أدناه.');
      }
      setSkipped(report.skipped);
      setDrafts(report.questions);
      setFileName(file.name);
      setFileHash(hash);
      setSourceFile(report.sourceFile);
      setRepaired(report.repaired);
      setIndex(0);
      setOpen(true);
      setMessage('');
      setRequestId(crypto.randomUUID());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON.');
    } finally {
      operation.current = false;
      setReading(false);
    }
  }
  function edit(patch: Partial<QuestionProposalPayload>) {
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
      const validated = parseQuestionImportReport({ sourceFile, questions: drafts, skipped });
      if (!validated.questions.length) throw new Error('لا يوجد سؤال صالح للإرسال.');
      const result = await api<{
        proposals: QuestionProposal[];
        total: number;
        successful: number;
        failed: number;
        skipped: SkippedImportedQuestion[];
        repaired: boolean;
      }>('/platform/import', {
        method: 'POST',
        body: JSON.stringify({
          questions: validated.questions,
          skipped: validated.skipped,
          sourceFile: validated.sourceFile,
          repaired: repaired || validated.repaired,
          fileName,
          fileHash,
          qbankId: bankId,
          requestId,
        }),
      });
      onImported(result.proposals);
      setSkipped(result.skipped);
      setMessage(`تم استلام ${result.successful} سؤالًا بنجاح 🎉`);
      setOpen(false);
      setDrafts([]);
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : 'تعذر الرفع.'} بقيت الأسئلة متاحة للتعديل وإعادة المحاولة، ولم يُحفظ جزء غير مكتمل من الدفعة.`,
      );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
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
        <p className="text-xs text-muted-foreground" dir="auto">JSON أو ملف نصي يحتوي على JSON · من 1 إلى 200 سؤال · حتى 1.5 MB. راجع الأسئلة قبل إرسالها.</p>
        {reading && <output className="block text-sm">Validating file… · جارٍ التحقق من الملف</output>}
        {drafts.length > 0 && <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg bg-muted p-3">
          <p className="min-w-0 flex-1 break-words text-sm">{fileName} · {drafts.length} questions ready for review{skipped.length ? ` · ${skipped.length} skipped` : ''}{repaired ? ' · JSON repaired' : ''}</p>
          <button type="button" disabled={reading || busy} className="q-button min-h-11 border" onClick={() => setOpen(true)}>Resume review · متابعة المراجعة</button>
        </div>}
        {message && <output className="block space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm" dir="rtl">
          <strong className="block text-base text-emerald-700 dark:text-emerald-300">{message}</strong>
          <span className="block">تم رفع الأسئلة وإرسالها إلى فريق المراجعة للتحقق منها قبل إضافتها إلى Q Bank.</span>
          <span className="block">عدم ظهورها مباشرة في البنك أمر طبيعي. لا تحتاج إلى رفع الملف مرة أخرى؛ ستُضاف تلقائيًا بعد اعتماد المراجعين.</span>
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
        {!lecture && <p className="rounded-lg bg-muted p-3 text-sm" dir="auto">سيطلب Prompt نقل الأسئلة والخيارات بالترتيب الأصلي دون تخمين. أي سؤال ناقص أو غير مقروء سيُتجاوز وحده مع تسجيل السبب، بينما تستمر معالجة بقية الملف. يدعم اختلاف ترقيم الأسئلة وصفحات PDF الممسوحة والمحتوى المختلط قدر الإمكان.</p>}
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
            <p className="text-xs text-muted-foreground">1–200 questions per JSON file.</p>
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
          <p>
            تم اكتشاف {drafts.length} سؤالًا · Question {index + 1} of{' '}
            {drafts.length}
          </p>
          <progress aria-label="Question review progress" max={drafts.length || 1} value={index + 1} className="h-2 w-full accent-primary" />
          {draft && (
            <fieldset disabled={busy} className="min-w-0 space-y-3">
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
          <p className="text-xs text-muted-foreground">
            Skip Review يتجاوز المراجعة فقط. سيتم رفع جميع الأسئلة دون تجاهل أي
            سؤال.
          </p>
          <div className="grid grid-cols-2 gap-2 border-t pt-3">
            <button
              disabled={busy || index === 0}
              className="q-button min-h-11 border"
              onClick={() => setIndex(index - 1)}
            >
              Previous
            </button>
            {index < drafts.length - 1 ? (
              <button
                disabled={busy}
                className="q-button min-h-11 border"
                onClick={() => setIndex(index + 1)}
              >
                Next
              </button>
            ) : <span className="self-center text-center text-sm text-muted-foreground">Last question</span>}
            <button
              disabled={busy}
              className="q-button col-span-2 min-h-11 whitespace-normal bg-primary text-primary-foreground"
              onClick={() => void submit()}
            >
              {busy ? 'Uploading…' : index < drafts.length - 1 ? `Skip Review & submit all ${drafts.length} questions` : `Submit all ${drafts.length} questions for review`}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
