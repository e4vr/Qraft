'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  LoaderCircle,
  Mail,
  Phone,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { WorkspaceHeader } from '@/components/workspace-header';
import {
  changeCloudflarePassword,
  updateCloudflareProfile,
} from '@/lib/application-services';
import { administrativeRoleLabels } from '@/features/access/domain/access-policy';
import { normalizePhone, type AppUser } from '@/lib/medguard-types';

export function AccountProfile({
  user,
  onUser,
}: {
  user: AppUser;
  onUser: (user: AppUser) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const role = administrativeRoleLabels(user).join(' · ') || 'Learner';

  async function saveProfile(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (profileBusy) return;
    const normalizedName = displayName.trim().replace(/\s+/g, ' ');
    const normalizedPhone = normalizePhone(phone);
    if (normalizedName === user.displayName && normalizedPhone === normalizePhone(user.phone ?? '')) {
      setProfileMessage('No changes to save.');
      setProfileError('');
      return;
    }
    setProfileBusy(true);
    setProfileError('');
    setProfileMessage('');
    try {
      const updated = await updateCloudflareProfile(normalizedName, normalizedPhone);
      onUser(updated);
      setDisplayName(updated.displayName);
      setPhone(updated.phone ?? '');
      setProfileMessage('Your profile has been updated.');
    } catch (error) {
      setProfileError(
        error instanceof Error
          ? error.message
          : 'Unable to update your profile.',
      );
    } finally {
      setProfileBusy(false);
    }
  }

  async function resetPassword(event: { preventDefault: () => void }) {
    event.preventDefault();
    setPasswordError('');
    setPasswordMessage('');
    if (newPassword !== confirmPassword) {
      setPasswordError('The new passwords do not match.');
      return;
    }
    if (passwordBusy) return;
    setPasswordBusy(true);
    try {
      await changeCloudflarePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage(
        'Password updated. Other signed-in devices have been signed out.',
      );
    } catch (error) {
      setPasswordError(
        error instanceof Error
          ? error.message
          : 'Unable to update your password.',
      );
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <>
      <WorkspaceHeader
        title="My profile"
        subtitle="Personal information and account security"
      />
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-7">
        <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
          <div className="bg-gradient-to-br from-primary/15 via-card to-violet-500/10 p-6 sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div
                className={`profile-ring profile-ring-${user.tier} grid size-20 shrink-0 place-items-center rounded-3xl bg-primary text-2xl font-black text-primary-foreground shadow-lg`}
              >
                {user.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-2xl font-bold">
                  {user.displayName}
                </h2>
                <p className="mt-1 break-all text-sm text-muted-foreground">
                  {user.email}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold capitalize text-primary">
                    {role}
                  </span>
                  <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-300">
                    {user.tier.toUpperCase()}
                  </span>
                  <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    Verified account
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <form
            onSubmit={saveProfile}
            className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <UserRound className="size-5" />
              </span>
              <div>
                <h2 className="font-bold">Personal details</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Update the information shown across Qraft.
                </p>
              </div>
            </div>
            <div className="mt-6 space-y-4">
              <label className="block text-sm font-semibold">
                Display name
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  minLength={2}
                  maxLength={120}
                  required
                  className="mt-2 h-12 w-full rounded-xl border bg-background px-4 font-normal outline-none focus:border-primary focus:ring-3 focus:ring-primary/10"
                />
              </label>
              <label className="block text-sm font-semibold">
                Mobile number
                <span className="relative mt-2 block">
                  <Phone className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    inputMode="tel"
                    required={user.role !== 'super_admin'}
                    className="h-12 w-full rounded-xl border bg-background pl-11 pr-4 font-normal outline-none focus:border-primary focus:ring-3 focus:ring-primary/10"
                  />
                </span>
              </label>
              <label className="block text-sm font-semibold">
                Email address
                <span className="relative mt-2 block">
                  <Mail className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={user.email}
                    readOnly
                    className="h-12 w-full rounded-xl border bg-muted/60 pl-11 pr-4 font-normal text-muted-foreground"
                  />
                </span>
              </label>
              <label className="block text-sm font-semibold">
                University ID
                <span className="relative mt-2 block">
                  <GraduationCap className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={user.universityId ?? 'Not provided'}
                    readOnly
                    className="h-12 w-full rounded-xl border bg-muted/60 pl-11 pr-4 font-normal text-muted-foreground"
                  />
                </span>
              </label>
            </div>
            {profileError && (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
              >
                {profileError}
              </p>
            )}
            {profileMessage && (
              <output className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4" />
                {profileMessage}
              </output>
            )}
            <button
              disabled={profileBusy || !displayName.trim()}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-bold text-primary-foreground disabled:opacity-50"
            >
              {profileBusy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {profileBusy ? 'Saving…' : 'Save changes'}
            </button>
          </form>

          <form
            onSubmit={resetPassword}
            className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
                <KeyRound className="size-5" />
              </span>
              <div>
                <h2 className="font-bold">Reset password</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Confirm your current password before choosing a new one.
                </p>
              </div>
            </div>
            <div className="mt-6 space-y-4">
              {[
                {
                  label: 'Current password',
                  value: currentPassword,
                  set: setCurrentPassword,
                  autoComplete: 'current-password',
                },
                {
                  label: 'New password',
                  value: newPassword,
                  set: setNewPassword,
                  autoComplete: 'new-password',
                },
                {
                  label: 'Confirm new password',
                  value: confirmPassword,
                  set: setConfirmPassword,
                  autoComplete: 'new-password',
                },
              ].map((field) => (
                <label
                  key={field.label}
                  className="block text-sm font-semibold"
                >
                  {field.label}
                  <span className="relative mt-2 block">
                    <input
                      type={showPasswords ? 'text' : 'password'}
                      autoComplete={field.autoComplete}
                      value={field.value}
                      onChange={(event) => field.set(event.target.value)}
                      minLength={
                        field.label === 'Current password' ? undefined : 10
                      }
                      required
                      className="h-12 w-full rounded-xl border bg-background px-4 pr-12 font-normal outline-none focus:border-primary focus:ring-3 focus:ring-primary/10"
                    />
                    <button
                      type="button"
                      aria-label={
                        showPasswords ? 'Hide passwords' : 'Show passwords'
                      }
                      onClick={() => setShowPasswords((value) => !value)}
                      className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                    >
                      {showPasswords ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-3 rounded-xl border border-primary/15 bg-primary/5 p-3 text-sm leading-6 text-muted-foreground">
              <ShieldCheck className="mt-1 size-4 shrink-0 text-primary" />
              <span>
                Use at least 10 characters. Updating your password signs out
                other devices while keeping this session active.
              </span>
            </div>
            {passwordError && (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
              >
                {passwordError}
              </p>
            )}
            {passwordMessage && (
              <output className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4" />
                {passwordMessage}
              </output>
            )}
            <button
              disabled={
                passwordBusy ||
                !currentPassword ||
                newPassword.length < 10 ||
                !confirmPassword
              }
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 font-bold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-950"
            >
              {passwordBusy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              {passwordBusy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
