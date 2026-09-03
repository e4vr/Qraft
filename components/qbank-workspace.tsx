'use client';

import { Check, Copy, Crown, Globe2, KeyRound, Link2, LockKeyhole, Plus, UserPlus, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { bankRoleFor, canAccessBank, type AppUser, type BankRole, type CollaborationState, type QBank, type QBankVisibility } from '@/lib/medguard-types';
import { cn as cx, nowIso } from '@/lib/utils';

function slug(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48); }

export function QBankWorkspace({ user, collaboration, update, activeQBankId, onSelect }: { user: AppUser; collaboration: CollaborationState; update: (updater: (current: CollaborationState) => CollaborationState) => void; activeQBankId: string; onSelect: (id: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<QBankVisibility>('private');
  const [inviteBankId, setInviteBankId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<BankRole, 'owner'>>('viewer');
  const accessible = useMemo(() => collaboration.qbanks.filter((bank) => !bank.archived && canAccessBank(user, bank, collaboration.memberships)), [collaboration, user]);
  const receivedInvites = collaboration.invitations.filter((item) => item.email === user.email.toLowerCase() && item.status === 'pending');
  const canCreate = user.tier === 'pro' || user.role === 'super_admin' || user.platformRoles.includes('access_manager');

  function createBank(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = `${slug(shortName || name)}-${crypto.randomUUID().slice(0, 6)}`;
    if (!name.trim() || !id || !canCreate) return;
    const createdAt = nowIso();
    const bank: QBank = {
      id, name: name.trim(), shortName: (shortName.trim() || name.trim()).slice(0, 18).toUpperCase(), description: description.trim(),
      createdAt, createdById: user.uid, createdByName: user.displayName, ownerId: user.uid, ownerName: user.displayName,
      visibility, shareEnabled: false, reviewerIds: [], viewerIds: [], archived: false,
    };
    update((current) => ({ ...current, qbanks: [...current.qbanks, bank], auditLog: [{ id: crypto.randomUUID(), action: 'qbank_created', entityType: 'qbank', entityId: id, actorId: user.uid, actorName: user.displayName, createdAt, detail: `Created ${visibility} QBank ${bank.name}.` }, ...current.auditLog] }));
    onSelect(id); setCreating(false); setName(''); setShortName(''); setDescription(''); setVisibility('private');
  }

  function setShare(bank: QBank, enabled: boolean) {
    update((current) => ({ ...current, qbanks: current.qbanks.map((item) => item.id === bank.id ? { ...item, shareEnabled: enabled, shareToken: enabled ? (item.shareToken || crypto.randomUUID()) : undefined } : item) }));
  }

  function invite() {
    const bank = collaboration.qbanks.find((item) => item.id === inviteBankId && item.ownerId === user.uid);
    const email = inviteEmail.trim().toLowerCase();
    if (!bank || !email.includes('@')) return;
    const createdAt = nowIso();
    const id = crypto.randomUUID();
    update((current) => ({ ...current, invitations: [{ id, qbankId: bank.id, email, role: inviteRole, invitedById: user.uid, invitedByName: user.displayName, createdAt, status: 'pending' }, ...current.invitations], auditLog: [{ id: crypto.randomUUID(), action: 'qbank_user_invited', entityType: 'sharing', entityId: bank.id, actorId: user.uid, actorName: user.displayName, createdAt, detail: `Invited ${email} as ${inviteRole} to ${bank.name}.` }, ...current.auditLog] }));
    setInviteEmail('');
  }

  function acceptInvite(inviteId: string) {
    const invitation = collaboration.invitations.find((item) => item.id === inviteId);
    if (!invitation) return;
    const acceptedAt = nowIso();
    update((current) => ({
      ...current,
      invitations: current.invitations.map((item) => item.id === inviteId ? { ...item, status: 'accepted', acceptedById: user.uid, acceptedAt } : item),
      memberships: [...current.memberships.filter((item) => !(item.qbankId === invitation.qbankId && item.userId === user.uid)), { id: `${invitation.qbankId}_${user.uid}`, qbankId: invitation.qbankId, userId: user.uid, userName: user.displayName, role: invitation.role, grantedById: invitation.invitedById, grantedByName: invitation.invitedByName, createdAt: acceptedAt, inviteId }],
    }));
  }

  function copyShare(bank: QBank) {
    const url = `${window.location.origin}${window.location.pathname}?join_qbank=${encodeURIComponent(bank.id)}&token=${encodeURIComponent(bank.shareToken ?? '')}`;
    void navigator.clipboard.writeText(url);
  }

  return <>
    <header className="sticky top-0 z-30 flex min-h-[72px] items-center justify-between border-b bg-card/90 px-4 backdrop-blur-xl sm:px-7"><div><h1 className="text-lg font-bold">QBank library</h1><p className="text-xs text-muted-foreground">Public libraries, private workspaces, and role-based sharing</p></div>{canCreate && <button onClick={() => setCreating(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground"><Plus className="size-4" />New QBank</button>}</header>
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-7">
      {receivedInvites.length > 0 && <section className="rounded-2xl border border-violet-200 bg-violet-50/70 p-5 dark:border-violet-500/20 dark:bg-violet-500/10"><h2 className="flex items-center gap-2 font-bold"><UserPlus className="size-5 text-violet-600" />Bank invitations</h2><div className="mt-3 space-y-2">{receivedInvites.map((inviteItem) => <div key={inviteItem.id} className="flex flex-col gap-3 rounded-xl bg-card p-3 sm:flex-row sm:items-center"><span className="flex-1 text-sm"><strong>{inviteItem.invitedByName}</strong> invited you as {inviteItem.role}.</span><button onClick={() => acceptInvite(inviteItem.id)} className="h-9 rounded-lg bg-violet-600 px-4 text-xs font-bold text-white">Accept invitation</button></div>)}</div></section>}
      {!canCreate && <section className="flex flex-col gap-4 rounded-2xl bg-card p-5 ring-1 ring-border sm:flex-row sm:items-center"><div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Crown className="size-5" /></div><div className="flex-1"><h2 className="font-bold">Lite account</h2><p className="mt-1 text-sm text-muted-foreground">You can study public and shared banks. Request Pro access from Contributions to create your own.</p></div></section>}
      <section><div className="mb-4 flex items-end justify-between"><div><h2 className="font-bold">Available QBanks</h2><p className="mt-1 text-sm text-muted-foreground">The Superadmin can audit every bank; private-bank content remains owner-controlled.</p></div><span className="text-xs font-bold text-muted-foreground">{accessible.length} available</span></div><div className="grid gap-4 md:grid-cols-2">{accessible.map((bank) => { const role = bankRoleFor(user, bank, collaboration.memberships); const questions = collaboration.approvedQuestions.filter((item) => item.qbankId === bank.id).length + (bank.id === 'smle-gs' ? 217 : 0); return <article key={bank.id} className={cx('rounded-2xl bg-card p-5 ring-1 transition', activeQBankId === bank.id ? 'ring-2 ring-primary' : 'ring-border hover:ring-primary/30')}><div className="flex items-start justify-between gap-4"><div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">{bank.visibility === 'public' ? <Globe2 className="size-5" /> : <LockKeyhole className="size-5" />}</div><div className="flex flex-wrap justify-end gap-1">{role && <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold uppercase text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">{role}</span>}{user.role === 'super_admin' && bank.visibility === 'private' && bank.ownerId !== user.uid && <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">AUDIT VIEW</span>}</div></div><h3 className="mt-4 font-bold">{bank.name}</h3><p className="mt-1 min-h-10 text-sm leading-5 text-muted-foreground">{bank.description || 'Empty QBank ready for its first question.'}</p><div className="mt-4 flex items-center justify-between border-t pt-3 text-xs"><span>{questions} questions</span><span className="text-muted-foreground">by {bank.ownerName}</span></div><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => onSelect(bank.id)} className={cx('h-9 flex-1 rounded-lg px-3 text-xs font-bold', activeQBankId === bank.id ? 'bg-primary/10 text-primary' : 'bg-primary text-primary-foreground')}>{activeQBankId === bank.id ? 'Active bank' : 'Open bank'}</button>{bank.ownerId === user.uid && <button onClick={() => setShare(bank, !bank.shareEnabled)} className="grid size-9 place-items-center rounded-lg border" title={bank.shareEnabled ? 'Disable share link' : 'Enable share link'}>{bank.shareEnabled ? <Link2 className="size-4 text-emerald-600" /> : <KeyRound className="size-4" />}</button>}{bank.ownerId === user.uid && bank.shareEnabled && <button onClick={() => copyShare(bank)} className="grid size-9 place-items-center rounded-lg border" title="Copy share link"><Copy className="size-4" /></button>}</div></article>; })}</div></section>
      {collaboration.qbanks.some((bank) => bank.ownerId === user.uid) && <section className="rounded-2xl bg-card p-5 ring-1 ring-border"><div className="flex items-center gap-2"><Users className="size-5 text-primary" /><h2 className="font-bold">Invite a specific user</h2></div><p className="mt-1 text-sm text-muted-foreground">Invite by account email and assign Viewer or Reviewer access for one bank.</p><div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.2fr_150px_auto]"><select value={inviteBankId} onChange={(event) => setInviteBankId(event.target.value)} className="h-11 rounded-xl border bg-card px-3 text-sm"><option value="">Choose your QBank</option>{collaboration.qbanks.filter((bank) => bank.ownerId === user.uid).map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="student@university.edu" className="h-11 rounded-xl border bg-card px-3 text-sm" /><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<BankRole, 'owner'>)} className="h-11 rounded-xl border bg-card px-3 text-sm"><option value="viewer">Viewer</option><option value="reviewer">Reviewer</option></select><button onClick={invite} disabled={!inviteBankId || !inviteEmail.includes('@')} className="h-11 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground disabled:opacity-40">Send invite</button></div></section>}
    </div>
    {creating && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm"><form onSubmit={createBank} className="my-8 w-full max-w-xl rounded-2xl bg-card p-6 shadow-2xl ring-1 ring-border"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Create a QBank from scratch</h2><p className="text-xs text-muted-foreground">You become the Bank Owner.</p></div><button type="button" onClick={() => setCreating(false)} aria-label="Close"><X className="size-5" /></button></div><div className="mt-5 space-y-4"><label className="block"><span className="mb-1.5 block text-sm font-semibold">QBank name</span><input required value={name} onChange={(event) => setName(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3" placeholder="Surgery final review" /></label><label className="block"><span className="mb-1.5 block text-sm font-semibold">Short label</span><input value={shortName} onChange={(event) => setShortName(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3" placeholder="SURG 401" /></label><label className="block"><span className="mb-1.5 block text-sm font-semibold">Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-24 w-full rounded-xl border bg-card p-3" /></label><fieldset><legend className="text-sm font-semibold">Visibility</legend><div className="mt-2 grid grid-cols-2 gap-3">{(['private', 'public'] as const).map((item) => <button type="button" key={item} onClick={() => setVisibility(item)} className={cx('rounded-xl border p-4 text-left', visibility === item && 'border-primary bg-primary/5 ring-2 ring-primary/10')}><span className="flex items-center gap-2 font-bold capitalize">{item === 'private' ? <LockKeyhole className="size-4" /> : <Globe2 className="size-4" />}{item}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{item === 'private' ? 'Only you, invited members, and Superadmin audit view.' : 'Visible to every approved Lite and Pro user.'}</span></button>)}</div></fieldset></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setCreating(false)} className="h-10 rounded-xl border px-4 text-xs font-bold">Cancel</button><button type="submit" className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground"><Check className="size-4" />Create empty QBank</button></div></form></div>}
  </>;
}
