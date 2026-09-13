'use client';

import { memo } from 'react';
import { ArrowRight, BookOpenCheck, Check, CheckCircle2, ChevronRight, ClipboardPlus, Flag, Flame, Library, Menu, Moon, Play, Sun, Target, TrendingUp } from 'lucide-react';
import { emptyProgress, type AppState, type Question } from '@/lib/medguard-types';
import { localStudyDay, visibleStudyStreak } from '@/lib/study-streak';

type Destination = 'create' | 'test' | 'library' | 'progress' | 'history';

export const StudyDashboard = memo(function StudyDashboard({ state, questions, name, bankName, navigate, startQuickTest, theme, onToggleTheme }: {
  state: AppState;
  questions: Question[];
  name?: string;
  bankName?: string;
  navigate: (view: Destination) => void;
  startQuickTest: () => void;
  theme: AppState['settings']['theme'];
  onToggleTheme: () => void;
}) {
  const progress = questions.map((question) => ({ question, progress: state.progress[question.id] ?? emptyProgress() }));
  const completed = progress.filter(({ progress: item }) => item.attempts > 0).length;
  const correct = progress.filter(({ question, progress: item }) => item.attempts > 0 && item.lastAnswer === question.answer).length;
  const flagged = progress.filter(({ progress: item }) => item.flagged).length;
  const today = new Date().toDateString();
  const todayCompleted = progress.filter(({ progress: item }) => item.lastAnsweredAt && new Date(item.lastAnsweredAt).toDateString() === today).length;
  const goal = Math.max(1, state.settings.dailyGoal);
  const completion = questions.length ? Math.round(completed / questions.length * 100) : 0;
  const daily = Math.min(100, Math.round(todayCompleted / goal * 100));
  const streak = visibleStudyStreak(state.studyStreak);
  const studiedToday = state.studyStreak.lastActivityDate === localStudyDay();
  const activeTest = state.tests.find((test) => test.status === 'active');
  const specialty = questions[0]?.specialty;
  const newQuestions = progress.filter(({ question, progress: item }) => !item.attempts && question.specialty === specialty);
  const quickCount = Math.min(goal, newQuestions.length);
  const firstName = name ? name.trim().split(/\s+/)[0] : undefined;
  const metrics = [
    { label: 'Questions studied', value: completed, detail: `of ${questions.length} in this bank`, icon: BookOpenCheck, tone: 'blue' },
    { label: 'Accuracy', value: completed ? `${Math.round(correct / completed * 100)}%` : '—', detail: completed ? `${correct} answered correctly` : 'Answer a question to begin', icon: TrendingUp, tone: 'green' },
    { label: 'Ready to explore', value: questions.length - completed, detail: 'Questions you haven’t tried', icon: Library, tone: 'violet' },
    { label: 'Flagged for review', value: flagged, detail: 'Your saved questions', icon: Flag, tone: 'amber' },
  ];

  return <>
    <header className="workspace-header">
      <div className="flex min-w-0 items-center gap-3">
        <button aria-label="Open navigation" onClick={() => window.dispatchEvent(new Event('medguard-open-menu'))} className="q-icon lg:hidden"><Menu className="size-5" /></button>
        <div><p className="q-eyebrow">Your workspace</p><h1 className="text-lg font-bold tracking-tight">Study overview</h1></div>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden text-sm text-muted-foreground sm:block">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span>
        <button className="q-icon" aria-label="Toggle light and dark mode" title="Toggle theme" onClick={onToggleTheme}>
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </header>
    <div className="q-page q-enter">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{firstName ? `Welcome back, ${firstName}.` : 'A little progress, every day.'}</h2><p className="mt-2 text-sm text-muted-foreground">{bankName || specialty || 'Your question bank'} <span className="mx-2 text-border">/</span> Make your next session count.</p></div>
        <button className="q-button q-button-secondary" onClick={() => navigate('library')}><Library className="size-4" />Switch QBank</button>
      </div>
      <section className="study-focus">
        <div className="relative flex-1">
          <span className="focus-label"><span className="size-1.5 rounded-full bg-emerald-300" />{activeTest ? 'PICK UP WHERE YOU LEFT OFF' : 'YOUR NEXT STEP'}</span>
          <h2 className="mt-5 max-w-lg text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{activeTest ? 'Back to your flow.' : completed ? 'Keep your momentum.' : 'Your first session starts here.'}</h2>
          <p className="mt-3 max-w-md text-base leading-7 text-slate-300">{activeTest ? `${activeTest.title}. Continue from question ${activeTest.currentIndex + 1}.` : quickCount ? `${quickCount} new questions, with an explanation after each answer. Go at your own pace.` : 'You’ve explored this bank. Build a test to revisit questions and strengthen your understanding.'}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button className="q-button q-button-study" onClick={activeTest ? () => navigate('test') : quickCount ? startQuickTest : () => navigate('create')}><Play className="size-4 fill-current" />{activeTest ? 'Resume test' : quickCount ? `Start ${quickCount} questions` : 'Build a review test'}<ArrowRight className="ml-2 size-4" /></button>
            <button className="focus-secondary" onClick={() => navigate('create')}>Customize a test<ChevronRight className="size-4" /></button>
          </div>
        </div>
        <div className="daily-focus"><progress className="sr-only" aria-label={`Daily study goal: ${todayCompleted} of ${goal} questions today`} value={daily} max={100} />
          <div className="daily-focus-stats">
            <div className="goal-ring" aria-hidden="true" style={{ background: `conic-gradient(#5ee0bd ${daily * 3.6}deg, #ffffff16 0)` }}>
              <div><Target className="size-[18px] shrink-0 text-emerald-300" /><strong dir="ltr" style={{ fontSize: `${Math.min(34, 170 / Math.max(1, String(todayCompleted).length))}px` }}>{todayCompleted}</strong><span className="goal-total" dir="ltr">of {goal}</span><span className="goal-caption">questions today</span></div>
            </div>
            <div className="streak-card" aria-label={`${streak} day study streak. Best streak ${state.studyStreak.best} days.`}>
              <span className="streak-icon"><Flame className="size-5 fill-current" /></span>
              <strong dir="ltr">{streak}</strong>
              <span>{streak === 1 ? 'day streak' : 'days streak'}</span>
              <small>Best {state.studyStreak.best}</small>
            </div>
          </div>
          <p className="mt-4 text-sm font-medium text-slate-200">{studiedToday ? daily === 100 ? 'Daily goal reached. Well done.' : 'Today counts. Keep your rhythm.' : streak ? `Open a test today to keep your ${streak}-day streak.` : 'Open a test to begin your streak.'}</p>
        </div>
      </section>
      <div className="q-stagger mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map(({ label, value, detail, icon: Icon, tone }) => <article key={label} className="metric-card">
          <div className={`metric-icon tone-${tone}`}><Icon className="size-[18px]" /></div>
          <strong className="mt-4 block text-3xl font-semibold tracking-tight tabular-nums">{value}</strong>
          <h3 className="mt-1 text-sm font-semibold">{label}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
        </article>)}
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <section className="q-surface p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3"><h3 className="text-base font-bold">Your learning progress</h3><button className="q-text-action" onClick={() => navigate('progress')}>View insights<ArrowRight className="size-4" /></button></div>
          <div className="mb-3 mt-7 flex items-end justify-between"><span className="text-sm text-muted-foreground">{completed} of {questions.length} questions studied</span><strong className="text-2xl font-semibold tracking-tight">{completion}%</strong></div>
          <progress className="q-native-progress" aria-label="Question bank completion" max={100} value={completion} />
          <div className="mt-6 grid grid-cols-3 gap-3 border-t pt-5 text-sm">
            {[['New', questions.length - completed, 'bg-blue-500'], ['Correct', correct, 'bg-emerald-500'], ['To revisit', completed - correct, 'bg-amber-500']].map(([label, value, color]) => <div key={label}><span className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`size-2 rounded-full ${color}`} />{label}</span><strong className="mt-2 block text-lg font-semibold">{value}</strong></div>)}
          </div>
        </section>
        <section className="q-surface p-5 sm:p-6">
          <h3 className="text-base font-bold">Make it your session</h3>
          <div className="mt-3 divide-y">
            {[{ title: 'Build a focused test', detail: 'Choose topics, question types and pace.', icon: ClipboardPlus, view: 'create' as const, tone: 'green' }, { title: 'Explore your QBanks', detail: 'Open a bank or organize your collection.', icon: Library, view: 'library' as const, tone: 'blue' }, { title: 'Revisit previous tests', detail: 'Review answers and see what you learned.', icon: CheckCircle2, view: 'history' as const, tone: 'violet' }].map(({ title, detail, icon: Icon, view, tone }) => <button key={view} className="quick-link" onClick={() => navigate(view)}><span className={`metric-icon tone-${tone}`}><Icon className="size-[18px]" /></span><span className="min-w-0 flex-1"><strong className="block text-sm font-semibold">{title}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span></span><ChevronRight className="size-4 shrink-0 text-muted-foreground" /></button>)}
          </div>
        </section>
      </div>
      <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground"><Check className="size-3.5" />Your study progress is personal. Shared notes help everyone learn.</p>
    </div>
  </>;
});
