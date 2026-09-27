'use client';

import {
  Activity,
  BarChart3,
  CreditCard,
  FileText,
  Flag,
  LayoutDashboard,
  Coins,
  Ticket,
  Users,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  Clock3,
  Command,
  Database,
  Download,
  Eye,
  EyeOff,
  Fingerprint,
  Inbox,
  LogOut,
  Megaphone,
  Menu,
  MessageSquareText,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  UserRoundX,
} from 'lucide-react';
import { QraftBrand } from '@/components/brand/qraft-brand';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  administrativeRoleLabels,
  canReviewBank,
  hasAccessManagerRole,
  hasModeratorRole,
  hasReviewerRole,
  isPlatformRole,
} from '@/features/access/domain/access-policy';
import {
  normalizeEmail,
  normalizePhone,
  normalizeUniversityId,
  type AccessBlocklist,
  type AccountStatus,
  type AppUser,
  type AuditEntry,
  type CollaborationState,
  type MemberProfile,
  type PlatformRole,
} from '@/lib/medguard-types';
import { cn as cx, nowIso } from '@/lib/utils';
import { SubscriptionAdmin } from '@/components/subscription-workspace';
import { ReviewerPerformance } from '@/components/reviewer-performance';
import { EconomyAdmin } from '@/components/economy-admin';
import { ContactWorkspace } from '@/components/contact-workspace';
import { QuestionPreview } from '@/components/question-tools';
import { ReviewWorkspace } from '@/components/review-workspace';
import { PreformedReportsAdmin } from '@/components/preformed-tests-workspace';
import { QBankFolderManager } from '@/components/qbank-folder-manager';
import { JsonImportMonitor } from '@/components/json-import-monitor';
import { api, invalidateApiResources, setApiCache } from '@/lib/api-client';
import { deleteQBankImages } from '@/lib/application-services';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';

type Tab =
  | 'reviewer-performance'
  | 'discounts'
  | 'subscriptions'
  | 'economy'
  | 'contact'
  | 'question-preview'
  | 'overview'
  | 'registrations'
  | 'blocked'
  | 'roles'
  | 'qbanks'
  | 'proposals'
  | 'ready-tests'
  | 'json-imports'
  | 'student-ids'
  | 'announcement'
  | 'backups'
  | 'legal'
  | 'audit';
const adminGroups: Array<{ label: string; ids: Tab[] }> = [
  { label: 'OVERVIEW', ids: ['overview', 'reviewer-performance'] },
  {
    label: 'OPERATIONS',
    ids: [
      'proposals',
      'json-imports',
      'ready-tests',
      'contact',
      'registrations',
    ],
  },
  { label: 'USERS & ACCESS', ids: ['student-ids', 'roles', 'blocked'] },
  { label: 'BILLING', ids: ['subscriptions', 'discounts', 'economy'] },
  { label: 'QBANK', ids: ['qbanks', 'question-preview'] },
  { label: 'SYSTEM', ids: ['announcement', 'backups', 'legal', 'audit'] },
];
const adminSections: Record<
  Tab,
  { icon: typeof ShieldCheck; description: string }
> = {
  overview: {
    icon: LayoutDashboard,
    description:
      'Your platform at a glance. Prioritize the work that matters today.',
  },
  'reviewer-performance': {
    icon: BarChart3,
    description: 'Track review quality, contribution and team performance.',
  },
  registrations: {
    icon: Users,
    description:
      'Review applications, verify identities and manage account access.',
  },
  blocked: {
    icon: UserRoundX,
    description: 'Manage suspended accounts and the access blocklist.',
  },
  roles: {
    icon: ShieldCheck,
    description: 'Review role requests and manage administrative permissions.',
  },
  'student-ids': {
    icon: Fingerprint,
    description: 'Maintain the student registry and verify eligibility.',
  },
  subscriptions: {
    icon: CreditCard,
    description: 'Manage plans, activations and subscription access.',
  },
  discounts: {
    icon: Ticket,
    description: 'Create and manage promotional codes.',
  },
  economy: {
    icon: Coins,
    description: 'Manage platform credits, rewards and incentives.',
  },
  contact: {
    icon: MessageSquareText,
    description: 'Respond to support requests and follow up with members.',
  },
  qbanks: {
    icon: BookOpen,
    description: 'Inspect the question banks available across your platform.',
  },
  proposals: {
    icon: Inbox,
    description: 'Review proposed questions and changes before publication.',
  },
  'json-imports': {
    icon: Upload,
    description:
      'Monitor server-side JSON imports, duplicate handling and rejected files.',
  },
  'ready-tests': {
    icon: Flag,
    description:
      'Review reported public tests and hide unsafe content directly.',
  },
  'question-preview': {
    icon: Search,
    description: 'Find and inspect questions in the learner experience.',
  },
  announcement: {
    icon: Megaphone,
    description: 'Manage the announcement shown across the learner workspace.',
  },
  backups: {
    icon: Database,
    description: 'Export platform data and manage recovery operations.',
  },
  legal: {
    icon: FileText,
    description: 'Maintain the terms of use and privacy links.',
  },
  audit: {
    icon: Activity,
    description: 'Inspect administrative events and trace changes over time.',
  },
};
type BlockKind = keyof AccessBlocklist;
function formatDate(value?: string) {
  return value
    ? new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : '—';
}

function relativeAge(value: string | undefined, now: number) {
  if (!value) return '—';
  const seconds = Math.max(
    0,
    Math.floor((now - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : formatDate(value);
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function mondayOf(date: Date) {
  const result = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7));
  return result;
}

function weeksForMonth(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const weeks: string[] = [];
  for (
    let cursor = mondayOf(first);
    cursor <= last;
    cursor = new Date(cursor.getTime() + 7 * 86_400_000)
  )
    weeks.push(isoDay(cursor));
  return weeks;
}

function activityLabel(entry: AuditEntry) {
  const actions: Record<string, string> = {
    registration_approved: 'approved a registration',
    registration_rejected: 'rejected a registration',
    account_blocked: 'blocked an account',
    account_restored: 'restored an account',
    account_roles_saved: 'updated participant permissions',
    role_request_approved: 'approved a role request',
    role_request_rejected: 'rejected a role request',
    reward_activated: 'activated a reward plan',
    subscription_expired: 'had a subscription expire',
  };
  return `${entry.actorName} ${actions[entry.action] ?? entry.action.replaceAll('_', ' ')}`;
}
function audit(
  user: AppUser,
  action: string,
  entityType: AuditEntry['entityType'],
  entityId: string,
  detail: string,
): AuditEntry {
  return {
    id: crypto.randomUUID(),
    action,
    entityType,
    entityId,
    actorId: user.uid,
    actorName: user.displayName,
    createdAt: nowIso(),
    detail,
  };
}

function normalizeBlockValue(kind: BlockKind, value: string): string {
  if (kind === 'phones') return normalizePhone(value);
  if (kind === 'universityIds') return normalizeUniversityId(value);
  return normalizeEmail(value);
}

function memberMatchesBlocklist(
  member: MemberProfile,
  blockedAccess: AccessBlocklist,
): boolean {
  return Boolean(
    (member.phone &&
      blockedAccess.phones.includes(normalizePhone(member.phone))) ||
    blockedAccess.universityIds.includes(
      normalizeUniversityId(member.universityId),
    ) ||
    blockedAccess.emails.includes(normalizeEmail(member.email)),
  );
}

function LegalLinksAdmin() {
  const [links, setLinks] = useState({ termsUrl: '', privacyUrl: '' });
  const original = useRef(links);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void api<typeof links>('/platform/legal-links')
      .then((value) => {
        if (active) {
          setLinks(value);
          original.current = value;
        }
      })
      .catch((error) => {
        if (active)
          setMessage(
            error instanceof Error ? error.message : 'Unable to load links.',
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const save = async () => {
    const normalized = {
      termsUrl: links.termsUrl.trim(),
      privacyUrl: links.privacyUrl.trim(),
    };
    if (JSON.stringify(normalized) === JSON.stringify(original.current)) {
      setMessage('No changes to save.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const saved = await api<typeof links>('/platform/legal-links', {
        method: 'PUT',
        body: JSON.stringify(normalized),
      });
      setLinks(saved);
      original.current = saved;
      setApiCache('/platform/legal-links', saved);
      setMessage('Legal links saved.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to save links.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
      <h2 className="font-bold">Terms & privacy links</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        These links appear in Settings for every approved user. Use HTTPS links
        or internal paths beginning with /.
      </p>
      <div className="mt-5 grid gap-4">
        <label className="grid gap-2 text-sm font-semibold">
          Terms of use URL
          <input
            type="url"
            value={links.termsUrl}
            onChange={(event) =>
              setLinks((current) => ({
                ...current,
                termsUrl: event.target.value,
              }))
            }
            placeholder="https://example.com/terms"
            className="h-11 rounded-xl border bg-background px-3 font-normal"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Privacy policy URL
          <input
            type="url"
            value={links.privacyUrl}
            onChange={(event) =>
              setLinks((current) => ({
                ...current,
                privacyUrl: event.target.value,
              }))
            }
            placeholder="https://example.com/privacy"
            className="h-11 rounded-xl border bg-background px-3 font-normal"
          />
        </label>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="q-button q-button-primary"
        >
          <Save className="size-4" />
          {busy ? 'Saving…' : 'Save links'}
        </button>
        {message && (
          <output className="text-sm text-muted-foreground">{message}</output>
        )}
      </div>
    </section>
  );
}

function AnnouncementAdmin() {
  const [value, setValue] = useState({ enabled: false, content: '', href: '' });
  const original = useRef(value);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void api<typeof value>('/platform/announcement')
      .then((next) => {
        if (active) {
          setValue(next);
          original.current = next;
        }
      })
      .catch((error) => {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : 'Unable to load announcement.',
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const save = async () => {
    const normalized = {
      enabled: value.enabled,
      content: value.content.trim(),
      href: value.href.trim(),
    };
    if (JSON.stringify(normalized) === JSON.stringify(original.current)) {
      setMessage('No changes to save.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const saved = await api<typeof value>('/platform/announcement', {
        method: 'PUT',
        body: JSON.stringify(normalized),
      });
      setValue(saved);
      original.current = saved;
      setApiCache('/platform/announcement', saved);
      setMessage('Announcement saved and published.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to save announcement.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Megaphone className="size-5" />
        </span>
        <div>
          <h2 className="font-bold">Site announcement bar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Publish one compact announcement across the main application.
          </p>
        </div>
      </div>
      <label className="mt-5 grid gap-2 text-sm font-semibold">
        Announcement content
        <textarea
          maxLength={280}
          value={value.content}
          onChange={(event) =>
            setValue((current) => ({ ...current, content: event.target.value }))
          }
          className="min-h-28 rounded-xl border bg-background p-3 font-normal"
          placeholder="Write a short announcement…"
        />
      </label>
      <div className="mt-1 text-right text-xs text-muted-foreground">
        {value.content.length}/280
      </div>
      <label className="mt-4 grid gap-2 text-sm font-semibold">
        Optional action link
        <input
          value={value.href}
          onChange={(event) =>
            setValue((current) => ({ ...current, href: event.target.value }))
          }
          className="h-11 rounded-xl border bg-background px-3 font-normal"
          placeholder="https://… or /internal-page"
        />
      </label>
      <label className="mt-5 flex items-center gap-3 rounded-xl border bg-muted/25 p-3 text-sm font-semibold">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) =>
            setValue((current) => ({
              ...current,
              enabled: event.target.checked,
            }))
          }
          className="size-4 accent-primary"
        />
        Show announcement on the site
      </label>
      {value.content && (
        <div className="mt-5 rounded-xl bg-gradient-to-r from-primary via-cyan-600 to-teal-600 px-4 py-3 text-center text-sm font-bold text-white">
          {value.content}
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="q-button q-button-primary"
        >
          <Save className="size-4" />
          {busy ? 'Saving…' : 'Save announcement'}
        </button>
        {message && (
          <output className="text-sm text-muted-foreground">{message}</output>
        )}
      </div>
    </section>
  );
}

function BackupAdmin() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const download = async () => {
    setBusy(true);
    setMessage('');
    try {
      const backup = await api<Record<string, unknown>>(
        '/platform/content-backup',
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: 'application/json',
        }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `qraft-content-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage('Backup downloaded. Keep it in a secure location.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to create backup.',
      );
    } finally {
      setBusy(false);
    }
  };
  const restore = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const raw = await file.text();
      if (raw.length > 50_000_000)
        throw new Error('Backup exceeds the 50 MB restore limit.');
      const result = await api<{ restored: number }>(
        '/platform/content-backup',
        { method: 'PUT', body: raw },
      );
      setMessage(
        `${result.restored.toLocaleString()} records restored successfully.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to restore backup.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Database className="size-5" />
        </span>
        <div>
          <h2 className="font-bold">Content backup & restore</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Includes public and private QBanks, questions, answers,
            explanations, sources, proposals and memberships. Private ownership
            remains unchanged.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          onClick={() => void download()}
          disabled={busy}
          className="q-button q-button-primary"
        >
          <Download className="size-4" />
          Download readable backup
        </button>
        <label className="q-button q-button-secondary cursor-pointer">
          <Upload className="size-4" />
          Restore backup
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              void restore(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
      </div>
      <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
        Restoration updates matching content records. Accounts, passwords,
        subscriptions and payment records are intentionally excluded.
      </p>
      {message && (
        <output className="mt-3 block text-sm text-muted-foreground">
          {message}
        </output>
      )}
    </section>
  );
}

export function AdminDashboard({
  user,
  collaboration,
  update,
  replaceFromServer,
  scope = 'access',
  onSignOut,
}: {
  user: AppUser;
  collaboration: CollaborationState;
  update: (
    updater: (current: CollaborationState) => CollaborationState,
  ) => void;
  replaceFromServer: (next: CollaborationState) => void;
  scope?: 'access' | 'superadmin';
  onSignOut?: () => void;
}) {
  const canAccess = hasAccessManagerRole(user);
  const isModerator = hasModeratorRole(user);
  const isRoot = user.role === 'super_admin';
  const isSuperadminWorkspace = scope === 'superadmin' && isRoot;
  const tabs = useMemo(
    () =>
      isSuperadminWorkspace
        ? ([
            ['overview', 'Overview'],
            ['reviewer-performance', 'Reviewer Performance'],
            ['registrations', 'Registrations'],
            ['blocked', 'Blocked users'],
            ['roles', 'Roles & permissions'],
            ['student-ids', 'Student IDs'],
            ['subscriptions', 'Subscriptions'],
            ['discounts', 'Discount codes'],
            ['economy', 'Credits & rewards'],
            ['contact', 'Contact tickets'],
            ['qbanks', 'All QBanks'],
            ['proposals', 'Review queue'],
            ['json-imports', 'JSON imports'],
            ['ready-tests', 'Reported tests'],
            ['question-preview', 'Question preview'],
            ['announcement', 'Announcement bar'],
            ['backups', 'Backup & restore'],
            ['legal', 'Terms & privacy'],
            ['audit', 'Audit log'],
          ] as Array<[Tab, string]>)
        : ([
            ['overview', 'Overview'],
            ['reviewer-performance', 'Reviewer Performance'],
            ...(canAccess
              ? [['registrations', 'Registrations'] as [Tab, string]]
              : []),
            ...(canAccess
              ? [['blocked', 'Blocked users'] as [Tab, string]]
              : []),
            ...(isModerator
              ? [['roles', 'Roles & permissions'] as [Tab, string]]
              : []),
          ] as Array<[Tab, string]>),
    [canAccess, isModerator, isSuperadminWorkspace],
  );
  const [tab, setTab] = useState<Tab>('overview');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [qbankActionId, setQbankActionId] = useState('');
  const [qbankActionMessage, setQbankActionMessage] = useState('');
  const [confirmQBankAction, qbankConfirmationDialog] = useConfirmationDialog();
  const adminContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    adminContentRef.current?.scrollTo({ top: 0 });
  }, [tab]);
  const [dashboardNow] = useState(() => Date.now());
  const [qbankScope, setQbankScope] = useState('all');
  const [adminSearchOpen, setAdminSearchOpen] = useState(false);
  const [adminSearch, setAdminSearch] = useState('');
  const adminSearchRef = useRef<HTMLInputElement>(null);
  const adminSearchTriggerRef = useRef<HTMLButtonElement>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberStatus, setMemberStatus] = useState('all');
  const [memberPage, setMemberPage] = useState(0);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditPage, setAuditPage] = useState(0);
  const [auditYear, setAuditYear] = useState(() => new Date().getUTCFullYear());
  const [auditMonth, setAuditMonth] = useState(() => new Date().getUTCMonth());
  const [auditWeek, setAuditWeek] = useState(() =>
    isoDay(mondayOf(new Date())),
  );
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditLimited, setAuditLimited] = useState(false);
  const auditWeeks = useMemo(
    () => weeksForMonth(auditYear, auditMonth),
    [auditYear, auditMonth],
  );
  useEffect(() => {
    if (!isRoot || (tab !== 'audit' && tab !== 'overview') || !auditWeek)
      return;
    let active = true;
    const timer = window.setTimeout(() => {
      setAuditBusy(true);
      void api<{ entries: AuditEntry[]; limited: boolean }>(
        `/platform/audit-week?start=${encodeURIComponent(auditWeek)}`,
      )
        .then((result) => {
          if (active) {
            setAuditEntries(result.entries);
            setAuditLimited(result.limited);
          }
        })
        .catch(() => {
          if (active) {
            setAuditEntries([]);
            setAuditLimited(false);
          }
        })
        .finally(() => {
          if (active) setAuditBusy(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [auditWeek, isRoot, refreshRevision, tab]);

  async function refreshAdministration() {
    if (!isSuperadminWorkspace || refreshBusy) return;
    setRefreshBusy(true);
    invalidateApiResources(
      [
        'collaboration',
        'question-catalog',
        'review-queue',
        'reviewer-performance',
        'subscriptions',
        'discounts',
        'pricing',
        'economy',
        'contributions',
        'contact',
        'announcement',
        'legal-links',
        'audit',
        'review-history',
        'preformed-tests',
        'json-import-monitor',
      ],
      'explicit-refresh',
    );
    try {
      const result = await api<{ collaboration: CollaborationState }>(
        '/collaboration',
        {
          cacheScope: user.uid,
          forceRefresh: true,
          requestReason: 'explicit-refresh',
        },
      );
      replaceFromServer(result.collaboration);
      setRefreshRevision((value) => value + 1);
    } catch {
      // Each workspace keeps its last valid snapshot if an explicit refresh fails.
    } finally {
      setRefreshBusy(false);
    }
  }

  async function refreshQBankAdministration() {
    invalidateApiResources(
      ['collaboration', 'question-catalog', 'review-queue'],
      'explicit-refresh',
    );
    const result = await api<{ collaboration: CollaborationState }>(
      '/collaboration',
      {
        cacheScope: user.uid,
        forceRefresh: true,
        requestReason: 'explicit-refresh',
      },
    );
    replaceFromServer(result.collaboration);
  }

  async function setQBankHidden(
    bank: CollaborationState['qbanks'][number],
    hidden: boolean,
  ) {
    if (!isSuperadminWorkspace || qbankActionId) return;
    setQbankActionId(bank.id);
    setQbankActionMessage('');
    try {
      await api('/collaboration', {
        method: 'PUT',
        body: JSON.stringify({
          operations: [
            {
              collection: 'qbanks',
              id: bank.id,
              type: 'set',
              value: { ...bank, archived: hidden },
            },
          ],
        }),
      });
      await refreshQBankAdministration();
      setQbankActionMessage(
        hidden
          ? `${bank.name} is now hidden from QBank listings.`
          : `${bank.name} is visible again.`,
      );
    } catch (error) {
      setQbankActionMessage(
        error instanceof Error ? error.message : 'Unable to update this QBank.',
      );
    } finally {
      setQbankActionId('');
    }
  }

  async function deleteQBank(bank: CollaborationState['qbanks'][number]) {
    if (!isSuperadminWorkspace || qbankActionId || bank.essential) return;
    const confirmed = await confirmQBankAction({
      title: `Delete ${bank.name}?`,
      description:
        'This permanently deletes the QBank, its questions, invitations, memberships, notes, statistics, and uploaded media. This action cannot be undone.',
      confirmLabel: 'Delete QBank',
      tone: 'destructive',
    });
    if (!confirmed) return;
    setQbankActionId(bank.id);
    setQbankActionMessage('');
    try {
      await deleteQBankImages(bank.id);
      await api('/collaboration', {
        method: 'PUT',
        body: JSON.stringify({
          operations: [{ collection: 'qbanks', id: bank.id, type: 'delete' }],
        }),
      });
      await refreshQBankAdministration();
      setQbankActionMessage(`${bank.name} was permanently deleted.`);
    } catch (error) {
      setQbankActionMessage(
        error instanceof Error ? error.message : 'Unable to delete this QBank.',
      );
    } finally {
      setQbankActionId('');
    }
  }
  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return collaboration.members
      .filter(
        (m) =>
          (memberStatus === 'all' ||
            (memberStatus === 'suspended'
              ? m.suspended
              : m.status === memberStatus)) &&
          [m.displayName, m.email, m.uid, m.phone, m.universityId].some(
            (value) =>
              String(value ?? '')
                .toLowerCase()
                .includes(query),
          ),
      )
      .sort(
        (a, b) =>
          Number(b.status === 'pending') - Number(a.status === 'pending') ||
          (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      );
  }, [collaboration.members, memberSearch, memberStatus]);
  const filteredAudit = useMemo(() => {
    const query = auditSearch.trim().toLowerCase();
    return auditEntries
      .filter((entry) =>
        [
          entry.actorName,
          entry.actorId,
          entry.action,
          entry.entityId,
          entry.detail,
        ].some((value) =>
          String(value ?? '')
            .toLowerCase()
            .includes(query),
        ),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [auditEntries, auditSearch]);
  const membersPage = Math.min(
    memberPage,
    Math.max(0, Math.ceil(filteredMembers.length / 20) - 1),
  );
  const logsPage = Math.min(
    auditPage,
    Math.max(0, Math.ceil(filteredAudit.length / 25) - 1),
  );
  const [idText, setIdText] = useState('');
  const [roleSearch, setRoleSearch] = useState('');
  const [roleSectionPages, setRoleSectionPages] = useState<
    Record<string, number>
  >({});
  const roleGroups = useMemo(() => {
    const query = roleSearch.trim().toLowerCase();
    const members = collaboration.members.filter(
      (member) =>
        member.role !== 'super_admin' &&
        member.status === 'approved' &&
        `${member.displayName} ${member.email} ${member.universityId}`
          .toLowerCase()
          .includes(query),
    );
    const moderator = (member: MemberProfile) => hasModeratorRole(member);
    const reviewer = (member: MemberProfile) =>
      !moderator(member) && hasReviewerRole(member);
    const access = (member: MemberProfile) =>
      !moderator(member) && hasAccessManagerRole(member);
    return [
      {
        id: 'moderator',
        label: 'Moderators',
        members: members.filter(moderator),
      },
      { id: 'reviewer', label: 'Reviewers', members: members.filter(reviewer) },
      {
        id: 'access',
        label: 'Access managers',
        members: members.filter(access),
      },
      {
        id: 'member',
        label: 'No assigned role',
        members: members.filter(
          (member) => !administrativeRoleLabels(member).length,
        ),
      },
    ];
  }, [collaboration.members, roleSearch]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, PlatformRole[]>>(
    {},
  );
  const [blockText, setBlockText] = useState<Record<BlockKind, string>>({
    phones: '',
    universityIds: '',
    emails: '',
  });
  const pendingMembers = useMemo(
    () => collaboration.members.filter((item) => item.status === 'pending'),
    [collaboration.members],
  );
  const pendingManualIdChecks = useMemo(
    () =>
      pendingMembers.filter(
        (item) => item.role !== 'super_admin' && !item.universityIdRegistered,
      ),
    [pendingMembers],
  );
  const reviewable = useMemo(
    () =>
      collaboration.proposals.filter(
        (proposal) =>
          proposal.status === 'pending' &&
          (qbankScope === 'all' || proposal.qbankId === qbankScope) &&
          collaboration.qbanks.some(
            (bank) =>
              bank.id === proposal.qbankId &&
              canReviewBank(user, bank, collaboration.memberships),
          ),
      ),
    [
      collaboration.memberships,
      collaboration.proposals,
      collaboration.qbanks,
      qbankScope,
      user,
    ],
  );
  const roleRequests = useMemo(
    () =>
      collaboration.roleApplications.filter(
        (item) =>
          item.status === 'pending' && isPlatformRole(item.requestedRole),
      ),
    [collaboration.roleApplications],
  );
  const scopedQuestions = useMemo(
    () =>
      collaboration.approvedQuestions.filter(
        (question) => qbankScope === 'all' || question.qbankId === qbankScope,
      ),
    [collaboration.approvedQuestions, qbankScope],
  );
  const qbankHealth = useMemo(() => {
    const weekAgo = dashboardNow - 7 * 24 * 60 * 60 * 1000;
    return {
      published: scopedQuestions.length,
      awaiting: reviewable.length,
      addedThisWeek: scopedQuestions.filter(
        (question) =>
          question.reviewedAt &&
          new Date(question.reviewedAt).getTime() >= weekAgo,
      ).length,
      visibleBanks:
        qbankScope === 'all'
          ? collaboration.qbanks.filter((bank) => !bank.archived).length
          : 1,
    };
  }, [
    collaboration.qbanks,
    dashboardNow,
    qbankScope,
    reviewable.length,
    scopedQuestions,
  ]);
  const subscriptionSnapshot = useMemo(() => {
    const active = collaboration.members.filter(
      (member) => member.status === 'approved' && !member.suspended,
    );
    return {
      lite: active.filter((member) => member.tier === 'lite').length,
      pro: active.filter((member) => member.tier === 'pro').length,
      unlimited: active.filter((member) => member.tier === 'unlimited').length,
    };
  }, [collaboration.members]);
  const attentionQueue = useMemo(
    () =>
      [
        ...reviewable.map((proposal) => ({
          id: proposal.id,
          type: 'Edit review',
          item:
            proposal.questionId && proposal.questionId !== '#deleted'
              ? `Question #${proposal.questionId.replace(/^#/, '')}`
              : proposal.payload.stem,
          context:
            collaboration.qbanks.find((bank) => bank.id === proposal.qbankId)
              ?.name ?? 'QBank',
          createdAt: proposal.proposedAt,
          destination: 'proposals' as Tab,
        })),
        ...pendingMembers.map((member) => ({
          id: member.uid,
          type: 'Registration',
          item: member.displayName,
          context: member.universityId || member.email,
          createdAt: member.createdAt,
          destination: 'registrations' as Tab,
        })),
        ...roleRequests.map((request) => ({
          id: request.id,
          type: 'Role request',
          item: request.userName,
          context: request.requestedRole.replaceAll('_', ' '),
          createdAt: request.createdAt,
          destination: 'roles' as Tab,
        })),
      ]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(0, 8),
    [collaboration.qbanks, pendingMembers, reviewable, roleRequests],
  );
  const oldestReview = reviewable.reduce<string | undefined>(
    (oldest, item) =>
      !oldest || item.proposedAt < oldest ? item.proposedAt : oldest,
    undefined,
  );
  const oldestRegistration = pendingMembers.reduce<string | undefined>(
    (oldest, item) =>
      !oldest || item.createdAt < oldest ? item.createdAt : oldest,
    undefined,
  );
  const oldestRoleRequest = roleRequests.reduce<string | undefined>(
    (oldest, item) =>
      !oldest || item.createdAt < oldest ? item.createdAt : oldest,
    undefined,
  );
  const searchResults = useMemo(() => {
    const query = adminSearch.trim().replace(/^#/, '').toLowerCase();
    if (!query) return [];
    return [
      ...collaboration.members
        .filter((member) =>
          [
            member.displayName,
            member.email,
            member.universityId,
            member.uid,
          ].some((value) => value.toLowerCase().includes(query)),
        )
        .slice(0, 5)
        .map((member) => ({
          id: `member:${member.uid}`,
          label: member.displayName,
          detail: `${member.email} · ${member.universityId}`,
          destination: 'registrations' as Tab,
          filter: member.email,
        })),
      ...collaboration.qbanks
        .filter((bank) =>
          `${bank.name} ${bank.id}`.toLowerCase().includes(query),
        )
        .slice(0, 4)
        .map((bank) => ({
          id: `bank:${bank.id}`,
          label: bank.name,
          detail: 'QBank',
          destination: 'qbanks' as Tab,
          filter: '',
        })),
      ...collaboration.approvedQuestions
        .filter((question) =>
          `${question.questionId} ${question.stem}`
            .toLowerCase()
            .includes(query),
        )
        .slice(0, 4)
        .map((question) => ({
          id: `question:${question.id}`,
          label: `Question #${question.questionId}`,
          detail: question.stem,
          destination: 'question-preview' as Tab,
          filter: '',
        })),
    ].slice(0, 10);
  }, [
    adminSearch,
    collaboration.approvedQuestions,
    collaboration.members,
    collaboration.qbanks,
  ]);

  useEffect(() => {
    if (!isSuperadminWorkspace) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setAdminSearchOpen(true);
      }
      if (event.key === 'Escape') setAdminSearchOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSuperadminWorkspace]);

  function reviewMember(uid: string, status: AccountStatus) {
    const reviewedAt = nowIso();
    update((current) => ({
      ...current,
      members: current.members.map((item) =>
        item.uid === uid
          ? {
              ...item,
              status,
              approvedAt: status === 'approved' ? reviewedAt : item.approvedAt,
              approvedById: user.uid,
              approvedByName: user.displayName,
              universityIdVerifiedManually:
                status === 'approved' && !item.universityIdRegistered
                  ? true
                  : item.universityIdVerifiedManually,
            }
          : item,
      ),
      auditLog: [
        audit(
          user,
          `registration_${status}`,
          'account',
          uid,
          `${status} membership request.`,
        ),
        ...current.auditLog,
      ],
    }));
  }

  function toggleSuspended(member: MemberProfile) {
    update((current) => ({
      ...current,
      members: current.members.map((item) =>
        item.uid === member.uid
          ? { ...item, suspended: !item.suspended }
          : item,
      ),
      auditLog: [
        audit(
          user,
          member.suspended ? 'account_restored' : 'account_blocked',
          'account',
          member.uid,
          `${member.displayName} access ${member.suspended ? 'restored' : 'blocked'}.`,
        ),
        ...current.auditLog,
      ],
    }));
  }

  function addStudentIds() {
    const values = [
      ...new Set(
        idText
          .split(/[\s,;]+/)
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    if (!values.length) return;
    const createdAt = nowIso();
    update((current) => {
      const existing = new Set(
        current.allowedUniversityIds.map((item) => item.id),
      );
      const added = values
        .filter((id) => !existing.has(id))
        .map((id) => {
          const claimant = current.members.find(
            (member) =>
              normalizeUniversityId(member.universityId) ===
              normalizeUniversityId(id),
          );
          return {
            id,
            addedAt: createdAt,
            addedById: user.uid,
            claimedById: claimant?.uid ?? null,
            claimedByName: claimant?.displayName ?? null,
            claimedAt: claimant?.createdAt ?? null,
          };
        });
      return {
        ...current,
        allowedUniversityIds: [...added, ...current.allowedUniversityIds],
        auditLog: added.length
          ? [
              audit(
                user,
                'student_ids_added',
                'university_id',
                added[0].id,
                `${added.length} eligible IDs added.`,
              ),
              ...current.auditLog,
            ]
          : current.auditLog,
      };
    });
    setIdText('');
  }

  function addBlockedValues(kind: BlockKind) {
    const values = [
      ...new Set(
        blockText[kind]
          .split(/[\s,;]+/)
          .map((item) => normalizeBlockValue(kind, item))
          .filter(Boolean),
      ),
    ];
    if (!values.length) return;
    update((current) => {
      const existing = new Set(current.blockedAccess[kind]);
      const added = values.filter((value) => !existing.has(value));
      if (!added.length) return current;
      const blockedAccess: AccessBlocklist = {
        ...current.blockedAccess,
        [kind]: [...current.blockedAccess[kind], ...added],
      };
      return {
        ...current,
        blockedAccess,
        members: current.members.map((member) =>
          member.role === 'super_admin' ||
          !memberMatchesBlocklist(member, blockedAccess)
            ? member
            : { ...member, suspended: true },
        ),
        auditLog: [
          audit(
            user,
            'access_block_added',
            'access_block',
            added[0],
            `${added.length} ${kind} value${added.length === 1 ? '' : 's'} blocked.`,
          ),
          ...current.auditLog,
        ],
      };
    });
    setBlockText((current) => ({ ...current, [kind]: '' }));
  }

  function removeBlockedValue(kind: BlockKind, value: string) {
    update((current) => ({
      ...current,
      blockedAccess: {
        ...current.blockedAccess,
        [kind]: current.blockedAccess[kind].filter((item) => item !== value),
      },
      auditLog: [
        audit(
          user,
          'access_block_removed',
          'access_block',
          value,
          `${kind} block removed.`,
        ),
        ...current.auditLog,
      ],
    }));
  }

  function reviewRole(applicationId: string, approved: boolean) {
    const application = collaboration.roleApplications.find(
      (item) => item.id === applicationId,
    );
    if (!application || !isModerator) return;
    const reviewedAt = nowIso();
    update((current) => ({
      ...current,
      roleApplications: current.roleApplications.map((item) =>
        item.id === applicationId
          ? {
              ...item,
              status: approved ? 'approved' : 'rejected',
              reviewedAt,
              reviewedById: user.uid,
              reviewedByName: user.displayName,
            }
          : item,
      ),
      members: approved
        ? current.members.map((member) =>
            member.uid === application.userId
              ? {
                  ...member,
                  platformRoles:
                    application.requestedRole === 'moderator'
                      ? ['moderator']
                      : member.platformRoles.includes('moderator')
                        ? member.platformRoles
                        : [
                            ...new Set([
                              ...member.platformRoles.filter(
                                (role) => role !== 'moderator',
                              ),
                              application.requestedRole,
                            ]),
                          ],
                }
              : member,
          )
        : current.members,
      auditLog: [
        audit(
          user,
          approved ? 'role_request_approved' : 'role_request_rejected',
          'role',
          application.id,
          `${application.requestedRole} request by ${application.userName}.`,
        ),
        ...current.auditLog,
      ],
    }));
  }

  function toggleAccountRole(member: MemberProfile, role: PlatformRole) {
    if (!isModerator || member.role === 'super_admin') return;
    setRoleDrafts((current) => {
      const draft = current[member.uid] ?? [...member.platformRoles];
      const enabling = !draft.includes(role);
      if (role !== 'moderator' && draft.includes('moderator')) return current;
      return {
        ...current,
        [member.uid]:
          role === 'moderator'
            ? enabling
              ? ['moderator']
              : []
            : enabling
              ? [...new Set([...draft, role])]
              : draft.filter((item) => item !== role),
      };
    });
  }

  function roleDraftFor(member: MemberProfile) {
    return roleDrafts[member.uid] ?? member.platformRoles;
  }

  function hasUnsavedRoles(member: MemberProfile) {
    const draft = roleDrafts[member.uid];
    if (!draft) return false;
    return (
      [...draft].sort().join('|') !== [...member.platformRoles].sort().join('|')
    );
  }

  function saveAccountRoles(member: MemberProfile) {
    const draft = roleDrafts[member.uid];
    if (
      !isModerator ||
      member.role === 'super_admin' ||
      !draft ||
      !hasUnsavedRoles(member)
    )
      return;
    update((current) => ({
      ...current,
      members: current.members.map((item) =>
        item.uid === member.uid ? { ...item, platformRoles: [...draft] } : item,
      ),
      auditLog: [
        audit(
          user,
          'account_roles_saved',
          'role',
          member.uid,
          `Saved ${member.displayName}'s roles: ${draft.join(', ') || 'none'}.`,
        ),
        ...current.auditLog,
      ],
    }));
    setRoleDrafts((current) => {
      const next = { ...current };
      delete next[member.uid];
      return next;
    });
  }

  return (
    <div
      className={isSuperadminWorkspace ? 'q-admin-layout' : 'q-access-layout'}
    >
      <header className="q-admin-toolbar">
        <div className="flex min-w-0 items-center gap-3">
          {isSuperadminWorkspace ? (
            <Link
              aria-label="Back to Qraft"
              href="/"
              className="q-admin-icon-button"
            >
              <ArrowLeft className="size-4" />
            </Link>
          ) : (
            <button
              aria-label="Open navigation"
              onClick={() =>
                window.dispatchEvent(new Event('medguard-open-menu'))
              }
              className="q-admin-icon-button lg:hidden"
            >
              <Menu className="size-5" />
            </button>
          )}
          <span className="text-sm font-semibold">
            {isSuperadminWorkspace ? 'Administration' : 'Access administration'}
          </span>
          <span className="q-admin-toolbar-divider">/</span>
          <span className="q-admin-toolbar-section">
            {tabs.find(([id]) => id === tab)?.[1]}
          </span>
        </div>
        {isSuperadminWorkspace && (
          <div className="q-admin-toolbar-actions">
            <button
              disabled={refreshBusy}
              aria-label="Refresh administration data"
              title="Refresh current data"
              onClick={() => void refreshAdministration()}
              className="q-admin-icon-button"
            >
              <RefreshCw
                className={cx('size-4', refreshBusy && 'animate-spin')}
              />
            </button>
            <button
              ref={adminSearchTriggerRef}
              aria-label="Search administration"
              onClick={() => setAdminSearchOpen(true)}
              className="q-admin-search-trigger"
            >
              <Search className="size-4" />
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </button>
            <details className="q-admin-quick-actions group relative">
              <summary className="q-button q-button-primary cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                Quick actions <ChevronDown className="size-4" />
              </summary>
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-xl border bg-card p-2 shadow-xl">
                {(
                  [
                    ['question-preview', 'Preview question'],
                    ['subscriptions', 'Activate subscription'],
                    ['discounts', 'Create discount code'],
                    ['registrations', 'Review registrations'],
                  ] as Array<[Tab, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={(event) => {
                      setTab(id);
                      event.currentTarget
                        .closest('details')
                        ?.removeAttribute('open');
                    }}
                    className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm hover:bg-muted"
                  >
                    <span>{label}</span>
                    <ArrowRight className="size-4" />
                  </button>
                ))}
              </div>
            </details>
          </div>
        )}
      </header>
      {isSuperadminWorkspace && (
        <Dialog open={adminSearchOpen} onOpenChange={setAdminSearchOpen}>
          <DialogContent
            initialFocus={adminSearchRef}
            finalFocus={adminSearchTriggerRef}
            showCloseButton={false}
            className="gap-0 overflow-hidden rounded-2xl border bg-card p-0 text-foreground shadow-2xl sm:max-w-2xl"
          >
            <DialogTitle className="sr-only">Search administration</DialogTitle>
            <div className="flex items-center gap-3 border-b px-4">
              <Search className="size-5 text-muted-foreground" />
              <input
                aria-label="Search members, QBanks and questions"
                ref={adminSearchRef}
                value={adminSearch}
                onChange={(event) => setAdminSearch(event.target.value)}
                placeholder="Question ID, student ID, email, username or QBank…"
                className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none"
              />
              <button
                aria-label="Close search"
                onClick={() => setAdminSearchOpen(false)}
                className="rounded-lg border px-2 py-1 text-xs text-muted-foreground"
              >
                ESC
              </button>
            </div>
            <div className="max-h-[55dvh] overflow-y-auto p-2">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => {
                    setTab(result.destination);
                    if (result.destination === 'registrations') {
                      setMemberSearch(result.filter);
                      setMemberStatus('all');
                      setMemberPage(0);
                    }
                    setAdminSearchOpen(false);
                  }}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-muted"
                >
                  <Command className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">
                      {result.label}
                    </strong>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {result.detail}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
              {adminSearch.trim() && !searchResults.length && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  No matching members, QBanks or questions.
                </p>
              )}
              {!adminSearch.trim() && (
                <div className="grid gap-2 p-2 sm:grid-cols-2">
                  {(
                    [
                      ['contact', 'Contact tickets'],
                      ['subscriptions', 'Subscriptions'],
                      ['roles', 'Roles & permissions'],
                      ['audit', 'Audit log'],
                    ] as Array<[Tab, string]>
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => {
                        setTab(id);
                        setAdminSearchOpen(false);
                      }}
                      className="flex min-h-11 items-center justify-between rounded-xl border px-3 text-sm font-semibold hover:bg-muted"
                    >
                      <span>{label}</span>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
      <div className="q-admin-body">
        <nav
          aria-label="Administration sections"
          className="q-admin-navigation"
        >
          <div className="q-admin-brand">
            <span>
              <QraftBrand variant="mark" className="size-8" />
            </span>
            <div>
              <strong>
                Qraft<span>admin</span>
              </strong>
              <p>Platform management</p>
            </div>
          </div>
          <label className="q-admin-mobile-section">
            <span>Workspace</span>
            <select
              aria-label="Administration section"
              value={tab}
              onChange={(e) => setTab(e.target.value as Tab)}
            >
              {adminGroups.map((group) => {
                const available = tabs.filter(([id]) => group.ids.includes(id));
                return available.length ? (
                  <optgroup key={group.label} label={group.label}>
                    {available.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
          </label>
          <div className="q-admin-nav-groups">
            {adminGroups.map((group) => {
              const available = tabs.filter(([id]) => group.ids.includes(id));
              return available.length ? (
                <div key={group.label} className="q-admin-nav-group">
                  <p>{group.label}</p>
                  {available.map(([id, label]) => {
                    const count =
                      id === 'registrations'
                        ? pendingMembers.length
                        : id === 'roles'
                          ? roleRequests.length
                          : id === 'proposals'
                            ? reviewable.length
                            : 0;
                    const Icon = adminSections[id].icon;
                    return (
                      <button
                        key={id}
                        aria-current={tab === id ? 'page' : undefined}
                        onClick={() => setTab(id)}
                      >
                        <Icon className="size-[18px] shrink-0" />
                        <span>{label}</span>
                        {count > 0 && <small>{count}</small>}
                      </button>
                    );
                  })}
                </div>
              ) : null;
            })}
          </div>
          <div className="q-admin-identity">
            <span className="q-admin-avatar">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user.displayName}</strong>
              <span>
                {isRoot
                  ? 'Super administrator · MFA'
                  : administrativeRoleLabels(user).join(' · ')}
              </span>
            </div>
            {isSuperadminWorkspace && onSignOut && (
              <button
                aria-label="Sign out"
                title="Sign out"
                onClick={onSignOut}
              >
                <LogOut className="size-4" />
              </button>
            )}
          </div>
        </nav>
        <div
          ref={adminContentRef}
          className="q-admin-content"
          id="admin-workspace"
          tabIndex={-1}
        >
          <div className="q-admin-page-heading">
            <div>
              <p className="q-admin-eyebrow">
                {adminGroups.find((group) => group.ids.includes(tab))?.label}
              </p>
              <h1>
                {tab === 'overview'
                  ? 'Workspace overview'
                  : tabs.find(([id]) => id === tab)?.[1]}
              </h1>
              <p>{adminSections[tab].description}</p>
            </div>
            {isSuperadminWorkspace &&
              (tab === 'overview' || tab === 'proposals') && (
                <label className="q-admin-scope">
                  <span>Content scope</span>
                  <select
                    aria-label="QBank scope"
                    value={qbankScope}
                    onChange={(event) => setQbankScope(event.target.value)}
                  >
                    <option value="all">All QBanks</option>
                    {collaboration.qbanks
                      .filter((bank) => !bank.archived)
                      .map((bank) => (
                        <option key={bank.id} value={bank.id}>
                          {bank.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
          </div>
          <div className="q-admin-panels">
            {isRoot && (tab === 'discounts' || tab === 'subscriptions') && (
              <SubscriptionAdmin
                key={`${tab}:${refreshRevision}`}
                section={tab}
              />
            )}
            {isRoot && tab === 'economy' && (
              <EconomyAdmin
                key={refreshRevision}
                members={collaboration.members}
              />
            )}
            {isRoot && tab === 'contact' && (
              <ContactWorkspace key={refreshRevision} admin />
            )}
            {isRoot && tab === 'json-imports' && (
              <JsonImportMonitor
                key={refreshRevision}
                qbanks={collaboration.qbanks}
              />
            )}
            {isRoot && tab === 'question-preview' && <QuestionPreview />}
            {isRoot && tab === 'announcement' && (
              <AnnouncementAdmin key={refreshRevision} />
            )}
            {isRoot && tab === 'backups' && <BackupAdmin />}
            {isRoot && tab === 'legal' && (
              <LegalLinksAdmin key={refreshRevision} />
            )}
            {tab === 'overview' && (
              <div className="q-admin-overview">
                {isSuperadminWorkspace && (
                  <section
                    aria-label="Platform summary"
                    className="q-admin-metrics"
                  >
                    {(
                      [
                        {
                          label: 'Active members',
                          value:
                            subscriptionSnapshot.lite +
                            subscriptionSnapshot.pro +
                            subscriptionSnapshot.unlimited,
                          detail: 'Approved accounts',
                          icon: Users,
                          destination: 'registrations',
                        },
                        {
                          label: 'Published questions',
                          value: qbankHealth.published,
                          detail: `${qbankHealth.addedThisWeek} added in the last 7 days`,
                          icon: BookOpen,
                          destination: 'qbanks',
                        },
                        {
                          label: 'Visible QBanks',
                          value: qbankHealth.visibleBanks,
                          detail: 'Within the selected scope',
                          icon: Database,
                          destination: 'qbanks',
                        },
                        {
                          label: 'Pending reviews',
                          value: qbankHealth.awaiting,
                          detail: 'Awaiting a review decision',
                          icon: Inbox,
                          destination: 'proposals',
                        },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.label}
                        onClick={() => setTab(item.destination)}
                      >
                        <div>
                          <span>{item.label}</span>
                          <item.icon className="size-[18px]" />
                        </div>
                        <strong>{item.value.toLocaleString()}</strong>
                        <p>{item.detail}</p>
                      </button>
                    ))}
                  </section>
                )}
                <section
                  className="q-admin-priorities"
                  aria-labelledby="attention-heading"
                >
                  <div className="q-admin-section-heading">
                    <div>
                      <h2 id="attention-heading">Needs your attention</h2>
                      <p>A clear starting point for your next action.</p>
                    </div>
                    <span className="q-admin-chip">
                      {pendingMembers.length +
                        roleRequests.length +
                        reviewable.length}{' '}
                      pending
                    </span>
                  </div>
                  <div className="q-admin-priority-grid">
                    {(
                      [
                        {
                          id: 'proposals',
                          label: 'Question reviews',
                          value: reviewable.length,
                          oldest: oldestReview,
                          detail: 'Review submitted changes',
                          icon: Clock3,
                        },
                        {
                          id: 'registrations',
                          label: 'Registrations',
                          value: pendingMembers.length,
                          oldest: oldestRegistration,
                          detail: `${pendingManualIdChecks.length} IDs need manual verification`,
                          icon: UserCheck,
                        },
                        {
                          id: 'roles',
                          label: 'Access requests',
                          value: roleRequests.length,
                          oldest: oldestRoleRequest,
                          detail: 'Review permission requests',
                          icon: ShieldCheck,
                        },
                        {
                          id: 'contact',
                          label: 'Support inbox',
                          value: null,
                          oldest: undefined,
                          detail: 'Read and respond to tickets',
                          icon: MessageSquareText,
                        },
                      ] as Array<{
                        id: Tab;
                        label: string;
                        value: number | null;
                        oldest?: string;
                        detail: string;
                        icon: typeof Clock3;
                      }>
                    )
                      .filter((item) => tabs.some(([id]) => id === item.id))
                      .map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            setTab(item.id);
                            if (item.id === 'registrations') {
                              setMemberStatus('pending');
                              setMemberSearch('');
                              setMemberPage(0);
                            }
                          }}
                          className="q-admin-priority"
                          data-pending={Boolean(item.value)}
                        >
                          <span className="q-admin-priority-icon">
                            <item.icon className="size-5" />
                          </span>
                          <div>
                            <h3>{item.label}</h3>
                            <p>
                              {item.value === 0 ? 'All caught up' : item.detail}
                            </p>
                            {item.oldest && (
                              <small>
                                Oldest request ·{' '}
                                {relativeAge(item.oldest, dashboardNow)}
                              </small>
                            )}
                          </div>
                          <strong>
                            {item.value ?? <ArrowRight className="size-5" />}
                          </strong>
                        </button>
                      ))}
                  </div>
                </section>
                <div className="q-admin-overview-columns">
                  <section className="q-admin-panel q-admin-queue">
                    <div className="q-admin-section-heading">
                      <div>
                        <h2>Action queue</h2>
                        <p>Oldest requests first</p>
                      </div>
                      <Inbox className="size-5 text-muted-foreground" />
                    </div>
                    {attentionQueue.filter((item) =>
                      tabs.some(([id]) => id === item.destination),
                    ).length ? (
                      <div className="q-admin-queue-list">
                        {attentionQueue
                          .filter((item) =>
                            tabs.some(([id]) => id === item.destination),
                          )
                          .map((item) => (
                            <button
                              key={`${item.type}:${item.id}`}
                              onClick={() => {
                                setTab(item.destination);
                                if (item.destination === 'registrations') {
                                  setMemberSearch(item.item);
                                  setMemberStatus('pending');
                                  setMemberPage(0);
                                }
                                if (item.destination === 'roles')
                                  setRoleSearch(item.item);
                              }}
                            >
                              <span className="q-admin-queue-icon">
                                {item.type === 'Registration' ? (
                                  <UserCheck className="size-4" />
                                ) : (
                                  <Inbox className="size-4" />
                                )}
                              </span>
                              <span>
                                <small>{item.type}</small>
                                <strong>{item.item}</strong>
                                <p>{item.context}</p>
                              </span>
                              <time>
                                {relativeAge(item.createdAt, dashboardNow)}
                              </time>
                              <ArrowRight className="size-4 text-muted-foreground" />
                            </button>
                          ))}
                      </div>
                    ) : (
                      <div className="q-admin-empty">
                        <span>
                          <ShieldCheck className="size-7" />
                        </span>
                        <h3>You’re all caught up</h3>
                        <p>
                          New registrations, reviews and access requests will
                          appear here.
                        </p>
                      </div>
                    )}
                  </section>
                  {isSuperadminWorkspace && (
                    <section className="q-admin-panel q-admin-plans">
                      <div className="q-admin-section-heading">
                        <div>
                          <h2>Memberships</h2>
                          <p>Active accounts by plan</p>
                        </div>
                        <CreditCard className="size-5 text-muted-foreground" />
                      </div>
                      <div className="q-admin-plan-list">
                        {(
                          [
                            { label: 'Lite', value: subscriptionSnapshot.lite },
                            { label: 'Pro', value: subscriptionSnapshot.pro },
                            {
                              label: 'Unlimited',
                              value: subscriptionSnapshot.unlimited,
                            },
                          ] as const
                        ).map((item) => (
                          <button
                            key={item.label}
                            onClick={() => setTab('subscriptions')}
                          >
                            <div>
                              <span>{item.label}</span>
                              <strong>{item.value.toLocaleString()}</strong>
                            </div>
                            <progress
                              aria-label={`${item.label} active accounts`}
                              value={item.value}
                              max={Math.max(
                                1,
                                subscriptionSnapshot.lite +
                                  subscriptionSnapshot.pro +
                                  subscriptionSnapshot.unlimited,
                              )}
                            />
                          </button>
                        ))}
                      </div>
                      <button
                        className="q-admin-text-action"
                        onClick={() => setTab('subscriptions')}
                      >
                        Manage subscriptions <ArrowRight className="size-4" />
                      </button>
                    </section>
                  )}
                </div>
                {isRoot && (
                  <section className="q-admin-panel q-admin-activity">
                    <div className="q-admin-section-heading">
                      <div>
                        <h2>Recent activity</h2>
                        <p>Administrative events from this week</p>
                      </div>
                      <button
                        className="q-admin-text-action"
                        onClick={() => {
                          setAuditSearch('');
                          setAuditPage(0);
                          setTab('audit');
                        }}
                      >
                        View audit log <ArrowRight className="size-4" />
                      </button>
                    </div>
                    {auditEntries.slice(0, 5).map((item) => (
                      <div key={item.id} className="q-admin-activity-row">
                        <span>
                          <Activity className="size-4" />
                        </span>
                        <p>{activityLabel(item)}</p>
                        <time>{relativeAge(item.createdAt, dashboardNow)}</time>
                      </div>
                    ))}
                    {!auditBusy && !auditEntries.length && (
                      <p className="q-admin-quiet-message">
                        No activity recorded this week.
                      </p>
                    )}
                    {auditBusy && (
                      <output className="q-admin-quiet-message">
                        Loading recent activity…
                      </output>
                    )}
                  </section>
                )}
              </div>
            )}
            {tab === 'registrations' && (
              <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
                <div className="border-b p-5">
                  <h2 className="font-bold">Registration and access</h2>
                  <p className="text-xs text-muted-foreground">
                    Review every registrant detail before approving, rejecting,
                    blocking, or restoring an account.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <label className="relative">
                      <Search
                        aria-hidden="true"
                        className="absolute left-3 top-3.5 size-4 text-muted-foreground"
                      />
                      <input
                        aria-label="Search members"
                        placeholder={
                          isRoot
                            ? 'Name, email, phone or ID'
                            : 'Name, email or university ID'
                        }
                        value={memberSearch}
                        onChange={(e) => {
                          setMemberSearch(e.target.value);
                          setMemberPage(0);
                        }}
                        className="min-h-11 w-full min-w-0 rounded-xl border bg-background py-2 pl-10 pr-3 text-sm"
                      />
                    </label>
                    <select
                      aria-label="Filter members by status"
                      value={memberStatus}
                      onChange={(e) => {
                        setMemberStatus(e.target.value);
                        setMemberPage(0);
                      }}
                      className="min-h-11 rounded-xl border bg-background px-3 text-sm"
                    >
                      {[
                        'all',
                        'pending',
                        'approved',
                        'rejected',
                        'suspended',
                      ].map((status) => (
                        <option key={status} value={status}>
                          {status === 'all' ? 'All statuses' : status}
                        </option>
                      ))}
                    </select>
                  </div>
                  <output className="mt-3 block text-xs text-muted-foreground">
                    {filteredMembers.length} matching members · Pending requests
                    appear first
                  </output>
                </div>
                {filteredMembers.length ? (
                  <div className="overflow-x-auto">
                    <table
                      className={cx(
                        'q-admin-members-table w-full text-left text-sm',
                        isRoot ? 'min-w-[1120px]' : 'min-w-[680px]',
                      )}
                    >
                      <thead className="border-b bg-muted/30 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-5 py-3">Registrant</th>
                          <th className="px-5 py-3">Email</th>
                          {isRoot && <th className="px-5 py-3">Mobile</th>}
                          <th className="px-5 py-3">University ID</th>
                          <th className="px-5 py-3">Status</th>
                          <th className="px-5 py-3">
                            Roles &amp; subscription
                          </th>
                          {isRoot && <th className="px-5 py-3">Registered</th>}
                          {isRoot && <th className="px-5 py-3">Reviewed by</th>}
                          <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {filteredMembers
                          .slice(membersPage * 20, membersPage * 20 + 20)
                          .map((member) => (
                            <tr
                              key={member.uid}
                              className="align-top transition hover:bg-muted/20"
                            >
                              <td data-label="Registrant" className="px-5 py-4">
                                <strong className="block whitespace-nowrap text-sm">
                                  {member.displayName}
                                </strong>
                                {isRoot && (
                                  <span
                                    className="mt-1 block max-w-[150px] truncate font-mono text-xs text-muted-foreground"
                                    title={member.uid}
                                  >
                                    {member.uid}
                                  </span>
                                )}
                              </td>
                              <td data-label="Email" className="px-5 py-4">
                                <span
                                  className="block max-w-[220px] truncate"
                                  title={member.email}
                                >
                                  {member.email}
                                </span>
                              </td>
                              {isRoot && (
                                <td
                                  data-label="Mobile"
                                  className="px-5 py-4 font-mono text-xs"
                                >
                                  {member.phone || '—'}
                                </td>
                              )}
                              <td
                                data-label="University ID"
                                className="px-5 py-4"
                              >
                                <strong className="block font-mono text-xs">
                                  {member.universityId}
                                </strong>
                                {member.role === 'super_admin' ? (
                                  <span className="mt-1 inline-flex rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                                    SYSTEM ACCOUNT
                                  </span>
                                ) : member.universityIdRegistered ? (
                                  <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                                    REGISTERED IN SYSTEM
                                  </span>
                                ) : member.universityIdVerifiedManually ? (
                                  <span className="mt-1 inline-flex rounded-full bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                                    MANUALLY VERIFIED
                                  </span>
                                ) : (
                                  <span className="mt-1 inline-flex max-w-[190px] rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold leading-4 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                                    NOT REGISTERED · VERIFY MANUALLY
                                  </span>
                                )}
                              </td>
                              <td data-label="Status" className="px-5 py-4">
                                <span
                                  className={cx(
                                    'inline-flex rounded-full px-2.5 py-1 text-xs font-bold uppercase',
                                    member.suspended
                                      ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                                      : member.status === 'pending'
                                        ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200'
                                        : member.status === 'approved'
                                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                                          : 'bg-muted text-muted-foreground',
                                  )}
                                >
                                  {member.suspended ? 'Blocked' : member.status}
                                </span>
                                {isRoot && (
                                  <span className="mt-1 block text-xs text-muted-foreground">
                                    MFA{' '}
                                    {member.mfaEnrolled
                                      ? 'enabled'
                                      : 'not enabled'}
                                  </span>
                                )}
                              </td>
                              <td
                                data-label="Roles & subscription"
                                className="px-5 py-4"
                              >
                                <span className="block">
                                  {administrativeRoleLabels(member).join(
                                    ' · ',
                                  ) || 'No assigned role'}
                                </span>
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  Subscription: {member.tier.toUpperCase()}
                                </span>
                              </td>
                              {isRoot && (
                                <td
                                  data-label="Registered"
                                  className="whitespace-nowrap px-5 py-4 text-xs text-muted-foreground"
                                >
                                  {formatDate(member.createdAt)}
                                </td>
                              )}
                              {isRoot && (
                                <td
                                  data-label="Reviewed by"
                                  className="px-5 py-4 text-xs"
                                >
                                  {member.approvedByName ? (
                                    <>
                                      <span className="block">
                                        {member.approvedByName}
                                      </span>
                                      <span className="mt-1 block text-muted-foreground">
                                        {formatDate(member.approvedAt)}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      Pending review
                                    </span>
                                  )}
                                </td>
                              )}
                              <td data-label="Actions" className="px-5 py-4">
                                <div className="flex justify-end gap-2">
                                  {member.status === 'pending' && (
                                    <>
                                      <button
                                        onClick={() =>
                                          reviewMember(member.uid, 'rejected')
                                        }
                                        className="h-9 rounded-lg border px-3 text-xs font-bold text-red-600 dark:text-red-300"
                                      >
                                        <UserRoundX className="mr-1 inline size-4" />
                                        Reject
                                      </button>
                                      <button
                                        onClick={() =>
                                          reviewMember(member.uid, 'approved')
                                        }
                                        className="q-button q-button-study"
                                      >
                                        <UserCheck className="mr-1 inline size-4" />
                                        {member.universityIdRegistered
                                          ? 'Approve'
                                          : 'Verify & approve'}
                                      </button>
                                    </>
                                  )}
                                  {member.status === 'approved' &&
                                    member.role !== 'super_admin' && (
                                      <>
                                        {isModerator && (
                                          <button
                                            onClick={() => {
                                              setRoleSearch(member.email);
                                              setTab('roles');
                                            }}
                                            className="h-9 rounded-lg border px-3 text-xs font-bold text-primary"
                                          >
                                            Manage roles
                                          </button>
                                        )}
                                        <button
                                          onClick={() =>
                                            toggleSuspended(member)
                                          }
                                          className="h-9 rounded-lg border px-3 text-xs font-bold"
                                        >
                                          {member.suspended
                                            ? 'Restore'
                                            : 'Block'}
                                        </button>
                                      </>
                                    )}
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    {collaboration.members.length
                      ? 'No members match your search or filter.'
                      : 'No registrations yet.'}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs text-muted-foreground">
                  <span>
                    Page {membersPage + 1} of{' '}
                    {Math.max(1, Math.ceil(filteredMembers.length / 20))}
                  </span>
                  <div className="flex gap-2">
                    <button
                      className="q-button border"
                      disabled={membersPage === 0}
                      onClick={() => setMemberPage(membersPage - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="q-button border"
                      disabled={
                        (membersPage + 1) * 20 >= filteredMembers.length
                      }
                      onClick={() => setMemberPage(membersPage + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </section>
            )}
            {tab === 'student-ids' && (
              <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
                <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
                  <h2 className="flex items-center gap-2 font-bold">
                    <Fingerprint className="size-5 text-primary" />
                    Import eligible IDs
                  </h2>
                  <textarea
                    value={idText}
                    onChange={(event) => setIdText(event.target.value)}
                    className="mt-4 min-h-40 w-full rounded-xl border bg-card p-3 font-mono text-sm"
                    placeholder={'442001234\n442001235'}
                  />
                  <button
                    onClick={addStudentIds}
                    className="mt-3 h-10 w-full rounded-xl bg-primary text-xs font-bold text-primary-foreground"
                  >
                    Add IDs
                  </button>
                </section>
                <section className="flex max-h-[620px] min-w-0 flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-border">
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-4">
                    <h2 className="text-sm font-bold">
                      Registered IDs · إجمالي الأرقام المسجلة
                    </h2>
                    <output
                      aria-label="Total registered student IDs"
                      className="rounded-xl bg-primary/10 px-3 py-1 text-lg font-bold tabular-nums text-primary"
                    >
                      {collaboration.allowedUniversityIds.length.toLocaleString(
                        'en',
                      )}
                    </output>
                  </div>
                  <div className="min-h-0 divide-y overflow-y-auto overscroll-contain">
                    {collaboration.allowedUniversityIds.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between p-4 text-sm"
                      >
                        <strong className="font-mono">{item.id}</strong>
                        <span className="text-xs text-muted-foreground">
                          {item.claimedByName || 'Available'}
                        </span>
                      </div>
                    ))}
                    {!collaboration.allowedUniversityIds.length && (
                      <p className="p-5 text-sm text-muted-foreground">
                        No student IDs registered yet.
                      </p>
                    )}
                  </div>
                </section>
              </div>
            )}
            {tab === 'blocked' && (
              <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
                <div className="mb-5">
                  <h2 className="font-bold">Blocked access list</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    New registrations matching any value below will be rejected.
                    Existing matching accounts are suspended automatically.
                  </p>
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                  {(
                    [
                      ['phones', 'Mobile numbers', '0501234567\n+966501234567'],
                      [
                        'universityIds',
                        'University IDs',
                        '442001234\n442001235',
                      ],
                      [
                        'emails',
                        'Email addresses',
                        'blocked@example.com\nspam@example.com',
                      ],
                    ] as Array<[BlockKind, string, string]>
                  )
                    .filter(([kind]) => isRoot || kind !== 'phones')
                    .map(([kind, label, placeholder]) => (
                      <article
                        key={kind}
                        className="rounded-2xl border bg-background/35 p-4"
                      >
                        <h3 className="text-sm font-bold">{label}</h3>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          Add one or more values separated by spaces, commas, or
                          new lines.
                        </p>
                        <textarea
                          value={blockText[kind]}
                          onChange={(event) =>
                            setBlockText((current) => ({
                              ...current,
                              [kind]: event.target.value,
                            }))
                          }
                          className="mt-3 min-h-24 w-full rounded-xl border bg-card p-3 font-mono text-xs outline-none transition focus:border-primary focus:ring-3 focus:ring-primary/10"
                          placeholder={placeholder}
                          aria-label={`Add blocked ${label.toLowerCase()}`}
                        />
                        <button
                          onClick={() => addBlockedValues(kind)}
                          className="mt-3 h-10 w-full rounded-xl bg-primary text-xs font-bold text-primary-foreground"
                        >
                          Block values
                        </button>
                        <div className="mt-4 space-y-2">
                          {collaboration.blockedAccess[kind].length ? (
                            collaboration.blockedAccess[kind].map((value) => (
                              <div
                                key={value}
                                className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2"
                              >
                                <span
                                  className="min-w-0 truncate font-mono text-xs"
                                  title={value}
                                >
                                  {value}
                                </span>
                                <button
                                  onClick={() =>
                                    removeBlockedValue(kind, value)
                                  }
                                  className="shrink-0 text-xs font-bold text-red-600 hover:underline dark:text-red-300"
                                >
                                  Remove
                                </button>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              No blocked values yet.
                            </p>
                          )}
                        </div>
                      </article>
                    ))}
                </div>
              </section>
            )}
            {isModerator && tab === 'roles' && (
              <div className="space-y-5">
                <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
                  <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="font-bold">Role management</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Assign administrative roles independently from each
                        account&apos;s subscription.
                      </p>
                    </div>
                    <input
                      type="search"
                      value={roleSearch}
                      onChange={(event) => {
                        setRoleSearch(event.target.value);
                        setRoleSectionPages({});
                      }}
                      className="h-10 w-full rounded-xl border bg-card px-3 text-sm sm:w-72"
                      placeholder="Search name, email, or university ID"
                      aria-label="Search accounts"
                    />
                  </div>
                  <p className="border-b px-5 py-3 text-xs text-muted-foreground">
                    Moderator includes Reviewer and Access Manager permissions.
                    Subscription features are managed separately.
                  </p>
                  {roleGroups.map((group) => {
                    const page = Math.min(
                      roleSectionPages[group.id] ?? 0,
                      Math.max(0, Math.ceil(group.members.length / 20) - 1),
                    );
                    return (
                      <details
                        key={group.id}
                        open
                        className="border-b last:border-b-0"
                      >
                        <summary className="cursor-pointer bg-muted/30 px-5 py-4 text-sm font-bold">
                          {group.label}
                          <span className="ms-3 inline-flex min-w-7 items-center justify-center rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                            {group.members.length}
                          </span>
                        </summary>
                        <div className="divide-y">
                          {group.members
                            .slice(page * 20, page * 20 + 20)
                            .map((member) => {
                              const draft = roleDraftFor(member);
                              const unsaved = hasUnsavedRoles(member);
                              return (
                                <div
                                  key={member.uid}
                                  className={cx(
                                    'flex flex-col gap-4 p-5 transition lg:flex-row lg:items-center',
                                    unsaved &&
                                      'bg-amber-50/60 dark:bg-amber-500/5',
                                  )}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <strong className="block truncate">
                                        {member.displayName}
                                      </strong>
                                      {unsaved && (
                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                                          Unsaved
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-1 truncate text-xs text-muted-foreground">
                                      {member.email} · {member.universityId}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      aria-pressed={draft.includes('moderator')}
                                      onClick={() =>
                                        toggleAccountRole(member, 'moderator')
                                      }
                                      className={cx(
                                        'h-10 rounded-xl border px-4 text-xs font-bold transition',
                                        draft.includes('moderator') &&
                                          'border-primary bg-primary text-primary-foreground',
                                      )}
                                    >
                                      Moderator
                                    </button>
                                    <button
                                      aria-pressed={
                                        draft.includes('moderator') ||
                                        draft.includes('reviewer')
                                      }
                                      disabled={draft.includes('moderator')}
                                      onClick={() =>
                                        toggleAccountRole(member, 'reviewer')
                                      }
                                      className={cx(
                                        'h-10 rounded-xl border px-4 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60',
                                        (draft.includes('moderator') ||
                                          draft.includes('reviewer')) &&
                                          'border-primary bg-primary text-primary-foreground',
                                      )}
                                    >
                                      Reviewer
                                    </button>
                                    <button
                                      aria-pressed={
                                        draft.includes('moderator') ||
                                        draft.includes('access_manager')
                                      }
                                      disabled={draft.includes('moderator')}
                                      onClick={() =>
                                        toggleAccountRole(
                                          member,
                                          'access_manager',
                                        )
                                      }
                                      className={cx(
                                        'h-10 rounded-xl border px-4 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60',
                                        (draft.includes('moderator') ||
                                          draft.includes('access_manager')) &&
                                          'border-primary bg-primary text-primary-foreground',
                                      )}
                                    >
                                      Access Manager
                                    </button>
                                    <button
                                      onClick={() => saveAccountRoles(member)}
                                      disabled={!unsaved}
                                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-35"
                                    >
                                      <Save className="size-4" />
                                      Save
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                        {!group.members.length && (
                          <p className="px-5 py-4 text-sm text-muted-foreground">
                            No matching users in this section.
                          </p>
                        )}
                        {group.members.length > 20 && (
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
                            <span>
                              Page {page + 1} of{' '}
                              {Math.ceil(group.members.length / 20)}
                            </span>
                            <div className="flex gap-2">
                              <button
                                className="q-button q-button-secondary"
                                disabled={page === 0}
                                onClick={() =>
                                  setRoleSectionPages((current) => ({
                                    ...current,
                                    [group.id]: page - 1,
                                  }))
                                }
                              >
                                Previous
                              </button>
                              <button
                                className="q-button q-button-secondary"
                                disabled={
                                  (page + 1) * 20 >= group.members.length
                                }
                                onClick={() =>
                                  setRoleSectionPages((current) => ({
                                    ...current,
                                    [group.id]: page + 1,
                                  }))
                                }
                              >
                                Next
                              </button>
                            </div>
                          </div>
                        )}
                      </details>
                    );
                  })}
                </section>
                <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
                  <div className="border-b p-5">
                    <h2 className="font-bold">Pending role requests</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Moderators can approve or reject role requests submitted
                      from the Contributions page.
                    </p>
                  </div>
                  {roleRequests.length ? (
                    <div className="divide-y">
                      {roleRequests.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"
                        >
                          <div className="flex-1">
                            <strong>{item.userName}</strong>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Requests {item.requestedRole.replaceAll('_', ' ')}{' '}
                              · {item.reason}
                            </p>
                          </div>
                          <button
                            onClick={() => reviewRole(item.id, false)}
                            className="h-9 rounded-lg border px-3 text-xs font-bold text-red-600 dark:text-red-300"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => reviewRole(item.id, true)}
                            className="q-button q-button-study"
                          >
                            Approve
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-10 text-center text-sm text-muted-foreground">
                      No pending role requests.
                    </div>
                  )}
                </section>
              </div>
            )}
            {tab === 'qbanks' && (
              <section className="grid gap-4 md:grid-cols-2">
                {isRoot && (
                  <QBankFolderManager
                    user={user}
                    collaboration={collaboration}
                    update={update}
                    replaceFromServer={replaceFromServer}
                  />
                )}
                {qbankActionMessage && (
                  <output className="rounded-2xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-border md:col-span-2">
                    {qbankActionMessage}
                  </output>
                )}
                {collaboration.qbanks.map((bank) => (
                  <article
                    key={bank.id}
                    className="rounded-2xl bg-card p-5 ring-1 ring-border"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                          {bank.visibility.toUpperCase()}
                        </span>
                        {bank.archived && (
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                            HIDDEN
                          </span>
                        )}
                        {bank.essential && (
                          <span className="rounded-full bg-muted px-2 py-1 text-xs font-bold text-muted-foreground">
                            ESSENTIAL
                          </span>
                        )}
                      </div>
                      {bank.visibility === 'private' &&
                        isRoot &&
                        bank.ownerId !== user.uid && (
                          <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
                            READ-ONLY AUDIT
                          </span>
                        )}
                    </div>
                    <h3 className="mt-3 font-bold">{bank.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {bank.description || 'No description.'}
                    </p>
                    <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                      Owner: {bank.ownerName} · {bank.reviewerIds.length}{' '}
                      reviewers · {bank.viewerIds.length} viewers
                    </p>
                    {isSuperadminWorkspace && (
                      <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                        <button
                          type="button"
                          disabled={Boolean(qbankActionId)}
                          onClick={() =>
                            void setQBankHidden(bank, !bank.archived)
                          }
                          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {bank.archived ? (
                            <Eye className="size-4" />
                          ) : (
                            <EyeOff className="size-4" />
                          )}
                          {qbankActionId === bank.id
                            ? 'Saving…'
                            : bank.archived
                              ? 'Show QBank'
                              : 'Hide QBank'}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(qbankActionId) || bank.essential}
                          title={
                            bank.essential
                              ? 'Essential QBanks can be hidden but not permanently deleted.'
                              : 'Permanently delete this QBank and its related data.'
                          }
                          onClick={() => void deleteQBank(bank)}
                          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-500/10"
                        >
                          <Trash2 className="size-4" />
                          Delete QBank
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </section>
            )}
            {tab === 'proposals' && (
              <ReviewWorkspace
                user={user}
                collaboration={collaboration}
                update={update}
                replaceFromServer={replaceFromServer}
                embedded
              />
            )}
            {isRoot && tab === 'ready-tests' && (
              <PreformedReportsAdmin key={refreshRevision} />
            )}
            {tab === 'reviewer-performance' && user.isAdmin && (
              <ReviewerPerformance key={refreshRevision} />
            )}
            {tab === 'audit' && (
              <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
                <div className="border-b p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="font-bold">Audit log</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        One small weekly request at a time. Choose a year, month
                        and week.
                      </p>
                    </div>
                    <input
                      aria-label="Search audit log"
                      placeholder="Search activity…"
                      value={auditSearch}
                      onChange={(e) => {
                        setAuditSearch(e.target.value);
                        setAuditPage(0);
                      }}
                      className="min-h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-sm sm:w-72"
                    />
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <select
                      aria-label="Audit year"
                      value={auditYear}
                      onChange={(event) => {
                        const year = Number(event.target.value);
                        setAuditYear(year);
                        setAuditWeek(weeksForMonth(year, auditMonth)[0]);
                        setAuditPage(0);
                      }}
                      className="h-11 rounded-xl border bg-background px-3 text-sm font-semibold"
                    >
                      {Array.from(
                        { length: 7 },
                        (_, index) => new Date().getUTCFullYear() - index,
                      ).map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Audit month"
                      value={auditMonth}
                      onChange={(event) => {
                        const month = Number(event.target.value);
                        setAuditMonth(month);
                        setAuditWeek(weeksForMonth(auditYear, month)[0]);
                        setAuditPage(0);
                      }}
                      className="h-11 rounded-xl border bg-background px-3 text-sm font-semibold"
                    >
                      {Array.from({ length: 12 }, (_, month) => (
                        <option key={month} value={month}>
                          {new Intl.DateTimeFormat('en', {
                            month: 'long',
                          }).format(new Date(Date.UTC(2026, month, 1)))}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Audit week"
                      value={auditWeek}
                      onChange={(event) => {
                        setAuditWeek(event.target.value);
                        setAuditPage(0);
                      }}
                      className="h-11 rounded-xl border bg-background px-3 text-sm font-semibold"
                    >
                      {auditWeeks.map((week, index) => (
                        <option key={week} value={week}>
                          Week {index + 1} · {formatDate(week)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {auditLimited && (
                    <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
                      Showing the newest 250 entries for this week.
                    </p>
                  )}
                </div>
                <div className="divide-y">
                  {auditBusy && (
                    <div className="space-y-3 p-5">
                      {Array.from({ length: 5 }, (_, index) => (
                        <div
                          key={index}
                          className="h-12 animate-pulse rounded-xl bg-muted"
                        />
                      ))}
                    </div>
                  )}
                  {!auditBusy &&
                    filteredAudit
                      .slice(logsPage * 25, logsPage * 25 + 25)
                      .map((item) => (
                        <details
                          key={item.id}
                          className="group min-w-0 text-sm open:bg-muted/20"
                        >
                          <summary className="grid min-h-14 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/30 focus-visible:outline-offset-[-3px] lg:grid-cols-[minmax(100px,0.8fr)_minmax(0,1.4fr)_minmax(0,1.5fr)_auto] [&::-webkit-details-marker]:hidden">
                            <strong className="min-w-0 break-words" dir="auto">
                              {item.actorName}
                            </strong>
                            <span className="col-start-1 min-w-0 break-words text-xs font-semibold uppercase text-primary lg:col-auto">
                              {item.action.replaceAll('_', ' ')}
                            </span>
                            <time
                              dateTime={item.createdAt}
                              className="col-start-1 min-w-0 text-xs text-muted-foreground lg:col-auto"
                            >
                              {formatDate(item.createdAt)}
                            </time>
                            <span className="col-start-2 row-start-1 row-end-4 text-xs font-medium text-primary lg:col-auto lg:row-auto">
                              <span className="group-open:hidden">
                                Details +
                              </span>
                              <span className="hidden group-open:inline">
                                Close −
                              </span>
                            </span>
                          </summary>
                          <div className="space-y-3 border-t border-dashed px-4 py-3">
                            <p className="break-words text-xs text-muted-foreground">
                              Target: {item.entityId} · Event: {item.id}
                            </p>
                            <p
                              dir="auto"
                              className="whitespace-pre-wrap break-words text-sm leading-6"
                            >
                              {item.detail || 'No additional details.'}
                            </p>
                          </div>
                        </details>
                      ))}
                </div>
                {!auditBusy && !filteredAudit.length && (
                  <p className="p-6 text-sm text-muted-foreground">
                    No activity matches this week and search.
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs text-muted-foreground">
                  <span>
                    {filteredAudit.length} entries · Page {logsPage + 1} of{' '}
                    {Math.max(1, Math.ceil(filteredAudit.length / 25))}
                  </span>
                  <div className="flex gap-2">
                    <button
                      className="q-button border"
                      disabled={logsPage === 0}
                      onClick={() => setAuditPage(logsPage - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="q-button border"
                      disabled={(logsPage + 1) * 25 >= filteredAudit.length}
                      onClick={() => setAuditPage(logsPage + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
      {qbankConfirmationDialog}
    </div>
  );
}

export function PendingApproval({
  user,
  onSignOut,
}: {
  user: AppUser;
  onSignOut: () => void;
}) {
  const blocked = user.suspended;
  const rejected = user.status === 'rejected';
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <section className="w-full max-w-lg rounded-[26px] bg-card p-8 text-center shadow-xl ring-1 ring-border">
        <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          {blocked || rejected ? (
            <UserRoundX className="size-7" />
          ) : (
            <Clock3 className="size-7" />
          )}
        </div>
        <p className="mt-6 text-xs font-bold uppercase tracking-widest text-primary">
          Qraft membership
        </p>
        <h1 className="mt-2 text-2xl font-bold">
          {blocked
            ? 'Account access blocked'
            : rejected
              ? 'Registration not approved'
              : 'You’re on the list.'}
        </h1>
        <p className="mx-auto mt-3 text-sm leading-6 text-muted-foreground">
          {blocked
            ? 'An Access Manager or the Superadmin must restore this account.'
            : rejected
              ? 'Contact your cohort Access Manager if you believe this is a mistake.'
              : 'Your account has been created. An administrator will check your details before you can open your question banks.'}
        </p>
        <div className="mt-6 rounded-xl bg-muted/60 p-4 text-left text-sm">
          <p className="font-semibold">
            {blocked || rejected ? 'Need help?' : 'What happens next?'}
          </p>
          <p className="mt-2 leading-6 text-muted-foreground">
            {blocked || rejected
              ? 'Contact the administrator who manages your question bank for help with your account.'
              : 'After approval, sign in again to start studying. You don’t need to create another account.'}
          </p>
        </div>
        <button
          onClick={onSignOut}
          className="mt-6 h-11 w-full rounded-xl border text-sm font-bold"
        >
          Sign out
        </button>
      </section>
    </main>
  );
}
