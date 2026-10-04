'use client';
import { useRef, useState } from 'react';
import { ArrowRight, BookOpenCheck } from 'lucide-react';
import type { TestBuilderConfig } from '@/lib/medguard-types';
import { topicStudyConfig, type ProgressTopicSummary } from '@/features/progress/domain/progress-summary';

export function AreasToImprove({ topics, completed, maxQuestions, onStudy }: {
  topics: ProgressTopicSummary[];
  completed: number;
  maxQuestions: number;
  onStudy: (config: TestBuilderConfig) => Promise<void>;
}) {
  const lock = useRef(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function start(topic: ProgressTopicSummary) {
    const config = topicStudyConfig(topic, maxQuestions);
    if (lock.current || !config) return;
    lock.current = true;
    setError('');
    setStarting(JSON.stringify([topic.specialtyId, topic.id]));
    try { await onStudy(config); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to start this session. Please try again.'); }
    finally { lock.current = false; setStarting(null); }
  }
  return (
    <section aria-label="Areas to improve" className="mt-6 rounded-2xl border bg-card p-4 sm:p-6">
      <h2 className="text-lg font-bold">Areas to improve</h2>
      <p className="mt-1 text-sm text-muted-foreground">Topics below 75% correct after rounding, based on your latest answer to each answered question.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!topics.length ? (
        <p className="mt-4 rounded-xl bg-muted/35 p-4 text-sm text-muted-foreground">
          {completed ? 'All answered topics are at 75% or above. Keep studying to maintain your progress.' : 'Answer questions to discover topics to focus on.'}
        </p>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {topics.map(topic => {
            const key = JSON.stringify([topic.specialtyId, topic.id]);
            const count = topicStudyConfig(topic, maxQuestions)?.count ?? 0;
            return (
              <article key={key} className="flex flex-col gap-3 rounded-xl border bg-background/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-xs text-muted-foreground">{topic.specialty}</p><h3 className="mt-1 break-words font-semibold">{topic.topic}</h3></div>
                  <strong className="shrink-0 rounded-lg bg-amber-500/10 px-2.5 py-1 text-amber-700 dark:text-amber-400">{topic.accuracy}% correct</strong>
                </div>
                <p className="text-sm text-muted-foreground">{topic.correct} of {topic.completed} answered questions correct · {topic.total} questions in this topic</p>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">Tutor mode · {count} questions{count < topic.total ? ' this session' : ''}</span>
                  <button type="button" disabled={starting !== null || count === 0} aria-label={`Study now: ${topic.specialty} — ${topic.topic}`} aria-busy={starting === key} onClick={() => void start(topic)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-wait disabled:opacity-60">
                    <BookOpenCheck className="size-4" />{starting === key ? 'Starting…' : 'Study now'}<ArrowRight className="size-4" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
