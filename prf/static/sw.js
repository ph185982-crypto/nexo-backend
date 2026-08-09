/**
 * Service Worker — PRF Estudo
 * Enables offline-first PWA experience with cache-first strategy
 */

const CACHE_NAME = 'prf-estudo-v2';
const API_CACHE = 'prf-api-v2';
const ASSETS_CACHE = 'prf-assets-v2';

const CRITICAL_ASSETS = [
  '/',
  '/app',
  '/manifest.json',
  '/sw.js'
];

// Install: cache critical assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching critical assets');
      return cache.addAll(CRITICAL_ASSETS).catch(() => {
        console.log('[SW] Some assets could not be cached (expected on first run)');
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== API_CACHE && name !== ASSETS_CACHE)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for assets, network-first for API
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // API requests: network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          // Clone and cache
          const cloned = response.clone();
          caches.open(API_CACHE).then((cache) => {
            cache.put(request, cloned);
          });
          return response;
        })
        .catch(() => {
          // Network failed, try cache
          return caches.match(request).then((cached) => {
            if (cached) {
              console.log('[SW] Serving from cache:', request.url);
              return cached;
            }
            // No cache, return offline response
            return new Response(
              JSON.stringify({
                error: 'Offline — no cached data available',
                offline: true
              }),
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: new Headers({
                  'Content-Type': 'application/json'
                })
              }
            );
          });
        })
    );
    return;
  }

  // Navigation requests (HTML pages): network-first so deploys take effect immediately
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response && response.status === 200) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        }
        return response;
      }).catch(() => caches.match(request).then((c) => c || caches.match('/')))
    );
    return;
  }

  // Other static assets (icons, manifest): cache-first with background refresh
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (response && response.status === 200) {
          const cloned = response.clone();
          caches.open(ASSETS_CACHE).then((cache) => cache.put(request, cloned));
        }
        return response;
      });
      return cached || networkFetch.catch(() => null);
    })
  );
});

// A fila de respostas offline vive no app (localStorage), não aqui — o
// listener 'sync' chamava funções (openIndexedDB, getPendingAnswers,
// clearPendingAnswers) que nunca existiram neste arquivo, então nunca
// rodava de verdade. Removido em vez de manter código morto.

// ─── Notificações push ──────────────────────────────────────────────────────
// O servidor manda o lembrete cifrado; aqui ele vira notificação na tela.
// É esta parte que faz a cobrança chegar com o app fechado.

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: 'Estudo PRF', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Estudo PRF';
  const options = {
    body: payload.body || '',
    tag: payload.tag || 'prf',
    // Sem renotify uma cobrança nova substitui a anterior em silêncio.
    renotify: true,
    badge: '/manifest.json',
    data: { url: payload.url || '/' },
    vibrate: [80, 40, 80]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  // Reaproveita a aba já aberta em vez de abrir outra a cada lembrete.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ('focus' in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});

console.log('[SW] Service Worker loaded');
