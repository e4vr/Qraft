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
    pair[1].serializeAttachment({ clientId: request.headers.get('x-qraft-client-id') ?? '' });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  publish(resources: string[], originClientId = '') {
    const message = JSON.stringify({ type: 'resources_changed', resources: [...new Set(resources)].slice(0, 20) });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const { clientId } = socket.deserializeAttachment() as { clientId?: string };
        if (originClientId && clientId === originClientId) continue;
        else socket.send(message);
      } catch { /* A disconnected client will refresh after reconnecting. */ }
    }
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
