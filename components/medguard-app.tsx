'use client';

/* oxlint-disable next/no-img-element, jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/control-has-associated-label */

import {
  ArrowRight,
  BarChart3,
  Bold,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  ClipboardPlus,
  Cloud,
  CloudOff,
  Download,
  FileText,
  Flag,
  Highlighter,
  ImagePlus,
  Italic,
  LayoutDashboard,
  Library,
  List,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import questionData from '@/data/questions.json';
import {
  createFirebaseAccount,
  firebaseEnabled,
  loadCollaborationState,
  loadCloudState,
  observeFirebaseUser,
  saveCloudState,
  saveCollaborationState,
  signInFirebase,
  signOutFirebase,
  uploadNoteImage,
} from '@/lib/firebase-client';
import {
  createLocalAccount,
  loadLocalCollaboration,
  loadLocalState,
  loadSession,
  saveLocalState,
  saveLocalCollaboration,
  saveSession,
  signInLocal,
} from '@/lib/local-db';
import {
  emptyProgress,
  initialCollaborationState,
  initialAppState,
  normalizeAppState,
  type AppState,
  type AppUser,
  type CollaborationState,
  type HighlightRange,
  type Question,
  type QuestionProgress,
  type QuestionStatus,
  type TestBuilderConfig,
  type TestSession,
} from '@/lib/medguard-types';
import { AdminDashboard, PendingApproval } from '@/components/collaboration-dashboard';

type View = 'dashboard' | 'create' | 'history' | 'progress' | 'settings' | 'manager' | 'admin' | 'test';
type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error';

interface ModelContextLike {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
    execute: (input: unknown) => unknown;
  }, options?: { signal?: AbortSignal }) => void | Promise<void>;
}

const baseQuestions = questionData as Question[];

const NAV_ITEMS = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'create' as const, label: 'Create test', icon: ClipboardPlus },
  { id: 'history' as const, label: 'Previous tests', icon: BookOpenCheck },
  { id: 'progress' as const, label: 'Progress', icon: BarChart3 },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
];

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatDate(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function getQuestionProgress(state: AppState, questionId: string): QuestionProgress {
  return state.progress[questionId] ?? emptyProgress();
}

function mergeRanges(ranges: HighlightRange[]): HighlightRange[] {
  const sorted = ranges.filter((range) => range.end > range.start).sort((a, b) => a.start - b.start);
  const merged: HighlightRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function HighlightedText({ text, ranges }: { text: string; ranges: HighlightRange[] }) {
  const valid = mergeRanges(ranges).filter((range) => range.start < text.length);
  const output: React.ReactNode[] = [];
  let cursor = 0;
  valid.forEach((range, index) => {
    const end = Math.min(range.end, text.length);
    if (range.start > cursor) output.push(text.slice(cursor, range.start));
    output.push(<mark key={`${range.start}-${end}-${index}`} className="rounded-sm bg-[#ffe66d] px-0.5 text-inherit">{text.slice(range.start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
}

function IconButton({ label, children, onClick, active, disabled }: { label: string; children: React.ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cx('grid size-10 place-items-center rounded-xl border text-muted-foreground transition hover:border-primary/35 hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40', active && 'border-primary/40 bg-primary/10 text-primary')}>{children}</button>;
}

function PrimaryButton({ children, onClick, disabled, type = 'button', className }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit'; className?: string }) {
  return <button type={type} onClick={onClick} disabled={disabled} className={cx('inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-white shadow-[0_7px_18px_rgba(8,107,196,0.2)] transition hover:bg-[#075fae] disabled:cursor-not-allowed disabled:opacity-50', className)}>{children}</button>;
}

function SecondaryButton({ children, onClick, disabled, className }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={cx('inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold transition hover:border-primary/30 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-card', className)}>{children}</button>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: AppUser) => void }) {
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [universityId, setUniversityId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 6) { setError('Use at least 6 characters for your password.'); return; }
    setBusy(true); setError('');
    try {
      const user = firebaseEnabled
        ? register ? await createFirebaseAccount(name, email, password, universityId) : await signInFirebase(email, password)
        : register ? await createLocalAccount(name, email, password, universityId) : await signInLocal(email, password);
      onAuthenticated(user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in.');
    } finally { setBusy(false); }
  }

  return (
    <main className="grid min-h-screen bg-[#f4f8fc] lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-[radial-gradient(circle_at_15%_15%,#168ee8_0,#075dab_36%,#073c74_100%)] p-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -bottom-48 -left-40 size-[560px] rounded-full border border-white/10" />
        <div className="absolute -bottom-28 -left-20 size-[380px] rounded-full border border-cyan-300/15" />
        <div className="relative flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25"><Sparkles className="size-5" /></div><div><strong className="block text-xl">MedGuard</strong><span className="text-xs text-blue-100/80">Collaborative QBank</span></div></div>
        <div className="relative max-w-xl">
          <div className="mb-6 grid size-14 place-items-center rounded-2xl bg-[#62dfbd]/15 ring-1 ring-[#73e9c8]/30"><ShieldCheck className="size-7 text-[#82f2d1]" /></div>
          <h1 className="text-4xl font-bold leading-tight tracking-[-0.035em]">Study with focus.<br />Improve with every question.</h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-blue-50/80">Build trusted medical QBanks together, review every change, and keep your personal progress synced across devices.</p>
          <div className="mt-9 grid max-w-lg grid-cols-3 gap-3">
            {[['217', 'verified questions'], ['2', 'test modes'], ['100%', 'private progress']].map(([value, label]) => <div key={label} className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10"><strong className="block text-xl">{value}</strong><span className="text-[11px] text-blue-100/75">{label}</span></div>)}
          </div>
        </div>
        <p className="relative text-xs text-blue-100/60">Built for accountable, collaborative medical learning.</p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[430px]">
          <div className="mb-9 flex items-center gap-3 lg:hidden"><div className="grid size-10 place-items-center rounded-xl bg-primary text-white"><Sparkles className="size-4" /></div><strong className="text-xl">MedGuard</strong></div>
          <div className="mb-8"><p className="mb-2 text-sm font-bold text-primary">{register ? 'REQUEST MEMBERSHIP' : 'WELCOME BACK'}</p><h2 className="text-3xl font-bold tracking-tight">{register ? 'Join your cohort QBank' : 'Sign in to continue'}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{register ? 'Your student ID is checked once, then an administrator reviews your request.' : firebaseEnabled ? 'Your progress and shared contributions sync securely.' : 'Local collaborative preview mode is active.'}</p></div>
          <form onSubmit={submit} className="space-y-4">
            {register && <label className="block"><span className="mb-1.5 block text-sm font-semibold">Full name</span><input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className="h-12 w-full rounded-xl border bg-white px-4 outline-none transition focus:border-primary focus:ring-3 focus:ring-primary/10" placeholder="Khaled" /></label>}
            {register && <label className="block"><span className="mb-1.5 block text-sm font-semibold">University ID</span><input required autoComplete="off" value={universityId} onChange={(event) => setUniversityId(event.target.value.toUpperCase())} className="h-12 w-full rounded-xl border bg-white px-4 font-mono outline-none transition focus:border-primary focus:ring-3 focus:ring-primary/10" placeholder="442001234" /><span className="mt-1 block text-[11px] text-muted-foreground">One approved account can be created for each eligible ID.</span></label>}
            <label className="block"><span className="mb-1.5 block text-sm font-semibold">Email address</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-12 w-full rounded-xl border bg-white px-4 outline-none transition focus:border-primary focus:ring-3 focus:ring-primary/10" placeholder="you@example.com" /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold">Password</span><input required minLength={6} type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 w-full rounded-xl border bg-white px-4 outline-none transition focus:border-primary focus:ring-3 focus:ring-primary/10" placeholder="At least 6 characters" /></label>
            {error && <div role="alert" className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</div>}
            <PrimaryButton type="submit" disabled={busy} className="w-full">{busy && <RefreshCw className="size-4 animate-spin" />}{register ? 'Submit registration' : 'Sign in'}</PrimaryButton>
          </form>
          {!firebaseEnabled && <button type="button" onClick={() => onAuthenticated({ uid: 'local-demo', email: 'demo@local.medguard', displayName: 'Root Admin', isAdmin: true, provider: 'local', role: 'super_admin', status: 'approved', universityId: 'ADMIN-DEMO' })} className="mt-3 h-11 w-full rounded-xl border border-primary/25 bg-primary/5 text-sm font-bold text-primary transition hover:bg-primary/10">Continue as root admin demo</button>}
          <p className="mt-7 text-center text-sm text-muted-foreground">{register ? 'Already have an account?' : 'New to MedGuard?'} <button type="button" onClick={() => { setRegister(!register); setError(''); }} className="font-bold text-primary hover:underline">{register ? 'Sign in' : 'Create an account'}</button></p>
        </div>
      </section>
    </main>
  );
}

function AppSidebar({ view, setView, user, syncStatus, onSignOut, mobileOpen, closeMobile, qbanks, activeQBankId, onSelectQBank }: { view: View; setView: (view: View) => void; user: AppUser; syncStatus: SyncStatus; onSignOut: () => void; mobileOpen: boolean; closeMobile: () => void; qbanks: CollaborationState['qbanks']; activeQBankId: string; onSelectQBank: (id: string) => void }) {
  const navigate = (next: View) => { setView(next); closeMobile(); };
  return (
    <>
      {mobileOpen && <button aria-label="Close menu" onClick={closeMobile} className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm lg:hidden" />}
      <aside className={cx('fixed inset-y-0 left-0 z-50 flex w-[254px] shrink-0 flex-col border-r bg-sidebar transition-transform lg:sticky lg:top-0 lg:z-20 lg:h-screen lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-[72px] items-center justify-between border-b px-5">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-primary text-white shadow-sm"><Sparkles className="size-4" /></div><div><strong className="block text-[17px] tracking-tight">MedGuard</strong><span className="block text-[10px] font-semibold text-muted-foreground">COLLABORATIVE QBANK</span></div></div>
          <button onClick={closeMobile} className="lg:hidden"><X className="size-5" /></button>
        </div>
        <div className="mx-3 mt-3 rounded-xl border bg-white p-2 dark:bg-card"><label className="flex items-center gap-2"><Library className="ml-1 size-4 shrink-0 text-primary" /><span className="sr-only">Active QBank</span><select aria-label="Active QBank" value={activeQBankId} onChange={(event) => { onSelectQBank(event.target.value); navigate('dashboard'); }} className="min-w-0 flex-1 bg-transparent py-1 text-xs font-bold outline-none">{qbanks.filter((item) => !item.archived).map((qbank) => <option key={qbank.id} value={qbank.id}>{qbank.shortName}</option>)}</select></label></div>
        <nav className="flex-1 space-y-1 p-3" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => <button key={item.id} onClick={() => navigate(item.id)} className={cx('flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition', view === item.id ? 'bg-primary/10 text-primary' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')}><item.icon className="size-[18px]" />{item.label}</button>)}
          <div className="my-3 border-t" />
          <button onClick={() => navigate('manager')} className={cx('flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition', view === 'manager' ? 'bg-primary/10 text-primary' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')}><ClipboardList className="size-[18px]" />Contributions</button>
          {user.isAdmin && <button onClick={() => navigate('admin')} className={cx('flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition', view === 'admin' ? 'bg-violet-50 text-violet-700' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')}><Users className="size-[18px]" />Admin dashboard</button>}
        </nav>
        <div className="mx-4 mb-3 rounded-2xl border bg-muted/45 p-3.5">
          <div className={cx('flex items-center gap-2 text-xs font-bold', syncStatus === 'error' ? 'text-red-600' : syncStatus === 'offline' || syncStatus === 'local' ? 'text-amber-700' : 'text-emerald-700')}>
            {syncStatus === 'syncing' ? <RefreshCw className="size-3.5 animate-spin" /> : syncStatus === 'offline' || syncStatus === 'local' ? <CloudOff className="size-3.5" /> : <Cloud className="size-3.5" />}
            {syncStatus === 'syncing' ? 'Syncing changes' : syncStatus === 'synced' ? 'All changes synced' : syncStatus === 'error' ? 'Sync needs attention' : syncStatus === 'offline' ? 'Working offline' : 'Saved on this device'}
          </div>
        </div>
        <div className="border-t p-3">
          <div className="flex items-center gap-3 rounded-xl p-2"><div className="grid size-9 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">{user.displayName.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{user.displayName}</strong><span className="block truncate text-[10px] text-muted-foreground">{user.role.replace('_', ' ')} · {user.universityId || user.email}</span></div><button title="Sign out" aria-label="Sign out" onClick={onSignOut} className="text-muted-foreground hover:text-red-600"><LogOut className="size-4" /></button></div>
        </div>
      </aside>
    </>
  );
}

function PageHeader({ title, subtitle, openMenu, actions }: { title: string; subtitle?: string; openMenu: () => void; actions?: React.ReactNode }) {
  return <header className="sticky top-0 z-30 flex min-h-[72px] items-center justify-between border-b bg-white/88 px-4 backdrop-blur-xl dark:bg-background/90 sm:px-7"><div className="flex min-w-0 items-center gap-3"><button onClick={openMenu} className="grid size-10 place-items-center rounded-xl border lg:hidden"><Menu className="size-5" /></button><div className="min-w-0"><h1 className="truncate text-lg font-bold tracking-tight">{title}</h1>{subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}</div></div>{actions && <div className="flex items-center gap-2">{actions}</div>}</header>;
}

function StatCard({ label, value, detail, color = 'blue' }: { label: string; value: number | string; detail: string; color?: 'blue' | 'green' | 'red' | 'amber' }) {
  const colors = { blue: 'bg-blue-50 text-blue-700', green: 'bg-emerald-50 text-emerald-700', red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700' };
  return <article className="rounded-2xl bg-card p-5 shadow-[0_5px_20px_rgba(24,53,78,0.055)] ring-1 ring-border"><div className="flex items-start justify-between"><div><p className="text-sm font-semibold text-muted-foreground">{label}</p><strong className="mt-2 block text-3xl tracking-tight">{value}</strong><span className="mt-1 block text-xs text-muted-foreground">{detail}</span></div><div className={cx('grid size-9 place-items-center rounded-xl text-xs font-bold', colors[color])}>{typeof value === 'number' && value > 0 ? '↑' : '—'}</div></div></article>;
}

function Dashboard({ state, questions, setView, startQuickTest }: { state: AppState; questions: Question[]; setView: (view: View) => void; startQuickTest: () => void }) {
  const values = useMemo(() => {
    const progress = Object.values(state.progress);
    const completed = progress.filter((item) => item.attempts > 0).length;
    const correct = questions.filter((question) => getQuestionProgress(state, question.id).lastAnswer === question.answer).length;
    const incorrect = progress.filter((item) => item.attempts > 0 && item.lastAnswer !== undefined).length - correct;
    const flagged = progress.filter((item) => item.flagged).length;
    const today = new Date().toDateString();
    const todayCompleted = progress.filter((item) => item.lastAnsweredAt && new Date(item.lastAnsweredAt).toDateString() === today).length;
    return { completed, correct, incorrect: Math.max(0, incorrect), flagged, todayCompleted };
  }, [state, questions]);
  const completion = questions.length ? Math.round((values.completed / questions.length) * 100) : 0;
  const daily = Math.min(100, Math.round((values.todayCompleted / state.settings.dailyGoal) * 100));
  const activeTest = state.tests.find((test) => test.status === 'active');

  return <>
    <PageHeader title={`Welcome back`} subtitle={new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())} openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))} actions={<button onClick={() => setView('create')} className="hidden h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold hover:bg-muted sm:flex"><Plus className="size-4" />New test</button>} />
    <div className="mx-auto max-w-[1180px] p-4 sm:p-7">
      <section className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(125deg,#0759aa,#0d78d1)] px-6 py-7 text-white shadow-[0_18px_44px_rgba(15,107,196,0.22)] sm:px-8">
        <div className="absolute -right-16 -top-24 size-72 rounded-full border-[36px] border-white/5" />
        <div className="relative flex flex-col justify-between gap-6 md:flex-row md:items-center">
          <div><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-xs font-semibold ring-1 ring-white/20"><span className="size-1.5 rounded-full bg-[#74edc9]" />Daily study plan</div><h2 className="text-2xl font-bold tracking-tight sm:text-[29px]">{activeTest ? 'Your active test is waiting' : "Ready for today's session?"}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-blue-50/80">{activeTest ? `Continue ${activeTest.title} from question ${activeTest.currentIndex + 1}.` : 'Build a focused test from new, previous, incorrect, or flagged questions.'}</p></div>
          <PrimaryButton onClick={activeTest ? () => setView('test') : startQuickTest} className="bg-white !text-primary hover:!bg-blue-50">{activeTest ? <ArrowRight className="size-4" /> : <ClipboardPlus className="size-4" />}{activeTest ? 'Resume test' : `Start ${state.settings.dailyGoal} questions`}</PrimaryButton>
        </div>
      </section>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Completed" value={values.completed} detail={`of ${questions.length} questions`} /><StatCard label="Remaining" value={questions.length - values.completed} detail={`${100 - completion}% of bank`} /><StatCard label="Correct" value={values.correct} detail={values.completed ? `${Math.round((values.correct / values.completed) * 100)}% accuracy` : 'No attempts yet'} color="green" /><StatCard label="Flagged" value={values.flagged} detail="Saved for review" color="amber" /></div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1.45fr_0.8fr]">
        <article className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border sm:p-6"><div className="flex items-start justify-between"><div><h3 className="font-bold">Question bank progress</h3><p className="mt-1 text-sm text-muted-foreground">Surgery · Phase one</p></div><button onClick={() => setView('progress')} className="text-xs font-bold text-primary hover:underline">View details</button></div><div className="mt-7 flex items-center justify-between text-sm"><span className="font-semibold">Overall completion</span><span className="font-bold text-primary">{completion}%</span></div><div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completion}%` }} /></div><div className="mt-6 grid grid-cols-3 divide-x rounded-xl bg-muted/55 py-4 text-center"><div><strong className="block text-lg">{questions.length - values.completed}</strong><span className="text-xs text-muted-foreground">New</span></div><div><strong className="block text-lg text-emerald-650">{values.correct}</strong><span className="text-xs text-muted-foreground">Correct</span></div><div><strong className="block text-lg text-red-600">{values.incorrect}</strong><span className="text-xs text-muted-foreground">Incorrect</span></div></div></article>
        <article className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border sm:p-6"><h3 className="font-bold">Daily goal</h3><p className="mt-1 text-sm text-muted-foreground">{values.todayCompleted} of {state.settings.dailyGoal} questions</p><div className="grid place-items-center py-5"><div className="relative grid size-32 place-items-center rounded-full" style={{ background: `conic-gradient(#086bc4 ${daily * 3.6}deg, #e7edf3 0)` }}><div className="grid size-[104px] place-items-center rounded-full bg-card text-center"><div><strong className="block text-2xl">{daily}%</strong><span className="text-[11px] text-muted-foreground">completed</span></div></div></div></div></article>
      </div>
    </div>
  </>;
}

function CreateTest({ questions, state, onStart }: { questions: Question[]; state: AppState; onStart: (config: TestBuilderConfig) => void }) {
  const topics = useMemo(() => Array.from(new Set(questions.map((question) => question.topic))).sort(), [questions]);
  const specialties = useMemo(() => Array.from(new Set(questions.map((question) => question.specialty))).sort(), [questions]);
  const [config, setConfig] = useState<TestBuilderConfig>({ mode: 'tutor', statuses: ['new'], specialty: questions[0]?.specialty ?? 'General', topics: [], count: Math.min(20, Math.max(1, questions.length)) });
  const [message, setMessage] = useState('');
  const eligible = useMemo(() => questions.filter((question) => {
    const progress = getQuestionProgress(state, question.id);
    const statusMatch = config.statuses.length === 0 || config.statuses.some((status) => status === 'new' ? progress.attempts === 0 : status === 'previous' ? progress.attempts > 0 : status === 'correct' ? progress.attempts > 0 && progress.lastAnswer === question.answer : status === 'incorrect' ? progress.attempts > 0 && progress.lastAnswer !== question.answer : progress.flagged);
    return question.specialty === config.specialty && (config.topics.length === 0 || config.topics.includes(question.topic)) && statusMatch;
  }), [config, questions, state]);
  const statuses: Array<[QuestionStatus, string]> = [['new', 'New'], ['previous', 'Previously tested'], ['incorrect', 'Incorrect'], ['correct', 'Correct'], ['flagged', 'Flagged']];
  function toggleStatus(status: QuestionStatus) { setConfig((current) => ({ ...current, statuses: current.statuses.includes(status) ? current.statuses.filter((item) => item !== status) : [...current.statuses, status] })); }
  function toggleTopic(topic: string) { setConfig((current) => ({ ...current, topics: current.topics.includes(topic) ? current.topics.filter((item) => item !== topic) : [...current.topics, topic] })); }
  return <><PageHeader title="Create a test" subtitle="Build a focused question block" openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))} /><div className="mx-auto max-w-5xl p-4 sm:p-7"><div className="grid gap-5 lg:grid-cols-[1fr_310px]">
    <div className="space-y-5">
      <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6"><span className="text-xs font-bold text-primary">01</span><h2 className="mt-1 text-lg font-bold">Choose your test mode</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{([['tutor', 'Tutor mode', 'See the correct answer after every question.'], ['timed', 'Timed mode', 'Review all answers after completing the test.']] as const).map(([value, title, description]) => <button key={value} onClick={() => setConfig({ ...config, mode: value })} className={cx('rounded-2xl border p-4 text-left transition', config.mode === value ? 'border-primary bg-primary/5 ring-2 ring-primary/10' : 'hover:border-primary/30')}><div className="flex items-start justify-between"><div className={cx('grid size-9 place-items-center rounded-xl', config.mode === value ? 'bg-primary text-white' : 'bg-muted text-muted-foreground')}>{value === 'tutor' ? <BookOpenCheck className="size-4" /> : <RefreshCw className="size-4" />}</div>{config.mode === value && <CheckCircle2 className="size-5 text-primary" />}</div><strong className="mt-4 block text-sm">{title}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></button>)}</div></section>
      <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6"><span className="text-xs font-bold text-primary">02</span><h2 className="mt-1 text-lg font-bold">Question status</h2><p className="mt-1 text-sm text-muted-foreground">Choose one or combine multiple pools.</p><div className="mt-4 flex flex-wrap gap-2">{statuses.map(([value, label]) => <button key={value} onClick={() => toggleStatus(value)} className={cx('rounded-full border px-4 py-2 text-xs font-bold transition', config.statuses.includes(value) ? 'border-primary bg-primary text-white' : 'bg-white hover:border-primary/35 dark:bg-card')}>{label}</button>)}</div></section>
      <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6"><span className="text-xs font-bold text-primary">03</span><h2 className="mt-1 text-lg font-bold">Specialty & topics</h2><p className="mt-1 text-sm text-muted-foreground">Choose a specialty, then optionally narrow the block by topic.</p>{specialties.length > 1 && <label className="mt-4 block"><span className="mb-1.5 block text-xs font-bold">Specialty</span><select value={config.specialty} onChange={(event) => setConfig({ ...config, specialty: event.target.value, topics: [] })} className="h-11 w-full rounded-xl border bg-white px-3 text-sm dark:bg-card">{specialties.map((item) => <option key={item}>{item}</option>)}</select></label>}<div className="mt-4 grid gap-2 sm:grid-cols-2">{topics.filter((topic) => questions.some((question) => question.specialty === config.specialty && question.topic === topic)).map((topic) => { const selected = config.topics.includes(topic); return <button type="button" key={topic} aria-pressed={selected} onClick={() => toggleTopic(topic)} className="flex items-center gap-3 rounded-xl border p-3 text-left text-sm transition hover:bg-muted/50"><span className={cx('grid size-4 place-items-center rounded border', selected && 'border-primary bg-primary text-white')}>{selected && <Check className="size-3" />}</span><span className="flex-1 font-medium">{topic}</span><span className="text-xs text-muted-foreground">{questions.filter((question) => question.specialty === config.specialty && question.topic === topic).length}</span></button>; })}</div></section>
    </div>
    <aside className="h-fit rounded-2xl bg-card p-5 ring-1 ring-border lg:sticky lg:top-[92px]"><h3 className="font-bold">Test summary</h3><div className="mt-5 space-y-3 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Mode</span><strong className="capitalize">{config.mode}</strong></div><div className="flex justify-between"><span className="text-muted-foreground">Eligible</span><strong>{eligible.length}</strong></div><div className="flex justify-between"><span className="text-muted-foreground">Selected topics</span><strong>{config.topics.length || 'All'}</strong></div></div><label htmlFor="test-question-count" className="mt-6 block"><span className="mb-2 flex justify-between text-sm font-semibold"><span>Questions</span><strong className="text-primary">{Math.min(config.count, Math.max(eligible.length, 1))}</strong></span><input id="test-question-count" aria-label="Number of questions" type="range" min="1" max={Math.max(eligible.length, 1)} value={Math.min(config.count, Math.max(eligible.length, 1))} onChange={(event) => setConfig({ ...config, count: Number(event.target.value) })} className="w-full accent-primary" /></label>{message && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{message}</p>}<PrimaryButton onClick={() => { if (!eligible.length) { setMessage('No questions match these filters. Try a different status or topic.'); return; } onStart({ ...config, count: Math.min(config.count, eligible.length) }); }} className="mt-6 w-full"><ClipboardPlus className="size-4" />Start test</PrimaryButton></aside>
  </div></div></>;
}

function TestView({ test, questions, state, setState, onExit, user, collaboration, updateCollaboration }: { test: TestSession; questions: Question[]; state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>>; onExit: () => void; user: AppUser; collaboration: CollaborationState; updateCollaboration: (updater: (current: CollaborationState) => CollaborationState) => void }) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.floor((Date.now() - new Date(test.startedAt).getTime()) / 1000)));
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMessage, setReportMessage] = useState('');
  const [suggestedAnswer, setSuggestedAnswer] = useState<number | undefined>();
  const [noteDraft, setNoteDraft] = useState('');
  const [noteImagesDraft, setNoteImagesDraft] = useState<QuestionProgress['noteImages']>([]);
  const [uploading, setUploading] = useState(false);
  const stemRef = useRef<HTMLParagraphElement>(null);
  const activeQuestions = useMemo(() => test.questionIds.map((id) => questions.find((question) => question.id === id)).filter(Boolean) as Question[], [test.questionIds, questions]);
  const question = activeQuestions[test.currentIndex];
  const progress = question ? getQuestionProgress(state, question.id) : emptyProgress();
  const qbankId = question?.qbankId ?? test.qbankId ?? 'smle-gs';
  const noteKey = question ? `${qbankId}:${question.id}` : '';
  const sharedNote = noteKey ? collaboration.sharedNotes[noteKey] : undefined;
  const selected = question ? test.answers[question.id] : undefined;
  const revealed = question ? test.revealed.includes(question.id) : false;

  useEffect(() => {
    if (test.mode !== 'timed' || test.status !== 'active') return;
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - new Date(test.startedAt).getTime()) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [test.mode, test.startedAt, test.status]);

  useEffect(() => {
    const update = window.setTimeout(() => { setNoteDraft(sharedNote?.content ?? ''); setNoteImagesDraft(sharedNote?.images ?? []); }, 0);
    return () => window.clearTimeout(update);
  }, [question?.id, sharedNote?.content, sharedNote?.images]);

  const updateTest = useCallback((updater: (current: TestSession) => TestSession) => {
    setState((current) => ({ ...current, tests: current.tests.map((item) => item.id === test.id ? updater(item) : item) }));
  }, [setState, test.id]);

  if (!question) return <main className="grid min-h-screen place-items-center"><div className="text-center"><CircleAlert className="mx-auto size-8 text-red-500" /><h1 className="mt-3 font-bold">Question unavailable</h1><SecondaryButton onClick={onExit} className="mt-4">Return to dashboard</SecondaryButton></div></main>;

  function selectAnswer(answer: number) {
    if (revealed) return;
    updateTest((current) => ({ ...current, answers: { ...current.answers, [question.id]: answer }, updatedAt: new Date().toISOString() }));
  }

  function gradeCurrent() {
    if (selected === undefined || test.graded.includes(question.id)) return;
    setState((current) => {
      const oldProgress = getQuestionProgress(current, question.id);
      const correct = selected === question.answer;
      return {
        ...current,
        progress: { ...current.progress, [question.id]: { ...oldProgress, attempts: oldProgress.attempts + 1, correctAttempts: oldProgress.correctAttempts + (correct ? 1 : 0), incorrectAttempts: oldProgress.incorrectAttempts + (correct ? 0 : 1), lastAnswer: selected, lastAnsweredAt: new Date().toISOString() } },
        tests: current.tests.map((item) => item.id === test.id ? { ...item, revealed: [...new Set([...item.revealed, question.id])], graded: [...new Set([...item.graded, question.id])], updatedAt: new Date().toISOString() } : item),
      };
    });
    setNotesOpen(true);
  }

  function finishTest() {
    const finish = window.confirm('End this test and save your results?');
    if (!finish) return;
    setState((current) => {
      const currentTest = current.tests.find((item) => item.id === test.id) ?? test;
      const nextProgress = { ...current.progress };
      currentTest.questionIds.forEach((questionId) => {
        if (currentTest.graded.includes(questionId) || currentTest.answers[questionId] === undefined) return;
        const sourceQuestion = questions.find((item) => item.id === questionId);
        if (!sourceQuestion) return;
        const answer = currentTest.answers[questionId];
        const old = getQuestionProgress(current, questionId);
        const correct = answer === sourceQuestion.answer;
        nextProgress[questionId] = { ...old, attempts: old.attempts + 1, correctAttempts: old.correctAttempts + (correct ? 1 : 0), incorrectAttempts: old.incorrectAttempts + (correct ? 0 : 1), lastAnswer: answer, lastAnsweredAt: new Date().toISOString() };
      });
      return { ...current, progress: nextProgress, tests: current.tests.map((item) => item.id === test.id ? { ...item, status: 'completed', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), graded: [...new Set([...item.graded, ...Object.keys(item.answers)])], revealed: [...new Set([...item.revealed, ...item.questionIds])] } : item) };
    });
    onExit();
  }

  function move(index: number) { updateTest((current) => ({ ...current, currentIndex: Math.max(0, Math.min(index, current.questionIds.length - 1)), updatedAt: new Date().toISOString() })); }

  function toggleFlag() {
    setState((current) => { const old = getQuestionProgress(current, question.id); return { ...current, progress: { ...current.progress, [question.id]: { ...old, flagged: !old.flagged } } }; });
  }

  function addHighlight() {
    const selection = window.getSelection();
    const root = stemRef.current;
    if (!selection || !root || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const before = document.createRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const end = start + range.toString().length;
    setState((current) => { const old = getQuestionProgress(current, question.id); return { ...current, progress: { ...current.progress, [question.id]: { ...old, highlights: mergeRanges([...old.highlights, { start, end }]) } } }; });
    selection.removeAllRanges();
  }

  function clearHighlights() { setState((current) => { const old = getQuestionProgress(current, question.id); return { ...current, progress: { ...current.progress, [question.id]: { ...old, highlights: [] } } }; }); }

  function saveNote() {
    const content = noteDraft.trim();
    if (content === (sharedNote?.content ?? '') && JSON.stringify(noteImagesDraft) === JSON.stringify(sharedNote?.images ?? [])) return;
    const editedAt = new Date().toISOString();
    const revision = { id: crypto.randomUUID(), content, images: noteImagesDraft, editedById: user.uid, editedByName: user.displayName, editedAt };
    updateCollaboration((current) => {
      const previous = current.sharedNotes[noteKey];
      return {
        ...current,
        sharedNotes: {
          ...current.sharedNotes,
          [noteKey]: { id: noteKey, qbankId, questionId: question.id, content, images: noteImagesDraft, version: (previous?.version ?? 0) + 1, updatedById: user.uid, updatedByName: user.displayName, updatedAt: editedAt, history: [...(previous?.history ?? []), revision] },
        },
        auditLog: [{ id: crypto.randomUUID(), action: 'shared_note_updated', entityType: 'note', entityId: noteKey, actorId: user.uid, actorName: user.displayName, createdAt: editedAt, detail: `Updated the shared note for question ${question.number}.` }, ...current.auditLog],
      };
    });
  }

  function insertNoteToken(before: string, after = before) {
    const textarea = document.getElementById('question-note') as HTMLTextAreaElement | null;
    if (!textarea) return;
    const start = textarea.selectionStart; const end = textarea.selectionEnd;
    const next = noteDraft.slice(0, start) + before + noteDraft.slice(start, end) + after + noteDraft.slice(end);
    setNoteDraft(next);
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + before.length, end + before.length); });
  }

  async function attachImages(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const images = await Promise.all(Array.from(files).slice(0, 5).map(async (file) => {
        if (!file.type.startsWith('image/')) throw new Error('Only image files are supported.');
        if (file.size > 10 * 1024 * 1024) throw new Error('Each image must be smaller than 10 MB.');
        let url: string;
        if (firebaseEnabled) url = await uploadNoteImage(user.uid, file, qbankId, question.id);
        else url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read image.')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
        return { id: crypto.randomUUID(), url, name: file.name, caption: '' };
      }));
      setNoteImagesDraft((current) => [...current, ...images]);
    } catch (caught) { window.alert(caught instanceof Error ? caught.message : 'Image upload failed.'); }
    finally { setUploading(false); }
  }

  function removeImage(imageId: string) { setNoteImagesDraft((current) => current.filter((image) => image.id !== imageId)); }

  function updateCaption(imageId: string, caption: string) { setNoteImagesDraft((current) => current.map((image) => image.id === imageId ? { ...image, caption } : image)); }

  function submitReport() {
    if (!reportMessage.trim() && suggestedAnswer === undefined) return;
    const proposedAt = new Date().toISOString();
    updateCollaboration((current) => ({
      ...current,
      proposals: [{ id: crypto.randomUUID(), qbankId, type: 'question_edit', questionId: question.id, payload: { stem: question.stem, options: question.options, answer: suggestedAnswer ?? question.answer, specialty: question.specialty, topic: question.topic }, rationale: reportMessage.trim(), status: 'pending', proposedById: user.uid, proposedByName: user.displayName, proposedAt }, ...current.proposals],
      auditLog: [{ id: crypto.randomUUID(), action: 'question_edit_proposed', entityType: 'question', entityId: question.id, actorId: user.uid, actorName: user.displayName, createdAt: proposedAt, detail: `Proposed a correction to question ${question.number}.` }, ...current.auditLog],
    }));
    setReportOpen(false); setReportMessage(''); setSuggestedAnswer(undefined);
  }

  return <main className="flex min-h-screen flex-col bg-[#f5f7fa] dark:bg-background">
    <header className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b bg-white px-3 shadow-sm dark:bg-card sm:px-5">
      <div className="flex items-center gap-2 sm:gap-3"><button aria-label="Exit test" onClick={onExit} className="grid size-9 place-items-center rounded-xl hover:bg-muted"><X className="size-5" /></button><div className="hidden h-7 w-px bg-border sm:block" /><div><strong className="block text-sm">{test.title}</strong><span className="text-[10px] font-semibold uppercase text-muted-foreground">{test.mode} mode</span></div></div>
      <div className="flex items-center gap-2"><div className="rounded-xl bg-muted px-3 py-2 text-xs font-bold tabular-nums">{test.mode === 'timed' ? formatDuration(seconds) : `${test.currentIndex + 1} / ${test.questionIds.length}`}</div><IconButton label={progress.flagged ? 'Remove flag' : 'Flag question'} active={progress.flagged} onClick={toggleFlag}><Flag className={cx('size-4', progress.flagged && 'fill-current')} /></IconButton><SecondaryButton onClick={finishTest} className="hidden sm:flex">End block</SecondaryButton></div>
    </header>
    <div className="mx-auto flex w-full max-w-[1440px] flex-1">
      <aside className="hidden w-[190px] shrink-0 border-r bg-white p-4 dark:bg-card xl:block"><div className="mb-3 flex items-center justify-between"><strong className="text-xs">Questions</strong><span className="text-[10px] text-muted-foreground">{Object.keys(test.answers).length}/{test.questionIds.length}</span></div><div className="grid grid-cols-5 gap-1.5">{activeQuestions.map((item, index) => { const itemProgress = getQuestionProgress(state, item.id); const answered = test.answers[item.id] !== undefined; return <button key={item.id} onClick={() => move(index)} className={cx('grid size-7 place-items-center rounded-md border text-[10px] font-bold', index === test.currentIndex ? 'border-primary bg-primary text-white' : answered ? 'border-primary/25 bg-primary/8 text-primary' : 'bg-white dark:bg-card', itemProgress.flagged && index !== test.currentIndex && 'border-amber-400 text-amber-700')}>{index + 1}</button>; })}</div></aside>
      <section className="min-w-0 flex-1 p-3 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-[890px]">
          <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">{question.specialty}</span><span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">{question.topic}</span></div><button onClick={() => setNavigatorOpen(true)} className="text-xs font-bold text-primary xl:hidden">Question {test.currentIndex + 1} of {test.questionIds.length}</button></div>
          <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-border dark:bg-card sm:p-8">
            <div className="mb-5 flex items-center justify-between border-b pb-4"><span className="text-xs font-bold text-muted-foreground">QUESTION {test.currentIndex + 1}</span><div className="flex gap-2"><IconButton label="Highlight selected text" onClick={addHighlight}><Highlighter className="size-4" /></IconButton>{progress.highlights.length > 0 && <IconButton label="Clear highlights" onClick={clearHighlights}><Trash2 className="size-4" /></IconButton>}</div></div>
            <p ref={stemRef} className="select-text text-[15px] leading-[1.85] text-[#1d2e40] dark:text-foreground sm:text-base"><HighlightedText text={question.stem} ranges={progress.highlights} /></p>
            <div className="mt-7 space-y-3">{question.options.map((option, index) => { const isSelected = selected === index; const isCorrect = revealed && question.answer === index; const isWrong = revealed && isSelected && index !== question.answer; return <button key={index} disabled={revealed} onClick={() => selectAnswer(index)} className={cx('flex w-full items-start gap-3 rounded-xl border p-4 text-left text-sm leading-6 transition', isCorrect ? 'border-emerald-400 bg-emerald-50 text-emerald-950' : isWrong ? 'border-red-400 bg-red-50 text-red-950' : isSelected ? 'border-primary bg-primary/5 ring-2 ring-primary/10' : 'bg-white hover:border-primary/35 hover:bg-primary/[0.025] dark:bg-card')}><span className={cx('grid size-7 shrink-0 place-items-center rounded-full border text-xs font-bold', isCorrect ? 'border-emerald-500 bg-emerald-500 text-white' : isWrong ? 'border-red-500 bg-red-500 text-white' : isSelected ? 'border-primary bg-primary text-white' : 'bg-muted/40')}>{isCorrect ? <Check className="size-4" /> : isWrong ? <X className="size-4" /> : 'ABCD'[index]}</span><span className="pt-0.5">{option}</span></button>; })}</div>
            {test.mode === 'tutor' && !revealed && <div className="mt-6 flex justify-end"><PrimaryButton onClick={gradeCurrent} disabled={selected === undefined}>Submit answer</PrimaryButton></div>}
            {revealed && <div className={cx('mt-6 rounded-xl border p-4 text-sm font-semibold', selected === question.answer ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800')}>{selected === question.answer ? 'Correct answer.' : `The keyed answer is ${question.answerLetter}.`} <span className="font-normal opacity-75">Source page {question.sourcePage} · Revision {question.revision}</span></div>}
          </article>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2"><SecondaryButton onClick={() => move(test.currentIndex - 1)} disabled={test.currentIndex === 0}><ChevronLeft className="size-4" />Previous</SecondaryButton><SecondaryButton onClick={() => move(test.currentIndex + 1)} disabled={test.currentIndex === test.questionIds.length - 1}>Next<ChevronRight className="size-4" /></SecondaryButton></div><div className="flex gap-2"><SecondaryButton onClick={() => setReportOpen(true)}><CircleAlert className="size-4" />Suggest correction</SecondaryButton><PrimaryButton onClick={() => setNotesOpen(!notesOpen)}><FileText className="size-4" />Shared notes {sharedNote?.content || sharedNote?.images.length ? '•' : ''}</PrimaryButton></div></div>
          {notesOpen && <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-border dark:bg-card"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h3 className="font-bold">Shared explanation & notes</h3><p className="text-xs text-muted-foreground">Everyone can improve this note. Every saved version is attributed.</p></div>{sharedNote && <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold text-emerald-700">EDITED BY {sharedNote.updatedByName.toUpperCase()} · {formatDate(sharedNote.updatedAt)}</span>}</div><div className="mt-4 flex gap-1 border-b pb-2"><IconButton label="Bold" onClick={() => insertNoteToken('**')}><Bold className="size-4" /></IconButton><IconButton label="Italic" onClick={() => insertNoteToken('_')}><Italic className="size-4" /></IconButton><IconButton label="Bullet list" onClick={() => insertNoteToken('\n• ', '')}><List className="size-4" /></IconButton><label title="Add images" className="grid size-10 cursor-pointer place-items-center rounded-xl border text-muted-foreground hover:bg-muted"><span className="sr-only">Add note images</span><ImagePlus className="size-4" /><input aria-label="Add note images" type="file" accept="image/*" multiple hidden onChange={(event) => { void attachImages(event.target.files); event.target.value = ''; }} /></label></div><textarea id="question-note" dir="auto" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Write or improve the shared explanation…" className="mt-3 min-h-40 w-full resize-y rounded-xl border bg-muted/20 p-4 text-sm leading-7 outline-none focus:border-primary focus:ring-3 focus:ring-primary/10" />{uploading && <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw className="size-3 animate-spin" />Uploading images…</div>}{noteImagesDraft.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-2">{noteImagesDraft.map((image) => <div key={image.id} className="overflow-hidden rounded-xl border"><div className="relative bg-muted"><img src={image.url} alt={image.caption || image.name} className="h-40 w-full object-contain" /><button onClick={() => removeImage(image.id)} className="absolute right-2 top-2 grid size-8 place-items-center rounded-lg bg-white/90 text-red-600 shadow"><Trash2 className="size-4" /></button></div><input value={image.caption} onChange={(event) => updateCaption(image.id, event.target.value)} placeholder="Add a caption" className="h-10 w-full border-t px-3 text-xs outline-none" /></div>)}</div>}<div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Saving adds your name and timestamp to version history.</span><PrimaryButton onClick={saveNote}><Save className="size-4" />Save shared note</PrimaryButton></div>{sharedNote?.history.length ? <details className="mt-4 rounded-xl border bg-muted/20 p-3"><summary className="cursor-pointer text-xs font-bold">Version history · {sharedNote.history.length}</summary><div className="mt-3 space-y-2">{[...sharedNote.history].reverse().slice(0, 10).map((revision, index) => <div key={revision.id} className="flex items-center justify-between gap-3 rounded-lg bg-white p-2 text-xs dark:bg-card"><span><strong>v{sharedNote.history.length - index}</strong> · {revision.editedByName}</span><time className="text-muted-foreground">{formatDate(revision.editedAt)}</time></div>)}</div></details> : null}</section>}
        </div>
      </section>
    </div>
    <button onClick={finishTest} className="fixed bottom-4 right-4 z-20 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-xl sm:hidden">End block</button>
    {navigatorOpen && <div className="fixed inset-0 z-50 flex items-end bg-slate-950/35" onClick={() => setNavigatorOpen(false)}><div onClick={(event) => event.stopPropagation()} className="max-h-[70vh] w-full rounded-t-3xl bg-white p-5 dark:bg-card"><div className="mb-4 flex items-center justify-between"><strong>Questions</strong><button onClick={() => setNavigatorOpen(false)}><X className="size-5" /></button></div><div className="grid grid-cols-8 gap-2 overflow-y-auto">{activeQuestions.map((item, index) => <button key={item.id} onClick={() => { move(index); setNavigatorOpen(false); }} className={cx('grid aspect-square place-items-center rounded-lg border text-xs font-bold', index === test.currentIndex ? 'bg-primary text-white' : test.answers[item.id] !== undefined ? 'bg-primary/10 text-primary' : '')}>{index + 1}</button>)}</div></div></div>}
    {reportOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-card"><div className="flex items-center justify-between"><div><h3 className="font-bold">Suggest a correction</h3><p className="text-xs text-muted-foreground">Question {question.number} · requires admin approval</p></div><button onClick={() => setReportOpen(false)}><X className="size-5" /></button></div><label className="mt-5 block"><span className="mb-1.5 block text-sm font-semibold">What should be corrected?</span><textarea value={reportMessage} onChange={(event) => setReportMessage(event.target.value)} className="min-h-28 w-full rounded-xl border p-3 text-sm outline-none focus:border-primary" placeholder="Describe the issue and the evidence for your correction…" /></label><label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold">Suggested correct answer (optional)</span><select value={suggestedAnswer ?? ''} onChange={(event) => setSuggestedAnswer(event.target.value === '' ? undefined : Number(event.target.value))} className="h-11 w-full rounded-xl border bg-white px-3 text-sm dark:bg-card"><option value="">Keep current answer</option>{question.options.map((option, index) => <option key={index} value={index}>{'ABCD'[index]}. {option}</option>)}</select></label><div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">The live question will not change until an administrator reviews and approves this proposal.</div><div className="mt-5 flex justify-end gap-2"><SecondaryButton onClick={() => setReportOpen(false)}>Cancel</SecondaryButton><PrimaryButton onClick={submitReport} disabled={!reportMessage.trim() && suggestedAnswer === undefined}><Save className="size-4" />Submit for approval</PrimaryButton></div></div></div>}
  </main>;
}

function HistoryView({ state, questions, onOpen }: { state: AppState; questions: Question[]; onOpen: (test: TestSession) => void }) {
  const tests = [...state.tests].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return <><PageHeader title="Previous tests" subtitle={`${tests.length} saved test${tests.length === 1 ? '' : 's'}`} openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))} /><div className="mx-auto max-w-5xl p-4 sm:p-7">{tests.length === 0 ? <div className="grid min-h-[55vh] place-items-center rounded-2xl border border-dashed bg-white/60"><div className="max-w-sm text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><BookOpenCheck className="size-6" /></div><h2 className="mt-4 font-bold">No tests yet</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Create your first test to start building a review history.</p></div></div> : <div className="space-y-3">{tests.map((test) => { const answered = Object.keys(test.answers).length; const correct = test.questionIds.filter((id) => { const question = questions.find((item) => item.id === id); return question && test.answers[id] === question.answer; }).length; const score = answered ? Math.round((correct / answered) * 100) : 0; return <article key={test.id} className="flex flex-col gap-4 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border sm:flex-row sm:items-center"><div className={cx('grid size-12 shrink-0 place-items-center rounded-2xl', test.status === 'active' ? 'bg-amber-50 text-amber-700' : score >= 70 ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700')}><FileText className="size-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{test.title}</h3><span className={cx('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', test.status === 'active' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>{test.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{formatDate(test.startedAt)} · {test.mode} · {answered}/{test.questionIds.length} answered</p></div><div className="flex items-center justify-between gap-5 sm:justify-end"><div className="text-right"><strong className="block text-xl">{test.status === 'active' ? `${test.currentIndex + 1}/${test.questionIds.length}` : `${score}%`}</strong><span className="text-[10px] text-muted-foreground">{test.status === 'active' ? 'position' : 'score'}</span></div><SecondaryButton onClick={() => onOpen(test)}>{test.status === 'active' ? 'Resume' : 'Review'}<ArrowRight className="size-4" /></SecondaryButton></div></article>; })}</div>}</div></>;
}

function ProgressView({ state, questions }: { state: AppState; questions: Question[] }) {
  const summary = useMemo(() => {
    const completed = questions.filter((question) => getQuestionProgress(state, question.id).attempts > 0);
    const correct = completed.filter((question) => getQuestionProgress(state, question.id).lastAnswer === question.answer);
    const incorrect = completed.length - correct.length;
    const flagged = questions.filter((question) => getQuestionProgress(state, question.id).flagged).length;
    const topics = Array.from(new Set(questions.map((question) => question.topic))).sort().map((topic) => {
      const pool = questions.filter((question) => question.topic === topic);
      const attempted = pool.filter((question) => getQuestionProgress(state, question.id).attempts > 0);
      const right = attempted.filter((question) => getQuestionProgress(state, question.id).lastAnswer === question.answer).length;
      return { topic, total: pool.length, completed: attempted.length, accuracy: attempted.length ? Math.round((right / attempted.length) * 100) : 0 };
    });
    return { completed: completed.length, correct: correct.length, incorrect, flagged, topics };
  }, [questions, state]);
  const completion = Math.round((summary.completed / questions.length) * 100);
  const accuracy = summary.completed ? Math.round((summary.correct / summary.completed) * 100) : 0;
  return <><PageHeader title="Progress" subtitle="A clear view of your QBank performance" openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))} /><div className="mx-auto max-w-6xl p-4 sm:p-7"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Completed" value={summary.completed} detail={`${completion}% of the bank`} /><StatCard label="Correct" value={summary.correct} detail={`${accuracy}% accuracy`} color="green" /><StatCard label="Incorrect" value={summary.incorrect} detail="Ready for review" color="red" /><StatCard label="Flagged" value={summary.flagged} detail="Saved questions" color="amber" /></div><section className="mt-6 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border sm:p-6"><div><h2 className="font-bold">Progress by topic</h2><p className="mt-1 text-sm text-muted-foreground">Completion and latest-answer accuracy.</p></div><div className="mt-6 space-y-5">{summary.topics.map((topic) => { const topicCompletion = Math.round((topic.completed / topic.total) * 100); return <div key={topic.topic}><div className="mb-2 flex flex-col justify-between gap-1 text-sm sm:flex-row sm:items-center"><strong>{topic.topic}</strong><span className="text-xs text-muted-foreground">{topic.completed}/{topic.total} completed · {topic.accuracy}% accuracy</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${topicCompletion}%` }} /></div></div>; })}</div></section></div></>;
}

function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character); }

function exportAsPdf(questions: Question[], collaboration: CollaborationState) {
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) { window.alert('Allow pop-ups to export your QBank as PDF.'); return; }
  const content = questions.map((question) => {
    const options = question.options.map((option, index) => `<li class="${index === question.answer ? 'answer' : ''}"><b>${'ABCD'[index]}.</b> ${escapeHtml(option)}${index === question.answer ? ' <span>Correct answer</span>' : ''}</li>`).join('');
    const note = collaboration.sharedNotes[`${question.qbankId ?? 'smle-gs'}:${question.id}`];
    const images = (note?.images ?? []).map((image) => `<figure><img src="${escapeHtml(image.url)}" alt=""/><figcaption>${escapeHtml(image.caption || image.name)}</figcaption></figure>`).join('');
    return `<article><header><b>Question ${question.number}</b><small>${escapeHtml(question.specialty)} · ${escapeHtml(question.topic)} · Source page ${question.sourcePage}</small></header><p class="stem">${escapeHtml(question.stem)}</p><ol>${options}</ol>${note?.content || images ? `<section class="notes"><b>Shared explanation</b><p dir="auto">${escapeHtml(note?.content ?? '').replace(/\n/g, '<br>')}</p>${images}<small>Last edited by ${escapeHtml(note?.updatedByName ?? '')} · ${escapeHtml(formatDate(note?.updatedAt))}</small></section>` : ''}</article>`;
  }).join('');
  popup.document.documentElement.innerHTML = `<!doctype html><html><head><title>MedGuard QBank Export</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font-family:Arial,"Segoe UI",sans-serif;color:#16283a;margin:0}main{max-width:800px;margin:auto}.cover{display:grid;min-height:92vh;place-items:center;text-align:center;page-break-after:always}.brand{color:#086bc4;font-size:42px;margin:0}.cover p{color:#627486}.cover strong{display:block;margin-top:24px;font-size:18px}article{page-break-inside:avoid;border-top:3px solid #086bc4;padding:18px 0 24px;margin-bottom:12px}article header{display:flex;justify-content:space-between;gap:16px;color:#086bc4}small{color:#64788c}.stem{line-height:1.7;font-size:14px}ol{list-style:none;padding:0;margin:16px 0}li{padding:8px 10px;border:1px solid #dce5ee;margin:5px 0;border-radius:7px;font-size:13px}.answer{background:#ecfdf5;border-color:#86efac}.answer span{float:right;color:#087b55;font-size:10px;font-weight:bold}.notes{margin-top:14px;padding:13px;background:#fff9dc;border:1px solid #f3dc75;border-radius:8px}.notes p{white-space:normal;line-height:1.7;font-size:13px}figure{margin:10px 0}figure img{max-width:100%;max-height:420px;object-fit:contain}figcaption{font-size:10px;color:#64788c}@media print{button{display:none}}</style></head><body><main><section class="cover"><div><h1 class="brand">MedGuard</h1><p>Collaborative Question Bank</p><strong>${questions.length} questions with answers and shared explanations</strong><p>Exported ${new Date().toLocaleDateString()}</p><button onclick="window.print()">Save as PDF</button></div></section>${content}</main><script>window.onload=()=>setTimeout(()=>window.print(),500);</script></body></html>`;
}

function downloadBackup(state: AppState, collaboration: CollaborationState) {
  const blob = new Blob([JSON.stringify({ personal: state, collaboration }, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = `medguard-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(anchor.href);
}

function SettingsView({ state, setState, syncStatus, onSync, questions, collaboration }: { state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>>; syncStatus: SyncStatus; onSync: () => void; questions: Question[]; collaboration: CollaborationState }) {
  return <><PageHeader title="Settings" subtitle="Study preferences, sync, and exports" openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))} /><div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-7"><section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h2 className="font-bold">Cloud sync</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{firebaseEnabled ? 'Firebase is connected. Changes sync automatically and can be forced at any time.' : 'Local preview mode. Add your Firebase values to enable account-based cloud sync.'}</p></div><PrimaryButton onClick={onSync} disabled={syncStatus === 'syncing' || !firebaseEnabled}><RefreshCw className={cx('size-4', syncStatus === 'syncing' && 'animate-spin')} />Sync now</PrimaryButton></div><div className={cx('mt-4 flex items-center gap-2 rounded-xl p-3 text-xs font-bold', firebaseEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>{firebaseEnabled ? <Cloud className="size-4" /> : <CloudOff className="size-4" />}{firebaseEnabled ? `Cloud ready${state.lastSyncAt ? ` · Last manual sync ${new Date(state.lastSyncAt).toLocaleString()}` : ''}` : 'Firebase setup required before cloud deployment'}</div></section>
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6"><h2 className="font-bold">Daily study goal</h2><p className="mt-1 text-sm text-muted-foreground">Used by the quick-start button on your dashboard.</p><div className="mt-5 flex items-center gap-4"><input type="range" min="5" max="100" step="5" value={state.settings.dailyGoal} onChange={(event) => setState((current) => ({ ...current, settings: { ...current.settings, dailyGoal: Number(event.target.value) } }))} className="flex-1 accent-primary" /><strong className="min-w-20 rounded-xl bg-primary/10 px-3 py-2 text-center text-primary">{state.settings.dailyGoal}</strong></div></section>
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6"><h2 className="font-bold">Export and backup</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Create a printable PDF with answers, shared notes, editor attribution, and images.</p><div className="mt-5 flex flex-wrap gap-3"><PrimaryButton onClick={() => exportAsPdf(questions, collaboration)}><FileText className="size-4" />Export current QBank</PrimaryButton><SecondaryButton onClick={() => downloadBackup(state, collaboration)}><Download className="size-4" />Download backup</SecondaryButton></div></section>
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6"><h2 className="font-bold">PWA installation</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">On iPad, open MedGuard in Safari, tap Share, then choose <strong>Add to Home Screen</strong>. The interface is optimized for touch, split view, and offline study.</p></section>
  </div></>;
}

function QuestionManager({ user, collaboration, updateCollaboration, questions, activeQBankId }: { user: AppUser; collaboration: CollaborationState; updateCollaboration: (updater: (current: CollaborationState) => CollaborationState) => void; questions: Question[]; activeQBankId: string }) {
  const [open, setOpen] = useState(false);
  const [stem, setStem] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [answer, setAnswer] = useState(0);
  const [specialty, setSpecialty] = useState(questions[0]?.specialty ?? 'General');
  const [topic, setTopic] = useState(questions[0]?.topic ?? 'General');
  const [rationale, setRationale] = useState('');
  const topics = Array.from(new Set(questions.map((question) => question.topic))).sort();
  function addQuestion(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stem.trim() || options.some((option) => !option.trim())) return;
    const proposedAt = new Date().toISOString();
    updateCollaboration((current) => ({
      ...current,
      proposals: [{ id: crypto.randomUUID(), qbankId: activeQBankId, type: 'new_question', payload: { stem: stem.trim(), options: options.map((option) => option.trim()), answer, specialty: specialty.trim() || 'General', topic: topic.trim() || 'General' }, rationale: rationale.trim(), status: 'pending', proposedById: user.uid, proposedByName: user.displayName, proposedAt }, ...current.proposals],
      auditLog: [{ id: crypto.randomUUID(), action: 'new_question_proposed', entityType: 'question', entityId: activeQBankId, actorId: user.uid, actorName: user.displayName, createdAt: proposedAt, detail: `Proposed a new question for ${activeQBankId}.` }, ...current.auditLog],
    }));
    setStem(''); setOptions(['', '', '', '']); setAnswer(0); setRationale(''); setOpen(false);
  }
  const mine = collaboration.proposals.filter((proposal) => proposal.proposedById === user.uid && proposal.qbankId === activeQBankId);
  const qbank = collaboration.qbanks.find((item) => item.id === activeQBankId);
  return <><PageHeader title="Community contributions" subtitle={`${qbank?.name ?? 'QBank'} · proposed questions require admin approval`} openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))} actions={<PrimaryButton onClick={() => setOpen(true)}><Plus className="size-4" />Propose question</PrimaryButton>} /><div className="mx-auto max-w-6xl p-4 sm:p-7"><div className="grid gap-4 sm:grid-cols-3"><StatCard label="Live questions" value={questions.length} detail="Approved and available in tests" /><StatCard label="Your proposals" value={mine.length} detail={`${mine.filter((item) => item.status === 'approved').length} approved`} /><StatCard label="Awaiting review" value={mine.filter((item) => item.status === 'pending').length} detail="Visible to the admin team" color="amber" /></div><section className="mt-6 overflow-hidden rounded-2xl bg-card ring-1 ring-border"><div className="border-b p-5"><h2 className="font-bold">Your contribution history</h2><p className="mt-1 text-sm text-muted-foreground">Proposals are attributed to your account and remain auditable.</p></div>{mine.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">You have not proposed a question or correction in this QBank yet.</div> : <div className="divide-y">{mine.map((proposal) => <div key={proposal.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[120px_1fr_auto]"><span className={cx('w-fit rounded-full px-2 py-1 text-[10px] font-bold uppercase', proposal.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : proposal.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800')}>{proposal.status}</span><span className="line-clamp-2">{proposal.payload.stem}</span><span className="text-xs text-muted-foreground">{formatDate(proposal.proposedAt)}</span></div>)}</div>}</section></div>
    {open && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/35 p-4 backdrop-blur-sm"><form onSubmit={addQuestion} className="my-8 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl dark:bg-card"><div className="flex items-center justify-between"><div><h2 className="font-bold">Propose a question</h2><p className="text-xs text-muted-foreground">It will enter the shared admin approval queue.</p></div><button type="button" onClick={() => setOpen(false)}><X className="size-5" /></button></div><label className="mt-5 block"><span className="mb-1.5 block text-sm font-semibold">Question stem</span><textarea required value={stem} onChange={(event) => setStem(event.target.value)} className="min-h-28 w-full rounded-xl border p-3 text-sm outline-none focus:border-primary" /></label><div className="mt-4 space-y-2">{options.map((option, index) => <label key={index} className="flex items-center gap-3"><input aria-label={`Mark option ${'ABCD'[index]} as correct`} type="radio" name="answer" checked={answer === index} onChange={() => setAnswer(index)} className="size-4 accent-primary" /><span className="grid size-7 place-items-center rounded-full bg-muted text-xs font-bold">{'ABCD'[index]}</span><input required value={option} onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="h-11 flex-1 rounded-xl border px-3 text-sm outline-none focus:border-primary" placeholder={`Option ${'ABCD'[index]}`} /></label>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-sm font-semibold">Specialty</span><input value={specialty} onChange={(event) => setSpecialty(event.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm" /></label><label><span className="mb-1.5 block text-sm font-semibold">Topic</span><input list="topic-options" value={topic} onChange={(event) => setTopic(event.target.value)} className="h-11 w-full rounded-xl border px-3 text-sm" /><datalist id="topic-options">{topics.map((item) => <option key={item} value={item} />)}</datalist></label></div><label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold">Source or rationale (recommended)</span><textarea value={rationale} onChange={(event) => setRationale(event.target.value)} className="min-h-20 w-full rounded-xl border p-3 text-sm" placeholder="Why should this question be added?" /></label><div className="mt-6 flex justify-end gap-2"><SecondaryButton onClick={() => setOpen(false)}>Cancel</SecondaryButton><PrimaryButton type="submit"><Save className="size-4" />Submit for approval</PrimaryButton></div></form></div>}
  </>;
}

export default function MedGuardApp() {
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);
  const [state, setState] = useState<AppState>(initialAppState);
  const [collaboration, setCollaboration] = useState<CollaborationState>(initialCollaborationState);
  const [hydrated, setHydrated] = useState(false);
  const [collaborationHydrated, setCollaborationHydrated] = useState(false);
  const [view, setView] = useState<View>('dashboard');
  const [activeTestId, setActiveTestId] = useState<string>();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(firebaseEnabled ? 'syncing' : 'local');
  const [mobileOpen, setMobileOpen] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const collaborationSaveTimer = useRef<number | undefined>(undefined);
  const lastSavedCollaboration = useRef<CollaborationState>(initialCollaborationState());

  const allQuestions = useMemo(() => {
    const imported = baseQuestions.map((question) => ({ ...question, qbankId: question.qbankId ?? 'smle-gs' }));
    const merged = new Map<string, Question>();
    [...imported, ...state.customQuestions.map((question) => ({ ...question, qbankId: question.qbankId ?? 'smle-gs' })), ...collaboration.approvedQuestions].forEach((question) => merged.set(question.id, { ...question, ...state.questionOverrides[question.id] }));
    return [...merged.values()];
  }, [state.customQuestions, state.questionOverrides, collaboration.approvedQuestions]);
  const activeQBankId = state.settings.activeQBankId || 'smle-gs';
  const questions = useMemo(() => allQuestions.filter((question) => (question.qbankId ?? 'smle-gs') === activeQBankId), [allQuestions, activeQBankId]);
  const activeTest = state.tests.find((test) => test.id === activeTestId) ?? state.tests.find((test) => test.status === 'active');

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    const openMenu = () => setMobileOpen(true);
    window.addEventListener('medguard-open-menu', openMenu);
    const online = () => setSyncStatus(firebaseEnabled ? 'syncing' : 'local');
    const offline = () => setSyncStatus('offline');
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    return () => { window.removeEventListener('medguard-open-menu', openMenu); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    async function initialize() {
      if (firebaseEnabled) cleanup = await observeFirebaseUser((account) => { if (!cancelled) setUser(account ?? null); });
      else setUser((await loadSession()) ?? null);
    }
    void initialize();
    return () => { cancelled = true; cleanup?.(); };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function hydrate() {
      try {
        const local = await loadLocalState(user!.uid);
        let resolved = normalizeAppState(local);
        let shared = (await loadLocalCollaboration()) ?? initialCollaborationState();
        if (user!.provider === 'local' && !shared.members.some((member) => member.uid === user!.uid)) {
          shared = { ...shared, members: [...shared.members, { uid: user!.uid, email: user!.email, displayName: user!.displayName, universityId: user!.universityId ?? 'ADMIN-DEMO', role: user!.role, status: user!.status, createdAt: user!.createdAt ?? new Date().toISOString() }] };
        }
        if (firebaseEnabled && navigator.onLine && user!.status === 'approved') {
          const cloud = await loadCloudState(user!.uid);
          if (cloud) resolved = normalizeAppState(cloud);
          shared = await loadCollaborationState(user!);
          setSyncStatus('synced');
        }
        if (!cancelled) { setState(resolved); setCollaboration(shared); lastSavedCollaboration.current = shared; setHydrated(true); setCollaborationHydrated(true); }
      } catch { if (!cancelled) { const shared = initialCollaborationState(); setState(initialAppState()); setCollaboration(shared); lastSavedCollaboration.current = shared; setHydrated(true); setCollaborationHydrated(true); setSyncStatus(firebaseEnabled ? 'error' : 'local'); } }
    }
    void hydrate();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user || !hydrated) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveLocalState(user.uid, state);
      if (firebaseEnabled && state.settings.autoSync && navigator.onLine) {
        setSyncStatus('syncing');
        void saveCloudState(user.uid, state).then(() => setSyncStatus('synced')).catch(() => setSyncStatus('error'));
      } else setSyncStatus(navigator.onLine ? 'local' : 'offline');
    }, 450);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [state, user, hydrated]);

  useEffect(() => {
    if (!user || !collaborationHydrated || user.status !== 'approved') return;
    if (collaborationSaveTimer.current) window.clearTimeout(collaborationSaveTimer.current);
    collaborationSaveTimer.current = window.setTimeout(() => {
      const previous = lastSavedCollaboration.current;
      void saveLocalCollaboration(collaboration);
      if (firebaseEnabled && navigator.onLine) {
        setSyncStatus('syncing');
        void saveCollaborationState(collaboration, previous).then(() => { lastSavedCollaboration.current = collaboration; setSyncStatus('synced'); }).catch(() => setSyncStatus('error'));
      } else {
        lastSavedCollaboration.current = collaboration;
        setSyncStatus(navigator.onLine ? 'local' : 'offline');
      }
    }, 650);
    return () => { if (collaborationSaveTimer.current) window.clearTimeout(collaborationSaveTimer.current); };
  }, [collaboration, user, collaborationHydrated]);

  async function manualSync() {
    if (!user || !firebaseEnabled || !navigator.onLine) { setSyncStatus(navigator.onLine ? 'local' : 'offline'); return; }
    setSyncStatus('syncing');
    try { const next = { ...state, lastSyncAt: new Date().toISOString() }; await Promise.all([saveCloudState(user.uid, next), saveCollaborationState(collaboration, lastSavedCollaboration.current)]); await Promise.all([saveLocalState(user.uid, next), saveLocalCollaboration(collaboration)]); lastSavedCollaboration.current = collaboration; setState(next); setSyncStatus('synced'); } catch { setSyncStatus('error'); }
  }

  async function signOut() {
    if (firebaseEnabled) await signOutFirebase(); else await saveSession();
    setUser(null); setHydrated(false); setCollaborationHydrated(false); setState(initialAppState()); setCollaboration(initialCollaborationState()); setView('dashboard');
  }

  const createTest = useCallback((config: TestBuilderConfig) => {
    const eligible = questions.filter((question) => {
      const progress = getQuestionProgress(state, question.id);
      const statusMatch = config.statuses.length === 0 || config.statuses.some((status) => status === 'new' ? progress.attempts === 0 : status === 'previous' ? progress.attempts > 0 : status === 'correct' ? progress.attempts > 0 && progress.lastAnswer === question.answer : status === 'incorrect' ? progress.attempts > 0 && progress.lastAnswer !== question.answer : progress.flagged);
      return question.specialty === config.specialty && (config.topics.length === 0 || config.topics.includes(question.topic)) && statusMatch;
    });
    const selected = [...eligible].sort(() => Math.random() - 0.5).slice(0, config.count);
    if (!selected.length) { setView('create'); return; }
    const now = new Date().toISOString();
    const test: TestSession = { id: crypto.randomUUID(), title: `${collaboration.qbanks.find((item) => item.id === activeQBankId)?.shortName ?? config.specialty} · ${selected.length} ${selected.length === 1 ? 'question' : 'questions'}`, mode: config.mode, questionIds: selected.map((question) => question.id), currentIndex: 0, answers: {}, revealed: [], graded: [], startedAt: now, updatedAt: now, status: 'active', qbankId: activeQBankId };
    setState((current) => ({ ...current, tests: [test, ...current.tests] })); setActiveTestId(test.id); setView('test');
  }, [questions, state, collaboration.qbanks, activeQBankId]);

  const quickTest = useCallback(() => { const specialty = questions[0]?.specialty ?? 'General'; createTest({ mode: 'tutor', statuses: ['new'], specialty, topics: [], count: Math.min(state.settings.dailyGoal, questions.filter((question) => getQuestionProgress(state, question.id).attempts === 0).length) }); }, [createTest, questions, state]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool || !user || !hydrated || !collaborationHydrated || user.status !== 'approved') return;
    const lifecycle = new AbortController();
    const completed = questions.filter((question) => getQuestionProgress(state, question.id).attempts > 0).length;
    void Promise.resolve(context.registerTool({
      name: 'get_medguard_progress',
      title: 'Get MedGuard progress',
      description: 'Read the signed-in learner’s current MedGuard question-bank progress summary.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => ({ totalQuestions: questions.length, completed, remaining: questions.length - completed, flagged: questions.filter((question) => getQuestionProgress(state, question.id).flagged).length }),
    }, { signal: lifecycle.signal })).catch(() => undefined);
    void Promise.resolve(context.registerTool({
      name: 'start_medguard_daily_test',
      title: 'Start daily MedGuard test',
      description: 'Create and open a Tutor-mode test from new questions in the learner’s active QBank using the daily goal.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => { quickTest(); return { status: 'started', questionCount: Math.min(state.settings.dailyGoal, questions.length - completed), mode: 'tutor' }; },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [user, hydrated, collaborationHydrated, state, questions, quickTest]);

  if (user === undefined) return <main className="grid min-h-screen place-items-center bg-[#f4f8fc]"><div className="text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary text-white"><Sparkles className="size-5 animate-pulse" /></div><p className="mt-3 text-sm font-semibold text-muted-foreground">Preparing MedGuard…</p></div></main>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;
  if (user.status !== 'approved') return <PendingApproval user={user} onSignOut={() => void signOut()} />;
  if (!hydrated || !collaborationHydrated) return <main className="grid min-h-screen place-items-center bg-[#f4f8fc]"><div className="text-center"><RefreshCw className="mx-auto size-7 animate-spin text-primary" /><p className="mt-3 text-sm font-semibold text-muted-foreground">Loading your collaborative workspace…</p></div></main>;
  if (view === 'test' && activeTest) return <TestView user={user} test={activeTest} questions={allQuestions} state={state} setState={setState} collaboration={collaboration} updateCollaboration={(updater) => setCollaboration(updater)} onExit={() => { setActiveTestId(undefined); setView(activeTest.status === 'completed' ? 'history' : 'dashboard'); }} />;

  return <main className="min-h-screen bg-background text-foreground"><div className="flex min-h-screen"><AppSidebar view={view} setView={setView} user={user} syncStatus={syncStatus} onSignOut={() => void signOut()} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} qbanks={collaboration.qbanks} activeQBankId={activeQBankId} onSelectQBank={(id) => setState((current) => ({ ...current, settings: { ...current.settings, activeQBankId: id } }))} /><section className="min-w-0 flex-1">{view === 'dashboard' && <Dashboard state={state} questions={questions} setView={setView} startQuickTest={quickTest} />}{view === 'create' && <CreateTest questions={questions} state={state} onStart={createTest} />}{view === 'history' && <HistoryView state={{ ...state, tests: state.tests.filter((test) => (test.qbankId ?? 'smle-gs') === activeQBankId) }} questions={questions} onOpen={(test) => { setActiveTestId(test.id); setView('test'); }} />}{view === 'progress' && <ProgressView state={state} questions={questions} />}{view === 'settings' && <SettingsView state={state} setState={setState} syncStatus={syncStatus} onSync={() => void manualSync()} questions={questions} collaboration={collaboration} />}{view === 'manager' && <QuestionManager user={user} collaboration={collaboration} updateCollaboration={(updater) => setCollaboration(updater)} questions={questions} activeQBankId={activeQBankId} />}{view === 'admin' && user.isAdmin && <AdminDashboard user={user} collaboration={collaboration} update={(updater) => setCollaboration(updater)} />}</section></div></main>;
}
