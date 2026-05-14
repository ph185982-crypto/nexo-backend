/* Nexo Vendas — Service Worker v2
 * Strategy:
 *   - Static assets (_next/static, icons, fonts): Cache-First, versioned cache
 *   - Navigation (HTML pages): Network-First with offline fallback
 *   - API routes: Network-Only (never cache sensitive data)
 *   - Push notifications: existing handler preserved
 */

const CACHE_VERSION = 'nexo-v2';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const OFFLINE_URL   = '/offline.html';

const PRECACHE_ASSETS = [
  '/',
  '/crm/conversations',
  '/offline.html',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
];

// ── Install: pre-cache shell assets ──────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(PRECACHE_ASSETS).catch(() => {
        // Non-fatal: some pages may not exist at install time
      })
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: delete stale caches ────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('nexo-') && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => clients.claim())
  );
});

// ── Fetch: routing strategy ───────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API routes — always network, never cache
  if (url.pathname.startsWith('/api/')) return;

  // Static assets (_next/static, images, fonts) — Cache-First
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image') ||
    url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests (HTML) — Network-First with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) =>
            cached ?? caches.match(OFFLINE_URL)
          )
        )
    );
    return;
  }
});

// ── Push Notifications (preserved from v1) ────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); }
  catch { data = { title: 'Nexo Vendas', body: event.data.text(), url: '/crm/conversations' }; }

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Nexo Vendas', {
      body:             data.body,
      icon:             '/icon-192.png',
      badge:            '/icon-192.png',
      vibrate:          [200, 100, 200],
      data:             { url: data.url || '/crm/conversations' },
      requireInteraction: true,
      tag:              data.tag || 'msg',
      renotify:         true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/crm/conversations';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('/crm') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
