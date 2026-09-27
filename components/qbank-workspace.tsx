'use client';

import { ReviewerSearch } from '@/components/reviewer-search';
import { WorkspaceHeader } from '@/components/workspace-header';
import { AdaptiveOverlay } from '@/components/ui/adaptive-overlay';
import {
  openUpgrade,
  UpgradeButton,
} from '@/components/subscription-workspace';
import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  Crown,
  Folder,
  Globe2,
  GripVertical,
  Heart,
  ListChecks,
  LockKeyhole,
  Pin,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  UserPlus,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePresentationEnvironment } from '@/features/presentation/presentation-context';
import {
  bankRoleFor,
  canAccessBank,
  canEditBank,
  canManageBank,
} from '@/features/access/domain/access-policy';
import {
  type AppUser,
  type BankRole,
  type CollaborationState,
  type QBank,
  type QBankVisibility,
  type Question,
} from '@/lib/medguard-types';
import { cn as cx, nowIso } from '@/lib/utils';
import {
  hasFeature,
  PLAN_LIMITS,
} from '@/features/subscriptions/domain/plan-config';

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
  questionPool,
  update,
  confirmUpdate,
  activeQBankId,
  organization,
  updateOrganization,
  bookmarkedQuestionIds,
  onToggleBookmark,
  onStartBookmarks,
  onSelect,
  onManageBank,
}: {
  user: AppUser;
  collaboration: CollaborationState;
  questionPool: Question[];
  update: (
    updater: (current: CollaborationState) => CollaborationState,
  ) => void;
  confirmUpdate: (
    updater: (current: CollaborationState) => CollaborationState,
  ) => void;
  activeQBankId: string;
  organization: {
    favoriteIds: string[];
    pinnedIds: string[];
    quickAccessIds: string[];
    orderBySection: { mine: string[]; shared: string[] };
  };
  updateOrganization: (next: {
    favoriteIds: string[];
    pinnedIds: string[];
    quickAccessIds: string[];
    orderBySection: { mine: string[]; shared: string[] };
  }) => void;
  bookmarkedQuestionIds: string[];
  onToggleBookmark: (questionId: string) => void;
  onStartBookmarks: (questionIds: string[], title: string) => void;
  onSelect: (id: string) => void;
  onManageBank: (
    id: string,
    section: 'settings' | 'structure' | 'questions',
  ) => void;
}) {
  const { coarsePointer, mode: presentationMode } = usePresentationEnvironment();
  const handheld = presentationMode === 'handheld';
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<QBankVisibility>('private');
  const [essential, setEssential] = useState(false);
  const [inviteBankId, setInviteBankId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] =
    useState<Exclude<BankRole, 'owner'>>('viewer');
  const [activeSection, setActiveSection] = useState<
    'mine' | 'shared' | 'public' | 'favorites' | 'bookmarks'
  >('mine');
  const [activeFolderId, setActiveFolderId] = useState('');
  const [quickAccessOpen, setQuickAccessOpen] = useState(false);
  const [mobileActionsBankId, setMobileActionsBankId] = useState('');
  const [draggingId, setDraggingId] = useState('');
  useEffect(() => {
    const bank = collaboration.qbanks.find((item) => item.id === activeQBankId);
    if (!bank) return;
    const shared = collaboration.memberships.some(
      (membership) =>
        membership.qbankId === bank.id && membership.userId === user.uid,
    );
    const nextSection = bank.essential || (bank.visibility === 'public' && bank.ownerId !== user.uid)
      ? 'public'
      : bank.ownerId === user.uid
        ? 'mine'
        : shared
          ? 'shared'
          : 'public';
    const timer = window.setTimeout(() => {
      setActiveSection(nextSection);
      setActiveFolderId(bank.folderId ?? '');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeQBankId, collaboration.memberships, collaboration.qbanks, user.uid]);
  const accessible = useMemo(
    () =>
      collaboration.qbanks.filter(
        (bank) =>
          !bank.archived &&
          canAccessBank(user, bank, collaboration.memberships),
      ),
    [collaboration.memberships, collaboration.qbanks, user],
  );
  const receivedInvites = useMemo(
    () =>
      collaboration.invitations.filter(
        (item) =>
          item.email === user.email.toLowerCase() && item.status === 'pending',
      ),
    [collaboration.invitations, user.email],
  );
  const canCreate = hasFeature(user.effectivePlan ?? user.tier, 'createQBank', user.planLimits);
  const sectionBanks = useMemo(() => {
    if (activeSection === 'mine')
      return accessible.filter(
        (bank) => bank.ownerId === user.uid && !bank.essential,
      );
    if (activeSection === 'shared') {
      const sharedIds = new Set(
        collaboration.memberships
          .filter((membership) => membership.userId === user.uid)
          .map((membership) => membership.qbankId),
      );
      return accessible.filter(
        (bank) => bank.ownerId !== user.uid && sharedIds.has(bank.id),
      );
    }
    if (activeSection === 'public')
      return accessible.filter(
        (bank) =>
          bank.essential ||
          (bank.visibility === 'public' && bank.ownerId !== user.uid),
      );
    if (activeSection === 'favorites')
      return accessible.filter((bank) =>
        organization.favoriteIds.includes(bank.id),
      );
    return [];
  }, [
    activeSection,
    accessible,
    collaboration.memberships,
    organization.favoriteIds,
    user.uid,
  ]);
  const activeFolder = collaboration.qbankFolders.find(
    (folder) => folder.id === activeFolderId,
  );
  const visibleFolders = useMemo(
    () =>
      search.trim() || activeSection === 'favorites'
        ? []
        : collaboration.qbankFolders
            .filter((folder) => folder.parentId === (activeFolder?.id ?? null))
            .filter((folder) =>
              sectionBanks.some(
                (bank) =>
                  bank.folderId === folder.id ||
                  collaboration.qbankFolders.some(
                    (child) =>
                      child.parentId === folder.id &&
                      child.id === bank.folderId,
                  ),
              ),
            )
            .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [
      activeFolder?.id,
      activeSection,
      collaboration.qbankFolders,
      search,
      sectionBanks,
    ],
  );
  const displayedBanks = useMemo(
    () =>
      sectionBanks
        .filter((bank) =>
          `${bank.name} ${bank.shortName} ${bank.description}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
        )
        .filter((bank) => {
          if (search.trim() || activeSection === 'favorites') return true;
          return activeFolder
            ? bank.folderId === activeFolder.id
            : !bank.folderId;
        })
        .sort((left, right) => {
          const pin =
            Number(organization.pinnedIds.includes(right.id)) -
            Number(organization.pinnedIds.includes(left.id));
          if (pin) return pin;
          if (activeSection === 'mine' || activeSection === 'shared') {
            const order = organization.orderBySection[activeSection];
            const leftIndex = order.indexOf(left.id);
            const rightIndex = order.indexOf(right.id);
            if (leftIndex >= 0 || rightIndex >= 0)
              return (
                (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
                (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
              );
          }
          return left.name.localeCompare(right.name);
        }),
    [
      activeFolder,
      activeSection,
      organization.orderBySection,
      organization.pinnedIds,
      search,
      sectionBanks,
    ],
  );
  const questionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const question of questionPool) {
      const bankId = question.qbankId ?? 'smle-gs';
      counts.set(bankId, (counts.get(bankId) ?? 0) + 1);
    }
    return counts;
  }, [questionPool]);
  const bookmarkedGroups = useMemo(() => {
    const accessibleIds = new Set(accessible.map((bank) => bank.id));
    return accessible
      .map((bank) => ({
        bank,
        questions: questionPool.filter(
          (question) =>
            (question.qbankId ?? 'smle-gs') === bank.id &&
            bookmarkedQuestionIds.includes(question.id) &&
            accessibleIds.has(bank.id),
        ),
      }))
      .filter((group) => group.questions.length > 0);
  }, [accessible, bookmarkedQuestionIds, questionPool]);
  const mobileActionsBank = accessible.find(
    (bank) => bank.id === mobileActionsBankId,
  );

  function toggleList(key: 'favoriteIds' | 'pinnedIds', bankId: string) {
    const values = organization[key];
    updateOrganization({
      ...organization,
      [key]: values.includes(bankId)
        ? values.filter((id) => id !== bankId)
        : [...values, bankId],
    });
  }

  function reorderBank(targetId: string) {
    if (
      !draggingId ||
      draggingId === targetId ||
      (activeSection !== 'mine' && activeSection !== 'shared')
    )
      return;
    const currentOrder = organization.orderBySection[activeSection];
    const ids = [
      ...new Set([...currentOrder, ...sectionBanks.map((bank) => bank.id)]),
    ].filter((id) => sectionBanks.some((bank) => bank.id === id));
    const from = ids.indexOf(draggingId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    updateOrganization({
      ...organization,
      orderBySection: { ...organization.orderBySection, [activeSection]: ids },
    });
    setDraggingId('');
  }

  function moveBank(bankId: string, direction: -1 | 1) {
    if (activeSection !== 'mine' && activeSection !== 'shared') return;
    const bankPinned = organization.pinnedIds.includes(bankId);
    const peers = displayedBanks.filter(
      (bank) => organization.pinnedIds.includes(bank.id) === bankPinned,
    );
    const from = peers.findIndex((bank) => bank.id === bankId);
    const target = peers[from + direction];
    if (from < 0 || !target) return;

    const savedOrder = organization.orderBySection[activeSection].filter((id) =>
      sectionBanks.some((bank) => bank.id === id),
    );
    const unsavedIds = sectionBanks
      .filter((bank) => !savedOrder.includes(bank.id))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((bank) => bank.id);
    const ids = [...savedOrder, ...unsavedIds];
    const sourceIndex = ids.indexOf(bankId);
    const targetIndex = ids.indexOf(target.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    [ids[sourceIndex], ids[targetIndex]] = [ids[targetIndex], ids[sourceIndex]];
    updateOrganization({
      ...organization,
      orderBySection: { ...organization.orderBySection, [activeSection]: ids },
    });
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
    const bank = collaboration.qbanks.find(
      (item) => item.id === inviteBankId && canManageBank(user, item),
    );
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
    const invitation = collaboration.invitations.find(
      (item) => item.id === inviteId,
    );
    if (!invitation) return;
    const acceptedAt = nowIso();
    update((current) => ({
      ...current,
      invitations: current.invitations.map((item) =>
        item.id === inviteId
          ? { ...item, status: 'accepted', acceptedById: user.uid, acceptedAt }
          : item,
      ),
      memberships: [
        ...current.memberships.filter(
          (item) =>
            !(item.qbankId === invitation.qbankId && item.userId === user.uid),
        ),
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
      <WorkspaceHeader
        title="My QBanks"
        subtitle="Your questions, organized around you."
        actions={<button
          onClick={() => (canCreate ? setCreating(true) : openUpgrade())}
          className={cx(
            'q-button',
            canCreate ? 'q-button-contribute' : 'border',
          )}
        >
          {canCreate ? (
            <Plus className="size-4" />
          ) : (
            <LockKeyhole className="size-4" />
          )}
          {canCreate ? 'New QBank' : 'Create QBank · Pro'}
        </button>}
      />
      <div className="q-page space-y-6">
        {receivedInvites.length > 0 && (
          <section className="rounded-2xl border border-violet-200 bg-violet-50/70 p-5 dark:border-violet-500/20 dark:bg-violet-500/10">
            <h2 className="flex items-center gap-2 font-bold">
              <UserPlus className="size-5 text-violet-600 dark:text-violet-300" />
              Bank invitations
            </h2>
            <div className="mt-3 space-y-2">
              {receivedInvites.map((inviteItem) => (
                <div
                  key={inviteItem.id}
                  className="flex flex-col gap-3 rounded-xl bg-card p-3 sm:flex-row sm:items-center"
                >
                  <span className="flex-1 text-sm">
                    <strong>{inviteItem.invitedByName}</strong> invited you as{' '}
                    {inviteItem.role === 'editor'
                      ? 'Editor'
                      : inviteItem.role === 'reviewer'
                        ? 'Reviewer'
                        : 'Viewer'}.
                  </span>
                  <button
                    onClick={() => acceptInvite(inviteItem.id)}
                    className="h-9 rounded-lg bg-violet-600 px-4 text-xs font-bold text-white"
                  >
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
              <h2 className="font-bold">
                {PLAN_LIMITS[user.effectivePlan ?? user.tier].name} account
              </h2>
              <div className="mt-3">
                <UpgradeButton />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                You can study public and shared banks. Upgrade to Pro to create
                your own.
              </p>
            </div>
          </section>
        )}
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Your QBank library</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A clean folder view with personal shortcuts.
              </p>
            </div>
            <button
              onClick={() => setQuickAccessOpen(true)}
              className="q-button q-button-secondary"
            >
              <SlidersHorizontal className="size-4" />
              Quick Access
            </button>
          </div>
          <nav
            aria-label="QBank sections"
            className="mb-4 overflow-x-auto rounded-2xl bg-muted p-1.5 scrollbar-none"
          >
            <div className="mx-auto flex w-max gap-2">
              {(
                [
                  ['mine', 'My QBanks'],
                  ['shared', 'Shared with me'],
                  ['public', 'Public QBanks'],
                  ['favorites', 'Favorites'],
                  ['bookmarks', 'Bookmarks'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => {
                    setActiveSection(id);
                    setActiveFolderId('');
                  }}
                  className={cx(
                    'flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-muted-foreground',
                    activeSection === id && 'bg-card text-primary shadow-sm',
                  )}
                >
                  {id === 'favorites' && <Heart className="size-4" />}
                  {id === 'bookmarks' && <Bookmark className="size-4" />}
                  {label}
                </button>
              ))}
            </div>
          </nav>
          {activeSection === 'bookmarks' ? (
            <div className="space-y-4">
              {bookmarkedGroups.length ? (
                bookmarkedGroups.map(({ bank, questions }) => (
                  <section
                    key={bank.id}
                    className="overflow-hidden rounded-2xl bg-card ring-1 ring-border"
                  >
                    <header className="flex items-center gap-3 border-b p-4">
                      <Folder className="size-5 text-primary" />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-bold">{bank.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {questions.length} bookmarked questions
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          onStartBookmarks(
                            questions.map((question) => question.id),
                            `${bank.shortName} Bookmarks`,
                          )
                        }
                        className="q-button q-button-study"
                      >
                        Start test
                      </button>
                    </header>
                    <div className="divide-y">
                      {questions.map((question, index) => (
                        <div
                          key={question.id}
                          className="flex items-center gap-3 p-3"
                        >
                          <button
                            onClick={() =>
                              onStartBookmarks(
                                [question.id],
                                `Bookmarked question ${question.questionId ?? index + 1}`,
                              )
                            }
                            className="min-w-0 flex-1 text-left"
                          >
                            <strong className="line-clamp-1 text-sm">
                              {question.stem}
                            </strong>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Question {question.questionId ?? index + 1}
                            </span>
                          </button>
                          <button
                            onClick={() => onToggleBookmark(question.id)}
                            aria-label="Remove bookmark"
                            className="q-icon text-primary"
                          >
                            <Bookmark className="size-4 fill-current" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed bg-card p-12 text-center">
                  <Bookmark className="mx-auto size-8 text-muted-foreground" />
                  <h3 className="mt-3 font-bold">No bookmarks yet</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Bookmark questions while solving a test.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              <label className="mb-4 flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
                <Search className="size-5 text-muted-foreground" />
                <input
                  aria-label="Search QBanks"
                  placeholder="Find a question bank…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
              {activeFolder && (
                <button
                  onClick={() => setActiveFolderId(activeFolder.parentId ?? '')}
                  className="q-button q-button-secondary mb-3"
                >
                  <ArrowLeft className="size-4" />
                  Back{' '}
                  <span className="text-muted-foreground">
                    / {activeFolder.name}
                  </span>
                </button>
              )}
              {!!visibleFolders.length && (
                <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleFolders.map((folder) => {
                    const direct = sectionBanks.filter(
                      (bank) => bank.folderId === folder.id,
                    ).length;
                    const childIds = collaboration.qbankFolders
                      .filter((child) => child.parentId === folder.id)
                      .map((child) => child.id);
                    const total =
                      direct +
                      sectionBanks.filter(
                        (bank) =>
                          bank.folderId && childIds.includes(bank.folderId),
                      ).length;
                    return (
                      <button
                        key={folder.id}
                        onClick={() => setActiveFolderId(folder.id)}
                        className="group flex min-h-24 items-center gap-4 rounded-2xl bg-card p-4 text-left ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-primary/30"
                      >
                        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                          <Folder className="size-6 fill-current/10" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate">
                            {folder.name}
                          </strong>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {total} QBanks
                          </span>
                        </span>
                        <ArrowRight className="size-4 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              )}
              {(displayedBanks.length > 0 || visibleFolders.length === 0) && (
                <div className="q-bank-list overflow-hidden rounded-2xl bg-card ring-1 ring-border">
                  {!displayedBanks.length ? (
                    <div className="p-12 text-center">
                      <p className="font-bold">No QBanks here</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {search
                          ? 'Try a different search.'
                          : 'This folder is currently empty.'}
                      </p>
                    </div>
                  ) : (
                    displayedBanks.map((bank) => {
                    const role = bankRoleFor(
                      user,
                      bank,
                      collaboration.memberships,
                    );
                    const questions = questionCounts.get(bank.id) ?? 0;
                    const editable = canEditBank(
                      user,
                      bank,
                      collaboration.memberships,
                    );
                    const isOwner = bank.ownerId === user.uid;
                    const favorite = organization.favoriteIds.includes(bank.id);
                    const pinned = organization.pinnedIds.includes(bank.id);
                    const sortable =
                      activeSection === 'mine' || activeSection === 'shared';
                    const reorderPeers = sortable
                      ? displayedBanks.filter(
                          (item) =>
                            organization.pinnedIds.includes(item.id) === pinned,
                        )
                      : [];
                    const reorderIndex = reorderPeers.findIndex(
                      (item) => item.id === bank.id,
                    );
                    return (
                      <article
                        key={bank.id}
                        data-active={activeQBankId === bank.id}
                        className={cx(
                          'q-bank-row flex flex-col gap-4 border-b p-4 transition last:border-b-0 xl:flex-row xl:items-center',
                          activeQBankId === bank.id
                            ? 'bg-primary/5'
                            : 'hover:bg-muted/30',
                        )}
                      >
                        <button
                          draggable={sortable && !coarsePointer}
                          onDragStart={() => {
                            if (!coarsePointer) setDraggingId(bank.id);
                          }}
                          onDragEnd={() => setDraggingId('')}
                          onDragOver={(event) => {
                            if (sortable) event.preventDefault();
                          }}
                          onDrop={() => reorderBank(bank.id)}
                          onClick={() => onSelect(bank.id)}
                          className="flex min-w-0 flex-1 items-start gap-4 text-left"
                        >
                          {sortable && (
                            <GripVertical className="q-fine-pointer-only mt-3 size-4 shrink-0 cursor-grab text-muted-foreground" />
                          )}
                          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                            {bank.visibility === 'public' ? (
                              <Globe2 className="size-5" />
                            ) : (
                              <LockKeyhole className="size-5" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-bold">{bank.name}</span>
                              {activeQBankId === bank.id && (
                                <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                                  Selected
                                </span>
                              )}
                              {isOwner && (
                                <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-bold text-violet-700">
                                  Owner
                                </span>
                              )}
                              {bank.essential && (
                                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
                                  Essential
                                </span>
                              )}
                              {!isOwner && role && (
                                <span className="rounded-full bg-muted px-2 py-1 text-xs font-bold">
                                  {role === 'editor'
                                    ? 'Editor'
                                    : role === 'reviewer'
                                      ? 'Reviewer'
                                      : 'Viewer'}
                                </span>
                              )}
                              {pinned && (
                                <Pin className="size-3.5 fill-primary text-primary" />
                              )}
                            </span>
                            <span className="mt-1 line-clamp-1 block text-sm text-muted-foreground">
                              {bank.description ||
                                'Ready for its first question.'}
                            </span>
                            <span className="mt-2 block text-xs text-muted-foreground">
                              {questions} questions · by {bank.ownerName}
                            </span>
                          </span>
                        </button>
                        {!handheld && <div className="flex shrink-0 flex-wrap gap-2">
                          {sortable && (
                            <div
                              className="q-coarse-pointer-only items-center gap-2"
                              aria-label="Reorder QBank"
                            >
                              <button
                                type="button"
                                aria-label={`Move ${bank.name} up`}
                                disabled={reorderIndex <= 0}
                                onClick={() => moveBank(bank.id, -1)}
                                className="q-icon border disabled:opacity-35"
                              >
                                <ArrowUp className="size-4" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${bank.name} down`}
                                disabled={
                                  reorderIndex < 0 ||
                                  reorderIndex >= reorderPeers.length - 1
                                }
                                onClick={() => moveBank(bank.id, 1)}
                                className="q-icon border disabled:opacity-35"
                              >
                                <ArrowDown className="size-4" />
                              </button>
                            </div>
                          )}
                          <button
                            onClick={() => onSelect(bank.id)}
                            className="q-button q-button-study"
                          >
                            Study
                            <ArrowRight className="size-4" />
                          </button>
                          <button
                            onClick={() => toggleList('favoriteIds', bank.id)}
                            aria-label="Toggle favorite"
                            className={cx(
                              'q-icon border',
                              favorite && 'bg-rose-50 text-rose-600',
                            )}
                          >
                            <Heart
                              className={cx(
                                'size-4',
                                favorite && 'fill-current',
                              )}
                            />
                          </button>
                          <button
                            onClick={() => toggleList('pinnedIds', bank.id)}
                            aria-label="Toggle pin"
                            className={cx(
                              'q-icon border',
                              pinned && 'bg-primary/10 text-primary',
                            )}
                          >
                            <Pin
                              className={cx('size-4', pinned && 'fill-current')}
                            />
                          </button>
                          {editable && (
                            <button
                              onClick={() => onManageBank(bank.id, 'settings')}
                              className="q-button q-button-secondary"
                            >
                              <Settings2 className="size-4" />
                              Manage
                            </button>
                          )}
                          {editable && (
                            <button
                              onClick={() => onManageBank(bank.id, 'questions')}
                              className="q-button q-button-secondary"
                            >
                              <ListChecks className="size-4" />
                              Questions
                            </button>
                          )}
                        </div>}
                        {handheld && (
                          <div className="q-bank-mobile-actions">
                            <button
                              onClick={() => onSelect(bank.id)}
                              className="q-button q-button-study"
                            >
                              Study
                              <ArrowRight className="size-4" />
                            </button>
                            <button
                              onClick={() => toggleList('favoriteIds', bank.id)}
                              aria-label={favorite ? `Remove ${bank.name} from favorites` : `Add ${bank.name} to favorites`}
                              aria-pressed={favorite}
                              className={cx('q-icon border', favorite && 'bg-rose-50 text-rose-600')}
                            >
                              <Heart className={cx('size-4', favorite && 'fill-current')} />
                            </button>
                            <button
                              onClick={() => setMobileActionsBankId(bank.id)}
                              aria-label={`More actions for ${bank.name}`}
                              className="q-icon border"
                            >
                              <Settings2 className="size-4" />
                            </button>
                          </div>
                        )}
                      </article>
                    );
                    })
                  )}
                </div>
              )}
            </>
          )}
        </section>
        {collaboration.qbanks.some((bank) => canManageBank(user, bank)) && (
          <section className="rounded-2xl bg-card p-5 ring-1 ring-border">
            <div className="flex items-center gap-2">
              <Users className="size-5 text-primary" />
              <h2 className="font-bold">Invite a specific user</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Invite by account email and assign Viewer, Reviewer, or Editor
              access for one bank.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.2fr_150px_auto]">
              <select
                aria-label="QBank to share"
                value={inviteBankId}
                onChange={(event) => setInviteBankId(event.target.value)}
                className="h-11 rounded-xl border bg-card px-3 text-sm"
              >
                <option value="">Choose your QBank</option>
                {collaboration.qbanks
                  .filter((bank) => canManageBank(user, bank))
                  .map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.name}
                    </option>
                  ))}
              </select>
              {inviteRole === 'reviewer' ? (
                <ReviewerSearch
                  bankId={inviteBankId}
                  onAdded={(membership) =>
                    confirmUpdate((current) => ({
                      ...current,
                      memberships: [
                        membership,
                        ...current.memberships.filter(
                          (m) =>
                            !(
                              m.qbankId === membership.qbankId &&
                              m.userId === membership.userId
                            ),
                        ),
                      ],
                    }))
                  }
                />
              ) : (
                <input
                  aria-label="Invitation email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="student@university.edu"
                  className="h-11 rounded-xl border bg-card px-3 text-sm"
                />
              )}
              <select
                aria-label="Invitation role"
                value={inviteRole}
                onChange={(event) =>
                  setInviteRole(
                    event.target.value as Exclude<BankRole, 'owner'>,
                  )
                }
                className="h-11 rounded-xl border bg-card px-3 text-sm"
              >
                <option value="viewer">Viewer</option>
                <option value="reviewer">Reviewer</option>
                <option value="editor">Editor</option>
              </select>
              <button
                onClick={invite}
                disabled={
                  inviteRole === 'reviewer' ||
                  !inviteBankId ||
                  !inviteEmail.includes('@')
                }
                className="q-button q-button-contribute"
              >
                Send invite
              </button>
            </div>
          </section>
        )}
      </div>
      <AdaptiveOverlay
        open={Boolean(mobileActionsBank)}
        onOpenChange={(open) => {
          if (!open) setMobileActionsBankId('');
        }}
        title={mobileActionsBank?.name ?? 'QBank actions'}
        description="Organize this bank or open its management tools."
      >
        {mobileActionsBank && (
          <div className="q-mobile-tool-list">
            <button
              type="button"
              aria-pressed={organization.pinnedIds.includes(mobileActionsBank.id)}
              onClick={() => toggleList('pinnedIds', mobileActionsBank.id)}
            >
              <Pin className="size-5" />
              <span>
                <strong>{organization.pinnedIds.includes(mobileActionsBank.id) ? 'Unpin QBank' : 'Pin QBank'}</strong>
                <small>Keep important banks at the top of this section.</small>
              </span>
            </button>
            {(activeSection === 'mine' || activeSection === 'shared') && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => moveBank(mobileActionsBank.id, -1)}>
                  <ArrowUp className="size-5" />
                  <span><strong>Move up</strong><small>Change list order</small></span>
                </button>
                <button type="button" onClick={() => moveBank(mobileActionsBank.id, 1)}>
                  <ArrowDown className="size-5" />
                  <span><strong>Move down</strong><small>Change list order</small></span>
                </button>
              </div>
            )}
            {canEditBank(user, mobileActionsBank, collaboration.memberships) && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMobileActionsBankId('');
                    onManageBank(mobileActionsBank.id, 'settings');
                  }}
                >
                  <Settings2 className="size-5" />
                  <span><strong>Manage QBank</strong><small>Settings, access, and sharing.</small></span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileActionsBankId('');
                    onManageBank(mobileActionsBank.id, 'questions');
                  }}
                >
                  <ListChecks className="size-5" />
                  <span><strong>Manage questions</strong><small>Review and edit this bank’s content.</small></span>
                </button>
              </>
            )}
          </div>
        )}
      </AdaptiveOverlay>
      <AdaptiveOverlay
        open={quickAccessOpen}
        onOpenChange={setQuickAccessOpen}
        title="Quick Access QBanks"
        description="Choose up to five banks for the navigation shortcut."
      >
            <p className="text-xs font-bold text-primary">
              {organization.quickAccessIds.length}/5 selected
            </p>
            <div className="mt-3 max-h-[55dvh] space-y-2 overflow-y-auto pr-1">
              {accessible.map((bank) => {
                const selected = organization.quickAccessIds.includes(bank.id);
                return (
                  <label
                    key={bank.id}
                    aria-label={`Toggle ${bank.name} in Quick Access`}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border p-3"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={
                        !selected && organization.quickAccessIds.length >= 5
                      }
                      onChange={() =>
                        updateOrganization({
                          ...organization,
                          quickAccessIds: selected
                            ? organization.quickAccessIds.filter(
                                (id) => id !== bank.id,
                              )
                            : [...organization.quickAccessIds, bank.id],
                        })
                      }
                      className="size-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">
                        {bank.name}
                      </strong>
                      <span className="text-xs text-muted-foreground">
                        {bank.shortName}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <button
              onClick={() => setQuickAccessOpen(false)}
              className="q-button q-button-primary mt-4 w-full"
            >
              Done
            </button>
      </AdaptiveOverlay>
      <AdaptiveOverlay
        open={creating}
        onOpenChange={setCreating}
        title="Create a QBank from scratch"
        description="You become the Bank Owner."
        className="sm:max-w-xl"
      >
          <form
            onSubmit={createBank}
            className="w-full"
          >
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">
                  QBank name
                </span>
                <input
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-11 w-full rounded-xl border bg-card px-3"
                  placeholder="Surgery final review"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">
                  Short label
                </span>
                <input
                  value={shortName}
                  onChange={(event) => setShortName(event.target.value)}
                  className="h-11 w-full rounded-xl border bg-card px-3"
                  placeholder="SURG 401"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">
                  Description
                </span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="min-h-24 w-full rounded-xl border bg-card p-3"
                />
              </label>
              <fieldset>
                <legend className="text-sm font-semibold">Visibility</legend>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {(['private', 'public'] as const).map((item) => (
                    <button
                      type="button"
                      key={item}
                      onClick={() => setVisibility(item)}
                      className={cx(
                        'rounded-xl border p-4 text-left',
                        visibility === item &&
                          'border-primary bg-primary/5 ring-2 ring-primary/10',
                      )}
                    >
                      <span className="flex items-center gap-2 font-bold capitalize">
                        {item === 'private' ? (
                          <LockKeyhole className="size-4" />
                        ) : (
                          <Globe2 className="size-4" />
                        )}
                        {item}
                      </span>
                      <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                        {item === 'private'
                          ? 'Only you, invited members, and Superadmin audit view.'
                          : 'Visible to every approved Lite and Pro user.'}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
              {user.role === 'super_admin' && (
                <label
                  aria-label="Make this an Essential QBank"
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/25 dark:bg-amber-500/10"
                >
                  <input
                    type="checkbox"
                    checked={essential}
                    onChange={(event) => setEssential(event.target.checked)}
                    className="mt-1 size-4 accent-amber-600"
                  />
                  <span>
                    <span className="block text-sm font-bold">
                      Check to make it an Essential QBank
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                      Only Superadmin can edit or delete it. Other users can
                      submit change proposals for review.
                    </span>
                  </span>
                </label>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="h-10 rounded-xl border px-4 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground"
              >
                <Check className="size-4" />
                Create empty QBank
              </button>
            </div>
          </form>
      </AdaptiveOverlay>
    </>
  );
}
