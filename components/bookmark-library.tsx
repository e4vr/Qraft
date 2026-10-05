'use client';

import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Folder,
  ListChecks,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { FormattedQuestionText } from '@/components/formatted-question-text';
import { groupBookmarkedQuestions } from '@/features/qbanks/domain/bookmarks';
import type { QBank, Question } from '@/lib/medguard-types';

export function BookmarkLibrary({
  banks,
  questionPool,
  bookmarkedQuestionIds,
  onToggleBookmark,
  onStartBookmarks,
}: {
  banks: QBank[];
  questionPool: Question[];
  bookmarkedQuestionIds: string[];
  onToggleBookmark: (questionId: string) => void;
  onStartBookmarks: (
    bankId: string,
    questionIds: string[],
    title: string,
  ) => void;
}) {
  const [exploredBankId, setExploredBankId] = useState('');
  const groups = useMemo(
    () => groupBookmarkedQuestions(banks, questionPool, bookmarkedQuestionIds),
    [banks, questionPool, bookmarkedQuestionIds],
  );
  // Resolve against current access on every render, including live access changes.
  const exploredBank = banks.find((bank) => bank.id === exploredBankId);
  const exploredQuestions =
    groups.find((group) => group.bank.id === exploredBankId)?.questions ?? [];
  const study = (bank: QBank, questions: Question[]) => {
    if (questions.length)
      onStartBookmarks(
        bank.id,
        questions.map((question) => question.id),
        `${bank.shortName} Bookmarks`,
      );
  };

  if (exploredBank)
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setExploredBankId('')}
          className="q-button q-button-secondary"
        >
          <ArrowLeft className="size-4" /> Back to bookmark folders
        </button>
        <section
          className="overflow-hidden rounded-2xl bg-card ring-1 ring-border"
          aria-label={`${exploredBank.name} bookmarks`}
        >
          <header className="flex flex-wrap items-center gap-3 border-b p-4">
            <Folder className="size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-bold" title={exploredBank.name}>
                {exploredBank.name}
              </h3>
              <p className="text-xs text-muted-foreground">
                {exploredQuestions.length} bookmarked questions
              </p>
            </div>
            <button
              type="button"
              disabled={!exploredQuestions.length}
              onClick={() => study(exploredBank, exploredQuestions)}
              className="q-button q-button-study"
            >
              <ListChecks className="size-4" /> Study
            </button>
          </header>
          {exploredQuestions.length ? (
            <div className="divide-y">
              {exploredQuestions.map((question, index) => (
                <div key={question.id} className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    onClick={() =>
                      onStartBookmarks(
                        exploredBank.id,
                        [question.id],
                        `Bookmarked question ${question.questionId ?? index + 1}`,
                      )
                    }
                    className="min-w-0 flex-1 text-left"
                  >
                    <strong className="line-clamp-1 text-sm">
                      <FormattedQuestionText text={question.stem} />
                    </strong>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Question {question.questionId ?? index + 1}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleBookmark(question.id)}
                    aria-label={`Remove bookmark from question ${question.questionId ?? index + 1}`}
                    className="q-icon shrink-0 text-primary"
                  >
                    <Bookmark className="size-4 fill-current" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No bookmarked questions in this QBank.
            </p>
          )}
        </section>
      </div>
    );

  return groups.length ? (
    <div className="grid gap-4 sm:grid-cols-2">
      {groups.map(({ bank, questions }) => (
        <article
          key={bank.id}
          className="q-bookmark-folder min-w-0 rounded-2xl bg-card p-5 ring-1 ring-border"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Folder className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-bold" title={bank.name}>
                {bank.name}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {questions.length} bookmarked questions
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setExploredBankId(bank.id)}
              aria-label={`Explore bookmarks in ${bank.name}`}
              className="q-button q-button-secondary"
            >
              Explore <ArrowRight className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => study(bank, questions)}
              aria-label={`Study bookmarks in ${bank.name}`}
              className="q-button q-button-study"
            >
              <ListChecks className="size-4" /> Study
            </button>
          </div>
        </article>
      ))}
    </div>
  ) : (
    <div className="rounded-2xl border border-dashed bg-card p-12 text-center">
      <Bookmark className="mx-auto size-8 text-muted-foreground" />
      <h3 className="mt-3 font-bold">No bookmarks yet</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Bookmark questions while solving a test.
      </p>
    </div>
  );
}
