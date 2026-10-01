'use client';

/* oxlint-disable next/no-img-element */

import { ArrowLeft, Check, Clipboard, Copy, FileJson, ImagePlus, Layers3, Link2, LockKeyhole, Pencil, Plus, RefreshCw, Save, Search, Settings, Trash2, Unlink, Users, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { ClassificationFields } from '@/components/classification-fields';
import { ClassificationManager } from '@/components/classification-manager';
import { QuestionImportReview } from '@/components/question-import-review';
import { QuestionId } from '@/components/question-tools';
import { ReviewerSearch } from '@/components/reviewer-search';
import { WorkspaceHeader } from '@/components/workspace-header';
import { api } from '@/lib/api-client';
import { deleteQBank } from '@/features/qbanks/client/qbank-client';
import { withoutQBank } from '@/features/qbanks/domain/bank-state';
import { saveDirectQuestionEdit } from '@/features/qbanks/client/direct-question-edit';
import { readQuestionSource, validateQuestionSource, questionSourceKey, questionSourceOptions } from '@/features/qbanks/domain/question-source';
import { uploadQuestionImage } from '@/lib/application-services';
import { ExplanationImageEditor } from '@/components/explanation-image-editor';
import {
  bankRoleFor,
  canEditBank,
  canManageBank,
  canDeleteBank,
} from '@/features/access/domain/access-policy';
import {
  optionLabel,
  type AppUser,
  type CollaborationState,
  type NoteImage,
  type QBank,
  type Question,
  type QBankVisibility,
} from '@/lib/medguard-types';
import { cn } from '@/lib/utils';
import { hasFeature } from '@/features/subscriptions/domain/plan-config';
import { openUpgrade } from '@/components/subscription-workspace';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type Section = 'settings' | 'structure' | 'questions' | 'import';




interface QuestionDraft {
  stem: string;
  options: string[];
  answer: number;
  specialty: string;
  topic: string;
  explanation: string;
  explanationImages: NoteImage[];
  sourceFile: string;
  sourcePage: string;
  images: NoteImage[];
}

const emptyDraft = (): QuestionDraft => ({
  stem: '',
  options: ['', '', '', ''],
  answer: 0,
  specialty: 'General',
  topic: 'General',
  explanation: '',
  explanationImages: [],
  sourceFile: '',
  sourcePage: '',
  images: [],
});

const classificationKey = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function QBankManagement({
  user,
  bankId,
  initialSection,
  collaboration,
  questions,
  update,
  confirmUpdate,
  onBack,
  onDeleted,
}: {
  user: AppUser;
  bankId: string;
  initialSection: Section;
  collaboration: CollaborationState;
  questions: Question[];
  update: (updater: (current: CollaborationState) => CollaborationState) => void;
  confirmUpdate: (updater: (current: CollaborationState) => CollaborationState) => void;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const bank = collaboration.qbanks.find((item) => item.id === bankId);
  const [section, setSection] = useState<Section>(initialSection);
  const [name, setName] = useState(bank?.name ?? '');
  const [shortName, setShortName] = useState(bank?.shortName ?? '');
  const [description, setDescription] = useState(bank?.description ?? '');
  const [visibility, setVisibility] = useState<QBankVisibility>(bank?.visibility ?? 'private');
  const [essential, setEssential] = useState(bank?.essential ?? false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Question | 'new'>();
  const [draft, setDraft] = useState<QuestionDraft>(emptyDraft);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [explanationImagesBusy, setExplanationImagesBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [specialtyFilter, setSpecialtyFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const sources = useMemo(() => questionSourceOptions(questions), [questions]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [bulkSpecialty, setBulkSpecialty] = useState('');
  const [bulkTopic, setBulkTopic] = useState('');
  const [structureDirty, setStructureDirty] = useState(false);
  const [confirmAction, confirmationDialog] = useConfirmationDialog();
  const bankSpecialties = useMemo(() => collaboration.specialties.filter((item) => item.qbankId === bankId), [bankId, collaboration.specialties]);
  const bankTopics = useMemo(() => collaboration.topics.filter((item) => item.qbankId === bankId), [bankId, collaboration.topics]);
  const noteStructureDirty = useCallback((dirty: boolean) => setStructureDirty(dirty), []);
  const members = useMemo(
    () =>
      collaboration.memberships.filter((item) => item.qbankId === bankId),
    [bankId, collaboration.memberships],
  );
  const plan = user.effectivePlan ?? user.tier;
  const canAddQuestions = user.role === 'super_admin' || hasFeature(plan, 'addQuestions', user.planLimits);
  const canImport = user.role === 'super_admin' || hasFeature(plan, 'jsonImport', user.planLimits);
  const canManageAccess = Boolean(bank && canManageBank(user, bank));
  const canDelete = Boolean(bank && canDeleteBank(user, bank));
  const bankRole = bank
    ? bankRoleFor(user, bank, collaboration.memberships)
    : undefined;
  const filteredQuestions = useMemo(() => {
    const raw = search.trim().replace(/^#/, '').toLowerCase();
    const padded = /^\d+$/.test(raw) ? raw.padStart(5, '0') : raw;
    return questions.filter((question) =>
      (!specialtyFilter || question.specialtyId === specialtyFilter) &&
      (!topicFilter || question.topicId === topicFilter) &&
      (!sourceFilter || (questionSourceKey(question) || '__missing-source__') === sourceFilter) &&
      (!raw || `${question.questionId} ${question.stem} ${question.specialty} ${question.topic}`.toLowerCase().includes(raw) || question.questionId.includes(padded)),
    );
  }, [questions, search, specialtyFilter, topicFilter, sourceFilter]);

  if (bank && canDelete && !canEditBank(user, bank, collaboration.memberships))
    return <main className="mx-auto max-w-xl space-y-4 p-6">
      <button onClick={onBack}>Return to My QBanks</button>
      <h1 className="text-xl font-bold">{bank.name}</h1>
      <p>This Essential QBank can be edited by Superadmin. As its owner, you can delete it.</p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {deleteOpen ? <>
        <p>Delete this bank and all of its questions permanently?</p>
        <button disabled={busy} onClick={() => void deleteBank()} className="rounded-xl bg-destructive p-3 text-destructive-foreground">{busy ? 'Deleting…' : 'Delete permanently'}</button>
        <button disabled={busy} onClick={() => setDeleteOpen(false)}>Cancel</button>
      </> : <button onClick={() => setDeleteOpen(true)} className="rounded-xl bg-destructive p-3 text-destructive-foreground">Delete QBank</button>}
    </main>;
  if (!bank || !canEditBank(user, bank, collaboration.memberships))
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="text-center">
          <h1 className="text-xl font-bold">QBank management is unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">QBank Owner or Editor access is required for this workspace.</p>
          <button onClick={onBack} className="mt-5 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">
            Return to My QBanks
          </button>
        </div>
      </main>
    );
  const bankName = bank.name;

  function changeSection(next: Section) {
    if (section === 'structure' && structureDirty && next !== 'structure') {
      setError('Save structure or discard the draft before leaving this section.');
      return;
    }
    setError('');
    setSection(next);
  }

  function leaveManagement() {
    if (section === 'structure' && structureDirty) {
      setError('Save structure or discard the draft before leaving this page.');
      return;
    }
    onBack();
  }

  function updateBank(updater: (current: QBank) => QBank) {
    update((current) => ({
      ...current,
      qbanks: current.qbanks.map((item) => (item.id === bankId ? updater(item) : item)),
    }));
  }

  function saveProperties(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    updateBank((current) => ({
      ...current,
      name: name.trim(),
      shortName: (shortName.trim() || name.trim()).slice(0, 18).toUpperCase(),
      description: description.trim(),
      visibility,
      essential: user.role === 'super_admin' ? essential : current.essential,
    }));
    setMessage('QBank properties saved.');
  }

  function rotateLink() {
    if (!canManageAccess) return;
    updateBank((current) => ({
      ...current,
      shareEnabled: true,
      shareToken: crypto.randomUUID(),
    }));
    setMessage('A new access link has been created. The previous link no longer works.');
  }

  function removeMember(memberId: string) {
    if (!canManageAccess) return;
    const member = collaboration.memberships.find((item) => item.id === memberId);
    update((current) => ({
      ...current,
      memberships: current.memberships.filter((item) => item.id !== memberId),
      qbanks: current.qbanks.map((item) =>
        item.id === bankId && member
          ? {
              ...item,
              reviewerIds: item.reviewerIds.filter((id) => id !== member.userId),
              viewerIds: item.viewerIds.filter((id) => id !== member.userId),
            }
          : item,
      ),
    }));
  }

  async function deleteBank() {
    if (!canDelete || busy) return;
    setBusy(true);
    setError('');
    try {
      await deleteQBank(user.uid, bankId);
      confirmUpdate(current => withoutQBank(current, bankId));
      onDeleted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to delete this QBank.');
      setDeleteOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function openQuestion(question?: Question) {
    setEditing(question ?? 'new');
    setDraft(
      question
        ? {
            stem: question.stem,
            options: [...question.options],
            answer: question.answer,
            specialty: question.specialty,
            topic: question.topic,
            explanation: question.explanation ?? '',
            explanationImages: question.explanationImages ?? [],
            sourceFile: readQuestionSource(question).sourceFile,
            sourcePage: String(readQuestionSource(question).sourcePage ?? ''),
            images: [...(question.images ?? [])],
          }
        : emptyDraft(),
    );
    setImageFiles([]);
    setError('');
    setMessage('');
  }

  async function uploadImages(questionId: string) {
    return Promise.all(
      imageFiles.slice(0, 5).map(async (file) => {
        if (!file.type.startsWith('image/')) throw new Error('Only image files are supported.');
        if (file.size > 10 * 1024 * 1024) throw new Error('Each image must be smaller than 10 MB.');
        const url = await uploadQuestionImage(user.uid, file, bankId, questionId);
        return { id: crypto.randomUUID(), url, name: file.name, caption: '' };
      }),
    );
  }

  async function ensureQuestionClassification(specialtyValue: string, topicValue: string, questionIds: string[] = []) {
    const specialtyName = specialtyValue.trim().replace(/\s+/g, ' ') || 'General';
    const topicName = topicValue.trim().replace(/\s+/g, ' ') || 'General';
    const now = new Date().toISOString();
    const nextSpecialties = [...bankSpecialties];
    const nextTopics = [...bankTopics];
    let specialty = nextSpecialties.find((item) => item.name === specialtyName)
      ?? nextSpecialties.find((item) => classificationKey(item.name) === classificationKey(specialtyName));
    let changed = false;
    if (!specialty) {
      specialty = { id: crypto.randomUUID(), qbankId: bankId, name: specialtyName, order: nextSpecialties.length, createdAt: now, updatedAt: now };
      nextSpecialties.push(specialty);
      changed = true;
    }
    let topic = nextTopics.find((item) => item.specialtyId === specialty!.id && item.name === topicName)
      ?? nextTopics.find((item) => item.specialtyId === specialty!.id && classificationKey(item.name) === classificationKey(topicName));
    if (!topic) {
      topic = { id: crypto.randomUUID(), qbankId: bankId, specialtyId: specialty.id, name: topicName, order: nextTopics.length, createdAt: now, updatedAt: now };
      nextTopics.push(topic);
      changed = true;
    }
    const changedQuestionIds = questionIds.filter((id) => questions.find((item) => item.id === id)?.topicId !== topic.id);
    const assignmentChanged = changedQuestionIds.length > 0;
    if (changed || assignmentChanged) {
      const result = await api<{
        revision: number;
        specialties: typeof nextSpecialties;
        topics: typeof nextTopics;
        assignments: Array<{ questionId: string; topicId: string; specialtyId: string; specialty: string; topic: string }>;
      }>('/platform/classification', {
        method: 'PUT',
        body: JSON.stringify({
          qbankId: bankId,
          operationId: crypto.randomUUID(),
          baseRevision: collaboration.classificationRevisions[bankId] ?? 0,
          specialties: nextSpecialties,
          topics: nextTopics,
          assignments: changedQuestionIds.map((questionId) => ({ questionId, topicId: topic!.id })),
        }),
      });
      confirmUpdate((current) => ({
        ...current,
        specialties: [...current.specialties.filter((item) => item.qbankId !== bankId), ...result.specialties],
        topics: [...current.topics.filter((item) => item.qbankId !== bankId), ...result.topics],
        classificationRevisions: { ...current.classificationRevisions, [bankId]: result.revision },
        approvedQuestions: current.approvedQuestions.map((item) => changedQuestionIds.includes(item.id)
          ? { ...item, specialtyId: specialty!.id, specialty: specialty!.name, topicId: topic!.id, topic: topic!.name }
          : item),
      }));
    }
    return { specialty, topic, assignmentChanged };
  }

  async function saveQuestion(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (explanationImagesBusy) return;
    if (!editing || !draft.stem.trim() || draft.options.length < 2 || draft.options.length > 10 || draft.answer >= draft.options.length || draft.options.some((item) => !item.trim()) || (editing === 'new' && !draft.explanation.trim()) || !draft.sourceFile.trim()) return;
    setBusy(true);
    setError('');
    try {
      const existing = editing === 'new' ? undefined : editing;
      const source = validateQuestionSource({ sourceFile: draft.sourceFile, sourcePage: draft.sourcePage, originalQuestionNumber: existing ? readQuestionSource(existing).originalQuestionNumber : undefined });
      const classification = await ensureQuestionClassification(draft.specialty, draft.topic, existing ? [existing.id] : []);
      const contentChanged = !existing ||
        existing.stem !== draft.stem.trim() ||
        JSON.stringify(existing.options) !== JSON.stringify(draft.options.map((item) => item.trim())) ||
        existing.answer !== draft.answer ||
        (existing.explanation ?? '') !== draft.explanation.trim() ||
        JSON.stringify(existing.explanationImages ?? []) !== JSON.stringify(draft.explanationImages) ||
        readQuestionSource(existing).sourceReference !== source.sourceReference ||
        JSON.stringify(existing.images ?? []) !== JSON.stringify(draft.images) ||
        imageFiles.length > 0;
      if (existing && !contentChanged) {
        setEditing(undefined);
        setDraft(emptyDraft());
        setMessage(classification.assignmentChanged ? 'Question classification updated for everyone.' : 'No changes to save.');
        return;
      }
      const proposalId = crypto.randomUUID();
      const uploaded = await uploadImages(existing?.questionId ?? `proposal-${proposalId}`);
      // Preserve completed uploads if the following question save fails.
      if (uploaded.length) {
        setDraft(current => ({ ...current, images: [...current.images, ...uploaded] }));
        setImageFiles([]);
      }
      const proposedAt = new Date().toISOString();
      const payload = {
        stem: draft.stem.trim(),
        options: draft.options.map((item) => item.trim()),
        answer: draft.answer,
        specialtyId: classification.specialty.id,
        specialty: classification.specialty.name,
        topicId: classification.topic.id,
        topic: classification.topic.name,
        explanation: draft.explanation.trim(),
        explanationImages: draft.explanationImages,
        ...source,
        images: [...draft.images, ...uploaded],
      };
      if (existing && user.role === 'super_admin') {
        const saved = await saveDirectQuestionEdit(user.uid, bankId, existing, payload);
        confirmUpdate((current) => ({
          ...current,
          approvedQuestions: current.approvedQuestions.map(item => item.id === saved.id ? saved : item),
        }));
        setEditing(undefined);
        setDraft(emptyDraft());
        setImageFiles([]);
        setMessage('Question updated immediately. Existing review proposals remain pending.');
        return;
      }
      update((current) => ({
        ...current,
        proposals: [
          {
            id: proposalId,
            qbankId: bankId,
            type: existing ? 'question_edit' : 'new_question',
            editKinds: ['question_text', 'options', 'correct_answer', 'explanation', 'source'],
            questionId: existing?.id,
            currentSnapshot: existing ? {
              stem: existing.stem,
              options: existing.options,
              answer: existing.answer,
              specialty: classification.specialty.name,
              topic: classification.topic.name,
              specialtyId: classification.specialty.id,
              topicId: classification.topic.id,
              explanation: existing.explanation ?? '',
              explanationImages: existing.explanationImages ?? [],
              ...readQuestionSource(existing),
              images: existing.images ?? [],
            } : undefined,
            payload,
            rationale: existing ? 'Question update submitted from bank management.' : 'New question submitted from bank management.',
            submissionMethod: 'manual',
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
            action: existing ? 'question_edit_proposed' : 'new_question_proposed',
            entityType: 'question',
            entityId: existing?.id ?? proposalId,
            actorId: user.uid,
            actorName: user.displayName,
            createdAt: proposedAt,
            detail: `${existing ? 'Submitted an edit for' : 'Submitted'} a question in ${bankName} for review.`,
          },
          ...current.auditLog,
        ],
      }));
      setEditing(undefined);
      setDraft(emptyDraft());
      setImageFiles([]);
      setMessage(existing ? 'Question update submitted for review.' : 'Question submitted for review.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to submit the question for review.');
    } finally {
      setBusy(false);
    }
  }

  async function applyBulkClassification() {
    if (!selectedQuestionIds.length || selectedQuestionIds.length > 500 || !bulkSpecialty.trim() || !bulkTopic.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await ensureQuestionClassification(bulkSpecialty, bulkTopic, selectedQuestionIds);
      setMessage(`Classification updated for ${selectedQuestionIds.length} questions in one atomic change.`);
      setSelectedQuestionIds([]);
      setBulkSpecialty(''); setBulkTopic('');
    } catch (caught) {
      setError(`${caught instanceof Error ? caught.message : 'Unable to update the selected questions.'} Your selection was kept. Choose Try again.`);
    } finally { setBusy(false); }
  }


  const shareUrl = bank.shareEnabled && bank.shareToken && typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}?join_qbank=${encodeURIComponent(bank.id)}&token=${encodeURIComponent(bank.shareToken)}` : '';

  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <WorkspaceHeader
        eyebrow="QBank management"
        title={bank.name}
        showMenu={false}
        leading={<button onClick={leaveManagement} className="q-icon" aria-label="Back to My QBanks">
            <ArrowLeft className="size-5" />
          </button>}
        actions={<span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">{bank.essential ? 'ESSENTIAL · SUPERADMIN' : bankRole === 'editor' ? 'EDITOR' : 'OWNER'}</span>}
      />
      <div className="mx-auto max-w-[1180px] p-4 sm:p-7">
        <nav className="mb-6 flex gap-2 overflow-x-auto" aria-label="QBank management sections">
          {(
            [
              ['settings', Settings, 'Properties & access'],
              ['structure', Layers3, 'Specialties & Topics'],
              ['questions', Clipboard, 'Questions'],
              ['import', FileJson, 'Import questions'],
            ] as const
          ).map(([id, Icon, label]) => (
            <button key={id} aria-pressed={section === id} onClick={() => (id === 'import' && !canImport ? openUpgrade() : changeSection(id))} className={cn('inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-bold', section === id && 'border-primary bg-primary text-primary-foreground')}>
              <Icon className="size-4" />
              {label}
              {id === 'import' && !canImport && <LockKeyhole className="size-3" />}
            </button>
          ))}
        </nav>
        {message && !error && (
          <output className="mb-5 flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            <Check className="size-4" />
            {message}
          </output>
        )}
        {error && (
          <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}

        {section === 'settings' && canManageAccess && <div className="mb-4 rounded-xl border bg-card p-4"><h2 className="mb-3 font-bold">Add Reviewer</h2><ReviewerSearch bankId={bankId} onAdded={membership=>confirmUpdate(current=>({...current,memberships:[membership,...current.memberships.filter(m=>!(m.qbankId===bankId&&m.userId===membership.userId))]}))} /></div>}
        {section === 'settings' && (
          <div className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
            <form onSubmit={saveProperties} className="rounded-2xl bg-card p-6 ring-1 ring-border">
              <h2 className="text-lg font-bold">QBank properties</h2>
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">Name</span>
                  <input required value={name} onChange={(event) => setName(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">Short label</span>
                  <input value={shortName} onChange={(event) => setShortName(event.target.value)} className="h-11 w-full rounded-xl border bg-card px-3" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">Description</span>
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-24 w-full rounded-xl border bg-card p-3" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">Visibility</span>
                  <select value={visibility} onChange={(event) => setVisibility(event.target.value as QBankVisibility)} className="h-11 w-full rounded-xl border bg-card px-3">
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                {user.role === 'super_admin' && (
                  <label aria-label="Essential QBank" className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-500/25 dark:bg-amber-500/10">
                    <input type="checkbox" checked={essential} onChange={(event) => setEssential(event.target.checked)} className="mt-1 size-4 accent-amber-600" />
                    <span>
                      <span className="block text-sm font-bold">Essential QBank</span>
                      <span className="mt-1 block text-sm leading-6 text-muted-foreground">Only Superadmin can edit or delete this bank. Everyone else submits proposals for reviewer approval.</span>
                    </span>
                  </label>
                )}
                <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">
                  <Save className="size-4" />
                  Save properties
                </button>
              </div>
            </form>
            <div className="space-y-5">
              {canManageAccess && <section className="rounded-2xl bg-card p-6 ring-1 ring-border">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <Link2 className="size-5 text-primary" />
                  Access link
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Generate a new link at any time. Changing it immediately invalidates the previous link.</p>
                {shareUrl && (
                  <div className="mt-4 flex gap-2">
                    <input readOnly aria-label="QBank access link" value={shareUrl} className="h-11 min-w-0 flex-1 rounded-xl border bg-muted/30 px-3 text-sm" />
                    <button onClick={() => { setError(''); setMessage(''); void navigator.clipboard.writeText(shareUrl).then(() => setMessage('Access link copied.')).catch(() => setError('Unable to copy the access link. Select and copy it manually.')); }} className="grid size-11 place-items-center rounded-xl border" aria-label="Copy access link">
                      <Copy className="size-4" />
                    </button>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={rotateLink} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">
                    <RefreshCw className="size-4" />
                    {shareUrl ? 'Change link' : 'Create link'}
                  </button>
                  {bank.shareEnabled && (
                    <button
                      onClick={() =>
                        updateBank((current) => ({
                          ...current,
                          shareEnabled: false,
                        }))
                      }
                      className="inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-bold"
                    >
                      <Unlink className="size-4" />
                      Disable link
                    </button>
                  )}
                </div>
              </section>}
              {canDelete && <section className="rounded-2xl border border-red-200 bg-red-50/60 p-6 dark:border-red-500/25 dark:bg-red-500/5">
                <h2 className="font-bold text-red-700 dark:text-red-300">Delete QBank</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Deletes the bank, its questions, invitations, access grants, statistics, and shared notes. Question IDs are never reused.</p>
                <button onClick={() => setDeleteOpen(true)} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white">
                  <Trash2 className="size-4" />
                  Delete QBank
                </button>
              </section>}
            </div>
            <section className="rounded-2xl bg-card p-6 ring-1 ring-border lg:col-span-2">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Users className="size-5 text-primary" />
                Granted access
              </h2>
              {!canManageAccess && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Only the QBank Owner can add or remove users.
                </p>
              )}
              {members.length ? (
                <div className="mt-4 divide-y rounded-xl border">
                  {members.map((member) => (
                    <div key={member.id} className="flex items-center gap-3 p-4">
                      <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-sm font-bold text-primary">{member.userName.slice(0, 2).toUpperCase()}</div>
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-sm">{member.userName}</strong>
                        <span className="text-xs uppercase text-muted-foreground">{member.role}</span>
                      </div>
                      {canManageAccess && (
                        <button onClick={() => removeMember(member.id)} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-bold text-red-600 dark:text-red-300">
                          <X className="size-4" />
                          Revoke access
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-xl bg-muted/40 p-5 text-sm text-muted-foreground">No users currently have access to this QBank.</p>
              )}
            </section>
          </div>
        )}

        {section === 'structure' && (
          <ClassificationManager
            user={user}
            qbankId={bankId}
            revision={collaboration.classificationRevisions[bankId] ?? 0}
            specialties={bankSpecialties}
            topics={bankTopics}
            questions={questions}
            onDirtyChange={noteStructureDirty}
            onRemoteConflict={(result) => confirmUpdate((current) => ({
              ...current,
              specialties: [...current.specialties.filter((item) => item.qbankId !== bankId), ...result.specialties],
              topics: [...current.topics.filter((item) => item.qbankId !== bankId), ...result.topics],
              classificationRevisions: { ...current.classificationRevisions, [bankId]: result.revision },
            }))}
            onSaved={(result) => confirmUpdate((current) => {
              const topicById = new Map(result.topics.map((item) => [item.id, item]));
              const specialtyById = new Map(result.specialties.map((item) => [item.id, item]));
              const assignmentByQuestion = new Map(result.assignments.map((item) => [item.questionId, item.topicId]));
              return {
                ...current,
                specialties: [...current.specialties.filter((item) => item.qbankId !== bankId), ...result.specialties],
                topics: [...current.topics.filter((item) => item.qbankId !== bankId), ...result.topics],
                classificationRevisions: { ...current.classificationRevisions, [bankId]: result.revision },
                approvedQuestions: current.approvedQuestions.map((question) => {
                  const topicId = assignmentByQuestion.get(question.id) ?? question.topicId;
                  const topic = topicId ? topicById.get(topicId) : undefined;
                  const specialty = topic ? specialtyById.get(topic.specialtyId) : undefined;
                  return topic && specialty ? { ...question, topicId: topic.id, topic: topic.name, specialtyId: specialty.id, specialty: specialty.name } : question;
                }),
              };
            })}
          />
        )}

        {section === 'questions' && (
          <>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row">
              <label className="relative flex-1">
                <Search className="absolute left-3 top-3.5 size-4 text-muted-foreground" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by Question ID, topic, or text" className="h-11 w-full rounded-xl border bg-card pl-10 pr-3 text-sm" />
              </label>
              <button onClick={() => (canAddQuestions ? openQuestion() : openUpgrade())} className={cn('q-button', canAddQuestions ? 'q-button-contribute' : 'border')}>
                {canAddQuestions ? <Plus className="size-4" /> : <LockKeyhole className="size-4" />}
                {canAddQuestions ? 'Add question manually' : 'Add questions · Full Access'}
              </button>
            </div>
            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <select value={specialtyFilter} onChange={(event) => { setSpecialtyFilter(event.target.value); setTopicFilter(''); }} className="h-11 rounded-xl border bg-card px-3 text-sm">
                <option value="">All specialties</option>
                {bankSpecialties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)} className="h-11 rounded-xl border bg-card px-3 text-sm">
                <option value="">All topics</option>
                {bankTopics.filter((item) => !specialtyFilter || item.specialtyId === specialtyFilter).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <select aria-label="Filter questions by source" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} className="h-11 min-w-0 rounded-xl border bg-card px-3 text-sm">
                <option value="">All sources</option>
                {sources.map(source => <option key={source.key} value={source.key || '__missing-source__'}>{source.name} ({source.count})</option>)}
              </select>
            </div>
            <div className="mb-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>{filteredQuestions.length} of {questions.length} questions</span>
              {(sourceFilter || specialtyFilter || topicFilter || search) && <button type="button" className="underline" onClick={() => { setSourceFilter(''); setSpecialtyFilter(''); setTopicFilter(''); setSearch(''); }}>Clear filters</button>}
            </div>
            {selectedQuestionIds.length > 0 && (
              <section className="mb-5 rounded-2xl border border-primary/30 bg-primary/5 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <strong>{selectedQuestionIds.length} selected</strong>
                  <button onClick={() => setSelectedQuestionIds([])} className="text-sm font-bold text-muted-foreground">Clear</button>
                </div>
                <ClassificationFields specialties={bankSpecialties} topics={bankTopics} specialty={bulkSpecialty} topic={bulkTopic} onChange={(value) => { setBulkSpecialty(value.specialty); setBulkTopic(value.topic); }} disabled={busy} />
                <button disabled={busy || !bulkSpecialty.trim() || !bulkTopic.trim()} onClick={() => void applyBulkClassification()} className="q-button mt-4 bg-primary text-primary-foreground">
                  {busy ? <RefreshCw className="size-4 animate-spin" /> : <Save className="size-4" />}{error ? 'Try again' : 'Apply to selected'}
                </button>
              </section>
            )}
            <section className="overflow-x-auto rounded-2xl bg-card ring-1 ring-border">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[36px_90px_1fr_150px_72px_48px] gap-3 border-b bg-muted/35 px-4 py-3 text-xs font-bold uppercase text-muted-foreground">
                  <input type="checkbox" aria-label="Select visible questions" checked={filteredQuestions.length > 0 && filteredQuestions.every((item) => selectedQuestionIds.includes(item.id))} onChange={(event) => setSelectedQuestionIds(event.target.checked ? [...new Set([...selectedQuestionIds, ...filteredQuestions.map((item) => item.id)])].slice(0, 500) : selectedQuestionIds.filter((id) => !filteredQuestions.some((item) => item.id === id)))} />
                  <span>Question ID</span>
                  <span>Question</span>
                  <span>Topic</span>
                  <span>Delete</span>
                  <span>Edit</span>
                </div>
                {filteredQuestions.length ? (
                  <div className="divide-y">
                    {filteredQuestions.map((question) => (
                      <div key={question.id} className="grid grid-cols-[36px_90px_1fr_150px_72px_48px] items-center gap-3 px-4 py-4">
                        <input type="checkbox" aria-label={`Select Question ID ${question.questionId}`} checked={selectedQuestionIds.includes(question.id)} onChange={(event) => setSelectedQuestionIds((current) => event.target.checked ? [...current, question.id].slice(0, 500) : current.filter((id) => id !== question.id))} />
                        <QuestionId value={question.questionId} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{question.stem}</p>
                          <span className="text-xs text-muted-foreground">
                            Revision {question.revision} · {question.images?.length ?? 0} images
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">Source: {readQuestionSource(question).sourceReference || 'Unspecified source'}</span>
                          {(question.writtenByName || question.reviewedByName) && (
                            <span className="block text-xs text-muted-foreground">
                              Written by {question.writtenByName ?? 'Qraft'} · Reviewed by {question.reviewedByName ?? 'Pending'}
                            </span>
                          )}
                        </div>
                        <span className="truncate text-sm text-muted-foreground">{question.specialty} / {question.topic}</span>
                        <button aria-label={`Delete Question ID ${question.questionId}`} className="q-button text-destructive" disabled={busy} onClick={async () => { if (!(await confirmAction({title:'Permanently delete this question?',description:'The question will be removed. Related tickets and history will remain detached under #deleted.',confirmLabel:'Delete permanently',tone:'destructive'}))) return; setBusy(true); setError(''); try { await api('/platform/question', { method: 'DELETE', body: JSON.stringify({id:question.questionId}) }); confirmUpdate(current=>({...current,approvedQuestions:current.approvedQuestions.filter(q=>q.id!==question.id),proposals:current.proposals.map(p=>p.questionId===question.id?{...p,questionId:'#deleted'}:p)})); setMessage('Question permanently deleted.'); } catch (e) { setError(e instanceof Error?e.message:'Unable to delete.'); } finally {setBusy(false);} }}>Delete</button>
                        <button onClick={() => openQuestion(question)} className="grid size-9 place-items-center rounded-lg border" aria-label={`Edit Question ID ${question.questionId}`}>
                          <Pencil className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-12 text-center text-sm text-muted-foreground">No questions match your search.</div>
                )}
              </div>
            </section>
          </>
        )}

        {section === 'import' && (
          <section className="min-w-0 rounded-2xl bg-card p-3 ring-1 ring-border sm:p-6">
            <h2 className="mb-4 text-lg font-bold">Import</h2>
            <QuestionImportReview uid={user.uid} bankId={bankId} adminImportPrivileges={user.role === 'super_admin'} onImported={result=>confirmUpdate(current=>({
              ...current,
              proposals:[...result.proposals,...current.proposals.filter(p=>!result.proposals.some(n=>n.id===p.id))],
              specialties:[...current.specialties,...result.specialties.filter(item=>!current.specialties.some(existing=>existing.id===item.id))],
              topics:[...current.topics,...result.topics.filter(item=>!current.topics.some(existing=>existing.id===item.id))],
              classificationRevisions: result.classificationRevision === undefined ? current.classificationRevisions : { ...current.classificationRevisions, [bankId]: result.classificationRevision },
            }))} />
          </section>
        )}
      </div>

      {editing && (
        <Dialog open onOpenChange={open => { if (!open && !busy && !explanationImagesBusy) setEditing(undefined); }}>
          <DialogContent showCloseButton={false} className="q-question-editor flex h-[min(860px,calc(100dvh-2rem))] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 sm:max-w-4xl">
            <form onSubmit={event => void saveQuestion(event)} className="flex min-h-0 flex-1 flex-col">
              <header className="flex shrink-0 items-start justify-between gap-4 border-b px-4 py-4 sm:px-6">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">{editing === 'new' ? 'New question' : `Question ID ${editing.questionId}`}</p>
                  <DialogTitle className="mt-1 text-xl font-bold leading-tight">{editing === 'new' ? 'Add question manually' : 'Edit question'}</DialogTitle>
                  <DialogDescription className="mt-1.5 truncate text-sm">{bankName} · {editing !== 'new' && user.role === 'super_admin' ? 'Changes are saved immediately.' : 'Submitted questions are reviewed before publishing.'}</DialogDescription>
                </div>
                <button type="button" disabled={busy || explanationImagesBusy} onClick={() => setEditing(undefined)} className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40" aria-label="Close question editor">
                  <X className="size-5" />
                </button>
              </header>

              <fieldset disabled={busy} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-muted/20 p-4 sm:p-6">
                <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <div className="min-w-0 space-y-5">
                    <section className="q-question-editor-section">
                      <label className="block">
                        <span className="mb-3 flex items-center justify-between gap-2 text-sm font-bold">Question text <span className="q-question-field-note">Required</span></span>
                        <textarea dir="auto" required rows={5} value={draft.stem} onChange={event => setDraft({ ...draft, stem: event.target.value })} placeholder="Write the complete question, including the details needed to answer it." className="q-question-control min-h-32 w-full resize-y" />
                      </label>
                    </section>

                    <section className="q-question-editor-section" aria-labelledby="question-options-heading">
                      <div className="mb-4">
                        <div className="flex items-center justify-between gap-3">
                          <h3 id="question-options-heading" className="text-sm font-bold">Answer options</h3>
                          <span className="q-question-field-note">{draft.options.length} / 10</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">Select the letter beside the correct answer.</p>
                      </div>
                      <div className="space-y-3">
                        {draft.options.map((option, index) => (
                          <div key={index} className={cn('q-question-option', draft.answer === index && 'q-question-option-correct')}>
                            <label className="q-question-answer-selector">
                              <input aria-label={`Mark option ${optionLabel(index)} as correct`} type="radio" name="correct-answer" checked={draft.answer === index} onChange={() => setDraft({ ...draft, answer: index })} className="peer sr-only" />
                              <span className="q-question-answer-letter peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary">{optionLabel(index)}</span>
                            </label>
                            <div className="min-w-0 flex-1">
                              <textarea dir="auto" aria-label={`Option ${optionLabel(index)}`} required rows={2} value={option} onChange={event => setDraft({ ...draft, options: draft.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} placeholder={`Answer choice ${optionLabel(index)}`} className="q-question-option-text w-full resize-y" />
                              {draft.answer === index && <span className="flex items-center gap-1.5 pb-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><Check className="size-3.5" />Correct answer</span>}
                            </div>
                            <button type="button" aria-label={`Remove option ${optionLabel(index)}`} disabled={draft.options.length <= 2} onClick={() => setDraft({ ...draft, options: draft.options.filter((_, itemIndex) => itemIndex !== index), answer: draft.answer === index ? 0 : draft.answer > index ? draft.answer - 1 : draft.answer })} className="q-question-remove-option">
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button type="button" disabled={draft.options.length >= 10} onClick={() => setDraft({ ...draft, options: [...draft.options, ''] })} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-dashed px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-40">
                        <Plus className="size-4" />Add option
                      </button>
                    </section>

                    <section className="q-question-editor-section">
                      <label className="block">
                        <span className="mb-3 flex items-center justify-between gap-2 text-sm font-bold">Explanation <span className="q-question-field-note">{editing === 'new' ? 'Required' : 'Optional'}</span></span>
                        <textarea dir="auto" required={editing === 'new'} rows={5} value={draft.explanation} onChange={event => setDraft({ ...draft, explanation: event.target.value })} placeholder="Explain why the selected answer is correct." className="q-question-control min-h-32 w-full resize-y" />
                        {editing !== 'new' && !draft.explanation.trim() && <p className="mt-2 text-xs leading-5 text-muted-foreground">Saving an empty explanation removes the existing explanation.</p>}
                      </label>
                      <ExplanationImageEditor key={`${bankId}:${editing === 'new' ? 'new' : editing?.id}`} uid={user.uid} qbankId={bankId} questionId={editing === 'new' ? 'new-question' : editing?.id ?? ''} images={draft.explanationImages} onChange={explanationImages => setDraft(current => ({ ...current, explanationImages }))} onBusyChange={setExplanationImagesBusy} disabled={busy} />
                    </section>
                  </div>

                  <div className="min-w-0 space-y-5">
                    <section className="q-question-editor-section">
                      <h3 className="mb-4 text-sm font-bold">Classification</h3>
                      <div className="q-question-classification"><ClassificationFields specialties={bankSpecialties} topics={bankTopics} specialty={draft.specialty} topic={draft.topic} onChange={classification => setDraft({ ...draft, ...classification })} disabled={busy} /></div>
                    </section>

                    <section className="q-question-editor-section space-y-4">
                      <div>
                        <h3 className="text-sm font-bold">Source</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">Use the same source name for questions from the same file.</p>
                      </div>
                      <label className="block">
                        <span className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold">File or lecture name <span className="q-question-field-note">Required</span></span>
                        <input required maxLength={240} aria-label="Source file name" dir="auto" value={draft.sourceFile} onChange={event => setDraft({ ...draft, sourceFile: event.target.value })} placeholder="e.g. Surgery lecture.pdf" className="q-question-control h-11 w-full" />
                      </label>
                      <label className="block">
                        <span className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold">Page or slide <span className="q-question-field-note">Optional</span></span>
                        <input aria-label="Source page" type="number" min={1} max={100000} step={1} value={draft.sourcePage} onChange={event => setDraft({ ...draft, sourcePage: event.target.value })} placeholder="Leave empty if unknown" className="q-question-control h-11 w-full" />
                      </label>
                    </section>

                    <section className="q-question-editor-section">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 className="text-sm font-bold">Question images</h3>
                        <span className="q-question-field-note">Optional</span>
                      </div>
                      <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 p-4 text-center transition-colors hover:border-primary hover:bg-primary/5 focus-within:outline-2 focus-within:outline-primary">
                        <ImagePlus className="size-5 text-primary" />
                        <span className="text-sm font-semibold">Add images</span>
                        <span className="text-xs text-muted-foreground">Up to 5 new images · 10 MB each</span>
                        <input aria-label="Add question images" type="file" accept="image/*" multiple className="sr-only" onChange={event => setImageFiles(Array.from(event.target.files ?? []).slice(0, 5))} />
                      </label>
                      {draft.images.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3">
                        {draft.images.map(image => <figure key={image.id} className="overflow-hidden rounded-xl border">
                          <img src={image.url} alt={image.caption || image.name} className="aspect-video w-full bg-muted/30 object-contain" />
                          <div className="flex items-center gap-1 p-2">
                            <input aria-label={`Caption for ${image.name}`} value={image.caption} onChange={event => setDraft({ ...draft, images: draft.images.map(item => item.id === image.id ? { ...item, caption: event.target.value } : item) })} placeholder="Caption" className="h-9 min-w-0 flex-1 rounded-lg border bg-card px-2 text-xs" />
                            <button type="button" aria-label={`Remove image ${image.name}`} onClick={() => setDraft({ ...draft, images: draft.images.filter(item => item.id !== image.id) })} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-4" /></button>
                          </div>
                        </figure>)}
                      </div>}
                      {imageFiles.length > 0 && <div className="mt-3 space-y-2">
                        <p className="text-xs font-semibold text-primary">{imageFiles.length} new image{imageFiles.length === 1 ? '' : 's'} ready to upload</p>
                        {imageFiles.map((file, index) => <div key={`${file.name}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/50 ps-3 text-xs">
                          <span className="min-w-0 flex-1 truncate">{file.name}</span>
                          <button type="button" aria-label={`Remove pending image ${file.name}`} onClick={() => setImageFiles(current => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-destructive"><X className="size-4" /></button>
                        </div>)}
                      </div>}
                    </section>
                  </div>
                </div>
              </fieldset>

              <footer className="shrink-0 border-t bg-card px-4 py-4 sm:px-6">
                {error && <p role="alert" className="mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">Fields marked Required must be completed.</p>
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:flex">
                    <button type="button" disabled={busy || explanationImagesBusy} onClick={() => setEditing(undefined)} className="q-button q-button-secondary">Cancel</button>
                    <button type="submit" disabled={busy || explanationImagesBusy} className="q-button q-button-contribute">
                      {busy ? <RefreshCw className="size-4 animate-spin" /> : <Save className="size-4" />}
                      {busy ? 'Saving…' : editing !== 'new' && user.role === 'super_admin' ? 'Save changes now' : 'Submit for review'}
                    </button>
                  </div>
                </div>
              </footer>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {deleteOpen && canManageAccess && (
        <div className="q-safe-overlay fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-bank-title" className="q-confirm-dialog w-full max-w-md rounded-2xl bg-card p-5 shadow-2xl sm:p-6">
            <h2 id="delete-bank-title" className="text-xl font-bold">
              Delete {bank.name}?
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">This action cannot be undone. Questions are permanently deleted. Their display IDs may be reused; historical tickets remain detached as #deleted.</p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <button onClick={() => setDeleteOpen(false)} className="h-11 rounded-xl border text-sm font-bold">
                Cancel
              </button>
              <button disabled={busy} onClick={() => void deleteBank()} className="h-11 rounded-xl bg-red-600 text-sm font-bold text-white disabled:opacity-50">
                Delete permanently
              </button>
            </div>
          </section>
        </div>
      )}
      {confirmationDialog}
    </main>
  );
}
