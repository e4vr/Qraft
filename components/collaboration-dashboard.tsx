'use client';

import { ArrowRight, BookOpen, Clock3, Fingerprint, Menu, Save, Search, ShieldCheck, UserCheck, UserRoundX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { canReviewBank, normalizeEmail, normalizePhone, normalizeUniversityId, type AccessBlocklist, type AccountStatus, type AppUser, type AuditEntry, type CollaborationState, type MemberProfile, type PlatformRole } from '@/lib/medguard-types';
import { cn as cx, nowIso } from '@/lib/utils';
import { SubscriptionAdmin } from '@/components/subscription-workspace';
import { EconomyAdmin } from '@/components/economy-admin';
import { ContactWorkspace } from '@/components/contact-workspace';
import { QuestionPreview } from '@/components/question-tools';
import { ReviewWorkspace } from '@/components/review-workspace';

type Tab = 'discounts' | 'subscriptions' | 'economy' | 'contact' | 'question-preview' | 'overview' | 'registrations' | 'blocked' | 'roles' | 'qbanks' | 'proposals' | 'student-ids' | 'audit';
const adminGroups: Array<{ label: string; ids: Tab[] }> = [
  { label: 'WORKSPACE', ids: ['overview', 'contact', 'audit'] },
  { label: 'PEOPLE & ACCESS', ids: ['registrations', 'roles', 'student-ids', 'blocked'] },
  { label: 'SUBSCRIPTIONS', ids: ['subscriptions', 'discounts', 'economy'] },
  { label: 'QUESTION BANKS', ids: ['qbanks', 'proposals', 'question-preview'] },
];
type BlockKind = keyof AccessBlocklist;
function formatDate(value?: string) {
  return value
    ? new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : '—';
}
function audit(user: AppUser, action: string, entityType: AuditEntry['entityType'], entityId: string, detail: string): AuditEntry {
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

function memberMatchesBlocklist(member: MemberProfile, blockedAccess: AccessBlocklist): boolean {
  return Boolean(
    (member.phone && blockedAccess.phones.includes(normalizePhone(member.phone))) ||
      blockedAccess.universityIds.includes(normalizeUniversityId(member.universityId)) ||
      blockedAccess.emails.includes(normalizeEmail(member.email)),
  );
}

export function AdminDashboard({ user, collaboration, update, replaceFromServer }: { user: AppUser; collaboration: CollaborationState; update: (updater: (current: CollaborationState) => CollaborationState) => void; replaceFromServer: (next: CollaborationState) => void }) {
  const canAccess = user.role === 'super_admin' || user.platformRoles.includes('access_manager') || user.role === 'admin' || user.role === 'access_manager';
  const isRoot = user.role === 'super_admin';
  const isReviewer = isRoot || user.platformRoles.includes('reviewer') || user.role === 'reviewer';
  const tabs = useMemo(
    () =>
      [
        ['overview', 'Overview'],
        ...(canAccess ? [['registrations', 'Registrations']] : []),
        ...(canAccess ? [['blocked', 'Blocked access']] : []),
        ...(isRoot
          ? [
              ['discounts', 'Discount Codes'], ['subscriptions', 'Subscriptions'], ['economy', 'Credits & rewards'], ['contact', 'Contact Tickets'], ['question-preview', 'Question Preview'],
              ['student-ids', 'Student IDs'],
              ['roles', 'Roles & promotion'],
            ]
          : []),
        ...(isRoot || isReviewer ? [['qbanks', isRoot ? 'All QBanks' : 'QBanks']] : []),
        ...(isReviewer || collaboration.qbanks.some((bank) => canReviewBank(user, bank, collaboration.memberships)) ? [['proposals', 'Edit review']] : []),
        ...(isRoot ? [['audit', 'Audit log']] : []),
      ] as Array<[Tab, string]>,
    [canAccess, collaboration, isReviewer, isRoot, user],
  );
  const [tab, setTab] = useState<Tab>('overview');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberStatus, setMemberStatus] = useState('all');
  const [memberPage, setMemberPage] = useState(0);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditPage, setAuditPage] = useState(0);
  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return collaboration.members.filter(m =>
      (memberStatus === 'all' || (memberStatus === 'suspended' ? m.suspended : m.status === memberStatus)) &&
      [m.displayName, m.email, m.uid, m.phone, m.universityId].some(value => String(value ?? '').toLowerCase().includes(query)),
    ).sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }, [collaboration.members, memberSearch, memberStatus]);
  const filteredAudit = useMemo(() => {
    const query = auditSearch.trim().toLowerCase();
    return collaboration.auditLog.filter(entry => [entry.actorName, entry.actorId, entry.action, entry.entityId, entry.detail].some(value => String(value ?? '').toLowerCase().includes(query)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [collaboration.auditLog, auditSearch]);
  const membersPage = Math.min(memberPage, Math.max(0, Math.ceil(filteredMembers.length / 20) - 1));
  const logsPage = Math.min(auditPage, Math.max(0, Math.ceil(filteredAudit.length / 25) - 1));
  const [idText, setIdText] = useState('');
  const [roleSearch, setRoleSearch] = useState('');
  const [roleSectionPages, setRoleSectionPages] = useState<Record<string, number>>({});
  const roleGroups = useMemo(() => {
    const query = roleSearch.trim().toLowerCase();
    const members = collaboration.members.filter(member => member.role !== 'super_admin' && member.status === 'approved' && `${member.displayName} ${member.email} ${member.universityId}`.toLowerCase().includes(query));
    const reviewer = (member: MemberProfile) => member.role === 'reviewer' || member.platformRoles.includes('reviewer');
    const access = (member: MemberProfile) => member.platformRoles.includes('access_manager');
    return [
      { id: 'unlimited', label: 'Unlimited users', members: members.filter(member => member.tier === 'unlimited') },
      { id: 'pro', label: 'Pro users', members: members.filter(member => member.tier === 'pro') },
      { id: 'reviewer', label: 'Reviewers', members: members.filter(reviewer) },
      { id: 'access', label: 'Access managers', members: members.filter(access) },
      { id: 'lite', label: 'Lite users', members: members.filter(member => member.tier === 'lite' && !reviewer(member) && !access(member)) },
      { id: 'free', label: 'Free users', members: members.filter(member => member.tier === 'free' && !reviewer(member) && !access(member)) },
    ];
  }, [collaboration.members, roleSearch]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Pick<MemberProfile, 'tier' | 'platformRoles'>>>({});
  const [blockText, setBlockText] = useState<Record<BlockKind, string>>({ phones: '', universityIds: '', emails: '' });
  const pendingMembers = collaboration.members.filter((item) => item.status === 'pending');
  const pendingManualIdChecks = pendingMembers.filter((item) => item.role !== 'super_admin' && !item.universityIdRegistered);
  const reviewable = collaboration.proposals.filter((proposal) => proposal.status === 'pending' && collaboration.qbanks.some((bank) => bank.id === proposal.qbankId && canReviewBank(user, bank, collaboration.memberships)));
  const roleRequests = collaboration.roleApplications.filter((item) => item.status === 'pending');

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
              universityIdVerifiedManually: status === 'approved' && !item.universityIdRegistered ? true : item.universityIdVerifiedManually,
            }
          : item,
      ),
      auditLog: [audit(user, `registration_${status}`, 'account', uid, `${status} membership request.`), ...current.auditLog],
    }));
  }

  function toggleSuspended(member: MemberProfile) {
    if (!isRoot && member.subscriptionProtected) return;
    update((current) => ({
      ...current,
      members: current.members.map((item) => (item.uid === member.uid ? { ...item, suspended: !item.suspended } : item)),
      auditLog: [audit(user, member.suspended ? 'account_restored' : 'account_blocked', 'account', member.uid, `${member.displayName} access ${member.suspended ? 'restored' : 'blocked'}.`), ...current.auditLog],
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
      const existing = new Set(current.allowedUniversityIds.map((item) => item.id));
      const added = values.filter((id) => !existing.has(id)).map((id) => {
        const claimant = current.members.find((member) => normalizeUniversityId(member.universityId) === normalizeUniversityId(id));
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
        auditLog: added.length ? [audit(user, 'student_ids_added', 'university_id', added[0].id, `${added.length} eligible IDs added.`), ...current.auditLog] : current.auditLog,
      };
    });
    setIdText('');
  }

  function addBlockedValues(kind: BlockKind) {
    const values = [...new Set(blockText[kind].split(/[\s,;]+/).map((item) => normalizeBlockValue(kind, item)).filter(Boolean))];
    if (!values.length) return;
    update((current) => {
      const existing = new Set(current.blockedAccess[kind]);
      const added = values.filter((value) => !existing.has(value));
      if (!added.length) return current;
      const blockedAccess: AccessBlocklist = { ...current.blockedAccess, [kind]: [...current.blockedAccess[kind], ...added] };
      return {
        ...current,
        blockedAccess,
        members: current.members.map((member) => member.role === 'super_admin' || !memberMatchesBlocklist(member, blockedAccess) ? member : { ...member, suspended: true }),
        auditLog: [audit(user, 'access_block_added', 'access_block', added[0], `${added.length} ${kind} value${added.length === 1 ? '' : 's'} blocked.`), ...current.auditLog],
      };
    });
    setBlockText((current) => ({ ...current, [kind]: '' }));
  }

  function removeBlockedValue(kind: BlockKind, value: string) {
    update((current) => ({
      ...current,
      blockedAccess: { ...current.blockedAccess, [kind]: current.blockedAccess[kind].filter((item) => item !== value) },
      auditLog: [audit(user, 'access_block_removed', 'access_block', value, `${kind} block removed.`), ...current.auditLog],
    }));
  }

  function reviewRole(applicationId: string, approved: boolean) {
    const application = collaboration.roleApplications.find((item) => item.id === applicationId);
    if (!application || !isRoot) return;
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
                  tier: application.requestedRole === 'pro' || application.requestedRole === 'access_manager' ? 'pro' : member.tier,
                  platformRoles: application.requestedRole === 'pro' ? member.platformRoles : [...new Set([...member.platformRoles, application.requestedRole as PlatformRole])],
                }
              : member,
          )
        : current.members,
      auditLog: [audit(user, approved ? 'role_request_approved' : 'role_request_rejected', 'role', application.id, `${application.requestedRole} request by ${application.userName}.`), ...current.auditLog],
    }));
  }

  function toggleAccountAccess(member: MemberProfile, access: 'pro' | PlatformRole) {
    if (!isRoot || member.role === 'super_admin') return;
    setRoleDrafts((current) => {
      const draft = current[member.uid] ?? { tier: member.tier, platformRoles: [...member.platformRoles] };
      const enabling = access === 'pro' ? draft.tier !== 'pro' : !draft.platformRoles.includes(access);
      return {
        ...current,
        [member.uid]: access === 'pro'
          ? { ...draft, tier: enabling ? 'pro' : 'lite' }
          : {
              tier: access === 'access_manager' && enabling ? 'pro' : draft.tier,
              platformRoles: enabling ? [...new Set([...draft.platformRoles, access])] : draft.platformRoles.filter((role) => role !== access),
            },
      };
    });
  }

  function accessDraftFor(member: MemberProfile) {
    return roleDrafts[member.uid] ?? { tier: member.tier, platformRoles: member.platformRoles };
  }

  function hasUnsavedAccess(member: MemberProfile) {
    const draft = roleDrafts[member.uid];
    if (!draft) return false;
    return draft.tier !== member.tier || [...draft.platformRoles].sort().join('|') !== [...member.platformRoles].sort().join('|');
  }

  function saveAccountAccess(member: MemberProfile) {
    const draft = roleDrafts[member.uid];
    if (!isRoot || member.role === 'super_admin' || !draft || !hasUnsavedAccess(member)) return;
    update((current) => ({
      ...current,
      members: current.members.map((item) => (item.uid === member.uid ? { ...item, tier: draft.tier, platformRoles: [...draft.platformRoles] } : item)),
      auditLog: [
        audit(user, 'account_roles_saved', 'role', member.uid, `Saved ${member.displayName}'s access: ${draft.tier}${draft.platformRoles.length ? `, ${draft.platformRoles.join(', ')}` : ''}.`),
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
    <>
      <header className="workspace-header">
        <div className="flex min-w-0 items-center gap-3">
          <button aria-label="Open navigation" onClick={() => window.dispatchEvent(new Event('medguard-open-menu'))} className="grid size-10 shrink-0 place-items-center rounded-xl border lg:hidden">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" />
              <h1 className="truncate text-lg font-bold tracking-tight">Administration</h1>
            </div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">Manage members, access and shared content</p>
          </div>
        </div>
        <div className="workspace-header-actions">
          <span className="inline-flex min-h-10 items-center rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{isRoot ? 'SUPERADMIN · MFA' : (user.platformRoles.join(' · ') || user.role).replaceAll('_', ' ').toUpperCase()}</span>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] items-start gap-5 p-4 sm:p-7 xl:grid-cols-[190px_minmax(0,1fr)]">
        <nav aria-label="Administration sections" className="min-w-0 rounded-2xl border bg-card p-3">
          <label className="block text-xs font-semibold text-muted-foreground xl:hidden">
            Administration section
            <select value={tab} onChange={e => setTab(e.target.value as Tab)} className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3 text-base text-foreground">
              {adminGroups.map(group => {
                const available = tabs.filter(([id]) => group.ids.includes(id));
                return available.length ? <optgroup key={group.label} label={group.label}>{available.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</optgroup> : null;
              })}
            </select>
          </label>
          <div className="hidden space-y-5 xl:block">
            {adminGroups.map(group => {
              const available = tabs.filter(([id]) => group.ids.includes(id));
              return available.length ? <div key={group.label}>
                <p className="mb-2 px-2 text-[10px] font-bold tracking-wider text-muted-foreground">{group.label}</p>
                {available.map(([id, label]) => {
                  const count = id === 'registrations' ? pendingMembers.length : id === 'roles' ? roleRequests.length : id === 'proposals' ? reviewable.length : 0;
                  return <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)} className={cx('flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-start text-sm font-semibold transition-colors', tab === id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                    <span>{label}</span>{count > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-foreground">{count}</span>}
                  </button>;
                })}
              </div> : null;
            })}
          </div>
        </nav>
        <div className="min-w-0 space-y-5">
        {isRoot && (tab === 'discounts' || tab === 'subscriptions') && <SubscriptionAdmin section={tab} />}
        {isRoot && tab === 'economy' && <EconomyAdmin members={collaboration.members} />}
        {isRoot && tab === 'contact' && <ContactWorkspace admin />}
        {isRoot && tab === 'question-preview' && <QuestionPreview />}
        {tab === 'overview' && (
          <div className="space-y-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-primary">Admin overview</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">Your workspace at a glance</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Review pending work, manage access and keep your question banks up to date.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              {([
                { id: 'registrations', label: 'Pending registrations', value: pendingMembers.length, detail: `${pendingManualIdChecks.length} IDs need manual verification`, icon: UserCheck },
                { id: 'roles', label: 'Role requests', value: roleRequests.length, detail: 'Review access and responsibilities', icon: ShieldCheck },
                { id: 'proposals', label: 'Edits to review', value: reviewable.length, detail: 'Question changes awaiting review', icon: Clock3 },
                { id: 'qbanks', label: 'Visible QBanks', value: collaboration.qbanks.length, detail: 'Open the question bank directory', icon: BookOpen },
              ] as const).filter(item => tabs.some(([id]) => id === item.id)).map(item => (
                <button key={item.id} onClick={() => { setTab(item.id); if (item.id === 'registrations') { setMemberStatus('pending'); setMemberSearch(''); setMemberPage(0); } }} className="group min-w-0 rounded-2xl border bg-card p-5 text-start transition-colors hover:border-primary/40 hover:bg-primary/5">
                  <div className="flex items-center justify-between gap-2"><item.icon className="size-5 text-primary" /><ArrowRight className="size-4 text-muted-foreground" /></div>
                  <strong className="mt-4 block text-3xl tabular-nums">{item.value}</strong>
                  <p className="mt-1 text-sm font-semibold">{item.label}</p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                </button>
              ))}
            </div>
            {isRoot && <section className="rounded-2xl border bg-card p-5">
              <h3 className="font-bold">Quick access</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {([['contact', 'Contact Tickets', 'Respond to account and question issues.'], ['subscriptions', 'Subscriptions', 'Manage Pro access and expiration dates.'], ['discounts', 'Discount Codes', 'Set pricing and manage promotions.'], ['question-preview', 'Question Preview', 'Find a question by ID and inspect the student view.']] as const).map(([id, label, detail]) => <button key={id} onClick={() => setTab(id)} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border p-4 text-start hover:bg-muted/50"><span><strong className="block text-sm">{label}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span></span><ArrowRight className="size-4 shrink-0 text-muted-foreground" /></button>)}
              </div>
            </section>}
            {isRoot && <section className="rounded-2xl border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">Recent activity</h3><button className="q-button border" onClick={() => { setAuditSearch(''); setAuditPage(0); setTab('audit'); }}>View audit log</button></div>
              {[...collaboration.auditLog].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map(item => <div key={item.id} className="mt-4 flex flex-wrap items-start justify-between gap-2 border-t pt-4"><div className="min-w-0"><p className="break-words text-sm font-semibold">{item.action.replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-muted-foreground">{item.actorName}</p></div><time className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</time></div>)}
              {!collaboration.auditLog.length && <p className="mt-4 text-sm text-muted-foreground">No activity recorded yet.</p>}
            </section>}
          </div>
        )}
        {tab === 'registrations' && (
          <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            <div className="border-b p-5">
              <h2 className="font-bold">Registration and access</h2>
              <p className="text-xs text-muted-foreground">Review every registrant detail before approving, rejecting, blocking, or restoring an account.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                <label className="relative"><Search aria-hidden="true" className="absolute left-3 top-3.5 size-4 text-muted-foreground" /><input aria-label="Search members" placeholder={isRoot ? "Name, email, phone or ID" : "Name, email or university ID"} value={memberSearch} onChange={e => { setMemberSearch(e.target.value); setMemberPage(0); }} className="min-h-11 w-full min-w-0 rounded-xl border bg-background py-2 pl-10 pr-3 text-sm" /></label>
                <select aria-label="Filter members by status" value={memberStatus} onChange={e => { setMemberStatus(e.target.value); setMemberPage(0); }} className="min-h-11 rounded-xl border bg-background px-3 text-sm">{['all', 'pending', 'approved', 'rejected', 'suspended'].map(status => <option key={status} value={status}>{status === 'all' ? 'All statuses' : status}</option>)}</select>
              </div>
              <output className="mt-3 block text-xs text-muted-foreground">{filteredMembers.length} matching members · Pending requests appear first</output>
            </div>
            {filteredMembers.length ? (
              <div className="overflow-x-auto">
                <table className={cx('w-full text-left text-sm', isRoot ? 'min-w-[1120px]' : 'min-w-[680px]')}>
                  <thead className="border-b bg-muted/30 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3">Registrant</th>
                      <th className="px-5 py-3">Email</th>
                      {isRoot && <th className="px-5 py-3">Mobile</th>}
                      <th className="px-5 py-3">University ID</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Role &amp; tier</th>
                      {isRoot && <th className="px-5 py-3">Registered</th>}
                      {isRoot && <th className="px-5 py-3">Reviewed by</th>}
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {filteredMembers.slice(membersPage * 20, membersPage * 20 + 20).map((member) => (
                      <tr key={member.uid} className="align-top transition hover:bg-muted/20">
                        <td className="px-5 py-4">
                          <strong className="block whitespace-nowrap text-sm">{member.displayName}</strong>
                          {isRoot && <span className="mt-1 block max-w-[150px] truncate font-mono text-xs text-muted-foreground" title={member.uid}>
                            {member.uid}
                          </span>}
                        </td>
                        <td className="px-5 py-4">
                          <span className="block max-w-[220px] truncate" title={member.email}>
                            {member.email}
                          </span>
                        </td>
                        {isRoot && <td className="px-5 py-4 font-mono text-xs">{member.phone || '—'}</td>}
                        <td className="px-5 py-4">
                          <strong className="block font-mono text-xs">{member.universityId}</strong>
                          {member.role === 'super_admin' ? (
                            <span className="mt-1 inline-flex rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">SYSTEM ACCOUNT</span>
                          ) : member.universityIdRegistered ? (
                            <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">REGISTERED IN SYSTEM</span>
                          ) : member.universityIdVerifiedManually ? (
                            <span className="mt-1 inline-flex rounded-full bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">MANUALLY VERIFIED</span>
                          ) : (
                            <span className="mt-1 inline-flex max-w-[190px] rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold leading-4 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">NOT REGISTERED · VERIFY MANUALLY</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <span className={cx('inline-flex rounded-full px-2.5 py-1 text-xs font-bold uppercase', member.suspended ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : member.status === 'pending' ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200' : member.status === 'approved' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-muted text-muted-foreground')}>
                            {member.suspended ? 'Blocked' : member.status}
                          </span>
                          {isRoot && <span className="mt-1 block text-xs text-muted-foreground">MFA {member.mfaEnrolled ? 'enabled' : 'not enabled'}</span>}
                        </td>
                        <td className="px-5 py-4">
                          <span className="block capitalize">{member.role.replaceAll('_', ' ')}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{member.tier} · {member.platformRoles.length ? member.platformRoles.join(', ') : 'no extra roles'}</span>
                        </td>
                        {isRoot && <td className="whitespace-nowrap px-5 py-4 text-xs text-muted-foreground">{formatDate(member.createdAt)}</td>}
                        {isRoot && <td className="px-5 py-4 text-xs">
                          {member.approvedByName ? <><span className="block">{member.approvedByName}</span><span className="mt-1 block text-muted-foreground">{formatDate(member.approvedAt)}</span></> : <span className="text-muted-foreground">Pending review</span>}
                        </td>}
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            {!isRoot && member.subscriptionProtected && <span className="text-xs text-muted-foreground">Official subscription · Superadmin only</span>}
                            {member.status === 'pending' && (isRoot || !member.subscriptionProtected) && (
                              <>
                                <button onClick={() => reviewMember(member.uid, 'rejected')} className="h-9 rounded-lg border px-3 text-xs font-bold text-red-600 dark:text-red-300">
                                  <UserRoundX className="mr-1 inline size-4" />
                                  Reject
                                </button>
                                <button onClick={() => reviewMember(member.uid, 'approved')} className="q-button q-button-study">
                                  <UserCheck className="mr-1 inline size-4" />
                                  {member.universityIdRegistered ? 'Approve' : 'Verify & approve'}
                                </button>
                              </>
                            )}
                            {member.status === 'approved' && member.role !== 'super_admin' && (
                              <>
                                {isRoot && (
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
                                {(isRoot || !member.subscriptionProtected) && <button onClick={() => toggleSuspended(member)} className="h-9 rounded-lg border px-3 text-xs font-bold">
                                  {member.suspended ? 'Restore' : 'Block'}
                                </button>}
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
              <div className="p-10 text-center text-sm text-muted-foreground">{collaboration.members.length ? 'No members match your search or filter.' : 'No registrations yet.'}</div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs text-muted-foreground">
              <span>Page {membersPage + 1} of {Math.max(1, Math.ceil(filteredMembers.length / 20))}</span>
              <div className="flex gap-2"><button className="q-button border" disabled={membersPage === 0} onClick={() => setMemberPage(membersPage - 1)}>Previous</button><button className="q-button border" disabled={(membersPage + 1) * 20 >= filteredMembers.length} onClick={() => setMemberPage(membersPage + 1)}>Next</button></div>
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
              <textarea value={idText} onChange={(event) => setIdText(event.target.value)} className="mt-4 min-h-40 w-full rounded-xl border bg-card p-3 font-mono text-sm" placeholder={'442001234\n442001235'} />
              <button onClick={addStudentIds} className="mt-3 h-10 w-full rounded-xl bg-primary text-xs font-bold text-primary-foreground">
                Add IDs
              </button>
            </section>
            <section className="flex max-h-[620px] min-w-0 flex-col overflow-hidden rounded-2xl bg-card ring-1 ring-border">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-4">
                <h2 className="text-sm font-bold">Registered IDs · إجمالي الأرقام المسجلة</h2>
                <output aria-label="Total registered student IDs" className="rounded-xl bg-primary/10 px-3 py-1 text-lg font-bold tabular-nums text-primary">{collaboration.allowedUniversityIds.length.toLocaleString('en')}</output>
              </div>
              <div className="min-h-0 divide-y overflow-y-auto overscroll-contain">
                {collaboration.allowedUniversityIds.map((item) => (
                  <div key={item.id} className="flex justify-between p-4 text-sm">
                    <strong className="font-mono">{item.id}</strong>
                    <span className="text-xs text-muted-foreground">{item.claimedByName || 'Available'}</span>
                  </div>
                ))}
                {!collaboration.allowedUniversityIds.length && <p className="p-5 text-sm text-muted-foreground">No student IDs registered yet.</p>}
              </div>
            </section>
          </div>
        )}
        {tab === 'blocked' && (
          <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
            <div className="mb-5">
              <h2 className="font-bold">Blocked access list</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">New registrations matching any value below will be rejected. Existing matching accounts are suspended automatically.</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {([
                ['phones', 'Mobile numbers', '0501234567\n+966501234567'],
                ['universityIds', 'University IDs', '442001234\n442001235'],
                ['emails', 'Email addresses', 'blocked@example.com\nspam@example.com'],
              ] as Array<[BlockKind, string, string]>).filter(([kind]) => isRoot || kind !== 'phones').map(([kind, label, placeholder]) => (
                <article key={kind} className="rounded-2xl border bg-background/35 p-4">
                  <h3 className="text-sm font-bold">{label}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">Add one or more values separated by spaces, commas, or new lines.</p>
                  <textarea
                    value={blockText[kind]}
                    onChange={(event) => setBlockText((current) => ({ ...current, [kind]: event.target.value }))}
                    className="mt-3 min-h-24 w-full rounded-xl border bg-card p-3 font-mono text-xs outline-none transition focus:border-primary focus:ring-3 focus:ring-primary/10"
                    placeholder={placeholder}
                    aria-label={`Add blocked ${label.toLowerCase()}`}
                  />
                  <button onClick={() => addBlockedValues(kind)} className="mt-3 h-10 w-full rounded-xl bg-primary text-xs font-bold text-primary-foreground">
                    Block values
                  </button>
                  <div className="mt-4 space-y-2">
                    {collaboration.blockedAccess[kind].length ? collaboration.blockedAccess[kind].map((value) => (
                      <div key={value} className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
                        <span className="min-w-0 truncate font-mono text-xs" title={value}>{value}</span>
                        <button onClick={() => removeBlockedValue(kind, value)} className="shrink-0 text-xs font-bold text-red-600 hover:underline dark:text-red-300">Remove</button>
                      </div>
                    )) : <p className="text-xs text-muted-foreground">No blocked values yet.</p>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {tab === 'roles' && (
          <div className="space-y-5">
            <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
              <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-bold">Quick account promotion</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Turn Pro, Reviewer, or Access Manager access on or off with one click.</p>
                </div>
                <input
                  type="search"
                  value={roleSearch}
                  onChange={(event) => { setRoleSearch(event.target.value); setRoleSectionPages({}); }}
                  className="h-10 w-full rounded-xl border bg-card px-3 text-sm sm:w-72"
                  placeholder="Search name, email, or university ID"
                  aria-label="Search accounts"
                />
              </div>
              <p className="border-b px-5 py-3 text-xs text-muted-foreground" dir="auto">قد يظهر الحساب في أكثر من قسم حسب صلاحياته المحفوظة. تُحدّث الأقسام بعد Save.</p>
              {roleGroups.map(group => {
                const page = Math.min(roleSectionPages[group.id] ?? 0, Math.max(0, Math.ceil(group.members.length / 20) - 1));
                return <details key={group.id} open className="border-b last:border-b-0">
                  <summary className="cursor-pointer bg-muted/30 px-5 py-4 text-sm font-bold">{group.label}<span className="ms-3 inline-flex min-w-7 items-center justify-center rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{group.members.length}</span></summary>
                  <div className="divide-y">
                {group.members.slice(page * 20, page * 20 + 20).map((member) => {
                    const draft = accessDraftFor(member);
                    const unsaved = hasUnsavedAccess(member);
                    return (
                    <div key={member.uid} className={cx('flex flex-col gap-4 p-5 transition lg:flex-row lg:items-center', unsaved && 'bg-amber-50/60 dark:bg-amber-500/5')}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <strong className="block truncate">{member.displayName}</strong>
                          {unsaved && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">Unsaved</span>}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{member.email} · {member.universityId}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          aria-pressed={draft.tier === 'pro'}
                          onClick={() => toggleAccountAccess(member, 'pro')}
                          className={cx('h-10 rounded-xl border px-4 text-xs font-bold transition', draft.tier === 'pro' && 'border-primary bg-primary text-primary-foreground')}
                        >
                          Pro
                        </button>
                        <button
                          aria-pressed={draft.platformRoles.includes('reviewer')}
                          onClick={() => toggleAccountAccess(member, 'reviewer')}
                          className={cx('h-10 rounded-xl border px-4 text-xs font-bold transition', draft.platformRoles.includes('reviewer') && 'border-primary bg-primary text-primary-foreground')}
                        >
                          Reviewer
                        </button>
                        <button
                          aria-pressed={draft.platformRoles.includes('access_manager')}
                          onClick={() => toggleAccountAccess(member, 'access_manager')}
                          className={cx('h-10 rounded-xl border px-4 text-xs font-bold transition', draft.platformRoles.includes('access_manager') && 'border-primary bg-primary text-primary-foreground')}
                        >
                          Access Manager
                        </button>
                        <button
                          onClick={() => saveAccountAccess(member)}
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
                  {!group.members.length && <p className="px-5 py-4 text-sm text-muted-foreground">No matching users in this section.</p>}
                  {group.members.length > 20 && <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
                    <span>Page {page + 1} of {Math.ceil(group.members.length / 20)}</span>
                    <div className="flex gap-2"><button className="q-button q-button-secondary" disabled={page === 0} onClick={() => setRoleSectionPages(current => ({ ...current, [group.id]: page - 1 }))}>Previous</button><button className="q-button q-button-secondary" disabled={(page + 1) * 20 >= group.members.length} onClick={() => setRoleSectionPages(current => ({ ...current, [group.id]: page + 1 }))}>Next</button></div>
                  </div>}
                </details>;
              })}
            </section>
            <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
              <div className="border-b p-5">
                <h2 className="font-bold">Pending role requests</h2>
                <p className="mt-1 text-xs text-muted-foreground">Approve or reject requests submitted by users from the Contributions page.</p>
              </div>
              {roleRequests.length ? (
                <div className="divide-y">
                  {roleRequests.map((item) => (
                    <div key={item.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                      <div className="flex-1">
                        <strong>{item.userName}</strong>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Requests {item.requestedRole.replaceAll('_', ' ')} · {item.reason}
                        </p>
                      </div>
                      <button onClick={() => reviewRole(item.id, false)} className="h-9 rounded-lg border px-3 text-xs font-bold text-red-600 dark:text-red-300">
                        Reject
                      </button>
                      <button onClick={() => reviewRole(item.id, true)} className="q-button q-button-study">
                        Approve
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-10 text-center text-sm text-muted-foreground">No pending role requests.</div>
              )}
            </section>
          </div>
        )}
        {tab === 'qbanks' && (
          <section className="grid gap-4 md:grid-cols-2">
            {collaboration.qbanks.map((bank) => (
              <article key={bank.id} className="rounded-2xl bg-card p-5 ring-1 ring-border">
                <div className="flex justify-between">
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">{bank.visibility.toUpperCase()}</span>
                  {bank.visibility === 'private' && isRoot && bank.ownerId !== user.uid && <span className="text-xs font-bold text-amber-700 dark:text-amber-300">READ-ONLY AUDIT</span>}
                </div>
                <h3 className="mt-3 font-bold">{bank.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{bank.description || 'No description.'}</p>
                <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                  Owner: {bank.ownerName} · {bank.reviewerIds.length} reviewers · {bank.viewerIds.length} viewers
                </p>
              </article>
            ))}
          </section>
        )}
        {tab === 'proposals' && <ReviewWorkspace user={user} collaboration={collaboration} update={update} replaceFromServer={replaceFromServer} embedded />}
        {tab === 'audit' && (
          <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><h2 className="font-bold">Audit log</h2>
              <p className="mt-1 text-xs text-muted-foreground">Latest activity first. Search by actor, action or target ID.</p></div>
              <input aria-label="Search audit log" placeholder="Search activity…" value={auditSearch} onChange={e => { setAuditSearch(e.target.value); setAuditPage(0); }} className="min-h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-sm sm:w-72" />
            </div>
            <div className="divide-y">
              {filteredAudit.slice(logsPage * 25, logsPage * 25 + 25).map((item) => (
                <details key={item.id} className="group min-w-0 text-sm open:bg-muted/20">
                  <summary className="grid min-h-14 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/30 focus-visible:outline-offset-[-3px] lg:grid-cols-[minmax(100px,0.8fr)_minmax(0,1.4fr)_minmax(0,1.5fr)_auto] [&::-webkit-details-marker]:hidden">
                    <strong className="min-w-0 break-words" dir="auto">{item.actorName}</strong>
                    <span className="col-start-1 min-w-0 break-words text-xs font-semibold uppercase text-primary lg:col-auto">{item.action.replaceAll('_', ' ')}</span>
                    <time dateTime={item.createdAt} className="col-start-1 min-w-0 text-xs text-muted-foreground lg:col-auto">{formatDate(item.createdAt)}</time>
                    <span className="col-start-2 row-start-1 row-end-4 text-xs font-medium text-primary lg:col-auto lg:row-auto"><span className="group-open:hidden">Details +</span><span className="hidden group-open:inline">Close −</span></span>
                  </summary>
                  <div className="space-y-3 border-t border-dashed px-4 py-3">
                    <p className="break-words text-xs text-muted-foreground">Target: {item.entityId} · Event: {item.id}</p>
                    <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-6">{item.detail || 'No additional details.'}</p>
                  </div>
                </details>
              ))}
            </div>
            {!filteredAudit.length && <p className="p-6 text-sm text-muted-foreground">No activity matches your search.</p>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs text-muted-foreground">
              <span>{filteredAudit.length} entries · Page {logsPage + 1} of {Math.max(1, Math.ceil(filteredAudit.length / 25))}</span>
              <div className="flex gap-2"><button className="q-button border" disabled={logsPage === 0} onClick={() => setAuditPage(logsPage - 1)}>Previous</button><button className="q-button border" disabled={(logsPage + 1) * 25 >= filteredAudit.length} onClick={() => setAuditPage(logsPage + 1)}>Next</button></div>
            </div>
          </section>
        )}
        </div>
      </div>
    </>
  );
}

export function PendingApproval({ user, onSignOut }: { user: AppUser; onSignOut: () => void }) {
  const blocked = user.suspended;
  const rejected = user.status === 'rejected';
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <section className="w-full max-w-lg rounded-[26px] bg-card p-8 text-center shadow-xl ring-1 ring-border">
        <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{blocked || rejected ? <UserRoundX className="size-7" /> : <Clock3 className="size-7" />}</div>
        <p className="mt-6 text-xs font-bold uppercase tracking-widest text-primary">Qraft membership</p>
        <h1 className="mt-2 text-2xl font-bold">{blocked ? 'Account access blocked' : rejected ? 'Registration not approved' : 'You’re on the list.'}</h1>
        <p className="mx-auto mt-3 text-sm leading-6 text-muted-foreground">{blocked ? 'An Access Manager or the Superadmin must restore this account.' : rejected ? 'Contact your cohort Access Manager if you believe this is a mistake.' : 'Your account has been created. An administrator will check your details before you can open your question banks.'}</p>
        <div className="mt-6 rounded-xl bg-muted/60 p-4 text-left text-sm"><p className="font-semibold">{blocked || rejected ? 'Need help?' : 'What happens next?'}</p><p className="mt-2 leading-6 text-muted-foreground">{blocked || rejected ? 'Contact the administrator who manages your question bank for help with your account.' : 'After approval, sign in again to start studying. You don’t need to create another account.'}</p></div>
        <button onClick={onSignOut} className="mt-6 h-11 w-full rounded-xl border text-sm font-bold">
          Sign out
        </button>
      </section>
    </main>
  );
}
