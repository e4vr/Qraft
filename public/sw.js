const CACHE_NAME = 'qraft-shell-v4.6.4';
const APP_SHELL = [
  '/offline',
  '/manifest.webmanifest',
  '/qraft-mark.svg',
  '/qraft-wordmark.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('qraft-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim())
      .then(async () => {
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((client) =>
          client.postMessage({ type: 'QRAFT_SW_ACTIVATED' }),
        );
      }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'QRAFT_SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  // An existing worker can still control a development tab after a restart.
  // Vite modules change at stable URLs and must never use the shell cache.
  if (
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/node_modules/') ||
    /\.(?:tsx?|jsx)$/.test(url.pathname)
  ) return;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin)
    return;
  const staticAsset = ['script', 'style', 'font', 'image'].includes(
    event.request.destination,
  );
  if (staticAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      }),
    );
    return;
  }
  event.respondWith(
    fetch(event.request).catch(() =>
      event.request.mode === 'navigate'
        ? caches.match('/offline')
        : Response.error(),
    ),
  );
});
