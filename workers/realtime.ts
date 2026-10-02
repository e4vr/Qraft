import { DurableObject } from 'cloudflare:workers';

// One object per audience (bank, account, or administrative workspace).
// Sockets carry invalidations only; data remains behind the authorized D1 APIs.
export class RealtimeChannel extends DurableObject<Cloudflare.Env> {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required', { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ clientId: request.headers.get('x-qraft-client-id') ?? '',
      version: request.headers.get('x-qraft-live-version') === '2' ? 2 : 1 });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  publish(resources: string[], originClientId = '', legacyOnly = false) {
    const message = JSON.stringify({ type: 'resources_changed', resources: [...new Set(resources)].slice(0, 20) });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const { clientId, version } = socket.deserializeAttachment() as { clientId?: string; version?: number };
        if (legacyOnly && version === 2) continue;
        if (originClientId && clientId === originClientId) continue;
        else socket.send(message);
      } catch { /* A disconnected client will refresh after reconnecting. */ }
    }
  }
  publishLegacy(resources: string[], originClientId = '') {
    this.publish(resources, originClientId, true);
  }
  async reserveUsageBudget(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 256) return false;
    // Binding-only RPC: no public HTTP route can allocate or spend this budget.
    return this.ctx.storage.transaction(async storage => {
      const now = new Date().toISOString();
      const day = now.slice(0,10), month = now.slice(0,7);
      const budget = await storage.get<{ day:string; month:string; daily:number; monthly:number }>('usage-budget');
      const daily = budget?.day === day ? budget.daily : 0;
      const monthly = budget?.month === month ? budget.monthly : 0;
      if (daily + count > 20_000 || monthly + count > 500_000) return false;
      await storage.put('usage-budget', { day, month, daily:daily+count, monthly:monthly+count });
      return true;
    });
  }
  async usageBudget() {
    const now=new Date().toISOString();
    const budget=await this.ctx.storage.get<{day:string;month:string;daily:number;monthly:number}>('usage-budget');
    return {daily:budget?.day===now.slice(0,10)?budget.daily:0,monthly:budget?.month===now.slice(0,7)?budget.monthly:0};
  }
  webSocketMessage(socket: WebSocket) { socket.close(1008, 'Read-only connection'); }
  webSocketClose(socket: WebSocket, code: number, reason: string) { socket.close(code, reason); }
  webSocketError(socket: WebSocket) { socket.close(1011, 'Connection error'); }
}

const worker: ExportedHandler<Cloudflare.Env> = {
  fetch() {
    return new Response('Not found', { status: 404 });
  },
};
export default worker;
