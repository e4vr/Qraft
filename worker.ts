import application from 'vinext/server/fetch-handler';
import { connectRealtime, publishChanges } from './lib/realtime-server';
import { createQuestionBackup } from './lib/question-backup';
import { cleanDeletedAccountMedia } from './lib/account-deletion-server';
import { expireSubscriptions } from './lib/platform-server';
import { cleanStateSyncOperations } from './features/state/server/state-service';
import { cleanPreformedTestOperations } from './lib/preformed-test-server';
import { withSecurityHeaders } from './server/http/security-headers';

function withBuildIdentity(response: Response, env: Cloudflare.Env) {
  if (!env.BUILD_VERSION || response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set('x-qraft-build', env.BUILD_VERSION);
  if (env.BUILD_TIMESTAMP) headers.set('x-qraft-build-time', env.BUILD_TIMESTAMP);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const worker: ExportedHandler<Cloudflare.Env> = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    // WebSocket upgrades must reach Cloudflare unchanged (HTTP 101).
    if (new URL(request.url).pathname === '/api/cloudflare/realtime') {
      try {
        return withSecurityHeaders(request, await connectRealtime(request));
      } catch {
        return withSecurityHeaders(
          request,
          Response.json(
            { error: 'Live connection unavailable.' },
            { status: 503 },
          ),
        );
      }
    }
    const response = await application.fetch(request, env, ctx);
    if (request.method === 'DELETE' && new URL(request.url).pathname === '/api/cloudflare/auth/account' && response.ok)
      ctx.waitUntil(cleanDeletedAccountMedia());
    return withBuildIdentity(withSecurityHeaders(request, response), env);
  },
  scheduled(
    controller: ScheduledController,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(createQuestionBackup(env, controller.scheduledTime));
    ctx.waitUntil(cleanDeletedAccountMedia());
    ctx.waitUntil(cleanStateSyncOperations());
    ctx.waitUntil(cleanPreformedTestOperations());
    ctx.waitUntil((async () => {
      const userIds = await expireSubscriptions();
      if (userIds.length)
        await publishChanges(['admin', 'access', ...userIds.map(userId => `user:${userId}`)], ['account', 'subscriptions']);
    })());
  },
};
export default worker;
