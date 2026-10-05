'use client';
import { FormattedQuestionText } from '@/components/formatted-question-text';
import { HighlightedText } from '@/components/highlighted-question-text';
import { selectedTextRange } from '@/features/exams/client/text-selection';
import { readQuestionSource, validateQuestionSource } from '@/features/qbanks/domain/question-source';
import { indexQuestionsById } from '@/features/qbanks/domain/question-index';
import { createBookmarkStudySession } from '@/features/qbanks/domain/bookmarks';
import { QuestionEditDialog } from '@/components/question-edit-dialog';
import { QuestionSourceFields } from '@/components/question-source-fields';
import { SharedNoteImages } from '@/components/shared-note-images';
import { ExplanationImageEditor } from '@/components/explanation-image-editor';
import { NOTE_IMAGE_ACCEPT, uploadSharedNoteImages } from '@/features/media/client/shared-note-images';
import { DeleteAccount } from '@/components/delete-account';
import { stateBytes, STATE_WARNING_BYTES, STATE_BUDGET_BYTES } from '@/features/state/domain/state-budget';

/* oxlint-disable next/no-img-element, jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/control-has-associated-label */

import {
  openUpgrade,
  Subscribe,
  UpgradeDialog,
} from '@/components/subscription-workspace';
import { ContactWorkspace } from '@/components/contact-workspace';
import { WorkspaceHeader } from '@/components/workspace-header';
import { QraftBrand } from '@/components/brand/qraft-brand';
import { QuestionNavigator } from '@/components/exams/question-navigator';
import { QraftAppShell } from '@/components/presentation/qraft-app-shell';
import { ContributionCenter } from '@/components/contribution-center';
import { AccountProfile } from '@/components/account-profile';
import { SystemStatePage } from '@/components/system-state-page';
import { QuestionImportReview } from '@/components/question-import-review';
import { QuestionId, QuestionOption } from '@/components/question-tools';
import {
  FlashcardsWorkspace,
  QuestionFlashcardDialog,
} from '@/components/flashcards-workspace';
import { openLiveChannels, subscribeLive } from '@/lib/realtime-client';
import { createRefreshQueue } from '@/features/collaboration/client/refresh-queue';
import { ApiError, api, setApiCache } from '@/lib/api-client';
import { DEFAULT_LEGAL_LINKS, type LegalLinks } from '@/lib/legal-links';
import { DEFAULT_COMMUNITY_LINKS } from '@/features/announcements/domain/announcement';
import { SiteAnnouncement } from '@/components/site-announcement';
import { TelegramChannelButton } from '@/components/telegram-channel-button';
import { COLLABORATION_SYNC_NOTICE, type CollaborationSyncNotice } from '@/features/collaboration/client/collaboration-client';
import { loadRejectedCollaboration } from '@/lib/local-db';
import { saveDirectQuestionEdit } from '@/features/qbanks/client/direct-question-edit';
import { mergeLiveState } from '@/lib/merge-live-state';
import { appStateFreshness, mergeAppStates } from '@/lib/merge-app-state';
import { resolvePersonalStateReceipt, type PersonalStateReceipt, type PersonalStateSession } from '@/features/state/client/state-receipt';
import { recordStudyActivity } from '@/lib/study-streak';
import { preserveNewerLocalAnswers } from '@/features/collaboration/domain/preserve-personal-answers';
import {
  availableExamQuestionLimit,
  clampExamQuestionCount,
  formatDate,
  formatDuration,
  nextTestTitle,
  normalizedTestTitle,
} from '@/features/exams/domain/exam-presenters';
import { filterHistoryTests, groupHistoryTests, sortHistoryTests, type HistoryMonth } from '@/features/exams/domain/test-history';
import { summarizeProgress } from '@/features/progress/domain/progress-summary';
import { AreasToImprove } from '@/components/progress/areas-to-improve';
import { planAccessLabel } from '@/features/subscriptions/domain/plan-config';
import { ExamAccessNotice, type ExamUpgradeRequest } from '@/components/exams/exam-access-notice';
import { examRestriction, type ExamUpgradeReason } from '@/features/subscriptions/domain/exam-access';
import { mergeRanges } from '@/features/exams/domain/highlight-ranges';
import {
  loadActiveLocalTheme,
  loadLocalTheme,
  saveLocalTheme,
  type LocalTheme,
} from '@/lib/local-preferences';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { AdaptiveOverlay } from '@/components/ui/adaptive-overlay';
import {
  Award,
  ArrowRight,
  BarChart3,
  Bookmark,
  Bold,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CircleAlert,
  Clock3,
  ClipboardList,
  ClipboardPlus,
  Copy,
  Cloud,
  CloudOff,
  Download,
  Ellipsis,
  FileText,
  FlaskConical,
  Globe2,
  Flag,
  Eye,
  EyeOff,
  Highlighter,
  ImagePlus,
  Italic,
  LayoutDashboard,
  Library,
  Layers3,
  LockKeyhole,
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
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Sun,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { usePresentationEnvironment } from '@/features/presentation/presentation-context';

import {
  createCloudflareAccount,
  beginTotpEnrollment,
  completeCloudflareMfaSignIn,
  completeTotpEnrollment,
  joinCloudflareQBankByLink,
  flushPendingCollaborationState,
  retryRejectedCollaborationState,
  loadCollaborationState,
  loadCloudState,
  observeCloudflareUser,
  observeCloudStateSync,
  previewCloudflareQBankInvitation,
  registerStartedExam,
  flushPendingCloudState,
  saveBestEffortStateCheckpoint,
  saveCloudState,
  saveDailyGoal,
  saveExamCheckpoint,
  saveFlashcardCheckpoint,
  queueCollaborationState,
  saveCollaborationState,
  setAuthenticatedUserCache,
  signInCloudflare,
  signOutCloudflare,
  uploadSharedNoteImage,
  type QBankLinkInvitation,
} from '@/lib/application-services';
import {
  loadLocalCollaboration,
  loadCollaborationSyncOutbox,
  loadLocalState,
  saveLocalState,
  saveLocalCollaboration,
} from '@/lib/application-services';
import {
  administrativeRoleLabels,
  canAccessBank,
  canEditBank,
  canReviewBank,
  hasAccessManagerRole,
  hasModeratorRole,
  isPlatformRole,
} from '@/features/access/domain/access-policy';
import {
  emptyProgress,
  initialCollaborationState,
  initialAppState,
  normalizeCollaborationState,
  normalizeAppState,
  optionLabel,
  type AppState,
  type AppUser,
  type CollaborationState,
  type HighlightRange,
  type Question,
  type QuestionProgress,
  type QBankSpecialty,
  type QBankTopic,
  type QuestionProposal,
  type QuestionStatus,
  type ProposalEditKind,
  type PlatformRole,
  type TestBuilderConfig,
  type TestSession,
} from '@/lib/medguard-types';
import {
  getPlanLimits,
  hasFeature,
} from '@/features/subscriptions/domain/plan-config';
import {
  AdminDashboard,
  PendingApproval,
} from '@/components/collaboration-dashboard';
import { QBankWorkspace } from '@/components/qbank-workspace';
import { QBankManagement } from '@/components/qbank-management';
import {
  PreformedTestRunner,
  PreformedTestsWorkspace,
} from '@/components/preformed-tests-workspace';
import { ReviewWorkspace } from '@/components/review-workspace';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
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
import { StudyMobileNav, StudyTabletRail } from '@/components/study-mobile-nav';
import { StudyDashboard } from '@/components/study-dashboard';
import { cn as cx } from '@/lib/utils';

export type QraftView =
  | 'subscribe'
  | 'contact'
  | 'account'
  | 'dashboard'
  | 'library'
  | 'qbank-management'
  | 'review'
  | 'create'
  | 'preformed'
  | 'history'
  | 'flashcards'
  | 'progress'
  | 'settings'
  | 'manager'
  | 'contribution-center'
  | 'admin'
  | 'test';
type View = QraftView;

const VIEW_PATHS: Partial<Record<View, string>> = {
  dashboard: '/',
  library: '/qbanks',
  create: '/exams/new',
  preformed: '/ready-tests',
  history: '/history',
  flashcards: '/flashcards',
  progress: '/progress',
  settings: '/settings',
  account: '/account',
  subscribe: '/subscription',
  contact: '/support',
  review: '/review',
  manager: '/contribute/questions',
  'contribution-center': '/contributions',
  admin: '/access',
};

function viewFromPath(pathname: string): View {
  if (pathname === '/' || pathname === '/study') return 'dashboard';
  if (pathname === '/qbanks' || pathname.startsWith('/qbanks/'))
    return 'library';
  if (pathname === '/exams/new') return 'create';
  if (pathname.startsWith('/exams/')) return 'test';
  const entry = Object.entries(VIEW_PATHS).find(
    ([, path]) => path === pathname,
  );
  return (entry?.[0] as View | undefined) ?? 'dashboard';
}

function pathForView(view: View, activeTestId?: string) {
  if (view === 'test') return `/exams/${activeTestId ?? 'active'}`;
  return VIEW_PATHS[view] ?? '/';
}
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

const NAV_ITEMS = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'library' as const, label: 'My QBanks', icon: Library },
  { id: 'create' as const, label: 'Create test', icon: ClipboardPlus },
  { id: 'preformed' as const, label: 'Preformed tests', icon: Globe2 },
  { id: 'history' as const, label: 'Previous tests', icon: BookOpenCheck },
  { id: 'flashcards' as const, label: 'Flashcards', icon: Layers3 },
  { id: 'progress' as const, label: 'Progress', icon: BarChart3 },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
];

function AppLoadingScreen({ status }: { status: string }) {
  return (
    <main className="q-loading-screen grid min-h-full place-items-center bg-background px-6">
      <output
        aria-live="polite"
        aria-busy="true"
        className="flex flex-col items-center text-center"
      >
        <QraftBrand tone="adaptive" className="q-loading-wordmark h-[58px]" />
        <p className="q-loading-status mt-7 text-sm font-medium text-muted-foreground">
          {status}
        </p>
      </output>
    </main>
  );
}

function testElapsedSeconds(test: TestSession, now = Date.now()) {
  if (test.elapsedSeconds !== undefined) {
    if (test.timerPaused || test.status !== 'active')
      return test.elapsedSeconds;
    const runningSince = new Date(
      test.timerStartedAt ?? test.startedAt,
    ).getTime();
    return (
      test.elapsedSeconds + Math.max(0, Math.floor((now - runningSince) / 1000))
    );
  }
  const end = test.completedAt ? new Date(test.completedAt).getTime() : now;
  return Math.max(
    0,
    Math.floor((end - new Date(test.startedAt).getTime()) / 1000),
  );
}

function getQuestionProgress(
  state: AppState,
  questionId: string,
): QuestionProgress {
  return state.progress[questionId] ?? emptyProgress();
}

function IconButton({
  label,
  children,
  onClick,
  active,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'grid size-11 place-items-center rounded-xl border text-muted-foreground transition hover:border-primary/35 hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40',
        active && 'border-primary/40 bg-primary/10 text-primary',
      )}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  className,
  tone = 'primary',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  tone?: 'primary' | 'study' | 'contribute';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx('q-button', `q-button-${tone}`, className)}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx('q-button q-button-secondary', className)}
    >
      {children}
    </button>
  );
}

function AuthScreen({
  onAuthenticated,
  onJoinTest,
}: {
  onAuthenticated: (user: AppUser) => void;
  onJoinTest: (code: string) => void;
}) {
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
  const [testCode, setTestCode] = useState('');

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
        ? await createCloudflareAccount(
            name,
            email,
            password,
            universityId,
            phone,
            setupToken,
          )
        : mfaRequired
          ? await completeCloudflareMfaSignIn(mfaCode)
          : await signInCloudflare(email, password);
      onAuthenticated(user);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Unable to sign in.';
      if (message === 'MFA_REQUIRED') {
        setMfaRequired(true);
        setError('');
      } else setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout relative grid min-h-screen overflow-hidden text-foreground lg:grid-cols-[0.95fr_1.05fr]">
      <QraftBrand
        variant="mark"
        label=""
        className="pointer-events-none absolute -right-[12vw] top-[8vh] z-0 size-[72vw] select-none opacity-[0.045] dark:opacity-[0.055] sm:size-[58vw] lg:-right-[5vw] lg:top-[-8vh] lg:size-[55vw]"
      />
      <section className="auth-story relative z-10 hidden overflow-hidden bg-[radial-gradient(circle_at_15%_15%,#168ee8_0,#075dab_36%,#073c74_100%)] p-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -bottom-48 -left-40 size-[560px] rounded-full border border-white/10" />
        <div className="absolute -bottom-28 -left-20 size-[380px] rounded-full border border-cyan-300/15" />
        <QraftBrand
          variant="mark"
          label=""
          className="pointer-events-none absolute -bottom-[15vw] -right-[3vw] size-[43vw] select-none opacity-[0.075] brightness-0 invert"
        />
        <div className="relative flex items-center">
          <div className="flex h-12 w-[150px] items-center rounded-2xl bg-white px-3 shadow-lg ring-1 ring-white/30">
            <QraftBrand className="h-full w-full" />
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
          <p className="mt-5 max-w-lg text-base leading-7 text-blue-50/80">
            Build trusted medical QBanks together, review every change, and keep
            your personal progress synced across devices.
          </p>
          <div className="mt-9 grid max-w-lg grid-cols-3 gap-3">
            {[
              ['217', 'study questions'],
              ['2', 'test modes'],
              ['100%', 'private progress'],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10"
              >
                <strong className="block text-xl">{value}</strong>
                <span className="text-xs text-blue-100/75">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-blue-100/60">
          A thoughtful space to build knowledge, together.
        </p>
      </section>
      <section className="relative z-10 flex items-center justify-center p-6 sm:p-10">
        <div className="auth-panel q-enter w-full max-w-[470px]">
          <div className="mb-9 flex items-center lg:hidden">
            <div className="flex h-10 w-[126px] items-center rounded-xl bg-white px-2.5 shadow-sm ring-1 ring-black/5 dark:bg-slate-50">
              <QraftBrand className="h-full w-full" />
            </div>
          </div>
          <div className="mb-8">
            <p className="mb-2 text-sm font-bold text-primary">
              {register ? 'REQUEST MEMBERSHIP' : 'WELCOME BACK'}
            </p>
            <h2 className="text-3xl font-bold tracking-tight">
              {register
                ? 'Create your study account'
                : 'Good to see you again.'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {register
                ? 'Add your details below. An administrator will review your account before you start studying.'
                : 'Pick up where you left off. Your questions, notes and progress are here.'}
            </p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            {mfaRequired && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center gap-2 font-bold text-primary">
                  <ShieldCheck className="size-4" />
                  Two-factor authentication
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Enter the six-digit code from your authenticator app.
                </p>
              </div>
            )}
            {register && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">
                  Full name
                </span>
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
                <span className="mb-1.5 block text-sm font-semibold">
                  Mobile number
                </span>
                <input
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="h-12 w-full rounded-xl border bg-white px-4 text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-primary focus:ring-3 focus:ring-primary/10 dark:bg-card dark:text-foreground dark:placeholder:text-muted-foreground"
                  placeholder="05XXXXXXXX"
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Used to verify your membership.
                </span>
              </label>
            )}
            {register && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">
                  University ID
                </span>
                <input
                  autoComplete="off"
                  value={universityId}
                  onChange={(event) =>
                    setUniversityId(event.target.value.toUpperCase())
                  }
                  className="h-12 w-full rounded-xl border bg-white px-4 font-mono text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-primary focus:ring-3 focus:ring-primary/10 dark:bg-card dark:text-foreground dark:placeholder:text-muted-foreground"
                  placeholder="442001234"
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Your ID doesn’t need to be listed already. We can verify it
                  during approval.
                </span>
              </label>
            )}
            {!mfaRequired && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">
                  Email address
                </span>
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
                <span className="mb-1.5 block text-sm font-semibold">
                  Password
                </span>
                <span className="relative block">
                  <input
                    required
                    minLength={10}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={
                      register ? 'new-password' : 'current-password'
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-12 w-full rounded-xl border bg-white px-4 text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-primary focus:ring-3 focus:ring-primary/10 dark:bg-card dark:text-foreground dark:placeholder:text-muted-foreground"
                    placeholder={
                      register
                        ? 'At least 10 characters'
                        : 'Enter your password'
                    }
                    style={{ paddingRight: 48 }}
                  />
                  <button
                    type="button"
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-1 grid w-11 place-items-center rounded-lg text-muted-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </span>
              </label>
            )}
            {register && (
              <details>
                <summary>Setting up the platform for the first time?</summary>
                <label className="mt-3 block">
                  <span className="mb-1.5 block text-sm font-semibold">
                    Superadmin setup code{' '}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={setupToken}
                    onChange={(event) => setSetupToken(event.target.value)}
                    className="h-12 w-full rounded-xl border bg-white px-4 text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-primary focus:ring-3 focus:ring-primary/10 dark:bg-card dark:text-foreground"
                    placeholder="Only for the configured Superadmin email"
                  />
                </label>
              </details>
            )}
            {mfaRequired && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">
                  Authenticator code
                </span>
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(event) =>
                    setMfaCode(event.target.value.replace(/\D/g, ''))
                  }
                  className="h-12 w-full rounded-xl border bg-white px-4 text-center font-mono text-xl tracking-[.4em] text-slate-900 outline-none placeholder:text-slate-500 focus:border-primary dark:bg-card dark:text-foreground dark:placeholder:text-muted-foreground"
                  placeholder="000000"
                />
              </label>
            )}
            {error && (
              <div
                role="alert"
                className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/12 dark:text-red-200"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            )}
            <PrimaryButton
              type="submit"
              disabled={busy || (mfaRequired && mfaCode.length !== 6)}
              className="w-full"
            >
              {busy && <RefreshCw className="size-4 animate-spin" />}
              {mfaRequired
                ? 'Verify and sign in'
                : register
                  ? 'Submit registration'
                  : 'Sign in'}
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
          <div className="mt-6 border-t pt-6">
            <p className="text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Joining a shared test?
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = testCode.trim().toUpperCase().replace(/\s+/g, '');
                if (value)
                  onJoinTest(value.startsWith('QF-') ? value : `QF-${value}`);
              }}
              className="mt-3 flex gap-2"
            >
              <input
                value={testCode}
                onChange={(event) => setTestCode(event.target.value)}
                placeholder="QF-XXXXXX"
                className="h-11 min-w-0 flex-1 rounded-xl border bg-background px-3 font-mono font-bold uppercase outline-none focus:border-primary"
              />
              <button className="q-button q-button-secondary">Join test</button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}

function MfaEnrollmentGate({
  onComplete,
  onSignOut,
}: {
  onComplete: () => void;
  onSignOut: () => void;
}) {
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
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to start MFA enrollment.',
      );
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
      setError(
        caught instanceof Error
          ? caught.message
          : 'The code is invalid or expired.',
      );
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
        <p className="mt-6 text-xs font-bold uppercase tracking-widest text-violet-600">
          Superadmin security boundary
        </p>
        <h1 className="mt-2 text-2xl font-bold">
          Two-factor authentication is required
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The only Superadmin account cannot open Qraft administration until an
          authenticator-app factor is enrolled.
        </p>
        {!setup ? (
          <button
            onClick={() => void begin()}
            disabled={busy}
            className="mt-6 h-11 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Preparing…' : 'Set up authenticator app'}
          </button>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border bg-muted/30 p-4">
              <span className="text-xs font-bold">Authenticator setup key</span>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-card p-3 text-xs">
                  {setup.secretKey}
                </code>
                <button
                  onClick={() =>
                    void navigator.clipboard.writeText(setup.secretKey).catch(() => setError('Unable to copy the setup key. Select and copy it manually.'))
                  }
                  className="grid size-10 place-items-center rounded-lg border"
                  aria-label="Copy setup key"
                >
                  <Copy className="size-4" />
                </button>
              </div>
              <a
                href={setup.qrUrl}
                className="mt-3 inline-block text-xs font-bold text-primary underline"
              >
                Open authenticator setup link
              </a>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">
                Six-digit verification code
              </span>
              <input
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ''))
                }
                inputMode="numeric"
                maxLength={6}
                className="h-12 w-full rounded-xl border bg-card px-4 text-center font-mono text-xl tracking-[.35em]"
                placeholder="000000"
              />
            </label>
            <button
              onClick={() => void finish()}
              disabled={busy || code.length !== 6}
              className="h-11 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              Verify and secure account
            </button>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
          >
            {error}
          </p>
        )}
        <button
          onClick={onSignOut}
          className="mt-4 h-10 w-full rounded-xl border text-xs font-bold"
        >
          Sign out
        </button>
      </section>
    </main>
  );
}

const LAB_REFERENCE_GROUPS = [
  {
    name: 'Complete blood count',
    values: [
      ['Hemoglobin', 'Female 12–16; Male 14–18 g/dL'],
      ['WBC', '4,000–11,000/µL'],
      ['Platelets', '150,000–450,000/µL'],
      ['Absolute neutrophil count', '2,000–8,250/µL'],
    ],
  },
  {
    name: 'Electrolytes & renal',
    values: [
      ['Sodium', '136–145 mEq/L'],
      ['Potassium', '3.5–5.0 mEq/L'],
      ['Chloride', '98–106 mEq/L'],
      ['Bicarbonate', '23–28 mEq/L'],
      ['Creatinine', '0.6–1.2 mg/dL'],
      ['BUN', '8–20 mg/dL'],
      ['Anion gap', '7–13 mEq/L'],
    ],
  },
  {
    name: 'Liver & proteins',
    values: [
      ['Albumin', '3.5–5.5 g/dL'],
      ['Total bilirubin', '0.3–1.2 mg/dL'],
      ['AST', '10–40 U/L'],
      ['ALT', '10–40 U/L'],
      ['Alkaline phosphatase', '30–120 U/L'],
    ],
  },
  {
    name: 'Coagulation & glucose',
    values: [
      ['PT', '11–13 seconds'],
      ['aPTT', '25–35 seconds'],
      ['INR', '0.8–1.2'],
      ['Fasting glucose', '70–99 mg/dL'],
      ['HbA1c', '4.0–5.6%'],
    ],
  },
] as const;

function subscribeConnection(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function clearInvitationLink() {
  const url = new URL(window.location.href);
  url.searchParams.delete('join_qbank');
  url.searchParams.delete('token');
  window.history.replaceState(
    {},
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

function clearTestLink() {
  const url = new URL(window.location.href);
  url.searchParams.delete('join_test');
  window.history.replaceState(
    {},
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
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
  quickAccessQBankIds,
  activeQBankId,
  onSelectQBank,
  showReview,
  pendingReviewCount,
  dueFlashcardCount,
  persistent,
}: {
  view: View;
  setView: (view: View) => void;
  user: AppUser;
  syncStatus: SyncStatus;
  onSignOut: () => void;
  mobileOpen: boolean;
  closeMobile: () => void;
  qbanks: CollaborationState['qbanks'];
  quickAccessQBankIds: string[];
  activeQBankId: string;
  onSelectQBank: (id: string) => void;
  showReview: boolean;
  pendingReviewCount: number;
  dueFlashcardCount: number;
  persistent: boolean;
}) {
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const sidebarRef = useRef<HTMLElement>(null);
  const qbankMenuRef = useRef<HTMLDivElement>(null);
  const [qbankMenuOpen, setQbankMenuOpen] = useState(false);
  const quickAccessQBanks = useMemo(
    () =>
      quickAccessQBankIds.flatMap((id) => {
        const bank = qbanks.find((item) => item.id === id && !item.archived);
        return bank ? [bank] : [];
      }),
    [qbanks, quickAccessQBankIds],
  );
  useEffect(() => {
    if (!qbankMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!qbankMenuRef.current?.contains(event.target as Node))
        setQbankMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQbankMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [qbankMenuOpen]);
  useEffect(() => {
    const timer = window.setInterval(
      () => setCountdownNow(Date.now()),
      86_400_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!mobileOpen || persistent) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select, a[href]',
        ) ?? [],
      ).filter((item) => item.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobile();
      }
      if (event.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [mobileOpen, closeMobile, persistent]);
  const navigate = (next: View) => {
    setView(next);
    closeMobile();
  };
  const roleLabel = administrativeRoleLabels(user).join(' · ');
  const planExpiry = user.effectivePlanExpiresAt
    ? Date.parse(user.effectivePlanExpiresAt)
    : NaN;
  const remainingDays = Number.isFinite(planExpiry)
    ? Math.max(0, Math.ceil((planExpiry - countdownNow) / 86_400_000))
    : null;
  const formattedExpiry = Number.isFinite(planExpiry)
    ? new Intl.DateTimeFormat('en', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(planExpiry))
    : null;
  const planExpiryLabel = formattedExpiry
    ? `${formattedExpiry} · ${remainingDays}d left`
    : (user.effectivePlan ?? user.tier) === 'free'
      ? 'Free plan'
      : 'No expiry';
  return (
    <>
      {mobileOpen && !persistent && (
        <button
          aria-label="Close menu"
          onClick={closeMobile}
          className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm"
        />
      )}
      <aside
        ref={sidebarRef}
        inert={!persistent && !mobileOpen}
        aria-label="Workspace navigation"
        className={cx(
          'q-sidebar fixed inset-y-0 left-0 z-50 flex h-dvh shrink-0 flex-col overflow-hidden border-r border-sidebar-border/70 bg-sidebar transition-transform duration-200',
          persistent
            ? 'z-20 w-[264px] translate-x-0'
            : mobileOpen
              ? 'w-[min(88vw,340px)] translate-x-0'
              : 'w-[min(88vw,340px)] -translate-x-full',
        )}
      >
        <div className="flex h-[66px] shrink-0 items-center justify-between border-b border-sidebar-border/70 px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-[112px] shrink-0 items-center px-1">
              <QraftBrand tone="adaptive" className="h-[34px] w-full" />
            </div>
          </div>
          <button
            aria-label="Close navigation"
            onClick={closeMobile}
            className={cx(
              'size-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted',
              persistent ? 'hidden' : 'grid',
            )}
          >
            <X className="size-5" />
          </button>
        </div>
        <div ref={qbankMenuRef} className="relative mx-3 mt-2 shrink-0 py-1.5">
          <div className="flex h-10 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Library className="size-4" />
            </span>
            <button
              type="button"
              aria-label="Active QBank"
              aria-haspopup="menu"
              aria-expanded={qbankMenuOpen}
              onClick={() => setQbankMenuOpen((open) => !open)}
              className="group flex h-9 min-w-0 flex-1 items-center rounded-xl px-3 text-left text-sm font-bold text-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="min-w-0 flex-1 truncate">
                {qbanks.find((item) => item.id === activeQBankId)?.shortName ??
                  'Select QBank'}
              </span>
              <ChevronDown
                className={cx(
                  'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                  qbankMenuOpen && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>
          </div>
          {qbankMenuOpen && (
            <div
              role="menu"
              aria-label="Choose QBank"
              className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-2xl border border-sidebar-border/80 bg-popover p-1.5 text-popover-foreground shadow-[0_18px_45px_-20px_rgba(15,23,42,0.55)] ring-1 ring-black/5 backdrop-blur-xl"
            >
              {quickAccessQBanks.map((qbank) => {
                const active = qbank.id === activeQBankId;
                return (
                  <button
                    key={qbank.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      onSelectQBank(qbank.id);
                      setQbankMenuOpen(false);
                      closeMobile();
                    }}
                    className={cx(
                      'flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {qbank.shortName}
                    </span>
                    {active && <Check className="size-4 shrink-0" />}
                  </button>
                );
              })}
              {!quickAccessQBanks.length && (
                <button
                  type="button"
                  onClick={() => {
                    navigate('library');
                    setQbankMenuOpen(false);
                  }}
                  className="w-full rounded-xl px-3 py-3 text-left text-xs leading-5 text-muted-foreground hover:bg-accent"
                >
                  Choose up to five banks from My QBanks → Quick Access.
                </button>
              )}
            </div>
          )}
        </div>
        <nav
          className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable] [scrollbar-width:thin]"
          aria-label="Primary navigation"
        >
          <p className="q-eyebrow px-3 pb-2 pt-3">Study space</p>
          {NAV_ITEMS.map((item) => {
            const locked =
              item.id === 'flashcards' &&
              !hasFeature(user.effectivePlan ?? user.tier, 'flashcards', user.planLimits);
            return (
              <button
                key={item.id}
                aria-current={view === item.id ? 'page' : undefined}
                onClick={() => (locked ? openUpgrade() : navigate(item.id))}
                className={cx(
                  'group relative flex h-11 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 text-left text-sm font-semibold transition',
                  view === item.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                <span
                  className={cx(
                    'absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary transition-opacity',
                    view === item.id ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <item.icon className="size-[18px] shrink-0 transition-transform group-hover:scale-105" />
                <span className="min-w-0 truncate whitespace-nowrap">
                  {item.label}
                </span>
                {locked && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                    <LockKeyhole className="size-3" /> Full Access
                  </span>
                )}
                {item.id === 'flashcards' && dueFlashcardCount > 0 && (
                  <span
                    aria-label={`${dueFlashcardCount} flashcards due`}
                    className="ml-auto min-w-6 rounded-full bg-primary px-2 py-0.5 text-center text-[11px] font-black tabular-nums text-primary-foreground"
                  >
                    {dueFlashcardCount > 99 ? '99+' : dueFlashcardCount}
                  </span>
                )}
              </button>
            );
          })}
          {showReview && (
            <button
              aria-current={view === 'review' ? 'page' : undefined}
              onClick={() => navigate('review')}
              className={cx(
                'flex h-11 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 text-left text-sm font-semibold transition',
                view === 'review'
                  ? 'bg-primary/10 text-primary'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <ScanSearch className="size-[18px] shrink-0" />
              <span className="min-w-0 truncate whitespace-nowrap">Review</span>
              {pendingReviewCount > 0 && (
                <span
                  aria-label={`${pendingReviewCount} questions pending review`}
                  className="ml-auto min-w-6 rounded-full bg-amber-500 px-2 py-0.5 text-center text-[11px] font-black tabular-nums text-white shadow-sm"
                >
                  {pendingReviewCount > 99 ? '99+' : pendingReviewCount}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => navigate('contact')}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold"
          >
            <CircleAlert className="size-4" />
            Contact Us
          </button>
          {user.role !== 'super_admin' && (
            <button
              onClick={() => navigate('subscribe')}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-amber-700 dark:text-amber-300"
            >
              <Sparkles className="size-4" />
              Subscription
            </button>
          )}
          <div className="my-3 border-t" />
          <p className="q-eyebrow px-3 pb-2">Learn together</p>
          <button
            aria-current={view === 'contribution-center' ? 'page' : undefined}
            onClick={() => navigate('contribution-center')}
            className={cx(
              'flex h-11 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 text-left text-sm font-semibold transition',
              view === 'contribution-center'
                ? 'bg-primary/10 text-primary'
                : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            <Award className="size-[18px] shrink-0" />
            <span className="min-w-0 truncate whitespace-nowrap">
              Contribution Center
            </span>
          </button>
          <button
            aria-current={view === 'manager' ? 'page' : undefined}
            onClick={() => navigate('manager')}
            className={cx(
              'flex h-11 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 text-left text-sm font-semibold transition',
              view === 'manager'
                ? 'bg-primary/10 text-primary'
                : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            <ClipboardList className="size-[18px] shrink-0" />
            <span className="min-w-0 truncate whitespace-nowrap">
              + Add Questions
            </span>
          </button>
          {user.isAdmin && user.role === 'super_admin' ? (
            <Link
              href="/Admin"
              onClick={closeMobile}
              className="flex h-11 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 text-left text-sm font-semibold text-sidebar-foreground/80 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <ShieldCheck className="size-[18px] shrink-0" />
              <span className="min-w-0 truncate whitespace-nowrap">
                Superadmin
              </span>
            </Link>
          ) : user.isAdmin ? (
            <button
              aria-current={view === 'admin' ? 'page' : undefined}
              onClick={() => navigate('admin')}
              className={cx(
                'flex h-11 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 text-left text-sm font-semibold transition',
                view === 'admin'
                  ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <Users className="size-[18px] shrink-0" />
              <span className="min-w-0 truncate whitespace-nowrap">
                Admin dashboard
              </span>
            </button>
          ) : null}
        </nav>
        <footer className="q-sidebar-footer shrink-0 border-t border-sidebar-border/70 bg-sidebar/90 px-2.5 pt-2.5 backdrop-blur-xl">
          <div className="overflow-hidden rounded-2xl border border-sidebar-border/70 bg-card/95 shadow-[0_14px_34px_-25px_rgba(15,23,42,0.75)] dark:shadow-black/30">
            <div className="grid grid-cols-[minmax(0,1fr)_2rem_2rem] items-center gap-1.5 p-1.5">
              <button
                onClick={() => navigate('account')}
                aria-label="Open account profile"
                className="group flex min-w-0 items-center gap-2.5 overflow-hidden rounded-xl py-1.5 pl-1.5 pr-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span
                  className={`profile-ring profile-ring-${user.tier} grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-black text-primary transition-transform group-hover:scale-[1.02]`}
                >
                  {user.displayName.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <strong className="min-w-0 flex-1 truncate text-[13px] font-bold leading-tight">
                      {user.displayName}
                    </strong>
                  </span>
                  <span
                    className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5"
                    title={user.email}
                  >
                    {roleLabel && (
                      <span className="min-w-0 max-w-full truncate text-[10px] font-medium capitalize text-muted-foreground">
                        {roleLabel}
                      </span>
                    )}
                    <span className="max-w-full shrink-0 truncate rounded-md bg-primary/10 px-1.5 py-px text-[10px] font-bold leading-4 text-primary">
                      {planAccessLabel(user.effectivePlan ?? user.tier)}
                    </span>
                  </span>
                </span>
              </button>
              <span
                title={
                  syncStatus === 'syncing'
                    ? 'Syncing changes'
                    : syncStatus === 'synced'
                      ? 'All changes synced'
                      : syncStatus === 'error'
                        ? 'Sync needs attention'
                        : syncStatus === 'offline'
                          ? 'Working offline'
                          : 'Saved on this device'
                }
                className={cx(
                  'grid size-8 place-items-center rounded-xl',
                  syncStatus === 'error'
                    ? 'bg-red-50 text-red-600 dark:bg-red-500/10'
                    : syncStatus === 'offline' || syncStatus === 'local'
                      ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10'
                      : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10',
                )}
              >
                {syncStatus === 'syncing' ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : syncStatus === 'error' ? (
                  <CircleAlert className="size-3.5" />
                ) : syncStatus === 'offline' || syncStatus === 'local' ? (
                  <CloudOff className="size-3.5" />
                ) : (
                  <Cloud className="size-3.5" />
                )}
              </span>
              <button
                title="Sign out"
                aria-label="Sign out"
                onClick={onSignOut}
                className="grid size-8 shrink-0 place-items-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 dark:hover:border-red-500/20 dark:hover:bg-red-500/10"
              >
                <LogOut className="size-4" />
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-sidebar-border/60 px-2 pb-2 pt-2">
              <span
                className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-muted-foreground"
                title={
                  formattedExpiry
                    ? `Plan ends ${formattedExpiry}`
                    : 'No scheduled plan expiry'
                }
              >
                <Clock3 className="size-3.5 shrink-0 text-primary" />
                <span className="truncate">{planExpiryLabel}</span>
              </span>
              <button
                type="button"
                onClick={() => navigate('subscribe')}
                className="shrink-0 rounded-lg border border-primary/25 px-2 py-1 text-[10px] font-bold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Extend
              </button>
            </div>
          </div>
        </footer>
      </aside>
    </>
  );
}

function PageHeader({
  title,
  subtitle,
  openMenu,
  actions,
}: {
  title: string;
  subtitle?: string;
  openMenu: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <WorkspaceHeader
      title={title}
      subtitle={subtitle}
      actions={actions}
      onOpenMenu={openMenu}
    />
  );
}

function StatCard({
  label,
  value,
  detail,
  color = 'blue',
}: {
  label: string;
  value: number | string;
  detail: string;
  color?: 'blue' | 'green' | 'red' | 'amber';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/12 dark:text-blue-200',
    green:
      'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200',
    red: 'bg-red-50 text-red-700 dark:bg-red-500/12 dark:text-red-200',
    amber:
      'bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-200',
  };
  return (
    <article className="rounded-2xl bg-card p-5 shadow-[0_5px_20px_rgba(24,53,78,0.055)] ring-1 ring-border">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">{label}</p>
          <strong className="mt-2 block text-3xl tracking-tight">
            {value}
          </strong>
          <span className="mt-1 block text-xs text-muted-foreground">
            {detail}
          </span>
        </div>
        <div
          className={cx(
            'grid size-9 place-items-center rounded-xl',
            colors[color],
          )}
        >
          {color === 'green' ? (
            <CheckCircle2 className="size-4" />
          ) : color === 'amber' ? (
            <Flag className="size-4" />
          ) : color === 'red' ? (
            <CircleAlert className="size-4" />
          ) : (
            <BarChart3 className="size-4" />
          )}
        </div>
      </div>
    </article>
  );
}

function CreateTest({
  questions,
  state,
  bankName,
  maxQuestionsPerExam,
  onStart,
  onQuestionLimit,
}: {
  questions: Question[];
  state: AppState;
  bankName: string;
  maxQuestionsPerExam: number;
  onStart: (config: TestBuilderConfig) => void;
  onQuestionLimit: () => void;
}) {
  const { mode: presentationMode } = usePresentationEnvironment();
  const handheld = presentationMode === 'handheld';
  const topicOptions = useMemo(() => {
    const counts = new Map<string, { specialty: string; topic: string; count: number }>();
    for (const question of questions) {
      const key = JSON.stringify([question.specialty, question.topic]);
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { specialty: question.specialty, topic: question.topic, count: 1 });
    }
    return [...counts.values()].sort((left, right) =>
      left.specialty.localeCompare(right.specialty) || left.topic.localeCompare(right.topic),
    );
  }, [questions]);
  const specialties = useMemo(
    () =>
      Array.from(
        new Set(questions.map((question) => question.specialty)),
      ).sort(),
    [questions],
  );
  const [config, setConfig] = useState<TestBuilderConfig>({
    mode: 'tutor',
    statuses: [],
    specialty: '',
    topics: [],
    includedTopics: [],
    count: availableExamQuestionLimit(questions.length, maxQuestionsPerExam),
    randomAll: false,
    title: '',
  });
  const [message, setMessage] = useState('');
  const [browseSpecialty, setBrowseSpecialty] = useState('');
  const [countWasEdited, setCountWasEdited] = useState(false);
  const [countDraft, setCountDraft] = useState<{ limit: number; value: string } | null>(null);
  const [mobileStep, setMobileStep] = useState<
    'pool' | 'mode' | 'filters' | 'review'
  >('pool');
  const selectedTopicKeys = useMemo(
    () => new Set((config.includedTopics ?? []).map((item) => JSON.stringify([item.specialty, item.topic]))),
    [config.includedTopics],
  );
  // The complete accessible question metadata and personal progress are already
  // hydrated. Eligibility counting is therefore local; only final randomized
  // selection needs the authoritative server.
  const eligibleCount = useMemo(
    () =>
      questions.filter((question) => {
        if (config.randomAll) return true;
        if (selectedTopicKeys.size) {
          if (!selectedTopicKeys.has(JSON.stringify([question.specialty, question.topic])))
            return false;
        } else {
          if (config.specialty && question.specialty !== config.specialty)
            return false;
          if (config.topics.length && !config.topics.includes(question.topic))
            return false;
        }
        if (!config.statuses.length) return true;
        const progress = state.progress[question.id];
        const attempts = progress?.attempts ?? 0;
        return config.statuses.some(
          (status) =>
            (status === 'new' && attempts === 0) ||
            (status === 'previous' && attempts > 0) ||
            (status === 'flagged' && progress?.flagged === true) ||
            (status === 'correct' &&
              attempts > 0 &&
              progress?.lastAnswer === question.answer) ||
            (status === 'incorrect' &&
              attempts > 0 &&
              progress?.lastAnswer !== question.answer),
        );
      }).length,
    [
      config.randomAll,
      config.specialty,
      config.statuses,
      config.topics,
      questions,
      selectedTopicKeys,
      state.progress,
    ],
  );
  const questionLimit = availableExamQuestionLimit(
    eligibleCount,
    maxQuestionsPerExam,
  );
  const selectedCount = countWasEdited
    ? clampExamQuestionCount(config.count, questionLimit)
    : questionLimit;
  const visibleCountDraft = countDraft?.limit === questionLimit ? countDraft.value : null;
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
      statuses: current.statuses.includes(status)
        ? current.statuses.filter((item) => item !== status)
        : [...current.statuses, status],
    }));
  }
  function toggleTopic(specialty: string, topic: string) {
    setConfig((current) => ({
      ...current,
      specialty: '',
      topics: [],
      includedTopics: (current.includedTopics ?? []).some((item) =>
        item.specialty === specialty && item.topic === topic,
      )
        ? (current.includedTopics ?? []).filter((item) =>
            item.specialty !== specialty || item.topic !== topic,
          )
        : [...(current.includedTopics ?? []), { specialty, topic }],
    }));
  }
  function restartSetup() {
    setConfig({
      mode: 'tutor',
      statuses: [],
      specialty: '',
      topics: [],
      includedTopics: [],
      count: availableExamQuestionLimit(questions.length, maxQuestionsPerExam),
      randomAll: false,
      title: '',
    });
    setBrowseSpecialty('');
    setCountWasEdited(false);
    setCountDraft(null);
    setMessage('');
    setMobileStep('pool');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const mobileSteps: ReadonlyArray<typeof mobileStep> = config.randomAll
    ? ['pool', 'mode', 'review']
    : ['pool', 'mode', 'filters', 'review'];
  const mobileStepIndex = Math.max(0, mobileSteps.indexOf(mobileStep));

  function startConfiguredTest() {
    if (!eligibleCount) {
      setMessage(
        'No questions match these filters. Try a different status or topic.',
      );
      return;
    }
    const count = selectedCount;
    const requestedTitle = (config.title ?? '').trim().replace(/\s+/g, ' ');
    if (
      requestedTitle &&
      state.tests.some(
        (test) =>
          normalizedTestTitle(test.title) ===
          normalizedTestTitle(requestedTitle),
      )
    ) {
      setMessage('This test title already exists. Choose another name.');
      return;
    }
    onStart({
      ...config,
      count,
      title: requestedTitle,
    });
  }

  function moveMobileStep(direction: -1 | 1) {
    const nextIndex = Math.min(
      mobileSteps.length - 1,
      Math.max(0, mobileStepIndex + direction),
    );
    setMessage('');
    setMobileStep(mobileSteps[nextIndex]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const includedTopics = config.includedTopics ?? [];
  return (
    <>
      <PageHeader
        title="Create a test"
        subtitle="Build a focused question block"
        openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))}
      />
      <div className={cx('mx-auto max-w-5xl p-4 sm:p-7', handheld && 'pb-[calc(var(--q-mobile-navigation)+var(--q-safe-bottom)+7rem)]')}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-muted-foreground">
            Select topics from any specialty to build one focused test.
          </p>
          <button
            type="button"
            onClick={restartSetup}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border bg-card px-4 text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RotateCcw className="size-4" />
            Restart setup
          </button>
        </div>
        {handheld && (
          <div
            className="q-test-builder-progress"
            aria-label="Test setup progress"
          >
            <div className="flex items-center justify-between text-xs font-bold">
              <span>
                Step {mobileStepIndex + 1} of {mobileSteps.length}
              </span>
              <span className="text-muted-foreground">
                {mobileStep === 'pool'
                  ? 'Question pool'
                  : mobileStep === 'mode'
                    ? 'Study mode'
                    : mobileStep === 'filters'
                      ? 'Filters'
                      : 'Review'}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{
                  width: `${((mobileStepIndex + 1) / mobileSteps.length) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_310px]">
          <div className="space-y-5">
            <section
              className={cx(
                'rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6',
                handheld && mobileStep !== 'pool' && 'hidden',
              )}
            >
              <span className="text-xs font-bold text-primary">01</span>
              <h2 className="mt-1 text-lg font-bold">
                Choose the question pool
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {(
                  [
                    [
                      false,
                      'Focused test',
                      'Filter by status, specialty, and topic.',
                    ],
                    [
                      true,
                      'Random QBank Test',
                      `Random questions from all ${questions.length} available in this QBank.`,
                    ],
                  ] as const
                ).map(([randomAll, title, description]) => (
                  <button
                    key={title}
                    type="button"
                    aria-pressed={config.randomAll === randomAll}
                    onClick={() =>
                      setConfig((current) => ({
                        ...current,
                        randomAll,
                        statuses: randomAll ? [] : current.statuses,
                      }))
                    }
                    className={cx(
                      'rounded-2xl border p-4 text-left transition',
                      config.randomAll === randomAll
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/10'
                        : 'hover:border-primary/30',
                    )}
                  >
                    <strong className="block text-sm">{title}</strong>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                      {description}
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section
              className={cx(
                'rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6',
                handheld && mobileStep !== 'mode' && 'hidden',
              )}
            >
              <span className="text-xs font-bold text-primary">02</span>
              <h2 className="mt-1 text-lg font-bold">Choose your test mode</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {(
                  [
                    [
                      'tutor',
                      'Tutor mode',
                      'See the correct answer after every question.',
                    ],
                    [
                      'timed',
                      'Timed mode',
                      'Review all answers after completing the test.',
                    ],
                  ] as const
                ).map(([value, title, description]) => (
                  <button
                    key={value}
                    aria-pressed={config.mode === value}
                    onClick={() => setConfig({ ...config, mode: value })}
                    className={cx(
                      'rounded-2xl border p-4 text-left transition',
                      config.mode === value
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/10'
                        : 'hover:border-primary/30',
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div
                        className={cx(
                          'grid size-9 place-items-center rounded-xl',
                          config.mode === value
                            ? 'bg-primary text-white'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {value === 'tutor' ? (
                          <BookOpenCheck className="size-4" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                      </div>
                      {config.mode === value && (
                        <CheckCircle2 className="size-5 text-primary" />
                      )}
                    </div>
                    <strong className="mt-4 block text-sm">{title}</strong>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                      {description}
                    </span>
                  </button>
                ))}
              </div>
            </section>
            {!config.randomAll && (
              <section
                className={cx(
                  'rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6',
                  handheld && mobileStep !== 'filters' && 'hidden',
                )}
              >
                <span className="text-xs font-bold text-primary">03</span>
                <h2 className="mt-1 text-lg font-bold">Question status</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select one or more. Leave all unselected to include every
                  question.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {statuses.map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={config.statuses.includes(value)}
                      onClick={() => toggleStatus(value)}
                      className={cx(
                        'rounded-full border px-4 py-2 text-xs font-bold transition',
                        config.statuses.includes(value)
                          ? 'border-primary bg-primary text-white'
                          : 'bg-white hover:border-primary/35 dark:bg-card',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {!config.randomAll && (
              <section
                className={cx(
                  'rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6',
                  handheld && mobileStep !== 'filters' && 'hidden',
                )}
              >
                <span className="text-xs font-bold text-primary">04</span>
                <h2 className="mt-1 text-lg font-bold">Specialty & topics</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Browse specialties and select any combination of topics. Switching specialties keeps your selections.
                </p>
                {specialties.length > 1 && (
                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-xs font-bold">
                      Browse specialty
                    </span>
                    <select
                      value={browseSpecialty}
                      onChange={(event) => setBrowseSpecialty(event.target.value)}
                      className="min-h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-sm"
                    >
                      <option value="">All specialties</option>
                      {specialties.map((item) => (
                        <option key={item} value={item}>
                          {item} · {includedTopics.filter((selection) => selection.specialty === item).length} selected
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="mt-4 max-h-[min(52vh,520px)] space-y-5 overflow-y-auto overscroll-contain rounded-xl border bg-muted/10 p-3 sm:p-4">
                  {(browseSpecialty ? [browseSpecialty] : specialties).map((specialty) => (
                    <div key={specialty} className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="min-w-0 break-words text-sm font-bold">{specialty}</h3>
                        <span className="text-xs text-muted-foreground">
                          {includedTopics.filter((item) => item.specialty === specialty).length} included
                        </span>
                      </div>
                      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                        {topicOptions.filter((item) => item.specialty === specialty).map((item) => {
                          const selected = includedTopics.some((selection) =>
                            selection.specialty === item.specialty && selection.topic === item.topic,
                          );
                          return (
                            <button
                              type="button"
                              key={JSON.stringify([item.specialty, item.topic])}
                              aria-pressed={selected}
                              onClick={() => toggleTopic(item.specialty, item.topic)}
                              className={cx(
                                'flex min-h-12 min-w-0 items-center gap-3 rounded-xl border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                selected ? 'border-primary bg-primary/10' : 'bg-card hover:border-primary/35 hover:bg-muted/50',
                              )}
                            >
                              <span className={cx('grid size-5 shrink-0 place-items-center rounded border', selected && 'border-primary bg-primary text-white')}>
                                {selected && <Check className="size-3" />}
                              </span>
                              <span className="min-w-0 flex-1 break-words font-medium">{item.topic}</span>
                              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 min-w-0 rounded-xl border border-primary/20 bg-primary/5 p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold">Included topics</h3>
                    <span aria-live="polite" className="rounded-full bg-card px-2.5 py-1 text-xs font-bold tabular-nums">{includedTopics.length}</span>
                  </div>
                  {includedTopics.length ? (
                    <div className="mt-3 flex flex-wrap gap-2" aria-label="Included topics">
                      {includedTopics.map((item) => (
                        <button
                          type="button"
                          key={JSON.stringify([item.specialty, item.topic])}
                          onClick={() => toggleTopic(item.specialty, item.topic)}
                          aria-label={`Remove ${item.topic} from ${item.specialty}`}
                          className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left text-xs font-medium hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <span className="min-w-0 break-words">{item.specialty} · {item.topic}</span>
                          <X className="size-3.5 shrink-0" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">No topics selected — the test includes every topic in this QBank.</p>
                  )}
                </div>
              </section>
            )}
          </div>
          <aside
            className={cx(
              'order-last min-w-0 h-fit rounded-2xl bg-card p-5 ring-1 ring-border lg:sticky lg:top-[92px]',
              handheld && mobileStep !== 'review' && 'hidden',
            )}
          >
            <span className="q-eyebrow">Ready when you are</span>
            <h3 className="mt-1 text-lg font-bold">Your session</h3>
            <p className="mt-2 text-sm text-muted-foreground lg:hidden">
              Start with these settings, or customize them below.
            </p>
            <label
              htmlFor="test-title"
              className="mt-5 block text-sm font-semibold"
            >
              Test Title
              <input
                id="test-title"
                value={config.title ?? ''}
                onChange={(event) => {
                  setMessage('');
                  setConfig({ ...config, title: event.target.value });
                }}
                placeholder={nextTestTitle(bankName, state.tests)}
                className="mt-2 h-11 w-full rounded-xl border bg-background px-3 font-normal"
              />
              <span className="mt-1.5 block text-xs font-normal text-muted-foreground">
                Leave blank to use: {nextTestTitle(bankName, state.tests)}
              </span>
            </label>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mode</span>
                <strong className="capitalize">{config.mode}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Available in QBank
                </span>
                <strong>{questions.length}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Eligible</span>
                <strong aria-live="polite">{eligibleCount ?? '…'}</strong>
              </div>
            </div>
            <div className="mt-5 min-w-0 rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <strong>Included topics</strong>
                <span className="rounded-full bg-card px-2 py-0.5 text-xs font-bold tabular-nums">
                  {config.randomAll ? 'All' : includedTopics.length || 'All'}
                </span>
              </div>
              {config.randomAll || !includedTopics.length ? (
                <p className="mt-2 text-xs text-muted-foreground">All QBank topics are included.</p>
              ) : (
                <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto overscroll-contain text-xs">
                  {includedTopics.map((item) => (
                    <li key={JSON.stringify([item.specialty, item.topic])} className="min-w-0 break-words rounded-lg bg-card px-2 py-1.5">
                      <span className="font-semibold">{item.specialty}</span> · {item.topic}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <label htmlFor="test-question-count" className="mt-6 block">
              <span className="mb-2 flex justify-between text-sm font-semibold">
                <span>Questions</span>
                <strong className="text-primary">
                  {selectedCount}
                </strong>
              </span>
              <input
                id="test-question-count"
                aria-label="Number of questions"
                type="number"
                inputMode="numeric"
                min={questionLimit > 0 ? 1 : 0}
                value={visibleCountDraft ?? selectedCount}
                onChange={(event) => {
                  setMessage('');
                  const raw = event.target.value;
                  if (raw === '') {
                    setCountDraft({ limit: questionLimit, value: '' });
                    return;
                  }
                  const requested = Number(raw);
                  if (!Number.isFinite(requested)) return;
                  if (requested > maxQuestionsPerExam) onQuestionLimit();
                  const count = clampExamQuestionCount(requested, questionLimit);
                  setCountWasEdited(count < questionLimit);
                  setCountDraft({ limit: questionLimit, value: String(count) });
                  setConfig((current) => ({ ...current, count }));
                }}
                onBlur={() => setCountDraft(null)}
                max={questionLimit}
                disabled={questionLimit === 0}
                className="h-11 w-full rounded-xl border bg-background px-3"
              />
              <span className="mt-1.5 block text-xs text-muted-foreground">
                Maximum available: {questionLimit}
                {eligibleCount > questionLimit ? ' (plan limit)' : ''}
              </span>
            </label>
            {eligibleCount === 0 && (
              <output className="mt-4 block rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                No questions match yet. Choose another status or clear your
                topic filters.
              </output>
            )}
            {message && (
              <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-500/12 dark:text-amber-200">
                {message}
              </p>
            )}
            <PrimaryButton
              tone="study"
              disabled={!eligibleCount}
              onClick={startConfiguredTest}
              className="mt-6 w-full"
            >
              <ClipboardPlus className="size-4" />
              Start test
            </PrimaryButton>
          </aside>
        </div>
        {handheld && (
          <div
            className="q-test-builder-actions"
            aria-label="Test setup navigation"
          >
            {mobileStepIndex > 0 ? (
              <button
                type="button"
                className="q-button q-button-secondary"
                onClick={() => moveMobileStep(-1)}
              >
                <ChevronLeft className="size-4" />
                Back
              </button>
            ) : (
              <span />
            )}
            {mobileStep !== 'review' && (
              <button
                type="button"
                className="q-button q-button-primary"
                onClick={() => moveMobileStep(1)}
              >
                Continue
                <ChevronRight className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function TestPanels({
  mobile,
  children,
}: {
  mobile: boolean;
  children: React.ReactNode;
}) {
  return mobile ? (
    <div className="min-w-0">{children}</div>
  ) : (
    <ResizablePanelGroup
      orientation="horizontal"
      className="items-stretch overflow-visible"
    >
      {children}
    </ResizablePanelGroup>
  );
}
function TestQuestionPanel({
  mobile,
  explanation,
  children,
}: {
  mobile: boolean;
  explanation: boolean;
  children: React.ReactNode;
}) {
  return mobile ? (
    <div className="min-w-0">{children}</div>
  ) : (
    <ResizablePanel
      id="question-panel"
      defaultSize={explanation ? '68%' : '100%'}
      minSize={explanation ? '42%' : '100%'}
    >
      {children}
    </ResizablePanel>
  );
}

function NotesSurface({
  handheld,
  onClose,
  children,
}: {
  handheld: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return handheld ? (
    <AdaptiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Shared notes"
    >
      {children}
    </AdaptiveOverlay>
  ) : (
    <>{children}</>
  );
}

function TestView({
  test,
  questions,
  state,
  setState,
  onExit,
  user,
  collaboration,
  updateCollaboration,
  confirmUpdate,
}: {
  test: TestSession;
  questions: Question[];
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onExit: (destination?: 'dashboard' | 'history' | 'library') => void;
  user: AppUser;
  collaboration: CollaborationState;
  updateCollaboration: (
    updater: (current: CollaborationState) => CollaborationState,
  ) => void;
  confirmUpdate: (updater: (current: CollaborationState) => CollaborationState) => void;
}) {
  const [seconds, setSeconds] = useState(() => testElapsedSeconds(test));
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [privateNotesOpen, setPrivateNotesOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [labsOpen, setLabsOpen] = useState(false);
  const [flashcardOpen, setFlashcardOpen] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [zoomImage, setZoomImage] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState('');
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);
  const [reportMessage, setReportMessage] = useState('');
  const [suggestedAnswer, setSuggestedAnswer] = useState<number | undefined>();
  const [markerActive, setMarkerActive] = useState(false);
  const [editKinds, setEditKinds] = useState<ProposalEditKind[]>([
    'typo_formatting',
  ]);
  const [proposedStem, setProposedStem] = useState('');
  const [proposedOptions, setProposedOptions] = useState<string[]>([]);
  const [proposedExplanation, setProposedExplanation] = useState('');
  const [proposedExplanationImages, setProposedExplanationImages] = useState<QuestionProgress['noteImages']>([]);
  const [proposedSource, setProposedSource] = useState('');
  const [proposedSourcePage, setProposedSourcePage] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [noteImagesDraft, setNoteImagesDraft] = useState<
    QuestionProgress['noteImages']
  >([]);
  const [uploading, setUploading] = useState(false);
  const [noteUploadError, setNoteUploadError] = useState('');
  const noteUploadInFlight = useRef(false);
  const activeNoteUploadScope = useRef('');
  const noteDraftBaseline = useRef({ key: '', content: '', images: [] as QuestionProgress['noteImages'] });
  const { mode: presentationMode } = usePresentationEnvironment();
  const handheld = presentationMode === 'handheld';
  const stemRef = useRef<HTMLParagraphElement>(null);
  const examQuestionsById = useMemo(() => indexQuestionsById(questions), [questions]);
  const activeQuestions = useMemo(() => {
    const questionsById = new Map(
      questions.map((question) => [question.id, question]),
    );
    return test.questionIds
      .map((id) => questionsById.get(id))
      .filter(Boolean) as Question[];
  }, [test.questionIds, questions]);
  const answeredCount = test.questionIds.filter(
    (questionId) => test.answers[questionId] !== undefined,
  ).length;
  const allQuestionsAnswered =
    test.questionIds.length > 0 && answeredCount === test.questionIds.length;
  const question = activeQuestions[test.currentIndex];
  const progress = question
    ? getQuestionProgress(state, question.id)
    : emptyProgress();
  useEffect(() => {
    stemRef.current
      ?.closest('.q-viewport')
      ?.scrollTo({ top: 0, behavior: 'instant' });
  }, [question?.id]);
  const qbankId = question?.qbankId ?? test.qbankId ?? 'smle-gs';
  const noteKey = question ? `${qbankId}:${question.id}` : '';
  const sharedNote = noteKey ? collaboration.sharedNotes[noteKey] : undefined;
  const explanationImages = [...new Map([...(question?.explanationImages ?? []), ...(sharedNote?.images ?? [])].map(image => [image.url, image])).values()];
  const displayedExplanation =
    sharedNote?.content.trim() ||
    question?.explanation?.trim() ||
    'No explanation has been added yet.';
  const selected = question ? test.answers[question.id] : undefined;
  const revealed = question ? test.revealed.includes(question.id) : false;
  const answerStat = noteKey ? collaboration.answerStats[noteKey] : undefined;
  const answerSummary = useMemo(() => {
    const counts = new Map<number, number>();
    const selections = Object.values(answerStat?.selections ?? {});
    for (const answer of selections)
      counts.set(answer, (counts.get(answer) ?? 0) + 1);
    return { counts, total: selections.length };
  }, [answerStat?.selections]);

  useEffect(() => {
    if (test.timerPaused || test.status !== 'active') return;
    const elapsedAtStart = test.elapsedSeconds ?? 0;
    const runningSince = new Date(
      test.elapsedSeconds === undefined
        ? test.startedAt
        : (test.timerStartedAt ?? test.startedAt),
    ).getTime();
    const timer = window.setInterval(
      () =>
        setSeconds(
          elapsedAtStart +
            Math.max(0, Math.floor((Date.now() - runningSince) / 1000)),
        ),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [
    test.elapsedSeconds,
    test.startedAt,
    test.status,
    test.timerPaused,
    test.timerStartedAt,
  ]);

  useEffect(() => {
    activeNoteUploadScope.current = noteKey;
    return () => { activeNoteUploadScope.current = ''; };
  }, [noteKey]);

  useEffect(() => {
    const update = window.setTimeout(() => {
      const previous = noteDraftBaseline.current;
      const next = { key: noteKey, content: sharedNote?.content ?? '', images: sharedNote?.images ?? [] };
      setNoteDraft(current => previous.key === noteKey ? mergeLiveState(previous.content, current, next.content) : next.content);
      setNoteImagesDraft(current => previous.key === noteKey ? mergeLiveState(previous.images, current, next.images) : next.images);
      noteDraftBaseline.current = next;
      if (previous.key !== noteKey) setNoteUploadError('');
    }, 0);
    return () => window.clearTimeout(update);
  }, [noteKey, sharedNote?.content, sharedNote?.images]);

  const updateTest = useCallback(
    (updater: (current: TestSession) => TestSession) => {
      setState((current) => ({
        ...current,
        tests: current.tests.map((item) =>
          item.id === test.id ? updater(item) : item,
        ),
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
            incorrectAttempts:
              oldProgress.incorrectAttempts + (correct ? 0 : 1),
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
    if (!handheld) setNotesOpen(true);
  }

  function finishTest() {
    if (allQuestionsAnswered) setFinishConfirmOpen(true);
    else completeLater();
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
    onExit('history');
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
    setFinishConfirmOpen(false);
    setState((current) => {
      const currentTest =
        current.tests.find((item) => item.id === test.id) ?? test;
      const nextProgress = { ...current.progress };
      const graded = new Set(currentTest.graded);
      currentTest.questionIds.forEach((questionId) => {
        if (
          graded.has(questionId) ||
          currentTest.answers[questionId] === undefined
        )
          return;
        const sourceQuestion = examQuestionsById.get(questionId);
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
        tests:
          test.origin === 'bookmarks'
            ? current.tests.filter((item) => item.id !== test.id)
            : current.tests.map((item) =>
                item.id === test.id
                  ? {
                      ...item,
                      status: 'completed',
                      completedAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      elapsedSeconds: seconds,
                      timerPaused: true,
                      timerStartedAt: new Date().toISOString(),
                      graded: [
                        ...new Set([
                          ...item.graded,
                          ...Object.keys(item.answers),
                        ]),
                      ],
                      revealed: [
                        ...new Set([...item.revealed, ...item.questionIds]),
                      ],
                    }
                  : item,
              ),
      };
    });
    updateCollaboration((current) => {
      const answerStats = { ...current.answerStats };
      test.questionIds.forEach((questionId) => {
        const answer = test.answers[questionId];
        const source = examQuestionsById.get(questionId);
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
    onExit(test.origin === 'bookmarks' ? 'library' : 'history');
  }

  function move(index: number) {
    updateTest((current) => ({
      ...current,
      currentIndex: Math.max(
        0,
        Math.min(index, current.questionIds.length - 1),
      ),
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
          [question.id]: {
            ...old,
            flagged: !old.flagged,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
  }

  function toggleBookmark() {
    setState((current) => {
      const old = getQuestionProgress(current, question.id);
      return {
        ...current,
        progress: {
          ...current.progress,
          [question.id]: {
            ...old,
            bookmarked: !old.bookmarked,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
  }

  function sectionHighlights(section: string) {
    return section === 'stem'
      ? progress.highlights
      : (progress.highlightSections?.[section] ?? []);
  }

  const addHighlight = useCallback((section: string, root: HTMLElement) => {
    if (!question || (section !== 'stem' && section !== 'explanation')) return;
    const selection = window.getSelection();
    const sourceText = section === 'stem' ? question.stem : displayedExplanation;
    const selectedRange = selectedTextRange(root, sourceText, selection);
    if (!selectedRange) return;
    const { start, end } = selectedRange;
    setState((current) => {
      const old = getQuestionProgress(current, question.id);
      return {
        ...current,
        progress: {
          ...current.progress,
          [question.id]: {
            ...old,
            ...(section === 'stem'
              ? { highlights: mergeRanges([...old.highlights, { start, end }]) }
              : {
                  highlightSections: {
                    ...old.highlightSections,
                    [section]: mergeRanges([
                      ...(old.highlightSections?.[section] ?? []),
                      { start, end },
                    ]),
                  },
                }),
          },
        },
      };
    });
    selection?.removeAllRanges();
  }, [question, displayedExplanation, setState]);

  const copySelectionAndMark = useCallback((section: string, root: HTMLElement) => {
    if (!markerActive || (section !== 'stem' && section !== 'explanation'))
      return;
    addHighlight(section, root);
  }, [markerActive, addHighlight]);

  useEffect(() => {
    if (!markerActive || !question) return;
    const onSelectionKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Shift') return;
      const anchor = window.getSelection()?.anchorNode;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      const root = element?.closest<HTMLElement>('[data-highlight-section]');
      if (root?.dataset.highlightQuestion !== question.id) return;
      copySelectionAndMark(root.dataset.highlightSection ?? '', root);
    };
    document.addEventListener('keyup', onSelectionKeyUp);
    return () => document.removeEventListener('keyup', onSelectionKeyUp);
  }, [markerActive, question, copySelectionAndMark]);

  function removeHighlight(section: string, target: HighlightRange) {
    setState((current) => {
      const old = getQuestionProgress(current, question.id);
      return {
        ...current,
        progress: {
          ...current.progress,
          [question.id]: {
            ...old,
            ...(section === 'stem'
              ? {
                  highlights: old.highlights.filter(
                    (range) =>
                      range.end <= target.start || range.start >= target.end,
                  ),
                }
              : {
                  highlightSections: {
                    ...old.highlightSections,
                    [section]: (old.highlightSections?.[section] ?? []).filter(
                      (range) =>
                        range.end <= target.start ||
                        range.start >= target.end,
                    ),
                  },
                }),
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
          [question.id]: { ...old, highlights: [], highlightSections: {} },
        },
      };
    });
  }

  function updatePrivateNote(note: string) {
    setState((current) => {
      const old = getQuestionProgress(current, question.id);
      return {
        ...current,
        progress: { ...current.progress, [question.id]: { ...old, note } },
      };
    });
  }

  function saveNote() {
    if (noteUploadInFlight.current) return;
    const content = noteDraft.trim();
    if (
      content === (sharedNote?.content ?? '') &&
      JSON.stringify(noteImagesDraft) ===
        JSON.stringify(sharedNote?.images ?? [])
    )
      return;
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
    const textarea = document.getElementById(
      'question-note',
    ) as HTMLTextAreaElement | null;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next =
      noteDraft.slice(0, start) +
      before +
      noteDraft.slice(start, end) +
      after +
      noteDraft.slice(end);
    setNoteDraft(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    });
  }

  async function attachImages(files: readonly File[]) {
    if (!files.length || noteUploadInFlight.current) return;
    const scope = noteKey;
    noteUploadInFlight.current = true;
    setUploading(true);
    setNoteUploadError('');
    try {
      const result = await uploadSharedNoteImages(
        files,
        file => uploadSharedNoteImage(user.uid, file, qbankId, question.id),
      );
      // Navigation cannot attach a completed upload to a different question.
      if (activeNoteUploadScope.current !== scope) return;
      setNoteImagesDraft((current) => [...current, ...result.images]);
      setNoteUploadError(result.errors.join('\n'));
    } catch (caught) {
      if (activeNoteUploadScope.current === scope)
        setNoteUploadError(caught instanceof Error ? caught.message : 'Image upload failed.');
    } finally {
      noteUploadInFlight.current = false;
      setUploading(false);
    }
  }

  function openSharedNoteEditor() {
    setExplanationOpen(false);
    setNotesOpen(true);
  }

  function removeImage(imageId: string) {
    setNoteImagesDraft((current) =>
      current.filter((image) => image.id !== imageId),
    );
  }

  function updateCaption(imageId: string, caption: string) {
    setNoteImagesDraft((current) =>
      current.map((image) =>
        image.id === imageId ? { ...image, caption } : image,
      ),
    );
  }

  function openReport() {
    setReportError('');
    setProposedStem(question.stem);
    setProposedOptions([...question.options]);
    setSuggestedAnswer(question.answer);
    setProposedExplanation(question.explanation ?? sharedNote?.content ?? '');
    setProposedExplanationImages(question.explanationImages ?? []);
    setProposedSource(readQuestionSource(question).sourceFile);
    setProposedSourcePage(String(readQuestionSource(question).sourcePage ?? ''));
    setEditKinds(['typo_formatting']);
    setReportMessage('');
    setReportOpen(true);
  }

  async function submitReport() {
    if (
      !reportMessage.trim() ||
      !proposedStem.trim() ||
      !proposedSource.trim() ||
      !editKinds.length ||
      proposedOptions.length < 2 ||
      proposedOptions.length > 10 ||
      suggestedAnswer === undefined ||
      suggestedAnswer >= proposedOptions.length ||
      proposedOptions.some((item) => !item.trim())
    )
      return;
    let source: ReturnType<typeof validateQuestionSource>;
    try { source = validateQuestionSource({ sourceFile: proposedSource, sourcePage: proposedSourcePage, originalQuestionNumber: readQuestionSource(question).originalQuestionNumber }); }
    catch (error) { setReportError(error instanceof Error ? error.message : 'Invalid source.'); return; }
    const proposedAt = new Date().toISOString();
    const currentSnapshot = {
      stem: question.stem,
      options: question.options,
      answer: question.answer,
      specialty: question.specialty,
      topic: question.topic,
      explanation: question.explanation ?? sharedNote?.content ?? '',
      explanationImages: question.explanationImages ?? [],
      ...readQuestionSource(question),
      images: question.images ?? [],
    };
    if (user.role === 'super_admin') {
      setReportBusy(true);
      setReportError('');
      try {
        const saved = await saveDirectQuestionEdit(user.uid, qbankId, question, {
          ...currentSnapshot,
          stem: proposedStem.trim(), options: proposedOptions.map(item => item.trim()),
          answer: suggestedAnswer, explanation: proposedExplanation.trim(), explanationImages: proposedExplanationImages, ...source,
        });
        confirmUpdate(current => ({ ...current, approvedQuestions: current.approvedQuestions.map(item => item.id === saved.id ? saved : item) }));
        setReportOpen(false);
      } catch (caught) {
        setReportError(caught instanceof Error ? caught.message : 'Unable to save this question. Your draft has been kept.');
      } finally {
        setReportBusy(false);
      }
      return;
    }
    updateCollaboration((current) => {
      const payload = {
        stem: proposedStem.trim(),
        options: proposedOptions.map((item) => item.trim()),
        answer: suggestedAnswer,
        specialty: question.specialty,
        topic: question.topic,
        explanation: proposedExplanation.trim(),
        explanationImages: proposedExplanationImages,
        ...source,
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
    const handleKey = (event: KeyboardEvent) => {
      if (finishConfirmOpen) {
        if (event.key === 'Escape') setFinishConfirmOpen(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]'))
        return;
      const optionIndex = event.key.toLowerCase().charCodeAt(0) - 97;
      if (
        !revealed &&
        optionIndex >= 0 &&
        optionIndex < question.options.length
      )
        selectAnswer(optionIndex);
      else if (event.key === 'ArrowLeft') move(test.currentIndex - 1);
      else if (event.key === 'ArrowRight') move(test.currentIndex + 1);
      else if (event.key.toLowerCase() === 'f') toggleFlag();
      else if (event.key.toLowerCase() === 'm')
        setMarkerActive((value) => !value);
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
    <main className="q-test-screen flex flex-col bg-[#f5f7fa] dark:bg-background">
      <QuestionFlashcardDialog
        question={question}
        qbankId={qbankId}
        state={state}
        setState={setState}
        open={flashcardOpen}
        onOpenChange={setFlashcardOpen}
      />
      <AdaptiveOverlay
        open={explanationOpen}
        onOpenChange={setExplanationOpen}
        title="Explanation"
      >
        <p
          dir="auto"
          data-highlight-section="explanation"
          data-highlight-question={question.id}
          onPointerUp={(event) =>
            copySelectionAndMark('explanation', event.currentTarget)
          }
          className="select-text whitespace-pre-wrap break-words leading-7"
        >
          <HighlightedText
            text={displayedExplanation}
            ranges={sectionHighlights('explanation')}
            onRemove={(range) => removeHighlight('explanation', range)}
          />
        </p>
        <SharedNoteImages images={explanationImages} onZoom={setZoomImage} />
        <SecondaryButton className="mt-4" onClick={openSharedNoteEditor}>
          <ImagePlus className="size-4" />Add explanation images
        </SecondaryButton>
      </AdaptiveOverlay>
      <AdaptiveOverlay
        open={labsOpen}
        onOpenChange={setLabsOpen}
        title="Laboratory reference values"
        description="Quick study reference based on ABIM adult ranges. Local laboratory ranges and the clinical context may differ."
        className="sm:max-w-3xl"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {LAB_REFERENCE_GROUPS.map((group) => (
            <section
              key={group.name}
              className="rounded-2xl border bg-muted/20 p-4"
            >
              <h3 className="font-bold text-primary">{group.name}</h3>
              <dl className="mt-3 divide-y">
                {group.values.map(([name, value]) => (
                  <div
                    key={name}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2 text-sm"
                  >
                    <dt>{name}</dt>
                    <dd className="text-right font-semibold tabular-nums">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </AdaptiveOverlay>
      <AdaptiveOverlay
        open={privateNotesOpen}
        onOpenChange={setPrivateNotesOpen}
        title="Private note"
        description="Only you can see this note. It follows this question across every test and saves automatically."
      >
        <textarea
          dir="auto"
          value={progress.note}
          onChange={(event) => updatePrivateNote(event.target.value)}
          placeholder="Write a private note for this question…"
          className="min-h-52 w-full resize-y rounded-xl border bg-muted/20 p-4 text-sm leading-7 outline-none focus:border-primary focus:ring-3 focus:ring-primary/10"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
            Saved automatically to your account
          </span>
          <button
            type="button"
            disabled={!progress.note}
            onClick={() => updatePrivateNote('')}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-500/10"
          >
            <Trash2 className="size-4" />
            Delete note
          </button>
        </div>
      </AdaptiveOverlay>
      <AdaptiveOverlay
        open={toolsOpen}
        onOpenChange={setToolsOpen}
        title="Study tools"
        description="Tools for this question. Your place in the exam will not change."
      >
        <div className="q-mobile-tool-list">
          <button
            type="button"
            aria-pressed={markerActive}
            onClick={() => setMarkerActive((value) => !value)}
          >
            <Highlighter className="size-5" />
            <span>
              <strong>{markerActive ? 'Marker on' : 'Highlight text'}</strong>
              <small>Select text in the question or explanation.</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setToolsOpen(false);
              setPrivateNotesOpen(true);
            }}
          >
            <StickyNote className="size-5" />
            <span>
              <strong>Private note</strong>
              <small>
                {progress.note.trim()
                  ? 'Edit your saved note.'
                  : 'Add a note only you can see.'}
              </small>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setToolsOpen(false);
              setLabsOpen(true);
            }}
          >
            <FlaskConical className="size-5" />
            <span>
              <strong>Laboratory values</strong>
              <small>Open the quick reference.</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setToolsOpen(false);
              setFlashcardOpen(true);
            }}
          >
            <Layers3 className="size-5" />
            <span>
              <strong>Create flashcard</strong>
              <small>Turn this question into a study card.</small>
            </span>
          </button>
          <button
            type="button"
            disabled={selected === undefined && !revealed}
            onClick={() => {
              restartQuestion();
              setToolsOpen(false);
            }}
          >
            <RotateCcw className="size-5" />
            <span>
              <strong>Restart question</strong>
              <small>Clear this answer and try again.</small>
            </span>
          </button>
          {(progress.highlights.length > 0 || sectionHighlights('explanation').length > 0) && (
            <button type="button" onClick={clearHighlights}>
              <Trash2 className="size-5" />
              <span>
                <strong>Clear highlights</strong>
                <small>Remove highlights from this question.</small>
              </span>
            </button>
          )}
        </div>
      </AdaptiveOverlay>
      <Dialog
        open={Boolean(zoomImage)}
        onOpenChange={(open) => {
          if (!open) setZoomImage('');
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogTitle>Image preview</DialogTitle>
          <img
            src={zoomImage || undefined}
            alt="Enlarged question or explanation illustration"
            className="max-h-[75dvh] w-full object-contain"
          />
        </DialogContent>
      </Dialog>
      <nav className="q-test-bottom" aria-label="Test navigation">
        <SecondaryButton
          onClick={() => move(test.currentIndex - 1)}
          disabled={test.currentIndex === 0}
        >
          Previous
        </SecondaryButton>
        <SecondaryButton
          onClick={() => move(test.currentIndex + 1)}
          disabled={test.currentIndex >= activeQuestions.length - 1}
        >
          Next
        </SecondaryButton>
      </nav>
      <header className="q-exam-header sticky top-0 z-30 flex min-h-[68px] items-center gap-2 border-b bg-white px-3 shadow-sm dark:bg-card sm:gap-4 sm:px-5">
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
          <strong className="block truncate text-sm font-bold tabular-nums text-foreground sm:text-base">
            Question {test.currentIndex + 1} of {activeQuestions.length}
          </strong>
          <span className="block truncate text-[11px] text-muted-foreground sm:text-xs">
            {test.title}
          </span>
        </div>
        <div className="q-exam-header-actions flex shrink-0 items-center gap-1 sm:gap-2">
          <div
            className="hidden items-center gap-1.5 rounded-xl bg-muted px-2 py-2 text-xs font-bold tabular-nums sm:flex sm:gap-2 sm:px-3"
            title="Elapsed test time"
          >
            <Clock3 className="size-3.5 text-primary" />
            {formatDuration(seconds)}
          </div>
          <IconButton label="Pause timer" onClick={pauseTest}>
            <Pause className="size-4" />
          </IconButton>
          <IconButton
            label={progress.flagged ? 'Remove flag' : 'Flag question'}
            active={progress.flagged}
            onClick={toggleFlag}
          >
            <Flag
              className={cx('size-4', progress.flagged && 'fill-current')}
            />
          </IconButton>
          <IconButton
            label={
              progress.bookmarked ? 'Remove bookmark' : 'Bookmark question'
            }
            active={progress.bookmarked}
            onClick={toggleBookmark}
          >
            <Bookmark
              className={cx('size-4', progress.bookmarked && 'fill-current')}
            />
          </IconButton>
          <SecondaryButton onClick={finishTest} className="hidden sm:flex">
            {allQuestionsAnswered ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <Save className="size-4" />
            )}
            {allQuestionsAnswered ? 'Finish' : 'Continue later'}
          </SecondaryButton>
        </div>
      </header>
      <progress
        className="q-exam-progress h-1 w-full shrink-0"
        aria-label="Question progress"
        max={Math.max(1, activeQuestions.length)}
        value={test.currentIndex + 1}
      />
      <div className="q-test-body flex w-full min-w-0 flex-1">
        <section className="min-w-0 flex-1 p-3 sm:p-6 lg:p-8">
          <div
            className={cx(
              'mx-auto',
              revealed && displayedExplanation
                ? 'max-w-[1180px]'
                : 'max-w-[890px]',
            )}
          >
            <TestPanels
              key={`${question.id}:${revealed ? 'revealed' : 'answering'}`}
              mobile={handheld}
            >
              <TestQuestionPanel
                mobile={handheld}
                explanation={Boolean(revealed && displayedExplanation)}
              >
                <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-border dark:bg-card sm:p-8">
                  <div className="mb-5 flex min-w-0 items-center justify-between gap-2 border-b pb-4">
                    {handheld && (
                      <button
                        type="button"
                        className="q-exam-tools-trigger"
                        aria-label="Open study tools"
                        title="Open study tools"
                        onClick={() => setToolsOpen(true)}
                      >
                        <Ellipsis className="size-5" />
                      </button>
                    )}
                    <div className={cx('min-w-0', handheld && 'ml-auto')}>
                      <QuestionId value={question.questionId} compact />
                      {markerActive && (
                        <span className="ml-2 rounded-full bg-yellow-100 px-2 py-1 text-xs font-bold text-yellow-800 dark:bg-yellow-400/15 dark:text-yellow-200">
                          MARKER ON
                        </span>
                      )}
                    </div>
                    <div className="q-exam-inline-tools flex flex-wrap justify-end gap-2">
                      <IconButton
                        label="Open laboratory reference values"
                        onClick={() => setLabsOpen(true)}
                      >
                        <FlaskConical className="size-4" />
                      </IconButton>
                      <IconButton
                        label="Open private note"
                        active={Boolean(progress.note.trim())}
                        onClick={() => setPrivateNotesOpen(true)}
                      >
                        <StickyNote className="size-4" />
                      </IconButton>
                      <IconButton
                        label="Create flashcard from this question"
                        onClick={() => setFlashcardOpen(true)}
                      >
                        <Layers3 className="size-4" />
                      </IconButton>
                      <IconButton
                        label={
                          markerActive ? 'Turn marker off' : 'Keep marker on'
                        }
                        active={markerActive}
                        onClick={() => setMarkerActive((value) => !value)}
                      >
                        <Highlighter className="size-4" />
                      </IconButton>
                      <IconButton
                        label="Restart this question"
                        disabled={selected === undefined && !revealed}
                        onClick={restartQuestion}
                      >
                        <RotateCcw className="size-4" />
                      </IconButton>
                      {(progress.highlights.length > 0 || sectionHighlights('explanation').length > 0) && (
                        <IconButton
                          label="Clear highlights"
                          onClick={clearHighlights}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      )}
                    </div>
                  </div>
                  <div className="mb-5 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                      {question.specialty}
                    </span>
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                      {question.topic}
                    </span>
                  </div>
                  <p
                    ref={stemRef}
                    dir="auto"
                    data-highlight-section="stem"
                    data-highlight-question={question.id}
                    onPointerUp={(event) =>
                      copySelectionAndMark('stem', event.currentTarget)
                    }
                    className="select-text whitespace-pre-wrap break-words text-base leading-[1.85] text-[#1d2e40] touch-pan-y dark:text-foreground sm:text-base"
                  >
                    <HighlightedText
                      text={question.stem}
                      ranges={progress.highlights}
                      onRemove={(range) => removeHighlight('stem', range)}
                    />
                  </p>
                  <div className="mt-5 grid gap-3 border-t pt-4 text-xs sm:grid-cols-2">
                    <div className="min-w-0">
                      <span className="block text-muted-foreground">Written by</span>
                      <strong className="mt-1 block truncate font-semibold text-foreground">
                        {question.writtenByName?.trim() || 'Not recorded'}
                      </strong>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-muted-foreground">Reviewed by</span>
                      <strong className="mt-1 block truncate font-semibold text-foreground">
                        {question.reviewedByName?.trim() || 'Not reviewed'}
                      </strong>
                    </div>
                  </div>
                  {question.images?.length > 0 && (
                    <section
                      className="mt-6 rounded-2xl border bg-muted/20 p-3 sm:p-4"
                      aria-label="Question images"
                    >
                      <div
                        className={cx(
                          'grid gap-3',
                          question.images.length > 1 && 'sm:grid-cols-2',
                        )}
                      >
                        {question.images.map((image) => (
                          <figure
                            key={image.id}
                            className="overflow-hidden rounded-xl bg-card ring-1 ring-border"
                          >
                            <div className="grid min-h-48 place-items-center bg-slate-50 p-2 dark:bg-slate-950/25">
                              <button
                                className="w-full"
                                onClick={() => setZoomImage(image.url)}
                                aria-label="Enlarge question image"
                              >
                                <img
                                  src={image.url}
                                  alt={image.caption || image.name}
                                  className="max-h-[420px] w-full object-contain"
                                />
                              </button>
                            </div>
                            {(image.caption || image.name) && (
                              <figcaption className="border-t px-3 py-2 text-center text-sm leading-6 text-muted-foreground">
                                {image.caption || image.name}
                              </figcaption>
                            )}
                          </figure>
                        ))}
                      </div>
                    </section>
                  )}
                  <div className="q-test-choices mt-7 space-y-3">
                    {question.options.map((option, index) => {
                      const isSelected = selected === index;
                      const isCorrect = revealed && question.answer === index;
                      const isWrong =
                        revealed && isSelected && index !== question.answer;
                      const count = answerSummary.counts.get(index) ?? 0;
                      const percent = answerSummary.total
                        ? Math.round((count / answerSummary.total) * 100)
                        : 0;
                      return (
                        <QuestionOption
                          key={index}
                          text={option}
                          index={index}
                          selected={isSelected}
                          correct={isCorrect}
                          wrong={isWrong}
                          revealed={revealed}
                          percent={percent}
                          onSelect={() => selectAnswer(index)}
                        />
                      );
                    })}
                  </div>
                  {test.mode === 'tutor' && !revealed && (
                    <div className="mt-6 flex justify-end">
                      <PrimaryButton
                        tone="study"
                        onClick={gradeCurrent}
                        disabled={selected === undefined}
                      >
                        Submit answer
                      </PrimaryButton>
                    </div>
                  )}
                  {revealed && (
                    <>
                      <div
                        className={cx(
                          'mt-6 rounded-xl border p-4 text-sm font-semibold',
                          selected === question.answer
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'
                            : 'border-red-200 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200',
                        )}
                      >
                        {selected === question.answer
                          ? 'Correct answer.'
                          : `The keyed answer is ${question.answerLetter}.`}{' '}
                        <span className="font-normal opacity-75">
                          {answerSummary.total} learner
                          {answerSummary.total === 1 ? '' : 's'} in response
                          data · Revision {question.revision}
                        </span>
                      </div>
                    </>
                  )}
                </article>
              </TestQuestionPanel>
              {revealed && displayedExplanation && !handheld && (
                <>
                  <ResizableHandle withHandle className="mx-4 bg-transparent" />
                  <ResizablePanel
                    id="explanation-panel"
                    defaultSize="32%"
                    minSize="22%"
                    maxSize="58%"
                  >
                    <aside
                      className="h-full rounded-2xl border border-primary/15 bg-white p-5 shadow-sm dark:bg-card sm:p-6"
                      aria-label="Question explanation"
                    >
                      <div className="flex items-center justify-between gap-3 border-b pb-4">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
                            Explanation
                          </p>
                          <h3 className="mt-1 font-bold">
                            Why this answer is correct
                          </h3>
                        </div>
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
                          READ ONLY
                        </span>
                      </div>
                      <p
                        dir="auto"
                        data-highlight-section="explanation"
                        data-highlight-question={question.id}
                        onPointerUp={(event) =>
                          copySelectionAndMark(
                            'explanation',
                            event.currentTarget,
                          )
                        }
                        className="mt-5 select-text whitespace-pre-wrap text-sm leading-7 text-foreground touch-pan-y"
                      >
                        <HighlightedText
                          text={displayedExplanation}
                          ranges={sectionHighlights('explanation')}
                          onRemove={(range) =>
                            removeHighlight('explanation', range)
                          }
                        />
                      </p>
                      <SharedNoteImages images={explanationImages} onZoom={setZoomImage} />
                      <SecondaryButton className="mt-4" onClick={openSharedNoteEditor}>
                        <ImagePlus className="size-4" />Add explanation images
                      </SecondaryButton>
                      {(question.sourceReference || question.sourceFile) && (
                        <p className="mt-5 border-t pt-4 text-xs leading-6 text-muted-foreground">
                          <strong className="text-foreground">Source:</strong>{' '}
                          {readQuestionSource(question).sourceReference}
                        </p>
                      )}
                    </aside>
                  </ResizablePanel>
                </>
              )}
            </TestPanels>
            <div className="q-test-actions mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
              <SecondaryButton
                onClick={() => move(test.currentIndex - 1)}
                disabled={test.currentIndex === 0}
              >
                <ChevronLeft className="size-4" />
                Previous
              </SecondaryButton>
              <div className="q-test-secondary-actions flex min-w-0 flex-wrap justify-center gap-2">
                {handheld && revealed && displayedExplanation && (
                  <SecondaryButton className="q-test-explanation-action" onClick={() => setExplanationOpen(true)}>
                    Explanation
                  </SecondaryButton>
                )}
                <SecondaryButton className="q-test-edit-action" onClick={openReport}>
                  <CircleAlert className="size-4" />
                  {user.role === 'super_admin' ? 'Edit question' : 'Suggest edit'}
                </SecondaryButton>
                <PrimaryButton onClick={() => setNotesOpen(!notesOpen)}>
                  <FileText className="size-4" />
                  Shared notes{' '}
                  {sharedNote?.content || sharedNote?.images.length ? '•' : ''}
                </PrimaryButton>
              </div>
              <SecondaryButton
                onClick={() => move(test.currentIndex + 1)}
                disabled={test.currentIndex === test.questionIds.length - 1}
              >
                Next
                <ChevronRight className="size-4" />
              </SecondaryButton>
            </div>
            {notesOpen && (
              <NotesSurface
                handheld={handheld}
                onClose={() => setNotesOpen(false)}
              >
                <section
                  className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-border dark:bg-card"
                  onPaste={(event) => {
                    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
                    if (files.length) {
                      event.preventDefault();
                      void attachImages(files);
                    }
                  }}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes('Files')) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    if (!event.dataTransfer.files.length) return;
                    event.preventDefault();
                    void attachImages(Array.from(event.dataTransfer.files));
                  }}
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <h3 className="font-bold">Shared explanation & notes</h3>
                      <p className="text-xs text-muted-foreground">
                        Everyone can improve this note. Every saved version is
                        attributed.
                      </p>
                    </div>
                    {sharedNote && (
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200">
                        EDITED BY {sharedNote.updatedByName.toUpperCase()} ·{' '}
                        {formatDate(sharedNote.updatedAt)}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-1 border-b pb-2">
                    <IconButton
                      label="Bold"
                      onClick={() => insertNoteToken('**')}
                    >
                      <Bold className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Italic"
                      onClick={() => insertNoteToken('_')}
                    >
                      <Italic className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Bullet list"
                      onClick={() => insertNoteToken('\n• ', '')}
                    >
                      <List className="size-4" />
                    </IconButton>
                    <label className={cx('ml-auto flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold', uploading ? 'cursor-wait opacity-50' : 'cursor-pointer text-primary hover:bg-primary/5')}>
                      <ImagePlus className="size-4" />
                      <span>Add images</span>
                      <input
                        aria-label="Add note images"
                        type="file"
                        accept={NOTE_IMAGE_ACCEPT}
                        multiple
                        disabled={uploading}
                        className="sr-only"
                        onChange={(event) => {
                          void attachImages(Array.from(event.target.files ?? []));
                          event.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">Choose, paste, or drop up to 5 images at a time · JPEG, PNG, WebP, GIF · 10 MB each. Save the shared note to publish images in the explanation.</p>
                  <textarea
                    id="question-note"
                    dir="auto"
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder="Write or improve the shared explanation…"
                    className="mt-3 min-h-40 w-full resize-y rounded-xl border bg-muted/20 p-4 text-sm leading-7 outline-none focus:border-primary focus:ring-3 focus:ring-primary/10"
                  />
                  {uploading && (
                    <output className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <RefreshCw className="size-3 animate-spin" />
                      Uploading images…
                    </output>
                  )}
                  {noteUploadError && <p role="alert" className="mt-3 whitespace-pre-wrap rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{noteUploadError}</p>}
                  {noteImagesDraft.length > 0 && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {noteImagesDraft.map((image) => (
                        <div
                          key={image.id}
                          className="overflow-hidden rounded-xl border"
                        >
                          <div className="relative bg-muted">
                            <button type="button" onClick={() => setZoomImage(image.url)} aria-label={`Enlarge image: ${image.caption || image.name}`} className="block w-full cursor-zoom-in">
                              <img src={image.url} alt={image.caption || image.name} className="h-40 w-full object-contain" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Remove image ${image.name}`}
                              onClick={() => removeImage(image.id)}
                              className="absolute right-2 top-2 grid size-8 place-items-center rounded-lg bg-white/90 text-red-600 shadow dark:bg-slate-950/85 dark:text-red-300"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                          <input
                            aria-label={`Caption for ${image.name}`}
                            value={image.caption}
                            onChange={(event) =>
                              updateCaption(image.id, event.target.value)
                            }
                            placeholder="Add a caption"
                            className="h-10 w-full border-t bg-card px-3 text-xs text-foreground outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      Saving adds your name and timestamp to version history.
                    </span>
                    <PrimaryButton tone="study" onClick={saveNote} disabled={uploading}>
                      <Save className="size-4" />
                      Save shared note
                    </PrimaryButton>
                  </div>
                  {sharedNote?.history.length ? (
                    <details className="mt-4 rounded-xl border bg-muted/20 p-3">
                      <summary className="cursor-pointer text-xs font-bold">
                        Version history · {sharedNote.history.length}
                      </summary>
                      <div className="mt-3 space-y-2">
                        {[...sharedNote.history]
                          .reverse()
                          .slice(0, 10)
                          .map((revision, index) => (
                            <div
                              key={revision.id}
                              className="flex items-center justify-between gap-3 rounded-lg bg-white p-2 text-xs dark:bg-card"
                            >
                              <span>
                                <strong>
                                  v{sharedNote.history.length - index}
                                </strong>{' '}
                                · {revision.editedByName}
                              </span>
                              <time className="text-muted-foreground">
                                {formatDate(revision.editedAt)}
                              </time>
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
      {test.timerPaused && test.status === 'active' && (
        <dialog
          open
          className="q-safe-overlay fixed inset-0 z-[90] m-0 grid size-full max-h-none max-w-none place-items-center border-0 bg-background/45 p-6 text-foreground backdrop-blur-xl"
          aria-labelledby="paused-test-title"
        >
          <section className="w-full max-w-sm rounded-3xl bg-card/95 p-7 text-center shadow-2xl ring-1 ring-border">
            <button
              onClick={resumeTest}
              className="mx-auto grid size-20 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_14px_36px_rgba(8,107,196,.32)] transition hover:scale-105"
              aria-label="Continue test and resume timer"
            >
              <Play className="ml-1 size-9 fill-current" />
            </button>
            <h2 id="paused-test-title" className="mt-6 text-2xl font-bold">
              Continue
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The timer is paused at {formatDuration(seconds)}. Your answers are
              saved.
            </p>
          </section>
        </dialog>
      )}
      {finishConfirmOpen && (
        <div
          className="q-safe-overlay fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget)
              setFinishConfirmOpen(false);
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="end-test-title"
            aria-describedby="end-test-description"
            className="q-confirm-dialog w-full max-w-md overflow-hidden rounded-[24px] bg-card shadow-[0_28px_90px_rgba(2,12,27,.35)] ring-1 ring-white/10"
          >
            <div className="border-b bg-gradient-to-br from-primary/10 via-card to-card p-6">
              <div className="flex items-start gap-4">
                <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(8,107,196,.25)]">
                  <Flag className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                    Test checkpoint
                  </p>
                  <h2 id="end-test-title" className="mt-1 text-xl font-bold">
                    Finish this test?
                  </h2>
                  <p
                    id="end-test-description"
                    className="mt-2 text-sm leading-6 text-muted-foreground"
                  >
                    All questions are answered. Your answers will be graded and
                    the completed test will be saved in Test history.
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-3 divide-x rounded-2xl bg-muted/60 py-4 text-center">
                <div>
                  <strong className="block text-lg text-foreground">
                    {answeredCount}
                  </strong>
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    Answered
                  </span>
                </div>
                <div>
                  <strong className="block text-lg text-foreground">
                    {test.questionIds.length - answeredCount}
                  </strong>
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    Unanswered
                  </span>
                </div>
                <div>
                  <strong className="block text-lg text-foreground">
                    {formatDuration(seconds)}
                  </strong>
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    Elapsed
                  </span>
                </div>
              </div>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <SecondaryButton
                  onClick={() => setFinishConfirmOpen(false)}
                  className="h-11 w-full"
                >
                  Keep studying
                </SecondaryButton>
                <PrimaryButton
                  tone="study"
                  onClick={completeTest}
                  className="w-full"
                >
                  <CheckCircle2 className="size-4" />
                  Finish
                </PrimaryButton>
              </div>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Press Esc or click outside to continue the test.
              </p>
            </div>
          </section>
        </div>
      )}
      <QuestionNavigator
        open={navigatorOpen}
        title={test.title}
        currentIndex={test.currentIndex}
        items={activeQuestions.map((item) => {
          const itemProgress = getQuestionProgress(state, item.id);
          const answer = test.answers[item.id];
          const graded = test.graded.includes(item.id);
          return {
            id: item.id,
            preview: item.stem,
            answered: answer !== undefined,
            flagged: itemProgress.flagged,
            bookmarked: itemProgress.bookmarked,
            revealed: test.revealed.includes(item.id),
            result: graded
              ? answer === item.answer
                ? ('correct' as const)
                : ('incorrect' as const)
              : undefined,
          };
        })}
        onSelect={move}
        onClose={() => setNavigatorOpen(false)}
        secondaryAction={{
          label: 'Close',
          icon: <X className="size-4" />,
          onClick: () => setNavigatorOpen(false),
        }}
        primaryAction={{
          label: allQuestionsAnswered ? 'Finish' : 'Continue later',
          icon: allQuestionsAnswered ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <Save className="size-4" />
          ),
          onClick: () => {
            setNavigatorOpen(false);
            finishTest();
          },
        }}
      />
      {reportOpen && (
        <QuestionEditDialog
          uid={user.uid} qbankId={qbankId} questionId={question.id}
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          questionNumber={question.number}
          immediate={user.role === 'super_admin'}
          busy={reportBusy}
          error={reportError}
          onSubmit={submitReport}
          draft={{ stem: proposedStem, options: proposedOptions, answer: suggestedAnswer, explanation: proposedExplanation, explanationImages: proposedExplanationImages, sourceFile: proposedSource, sourcePage: proposedSourcePage, rationale: reportMessage, kinds: editKinds }}
          onChange={changes => {
            if (changes.stem !== undefined) setProposedStem(changes.stem);
            if (changes.options !== undefined) setProposedOptions(changes.options);
            if ('answer' in changes) setSuggestedAnswer(changes.answer);
            if (changes.explanation !== undefined) setProposedExplanation(changes.explanation);
            if (changes.explanationImages !== undefined) { setProposedExplanationImages(changes.explanationImages); setEditKinds(current => [...new Set([...current, 'explanation' as const])]); }
            if (changes.sourceFile !== undefined) setProposedSource(changes.sourceFile);
            if (changes.sourcePage !== undefined) setProposedSourcePage(changes.sourcePage);
            if (changes.rationale !== undefined) setReportMessage(changes.rationale);
            if (changes.kinds !== undefined) setEditKinds(changes.kinds);
          }}
        />
      )}
    </main>
  );
}

function HistoryView({
  state,
  questions,
  onOpen,
  onDelete,
}: {
  state: AppState;
  questions: Question[];
  onOpen: (test: TestSession) => void;
  onDelete: (id: string) => void;
}) {
  const [deleteId, setDeleteId] = useState<string>();
  const [search, setSearch] = useState('');
  const [historyNow, setHistoryNow] = useState(() => new Date());
  useEffect(() => {
    const refreshDate = () => setHistoryNow(new Date());
    // A returning tab re-evaluates calendar boundaries without any server work.
    window.addEventListener('focus', refreshDate);
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    const timer = window.setTimeout(refreshDate, tomorrow.getTime() - Date.now());
    return () => {
      window.removeEventListener('focus', refreshDate);
      window.clearTimeout(timer);
    };
  }, [historyNow]);
  const tests = useMemo(() => sortHistoryTests(state.tests), [state.tests]);
  const groups = useMemo(() => groupHistoryTests(tests, historyNow), [tests, historyNow]);
  const matchingTests = useMemo(() => filterHistoryTests(tests, search), [tests, search]);
  const searching = search.trim().length > 0;
  const questionsById = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions],
  );
  const renderTest = (test: TestSession) => {
    const isCompleted = test.status === 'completed';
    const answered = Object.keys(test.answers).length;
    const correct = test.questionIds.filter((id) => {
      const question = questionsById.get(id);
      return question && test.answers[id] === question.answer;
    }).length;
    const score = answered
      ? Math.round((correct / answered) * 100)
      : 0;
    return (
      <article
        key={test.id}
        className="flex flex-col gap-4 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border sm:flex-row sm:items-center"
      >
        <div
          className={cx(
            'grid size-12 shrink-0 place-items-center rounded-2xl',
            !isCompleted
              ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-200'
              : score >= 70
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200'
                : 'bg-blue-50 text-blue-700 dark:bg-blue-500/12 dark:text-blue-200',
          )}
        >
          <FileText className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">{test.title}</h3>
            <span
              className={cx(
                'rounded-full px-2 py-0.5 text-xs font-bold uppercase',
                !isCompleted
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-200'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200',
              )}
            >
              {isCompleted ? 'Completed' : 'Not completed'}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {Number.isFinite(Date.parse(test.startedAt)) ? formatDate(test.startedAt) : 'Date unavailable'} · {test.mode} · {answered}/
            {test.questionIds.length} answered
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <div className="text-right">
            <strong className="block text-xl">
              {!isCompleted
                ? `${test.currentIndex + 1}/${test.questionIds.length}`
                : `${score}%`}
            </strong>
            <span className="text-xs text-muted-foreground">
              {!isCompleted ? 'position' : 'score'}
            </span>
          </div>
          <SecondaryButton onClick={() => onOpen(test)}>
            {!isCompleted ? 'Resume' : 'Review'}
            <ArrowRight className="size-4" />
          </SecondaryButton>
          <IconButton
            label={`Delete ${test.title}`}
            onClick={() => setDeleteId(test.id)}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </article>
    );

  };
  const renderMonth = (month: HistoryMonth<TestSession>) => (
    <details key={month.key} className="q-history-stack">
      <summary className="q-history-stack-summary">
        <span className="q-history-stack-icon"><CalendarDays className="size-5" /></span>
        <strong className="min-w-0 flex-1">{month.label}</strong>
        <span className="q-history-stack-count">{month.tests.length} test{month.tests.length === 1 ? '' : 's'}</span>
        <ChevronDown className="q-history-stack-chevron size-4 shrink-0" />
      </summary>
      <div className="q-history-stack-body">{month.tests.map(renderTest)}</div>
    </details>
  );
  const selectedTest = tests.find((test) => test.id === deleteId);
  return (
    <>
      <PageHeader
        title="Previous tests"
        subtitle={`${tests.length} saved test${tests.length === 1 ? '' : 's'}`}
        openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))}
      />
      <div className="mx-auto max-w-5xl p-4 sm:p-7">
        <search className="q-history-search mb-5">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="history-search" className="sr-only">Search previous tests by name, mode, status or date</label>
          <input id="history-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tests by name, mode or date…" aria-controls="history-results" autoComplete="off" />
          <output className="q-history-search-count" aria-live="polite">{searching ? `${matchingTests.length} of ${tests.length}` : `${tests.length} test${tests.length === 1 ? '' : 's'}`}</output>
          {search && <button type="button" onClick={() => setSearch('')} className="q-history-search-clear" aria-label="Clear test search" title="Clear search"><X className="size-4" /></button>}
        </search>
        <div id="history-results">
          {tests.length === 0 ? (
            <div className="grid min-h-[55vh] place-items-center rounded-2xl border border-dashed bg-card/60">
              <div className="max-w-sm text-center">
                <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <BookOpenCheck className="size-6" />
                </div>
                <h2 className="mt-4 font-bold">No tests yet</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Create your first test to start building a review history.
                </p>
              </div>
            </div>
          ) : matchingTests.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-card/60 px-6 py-12 text-center">
              <Search className="mx-auto size-6 text-muted-foreground" />
              <h2 className="mt-3 font-bold">No matching tests</h2>
              <p className="mt-2 text-sm text-muted-foreground">Try another name, mode or date.</p>
              <button type="button" className="mt-4 text-sm font-semibold text-primary underline underline-offset-4" onClick={() => setSearch('')}>Clear search</button>
            </div>
          ) : (
            <div className="space-y-3">
              {searching ? (
                matchingTests.map(renderTest)
              ) : (
                <>
                  {groups.recent.length > 0 && (
                    <section className="space-y-3" aria-labelledby="history-recent-title">
                      <h2 id="history-recent-title" className="q-history-section-title">Last month <span>{groups.recent.length}</span></h2>
                      {groups.recent.map(renderTest)}
                    </section>
                  )}
                  {groups.months.map(renderMonth)}
                  {groups.years.map((year) => (
                    <details key={year.key} className="q-history-stack q-history-year">
                      <summary className="q-history-stack-summary">
                        <span className="q-history-stack-icon"><Layers3 className="size-5" /></span>
                        <span className="min-w-0 flex-1"><strong>{year.label}</strong><small>{year.months.length} month{year.months.length === 1 ? '' : 's'}</small></span>
                        <span className="q-history-stack-count">{year.count} test{year.count === 1 ? '' : 's'}</span>
                        <ChevronDown className="q-history-stack-chevron size-4 shrink-0" />
                      </summary>
                      <div className="q-history-stack-body">{year.months.map(renderMonth)}</div>
                    </details>
                  ))}
                  {groups.undated.length > 0 && (
                    <section className="space-y-3" aria-labelledby="history-undated-title">
                      <h2 id="history-undated-title" className="q-history-section-title">Date unavailable</h2>
                      {groups.undated.map(renderTest)}
                    </section>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {selectedTest && (
        <div className="q-safe-overlay fixed inset-0 z-[70] grid place-items-center bg-slate-950/60 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-test-title"
            className="q-confirm-dialog w-full max-w-md rounded-2xl bg-card p-5 shadow-2xl sm:p-6"
          >
            <h2 id="delete-test-title" className="text-xl font-bold">
              Delete this test?
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              <strong>{selectedTest.title}</strong> will be removed from your
              history. Your accumulated question progress will remain unchanged.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => setDeleteId(undefined)}
                className="h-11 rounded-xl border text-sm font-bold"
              >
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

function ProgressView({
  state,
  questions,
  specialties,
  topics,
  maxQuestions,
  onStudy,
}: {
  state: AppState;
  questions: Question[];
  specialties: QBankSpecialty[];
  topics: QBankTopic[];
  maxQuestions: number;
  onStudy: (config: TestBuilderConfig) => Promise<void>;
}) {
  const { mode: presentationMode } = usePresentationEnvironment();
  const summary = useMemo(() => summarizeProgress(state.progress, questions, specialties, topics), [questions, specialties, topics, state.progress]);
  const improvementSection = <AreasToImprove topics={summary.areasToImprove} completed={summary.completed} maxQuestions={maxQuestions} onStudy={onStudy} />;
  const completion = questions.length
    ? Math.round((summary.completed / questions.length) * 100)
    : 0;
  const accuracy = summary.completed
    ? Math.round((summary.correct / summary.completed) * 100)
    : 0;
  if (presentationMode === 'handheld') {
    return (
      <>
        <PageHeader
          title="Progress"
          subtitle="Your QBank performance"
          openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))}
        />
        <div className="q-mobile-progress">
          <section className="q-mobile-progress-hero">
            <div
              className="q-mobile-progress-ring"
              style={{
                background: `conic-gradient(var(--study) ${completion}%, var(--muted) 0)`,
              }}
              aria-label={`${completion}% of this QBank completed`}
            >
              <div>
                <strong>{completion}%</strong>
                <span>complete</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <span className="q-eyebrow">QBank overview</span>
              <h2>
                {summary.completed} of {questions.length} completed
              </h2>
              <p>{accuracy}% accuracy across answered questions.</p>
            </div>
          </section>
          <div className="q-mobile-progress-signals">
            <article>
              <CircleAlert className="size-5 text-red-500" />
              <strong>{summary.incorrect}</strong>
              <span>Incorrect</span>
            </article>
            <article>
              <Flag className="size-5 text-amber-500" />
              <strong>{summary.flagged}</strong>
              <span>Flagged</span>
            </article>
            <article>
              <CheckCircle2 className="size-5 text-emerald-500" />
              <strong>{summary.correct}</strong>
              <span>Correct</span>
            </article>
          </div>
          {improvementSection}
          <section className="q-mobile-progress-topics">
            <div className="mobile-section-heading">
              <div>
                <span className="q-eyebrow">Breakdown</span>
                <h2>Specialties & topics</h2>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              {summary.categories.map((category) => {
                const categoryCompletion = category.total
                  ? Math.round((category.completed / category.total) * 100)
                  : 0;
                return (
                  <details
                    key={category.id}
                    className="group rounded-2xl border bg-card"
                  >
                    <summary className="list-none p-4">
                      <div className="flex items-center justify-between gap-3">
                        <strong>{category.category}</strong>
                        <span className="text-xs text-muted-foreground">
                          {category.accuracy}% accuracy{' '}
                          <ChevronRight className="ml-1 inline size-4 transition group-open:rotate-90" />
                        </span>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${categoryCompletion}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {category.completed}/{category.total} questions ·{' '}
                        {categoryCompletion}% complete
                      </p>
                    </summary>
                    <div className="space-y-2 border-t p-3">
                      {category.topics.map((topic) => (
                        <div
                          key={topic.id}
                          className="rounded-xl bg-muted/35 p-3"
                        >
                          <div className="flex items-start justify-between gap-3 text-sm">
                            <strong>{topic.topic}</strong>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {topic.accuracy}%
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {topic.completed}/{topic.total} completed
                          </p>
                        </div>
                      ))}
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
  return (
    <>
      <PageHeader
        title="Progress"
        subtitle="A clear view of your QBank performance"
        openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))}
      />
      <div className="mx-auto max-w-6xl p-4 sm:p-7">
        <div className="q-progress-stats grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Completed"
            value={summary.completed}
            detail={`${completion}% of the bank`}
          />
          <StatCard
            label="Correct"
            value={summary.correct}
            detail={`${accuracy}% accuracy`}
            color="green"
          />
          <StatCard
            label="Incorrect"
            value={summary.incorrect}
            detail="Ready for review"
            color="red"
          />
          <StatCard
            label="Flagged"
            value={summary.flagged}
            detail="Saved questions"
            color="amber"
          />
        </div>
        {improvementSection}
        <section className="mt-6 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border sm:p-6">
          <div>
            <h2 className="font-bold">Progress by Specialty & Topic</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open a QBank specialty to see progress for its topics.
            </p>
          </div>
          <div className="mt-5 space-y-2">
            {summary.categories.map((category) => {
              const categoryCompletion = category.total
                ? Math.round((category.completed / category.total) * 100)
                : 0;
              return (
                <details
                  key={category.id}
                  className="group rounded-xl border bg-background/40"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-sm">
                    <span>
                      <strong>{category.category}</strong>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {categoryCompletion}% complete
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {category.completed}/{category.total} ·{' '}
                      {category.accuracy}% accuracy{' '}
                      <ChevronRight className="ml-2 inline size-4 transition group-open:rotate-90" />
                    </span>
                  </summary>
                  <div className="space-y-3 border-t p-4">
                    {category.topics.map((topic) => {
                      const topicCompletion = topic.total
                        ? Math.round((topic.completed / topic.total) * 100)
                        : 0;
                      return (
                        <details
                          key={topic.id}
                          className="rounded-xl bg-muted/35 p-3"
                        >
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                            <strong>{topic.topic}</strong>
                            <span className="text-xs text-muted-foreground">
                              {topic.completed}/{topic.total} · {topic.accuracy}
                              % accuracy
                            </span>
                          </summary>
                          <div className="mt-3">
                            <div className="mb-1 flex justify-between text-xs">
                              <span>Completion</span>
                              <strong>{topicCompletion}%</strong>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-background">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${topicCompletion}%` }}
                              />
                            </div>
                          </div>
                        </details>
                      );
                    })}
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

function RoleRequestPanel({
  user,
  collaboration,
  updateCollaboration,
}: {
  user: AppUser;
  collaboration: CollaborationState;
  updateCollaboration: (
    updater: (current: CollaborationState) => CollaborationState,
  ) => void;
}) {
  const [roleReason, setRoleReason] = useState('');
  const [requestedRole, setRequestedRole] = useState<PlatformRole>('reviewer');
  const pendingRole = collaboration.roleApplications.find(
    (item) =>
      item.userId === user.uid &&
      item.status === 'pending' &&
      isPlatformRole(item.requestedRole),
  );

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

  if (hasModeratorRole(user)) return null;
  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
      <h2 className="font-bold">Request an additional role</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A Moderator reviews every Moderator, Reviewer, and Access Manager
        request.
      </p>
      {pendingRole ? (
        <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          Your <strong>{pendingRole.requestedRole.replaceAll('_', ' ')}</strong>{' '}
          request is waiting for review.
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr_auto]">
          <select
            value={requestedRole}
            onChange={(event) =>
              setRequestedRole(event.target.value as typeof requestedRole)
            }
            className="h-11 rounded-xl border bg-card px-3 text-sm"
          >
            <option value="moderator">Moderator</option>
            <option value="reviewer">Public QBank reviewer</option>
            <option value="access_manager">Access Manager</option>
          </select>
          <input
            value={roleReason}
            onChange={(event) => setRoleReason(event.target.value)}
            className="h-11 rounded-xl border bg-card px-3 text-sm"
            placeholder="Why do you need this role?"
          />
          <button
            onClick={applyForRole}
            disabled={!roleReason.trim()}
            className="h-11 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground disabled:opacity-40"
          >
            Submit request
          </button>
        </div>
      )}
    </section>
  );
}

function SettingsView({
  state,
  theme,
  onThemeChange,
  onSaveDailyGoal,
  syncStatus,
  syncIssue,
  onSync,
  onAccountDeleted,
  collaboration,
  user,
  updateCollaboration,
}: {
  state: AppState;
  theme: LocalTheme;
  onThemeChange: (theme: LocalTheme) => void;
  onSaveDailyGoal: (dailyGoal: number) => Promise<void>;
  syncStatus: SyncStatus;
  syncIssue: string;
  onSync: () => void;
  onAccountDeleted: () => void;
  collaboration: CollaborationState;
  user: AppUser;
  updateCollaboration: (
    updater: (current: CollaborationState) => CollaborationState,
  ) => void;
}) {
  const [legalLinks, setLegalLinks] = useState(DEFAULT_LEGAL_LINKS);
  const [communityLinks, setCommunityLinks] = useState(DEFAULT_COMMUNITY_LINKS);
  const [personalBackupBusy, setPersonalBackupBusy] = useState(false);
  const [personalBackupMessage, setPersonalBackupMessage] = useState('');
  const [dailyGoalOverride, setDailyGoalDraft] = useState<number>();
  const dailyGoalDraft = dailyGoalOverride ?? state.settings.dailyGoal;
  const dataSize = useMemo(() => stateBytes(state), [state]);
  const [dailyGoalBusy, setDailyGoalBusy] = useState(false);
  const [dailyGoalMessage, setDailyGoalMessage] = useState('');
  const [draftDownloadError, setDraftDownloadError] = useState('');
  useEffect(() => {
    let active = true;
    void api<LegalLinks>('/platform/legal-links')
      .then((links) => {
        if (active) setLegalLinks({ ...DEFAULT_LEGAL_LINKS, ...links });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const backupAvailable =
    hasFeature(user.effectivePlan ?? user.tier, 'flashcards', user.planLimits) ||
    hasFeature(user.effectivePlan ?? user.tier, 'createPrivateQBank', user.planLimits);
  useEffect(() => {
    let active = true;
    const refresh = () => { void api<typeof communityLinks>('/platform/community-links').then(links => { if (active) setCommunityLinks(links); }).catch(() => undefined); };
    refresh();
    const stop = subscribeLive(refresh, ['community-links']);
    return () => { active = false; stop(); };
  }, []);
  const downloadPersonalBackup = async () => {
    setPersonalBackupBusy(true);
    setPersonalBackupMessage('');
    try {
      const backup = await api<Record<string, unknown>>(
        '/platform/personal-backup',
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: 'application/json',
        }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `qraft-personal-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setPersonalBackupMessage('Your personal backup was downloaded.');
    } catch (error) {
      setPersonalBackupMessage(
        error instanceof Error ? error.message : 'Unable to create backup.',
      );
    } finally {
      setPersonalBackupBusy(false);
    }
  };
  const restorePersonalBackup = async (file?: File) => {
    if (!file) return;
    setPersonalBackupBusy(true);
    setPersonalBackupMessage('');
    try {
      const raw = await file.text();
      if (raw.length > 50_000_000)
        throw new Error('Backup exceeds the 50 MB restore limit.');
      await api('/platform/personal-backup', { method: 'PUT', body: raw });
      setPersonalBackupMessage('Backup restored. Refreshing your workspace…');
      window.location.reload();
    } catch (error) {
      setPersonalBackupMessage(
        error instanceof Error ? error.message : 'Unable to restore backup.',
      );
      setPersonalBackupBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Study preferences, sync, and account policies"
        openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))}
      />
      <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-7">
        <TelegramChannelButton href={communityLinks.telegramUrl} />
        {dataSize >= STATE_WARNING_BYTES && (
          <output className="block rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            {dataSize > STATE_BUDGET_BYTES ? 'Cloud sync capacity reached.' : 'Your study data is approaching the current cloud sync capacity.'}
            {' '}Your work remains on this device. Download a local copy before removing old study data.
            <button className="ml-2 underline" onClick={() => {
              const url = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' }));
              const anchor = document.createElement('a'); anchor.href = url;
              anchor.download = `qraft-local-study-${new Date().toISOString().slice(0, 10)}.json`;
              anchor.click(); URL.revokeObjectURL(url);
            }}>Download local study data</button>
          </output>
        )}
        <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-bold">Cloud sync</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Changes stay on this device while you work, then synchronize at
                save and exit checkpoints or when you choose Sync now.
                {' '}Sync now also retries preserved contribution deletions.
              </p>
            </div>
            <PrimaryButton onClick={onSync} disabled={syncStatus === 'syncing'}>
              <RefreshCw
                className={cx(
                  'size-4',
                  syncStatus === 'syncing' && 'animate-spin',
                )}
              />
              Sync now
            </PrimaryButton>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200">
            {syncStatus === 'offline' ? (
              <CloudOff className="size-4" />
            ) : (
              <Cloud className="size-4" />
            )}
            {
              {
                syncing: 'Synchronizing saved changes…',
                synced: syncIssue ? 'Some changes still need attention; see details below.' : 'All saved changes are synchronized.',
                local: 'Saved on this device and waiting to synchronize.',
                offline:
                  'Saved on this device. Synchronization will resume online.',
                error: 'Saved locally. Cloud synchronization needs attention.',
              }[syncStatus]
            }
            {state.lastSyncAt
              ? ` · Last manual sync ${new Date(state.lastSyncAt).toLocaleString()}`
              : ''}
          </div>
          {syncIssue && <p role="alert" className="mt-3 text-sm text-destructive">{syncIssue}</p>}
          <button type="button" className="mt-3 text-sm underline" onClick={() => {
            setDraftDownloadError('');
            void loadRejectedCollaboration(user.uid).then(drafts => {
              const url = URL.createObjectURL(new Blob([JSON.stringify(drafts, null, 2)], { type: 'application/json' }));
              const link = document.createElement('a'); link.href = url; link.download = 'qraft-unsynchronized-drafts.json'; link.click(); URL.revokeObjectURL(url);
            }).catch(() => setDraftDownloadError('Unable to download the preserved drafts. Retry on this device.'));
          }}>Download a copy of changes needing review</button>
          {draftDownloadError && <p role="alert" className="mt-2 text-sm text-destructive">{draftDownloadError}</p>}
        </section>
        <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
          <h2 className="font-bold">Appearance</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Light, dark, or follow your device.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {(['light', 'dark', 'system'] as const).map((option) => (
              <button
                key={option}
                onClick={() => onThemeChange(option)}
                className={cx(
                  'flex h-11 items-center justify-center gap-2 rounded-xl border text-xs font-bold capitalize',
                  theme === option &&
                    'border-primary bg-primary text-primary-foreground',
                )}
              >
                {option === 'light' ? (
                  <Sun className="size-4" />
                ) : option === 'dark' ? (
                  <Moon className="size-4" />
                ) : (
                  <Settings className="size-4" />
                )}
                {option}
              </button>
            ))}
          </div>
        </section>
        <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
          <h2 className="font-bold">Daily study goal</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Used by the quick-start button on your dashboard.
          </p>
          <div className="mt-5 flex items-center gap-4">
            <input
              type="range"
              aria-label="Daily study goal"
              min="5"
              max="100"
              step="5"
              value={dailyGoalDraft}
              onChange={(event) => {
                setDailyGoalDraft(Number(event.target.value));
                setDailyGoalMessage('');
              }}
              className="flex-1 accent-primary"
            />
            <strong className="min-w-20 rounded-xl bg-primary/10 px-3 py-2 text-center text-primary">
              {dailyGoalDraft}
            </strong>
            <PrimaryButton
              disabled={
                dailyGoalBusy || dailyGoalDraft === state.settings.dailyGoal
              }
              onClick={() => {
                setDailyGoalBusy(true);
                setDailyGoalMessage('');
                void onSaveDailyGoal(dailyGoalDraft)
                  .then(() => {
                    setDailyGoalDraft(undefined);
                    setDailyGoalMessage('Daily goal saved.');
                  })
                  .catch((error) =>
                    setDailyGoalMessage(
                      error instanceof Error
                        ? error.message
                        : 'Unable to save your daily goal.',
                    ),
                  )
                  .finally(() => setDailyGoalBusy(false));
              }}
            >
              <Save className="size-4" />
              {dailyGoalBusy ? 'Saving…' : 'Save'}
            </PrimaryButton>
          </div>
          {dailyGoalMessage && (
            <output className="mt-3 block text-xs font-semibold text-muted-foreground">
              {dailyGoalMessage}
            </output>
          )}
        </section>
        <RoleRequestPanel
          user={user}
          collaboration={collaboration}
          updateCollaboration={updateCollaboration}
        />
        {backupAvailable && (
          <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
            <h2 className="font-bold">Your personal backup</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Download your Flashcards and the private QBanks you own. A private
              QBank backup can only be restored by the same account and always
              remains private.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <PrimaryButton
                onClick={() => void downloadPersonalBackup()}
                disabled={personalBackupBusy}
              >
                <Download className="size-4" />
                Download my backup
              </PrimaryButton>
              <label className="q-button q-button-secondary cursor-pointer">
                <Upload className="size-4" />
                Restore my backup
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={personalBackupBusy}
                  className="sr-only"
                  onChange={(event) => {
                    void restorePersonalBackup(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </label>
            </div>
            {personalBackupMessage && (
              <output className="mt-3 block text-sm text-muted-foreground">
                {personalBackupMessage}
              </output>
            )}
          </section>
        )}
        <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
          <h2 className="font-bold">Legal and privacy</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Review the policies that govern your use of Qraft and your data.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <a
              href={legalLinks.termsUrl || undefined}
              target={legalLinks.termsUrl ? '_blank' : undefined}
              rel={legalLinks.termsUrl ? 'noreferrer' : undefined}
              aria-disabled={!legalLinks.termsUrl}
              className={cx(
                'flex min-h-12 items-center gap-3 rounded-xl border px-4 text-sm font-bold transition hover:border-primary/40 hover:bg-primary/5',
                !legalLinks.termsUrl && 'pointer-events-none opacity-50',
              )}
            >
              <FileText className="size-5 text-primary" />
              Terms of use
              <ArrowRight className="ml-auto size-4 text-muted-foreground" />
            </a>
            <a
              href={legalLinks.privacyUrl || undefined}
              target={legalLinks.privacyUrl ? '_blank' : undefined}
              rel={legalLinks.privacyUrl ? 'noreferrer' : undefined}
              aria-disabled={!legalLinks.privacyUrl}
              className={cx(
                'flex min-h-12 items-center gap-3 rounded-xl border px-4 text-sm font-bold transition hover:border-primary/40 hover:bg-primary/5',
                !legalLinks.privacyUrl && 'pointer-events-none opacity-50',
              )}
            >
              <ShieldCheck className="size-5 text-primary" />
              Privacy policy
              <ArrowRight className="ml-auto size-4 text-muted-foreground" />
            </a>
            <a
              href={legalLinks.refundUrl || undefined}
              target={legalLinks.refundUrl ? '_blank' : undefined}
              rel={legalLinks.refundUrl ? 'noreferrer' : undefined}
              aria-disabled={!legalLinks.refundUrl}
              className={cx(
                'flex min-h-12 items-center gap-3 rounded-xl border px-4 text-sm font-bold transition hover:border-primary/40 hover:bg-primary/5',
                !legalLinks.refundUrl && 'pointer-events-none opacity-50',
              )}
            >
              <RotateCcw className="size-5 text-primary" />
              Refund policy
              <ArrowRight className="ml-auto size-4 text-muted-foreground" />
            </a>
          </div>
          {(!legalLinks.termsUrl || !legalLinks.privacyUrl || !legalLinks.refundUrl) && (
            <p className="mt-3 text-xs text-muted-foreground">
              The Superadmin can configure unavailable links from the Admin
              page.
            </p>
          )}
        </section>
        <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
          <h2 className="font-bold">PWA installation</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            On iPad, open Qraft in Safari, tap Share, then choose{' '}
            <strong>Add to Home Screen</strong>. The interface is optimized for
            touch, split view, and offline study.
          </p>
        </section>
        <DeleteAccount uid={user.uid} onDeleted={onAccountDeleted} />
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
  confirmUpdate: (
    updater: (current: CollaborationState) => CollaborationState,
  ) => void;
  collaboration: CollaborationState;
  updateCollaboration: (
    updater: (current: CollaborationState) => CollaborationState,
  ) => void;
  questions: Question[];
  allQuestions: Question[];
  activeQBankId: string;
}) {
  const [open, setOpen] = useState(false);
  const [roleRequestOpen, setRoleRequestOpen] = useState(false);
  const [editingProposal, setEditingProposal] = useState<QuestionProposal>();
  const [importOpen, setImportOpen] = useState(false);
  const [contributionSearch, setContributionSearch] = useState('');
  const [selectedContributionIds, setSelectedContributionIds] = useState<
    Set<string>
  >(new Set());
  const [contributionDeleteMode, setContributionDeleteMode] = useState<
    'selected' | 'all'
  >();
  const [stem, setStem] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [answer, setAnswer] = useState(0);
  const [specialty, setSpecialty] = useState(
    questions[0]?.specialty ?? 'General',
  );
  const [topic, setTopic] = useState(questions[0]?.topic ?? 'General');
  const [rationale, setRationale] = useState('');
  const [explanation, setExplanation] = useState('');
  const [explanationImages, setExplanationImages] = useState<QuestionProgress['noteImages']>([]);
  const [explanationImagesBusy, setExplanationImagesBusy] = useState(false);
  const [composerImageScope, setComposerImageScope] = useState('');
  const [sourceFile, setSourceFile] = useState('');
  const [sourcePage, setSourcePage] = useState('');
  const [sourceError, setSourceError] = useState('');
  function resetComposer() {
    setStem('');
    setOptions(['', '', '', '']);
    setAnswer(0);
    setSpecialty(questions[0]?.specialty ?? 'General');
    setTopic(questions[0]?.topic ?? 'General');
    setRationale('');
    setExplanation('');
    setExplanationImages([]);
    setComposerImageScope(crypto.randomUUID());
    setSourceFile(''); setSourcePage(''); setSourceError('');
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
    setExplanationImages(proposal.payload.explanationImages ?? []);
    setComposerImageScope(proposal.id);
    const source = readQuestionSource(proposal.payload);
    setSourceFile(source.sourceFile); setSourcePage(String(source.sourcePage ?? '')); setSourceError('');
    setOpen(true);
  }

  async function addQuestion(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (explanationImagesBusy) return;
    if (
      !stem.trim() ||
      options.length < 2 ||
      options.length > 10 ||
      answer >= options.length ||
      options.some((option) => !option.trim()) ||
      ((!editingProposal || editingProposal.type === 'new_question') && !explanation.trim()) ||
      !sourceFile.trim()
    )
      return;
    let source: ReturnType<typeof validateQuestionSource>;
    try { source = validateQuestionSource({ sourceFile, sourcePage, originalQuestionNumber: editingProposal ? readQuestionSource(editingProposal.payload).originalQuestionNumber : undefined }); }
    catch (error) { setSourceError(error instanceof Error ? error.message : 'Invalid source.'); return; }
    setSourceError('');
    const proposedAt = new Date().toISOString();
    const payload = {
      stem: stem.trim(),
      options: options.map((option) => option.trim()),
      answer,
      specialty: specialty.trim() || 'General',
      topic: topic.trim() || 'General',
      explanation: explanation.trim(),
      explanationImages,
      ...source,
      images: editingProposal?.payload.images ?? [],
    };
    if (editingProposal) {
      const isResubmission = editingProposal.status === 'rejected';
      const nextProposal: QuestionProposal = {
        ...editingProposal,
        id: isResubmission ? crypto.randomUUID() : editingProposal.id,
        payload,
        rationale: rationale.trim() || 'Updated question contribution.',
        status: 'pending',
        proposedAt,
        reviewedById: undefined,
        reviewedByName: undefined,
        reviewedAt: undefined,
        reviewNote: undefined,
      };
      updateCollaboration((current) => ({
        ...current,
        proposals: isResubmission
          ? [nextProposal, ...current.proposals]
          : current.proposals.map((item) =>
              item.id === editingProposal.id &&
              item.proposedById === user.uid &&
              item.status !== 'approved'
                ? nextProposal
                : item,
            ),
        auditLog: [
          {
            id: crypto.randomUUID(),
            action:
              editingProposal.status === 'rejected'
                ? 'question_proposal_resubmitted'
                : 'question_proposal_updated',
            entityType: 'question',
            entityId: editingProposal.id,
            actorId: user.uid,
            actorName: user.displayName,
            createdAt: proposedAt,
            detail:
              editingProposal.status === 'rejected'
                ? 'Resubmitted a rejected question contribution.'
                : 'Updated a pending question contribution.',
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
            editKinds: [
              'question_text',
              'options',
              'correct_answer',
              'explanation',
              'source',
            ],
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
    setSourceFile(''); setSourcePage(''); setSourceError('');
    setEditingProposal(undefined);
    setOpen(false);
  }
  const allMine = collaboration.proposals.filter(
    (proposal) =>
      proposal.proposedById === user.uid && proposal.qbankId === activeQBankId,
  );
  const mine = allMine.filter((proposal) =>
    `${proposal.payload.stem} ${allQuestions.find((q) => q.id === proposal.questionId)?.questionId ?? (proposal.questionId === '#deleted' ? 'deleted' : '')}`
      .toLowerCase()
      .includes(contributionSearch.replace(/^#/, '').toLowerCase()),
  );
  const selectedContributionCount = allMine.filter((proposal) =>
    selectedContributionIds.has(proposal.id),
  ).length;
  const allVisibleSelected =
    mine.length > 0 &&
    mine.every((proposal) => selectedContributionIds.has(proposal.id));
  function toggleContribution(id: string) {
    setSelectedContributionIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleVisibleContributions() {
    setSelectedContributionIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected)
        mine.forEach((proposal) => next.delete(proposal.id));
      else mine.forEach((proposal) => next.add(proposal.id));
      return next;
    });
  }
  function deleteContributions() {
    const ids = new Set(
      contributionDeleteMode === 'all'
        ? allMine.map((proposal) => proposal.id)
        : [...selectedContributionIds],
    );
    updateCollaboration((current) => ({
      ...current,
      proposals: current.proposals.filter(
        (proposal) =>
          !ids.has(proposal.id) ||
          proposal.proposedById !== user.uid ||
          proposal.qbankId !== activeQBankId,
      ),
    }));
    setSelectedContributionIds(new Set());
    setContributionDeleteMode(undefined);
  }
  const qbank = collaboration.qbanks.find((item) => item.id === activeQBankId);
  const isOwner = Boolean(
    qbank && canEditBank(user, qbank, collaboration.memberships),
  );
  if (open)
    return (
      <>
        <PageHeader
          title={
            editingProposal
              ? editingProposal.status === 'rejected'
                ? 'Resubmit contribution'
                : 'Edit contribution'
              : isOwner
                ? 'Add question'
                : 'Propose a question'
          }
          subtitle={`${qbank?.name ?? 'QBank'} · ${editingProposal?.type === 'question_edit' ? 'explanation is optional; source is required' : 'explanation and source are required'}`}
          openMenu={() => window.dispatchEvent(new Event('medguard-open-menu'))}
        />
        <form
          onSubmit={addQuestion}
          className="mx-auto my-6 w-[calc(100%-2rem)] max-w-3xl rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border sm:p-7"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold">
                {editingProposal ? 'Update contribution' : 'Question content'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {editingProposal
                  ? editingProposal.status === 'rejected'
                    ? 'Update the details and send this contribution back to the review queue.'
                    : 'You can update this contribution while it is pending review.'
                  : 'Every new question is published only after another reviewer approves it.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close composer"
              disabled={explanationImagesBusy}
              className="grid size-11 shrink-0 place-items-center rounded-xl border"
            >
              <X className="size-5" />
            </button>
          </div>
          <label className="mt-5 block">
            <span className="mb-1.5 block text-sm font-semibold">
              Question stem
            </span>
            <textarea
              dir="auto"
              required
              value={stem}
              onChange={(event) => setStem(event.target.value)}
              className="min-h-28 w-full rounded-xl border bg-card p-3 text-sm"
            />
          </label>
          <div className="mt-4 space-y-2">
            {options.map((option, index) => (
              <div key={index} className="flex min-w-0 items-start gap-2">
                <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-xl border px-2">
                  <input
                    aria-label={`Mark option ${optionLabel(index)} as correct`}
                    type="radio"
                    name="answer"
                    checked={answer === index}
                    onChange={() => setAnswer(index)}
                    className="size-4 accent-primary"
                  />
                  <span className="text-xs font-bold">
                    {optionLabel(index)}
                  </span>
                </label>
                <textarea
                  dir="auto"
                  aria-label={`Option ${optionLabel(index)}`}
                  required
                  value={option}
                  onChange={(event) =>
                    setOptions((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item,
                      ),
                    )
                  }
                  className="min-h-11 min-w-0 flex-1 rounded-xl border bg-card p-3 text-sm"
                />
                <button
                  type="button"
                  aria-label={`Remove option ${optionLabel(index)}`}
                  disabled={options.length <= 2}
                  onClick={() => {
                    setOptions((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    );
                    setAnswer((current) =>
                      current === index
                        ? 0
                        : current > index
                          ? current - 1
                          : current,
                    );
                  }}
                  className="grid size-11 shrink-0 place-items-center rounded-xl border text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:text-red-300"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={options.length >= 10}
              onClick={() => setOptions((current) => [...current, ''])}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-dashed px-4 text-sm font-bold text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="size-4" />
              Add option
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-sm font-semibold">
                Specialty
              </span>
              <input
                value={specialty}
                onChange={(event) => setSpecialty(event.target.value)}
                className="h-11 w-full rounded-xl border bg-card px-3 text-sm"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-semibold">Topic</span>
              <input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                className="h-11 w-full rounded-xl border bg-card px-3 text-sm"
              />
            </label>
          </div>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-semibold">
              Explanation{' '}
              {editingProposal?.type === 'question_edit' ? <span className="text-orange-600 dark:text-orange-400">optional</span> : <strong className="text-red-600 dark:text-red-300">required</strong>}
            </span>
            <textarea
              required={editingProposal?.type !== 'question_edit'}
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              className="min-h-28 w-full rounded-xl border bg-card p-3 text-sm"
              placeholder="Explain why the keyed answer is correct."
            />
            {editingProposal?.type === 'question_edit' && !explanation.trim() && <p className="mt-2 text-sm text-orange-600 dark:text-orange-400">Adding an explanation helps learners. Saving empty removes the existing explanation when accepted.</p>}
          </label>
          <ExplanationImageEditor key={`${activeQBankId}:${composerImageScope}`} uid={user.uid} qbankId={activeQBankId} questionId={`proposal-${composerImageScope}`} images={explanationImages} onChange={setExplanationImages} onBusyChange={setExplanationImagesBusy} />
          <div className="mt-4"><QuestionSourceFields sourceFile={sourceFile} sourcePage={sourcePage} onChange={source => { setSourceFile(source.sourceFile); setSourcePage(source.sourcePage); }} /></div>
          {sourceError && <p role="alert" className="mt-2 text-sm text-destructive">{sourceError}</p>}
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-semibold">
              Reviewer context
            </span>
            <textarea
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              className="min-h-20 w-full rounded-xl border bg-card p-3 text-sm"
              placeholder="Optional context for the reviewer"
            />
          </label>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <SecondaryButton disabled={explanationImagesBusy} onClick={() => setOpen(false)}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" tone="contribute" disabled={explanationImagesBusy}>
              <Save className="size-4" />
              {editingProposal
                ? editingProposal.status === 'rejected'
                  ? 'Resubmit for review'
                  : 'Save changes'
                : 'Submit for review'}
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
            {!hasModeratorRole(user) && (
              <SecondaryButton onClick={() => setRoleRequestOpen(true)}>
                <UserPlus className="size-4" />
                Request role
              </SecondaryButton>
            )}
            <SecondaryButton
              onClick={() =>
                user.role === 'super_admin' || hasFeature(user.effectivePlan ?? user.tier, 'jsonImport', user.planLimits)
                  ? setImportOpen(true)
                  : openUpgrade()
              }
            >
              {user.role !== 'super_admin' && !hasFeature(user.effectivePlan ?? user.tier, 'jsonImport', user.planLimits) && (
                <LockKeyhole className="size-4" />
              )}
              Import
            </SecondaryButton>
            <PrimaryButton
              tone="contribute"
              onClick={() =>
                hasFeature(user.effectivePlan ?? user.tier, 'addQuestions', user.planLimits)
                  ? startNewContribution()
                  : openUpgrade()
              }
            >
              {hasFeature(user.effectivePlan ?? user.tier, 'addQuestions', user.planLimits) ? (
                <Plus className="size-4" />
              ) : (
                <LockKeyhole className="size-4" />
              )}
              Add Manually{' '}
              {hasFeature(user.effectivePlan ?? user.tier, 'addQuestions', user.planLimits)
                ? ''
                : '· Full Access'}
            </PrimaryButton>
          </div>
        }
      />
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogTitle>Import</DialogTitle>
          <QuestionImportReview
            uid={user.uid}
            bankId={activeQBankId}
            adminImportPrivileges={user.role === 'super_admin'}
            onImported={(result) =>
              confirmUpdate((current) => ({
                ...current,
                proposals: [
                  ...result.proposals,
                  ...current.proposals.filter(
                    (p) => !result.proposals.some((n) => n.id === p.id),
                  ),
                ],
                specialties: [
                  ...current.specialties,
                  ...result.specialties.filter(
                    (item) =>
                      !current.specialties.some(
                        (existing) => existing.id === item.id,
                      ),
                  ),
                ],
                topics: [
                  ...current.topics,
                  ...result.topics.filter(
                    (item) =>
                      !current.topics.some(
                        (existing) => existing.id === item.id,
                      ),
                  ),
                ],
                classificationRevisions:
                  result.classificationRevision === undefined
                    ? current.classificationRevisions
                    : {
                        ...current.classificationRevisions,
                        [activeQBankId]: result.classificationRevision,
                      },
              }))
            }
          />
        </DialogContent>
      </Dialog>
      {roleRequestOpen && (
        <dialog
          open
          className="q-safe-overlay fixed inset-0 z-[70] m-0 grid h-full w-full max-w-none place-items-center overflow-y-auto border-0 bg-slate-950/45 p-4 backdrop-blur-sm"
          aria-label="Request a role"
        >
          <div className="w-full max-w-3xl">
            <div className="mb-3 flex justify-end">
              <button
                onClick={() => setRoleRequestOpen(false)}
                className="grid size-10 place-items-center rounded-full bg-card text-foreground shadow-lg"
                aria-label="Close role request"
              >
                <X className="size-5" />
              </button>
            </div>
            <RoleRequestPanel
              user={user}
              collaboration={collaboration}
              updateCollaboration={updateCollaboration}
            />
          </div>
        </dialog>
      )}
      <div className="mx-auto max-w-6xl p-4 sm:p-7">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Live questions"
            value={questions.length}
            detail="Approved and available in tests"
          />
          <StatCard
            label="Your proposals"
            value={mine.length}
            detail={`${mine.filter((item) => item.status === 'approved').length} approved`}
          />
          <StatCard
            label="Awaiting review"
            value={mine.filter((item) => item.status === 'pending').length}
            detail="Visible to the authorized reviewers"
            color="amber"
          />
        </div>
        <section className="mt-6 overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          <div className="border-b p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold">Your contribution history</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Remove history entries without deleting approved questions
                  from the QBank.
                </p>
              </div>
              <button
                type="button"
                disabled={allMine.length === 0}
                onClick={() => setContributionDeleteMode('all')}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/15"
              >
                <Trash2 className="size-4" />
                Clear history
              </button>
            </div>
            <input
              aria-label="Search contributions by Question ID"
              placeholder="Search Question ID or text"
              className="mt-3 w-full rounded-xl border bg-background p-3"
              value={contributionSearch}
              onChange={(e) => setContributionSearch(e.target.value)}
            />
          </div>
          {mine.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              You have not proposed a question or correction in this QBank yet.
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/25 px-4 py-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleVisibleContributions}
                    className="size-4 rounded accent-primary"
                  />
                  Select all shown ({mine.length})
                </label>
                {selectedContributionCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setContributionDeleteMode('selected')}
                    className="inline-flex h-9 items-center gap-2 rounded-xl bg-red-600 px-3 text-xs font-bold text-white transition hover:bg-red-700"
                  >
                    <Trash2 className="size-3.5" />
                    Delete selected ({selectedContributionCount})
                  </button>
                )}
              </div>
              <div className="divide-y">
                {mine.map((proposal) => {
                  const contributedQuestion = proposal.questionId
                    ? allQuestions.find(
                        (item) => item.id === proposal.questionId,
                      )
                    : undefined;
                  return (
                    <div
                      key={proposal.id}
                      className={cx(
                        'grid gap-3 p-4 text-sm transition sm:grid-cols-[auto_120px_minmax(0,1fr)_140px_auto] sm:items-center',
                        selectedContributionIds.has(proposal.id) &&
                          'bg-primary/5',
                      )}
                    >
                      <input
                        aria-label={`Select contribution: ${proposal.payload.stem}`}
                        type="checkbox"
                        checked={selectedContributionIds.has(proposal.id)}
                        onChange={() => toggleContribution(proposal.id)}
                        className="size-4 rounded accent-primary"
                      />
                      <span
                        className={cx(
                          'w-fit rounded-full px-2 py-1 text-xs font-bold uppercase',
                          proposal.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200'
                            : proposal.status === 'rejected'
                              ? 'bg-red-50 text-red-700 dark:bg-red-500/12 dark:text-red-200'
                              : 'bg-amber-50 text-amber-800 dark:bg-amber-500/12 dark:text-amber-200',
                        )}
                      >
                        {proposal.status === 'pending' && (proposal.duplicateReview?.status === 'flagged' || proposal.duplicateInfo)
                          ? 'possible duplicate · review pending'
                          : proposal.duplicateReview?.resolutions?.at(-1)?.decision === 'rejected_as_duplicate'
                            ? 'rejected as duplicate'
                            : proposal.status}
                      </span>
                      <span>
                        <span className="line-clamp-2"><FormattedQuestionText text={proposal.payload.stem} /></span>
                        {proposal.status === 'pending' && (proposal.duplicateReview?.status === 'flagged' || proposal.duplicateInfo) && (
                          <small className="mt-1 block text-amber-700 dark:text-amber-300">Possible duplicate — awaiting reviewer decision. This is not a confirmed duplicate.</small>
                        )}
                        {proposal.duplicateReview?.resolutions?.at(-1)?.decision === 'rejected_as_duplicate' && (
                          <small className="mt-1 block text-red-700 dark:text-red-300">
                            Rejected after reviewer confirmation
                            {(() => {
                              const candidateId = proposal.duplicateReview?.resolutions?.at(-1)?.candidateEntityId;
                              const matched = collaboration.approvedQuestions.find((question) => question.id === candidateId && question.qbankId === proposal.qbankId);
                              return matched ? ` as duplicate of Question #${matched.questionId}.` : ' as a duplicate.';
                            })()}
                          </small>
                        )}
                      </span>
                      <div className="rounded-lg bg-muted/45 px-3 py-2">
                        <span className="block text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                          Question ID
                        </span>
                        {contributedQuestion ? (
                          <QuestionId value={contributedQuestion.questionId} />
                        ) : (
                          <strong className="font-mono text-xs">
                            {proposal.questionId === '#deleted'
                              ? '#deleted'
                              : 'Not assigned'}
                          </strong>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(proposal.proposedAt)}
                        </span>
                        {(proposal.status === 'pending' ||
                          proposal.status === 'rejected') && (
                          <SecondaryButton
                            onClick={() => startEditing(proposal)}
                            className="h-9 px-3 text-xs"
                          >
                            <Pencil className="size-3.5" />
                            {proposal.status === 'rejected'
                              ? 'Edit & resubmit'
                              : 'Edit'}
                          </SecondaryButton>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
      <AlertDialog
        open={Boolean(contributionDeleteMode)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setContributionDeleteMode(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-200">
              <Trash2 className="size-5" />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {contributionDeleteMode === 'all'
                ? 'Clear contribution history?'
                : `Delete ${selectedContributionCount} selected contribution${selectedContributionCount === 1 ? '' : 's'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {contributionDeleteMode === 'all'
                ? `This removes all ${allMine.length} history entries in this QBank. Approved questions remain available in the QBank.`
                : 'The selected history entries will be removed. Any approved questions remain available in the QBank.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteContributions}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function MedGuardApp({
  portal = 'app',
  initialView = 'dashboard',
  initialTestId,
  initialQBankId,
}: {
  portal?: 'app' | 'superadmin';
  initialView?: View;
  initialTestId?: string;
  initialQBankId?: string;
}) {
  const presentation = usePresentationEnvironment();
  const [user, setUserRaw] = useState<AppUser | null | undefined>(undefined);
  const personalStateSession = useRef<PersonalStateSession>({ uid: undefined });
  const [state, setStateRaw] = useState<AppState>(initialAppState);
  const stateSnapshot = useRef(state);
  const stateDirty = useRef(false);
  const setState = useCallback((update: React.SetStateAction<AppState>) => {
      const current = stateSnapshot.current;
      const next = typeof update === 'function' ? update(current) : update;
      if (next === current) return;
      const updatedAt = new Date().toISOString();
      const progress = Object.fromEntries(
        Object.entries(next.progress).map(([id, value]) => [
          id,
          value === current.progress[id] ? value : { ...value, updatedAt },
        ]),
      );
      const edited = { ...next, progress, clientUpdatedAt: updatedAt };
      stateSnapshot.current = edited;
      stateDirty.current = true;
      setStateRaw(edited);
  }, []);
  const recordStudyVisit = useCallback(() => {
    setState((current) => {
      const studyStreak = recordStudyActivity(current.studyStreak);
      return studyStreak === current.studyStreak
        ? current
        : { ...current, studyStreak };
    });
  }, [setState]);
  const [theme, setTheme] = useState<LocalTheme>(loadActiveLocalTheme);
  const [collaboration, setCollaboration] = useState<CollaborationState>(
    initialCollaborationState,
  );
  const [hydrated, setHydrated] = useState(false);
  const [collaborationHydrated, setCollaborationHydrated] = useState(false);
  const [view, setViewState] = useState<View>(initialView);
  const [directTestCode, setDirectTestCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    return (
      new URL(window.location.href).searchParams
        .get('join_test')
        ?.trim()
        .toUpperCase() ?? ''
    );
  });
  const [testError, setTestError] = useState('');
  const [examUpgradeRequest, setExamUpgradeRequest] = useState<ExamUpgradeRequest | null>(null);
  const creatingTest = useRef(false);
  const [examPool, setExamPool] = useState<Question[]>([]);
  const [activeTestId, setActiveTestId] = useState<string | undefined>(
    initialTestId,
  );
  const setView = useCallback(
    (next: View) => {
      setViewState(next);
      if (portal !== 'app' || typeof window === 'undefined') return;
      const nextPath = pathForView(next, activeTestId);
      if (window.location.pathname === nextPath) return;
      window.history.pushState({ qraftView: next }, '', nextPath);
    },
    [activeTestId, portal],
  );
  const [managedBank, setManagedBank] = useState<{
    id: string;
    section: 'settings' | 'structure' | 'questions';
  }>();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('syncing');
  const [syncIssue, setSyncIssue] = useState('');
  const reportSyncError = useCallback((error: unknown) => {
    const reference = error instanceof ApiError && typeof error.payload.requestId === 'string'
      ? ` Reference: ${error.payload.requestId}.` : '';
    setSyncIssue(`${error instanceof Error ? error.message : 'Unable to synchronize. Your changes remain on this device.'}${reference}`);
    setSyncStatus('error');
  }, []);
  const online = useSyncExternalStore(
    subscribeConnection,
    () => navigator.onLine,
    () => true,
  );
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [flashcardClock, setFlashcardClock] = useState(() => Date.now());
  const [linkInvitation, setLinkInvitation] = useState<
    (QBankLinkInvitation & { token: string }) | null
  >(null);
  const [linkInvitationBusy, setLinkInvitationBusy] = useState(false);
  const [linkInvitationError, setLinkInvitationError] = useState('');
  const activateAppUpdate = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.waiting) {
      window.location.reload();
      return;
    }
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true },
    );
    registration.waiting.postMessage({ type: 'QRAFT_SKIP_WAITING' });
  }, []);
  const saveTimer = useRef<number | undefined>(undefined);
  const stateSyncInFlight = useRef(false);
  const checkpointInFlight = useRef(0);
  const flashcardReviewActive = useRef(false);
  const viewSnapshot = useRef<View>(initialView);
  const activeTestIdSnapshot = useRef<string | undefined>(undefined);
  const outboxReplayedFor = useRef('');
  const lastLeaveCheckpoint = useRef('');
  const flashcardCrudSnapshot = useRef('');
  const cloudStateSnapshot = useRef<AppState | undefined>(undefined);
  const collaborationSaveTimer = useRef<number | undefined>(undefined);
  const lastSavedCollaboration = useRef<CollaborationState>(
    initialCollaborationState(),
  );
  const collaborationWriteInFlight = useRef(false);
  const collaborationRetryAt = useRef(0);
  const collaborationRetryCount = useRef(0);
  const collaborationRefreshDeferred = useRef(false);
  const requestCollaborationRefresh = useRef<(() => void) | undefined>(undefined);
  const liveSnapshot = useRef({ collaboration, user });
  useEffect(() => {
    liveSnapshot.current = { collaboration, user };
  }, [collaboration, user]);
  useEffect(() => {
    stateSnapshot.current = state;
  }, [state]);
  useEffect(() => {
    viewSnapshot.current = view;
  }, [view]);
  useEffect(() => {
    activeTestIdSnapshot.current = activeTestId;
  }, [activeTestId]);
  const handledInvitationLink = useRef('');
  const hydratedIdentity = useRef('');
  const cloudLoaded = useRef(false);
  const setUser = useCallback((update: React.SetStateAction<AppUser | null | undefined>) => {
    const next = typeof update === 'function' ? update(liveSnapshot.current.user) : update;
    if (personalStateSession.current.uid !== next?.uid) {
      personalStateSession.current = { uid: next?.uid };
      const empty = initialAppState();
      stateSnapshot.current = empty;
      cloudStateSnapshot.current = undefined;
      stateDirty.current = false;
      stateSyncInFlight.current = false;
      checkpointInFlight.current = 0;
      cloudLoaded.current = false;
      hydratedIdentity.current = '';
      outboxReplayedFor.current = '';
      setHydrated(false);
      setCollaborationHydrated(false);
      setStateRaw(empty);
    }
    liveSnapshot.current = { ...liveSnapshot.current, user: next };
    setUserRaw(next);
  }, []);
  const acceptPersonalStateReceipt = useCallback((receipt: PersonalStateReceipt, remote: AppState | undefined) => {
    const result = resolvePersonalStateReceipt(receipt, personalStateSession.current, stateSnapshot.current, remote);
    if (!result) return undefined;
    stateDirty.current = result.dirty;
    if (result.state !== stateSnapshot.current) {
      stateSnapshot.current = result.state;
      cloudStateSnapshot.current = result.dirty ? undefined : result.state;
      setStateRaw(result.state);
    }
    return result;
  }, []);
  const confirmUpdate = (
    updater: (current: CollaborationState) => CollaborationState,
  ) => {
    lastSavedCollaboration.current = updater(lastSavedCollaboration.current);
    setCollaboration(updater);
  };
  const synchronizationUid = user?.uid;
  useEffect(() => {
    if (!synchronizationUid) return;
    let active = true;
    void loadRejectedCollaboration(synchronizationUid).then(drafts => {
      if (active) setSyncIssue(drafts.length ? 'Some earlier changes need review. A copy is preserved on this device and can be downloaded from Settings.' : '');
    }).catch(error => { if (active) reportSyncError(error); });
    const synchronized = (event: Event) => {
      const notice = (event as CustomEvent<CollaborationSyncNotice>).detail;
      if (notice.uid !== synchronizationUid) return;
      lastSavedCollaboration.current = notice.confirmed;
      setCollaboration(current => mergeLiveState(notice.local, current, notice.confirmed));
      void loadRejectedCollaboration(synchronizationUid).then(drafts => {
        if (active) setSyncIssue(drafts.length ? 'Some changes need review. Other changes were synchronized. Download the preserved drafts from Settings.' : '');
      }).catch(error => { if (active) reportSyncError(error); });
    };
    window.addEventListener(COLLABORATION_SYNC_NOTICE, synchronized);
    return () => { active = false; window.removeEventListener(COLLABORATION_SYNC_NOTICE, synchronized); };
  }, [synchronizationUid, reportSyncError]);
  const replaceCollaborationFromServer = useCallback(
    (next: CollaborationState) => {
      lastSavedCollaboration.current = next;
      setCollaboration(next);
      if (user) {
        setApiCache(
          '/collaboration',
          { collaboration: next },
          { cacheScope: user.uid },
        );
        void saveLocalCollaboration(next, user.uid).catch(() => setSyncStatus('error'));
      }
    },
    [user],
  );
  useEffect(() => {
    if (!user) return;
    const changed = (event: Event) => {
      const { userId, tier } = (
        event as CustomEvent<{ userId: string; tier?: AppUser['tier'] }>
      ).detail;
      if (!tier) return;
      const patch = (current: CollaborationState) => ({
        ...current,
        members: current.members.map((m) =>
          m.uid === userId ? { ...m, tier } : m,
        ),
      });
      lastSavedCollaboration.current = patch(lastSavedCollaboration.current);
      setCollaboration(patch);
      if (userId === user.uid)
        setUser((current) => {
          if (!current || current.uid !== userId) return current;
          const next = { ...current, tier, effectivePlan: tier };
          setAuthenticatedUserCache(next);
          return next;
        });
    };
    window.addEventListener('qraft-account-updated', changed);
    return () => {
      window.removeEventListener('qraft-account-updated', changed);
    };
  }, [setUser, user]);

  useEffect(() => {
    if (!user || !collaborationHydrated || user.status !== 'approved') return;
    if (
      !['library', 'create', 'review', 'manager', 'qbank-management'].includes(
        view,
      )
    )
      return;
    if (collaborationWriteInFlight.current || collaborationSaveTimer.current)
      return;
    let active = true;
    const baseline = lastSavedCollaboration.current;
    void loadCollaborationState(user)
      .then(async (next) => {
        if (!active || (await loadCollaborationSyncOutbox(user.uid))) return;
        if (
          collaborationWriteInFlight.current ||
          collaborationSaveTimer.current ||
          baseline !== lastSavedCollaboration.current ||
          JSON.stringify(liveSnapshot.current.collaboration) !==
            JSON.stringify(lastSavedCollaboration.current)
        )
          return;
        if (next !== baseline) replaceCollaborationFromServer(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [collaborationHydrated, replaceCollaborationFromServer, user, view]);

  const allQuestions = useMemo(() => {
    const merged = new Map<string, Question>();
    [
      ...state.customQuestions.map((question, index) => ({
        ...question,
        questionId: question.questionId ?? String(218 + index).padStart(5, '0'),
        images: question.images ?? [],
        qbankId: question.qbankId ?? 'smle-gs',
      })),
      ...[
        ...collaboration.approvedQuestions,
        ...(view === 'test' ? examPool : []),
      ].map((question) => ({
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
  }, [
    state.customQuestions,
    state.questionOverrides,
    collaboration.approvedQuestions,
    examPool,
    view,
  ]);
  const allQuestionsById = useMemo(() => indexQuestionsById(allQuestions), [allQuestions]);
  const bookmarkedQuestionIds = useMemo(
    () => Object.entries(state.progress)
      .filter(([, progress]) => progress.bookmarked)
      .map(([questionId]) => questionId),
    [state.progress],
  );
  const accessibleQBanks = useMemo(
    () =>
      collaboration.qbanks.filter(
        (bank) =>
          !bank.archived &&
          user &&
          canAccessBank(user, bank, collaboration.memberships),
      ),
    [collaboration.memberships, collaboration.qbanks, user],
  );
  const requestedQBankId = state.settings.activeQBankId || 'smle-gs';
  const activeQBankId = accessibleQBanks.some(
    (bank) => bank.id === requestedQBankId,
  )
    ? requestedQBankId
    : (accessibleQBanks[0]?.id ?? 'smle-gs');
  const questions = useMemo(
    () =>
      allQuestions.filter(
        (question) => (question.qbankId ?? 'smle-gs') === activeQBankId,
      ),
    [allQuestions, activeQBankId],
  );
  useEffect(() => {
    if (!hydrated || !collaborationHydrated || !user) return;
    const bankIds = new Set(accessibleQBanks.map((bank) => bank.id));
    const questionIds = new Set(
      allQuestions
        .filter((question) => bankIds.has(question.qbankId ?? 'smle-gs'))
        .map((question) => question.id),
    );
    const cleanup = window.setTimeout(
      () =>
        setState((current) => {
          const favoriteQBankIds = current.settings.favoriteQBankIds.filter(
            (id) => bankIds.has(id),
          );
          const pinnedQBankIds = current.settings.pinnedQBankIds.filter((id) =>
            bankIds.has(id),
          );
          const quickAccessQBankIds = current.settings.quickAccessQBankIds
            .filter((id) => bankIds.has(id))
            .slice(0, 5);
          const qbankOrderBySection = {
            mine: [
              ...new Set(current.settings.qbankOrderBySection.mine),
            ].filter((id) => bankIds.has(id)),
            shared: [
              ...new Set(current.settings.qbankOrderBySection.shared),
            ].filter((id) => bankIds.has(id)),
          };
          let progressChanged = false;
          const progress = Object.fromEntries(
            Object.entries(current.progress).map(([id, value]) => {
              if (value.bookmarked && !questionIds.has(id)) {
                progressChanged = true;
                return [id, { ...value, bookmarked: false }];
              }
              return [id, value];
            }),
          );
          const settingsChanged =
            favoriteQBankIds.length !==
              current.settings.favoriteQBankIds.length ||
            pinnedQBankIds.length !== current.settings.pinnedQBankIds.length ||
            quickAccessQBankIds.length !==
              current.settings.quickAccessQBankIds.length ||
            qbankOrderBySection.mine.length !==
              current.settings.qbankOrderBySection.mine.length ||
            qbankOrderBySection.shared.length !==
              current.settings.qbankOrderBySection.shared.length;
          if (!progressChanged && !settingsChanged) return current;
          return {
            ...current,
            progress,
            settings: {
              ...current.settings,
              favoriteQBankIds,
              pinnedQBankIds,
              quickAccessQBankIds,
              qbankOrderBySection,
            },
          };
        }),
      0,
    );
    return () => window.clearTimeout(cleanup);
  }, [
    accessibleQBanks,
    allQuestions,
    collaborationHydrated,
    hydrated,
    setState,
    user,
  ]);
  const activeQBank = collaboration.qbanks.find(
    (bank) => bank.id === activeQBankId,
  );
  const showReview = Boolean(
    user &&
    activeQBank &&
    canReviewBank(user, activeQBank, collaboration.memberships),
  );
  const pendingReviewCount =
    showReview && user
      ? collaboration.proposals.filter(
          (proposal) =>
            proposal.qbankId === activeQBankId &&
            proposal.status === 'pending' &&
            proposal.proposedById !== user.uid,
        ).length
      : 0;
  const dueFlashcardCount = state.flashcards.filter((card) => {
    if (card.qbankId !== activeQBankId || card.suspended) return false;
    const schedule = state.flashcardSchedules[card.id];
    return !schedule || new Date(schedule.due).getTime() <= flashcardClock;
  }).length;
  const activeTest =
    state.tests.find((test) => test.id === activeTestId) ??
    state.tests.find((test) => test.status === 'active');
  const activeTestHasQuestion = Boolean(
    activeTest?.questionIds.some((id) =>
      allQuestions.some((question) => question.id === id),
    ),
  );

  useEffect(() => {
    if (!hydrated || view !== 'test' || activeTest) return;
    const timer = window.setTimeout(() => setViewState('history'), 0);
    if (portal === 'app')
      window.history.replaceState({ qraftView: 'history' }, '', '/history');
    return () => window.clearTimeout(timer);
  }, [activeTest, hydrated, portal, view]);

  useEffect(() => {
    if (!hydrated || view !== 'review' || showReview) return;
    const timer = window.setTimeout(() => setViewState('dashboard'), 0);
    if (portal === 'app')
      window.history.replaceState({ qraftView: 'dashboard' }, '', '/');
    return () => window.clearTimeout(timer);
  }, [hydrated, portal, showReview, view]);

  useEffect(() => {
    if (portal !== 'app') return;
    const onPopState = () => {
      const pathname = window.location.pathname;
      const next = viewFromPath(pathname);
      setViewState(next);
      setDirectTestCode(
        new URL(window.location.href).searchParams.get('join_test')?.trim().toUpperCase() ?? '',
      );
      if (next === 'test') {
        const id = decodeURIComponent(pathname.slice('/exams/'.length));
        setActiveTestId(id === 'active' ? undefined : id);
      }
      setMobileOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [portal]);

  useEffect(() => {
    if (portal !== 'app' || view !== 'test' || !activeTestId) return;
    const nextPath = `/exams/${encodeURIComponent(activeTestId)}`;
    if (window.location.pathname !== nextPath)
      window.history.replaceState({ qraftView: 'test' }, '', nextPath);
  }, [activeTestId, portal, view]);

  useEffect(() => {
    if (!initialQBankId || !collaborationHydrated || !user) return;
    const accessible = collaboration.qbanks.some(
      (bank) =>
        bank.id === initialQBankId &&
        canAccessBank(user, bank, collaboration.memberships),
    );
    if (!accessible) return;
    const timer = window.setTimeout(() => {
      setState((current) =>
        current.settings.activeQBankId === initialQBankId
          ? current
          : {
              ...current,
              settings: { ...current.settings, activeQBankId: initialQBankId },
            },
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    collaboration.qbanks,
    collaboration.memberships,
    collaborationHydrated,
    initialQBankId,
    setState,
    user,
  ]);

  useEffect(() => {
    if (view !== 'test' || !activeTestHasQuestion) return;
    const timer = window.setTimeout(recordStudyVisit, 0);
    return () => window.clearTimeout(timer);
  }, [activeTest?.id, activeTestHasQuestion, recordStudyVisit, view]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setFlashcardClock(Date.now()),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator)
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          if (registration.waiting && navigator.serviceWorker.controller)
            setUpdateAvailable(true);
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            worker?.addEventListener('statechange', () => {
              if (
                worker.state === 'installed' &&
                navigator.serviceWorker.controller
              )
                setUpdateAvailable(true);
            });
          });
          return registration.update();
        })
        .catch(() => undefined);
    const openMenu = () => setMobileOpen(true);
    window.addEventListener('medguard-open-menu', openMenu);
    const handleOnline = () => {
      setOfflineDismissed(false);
      setSyncStatus('syncing');
    };
    const handleOffline = () => {
      setOfflineDismissed(false);
      setSyncStatus('offline');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('medguard-open-menu', openMenu);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      let themeColor = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"][data-qraft-theme]',
      );
      if (!themeColor) {
        themeColor = document.createElement('meta');
        themeColor.name = 'theme-color';
        themeColor.dataset.qraftTheme = 'true';
        document.head.appendChild(themeColor);
      }
      // Safari may use the first matching server-rendered theme entry.
      document
        .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
        .forEach((meta) => {
          meta.removeAttribute('media');
          meta.content = dark ? '#0d1b2a' : '#ffffff';
        });
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    async function initialize() {
      const session = personalStateSession.current;
      try {
        cleanup = await observeCloudflareUser((account) => {
          if (!cancelled && personalStateSession.current === session) setUser(account ?? null);
        });
      } catch {
        if (!cancelled && personalStateSession.current === session) setUser(null);
      }
    }
    void initialize();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [setUser]);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'super_admin' && !user.mfaEnrolled) return;
    const identity = `${user.uid}:${user.status}:${Boolean(user.mfaEnrolled)}`;
    if (hydratedIdentity.current === identity) return;
    cloudLoaded.current = false;
    let cancelled = false;
    const session = personalStateSession.current;
    async function hydrate() {
      let localState: AppState | undefined;
      let localCollaboration: CollaborationState | undefined;
      try {
        [localState, localCollaboration] = await Promise.all([
          loadLocalState(user!.uid),
          loadLocalCollaboration(user!.uid),
        ]);
        let resolved = normalizeAppState(localState);
        let shared = normalizeCollaborationState(
          localCollaboration ?? initialCollaborationState(),
        );
        if (navigator.onLine && user!.status === 'approved') {
          let collaborationReplaySucceeded = true;
          try {
            await flushPendingCollaborationState(user!.uid);
          } catch {
            collaborationReplaySucceeded = false;
          }
          const [cloud, remoteCollaboration] = await Promise.all([
            loadCloudState(user!.uid),
            loadCollaborationState(user!),
          ]);
          const localIsNewer = Boolean(
            localState &&
            (!cloud ||
              appStateFreshness(localState) > appStateFreshness(cloud)),
          );
          if (cloud) {
            resolved = localState
              ? mergeAppStates(
                  normalizeAppState(localState),
                  normalizeAppState(cloud),
                )
              : normalizeAppState(cloud);
            cloudStateSnapshot.current = normalizeAppState(cloud);
          }
          shared =
            !collaborationReplaySucceeded && localCollaboration
              ? localCollaboration
              : localIsNewer && localCollaboration
                ? preserveNewerLocalAnswers(
                    remoteCollaboration,
                    localCollaboration,
                    user!.uid,
                  )
                : remoteCollaboration;
          cloudLoaded.current = true;
          setSyncStatus('synced');
        }
        if (!cancelled && personalStateSession.current === session) {
          hydratedIdentity.current = identity;
          const accountTheme =
            loadLocalTheme(user!.uid) ?? resolved.settings.theme;
          saveLocalTheme(user!.uid, accountTheme);
          setTheme(accountTheme);
          stateSnapshot.current = resolved;
          setStateRaw(resolved);
          setCollaboration(shared);
          lastSavedCollaboration.current = shared;
          setHydrated(true);
          setCollaborationHydrated(true);
        }
      } catch {
        if (!cancelled) {
          const shared = normalizeCollaborationState(
            localCollaboration ?? (await loadLocalCollaboration(user!.uid)),
          );
          const fallback = normalizeAppState(localState ?? (await loadLocalState(user!.uid)));
          if (cancelled || personalStateSession.current !== session) return;
          stateSnapshot.current = fallback;
          setStateRaw(fallback);
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
    clearInvitationLink();
    if (
      collaboration.memberships.some(
        (membership) =>
          membership.qbankId === qbankId && membership.userId === user.uid,
      )
    )
      return;
    void previewCloudflareQBankInvitation(qbankId, token)
      .then((invitation) => {
        setLinkInvitationError('');
        setLinkInvitation({ ...invitation, token });
      })
      .catch((error) => {
        setLinkInvitationError(
          error instanceof Error
            ? error.message
            : 'This QBank invitation could not be opened.',
        );
        handledInvitationLink.current = '';
      });
  }, [collaboration.memberships, collaborationHydrated, user]);

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
      const membership = await joinCloudflareQBankByLink(
        user,
        linkInvitation.qbankId,
        linkInvitation.token,
      );
      confirmUpdate((current) => ({
        ...current,
        memberships: [
          membership,
          ...current.memberships.filter((item) => item.id !== membership.id),
        ],
      }));
      setState((current) => ({
        ...current,
        settings: {
          ...current.settings,
          activeQBankId: linkInvitation.qbankId,
        },
      }));
      setView('library');
      setLinkInvitation(null);
      clearInvitationLink();
    } catch (error) {
      setLinkInvitationError(
        error instanceof Error
          ? error.message
          : 'The invitation could not be accepted.',
      );
    } finally {
      setLinkInvitationBusy(false);
    }
  }

  useEffect(() => {
    if (!user || !hydrated) return;
    const alreadySynced = cloudStateSnapshot.current === state;
    cloudStateSnapshot.current = undefined;
    if (!alreadySynced) stateDirty.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(
      () => {
        if (creatingTest.current) return;
        void saveLocalState(user.uid, state).catch(() => setSyncStatus('error'));
        if (!alreadySynced)
          setSyncStatus(navigator.onLine ? 'local' : 'offline');
      },
      view === 'test' || flashcardReviewActive.current ? 0 : 200,
    );
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [state, user, hydrated, view]);

  useEffect(() => {
    if (
      !user ||
      !hydrated ||
      !navigator.onLine ||
      outboxReplayedFor.current === user.uid
    )
      return;
    outboxReplayedFor.current = user.uid;
    const session = personalStateSession.current;
    void flushPendingCloudState(user.uid)
      .then((remote) => {
        if (!remote || personalStateSession.current !== session || stateDirty.current) return;
        const merged = mergeAppStates(stateSnapshot.current, remote);
        stateSnapshot.current = merged;
        cloudStateSnapshot.current = merged;
        setStateRaw(merged);
        void saveLocalState(user.uid, merged).catch(() => setSyncStatus('error'));
      })
      .catch(() => {
        if (personalStateSession.current !== session) return;
        outboxReplayedFor.current = '';
        setSyncStatus('local');
      });
  }, [hydrated, user]);

  useEffect(() => {
    if (!user || !hydrated) return;
    const session = personalStateSession.current;
    return observeCloudStateSync(user.uid, (remote) => {
      if (personalStateSession.current !== session || stateDirty.current) return;
      const merged = mergeAppStates(stateSnapshot.current, remote);
      stateSnapshot.current = merged;
      cloudStateSnapshot.current = merged;
      setStateRaw(merged);
      void saveLocalState(user.uid, merged).catch(() => setSyncStatus('error'));
      setSyncStatus('synced');
    });
  }, [hydrated, user]);

  const flushCloudState = useCallback(async () => {
    const account = liveSnapshot.current.user;
    const snapshot = stateSnapshot.current;
    if (
      !account ||
      account.status !== 'approved' ||
      !cloudLoaded.current ||
      !snapshot.settings.autoSync ||
      !navigator.onLine ||
      !stateDirty.current ||
      stateSyncInFlight.current ||
      checkpointInFlight.current ||
      viewSnapshot.current === 'test' ||
      flashcardReviewActive.current
    )
      return;
    stateSyncInFlight.current = true;
    const receipt: PersonalStateReceipt = { session: personalStateSession.current, snapshot, dirtyBefore: stateDirty.current, full: true };
    setSyncStatus('syncing');
    try {
      const remote = await saveCloudState(account.uid, snapshot);
      const result = acceptPersonalStateReceipt(receipt, remote);
      if (!result) return;
      setSyncStatus(result.dirty ? 'local' : 'synced');
    } catch (error) {
      if (personalStateSession.current !== receipt.session) return;
      reportSyncError(error);
    } finally {
      if (personalStateSession.current === receipt.session) stateSyncInFlight.current = false;
    }
  }, [acceptPersonalStateReceipt, reportSyncError]);

  const flashcardCrudVersion = useMemo(
    () => JSON.stringify([state.flashcardDecks, state.flashcards]),
    [state.flashcardDecks, state.flashcards],
  );
  useEffect(() => {
    if (!user || !hydrated) return;
    const previous = flashcardCrudSnapshot.current;
    flashcardCrudSnapshot.current = flashcardCrudVersion;
    if (
      !previous ||
      previous === flashcardCrudVersion ||
      flashcardReviewActive.current
    )
      return;
    // Card/deck CRUD intentionally keeps its established autosave behavior.
    // Review ratings are excluded because they change only schedules/logs.
    const timer = window.setTimeout(() => void flushCloudState(), 800);
    return () => window.clearTimeout(timer);
  }, [flashcardCrudVersion, flushCloudState, hydrated, user]);

  useEffect(() => {
    if (!user || !hydrated) return;
    const onlineHandler = () => {
      void flushPendingCloudState(user.uid).catch(() => setSyncStatus('local'));
      void flushPendingCollaborationState(user.uid)
        .then((synced) => {
          if (!synced) return;
          lastSavedCollaboration.current = synced;
          setSyncStatus('synced');
        })
        .catch(() => setSyncStatus('local'));
    };
    const saveBeforeLeaving = () => {
      const snapshot = stateSnapshot.current;
      void saveLocalState(user.uid, snapshot).catch(() => setSyncStatus('error'));
      if (!snapshot.settings.autoSync || !stateDirty.current) return;
      const kind =
        viewSnapshot.current === 'test'
          ? 'exam'
          : flashcardReviewActive.current
            ? 'flashcards'
            : 'full';
      const checkpointKey = `${kind}:${snapshot.clientUpdatedAt ?? ''}`;
      if (lastLeaveCheckpoint.current === checkpointKey) return;
      lastLeaveCheckpoint.current = checkpointKey;
      const activeCheckpointTest =
        kind === 'exam'
          ? (snapshot.tests.find(
              (item) => item.id === activeTestIdSnapshot.current,
            ) ?? snapshot.tests.find((item) => item.status === 'active'))
          : undefined;
      const answerSelections = activeCheckpointTest
        ? activeCheckpointTest.questionIds.flatMap((questionId) => {
            const question = allQuestionsById.get(questionId);
            const qbankId =
              question?.qbankId ?? activeCheckpointTest.qbankId ?? 'smle-gs';
            const answer =
              liveSnapshot.current.collaboration.answerStats[
                `${qbankId}:${questionId}`
              ]?.selections[user.uid];
            return Number.isInteger(answer)
              ? [{ qbankId, questionId, answer }]
              : [];
          })
        : [];
      saveBestEffortStateCheckpoint(
        user.uid,
        snapshot,
        kind,
        kind === 'exam' ? { answerSelections } : undefined,
      );
    };
    const visibilityHandler = () => {
      if (document.visibilityState === 'hidden') saveBeforeLeaving();
    };
    const pageHideHandler = () => saveBeforeLeaving();
    window.addEventListener('online', onlineHandler);
    window.addEventListener('pagehide', pageHideHandler);
    document.addEventListener('visibilitychange', visibilityHandler);
    return () => {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('pagehide', pageHideHandler);
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, [allQuestionsById, flushCloudState, hydrated, user]);

  useEffect(() => {
    if (!user || !collaborationHydrated || user.status !== 'approved') return;
    if (
      JSON.stringify(collaboration) ===
      JSON.stringify(lastSavedCollaboration.current)
    )
      return;
    if (
      viewSnapshot.current === 'test' &&
      JSON.stringify({
        ...collaboration,
        answerStats: lastSavedCollaboration.current.answerStats,
      }) === JSON.stringify(lastSavedCollaboration.current)
    ) {
      void saveLocalCollaboration(collaboration, user.uid).catch(() => setSyncStatus('error'));
      setSyncStatus(navigator.onLine ? 'local' : 'offline');
      return;
    }
    if (collaborationSaveTimer.current)
      window.clearTimeout(collaborationSaveTimer.current);
    const previous = lastSavedCollaboration.current;
    let cancelled = false;
    const queued = Promise.all([
      saveLocalCollaboration(collaboration, user.uid),
      queueCollaborationState(user.uid, collaboration, previous),
    ]);
    void queued.catch(() => setSyncStatus('error'));
    const persist = () => {
      if (cancelled || liveSnapshot.current.user?.uid !== user.uid) return;
      if (Date.now() < collaborationRetryAt.current) {
        collaborationSaveTimer.current = window.setTimeout(persist, collaborationRetryAt.current - Date.now());
        return;
      }
      if (collaborationWriteInFlight.current) {
        collaborationSaveTimer.current = window.setTimeout(persist, 100);
        return;
      }
      collaborationSaveTimer.current = undefined;
      if (navigator.onLine && cloudLoaded.current) {
        collaborationWriteInFlight.current = true;
        setSyncStatus('syncing');
        void queued
          .then(() => flushPendingCollaborationState(user.uid))
          .then((synced) => {
            if (liveSnapshot.current.user?.uid !== user.uid) return;
            if (synced) lastSavedCollaboration.current = synced;
            collaborationRetryCount.current = 0;
            collaborationRetryAt.current = 0;
            setSyncStatus('synced');
          })
          .catch((error: unknown) => {
            if (liveSnapshot.current.user?.uid !== user.uid) return;
            reportSyncError(error);
            if (error instanceof ApiError && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500)) {
              const delay = Math.max(error.retryAfterMs ?? 0, Math.min(60_000, 1000 * 2 ** Math.min(++collaborationRetryCount.current, 6)));
              collaborationRetryAt.current = Date.now() + delay;
              if (!cancelled) collaborationSaveTimer.current = window.setTimeout(persist, delay);
            }
          })
          .finally(() => {
            collaborationWriteInFlight.current = false;
            if (collaborationRefreshDeferred.current) requestCollaborationRefresh.current?.();
          });
      } else {
        setSyncStatus(navigator.onLine ? 'local' : 'offline');
      }
    };
    collaborationSaveTimer.current = window.setTimeout(persist, 150);
    return () => {
      cancelled = true;
      if (collaborationSaveTimer.current)
        window.clearTimeout(collaborationSaveTimer.current);
      collaborationSaveTimer.current = undefined;
    };
  }, [collaboration, user, collaborationHydrated, reportSyncError]);

  const liveChannels = JSON.stringify(
    user
      ? [
          `user:${user.uid}`,
          ...(user.status === 'approved'
            ? [
                'catalog',
                ...collaboration.qbanks.map((bank) => `bank:${bank.id}`),
                ...collaboration.qbanks.filter(bank => canReviewBank(user, bank, collaboration.memberships))
                  .map(bank => `review:bank:${bank.id}`),
              ]
            : []),
          ...(hasModeratorRole(user) &&
          (user.role !== 'super_admin' || user.mfaVerified)
            ? ['admin', 'access']
            : hasAccessManagerRole(user)
              ? ['access']
              : []),
        ].sort()
      : [],
  );
  useEffect(() => {
    const channels = JSON.parse(liveChannels) as string[];
    if (!channels.length || !collaborationHydrated) return;
    let stopped = false;
    const refreshAccount = async () => {
      if (stopped || !navigator.onLine || document.visibilityState === 'hidden')
        return;
      const session = personalStateSession.current;
      await observeCloudflareUser((account) => {
        if (!stopped && personalStateSession.current === session) setUser(account ?? null);
      }).catch(() => undefined);
    };
    const refreshCollaboration = async () => {
      if (collaborationWriteInFlight.current || collaborationSaveTimer.current) {
        collaborationRefreshDeferred.current = true;
        return;
      }
      const forceRefresh = collaborationRefreshDeferred.current;
      collaborationRefreshDeferred.current = false;
      if (
        stopped ||
        !navigator.onLine ||
        document.visibilityState === 'hidden' ||
        collaborationWriteInFlight.current ||
        collaborationSaveTimer.current
      )
        return;
      const baseline = lastSavedCollaboration.current;
      try {
        const currentAccount = liveSnapshot.current.user;
        if (!currentAccount || currentAccount.status !== 'approved') return;
        const shared = await loadCollaborationState(currentAccount, forceRefresh);
        if (stopped) return;
        if (
          collaborationWriteInFlight.current ||
          collaborationSaveTimer.current ||
          (await loadCollaborationSyncOutbox(currentAccount.uid)) ||
          baseline !== lastSavedCollaboration.current
        ) {
          collaborationRefreshDeferred.current = true;
          return;
        }
        const merged = mergeLiveState(
          baseline,
          liveSnapshot.current.collaboration,
          shared,
        );
        lastSavedCollaboration.current = shared;
        cloudLoaded.current = true;
        if (
          JSON.stringify(merged) !==
          JSON.stringify(liveSnapshot.current.collaboration)
        )
          setCollaboration(merged);
        void saveLocalCollaboration(merged, currentAccount.uid).catch(() => setSyncStatus('error'));
      } catch {
        /* The stale entry remains stale and will retry on actual use. */
      }
    };
    const accountRefresh = createRefreshQueue(refreshAccount);
    const collaborationRefresh = createRefreshQueue(refreshCollaboration);
    requestCollaborationRefresh.current = collaborationRefresh.request;
    const disconnect = openLiveChannels(channels, (topic) => {
      if (['account', 'access', 'subscriptions', 'connected'].includes(topic)) accountRefresh.request();
      if (['collaboration', 'question-catalog', 'classification', 'catalog', 'review-queue', 'shared-notes', 'access', 'connected'].includes(topic))
        collaborationRefresh.request();
    });
    return () => {
      stopped = true;
      accountRefresh.stop();
      collaborationRefresh.stop();
      requestCollaborationRefresh.current = undefined;
      disconnect();
    };
  }, [liveChannels, collaborationHydrated, setUser]);

  const checkpointPersonalState = useCallback(
    async (kind: 'exam' | 'flashcards', testId?: string) => {
      if (!user) return;
      const snapshot = stateSnapshot.current;
      const receipt: PersonalStateReceipt = { session: personalStateSession.current, snapshot, dirtyBefore: stateDirty.current, full: false };
      const checkpointTest =
        kind === 'exam'
          ? (snapshot.tests.find((item) => item.id === testId) ??
            snapshot.tests.find((item) => item.status === 'active'))
          : undefined;
      const answerSelections = checkpointTest
        ? checkpointTest.questionIds.flatMap((questionId) => {
            const question = allQuestionsById.get(questionId);
            const qbankId =
              question?.qbankId ?? checkpointTest.qbankId ?? 'smle-gs';
            const answer =
              liveSnapshot.current.collaboration.answerStats[
                `${qbankId}:${questionId}`
              ]?.selections[user.uid];
            return Number.isInteger(answer)
              ? [{ qbankId, questionId, answer }]
              : [];
          })
        : [];
      const checkpointAnswerStats = liveSnapshot.current.collaboration.answerStats;
      checkpointInFlight.current += 1;
      setSyncStatus('syncing');
      try {
        await saveLocalState(user.uid, snapshot);
        if (personalStateSession.current !== receipt.session) return;
        if (!snapshot.settings.autoSync) {
          setSyncStatus(navigator.onLine ? 'local' : 'offline');
          return;
        }
        const remote =
          kind === 'exam'
            ? await saveExamCheckpoint(user.uid, snapshot, answerSelections)
            : await saveFlashcardCheckpoint(user.uid, snapshot);
        const result = acceptPersonalStateReceipt(receipt, remote);
        if (!result) return;
        if (kind === 'exam')
          lastSavedCollaboration.current = {
            ...lastSavedCollaboration.current,
            answerStats: checkpointAnswerStats,
          };
        if (remote && result.state !== snapshot) await saveLocalState(user.uid, result.state);
        if (personalStateSession.current !== receipt.session) return;
        setSyncStatus(navigator.onLine ? (result.dirty ? 'local' : 'synced') : 'offline');
      } catch {
        if (personalStateSession.current !== receipt.session) return;
        stateDirty.current = true;
        setSyncStatus(navigator.onLine ? 'local' : 'offline');
      } finally {
        if (personalStateSession.current === receipt.session) checkpointInFlight.current -= 1;
      }
    },
    [acceptPersonalStateReceipt, allQuestionsById, user],
  );
  const setFlashcardReviewActivity = useCallback((active: boolean) => {
    flashcardReviewActive.current = active;
  }, []);
  const checkpointFlashcardReview = useCallback(() => {
    if (document.visibilityState === 'hidden') return;
    void checkpointPersonalState('flashcards');
  }, [checkpointPersonalState]);
  const updateLocalTheme = useCallback(
    (nextTheme: LocalTheme) => {
      setTheme(nextTheme);
      if (user) saveLocalTheme(user.uid, nextTheme);
    },
    [user],
  );
  const toggleDashboardTheme = useCallback(() => {
    updateLocalTheme(
      document.documentElement.classList.contains('dark') ? 'light' : 'dark',
    );
  }, [updateLocalTheme]);
  const persistDailyGoal = useCallback(
    async (dailyGoal: number) => {
      if (!user) throw new Error('Sign in to save your daily goal.');
      const session = personalStateSession.current;
      const dirtyBefore = stateDirty.current;
      const next: AppState = {
        ...stateSnapshot.current,
        clientUpdatedAt: new Date().toISOString(),
        settings: { ...stateSnapshot.current.settings, dailyGoal },
      };
      const receipt: PersonalStateReceipt = { session, snapshot: next, dirtyBefore, full: false };
      stateSnapshot.current = next;
      stateDirty.current = true;
      cloudStateSnapshot.current = undefined;
      setStateRaw(next);
      setSyncStatus(navigator.onLine ? 'syncing' : 'offline');
      try {
        await saveLocalState(user.uid, next);
        if (personalStateSession.current !== session) return;
        const remote = await saveDailyGoal(user.uid, next, dailyGoal);
        const result = acceptPersonalStateReceipt(receipt, remote);
        if (!result) return;
        if (remote && result.state !== next) await saveLocalState(user.uid, result.state);
        if (personalStateSession.current !== session) return;
        setSyncStatus(navigator.onLine ? (result.dirty ? 'local' : 'synced') : 'offline');
      } catch (error) {
        if (personalStateSession.current !== session) return;
        setSyncStatus(navigator.onLine ? 'local' : 'offline');
        if (navigator.onLine) throw error;
      }
    },
    [acceptPersonalStateReceipt, user],
  );

  async function manualSync() {
    if (!user || !navigator.onLine) {
      setSyncStatus(navigator.onLine ? 'local' : 'offline');
      return;
    }
    setSyncStatus('syncing');
    const snapshot = stateSnapshot.current;
    const receipt: PersonalStateReceipt = { session: personalStateSession.current, snapshot, dirtyBefore: stateDirty.current, full: true };
    try {
      const next = { ...snapshot, lastSyncAt: new Date().toISOString() };
      const [remote, confirmed] = await Promise.all([
        saveCloudState(user.uid, next),
        saveCollaborationState(
          collaboration,
          lastSavedCollaboration.current,
          user.uid,
        ).then(async saved => (await retryRejectedCollaborationState(user.uid)) ?? saved),
      ]);
      const result = acceptPersonalStateReceipt(receipt, remote);
      if (!result) return;
      const synchronized = result.state;
      const localCollaboration = mergeLiveState(collaboration, liveSnapshot.current.collaboration, confirmed);
      await Promise.all([
        saveLocalState(user.uid, synchronized),
        saveLocalCollaboration(localCollaboration, user.uid),
      ]);
      if (personalStateSession.current !== receipt.session) return;
      lastSavedCollaboration.current = confirmed;
      const drafts = await loadRejectedCollaboration(user.uid);
      if (personalStateSession.current !== receipt.session) return;
      setSyncIssue(drafts.length ? 'Some changes still need review. Sync now retries preserved contribution deletions; changed or unauthorized items stay available to download.' : '');
      setSyncStatus(stateDirty.current ? 'local' : 'synced');
    } catch (error) {
      if (personalStateSession.current !== receipt.session) return;
      reportSyncError(error);
    }
  }

  async function signOut() {
    await signOutCloudflare();
    setUser(null);
    setHydrated(false);
    setCollaborationHydrated(false);
    setStateRaw(initialAppState());
    flashcardCrudSnapshot.current = '';
    setCollaboration(initialCollaborationState());
    setView('dashboard');
  }

  const requestExamUpgrade = useCallback((reason: ExamUpgradeReason) => {
    if (!user) return;
    const plan = user.effectivePlan ?? user.tier;
    if (reason === 'questions' && plan !== 'free') return;
    setTestError('');
    setExamUpgradeRequest({ uid: user.uid, plan, reason });
  }, [user]);
  const handleTestFailure = useCallback((error: unknown, fallback: string) => {
    const reason = examRestriction(error);
    if (reason && (reason === 'exams' || (user?.effectivePlan ?? user?.tier) === 'free')) requestExamUpgrade(reason);
    else setTestError(error instanceof Error ? error.message : fallback);
  }, [requestExamUpgrade, user]);
  const createTest = useCallback(
    async (config: TestBuilderConfig) => {
      if (!user || creatingTest.current) return;
      setTestError('');
      setExamUpgradeRequest(null);
      const limits = (user.planLimits ?? getPlanLimits(user.effectivePlan ?? user.tier));
      if (config.count > limits.maxQuestionsPerExam) {
        if ((user.effectivePlan ?? user.tier) === 'free') { requestExamUpgrade('questions'); return; }
        setTestError(
          `${limits.name} allows a maximum of ${limits.maxQuestionsPerExam} questions per exam. Your selections are preserved.`,
        );
        return;
      }
      if (!navigator.onLine) {
        setTestError(
          'Connect to the internet to securely register this started exam. Your selections are preserved.',
        );
        return;
      }
      let selected: Question[];
      let testBaseState = state;
      creatingTest.current = true;
      try {
        // Persist personal questions/overrides before using the same server pool
        // as the counter. Plan rules remain in the existing exam registration.
        const remote = await saveCloudState(user.uid, state);
        if (remote) {
          testBaseState = mergeAppStates(state, remote);
          stateSnapshot.current = testBaseState;
          cloudStateSnapshot.current = testBaseState;
          setStateRaw(testBaseState);
          await saveLocalState(user.uid, testBaseState);
        }
        const result = await api<{ questions: Question[] }>(
          '/platform/test-pool',
          {
            method: 'POST',
            body: JSON.stringify({
              qbankId: activeQBankId,
              config,
              select: true,
            }),
          },
        );
        selected = result.questions;
        setExamPool(selected);
      } catch (error) {
        handleTestFailure(error, 'Unable to select questions.');
        return;
      } finally {
        creatingTest.current = false;
      }
      if (!selected.length) {
        setView('create');
        return;
      }
      const now = new Date().toISOString();
      const bankName =
        collaboration.qbanks.find((item) => item.id === activeQBankId)?.name ??
        'QBank';
      const title =
        config.title?.trim().replace(/\s+/g, ' ') ||
        nextTestTitle(bankName, testBaseState.tests);
      if (
        testBaseState.tests.some(
          (item) =>
            normalizedTestTitle(item.title) === normalizedTestTitle(title),
        )
      ) {
        setTestError('This test title already exists. Choose another name.');
        setView('create');
        return;
      }
      const test: TestSession = {
        id: crypto.randomUUID(),
        title,
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
        const registration = await registerStartedExam(test.id, test.questionIds.length);
        if (!registration.duplicate) window.dispatchEvent(new CustomEvent('qraft-exam-started', { detail: { uid: user.uid } }));
        setState((current) => ({
          ...current,
          tests: [test, ...current.tests],
        }));
        setActiveTestId(test.id);
        setView('test');
      } catch (error) {
        handleTestFailure(error, 'Unable to create test. Your selections are preserved.');
      } finally {
        creatingTest.current = false;
      }
    },
    [state, collaboration.qbanks, activeQBankId, setState, setView, user, requestExamUpgrade, handleTestFailure],
  );

  const quickTest = useCallback(() => {
    const specialty = questions[0]?.specialty ?? 'General';
    void createTest({
      mode: 'tutor',
      statuses: ['new'],
      specialty,
      topics: [],
      count: Math.min(
        state.settings.dailyGoal,
        questions.filter(
          (question) => getQuestionProgress(state, question.id).attempts === 0,
        ).length,
      ),
    });
  }, [createTest, questions, state]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike })
      .modelContext;
    if (
      !context?.registerTool ||
      !user ||
      !hydrated ||
      !collaborationHydrated ||
      user.status !== 'approved'
    )
      return;
    const lifecycle = new AbortController();
    const completed = questions.filter(
      (question) => getQuestionProgress(state, question.id).attempts > 0,
    ).length;
    void Promise.resolve(
      context.registerTool(
        {
          name: 'get_medguard_progress',
          title: 'Get Qraft progress',
          description:
            'Read the signed-in learner’s current Qraft question-bank progress summary.',
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
            flagged: questions.filter(
              (question) => getQuestionProgress(state, question.id).flagged,
            ).length,
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
          description:
            'Create and open a Tutor-mode test from new questions in the learner’s active QBank using the daily goal.',
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
              questionCount: Math.min(
                state.settings.dailyGoal,
                questions.length - completed,
              ),
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
    return (
      <SystemStatePage
        kind="offline"
        onRetry={() => {
          if (navigator.onLine) window.location.reload();
        }}
        onContinue={
          user && hydrated && collaborationHydrated
            ? () => setOfflineDismissed(true)
            : undefined
        }
      />
    );
  if (user === undefined) return <AppLoadingScreen status="Starting Qraft…" />;
  if (directTestCode) {
    const participant =
      user?.status === 'approved' && !user.suspended ? user : null;
    return (
      <PreformedTestRunner
        key={`${participant?.uid ?? 'guest'}:${directTestCode}`}
        user={participant}
        code={directTestCode}
        onTestEntered={participant ? recordStudyVisit : undefined}
        onClose={() => {
          clearTestLink();
          setDirectTestCode('');
          if (participant) setView('preformed');
        }}
        onJoinQraft={() => {
          clearTestLink();
          setDirectTestCode('');
        }}
      />
    );
  }
  if (!user)
    return (
      <AuthScreen
        onAuthenticated={setUser}
        onJoinTest={(code) => {
          const url = new URL(window.location.href);
          url.searchParams.set('join_test', code);
          window.history.replaceState(
            {},
            '',
            `${url.pathname}${url.search}${url.hash}`,
          );
          setDirectTestCode(code);
        }}
      />
    );
  if (user.status !== 'approved' || user.suspended)
    return <PendingApproval user={user} onSignOut={() => void signOut()} />;
  if (user.role === 'super_admin' && !user.mfaEnrolled)
    return (
      <MfaEnrollmentGate
        onComplete={() =>
          setUser({ ...user, mfaEnrolled: true, mfaVerified: true })
        }
        onSignOut={() => void signOut()}
      />
    );
  if (!hydrated || !collaborationHydrated)
    return <AppLoadingScreen status="Syncing your workspace…" />;
  if (portal === 'superadmin') {
    if (user.role !== 'super_admin' || !user.mfaVerified)
      return (
        <main className="grid min-h-screen place-items-center bg-background p-6">
          <section className="w-full max-w-lg rounded-3xl border bg-card p-8 text-center shadow-xl">
            <ShieldCheck className="mx-auto size-10 text-muted-foreground" />
            <h1 className="mt-5 text-2xl font-bold">
              Superadmin access required
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              This workspace is available only to the verified Superadmin
              account.
            </p>
            <Link
              href="/"
              className="q-button q-button-primary mt-6 inline-flex"
            >
              Return to Qraft
            </Link>
          </section>
        </main>
      );
    return (
      <main className="q-admin-dashboard min-h-screen bg-background text-foreground">
        <AdminDashboard
          user={user}
          collaboration={collaboration}
          update={(updater) => setCollaboration(updater)}
          replaceFromServer={replaceCollaborationFromServer}
          scope="superadmin"
          onSignOut={() => void signOut()}
        />
      </main>
    );
  }
  if (view === 'test' && activeTest)
    return (
      <TestView
        confirmUpdate={confirmUpdate}
        user={user}
        test={activeTest}
        questions={allQuestions}
        state={state}
        setState={setState}
        collaboration={collaboration}
        updateCollaboration={(updater) => setCollaboration(updater)}
        onExit={(destination) => {
          setActiveTestId(undefined);
          setView(
            destination ??
              (activeTest.status === 'completed' ? 'history' : 'dashboard'),
          );
          window.setTimeout(
            () => void checkpointPersonalState('exam', activeTest.id),
            0,
          );
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
        questions={allQuestions.filter(
          (question) => (question.qbankId ?? 'smle-gs') === managedBank.id,
        )}
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
    <>
      <UpgradeDialog user={user} onUser={setUser} />
      <AlertDialog open={Boolean(linkInvitation)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
              <UserPlus className="size-5" />
            </AlertDialogMedia>
            <AlertDialogTitle>QBank invitation</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">
                {linkInvitation?.ownerName}
              </strong>{' '}
              invited you to join{' '}
              <strong className="text-foreground">
                {linkInvitation?.bankName}
              </strong>{' '}
              as a viewer.
              {linkInvitation?.description && (
                <span className="mt-2 block">{linkInvitation.description}</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {linkInvitationError && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {linkInvitationError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={declineLinkInvitation}
              disabled={linkInvitationBusy}
            >
              Decline
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void acceptLinkInvitation()}
              disabled={linkInvitationBusy}
            >
              {linkInvitationBusy ? 'Joining…' : 'Accept'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {updateAvailable && (
        <output className="q-update-toast" aria-live="polite">
          <div>
            <strong>A Qraft update is ready</strong>
            <span>Your current work is saved before refresh.</span>
          </div>
          <button type="button" onClick={() => void activateAppUpdate()}>
            <RefreshCw className="size-4" /> Update
          </button>
          <button
            type="button"
            className="q-update-dismiss"
            aria-label="Dismiss update notice"
            onClick={() => setUpdateAvailable(false)}
          >
            <X className="size-4" />
          </button>
        </output>
      )}
      <QraftAppShell
        contentKey={view}
        navigationOpen={mobileOpen}
        handheldNavigation={<StudyMobileNav view={view} onNavigate={setView} />}
        tabletNavigation={
          <StudyTabletRail
            view={view}
            onNavigate={setView}
            onMore={() => setMobileOpen(true)}
            showReview={showReview}
            showSubscribe={user.role !== 'super_admin'}
          />
        }
        navigation={
          <AppSidebar
            view={view}
            setView={setView}
            user={user}
            syncStatus={syncStatus}
            onSignOut={() => void signOut()}
            mobileOpen={mobileOpen}
            closeMobile={() => setMobileOpen(false)}
            qbanks={accessibleQBanks}
            quickAccessQBankIds={state.settings.quickAccessQBankIds}
            activeQBankId={activeQBankId}
            onSelectQBank={(id) => {
              const nextBank = collaboration.qbanks.find(
                (bank) => bank.id === id,
              );
              setState((current) => ({
                ...current,
                settings: { ...current.settings, activeQBankId: id },
              }));
              if (
                view === 'review' &&
                (!nextBank ||
                  !canReviewBank(user, nextBank, collaboration.memberships))
              )
                setView('dashboard');
            }}
            showReview={showReview}
            pendingReviewCount={pendingReviewCount}
            dueFlashcardCount={dueFlashcardCount}
            persistent={presentation.mode === 'desktop'}
          />
        }
      >
        {syncIssue && view !== 'test' && view !== 'settings' && <output className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <span>{syncIssue}</span>
          <button type="button" className="shrink-0 underline" onClick={() => setView('settings')}>Open Settings</button>
        </output>}
        <ExamAccessNotice user={user} request={examUpgradeRequest} defer={view === 'test' || view === 'subscribe' || portal !== 'app'} onViewPlans={() => { setExamUpgradeRequest(null); setTestError(''); setView('subscribe'); }} />
        <SiteAnnouncement userId={user.uid} defer={view === 'test' || portal !== 'app'} />
        {view === 'subscribe' && (
          <>
            <PageHeader
              title="Subscription"
              subtitle="Plans and account access"
              openMenu={() =>
                window.dispatchEvent(new Event('medguard-open-menu'))
              }
            />
            <Subscribe user={user} onUser={setUser} />
          </>
        )}
        {view === 'contact' && (
          <>
            <PageHeader
              title="Contact Us"
              subtitle="Private support for technical, account, and question issues"
              openMenu={() =>
                window.dispatchEvent(new Event('medguard-open-menu'))
              }
            />
            <ContactWorkspace />
          </>
        )}
        {view === 'account' && <AccountProfile user={user} onUser={setUser} />}
        {testError && (
          <div
            role="alert"
            className="m-4 rounded-xl border border-amber-400 bg-card p-4"
          >
            <p>{testError}</p>
          </div>
        )}
        {view === 'dashboard' && (
          <StudyDashboard
            state={state}
            questions={questions}
            name={user.displayName}
            bankName={
              collaboration.qbanks.find((bank) => bank.id === activeQBankId)
                ?.name
            }
            navigate={setView}
            startQuickTest={quickTest}
            theme={theme}
            onToggleTheme={toggleDashboardTheme}
          />
        )}
        {view === 'library' && (
          <QBankWorkspace
            confirmUpdate={confirmUpdate}
            user={user}
            collaboration={collaboration}
            questionPool={allQuestions}
            update={(updater) => setCollaboration(updater)}
            activeQBankId={activeQBankId}
            organization={{
              favoriteIds: state.settings.favoriteQBankIds,
              pinnedIds: state.settings.pinnedQBankIds,
              quickAccessIds: state.settings.quickAccessQBankIds,
              orderBySection: state.settings.qbankOrderBySection,
            }}
            bookmarkedQuestionIds={bookmarkedQuestionIds}
            onToggleBookmark={(questionId) =>
              setState((current) => {
                const old = getQuestionProgress(current, questionId);
                return {
                  ...current,
                  progress: {
                    ...current.progress,
                    [questionId]: {
                      ...old,
                      bookmarked: !old.bookmarked,
                      updatedAt: new Date().toISOString(),
                    },
                  },
                };
              })
            }
            onStartBookmarks={(bankId, questionIds, title) => {
              if (!accessibleQBanks.some(bank => bank.id === bankId)) return;
              const test = createBookmarkStudySession({
                bankId, questionIds, title, questionsById: allQuestionsById, progress: state.progress,
              });
              if (!test) return;
              setState((current) => ({
                ...current,
                tests: [test, ...current.tests],
              }));
              setActiveTestId(test.id);
              setView('test');
            }}
            updateOrganization={(organization) =>
              setState((current) => ({
                ...current,
                settings: {
                  ...current.settings,
                  favoriteQBankIds: organization.favoriteIds,
                  pinnedQBankIds: organization.pinnedIds,
                  quickAccessQBankIds: organization.quickAccessIds.slice(0, 5),
                  qbankOrderBySection: organization.orderBySection,
                },
              }))
            }
            onSelect={(id) => {
              setState((current) => ({
                ...current,
                settings: { ...current.settings, activeQBankId: id },
              }));
              setView('dashboard');
            }}
            onManageBank={(id, section) => {
              setManagedBank({ id, section });
              setView('qbank-management');
            }}
          />
        )}
        {view === 'review' && showReview && (
          <ReviewWorkspace
            activeQBankId={activeQBankId}
            user={user}
            collaboration={collaboration}
            update={(updater) => setCollaboration(updater)}
            replaceFromServer={replaceCollaborationFromServer}
          />
        )}
        {view === 'create' && (
          <CreateTest
            key={activeQBankId}
            questions={questions}
            state={state}
            bankName={activeQBank?.name ?? 'QBank'}
            maxQuestionsPerExam={
              (user.planLimits ?? getPlanLimits(user.effectivePlan ?? user.tier)).maxQuestionsPerExam
            }
            onStart={createTest}
            onQuestionLimit={() => requestExamUpgrade('questions')}
          />
        )}
        {view === 'preformed' && (
          <PreformedTestsWorkspace
            user={user}
            onUpgrade={openUpgrade}
            onRunTest={(code) => {
              const url = new URL(window.location.href);
              url.searchParams.set('join_test', code);
              window.history.replaceState(
                {},
                '',
                `${url.pathname}${url.search}${url.hash}`,
              );
              setDirectTestCode(code);
            }}
          />
        )}
        {view === 'history' && (
          <HistoryView
            state={{
              ...state,
              tests: state.tests.filter(
                (test) =>
                  (test.origin !== 'bookmarks' || test.status === 'active') &&
                  (test.qbankId ??
                    allQuestions.find(
                      (question) => question.id === test.questionIds[0],
                    )?.qbankId ??
                    'smle-gs') === activeQBankId,
              ),
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
        {view === 'progress' && (
          <ProgressView
            key={activeQBankId}
            state={state}
            questions={questions}
            specialties={collaboration.specialties.filter((item) => item.qbankId === activeQBankId)}
            topics={collaboration.topics.filter((item) => item.qbankId === activeQBankId)}
            maxQuestions={(user.planLimits ?? getPlanLimits(user.effectivePlan ?? user.tier)).maxQuestionsPerExam}
            onStudy={createTest}
          />
        )}
        {view === 'flashcards' && (
          <FlashcardsWorkspace
            key={activeQBankId}
            state={state}
            setState={setState}
            qbankId={activeQBankId}
            qbankName={activeQBank?.name ?? 'QBank'}
            questions={questions}
            onReviewActiveChange={setFlashcardReviewActivity}
            onReviewCheckpoint={checkpointFlashcardReview}
          />
        )}
        {view === 'settings' && (
          <SettingsView
            onAccountDeleted={() => {
              setUser(null);
              setState(initialAppState());
              setCollaboration(initialCollaborationState());
              setView('dashboard');
            }}
            state={state}
            theme={theme}
            onThemeChange={updateLocalTheme}
            onSaveDailyGoal={persistDailyGoal}
            syncStatus={syncStatus}
            onSync={() => void manualSync()}
            syncIssue={syncIssue}
            collaboration={collaboration}
            user={user}
            updateCollaboration={(updater) => setCollaboration(updater)}
          />
        )}
        {view === 'manager' && (
          <QuestionManager
            confirmUpdate={confirmUpdate}
            user={user}
            collaboration={collaboration}
            updateCollaboration={(updater) => setCollaboration(updater)}
            questions={questions}
            allQuestions={allQuestions}
            activeQBankId={activeQBankId}
          />
        )}
        {view === 'contribution-center' && (
          <>
            <PageHeader
              title="Contribution Center"
              subtitle="Credits, rewards, and contribution activity"
              openMenu={() =>
                window.dispatchEvent(new Event('medguard-open-menu'))
              }
            />
            <ContributionCenter
              userId={user.uid}
              onEntitlementChange={(next) => {
                setAuthenticatedUserCache(next);
                setUser(next);
              }}
            />
          </>
        )}
        {view === 'admin' && user.isAdmin && (
          <AdminDashboard
            user={user}
            collaboration={collaboration}
            update={(updater) => setCollaboration(updater)}
            replaceFromServer={replaceCollaborationFromServer}
            scope="access"
          />
        )}
      </QraftAppShell>
    </>
  );
}
