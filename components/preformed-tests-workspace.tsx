'use client';
import { FormattedQuestionText } from '@/components/formatted-question-text';

/* oxlint-disable next/no-img-element */

import { ApiError, api } from '@/lib/api-client';
import { ExplanationImageEditor } from '@/components/explanation-image-editor';
import { ExplanationImages } from '@/components/explanation-images';
import { WorkspaceHeader } from '@/components/workspace-header';
import { QuestionNavigator } from '@/components/exams/question-navigator';
import {
  uploadQuestionImage,
} from '@/lib/application-services';
import {
  loadPreformedAttempt,
  loadPreformedAttemptByCode,
  savePreformedAttempt,
} from '@/lib/local-db';
import { preformedAccountScope } from '@/features/exams/domain/preformed-attempt-scope';
import { preformedGuestScope } from '@/features/exams/client/guest-scope';
import type { AppUser } from '@/lib/medguard-types';
import { getPlanLimits } from '@/features/subscriptions/domain/plan-config';
import {
  buildQuestionPrompt,
  parseQuestionImportReport,
  type QuestionPromptSettings,
} from '@/lib/question-import';
import { subscribeLive } from '@/lib/realtime-client';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';
import type {
  PreformedLeaderboardEntry,
  PreformedLocalAttempt,
  PreformedQuestion,
  PreformedTestDocument,
  PreformedTestSummary,
} from '@/lib/preformed-test-types';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Eye,
  FileJson,
  Flag,
  Globe2,
  GraduationCap,
  ImagePlus,
  LockKeyhole,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldAlert,
  Trash2,
  Trophy,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const inputClass =
  'h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-3 focus:ring-primary/10';
const areaClass =
  'w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-3 focus:ring-primary/10';
const panelClass = 'rounded-3xl border bg-card shadow-sm';

function randomOrder(length: number) {
  const values = Array.from({ length }, (_, index) => index);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function emptyQuestion(): PreformedQuestion {
  return {
    id: crypto.randomUUID(),
    stem: '',
    options: ['', '', '', ''],
    answer: 0,
    explanation: '',
    explanationImages: [],
    sourceReference: '',
    images: [],
  };
}

function questionValidationMessage(question: PreformedQuestion) {
  if ((question.explanationImages?.length ?? 0) > 5) return 'Keep at most five explanation images per question.';
  if (!question.stem.trim()) return 'Write the question before saving it.';
  if (question.options.length < 2) return 'Add at least two answer options.';
  const emptyOption = question.options.findIndex((option) => !option.trim());
  if (emptyOption >= 0)
    return `Complete answer option ${String.fromCharCode(65 + emptyOption)} before saving.`;
  if (
    !Number.isInteger(question.answer) ||
    question.answer < 0 ||
    question.answer >= question.options.length
  )
    return 'Choose the correct answer before saving.';
  return '';
}

function duration(value: number) {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return [hours, minutes, seconds]
    .map((item) => String(item).padStart(2, '0'))
    .join(':');
}

function testUrl(code: string) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('join_test', code);
  return url.toString();
}

function downloadResults(
  test: Pick<PreformedTestSummary, 'title'>,
  entries: PreformedLeaderboardEntry[],
) {
  const escape = (value: string | number) => {
    const text = String(value);
    const safe = /^[=+\-@\t\r]/.test(text.trimStart()) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows = [
    [
      'Rank',
      'Name',
      'Guest',
      'Score',
      'Questions',
      'Percentage',
      'Duration seconds',
      'Attempt',
      'Submitted at',
    ],
    ...entries.map((entry) => [
      entry.rank,
      entry.participantName,
      entry.guest ? 'Yes' : 'No',
      entry.score,
      entry.questionCount,
      entry.percentage,
      entry.durationSeconds,
      entry.attemptNumber,
      entry.submittedAt,
    ]),
  ];
  const blob = new Blob(
    [rows.map((row) => row.map(escape).join(',')).join('\r\n')],
    { type: 'text/csv;charset=utf-8' },
  );
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `${test.title.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'test'}-results.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

type ManageResponse = {
  test: PreformedTestDocument;
  leaderboard: PreformedLeaderboardEntry[];
};

type LeaderboardResponse = {
  test: PreformedTestSummary;
  leaderboard: PreformedLeaderboardEntry[];
};

function Leaderboard({ entries }: { entries: PreformedLeaderboardEntry[] }) {
  if (!entries.length)
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        No ranked results yet.
      </div>
    );
  return (
    <div className="overflow-hidden rounded-2xl border">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="grid grid-cols-[46px_1fr_auto] items-center gap-3 border-b px-4 py-3 last:border-b-0"
        >
          <span
            className={
              entry.rank <= 3
                ? 'grid size-8 place-items-center rounded-full bg-amber-100 font-black text-amber-700'
                : 'text-center font-bold text-muted-foreground'
            }
          >
            {entry.rank}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{entry.participantName}</p>
            <p className="text-xs text-muted-foreground">
              {entry.guest ? 'Guest' : `Attempt ${entry.attemptNumber}`} ·{' '}
              {duration(entry.durationSeconds)}
            </p>
            <time dateTime={entry.submittedAt} className="mt-1 block text-xs text-muted-foreground">{new Date(entry.submittedAt).toLocaleString()}</time>
          </div>
          <strong className="text-primary">
            {entry.score}/{entry.questionCount}{' '}
            <span className="text-xs text-muted-foreground">
              ({entry.percentage}%)
            </span>
          </strong>
        </div>
      ))}
    </div>
  );
}

function TestEditor({
  user,
  initial,
  onClose,
  onSaved,
}: {
  user: AppUser;
  initial: PreformedTestDocument;
  onClose: () => void;
  onSaved: (test: PreformedTestDocument) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [passcode, setPasscode] = useState<string | undefined>(undefined);
  const [passcodeEnabled, setPasscodeEnabled] = useState(initial.hasPasscode);
  const [selected, setSelected] = useState(0);
  const [requestBusy, setBusy] = useState(false);
  const [explanationImagesBusy, setExplanationImagesBusy] = useState(false);
  const busy = requestBusy || explanationImagesBusy;
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error' | 'info'>(
    'info',
  );
  const [importOpen, setImportOpen] = useState(false);
  const [selectedImportSource, setSelectedImportSource] =
    useState<QuestionPromptSettings['source'] | null>(null);
  const [importDragging, setImportDragging] = useState(false);
  const [importSource, setImportSource] =
    useState<QuestionPromptSettings['source']>('qbank');
  const [importKind, setImportKind] =
    useState<QuestionPromptSettings['kind']>('clinical');
  const [importLength, setImportLength] =
    useState<QuestionPromptSettings['length']>('medium');
  const [importCountMode, setImportCountMode] =
    useState<QuestionPromptSettings['countMode']>('fixed');
  const [importCount, setImportCount] = useState(10);
  const [importOptionCount, setImportOptionCount] = useState(4);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [confirmEditorAction, editorConfirmationDialog] =
    useConfirmationDialog();
  const dirty = JSON.stringify(draft) !== baseline || passcode !== undefined;
  const question = draft.questions[selected];
  const availableImportSlots = Math.max(0, 35 - draft.questions.length);
  const safeImportCount = Math.max(
    1,
    Math.min(importCount, Math.max(1, availableImportSlots)),
  );
  const importPrompt = availableImportSlots
    ? buildQuestionPrompt({
        source: importSource,
        kind: importKind,
        length: importLength,
        countMode: importCountMode,
        count: safeImportCount,
        optionCount: importOptionCount,
      }, availableImportSlots)
    : '';

  const openImport = () => {
    setSelectedImportSource(null);
    setImportDragging(false);
    setCopiedPrompt(false);
    setCopyError('');
    setImportCount((current) =>
      Math.max(1, Math.min(current, Math.max(1, availableImportSlots))),
    );
    setImportOpen(true);
  };

  const copyImportPrompt = async () => {
    try {
      await navigator.clipboard.writeText(importPrompt);
      setCopiedPrompt(true);
      setCopyError('');
    } catch {
      setCopiedPrompt(false);
      setCopyError('Could not copy automatically. Open the preview and copy it manually.');
    }
  };

  const close = async () => {
    if (busy) return;
    if (
      !dirty ||
      (await confirmEditorAction({
        title: 'Discard unsaved changes?',
        description:
          'Your changes to this ready-made test have not been saved and will be lost.',
        confirmLabel: 'Discard changes',
        tone: 'warning',
      }))
    )
      onClose();
  };
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);

  const updateQuestion = (patch: Partial<PreformedQuestion>) => {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((item, index) =>
        index === selected ? { ...item, ...patch } : item,
      ),
    }));
  };
  const appendQuestion = () => {
    if (draft.questions.length >= 35) return false;
    setDraft((current) => ({
      ...current,
      questions: [...current.questions, emptyQuestion()],
    }));
    setSelected(draft.questions.length);
    setMessage(
      'New question started. Complete it, then save or save and continue.',
    );
    setMessageKind('info');
    return true;
  };
  const importJson = async (file?: File) => {
    if (!file) return;
    setMessage('');
    try {
      if (file.size > 1_500_000)
        throw new Error('JSON file must be smaller than 1.5 MB.');
      if (!/\.(json|txt|text)$/i.test(file.name))
        throw new Error('Choose a JSON or TXT file containing questions in JSON format.');
      const report = parseQuestionImportReport(await file.text(), file.name);
      const available = 35 - draft.questions.length;
      const notAdded = Math.max(0, report.questions.length - available);
      const imported = report.questions.slice(0, available).map((item) => ({
        id: crypto.randomUUID(),
        stem: item.stem,
        options: item.options,
        answer: item.answer,
        explanation: item.explanation,
        explanationImages: item.explanationImages ?? [],
        sourceReference: item.sourceReference,
        images: item.images,
      }));
      setDraft((current) => ({
        ...current,
        questions: [...current.questions, ...imported],
      }));
      setMessageKind('success');
      setMessage(
        `${imported.length} question${imported.length === 1 ? '' : 's'} imported${notAdded ? `; ${notAdded} not added because this test is limited to 35 questions` : ''}${report.skipped.length ? `; ${report.skipped.length} skipped` : ''}.`,
      );
    } catch (error) {
      setMessageKind('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not import this JSON file.',
      );
    }
  };
  const uploadImage = async (file?: File) => {
    if (!file || !question) return;
    setBusy(true);
    setMessage('');
    try {
      const url = await uploadQuestionImage(
        user.uid,
        file,
        `preformed-${draft.id}`,
        question.id,
      );
      updateQuestion({
        images: [
          ...question.images,
          { id: crypto.randomUUID(), url, name: file.name, caption: '' },
        ],
      });
    } catch (error) {
      setMessageKind('error');
      setMessage(
        error instanceof Error ? error.message : 'Image upload failed.',
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async (
    nextDraft: PreformedTestDocument = draft,
    successMessage = 'Test saved.',
  ) => {
    if (explanationImagesBusy) return undefined;
    if (!nextDraft.title.trim()) {
      setMessageKind('error');
      setMessage('Add a test title before saving.');
      return undefined;
    }
    const invalidQuestion = nextDraft.questions.findIndex(
      (item) => questionValidationMessage(item) !== '',
    );
    if (invalidQuestion >= 0) {
      setSelected(invalidQuestion);
      setMessageKind('error');
      setMessage(
        `Question ${invalidQuestion + 1}: ${questionValidationMessage(nextDraft.questions[invalidQuestion])}`,
      );
      return undefined;
    }
    if (nextDraft.status === 'published' && !nextDraft.questions.length) {
      setMessageKind('error');
      setMessage('Add at least one complete question before publishing.');
      return undefined;
    }
    setBusy(true);
    setMessage('');
    try {
      const payload = await api<{
        test: PreformedTestDocument;
        resultsReset: boolean;
      }>('/preformed/save', {
        method: 'PUT',
        body: JSON.stringify({
          test: nextDraft,
          ...(passcode !== undefined
            ? { passcode: passcodeEnabled ? passcode : '' }
            : {}),
        }),
      });
      setDraft(payload.test);
      setBaseline(JSON.stringify(payload.test));
      setPasscode(undefined);
      setPasscodeEnabled(payload.test.hasPasscode);
      onSaved(payload.test);
      setMessageKind('success');
      setMessage(
        payload.resultsReset
          ? `${successMessage} Previous results were permanently cleared because the questions changed.`
          : successMessage,
      );
      return payload.test;
    } catch (error) {
      setMessageKind('error');
      setMessage(
        error instanceof Error ? error.message : 'Could not save the test.',
      );
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  const saveQuestion = async (advance: boolean) => {
    if (!question) return;
    const issue = questionValidationMessage(question);
    if (issue) {
      setMessageKind('error');
      setMessage(issue);
      return;
    }
    const saved = await save(
      draft,
      advance
        ? 'Question saved. Ready for the next question.'
        : 'Question saved.',
    );
    if (!saved || !advance) return;
    if (selected < saved.questions.length - 1) {
      setSelected(selected + 1);
      return;
    }
    if (saved.questions.length >= 35) {
      setMessageKind('success');
      setMessage(
        'Question saved. This test has reached the 35-question limit.',
      );
      return;
    }
    const next = { ...saved, questions: [...saved.questions, emptyQuestion()] };
    setDraft(next);
    setSelected(saved.questions.length);
  };
  const addQuestion = async () => {
    if (!question) {
      appendQuestion();
      return;
    }
    await saveQuestion(true);
  };
  const publishPublicly = async () => {
    const publicDraft: PreformedTestDocument = {
      ...draft,
      visibility: 'public',
      status: 'published',
    };
    await save(
      publicDraft,
      'Published. The test is now visible in Public Tests.',
    );
  };

  return (
    <div className="q-safe-fullscreen fixed inset-0 z-[80] overflow-y-auto bg-background">
      <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-7">
        <button
          onClick={() => void close()}
          className="grid size-10 place-items-center rounded-xl hover:bg-muted"
          aria-label="Close editor"
          disabled={busy}
        >
          <X className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-bold">Edit ready-made test</h2>
          <p className="text-xs text-muted-foreground">
            Questions are independent from every QBank.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {draft.status !== 'hidden' &&
            !(
              draft.visibility === 'public' && draft.status === 'published'
            ) && (
              <button
                disabled={busy}
                onClick={() => void publishPublicly()}
                className="q-button q-button-secondary"
              >
                <Globe2 className="size-4" />
                <span className="hidden sm:inline">Publish publicly</span>
                <span className="sm:hidden">Publish</span>
              </button>
            )}
          <button
            disabled={busy || !dirty}
            onClick={() => void save()}
            className="q-button q-button-primary"
          >
            <Save className="size-4" />
            {busy ? 'Saving…' : 'Save test'}
          </button>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-5 p-4 sm:p-7 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-5">
          <section className={`${panelClass} p-5`}>
            <h3 className="font-bold">Test details</h3>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-semibold">
                Title
                <input
                  value={draft.title}
                  maxLength={160}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="block text-sm font-semibold">
                Description
                <textarea
                  rows={3}
                  value={draft.description}
                  maxLength={2000}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  className={`${areaClass} mt-1`}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-semibold">
                  Visibility
                  <select
                    value={draft.visibility}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        visibility: e.target.value as 'public' | 'private',
                      })
                    }
                    className={`${inputClass} mt-1`}
                  >
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Status
                  <select
                    value={draft.status === 'hidden' ? 'paused' : draft.status}
                    disabled={draft.status === 'hidden'}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        status: e.target.value as
                          | 'draft'
                          | 'published'
                          | 'paused',
                      })
                    }
                    className={`${inputClass} mt-1`}
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="paused">Paused</option>
                  </select>
                </label>
              </div>
              <p className="rounded-xl bg-muted/70 px-3 py-2 text-xs leading-5 text-muted-foreground">
                Public Tests shows tests that are both <strong>Public</strong>{' '}
                and <strong>Published</strong>. Use “Publish publicly” above to
                apply both in one step.
              </p>
              {draft.status === 'hidden' && (
                <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-200">
                  This test is hidden by a Superadmin.
                </p>
              )}
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={passcodeEnabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setPasscodeEnabled(enabled);
                    setPasscode(enabled && draft.hasPasscode ? undefined : '');
                  }}
                />
                Require an access passcode
              </label>
              {passcodeEnabled && (
                <input
                  type="password"
                  value={passcode ?? ''}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder={
                    initial.hasPasscode
                      ? 'Leave blank only to replace it'
                      : 'Optional access passcode'
                  }
                  className={inputClass}
                />
              )}
            </div>
          </section>
          <section className={`${panelClass} p-5`}>
            <h3 className="font-bold">Experience</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-sm font-semibold">
                Mode
                <select
                  value={draft.settings.mode}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      settings: {
                        ...draft.settings,
                        mode: e.target.value as 'exam' | 'practice',
                      },
                    })
                  }
                  className={`${inputClass} mt-1`}
                >
                  <option value="exam">Exam</option>
                  <option value="practice">Practice</option>
                </select>
              </label>
              <label className="text-sm font-semibold">
                Passing %
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.settings.passingPercent}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      settings: {
                        ...draft.settings,
                        passingPercent: Number(e.target.value),
                      },
                    })
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="text-sm font-semibold">
                Minutes
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={draft.settings.durationMinutes ?? ''}
                  placeholder="No limit"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      settings: {
                        ...draft.settings,
                        durationMinutes: e.target.value
                          ? Number(e.target.value)
                          : null,
                      },
                    })
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="text-sm font-semibold">
                Attempts
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={draft.settings.maxAttempts ?? ''}
                  placeholder="Unlimited"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      settings: {
                        ...draft.settings,
                        maxAttempts: e.target.value
                          ? Number(e.target.value)
                          : null,
                      },
                    })
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="col-span-2 text-sm font-semibold">
                Leaderboard result per participant
                <select
                  value={draft.settings.attemptResultPolicy}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      settings: {
                        ...draft.settings,
                        attemptResultPolicy: e.target.value as
                          | 'highest'
                          | 'latest'
                          | 'all',
                      },
                    })
                  }
                  className={`${inputClass} mt-1`}
                >
                  <option value="highest">Keep the highest result</option>
                  <option value="latest">Keep the latest result</option>
                  <option value="all">Rank every attempt</option>
                </select>
              </label>
              <label className="col-span-2 text-sm font-semibold">
                Opens at
                <input
                  type="datetime-local"
                  value={draft.settings.opensAt?.slice(0, 16) ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      settings: {
                        ...draft.settings,
                        opensAt: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      },
                    })
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="col-span-2 text-sm font-semibold">
                Closes at
                <input
                  type="datetime-local"
                  value={draft.settings.closesAt?.slice(0, 16) ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      settings: {
                        ...draft.settings,
                        closesAt: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null,
                      },
                    })
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              {[
                ['randomizeQuestions', 'Randomize questions'],
                ['randomizeOptions', 'Randomize options'],
                ['allowBackNavigation', 'Allow back navigation'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(
                      draft.settings[key as keyof typeof draft.settings],
                    )}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        settings: {
                          ...draft.settings,
                          [key]: e.target.checked,
                        },
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </section>
        </aside>
        <main className={`${panelClass} min-h-[700px] overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-2 border-b p-4">
            <strong className="mr-auto">
              Questions{' '}
              <span className="text-muted-foreground">
                {draft.questions.length}/35
              </span>
            </strong>
            <button
              type="button"
              className="q-button q-button-secondary"
              disabled={busy || availableImportSlots === 0}
              onClick={openImport}
            >
              <FileJson className="size-4" />
              Import
            </button>
            <button
              onClick={() => void addQuestion()}
              disabled={busy || draft.questions.length >= 35}
              className="q-button q-button-primary"
            >
              <Plus className="size-4" />
              Add question
            </button>
          </div>
          {message && (
            <output
              aria-live="polite"
              className={`m-4 block rounded-xl border px-4 py-3 text-sm font-semibold ${
                messageKind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
                  : messageKind === 'error'
                    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200'
                    : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200'
              }`}
            >
              {message}
            </output>
          )}
          {!!draft.questions.length && (
            <div className="flex gap-2 overflow-x-auto border-b p-3">
              {draft.questions.map((item, index) => (
                <button
                  key={item.id}
                  disabled={busy}
                  onClick={() => setSelected(index)}
                  className={`shrink-0 rounded-xl px-3 py-2 text-sm font-bold ${selected === index ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          )}
          {!question ? (
            <div className="grid min-h-[560px] place-items-center p-8 text-center">
              <div>
                <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Plus className="size-7" />
                </div>
                <h3 className="mt-4 text-xl font-bold">
                  Add your first question
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Write it manually or import a compatible JSON file.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-5 p-5 sm:p-7">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">Question {selected + 1}</h3>
                <button
                  className="q-button q-button-secondary text-red-600"
                  disabled={busy}
                  onClick={() => {
                    const next = draft.questions.filter(
                      (_, index) => index !== selected,
                    );
                    setDraft({ ...draft, questions: next });
                    setSelected(Math.max(0, selected - 1));
                  }}
                >
                  <Trash2 className="size-4" />
                  Remove
                </button>
              </div>
              <label className="block text-sm font-semibold">
                Question stem
                <textarea
                  rows={5}
                  value={question.stem}
                  onChange={(e) => updateQuestion({ stem: e.target.value })}
                  className={`${areaClass} mt-1`}
                />
              </label>
              <div className="space-y-3">
                <p className="text-sm font-semibold">Answer options</p>
                {question.options.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <button
                      aria-label={`Mark option ${index + 1} correct`}
                      onClick={() => updateQuestion({ answer: index })}
                      className={`grid size-10 shrink-0 place-items-center rounded-xl border ${question.answer === index ? 'border-emerald-500 bg-emerald-500 text-white' : 'bg-background'}`}
                    >
                      {question.answer === index ? (
                        <Check className="size-4" />
                      ) : (
                        String.fromCharCode(65 + index)
                      )}
                    </button>
                    <input
                      value={option}
                      onChange={(e) =>
                        updateQuestion({
                          options: question.options.map((item, optionIndex) =>
                            optionIndex === index ? e.target.value : item,
                          ),
                        })
                      }
                      className={inputClass}
                    />
                    {question.options.length > 2 && (
                      <button
                        aria-label="Remove option"
                        onClick={() => {
                          const options = question.options.filter(
                            (_, optionIndex) => optionIndex !== index,
                          );
                          updateQuestion({
                            options,
                            answer:
                              question.answer === index
                                ? 0
                                : question.answer > index
                                  ? question.answer - 1
                                  : question.answer,
                          });
                        }}
                        className="grid size-10 shrink-0 place-items-center rounded-xl text-red-600 hover:bg-red-50"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  disabled={question.options.length >= 10}
                  onClick={() =>
                    updateQuestion({ options: [...question.options, ''] })
                  }
                  className="q-button q-button-secondary"
                >
                  <Plus className="size-4" />
                  Option
                </button>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block text-sm font-semibold">
                  Explanation
                  <textarea
                    rows={4}
                    value={question.explanation}
                    onChange={(e) =>
                      updateQuestion({ explanation: e.target.value })
                    }
                    className={`${areaClass} mt-1`}
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Source
                  <textarea
                    rows={4}
                    value={question.sourceReference}
                    onChange={(e) =>
                      updateQuestion({ sourceReference: e.target.value })
                    }
                    className={`${areaClass} mt-1`}
                  />
                </label>
              </div>
              <div>
                <ExplanationImageEditor key={question.id} uid={user.uid} qbankId={`preformed-${draft.id}`} questionId={question.id} images={question.explanationImages ?? []} onChange={explanationImages => updateQuestion({ explanationImages })} onBusyChange={setExplanationImagesBusy} disabled={requestBusy} maximum={5} upload={file => uploadQuestionImage(user.uid, file, `preformed-${draft.id}`, question.id)} />
                <p className="mt-4 text-sm font-semibold">Question images</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {question.images.map((image) => (
                    <div
                      key={image.id}
                      className="relative size-28 overflow-hidden rounded-xl border"
                    >
                      <img
                        src={image.url}
                        alt={image.caption || image.name}
                        className="size-full object-cover"
                      />
                      <button
                        onClick={() =>
                          updateQuestion({
                            images: question.images.filter(
                              (item) => item.id !== image.id,
                            ),
                          })
                        }
                        className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-black/70 text-white"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                  <label className="grid size-28 cursor-pointer place-items-center rounded-xl border border-dashed text-center text-xs text-muted-foreground hover:border-primary hover:text-primary">
                    <span>
                      <ImagePlus className="mx-auto mb-1 size-5" />
                      Upload
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="sr-only"
                      onChange={(e) => {
                        void uploadImage(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>
              <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-2 rounded-2xl border bg-card/95 p-3 shadow-lg backdrop-blur">
                <button
                  disabled={busy}
                  onClick={() => void saveQuestion(false)}
                  className="q-button q-button-secondary"
                >
                  <Save className="size-4" />
                  {busy ? 'Saving…' : 'Save question'}
                </button>
                <button
                  disabled={busy || draft.questions.length >= 35}
                  onClick={() => void saveQuestion(true)}
                  className="q-button q-button-primary"
                >
                  <ChevronRight className="size-4" />
                  Save & next question
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
      {importOpen && (
        <dialog
          open
          aria-labelledby="preformed-import-title"
          className="q-safe-overlay fixed inset-0 z-[80] m-0 grid h-full w-full max-w-none place-items-center overflow-y-auto border-0 bg-slate-950/55 p-4 backdrop-blur-sm"
        >
          <section className="my-4 max-h-[85dvh] w-full max-w-3xl overflow-y-auto rounded-3xl border bg-card p-4 text-card-foreground shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <h2 id="preformed-import-title" className="text-lg font-bold">Import</h2>
              <button
                type="button"
                aria-label="Close import options"
                className="q-icon"
                onClick={() => setImportOpen(false)}
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 rounded-xl border bg-card p-3 sm:p-4">
              <label className={`relative flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-5 text-center transition-colors ${importDragging ? 'border-primary bg-primary/10' : 'border-primary/30 bg-primary/5 hover:border-primary hover:bg-primary/10'}`}>
                <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Upload className="size-6" /></span>
                <span className="text-base font-bold" dir="auto">Upload your file here <span dir="ltr">JSON / Text</span></span>
                <span className="text-sm text-muted-foreground" dir="auto">Drag a file here or click to choose one</span>
                <input
                  aria-label="Upload your file here JSON / Text"
                  type="file"
                  accept="application/json,text/plain,.json,.txt,.text"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  onDragOver={(event) => { event.preventDefault(); setImportDragging(true); }}
                  onDragLeave={() => setImportDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setImportDragging(false);
                    if (event.dataTransfer.files.length !== 1) return;
                    setImportOpen(false);
                    void importJson(event.dataTransfer.files[0]);
                  }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setImportOpen(false);
                      void importJson(file);
                    }
                    event.target.value = '';
                  }}
                />
              </label>
              <p className="text-xs text-muted-foreground" dir="auto">
                JSON or text containing JSON · 1–200 questions per file · Up to 1.5 MB. This test has {availableImportSlots} question slots remaining (35 maximum).
              </p>
            </div>
            <div className="mt-4 space-y-3">
              {(['lecture', 'qbank'] as const).map((source) => (
                <div key={source} className={`min-w-0 overflow-hidden rounded-xl border ${selectedImportSource === source ? 'border-primary/50' : 'border-border'}`}>
                  <button
                    type="button"
                    aria-expanded={selectedImportSource === source}
                    onClick={() => {
                      setSelectedImportSource(selectedImportSource === source ? null : source);
                      setImportSource(source);
                      setCopiedPrompt(false);
                      setCopyError('');
                    }}
                    className={`flex min-h-16 w-full items-center gap-3 p-4 text-start transition-colors hover:bg-muted/60 ${selectedImportSource === source ? 'bg-primary/5' : 'bg-card'}`}
                    dir="ltr"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{source === 'lecture' ? <GraduationCap className="size-5" /> : <FileJson className="size-5" />}</span>
                    <span className="min-w-0 flex-1 text-sm font-semibold leading-6">{source === 'lecture' ? 'Generate questions from lecture material with AI' : 'Convert question bank files with AI'}</span>
                    <ChevronRight className={`size-5 shrink-0 transition-transform ${selectedImportSource === source ? '-rotate-90' : 'rotate-90'}`} />
                  </button>
                  {selectedImportSource === source && (
                    <div className="min-w-0 space-y-4 rounded-xl border bg-card p-3 sm:p-4">
                      <div>
                        <h3 className="font-semibold">Prepare content with AI</h3>
                        <p className="mt-1 text-sm text-muted-foreground" dir="auto">Choose your settings, copy the prompt into your AI tool with your file, then upload the resulting JSON to review and add its questions to this test. Qraft does not send your file to an AI service.</p>
                        <p className="mt-2 text-sm text-muted-foreground" dir="auto">The prompt asks for a specialty and topic for each question. Check the output against your source before uploading.</p>
                      </div>
                      {source === 'qbank' && <p className="rounded-lg bg-muted p-3 text-sm" dir="auto">The prompt preserves the original question and option order without guessing. Incomplete or unreadable questions are skipped with a reason while the rest of the file is processed.</p>}
                      {source === 'lecture' && (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="text-sm font-semibold">Question type
                            <select className={`${inputClass} mt-2`} value={importKind} onChange={(event) => { setImportKind(event.target.value as QuestionPromptSettings['kind']); setCopiedPrompt(false); }}>
                              <option value="clinical">Clinical</option><option value="direct">Direct</option>
                            </select>
                          </label>
                          <label className="text-sm font-semibold">Question length
                            <select className={`${inputClass} mt-2`} value={importLength} onChange={(event) => { setImportLength(event.target.value as QuestionPromptSettings['length']); setCopiedPrompt(false); }}>
                              <option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option>
                            </select>
                          </label>
                        </div>
                      )}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          {source === 'lecture' && <label className="block text-sm font-semibold">Question count mode
                            <select className={`${inputClass} mt-2`} value={importCountMode} onChange={(event) => { setImportCountMode(event.target.value as QuestionPromptSettings['countMode']); setCopiedPrompt(false); }}>
                              <option value="fixed">Specific number</option><option value="per_slide">One question per slide</option>
                            </select>
                          </label>}
                          {(source === 'qbank' || importCountMode === 'fixed') && <label className="block text-sm font-semibold">{source === 'lecture' ? 'Questions to generate' : 'Questions to extract'}
                            <input type="number" inputMode="numeric" min={1} max={Math.max(1, availableImportSlots)} step={1} className={`${inputClass} mt-2`} value={safeImportCount} onChange={(event) => { setImportCount(Number(event.target.value) || 1); setCopiedPrompt(false); }} />
                          </label>}
                          <p className="text-xs text-muted-foreground">1–{availableImportSlots} questions for this test. A JSON file may contain up to 200 questions.</p>
                        </div>
                        {source === 'lecture' && <label className="text-sm font-semibold">Options per question
                          <input type="number" inputMode="numeric" min={2} max={10} className={`${inputClass} mt-2`} value={importOptionCount} onChange={(event) => { setImportOptionCount(Math.max(2, Math.min(10, Number(event.target.value) || 2))); setCopiedPrompt(false); }} />
                        </label>}
                      </div>
                      <button type="button" className="q-button q-button-primary min-h-12" onClick={() => void copyImportPrompt()} disabled={!importPrompt}>
                        {copiedPrompt ? <Check className="size-4" /> : <Copy className="size-4" />}
                        {copiedPrompt ? 'Prompt copied' : 'Copy AI prompt'}
                      </button>
                      {copiedPrompt && <output className="block text-sm text-emerald-600" dir="auto">Copied. Add your source and this prompt to your AI tool, then upload the resulting file above.</output>}
                      {copyError && <p role="alert" className="text-sm text-destructive">{copyError}</p>}
                      <details className="text-sm">
                        <summary className="min-h-11 cursor-pointer py-3">Preview AI prompt</summary>
                        <textarea aria-label="Preformed test AI prompt" readOnly dir="ltr" value={importPrompt} className="min-h-48 w-full rounded-xl border bg-muted p-3 text-xs" />
                      </details>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground" dir="auto">You can also upload an existing JSON file directly. These settings only affect the prompt; they do not rewrite imported questions or answers. Check the output against your source before uploading.</p>
          </section>
        </dialog>
      )}
      {editorConfirmationDialog}
    </div>
  );
}

export function PreformedTestRunner({
  user,
  code,
  onClose,
  onJoinQraft,
  onTestEntered,
}: {
  user: AppUser | null;
  code: string;
  onClose: () => void;
  onJoinQraft: () => void;
  onTestEntered?: () => void;
}) {
  const [name, setName] = useState(user?.displayName ?? '');
  const [scope, setScope] = useState('');
  const accountUid = user?.uid;
  const [passcode, setPasscode] = useState('');
  const [needsPasscode, setNeedsPasscode] = useState(false);
  const [attempt, setAttempt] = useState<PreformedLocalAttempt>();
  const [restoring, setRestoring] = useState(true);
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    score: number;
    questionCount: number;
    percentage: number;
    rank: number | null;
    leaderboard: boolean;
  }>();
  const [reviewing, setReviewing] = useState(false);
  const [leaderboard, setLeaderboard] = useState<PreformedLeaderboardEntry[]>();
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const submitLock = useRef(false);
  const autoSubmitted = useRef('');
  const questionBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (questionBodyRef.current) questionBodyRef.current.scrollTop = 0;
  }, [index, reviewing]);

  useEffect(() => {
    if (!attempt?.test.questions.length) return;
    onTestEntered?.();
  }, [attempt?.test.id, attempt?.test.questions.length, onTestEntered]);

  useEffect(() => {
    let active = true;
    const nextScope = accountUid ? preformedAccountScope(accountUid) : preformedGuestScope();
    void loadPreformedAttemptByCode(nextScope, code)
      .then(async (saved) => {
        if (!active) return;
        setScope(nextScope);
        if (saved?.submittedAt && saved.result) {
          setAttempt(saved);
          setResult(saved.result);
          setElapsed(saved.elapsedSeconds);
        } else if (saved && !saved.submittedAt) {
          let restored = saved;
          try {
            // Pending submissions must replay their original token, even if
            // their first response was lost after the server accepted it.
            const payload = !saved.submissionPending && navigator.onLine ? await api<{ test: PreformedTestDocument }>(
            `/preformed/open?code=${encodeURIComponent(code)}`,
            { forceRefresh: true, requestReason: 'reconnect-reconciliation',
              cacheScope: nextScope, expectedUserId: accountUid,
              headers: { 'x-qraft-attempt-token': saved.test.attemptToken ?? '' } },
            ) : undefined;
            if (payload) restored = { ...saved, test: payload.test };
          } catch (caught) {
            if (caught instanceof ApiError && caught.status < 500) throw caught;
            if (active) setError('Connection unavailable. Your saved attempt is available on this device; reconnect to submit.');
          }
          if (!active) return;
          setAttempt(restored);
          setName(saved.participantName);
          setElapsed(Math.max(saved.elapsedSeconds, Math.floor((Date.now() - Date.parse(restored.test.attemptStartedAt ?? saved.startedAt)) / 1000)));
          setIndex(Math.max(0, Math.min(saved.currentIndex ?? 0, saved.questionOrder.length - 1)));
        }
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not restore this attempt.');
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [code, accountUid]);

  const begin = async () => {
    if (!user && !name.trim()) return setError('Enter your name to begin.');
    setBusy(true);
    setError('');
    try {
      const payload = await api<{ test: PreformedTestDocument }>(
        `/preformed/open?code=${encodeURIComponent(code)}`,
        {
          forceRefresh: true,
          cacheScope: scope,
          expectedUserId: accountUid,
          requestReason: 'user-transaction',
          headers: passcode ? { 'x-qraft-test-passcode': passcode } : undefined,
        },
      );
      if (!user && payload.test.settings.maxAttempts !== null) {
        const attempts = Number(
          localStorage.getItem(
            `qraft-preformed-count:${scope}:${payload.test.id}:${payload.test.version}`,
          ) ?? 0,
        );
        if (attempts >= payload.test.settings.maxAttempts)
          throw new Error(
            'You have reached the attempt limit for this test on this device.',
          );
      }
      const saved = await loadPreformedAttempt(
        scope,
        payload.test.id,
        payload.test.version,
      );
      if (saved && !saved.submittedAt && saved.test.attemptToken === payload.test.attemptToken) {
        setAttempt({
          ...saved,
          test: payload.test,
        });
        setElapsed(saved.elapsedSeconds);
        setIndex(Math.max(0, Math.min(saved.currentIndex ?? 0, saved.questionOrder.length - 1)));
      } else {
        const questionOrder = payload.test.settings.randomizeQuestions
          ? randomOrder(payload.test.questions.length).map(
              (item) => payload.test.questions[item].id,
            )
          : payload.test.questions.map((item) => item.id);
        const optionOrder = Object.fromEntries(
          payload.test.questions.map((question) => [
            question.id,
            payload.test.settings.randomizeOptions
              ? randomOrder(question.options.length)
              : question.options.map((_, optionIndex) => optionIndex),
          ]),
        );
        const participantKeyName = `qraft-preformed-participant:${scope}:${payload.test.id}`;
        const existingParticipantKey = localStorage.getItem(participantKeyName);
        const participantKey = existingParticipantKey ?? crypto.randomUUID();
        if (!existingParticipantKey)
          localStorage.setItem(participantKeyName, participantKey);
        const next: PreformedLocalAttempt = {
          test: payload.test,
          participantName: user?.displayName ?? name.trim(),
          answers: {},
          currentIndex: 0,
          questionOrder,
          optionOrder,
          submissionId: crypto.randomUUID(),
          participantKey,
          startedAt: new Date().toISOString(),
          elapsedSeconds: 0,
        };
        await savePreformedAttempt(scope, next);
        setAttempt(next);
        setIndex(0);
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Could not open this test.';
      if (
        message === 'PASSCODE_REQUIRED' ||
        message.toLowerCase().includes('access code')
      )
        setNeedsPasscode(true);
      setError(
        message === 'PASSCODE_REQUIRED'
          ? 'This test needs an access passcode.'
          : message,
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = useCallback(async () => {
    if (!attempt || submitLock.current || result) return;
    submitLock.current = true;
    autoSubmitted.current = attempt.submissionId;
    setBusy(true);
    setError('');
    try {
      const pending = { ...attempt, elapsedSeconds: elapsed, submissionPending: true };
      await savePreformedAttempt(scope, pending);
      setAttempt(pending);
      if (!navigator.onLine) throw new Error('Your answers are saved on this device. Submission will retry when the connection returns.');
      const submissionId = attempt.submissionId;
      const localAttemptNumber =
        Number(
          localStorage.getItem(
            `qraft-preformed-count:${scope}:${attempt.test.id}:${attempt.test.version}`,
          ) ?? 0,
        ) + 1;
      const payload = await api<{
        accepted: boolean;
        score: number;
        questionCount: number;
        percentage: number;
        rank: number | null;
        leaderboard: boolean;
        questions: PreformedQuestion[];
      }>('/preformed/submit', {
        method: 'POST',
        expectedUserId: accountUid,
        body: JSON.stringify({
          submissionId,
          attemptToken: attempt.test.attemptToken,
          participantName: attempt.participantName,
          participantKey: attempt.participantKey,
          attemptNumber: localAttemptNumber,
          answers: attempt.answers,
        }),
      });
      if (payload.accepted !== true || !Number.isFinite(payload.score) ||
          !Array.isArray(payload.questions) || payload.questions.length !== attempt.test.questions.length)
        throw new Error('The server did not confirm the result. Your submission remains saved for retry.');
      const completed = {
        ...attempt,
        test: { ...attempt.test, questions: payload.questions, answersHidden: false },
        elapsedSeconds: elapsed,
        submittedAt: new Date().toISOString(),
        score: payload.score,
        submissionPending: false,
        result: { score: payload.score, questionCount: payload.questionCount, percentage: payload.percentage, rank: payload.rank, leaderboard: payload.leaderboard },
      };
      await savePreformedAttempt(scope, completed);
      setAttempt(completed);
      setResult(payload);
      if (!user) {
        const countKey = `qraft-preformed-count:${scope}:${attempt.test.id}:${attempt.test.version}`;
        localStorage.setItem(
          countKey,
          String(Number(localStorage.getItem(countKey) ?? 0) + 1),
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Submission failed. Your answers remain safely on this device.',
      );
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  }, [attempt, elapsed, result, user, scope, accountUid]);

  useEffect(() => {
    if (!attempt || result || attempt.submissionPending) return;
    const timer = window.setInterval(
      () => setElapsed(Math.max(attempt.elapsedSeconds, Math.floor((Date.now() - Date.parse(attempt.test.attemptStartedAt ?? attempt.startedAt)) / 1000))),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [attempt, result]);
  useEffect(() => {
    if (!attempt || result || attempt.submissionPending) return;
    if (elapsed % 15 !== 0) return;
    void savePreformedAttempt(scope, { ...attempt, elapsedSeconds: elapsed }).catch(
      () => setError('Could not save this attempt on your device. Please try again.'),
    );
  }, [attempt, elapsed, result, scope]);
  const limit = attempt?.test.settings.durationMinutes
    ? attempt.test.settings.durationMinutes * 60
    : null;
  useEffect(() => {
    if (!attempt || result || !navigator.onLine || autoSubmitted.current === attempt.submissionId) return;
    if (!attempt.submissionPending && (limit === null || elapsed < limit)) return;
    const timer = window.setTimeout(() => {
      autoSubmitted.current = attempt.submissionId;
      void submit();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [attempt, elapsed, limit, result, submit]);
  useEffect(() => {
    const online = () => { if (attempt && !result && (attempt.submissionPending || (limit !== null && elapsed >= limit))) void submit(); };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [attempt, result, submit, limit, elapsed]);

  const continueLater = async () => {
    if (!attempt) return onClose();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await savePreformedAttempt(scope, { ...attempt, elapsedSeconds: elapsed });
      onClose();
    } catch {
      setError('Could not save this attempt on your device. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (restoring || !scope || (user ? scope !== preformedAccountScope(user.uid) : !scope.startsWith('guest:')))
    return (
      <main className="q-test-screen grid h-full place-items-center bg-background p-5 text-sm font-semibold text-muted-foreground">
        <output>Opening saved test…</output>
      </main>
    );

  if (!attempt)
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,#dff6ff_0,transparent_42%)] p-5 dark:bg-[radial-gradient(circle_at_top,#102b46_0,transparent_42%)] sm:p-10">
        <div className="mx-auto max-w-lg">
          <button onClick={onClose} className="q-button q-button-secondary">
            <ChevronLeft className="size-4" />
            Back
          </button>
          <section className={`${panelClass} mt-6 p-7 sm:p-9`}>
            <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Globe2 className="size-7" />
            </div>
            <p className="mt-5 text-sm font-bold text-primary">
              READY-MADE TEST · {code}
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">
              Start when you are ready.
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              The full test loads once. Your answers stay on this device until
              you submit.
            </p>
            <div className="mt-7 space-y-4">
              {!user && (
                <label className="block text-sm font-semibold">
                  Your display name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    className={`${inputClass} mt-1`}
                    placeholder="Name shown if you reach the top 70"
                  />
                </label>
              )}
              {needsPasscode && (
                <label className="block text-sm font-semibold">
                  Access passcode
                  <input
                    type="password"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    className={`${inputClass} mt-1`}
                  />
                </label>
              )}
              {error && (
                <p
                  role="alert"
                  className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200"
                >
                  {error}
                </p>
              )}
              <button
                disabled={busy}
                onClick={() => void begin()}
                className="q-button q-button-primary w-full"
              >
                {busy ? 'Opening…' : 'Open test'}
                <ChevronRight className="size-4" />
              </button>
            </div>
          </section>
        </div>
      </main>
    );

  const ordered = attempt.questionOrder
    .map((id) => attempt.test.questions.find((item) => item.id === id))
    .filter((item): item is PreformedQuestion => Boolean(item));
  const goToQuestion = (target: number) => {
    const nextIndex = Math.max(0, Math.min(target, Math.max(0, ordered.length - 1)));
    const next = { ...attempt, currentIndex: nextIndex, elapsedSeconds: elapsed };
    setIndex(nextIndex);
    setAttempt(next);
    void savePreformedAttempt(scope, next).catch(() =>
      setError('Could not save your place on this device. Please try again.'),
    );
  };
  const question = ordered[index];
  const selectedAnswer = question ? attempt.answers[question.id] : undefined;
  const reveal =
    reviewing ||
    (attempt.test.settings.mode === 'practice' &&
      Number.isInteger(selectedAnswer));
  const clockSeconds = limit === null ? elapsed : Math.max(0, limit - elapsed);
  const clockText = duration(clockSeconds);
  if (result && !reviewing)
    return (
      <main className="grid min-h-screen place-items-center bg-background p-5">
        <section className={`${panelClass} w-full max-w-xl p-8 text-center`}>
          <div
            className={`mx-auto grid size-20 place-items-center rounded-full ${result.percentage >= attempt.test.settings.passingPercent ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
          >
            <Trophy className="size-9" />
          </div>
          <p className="mt-5 text-sm font-bold text-muted-foreground">
            {attempt.test.title}
          </p>
          <h1 className="mt-2 text-5xl font-black text-primary">
            {result.percentage}%
          </h1>
          <p className="mt-3 text-lg font-semibold">
            {result.score} of {result.questionCount} correct
          </p>
          {result.rank && (
            <p className="mt-2 text-sm text-muted-foreground">
              Leaderboard rank #{result.rank}
            </p>
          )}
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => {
                setReviewing(true);
                setIndex(0);
              }}
              className="q-button q-button-secondary"
            >
              <Eye className="size-4" />
              Review questions
            </button>
            {user ? (
              <button
                onClick={() =>
                  void api<{ leaderboard: PreformedLeaderboardEntry[] }>(
                    `/preformed/leaderboard?id=${attempt.test.id}`,
                  ).then((value) => setLeaderboard(value.leaderboard))
                }
                className="q-button q-button-primary"
              >
                <Trophy className="size-4" />
                Leaderboard
              </button>
            ) : (
              <button
                onClick={onJoinQraft}
                className="q-button q-button-primary"
              >
                Join Qraft to see leaderboard
              </button>
            )}
          </div>
          {leaderboard && (
            <div className="mt-6 text-left">
              <Leaderboard entries={leaderboard} />
            </div>
          )}
          <button
            onClick={onClose}
            className="mt-6 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            Leave test
          </button>
        </section>
      </main>
    );

  return (
    <>
      <main className="q-test-screen q-preformed-runner flex h-full min-h-0 flex-col bg-muted/25">
        <nav className="q-test-bottom" aria-label="Test navigation">
          <button
            disabled={index === 0 || !attempt.test.settings.allowBackNavigation}
            onClick={() => goToQuestion(index - 1)}
            className="q-button q-button-secondary"
          >
            Previous
          </button>
          {index < ordered.length - 1 ? (
            <button
              disabled={!Number.isInteger(selectedAnswer)}
              onClick={() => goToQuestion(index + 1)}
              className="q-button q-button-primary"
            >
              Next
            </button>
          ) : reviewing ? (
            <button
              onClick={() => setReviewing(false)}
              className="q-button q-button-primary"
            >
              Results
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => void submit()}
              className="q-button q-button-primary"
            >
              {attempt.submissionPending ? 'Retry submission' : 'Submit'}
            </button>
          )}
        </nav>
        <header className="q-exam-header sticky top-0 z-20 flex min-h-[68px] items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:gap-4 sm:px-7">
          <button
            type="button"
            aria-label="Open question list"
            aria-expanded={navigatorOpen}
            title="Open question list"
            onClick={() => setNavigatorOpen(true)}
            className="grid size-11 shrink-0 place-items-center rounded-xl border text-muted-foreground transition hover:border-primary/35 hover:bg-primary/5 hover:text-primary"
          >
            <Menu className="size-5" />
          </button>
          <div className="q-exam-heading min-w-0 flex-1 text-center sm:text-left">
            <strong className="block truncate text-sm font-bold tabular-nums sm:text-base">
              Question {index + 1} of {ordered.length}
            </strong>
            <span className="block truncate text-[11px] text-muted-foreground sm:text-xs">
              {attempt.test.title}
            </span>
          </div>
          <span
            aria-label={`${limit === null ? 'Elapsed time' : 'Time remaining'}: ${clockText}`}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-2 text-xs font-bold tabular-nums sm:gap-2 sm:px-3 sm:text-sm ${limit !== null && limit - elapsed < 60 ? 'bg-red-100 text-red-700' : 'bg-muted'}`}
          >
            <Clock3 className="size-4" />
            {clockText.startsWith('00:') ? clockText.slice(3) : clockText}
          </span>
        </header>
        <progress
          className="q-exam-progress h-1 w-full shrink-0"
          aria-label="Question progress"
          max={Math.max(1, ordered.length)}
          value={index + 1}
        />
        {error && (
          <p role="alert" className="mx-3 mt-2 shrink-0 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </p>
        )}
        <div ref={questionBodyRef} className="q-test-body w-full flex-1">
          <div className="mx-auto max-w-4xl p-3 pb-8 sm:p-8">
            {question && (
              <section className={`${panelClass} p-5 sm:p-8`}>
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap text-base font-medium leading-7 sm:text-lg sm:leading-8">
                    <FormattedQuestionText text={question.stem} />
                  </p>
                  {question.images.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      {question.images.map((image) => (
                        <img
                          key={image.id}
                          src={image.url}
                          alt={image.caption || image.name}
                          className="max-h-72 rounded-2xl border object-contain"
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-7 space-y-3">
                  {(
                    attempt.optionOrder[question.id] ??
                    question.options.map((_, itemIndex) => itemIndex)
                  ).map((optionIndex, displayIndex) => {
                    const selected = selectedAnswer === optionIndex;
                    const correct = question.answer === optionIndex;
                    return (
                      <button
                        key={optionIndex}
                        disabled={reviewing || busy || attempt.submissionPending}
                        onClick={() => {
                          const next = {
                            ...attempt,
                            answers: {
                              ...attempt.answers,
                              [question.id]: optionIndex,
                            },
                            elapsedSeconds: elapsed,
                          };
                          setAttempt(next);
                          setError('');
                          void savePreformedAttempt(scope, next).catch(() =>
                            setError('Could not save your answer on this device. Please try again.'),
                          );
                        }}
                        className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${reveal && correct ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' : reveal && selected && !correct ? 'border-red-400 bg-red-50 dark:bg-red-500/10' : selected ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/40'}`}
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background font-bold">
                          {String.fromCharCode(65 + displayIndex)}
                        </span>
                        <span className="pt-1 text-sm font-medium">
                          <FormattedQuestionText text={question.options[optionIndex]} />
                        </span>
                      </button>
                    );
                  })}
                </div>
                {reveal &&
                  (question.explanation || question.sourceReference || question.explanationImages?.length) && (
                    <div className="mt-6 rounded-2xl bg-muted p-5">
                      <p className="font-bold">Explanation</p>
                      {question.explanation && (
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                          <FormattedQuestionText text={question.explanation} />
                        </p>
                      )}
                      <ExplanationImages images={question.explanationImages} />
                      {question.sourceReference && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Source: {question.sourceReference}
                        </p>
                      )}
                    </div>
                  )}
              </section>
            )}
            <div className="mt-5 hidden items-center justify-between gap-3 sm:flex">
              <button
                disabled={
                  index === 0 || !attempt.test.settings.allowBackNavigation
                }
                onClick={() => goToQuestion(index - 1)}
                className="q-button q-button-secondary"
              >
                <ChevronLeft className="size-4" />
                Previous
              </button>
              {index < ordered.length - 1 ? (
                <button
                  disabled={!Number.isInteger(selectedAnswer)}
                  onClick={() => goToQuestion(index + 1)}
                  className="q-button q-button-primary"
                >
                  Next
                  <ChevronRight className="size-4" />
                </button>
              ) : reviewing ? (
                <button
                  onClick={() => setReviewing(false)}
                  className="q-button q-button-primary"
                >
                  Back to result
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => void submit()}
                  className="q-button q-button-primary"
                >
                  <Send className="size-4" />
                  {busy ? 'Submitting…' : attempt.submissionPending ? 'Retry submission' : 'Submit test'}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
      <QuestionNavigator
        open={navigatorOpen}
        title={attempt.test.title}
        currentIndex={index}
        items={ordered.map((item, itemIndex) => {
          const answer = attempt.answers[item.id];
          const canReveal =
            reviewing ||
            (attempt.test.settings.mode === 'practice' &&
              Number.isInteger(answer));
          return {
            id: item.id,
            preview: item.stem,
            answered: Number.isInteger(answer),
            revealed: canReveal,
            result: canReveal
              ? answer === item.answer
                ? ('correct' as const)
                : ('incorrect' as const)
              : undefined,
            disabled:
              !attempt.test.settings.allowBackNavigation && itemIndex !== index,
          };
        })}
        onSelect={goToQuestion}
        onClose={() => setNavigatorOpen(false)}
        secondaryAction={{
          label: busy ? 'Saving…' : 'Save & exit',
          icon: <LogOut className="size-4" />,
          disabled: busy,
          onClick: () => {
            setNavigatorOpen(false);
            void continueLater();
          },
        }}
        primaryAction={{
          label: reviewing ? 'Results' : busy ? 'Finishing…' : 'Finish',
          icon: reviewing ? (
            <Eye className="size-4" />
          ) : (
            <Send className="size-4" />
          ),
          disabled: busy,
          onClick: () => {
            setNavigatorOpen(false);
            if (reviewing) setReviewing(false);
            else void submit();
          },
        }}
      />
    </>
  );
}

export function PreformedTestsWorkspace({
  user,
  onUpgrade,
  onRunTest,
}: {
  user: AppUser;
  onUpgrade: () => void;
  onRunTest: (code: string) => void;
}) {
  const [tests, setTests] = useState<PreformedTestSummary[]>([]);
  const [tab, setTab] = useState<'mine' | 'public'>('mine');
  const [joinCode, setJoinCode] = useState('');
  const [editing, setEditing] = useState<PreformedTestDocument>();
  const [stats, setStats] = useState<LeaderboardResponse>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const actionInFlight = useRef(false);
  const [copiedCode, setCopiedCode] = useState('');
  const [confirmAction, confirmationDialog] = useConfirmationDialog();
  const loadSequence = useRef(0);
  const cancelPendingLoads = useCallback(() => { loadSequence.current += 1; }, []);
  const copyResetTimer = useRef<number | undefined>(undefined);
  const canCreate = user.role === 'super_admin' || (user.planLimits ?? getPlanLimits(user.effectivePlan ?? user.tier)).canCreateReadyTests;
  const load = useCallback(
    async (force = false, silent = false) => {
      const sequence = ++loadSequence.current;
      if (!silent) {
        setLoading(true);
        setError('');
      }
      try {
        const value = await api<{ tests: PreformedTestSummary[] }>(
          '/preformed/catalog',
          {
            resourceQuery: true,
            cacheScope: user.uid,
            forceRefresh: force,
            requestReason: force ? 'explicit-refresh' : undefined,
          },
        );
        if (sequence === loadSequence.current) { setTests(value.tests); }
      } catch (caught) {
        if (!silent && sequence === loadSequence.current)
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not load ready-made tests.',
          );
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [user.uid],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); cancelPendingLoads(); };
  }, [load, cancelPendingLoads]);
  useEffect(
    () => subscribeLive(() => {
      void load(true, true);
      if (!stats) return;
      const id = stats.test.id;
      void api<{ leaderboard: PreformedLeaderboardEntry[] }>(`/preformed/leaderboard?id=${encodeURIComponent(id)}`, {
        forceRefresh: true, cacheScope: user.uid, requestReason: 'server-invalidation',
      }).then(value => setStats(current => current?.test.id === id
        ? { ...current, leaderboard: value.leaderboard } : current))
        .catch(() => setStats(current => current?.test.id === id ? undefined : current));
    }, ['preformed-tests', 'preformed-results', 'connected']),
    [load, stats, user.uid],
  );
  useEffect(
    () => () => {
      if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
    },
    [],
  );
  async function runAction(action: () => Promise<void>, fallback: string) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    // A read started before this action must not overwrite its result.
    ++loadSequence.current;
    setLoading(false); setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : fallback); }
    finally { actionInFlight.current = false; setBusy(false); }
  }
  const create = async () => {
    if (!canCreate) return onUpgrade();
    await runAction(async () => {
      const value = await api<{ test: PreformedTestDocument }>('/preformed/create', { method: 'POST', body: '{}' });
      setEditing(value.test);
    }, 'Could not create a test. Please try again.');
  };
  const edit = async (id: string) => {
    await runAction(async () => {
      const value = await api<ManageResponse>(`/preformed/manage?id=${encodeURIComponent(id)}`, { forceRefresh: true, requestReason: 'user-transaction' });
      setEditing(value.test);
    }, 'Could not load this test. Please try again.');
  };
  const showBoard = async (test: PreformedTestSummary) => {
    await runAction(async () => {
      const value = await api<{ leaderboard: PreformedLeaderboardEntry[] }>(`/preformed/leaderboard?id=${encodeURIComponent(test.id)}`);
      setStats({ test, leaderboard: value.leaderboard });
    }, 'Could not load the leaderboard. Please try again.');
  };
  const share = async (code: string) => {
    setError('');
    try {
      await navigator.clipboard.writeText(testUrl(code));
      setCopiedCode(code);
      if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = window.setTimeout(() => {
        setCopiedCode((current) => (current === code ? '' : current));
      }, 2400);
    } catch {
      setError('Could not copy the share link. Try again.');
    }
  };
  const rotate = async (id: string) => {
    if (
      !(await confirmAction({
        title: 'Create a new join code?',
        description:
          'The current code and its existing share link will stop working immediately.',
        confirmLabel: 'Create new code',
        tone: 'warning',
      }))
    )
      return;
    await runAction(async () => {
      const value = await api<{ code: string }>('/preformed/rotate-code', { method: 'POST', body: JSON.stringify({ id }) });
      setTests(current => current.map(item => item.id === id ? { ...item, code: value.code } : item));
      setCopiedCode('');
      setNotice('A new join code has been created. The previous link no longer works.');
    }, 'Could not change the join code. Please try again.');
  };
  const remove = async (test: PreformedTestSummary) => {
    if (
      !(await confirmAction({
        title: `Delete “${test.title}”?`,
        description:
          'The test and all of its participant results will be permanently deleted. This cannot be undone.',
        confirmLabel: 'Delete permanently',
        tone: 'destructive',
      }))
    )
      return;
    await runAction(async () => {
      await api('/preformed/delete', { method: 'DELETE', body: JSON.stringify({ id: test.id }) });
      setTests(current => current.filter(item => item.id !== test.id));
      setNotice('Test deleted.');
    }, 'Could not delete the test. Please try again.');
  };
  const report = async (id: string) => {
    if (actionInFlight.current) return;
    const reason = window.prompt('What should the Superadmin review?');
    if (!reason?.trim()) return;
    await runAction(async () => {
      await api('/preformed/report', { method: 'POST', body: JSON.stringify({ id, reason }) });
      setNotice('Report sent. Thank you.');
    }, 'Could not send the report. Please try again.');
  };
  const moderate = async (id: string) => {
    if (!(await confirmAction({ title: 'Hide this public test?', description: 'Participants will no longer be able to find or open this test until it is restored.', confirmLabel: 'Hide test', tone: 'warning' }))) return;
    await runAction(async () => {
      await api('/preformed/moderate', { method: 'PUT', body: JSON.stringify({ id, hidden: true }) });
      setTests(current => current.filter(item => item.id !== id));
      setNotice('Test hidden.');
    }, 'Could not hide the test. Please try again.');
  };
  const visible = tests.filter((item) =>
    tab === 'mine'
      ? item.ownerId === user.uid
      : item.visibility === 'public' && item.status === 'published',
  );

  return (
    <>
      <WorkspaceHeader
        title="Preformed tests"
        subtitle="Join, create, and share independent tests"
      />
      <div className="mx-auto max-w-7xl p-4 sm:p-7">
        <section className="overflow-hidden rounded-[30px] bg-gradient-to-br from-[#0b5fae] via-[#087cb9] to-[#13a69a] p-5 text-white shadow-xl shadow-primary/10 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-black tracking-[0.18em] text-cyan-100">
                READY-MADE TESTS
              </p>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
                Share one code. Start learning.
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-blue-50/80">
                Independent tests for quick classes, study groups, and public
                practice—without creating a QBank.
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const normalized = joinCode
                  .trim()
                  .toUpperCase()
                  .replace(/\s+/g, '');
                if (normalized)
                  onRunTest(
                    normalized.startsWith('QF-')
                      ? normalized
                      : `QF-${normalized}`,
                  );
              }}
              className="flex w-full max-w-md gap-2 rounded-2xl bg-white/12 p-2 ring-1 ring-white/20"
            >
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Enter test code"
                className="h-11 min-w-0 flex-1 rounded-xl bg-white px-4 font-mono font-bold uppercase text-slate-900 outline-none"
              />
              <button className="rounded-xl bg-white px-5 font-bold text-primary">
                Join
              </button>
            </form>
          </div>
        </section>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-2xl bg-muted p-1">
            <button
              onClick={() => setTab('mine')}
              className={`rounded-xl px-5 py-2.5 text-sm font-bold ${tab === 'mine' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}
            >
              My Tests
            </button>
            <button
              onClick={() => setTab('public')}
              className={`rounded-xl px-5 py-2.5 text-sm font-bold ${tab === 'public' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}
            >
              Public Tests
            </button>
          </div>
          <button
            onClick={() => void load(true)}
            disabled={busy || loading}
            className="q-button q-button-secondary"
          >
            <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {tab === 'mine' && (
            <button
              disabled={busy || loading}
                        onClick={() => void create()}
              className="q-button q-button-primary ml-auto"
              aria-label={
                !canCreate ? 'New test — Full Access plan required' : undefined
              }
              title={!canCreate ? 'Upgrade to Full Access to create a test' : undefined}
            >
              <span
                aria-hidden="true"
                className={`grid size-6 shrink-0 place-items-center rounded-lg transition-colors ${
                  canCreate
                    ? 'bg-white/15 text-current'
                    : 'bg-amber-50 text-amber-700 shadow-sm ring-1 ring-inset ring-amber-300/80'
                }`}
              >
                {canCreate ? (
                  <Plus className="size-4" strokeWidth={2.4} />
                ) : (
                  <LockKeyhole className="size-3.5" strokeWidth={2.4} />
                )}
              </span>
              New test
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-4 block rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && !error && <output className="mt-4 block rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</output>}
        {loading && <output className="mt-4 block text-sm">Loading tests…</output>}
        {!visible.length && !busy && !loading && !error ? (
          <div className={`${panelClass} mt-5 p-12 text-center`}>
            <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Globe2 className="size-7" />
            </div>
            <h2 className="mt-4 text-xl font-bold">
              {tab === 'mine' ? 'No tests yet' : 'No public tests yet'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {tab === 'mine'
                ? 'Create a focused test and share its link or short code.'
                : 'Published community tests will appear here.'}
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((test) => (
              <article
                key={test.id}
                className={`${panelClass} flex min-h-64 flex-col p-5`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${test.visibility === 'public' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}
                  >
                    {test.visibility}
                  </span>
                  <span className="font-mono text-xs font-bold text-muted-foreground">
                    {test.code}
                  </span>
                </div>
                <h2 className="mt-4 line-clamp-2 text-xl font-bold">
                  {test.title}
                </h2>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                  {test.description || `Created by ${test.ownerName}`}
                </p>
                <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-muted-foreground">
                  <span>{test.questionCount} questions</span>
                  <span>·</span>
                  <span>{test.participantCount} ranked</span>
                  <span>·</span>
                  <span>{test.settings.mode}</span>
                </div>
                <div className="q-preformed-card-actions mt-auto pt-5">
                  <button
                    aria-label={`Open ${test.title}`}
                    disabled={busy || loading || test.status !== 'published'}
                    title={
                      test.status !== 'published'
                        ? 'Publish this test before opening it.'
                        : 'Open test'
                    }
                    onClick={() => onRunTest(test.code)}
                    className="q-button q-button-primary"
                  >
                    <Eye className="size-4" />
                  </button>
                  <button
                    aria-label={copiedCode === test.code ? `Link copied for ${test.title}` : `Copy link for ${test.title}`}
                    disabled={busy || loading || test.status !== 'published'}
                    title={
                      test.status !== 'published'
                        ? 'Publish this test before sharing it.'
                        : copiedCode === test.code ? 'Link copied' : 'Copy link'
                    }
                    onClick={() => void share(test.code)}
                    className="q-button q-button-secondary"
                  >
                    {copiedCode === test.code ? (
                      <Check className="size-4 text-emerald-600" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                  <button title="Leaderboard" aria-label={`Leaderboard for ${test.title}`} disabled={busy || loading} onClick={() => void showBoard(test)} className="q-button q-button-secondary">
                    <Trophy className="size-4" />
                  </button>
                  {test.ownerId === user.uid ? (
                    <>
                      <button
                        title="Edit test"
                        aria-label={`Edit ${test.title}`}
                        disabled={busy || loading}
                        onClick={() => void edit(test.id)}
                        className="q-button q-button-secondary"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        title="Rotate code"
                        aria-label={`Rotate code for ${test.title}`}
                        disabled={busy || loading}
                        onClick={() => void rotate(test.id)}
                        className="q-button q-button-secondary px-3"
                      >
                        <RotateCcw className="size-4" />
                      </button>
                      <button
                        title="Delete"
                        aria-label={`Delete ${test.title}`}
                        disabled={busy || loading}
                        onClick={() => void remove(test)}
                        className="q-button q-button-secondary px-3 text-red-600"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        title="Report"
                        aria-label={`Report ${test.title}`}
                        disabled={busy || loading}
                        onClick={() => void report(test.id)}
                        className="q-button q-button-secondary px-3"
                      >
                        <Flag className="size-4" />
                      </button>
                      {user.role === 'super_admin' && user.mfaVerified && (
                        <button
                          title="Hide test"
                          disabled={busy || loading}
                        aria-label={`Hide ${test.title}`}
                          onClick={() => void moderate(test.id)}
                          className="q-button q-button-secondary px-3 text-red-600"
                        >
                          <ShieldAlert className="size-4" />
                        </button>
                      )}
                    </>
                  )}
                </div>
                {copiedCode === test.code && <output className="sr-only">Link copied</output>}
              </article>
            ))}
          </div>
        )}
        {editing && (
          <TestEditor
            user={user}
            initial={editing}
            onClose={() => {
              setEditing(undefined);
              void load(true);
            }}
            onSaved={(test) => {
              setEditing(test);
              if (test.visibility === 'public' && test.status === 'published')
                setTab('public');
              setTests((current) => {
                const exists = current.some((item) => item.id === test.id);
                return exists
                  ? current.map((item) => (item.id === test.id ? test : item))
                  : [test, ...current];
              });
            }}
          />
        )}
        {stats && (
          <div className="q-safe-overlay fixed inset-0 z-[80] overflow-y-auto bg-black/45 p-4 sm:p-8">
            <section className="mx-auto max-w-4xl rounded-3xl bg-card p-5 shadow-2xl sm:p-7">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-primary">LEADERBOARD</p>
                  <h2 className="truncate text-2xl font-black">
                    {stats.test.title}
                  </h2>
                </div>
                {stats.test.ownerId === user.uid && (
                  <button
                    onClick={() =>
                      downloadResults(stats.test, stats.leaderboard)
                    }
                    className="q-button q-button-secondary"
                  >
                    <Download className="size-4" />
                    Export CSV
                  </button>
                )}
                <button
                  onClick={() => setStats(undefined)}
                  aria-label="Close leaderboard"
                  className="grid size-10 place-items-center rounded-xl hover:bg-muted"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="mt-6">
                <Leaderboard entries={stats.leaderboard} />
              </div>
            </section>
          </div>
        )}
        {confirmationDialog}
      </div>
    </>
  );
}

type PreformedReport = {
  id: string;
  test_id: string;
  reporter_id: string;
  reason: string;
  created_at: string;
  title: string;
  code: string;
  status: 'draft' | 'published' | 'paused' | 'hidden';
};

export function PreformedReportsAdmin() {
  const [reports, setReports] = useState<PreformedReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setReports(
        (
          await api<{ reports: PreformedReport[] }>('/preformed/reports', {
            forceRefresh: true,
            requestReason: 'explicit-refresh',
          })
        ).reports,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not load test reports.',
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const setHidden = async (testId: string, hidden: boolean) => {
    setBusy(true);
    setError('');
    try {
      await api('/preformed/moderate', {
        method: 'PUT',
        body: JSON.stringify({ id: testId, hidden }),
      });
      setReports((current) =>
        current.map((item) =>
          item.test_id === testId
            ? { ...item, status: hidden ? 'hidden' : 'published' }
            : item,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not update this test.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
        <div>
          <h2 className="font-bold">Reported ready-made tests</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Moderation is direct and does not enter the QBank review workflow.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={busy}
          className="q-button q-button-secondary"
        >
          <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      {error && (
        <p className="m-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </p>
      )}
      <div className="divide-y">
        {reports.map((report) => (
          <article
            key={report.id}
            className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="truncate">{report.title}</strong>
                <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-bold">
                  {report.code}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${report.status === 'hidden' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}
                >
                  {report.status}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                {report.reason}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Reporter {report.reporter_id} ·{' '}
                {new Date(report.created_at).toLocaleString()}
              </p>
            </div>
            {report.status === 'hidden' ? (
              <button
                disabled={busy}
                onClick={() => void setHidden(report.test_id, false)}
                className="q-button q-button-secondary"
              >
                Restore
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={() => void setHidden(report.test_id, true)}
                className="q-button q-button-secondary text-red-600"
              >
                <ShieldAlert className="size-4" />
                Hide test
              </button>
            )}
          </article>
        ))}
      </div>
      {!reports.length && !busy && (
        <p className="p-10 text-center text-sm text-muted-foreground">
          No ready-made test reports.
        </p>
      )}
    </section>
  );
}
