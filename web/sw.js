// Offline support: cache the app shell and engine and serve them from the cache.
// The build script fills in the version and the file list.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `flg-${VERSION}`;

self.addEventListener('install', (e) => {
  // A first install takes over at once; an update waits until the player
  // chooses Reload (the page sends 'skip-waiting'), so a puzzle is never cut off.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => { if (!self.registration.active) return self.skipWaiting(); }));
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('flg-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Video is streamed with range requests; let the browser handle it directly.
  if (req.headers.has('range') || new URL(req.url).pathname.includes('/media/')) return;
  // The daily, weekly and special edition puzzles change: always from the network (the game keeps its own copy).
  if (/\/(daily|weekly|specials)\/.*\.json$/.test(new URL(req.url).pathname)) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    // Each version's files stay together in its own cache; new versions arrive
    // as a new service worker. Files not cached yet (voice engine) are added on first use.
    if (hit) return hit;
    const res = await fetch(req).catch(() => null);
    // Website pages (how to play, daily puzzle...) come from the network and
    // are not cached; offline, any page opens the game instead.
    if (req.mode === 'navigate') return res && res.status < 500 ? res : (await cache.match('./index.html')) || new Response('Offline', { status: 503 });
    if (res && res.ok) cache.put(req, res.clone());
    return res || new Response('Offline', { status: 503 });
  }));
});
