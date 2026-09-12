'use client';

/* oxlint-disable next/no-img-element, typescript/no-deprecated */

import {
  Archive,
  ArrowLeft,
  Brain,
  Check,
  ChevronRight,
  FileArchive,
  Folder,
  FolderPlus,
  ImagePlus,
  Layers3,
  Menu,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { unzipSync } from 'fflate';
import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  type Card,
  type Grade,
} from 'ts-fsrs';
import sqlWasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { deleteFlashcardDeck } from '@/lib/flashcard-deletion';
import { cn } from '@/lib/utils';
import { uploadNoteImage } from '@/lib/application-services';
import type {
  AppState,
  Flashcard,
  FlashcardDeck,
  FlashcardLearningState,
  FlashcardRating,
  FlashcardSchedule,
  FlashcardType,
  NoteImage,
  Question,
} from '@/lib/medguard-types';

const DECK_COLORS = ['#5b5bd6', '#0f9f76', '#e08a19', '#db4b68', '#1686b8'];
const IMAGE_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const AUDIO_TYPES = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);
const MAX_ANKI_SIZE = 12 * 1024 * 1024;
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const MAX_IMPORT_CARDS = 5000;

type UpdateState = Dispatch<SetStateAction<AppState>>;

interface CardDraft {
  type: FlashcardType;
  front: string;
  back: string;
  deckId: string;
  tags: string;
  image?: NoteImage;
  makeReverse: boolean;
}

interface ImportReport {
  imported: number;
  duplicates: number;
  skipped: number;
  ignoredAudio: number;
  skippedImages: number;
  message?: string;
}

function normalized(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function normalizeTags(value: string | string[]) {
  const items = Array.isArray(value) ? value : value.split(/[;,]/);
  return [...new Set(items.map((tag) => tag.trim()).filter(Boolean))].slice(
    0,
    20,
  );
}

function formatDue(value: string) {
  const due = new Date(value);
  const now = new Date();
  if (due <= now) return 'Due now';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(due);
}

function stateFromFsrs(state: State): FlashcardLearningState {
  if (state === State.Learning) return 'learning';
  if (state === State.Review) return 'review';
  if (state === State.Relearning) return 'relearning';
  return 'new';
}

function stateToFsrs(state: FlashcardLearningState): State {
  if (state === 'learning') return State.Learning;
  if (state === 'review') return State.Review;
  if (state === 'relearning') return State.Relearning;
  return State.New;
}

function scheduleToCard(schedule?: FlashcardSchedule): Card {
  if (!schedule) return createEmptyCard(new Date());
  return {
    due: new Date(schedule.due),
    stability: schedule.stability,
    difficulty: schedule.difficulty,
    elapsed_days: schedule.elapsedDays,
    scheduled_days: schedule.scheduledDays,
    learning_steps: schedule.learningSteps,
    reps: schedule.reps,
    lapses: schedule.lapses,
    state: stateToFsrs(schedule.state),
    last_review: schedule.lastReview
      ? new Date(schedule.lastReview)
      : undefined,
  };
}

function cardToSchedule(cardId: string, card: Card): FlashcardSchedule {
  return {
    cardId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: stateFromFsrs(card.state),
    lastReview: card.last_review?.toISOString(),
  };
}

function renderCloze(value: string, revealed: boolean) {
  return value.replace(
    /\{\{c\d+::(.*?)(?:::(.*?))?\}\}/gi,
    (_, answer: string, hint?: string) =>
      revealed ? answer : `[${hint?.trim() || '…'}]`,
  );
}

function htmlToText(value: string) {
  const withoutAudio = value.replace(/\[sound:[^\]]+\]/gi, '');
  const document = new DOMParser().parseFromString(withoutAudio, 'text/html');
  document
    .querySelectorAll('script,style,audio,video,source')
    .forEach((node) => node.remove());
  document.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  document.querySelectorAll('div,p,li').forEach((node) => node.append('\n'));
  return (document.body.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstImageName(value: string) {
  const document = new DOMParser().parseFromString(value, 'text/html');
  const source = document.querySelector('img')?.getAttribute('src') ?? '';
  try {
    return decodeURIComponent(source).replace(/^.*[\\/]/, '');
  } catch {
    return source.replace(/^.*[\\/]/, '');
  }
}

async function fileToImage(file: File, qbankId: string): Promise<NoteImage> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > MAX_IMAGE_SIZE)
    throw new Error('Images must be 2 MB or smaller.');
  if (!navigator.onLine)
    throw new Error('Connect to the internet before adding a card image.');
  const url = await uploadNoteImage(
    'current-user',
    file,
    qbankId,
    `flashcard-${crypto.randomUUID()}`,
  );
  return {
    id: crypto.randomUUID(),
    url,
    name: file.name,
    caption: '',
  };
}

function descendants(decks: FlashcardDeck[], id: string) {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    decks.forEach((deck) => {
      if (deck.parentId && ids.has(deck.parentId) && !ids.has(deck.id)) {
        ids.add(deck.id);
        changed = true;
      }
    });
  }
  return ids;
}

function uniqueDeckName(
  decks: FlashcardDeck[],
  qbankId: string,
  name: string,
  parentId?: string,
) {
  return !decks.some(
    (deck) =>
      deck.qbankId === qbankId &&
      deck.parentId === parentId &&
      normalized(deck.name) === normalized(name),
  );
}

function addCardsFromDraft(
  draft: CardDraft,
  qbankId: string,
  sourceQuestionId?: string,
  existingId?: string,
) {
  const now = new Date().toISOString();
  const id = existingId ?? crypto.randomUUID();
  const base: Flashcard = {
    id,
    deckId: draft.deckId,
    qbankId,
    type: draft.type,
    front: draft.front.trim(),
    back: draft.back.trim(),
    tags: normalizeTags(draft.tags),
    image: draft.image,
    sourceQuestionId,
    createdAt: now,
    updatedAt: now,
  };
  if (!draft.makeReverse || draft.type !== 'basic') return [base];
  return [
    base,
    {
      ...base,
      id: crypto.randomUUID(),
      front: base.back,
      back: base.front,
      reverseOfId: base.id,
    },
  ];
}

function CardEditorDialog({
  open,
  onOpenChange,
  qbankId,
  decks,
  initial,
  title = 'Create flashcard',
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  qbankId: string;
  decks: FlashcardDeck[];
  initial?: Partial<CardDraft>;
  title?: string;
  onSave: (draft: CardDraft) => void;
}) {
  const availableDecks = decks.filter((deck) => deck.qbankId === qbankId);
  const firstDeck = initial?.deckId ?? availableDecks[0]?.id ?? '';
  const [draft, setDraft] = useState<CardDraft>({
    type: initial?.type ?? 'basic',
    front: initial?.front ?? '',
    back: initial?.back ?? '',
    deckId: firstDeck,
    tags: initial?.tags ?? '',
    image: initial?.image,
    makeReverse: initial?.makeReverse ?? false,
  });
  const [error, setError] = useState('');

  function save() {
    if (!draft.deckId) return setError('Create or choose a deck first.');
    if (!draft.front.trim() || !draft.back.trim())
      return setError('Front and back are required.');
    if (draft.type === 'cloze' && !/\{\{c\d+::.+?\}\}/i.test(draft.front))
      return setError('Cloze cards need text such as {{c1::answer}}.');
    onSave(draft);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Review the card before saving it to your private collection.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label
            htmlFor="flashcard-type"
            className="grid gap-1.5 text-sm font-semibold"
          >
            Card type
            <select
              id="flashcard-type"
              value={draft.type}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  type: event.target.value as FlashcardType,
                  makeReverse: false,
                })
              }
              className="min-h-11 rounded-xl border bg-background px-3"
            >
              <option value="basic">Basic</option>
              <option value="cloze">Cloze</option>
              <option value="image">Image</option>
            </select>
          </label>
          <label
            htmlFor="flashcard-front"
            className="grid gap-1.5 text-sm font-semibold"
          >
            Front
            <Textarea
              id="flashcard-front"
              dir="auto"
              value={draft.front}
              onChange={(event) =>
                setDraft({ ...draft, front: event.target.value })
              }
              placeholder={
                draft.type === 'cloze'
                  ? 'The {{c1::mitral valve}} lies between the left atrium and ventricle.'
                  : 'What do you want to remember?'
              }
              className="min-h-32"
            />
          </label>
          <label
            htmlFor="flashcard-back"
            className="grid gap-1.5 text-sm font-semibold"
          >
            Back
            <Textarea
              id="flashcard-back"
              dir="auto"
              value={draft.back}
              onChange={(event) =>
                setDraft({ ...draft, back: event.target.value })
              }
              placeholder="Answer or explanation"
              className="min-h-28"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label
              htmlFor="flashcard-deck"
              className="grid gap-1.5 text-sm font-semibold"
            >
              Deck
              <select
                id="flashcard-deck"
                value={draft.deckId}
                onChange={(event) =>
                  setDraft({ ...draft, deckId: event.target.value })
                }
                className="min-h-11 rounded-xl border bg-background px-3"
              >
                <option value="">Choose a deck</option>
                {availableDecks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.parentId ? '↳ ' : ''}
                    {deck.name}
                  </option>
                ))}
              </select>
            </label>
            <label
              htmlFor="flashcard-tags"
              className="grid gap-1.5 text-sm font-semibold"
            >
              Tags
              <Input
                id="flashcard-tags"
                value={draft.tags}
                onChange={(event) =>
                  setDraft({ ...draft, tags: event.target.value })
                }
                placeholder="High Yield, Trauma"
                className="min-h-11"
              />
            </label>
          </div>
          {draft.type === 'basic' && (
            <label className="flex min-h-11 items-center gap-3 rounded-xl border p-3 text-sm font-semibold">
              <input
                type="checkbox"
                checked={draft.makeReverse}
                onChange={(event) =>
                  setDraft({ ...draft, makeReverse: event.target.checked })
                }
                className="size-4 accent-primary"
              />
              Also create a reverse card
            </label>
          )}
          {draft.type === 'image' && (
            <label className="flex min-h-24 cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/20 p-4 text-sm font-semibold hover:bg-muted/40">
              <ImagePlus className="size-5 text-primary" />
              {draft.image ? draft.image.name : 'Choose an image (max 2 MB)'}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void fileToImage(file, qbankId)
                    .then((image) => setDraft({ ...draft, image }))
                    .catch((reason: Error) => setError(reason.message));
                  event.target.value = '';
                }}
              />
            </label>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save flashcard</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QuestionFlashcardDialog({
  question,
  qbankId,
  state,
  setState,
  open,
  onOpenChange,
}: {
  question: Question;
  qbankId: string;
  state: AppState;
  setState: UpdateState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const now = new Date().toISOString();
  let decks = state.flashcardDecks;
  let deck = decks.find(
    (item) =>
      item.qbankId === qbankId && normalized(item.name) === 'from questions',
  );
  if (!deck) {
    deck = {
      id: crypto.randomUUID(),
      name: 'From Questions',
      qbankId,
      color: DECK_COLORS[0],
      createdAt: now,
      updatedAt: now,
    };
    decks = [...decks, deck];
  }
  return (
    <CardEditorDialog
      key={`${question.id}:${open}`}
      open={open}
      onOpenChange={onOpenChange}
      qbankId={qbankId}
      decks={decks}
      title="Create flashcard from question"
      initial={{
        front: question.stem,
        back: `${question.answerLetter}. ${question.options[question.answer]}${question.explanation?.trim() ? `\n\n${question.explanation.trim()}` : ''}`,
        deckId: deck.id,
        tags: `${question.specialty}, ${question.topic}`,
      }}
      onSave={(draft) =>
        setState((current) => {
          const currentDeck = current.flashcardDecks.some(
            (item) => item.id === draft.deckId,
          );
          return {
            ...current,
            flashcardDecks: currentDeck
              ? current.flashcardDecks
              : [...current.flashcardDecks, deck],
            flashcards: [
              ...addCardsFromDraft(draft, qbankId, question.id),
              ...current.flashcards,
            ],
          };
        })
      }
    />
  );
}

function ReviewSession({
  cards,
  state,
  setState,
  onClose,
}: {
  cards: Flashcard[];
  state: AppState;
  setState: UpdateState;
  onClose: () => void;
}) {
  const [queue, setQueue] = useState(cards);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [reviewNow] = useState(() => new Date());
  const card = queue[0];
  const scheduler = useMemo(
    () =>
      fsrs({
        request_retention: state.flashcardSettings.desiredRetention,
        maximum_interval: 36500,
      }),
    [state.flashcardSettings.desiredRetention],
  );
  const previews = card
    ? scheduler.repeat(
        scheduleToCard(state.flashcardSchedules[card.id]),
        reviewNow,
      )
    : undefined;

  function rate(rating: FlashcardRating, grade: Grade) {
    if (!card) return;
    const result = scheduler.next(
      scheduleToCard(state.flashcardSchedules[card.id]),
      new Date(),
      grade,
    );
    setState((current) => ({
      ...current,
      flashcardSchedules: {
        ...current.flashcardSchedules,
        [card.id]: cardToSchedule(card.id, result.card),
      },
      flashcardReviewLog: [
        ...current.flashcardReviewLog,
        {
          id: crypto.randomUUID(),
          cardId: card.id,
          rating,
          reviewedAt: new Date().toISOString(),
          scheduledDays: result.card.scheduled_days,
        },
      ].slice(-5000),
    }));
    setReviewed((value) => value + 1);
    setQueue((current) => current.slice(1));
    setRevealed(false);
  }

  if (!card)
    return (
      <section className="grid min-h-[70dvh] place-items-center p-5">
        <div className="max-w-md text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600">
            <Check className="size-8" />
          </div>
          <h2 className="mt-5 text-2xl font-black">Review complete</h2>
          <p className="mt-2 text-muted-foreground">
            You reviewed {reviewed} card{reviewed === 1 ? '' : 's'}. Your next
            reviews are scheduled automatically.
          </p>
          <Button className="mt-6" onClick={onClose}>
            Back to flashcards
          </Button>
        </div>
      </section>
    );

  const dueLabel = (grade: Grade) => {
    const due = previews?.[grade].card.due;
    if (!due) return '';
    const minutes = Math.max(
      1,
      Math.round((due.getTime() - reviewNow.getTime()) / 60000),
    );
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
    return `${Math.round(minutes / 1440)}d`;
  };

  return (
    <section className="min-h-full bg-muted/20 p-4 sm:p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={onClose}>
            <ArrowLeft /> Exit review
          </Button>
          <span className="text-sm font-bold text-muted-foreground">
            {reviewed + 1} / {reviewed + queue.length}
          </span>
        </div>
        <article className="grid min-h-[480px] place-items-center rounded-3xl border bg-card p-6 text-center shadow-sm sm:p-12">
          <div className="w-full max-w-2xl">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-primary">
              {card.type}
            </span>
            {card.image && (
              <img
                src={card.image.url}
                alt={card.image.caption || card.image.name}
                className="mx-auto mt-6 max-h-64 rounded-2xl object-contain"
              />
            )}
            <p
              dir="auto"
              className="mt-7 whitespace-pre-wrap text-xl font-bold leading-9 sm:text-2xl"
            >
              {card.type === 'cloze'
                ? renderCloze(card.front, revealed)
                : card.front}
            </p>
            {revealed && (
              <div className="mt-8 border-t pt-8">
                <p
                  dir="auto"
                  className="whitespace-pre-wrap text-lg leading-8 text-muted-foreground"
                >
                  {card.back}
                </p>
              </div>
            )}
          </div>
        </article>
        {!revealed ? (
          <Button
            className="mt-5 min-h-12 w-full text-base"
            onClick={() => setRevealed(true)}
          >
            Show answer
          </Button>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['again', Rating.Again, 'Again', 'text-red-600'],
                ['hard', Rating.Hard, 'Hard', 'text-amber-600'],
                ['good', Rating.Good, 'Good', 'text-blue-600'],
                ['easy', Rating.Easy, 'Easy', 'text-emerald-600'],
              ] as const
            ).map(([key, grade, label, color]) => (
              <Button
                key={key}
                variant="outline"
                className={cn('min-h-14 flex-col gap-0.5', color)}
                onClick={() => rate(key, grade)}
              >
                <strong>{label}</strong>
                <span className="text-[11px] text-muted-foreground">
                  {dueLabel(grade)}
                </span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function FlashcardsWorkspace({
  state,
  setState,
  qbankId,
  qbankName,
  questions,
  onReviewActiveChange,
  onReviewCheckpoint,
}: {
  state: AppState;
  setState: UpdateState;
  qbankId: string;
  qbankName: string;
  questions: Question[];
  onReviewActiveChange?: (active: boolean) => void;
  onReviewCheckpoint?: () => void;
}) {
  const [selectedDeckId, setSelectedDeckId] = useState('all');
  const [deleteDeckId, setDeleteDeckId] = useState<string>();
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard>();
  const [deckDialogOpen, setDeckDialogOpen] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [parentDeckId, setParentDeckId] = useState('');
  const [deckError, setDeckError] = useState('');
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [moveDeckId, setMoveDeckId] = useState('');
  const [reviewCards, setReviewCards] = useState<Flashcard[]>();

  useEffect(() => {
    if (!reviewCards) return;
    onReviewActiveChange?.(true);
    return () => {
      onReviewActiveChange?.(false);
      onReviewCheckpoint?.();
    };
  }, [onReviewActiveChange, onReviewCheckpoint, reviewCards]);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport>();
  const [currentTime] = useState(() => Date.now());
  const importInput = useRef<HTMLInputElement>(null);
  const decks = state.flashcardDecks.filter((deck) => deck.qbankId === qbankId);
  const bankCards = state.flashcards.filter((card) => card.qbankId === qbankId);
  const selectedDeckIds =
    selectedDeckId === 'all' ? undefined : descendants(decks, selectedDeckId);
  const visibleCards = bankCards.filter((card) => {
    if (selectedDeckIds && !selectedDeckIds.has(card.deckId)) return false;
    const query = normalized(search);
    return (
      !query ||
      normalized(`${card.front} ${card.back} ${card.tags.join(' ')}`).includes(
        query,
      )
    );
  });
  const dueCards = bankCards.filter(
    (card) =>
      !card.suspended &&
      state.flashcardSchedules[card.id] &&
      new Date(state.flashcardSchedules[card.id].due).getTime() <= currentTime,
  );
  const newCards = bankCards.filter(
    (card) => !card.suspended && !state.flashcardSchedules[card.id],
  );
  const studyCards = [
    ...dueCards.slice(0, state.flashcardSettings.dailyReviewLimit),
    ...newCards.slice(0, state.flashcardSettings.dailyNewLimit),
  ];
  const accuracy = state.flashcardReviewLog.filter((log) =>
    bankCards.some((card) => card.id === log.cardId),
  );
  const remembered = accuracy.filter(
    (log) => log.rating === 'good' || log.rating === 'easy',
  ).length;
  const metrics = [
    {
      label: 'Due today',
      value: dueCards.length,
      Icon: Brain,
      color: 'text-violet-600 bg-violet-500/10',
    },
    {
      label: 'New cards',
      value: newCards.length,
      Icon: Sparkles,
      color: 'text-blue-600 bg-blue-500/10',
    },
    {
      label: 'Decks',
      value: decks.length,
      Icon: Layers3,
      color: 'text-amber-600 bg-amber-500/10',
    },
    {
      label: 'Remembered',
      value: accuracy.length
        ? `${Math.round((remembered / accuracy.length) * 100)}%`
        : '—',
      Icon: Check,
      color: 'text-emerald-600 bg-emerald-500/10',
    },
  ];

  function ensureDeck() {
    const existing = state.flashcardDecks.find(
      (deck) =>
        deck.qbankId === qbankId && normalized(deck.name) === 'my cards',
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    const deck: FlashcardDeck = {
      id: crypto.randomUUID(),
      name: 'My Cards',
      qbankId,
      color: DECK_COLORS[0],
      createdAt: now,
      updatedAt: now,
    };
    setState((current) => ({
      ...current,
      flashcardDecks: [...current.flashcardDecks, deck],
    }));
    return deck;
  }

  function openNewCard() {
    ensureDeck();
    setEditingCard(undefined);
    setEditorOpen(true);
  }

  function saveDeck() {
    const name = deckName.trim().replace(/\s+/g, ' ');
    if (!name) return setDeckError('Enter a deck name.');
    if (
      !uniqueDeckName(
        state.flashcardDecks,
        qbankId,
        name,
        parentDeckId || undefined,
      )
    )
      return setDeckError('A deck with this name already exists here.');
    const now = new Date().toISOString();
    setState((current) => ({
      ...current,
      flashcardDecks: [
        ...current.flashcardDecks,
        {
          id: crypto.randomUUID(),
          name,
          qbankId,
          parentId: parentDeckId || undefined,
          color:
            DECK_COLORS[current.flashcardDecks.length % DECK_COLORS.length],
          createdAt: now,
          updatedAt: now,
        },
      ],
    }));
    setDeckName('');
    setParentDeckId('');
    setDeckError('');
    setDeckDialogOpen(false);
  }

  function deleteCards(ids: string[]) {
    const targets = new Set(ids);
    setState((current) => ({
      ...current,
      flashcards: current.flashcards.filter((card) => !targets.has(card.id)),
      flashcardSchedules: Object.fromEntries(
        Object.entries(current.flashcardSchedules).filter(
          ([id]) => !targets.has(id),
        ),
      ),
      flashcardReviewLog: current.flashcardReviewLog.filter(
        (log) => !targets.has(log.cardId),
      ),
    }));
    setSelectedCards([]);
  }

  async function importAnki(file: File) {
    setImporting(true);
    setImportReport(undefined);
    try {
      if (!file.name.toLowerCase().endsWith('.apkg'))
        throw new Error('Choose an Anki .apkg file.');
      if (file.size > MAX_ANKI_SIZE)
        throw new Error('Anki packages must be 12 MB or smaller.');
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const collection =
        archive['collection.anki21'] ?? archive['collection.anki2'];
      if (!collection) {
        if (archive['collection.anki21b'] || archive['collection.21b'])
          throw new Error(
            'This package uses Anki’s newest compressed format. Export it again with “Support older Anki versions” enabled, then retry.',
          );
        throw new Error(
          'No readable Anki collection was found in this package.',
        );
      }
      const initSqlJs = (await import('sql.js/dist/sql-wasm-browser.js'))
        .default;
      const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
      const database = new SQL.Database(collection);
      const deckResult = database.exec('SELECT decks FROM col LIMIT 1')[0];
      const deckJson = String(deckResult?.values[0]?.[0] ?? '{}');
      const ankiDecks = JSON.parse(deckJson) as Record<
        string,
        { name?: string }
      >;
      const cardResult = database.exec(
        'SELECT n.guid,n.flds,n.tags,c.did,c.ord FROM notes n JOIN cards c ON c.nid=n.id ORDER BY c.id LIMIT 5001',
      )[0];
      database.close();
      if (!cardResult?.values.length)
        throw new Error('The Anki package does not contain readable cards.');
      if (cardResult.values.length > MAX_IMPORT_CARDS)
        throw new Error(`Import up to ${MAX_IMPORT_CARDS} cards at a time.`);
      const mediaMap = archive.media
        ? (JSON.parse(new TextDecoder().decode(archive.media)) as Record<
            string,
            string
          >)
        : {};
      const mediaByName = new Map(
        Object.entries(mediaMap).map(([key, value]) => [value, archive[key]]),
      );
      const currentDecks = [...state.flashcardDecks];
      const createdDecks: FlashcardDeck[] = [];
      const deckByPath = new Map<string, FlashcardDeck>();
      const existingGuids = new Set(
        state.flashcards.map((card) => card.importedGuid).filter(Boolean),
      );
      let duplicates = 0;
      let skipped = 0;
      let ignoredAudio = 0;
      let skippedImages = 0;
      const imported: Flashcard[] = [];
      const uploadedImages = new Map<string, NoteImage | undefined>();

      const resolveDeck = (path: string) => {
        const parts = path
          .split('::')
          .map((part) => part.trim())
          .filter(Boolean);
        let parentId: string | undefined;
        let fullPath = '';
        for (const part of parts.length
          ? parts
          : [file.name.replace(/\.apkg$/i, '')]) {
          fullPath = fullPath ? `${fullPath}::${part}` : part;
          let deck = deckByPath.get(fullPath);
          if (!deck) {
            deck = [...currentDecks, ...createdDecks].find(
              (item) =>
                item.qbankId === qbankId &&
                item.parentId === parentId &&
                normalized(item.name) === normalized(part),
            );
          }
          if (!deck) {
            const timestamp = new Date().toISOString();
            deck = {
              id: crypto.randomUUID(),
              name: part,
              qbankId,
              parentId,
              color: DECK_COLORS[createdDecks.length % DECK_COLORS.length],
              createdAt: timestamp,
              updatedAt: timestamp,
              importedFrom: file.name,
            };
            createdDecks.push(deck);
          }
          deckByPath.set(fullPath, deck);
          parentId = deck.id;
        }
        return deckByPath.get(fullPath)!;
      };

      for (const row of cardResult.values) {
        const guid = `${String(row[0])}:${String(row[4])}`;
        if (existingGuids.has(guid)) {
          duplicates++;
          continue;
        }
        const fields = String(row[1] ?? '').split('\x1f');
        const rawFront = fields[0] ?? '';
        const rawBack = fields.slice(1).join('\n\n');
        ignoredAudio += (rawFront.match(/\[sound:[^\]]+\]/gi) ?? []).length;
        ignoredAudio += (rawBack.match(/\[sound:[^\]]+\]/gi) ?? []).length;
        const cardOrdinal = Number(row[4] ?? 0);
        const isCloze = /\{\{c\d+::.+?\}\}/i.test(rawFront);
        const primaryFront = htmlToText(rawFront);
        const primaryBack = htmlToText(rawBack);
        const front = cardOrdinal > 0 && !isCloze ? primaryBack : primaryFront;
        const back = cardOrdinal > 0 && !isCloze ? primaryFront : primaryBack;
        if (!front || !back || front.length > 20_000 || back.length > 40_000) {
          skipped++;
          continue;
        }
        const deckName =
          ankiDecks[String(row[3])]?.name ?? file.name.replace(/\.apkg$/i, '');
        const deck = resolveDeck(deckName);
        const imageName = firstImageName(`${rawFront} ${rawBack}`);
        const imageBytes = imageName ? mediaByName.get(imageName) : undefined;
        const extension = imageName.split('.').pop()?.toLowerCase() ?? '';
        let image = uploadedImages.get(imageName);
        if (
          imageName &&
          imageBytes &&
          IMAGE_TYPES.has(extension) &&
          extension !== 'svg' &&
          imageBytes.length <= MAX_IMAGE_SIZE
        ) {
          if (!uploadedImages.has(imageName)) {
            const mime =
              extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
            try {
              image = await fileToImage(
                new File([imageBytes], imageName, { type: mime }),
                qbankId,
              );
            } catch {
              skippedImages++;
              image = undefined;
            }
            uploadedImages.set(imageName, image);
          }
        } else if (imageName && !AUDIO_TYPES.has(extension)) {
          skippedImages++;
        }
        if (imageName && AUDIO_TYPES.has(extension)) ignoredAudio++;
        const timestamp = new Date().toISOString();
        imported.push({
          id: crypto.randomUUID(),
          deckId: deck.id,
          qbankId,
          type: isCloze ? 'cloze' : image ? 'image' : 'basic',
          front: isCloze ? htmlToText(rawFront) : front,
          back,
          tags: normalizeTags(
            String(row[2] ?? '')
              .trim()
              .split(/\s+/),
          ),
          image,
          importedGuid: guid,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        existingGuids.add(guid);
      }
      while (
        imported.length &&
        JSON.stringify({
          ...state,
          flashcardDecks: [...state.flashcardDecks, ...createdDecks],
          flashcards: [...imported, ...state.flashcards],
        }).length > 1_750_000
      ) {
        imported.pop();
        skipped++;
      }
      setState((current) => ({
        ...current,
        flashcardDecks: [...current.flashcardDecks, ...createdDecks],
        flashcards: [...imported, ...current.flashcards],
      }));
      setImportReport({
        imported: imported.length,
        duplicates,
        skipped,
        ignoredAudio,
        skippedImages,
      });
    } catch (error) {
      setImportReport({
        imported: 0,
        duplicates: 0,
        skipped: 0,
        ignoredAudio: 0,
        skippedImages: 0,
        message: error instanceof Error ? error.message : 'Import failed.',
      });
    } finally {
      setImporting(false);
    }
  }

  if (reviewCards)
    return (
      <ReviewSession
        cards={reviewCards}
        state={state}
        setState={setState}
        onClose={() => setReviewCards(undefined)}
      />
    );

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <AlertDialog open={Boolean(deleteDeckId)} onOpenChange={(open) => { if (!open) setDeleteDeckId(undefined); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this deck?</AlertDialogTitle>
            <AlertDialogDescription>
              “{decks.find(deck => deck.id === deleteDeckId)?.name}” and its subdecks, cards, and study history will be deleted. Other decks are not affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={() => {
              if (!deleteDeckId) return;
              setState(current => deleteFlashcardDeck(current, deleteDeckId, qbankId));
              setSelectedDeckId('all'); setSelectedCards([]); setDeleteDeckId(undefined);
            }}>Delete deck</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="mx-auto max-w-[1440px]">
        <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="mb-4 lg:hidden"
              aria-label="Open navigation"
              onClick={() =>
                window.dispatchEvent(new Event('medguard-open-menu'))
              }
            >
              <Menu />
            </Button>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">
              Active recall
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">
              Flashcards
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Private decks for {qbankName}, scheduled around your memory with
              FSRS. {questions.length} bank questions can be converted into
              cards while you study.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDeckDialogOpen(true)}>
              <FolderPlus /> New deck
            </Button>
            <Button
              variant="outline"
              disabled={importing}
              onClick={() => importInput.current?.click()}
            >
              {importing ? <Sparkles className="animate-pulse" /> : <Upload />}
              {importing ? 'Importing…' : 'Import Anki'}
            </Button>
            <input
              ref={importInput}
              type="file"
              accept=".apkg,application/zip"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importAnki(file);
                event.target.value = '';
              }}
            />
            <Button onClick={openNewCard}>
              <Plus /> New card
            </Button>
          </div>
        </header>

        {importReport && (
          <section
            className={cn(
              'mt-5 rounded-2xl border p-4',
              importReport.message
                ? 'border-destructive/30 bg-destructive/5'
                : 'border-emerald-500/30 bg-emerald-500/5',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold">
                  {importReport.message
                    ? 'Anki import needs attention'
                    : 'Anki import complete'}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {importReport.message ??
                    `${importReport.imported} imported · ${importReport.duplicates} duplicates skipped · ${importReport.skipped} invalid or over-limit cards skipped · ${importReport.ignoredAudio} audio references ignored · ${importReport.skippedImages} unreadable images skipped.`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setImportReport(undefined)}
                aria-label="Dismiss import report"
              >
                <X />
              </Button>
            </div>
          </section>
        )}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ label, value, Icon, color }) => (
            <article
              key={String(label)}
              className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm"
            >
              <span
                className={cn(
                  'grid size-11 place-items-center rounded-xl',
                  color,
                )}
              >
                <Icon className="size-5" />
              </span>
              <div>
                <p className="text-xs font-bold text-muted-foreground">
                  {label}
                </p>
                <strong className="text-2xl tabular-nums">{value}</strong>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 sm:flex sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black">Today’s review</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {studyCards.length
                  ? `${studyCards.length} cards are ready.`
                  : 'You are caught up for now.'}
              </p>
            </div>
            <Button
              className="mt-4 min-h-11 sm:mt-0"
              disabled={!studyCards.length}
              onClick={() => setReviewCards(studyCards)}
            >
              <Play /> Study now
            </Button>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="self-start rounded-2xl border bg-card p-3 shadow-sm lg:sticky lg:top-5">
            <button
              onClick={() => setSelectedDeckId('all')}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold',
                selectedDeckId === 'all'
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted',
              )}
            >
              <Layers3 className="size-4" /> All cards{' '}
              <span className="ml-auto tabular-nums">{bankCards.length}</span>
            </button>
            <div className="my-3 border-t" />
            {selectedDeckId !== 'all' && <Button variant="ghost" className="mb-3 w-full text-destructive" onClick={() => setDeleteDeckId(selectedDeckId)}><Trash2 />Delete selected deck</Button>}
            {decks
              .filter((deck) => !deck.parentId)
              .map((deck) => (
                <div key={deck.id}>
                  <button
                    onClick={() => setSelectedDeckId(deck.id)}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold',
                      selectedDeckId === deck.id
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-muted',
                    )}
                  >
                    <Folder className="size-4" style={{ color: deck.color }} />
                    <span className="min-w-0 flex-1 truncate">{deck.name}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {
                        bankCards.filter((card) => card.deckId === deck.id)
                          .length
                      }
                    </span>
                  </button>
                  {decks
                    .filter((child) => child.parentId === deck.id)
                    .map((child) => (
                      <button
                        key={child.id}
                        onClick={() => setSelectedDeckId(child.id)}
                        className={cn(
                          'ml-5 flex min-h-10 w-[calc(100%-1.25rem)] items-center gap-2 rounded-xl px-3 text-left text-sm',
                          selectedDeckId === child.id
                            ? 'bg-primary/10 font-bold text-primary'
                            : 'text-muted-foreground hover:bg-muted',
                        )}
                      >
                        <ChevronRight className="size-3" />
                        <span className="min-w-0 flex-1 truncate">
                          {child.name}
                        </span>
                        <span className="text-xs tabular-nums">
                          {
                            bankCards.filter((card) => card.deckId === child.id)
                              .length
                          }
                        </span>
                      </button>
                    ))}
                </div>
              ))}
            {!decks.length && (
              <p className="p-4 text-center text-sm text-muted-foreground">
                Create your first deck to start organizing cards.
              </p>
            )}
          </aside>

          <section className="min-w-0">
            <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search flashcards"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search cards or tags"
                  className="min-h-11 pl-9"
                />
              </div>
              {selectedCards.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="px-2 text-sm">
                    {selectedCards.length} selected
                  </strong>
                  <select
                    value={moveDeckId}
                    onChange={(event) => setMoveDeckId(event.target.value)}
                    className="min-h-10 rounded-xl border bg-background px-3 text-sm"
                  >
                    <option value="">Move to…</option>
                    {decks.map((deck) => (
                      <option key={deck.id} value={deck.id}>
                        {deck.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    disabled={!moveDeckId}
                    onClick={() => {
                      const ids = new Set(selectedCards);
                      setState((current) => ({
                        ...current,
                        flashcards: current.flashcards.map((card) =>
                          ids.has(card.id)
                            ? {
                                ...card,
                                deckId: moveDeckId,
                                updatedAt: new Date().toISOString(),
                              }
                            : card,
                        ),
                      }));
                      setSelectedCards([]);
                      setMoveDeckId('');
                    }}
                  >
                    Move
                  </Button>
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => deleteCards(selectedCards)}
                  >
                    <Trash2 /> Delete
                  </Button>
                </div>
              )}
            </div>

            {visibleCards.length ? (
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {visibleCards.map((card) => {
                  const deck = decks.find((item) => item.id === card.deckId);
                  const checked = selectedCards.includes(card.id);
                  return (
                    <article
                      key={card.id}
                      className={cn(
                        'rounded-2xl border bg-card p-4 shadow-sm transition',
                        checked && 'border-primary ring-2 ring-primary/10',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setSelectedCards((current) =>
                              event.target.checked
                                ? [...current, card.id]
                                : current.filter((id) => id !== card.id),
                            )
                          }
                          aria-label="Select flashcard"
                          className="mt-1 size-4 accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-muted-foreground">
                            <span className="rounded-full bg-muted px-2 py-1 uppercase">
                              {card.type}
                            </span>
                            <span>{deck?.name ?? 'Unfiled'}</span>
                            {state.flashcardSchedules[card.id] && (
                              <span className="ml-auto">
                                {formatDue(
                                  state.flashcardSchedules[card.id].due,
                                )}
                              </span>
                            )}
                          </div>
                          <p
                            dir="auto"
                            className="mt-3 line-clamp-3 whitespace-pre-wrap font-bold leading-6"
                          >
                            {renderCloze(card.front, false)}
                          </p>
                          <p
                            dir="auto"
                            className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground"
                          >
                            {card.back}
                          </p>
                          {card.image && (
                            <img
                              src={card.image.url}
                              alt={card.image.caption || card.image.name}
                              className="mt-3 h-24 w-full rounded-xl object-contain bg-muted/30"
                            />
                          )}
                          {card.tags.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {card.tags.map((item) => (
                                <span
                                  key={item}
                                  className="inline-flex items-center gap-1 rounded-full bg-primary/7 px-2 py-1 text-[11px] font-bold text-primary"
                                >
                                  <Tag className="size-3" />
                                  {item}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Edit card"
                            onClick={() => {
                              setEditingCard(card);
                              setEditorOpen(true);
                            }}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Suspend card"
                            onClick={() =>
                              setState((current) => ({
                                ...current,
                                flashcards: current.flashcards.map((item) =>
                                  item.id === card.id
                                    ? { ...item, suspended: !item.suspended }
                                    : item,
                                ),
                              }))
                            }
                          >
                            <Archive
                              className={card.suspended ? 'text-amber-600' : ''}
                            />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Delete card"
                            className="text-destructive"
                            onClick={() => deleteCards([card.id])}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 grid min-h-80 place-items-center rounded-2xl border border-dashed bg-card p-8 text-center">
                <div>
                  <FileArchive className="mx-auto size-10 text-muted-foreground" />
                  <h2 className="mt-4 text-lg font-black">
                    No flashcards here yet
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Create one manually, convert a question, or import an Anki
                    deck.
                  </p>
                  <Button className="mt-5" onClick={openNewCard}>
                    <Plus /> Create card
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {editorOpen && (
        <CardEditorDialog
          key={editingCard?.id ?? 'new'}
          open
          onOpenChange={(open) => {
            setEditorOpen(open);
            if (!open) setEditingCard(undefined);
          }}
          qbankId={qbankId}
          decks={state.flashcardDecks}
          title={editingCard ? 'Edit flashcard' : 'Create flashcard'}
          initial={
            editingCard
              ? {
                  type: editingCard.type,
                  front: editingCard.front,
                  back: editingCard.back,
                  deckId: editingCard.deckId,
                  tags: editingCard.tags.join(', '),
                  image: editingCard.image,
                }
              : { deckId: decks[0]?.id ?? '' }
          }
          onSave={(draft) =>
            setState((current) =>
              editingCard
                ? {
                    ...current,
                    flashcards: current.flashcards.map((card) =>
                      card.id === editingCard.id
                        ? {
                            ...card,
                            type: draft.type,
                            front: draft.front.trim(),
                            back: draft.back.trim(),
                            deckId: draft.deckId,
                            tags: normalizeTags(draft.tags),
                            image: draft.image,
                            updatedAt: new Date().toISOString(),
                          }
                        : card,
                    ),
                  }
                : {
                    ...current,
                    flashcards: [
                      ...addCardsFromDraft(draft, qbankId),
                      ...current.flashcards,
                    ],
                  },
            )
          }
        />
      )}
      <Dialog open={deckDialogOpen} onOpenChange={setDeckDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create deck</DialogTitle>
            <DialogDescription>
              Use a parent deck to create a subdeck.
            </DialogDescription>
          </DialogHeader>
          <label
            htmlFor="new-deck-name"
            className="grid gap-1.5 text-sm font-semibold"
          >
            Deck name
            <Input
              id="new-deck-name"
              value={deckName}
              onChange={(event) => setDeckName(event.target.value)}
              className="min-h-11"
              placeholder="e.g. Trauma"
            />
          </label>
          <label
            htmlFor="parent-deck"
            className="grid gap-1.5 text-sm font-semibold"
          >
            Parent deck (optional)
            <select
              id="parent-deck"
              value={parentDeckId}
              onChange={(event) => setParentDeckId(event.target.value)}
              className="min-h-11 rounded-xl border bg-background px-3"
            >
              <option value="">Top level</option>
              {decks
                .filter((deck) => !deck.parentId)
                .map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
            </select>
          </label>
          {deckError && (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {deckError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeckDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveDeck}>Create deck</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
