import application from 'vinext/server/fetch-handler';
import { connectRealtime } from './lib/realtime-server';
import { createQuestionBackup } from './lib/question-backup';
import { cleanDeletedAccountMedia } from './lib/account-deletion-server';

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    // WebSocket upgrades must reach Cloudflare unchanged (HTTP 101).
    if (new URL(request.url).pathname === '/api/cloudflare/realtime') {
      try { return await connectRealtime(request); }
      catch { return Response.json({ error: 'Live connection unavailable.' }, { status: 503 }); }
    }
    const response = await application.fetch(request, env, ctx);
    if (request.method === 'DELETE' && new URL(request.url).pathname === '/api/cloudflare/auth/account' && response.ok)
      ctx.waitUntil(cleanDeletedAccountMedia());
    return response;
  },
  scheduled(
    controller: ScheduledController,
    env: Cloudflare.Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(createQuestionBackup(env, controller.scheduledTime));
    ctx.waitUntil(cleanDeletedAccountMedia());
  },
};
export default worker;
