// Service worker: keeps the app shell available on a bad connection.
// It caches only this app's own static files and pages. It never caches Supabase responses,
// so customer and money data is never stored here (that lives in IndexedDB, wiped on logout).
const CACHE = 'sk-shell-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE)); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const isStatic = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/ocr/') || /\.(svg|woff2?|webmanifest)$/.test(url.pathname);
  if (isStatic) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (req.mode === 'navigate' || req.headers.get('RSC') || url.searchParams.has('_rsc')) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('/home')).then((hit) => hit || Response.error())));
  }
});
