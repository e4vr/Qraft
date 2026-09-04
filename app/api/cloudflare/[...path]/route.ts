import {
  beginMfa,
  completeMfa,
  currentUser,
  deleteBankMedia,
  joinBank,
  loadCollaboration,
  loadState,
  login,
  logout,
  previewBankInvite,
  register,
  reserveIds,
  saveCollaboration,
  saveState,
  serveMedia,
  uploadMedia,
  verifyMfa,
} from '@/lib/cloudflare-server';

export const dynamic = 'force-dynamic';

async function safely(run: () => Promise<Response>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(JSON.stringify({ event: 'cloudflare_api_error', error: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: 'The request could not be completed.' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

function pathParts(request: Request) {
  return new URL(request.url).pathname.split('/').slice(3).map(decodeURIComponent);
}

export async function GET(request: Request) {
  return safely(async () => {
  const [scope, action, ...rest] = pathParts(request);
  if (scope === 'auth' && action === 'session') {
    const user = await currentUser(request);
    return Response.json({ user: user ?? null }, { headers: { 'cache-control': 'no-store' } });
  }
  if (scope === 'state') return loadState(request);
  if (scope === 'collaboration') return loadCollaboration(request);
  if (scope === 'media' && action) return serveMedia(request, [action, ...rest].join('/'));
  return Response.json({ error: 'Not found.' }, { status: 404 });
  });
}

export async function POST(request: Request) {
  return safely(async () => {
  const [scope, action] = pathParts(request);
  if (scope === 'auth' && action === 'register') return register(request);
  if (scope === 'auth' && action === 'login') return login(request);
  if (scope === 'auth' && action === 'mfa') return verifyMfa(request);
  if (scope === 'auth' && action === 'mfa-begin') return beginMfa(request);
  if (scope === 'auth' && action === 'mfa-complete') return completeMfa(request);
  if (scope === 'auth' && action === 'logout') return logout(request);
  if (scope === 'ids' && action === 'reserve') return reserveIds(request);
  if (scope === 'qbanks' && action === 'invite-preview') return previewBankInvite(request);
  if (scope === 'qbanks' && action === 'join') return joinBank(request);
  if (scope === 'media' && action === 'notes') return uploadMedia(request, 'notes');
  if (scope === 'media' && action === 'questions') return uploadMedia(request, 'questions');
  return Response.json({ error: 'Not found.' }, { status: 404 });
  });
}

export async function PUT(request: Request) {
  return safely(async () => {
  const [scope] = pathParts(request);
  if (scope === 'state') return saveState(request);
  if (scope === 'collaboration') return saveCollaboration(request);
  return Response.json({ error: 'Not found.' }, { status: 404 });
  });
}

export async function DELETE(request: Request) {
  return safely(async () => {
  const [scope, action] = pathParts(request);
  if (scope === 'media' && action) return deleteBankMedia(request, action);
  return Response.json({ error: 'Not found.' }, { status: 404 });
  });
}
