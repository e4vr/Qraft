'use client';

import {
  BookOpen,
  Check,
  Clock3,
  FileCheck2,
  Fingerprint,
  Menu,
  Plus,
  ShieldCheck,
  UserCheck,
  UserCog,
  UserRoundX,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import questionData from '@/data/questions.json';
import type {
  AppUser,
  AuditEntry,
  CollaborationState,
  Question,
  QuestionProposal,
  QBank,
} from '@/lib/medguard-types';

type AdminTab = 'overview' | 'registrations' | 'admins' | 'student-ids' | 'qbanks' | 'proposals' | 'audit';

const tabs: Array<[AdminTab, string]> = [
  ['overview', 'Overview'],
  ['registrations', 'Registrations'],
  ['admins', 'Administrators'],
  ['student-ids', 'Student IDs'],
  ['qbanks', 'QBanks'],
  ['proposals', 'Question review'],
  ['audit', 'Audit log'],
];

function now() { return new Date().toISOString(); }
function cleanId(value: string) { return value.replace(/\s+/g, '').toUpperCase(); }
function cleanCode(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function formatDate(value?: string) { return value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function cx(...values: Array<string | false | null | undefined>) { return values.filter(Boolean).join(' '); }

function audit(user: AppUser, action: string, entityType: AuditEntry['entityType'], entityId: string, detail: string): AuditEntry {
  return { id: crypto.randomUUID(), action, entityType, entityId, actorId: user.uid, actorName: user.displayName, createdAt: now(), detail };
}

function Stat({ label, value, detail, tone = 'blue' }: { label: string; value: number; detail: string; tone?: 'blue' | 'green' | 'amber' | 'violet' }) {
  const colors = { blue: 'bg-blue-50 text-blue-700', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-800', violet: 'bg-violet-50 text-violet-700' };
  return <div className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border"><div className={cx('mb-4 grid size-9 place-items-center rounded-xl text-sm font-black', colors[tone])}>{value}</div><p className="font-bold">{label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></div>;
}

export function AdminDashboard({
  user,
  collaboration,
  update,
}: {
  user: AppUser;
  collaboration: CollaborationState;
  update: (updater: (current: CollaborationState) => CollaborationState) => void;
}) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [idText, setIdText] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [qbankName, setQbankName] = useState('');
  const [qbankCode, setQbankCode] = useState('');
  const [qbankDescription, setQbankDescription] = useState('');
  const pendingMembers = collaboration.members.filter((member) => member.status === 'pending');
  const pendingProposals = collaboration.proposals.filter((proposal) => proposal.status === 'pending');
  const admins = collaboration.members.filter((member) => member.role === 'admin' || member.role === 'super_admin');
  const availableIds = collaboration.allowedUniversityIds.filter((item) => !item.claimedById);

  function reviewMember(uid: string, status: 'approved' | 'rejected') {
    update((current) => {
      const member = current.members.find((item) => item.uid === uid);
      if (!member) return current;
      return {
        ...current,
        members: current.members.map((item) => item.uid === uid ? { ...item, status, approvedAt: now(), approvedById: user.uid, approvedByName: user.displayName } : item),
        auditLog: [audit(user, status === 'approved' ? 'registration_approved' : 'registration_rejected', 'account', uid, `${member.displayName} (${member.universityId})`), ...current.auditLog],
      };
    });
  }

  function setRole(uid: string, role: 'admin' | 'student') {
    if (user.role !== 'super_admin') return;
    update((current) => {
      const member = current.members.find((item) => item.uid === uid);
      if (!member || member.role === 'super_admin') return current;
      return {
        ...current,
        members: current.members.map((item) => item.uid === uid ? { ...item, role } : item),
        auditLog: [audit(user, role === 'admin' ? 'admin_added' : 'admin_removed', 'admin', uid, `${member.displayName} is now ${role}.`), ...current.auditLog],
      };
    });
  }

  function addStudentIds() {
    const ids = [...new Set(idText.split(/[\s,;]+/).map(cleanId).filter(Boolean))];
    if (!ids.length) return;
    update((current) => {
      const existing = new Set(current.allowedUniversityIds.map((item) => item.id));
      const added = ids.filter((id) => !existing.has(id)).map((id) => ({ id, addedAt: now(), addedById: user.uid, claimedById: null, claimedByName: null, claimedAt: null }));
      if (!added.length) return current;
      return {
        ...current,
        allowedUniversityIds: [...added, ...current.allowedUniversityIds],
        auditLog: [audit(user, 'student_ids_added', 'university_id', added[0].id, `${added.length} eligible university IDs added.`), ...current.auditLog],
      };
    });
    setIdText('');
  }

  function addAdminInvite() {
    const email = adminEmail.trim().toLowerCase();
    if (!email || !email.includes('@') || user.role !== 'super_admin') return;
    update((current) => {
      const member = current.members.find((item) => item.email.toLowerCase() === email);
      if (member && member.status === 'approved') {
        return {
          ...current,
          members: current.members.map((item) => item.uid === member.uid ? { ...item, role: 'admin' } : item),
          auditLog: [audit(user, 'admin_added', 'admin', member.uid, `${member.displayName} promoted to administrator.`), ...current.auditLog],
        };
      }
      if (current.adminInvites.some((invite) => invite.email === email && invite.status === 'pending')) return current;
      const invite = { id: email, email, createdAt: now(), createdById: user.uid, createdByName: user.displayName, status: 'pending' as const };
      return { ...current, adminInvites: [invite, ...current.adminInvites], auditLog: [audit(user, 'admin_invited', 'admin', email, `Admin invitation prepared for ${email}.`), ...current.auditLog] };
    });
    setAdminEmail('');
  }

  function createQBank() {
    const name = qbankName.trim();
    const code = cleanCode(qbankCode || name);
    if (!name || !code) return;
    update((current) => {
      if (current.qbanks.some((item) => item.id === code)) return current;
      const qbank: QBank = { id: code, name, shortName: qbankCode.trim().toUpperCase() || name.slice(0, 16), description: qbankDescription.trim(), createdAt: now(), createdById: user.uid, createdByName: user.displayName, archived: false };
      return { ...current, qbanks: [...current.qbanks, qbank], auditLog: [audit(user, 'qbank_created', 'qbank', code, name), ...current.auditLog] };
    });
    setQbankName(''); setQbankCode(''); setQbankDescription('');
  }

  function reviewProposal(proposal: QuestionProposal, status: 'approved' | 'rejected') {
    update((current) => {
      const reviewedAt = now();
      let approvedQuestions = current.approvedQuestions;
      if (status === 'approved') {
        const availableQuestions = [...(questionData as Question[]).map((item) => ({ ...item, qbankId: item.qbankId ?? 'smle-gs' })), ...approvedQuestions];
        const existing = proposal.questionId ? availableQuestions.find((item) => item.id === proposal.questionId) : undefined;
        const question: Question = {
          id: proposal.questionId ?? `shared-${crypto.randomUUID()}`,
          number: existing?.number ?? Math.max(0, ...availableQuestions.filter((item) => item.qbankId === proposal.qbankId).map((item) => item.number)) + 1,
          qbankId: proposal.qbankId,
          specialty: proposal.payload.specialty,
          topic: proposal.payload.topic,
          stem: proposal.payload.stem,
          options: proposal.payload.options,
          answer: proposal.payload.answer,
          answerLetter: 'ABCD'[proposal.payload.answer],
          sourcePage: existing?.sourcePage ?? 0,
          sourceFile: existing?.sourceFile ?? 'Community contribution',
          revision: (existing?.revision ?? 0) + 1,
          isCustom: true,
        };
        approvedQuestions = [...approvedQuestions.filter((item) => item.id !== question.id), question];
      }
      return {
        ...current,
        approvedQuestions,
        proposals: current.proposals.map((item) => item.id === proposal.id ? { ...item, status, reviewedById: user.uid, reviewedByName: user.displayName, reviewedAt } : item),
        auditLog: [audit(user, status === 'approved' ? 'question_proposal_approved' : 'question_proposal_rejected', 'question', proposal.id, `${proposal.type} by ${proposal.proposedByName}`), ...current.auditLog],
      };
    });
  }

  const recentActivity = useMemo(() => collaboration.auditLog.slice(0, 8), [collaboration.auditLog]);

  return <>
    <header className="sticky top-0 z-30 border-b bg-white/90 px-4 py-4 backdrop-blur-xl dark:bg-background/90 sm:px-7">
      <div className="mx-auto flex max-w-[1260px] items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><button aria-label="Open navigation" onClick={() => window.dispatchEvent(new Event('medguard-open-menu'))} className="grid size-10 shrink-0 place-items-center rounded-xl border lg:hidden"><Menu className="size-5" /></button><div className="min-w-0"><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><h1 className="text-lg font-bold">Administration</h1></div><p className="mt-0.5 truncate text-xs text-muted-foreground">Secure approvals, QBank governance, and complete audit history</p></div></div><span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700">{user.role === 'super_admin' ? 'ROOT ADMIN' : 'ADMIN'}</span></div>
    </header>
    <div className="mx-auto max-w-[1260px] p-4 sm:p-7">
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">{tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={cx('shrink-0 rounded-full border px-4 py-2 text-xs font-bold transition', tab === id ? 'border-primary bg-primary text-white' : 'bg-card hover:border-primary/30')}>{label}{id === 'registrations' && pendingMembers.length > 0 ? ` · ${pendingMembers.length}` : ''}{id === 'proposals' && pendingProposals.length > 0 ? ` · ${pendingProposals.length}` : ''}</button>)}</div>

      {tab === 'overview' && <div className="space-y-6"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Pending registrations" value={pendingMembers.length} detail="Require an administrator decision" tone="amber" /><Stat label="Approved members" value={collaboration.members.filter((item) => item.status === 'approved').length} detail={`${admins.length} administrators`} tone="green" /><Stat label="Active QBanks" value={collaboration.qbanks.filter((item) => !item.archived).length} detail="Separate question libraries" tone="violet" /><Stat label="Pending corrections" value={pendingProposals.length} detail="No question changes before approval" /></div><section className="rounded-2xl bg-card ring-1 ring-border"><div className="border-b p-5"><h2 className="font-bold">Recent governance activity</h2><p className="mt-1 text-xs text-muted-foreground">Immutable attribution for administrative actions.</p></div>{recentActivity.length ? <div className="divide-y">{recentActivity.map((item) => <div key={item.id} className="grid gap-1 p-4 text-sm sm:grid-cols-[170px_1fr_auto]"><strong>{item.actorName}</strong><span>{item.detail}</span><time className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</time></div>)}</div> : <div className="p-10 text-center text-sm text-muted-foreground">No administrative activity yet.</div>}</section></div>}

      {tab === 'registrations' && <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border"><div className="border-b p-5"><h2 className="font-bold">Registration approval queue</h2><p className="mt-1 text-xs text-muted-foreground">Every first-time registration remains blocked until an admin approves it.</p></div>{pendingMembers.length ? <div className="divide-y">{pendingMembers.map((member) => <div key={member.uid} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"><div className="grid size-11 place-items-center rounded-full bg-primary/10 font-bold text-primary">{member.displayName.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><strong className="block">{member.displayName}</strong><p className="truncate text-xs text-muted-foreground">{member.email} · Student ID {member.universityId}</p><p className="mt-1 text-[11px] text-muted-foreground">Requested {formatDate(member.createdAt)}</p></div><div className="flex gap-2"><button onClick={() => reviewMember(member.uid, 'rejected')} className="inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-bold text-red-600 hover:bg-red-50"><UserRoundX className="size-4" />Reject</button><button onClick={() => reviewMember(member.uid, 'approved')} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-white"><UserCheck className="size-4" />Approve</button></div></div>)}</div> : <div className="grid min-h-64 place-items-center text-sm text-muted-foreground"><div className="text-center"><UserCheck className="mx-auto mb-3 size-8 text-emerald-500" />No registrations waiting for review.</div></div>}</section>}

      {tab === 'admins' && <div className="grid gap-5 lg:grid-cols-[360px_1fr]"><section className="h-fit rounded-2xl bg-card p-5 ring-1 ring-border"><h2 className="font-bold">Add an administrator</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Promote an approved account immediately, or prepare an invite for an email that has not registered.</p><input type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder="admin@university.edu" className="mt-4 h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-primary" /><button disabled={user.role !== 'super_admin' || !adminEmail.includes('@')} onClick={addAdminInvite} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold text-white disabled:opacity-45"><UserCog className="size-4" />Add administrator</button>{user.role !== 'super_admin' && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Only the root administrator can change administrator roles.</p>}</section><section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border"><div className="border-b p-5"><h2 className="font-bold">Administrator team</h2><p className="mt-1 text-xs text-muted-foreground">Shared dashboard access is synchronized for approved administrators.</p></div><div className="divide-y">{admins.map((member) => <div key={member.uid} className="flex items-center gap-4 p-4"><div className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-700"><ShieldCheck className="size-5" /></div><div className="min-w-0 flex-1"><strong className="block text-sm">{member.displayName}</strong><p className="truncate text-xs text-muted-foreground">{member.email} · {member.role.replace('_', ' ')}</p></div>{user.role === 'super_admin' && member.role === 'admin' && <button onClick={() => setRole(member.uid, 'student')} className="rounded-lg border px-3 py-2 text-[11px] font-bold text-red-600">Remove admin</button>}</div>)}</div>{collaboration.adminInvites.filter((item) => item.status === 'pending').map((invite) => <div key={invite.id} className="flex items-center gap-3 border-t bg-muted/20 p-4 text-xs"><Clock3 className="size-4 text-amber-600" /><span className="flex-1">Pending invite: <strong>{invite.email}</strong></span><span className="text-muted-foreground">{formatDate(invite.createdAt)}</span></div>)}</section></div>}

      {tab === 'student-ids' && <div className="grid gap-5 lg:grid-cols-[390px_1fr]"><section className="h-fit rounded-2xl bg-card p-5 ring-1 ring-border"><div className="flex items-center gap-2"><Fingerprint className="size-5 text-primary" /><h2 className="font-bold">Import eligible IDs</h2></div><p className="mt-2 text-xs leading-5 text-muted-foreground">Paste student numbers separated by spaces, commas, or new lines. Duplicates are removed automatically.</p><textarea value={idText} onChange={(event) => setIdText(event.target.value)} placeholder={'442001234\n442001235\n442001236'} className="mt-4 min-h-40 w-full rounded-xl border p-3 font-mono text-sm outline-none focus:border-primary" /><button onClick={addStudentIds} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold text-white"><Plus className="size-4" />Add eligible IDs</button></section><section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border"><div className="flex items-center justify-between border-b p-5"><div><h2 className="font-bold">University ID registry</h2><p className="mt-1 text-xs text-muted-foreground">One account can claim each number exactly once.</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{availableIds.length} available</span></div><div className="max-h-[620px] divide-y overflow-y-auto">{collaboration.allowedUniversityIds.length ? collaboration.allowedUniversityIds.map((item) => <div key={item.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[150px_1fr_auto]"><strong className="font-mono">{item.id}</strong><span className="text-xs text-muted-foreground">{item.claimedByName ? `Claimed by ${item.claimedByName}` : 'Available for registration'}</span><span className={cx('w-fit rounded-full px-2 py-1 text-[10px] font-bold', item.claimedById ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700')}>{item.claimedById ? 'CLAIMED' : 'AVAILABLE'}</span></div>) : <div className="p-10 text-center text-sm text-muted-foreground">No university IDs imported yet.</div>}</div></section></div>}

      {tab === 'qbanks' && <div className="grid gap-5 lg:grid-cols-[390px_1fr]"><section className="h-fit rounded-2xl bg-card p-5 ring-1 ring-border"><div className="flex items-center gap-2"><BookOpen className="size-5 text-primary" /><h2 className="font-bold">Create a separate QBank</h2></div><div className="mt-4 space-y-3"><input value={qbankName} onChange={(event) => setQbankName(event.target.value)} placeholder="e.g. USMLE Step 2" className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-primary" /><input value={qbankCode} onChange={(event) => setQbankCode(event.target.value)} placeholder="Short label (USMLE)" className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-primary" /><textarea value={qbankDescription} onChange={(event) => setQbankDescription(event.target.value)} placeholder="Purpose and scope" className="min-h-24 w-full rounded-xl border p-3 text-sm outline-none focus:border-primary" /><button onClick={createQBank} disabled={!qbankName.trim()} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-bold text-white disabled:opacity-45"><Plus className="size-4" />Create QBank</button></div></section><section className="space-y-3">{collaboration.qbanks.map((qbank) => <article key={qbank.id} className="rounded-2xl bg-card p-5 ring-1 ring-border"><div className="flex items-start justify-between gap-4"><div><span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary">{qbank.shortName}</span><h3 className="mt-3 font-bold">{qbank.name}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{qbank.description || 'No description added.'}</p></div><span className="text-xs font-bold text-muted-foreground">{collaboration.approvedQuestions.filter((item) => item.qbankId === qbank.id).length + (qbank.id === 'smle-gs' ? 217 : 0)} questions</span></div><p className="mt-4 border-t pt-3 text-[11px] text-muted-foreground">Created by {qbank.createdByName} · {formatDate(qbank.createdAt)}</p></article>)}</section></div>}

      {tab === 'proposals' && <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border"><div className="border-b p-5"><h2 className="font-bold">Question change approvals</h2><p className="mt-1 text-xs text-muted-foreground">New questions and corrections are invisible in the live bank until approved.</p></div>{pendingProposals.length ? <div className="divide-y">{pendingProposals.map((proposal) => <article key={proposal.id} className="p-5"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">{proposal.type === 'new_question' ? 'NEW QUESTION' : 'CORRECTION'}</span><span className="text-xs text-muted-foreground">{collaboration.qbanks.find((item) => item.id === proposal.qbankId)?.shortName} · by {proposal.proposedByName} · {formatDate(proposal.proposedAt)}</span></div><p className="mt-3 text-sm font-semibold leading-6">{proposal.payload.stem}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{proposal.payload.options.map((option, index) => <div key={index} className={cx('rounded-lg border px-3 py-2 text-xs', index === proposal.payload.answer && 'border-emerald-300 bg-emerald-50 text-emerald-800')}><strong className="mr-2">{'ABCD'[index]}</strong>{option}</div>)}</div>{proposal.rationale && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><strong>Reason:</strong> {proposal.rationale}</p>}<div className="mt-4 flex justify-end gap-2"><button onClick={() => reviewProposal(proposal, 'rejected')} className="inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-xs font-bold text-red-600"><X className="size-4" />Reject</button><button onClick={() => reviewProposal(proposal, 'approved')} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-white"><Check className="size-4" />Approve & publish</button></div></article>)}</div> : <div className="grid min-h-64 place-items-center text-sm text-muted-foreground"><div className="text-center"><FileCheck2 className="mx-auto mb-3 size-8 text-emerald-500" />All question proposals have been reviewed.</div></div>}</section>}

      {tab === 'audit' && <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border"><div className="border-b p-5"><h2 className="font-bold">Full audit log</h2><p className="mt-1 text-xs text-muted-foreground">Who changed what, and when.</p></div>{collaboration.auditLog.length ? <div className="divide-y">{collaboration.auditLog.map((item) => <div key={item.id} className="grid gap-1 p-4 text-sm sm:grid-cols-[180px_150px_1fr_auto]"><strong>{item.actorName}</strong><span className="text-xs font-bold uppercase text-primary">{item.action.replaceAll('_', ' ')}</span><span>{item.detail}</span><time className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</time></div>)}</div> : <div className="p-10 text-center text-sm text-muted-foreground">The audit log is empty.</div>}</section>}
    </div>
  </>;
}

export function PendingApproval({ user, onSignOut }: { user: AppUser; onSignOut: () => void }) {
  const rejected = user.status === 'rejected';
  return <main className="grid min-h-screen place-items-center bg-[#f4f8fc] p-6"><section className="w-full max-w-lg rounded-[26px] bg-white p-8 text-center shadow-[0_24px_70px_rgba(24,53,78,.12)] ring-1 ring-border"><div className={cx('mx-auto grid size-16 place-items-center rounded-2xl', rejected ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700')}>{rejected ? <UserRoundX className="size-7" /> : <Clock3 className="size-7" />}</div><p className="mt-6 text-xs font-bold uppercase tracking-widest text-primary">MedGuard membership</p><h1 className="mt-2 text-2xl font-bold">{rejected ? 'Registration not approved' : 'Waiting for admin approval'}</h1><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">{rejected ? 'An administrator declined this registration. Contact your cohort administrator if you believe this is a mistake.' : 'Your university ID has been reserved. You will gain access as soon as an administrator approves your first registration.'}</p><div className="mt-6 rounded-xl bg-muted/60 p-4 text-left text-xs"><div className="flex justify-between gap-4"><span className="text-muted-foreground">Account</span><strong>{user.email}</strong></div><div className="mt-2 flex justify-between gap-4"><span className="text-muted-foreground">University ID</span><strong className="font-mono">{user.universityId || 'Pending profile'}</strong></div></div><button onClick={onSignOut} className="mt-6 h-11 w-full rounded-xl border text-sm font-bold hover:bg-muted">Sign out</button></section></main>;
}
