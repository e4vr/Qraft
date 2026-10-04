'use client';
import { useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
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
    <section aria-label="Areas to improve" className="mt-4 rounded-2xl border bg-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3"><h2 className="font-bold">Areas to improve</h2>{topics.length > 0 && <span className="text-xs text-muted-foreground">{topics.length} topic{topics.length === 1 ? '' : 's'}</span>}</div>
      <p className="mt-1 text-xs text-muted-foreground">Below 75% correct (rounded), using your latest answers.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!topics.length ? (
        <p className="mt-4 rounded-xl bg-muted/35 p-4 text-sm text-muted-foreground">
          {completed ? 'All answered topics are at 75% or above. Keep studying to maintain your progress.' : 'Answer questions to discover topics to focus on.'}
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {topics.map(topic => {
            const key = JSON.stringify([topic.specialtyId, topic.id]);
            const count = topicStudyConfig(topic, maxQuestions)?.count ?? 0;
            return (
              <article key={key} className="flex flex-col gap-2 rounded-xl border bg-background/40 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="break-words text-xs leading-4 text-muted-foreground">{topic.specialty}</p><h3 className="mt-0.5 break-words text-sm font-semibold leading-5">{topic.topic}</h3></div>
                  <strong aria-label={`${topic.accuracy}% correct`} className="shrink-0 rounded-md bg-amber-500/10 px-2 py-1 text-xs tabular-nums text-amber-700 dark:text-amber-400">{topic.accuracy}%</strong>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs leading-5 text-muted-foreground"><p>{topic.correct}/{topic.completed} correct · {topic.total} total</p><p>Tutor · {count} question{count === 1 ? '' : 's'}{count < topic.total ? ' this session' : ''}</p></div>
                  <button type="button" disabled={starting !== null || count === 0} aria-label={`Study now: ${topic.specialty} — ${topic.topic}`} aria-busy={starting === key} onClick={() => void start(topic)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:cursor-wait disabled:opacity-60">
                    {starting === key ? 'Starting…' : 'Study now'}<ArrowRight className="size-3.5" />
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
