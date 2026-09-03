'use client';

import { Clock3, Fingerprint, Menu, ShieldCheck, UserCheck, UserRoundX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { canReviewBank, normalizeEmail, normalizePhone, normalizeUniversityId, type AccessBlocklist, type AccountStatus, type AppUser, type AuditEntry, type CollaborationState, type MemberProfile, type PlatformRole } from '@/lib/medguard-types';
import { cn as cx, nowIso } from '@/lib/utils';
import { ReviewWorkspace } from '@/components/review-workspace';

type Tab = 'overview' | 'registrations' | 'blocked' | 'roles' | 'qbanks' | 'proposals' | 'student-ids' | 'audit';
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

export function AdminDashboard({ user, collaboration, update }: { user: AppUser; collaboration: CollaborationState; update: (updater: (current: CollaborationState) => CollaborationState) => void }) {
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
              ['student-ids', 'Student IDs'],
              ['roles', 'Role requests'],
            ]
          : []),
        ...(isRoot || isReviewer ? [['qbanks', isRoot ? 'All QBanks' : 'QBanks']] : []),
        ...(isReviewer || collaboration.qbanks.some((bank) => canReviewBank(user, bank, collaboration.memberships)) ? [['proposals', 'Edit review']] : []),
        ...(isRoot ? [['audit', 'Audit log']] : []),
      ] as Array<[Tab, string]>,
    [canAccess, collaboration, isReviewer, isRoot, user],
  );
  const [tab, setTab] = useState<Tab>('overview');
  const [idText, setIdText] = useState('');
  const [blockText, setBlockText] = useState<Record<BlockKind, string>>({ phones: '', universityIds: '', emails: '' });
  const pendingMembers = collaboration.members.filter((item) => item.status === 'pending');
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
            }
          : item,
      ),
      auditLog: [audit(user, `registration_${status}`, 'account', uid, `${status} membership request.`), ...current.auditLog],
    }));
  }

  function toggleSuspended(member: MemberProfile) {
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
      const added = values.filter((id) => !existing.has(id)).map((id) => ({ id, addedAt: createdAt, addedById: user.uid }));
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

  return (
    <>
      <header className="sticky top-0 z-30 border-b bg-card/90 px-4 py-4 backdrop-blur-xl sm:px-7">
        <div className="mx-auto flex max-w-[1260px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button aria-label="Open navigation" onClick={() => window.dispatchEvent(new Event('medguard-open-menu'))} className="grid size-10 shrink-0 place-items-center rounded-xl border lg:hidden">
              <Menu className="size-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" />
                <h1 className="font-bold">Administration</h1>
              </div>
              <p className="text-xs text-muted-foreground">Least-privilege access and QBank governance</p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{isRoot ? 'SUPERADMIN · MFA' : user.platformRoles.join(' · ').toUpperCase()}</span>
        </div>
      </header>
      <div className="mx-auto max-w-[1260px] p-4 sm:p-7">
        <div className="mb-6 flex gap-2 overflow-x-auto">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={cx('shrink-0 rounded-full border px-4 py-2 text-xs font-bold', tab === id ? 'bg-primary text-primary-foreground' : 'bg-card')}>
              {label}
              {id === 'registrations' && pendingMembers.length ? ` · ${pendingMembers.length}` : ''}
              {id === 'proposals' && reviewable.length ? ` · ${reviewable.length}` : ''}
            </button>
          ))}
        </div>
        {tab === 'overview' && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Pending registrations', pendingMembers.length],
              ['Role requests', roleRequests.length],
              ['Visible QBanks', collaboration.qbanks.length],
              ['Edits to review', reviewable.length],
            ].map(([label, value]) => (
              <article key={label} className="rounded-2xl bg-card p-5 ring-1 ring-border">
                <p className="text-sm font-semibold text-muted-foreground">{label}</p>
                <strong className="mt-2 block text-3xl">{value}</strong>
              </article>
            ))}
          </div>
        )}
        {tab === 'registrations' && (
          <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            <div className="border-b p-5">
              <h2 className="font-bold">Registration and access</h2>
              <p className="text-xs text-muted-foreground">Review every registrant detail before approving, rejecting, blocking, or restoring an account.</p>
            </div>
            {collaboration.members.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-left text-sm">
                  <thead className="border-b bg-muted/30 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3">Registrant</th>
                      <th className="px-5 py-3">Email</th>
                      <th className="px-5 py-3">Mobile</th>
                      <th className="px-5 py-3">University ID</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Role &amp; tier</th>
                      <th className="px-5 py-3">Registered</th>
                      <th className="px-5 py-3">Reviewed by</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {collaboration.members.map((member) => (
                      <tr key={member.uid} className="align-top transition hover:bg-muted/20">
                        <td className="px-5 py-4">
                          <strong className="block whitespace-nowrap text-sm">{member.displayName}</strong>
                          <span className="mt-1 block max-w-[150px] truncate font-mono text-[10px] text-muted-foreground" title={member.uid}>
                            {member.uid}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span className="block max-w-[220px] truncate" title={member.email}>
                            {member.email}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-mono text-xs">{member.phone || '—'}</td>
                        <td className="px-5 py-4 font-mono text-xs font-semibold">{member.universityId}</td>
                        <td className="px-5 py-4">
                          <span className={cx('inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase', member.suspended ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : member.status === 'pending' ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200' : member.status === 'approved' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-muted text-muted-foreground')}>
                            {member.suspended ? 'Blocked' : member.status}
                          </span>
                          <span className="mt-1 block text-[10px] text-muted-foreground">MFA {member.mfaEnrolled ? 'enabled' : 'not enabled'}</span>
                        </td>
                        <td className="px-5 py-4">
                          <span className="block capitalize">{member.role.replaceAll('_', ' ')}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{member.tier} · {member.platformRoles.length ? member.platformRoles.join(', ') : 'no extra roles'}</span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-xs text-muted-foreground">{formatDate(member.createdAt)}</td>
                        <td className="px-5 py-4 text-xs">
                          {member.approvedByName ? <><span className="block">{member.approvedByName}</span><span className="mt-1 block text-muted-foreground">{formatDate(member.approvedAt)}</span></> : <span className="text-muted-foreground">Pending review</span>}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            {member.status === 'pending' && (
                              <>
                                <button onClick={() => reviewMember(member.uid, 'rejected')} className="h-9 rounded-lg border px-3 text-xs font-bold text-red-600 dark:text-red-300">
                                  <UserRoundX className="mr-1 inline size-4" />
                                  Reject
                                </button>
                                <button onClick={() => reviewMember(member.uid, 'approved')} className="h-9 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground">
                                  <UserCheck className="mr-1 inline size-4" />
                                  Approve
                                </button>
                              </>
                            )}
                            {member.status === 'approved' && member.role !== 'super_admin' && (
                              <button onClick={() => toggleSuspended(member)} className="h-9 rounded-lg border px-3 text-xs font-bold">
                                {member.suspended ? 'Restore' : 'Block'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-sm text-muted-foreground">No registrations yet.</div>
            )}
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
            <section className="max-h-[620px] overflow-y-auto rounded-2xl bg-card ring-1 ring-border">
              <div className="divide-y">
                {collaboration.allowedUniversityIds.map((item) => (
                  <div key={item.id} className="flex justify-between p-4 text-sm">
                    <strong className="font-mono">{item.id}</strong>
                    <span className="text-xs text-muted-foreground">{item.claimedByName || 'Available'}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
        {tab === 'blocked' && (
          <section className="rounded-2xl bg-card p-5 ring-1 ring-border sm:p-6">
            <div className="mb-5">
              <h2 className="font-bold">Blocked access list</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">New registrations matching any value below will be rejected. Existing matching accounts are suspended automatically.</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {([
                ['phones', 'Mobile numbers', '0501234567\n+966501234567'],
                ['universityIds', 'University IDs', '442001234\n442001235'],
                ['emails', 'Email addresses', 'blocked@example.com\nspam@example.com'],
              ] as Array<[BlockKind, string, string]>).map(([kind, label, placeholder]) => (
                <article key={kind} className="rounded-2xl border bg-background/35 p-4">
                  <h3 className="text-sm font-bold">{label}</h3>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Add one or more values separated by spaces, commas, or new lines.</p>
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
                        <span className="min-w-0 truncate font-mono text-[11px]" title={value}>{value}</span>
                        <button onClick={() => removeBlockedValue(kind, value)} className="shrink-0 text-[10px] font-bold text-red-600 hover:underline dark:text-red-300">Remove</button>
                      </div>
                    )) : <p className="text-[11px] text-muted-foreground">No blocked values yet.</p>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {tab === 'roles' && (
          <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            <div className="border-b p-5">
              <h2 className="font-bold">Role applications</h2>
              <p className="text-xs text-muted-foreground">Only the single Superadmin can approve Pro, Reviewer, or Access Manager privileges.</p>
            </div>
            {roleRequests.length ? (
              <div className="divide-y">
                {roleRequests.map((item) => (
                  <div key={item.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                    <div className="flex-1">
                      <strong>{item.userName}</strong>
                      <p className="text-xs text-muted-foreground">
                        Requests {item.requestedRole} · {item.reason}
                      </p>
                    </div>
                    <button onClick={() => reviewRole(item.id, false)} className="h-9 rounded-lg border px-3 text-xs font-bold text-red-600 dark:text-red-300">
                      Reject
                    </button>
                    <button onClick={() => reviewRole(item.id, true)} className="h-9 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground">
                      Approve
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center text-sm text-muted-foreground">No pending role applications.</div>
            )}
          </section>
        )}
        {tab === 'qbanks' && (
          <section className="grid gap-4 md:grid-cols-2">
            {collaboration.qbanks.map((bank) => (
              <article key={bank.id} className="rounded-2xl bg-card p-5 ring-1 ring-border">
                <div className="flex justify-between">
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">{bank.visibility.toUpperCase()}</span>
                  {bank.visibility === 'private' && isRoot && bank.ownerId !== user.uid && <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300">READ-ONLY AUDIT</span>}
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
        {tab === 'proposals' && <ReviewWorkspace user={user} collaboration={collaboration} update={update} embedded />}
        {tab === 'audit' && (
          <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            <div className="border-b p-5">
              <h2 className="font-bold">Audit log</h2>
            </div>
            <div className="divide-y">
              {collaboration.auditLog.map((item) => (
                <div key={item.id} className="grid gap-1 p-4 text-sm sm:grid-cols-[170px_160px_1fr_auto]">
                  <strong>{item.actorName}</strong>
                  <span className="text-xs font-bold uppercase text-primary">{item.action.replaceAll('_', ' ')}</span>
                  <span>{item.detail}</span>
                  <time className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</time>
                </div>
              ))}
            </div>
          </section>
        )}
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
        <h1 className="mt-2 text-2xl font-bold">{blocked ? 'Account access blocked' : rejected ? 'Registration not approved' : 'Waiting for approval'}</h1>
        <p className="mx-auto mt-3 text-sm leading-6 text-muted-foreground">{blocked ? 'An Access Manager or the Superadmin must restore this account.' : rejected ? 'Contact your cohort Access Manager if you believe this is a mistake.' : 'Your university ID is reserved until an Access Manager reviews the request.'}</p>
        <button onClick={onSignOut} className="mt-6 h-11 w-full rounded-xl border text-sm font-bold">
          Sign out
        </button>
      </section>
    </main>
  );
}
