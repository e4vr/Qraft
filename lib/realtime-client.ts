'use client';

export const LIVE_CHANGE = 'qraft-live-change';
export function subscribeLive(callback: () => void, topics?: string[]) {
  const listener = (event: Event) => {
    const topic = (event as CustomEvent<string>).detail;
    if (!topics || topic === 'connected' || topics.includes(topic)) callback();
  };
  window.addEventListener(LIVE_CHANGE, listener);
  return () => window.removeEventListener(LIVE_CHANGE, listener);
}

// Each bank/account has its own audience. A reconnect always triggers a refresh
// to recover changes made while the browser was asleep or disconnected.
export function openLiveChannels(channels: string[], changed: () => void) {
  let stopped = false;
  const sockets = new Map<string, WebSocket>();
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  const attempts = new Map<string, number>();
  const lastMessage = new Map<string, number>();
  const emit = (topic = 'connected') => { changed(); window.dispatchEvent(new CustomEvent(LIVE_CHANGE, { detail: topic })); };
  function connect(channel: string) {
    if (stopped || !navigator.onLine || document.visibilityState === 'hidden' || sockets.has(channel)) return;
    const url = new URL('/api/cloudflare/realtime', window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('channel', channel);
    const socket = new WebSocket(url);
    sockets.set(channel, socket);
    socket.onopen = () => { attempts.set(channel, 0); lastMessage.set(channel, Date.now()); emit(); };
    socket.onmessage = event => {
      lastMessage.set(channel, Date.now());
      if (event.data === 'pong') return;
      try { const message = JSON.parse(String(event.data)); if (message.type === 'changed') emit(message.topic); } catch { /* Ignore malformed packets. */ }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (sockets.get(channel) !== socket) return;
      sockets.delete(channel);
      if (stopped || !navigator.onLine || document.visibilityState === 'hidden') return;
      const attempt = (attempts.get(channel) ?? 0) + 1;
      attempts.set(channel, attempt);
      retries.set(channel, setTimeout(() => { retries.delete(channel); connect(channel); }, Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)) + Math.random() * 500));
    };
  }
  const resume = () => {
    for (const retry of retries.values()) clearTimeout(retry);
    retries.clear();
    if (!navigator.onLine || document.visibilityState === 'hidden') {
      for (const socket of sockets.values()) socket.close(1000, 'Background');
      sockets.clear();
    } else { channels.forEach(connect); emit(); }
  };
  const heartbeat = setInterval(() => {
    for (const [channel, socket] of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        if (Date.now() - (lastMessage.get(channel) ?? 0) > 65_000) socket.close();
        else socket.send('ping');
      }
    }
  }, 25_000);
  // A lightweight fallback only when an expected connection is unavailable.
  const fallback = setInterval(() => { if (navigator.onLine && document.visibilityState !== 'hidden' && channels.some(channel => sockets.get(channel)?.readyState !== WebSocket.OPEN)) emit(); }, 15_000);
  window.addEventListener('online', resume);
  window.addEventListener('offline', resume);
  document.addEventListener('visibilitychange', resume);
  channels.forEach(connect);
  return () => {
    stopped = true;
    clearInterval(heartbeat); clearInterval(fallback);
    retries.forEach(clearTimeout);
    sockets.forEach(socket => socket.close(1000, 'Leaving'));
    window.removeEventListener('online', resume);
    window.removeEventListener('offline', resume);
    document.removeEventListener('visibilitychange', resume);
  };
}
