/**
 * Service Worker — PRF Estudo
 * Enables offline-first PWA experience with cache-first strategy
 */

const CACHE_NAME = 'prf-estudo-v1';
const API_CACHE = 'prf-api-v1';
const ASSETS_CACHE = 'prf-assets-v1';

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

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Refresh in background
        fetch(request).then((response) => {
          if (response && response.status === 200) {
            caches.open(ASSETS_CACHE).then((cache) => {
              cache.put(request, response);
            });
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(request).then((response) => {
        if (!response || response.status !== 200) {
          return response;
        }
        const cloned = response.clone();
        caches.open(ASSETS_CACHE).then((cache) => {
          cache.put(request, cloned);
        });
        return response;
      }).catch(() => {
        // Fallback for critical pages
        if (request.mode === 'navigate') {
          return caches.match('/');
        }
        return null;
      });
    })
  );
});

// Background sync (not critical for MVP, but future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-answers') {
    event.waitUntil(syncAnswers());
  }
});

async function syncAnswers() {
  try {
    const db = await openIndexedDB();
    const pending = await getPendingAnswers(db);
    for (const answer of pending) {
      await fetch('/api/prf/questions/answer', {
        method: 'POST',
        body: JSON.stringify(answer)
      });
    }
    await clearPendingAnswers(db);
  } catch (error) {
    console.log('[SW] Background sync failed:', error);
  }
}

console.log('[SW] Service Worker loaded');
