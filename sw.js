// Life OS Service Worker
// CACHE_NAME uses ISO date — update on every deploy to bust cache

const CACHE_NAME = 'lifeos-2026-04-19';

// Files to cache on install — the complete app shell
const CACHE_FILES = [
  './lifeOS.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;1,9..144,300&family=DM+Sans:wght@300;400;500&display=swap'
];

// ── Install: cache app shell ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache what we can — don't fail install if fonts are unavailable
      return cache.addAll(CACHE_FILES).catch(err => {
        console.warn('[SW] Some files failed to cache:', err);
        // At minimum cache the HTML
        return cache.add('./lifeOS.html');
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache, fall back to network ────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Let Anthropic API calls go straight to network — never cache
  if (url.hostname === 'api.anthropic.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Let Google Fonts go to network with cache fallback
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
      )
    );
    return;
  }

  // App shell: cache first, network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful GET responses
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // If both cache and network fail, return the cached app shell
        return caches.match('./lifeOS.html');
      });
    })
  );
});

// ── Share Target handler ──────────────────────────────
// Handles "Share to Life OS" from other apps (when PWA manifest share_target is active)
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && event.request.url.includes('share_text')) {
    const url    = new URL(event.request.url);
    const text   = url.searchParams.get('share_text') || '';
    const shared = url.searchParams.get('share_url')  || '';

    // Store shared content for the app to pick up
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SHARE_TARGET', text, url: shared });
        });
      })
    );

    // Redirect to app
    event.respondWith(Response.redirect('./lifeOS.html', 302));
  }
});

// ── Push notifications ────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Life OS', {
      body:    data.body    || 'Time to check in.',
      icon:    './icon-192.png',
      badge:   './icon-192.png',
      vibrate: [200, 100, 200],
      data:    { url: data.url || './lifeOS.html' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow(event.notification.data?.url || './lifeOS.html')
  );
});
