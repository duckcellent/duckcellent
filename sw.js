// Duckcellent service worker: lets the app open offline once it has been loaded.
// It never touches /api/ calls, sign-in traffic or payments: those always go straight to the network.
const CACHE = 'duckcellent-v2';
const SHELL = ['/', '/favicon.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;
  // Pages: network first so updates arrive, cache as the offline fallback.
  // Only the app itself is stored as '/', so other pages (like /delete-account) never replace it.
  if (req.mode === 'navigate') {
    const isApp = url.pathname === '/' || url.pathname === '/index.html';
    e.respondWith(
      fetch(req).then(r => { if (r && r.ok && isApp) { const copy = r.clone(); caches.open(CACHE).then(c => c.put('/', copy)); } return r; })
        .catch(() => isApp ? caches.match('/') : caches.match(req).then(hit => hit || caches.match('/')))
    );
    return;
  }
  // Own files and Google Fonts: cache first, fill the cache as they are used.
  if (url.origin === location.origin || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        if (r && (r.ok || r.type === 'opaque')) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return r;
      }))
    );
  }
});
