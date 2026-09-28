'use client';

import { api } from '@/lib/api-client';
import type {
  AppUser,
  CollaborationState,
  QBankFolder,
} from '@/lib/medguard-types';
import {
  ChevronDown,
  ChevronUp,
  Folder,
  FolderPlus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';

export function QBankFolderManager({
  user,
  collaboration,
  update,
  replaceFromServer,
}: {
  user: AppUser;
  collaboration: CollaborationState;
  update: (
    updater: (current: CollaborationState) => CollaborationState,
  ) => void;
  replaceFromServer: (next: CollaborationState) => void;
}) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [renaming, setRenaming] = useState<QBankFolder>();
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<QBankFolder>();
  const [deleteMode, setDeleteMode] = useState<'move' | 'cascade'>('move');
  const [targetFolderId, setTargetFolderId] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const roots = useMemo(
    () =>
      collaboration.qbankFolders
        .filter((folder) => folder.parentId === null)
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [collaboration.qbankFolders],
  );
  const ordered = useMemo(
    () =>
      roots.flatMap((root) => [
        root,
        ...collaboration.qbankFolders
          .filter((folder) => folder.parentId === root.id)
          .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
      ]),
    [collaboration.qbankFolders, roots],
  );
  const deletingFolderIds = useMemo(() => {
    if (!deleting) return new Set<string>();
    return new Set([
      deleting.id,
      ...collaboration.qbankFolders
        .filter((folder) => folder.parentId === deleting.id)
        .map((folder) => folder.id),
    ]);
  }, [collaboration.qbankFolders, deleting]);
  const deletingBanks = useMemo(
    () =>
      collaboration.qbanks.filter(
        (bank) => bank.folderId && deletingFolderIds.has(bank.folderId),
      ),
    [collaboration.qbanks, deletingFolderIds],
  );
  const deletingHasEssential = deletingBanks.some((bank) => bank.essential);

  function createFolder(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    const normalized = nextName.toLocaleLowerCase();
    if (
      collaboration.qbankFolders.some(
        (folder) =>
          folder.parentId === (parentId || null) &&
          folder.name.trim().toLocaleLowerCase() === normalized,
      )
    ) {
      setMessage('A folder with this name already exists at this level.');
      return;
    }
    const now = new Date().toISOString();
    update((current) => ({
      ...current,
      qbankFolders: [
        ...current.qbankFolders,
        {
          id: crypto.randomUUID(),
          name: nextName,
          parentId: parentId || null,
          order: current.qbankFolders.filter(
            (folder) => folder.parentId === (parentId || null),
          ).length,
          createdAt: now,
          updatedAt: now,
        },
      ],
    }));
    setName('');
    setMessage('Folder added.');
  }

  function saveRename() {
    const value = renameValue.trim();
    if (!renaming || !value) return;
    if (
      collaboration.qbankFolders.some(
        (folder) =>
          folder.id !== renaming.id &&
          folder.parentId === renaming.parentId &&
          folder.name.trim().toLocaleLowerCase() === value.toLocaleLowerCase(),
      )
    ) {
      setMessage('A folder with this name already exists at this level.');
      return;
    }
    update((current) => ({
      ...current,
      qbankFolders: current.qbankFolders.map((folder) =>
        folder.id === renaming.id
          ? { ...folder, name: value, updatedAt: new Date().toISOString() }
          : folder,
      ),
    }));
    setRenaming(undefined);
    setMessage('Folder renamed.');
  }

  function moveFolder(folder: QBankFolder, direction: -1 | 1) {
    const siblings = collaboration.qbankFolders
      .filter((item) => item.parentId === folder.parentId)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const index = siblings.findIndex((item) => item.id === folder.id);
    const swap = siblings[index + direction];
    if (!swap) return;
    update((current) => ({
      ...current,
      qbankFolders: current.qbankFolders.map((item) =>
        item.id === folder.id
          ? { ...item, order: swap.order, updatedAt: new Date().toISOString() }
          : item.id === swap.id
            ? {
                ...item,
                order: folder.order,
                updatedAt: new Date().toISOString(),
              }
            : item,
      ),
    }));
  }

  function assignBank(bankId: string, folderId: string) {
    update((current) => ({
      ...current,
      qbanks: current.qbanks.map((bank) =>
        bank.id === bankId
          ? {
              ...bank,
              ...(folderId ? { folderId } : { folderId: undefined }),
            }
          : bank,
      ),
    }));
  }

  async function removeFolder() {
    if (!deleting) return;
    setBusy(true);
    setMessage('');
    try {
      await api(`/qbank-folders/${encodeURIComponent(deleting.id)}`, {
        method: 'DELETE',
        body: JSON.stringify({
          mode: deleteMode,
          targetFolderId: targetFolderId || null,
          confirmation,
        }),
      });
      const result = await api<{ collaboration: CollaborationState }>(
        '/collaboration',
        {
          forceRefresh: true,
          cacheScope: user.uid,
          requestReason: 'explicit-refresh',
        },
      );
      replaceFromServer(result.collaboration);
      setDeleting(undefined);
      setConfirmation('');
      setMessage('Folder operation completed.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Folder operation failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl bg-card p-5 ring-1 ring-border md:col-span-2">
      <div>
        <h2 className="flex items-center gap-2 font-bold">
          <Folder className="size-5 text-primary" /> QBank folder structure
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One global structure, up to two levels. It is reused in My, Shared and
          Public QBanks.
        </p>
      </div>
      <form
        onSubmit={createFolder}
        className="grid gap-2 sm:grid-cols-[1fr_220px_auto]"
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder="Folder name"
          className="h-11 rounded-xl border bg-background px-3 text-sm"
        />
        <select
          value={parentId}
          onChange={(event) => setParentId(event.target.value)}
          className="h-11 rounded-xl border bg-background px-3 text-sm"
        >
          <option value="">Top level</option>
          {roots.map((folder) => (
            <option key={folder.id} value={folder.id}>
              Inside {folder.name}
            </option>
          ))}
        </select>
        <button disabled={!name.trim()} className="q-button q-button-primary">
          <FolderPlus className="size-4" /> Add folder
        </button>
      </form>
      {message && (
        <output className="block rounded-xl bg-muted p-3 text-sm">
          {message}
        </output>
      )}
      <div className="overflow-hidden rounded-2xl border">
        {ordered.length ? (
          ordered.map((folder) => {
            const child = folder.parentId !== null;
            const count = collaboration.qbanks.filter(
              (bank) => bank.folderId === folder.id,
            ).length;
            return (
              <div
                key={folder.id}
                className="flex items-center gap-2 border-b px-3 py-3 last:border-b-0"
              >
                <span style={{ marginLeft: child ? 28 : 0 }}>
                  <Folder className="size-4 text-primary" />
                </span>
                <strong className="min-w-0 flex-1 truncate text-sm">
                  {folder.name}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {count} banks
                </span>
                <button
                  onClick={() => moveFolder(folder, -1)}
                  aria-label="Move up"
                  className="q-icon"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  onClick={() => moveFolder(folder, 1)}
                  aria-label="Move down"
                  className="q-icon"
                >
                  <ChevronDown className="size-4" />
                </button>
                <button
                  onClick={() => {
                    setRenaming(folder);
                    setRenameValue(folder.name);
                  }}
                  aria-label="Rename folder"
                  className="q-icon"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  onClick={() => {
                    setDeleting(folder);
                    setDeleteMode('move');
                    setTargetFolderId('');
                  }}
                  aria-label="Delete folder"
                  className="q-icon text-red-600"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })
        ) : (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No folders yet.
          </p>
        )}
      </div>
      <div>
        <h3 className="font-bold">Assign QBanks</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {collaboration.qbanks.map((bank) => (
            <label
              key={bank.id}
              className="flex items-center gap-3 rounded-xl border p-3"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {bank.name}
              </span>
              <select
                value={bank.folderId ?? ''}
                onChange={(event) => assignBank(bank.id, event.target.value)}
                className="h-9 max-w-44 rounded-lg border bg-background px-2 text-xs"
              >
                <option value="">Outside folders</option>
                {ordered.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.parentId ? '↳ ' : ''}
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      {renaming && (
        <div className="q-safe-overlay fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/45 p-4">
          <section className="w-full max-w-md rounded-2xl bg-card p-5 shadow-2xl">
            <h3 className="font-bold">Rename folder</h3>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="mt-4 h-11 w-full rounded-xl border bg-background px-3"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRenaming(undefined)}
                className="q-button q-button-secondary"
              >
                Cancel
              </button>
              <button
                onClick={saveRename}
                className="q-button q-button-primary"
              >
                Save
              </button>
            </div>
          </section>
        </div>
      )}
      {deleting && (
        <div className="q-safe-overlay fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/50 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-folder-title"
            aria-describedby="delete-folder-description"
            className="q-confirm-dialog q-confirm-dialog-wide w-full max-w-lg rounded-2xl bg-card p-5 shadow-2xl sm:p-6"
          >
            <h3 id="delete-folder-title" className="text-lg font-bold">
              Delete “{deleting.name}”
            </h3>
            <p
              id="delete-folder-description"
              className="mt-2 text-sm leading-6 text-muted-foreground"
            >
              Choose what should happen to the QBank contents before confirming.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => setDeleteMode('move')}
                className={`rounded-xl border p-3 text-left text-sm ${deleteMode === 'move' ? 'border-primary bg-primary/5' : ''}`}
              >
                <strong>Move contents</strong>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Keep every QBank.
                </span>
              </button>
              <button
                disabled={deletingHasEssential}
                onClick={() => setDeleteMode('cascade')}
                className={`rounded-xl border p-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${deleteMode === 'cascade' ? 'border-red-500 bg-red-50 dark:bg-red-500/10' : ''}`}
              >
                <strong>Delete everything</strong>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Permanently delete {deletingBanks.length} QBank(s).
                </span>
              </button>
            </div>
            {deletingHasEssential && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
                This branch contains an Essential QBank. Move it out before
                using permanent deletion.
              </p>
            )}
            {deleteMode === 'move' ? (
              <select
                value={targetFolderId}
                onChange={(e) => setTargetFolderId(e.target.value)}
                className="mt-4 h-11 w-full rounded-xl border bg-background px-3"
              >
                <option value="">Outside folders</option>
                {ordered
                  .filter(
                    (folder) =>
                      folder.id !== deleting.id &&
                      folder.parentId !== deleting.id,
                  )
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.parentId ? '↳ ' : ''}
                      {folder.name}
                    </option>
                  ))}
              </select>
            ) : (
              <label className="mt-4 block text-sm font-semibold">
                Type DELETE to confirm
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  className="mt-1 h-11 w-full rounded-xl border border-red-300 bg-background px-3"
                />
              </label>
            )}
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                disabled={busy}
                onClick={() => setDeleting(undefined)}
                className="q-button q-button-secondary w-full"
              >
                Cancel
              </button>
              <button
                disabled={
                  busy ||
                  (deleteMode === 'cascade' &&
                    (confirmation !== 'DELETE' || deletingHasEssential))
                }
                onClick={() => void removeFolder()}
                className="q-button w-full bg-red-600 text-white hover:bg-red-700"
              >
                {busy ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
