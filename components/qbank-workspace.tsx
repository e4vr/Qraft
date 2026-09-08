'use client';

import { ReviewerSearch } from '@/components/reviewer-search';
import { openUpgrade, UpgradeButton } from '@/components/subscription-workspace';
import { ArrowRight, Check, Crown, Menu, Search, FolderPlus, Globe2, Heart, ListChecks, LockKeyhole, Pin, Plus, Settings2, UserPlus, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { bankRoleFor, canAccessBank, canManageBank, type AppUser, type BankRole, type CollaborationState, type QBank, type QBankVisibility } from '@/lib/medguard-types';
import { cn as cx, nowIso } from '@/lib/utils';
import { hasFeature, PLAN_LIMITS } from '@/lib/plan-config';

function slug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export function QBankWorkspace({
  user,
  collaboration,
  update,
  confirmUpdate,
  activeQBankId,
  organization,
  updateOrganization,
  onSelect,
  onManageBank,
}: {
  user: AppUser;
  collaboration: CollaborationState;
  update: (updater: (current: CollaborationState) => CollaborationState) => void;
  confirmUpdate: (updater: (current: CollaborationState) => CollaborationState) => void;
  activeQBankId: string;
  organization: { favoriteIds: string[]; pinnedIds: string[]; categories: string[]; categoryByBankId: Record<string, string> };
  updateOrganization: (next: { favoriteIds: string[]; pinnedIds: string[]; categories: string[]; categoryByBankId: Record<string, string> }) => void;
  onSelect: (id: string) => void;
  onManageBank: (id: string, section: 'settings' | 'questions') => void;
}) {
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<QBankVisibility>('private');
  const [essential, setEssential] = useState(false);
  const [inviteBankId, setInviteBankId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<BankRole, 'owner'>>('viewer');
  const [newCategory, setNewCategory] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const accessible = useMemo(() => collaboration.qbanks.filter((bank) => !bank.archived && canAccessBank(user, bank, collaboration.memberships)), [collaboration, user]);
  const receivedInvites = collaboration.invitations.filter((item) => item.email === user.email.toLowerCase() && item.status === 'pending');
  const canCreate = hasFeature(user.effectivePlan ?? user.tier, 'createQBank') || user.role === 'super_admin' || user.platformRoles.includes('access_manager');
  const categoryNames = ['Uncategorized', ...organization.categories];
  const categoryTabs = [
    { id: 'all', label: 'All', count: accessible.length },
    { id: 'favorites', label: 'Favorites', count: accessible.filter((bank) => organization.favoriteIds.includes(bank.id)).length },
    { id: 'pinned', label: 'Pinned', count: accessible.filter((bank) => organization.pinnedIds.includes(bank.id)).length },
    ...categoryNames.map((category) => ({ id: `category:${category}`, label: category, count: accessible.filter((bank) => (organization.categoryByBankId[bank.id] || 'Uncategorized') === category).length })),
  ];
  const displayedBanks = accessible
    .filter((bank) => `${bank.name} ${bank.shortName} ${bank.description}`.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((bank) => {
      if (activeCategory === 'favorites') return organization.favoriteIds.includes(bank.id);
      if (activeCategory === 'pinned') return organization.pinnedIds.includes(bank.id);
      if (activeCategory.startsWith('category:')) return (organization.categoryByBankId[bank.id] || 'Uncategorized') === activeCategory.slice(9);
      return true;
    })
    .sort((left, right) => Number(organization.pinnedIds.includes(right.id)) - Number(organization.pinnedIds.includes(left.id)) || left.name.localeCompare(right.name));

  function toggleList(key: 'favoriteIds' | 'pinnedIds', bankId: string) {
    const values = organization[key];
    updateOrganization({ ...organization, [key]: values.includes(bankId) ? values.filter((id) => id !== bankId) : [...values, bankId] });
  }

  function addCategory(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = newCategory.trim();
    if (!value || organization.categories.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    updateOrganization({ ...organization, categories: [...organization.categories, value] });
    setActiveCategory(`category:${value}`);
    setNewCategory('');
  }

  function setBankCategory(bankId: string, category: string) {
    const next = { ...organization.categoryByBankId };
    if (category === 'Uncategorized') delete next[bankId];
    else next[bankId] = category;
    updateOrganization({ ...organization, categoryByBankId: next });
  }

  function createBank(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = `${slug(shortName || name)}-${crypto.randomUUID().slice(0, 6)}`;
    if (!name.trim() || !id || !canCreate) return;
    const createdAt = nowIso();
    const bank: QBank = {
      id,
      name: name.trim(),
      shortName: (shortName.trim() || name.trim()).slice(0, 18).toUpperCase(),
      description: description.trim(),
      createdAt,
      createdById: user.uid,
      createdByName: user.displayName,
      ownerId: user.uid,
      ownerName: user.displayName,
      visibility,
      shareEnabled: false,
      reviewerIds: [],
      viewerIds: [],
      archived: false,
      essential: user.role === 'super_admin' && essential,
    };
    update((current) => ({
      ...current,
      qbanks: [...current.qbanks, bank],
      auditLog: [
        {
          id: crypto.randomUUID(),
          action: 'qbank_created',
          entityType: 'qbank',
          entityId: id,
          actorId: user.uid,
          actorName: user.displayName,
          createdAt,
          detail: `Created ${visibility} QBank ${bank.name}.`,
        },
        ...current.auditLog,
      ],
    }));
    onSelect(id);
    setCreating(false);
    setName('');
    setShortName('');
    setDescription('');
    setVisibility('private');
    setEssential(false);
  }

  function invite() {
    const bank = collaboration.qbanks.find((item) => item.id === inviteBankId && canManageBank(user, item));
    const email = inviteEmail.trim().toLowerCase();
    if (!bank || !email.includes('@')) return;
    const createdAt = nowIso();
    const id = crypto.randomUUID();
    update((current) => ({
      ...current,
      invitations: [
        {
          id,
          qbankId: bank.id,
          email,
          role: inviteRole,
          invitedById: user.uid,
          invitedByName: user.displayName,
          createdAt,
          status: 'pending',
        },
        ...current.invitations,
      ],
      auditLog: [
        {
          id: crypto.randomUUID(),
          action: 'qbank_user_invited',
          entityType: 'sharing',
          entityId: bank.id,
          actorId: user.uid,
          actorName: user.displayName,
          createdAt,
          detail: `Invited ${email} as ${inviteRole} to ${bank.name}.`,
        },
        ...current.auditLog,
      ],
    }));
    setInviteEmail('');
  }

  function acceptInvite(inviteId: string) {
    const invitation = collaboration.invitations.find((item) => item.id === inviteId);
    if (!invitation) return;
    const acceptedAt = nowIso();
    update((current) => ({
      ...current,
      invitations: current.invitations.map((item) => (item.id === inviteId ? { ...item, status: 'accepted', acceptedById: user.uid, acceptedAt } : item)),
      memberships: [
        ...current.memberships.filter((item) => !(item.qbankId === invitation.qbankId && item.userId === user.uid)),
        {
          id: `${invitation.qbankId}_${user.uid}`,
          qbankId: invitation.qbankId,
          userId: user.uid,
          userName: user.displayName,
          role: invitation.role,
          grantedById: invitation.invitedById,
          grantedByName: invitation.invitedByName,
          createdAt: acceptedAt,
          inviteId,
        },
      ],
    }));
  }

  return (
    <>
      <header className="workspace-header">
        <div className="flex min-w-0 items-center gap-3"><button aria-label="Open navigation" className="q-icon lg:hidden" onClick={() => window.dispatchEvent(new Event('medguard-open-menu'))}><Menu className="size-5" /></button><div>
          <h1 className="text-lg font-bold">My QBanks</h1>
          <p className="text-xs text-muted-foreground">Your questions, organized around you.</p>
        </div></div>
        <button
          onClick={() => (canCreate ? setCreating(true) : openUpgrade())}
          className={cx('q-button', canCreate ? 'q-button-contribute' : 'border')}
        >
          {canCreate ? <Plus className="size-4" /> : <LockKeyhole className="size-4" />}
          {canCreate ? 'New QBank' : 'Create QBank · Pro'}
        </button>
      </header>
      <div className="q-page space-y-6">
        {receivedInvites.length > 0 && (
          <section className="rounded-2xl border border-violet-200 bg-violet-50/70 p-5 dark:border-violet-500/20 dark:bg-violet-500/10">
            <h2 className="flex items-center gap-2 font-bold">
              <UserPlus className="size-5 text-violet-600 dark:text-violet-300" />
              Bank invitations
            </h2>
            <div className="mt-3 space-y-2">
              {receivedInvites.map((inviteItem) => (
                <div key={inviteItem.id} className="flex flex-col gap-3 rounded-xl bg-card p-3 sm:flex-row sm:items-center">
                  <span className="flex-1 text-sm">
                    <strong>{inviteItem.invitedByName}</strong> invited you as {inviteItem.role}.
                  </span>
                  <button onClick={() => acceptInvite(inviteItem.id)} className="h-9 rounded-lg bg-violet-600 px-4 text-xs font-bold text-white">
                    Accept invitation
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
        {!canCreate && (
          <section className="flex flex-col gap-4 rounded-2xl bg-card p-5 ring-1 ring-border sm:flex-row sm:items-center">
            <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Crown className="size-5" />
            </div>
            <div className="flex-1">
              <h2 className="font-bold">{PLAN_LIMITS[user.effectivePlan ?? user.tier].name} account</h2><div className="mt-3"><UpgradeButton /></div>
              <p className="mt-1 text-sm text-muted-foreground">You can study public and shared banks. Upgrade to Pro to create your own.</p>
            </div>
          </section>
        )}
        <section>
          <label className="mb-6 flex items-center gap-3 rounded-xl border bg-card px-4 py-3"><Search className="size-5 text-muted-foreground" /><input aria-label="Search QBanks" placeholder="Find a question bank…" value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /><span className="text-xs text-muted-foreground" aria-live="polite">{displayedBanks.length} banks</span></label>
          <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold">Your collection</h2>
              <p className="mt-1 text-sm text-muted-foreground">Choose a bank to study. Keep your favorites close.</p>
            </div>
            <form onSubmit={addCategory} className="flex gap-2">
              <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="New subcategory" aria-label="New QBank subcategory" className="h-10 min-w-0 rounded-xl border bg-card px-3 text-sm" />
              <button type="submit" disabled={!newCategory.trim()} className="inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-bold disabled:opacity-40">
                <FolderPlus className="size-4" />
                Add
              </button>
            </form>
          </div>
          <nav aria-label="QBank categories" className="mb-4 flex gap-1 overflow-x-auto border-b px-1 scrollbar-none">
            {categoryTabs.map((tab) => (
              <button key={tab.id} aria-pressed={activeCategory === tab.id} onClick={() => setActiveCategory(tab.id)} className={cx('relative flex h-12 shrink-0 items-center gap-2 px-4 text-sm font-semibold text-muted-foreground transition hover:text-foreground', activeCategory === tab.id && 'text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary')}>
                {tab.id === 'favorites' && <Heart className={cx('size-4', activeCategory === tab.id && 'fill-current')} />}
                {tab.id === 'pinned' && <Pin className={cx('size-4', activeCategory === tab.id && 'fill-current')} />}
                <span>{tab.label}</span>
                <span className={cx('rounded-full bg-muted px-1.5 py-0.5 text-xs', activeCategory === tab.id && 'bg-primary/10 text-primary')}>{tab.count}</span>
              </button>
            ))}
          </nav>
          <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            {displayedBanks.length === 0 ? (
              <div className="grid min-h-40 place-items-center p-6 text-center">
                <div>
                  <p className="font-bold">{search ? 'No matching question banks' : 'No QBanks here yet'}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{search ? 'Try a shorter name or clear your search.' : 'Use the heart, pin, or category selector on a bank to add it here.'}</p>
                </div>
              </div>
            ) : (
              displayedBanks.map((bank) => {
                    const role = bankRoleFor(user, bank, collaboration.memberships);
                    const questions = collaboration.approvedQuestions.filter((item) => item.qbankId === bank.id).length;
                    const managed = canManageBank(user, bank);
                    const isOwner = bank.ownerId === user.uid;
                    const favorite = organization.favoriteIds.includes(bank.id);
                    const pinned = organization.pinnedIds.includes(bank.id);
                    return (
                      <article key={bank.id} data-active={activeQBankId === bank.id} className={cx('q-bank-row flex flex-col gap-4 border-b p-4 transition last:border-b-0 xl:flex-row xl:items-center', activeQBankId === bank.id ? 'bg-primary/5' : 'hover:bg-muted/30')}>
                        <button onClick={() => onSelect(bank.id)} className="flex min-w-0 flex-1 items-start gap-4 text-left">
                          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{bank.visibility === 'public' ? <Globe2 className="size-5" /> : <LockKeyhole className="size-5" />}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-bold">{bank.name}</span>{activeQBankId === bank.id && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary"><Check className="size-3" />Selected</span>}
                              {isOwner && <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-bold uppercase text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">Owner</span>}
                              {bank.essential && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold uppercase text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Essential</span>}
                              {!isOwner && role && <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-bold uppercase text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">{role}</span>}
                              {pinned && <Pin className="size-3.5 fill-primary text-primary" aria-label="Pinned" />}
                            </span>
                            <span className="mt-1 line-clamp-2 block text-sm leading-5 text-muted-foreground">{bank.description || 'Empty QBank ready for its first question.'}</span>
                            <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{questions} questions</span><span>by {bank.ownerName}</span></span>
                          </span>
                        </button>
                        <div className="flex shrink-0 flex-wrap items-center gap-2 xl:max-w-[440px] xl:justify-end">
                          <button onClick={() => onSelect(bank.id)} className="q-button q-button-study">Study<ArrowRight className="size-4" /></button>
                          <select value={organization.categoryByBankId[bank.id] || 'Uncategorized'} onChange={(event) => setBankCategory(bank.id, event.target.value)} aria-label={`Category for ${bank.name}`} className="h-9 max-w-40 rounded-lg border bg-card px-2 text-xs">
                            {categoryNames.map((item) => <option key={item} value={item}>{item}</option>)}
                          </select>
                          <button onClick={() => toggleList('favoriteIds', bank.id)} aria-pressed={favorite} aria-label={favorite ? `Remove ${bank.name} from favorites` : `Add ${bank.name} to favorites`} className={cx('grid size-9 place-items-center rounded-lg border', favorite && 'border-rose-200 bg-rose-50 text-rose-600 dark:bg-rose-500/10')}><Heart className={cx('size-4', favorite && 'fill-current')} /></button>
                          <button onClick={() => toggleList('pinnedIds', bank.id)} aria-pressed={pinned} aria-label={pinned ? `Unpin ${bank.name}` : `Pin ${bank.name}`} className={cx('grid size-9 place-items-center rounded-lg border', pinned && 'border-primary/30 bg-primary/10 text-primary')}><Pin className={cx('size-4', pinned && 'fill-current')} /></button>
                          {managed && <button onClick={() => onManageBank(bank.id, 'settings')} aria-label={`Manage ${bank.name}`} className="q-button q-button-secondary"><Settings2 className="size-4" /><span>Manage</span></button>}
                          {managed && <button onClick={() => onManageBank(bank.id, 'questions')} aria-label={`Manage questions in ${bank.name}`} className="q-button q-button-secondary"><ListChecks className="size-4" /><span>Questions</span></button>}
                        </div>
                      </article>
                    );
              })
            )}
          </div>
        </section>
        {collaboration.qbanks.some((bank) => canManageBank(user, bank)) && (
          <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
            <div className="flex items-center gap-2">
              <Users className="size-5 text-primary" />
              <h2 className="font-bold">Invite a specific user</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Invite by account email and assign Viewer or Reviewer access for one bank.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.2fr_150px_auto]">
              <select aria-label="QBank to share" value={inviteBankId} onChange={(event) => setInviteBankId(event.target.value)} className="h-11 rounded-xl border bg-card px-3 text-sm">
                <option value="">Choose your QBank</option>
                {collaboration.qbanks
                  .filter((bank) => canManageBank(user, bank))
                  .map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.name}
                    </option>
                  ))}
              </select>
              {inviteRole === 'reviewer' ? <ReviewerSearch bankId={inviteBankId} onAdded={membership=>confirmUpdate(current=>({...current,memberships:[membership,...current.memberships.filter(m=>!(m.qbankId===membership.qbankId&&m.userId===membership.userId))]}))} /> : <input aria-label="Invitation email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="student@university.edu" className="h-11 rounded-xl border bg-card px-3 text-sm" />}
              <select aria-label="Invitation role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<BankRole, 'owner'>)} className="h-11 rounded-xl border bg-card px-3 text-sm">
                <option value="viewer">Viewer</option>
                <option value="reviewer">Reviewer</option>
              </select>
              <button onClick={invite} disabled={inviteRole === 'reviewer' || !inviteBankId || !inviteEmail.includes('@')} className="q-button q-button-contribute">
                Send invite
              </button>
            </div>
          </section>
        )}
      </div>
      {creating && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm">
          <form onSubmit={createBank} className="my-8 w-full max-w-xl rounded-2xl bg-card p-6 shadow-2xl ring-1 ring-border">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Create a QBank from scratch</h2>
                <p className="text-xs text-muted-foreground">You become the Bank Owner.</p>
              </div>
              <button type="button" onClick={() => setCreating(false)} aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">QBank name</span>
                <input required value={name} onChange={(event) => setName(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3" placeholder="Surgery final review" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Short label</span>
                <input value={shortName} onChange={(event) => setShortName(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3" placeholder="SURG 401" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Description</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-24 w-full rounded-xl border bg-card p-3" />
              </label>
              <fieldset>
                <legend className="text-sm font-semibold">Visibility</legend>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {(['private', 'public'] as const).map((item) => (
                    <button type="button" key={item} onClick={() => setVisibility(item)} className={cx('rounded-xl border p-4 text-left', visibility === item && 'border-primary bg-primary/5 ring-2 ring-primary/10')}>
                      <span className="flex items-center gap-2 font-bold capitalize">
                        {item === 'private' ? <LockKeyhole className="size-4" /> : <Globe2 className="size-4" />}
                        {item}
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-muted-foreground">{item === 'private' ? 'Only you, invited members, and Superadmin audit view.' : 'Visible to every approved Lite and Pro user.'}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              {user.role === 'super_admin' && (
                <label aria-label="Make this an Essential QBank" className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/25 dark:bg-amber-500/10">
                  <input type="checkbox" checked={essential} onChange={(event) => setEssential(event.target.checked)} className="mt-1 size-4 accent-amber-600" />
                  <span>
                    <span className="block text-sm font-bold">Check to make it an Essential QBank</span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">Only Superadmin can edit or delete it. Other users can submit change proposals for review.</span>
                  </span>
                </label>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="h-10 rounded-xl border px-4 text-xs font-bold">
                Cancel
              </button>
              <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground">
                <Check className="size-4" />
                Create empty QBank
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
