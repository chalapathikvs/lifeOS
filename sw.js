// Life OS Service Worker
// CACHE_NAME uses ISO date — update on every deploy to bust cache

const CACHE_NAME = 'lifeos-2026-09-06';

// Files to cache on install — everything EXCEPT lifeOS.html (network-first)
const CACHE_FILES = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;1,9..144,300&family=DM+Sans:wght@300;400;500&display=swap'
];

// ── Install: cache app shell ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(CACHE_FILES).catch(err => {
        console.warn('[SW] Some files failed to cache:', err);
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

// ── Fetch: network-first for HTML, cache-first for assets ────
self.addEventListener('fetch', event => {
  // ?nocache=1 bypass — skip SW entirely, go straight to network
  if (event.request.url.includes('nocache=1')) {
    event.respondWith(fetch(event.request));
    return;
  }
  const url = new URL(event.request.url);

  // Let API calls go straight to network — never cache
  if (url.hostname === 'api.anthropic.com' ||
      url.hostname === 'api.groq.com' ||
      url.hostname === 'generativelanguage.googleapis.com' ||
      url.hostname === 'api.openai.com' ||
      url.hostname === 'api.perplexity.ai') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Google Fonts: cache-first
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

  // lifeOS.html: NETWORK FIRST — always get latest when online
  if (url.pathname.endsWith('lifeOS.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request).then(response => {
        // Update cache with fresh version
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback to cache
        return caches.match(event.request) || caches.match('./lifeOS.html');
      })
    );
    return;
  }

  // Everything else: cache-first, network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('./lifeOS.html'));
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
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing window if open
      const existing = clients.find(c => c.url.includes('lifeOS'));
      if (existing) return existing.focus();
      return self.clients.openWindow(event.notification.data?.url || './lifeOS.html');
    })
  );
});

// ── Version check — lets the HTML detect stale SW ────
self.addEventListener('message', event => {
  if (event.data?.type === 'GET_CACHE_NAME') {
    event.ports[0]?.postMessage(CACHE_NAME);
  }
});
