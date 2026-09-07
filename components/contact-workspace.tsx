'use client';
/* oxlint-disable next/no-img-element */
import { useEffect, useState } from 'react';
import { MessageSquareText, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/cloudflare-client';
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
        <div className="mt-3 space-y-1 text-sm leading-7 text-muted-foreground" dir="rtl">
          <p>{admin ? 'استعرض شكاوى المستخدمين ومشاكل الحسابات والأسئلة في مكان واحد.' : 'أرسل بلاغًا عن مشكلة تقنية أو مشكلة في حسابك أو أحد الأسئلة.'}</p>
          <p>{admin ? 'تابع التفاصيل، وردّ على البلاغات وحدّث حالتها عند الحاجة.' : 'تابع بلاغاتك وردود الإدارة بشكل خاص من خلال هذه الخدمة.'}</p>
        </div>
        <button type="button" onClick={() => setStartedFor(admin)} className="q-button q-button-primary mt-6 w-full whitespace-normal sm:w-auto" dir="rtl">
          {admin ? 'استعرض الشكاوى الحالية' : 'اطلب الخدمة الآن'}<ArrowLeft aria-hidden="true" className="size-4" />
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
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useEffect(() => subscribeLive(() => setRevision(r => r + 1), ['contact']), []);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      const path = selected
        ? `id=${selected.id}&offset=${messageOffset}`
        : `search=${encodeURIComponent(search)}&status=${filter}&offset=${offset}`;
      api<{ tickets?: Ticket[]; messages?: Message[]; ticket?: Ticket }>(
        `/contact?${path}`,
      )
        .then((r) => {
          if (!live) return;
          setError('');
          if (r.tickets) setTickets(r.tickets);
          if (r.messages) setMessages(r.messages);
          if (r.ticket) setSelected(current => current && current.id === r.ticket?.id && current.status !== r.ticket.status ? { ...current, status: r.ticket.status } : current);
        })
        .catch((e) => {
          if (!live) return;
          if (selected && e.message === 'Ticket not found.') {
            setSelected(undefined); setMessages([]); setMessageOffset(0);
            setNotice('This ticket is no longer available.');
          } else setError(e.message);
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [selected, search, filter, offset, messageOffset, revision]);
  async function send() {
    setBusy(true);
    setError('');
    try {
      await api('/contact', {
        method: 'POST',
        body: JSON.stringify({
          id: selected?.id,
          title,
          body,
          questionId: question,
          requestId,
        }),
      });
      setBody('');
      setTitle('');
      setQuestion('');
      setRequestId(crypto.randomUUID());
      setNotice('تم إرسال البلاغ / Message sent successfully.');
      setRevision((r) => r + 1);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Unable to send. Your draft is preserved.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function status(value: string) {
    setBusy(true);
    try {
      await api('/contact', {
        method: 'POST',
        body: JSON.stringify({
          id: selected?.id,
          operation: 'status',
          status: value,
        }),
      });
      setSelected((s) => (s ? { ...s, status: value } : s));
      setNotice('Status updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update status.');
    } finally {
      setBusy(false);
    }
  }
  async function deleteTicket() {
    if (!selected || deleting) return;
    setDeleting(true);
    setError('');
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
      setNotice('تم حذف البلاغ / Ticket deleted.');
      setRevision((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to delete ticket.');
    } finally {
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
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 p-3 text-destructive"
        >
          {error}
        </p>
      )}
      {notice && <output className="text-emerald-600">{notice}</output>}
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
            onClick={() => {
              setSelected(undefined);
              setMessageOffset(0);
            }}
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
                  disabled={busy}
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
                disabled={messageOffset === 0 || busy}
                onClick={() =>
                  setMessageOffset(Math.max(0, messageOffset - 50))
                }
              >
                Previous messages
              </button>
              <button
                className="q-button border"
                disabled={messages.length <= 50 || busy}
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
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
            <select
              className={input}
              aria-label="Ticket status"
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
              onClick={() => {
                setSelected(t);
                setMessages([]);
                setNotice('');
              }}
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
          {!busy && !tickets.length && <p>No tickets yet.</p>}
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
              disabled={tickets.length <= 50 || busy}
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
                  className={input}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="block">
                Question ID (optional)
                <input
                  className={input}
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
              dir="auto"
              className={`${input} min-h-36`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !body.trim()}
            className="q-button bg-primary text-primary-foreground"
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </form>
      ) : null}
      {busy && <output>Loading…</output>}
    </section>
  );
}
