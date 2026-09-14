'use client';

import { ArrowDown, ArrowUp, Check, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { deleteClassificationDraft, loadClassificationDraft, saveClassificationDraft } from '@/lib/application-services';
import type { AppUser, QBankSpecialty, QBankTopic, Question } from '@/lib/medguard-types';
import { useConfirmationDialog } from '@/components/ui/confirmation-dialog';

type Assignment = { questionId: string; topicId: string };
type ClassificationDeletePlan = {
  kind: 'specialty' | 'topic';
  id: string;
  mode: 'move' | 'unclassified';
  destinationId: string;
};
type SaveResult = {
  revision: number;
  specialties: QBankSpecialty[];
  topics: QBankTopic[];
  assignments: Array<Assignment & { specialtyId: string; specialty: string; topic: string }>;
};

const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const replaceAssignments = (current: Assignment[], next: Assignment[]) => {
  const merged = new Map(current.map((item) => [item.questionId, item]));
  next.forEach((item) => merged.set(item.questionId, item));
  return [...merged.values()];
};

export function ClassificationManager({
  user,
  qbankId,
  revision,
  specialties: sourceSpecialties,
  topics: sourceTopics,
  questions,
  onSaved,
  onRemoteConflict,
  onDirtyChange,
}: {
  user: AppUser;
  qbankId: string;
  revision: number;
  specialties: QBankSpecialty[];
  topics: QBankTopic[];
  questions: Question[];
  onSaved: (result: SaveResult) => void;
  onRemoteConflict: (result: Pick<SaveResult, 'revision' | 'specialties' | 'topics'>) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [confirmAction, confirmationDialog] = useConfirmationDialog();
  const [specialties, setSpecialties] = useState(sourceSpecialties);
  const [topics, setTopics] = useState(sourceTopics);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [deletePlan, setDeletePlan] =
    useState<ClassificationDeletePlan | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const hydrated = useRef(false);
  const baseline = JSON.stringify({ specialties: sourceSpecialties, topics: sourceTopics, assignments: [] });
  const snapshot = JSON.stringify({ specialties, topics, assignments });
  const dirty = snapshot !== baseline;
  const assignedTopicByQuestion = new Map(assignments.map((item) => [item.questionId, item.topicId]));
  const questionTopicId = (question: Question) => assignedTopicByQuestion.get(question.id) ?? question.topicId;

  useEffect(() => {
    let active = true;
    void loadClassificationDraft(user.uid, qbankId).then((draft) => {
      if (!active || !draft) { hydrated.current = true; return; }
      setSpecialties(draft.specialties);
      setTopics(draft.topics);
      setAssignments(draft.assignments);
      setBaseRevision(draft.baseRevision);
      setOperationId(draft.operationId);
      setMessage('Your unsaved classification draft was restored from this device.');
      hydrated.current = true;
    });
    return () => { active = false; };
  }, [qbankId, user.uid]);

  useEffect(() => {
    if (!hydrated.current || !dirty) return;
    const timer = window.setTimeout(() => {
      void saveClassificationDraft(user.uid, {
        qbankId, baseRevision, operationId, specialties, topics, assignments,
        updatedAt: new Date().toISOString(),
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [assignments, baseRevision, dirty, operationId, qbankId, specialties, topics, user.uid]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!hydrated.current) return;
    const timer = window.setTimeout(() => {
    if (!dirty) {
      setSpecialties(sourceSpecialties);
      setTopics(sourceTopics);
      setBaseRevision(revision);
    } else if (revision !== baseRevision) {
      setError('A newer server structure is available. Your local draft is protected; compare it, then retry or discard it.');
    }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [baseRevision, dirty, revision, sourceSpecialties, sourceTopics]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  function addSpecialty() {
    const name = window.prompt('Specialty name')?.trim();
    if (!name) return;
    if (specialties.some((item) => normalized(item.name) === normalized(name))) {
      setError('A specialty with this name already exists.'); return;
    }
    const now = new Date().toISOString();
    setSpecialties((current) => [...current, { id: crypto.randomUUID(), qbankId, name, order: current.length, createdAt: now, updatedAt: now }]);
    setError('');
  }

  function addTopic(specialtyId: string) {
    const name = window.prompt('Topic name')?.trim();
    if (!name) return;
    if (topics.some((item) => item.specialtyId === specialtyId && normalized(item.name) === normalized(name))) {
      setError('A topic with this name already exists in that specialty.'); return;
    }
    const now = new Date().toISOString();
    setTopics((current) => [...current, { id: crypto.randomUUID(), qbankId, specialtyId, name, order: current.length, createdAt: now, updatedAt: now }]);
    setError('');
  }

  function renameSpecialty(item: QBankSpecialty) {
    const name = window.prompt('New specialty name', item.name)?.trim();
    if (!name || name === item.name) return;
    if (specialties.some((other) => other.id !== item.id && normalized(other.name) === normalized(name))) {
      setError('That specialty name already exists. Choose a different name.'); return;
    }
    setSpecialties((current) => current.map((other) => other.id === item.id ? { ...other, name } : other));
  }

  async function renameTopic(item: QBankTopic) {
    const name = window.prompt('New topic name', item.name)?.trim();
    if (!name || name === item.name) return;
    const duplicate = topics.find((other) => other.id !== item.id && other.specialtyId === item.specialtyId && normalized(other.name) === normalized(name));
    if (duplicate) {
      if (await confirmAction({
        title: 'Merge matching topics?',
        description: 'A topic with this name already exists here. Merging will move the assigned questions into the existing topic.',
        confirmLabel: 'Merge topics',
        tone: 'warning',
      })) {
        setAssignments((current) => replaceAssignments(current, questions.filter((question) => questionTopicId(question) === item.id).map((question) => ({ questionId: question.id, topicId: duplicate.id }))));
        setTopics((current) => current.filter((other) => other.id !== item.id));
      } else setError('The topics were not merged. Rename one of them before saving.');
      return;
    }
    setTopics((current) => current.map((other) => other.id === item.id ? { ...other, name } : other));
  }

  function ensureUnclassified() {
    const now = new Date().toISOString();
    let specialty = specialties.find((item) => normalized(item.name) === 'unclassified');
    let nextSpecialties = specialties;
    if (!specialty) {
      specialty = { id: crypto.randomUUID(), qbankId, name: 'Unclassified', order: specialties.length, createdAt: now, updatedAt: now };
      nextSpecialties = [...specialties, specialty];
      setSpecialties(nextSpecialties);
    }
    let topic = topics.find((item) => item.specialtyId === specialty!.id && normalized(item.name) === 'unclassified');
    if (!topic) {
      topic = { id: crypto.randomUUID(), qbankId, specialtyId: specialty.id, name: 'Unclassified', order: topics.length, createdAt: now, updatedAt: now };
      setTopics((current) => [...current, topic!]);
    }
    return topic;
  }

  function removeTopic(item: QBankTopic) {
    const affected = questions.filter((question) => questionTopicId(question) === item.id);
    const firstDestination = topics.find((other) => other.id !== item.id);
    const parent = specialties.find((specialty) => specialty.id === item.specialtyId);
    const isUnclassified = normalized(item.name) === 'unclassified' && normalized(parent?.name ?? '') === 'unclassified';
    setDeletePlan({
      kind: 'topic',
      id: item.id,
      mode: isUnclassified || (affected.length && firstDestination) ? 'move' : 'unclassified',
      destinationId: firstDestination?.id ?? '',
    });
  }

  function removeSpecialty(item: QBankSpecialty) {
    const children = topics.filter((topic) => topic.specialtyId === item.id);
    const firstDestination = specialties.find((other) => other.id !== item.id);
    setDeletePlan({
      kind: 'specialty',
      id: item.id,
      mode: normalized(item.name) === 'unclassified' || (children.length && firstDestination) ? 'move' : 'unclassified',
      destinationId: firstDestination?.id ?? '',
    });
  }

  function confirmClassificationDelete() {
    if (!deletePlan) return;
    if (deletePlan.kind === 'topic') {
      const item = topics.find((topic) => topic.id === deletePlan.id);
      if (!item) return setDeletePlan(null);
      const affected = questions.filter((question) => questionTopicId(question) === item.id);
      if (affected.length) {
        const destination =
          deletePlan.mode === 'unclassified'
            ? ensureUnclassified()
            : topics.find((topic) => topic.id === deletePlan.destinationId);
        if (!destination || destination.id === item.id) {
          setError('Choose an existing destination topic.');
          return;
        }
        setAssignments((current) =>
          replaceAssignments(
            current,
            affected.map((question) => ({
              questionId: question.id,
              topicId: destination.id,
            })),
          ),
        );
      }
      setTopics((current) => current.filter((other) => other.id !== item.id));
      setDeletePlan(null);
      return;
    }

    const item = specialties.find((specialty) => specialty.id === deletePlan.id);
    if (!item) return setDeletePlan(null);
    const children = topics.filter((topic) => topic.specialtyId === item.id);
    if (!children.length) {
      setSpecialties((current) => current.filter((other) => other.id !== item.id));
      setDeletePlan(null);
      return;
    }
    if (deletePlan.mode === 'unclassified') {
      const destination = ensureUnclassified();
      const affected = questions.filter((question) => children.some((topic) => topic.id === questionTopicId(question)));
      setAssignments((current) => replaceAssignments(current, affected.map((question) => ({ questionId: question.id, topicId: destination.id }))));
      setTopics((current) => current.filter((topic) => topic.specialtyId !== item.id));
      setSpecialties((current) => current.filter((other) => other.id !== item.id));
      setDeletePlan(null);
      return;
    }
    const destination = specialties.find((other) => other.id === deletePlan.destinationId && other.id !== item.id);
    if (!destination) { setError('Choose an existing destination specialty.'); return; }
    const collisions = children.flatMap((child) => topics.filter((candidate) => candidate.specialtyId === destination.id && normalized(candidate.name) === normalized(child.name)).map((target) => ({ child, target })));
    for (const collision of collisions) {
      const affected = questions.filter((question) => questionTopicId(question) === collision.child.id);
      setAssignments((current) => replaceAssignments(current, affected.map((question) => ({ questionId: question.id, topicId: collision.target.id }))));
    }
    const mergedIds = new Set(collisions.map((item) => item.child.id));
    setTopics((current) => current.filter((topic) => !mergedIds.has(topic.id)).map((topic) => topic.specialtyId === item.id ? { ...topic, specialtyId: destination.id } : topic));
    setSpecialties((current) => current.filter((other) => other.id !== item.id));
    setDeletePlan(null);
  }

  function move<T>(values: T[], index: number, offset: number, set: (value: T[]) => void) {
    const target = index + offset;
    if (target < 0 || target >= values.length) return;
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    set(next);
  }

  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<SaveResult>('/platform/classification', {
        method: 'PUT',
        body: JSON.stringify({ qbankId, operationId, baseRevision, specialties, topics, assignments }),
      });
      await deleteClassificationDraft(user.uid, qbankId);
      setSpecialties(result.specialties ?? specialties);
      setTopics(result.topics ?? topics);
      setAssignments([]);
      setBaseRevision(result.revision);
      setOperationId(crypto.randomUUID());
      onSaved({ ...result, specialties: result.specialties ?? specialties, topics: result.topics ?? topics, assignments: result.assignments ?? [] });
      setMessage('Classification structure saved for everyone using this QBank.');
    } catch (caught) {
      if (caught instanceof ApiError && caught.payload.code === 'CLASSIFICATION_CONFLICT') {
        const remoteSpecialties = caught.payload.specialties;
        const remoteTopics = caught.payload.topics;
        const remoteRevision = caught.payload.revision;
        if (Array.isArray(remoteSpecialties) && Array.isArray(remoteTopics) && typeof remoteRevision === 'number')
          onRemoteConflict({ revision: remoteRevision, specialties: remoteSpecialties as QBankSpecialty[], topics: remoteTopics as QBankTopic[] });
      }
      setError(`${caught instanceof Error ? caught.message : 'Unable to save.'} Your draft is still available. Choose Try again after resolving the issue.`);
    } finally { setBusy(false); }
  }

  async function discard() {
    if (!(await confirmAction({
      title: 'Discard classification changes?',
      description: 'All unsaved specialty, topic, and question assignment changes on this device will be removed.',
      confirmLabel: 'Discard changes',
      tone: 'destructive',
    }))) return;
    setSpecialties(sourceSpecialties); setTopics(sourceTopics); setAssignments([]);
    setBaseRevision(revision); setOperationId(crypto.randomUUID()); setError(''); setMessage('Draft discarded.');
    void deleteClassificationDraft(user.uid, qbankId);
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <h2 className="text-lg font-bold">Specialties & Topics</h2>
          <p className="mt-1 text-sm text-muted-foreground">Edit the shared structure as one draft. No request is sent until Save structure.</p>
        </div>
        <button type="button" onClick={addSpecialty} className="q-button border"><Plus className="size-4" /> Add specialty</button>
        <button type="button" disabled={!dirty || busy} onClick={() => void discard()} className="q-button border"><X className="size-4" /> Discard</button>
        <button type="button" disabled={!dirty || busy} onClick={() => void save()} className="q-button bg-primary text-primary-foreground">{busy ? <RefreshCw className="size-4 animate-spin" /> : <Save className="size-4" />}{error ? 'Try again' : 'Save structure'}</button>
      </div>
      {message && <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Check className="size-4" />{message}</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {!specialties.length && <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">No classifications yet. Add a specialty, then add its topics.</div>}
      {specialties.map((specialty, specialtyIndex) => {
        const children = topics.filter((topic) => topic.specialtyId === specialty.id);
        const count = questions.filter((question) => children.some((topic) => topic.id === questionTopicId(question))).length;
        return <article key={specialty.id} className="rounded-2xl border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="min-w-0 flex-1 truncate">{specialty.name}</strong>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{children.length} topics · {count} questions</span>
            <button aria-label="Move specialty up" onClick={() => move(specialties, specialtyIndex, -1, setSpecialties)} className="grid size-9 place-items-center rounded-lg border"><ArrowUp className="size-4" /></button>
            <button aria-label="Move specialty down" onClick={() => move(specialties, specialtyIndex, 1, setSpecialties)} className="grid size-9 place-items-center rounded-lg border"><ArrowDown className="size-4" /></button>
            <button onClick={() => renameSpecialty(specialty)} className="q-button border">Rename</button>
            <button onClick={() => removeSpecialty(specialty)} className="grid size-9 place-items-center rounded-lg border text-destructive" aria-label={`Delete ${specialty.name}`}><Trash2 className="size-4" /></button>
          </div>
          <div className="mt-4 divide-y rounded-xl border">
            {children.map((topic, topicIndex) => <div key={topic.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{topic.name}</span>
              <span className="text-xs text-muted-foreground">{questions.filter((question) => questionTopicId(question) === topic.id).length} questions</span>
              <select aria-label={`Move ${topic.name} to another specialty`} value={topic.specialtyId} onChange={async (event) => {
                const duplicate = topics.find((other) => other.id !== topic.id && other.specialtyId === event.target.value && normalized(other.name) === normalized(topic.name));
                if (duplicate) {
                  if (!(await confirmAction({
                    title: 'Merge into the matching topic?',
                    description: 'A topic with the same name exists in the destination. Its questions will be moved into that topic.',
                    confirmLabel: 'Merge topic',
                    tone: 'warning',
                  }))) return;
                  const affected = questions.filter((question) => questionTopicId(question) === topic.id);
                  setAssignments((current) => replaceAssignments(current, affected.map((question) => ({ questionId: question.id, topicId: duplicate.id }))));
                  setTopics((current) => current.filter((other) => other.id !== topic.id));
                } else setTopics((current) => current.map((other) => other.id === topic.id ? { ...other, specialtyId: event.target.value } : other));
              }} className="h-9 max-w-48 rounded-lg border bg-card px-2 text-xs">{specialties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              <button aria-label="Move topic up" onClick={() => move(children, topicIndex, -1, (next) => setTopics([...topics.filter((item) => item.specialtyId !== specialty.id), ...next]))} className="grid size-8 place-items-center rounded-lg border"><ArrowUp className="size-3.5" /></button>
              <button aria-label="Move topic down" onClick={() => move(children, topicIndex, 1, (next) => setTopics([...topics.filter((item) => item.specialtyId !== specialty.id), ...next]))} className="grid size-8 place-items-center rounded-lg border"><ArrowDown className="size-3.5" /></button>
              <button onClick={() => void renameTopic(topic)} className="text-xs font-bold text-primary">Rename</button>
              <button onClick={() => removeTopic(topic)} className="text-destructive" aria-label={`Delete ${topic.name}`}><Trash2 className="size-4" /></button>
            </div>)}
            <button onClick={() => addTopic(specialty.id)} className="flex w-full items-center gap-2 p-3 text-sm font-bold text-primary"><Plus className="size-4" /> Add topic</button>
          </div>
        </article>;
      })}
      {deletePlan && (() => {
        const topic = deletePlan.kind === 'topic' ? topics.find((item) => item.id === deletePlan.id) : undefined;
        const specialty = deletePlan.kind === 'specialty' ? specialties.find((item) => item.id === deletePlan.id) : undefined;
        const children = specialty ? topics.filter((item) => item.specialtyId === specialty.id) : [];
        const affectedCount = topic
          ? questions.filter((question) => questionTopicId(question) === topic.id).length
          : questions.filter((question) => children.some((item) => item.id === questionTopicId(question))).length;
        const destinations = deletePlan.kind === 'topic'
          ? topics.filter((item) => item.id !== deletePlan.id)
          : specialties.filter((item) => item.id !== deletePlan.id);
        const collisions = specialty && deletePlan.mode === 'move'
          ? children.filter((child) => topics.some((candidate) => candidate.specialtyId === deletePlan.destinationId && normalized(candidate.name) === normalized(child.name))).length
          : 0;
        const label = topic?.name ?? specialty?.name ?? 'classification';
        const parent = topic ? specialties.find((item) => item.id === topic.specialtyId) : undefined;
        const canUseUnclassified = specialty
          ? normalized(specialty.name) !== 'unclassified'
          : !(topic && normalized(topic.name) === 'unclassified' && normalized(parent?.name ?? '') === 'unclassified');
        return (
          <div className="q-safe-overlay fixed inset-0 z-[90] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
            <section role="alertdialog" aria-modal="true" aria-labelledby="delete-classification-title" aria-describedby="delete-classification-description" className="q-confirm-dialog q-confirm-dialog-wide w-full max-w-lg rounded-2xl bg-card p-5 shadow-2xl sm:p-6">
              <h2 id="delete-classification-title" className="text-lg font-bold">Delete “{label}”?</h2>
              <p id="delete-classification-description" className="mt-2 text-sm leading-6 text-muted-foreground">
                {affectedCount
                  ? `${affectedCount} assigned question${affectedCount === 1 ? '' : 's'} must be kept in another classification.`
                  : 'This classification is empty and can be safely removed.'}
              </p>
              {affectedCount > 0 && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => setDeletePlan((current) => current ? { ...current, mode: 'move' } : current)} className={`rounded-xl border p-3 text-left text-sm ${deletePlan.mode === 'move' ? 'border-primary bg-primary/5' : ''}`}>
                    <strong>Move contents</strong>
                    <span className="mt-1 block text-xs text-muted-foreground">Choose an existing destination.</span>
                  </button>
                  <button type="button" disabled={!canUseUnclassified} onClick={() => setDeletePlan((current) => current ? { ...current, mode: 'unclassified' } : current)} className={`rounded-xl border p-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${deletePlan.mode === 'unclassified' ? 'border-primary bg-primary/5' : ''}`}>
                    <strong>Move to Unclassified</strong>
                    <span className="mt-1 block text-xs text-muted-foreground">Keep questions without a named category.</span>
                  </button>
                </div>
              )}
              {affectedCount > 0 && deletePlan.mode === 'move' && (
                <label className="mt-4 block text-sm font-semibold">
                  Destination
                  <select value={deletePlan.destinationId} onChange={(event) => setDeletePlan((current) => current ? { ...current, destinationId: event.target.value } : current)} className="mt-1 h-11 w-full rounded-xl border bg-background px-3">
                    <option value="">Choose a destination</option>
                    {destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
              )}
              {collisions > 0 && (
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
                  {collisions} matching topic{collisions === 1 ? '' : 's'} will be merged in the destination.
                </p>
              )}
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => setDeletePlan(null)} className="q-button q-button-secondary w-full">Cancel</button>
                <button type="button" onClick={confirmClassificationDelete} disabled={affectedCount > 0 && ((deletePlan.mode === 'move' && !deletePlan.destinationId) || (deletePlan.mode === 'unclassified' && !canUseUnclassified))} className="q-button w-full bg-red-600 text-white hover:bg-red-700">Delete and keep contents</button>
              </div>
            </section>
          </div>
        );
      })()}
      {confirmationDialog}
    </section>
  );
}
