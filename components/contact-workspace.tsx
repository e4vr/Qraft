'use client';
/* oxlint-disable next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import { MessageSquareText, ArrowRight } from 'lucide-react';
import { api, ApiError, invalidateApiResources } from '@/lib/api-client';
import { subscribeLive } from '@/lib/realtime-client';
import { QuestionId } from '@/components/question-tools';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
type Ticket = {
  id: string;
  title: string;
  status: string;
  user_id: string;
  email: string;
  name: string;
  question_id: string | null;
  created_at: string;
  updated_at: string;
};
type Message = {
  id: string;
  name: string;
  role: string;
  body: string;
  attachment: string | null;
  created_at: string;
};
export function ContactWorkspace({ admin = false }: { admin?: boolean }) {
  const [startedFor, setStartedFor] = useState<boolean | null>(null);
  if (startedFor === admin) return <ActiveContactWorkspace key={String(admin)} admin={admin} />;
  return (
    <section className="mx-auto w-full max-w-5xl p-4 sm:p-7">
      <div className="rounded-2xl border bg-card p-5 sm:p-8">
        <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><MessageSquareText aria-hidden="true" className="size-6" /></span>
        <h1 className="text-xl font-bold sm:text-2xl">{admin ? 'Contact Tickets' : 'Contact Us'}</h1>
        <div className="mt-3 space-y-1 text-sm leading-7 text-muted-foreground">
          <p>{admin ? 'Review technical, account and question issues in one place.' : 'Report a technical, account or question issue.'}</p>
          <p>{admin ? 'Read the details, reply and update ticket statuses.' : 'Track your tickets and administrator replies privately.'}</p>
        </div>
        <button type="button" onClick={() => setStartedFor(admin)} className="q-button q-button-primary mt-6 w-full whitespace-normal sm:w-auto">
          {admin ? 'View tickets' : 'Open support'}<ArrowRight aria-hidden="true" className="size-4" />
        </button>
      </div>
    </section>
  );
}

function ActiveContactWorkspace({ admin }: { admin: boolean }) {
  const [tickets, setTickets] = useState<Ticket[]>([]),
    [selected, setSelected] = useState<Ticket>(),
    [messages, setMessages] = useState<Message[]>([]),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState(''),
    [offset, setOffset] = useState(0),
    [messageOffset, setMessageOffset] = useState(0),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [question, setQuestion] = useState(''),
    [confirmDelete, setConfirmDelete] = useState(false),
    [deleting, setDeleting] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const mutationInFlight = useRef(false);
  const drafts = useRef(new Map<string, { title: string; body: string; question: string; requestId: string }>());
  const selectedId = selected?.id;
  function openTicket(ticket?: Ticket) {
    if (mutationInFlight.current) return;
    drafts.current.set(selectedId ?? '', { title, body, question, requestId });
    const draft = drafts.current.get(ticket?.id ?? '');
    setTitle(draft?.title ?? ''); setBody(draft?.body ?? ''); setQuestion(draft?.question ?? '');
    setRequestId(draft?.requestId ?? crypto.randomUUID());
    setSelected(ticket); setMessages([]); setMessageOffset(0);
    setError(''); setNotice(''); setLoadError(''); setLoading(true);
  }
  useEffect(() => subscribeLive(() => setRevision(r => r + 1), ['contact']), []);
  useEffect(() => {
    if (busy || deleting) return;
    let live = true;
    const timer = setTimeout(() => {
      setLoading(true);
      const path = selectedId
        ? `id=${selectedId}&offset=${messageOffset}`
        : `search=${encodeURIComponent(search)}&status=${filter}&offset=${offset}`;
      api<{ tickets?: Ticket[]; messages?: Message[]; ticket?: Ticket }>(
        `/contact?${path}`,
      )
        .then((r) => {
          if (!live || mutationInFlight.current) return;
          setLoadError('');
          if (r.tickets) setTickets(r.tickets);
          if (r.messages) setMessages(r.messages);
          if (r.ticket) setSelected(current => current && current.id === r.ticket?.id && current.status !== r.ticket.status ? { ...current, status: r.ticket.status } : current);
        })
        .catch((e) => {
          if (!live || mutationInFlight.current) return;
          if (selectedId && e instanceof ApiError && e.status === 404) {
            setSelected(undefined); setMessages([]); setMessageOffset(0);
            setNotice('This ticket is no longer available.');
          } else setLoadError(e instanceof Error ? e.message : 'Unable to load tickets. Please try again.');
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [selectedId, search, filter, offset, messageOffset, revision, busy, deleting]);
  async function send() {
    if (mutationInFlight.current || !body.trim() || (!selected && !title.trim())) return;
    mutationInFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ ticket: Ticket; message: Message }>('/contact', {
        method: 'POST',
        body: JSON.stringify({
          id: selected?.id,
          title,
          body,
          questionId: question,
          requestId,
        }),
      });
      if (!result.ticket || !result.message) throw new Error('The server did not confirm your message. Your draft is preserved; please try again.');
      // A replay can be the first acknowledgement this tab receives.
      invalidateApiResources(['contact']);
      setBody('');
      setTitle('');
      setQuestion('');
      setRequestId(crypto.randomUUID());
      setNotice('Message sent successfully.');
      if (selected) {
        setSelected({ ...selected, ...result.ticket });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Unable to send. Your draft is preserved.',
      );
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }
  async function status(value: string) {
    if (!selected || value === selected.status || mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setError(''); setNotice('');
    try {
      const result = await api<{ ticket: Ticket }>('/contact', {
        method: 'POST',
        body: JSON.stringify({
          id: selected?.id,
          operation: 'status',
          status: value,
        }),
      });
      const updatedTicket = { ...selected, ...result.ticket };
      setSelected(updatedTicket);
      setTickets((current) => current.map((item) => item.id === updatedTicket.id ? { ...item, ...updatedTicket } : item));
      setNotice('Status updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update status.');
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }
  async function deleteTicket() {
    if (!selected || mutationInFlight.current) return;
    mutationInFlight.current = true;
    setDeleting(true);
    setError('');
    setNotice('');
    try {
      await api('/contact', { method: 'DELETE', body: JSON.stringify({ id: selected.id }) });
      setTickets((items) => items.filter((t) => t.id !== selected.id));
      setSelected(undefined);
      setMessages([]);
      setMessageOffset(0);
      setOffset(0);
      setBody('');
      setRequestId(crypto.randomUUID());
      setConfirmDelete(false);
      drafts.current.delete(selected.id);
      const draft = drafts.current.get('');
      setTitle(draft?.title ?? ''); setBody(draft?.body ?? ''); setQuestion(draft?.question ?? '');
      setRequestId(draft?.requestId ?? crypto.randomUUID());
      setNotice('Ticket deleted.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to delete ticket.');
    } finally {
      mutationInFlight.current = false;
      setDeleting(false);
    }
  }
  const input = 'w-full min-w-0 rounded-xl border bg-background px-3 py-3';
  return (
    <section className="mx-auto max-w-5xl space-y-5 p-4 sm:p-7">
      <h1 className="text-2xl font-bold">
        {admin ? 'Contact Tickets' : 'Contact Us'}
      </h1>
      <p className="text-sm text-muted-foreground">
        Report a technical, account or question issue. Replies remain private
        between you and the Superadmin.
      </p>
      {(error || loadError) && !confirmDelete && (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 p-3 text-destructive"
        >
          {error || loadError}
        </p>
      )}
      {notice && !error && !loadError && <output className="text-emerald-700 dark:text-emerald-300">{notice}</output>}
      {loadError && <button type="button" className="q-button border" disabled={loading || busy || deleting} onClick={() => setRevision(value => value + 1)}>Try again</button>}
      <AlertDialog open={confirmDelete} onOpenChange={(open) => { if (!deleting) setConfirmDelete(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ticket?</AlertDialogTitle>
            <AlertDialogDescription>This permanently deletes this ticket and all its replies and attachments. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <button className="q-button min-h-11 bg-destructive text-white" disabled={deleting} onClick={() => void deleteTicket()}>{deleting ? 'Deleting…' : 'Delete ticket'}</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {selected ? (
        <>
          <button
            className="q-button border"
            disabled={busy || deleting}
            onClick={() => openTicket()}
          >
            Back to tickets
          </button>
          <button className="q-button min-h-11 border text-destructive" disabled={busy || deleting} onClick={() => { setError(''); setConfirmDelete(true); }}>Delete ticket</button>
          <article className="rounded-2xl border bg-card p-4 sm:p-6">
            <h2 className="break-words text-xl font-bold">{selected.title}</h2>
            <p className="break-all text-xs text-muted-foreground">
              Ticket ID: {selected.id}
            </p>
            <p className="mt-2 text-sm">
              {selected.name} · {selected.email}
            </p>
            <p className="text-sm">
              Created: {new Date(selected.created_at).toLocaleString()}
            </p>
            {selected.question_id && (
              <QuestionId value={selected.question_id} />
            )}
            <p className="mt-3 font-semibold">
              {selected.status.replaceAll('_', ' ')}
            </p>
            {admin && (
              <label className="mt-3 block">
                Status
                <select
                  className={input}
                  disabled={busy || loading || deleting}
                  value={selected.status}
                  onChange={(e) => void status(e.target.value)}
                >
                  {['open', 'in_progress', 'resolved', 'closed'].map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">
                  In Progress allows the user to reply with clarification.
                </span>
              </label>
            )}
            <div className="mt-5 space-y-4">
              {messages.slice(0, 50).map((m) => (
                <div
                  key={m.id}
                  className={`rounded-xl border p-4 ${m.role === 'super_admin' ? 'bg-primary/5' : 'bg-muted/30'}`}
                >
                  <p className="text-sm font-bold">
                    {m.name} · {new Date(m.created_at).toLocaleString()}
                  </p>
                  <p
                    dir="auto"
                    className="mt-2 whitespace-pre-wrap break-words leading-7"
                  >
                    {m.body}
                  </p>
                  {m.attachment && (
                    <a href={m.attachment} target="_blank" rel="noreferrer">
                      <img
                        src={m.attachment}
                        alt="Ticket attachment"
                        className="mt-3 max-h-80 max-w-full rounded-lg object-contain"
                      />
                    </a>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="q-button border"
                disabled={messageOffset === 0 || busy || loading || deleting}
                onClick={() =>
                  setMessageOffset(Math.max(0, messageOffset - 50))
                }
              >
                Previous messages
              </button>
              <button
                className="q-button border"
                disabled={messages.length <= 50 || busy || loading || deleting}
                onClick={() => setMessageOffset(messageOffset + 50)}
              >
                Next messages
              </button>
            </div>
          </article>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className={input}
              placeholder="Search tickets or Question ID"
              aria-label="Search tickets or Question ID"
              disabled={busy || deleting}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
            <select
              className={input}
              aria-label="Ticket status"
              disabled={busy || deleting}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setOffset(0);
              }}
            >
              {['', 'open', 'in_progress', 'resolved', 'closed'].map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll('_', ' ') || 'All statuses'}
                </option>
              ))}
            </select>
          </div>
          {tickets.slice(0, 50).map((t) => (
            <button
              key={t.id}
              disabled={busy || deleting}
              onClick={() => openTicket(t)}
              className="block w-full rounded-xl border bg-card p-4 text-start"
            >
              <strong className="break-words">{t.title}</strong>
              <span className="mt-1 block text-sm text-muted-foreground">
                {t.status.replaceAll('_', ' ')} ·{' '}
                {new Date(t.updated_at).toLocaleDateString()}{' '}
                {t.question_id ? `· #${t.question_id}` : ''}
              </span>
              <span className="block break-all text-xs text-muted-foreground">
                {t.id}
              </span>
            </button>
          ))}
          {!loading && !loadError && tickets.length === 0 && <p className="text-sm text-muted-foreground">{search || filter ? 'No tickets match your filters.' : 'No tickets yet.'}</p>}
          <div className="flex gap-2">
            <button
              className="q-button border"
              disabled={!offset || busy}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous
            </button>
            <button
              className="q-button border"
              disabled={tickets.length <= 50 || busy || loading || deleting}
              onClick={() => setOffset(offset + 50)}
            >
              Next
            </button>
          </div>
        </>
      )}
      {(!admin && !selected) ||
      (selected && (admin || selected.status === 'in_progress')) ? (
        <form
          className="space-y-3 rounded-2xl border bg-card p-4 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <h2 className="font-bold">
            {selected ? 'Reply' : 'Create a ticket'}
          </h2>
          {!selected && (
            <>
              <label className="block">
                Title
                <input
                  required
                  maxLength={160}
                  disabled={busy || deleting}
                  className={input}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="block">
                Question ID (optional)
                <input
                  className={input}
                  disabled={busy || deleting}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="#00125"
                />
              </label>
            </>
          )}
          <label className="block">
            {selected ? 'Reply' : 'Describe the problem'}
            <textarea
              required
              maxLength={10000}
              disabled={busy || deleting}
              dir="auto"
              className={`${input} min-h-36`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <button
            disabled={busy || deleting || loading || !body.trim() || (!selected && !title.trim())}
            className="q-button bg-primary text-primary-foreground"
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </form>
      ) : null}
      {loading && !busy && !deleting && <output>Loading…</output>}
    </section>
  );
}
