// Offline support: cache the app shell and engine, serve from cache first,
// refresh the cache in the background. The build script fills in the file list.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `flg-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('flg-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Video is streamed with range requests; let the browser handle it directly.
  if (req.headers.has('range') || new URL(req.url).pathname.includes('/media/')) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || new Response('Offline', { status: 503 });
  }));
});
