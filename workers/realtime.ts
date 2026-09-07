import { DurableObject } from 'cloudflare:workers';

// One object per audience (bank, account, or administrative workspace).
// Sockets carry invalidations only; data remains behind the authorized D1 APIs.
export class RealtimeChannel extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required', { status: 426 });
    const pair = new WebSocketPair();
    const expires = Date.now() + 5 * 60_000;
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ expires });
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(expires);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  publish(topic: string) {
    const message = JSON.stringify({ type: 'changed', topic });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const { expires } = socket.deserializeAttachment() as { expires: number };
        if (expires <= Date.now()) socket.close(4001, 'Renew authorization');
        else socket.send(message);
      } catch { /* A disconnected client will refresh after reconnecting. */ }
    }
  }
  async alarm() {
    let next = Infinity;
    for (const socket of this.ctx.getWebSockets()) {
      const { expires } = socket.deserializeAttachment() as { expires: number };
      if (expires <= Date.now()) socket.close(4001, 'Renew authorization');
      else next = Math.min(next, expires);
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }
  webSocketMessage(socket: WebSocket) { socket.close(1008, 'Read-only connection'); }
  webSocketClose(socket: WebSocket, code: number, reason: string) { socket.close(code, reason); }
  webSocketError(socket: WebSocket) { socket.close(1011, 'Connection error'); }
}

const worker = { fetch() { return new Response('Not found', { status: 404 }); } };
export default worker;
