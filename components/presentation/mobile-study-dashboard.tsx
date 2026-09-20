'use client';

import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  ChevronRight,
  Flame,
  Layers3,
  Library,
  Moon,
  Play,
  Sun,
  Target,
} from 'lucide-react';
import type { AppState } from '@/lib/medguard-types';
import type { StudyDashboardModel } from '@/features/dashboard/domain/study-dashboard-model';

type Destination = 'create' | 'test' | 'library' | 'progress' | 'history' | 'flashcards';

export function MobileStudyDashboard({
  model,
  bankName,
  navigate,
  startQuickTest,
  theme,
  onToggleTheme,
}: {
  model: StudyDashboardModel;
  bankName?: string;
  navigate: (view: Destination) => void;
  startQuickTest: () => void;
  theme: AppState['settings']['theme'];
  onToggleTheme: () => void;
}) {
  const primaryAction = model.activeTest
    ? () => navigate('test')
    : model.quickCount
      ? startQuickTest
      : () => navigate('create');
  const primaryLabel = model.activeTest
    ? 'Continue exam'
    : model.quickCount
      ? `Start ${model.quickCount} questions`
      : 'Create a review';

  return (
    <div className="mobile-home q-enter">
      <header className="mobile-home-header">
        <div className="min-w-0">
          <p className="q-eyebrow">{bankName ?? 'Your study space'}</p>
          <h1>{model.firstName ? `Hi, ${model.firstName}` : 'Ready to study?'}</h1>
        </div>
        <button
          type="button"
          className="q-icon"
          aria-label="Toggle light and dark mode"
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
      </header>

      <main className="mobile-home-content">
        <section className="mobile-resume-card">
          <div className="mobile-resume-copy">
            <span className="mobile-kicker">
              <Play className="size-3.5 fill-current" />
              {model.activeTest ? 'Ready when you are' : 'Your next session'}
            </span>
            <h2>
              {model.activeTest
                ? model.activeTest.title
                : model.completed
                  ? 'Keep your momentum.'
                  : 'Start with one focused session.'}
            </h2>
            <p>
              {model.activeTest
                ? `Question ${model.activeTest.currentIndex + 1} of ${model.activeTest.questionIds.length}`
                : model.quickCount
                  ? 'New questions with explanations after every answer.'
                  : 'Build a focused set from this QBank.'}
            </p>
          </div>
          <button type="button" className="mobile-primary-action" onClick={primaryAction}>
            {primaryLabel}
            <ArrowRight className="size-5" />
          </button>
        </section>

        <section className="mobile-goal-card" aria-label="Daily goal">
          <div
            className="mobile-goal-ring"
            style={{
              background: `conic-gradient(var(--study) ${model.dailyPercent * 3.6}deg, var(--muted) 0)`,
            }}
          >
            <div><strong>{model.todayCompleted}</strong><span>of {model.goal}</span></div>
          </div>
          <div className="min-w-0 flex-1">
            <span className="mobile-kicker text-primary"><Target className="size-3.5" />Today</span>
            <h2>{model.dailyPercent === 100 ? 'Goal complete' : 'Daily goal'}</h2>
            <p>{model.studiedToday ? 'You are building a steady rhythm.' : 'One question is enough to start today.'}</p>
          </div>
          <div className="mobile-streak" aria-label={`${model.streak} day study streak`}>
            <Flame className="size-4 fill-current" /><strong>{model.streak}</strong>
          </div>
        </section>

        <section>
          <div className="mobile-section-heading"><h2>Pick up quickly</h2></div>
          <div className="mobile-action-grid">
            <button type="button" onClick={() => navigate('library')}>
              <span className="tone-blue"><Library className="size-5" /></span>
              <strong>QBanks</strong><small>Switch or explore</small>
            </button>
            <button type="button" onClick={() => navigate('flashcards')}>
              <span className="tone-violet"><Layers3 className="size-5" /></span>
              <strong>Flashcards</strong><small>{model.dueFlashcards} due now</small>
            </button>
            <button type="button" onClick={() => navigate('history')}>
              <span className="tone-green"><BookOpenCheck className="size-5" /></span>
              <strong>History</strong><small>Review sessions</small>
            </button>
            <button type="button" onClick={() => navigate('progress')}>
              <span className="tone-amber"><BarChart3 className="size-5" /></span>
              <strong>Progress</strong><small>{model.completionPercent}% explored</small>
            </button>
          </div>
        </section>

        <section className="mobile-progress-card">
          <div className="mobile-section-heading">
            <div><p className="q-eyebrow">This QBank</p><h2>Your progress</h2></div>
            <button type="button" onClick={() => navigate('progress')}>Details <ChevronRight className="size-4" /></button>
          </div>
          <div className="mobile-progress-values">
            <div><strong>{model.completed}</strong><span>Studied</span></div>
            <div><strong>{model.accuracy === null ? '—' : `${model.accuracy}%`}</strong><span>Accuracy</span></div>
            <div><strong>{model.flagged}</strong><span>Marked</span></div>
          </div>
          <progress aria-label="QBank completion" max={100} value={model.completionPercent} />
        </section>
      </main>
    </div>
  );
}

