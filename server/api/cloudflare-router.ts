import { deleteOwnAccount } from '@/lib/account-deletion-server';
import { createQBank, deleteQBank } from '@/features/qbanks/server/lifecycle-service';
import {
  beginMfa,
  changeOwnPassword,
  completeMfa,
  currentUser,
  login,
  logout,
  register,
  updateOwnProfile,
  verifyMfa,
} from '@/features/auth/server/auth-service';
import {
  loadCollaboration,
  saveCollaboration,
} from '@/features/collaboration/server/collaboration-service';
import {
  deleteBankMedia,
  serveMedia,
  uploadMedia,
} from '@/features/media/server/media-service';
import {
  deleteQBankFolder,
  joinBank,
  previewBankInvite,
  reserveIds,
} from '@/features/qbanks/server/qbank-service';
import {
  loadState,
  saveState,
  saveStatePatch,
} from '@/features/state/server/state-service';
import { contactApi } from '@/lib/contact-server';
import { platformApi } from '@/lib/platform-server';
import { preformedTestApi } from '@/lib/preformed-test-server';
import { connectRealtime } from '@/lib/realtime-server';
import { monitoringApi } from '@/features/administration/server/monitoring-service';
import { operationsApi } from '@/features/administration/server/operations-service';
import {
  cloudflarePathParts,
  withApiLifecycle,
} from '@/server/api/request-lifecycle';

function notFound(): Response {
  return Response.json({ error: 'Not found.' }, { status: 404 });
}

async function routeGet(request: Request): Promise<Response> {
  const [scope, action, ...rest] = cloudflarePathParts(request);
  if (scope === 'platform' && action === 'monitoring') return monitoringApi(request);
  if (scope === 'platform' && ['site-operations', 'plan-pricing', 'plan-catalog', 'registration-policy'].includes(action)) return operationsApi(request, action);
  if (scope === 'realtime') return connectRealtime(request);
  if (scope === 'preformed' && action)
    return preformedTestApi(request, action);
  if (scope === 'auth' && action === 'session') {
    // An unverified Superadmin session may only discover that MFA enrollment
    // is required. Protected APIs still call currentUser() in verified mode.
    const user = await currentUser(request, false);
    return Response.json(
      { user: user ?? null },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  if (scope === 'platform' && action) return platformApi(request, action);
  if (scope === 'contact') return contactApi(request);
  if (scope === 'state') return loadState(request);
  if (scope === 'collaboration') return loadCollaboration(request);
  if (scope === 'media' && action)
    return serveMedia(request, [action, ...rest].join('/'));
  return notFound();
}

async function routePost(request: Request): Promise<Response> {
  const [scope, action] = cloudflarePathParts(request);
  if (scope === 'qbanks' && !action) return createQBank(request);
  if (scope === 'platform' && action === 'monitoring') return monitoringApi(request);
  if (scope === 'platform' && ['account-block', 'registration-policy'].includes(action)) return operationsApi(request, action);
  if (scope === 'preformed' && action)
    return preformedTestApi(request, action);
  if (scope === 'platform' && action) return platformApi(request, action);
  if (scope === 'contact') return contactApi(request);
  if (scope === 'auth' && action === 'register') return register(request);
  if (scope === 'auth' && action === 'login') return login(request);
  if (scope === 'auth' && action === 'mfa') return verifyMfa(request);
  if (scope === 'auth' && action === 'mfa-begin') return beginMfa(request);
  if (scope === 'auth' && action === 'mfa-complete') return completeMfa(request);
  if (scope === 'auth' && action === 'logout') return logout(request);
  if (scope === 'ids' && action === 'reserve') return reserveIds(request);
  if (scope === 'qbanks' && action === 'invite-preview')
    return previewBankInvite(request);
  if (scope === 'qbanks' && action === 'join') return joinBank(request);
  if (scope === 'media' && action === 'notes')
    return uploadMedia(request, 'notes');
  if (scope === 'media' && action === 'shared-notes')
    return uploadMedia(request, 'shared-notes');
  if (scope === 'media' && action === 'announcements')
    return uploadMedia(request, 'announcements');
  if (scope === 'media' && action === 'questions')
    return uploadMedia(request, 'questions');
  return notFound();
}

async function routePut(request: Request): Promise<Response> {
  const [scope, action] = cloudflarePathParts(request);
  if (scope === 'platform' && ['site-operations', 'plan-pricing', 'registration-policy'].includes(action)) return operationsApi(request, action);
  if (scope === 'preformed' && action)
    return preformedTestApi(request, action);
  if (scope === 'auth' && action === 'profile')
    return updateOwnProfile(request);
  if (scope === 'auth' && action === 'password')
    return changeOwnPassword(request);
  if (scope === 'platform' && action) return platformApi(request, action);
  if (scope === 'contact') return contactApi(request);
  if (scope === 'state' && action === 'exam')
    return saveStatePatch(request, 'exam');
  if (scope === 'state' && action === 'flashcards')
    return saveStatePatch(request, 'flashcards');
  if (scope === 'state' && action === 'daily-goal')
    return saveStatePatch(request, 'daily-goal');
  if (scope === 'state' && !action) return saveState(request);
  if (scope === 'collaboration') return saveCollaboration(request);
  return notFound();
}

async function routeDelete(request: Request): Promise<Response> {
  const [scope, action] = cloudflarePathParts(request);
  if (scope === 'platform' && action === 'registration-policy') return operationsApi(request, action);
  if (scope === 'platform' && action === 'deleted-registration') return operationsApi(request, action);
  if (scope === 'qbanks' && action) return deleteQBank(request, action);
  if (scope === 'preformed' && action)
    return preformedTestApi(request, action);
  if (scope === 'qbank-folders' && action)
    return deleteQBankFolder(request, action);
  if (scope === 'auth' && action === 'account')
    return deleteOwnAccount(request);
  if (scope === 'contact') return contactApi(request);
  if (scope === 'platform' && action) return platformApi(request, action);
  if (scope === 'media' && action) return deleteBankMedia(request, action);
  return notFound();
}

export function GET(request: Request): Promise<Response> {
  return withApiLifecycle(request, () => routeGet(request));
}

export function POST(request: Request): Promise<Response> {
  return withApiLifecycle(request, () => routePost(request));
}

export function PUT(request: Request): Promise<Response> {
  return withApiLifecycle(request, () => routePut(request));
}

export function DELETE(request: Request): Promise<Response> {
  return withApiLifecycle(request, () => routeDelete(request));
}
