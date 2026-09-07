'use client';

/* oxlint-disable next/no-img-element, jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/control-has-associated-label */

import { Subscribe, UpgradeButton, UpgradeDialog } from '@/components/subscription-workspace';
import { ContactWorkspace } from '@/components/contact-workspace';
import { AccountProfile } from '@/components/account-profile';
import { SystemStatePage } from '@/components/system-state-page';
import { QuestionImportReview } from '@/components/question-import-review';
import { QuestionId, QuestionOption } from '@/components/question-tools';
import { openLiveChannels } from '@/lib/realtime-client';
import { mergeLiveState } from '@/lib/merge-live-state';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  ArrowRight,
  BarChart3,
  Bold,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ClipboardList,
  ClipboardPlus,
  Copy,
  Cloud,
  CloudOff,
  Download,
  FileText,
  Flag,
  Eye,
  EyeOff,
  Highlighter,
  ImagePlus,
  Italic,
  LayoutDashboard,
  Library,
  List,
  LogOut,
  Menu,
  Moon,
  Pencil,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScanSearch,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  createCloudflareAccount,
  beginTotpEnrollment,
  completeCloudflareMfaSignIn,
  completeTotpEnrollment,
  joinCloudflareQBankByLink,
  loadCollaborationState,
  loadCloudState,
  observeCloudflareUser,
  previewCloudflareQBankInvitation,
  saveCloudState,
  saveCollaborationState,
  signInCloudflare,
  signOutCloudflare,
  uploadNoteImage,
  type QBankLinkInvitation,
} from '@/lib/cloudflare-client';
import { loadLocalCollaboration, loadLocalState, saveLocalState, saveLocalCollaboration } from '@/lib/local-db';
import {
  emptyProgress,
  initialCollaborationState,
  initialAppState,
  normalizeCollaborationState,
  normalizeAppState,
  canAccessBank,
  canManageBank,
  optionLabel,
  type AppState,
  type AppUser,
  type CollaborationState,
  type HighlightRange,
  type Question,
  type QuestionProgress,
  type QuestionProposal,
  type QuestionStatus,
  type ProposalEditKind,
  type TestBuilderConfig,
  type TestSession,
} from '@/lib/medguard-types';
import { AdminDashboard, PendingApproval } from '@/components/collaboration-dashboard';
import { QBankWorkspace } from '@/components/qbank-workspace';
import { QBankManagement } from '@/components/qbank-management';
import { ReviewWorkspace } from '@/components/review-workspace';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StudyMobileNav } from '@/components/study-mobile-nav';
import { StudyDashboard } from '@/components/study-dashboard';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn as cx } from '@/lib/utils';

type View = 'subscribe' | 'contact' | 'account' | 'dashboard' | 'library' | 'qbank-management' | 'review' | 'create' | 'history' | 'progress' | 'settings' | 'manager' | 'admin' | 'test';
type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error';

interface ModelContextLike {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      execute: (input: unknown) => unknown;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
}

const baseQuestions: Question[] = [];

const NAV_ITEMS = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'library' as const, label: 'My QBanks', icon: Library },
  { id: 'create' as const, label: 'Create test', icon: ClipboardPlus },
  { id: 'history' as const, label: 'Previous tests', icon: BookOpenCheck },
  { id: 'progress' as const, label: 'Progress', icon: BarChart3 },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
];

function formatDate(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function testElapsedSeconds(test: TestSession, now = Date.now()) {
  if (test.elapsedSeconds !== undefined) {
    if (test.timerPaused || test.status !== 'active') return test.elapsedSeconds;
    const runningSince = new Date(test.timerStartedAt ?? test.startedAt).getTime();
    return test.elapsedSeconds + Math.max(0, Math.floor((now - runningSince) / 1000));
  }
  const end = test.completedAt ? new Date(test.completedAt).getTime() : now;
  return Math.max(0, Math.floor((end - new Date(test.startedAt).getTime()) / 1000));
}

function getQuestionProgress(state: AppState, questionId: string): QuestionProgress {
  return state.progress[questionId] ?? emptyProgress();
}

function matchesTestConfig(question: Question, state: AppState, config: TestBuilderConfig): boolean {
  const progress = getQuestionProgress(state, question.id);
  const statusMatch =
    config.statuses.length === 0 ||
    config.statuses.some((status) =>
      status === 'new' ? progress.attempts === 0 : status === 'previous' ? progress.attempts > 0 : status === 'correct' ? progress.attempts > 0 && progress.lastAnswer === question.answer : status === 'incorrect' ? progress.attempts > 0 && progress.lastAnswer !== question.answer : progress.flagged,
    );
  return question.specialty === config.specialty && (config.topics.length === 0 || config.topics.includes(question.topic)) && statusMatch;
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

function HighlightedText({ text, ranges, onRemove }: { text: string; ranges: HighlightRange[]; onRemove?: (range: HighlightRange) => void }) {
  const valid = mergeRanges(ranges).filter((range) => range.start < text.length);
  const output: React.ReactNode[] = [];
  let cursor = 0;
  valid.forEach((range, index) => {
    const end = Math.min(range.end, text.length);
    if (range.start > cursor) output.push(text.slice(cursor, range.start));
    output.push(
      <mark key={`${range.start}-${end}-${index}`} className="rounded-sm bg-[#ffe66d] px-0.5 text-slate-900">
        <button type="button" title="Click to remove marker" aria-label={`Remove highlight: ${text.slice(range.start, end)}`} onClick={() => onRemove?.(range)} className="cursor-pointer text-inherit">
          {text.slice(range.start, end)}
        </button>
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
}

function IconButton({ label, children, onClick, active, disabled }: { label: string; children: React.ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx('grid size-10 place-items-center rounded-xl border text-muted-foreground transition hover:border-primary/35 hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40', active && 'border-primary/40 bg-primary/10 text-primary')}
    >
      {children}
    </button>
  );
}

function PrimaryButton({ children, onClick, disabled, type = 'button', className, tone = 'primary' }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit'; className?: string; tone?: 'primary' | 'study' | 'contribute' }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cx('q-button', `q-button-${tone}`, className)}>
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, disabled, className }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cx('q-button q-button-secondary', className)}>
      {children}
    </button>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: AppUser) => void }) {
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [universityId, setUniversityId] = useState('');
  const [phone, setPhone] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaRequired && password.length < 10) {
      setError('Use at least 10 characters for your password.');
      return;
    }
    if (register && !setupToken.trim() && phone.trim().length < 7) {
      setError('Enter a valid mobile number.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const user = register
        ? await createCloudflareAccount(name, email, password, universityId, phone, setupToken)
        : mfaRequired
          ? await completeCloudflareMfaSignIn(mfaCode)
          : await signInCloudflare(email, password);
      onAuthenticated(user);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to sign in.';
      if (message === 'MFA_REQUIRED') {
        setMfaRequired(true);
        setError('');
      } else setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout grid min-h-screen text-foreground lg:grid-cols-[0.95fr_1.05fr]">
      <section className="auth-story relative hidden overflow-hidden bg-[radial-gradient(circle_at_15%_15%,#168ee8_0,#075dab_36%,#073c74_100%)] p-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -bottom-48 -left-40 size-[560px] rounded-full border border-white/10" />
        <div className="absolute -bottom-28 -left-20 size-[380px] rounded-full border border-cyan-300/15" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <Sparkles className="size-5" />
          </div>
          <div>
            <strong className="block text-xl">Qraft</strong>
            <span className="text-xs text-blue-100/80">Collaborative QBank</span>
          </div>
        </div>
        <div className="relative max-w-xl">
          <div className="mb-6 grid size-14 place-items-center rounded-2xl bg-[#62dfbd]/15 ring-1 ring-[#73e9c8]/30">
            <ShieldCheck className="size-7 text-[#82f2d1]" />
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-[-0.035em]">
            Study with focus.
            <br />
            Improve with every question.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-blue-50/80">Build trusted medical QBanks together, review every change, and keep your personal progress synced across devices.</p>
          <div className="mt-9 grid max-w-lg grid-cols-3 gap-3">
            {[
              ['217', 'study questions'],
              ['2', 'test modes'],
              ['100%', 'private progress'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
                <strong className="block text-xl">{value}</strong>
                <span className="text-xs text-blue-100/75">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-blue-100/60">A thoughtful space to build knowledge, together.</p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="auth-panel q-enter w-full max-w-[470px]">
          <div className="mb-9 flex items-center gap-3 lg:hidden">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-white">
              <Sparkles className="size-4" />
            </div>
            <strong className="text-xl">Qraft</strong>
          </div>
          <div className="mb-8">
            <p className="mb-2 text-sm font-bold text-primary">{register ? 'REQUEST MEMBERSHIP' : 'WELCOME BACK'}</p>
            <h2 className="text-3xl font-bold tracking-tight">{register ? 'Create your study account' : 'Good to see you again.'}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{register ? 'Add your details below. An administrator will review your account before you start studying.' : 'Pick up where you left off. Your questions, notes and progress are here.'}</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            {mfaRequired && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center gap-2 font-bold text-primary">
                  <ShieldCheck className="size-4" />
                  Two-factor authentication
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">Enter the six-digit code from your authenticator app.</p>
              </div>
            )}
            {register && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Full name</span>
                <input
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-12 w-full rounded-xl border bg-white px-4 text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-primary focus:ring-3 focus:ring-primary/10 dark:bg-card dark:text-foreground dark:placeholder:text-muted-foreground"
                  placeholder="Khaled"
                />
              </label>
            )}
            {register && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Mobile number</span>
                <input
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="h-12 w-full rounded-xl border bg-white px-4 text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-primary focus:ring-3 focus:ring-primary/10 dark:bg-card dark:text-foreground dark:placeholder:text-muted-foreground"
                  placeholder="05XXXXXXXX"
                />
                <span className="mt-1 block text-xs text-muted-foreground">Used to verify your membership.</span>
              </label>
            )}
            {register && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">University ID</span>
                <input
                  autoComplete="off"
                  value={universityId}
                  onChange={(event) => setUniversityId(event.target.value.toUpperCase())}
                  className="h-12 w-full rounded-xl border bg-white px-4 font-mono text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-primary focus:ring-3 focus:ring-primary/10 dark:bg-card dark:text-foreground dark:placeholder:text-muted-foreground"
                  placeholder="442001234"
                />
                <span className="mt-1 block text-xs text-muted-foreground">Your ID doesn’t need to be listed already. We can verify it during approval.</span>
              </label>
            )}
            {!mfaRequired && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Email address</span>
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-12 w-full rounded-xl border bg-white px-4 text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-primary focus:ring-3 focus:ring-primary/10 dark:bg-card dark:text-foreground dark:placeholder:text-muted-foreground"
                  placeholder="you@example.com"
                />
              </label>
            )}
            {!mfaRequired && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Password</span>
                <span className="relative block"><input
                  required
                  minLength={10}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={register ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-12 w-full rounded-xl border bg-white px-4 text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-primary focus:ring-3 focus:ring-primary/10 dark:bg-card dark:text-foreground dark:placeholder:text-muted-foreground"
                  placeholder={register ? 'At least 10 characters' : 'Enter your password'}
                  style={{ paddingRight: 48 }}
                /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-1 grid w-11 place-items-center rounded-lg text-muted-foreground">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></span>
              </label>
            )}
            {register && (
              <details>
                <summary>Setting up the platform for the first time?</summary>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-sm font-semibold">Superadmin setup code <span className="font-normal text-muted-foreground">(optional)</span></span>
                <input type="password" autoComplete="off" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} className="h-12 w-full rounded-xl border bg-white px-4 text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-primary focus:ring-3 focus:ring-primary/10 dark:bg-card dark:text-foreground" placeholder="Only for the configured Superadmin email" />
              </label>
              </details>
            )}
            {mfaRequired && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Authenticator code</span>
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ''))}
                  className="h-12 w-full rounded-xl border bg-white px-4 text-center font-mono text-xl tracking-[.4em] text-slate-900 outline-none placeholder:text-slate-500 focus:border-primary dark:bg-card dark:text-foreground dark:placeholder:text-muted-foreground"
                  placeholder="000000"
                />
              </label>
            )}
            {error && (
              <div role="alert" className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/12 dark:text-red-200">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            )}
            <PrimaryButton type="submit" disabled={busy || (mfaRequired && mfaCode.length !== 6)} className="w-full">
              {busy && <RefreshCw className="size-4 animate-spin" />}
              {mfaRequired ? 'Verify and sign in' : register ? 'Submit registration' : 'Sign in'}
            </PrimaryButton>
          </form>
          <p className="mt-7 text-center text-sm text-muted-foreground">
            {register ? 'Already have an account?' : 'New to Qraft?'}{' '}
            <button
              type="button"
              onClick={() => {
                setRegister(!register);
                setMfaRequired(false);
                setMfaCode('');
                setError('');
              }}
              className="font-bold text-primary hover:underline"
            >
              {register ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}

function MfaEnrollmentGate({ onComplete, onSignOut }: { onComplete: () => void; onSignOut: () => void }) {
  const [setup, setSetup] = useState<{ secretKey: string; qrUrl: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function begin() {
    setBusy(true);
    setError('');
    try {
      setSetup(await beginTotpEnrollment());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to start MFA enrollment.');
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    setBusy(true);
    setError('');
    try {
      await completeTotpEnrollment(code);
      onComplete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The code is invalid or expired.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <section className="w-full max-w-xl rounded-3xl bg-card p-7 shadow-2xl ring-1 ring-border">
        <div className="grid size-14 place-items-center rounded-2xl bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
          <ShieldCheck className="size-7" />
        </div>
        <p className="mt-6 text-xs font-bold uppercase tracking-widest text-violet-600">Superadmin security boundary</p>
        <h1 className="mt-2 text-2xl font-bold">Two-factor authentication is required</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">The only Superadmin account cannot open Qraft administration until an authenticator-app factor is enrolled.</p>
        {!setup ? (
          <button onClick={() => void begin()} disabled={busy} className="mt-6 h-11 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50">
            {busy ? 'Preparing…' : 'Set up authenticator app'}
          </button>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border bg-muted/30 p-4">
              <span className="text-xs font-bold">Authenticator setup key</span>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-card p-3 text-xs">{setup.secretKey}</code>
                <button onClick={() => void navigator.clipboard.writeText(setup.secretKey)} className="grid size-10 place-items-center rounded-lg border" aria-label="Copy setup key">
                  <Copy className="size-4" />
                </button>
              </div>
              <a href={setup.qrUrl} className="mt-3 inline-block text-xs font-bold text-primary underline">
                Open authenticator setup link
              </a>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">Six-digit verification code</span>
              <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} className="h-12 w-full rounded-xl border bg-card px-4 text-center font-mono text-xl tracking-[.35em]" placeholder="000000" />
            </label>
            <button onClick={() => void finish()} disabled={busy || code.length !== 6} className="h-11 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50">
              Verify and secure account
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}
        <button onClick={onSignOut} className="mt-4 h-10 w-full rounded-xl border text-xs font-bold">
          Sign out
        </button>
      </section>
    </main>
  );
}

function subscribeDesktopNavigation(callback: () => void) {
  const media = window.matchMedia('(min-width: 1024px)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function subscribeConnection(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function AppSidebar({
  view,
  setView,
  user,
  syncStatus,
  onSignOut,
  mobileOpen,
  closeMobile,
  qbanks,
  activeQBankId,
  onSelectQBank,
  showReview,
}: {
  view: View;
  setView: (view: View) => void;
  user: AppUser;
  syncStatus: SyncStatus;
  onSignOut: () => void;
  mobileOpen: boolean;
  closeMobile: () => void;
  qbanks: CollaborationState['qbanks'];
  activeQBankId: string;
  onSelectQBank: (id: string) => void;
  showReview: boolean;
}) {
  const desktop = useSyncExternalStore(subscribeDesktopNavigation, () => window.matchMedia('(min-width: 1024px)').matches, () => false);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobileOpen || desktop) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select, a[href]') ?? []).filter((item) => item.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeMobile(); }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [mobileOpen, closeMobile, desktop]);
  const navigate = (next: View) => {
    setView(next);
    closeMobile();
  };
  const roleLabel = user.role === 'student' ? 'Learner' : user.role.replaceAll('_', ' ');
  return (
    <>
      {mobileOpen && <button aria-label="Close menu" onClick={closeMobile} className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm lg:hidden" />}
      <aside ref={sidebarRef} inert={!desktop && !mobileOpen} aria-label="Workspace navigation" className={cx('q-sidebar fixed inset-y-0 left-0 z-50 flex h-dvh w-[270px] shrink-0 flex-col overflow-hidden border-r bg-sidebar shadow-2xl transition-transform duration-200 lg:z-20 lg:w-[254px] lg:translate-x-0 lg:shadow-none', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-[72px] shrink-0 items-center justify-between border-b px-5">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-primary text-white shadow-sm">
              <Sparkles className="size-4" />
            </div>
            <div>
              <strong className="block text-[17px] tracking-tight">Qraft</strong>
              <span className="block text-xs text-muted-foreground">Learn better, together</span>
            </div>
          </div>
          <button aria-label="Close navigation" onClick={closeMobile} className="grid size-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted lg:hidden">
            <X className="size-5" />
          </button>
        </div>
        <div className="mx-3 mt-4 shrink-0 rounded-xl border bg-card p-3">
          <p className="mb-2 px-1 text-xs font-semibold text-muted-foreground">Currently studying</p>
          <label className="flex items-center gap-2">
            <Library className="ml-1 size-4 shrink-0 text-primary" />
            <span className="sr-only">Active QBank</span>
            <span className="relative min-w-0 flex-1">
              <select
                aria-label="Active QBank"
                value={activeQBankId}
                onChange={(event) => {
                  onSelectQBank(event.target.value);
                  navigate('dashboard');
                }}
                className="qbank-selector min-w-0 w-full appearance-none rounded-lg border border-border/70 bg-card px-2 py-1.5 pr-7 text-sm font-semibold text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {qbanks
                  .filter((item) => !item.archived)
                  .map((qbank) => (
                    <option key={qbank.id} value={qbank.id}>
                      {qbank.shortName}
                    </option>
                  ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            </span>
          </label>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable] [scrollbar-width:thin]" aria-label="Primary navigation">
          <p className="q-eyebrow px-3 pb-2 pt-3">Study space</p>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
              className={cx('group relative flex h-11 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 text-left text-sm font-semibold transition', view === item.id ? 'bg-primary/10 text-primary' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')}
            >
              <span className={cx('absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary transition-opacity', view === item.id ? 'opacity-100' : 'opacity-0')} />
              <item.icon className="size-[18px] shrink-0 transition-transform group-hover:scale-105" />
              <span className="min-w-0 truncate whitespace-nowrap">{item.label}</span>
            </button>
          ))}
          {showReview && (
            <button
              aria-current={view === 'review' ? 'page' : undefined}
              onClick={() => navigate('review')}
              className={cx('flex h-11 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 text-left text-sm font-semibold transition', view === 'review' ? 'bg-primary/10 text-primary' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')}
            >
              <ScanSearch className="size-[18px] shrink-0" />
              <span className="min-w-0 truncate whitespace-nowrap">Review</span>
            </button>
          )}
          <button onClick={() => navigate('contact')} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold"><CircleAlert className="size-4"/>Contact Us</button>
          {user.tier === 'lite' && <button onClick={() => navigate('subscribe')} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-amber-700 dark:text-amber-300"><Sparkles className="size-4"/>Subscribe</button>}
          <div className="my-3 border-t" /><p className="q-eyebrow px-3 pb-2">Learn together</p>
          <button
            aria-current={view === 'manager' ? 'page' : undefined}
            onClick={() => navigate('manager')}
            className={cx('flex h-11 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 text-left text-sm font-semibold transition', view === 'manager' ? 'bg-primary/10 text-primary' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')}
          >
            <ClipboardList className="size-[18px] shrink-0" />
            <span className="min-w-0 truncate whitespace-nowrap">Contributions</span>
          </button>
          {user.isAdmin && (
            <button
              aria-current={view === 'admin' ? 'page' : undefined}
              onClick={() => navigate('admin')}
              className={cx(
                'flex h-11 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 text-left text-sm font-semibold transition',
                view === 'admin' ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <Users className="size-[18px] shrink-0" />
              <span className="min-w-0 truncate whitespace-nowrap">Admin dashboard</span>
            </button>
          )}
        </nav>
        <footer className="shrink-0 border-t bg-sidebar/95 p-3 backdrop-blur-xl">
          <div className="rounded-2xl border bg-card/80 p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <button onClick={() => navigate('account')} aria-label="Open account profile" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left transition hover:bg-muted">
                <span className={`profile-ring profile-ring-${user.tier} grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-black text-primary`}>{user.displayName.slice(0, 2).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{user.displayName}</strong>
                  <span className="mt-0.5 block truncate text-xs capitalize text-muted-foreground" title={user.email}>{roleLabel} · {user.tier.toUpperCase()}</span>
                </span>
              </button>
              <button title="Sign out" aria-label="Sign out" onClick={onSignOut} className="grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
                <LogOut className="size-4" />
              </button>
            </div>
            {user.tier === 'lite' && <div className="mt-3"><UpgradeButton /></div>}
            <div className={cx('mt-3 flex items-center gap-2 border-t pt-2.5 text-xs font-medium', syncStatus === 'error' ? 'text-red-600' : syncStatus === 'offline' || syncStatus === 'local' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300')}>
              {syncStatus === 'syncing' ? <RefreshCw className="size-3.5 animate-spin" /> : syncStatus === 'offline' || syncStatus === 'local' ? <CloudOff className="size-3.5" /> : <Cloud className="size-3.5" />}
              <span className="truncate">{syncStatus === 'syncing' ? 'Syncing changes' : syncStatus === 'synced' ? 'All changes synced' : syncStatus === 'error' ? 'Sync needs attention' : syncStatus === 'offline' ? 'Working offline' : 'Saved on this device'}</span>
              <span className="ml-auto size-1.5 shrink-0 rounded-full bg-current" />
            </div>
          </div>
        </footer>
      </aside>
    </>
  );
}

function PageHeader({ title, subtitle, openMenu, actions }: { title: string; subtitle?: string; openMenu: () => void; actions?: React.ReactNode }) {
  return (
    <header className="workspace-header">
      <div className="flex min-w-0 items-center gap-3">
        <button aria-label="Open navigation" onClick={openMenu} className="grid size-10 place-items-center rounded-xl border lg:hidden">
          <Menu className="size-5" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm leading-5 text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="workspace-header-actions">{actions}</div>}
    </header>
  );
}

function StatCard({ label, value, detail, color = 'blue' }: { label: string; value: number | string; detail: string; color?: 'blue' | 'green' | 'red' | 'amber' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/12 dark:text-blue-200',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200',
    red: 'bg-red-50 text-red-700 dark:bg-red-500/12 dark:text-red-200',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-200',
  };
  return (
    <article className="rounded-2xl bg-card p-5 shadow-[0_5px_20px_rgba(24,53,78,0.055)] ring-1 ring-border">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">{label}</p>
          <strong className="mt-2 block text-3xl tracking-tight">{value}</strong>
          <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>
        </div>
        <div className={cx('grid size-9 place-items-center rounded-xl', colors[color])}>{color === 'green' ? <CheckCircle2 className="size-4" /> : color === 'amber' ? <Flag className="size-4" /> : color === 'red' ? <CircleAlert className="size-4" /> : <BarChart3 className="size-4" />}</div>
      </div>
    </article>
  );
}

function CreateTest({ questions, state, onStart }: { questions: Question[]; state: AppState; onStart: (config: TestBuilderConfig) => void }) {
  const topics = useMemo(() => Array.from(new Set(questions.map((question) => question.topic))).sort(), [questions]);
  const specialties = useMemo(() => Array.from(new Set(questions.map((question) => question.specialty))).sort(), [questions]);
  const [config, setConfig] = useState<TestBuilderConfig>({
    mode: 'tutor',
    statuses: ['new'],
    specialty: questions[0]?.specialty ?? 'General',
    topics: [],
    count: Math.min(20, Math.max(1, questions.length)),
  });
  const [message, setMessage] = useState('');
  const eligible = useMemo(() => questions.filter((question) => matchesTestConfig(question, state, config)), [config, questions, state]);
  const statuses: Array<[QuestionStatus, string]> = [
    ['new', 'New'],
    ['previous', 'Previously tested'],
    ['incorrect', 'Incorrect'],
    ['correct', 'Correct'],
    ['flagged', 'Flagged'],
  ];
  function toggleStatus(status: QuestionStatus) {
    setConfig((current) => ({
      ...current,
      statuses: current.statuses.includes(status) ? current.statuses.filter((item) => item !== status) : [...current.statuses, status],
    }));
  }
  function toggleTopic(topic: string) {
    setConfig((current) => ({
      ...current,
      topics: current.topics.includes(topic) ? current.topics.filter((item) => item !== topic) : [...current.topics, topic],
    }));
  }
  return (
    <>
      <PageHeader title="Create a test" subtitle="Build a focused question block" openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))} />
      <div className="mx-auto max-w-5xl p-4 sm:p-7">
        <div className="grid gap-5 lg:grid-cols-[1fr_310px]">
          <div className="space-y-5">
            <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
              <span className="text-xs font-bold text-primary">01</span>
              <h2 className="mt-1 text-lg font-bold">Choose your test mode</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['tutor', 'Tutor mode', 'See the correct answer after every question.'],
                    ['timed', 'Timed mode', 'Review all answers after completing the test.'],
                  ] as const
                ).map(([value, title, description]) => (
                  <button key={value} aria-pressed={config.mode === value} onClick={() => setConfig({ ...config, mode: value })} className={cx('rounded-2xl border p-4 text-left transition', config.mode === value ? 'border-primary bg-primary/5 ring-2 ring-primary/10' : 'hover:border-primary/30')}>
                    <div className="flex items-start justify-between">
                      <div className={cx('grid size-9 place-items-center rounded-xl', config.mode === value ? 'bg-primary text-white' : 'bg-muted text-muted-foreground')}>{value === 'tutor' ? <BookOpenCheck className="size-4" /> : <RefreshCw className="size-4" />}</div>
                      {config.mode === value && <CheckCircle2 className="size-5 text-primary" />}
                    </div>
                    <strong className="mt-4 block text-sm">{title}</strong>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">{description}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
              <span className="text-xs font-bold text-primary">02</span>
              <h2 className="mt-1 text-lg font-bold">Question status</h2>
              <p className="mt-1 text-sm text-muted-foreground">Select one or more. Leave all unselected to include every question.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {statuses.map(([value, label]) => (
                  <button key={value} aria-pressed={config.statuses.includes(value)} onClick={() => toggleStatus(value)} className={cx('rounded-full border px-4 py-2 text-xs font-bold transition', config.statuses.includes(value) ? 'border-primary bg-primary text-white' : 'bg-white hover:border-primary/35 dark:bg-card')}>
                    {label}
                  </button>
                ))}
              </div>
            </section>
            <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
              <span className="text-xs font-bold text-primary">03</span>
              <h2 className="mt-1 text-lg font-bold">Specialty & topics</h2>
              <p className="mt-1 text-sm text-muted-foreground">Choose a specialty, then optionally narrow the block by topic.</p>
              {specialties.length > 1 && (
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-xs font-bold">Specialty</span>
                  <select
                    value={config.specialty}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        specialty: event.target.value,
                        topics: [],
                      })
                    }
                    className="h-11 w-full rounded-xl border bg-white px-3 text-sm dark:bg-card"
                  >
                    {specialties.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
              )}
              <details className="mt-4"><summary className="cursor-pointer rounded-xl border bg-muted/30 p-3 text-sm font-semibold">Choose topics <span className="ml-2 text-muted-foreground">{config.topics.length ? `${config.topics.length} selected` : 'All topics included'}</span></summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {topics
                  .filter((topic) => questions.some((question) => question.specialty === config.specialty && question.topic === topic))
                  .map((topic) => {
                    const selected = config.topics.includes(topic);
                    return (
                      <button type="button" key={topic} aria-pressed={selected} onClick={() => toggleTopic(topic)} className="flex items-center gap-3 rounded-xl border p-3 text-left text-sm transition hover:bg-muted/50">
                        <span className={cx('grid size-4 place-items-center rounded border', selected && 'border-primary bg-primary text-white')}>{selected && <Check className="size-3" />}</span>
                        <span className="flex-1 font-medium">{topic}</span>
                        <span className="text-xs text-muted-foreground">{questions.filter((question) => question.specialty === config.specialty && question.topic === topic).length}</span>
                      </button>
                    );
                  })}
              </div></details>
            </section>
          </div>
          <aside className="order-first h-fit rounded-2xl bg-card p-5 ring-1 ring-border lg:order-last lg:sticky lg:top-[92px]">
            <span className="q-eyebrow">Ready when you are</span><h3 className="mt-1 text-lg font-bold">Your session</h3><p className="mt-2 text-sm text-muted-foreground lg:hidden">Start with these settings, or customize them below.</p>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mode</span>
                <strong className="capitalize">{config.mode}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Eligible</span>
                <strong aria-live="polite">{eligible.length}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Selected topics</span>
                <strong>{config.topics.length || 'All'}</strong>
              </div>
            </div>
            <label htmlFor="test-question-count" className="mt-6 block">
              <span className="mb-2 flex justify-between text-sm font-semibold">
                <span>Questions</span>
                <strong className="text-primary">{Math.min(config.count, Math.max(eligible.length, 1))}</strong>
              </span>
              <input id="test-question-count" aria-label="Number of questions" type="range" min="1" max={Math.max(eligible.length, 1)} value={Math.min(config.count, Math.max(eligible.length, 1))} onChange={(event) => setConfig({ ...config, count: Number(event.target.value) })} className="w-full accent-primary" />
            </label>
            {!eligible.length && <output className="mt-4 block rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">No questions match yet. Choose another status or clear your topic filters.</output>}
            {message && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-500/12 dark:text-amber-200">{message}</p>}
            <PrimaryButton
              tone="study"
              disabled={!eligible.length}
              onClick={() => {
                if (!eligible.length) {
                  setMessage('No questions match these filters. Try a different status or topic.');
                  return;
                }
                onStart({
                  ...config,
                  count: Math.min(config.count, eligible.length),
                });
              }}
              className="mt-6 w-full"
            >
              <ClipboardPlus className="size-4" />
              Start test
            </PrimaryButton>
          </aside>
        </div>
      </div>
    </>
  );
}

function TestPanels({mobile,children}:{mobile:boolean;children:React.ReactNode}) { return mobile ? <div className="min-w-0">{children}</div> : <ResizablePanelGroup orientation="horizontal" className="items-stretch overflow-visible">{children}</ResizablePanelGroup>; }
function TestQuestionPanel({mobile,explanation,children}:{mobile:boolean;explanation:boolean;children:React.ReactNode}) { return mobile ? <div className="min-w-0">{children}</div> : <ResizablePanel id="question-panel" defaultSize={explanation?'68%':'100%'} minSize={explanation?'42%':'100%'}>{children}</ResizablePanel>; }

function NotesSurface({mobile,onClose,children}:{mobile:boolean;onClose:()=>void;children:React.ReactNode}) { return mobile ? <Dialog open onOpenChange={o=>{if(!o)onClose();}}><DialogContent className="sm:max-w-2xl"><DialogTitle>Notes</DialogTitle>{children}</DialogContent></Dialog> : <>{children}</>; }

function TestView({
  test,
  questions,
  state,
  setState,
  onExit,
  user,
  collaboration,
  updateCollaboration,
}: {
  test: TestSession;
  questions: Question[];
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onExit: (destination?: 'dashboard' | 'history') => void;
  user: AppUser;
  collaboration: CollaborationState;
  updateCollaboration: (updater: (current: CollaborationState) => CollaborationState) => void;
}) {
  const [seconds, setSeconds] = useState(() => testElapsedSeconds(test));
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [zoomImage, setZoomImage] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);
  const [reportMessage, setReportMessage] = useState('');
  const [suggestedAnswer, setSuggestedAnswer] = useState<number | undefined>();
  const [markerActive, setMarkerActive] = useState(false);
  const [editKinds, setEditKinds] = useState<ProposalEditKind[]>(['typo_formatting']);
  const [proposedStem, setProposedStem] = useState('');
  const [proposedOptions, setProposedOptions] = useState<string[]>([]);
  const [proposedExplanation, setProposedExplanation] = useState('');
  const [proposedSource, setProposedSource] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [noteImagesDraft, setNoteImagesDraft] = useState<QuestionProgress['noteImages']>([]);
  const [uploading, setUploading] = useState(false);
  const isMobile = useIsMobile();
  const stemRef = useRef<HTMLParagraphElement>(null);
  const activeQuestions = useMemo(() => test.questionIds.map((id) => questions.find((question) => question.id === id)).filter(Boolean) as Question[], [test.questionIds, questions]);
  const answeredCount = test.questionIds.filter((questionId) => test.answers[questionId] !== undefined).length;
  const allQuestionsAnswered = test.questionIds.length > 0 && answeredCount === test.questionIds.length;
  const question = activeQuestions[test.currentIndex];
  const progress = question ? getQuestionProgress(state, question.id) : emptyProgress();
  useEffect(() => { stemRef.current?.closest('.q-viewport')?.scrollTo({top:0,behavior:'instant'}); }, [question?.id]);
  const qbankId = question?.qbankId ?? test.qbankId ?? 'smle-gs';
  const noteKey = question ? `${qbankId}:${question.id}` : '';
  const sharedNote = noteKey ? collaboration.sharedNotes[noteKey] : undefined;
  const displayedExplanation = sharedNote?.content.trim() || question?.explanation?.trim() || 'No explanation has been added yet.';
  const selected = question ? test.answers[question.id] : undefined;
  const revealed = question ? test.revealed.includes(question.id) : false;
  const answerStat = noteKey ? collaboration.answerStats[noteKey] : undefined;
  const answerSelections = Object.values(answerStat?.selections ?? {});

  useEffect(() => {
    if (test.timerPaused || test.status !== 'active') return;
    const elapsedAtStart = test.elapsedSeconds ?? 0;
    const runningSince = new Date(test.elapsedSeconds === undefined ? test.startedAt : test.timerStartedAt ?? test.startedAt).getTime();
    const timer = window.setInterval(() => setSeconds(elapsedAtStart + Math.max(0, Math.floor((Date.now() - runningSince) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [test.elapsedSeconds, test.startedAt, test.status, test.timerPaused, test.timerStartedAt]);

  useEffect(() => {
    const update = window.setTimeout(() => {
      setNoteDraft(sharedNote?.content ?? '');
      setNoteImagesDraft(sharedNote?.images ?? []);
    }, 0);
    return () => window.clearTimeout(update);
  }, [question?.id, sharedNote?.content, sharedNote?.images]);

  const updateTest = useCallback(
    (updater: (current: TestSession) => TestSession) => {
      setState((current) => ({
        ...current,
        tests: current.tests.map((item) => (item.id === test.id ? updater(item) : item)),
      }));
    },
    [setState, test.id],
  );

  function selectAnswer(answer: number) {
    if (revealed) return;
    updateTest((current) => ({
      ...current,
      answers: { ...current.answers, [question.id]: answer },
      updatedAt: new Date().toISOString(),
    }));
  }

  function gradeCurrent() {
    if (selected === undefined || test.graded.includes(question.id)) return;
    setState((current) => {
      const oldProgress = getQuestionProgress(current, question.id);
      const correct = selected === question.answer;
      return {
        ...current,
        progress: {
          ...current.progress,
          [question.id]: {
            ...oldProgress,
            attempts: oldProgress.attempts + 1,
            correctAttempts: oldProgress.correctAttempts + (correct ? 1 : 0),
            incorrectAttempts: oldProgress.incorrectAttempts + (correct ? 0 : 1),
            lastAnswer: selected,
            lastAnsweredAt: new Date().toISOString(),
          },
        },
        tests: current.tests.map((item) =>
          item.id === test.id
            ? {
                ...item,
                revealed: [...new Set([...item.revealed, question.id])],
                graded: [...new Set([...item.graded, question.id])],
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      };
    });
    updateCollaboration((current) => {
      const existing = current.answerStats[noteKey] ?? {
        id: noteKey,
        qbankId,
        questionId: question.id,
        selections: {},
      };
      if (existing.selections[user.uid] !== undefined) return current;
      return {
        ...current,
        answerStats: {
          ...current.answerStats,
          [noteKey]: {
            ...existing,
            selections: { ...existing.selections, [user.uid]: selected },
          },
        },
      };
    });
    setNotesOpen(true);
  }

  function finishTest() {
    setFinishConfirmOpen(true);
  }

  function pauseTest() {
    const elapsedSeconds = testElapsedSeconds(test);
    setSeconds(elapsedSeconds);
    updateTest((current) => ({
      ...current,
      elapsedSeconds,
      timerPaused: true,
      timerStartedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }

  function resumeTest() {
    const resumedAt = new Date().toISOString();
    updateTest((current) => ({
      ...current,
      elapsedSeconds: testElapsedSeconds(current),
      timerPaused: false,
      timerStartedAt: resumedAt,
      updatedAt: resumedAt,
    }));
  }

  function completeLater() {
    const elapsedSeconds = testElapsedSeconds(test);
    const pausedAt = new Date().toISOString();
    updateTest((current) => ({
      ...current,
      status: 'active',
      completedAt: undefined,
      elapsedSeconds,
      timerPaused: true,
      timerStartedAt: pausedAt,
      updatedAt: pausedAt,
    }));
    onExit('dashboard');
  }

  function saveForLater() {
    setFinishConfirmOpen(false);
    completeLater();
  }

  function restartQuestion() {
    updateTest((current) => {
      const answers = { ...current.answers };
      delete answers[question.id];
      return {
        ...current,
        answers,
        revealed: current.revealed.filter((id) => id !== question.id),
        graded: current.graded.filter((id) => id !== question.id),
        updatedAt: new Date().toISOString(),
      };
    });
    setNotesOpen(false);
  }

  function completeTest() {
    if (!allQuestionsAnswered) {
      saveForLater();
      return;
    }
    setFinishConfirmOpen(false);
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
        nextProgress[questionId] = {
          ...old,
          attempts: old.attempts + 1,
          correctAttempts: old.correctAttempts + (correct ? 1 : 0),
          incorrectAttempts: old.incorrectAttempts + (correct ? 0 : 1),
          lastAnswer: answer,
          lastAnsweredAt: new Date().toISOString(),
        };
      });
      return {
        ...current,
        progress: nextProgress,
        tests: current.tests.map((item) =>
          item.id === test.id
            ? {
                ...item,
                status: 'completed',
                completedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                elapsedSeconds: seconds,
                timerPaused: true,
                timerStartedAt: new Date().toISOString(),
                graded: [...new Set([...item.graded, ...Object.keys(item.answers)])],
                revealed: [...new Set([...item.revealed, ...item.questionIds])],
              }
            : item,
        ),
      };
    });
    updateCollaboration((current) => {
      const answerStats = { ...current.answerStats };
      test.questionIds.forEach((questionId) => {
        const answer = test.answers[questionId];
        const source = questions.find((item) => item.id === questionId);
        if (answer === undefined || !source) return;
        const sourceBankId = source.qbankId ?? test.qbankId ?? 'smle-gs';
        const key = `${sourceBankId}:${questionId}`;
        const existing = answerStats[key] ?? {
          id: key,
          qbankId: sourceBankId,
          questionId,
          selections: {},
        };
        if (existing.selections[user.uid] === undefined)
          answerStats[key] = {
            ...existing,
            selections: { ...existing.selections, [user.uid]: answer },
          };
      });
      return { ...current, answerStats };
    });
    onExit('history');
  }

  function move(index: number) {
    updateTest((current) => ({
      ...current,
      currentIndex: Math.max(0, Math.min(index, current.questionIds.length - 1)),
      updatedAt: new Date().toISOString(),
    }));
  }

  function toggleFlag() {
    setState((current) => {
      const old = getQuestionProgress(current, question.id);
      return {
        ...current,
        progress: {
          ...current.progress,
          [question.id]: { ...old, flagged: !old.flagged },
        },
      };
    });
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
    setState((current) => {
      const old = getQuestionProgress(current, question.id);
      return {
        ...current,
        progress: {
          ...current.progress,
          [question.id]: {
            ...old,
            highlights: mergeRanges([...old.highlights, { start, end }]),
          },
        },
      };
    });
    selection.removeAllRanges();
  }

  function copySelectionAndMark() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = selection.toString().trim();
    if (text) void navigator.clipboard.writeText(text).catch(() => undefined);
    if (markerActive) addHighlight();
  }

  function removeHighlight(target: HighlightRange) {
    setState((current) => {
      const old = getQuestionProgress(current, question.id);
      return {
        ...current,
        progress: {
          ...current.progress,
          [question.id]: {
            ...old,
            highlights: old.highlights.filter((range) => range.start !== target.start || range.end !== target.end),
          },
        },
      };
    });
  }

  function clearHighlights() {
    setState((current) => {
      const old = getQuestionProgress(current, question.id);
      return {
        ...current,
        progress: {
          ...current.progress,
          [question.id]: { ...old, highlights: [] },
        },
      };
    });
  }

  function saveNote() {
    const content = noteDraft.trim();
    if (content === (sharedNote?.content ?? '') && JSON.stringify(noteImagesDraft) === JSON.stringify(sharedNote?.images ?? [])) return;
    const editedAt = new Date().toISOString();
    const revision = {
      id: crypto.randomUUID(),
      content,
      images: noteImagesDraft,
      editedById: user.uid,
      editedByName: user.displayName,
      editedAt,
    };
    updateCollaboration((current) => {
      const previous = current.sharedNotes[noteKey];
      return {
        ...current,
        sharedNotes: {
          ...current.sharedNotes,
          [noteKey]: {
            id: noteKey,
            qbankId,
            questionId: question.id,
            content,
            images: noteImagesDraft,
            version: (previous?.version ?? 0) + 1,
            updatedById: user.uid,
            updatedByName: user.displayName,
            updatedAt: editedAt,
            history: previous ? [...previous.history, revision] : [],
          },
        },
        auditLog: [
          {
            id: crypto.randomUUID(),
            action: 'shared_note_updated',
            entityType: 'note',
            entityId: noteKey,
            actorId: user.uid,
            actorName: user.displayName,
            createdAt: editedAt,
            detail: `Updated the shared note for question ${question.number}.`,
          },
          ...current.auditLog,
        ],
      };
    });
  }

  function insertNoteToken(before: string, after = before) {
    const textarea = document.getElementById('question-note') as HTMLTextAreaElement | null;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = noteDraft.slice(0, start) + before + noteDraft.slice(start, end) + after + noteDraft.slice(end);
    setNoteDraft(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    });
  }

  async function attachImages(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const images = await Promise.all(
        Array.from(files)
          .slice(0, 5)
          .map(async (file) => {
            if (!file.type.startsWith('image/')) throw new Error('Only image files are supported.');
            if (file.size > 10 * 1024 * 1024) throw new Error('Each image must be smaller than 10 MB.');
            const url = await uploadNoteImage(user.uid, file, qbankId, question.id);
            return {
              id: crypto.randomUUID(),
              url,
              name: file.name,
              caption: '',
            };
          }),
      );
      setNoteImagesDraft((current) => [...current, ...images]);
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function removeImage(imageId: string) {
    setNoteImagesDraft((current) => current.filter((image) => image.id !== imageId));
  }

  function updateCaption(imageId: string, caption: string) {
    setNoteImagesDraft((current) => current.map((image) => (image.id === imageId ? { ...image, caption } : image)));
  }

  function openReport() {
    setProposedStem(question.stem);
    setProposedOptions([...question.options]);
    setSuggestedAnswer(question.answer);
    setProposedExplanation(question.explanation ?? sharedNote?.content ?? '');
    setProposedSource(question.sourceReference ?? question.sourceFile ?? '');
    setEditKinds(['typo_formatting']);
    setReportMessage('');
    setReportOpen(true);
  }

  function toggleEditKind(kind: ProposalEditKind) {
    setEditKinds((current) => (current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]));
  }

  function submitReport() {
    if (!reportMessage.trim() || !proposedExplanation.trim() || !proposedSource.trim() || !editKinds.length || proposedOptions.length < 2 || proposedOptions.length > 10 || suggestedAnswer === undefined || suggestedAnswer >= proposedOptions.length || proposedOptions.some((item) => !item.trim())) return;
    const proposedAt = new Date().toISOString();
    const currentSnapshot = {
      stem: question.stem,
      options: question.options,
      answer: question.answer,
      specialty: question.specialty,
      topic: question.topic,
      explanation: question.explanation ?? sharedNote?.content ?? '',
      sourceReference: question.sourceReference ?? question.sourceFile ?? '',
      images: question.images ?? [],
    };
    updateCollaboration((current) => {
      const payload = {
        stem: proposedStem.trim(),
        options: proposedOptions.map((item) => item.trim()),
        answer: suggestedAnswer,
        specialty: question.specialty,
        topic: question.topic,
        explanation: proposedExplanation.trim(),
        sourceReference: proposedSource.trim(),
        images: question.images ?? [],
      };
      return {
        ...current,
        proposals: [
          {
            id: crypto.randomUUID(),
            qbankId,
            type: 'question_edit',
            editKinds,
            questionId: question.id,
            currentSnapshot,
            payload,
            rationale: reportMessage.trim(),
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
            action: 'question_edit_proposed',
            entityType: 'question',
            entityId: question.id,
            actorId: user.uid,
            actorName: user.displayName,
            createdAt: proposedAt,
            detail: `Proposed a correction to question ${question.number}.`,
          },
          ...current.auditLog,
        ],
      };
    });
    setReportOpen(false);
    setReportMessage('');
    setSuggestedAnswer(undefined);
  }

  useEffect(() => {
    const element = stemRef.current;
    if (!element) return;
    element.addEventListener('mouseup', copySelectionAndMark);
    return () => element.removeEventListener('mouseup', copySelectionAndMark);
  });

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (finishConfirmOpen) {
        if (event.key === 'Escape') setFinishConfirmOpen(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const optionIndex = event.key.toLowerCase().charCodeAt(0) - 97;
      if (!revealed && optionIndex >= 0 && optionIndex < question.options.length) selectAnswer(optionIndex);
      else if (event.key === 'ArrowLeft') move(test.currentIndex - 1);
      else if (event.key === 'ArrowRight') move(test.currentIndex + 1);
      else if (event.key.toLowerCase() === 'f') toggleFlag();
      else if (event.key.toLowerCase() === 'm') setMarkerActive((value) => !value);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  if (!question)
    return (
      <main className="grid min-h-screen place-items-center">
        <div className="text-center">
          <CircleAlert className="mx-auto size-8 text-red-500" />
          <h1 className="mt-3 font-bold">Question unavailable</h1>
          <SecondaryButton onClick={onExit} className="mt-4">
            Return to dashboard
          </SecondaryButton>
        </div>
      </main>
    );

  return (
    <main className="q-test-screen flex min-h-screen flex-col bg-[#f5f7fa] dark:bg-background">
      <Dialog open={explanationOpen} onOpenChange={setExplanationOpen}><DialogContent className="sm:max-w-2xl"><DialogTitle>Explanation</DialogTitle><p dir="auto" className="whitespace-pre-wrap break-words leading-7">{displayedExplanation}</p></DialogContent></Dialog>
      <Dialog open={Boolean(zoomImage)} onOpenChange={open => { if (!open) setZoomImage(''); }}><DialogContent className="sm:max-w-4xl"><DialogTitle>Question image</DialogTitle><img src={zoomImage || undefined} alt="Enlarged question illustration" className="max-h-[75dvh] w-full object-contain" /></DialogContent></Dialog>
      <nav className="q-test-bottom" aria-label="Test navigation"><SecondaryButton onClick={() => move(test.currentIndex - 1)} disabled={test.currentIndex === 0}>Previous</SecondaryButton><button className="text-sm font-bold" onClick={() => setNavigatorOpen(true)}>{test.currentIndex + 1}/{activeQuestions.length}</button><SecondaryButton onClick={() => move(test.currentIndex + 1)} disabled={test.currentIndex >= activeQuestions.length - 1}>Next</SecondaryButton></nav>
      <header className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b bg-white px-3 shadow-sm dark:bg-card sm:px-5">
        <div className="flex items-center gap-2 sm:gap-3">
          <button aria-label="Exit test" onClick={finishTest} className="grid size-9 place-items-center rounded-xl hover:bg-muted">
            <X className="size-5" />
          </button>
          <span className="sm:hidden"><QuestionId value={question.questionId} compact /></span><span className="text-xs font-bold sm:hidden">{test.currentIndex + 1}/{activeQuestions.length}</span>
          <div className="hidden h-7 w-px bg-border sm:block" />
          <div className="hidden sm:block">
            <strong className="block text-sm">{test.title}</strong>
            <span className="text-xs font-semibold uppercase text-muted-foreground">{test.mode} mode</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-1.5 rounded-xl bg-muted px-2 py-2 text-xs font-bold tabular-nums sm:flex sm:gap-2 sm:px-3" title="Elapsed test time">
            <Clock3 className="size-3.5 text-primary" />
            {formatDuration(seconds)}
          </div>
          <IconButton label="Pause timer" onClick={pauseTest}>
            <Pause className="size-4" />
          </IconButton>
          <IconButton label={progress.flagged ? 'Remove flag' : 'Flag question'} active={progress.flagged} onClick={toggleFlag}>
            <Flag className={cx('size-4', progress.flagged && 'fill-current')} />
          </IconButton>
          <SecondaryButton onClick={finishTest} className="hidden sm:flex">
            {allQuestionsAnswered ? <CheckCircle2 className="size-4" /> : <Clock3 className="size-4" />}
            {allQuestionsAnswered ? 'End and Save' : 'Continue Later and Save'}
          </SecondaryButton>
        </div>
      </header>
      <div className="flex w-full min-w-0 flex-1">
        <aside className="hidden w-[240px] shrink-0 border-r bg-white p-4 dark:bg-card xl:block" aria-label="Question navigator">
          <div className="mb-3 flex items-center justify-between">
            <strong className="text-xs">Questions</strong>
            <span className="text-xs text-muted-foreground">
              {Object.keys(test.answers).length}/{test.questionIds.length}
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(44px,1fr))] gap-2" dir="ltr">
            {activeQuestions.map((item, index) => {
              const itemProgress = getQuestionProgress(state, item.id);
              const answered = test.answers[item.id] !== undefined;
              return (
                <button
                  key={item.id}
                  onClick={() => move(index)}
                  aria-label={`Question ${index + 1}${itemProgress.flagged ? ', flagged' : ''}`}
                  aria-current={index === test.currentIndex ? 'step' : undefined}
                  className={cx(
                    'grid min-h-11 min-w-0 place-items-center rounded-lg border px-1 py-2 text-xs font-bold tabular-nums',
                    index === test.currentIndex ? 'border-primary bg-primary text-primary-foreground' : answered ? 'border-primary/25 bg-primary/8 text-primary' : 'bg-white dark:bg-card',
                    itemProgress.flagged && index !== test.currentIndex && 'border-amber-400 text-amber-700 dark:text-amber-300',
                  )}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
        </aside>
        <section className="min-w-0 flex-1 p-3 sm:p-6 lg:p-8">
          <div className={cx('mx-auto', revealed && displayedExplanation ? 'max-w-[1180px]' : 'max-w-[890px]')}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{question.specialty}</span>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">{question.topic}</span>
              </div>
              <button onClick={() => setNavigatorOpen(true)} className="text-xs font-bold text-primary xl:hidden">
                Question {test.currentIndex + 1} of {test.questionIds.length}
              </button>
            </div>
            <TestPanels key={`${question.id}:${revealed ? 'revealed' : 'answering'}`} mobile={isMobile}>
              <TestQuestionPanel mobile={isMobile} explanation={Boolean(revealed && displayedExplanation)}>
                <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-border dark:bg-card sm:p-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div>
                  <span className="text-xs font-bold text-muted-foreground">QUESTION {test.currentIndex + 1}</span>
                  <QuestionId value={question.questionId} />
                  {markerActive && <span className="ml-2 rounded-full bg-yellow-100 px-2 py-1 text-xs font-bold text-yellow-800 dark:bg-yellow-400/15 dark:text-yellow-200">MARKER ON</span>}
                </div>
                <div className="flex gap-2">
                  <IconButton label={markerActive ? 'Turn marker off' : 'Keep marker on'} active={markerActive} onClick={() => setMarkerActive((value) => !value)}>
                    <Highlighter className="size-4" />
                  </IconButton>
                  <IconButton label="Restart this question" disabled={selected === undefined && !revealed} onClick={restartQuestion}>
                    <RotateCcw className="size-4" />
                  </IconButton>
                  {progress.highlights.length > 0 && (
                    <IconButton label="Clear highlights" onClick={clearHighlights}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  )}
                </div>
              </div>
              <p ref={stemRef} dir="auto" className="select-text whitespace-pre-wrap break-words text-base leading-[1.85] text-[#1d2e40] dark:text-foreground sm:text-base">
                <HighlightedText text={question.stem} ranges={progress.highlights} onRemove={removeHighlight} />
              </p>
              {(question.writtenByName || question.reviewedByName) && (
                <p className="mt-3 text-xs font-medium text-muted-foreground">
                  Written by <strong className="text-foreground">{question.writtenByName ?? 'Qraft'}</strong>
                  {' · '}Reviewed by <strong className="text-foreground">{question.reviewedByName ?? 'Pending'}</strong>
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">Select text to copy it using your device’s text menu. When Marker is on, the selection is also saved; click a yellow marker to remove it.</p>
              {question.images?.length > 0 && (
                <section className="mt-6 rounded-2xl border bg-muted/20 p-3 sm:p-4" aria-label="Question images">
                  <div className={cx('grid gap-3', question.images.length > 1 && 'sm:grid-cols-2')}>
                    {question.images.map((image) => (
                      <figure key={image.id} className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
                        <div className="grid min-h-48 place-items-center bg-slate-50 p-2 dark:bg-slate-950/25">
                          <button className="w-full" onClick={() => setZoomImage(image.url)} aria-label="Enlarge question image"><img src={image.url} alt={image.caption || image.name} className="max-h-[420px] w-full object-contain" /></button>
                        </div>
                        {(image.caption || image.name) && <figcaption className="border-t px-3 py-2 text-center text-sm leading-6 text-muted-foreground">{image.caption || image.name}</figcaption>}
                      </figure>
                    ))}
                  </div>
                </section>
              )}
              <div className="q-test-choices mt-7 space-y-3">
                {question.options.map((option, index) => {
                  const isSelected = selected === index;
                  const isCorrect = revealed && question.answer === index;
                  const isWrong = revealed && isSelected && index !== question.answer;
                  const count = answerSelections.filter((answer) => answer === index).length;
                  const percent = answerSelections.length ? Math.round((count / answerSelections.length) * 100) : 0;
                  return (
                    <QuestionOption key={index} text={option} index={index} selected={isSelected} correct={isCorrect} wrong={isWrong} revealed={revealed} percent={percent} onSelect={() => selectAnswer(index)} />
                  );
                })}
              </div>
              {test.mode === 'tutor' && !revealed && (
                <div className="mt-6 flex justify-end">
                  <PrimaryButton tone="study" onClick={gradeCurrent} disabled={selected === undefined}>
                    Submit answer
                  </PrimaryButton>
                </div>
              )}
              {revealed && (
                <>
                  <div className={cx('mt-6 rounded-xl border p-4 text-sm font-semibold', selected === question.answer ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200' : 'border-red-200 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200')}>
                    {selected === question.answer ? 'Correct answer.' : `The keyed answer is ${question.answerLetter}.`}{' '}
                    <span className="font-normal opacity-75">
                      {answerSelections.length} learner
                      {answerSelections.length === 1 ? '' : 's'} in response data · Revision {question.revision}
                    </span>
                  </div>
                </>
              )}
                </article>
              </TestQuestionPanel>
              {revealed && displayedExplanation && !isMobile && (
                <>
                  <ResizableHandle withHandle className={cx('bg-transparent', isMobile ? 'my-4' : 'mx-4')} />
                  <ResizablePanel id="explanation-panel" defaultSize="32%" minSize={isMobile ? '12rem' : '22%'} maxSize={isMobile ? '34rem' : '58%'}>
                    <aside className="h-full rounded-2xl border border-primary/15 bg-white p-5 shadow-sm dark:bg-card sm:p-6" aria-label="Question explanation">
                      <div className="flex items-center justify-between gap-3 border-b pb-4">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Explanation</p>
                          <h3 className="mt-1 font-bold">Why this answer is correct</h3>
                        </div>
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">READ ONLY</span>
                      </div>
                      <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-foreground">{displayedExplanation}</p>
                      {(question.sourceReference || question.sourceFile) && (
                        <p className="mt-5 border-t pt-4 text-xs leading-6 text-muted-foreground">
                          <strong className="text-foreground">Source:</strong> {question.sourceReference || question.sourceFile}
                        </p>
                      )}
                      <p className="mt-5 rounded-xl bg-primary/5 p-3 text-sm leading-6 text-muted-foreground">Drag the divider to control the explanation space. Use Shared notes below to edit the collaborative explanation.</p>
                    </aside>
                  </ResizablePanel>
                </>
              )}
            </TestPanels>
            <div className="q-test-actions mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
              <SecondaryButton onClick={() => move(test.currentIndex - 1)} disabled={test.currentIndex === 0}>
                <ChevronLeft className="size-4" />
                Previous
              </SecondaryButton>
              <div className="flex min-w-0 flex-wrap justify-center gap-2">
                {isMobile && revealed && displayedExplanation && <SecondaryButton onClick={() => setExplanationOpen(true)}>Explanation</SecondaryButton>}
                <SecondaryButton onClick={openReport}>
                  <CircleAlert className="size-4" />
                  Suggest edit
                </SecondaryButton>
                <PrimaryButton onClick={() => setNotesOpen(!notesOpen)}>
                  <FileText className="size-4" />
                  Shared notes {sharedNote?.content || sharedNote?.images.length ? '•' : ''}
                </PrimaryButton>
              </div>
              <SecondaryButton onClick={() => move(test.currentIndex + 1)} disabled={test.currentIndex === test.questionIds.length - 1}>
                Next
                <ChevronRight className="size-4" />
              </SecondaryButton>
            </div>
            {notesOpen && (
              <NotesSurface mobile={isMobile} onClose={() => setNotesOpen(false)}>
              <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-border dark:bg-card">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="font-bold">Shared explanation & notes</h3>
                    <p className="text-xs text-muted-foreground">Everyone can improve this note. Every saved version is attributed.</p>
                  </div>
                  {sharedNote && (
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200">
                      EDITED BY {sharedNote.updatedByName.toUpperCase()} · {formatDate(sharedNote.updatedAt)}
                    </span>
                  )}
                </div>
                <div className="mt-4 flex gap-1 border-b pb-2">
                  <IconButton label="Bold" onClick={() => insertNoteToken('**')}>
                    <Bold className="size-4" />
                  </IconButton>
                  <IconButton label="Italic" onClick={() => insertNoteToken('_')}>
                    <Italic className="size-4" />
                  </IconButton>
                  <IconButton label="Bullet list" onClick={() => insertNoteToken('\n• ', '')}>
                    <List className="size-4" />
                  </IconButton>
                  <label title="Add images" className="grid size-10 cursor-pointer place-items-center rounded-xl border text-muted-foreground hover:bg-muted">
                    <span className="sr-only">Add note images</span>
                    <ImagePlus className="size-4" />
                    <input
                      aria-label="Add note images"
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(event) => {
                        void attachImages(event.target.files);
                        event.target.value = '';
                      }}
                    />
                  </label>
                </div>
                <textarea
                  id="question-note"
                  dir="auto"
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="Write or improve the shared explanation…"
                  className="mt-3 min-h-40 w-full resize-y rounded-xl border bg-muted/20 p-4 text-sm leading-7 outline-none focus:border-primary focus:ring-3 focus:ring-primary/10"
                />
                {uploading && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <RefreshCw className="size-3 animate-spin" />
                    Uploading images…
                  </div>
                )}
                {noteImagesDraft.length > 0 && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {noteImagesDraft.map((image) => (
                      <div key={image.id} className="overflow-hidden rounded-xl border">
                        <div className="relative bg-muted">
                          <img src={image.url} alt={image.caption || image.name} className="h-40 w-full object-contain" />
                          <button onClick={() => removeImage(image.id)} className="absolute right-2 top-2 grid size-8 place-items-center rounded-lg bg-white/90 text-red-600 shadow dark:bg-slate-950/85 dark:text-red-300">
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                        <input value={image.caption} onChange={(event) => updateCaption(image.id, event.target.value)} placeholder="Add a caption" className="h-10 w-full border-t bg-card px-3 text-xs text-foreground outline-none" />
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">Saving adds your name and timestamp to version history.</span>
                  <PrimaryButton tone="study" onClick={saveNote}>
                    <Save className="size-4" />
                    Save shared note
                  </PrimaryButton>
                </div>
                {sharedNote?.history.length ? (
                  <details className="mt-4 rounded-xl border bg-muted/20 p-3">
                    <summary className="cursor-pointer text-xs font-bold">Version history · {sharedNote.history.length}</summary>
                    <div className="mt-3 space-y-2">
                      {[...sharedNote.history]
                        .reverse()
                        .slice(0, 10)
                        .map((revision, index) => (
                          <div key={revision.id} className="flex items-center justify-between gap-3 rounded-lg bg-white p-2 text-xs dark:bg-card">
                            <span>
                              <strong>v{sharedNote.history.length - index}</strong> · {revision.editedByName}
                            </span>
                            <time className="text-muted-foreground">{formatDate(revision.editedAt)}</time>
                          </div>
                        ))}
                    </div>
                  </details>
                ) : null}
              </section>
              </NotesSurface>
            )}
          </div>
        </section>
      </div>
      <div className="fixed bottom-4 right-4 z-20 flex gap-2 sm:hidden">
        <button onClick={finishTest} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-xl">
          {allQuestionsAnswered ? 'End and Save' : 'Continue Later and Save'}
        </button>
      </div>
      {test.timerPaused && test.status === 'active' && (
        <dialog open className="fixed inset-0 z-[90] m-0 grid size-full max-h-none max-w-none place-items-center border-0 bg-background/45 p-6 text-foreground backdrop-blur-xl" aria-labelledby="paused-test-title">
          <section className="w-full max-w-sm rounded-3xl bg-card/95 p-7 text-center shadow-2xl ring-1 ring-border">
            <button onClick={resumeTest} className="mx-auto grid size-20 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_14px_36px_rgba(8,107,196,.32)] transition hover:scale-105" aria-label="Continue test and resume timer">
              <Play className="ml-1 size-9 fill-current" />
            </button>
            <h2 id="paused-test-title" className="mt-6 text-2xl font-bold">Continue</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">The timer is paused at {formatDuration(seconds)}. Your answers are saved.</p>
          </section>
        </dialog>
      )}
      {finishConfirmOpen && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFinishConfirmOpen(false);
          }}
        >
          <section role="alertdialog" aria-modal="true" aria-labelledby="end-test-title" aria-describedby="end-test-description" className="w-full max-w-md overflow-hidden rounded-[24px] bg-card shadow-[0_28px_90px_rgba(2,12,27,.35)] ring-1 ring-white/10">
            <div className="border-b bg-gradient-to-br from-primary/10 via-card to-card p-6">
              <div className="flex items-start gap-4">
                <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(8,107,196,.25)]">
                  <Flag className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Test checkpoint</p>
                  <h2 id="end-test-title" className="mt-1 text-xl font-bold">
                    {allQuestionsAnswered ? 'End and save this test?' : 'Continue this test later?'}
                  </h2>
                  <p id="end-test-description" className="mt-2 text-sm leading-6 text-muted-foreground">
                    {allQuestionsAnswered
                      ? 'All questions are answered. Your answers will be graded and the completed test will be saved in Test history.'
                      : 'Your current answers and position will be saved. The test will remain not completed so you can resume it later.'}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-3 divide-x rounded-2xl bg-muted/60 py-4 text-center">
                <div>
                  <strong className="block text-lg text-foreground">{answeredCount}</strong>
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Answered</span>
                </div>
                <div>
                  <strong className="block text-lg text-foreground">{test.questionIds.length - answeredCount}</strong>
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Unanswered</span>
                </div>
                <div>
                  <strong className="block text-lg text-foreground">{formatDuration(seconds)}</strong>
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Elapsed</span>
                </div>
              </div>
              {!allQuestionsAnswered && (
                <div className="mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>You still have unanswered questions. Saving now keeps this test active and available to resume.</span>
                </div>
              )}
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <SecondaryButton onClick={() => setFinishConfirmOpen(false)} className="h-11 w-full">
                  Keep studying
                </SecondaryButton>
                <PrimaryButton tone="study" onClick={allQuestionsAnswered ? completeTest : saveForLater} className="w-full">
                  {allQuestionsAnswered ? <CheckCircle2 className="size-4" /> : <Clock3 className="size-4" />}
                  {allQuestionsAnswered ? 'End and Save' : 'Continue Later and Save'}
                </PrimaryButton>
              </div>
              <p className="mt-3 text-center text-xs text-muted-foreground">Press Esc or click outside to continue the test.</p>
            </div>
          </section>
        </div>
      )}
      {navigatorOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/35" onClick={() => setNavigatorOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="max-h-[70vh] w-full rounded-t-3xl bg-white p-5 dark:bg-card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <strong>Questions</strong>
              <button onClick={() => setNavigatorOpen(false)}>
                <X className="size-5" />
              </button>
            </div>
            <div className="grid max-h-[50dvh] grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-2 overflow-y-auto p-1 pb-[max(4px,env(safe-area-inset-bottom))]" dir="ltr">
              {activeQuestions.map((item, index) => (
                <button
                  key={item.id}
                  onClick={() => {
                    move(index);
                    setNavigatorOpen(false);
                  }}
                  aria-label={`Question ${index + 1}${getQuestionProgress(state,item.id).flagged ? ', flagged' : ''}`} className={cx('grid min-h-11 place-items-center rounded-lg border text-xs font-bold', index === test.currentIndex ? 'bg-primary text-white' : test.answers[item.id] !== undefined ? 'bg-primary/10 text-primary' : '', getQuestionProgress(state,item.id).flagged && 'ring-2 ring-amber-400')}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {reportOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="mx-auto my-6 w-full max-w-4xl rounded-2xl bg-card p-5 shadow-2xl ring-1 ring-border">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold">Suggest edit</h3>
                <p className="text-xs text-muted-foreground">Question {question.number} · Suggest Edit → Review → Approve / Reject</p>
              </div>
              <button onClick={() => setReportOpen(false)} aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <fieldset className="mt-5">
              <legend className="text-sm font-semibold">What kind of change are you proposing?</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {(
                  [
                    ['question_text', 'Question text'],
                    ['options', 'Options'],
                    ['correct_answer', 'Correct answer'],
                    ['explanation', 'Explanation'],
                    ['source', 'Source'],
                    ['typo_formatting', 'Typo / formatting'],
                    ['duplicate', 'Duplicate question'],
                    ['outdated_guideline', 'Outdated guideline'],
                  ] as Array<[ProposalEditKind, string]>
                ).map(([kind, label]) => (
                  <button type="button" key={kind} onClick={() => toggleEditKind(kind)} className={cx('rounded-full border px-3 py-2 text-xs font-bold', editKinds.includes(kind) ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Proposed question text</span>
                <textarea required value={proposedStem} onChange={(event) => setProposedStem(event.target.value)} className="min-h-32 w-full rounded-xl border bg-card p-3 text-sm" />
              </label>
              <div className="space-y-2">
                <span className="block text-sm font-semibold">Proposed options</span>
                {proposedOptions.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input value={option} onChange={(event) => setProposedOptions((current) => current.map((item, i) => (i === index ? event.target.value : item)))} className="h-10 min-w-0 flex-1 rounded-xl border bg-card px-3 text-sm" aria-label={`Proposed option ${optionLabel(index)}`} />
                    <button
                      type="button"
                      aria-label={`Remove proposed option ${optionLabel(index)}`}
                      disabled={proposedOptions.length <= 2}
                      onClick={() => {
                        setProposedOptions((current) => current.filter((_, itemIndex) => itemIndex !== index));
                        setSuggestedAnswer((current) => current === undefined ? current : current === index ? 0 : current > index ? current - 1 : current);
                      }}
                      className="grid size-10 shrink-0 place-items-center rounded-xl border text-red-600 disabled:opacity-30 dark:text-red-300"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
                <button type="button" disabled={proposedOptions.length >= 10} onClick={() => setProposedOptions((current) => [...current, ''])} className="inline-flex h-10 items-center gap-2 rounded-xl border border-dashed px-4 text-sm font-bold text-primary disabled:opacity-40">
                  <Plus className="size-4" />
                  Add option
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mb-1.5 block text-sm font-semibold">Proposed correct answer</span>
                <select value={suggestedAnswer ?? ''} onChange={(event) => setSuggestedAnswer(Number(event.target.value))} className="h-11 w-full rounded-xl border bg-card px-3 text-sm">
                  {proposedOptions.map((option, index) => (
                    <option key={index} value={index}>
                      {optionLabel(index)}. {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1.5 block text-sm font-semibold">
                  Source <strong className="text-red-600 dark:text-red-300">required</strong>
                </span>
                <input required value={proposedSource} onChange={(event) => setProposedSource(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3 text-sm" placeholder="Guideline, textbook, DOI, or URL" />
              </label>
            </div>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-semibold">
                Explanation <strong className="text-red-600 dark:text-red-300">required</strong>
              </span>
              <textarea required value={proposedExplanation} onChange={(event) => setProposedExplanation(event.target.value)} className="min-h-28 w-full rounded-xl border bg-card p-3 text-sm" placeholder="Explain the medically correct change." />
            </label>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-semibold">Why should this change be made?</span>
              <textarea required value={reportMessage} onChange={(event) => setReportMessage(event.target.value)} className="min-h-20 w-full rounded-xl border bg-card p-3 text-sm" placeholder="Give the reviewer enough context to decide." />
            </label>
            <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Nothing changes immediately. An authorized reviewer will see a field-by-field comparison before deciding.</div>
            <div className="mt-5 flex justify-end gap-2">
              <SecondaryButton onClick={() => setReportOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton tone="contribute" onClick={submitReport} disabled={!reportMessage.trim() || !proposedExplanation.trim() || !proposedSource.trim() || !editKinds.length}>
                <Save className="size-4" />
                Submit for review
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function HistoryView({ state, questions, onOpen, onDelete }: { state: AppState; questions: Question[]; onOpen: (test: TestSession) => void; onDelete: (id: string) => void }) {
  const [deleteId, setDeleteId] = useState<string>();
  const tests = [...state.tests].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const selectedTest = tests.find((test) => test.id === deleteId);
  return (
    <>
      <PageHeader title="Previous tests" subtitle={`${tests.length} saved test${tests.length === 1 ? '' : 's'}`} openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))} />
      <div className="mx-auto max-w-5xl p-4 sm:p-7">
        {tests.length === 0 ? (
          <div className="grid min-h-[55vh] place-items-center rounded-2xl border border-dashed bg-card/60">
            <div className="max-w-sm text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                <BookOpenCheck className="size-6" />
              </div>
              <h2 className="mt-4 font-bold">No tests yet</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Create your first test to start building a review history.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {tests.map((test) => {
              const isCompleted = test.status === 'completed';
              const answered = Object.keys(test.answers).length;
              const correct = test.questionIds.filter((id) => {
                const question = questions.find((item) => item.id === id);
                return question && test.answers[id] === question.answer;
              }).length;
              const score = answered ? Math.round((correct / answered) * 100) : 0;
              return (
                <article key={test.id} className="flex flex-col gap-4 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border sm:flex-row sm:items-center">
                  <div
                    className={cx(
                      'grid size-12 shrink-0 place-items-center rounded-2xl',
                      !isCompleted ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-200' : score >= 70 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200' : 'bg-blue-50 text-blue-700 dark:bg-blue-500/12 dark:text-blue-200',
                    )}
                  >
                    <FileText className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold">{test.title}</h3>
                      <span className={cx('rounded-full px-2 py-0.5 text-xs font-bold uppercase', !isCompleted ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-200' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200')}>{isCompleted ? 'Completed' : 'Not completed'}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(test.startedAt)} · {test.mode} · {answered}/{test.questionIds.length} answered
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="text-right">
                      <strong className="block text-xl">{!isCompleted ? `${test.currentIndex + 1}/${test.questionIds.length}` : `${score}%`}</strong>
                      <span className="text-xs text-muted-foreground">{!isCompleted ? 'position' : 'score'}</span>
                    </div>
                    <SecondaryButton onClick={() => onOpen(test)}>
                      {!isCompleted ? 'Resume' : 'Review'}
                      <ArrowRight className="size-4" />
                    </SecondaryButton>
                    <IconButton label={`Delete ${test.title}`} onClick={() => setDeleteId(test.id)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      {selectedTest && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/60 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-test-title" className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl">
            <h2 id="delete-test-title" className="text-xl font-bold">
              Delete this test?
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              <strong>{selectedTest.title}</strong> will be removed from your history. Your accumulated question progress will remain unchanged.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button onClick={() => setDeleteId(undefined)} className="h-11 rounded-xl border text-sm font-bold">
                Cancel
              </button>
              <button
                onClick={() => {
                  onDelete(selectedTest.id);
                  setDeleteId(undefined);
                }}
                className="h-11 rounded-xl bg-red-600 text-sm font-bold text-white"
              >
                Delete test
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ProgressView({ state, questions }: { state: AppState; questions: Question[] }) {
  const summary = useMemo(() => {
    const completed = questions.filter((question) => getQuestionProgress(state, question.id).attempts > 0);
    const correct = completed.filter((question) => getQuestionProgress(state, question.id).lastAnswer === question.answer);
    const incorrect = completed.length - correct.length;
    const flagged = questions.filter((question) => getQuestionProgress(state, question.id).flagged).length;
    const topics = Array.from(new Set(questions.map((question) => question.topic)))
      .sort()
      .map((topic) => {
        const pool = questions.filter((question) => question.topic === topic);
        const attempted = pool.filter((question) => getQuestionProgress(state, question.id).attempts > 0);
        const right = attempted.filter((question) => getQuestionProgress(state, question.id).lastAnswer === question.answer).length;
        return {
          topic,
          total: pool.length,
          completed: attempted.length,
          accuracy: attempted.length ? Math.round((right / attempted.length) * 100) : 0,
        };
      });
    return {
      completed: completed.length,
      correct: correct.length,
      incorrect,
      flagged,
      topics,
    };
  }, [questions, state]);
  const completion = Math.round((summary.completed / questions.length) * 100);
  const accuracy = summary.completed ? Math.round((summary.correct / summary.completed) * 100) : 0;
  return (
    <>
      <PageHeader title="Progress" subtitle="A clear view of your QBank performance" openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))} />
      <div className="mx-auto max-w-6xl p-4 sm:p-7">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Completed" value={summary.completed} detail={`${completion}% of the bank`} />
          <StatCard label="Correct" value={summary.correct} detail={`${accuracy}% accuracy`} color="green" />
          <StatCard label="Incorrect" value={summary.incorrect} detail="Ready for review" color="red" />
          <StatCard label="Flagged" value={summary.flagged} detail="Saved questions" color="amber" />
        </div>
        <section className="mt-6 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border sm:p-6">
          <div>
            <h2 className="font-bold">Progress by topic</h2>
            <p className="mt-1 text-sm text-muted-foreground">Topics stay collapsed until you choose one.</p>
          </div>
          <div className="mt-5 space-y-2">
            {summary.topics.map((topic) => {
              const topicCompletion = Math.round((topic.completed / topic.total) * 100);
              return (
                <details key={topic.topic} className="group rounded-xl border bg-background/40">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-sm">
                    <strong>{topic.topic}</strong>
                    <span className="text-xs text-muted-foreground">
                      {topic.completed}/{topic.total} · {topic.accuracy}% accuracy <ChevronRight className="ml-2 inline size-4 transition group-open:rotate-90" />
                    </span>
                  </summary>
                  <div className="border-t p-4">
                    <div className="mb-2 flex justify-between text-xs">
                      <span>Completion</span>
                      <strong>{topicCompletion}%</strong>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${topicCompletion}%` }} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-lg bg-muted/50 p-2">
                        <strong className="block text-base">{topic.total}</strong>
                        Total
                      </div>
                      <div className="rounded-lg bg-muted/50 p-2">
                        <strong className="block text-base">{topic.completed}</strong>
                        Completed
                      </div>
                      <div className="rounded-lg bg-muted/50 p-2">
                        <strong className="block text-base">{topic.accuracy}%</strong>
                        Accuracy
                      </div>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

function exportAsPdf(questions: Question[], collaboration: CollaborationState) {
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) {
    window.alert('Allow pop-ups to export your QBank as PDF.');
    return;
  }
  const content = questions
    .map((question) => {
      const options = question.options.map((option, index) => `<li class="${index === question.answer ? 'answer' : ''}"><b>${optionLabel(index)}.</b> ${escapeHtml(option)}${index === question.answer ? ' <span>Correct answer</span>' : ''}</li>`).join('');
      const questionImages = (question.images ?? []).map((image) => `<figure><img src="${escapeHtml(image.url)}" alt=""/><figcaption>${escapeHtml(image.caption || image.name)}</figcaption></figure>`).join('');
      const note = collaboration.sharedNotes[`${question.qbankId ?? 'smle-gs'}:${question.id}`];
      const images = (note?.images ?? []).map((image) => `<figure><img src="${escapeHtml(image.url)}" alt=""/><figcaption>${escapeHtml(image.caption || image.name)}</figcaption></figure>`).join('');
      return `<article><header><b>Question ${question.number} · ID ${escapeHtml(question.questionId)}</b><small>${escapeHtml(question.specialty)} · ${escapeHtml(question.topic)} · Source page ${question.sourcePage}</small></header><p class="stem">${escapeHtml(question.stem)}</p>${questionImages}<ol>${options}</ol>${note?.content || images ? `<section class="notes"><b>Shared explanation</b><p dir="auto">${escapeHtml(note?.content ?? '').replace(/\n/g, '<br>')}</p>${images}<small>Last edited by ${escapeHtml(note?.updatedByName ?? '')} · ${escapeHtml(formatDate(note?.updatedAt))}</small></section>` : ''}</article>`;
    })
    .join('');
  popup.document.documentElement.innerHTML = `<!doctype html><html><head><title>Qraft QBank Export</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font-family:Arial,"Segoe UI",sans-serif;color:#16283a;margin:0}main{max-width:800px;margin:auto}.cover{display:grid;min-height:92vh;place-items:center;text-align:center;page-break-after:always}.brand{color:#086bc4;font-size:42px;margin:0}.cover p{color:#627486}.cover strong{display:block;margin-top:24px;font-size:18px}article{page-break-inside:avoid;border-top:3px solid #086bc4;padding:18px 0 24px;margin-bottom:12px}article header{display:flex;justify-content:space-between;gap:16px;color:#086bc4}small{color:#64788c}.stem{line-height:1.7;font-size:14px}ol{list-style:none;padding:0;margin:16px 0}li{padding:8px 10px;border:1px solid #dce5ee;margin:5px 0;border-radius:7px;font-size:13px}.answer{background:#ecfdf5;border-color:#86efac}.answer span{float:right;color:#087b55;font-size:10px;font-weight:bold}.notes{margin-top:14px;padding:13px;background:#fff9dc;border:1px solid #f3dc75;border-radius:8px}.notes p{white-space:normal;line-height:1.7;font-size:13px}figure{margin:10px 0}figure img{max-width:100%;max-height:420px;object-fit:contain}figcaption{font-size:10px;color:#64788c}@media print{button{display:none}}</style></head><body><main><section class="cover"><div><h1 class="brand">Qraft</h1><p>Collaborative Question Bank</p><strong>${questions.length} questions with answers and shared explanations</strong><p>Exported ${new Date().toLocaleDateString()}</p><button onclick="window.print()">Save as PDF</button></div></section>${content}</main><script>window.onload=()=>setTimeout(()=>window.print(),500);</script></body></html>`;
}

function downloadBackup(state: AppState, collaboration: CollaborationState) {
  const blob = new Blob([JSON.stringify({ personal: state, collaboration }, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `qraft-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function RoleRequestPanel({
  user,
  collaboration,
  updateCollaboration,
}: {
  user: AppUser;
  collaboration: CollaborationState;
  updateCollaboration: (updater: (current: CollaborationState) => CollaborationState) => void;
}) {
  const [roleReason, setRoleReason] = useState('');
  const [requestedRole, setRequestedRole] = useState<'pro' | 'reviewer' | 'access_manager'>('pro');
  const pendingRole = collaboration.roleApplications.find((item) => item.userId === user.uid && item.status === 'pending');

  function applyForRole() {
    if (!roleReason.trim() || pendingRole) return;
    const createdAt = new Date().toISOString();
    updateCollaboration((current) => ({
      ...current,
      roleApplications: [
        {
          id: crypto.randomUUID(),
          userId: user.uid,
          userName: user.displayName,
          userEmail: user.email,
          requestedRole,
          superAdminUid: current.security.superAdminUid,
          reason: roleReason.trim(),
          status: 'pending',
          createdAt,
        },
        ...current.roleApplications,
      ],
    }));
    setRoleReason('');
  }

  if (user.role === 'super_admin') return null;
  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
      <h2 className="font-bold">Request an additional role</h2>
      <p className="mt-1 text-sm text-muted-foreground">The Superadmin reviews every Pro, Reviewer, and Access Manager request.</p>
      {pendingRole ? (
        <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          Your <strong>{pendingRole.requestedRole.replaceAll('_', ' ')}</strong> request is waiting for review.
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr_auto]">
          <select value={requestedRole} onChange={(event) => setRequestedRole(event.target.value as typeof requestedRole)} className="h-11 rounded-xl border bg-card px-3 text-sm">
            <option value="pro">Pro user</option>
            <option value="reviewer">Public QBank reviewer</option>
            <option value="access_manager">Access Manager</option>
          </select>
          <input value={roleReason} onChange={(event) => setRoleReason(event.target.value)} className="h-11 rounded-xl border bg-card px-3 text-sm" placeholder="Why do you need this role?" />
          <button onClick={applyForRole} disabled={!roleReason.trim()} className="h-11 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground disabled:opacity-40">
            Submit request
          </button>
        </div>
      )}
    </section>
  );
}

function SettingsView({
  state,
  setState,
  syncStatus,
  onSync,
  questions,
  collaboration,
  user,
  updateCollaboration,
}: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  syncStatus: SyncStatus;
  onSync: () => void;
  questions: Question[];
  collaboration: CollaborationState;
  user: AppUser;
  updateCollaboration: (updater: (current: CollaborationState) => CollaborationState) => void;
}) {
  return (
    <>
      <PageHeader title="Settings" subtitle="Study preferences, sync, and exports" openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))} />
      <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-7">
        <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-bold">Cloud sync</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Cloudflare D1 and ImageKit are connected. Changes sync automatically and can be forced at any time.</p>
            </div>
            <PrimaryButton onClick={onSync} disabled={syncStatus === 'syncing'}>
              <RefreshCw className={cx('size-4', syncStatus === 'syncing' && 'animate-spin')} />
              Sync now
            </PrimaryButton>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200">
            <Cloud className="size-4" />
            {`Cloudflare ready${state.lastSyncAt ? ` · Last manual sync ${new Date(state.lastSyncAt).toLocaleString()}` : ''}`}
          </div>
        </section>
        <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
          <h2 className="font-bold">Appearance</h2>
          <p className="mt-1 text-sm text-muted-foreground">Light, dark, or follow your device.</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {(['light', 'dark', 'system'] as const).map((theme) => (
              <button
                key={theme}
                onClick={() =>
                  setState((current) => ({
                    ...current,
                    settings: { ...current.settings, theme },
                  }))
                }
                className={cx('flex h-11 items-center justify-center gap-2 rounded-xl border text-xs font-bold capitalize', state.settings.theme === theme && 'border-primary bg-primary text-primary-foreground')}
              >
                {theme === 'light' ? <Sun className="size-4" /> : theme === 'dark' ? <Moon className="size-4" /> : <Settings className="size-4" />}
                {theme}
              </button>
            ))}
          </div>
        </section>
        <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
          <h2 className="font-bold">Daily study goal</h2>
          <p className="mt-1 text-sm text-muted-foreground">Used by the quick-start button on your dashboard.</p>
          <div className="mt-5 flex items-center gap-4">
            <input
              type="range"
              aria-label="Daily study goal"
              min="5"
              max="100"
              step="5"
              value={state.settings.dailyGoal}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    dailyGoal: Number(event.target.value),
                  },
                }))
              }
              className="flex-1 accent-primary"
            />
            <strong className="min-w-20 rounded-xl bg-primary/10 px-3 py-2 text-center text-primary">{state.settings.dailyGoal}</strong>
          </div>
        </section>
        <RoleRequestPanel user={user} collaboration={collaboration} updateCollaboration={updateCollaboration} />
        <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
          <h2 className="font-bold">Export and backup</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Create a printable PDF with answers, shared notes, editor attribution, and images.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <PrimaryButton onClick={() => exportAsPdf(questions, collaboration)}>
              <FileText className="size-4" />
              Export current QBank
            </PrimaryButton>
            <SecondaryButton onClick={() => downloadBackup(state, collaboration)}>
              <Download className="size-4" />
              Download backup
            </SecondaryButton>
          </div>
        </section>
        <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
          <h2 className="font-bold">PWA installation</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            On iPad, open Qraft in Safari, tap Share, then choose <strong>Add to Home Screen</strong>. The interface is optimized for touch, split view, and offline study.
          </p>
        </section>
      </div>
    </>
  );
}

function QuestionManager({
  user,
  collaboration,
  updateCollaboration,
  questions,
  allQuestions,
  activeQBankId,
  confirmUpdate,
}: {
  user: AppUser;
  confirmUpdate: (updater: (current: CollaborationState) => CollaborationState) => void;
  collaboration: CollaborationState;
  updateCollaboration: (updater: (current: CollaborationState) => CollaborationState) => void;
  questions: Question[];
  allQuestions: Question[];
  activeQBankId: string;
}) {
  const [open, setOpen] = useState(false);
  const [roleRequestOpen, setRoleRequestOpen] = useState(false);
  const [editingProposal, setEditingProposal] = useState<QuestionProposal>();
  const [importOpen, setImportOpen] = useState(false);
  const [contributionSearch, setContributionSearch] = useState('');
  const [stem, setStem] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [answer, setAnswer] = useState(0);
  const [specialty, setSpecialty] = useState(questions[0]?.specialty ?? 'General');
  const [topic, setTopic] = useState(questions[0]?.topic ?? 'General');
  const [rationale, setRationale] = useState('');
  const [explanation, setExplanation] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  function resetComposer() {
    setStem('');
    setOptions(['', '', '', '']);
    setAnswer(0);
    setSpecialty(questions[0]?.specialty ?? 'General');
    setTopic(questions[0]?.topic ?? 'General');
    setRationale('');
    setExplanation('');
    setSourceReference('');
  }

  function startNewContribution() {
    setEditingProposal(undefined);
    resetComposer();
    setOpen(true);
  }

  function startEditing(proposal: QuestionProposal) {
    setEditingProposal(proposal);
    setStem(proposal.payload.stem);
    setOptions([...proposal.payload.options]);
    setAnswer(proposal.payload.answer);
    setSpecialty(proposal.payload.specialty);
    setTopic(proposal.payload.topic);
    setRationale(proposal.rationale);
    setExplanation(proposal.payload.explanation);
    setSourceReference(proposal.payload.sourceReference);
    setOpen(true);
  }

  async function addQuestion(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stem.trim() || options.length < 2 || options.length > 10 || answer >= options.length || options.some((option) => !option.trim()) || !explanation.trim() || !sourceReference.trim()) return;
    const proposedAt = new Date().toISOString();
    const payload = {
      stem: stem.trim(),
      options: options.map((option) => option.trim()),
      answer,
      specialty: specialty.trim() || 'General',
      topic: topic.trim() || 'General',
      explanation: explanation.trim(),
      sourceReference: sourceReference.trim(),
      images: editingProposal?.payload.images ?? [],
    };
    if (editingProposal) {
      updateCollaboration((current) => ({
        ...current,
        proposals: current.proposals.map((item) => item.id === editingProposal.id && item.proposedById === user.uid && item.status !== 'approved' ? { ...item, payload, rationale: rationale.trim() || 'Updated question contribution.', status: 'pending', proposedAt } : item),
        auditLog: [
          {
            id: crypto.randomUUID(),
            action: editingProposal.status === 'rejected' ? 'question_proposal_resubmitted' : 'question_proposal_updated',
            entityType: 'question',
            entityId: editingProposal.id,
            actorId: user.uid,
            actorName: user.displayName,
            createdAt: proposedAt,
            detail: editingProposal.status === 'rejected' ? 'Resubmitted a rejected question contribution.' : 'Updated a pending question contribution.',
          },
          ...current.auditLog,
        ],
      }));
      resetComposer();
      setEditingProposal(undefined);
      setOpen(false);
      return;
    }
    updateCollaboration((current) => {
      return {
        ...current,
        proposals: [
          {
            id: crypto.randomUUID(),
            qbankId: activeQBankId,
            type: 'new_question',
            editKinds: ['question_text', 'options', 'correct_answer', 'explanation', 'source'],
            payload,
            rationale: rationale.trim() || 'New question contribution.',
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
            action: 'new_question_proposed',
            entityType: 'question',
            entityId: activeQBankId,
            actorId: user.uid,
            actorName: user.displayName,
            createdAt: proposedAt,
            detail: `Proposed a new question for ${activeQBankId}.`,
          },
          ...current.auditLog,
        ],
      };
    });
    setStem('');
    setOptions(['', '', '', '']);
    setAnswer(0);
    setRationale('');
    setExplanation('');
    setSourceReference('');
    setEditingProposal(undefined);
    setOpen(false);
  }
  const mine = collaboration.proposals.filter((proposal) => proposal.proposedById === user.uid && proposal.qbankId === activeQBankId && `${proposal.payload.stem} ${allQuestions.find(q => q.id === proposal.questionId)?.questionId ?? (proposal.questionId === '#deleted' ? 'deleted' : '')}`.toLowerCase().includes(contributionSearch.replace(/^#/, '').toLowerCase()));
  const qbank = collaboration.qbanks.find((item) => item.id === activeQBankId);
  const isOwner = Boolean(qbank && canManageBank(user, qbank));
  if (open)
    return (
      <>
        <PageHeader title={editingProposal ? (editingProposal.status === 'rejected' ? 'Resubmit contribution' : 'Edit contribution') : isOwner ? 'Add question' : 'Propose a question'} subtitle={`${qbank?.name ?? 'QBank'} · explanation and source are required`} openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))} />
        <form onSubmit={addQuestion} className="mx-auto my-6 w-[calc(100%-2rem)] max-w-3xl rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border sm:p-7">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold">{editingProposal ? 'Update contribution' : 'Question content'}</h2>
              <p className="text-xs text-muted-foreground">{editingProposal ? editingProposal.status === 'rejected' ? 'Update the details and send this contribution back to the review queue.' : 'You can update this contribution while it is pending review.' : 'Every new question is published only after another reviewer approves it.'}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close composer" className="grid size-11 shrink-0 place-items-center rounded-xl border">
              <X className="size-5" />
            </button>
          </div>
          <label className="mt-5 block">
            <span className="mb-1.5 block text-sm font-semibold">Question stem</span>
            <textarea dir="auto" required value={stem} onChange={(event) => setStem(event.target.value)} className="min-h-28 w-full rounded-xl border bg-card p-3 text-sm" />
          </label>
          <div className="mt-4 space-y-2">
            {options.map((option, index) => (
              <div key={index} className="flex min-w-0 items-start gap-2">
                <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-xl border px-2">
                <input aria-label={`Mark option ${optionLabel(index)} as correct`} type="radio" name="answer" checked={answer === index} onChange={() => setAnswer(index)} className="size-4 accent-primary" />
                <span className="text-xs font-bold">{optionLabel(index)}</span>
                </label>
                <textarea dir="auto" aria-label={`Option ${optionLabel(index)}`} required value={option} onChange={(event) => setOptions((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))} className="min-h-11 min-w-0 flex-1 rounded-xl border bg-card p-3 text-sm" />
                <button
                  type="button"
                  aria-label={`Remove option ${optionLabel(index)}`}
                  disabled={options.length <= 2}
                  onClick={() => {
                    setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index));
                    setAnswer((current) => (current === index ? 0 : current > index ? current - 1 : current));
                  }}
                  className="grid size-11 shrink-0 place-items-center rounded-xl border text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:text-red-300"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button type="button" disabled={options.length >= 10} onClick={() => setOptions((current) => [...current, ''])} className="inline-flex h-10 items-center gap-2 rounded-xl border border-dashed px-4 text-sm font-bold text-primary disabled:cursor-not-allowed disabled:opacity-40">
              <Plus className="size-4" />
              Add option
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-sm font-semibold">Specialty</span>
              <input value={specialty} onChange={(event) => setSpecialty(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3 text-sm" />
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-semibold">Topic</span>
              <input value={topic} onChange={(event) => setTopic(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3 text-sm" />
            </label>
          </div>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-semibold">
              Explanation <strong className="text-red-600 dark:text-red-300">required</strong>
            </span>
            <textarea required value={explanation} onChange={(event) => setExplanation(event.target.value)} className="min-h-28 w-full rounded-xl border bg-card p-3 text-sm" placeholder="Explain why the keyed answer is correct." />
          </label>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-semibold">
              Source <strong className="text-red-600 dark:text-red-300">required</strong>
            </span>
            <input required value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3 text-sm" placeholder="Guideline, textbook, DOI, or URL" />
          </label>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-semibold">Reviewer context</span>
            <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} className="min-h-20 w-full rounded-xl border bg-card p-3 text-sm" placeholder="Optional context for the reviewer" />
          </label>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <SecondaryButton onClick={() => setOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit" tone="contribute">
              <Save className="size-4" />
              {editingProposal ? editingProposal.status === 'rejected' ? 'Resubmit for review' : 'Save changes' : 'Submit for review'}
            </PrimaryButton>
          </div>
        </form>
      </>
    );
  return (
    <>
      <PageHeader
        title="Community contributions"
        subtitle={`${qbank?.name ?? 'QBank'} · every new question requires independent review`}
        openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {user.role !== 'super_admin' && (
              <SecondaryButton onClick={() => setRoleRequestOpen(true)}>
                <UserPlus className="size-4" />
                Request role
              </SecondaryButton>
            )}
            <SecondaryButton onClick={() => setImportOpen(true)}>Import JSON / Use AI</SecondaryButton>
            <PrimaryButton tone="contribute" onClick={startNewContribution}>
              <Plus className="size-4" />
              Add Manually
            </PrimaryButton>
          </div>
        }
      />
      <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl"><DialogTitle>Import JSON / Use AI</DialogTitle><QuestionImportReview bankId={activeQBankId} onImported={proposals => confirmUpdate(current => ({ ...current, proposals: [...proposals, ...current.proposals.filter(p => !proposals.some(n => n.id === p.id))] }))} /></DialogContent></Dialog>
      {roleRequestOpen && (
        <dialog open className="fixed inset-0 z-[70] m-0 grid h-full w-full max-w-none place-items-center overflow-y-auto border-0 bg-slate-950/45 p-4 backdrop-blur-sm" aria-label="Request a role">
          <div className="w-full max-w-3xl">
            <div className="mb-3 flex justify-end">
              <button onClick={() => setRoleRequestOpen(false)} className="grid size-10 place-items-center rounded-full bg-card text-foreground shadow-lg" aria-label="Close role request">
                <X className="size-5" />
              </button>
            </div>
            <RoleRequestPanel user={user} collaboration={collaboration} updateCollaboration={updateCollaboration} />
          </div>
        </dialog>
      )}
      <div className="mx-auto max-w-6xl p-4 sm:p-7">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Live questions" value={questions.length} detail="Approved and available in tests" />
          <StatCard label="Your proposals" value={mine.length} detail={`${mine.filter((item) => item.status === 'approved').length} approved`} />
          <StatCard label="Awaiting review" value={mine.filter((item) => item.status === 'pending').length} detail="Visible to the authorized reviewers" color="amber" />
        </div>
        <section className="mt-6 overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          <div className="border-b p-5">
            <h2 className="font-bold">Your contribution history</h2>
            <p className="mt-1 text-sm text-muted-foreground">Proposals are attributed to your account and remain auditable.</p><input aria-label="Search contributions by Question ID" placeholder="Search Question ID or text" className="mt-3 w-full rounded-xl border bg-background p-3" value={contributionSearch} onChange={e => setContributionSearch(e.target.value)} />
          </div>
          {mine.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">You have not proposed a question or correction in this QBank yet.</div>
          ) : (
            <div className="divide-y">
              {mine.map((proposal) => {
                const contributedQuestion = proposal.questionId ? allQuestions.find((item) => item.id === proposal.questionId) : undefined;
                return (
                  <div key={proposal.id} className="grid gap-3 p-4 text-sm sm:grid-cols-[120px_minmax(0,1fr)_140px_auto] sm:items-center">
                    <span
                      className={cx(
                        'w-fit rounded-full px-2 py-1 text-xs font-bold uppercase',
                        proposal.status === 'approved' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200' : proposal.status === 'rejected' ? 'bg-red-50 text-red-700 dark:bg-red-500/12 dark:text-red-200' : 'bg-amber-50 text-amber-800 dark:bg-amber-500/12 dark:text-amber-200',
                      )}
                    >
                      {proposal.status}
                    </span>
                    <span className="line-clamp-2">{proposal.payload.stem}</span>
                    <div className="rounded-lg bg-muted/45 px-3 py-2">
                      <span className="block text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Question ID</span>
                      {contributedQuestion ? <QuestionId value={contributedQuestion.questionId} /> : <strong className="font-mono text-xs">{proposal.questionId === '#deleted' ? '#deleted' : 'Not assigned'}</strong>}
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                      <span className="text-xs text-muted-foreground">{formatDate(proposal.proposedAt)}</span>
                      {(proposal.status === 'pending' || proposal.status === 'rejected') && (
                        <SecondaryButton onClick={() => startEditing(proposal)} className="h-9 px-3 text-xs">
                          <Pencil className="size-3.5" />
                          {proposal.status === 'rejected' ? 'Edit & resubmit' : 'Edit'}
                        </SecondaryButton>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export default function MedGuardApp() {
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);
  const [state, setState] = useState<AppState>(initialAppState);
  const [collaboration, setCollaboration] = useState<CollaborationState>(initialCollaborationState);
  const [hydrated, setHydrated] = useState(false);
  const [collaborationHydrated, setCollaborationHydrated] = useState(false);
  const [view, setView] = useState<View>('dashboard');
  const [testError, setTestError] = useState('');
  const creatingTest = useRef(false);
  const [activeTestId, setActiveTestId] = useState<string>();
  const [managedBank, setManagedBank] = useState<{
    id: string;
    section: 'settings' | 'questions';
  }>();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('syncing');
  const online = useSyncExternalStore(subscribeConnection, () => navigator.onLine, () => true);
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [linkInvitation, setLinkInvitation] = useState<(QBankLinkInvitation & { token: string }) | null>(null);
  const [linkInvitationBusy, setLinkInvitationBusy] = useState(false);
  const [linkInvitationError, setLinkInvitationError] = useState('');
  const saveTimer = useRef<number | undefined>(undefined);
  const collaborationSaveTimer = useRef<number | undefined>(undefined);
  const lastSavedCollaboration = useRef<CollaborationState>(initialCollaborationState());
  const collaborationWriteInFlight = useRef(false);
  const liveSnapshot = useRef({ collaboration, user });
  useEffect(() => { liveSnapshot.current = { collaboration, user }; }, [collaboration, user]);
  const handledInvitationLink = useRef('');
  const hydratedIdentity = useRef('');
  const cloudLoaded = useRef(false);
  const confirmUpdate = (updater: (current: CollaborationState) => CollaborationState) => {
    lastSavedCollaboration.current = updater(lastSavedCollaboration.current);
    setCollaboration(updater);
  };
  const replaceCollaborationFromServer = useCallback((next: CollaborationState) => {
    lastSavedCollaboration.current = next;
    setCollaboration(next);
    if (user) void saveLocalCollaboration(next, user.uid);
  }, [user]);
  useEffect(() => {
    if (!user) return;
    const refresh = () => { void observeCloudflareUser(next => { if (next && next.uid === user.uid) setUser(next); }).catch(() => undefined); };
    const changed = (event: Event) => {
      const {userId,tier} = (event as CustomEvent<{userId:string;tier:'lite'|'pro'}>).detail;
      const patch = (current: CollaborationState) => ({...current,members:current.members.map(m=>m.uid===userId?{...m,tier}:m)});
      lastSavedCollaboration.current=patch(lastSavedCollaboration.current);
      setCollaboration(patch);
      if(userId===user.uid) refresh();
    };
    window.addEventListener('focus',refresh);
    window.addEventListener('qraft-account-updated',changed);
    return () => {window.removeEventListener('focus',refresh);window.removeEventListener('qraft-account-updated',changed);};
  }, [user]);


  const allQuestions = useMemo(() => {
    const imported = baseQuestions.map((question, index) => ({
      ...question,
      questionId: question.questionId ?? String(index + 1).padStart(5, '0'),
      images: question.images ?? [],
      qbankId: question.qbankId ?? 'smle-gs',
    }));
    const merged = new Map<string, Question>();
    [
      ...imported,
      ...state.customQuestions.map((question, index) => ({
        ...question,
        questionId: question.questionId ?? String(218 + index).padStart(5, '0'),
        images: question.images ?? [],
        qbankId: question.qbankId ?? 'smle-gs',
      })),
      ...collaboration.approvedQuestions.map((question) => ({
        ...question,
        images: question.images ?? [],
      })),
    ].forEach((question) =>
      merged.set(question.id, {
        ...question,
        ...state.questionOverrides[question.id],
      }),
    );
    return [...merged.values()];
  }, [state.customQuestions, state.questionOverrides, collaboration.approvedQuestions]);
  const accessibleQBanks = useMemo(() => collaboration.qbanks.filter((bank) => !bank.archived && user && canAccessBank(user, bank, collaboration.memberships)), [collaboration.memberships, collaboration.qbanks, user]);
  const requestedQBankId = state.settings.activeQBankId || 'smle-gs';
  const activeQBankId = accessibleQBanks.some((bank) => bank.id === requestedQBankId) ? requestedQBankId : (accessibleQBanks[0]?.id ?? 'smle-gs');
  const questions = useMemo(() => allQuestions.filter((question) => (question.qbankId ?? 'smle-gs') === activeQBankId), [allQuestions, activeQBankId]);
  const showReview = Boolean(user && (user.role === 'super_admin' || user.role === 'reviewer' || user.platformRoles.includes('reviewer') || collaboration.memberships.some((item) => item.userId === user.uid && item.role === 'reviewer')));
  const activeTest = state.tests.find((test) => test.id === activeTestId) ?? state.tests.find((test) => test.status === 'active');

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    const openMenu = () => setMobileOpen(true);
    window.addEventListener('medguard-open-menu', openMenu);
    const handleOnline = () => { setOfflineDismissed(false); setSyncStatus('syncing'); };
    const handleOffline = () => { setOfflineDismissed(false); setSyncStatus('offline'); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('medguard-open-menu', openMenu);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const theme = state.settings.theme;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && media.matches));
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [state.settings.theme]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    async function initialize() {
      try {
        cleanup = await observeCloudflareUser((account) => {
          if (!cancelled) setUser(account ?? null);
        });
      } catch {
        if (!cancelled) setUser(null);
      }
    }
    void initialize();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'super_admin' && !user.mfaEnrolled) return;
    const identity = `${user.uid}:${user.status}:${Boolean(user.mfaEnrolled)}`;
    if (hydratedIdentity.current === identity) return;
    cloudLoaded.current = false;
    let cancelled = false;
    async function hydrate() {
      try {
        const local = await loadLocalState(user!.uid);
        let resolved = normalizeAppState(local);
        let shared = normalizeCollaborationState((await loadLocalCollaboration(user!.uid)) ?? initialCollaborationState());
        if (navigator.onLine && user!.status === 'approved') {
          const cloud = await loadCloudState(user!.uid);
          if (cloud) resolved = normalizeAppState(cloud);
          shared = await loadCollaborationState(user!);
          cloudLoaded.current = true;
          setSyncStatus('synced');
        }
        if (!cancelled) {
          hydratedIdentity.current = identity;
          setState(resolved);
          setCollaboration(shared);
          lastSavedCollaboration.current = shared;
          setHydrated(true);
          setCollaborationHydrated(true);
        }
      } catch {
        if (!cancelled) {
          const shared = normalizeCollaborationState(await loadLocalCollaboration(user!.uid));
          setState(normalizeAppState(await loadLocalState(user!.uid)));
          setCollaboration(shared);
          lastSavedCollaboration.current = shared;
          setHydrated(true);
          setCollaborationHydrated(true);
          setSyncStatus('error');
        }
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !collaborationHydrated) return;
    const params = new URLSearchParams(window.location.search);
    const qbankId = params.get('join_qbank');
    const token = params.get('token');
    if (!qbankId || !token) return;
    const linkKey = `${user.uid}:${qbankId}:${token}`;
    if (handledInvitationLink.current === linkKey) return;
    handledInvitationLink.current = linkKey;
    void previewCloudflareQBankInvitation(qbankId, token)
      .then((invitation) => setLinkInvitation({ ...invitation, token }))
      .catch((error) => {
        setLinkInvitationError(error instanceof Error ? error.message : 'This QBank invitation could not be opened.');
        handledInvitationLink.current = '';
      });
  }, [collaborationHydrated, user]);

  function clearInvitationLink() {
    const url = new URL(window.location.href);
    url.searchParams.delete('join_qbank');
    url.searchParams.delete('token');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function declineLinkInvitation() {
    setLinkInvitation(null);
    setLinkInvitationError('');
    clearInvitationLink();
  }

  async function acceptLinkInvitation() {
    if (!user || !linkInvitation || linkInvitationBusy) return;
    setLinkInvitationBusy(true);
    setLinkInvitationError('');
    try {
      await joinCloudflareQBankByLink(user, linkInvitation.qbankId, linkInvitation.token);
      const shared = await loadCollaborationState(user);
      setCollaboration(shared);
      setState((current) => ({
        ...current,
        settings: { ...current.settings, activeQBankId: linkInvitation.qbankId },
      }));
      setView('library');
      setLinkInvitation(null);
      clearInvitationLink();
    } catch (error) {
      setLinkInvitationError(error instanceof Error ? error.message : 'The invitation could not be accepted.');
    } finally {
      setLinkInvitationBusy(false);
    }
  }

  useEffect(() => {
    if (!user || !hydrated) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (creatingTest.current) return;
      void saveLocalState(user.uid, state);
      if (cloudLoaded.current && state.settings.autoSync && navigator.onLine && user.status === 'approved') {
        setSyncStatus('syncing');
        void saveCloudState(user.uid, state)
          .then(() => setSyncStatus('synced'))
          .catch(() => setSyncStatus('error'));
      } else setSyncStatus(navigator.onLine ? 'local' : 'offline');
    }, 450);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [state, user, hydrated]);

  useEffect(() => {
    if (!user || !collaborationHydrated || user.status !== 'approved') return;
    if (JSON.stringify(collaboration) === JSON.stringify(lastSavedCollaboration.current)) return;
    if (collaborationSaveTimer.current) window.clearTimeout(collaborationSaveTimer.current);
    const persist = () => {
      if (collaborationWriteInFlight.current) { collaborationSaveTimer.current = window.setTimeout(persist, 100); return; }
      collaborationSaveTimer.current = undefined;
      const previous = lastSavedCollaboration.current;
      void saveLocalCollaboration(collaboration, user.uid);
      if (navigator.onLine && cloudLoaded.current) {
        collaborationWriteInFlight.current = true;
        setSyncStatus('syncing');
        void saveCollaborationState(collaboration, previous)
          .then(() => {
            lastSavedCollaboration.current = collaboration;
            setSyncStatus('synced');
          })
          .catch(() => setSyncStatus('error'))
          .finally(() => { collaborationWriteInFlight.current = false; });
      } else {
        setSyncStatus(navigator.onLine ? 'local' : 'offline');
      }
    };
    collaborationSaveTimer.current = window.setTimeout(persist, 150);
    return () => {
      if (collaborationSaveTimer.current) window.clearTimeout(collaborationSaveTimer.current);
      collaborationSaveTimer.current = undefined;
    };
  }, [collaboration, user, collaborationHydrated]);

  const liveChannels = JSON.stringify(user ? [
    `user:${user.uid}`,
    ...(user.status === 'approved' ? ['catalog', ...collaboration.qbanks.map(bank => `bank:${bank.id}`)] : []),
    ...(user.role === 'super_admin' && user.mfaVerified ? ['admin', 'access'] : user.platformRoles.includes('access_manager') ? ['access'] : []),
  ].sort() : []);
  useEffect(() => {
    const channels = JSON.parse(liveChannels) as string[];
    if (!channels.length || !collaborationHydrated) return;
    let stopped = false, fetching = false, pending = false, failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      timer = undefined;
      if (stopped || !navigator.onLine || document.visibilityState === 'hidden') return;
      if (fetching || collaborationWriteInFlight.current || collaborationSaveTimer.current) { timer = setTimeout(() => void refresh(), 150); return; }
      fetching = true; pending = false;
      const baseline = lastSavedCollaboration.current;
      try {
        let account = liveSnapshot.current.user;
        await observeCloudflareUser(next => { account = next; });
        if (stopped) return;
        if (!account) { setUser(null); return; }
        if (JSON.stringify(account) !== JSON.stringify(liveSnapshot.current.user)) setUser(account);
        if (account.status !== 'approved') return;
        const shared = await loadCollaborationState(account);
        if (stopped) return;
        if (collaborationWriteInFlight.current || baseline !== lastSavedCollaboration.current) { pending = true; return; }
        const merged = mergeLiveState(baseline, liveSnapshot.current.collaboration, shared);
        lastSavedCollaboration.current = shared;
        cloudLoaded.current = true;
        if (JSON.stringify(merged) !== JSON.stringify(liveSnapshot.current.collaboration)) setCollaboration(merged);
        void saveLocalCollaboration(merged, account.uid);
        failures = 0;
      } catch { pending = true; failures++; }
      finally {
        fetching = false;
        if (pending && !stopped && timer === undefined) timer = setTimeout(() => void refresh(), Math.min(30_000, 500 * 2 ** Math.min(failures, 6)));
      }
    };
    const disconnect = openLiveChannels(channels, () => {
      pending = true;
      if (timer === undefined && !fetching) timer = setTimeout(() => void refresh(), 80);
    });
    return () => { stopped = true; disconnect(); if (timer) clearTimeout(timer); };
  }, [liveChannels, collaborationHydrated]);

  async function manualSync() {
    if (!user || !navigator.onLine) {
      setSyncStatus(navigator.onLine ? 'local' : 'offline');
      return;
    }
    setSyncStatus('syncing');
    try {
      const next = { ...state, lastSyncAt: new Date().toISOString() };
      await Promise.all([saveCloudState(user.uid, next), saveCollaborationState(collaboration, lastSavedCollaboration.current)]);
      await Promise.all([saveLocalState(user.uid, next), saveLocalCollaboration(collaboration, user.uid)]);
      lastSavedCollaboration.current = collaboration;
      setState(next);
      setSyncStatus('synced');
    } catch {
      setSyncStatus('error');
    }
  }

  async function signOut() {
    await signOutCloudflare();
    setUser(null);
    setHydrated(false);
    setCollaborationHydrated(false);
    setState(initialAppState());
    setCollaboration(initialCollaborationState());
    setView('dashboard');
  }

  const createTest = useCallback(
    async (config: TestBuilderConfig) => {
      if (!user || creatingTest.current) return;
      setTestError('');
      if (user.tier === 'lite' && (config.count > 30 || state.tests.length >= 3)) { setTestError(config.count > 30 ? 'Lite allows a maximum of 30 questions per test. Your selections are preserved.' : 'The free Lite limit is 3 tests. Upgrade to Pro to create more.'); return; }
      const eligible = questions.filter((question) => matchesTestConfig(question, state, config));
      const selected = [...eligible].sort(() => Math.random() - 0.5).slice(0, config.count);
      if (!selected.length) {
        setView('create');
        return;
      }
      const now = new Date().toISOString();
      const test: TestSession = {
        id: crypto.randomUUID(),
        title: `${collaboration.qbanks.find((item) => item.id === activeQBankId)?.shortName ?? config.specialty} · ${selected.length} ${selected.length === 1 ? 'question' : 'questions'}`,
        mode: config.mode,
        questionIds: selected.map((question) => question.id),
        currentIndex: 0,
        answers: {},
        revealed: [],
        graded: [],
        startedAt: now,
        updatedAt: now,
        elapsedSeconds: 0,
        timerStartedAt: now,
        timerPaused: false,
        status: 'active',
        qbankId: activeQBankId,
      };
      creatingTest.current = true;
      try {
        if (navigator.onLine) {
          await saveCloudState(user.uid, { ...state, tests: [test, ...state.tests] });
        } else if (user.tier === 'lite') {
          throw new Error('Connect to the internet to check your Lite test allowance. Your selections are preserved.');
        }
        setState((current) => ({ ...current, tests: [test, ...current.tests] }));
        setActiveTestId(test.id);
        setView('test');
      } catch (error) { setTestError(error instanceof Error ? error.message : 'Unable to create test. Your selections are preserved.'); }
      finally { creatingTest.current = false; }
    },
    [questions, state, collaboration.qbanks, activeQBankId, user],
  );

  const quickTest = useCallback(() => {
    const specialty = questions[0]?.specialty ?? 'General';
    void createTest({
      mode: 'tutor',
      statuses: ['new'],
      specialty,
      topics: [],
      count: Math.min(state.settings.dailyGoal, questions.filter((question) => getQuestionProgress(state, question.id).attempts === 0).length),
    });
  }, [createTest, questions, state]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool || !user || !hydrated || !collaborationHydrated || user.status !== 'approved') return;
    const lifecycle = new AbortController();
    const completed = questions.filter((question) => getQuestionProgress(state, question.id).attempts > 0).length;
    void Promise.resolve(
      context.registerTool(
        {
          name: 'get_medguard_progress',
          title: 'Get Qraft progress',
          description: 'Read the signed-in learner’s current Qraft question-bank progress summary.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute: () => ({
            totalQuestions: questions.length,
            completed,
            remaining: questions.length - completed,
            flagged: questions.filter((question) => getQuestionProgress(state, question.id).flagged).length,
          }),
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);
    void Promise.resolve(
      context.registerTool(
        {
          name: 'start_medguard_daily_test',
          title: 'Start daily Qraft test',
          description: 'Create and open a Tutor-mode test from new questions in the learner’s active QBank using the daily goal.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: () => {
            quickTest();
            return {
              status: 'started',
              questionCount: Math.min(state.settings.dailyGoal, questions.length - completed),
              mode: 'tutor',
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);
    return () => lifecycle.abort();
  }, [user, hydrated, collaborationHydrated, state, questions, quickTest]);

  if (!online && !offlineDismissed)
    return <SystemStatePage kind="offline" onRetry={() => { if (navigator.onLine) window.location.reload(); }} onContinue={user && hydrated && collaborationHydrated ? () => setOfflineDismissed(true) : undefined} />;
  if (user === undefined)
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <div className="text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary text-white">
            <Sparkles className="size-5 animate-pulse" />
          </div>
          <p className="mt-3 text-sm font-semibold text-muted-foreground">Preparing Qraft…</p>
        </div>
      </main>
    );
  if (!user) return <AuthScreen onAuthenticated={setUser} />;
  if (user.status !== 'approved' || user.suspended) return <PendingApproval user={user} onSignOut={() => void signOut()} />;
  if (user.role === 'super_admin' && !user.mfaEnrolled) return <MfaEnrollmentGate onComplete={() => setUser({ ...user, mfaEnrolled: true, mfaVerified: true })} onSignOut={() => void signOut()} />;
  if (!hydrated || !collaborationHydrated)
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <div className="text-center">
          <RefreshCw className="mx-auto size-7 animate-spin text-primary" />
          <p className="mt-3 text-sm font-semibold text-muted-foreground">Loading your collaborative workspace…</p>
        </div>
      </main>
    );
  if (view === 'test' && activeTest)
    return (
      <TestView
        user={user}
        test={activeTest}
        questions={allQuestions}
        state={state}
        setState={setState}
        collaboration={collaboration}
        updateCollaboration={(updater) => setCollaboration(updater)}
        onExit={(destination) => {
          setActiveTestId(undefined);
          setView(destination ?? (activeTest.status === 'completed' ? 'history' : 'dashboard'));
        }}
      />
    );
  if (view === 'qbank-management' && managedBank)
    return (
      <QBankManagement
        confirmUpdate={confirmUpdate}
        key={`${managedBank.id}:${managedBank.section}`}
        user={user}
        bankId={managedBank.id}
        initialSection={managedBank.section}
        collaboration={collaboration}
        questions={allQuestions.filter((question) => (question.qbankId ?? 'smle-gs') === managedBank.id)}
        update={(updater) => setCollaboration(updater)}
        onBack={() => setView('library')}
        onDeleted={() => {
          setManagedBank(undefined);
          setState((current) => ({
            ...current,
            settings: { ...current.settings, activeQBankId: 'smle-gs' },
          }));
          setView('library');
        }}
      />
    );

  return (
    <main className="q-shell min-h-screen bg-background text-foreground" data-navigation-open={mobileOpen}>
      <a className="skip-navigation" href="#main-content">Skip to content</a>
      <StudyMobileNav view={view} onNavigate={setView} />
      <UpgradeDialog user={user} onUser={setUser} />
      <AlertDialog open={Boolean(linkInvitation)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
              <UserPlus className="size-5" />
            </AlertDialogMedia>
            <AlertDialogTitle>QBank invitation</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{linkInvitation?.ownerName}</strong> invited you to join{' '}
              <strong className="text-foreground">{linkInvitation?.bankName}</strong> as a viewer.
              {linkInvitation?.description && <span className="mt-2 block">{linkInvitation.description}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {linkInvitationError && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{linkInvitationError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={declineLinkInvitation} disabled={linkInvitationBusy}>Decline</AlertDialogCancel>
            <AlertDialogAction onClick={() => void acceptLinkInvitation()} disabled={linkInvitationBusy}>
              {linkInvitationBusy ? 'Joining…' : 'Accept'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="q-frame flex lg:pl-[254px]">
        <AppSidebar
          view={view}
          setView={setView}
          user={user}
          syncStatus={syncStatus}
          onSignOut={() => void signOut()}
          mobileOpen={mobileOpen}
          closeMobile={() => setMobileOpen(false)}
          qbanks={accessibleQBanks}
          activeQBankId={activeQBankId}
          onSelectQBank={(id) =>
            setState((current) => ({
              ...current,
              settings: { ...current.settings, activeQBankId: id },
            }))
          }
          showReview={showReview}
        />
        <section id="main-content" tabIndex={-1} key={view} className="q-stage q-enter">
          {view === 'subscribe' && <Subscribe user={user} onUser={setUser} />}
          {view === 'contact' && <ContactWorkspace />}
          {view === 'account' && <AccountProfile user={user} onUser={setUser} />}
          {testError && <div role="alert" className="m-4 rounded-xl border border-amber-400 bg-card p-4"><p className="mb-3">{testError}</p><UpgradeButton /></div>}
          {view === 'dashboard' && <StudyDashboard state={state} questions={questions} name={user.displayName} bankName={collaboration.qbanks.find((bank) => bank.id === activeQBankId)?.name} navigate={setView} startQuickTest={quickTest} />}
          {view === 'library' && (
            <QBankWorkspace
              confirmUpdate={confirmUpdate}
              user={user}
              collaboration={collaboration}
              update={(updater) => setCollaboration(updater)}
              activeQBankId={activeQBankId}
              organization={{
                favoriteIds: state.settings.favoriteQBankIds,
                pinnedIds: state.settings.pinnedQBankIds,
                categories: state.settings.qbankCategories,
                categoryByBankId: state.settings.qbankCategoryById,
              }}
              updateOrganization={(organization) =>
                setState((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    favoriteQBankIds: organization.favoriteIds,
                    pinnedQBankIds: organization.pinnedIds,
                    qbankCategories: organization.categories,
                    qbankCategoryById: organization.categoryByBankId,
                  },
                }))
              }
              onSelect={(id) => {
                setState((current) => ({ ...current, settings: { ...current.settings, activeQBankId: id } }));
                setView('dashboard');
              }}
              onManageBank={(id, section) => {
                setManagedBank({ id, section });
                setView('qbank-management');
              }}
            />
          )}
          {view === 'review' && showReview && <ReviewWorkspace user={user} collaboration={collaboration} update={(updater) => setCollaboration(updater)} replaceFromServer={replaceCollaborationFromServer} />}
          {view === 'create' && <CreateTest questions={questions} state={state} onStart={createTest} />}
          {view === 'history' && (
            <HistoryView
              state={{
                ...state,
                tests: state.tests.filter((test) => (test.qbankId ?? 'smle-gs') === activeQBankId),
              }}
              questions={questions}
              onOpen={(test) => {
                setActiveTestId(test.id);
                setView('test');
              }}
              onDelete={(id) =>
                setState((current) => ({
                  ...current,
                  tests: current.tests.filter((test) => test.id !== id),
                }))
              }
            />
          )}
          {view === 'progress' && <ProgressView state={state} questions={questions} />}
          {view === 'settings' && <SettingsView state={state} setState={setState} syncStatus={syncStatus} onSync={() => void manualSync()} questions={questions} collaboration={collaboration} user={user} updateCollaboration={(updater) => setCollaboration(updater)} />}
          {view === 'manager' && <QuestionManager confirmUpdate={confirmUpdate} user={user} collaboration={collaboration} updateCollaboration={(updater) => setCollaboration(updater)} questions={questions} allQuestions={allQuestions} activeQBankId={activeQBankId} />}
          {view === 'admin' && user.isAdmin && <AdminDashboard user={user} collaboration={collaboration} update={(updater) => setCollaboration(updater)} replaceFromServer={replaceCollaborationFromServer} />}
        </section>
      </div>
    </main>
  );
}
