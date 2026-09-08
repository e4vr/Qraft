'use client';
import { useRef, useState } from 'react';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { forgetLocalUser } from '@/lib/local-db';

export function DeleteAccount({ uid, onDeleted }: { uid: string; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function remove() {
    if (inFlight.current || confirmation !== 'DELETE') return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await api('/auth/account', { method: 'DELETE', body: JSON.stringify({ confirmation }) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to delete account.');
      setBusy(false); inFlight.current = false; return;
    }
    // Unmount the signed-in workspace before clearing its offline cache.
    onDeleted();
    await forgetLocalUser(uid);
    window.location.replace('/');
  }
  return <section className="rounded-2xl border border-destructive/30 bg-card p-5 sm:p-6">
    <h2 className="font-bold">Account</h2>
    <p className="my-3 text-sm text-muted-foreground">Permanently delete your account and personal study data.</p>
    <Button variant="destructive" onClick={() => { setConfirmation(''); setError(''); setOpen(true); }}>Delete Account</Button>
    <AlertDialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account permanently?</AlertDialogTitle>
          <AlertDialogDescription>Your sign-in, flashcards, decks, personal tests and unshared private QBanks will be deleted. Public questions, contributions and review history remain under “Deleted user”. Shared QBanks are preserved and transferred to a Superadmin. You will be signed out. This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <label htmlFor="delete-account-confirmation" className="text-sm font-semibold">Type DELETE to confirm</label>
        <Input id="delete-account-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><Button variant="destructive" disabled={busy || confirmation !== 'DELETE'} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete Account'}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
