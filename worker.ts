import application from 'vinext/server/fetch-handler';
import { connectRealtime, publishChanges } from './lib/realtime-server';
import { createQuestionBackup } from './lib/question-backup';
import { cleanDeletedAccountMedia } from './lib/account-deletion-server';
import { expireSubscriptions } from './lib/platform-server';
import { cleanStateSyncOperations } from './features/state/server/state-service';
import { cleanPreformedTestOperations } from './lib/preformed-test-server';
import { withSecurityHeaders } from './server/http/security-headers';
import { maintenanceGate } from './features/administration/server/operations-service';

function withBuildIdentity(response: Response, env: Cloudflare.Env) {
  if (!env.BUILD_VERSION || response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set('x-qraft-build', env.BUILD_VERSION);
  if (env.BUILD_TIMESTAMP) headers.set('x-qraft-build-time', env.BUILD_TIMESTAMP);
  if (env.BUILD_SERVICE_WORKER) headers.set('x-qraft-sw', env.BUILD_SERVICE_WORKER);
  if (env.BUILD_SCHEMA) headers.set('x-qraft-schema', env.BUILD_SCHEMA);
  if (env.BUILD_PACKAGE_VERSION) headers.set('x-qraft-app-version', env.BUILD_PACKAGE_VERSION);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const worker: ExportedHandler<Cloudflare.Env> = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    // API enforcement lives in the lifecycle too, so route-level tests exercise it.
    if (!new URL(request.url).pathname.startsWith('/api/cloudflare/') || new URL(request.url).pathname === '/api/cloudflare/realtime') {
      const maintenance = await maintenanceGate(request);
      if (maintenance) return withBuildIdentity(withSecurityHeaders(request, maintenance), env);
    }
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
