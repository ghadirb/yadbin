// App-shell cache so a child can re-open the game offline / on a slow network. API calls are never cached.
const CACHE = 'yadbin-shell-v3';
const wait = (ms) => new Promise((res) => setTimeout(() => res(null), ms));
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.ico'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    // Network first, but on a slow/hanging network fall back to the cached shell after 3 s (the page is the same for every /play/{token}).
    e.respondWith((async () => {
      const cached = await caches.match('/');
      const net = fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); } return r; });
      if (!cached) return net;
      e.waitUntil(net.catch(() => {}));
      const fast = await Promise.race([net.catch(() => null), wait(3000)]);
      return fast || cached;
    })());
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })));
});
