'use client';

/* oxlint-disable next/no-img-element */

import { ArrowLeft, Check, Clipboard, Copy, FileJson, ImagePlus, Link2, Pencil, Plus, RefreshCw, Save, Search, Settings, Trash2, Unlink, Upload, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { deleteQBankImages, uploadQuestionImage } from '@/lib/cloudflare-client';
import { canManageBank, optionLabel, type AppUser, type CollaborationState, type NoteImage, type QBank, type Question, type QuestionProposal, type QBankVisibility } from '@/lib/medguard-types';
import { cn } from '@/lib/utils';

type Section = 'settings' | 'questions' | 'import';
type QuestionKind = 'direct' | 'clinical';
type QuestionLength = 'short' | 'medium' | 'long';
type CountMode = 'fixed' | 'per_slide';

interface QuestionDraft {
  stem: string;
  options: string[];
  answer: number;
  specialty: string;
  topic: string;
  explanation: string;
  sourceReference: string;
  images: NoteImage[];
}

const emptyDraft = (): QuestionDraft => ({
  stem: '',
  options: ['', '', '', ''],
  answer: 0,
  specialty: 'General',
  topic: 'General',
  explanation: '',
  sourceReference: '',
  images: [],
});

function buildQraftPrompt(kind: QuestionKind, length: QuestionLength, countMode: CountMode, count: number, optionCount: number) {
  const kindText = kind === 'clinical' ? 'clinical case-based questions with a realistic vignette' : 'direct knowledge questions without a clinical vignette';
  const lengthText = length === 'long' ? 'long and detailed' : length === 'short' ? 'short and concise' : 'medium length';
  const countText = countMode === 'per_slide' ? 'Create exactly one question for every slide in the supplied lecture.' : `Create exactly ${count} questions for the supplied lecture.`;
  const optionLabels = Array.from({ length: optionCount }, (_, index) => optionLabel(index));
  const optionExample = optionLabels.map((label) => `"Option ${label}"`).join(', ');
  return `You are creating medical multiple-choice questions for Qraft.\n\n${countText}\nEach question must be ${lengthText} and use ${kindText}. Use only information found in the supplied lecture. Do not invent facts or sources.\n\nReturn one valid JSON object only. Do not use Markdown or add commentary. Use this exact schema:\n{\n  "format": "qraft-question-bank-v1",\n  "questions": [\n    {\n      "stem": "Question text",\n      "options": [${optionExample}],\n      "correctAnswer": "A",\n      "specialty": "Specialty name",\n      "topic": "Topic name",\n      "explanation": "Why the correct answer is correct",\n      "sourceReference": "Lecture title and slide number",\n      "images": []\n    }\n  ]\n}\n\nRules:\n- Every question must have exactly ${optionCount} distinct, non-empty options.\n- correctAnswer must be one of: ${optionLabels.join(', ')}.\n- Include a useful explanation and an exact slide reference.\n- Keep images as an empty array unless a stable image URL and caption are available.\n- Escape JSON characters correctly and make sure the file parses without errors.`;
}

function normalizeImportedQuestion(value: unknown, index: number): QuestionDraft {
  if (!value || typeof value !== 'object') throw new Error(`Question ${index + 1} is not an object.`);
  const item = value as Record<string, unknown>;
  const options = Array.isArray(item.options) ? item.options.map(String) : [];
  const rawAnswer = item.correctAnswer ?? item.answer;
  const answer = typeof rawAnswer === 'number' ? rawAnswer : Array.from({ length: options.length }, (_, optionIndex) => optionLabel(optionIndex)).indexOf(String(rawAnswer).trim().toUpperCase());
  if (typeof item.stem !== 'string' || !item.stem.trim()) throw new Error(`Question ${index + 1} has no stem.`);
  if (options.length < 2 || options.length > 10 || options.some((option) => !option.trim())) throw new Error(`Question ${index + 1} must have between 2 and 10 options.`);
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) throw new Error(`Question ${index + 1} has an invalid correctAnswer.`);
  if (typeof item.explanation !== 'string' || !item.explanation.trim()) throw new Error(`Question ${index + 1} requires an explanation.`);
  if (typeof item.sourceReference !== 'string' || !item.sourceReference.trim()) throw new Error(`Question ${index + 1} requires a sourceReference.`);
  const images = Array.isArray(item.images)
    ? item.images.flatMap((image, imageIndex) => {
        if (!image || typeof image !== 'object') return [];
        const source = image as Record<string, unknown>;
        if (typeof source.url !== 'string') return [];
        return [
          {
            id: crypto.randomUUID(),
            url: source.url,
            name: typeof source.name === 'string' ? source.name : `Imported image ${imageIndex + 1}`,
            caption: typeof source.caption === 'string' ? source.caption : '',
          },
        ];
      })
    : [];
  return {
    stem: item.stem.trim(),
    options: options.map((option) => option.trim()),
    answer,
    specialty: typeof item.specialty === 'string' && item.specialty.trim() ? item.specialty.trim() : 'General',
    topic: typeof item.topic === 'string' && item.topic.trim() ? item.topic.trim() : 'General',
    explanation: item.explanation.trim(),
    sourceReference: item.sourceReference.trim(),
    images,
  };
}

export function QBankManagement({
  user,
  bankId,
  initialSection,
  collaboration,
  questions,
  update,
  onBack,
  onDeleted,
}: {
  user: AppUser;
  bankId: string;
  initialSection: Section;
  collaboration: CollaborationState;
  questions: Question[];
  update: (updater: (current: CollaborationState) => CollaborationState) => void;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const bank = collaboration.qbanks.find((item) => item.id === bankId);
  const [section, setSection] = useState<Section>(initialSection);
  const [name, setName] = useState(bank?.name ?? '');
  const [shortName, setShortName] = useState(bank?.shortName ?? '');
  const [description, setDescription] = useState(bank?.description ?? '');
  const [visibility, setVisibility] = useState<QBankVisibility>(bank?.visibility ?? 'private');
  const [essential, setEssential] = useState(bank?.essential ?? false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Question | 'new'>();
  const [draft, setDraft] = useState<QuestionDraft>(emptyDraft);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [kind, setKind] = useState<QuestionKind>('clinical');
  const [length, setLength] = useState<QuestionLength>('medium');
  const [countMode, setCountMode] = useState<CountMode>('fixed');
  const [questionCount, setQuestionCount] = useState(20);
  const [optionCount, setOptionCount] = useState(4);
  const prompt = buildQraftPrompt(kind, length, countMode, questionCount, optionCount);
  const members = collaboration.memberships.filter((item) => item.qbankId === bankId);
  const filteredQuestions = useMemo(() => questions.filter((question) => `${question.questionId} ${question.stem} ${question.topic}`.toLowerCase().includes(search.trim().toLowerCase())), [questions, search]);

  if (!bank || !canManageBank(user, bank))
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="text-center">
          <h1 className="text-xl font-bold">QBank management is unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">Only the Bank Owner, or Superadmin for an Essential QBank, can manage this workspace.</p>
          <button onClick={onBack} className="mt-5 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">
            Return to My QBanks
          </button>
        </div>
      </main>
    );
  const bankName = bank.name;

  function updateBank(updater: (current: QBank) => QBank) {
    update((current) => ({
      ...current,
      qbanks: current.qbanks.map((item) => (item.id === bankId ? updater(item) : item)),
    }));
  }

  function saveProperties(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    updateBank((current) => ({
      ...current,
      name: name.trim(),
      shortName: (shortName.trim() || name.trim()).slice(0, 18).toUpperCase(),
      description: description.trim(),
      visibility,
      essential: user.role === 'super_admin' ? essential : current.essential,
    }));
    setMessage('QBank properties saved.');
  }

  function rotateLink() {
    updateBank((current) => ({
      ...current,
      shareEnabled: true,
      shareToken: crypto.randomUUID(),
    }));
    setMessage('A new access link has been created. The previous link no longer works.');
  }

  function removeMember(memberId: string) {
    const member = collaboration.memberships.find((item) => item.id === memberId);
    update((current) => ({
      ...current,
      memberships: current.memberships.filter((item) => item.id !== memberId),
      qbanks: current.qbanks.map((item) =>
        item.id === bankId && member
          ? {
              ...item,
              reviewerIds: item.reviewerIds.filter((id) => id !== member.userId),
              viewerIds: item.viewerIds.filter((id) => id !== member.userId),
            }
          : item,
      ),
    }));
  }

  async function deleteBank() {
    setBusy(true);
    setError('');
    try {
      await deleteQBankImages(bankId);
      update((current) => ({
        ...current,
        qbanks: current.qbanks.filter((item) => item.id !== bankId),
        memberships: current.memberships.filter((item) => item.qbankId !== bankId),
        invitations: current.invitations.filter((item) => item.qbankId !== bankId),
        proposals: current.proposals.filter((item) => item.qbankId !== bankId),
        approvedQuestions: current.approvedQuestions.filter((item) => item.qbankId !== bankId),
        answerStats: Object.fromEntries(Object.entries(current.answerStats).filter(([, item]) => item.qbankId !== bankId)),
        sharedNotes: Object.fromEntries(Object.entries(current.sharedNotes).filter(([, item]) => item.qbankId !== bankId)),
        auditLog: [
          {
            id: crypto.randomUUID(),
            action: 'qbank_deleted',
            entityType: 'qbank',
            entityId: bankId,
            actorId: user.uid,
            actorName: user.displayName,
            createdAt: new Date().toISOString(),
            detail: `Deleted QBank ${bankName}.`,
          },
          ...current.auditLog,
        ],
      }));
      onDeleted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to delete this QBank.');
      setDeleteOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function openQuestion(question?: Question) {
    setEditing(question ?? 'new');
    setDraft(
      question
        ? {
            stem: question.stem,
            options: [...question.options],
            answer: question.answer,
            specialty: question.specialty,
            topic: question.topic,
            explanation: question.explanation ?? '',
            sourceReference: question.sourceReference ?? question.sourceFile,
            images: [...(question.images ?? [])],
          }
        : emptyDraft(),
    );
    setImageFiles([]);
    setError('');
    setMessage('');
  }

  async function uploadImages(questionId: string) {
    return Promise.all(
      imageFiles.slice(0, 5).map(async (file) => {
        if (!file.type.startsWith('image/')) throw new Error('Only image files are supported.');
        if (file.size > 10 * 1024 * 1024) throw new Error('Each image must be smaller than 10 MB.');
        const url = await uploadQuestionImage(user.uid, file, bankId, questionId);
        return { id: crypto.randomUUID(), url, name: file.name, caption: '' };
      }),
    );
  }

  async function saveQuestion(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !draft.stem.trim() || draft.options.length < 2 || draft.options.length > 10 || draft.answer >= draft.options.length || draft.options.some((item) => !item.trim()) || !draft.explanation.trim() || !draft.sourceReference.trim()) return;
    setBusy(true);
    setError('');
    try {
      const existing = editing === 'new' ? undefined : editing;
      const proposalId = crypto.randomUUID();
      const uploaded = await uploadImages(existing?.questionId ?? `proposal-${proposalId}`);
      const proposedAt = new Date().toISOString();
      const payload = {
        stem: draft.stem.trim(),
        options: draft.options.map((item) => item.trim()),
        answer: draft.answer,
        specialty: draft.specialty.trim() || 'General',
        topic: draft.topic.trim() || 'General',
        explanation: draft.explanation.trim(),
        sourceReference: draft.sourceReference.trim(),
        images: [...draft.images, ...uploaded],
      };
      update((current) => ({
        ...current,
        proposals: [
          {
            id: proposalId,
            qbankId: bankId,
            type: existing ? 'question_edit' : 'new_question',
            editKinds: ['question_text', 'options', 'correct_answer', 'explanation', 'source'],
            questionId: existing?.id,
            currentSnapshot: existing ? {
              stem: existing.stem,
              options: existing.options,
              answer: existing.answer,
              specialty: existing.specialty,
              topic: existing.topic,
              explanation: existing.explanation ?? '',
              sourceReference: existing.sourceReference ?? existing.sourceFile,
              images: existing.images ?? [],
            } : undefined,
            payload,
            rationale: existing ? 'Question update submitted from bank management.' : 'New question submitted from bank management.',
            status: 'pending',
            proposedById: user.uid,
            proposedByName: user.displayName,
            proposedAt,
          },
          ...current.proposals,
        ],
        auditLog: [
          {
            id: crypto.randomUUID(),
            action: existing ? 'question_edit_proposed' : 'new_question_proposed',
            entityType: 'question',
            entityId: existing?.id ?? proposalId,
            actorId: user.uid,
            actorName: user.displayName,
            createdAt: proposedAt,
            detail: `${existing ? 'Submitted an edit for' : 'Submitted'} a question in ${bankName} for review.`,
          },
          ...current.auditLog,
        ],
      }));
      setEditing(undefined);
      setDraft(emptyDraft());
      setImageFiles([]);
      setMessage(existing ? 'Question update submitted for review.' : 'Question submitted for review.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to submit the question for review.');
    } finally {
      setBusy(false);
    }
  }

  async function importJson(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).questions) ? (parsed as { questions: unknown[] }).questions : undefined;
      if (!rows?.length) throw new Error('The JSON file does not contain a questions array.');
      if (rows.length > 200) throw new Error('A single import can contain at most 200 questions.');
      const drafts = rows.map(normalizeImportedQuestion);
      const proposedAt = new Date().toISOString();
      const proposals: QuestionProposal[] = drafts.map((payload) => ({
        id: crypto.randomUUID(),
        qbankId: bankId,
        type: 'new_question' as const,
        editKinds: ['question_text', 'options', 'correct_answer', 'explanation', 'source'],
        payload,
        rationale: 'Imported from Qraft JSON.',
        status: 'pending' as const,
        proposedById: user.uid,
        proposedByName: user.displayName,
        proposedAt,
      }));
      update((current) => ({
        ...current,
        proposals: [...proposals, ...current.proposals],
        auditLog: [
          {
            id: crypto.randomUUID(),
            action: 'questions_json_submitted',
            entityType: 'question',
            entityId: bankId,
            actorId: user.uid,
            actorName: user.displayName,
            createdAt: proposedAt,
            detail: `Submitted ${proposals.length} imported questions from ${bankName} for review.`,
          },
          ...current.auditLog,
        ],
      }));
      setMessage(`${proposals.length} questions submitted for review.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to import this JSON file.');
    } finally {
      setBusy(false);
    }
  }

  const shareUrl = bank.shareEnabled && bank.shareToken && typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}?join_qbank=${encodeURIComponent(bank.id)}&token=${encodeURIComponent(bank.shareToken)}` : '';

  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-card/90 px-4 py-4 backdrop-blur-xl sm:px-7">
        <div className="mx-auto flex max-w-[1180px] items-center gap-3">
          <button onClick={onBack} className="grid size-10 place-items-center rounded-xl border" aria-label="Back to My QBanks">
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">QBank management</p>
            <h1 className="truncate text-lg font-bold">{bank.name}</h1>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">{bank.essential ? 'ESSENTIAL · SUPERADMIN' : 'OWNER'}</span>
        </div>
      </header>
      <div className="mx-auto max-w-[1180px] p-4 sm:p-7">
        <nav className="mb-6 flex gap-2 overflow-x-auto" aria-label="QBank management sections">
          {(
            [
              ['settings', Settings, 'Properties & access'],
              ['questions', Clipboard, 'Questions'],
              ['import', FileJson, 'Use Ai to import'],
            ] as const
          ).map(([id, Icon, label]) => (
            <button key={id} onClick={() => setSection(id)} className={cn('inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-bold', section === id && 'border-primary bg-primary text-primary-foreground')}>
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>
        {message && (
          <output className="mb-5 flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            <Check className="size-4" />
            {message}
          </output>
        )}
        {error && (
          <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}

        {section === 'settings' && (
          <div className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
            <form onSubmit={saveProperties} className="rounded-2xl bg-card p-6 ring-1 ring-border">
              <h2 className="text-lg font-bold">QBank properties</h2>
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">Name</span>
                  <input required value={name} onChange={(event) => setName(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">Short label</span>
                  <input value={shortName} onChange={(event) => setShortName(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">Description</span>
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-24 w-full rounded-xl border bg-card p-3" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">Visibility</span>
                  <select value={visibility} onChange={(event) => setVisibility(event.target.value as QBankVisibility)} className="h-11 w-full rounded-xl border bg-card px-3">
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                {user.role === 'super_admin' && (
                  <label aria-label="Essential QBank" className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/25 dark:bg-amber-500/10">
                    <input type="checkbox" checked={essential} onChange={(event) => setEssential(event.target.checked)} className="mt-1 size-4 accent-amber-600" />
                    <span>
                      <span className="block text-sm font-bold">Essential QBank</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">Only Superadmin can edit or delete this bank. Everyone else submits proposals for reviewer approval.</span>
                    </span>
                  </label>
                )}
                <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">
                  <Save className="size-4" />
                  Save properties
                </button>
              </div>
            </form>
            <div className="space-y-5">
              <section className="rounded-2xl bg-card p-6 ring-1 ring-border">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <Link2 className="size-5 text-primary" />
                  Access link
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Generate a new link at any time. Changing it immediately invalidates the previous link.</p>
                {shareUrl && (
                  <div className="mt-4 flex gap-2">
                    <input readOnly value={shareUrl} className="h-11 min-w-0 flex-1 rounded-xl border bg-muted/30 px-3 text-sm" />
                    <button onClick={() => void navigator.clipboard.writeText(shareUrl)} className="grid size-11 place-items-center rounded-xl border" aria-label="Copy access link">
                      <Copy className="size-4" />
                    </button>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={rotateLink} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">
                    <RefreshCw className="size-4" />
                    {shareUrl ? 'Change link' : 'Create link'}
                  </button>
                  {bank.shareEnabled && (
                    <button
                      onClick={() =>
                        updateBank((current) => ({
                          ...current,
                          shareEnabled: false,
                        }))
                      }
                      className="inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-bold"
                    >
                      <Unlink className="size-4" />
                      Disable link
                    </button>
                  )}
                </div>
              </section>
              <section className="rounded-2xl border border-red-200 bg-red-50/60 p-6 dark:border-red-500/25 dark:bg-red-500/5">
                <h2 className="font-bold text-red-700 dark:text-red-300">Delete QBank</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Deletes the bank, its questions, invitations, access grants, statistics, and shared notes. Question IDs are never reused.</p>
                <button onClick={() => setDeleteOpen(true)} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white">
                  <Trash2 className="size-4" />
                  Delete QBank
                </button>
              </section>
            </div>
            <section className="rounded-2xl bg-card p-6 ring-1 ring-border lg:col-span-2">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Users className="size-5 text-primary" />
                Granted access
              </h2>
              {members.length ? (
                <div className="mt-4 divide-y rounded-xl border">
                  {members.map((member) => (
                    <div key={member.id} className="flex items-center gap-3 p-4">
                      <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-sm font-bold text-primary">{member.userName.slice(0, 2).toUpperCase()}</div>
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-sm">{member.userName}</strong>
                        <span className="text-xs uppercase text-muted-foreground">{member.role}</span>
                      </div>
                      <button onClick={() => removeMember(member.id)} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-bold text-red-600 dark:text-red-300">
                        <X className="size-4" />
                        Revoke access
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-xl bg-muted/40 p-5 text-sm text-muted-foreground">No users currently have access to this QBank.</p>
              )}
            </section>
          </div>
        )}

        {section === 'questions' && (
          <>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row">
              <label className="relative flex-1">
                <Search className="absolute left-3 top-3.5 size-4 text-muted-foreground" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by Question ID, topic, or text" className="h-11 w-full rounded-xl border bg-card pl-10 pr-3 text-sm" />
              </label>
              <button onClick={() => openQuestion()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">
                <Plus className="size-4" />
                Add question manually
              </button>
            </div>
            <section className="overflow-x-auto rounded-2xl bg-card ring-1 ring-border">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-[90px_1fr_140px_48px] gap-3 border-b bg-muted/35 px-4 py-3 text-xs font-bold uppercase text-muted-foreground">
                  <span>Question ID</span>
                  <span>Question</span>
                  <span>Topic</span>
                  <span />
                </div>
                {filteredQuestions.length ? (
                  <div className="divide-y">
                    {filteredQuestions.map((question) => (
                      <div key={question.id} className="grid grid-cols-[90px_1fr_140px_48px] items-center gap-3 px-4 py-4">
                        <strong className="font-mono text-sm text-primary">{question.questionId}</strong>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{question.stem}</p>
                          <span className="text-xs text-muted-foreground">
                            Revision {question.revision} · {question.images?.length ?? 0} images
                          </span>
                          {(question.writtenByName || question.reviewedByName) && (
                            <span className="block text-xs text-muted-foreground">
                              Written by {question.writtenByName ?? 'Qraft'} · Reviewed by {question.reviewedByName ?? 'Pending'}
                            </span>
                          )}
                        </div>
                        <span className="truncate text-sm text-muted-foreground">{question.topic}</span>
                        <button onClick={() => openQuestion(question)} className="grid size-9 place-items-center rounded-lg border" aria-label={`Edit Question ID ${question.questionId}`}>
                          <Pencil className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-12 text-center text-sm text-muted-foreground">No questions match your search.</div>
                )}
              </div>
            </section>
          </>
        )}

        {section === 'import' && (
          <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <section className="rounded-2xl bg-card p-6 ring-1 ring-border">
              <h2 className="text-lg font-bold">Build your Qraft prompt</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Choose the format before copying the prompt into your preferred AI tool.</p>
              <div className="mt-5 space-y-5">
                <fieldset>
                  <legend className="text-sm font-bold">Question type</legend>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(
                      [
                        ['clinical', 'Clinical'],
                        ['direct', 'Direct'],
                      ] as const
                    ).map(([id, label]) => (
                      <button type="button" key={id} onClick={() => setKind(id)} className={cn('h-10 rounded-xl border text-sm font-bold', kind === id && 'border-primary bg-primary text-primary-foreground')}>
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="text-sm font-bold">Question length</legend>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(['short', 'medium', 'long'] as const).map((id) => (
                      <button type="button" key={id} onClick={() => setLength(id)} className={cn('h-10 rounded-xl border text-sm font-bold capitalize', length === id && 'border-primary bg-primary text-primary-foreground')}>
                        {id}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="text-sm font-bold">Questions per lecture</legend>
                  <div className="mt-2 space-y-2">
                    <button type="button" onClick={() => setCountMode('fixed')} className={cn('flex h-11 w-full items-center justify-between rounded-xl border px-3 text-sm font-bold', countMode === 'fixed' && 'border-primary bg-primary/5 text-primary')}>
                      <span>Specific number</span>
                      {countMode === 'fixed' && <Check className="size-4" />}
                    </button>
                    {countMode === 'fixed' && <input type="number" min="1" max="200" value={questionCount} onChange={(event) => setQuestionCount(Math.max(1, Math.min(200, Number(event.target.value))))} className="h-11 w-full rounded-xl border bg-card px-3" />}
                    <button type="button" onClick={() => setCountMode('per_slide')} className={cn('flex h-11 w-full items-center justify-between rounded-xl border px-3 text-sm font-bold', countMode === 'per_slide' && 'border-primary bg-primary/5 text-primary')}>
                      <span>One question per slide</span>
                      {countMode === 'per_slide' && <Check className="size-4" />}
                    </button>
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="text-sm font-bold">Options per question</legend>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose how many answer choices the generated JSON must include.</p>
                  <input
                    aria-label="Options per question"
                    type="number"
                    min="2"
                    max="10"
                    value={optionCount}
                    onChange={(event) => setOptionCount(Math.max(2, Math.min(10, Number(event.target.value) || 2)))}
                    className="mt-2 h-11 w-full rounded-xl border bg-card px-3"
                  />
                </fieldset>
              </div>
            </section>
            <section className="rounded-2xl bg-card p-6 ring-1 ring-border">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Generated prompt</h2>
                  <p className="mt-1 text-sm text-muted-foreground">The output schema is validated before import.</p>
                </div>
                <button onClick={() => void navigator.clipboard.writeText(prompt).then(() => setMessage('Prompt copied.'))} className="inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-bold">
                  <Copy className="size-4" />
                  Copy prompt
                </button>
              </div>
              <textarea readOnly value={prompt} className="mt-4 min-h-[390px] w-full rounded-xl border bg-muted/25 p-4 font-mono text-xs leading-6" />
              <label className={cn('mt-4 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center', busy && 'pointer-events-none opacity-50')}>
                <Upload className="size-6 text-primary" />
                <strong className="mt-2 text-sm">Upload file here ( Json/Text )</strong>
                <span className="mt-1 text-xs text-muted-foreground">Maximum 200 questions per file</span>
                <input type="file" accept="application/json,.json" className="sr-only" onChange={(event) => void importJson(event.target.files?.[0])} />
              </label>
            </section>
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm">
          <form onSubmit={(event) => void saveQuestion(event)} className="mx-auto my-6 w-full max-w-4xl rounded-2xl bg-card p-5 shadow-2xl ring-1 ring-border sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-primary">{editing === 'new' ? 'New question' : `Question ID ${editing.questionId}`}</p>
                <h2 className="mt-1 text-xl font-bold">{editing === 'new' ? 'Add question manually' : 'Edit question'}</h2>
              </div>
              <button type="button" onClick={() => setEditing(undefined)} className="grid size-10 place-items-center rounded-xl border" aria-label="Close question editor">
                <X className="size-5" />
              </button>
            </div>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-sm font-bold">Question text</span>
              <textarea required value={draft.stem} onChange={(event) => setDraft({ ...draft, stem: event.target.value })} className="min-h-32 w-full rounded-xl border bg-card p-3" />
            </label>
            <div className="mt-4 space-y-2">
              {draft.options.map((option, index) => (
                <div key={index} className="flex items-center gap-3">
                  <input aria-label={`Mark option ${optionLabel(index)} as correct`} type="radio" name="correct-answer" checked={draft.answer === index} onChange={() => setDraft({ ...draft, answer: index })} className="size-4 accent-primary" />
                  <span className="grid size-8 place-items-center rounded-full bg-muted text-sm font-bold">{optionLabel(index)}</span>
                  <input
                    required
                    value={option}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        options: draft.options.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                      })
                    }
                    className="h-11 flex-1 rounded-xl border bg-card px-3"
                  />
                  <button
                    type="button"
                    aria-label={`Remove option ${optionLabel(index)}`}
                    disabled={draft.options.length <= 2}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        options: draft.options.filter((_, itemIndex) => itemIndex !== index),
                        answer: draft.answer === index ? 0 : draft.answer > index ? draft.answer - 1 : draft.answer,
                      })
                    }
                    className="grid size-10 shrink-0 place-items-center rounded-xl border text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:text-red-300"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={draft.options.length >= 10}
                onClick={() => setDraft({ ...draft, options: [...draft.options, ''] })}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-dashed px-4 text-sm font-bold text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="size-4" />
                Add option
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-1.5 block text-sm font-bold">Specialty</span>
                <input value={draft.specialty} onChange={(event) => setDraft({ ...draft, specialty: event.target.value })} className="h-11 w-full rounded-xl border bg-card px-3" />
              </label>
              <label>
                <span className="mb-1.5 block text-sm font-bold">Topic</span>
                <input value={draft.topic} onChange={(event) => setDraft({ ...draft, topic: event.target.value })} className="h-11 w-full rounded-xl border bg-card px-3" />
              </label>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-1.5 block text-sm font-bold">Explanation</span>
                <textarea required value={draft.explanation} onChange={(event) => setDraft({ ...draft, explanation: event.target.value })} className="min-h-28 w-full rounded-xl border bg-card p-3" />
              </label>
              <label>
                <span className="mb-1.5 block text-sm font-bold">Source</span>
                <textarea required value={draft.sourceReference} onChange={(event) => setDraft({ ...draft, sourceReference: event.target.value })} className="min-h-28 w-full rounded-xl border bg-card p-3" />
              </label>
            </div>
            <section className="mt-5 rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold">Question images</h3>
                  <p className="text-xs text-muted-foreground">Up to 5 new images, 10 MB each.</p>
                </div>
                <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-4 text-sm font-bold">
                  <ImagePlus className="size-4" />
                  Add images
                  <input type="file" accept="image/*" multiple className="sr-only" onChange={(event) => setImageFiles(Array.from(event.target.files ?? []).slice(0, 5))} />
                </label>
              </div>
              {draft.images.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {draft.images.map((image) => (
                    <figure key={image.id} className="overflow-hidden rounded-xl border">
                      <img src={image.url} alt={image.caption || image.name} className="aspect-video w-full object-contain" />
                      <div className="flex items-center gap-2 p-2">
                        <input
                          value={image.caption}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              images: draft.images.map((item) => (item.id === image.id ? { ...item, caption: event.target.value } : item)),
                            })
                          }
                          placeholder="Caption"
                          className="h-9 min-w-0 flex-1 rounded-lg border bg-card px-2 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              images: draft.images.filter((item) => item.id !== image.id),
                            })
                          }
                          className="grid size-9 place-items-center rounded-lg border text-red-600 dark:text-red-300"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </figure>
                  ))}
                </div>
              )}
              {imageFiles.length > 0 && (
                <p className="mt-3 text-sm text-primary">
                  {imageFiles.length} new image
                  {imageFiles.length === 1 ? '' : 's'} ready to upload.
                </p>
              )}
            </section>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(undefined)} className="h-11 rounded-xl border px-5 text-sm font-bold">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {busy ? <RefreshCw className="size-4 animate-spin" /> : <Save className="size-4" />}
                Submit for review
              </button>
            </div>
          </form>
        </div>
      )}
      {deleteOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-bank-title" className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl">
            <h2 id="delete-bank-title" className="text-xl font-bold">
              Delete {bank.name}?
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">This action cannot be undone. Existing Question IDs will remain reserved and will never be assigned again.</p>
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button onClick={() => setDeleteOpen(false)} className="h-11 rounded-xl border text-sm font-bold">
                Cancel
              </button>
              <button disabled={busy} onClick={() => void deleteBank()} className="h-11 rounded-xl bg-red-600 text-sm font-bold text-white disabled:opacity-50">
                Delete permanently
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
