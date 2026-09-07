import application from 'vinext/server/fetch-handler';
import { connectRealtime } from './lib/realtime-server';

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    // WebSocket upgrades must reach Cloudflare unchanged (HTTP 101).
    if (new URL(request.url).pathname === '/api/cloudflare/realtime') {
      try { return await connectRealtime(request); }
      catch { return Response.json({ error: 'Live connection unavailable.' }, { status: 503 }); }
    }
    return application.fetch(request, env, ctx);
  },
};
export default worker;
