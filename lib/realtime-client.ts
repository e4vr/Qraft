'use client';

import { clientInstanceId, invalidateApiResources } from './api-client';

export const LIVE_CHANGE = 'qraft-live-change';

const topicTags: Record<string, string[]> = {
  connected: ['account', 'collaboration', 'review-queue', 'question-catalog', 'subscriptions', 'discounts', 'contributions', 'economy', 'contact'],
  collaboration: ['collaboration'],
  catalog: ['collaboration', 'question-catalog', 'test-pool'],
  'question-catalog': ['question-catalog', 'test-pool', 'collaboration'],
  'review-queue': ['review-queue', 'collaboration'],
  'reviewer-performance': ['reviewer-performance'],
  'review-history': ['review-history'],
  account: ['account', 'subscriptions'],
  access: ['account', 'subscriptions', 'collaboration'],
  pricing: ['pricing', 'discounts'],
  discounts: ['discounts', 'pricing'],
  subscriptions: ['subscriptions', 'account'],
  reward: ['contributions', 'economy'],
  'reward-gift': ['contributions', 'economy'],
  contributions: ['contributions', 'economy'],
  economy: ['economy', 'contributions'],
  announcement: ['announcement'],
  'legal-links': ['legal-links'],
  contact: ['contact'],
  audit: ['audit'],
};

export function subscribeLive(callback: (topic: string) => void, topics?: string[]) {
  const listener = (event: Event) => {
    const topic = (event as CustomEvent<string>).detail;
    if (document.visibilityState === 'hidden') return;
    // A connection event is transport state, not a data change. Consumers should
    // refresh only when one of their requested topics actually changed.
    if (!topics || topics.includes(topic)) callback(topic);
  };
  window.addEventListener(LIVE_CHANGE, listener);
  return () => window.removeEventListener(LIVE_CHANGE, listener);
}

export function createReconnectCoordinator(reconcile: () => void) {
  const pending = new Set<string>();
  let reconciled = true;
  return {
    disconnected(channel: string) {
      if (reconciled) {
        pending.clear();
        reconciled = false;
      }
      pending.add(channel);
    },
    connected(channel: string) {
      if (!pending.delete(channel) || reconciled) return;
      reconciled = true;
      reconcile();
    },
  };
}

// Each bank/account has its own audience. A reconnect always triggers a refresh
// to recover changes made while the browser was asleep or disconnected.
export function openLiveChannels(
  channels: string[],
  changed: (topic: string) => void,
) {
  let stopped = false;
  const sockets = new Map<string, WebSocket>();
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  const attempts = new Map<string, number>();
  const connectedBefore = new Set<string>();
  const emit = (topic = 'connected') => {
    invalidateApiResources(topicTags[topic] ?? ['collaboration'], topic === 'connected' ? 'reconnect' : `realtime:${topic}`);
    changed(topic);
    window.dispatchEvent(new CustomEvent(LIVE_CHANGE, { detail: topic }));
  };
  const reconnects = createReconnectCoordinator(() => emit());
  function connect(channel: string) {
    if (stopped || !navigator.onLine || sockets.has(channel)) return;
    const url = new URL('/api/cloudflare/realtime', window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('channel', channel);
    if (clientInstanceId) url.searchParams.set('client', clientInstanceId);
    const socket = new WebSocket(url);
    sockets.set(channel, socket);
    socket.onopen = () => {
      attempts.set(channel, 0);
      if (connectedBefore.has(channel)) reconnects.connected(channel);
      else connectedBefore.add(channel);
    };
    socket.onmessage = event => {
      if (event.data === 'pong') return;
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; topic?: string; resources?: string[] };
        if (message.type === 'changed' && typeof message.topic === 'string') emit(message.topic);
        if (message.type === 'resources_changed' && Array.isArray(message.resources))
          message.resources.filter(resource => typeof resource === 'string').forEach(emit);
      } catch { /* Ignore malformed packets. */ }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (sockets.get(channel) !== socket) return;
      sockets.delete(channel);
      if (stopped) return;
      if (connectedBefore.has(channel)) reconnects.disconnected(channel);
      if (!navigator.onLine) return;
      const attempt = (attempts.get(channel) ?? 0) + 1;
      attempts.set(channel, attempt);
      retries.set(channel, setTimeout(() => { retries.delete(channel); connect(channel); }, Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)) + Math.random() * 500));
    };
  }
  const resume = () => {
    for (const retry of retries.values()) clearTimeout(retry);
    retries.clear();
    if (!navigator.onLine) {
      for (const socket of sockets.values()) socket.close(1000, 'Offline');
      sockets.clear();
    } else channels.forEach(connect);
  };
  window.addEventListener('online', resume);
  window.addEventListener('offline', resume);
  channels.forEach(connect);
  return () => {
    stopped = true;
    retries.forEach(clearTimeout);
    sockets.forEach(socket => socket.close(1000, 'Leaving'));
    window.removeEventListener('online', resume);
    window.removeEventListener('offline', resume);
  };
}
