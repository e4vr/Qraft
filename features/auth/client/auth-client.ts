import type { AppUser } from '@/lib/medguard-types';
import {
  api,
  clearResourceCache,
  setApiCache,
} from '@/lib/api-client';

export async function observeCloudflareUser(
  callback: (user?: AppUser) => void,
): Promise<() => void> {
  const { user } = await api<{ user: AppUser | null }>('/auth/session');
  rememberLocalAccount(user?.uid ?? '');
  callback(user ?? undefined);
  return () => undefined;
}

export function setAuthenticatedUserCache(user: AppUser): void {
  rememberLocalAccount(user.uid);
  setApiCache('/auth/session', { user });
}

function rememberLocalAccount(uid: string) {
  try { localStorage.setItem('qraft-current-account', uid); window.dispatchEvent(new Event('qraft-account-changed')); } catch { /* Server account guards remain mandatory. */ }
}

export async function signInCloudflare(
  email: string,
  password: string,
): Promise<AppUser> {
  clearResourceCache();
  try {
    const result = await api<{ user: AppUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthenticatedUserCache(result.user);
    return result.user;
  } catch (error) {
    if (error instanceof Error && error.message === 'MFA_REQUIRED') throw error;
    throw error;
  }
}

export async function completeCloudflareMfaSignIn(
  code: string,
): Promise<AppUser> {
  const result = await api<{ user: AppUser }>('/auth/mfa', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  setAuthenticatedUserCache(result.user);
  return result.user;
}

export async function createCloudflareAccount(
  name: string,
  email: string,
  password: string,
  universityId: string,
  phone: string,
  setupToken?: string,
): Promise<AppUser> {
  clearResourceCache();
  const result = await api<{ user: AppUser }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name,
      email,
      password,
      universityId,
      phone,
      setupToken,
    }),
  });
  setAuthenticatedUserCache(result.user);
  return result.user;
}

export async function signOutCloudflare(): Promise<void> {
  await api('/auth/logout', { method: 'POST', body: '{}' });
  rememberLocalAccount('');
  clearResourceCache();
}

export async function updateCloudflareProfile(
  displayName: string,
  phone: string,
): Promise<AppUser> {
  const result = await api<{ user: AppUser }>('/auth/profile', {
    method: 'PUT',
    body: JSON.stringify({ displayName, phone }),
  });
  setAuthenticatedUserCache(result.user);
  return result.user;
}

export async function changeCloudflarePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await api('/auth/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function beginTotpEnrollment(): Promise<{
  secretKey: string;
  qrUrl: string;
}> {
  return api('/auth/mfa-begin', { method: 'POST', body: '{}' });
}

export async function completeTotpEnrollment(code: string): Promise<void> {
  await api('/auth/mfa-complete', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}
