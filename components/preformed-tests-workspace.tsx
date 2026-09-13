'use client';

/* oxlint-disable next/no-img-element */

import { api } from '@/lib/api-client';
import {
  deleteQBankImages,
  uploadQuestionImage,
} from '@/lib/application-services';
import {
  loadPreformedAttempt,
  loadPreformedAttemptByCode,
  savePreformedAttempt,
} from '@/lib/local-db';
import type { AppUser } from '@/lib/medguard-types';
import { parseQuestionImportReport } from '@/lib/question-import';
import { subscribeLive } from '@/lib/realtime-client';
import type {
  PreformedLeaderboardEntry,
  PreformedLocalAttempt,
  PreformedQuestion,
  PreformedQuestionStat,
  PreformedTestDocument,
  PreformedTestSummary,
} from '@/lib/preformed-test-types';
import {
  BarChart3,
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
  ImagePlus,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldAlert,
  Trash2,
  Trophy,
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
    sourceReference: '',
    images: [],
  };
}

function questionValidationMessage(question: PreformedQuestion) {
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
  test: PreformedTestDocument,
  entries: PreformedLeaderboardEntry[],
) {
  const escape = (value: string | number) =>
    `"${String(value).replaceAll('"', '""')}"`;
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
  questionStats: PreformedQuestionStat[];
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error' | 'info'>(
    'info',
  );
  const dirty = JSON.stringify(draft) !== baseline || passcode !== undefined;
  const question = draft.questions[selected];

  const close = () => {
    if (!dirty || window.confirm('Discard your unsaved test changes?'))
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
      const report = parseQuestionImportReport(await file.text(), file.name);
      const available = 35 - draft.questions.length;
      const imported = report.questions.slice(0, available).map((item) => ({
        id: crypto.randomUUID(),
        stem: item.stem,
        options: item.options,
        answer: item.answer,
        explanation: item.explanation,
        sourceReference: item.sourceReference,
        images: item.images,
      }));
      setDraft((current) => ({
        ...current,
        questions: [...current.questions, ...imported],
      }));
      setMessageKind('success');
      setMessage(
        `${imported.length} question${imported.length === 1 ? '' : 's'} imported${report.skipped.length ? `; ${report.skipped.length} skipped` : ''}.`,
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
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-background">
      <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-7">
        <button
          onClick={close}
          className="grid size-10 place-items-center rounded-xl hover:bg-muted"
          aria-label="Close editor"
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
            <label className="q-button q-button-secondary cursor-pointer">
              <FileJson className="size-4" />
              Import JSON
              <input
                className="sr-only"
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  void importJson(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
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
                <p className="text-sm font-semibold">Images</p>
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
  const [passcode, setPasscode] = useState('');
  const [needsPasscode, setNeedsPasscode] = useState(false);
  const [attempt, setAttempt] = useState<PreformedLocalAttempt>();
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
  const submitLock = useRef(false);

  useEffect(() => {
    if (!attempt?.test.questions.length) return;
    onTestEntered?.();
  }, [attempt?.test.id, attempt?.test.questions.length, onTestEntered]);

  useEffect(() => {
    let active = true;
    void loadPreformedAttemptByCode(code)
      .then((saved) => {
        if (active && saved && !saved.submittedAt) {
          setAttempt(saved);
          setName(saved.participantName);
          setElapsed(saved.elapsedSeconds);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [code]);

  const begin = async () => {
    if (!user && !name.trim()) return setError('Enter your name to begin.');
    setBusy(true);
    setError('');
    try {
      const payload = await api<{ test: PreformedTestDocument }>(
        `/preformed/open?code=${encodeURIComponent(code)}`,
        {
          forceRefresh: true,
          requestReason: 'user-transaction',
          headers: passcode ? { 'x-qraft-test-passcode': passcode } : undefined,
        },
      );
      if (!user && payload.test.settings.maxAttempts !== null) {
        const attempts = Number(
          localStorage.getItem(
            `qraft-preformed-count:${payload.test.id}:${payload.test.version}`,
          ) ?? 0,
        );
        if (attempts >= payload.test.settings.maxAttempts)
          throw new Error(
            'You have reached the attempt limit for this test on this device.',
          );
      }
      const saved = await loadPreformedAttempt(
        payload.test.id,
        payload.test.version,
      );
      if (saved && !saved.submittedAt) {
        setAttempt({
          ...saved,
          test: { ...saved.test, attemptToken: payload.test.attemptToken },
        });
        setElapsed(saved.elapsedSeconds);
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
        const participantKeyName = `qraft-preformed-participant:${payload.test.id}`;
        const existingParticipantKey = localStorage.getItem(participantKeyName);
        const participantKey = existingParticipantKey ?? crypto.randomUUID();
        if (!existingParticipantKey)
          localStorage.setItem(participantKeyName, participantKey);
        const next: PreformedLocalAttempt = {
          test: payload.test,
          participantName: user?.displayName ?? name.trim(),
          answers: {},
          questionOrder,
          optionOrder,
          submissionId: crypto.randomUUID(),
          participantKey,
          startedAt: new Date().toISOString(),
          elapsedSeconds: 0,
        };
        await savePreformedAttempt(next);
        setAttempt(next);
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
    setBusy(true);
    setError('');
    try {
      const submissionId = attempt.submissionId;
      const localAttemptNumber =
        Number(
          localStorage.getItem(
            `qraft-preformed-count:${attempt.test.id}:${attempt.test.version}`,
          ) ?? 0,
        ) + 1;
      const guestScore = attempt.test.questions.reduce(
        (total, question) =>
          total + (attempt.answers[question.id] === question.answer ? 1 : 0),
        0,
      );
      const payload = await api<{
        accepted: boolean;
        score: number;
        questionCount: number;
        percentage: number;
        rank: number | null;
        leaderboard: boolean;
      }>('/preformed/submit', {
        method: 'POST',
        body: JSON.stringify({
          submissionId,
          attemptToken: attempt.test.attemptToken,
          participantName: attempt.participantName,
          participantKey: attempt.participantKey,
          attemptNumber: localAttemptNumber,
          ...(user ? { answers: attempt.answers } : { guestScore }),
          durationSeconds: elapsed,
        }),
      });
      const completed = {
        ...attempt,
        elapsedSeconds: elapsed,
        submittedAt: new Date().toISOString(),
        score: payload.score,
      };
      await savePreformedAttempt(completed);
      setAttempt(completed);
      setResult(payload);
      if (!user) {
        const countKey = `qraft-preformed-count:${attempt.test.id}:${attempt.test.version}`;
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
  }, [attempt, elapsed, result, user]);

  useEffect(() => {
    if (!attempt || result) return;
    const timer = window.setInterval(
      () => setElapsed((current) => current + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [attempt, result]);
  useEffect(() => {
    if (!attempt || result) return;
    if (elapsed % 5 !== 0) return;
    void savePreformedAttempt({ ...attempt, elapsedSeconds: elapsed });
  }, [attempt, elapsed, result]);
  const limit = attempt?.test.settings.durationMinutes
    ? attempt.test.settings.durationMinutes * 60
    : null;
  useEffect(() => {
    if (limit === null || elapsed < limit || !attempt || result) return;
    const timer = window.setTimeout(() => void submit(), 0);
    return () => window.clearTimeout(timer);
  }, [attempt, elapsed, limit, result, submit]);

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
  const question = ordered[index];
  const selectedAnswer = question ? attempt.answers[question.id] : undefined;
  const reveal =
    reviewing ||
    (attempt.test.settings.mode === 'practice' &&
      Number.isInteger(selectedAnswer));
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
    <main className="min-h-screen bg-muted/25">
      <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-7">
        <button
          onClick={onClose}
          className="grid size-10 place-items-center rounded-xl hover:bg-muted"
        >
          <X className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold">{attempt.test.title}</h1>
          <p className="text-xs text-muted-foreground">
            Question {index + 1} of {ordered.length}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold ${limit !== null && limit - elapsed < 60 ? 'bg-red-100 text-red-700' : 'bg-muted'}`}
        >
          <Clock3 className="size-4" />
          {duration(limit === null ? elapsed : Math.max(0, limit - elapsed))}
        </span>
      </header>
      <div className="mx-auto max-w-4xl p-4 sm:p-8">
        <div className="mb-5 flex gap-1">
          {ordered.map((item, itemIndex) => (
            <button
              key={item.id}
              disabled={
                !attempt.test.settings.allowBackNavigation &&
                itemIndex !== index
              }
              onClick={() => setIndex(itemIndex)}
              aria-label={`Question ${itemIndex + 1}`}
              className={`h-2 flex-1 rounded-full ${itemIndex === index ? 'bg-primary' : Number.isInteger(attempt.answers[item.id]) ? 'bg-emerald-400' : 'bg-muted'}`}
            />
          ))}
        </div>
        {question && (
          <section className={`${panelClass} p-5 sm:p-8`}>
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 font-black text-primary">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="whitespace-pre-wrap text-lg font-semibold leading-8">
                  {question.stem}
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
                    disabled={reviewing}
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
                      void savePreformedAttempt(next);
                    }}
                    className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${reveal && correct ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' : reveal && selected && !correct ? 'border-red-400 bg-red-50 dark:bg-red-500/10' : selected ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/40'}`}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background font-bold">
                      {String.fromCharCode(65 + displayIndex)}
                    </span>
                    <span className="pt-1 text-sm font-medium">
                      {question.options[optionIndex]}
                    </span>
                  </button>
                );
              })}
            </div>
            {reveal && (question.explanation || question.sourceReference) && (
              <div className="mt-6 rounded-2xl bg-muted p-5">
                <p className="font-bold">Explanation</p>
                {question.explanation && (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                    {question.explanation}
                  </p>
                )}
                {question.sourceReference && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Source: {question.sourceReference}
                  </p>
                )}
              </div>
            )}
          </section>
        )}
        <div className="mt-5 flex items-center justify-between">
          <button
            disabled={index === 0 || !attempt.test.settings.allowBackNavigation}
            onClick={() => setIndex((current) => Math.max(0, current - 1))}
            className="q-button q-button-secondary"
          >
            <ChevronLeft className="size-4" />
            Previous
          </button>
          {index < ordered.length - 1 ? (
            <button
              disabled={!Number.isInteger(selectedAnswer)}
              onClick={() => setIndex((current) => current + 1)}
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
              {busy ? 'Submitting…' : 'Submit test'}
            </button>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200"
          >
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

export function PreformedTestsWorkspace({
  user,
  onUpgrade,
  onTestEntered,
}: {
  user: AppUser;
  onUpgrade: () => void;
  onTestEntered?: () => void;
}) {
  const [tests, setTests] = useState<PreformedTestSummary[]>([]);
  const [tab, setTab] = useState<'mine' | 'public'>('mine');
  const [joinCode, setJoinCode] = useState('');
  const [runningCode, setRunningCode] = useState('');
  const [editing, setEditing] = useState<PreformedTestDocument>();
  const [stats, setStats] = useState<ManageResponse>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadSequence = useRef(0);
  const canCreate = ['pro', 'unlimited'].includes(
    user.effectivePlan ?? user.tier,
  );
  const load = useCallback(
    async (force = false, silent = false) => {
      const sequence = ++loadSequence.current;
      if (!silent) {
        setBusy(true);
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
        if (sequence === loadSequence.current) setTests(value.tests);
      } catch (caught) {
        if (!silent && sequence === loadSequence.current)
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not load ready-made tests.',
          );
      } finally {
        if (!silent) setBusy(false);
      }
    },
    [user.uid],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(
    () => subscribeLive(() => void load(true, true), ['preformed-tests']),
    [load],
  );
  const create = async () => {
    if (!canCreate) return onUpgrade();
    setBusy(true);
    setError('');
    try {
      const value = await api<{ test: PreformedTestDocument }>(
        '/preformed/create',
        { method: 'POST', body: '{}' },
      );
      setEditing(value.test);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not create a test.',
      );
    } finally {
      setBusy(false);
    }
  };
  const edit = async (id: string, showStats = false) => {
    setBusy(true);
    setError('');
    try {
      const value = await api<ManageResponse>(
        `/preformed/manage?id=${encodeURIComponent(id)}`,
        { forceRefresh: true, requestReason: 'user-transaction' },
      );
      if (showStats) setStats(value);
      else setEditing(value.test);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not load this test.',
      );
    } finally {
      setBusy(false);
    }
  };
  const share = async (code: string) => {
    await navigator.clipboard.writeText(testUrl(code));
  };
  const rotate = async (id: string) => {
    if (
      !window.confirm('Create a new join code? The old code will stop working.')
    )
      return;
    const value = await api<{ code: string }>('/preformed/rotate-code', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    setTests((current) =>
      current.map((item) =>
        item.id === id ? { ...item, code: value.code } : item,
      ),
    );
  };
  const remove = async (test: PreformedTestSummary) => {
    if (
      !window.confirm(
        `Delete “${test.title}” and all of its results permanently?`,
      )
    )
      return;
    setBusy(true);
    try {
      await deleteQBankImages(`preformed-${test.id}`);
      await api('/preformed/delete', {
        method: 'DELETE',
        body: JSON.stringify({ id: test.id }),
      });
      setTests((current) => current.filter((item) => item.id !== test.id));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not delete the test.',
      );
    } finally {
      setBusy(false);
    }
  };
  const report = async (id: string) => {
    const reason = window.prompt('What should the Superadmin review?');
    if (!reason?.trim()) return;
    await api('/preformed/report', {
      method: 'POST',
      body: JSON.stringify({ id, reason }),
    });
    setError('Report sent. Thank you.');
  };
  const moderate = async (id: string) => {
    if (!window.confirm('Hide this public test from participants?')) return;
    await api('/preformed/moderate', {
      method: 'PUT',
      body: JSON.stringify({ id, hidden: true }),
    });
    setTests((current) => current.filter((item) => item.id !== id));
  };
  const visible = tests.filter((item) =>
    tab === 'mine'
      ? item.ownerId === user.uid
      : item.visibility === 'public' && item.status === 'published',
  );

  if (runningCode)
    return (
      <PreformedTestRunner
        user={user}
        code={runningCode}
        onClose={() => setRunningCode('')}
        onJoinQraft={() => undefined}
        onTestEntered={onTestEntered}
      />
    );
  return (
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
                setRunningCode(
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
          disabled={busy}
          className="q-button q-button-secondary"
        >
          <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        {tab === 'mine' && (
          <button
            onClick={() => void create()}
            className="q-button q-button-primary ml-auto"
          >
            <span className="relative">
              <Plus className="size-4" />
              {!canCreate && (
                <LockKeyhole className="absolute -right-2 -top-2 size-3 rounded-full bg-white text-amber-600" />
              )}
            </span>
            New test
          </button>
        )}
      </div>
      {error && (
        <output className="mt-4 block rounded-xl bg-muted p-3 text-sm">
          {error}
        </output>
      )}
      {!visible.length && !busy ? (
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
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <button
                  disabled={test.status !== 'published'}
                  title={
                    test.status !== 'published'
                      ? 'Publish this test before opening it.'
                      : undefined
                  }
                  onClick={() => setRunningCode(test.code)}
                  className="q-button q-button-primary"
                >
                  <Eye className="size-4" />
                  {test.status === 'published' ? 'Open' : test.status}
                </button>
                {test.ownerId === user.uid ? (
                  <>
                    <button
                      onClick={() => void edit(test.id)}
                      className="q-button q-button-secondary"
                    >
                      <Pencil className="size-4" />
                      Edit
                    </button>
                    <button
                      onClick={() => void edit(test.id, true)}
                      className="q-button q-button-secondary"
                    >
                      <BarChart3 className="size-4" />
                      Stats
                    </button>
                    <button
                      title="Copy share link"
                      onClick={() => void share(test.code)}
                      className="q-button q-button-secondary px-3"
                    >
                      <Copy className="size-4" />
                    </button>
                    <button
                      title="Rotate code"
                      onClick={() => void rotate(test.id)}
                      className="q-button q-button-secondary px-3"
                    >
                      <RotateCcw className="size-4" />
                    </button>
                    <button
                      title="Delete"
                      onClick={() => void remove(test)}
                      className="q-button q-button-secondary px-3 text-red-600"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() =>
                        void api<{ leaderboard: PreformedLeaderboardEntry[] }>(
                          `/preformed/leaderboard?id=${test.id}`,
                        ).then((value) =>
                          setStats({
                            test: {
                              ...test,
                              questions: [],
                              hasPasscode: false,
                            },
                            leaderboard: value.leaderboard,
                            questionStats: [],
                          }),
                        )
                      }
                      className="q-button q-button-secondary"
                    >
                      <Trophy className="size-4" />
                      Board
                    </button>
                    <button
                      title="Report"
                      onClick={() => void report(test.id)}
                      className="q-button q-button-secondary px-3"
                    >
                      <Flag className="size-4" />
                    </button>
                    {user.role === 'super_admin' && user.mfaVerified && (
                      <button
                        onClick={() => void moderate(test.id)}
                        className="q-button q-button-secondary px-3 text-red-600"
                      >
                        <ShieldAlert className="size-4" />
                      </button>
                    )}
                  </>
                )}
              </div>
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
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/45 p-4 sm:p-8">
          <section className="mx-auto max-w-4xl rounded-3xl bg-card p-5 shadow-2xl sm:p-7">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-primary">RESULTS</p>
                <h2 className="truncate text-2xl font-black">
                  {stats.test.title}
                </h2>
              </div>
              {stats.test.ownerId === user.uid && (
                <button
                  onClick={() => downloadResults(stats.test, stats.leaderboard)}
                  className="q-button q-button-secondary"
                >
                  <Download className="size-4" />
                  Export CSV
                </button>
              )}
              <button
                onClick={() => setStats(undefined)}
                className="grid size-10 place-items-center rounded-xl hover:bg-muted"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
              <Leaderboard entries={stats.leaderboard} />
              <div>
                <h3 className="mb-3 font-bold">Question performance</h3>
                {stats.questionStats.length ? (
                  <div className="space-y-2">
                    {stats.test.questions.map((question, index) => {
                      const stat = stats.questionStats.find(
                        (item) => item.questionId === question.id,
                      );
                      const rate = stat?.submissions
                        ? Math.round((stat.correct / stat.submissions) * 100)
                        : 0;
                      return (
                        <div
                          key={question.id}
                          className="rounded-xl border p-3"
                        >
                          <p className="line-clamp-2 text-xs font-semibold">
                            {index + 1}. {question.stem}
                          </p>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${rate}%` }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {rate}% correct · {stat?.submissions ?? 0} signed-in
                            submissions
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Detailed analytics are available to the creator.
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
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
