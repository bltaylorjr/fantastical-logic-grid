// Book Studio as an installed app. Built by book-studio/build.mjs: do not edit here.
// The studio's own files are kept so it opens offline; each visit fetches
// them fresh when there is a connection. The API and sign-in are never kept.
const CACHE = 'book-studio-faad429e303d';
const SHELL = ["./","studio.css","studio.js","manifest.webmanifest","vendor/fabric.min.js","vendor/jspdf.umd.min.js","vendor/html2canvas.min.js","vendor/jszip.min.js","vendor/mammoth.browser.min.js","vendor/pdf.min.js","vendor/pdf.worker.min.js","vendor/pako.min.js","vendor/UTIF.js","vendor/marked.min.js","/admin/passkeys.js","/admin/books.js","/admin/icon.svg","/admin/icon-192.png"];
const HERE = new URL('./', self.location).pathname;
const KEEP = new Set(SHELL.map((f) => new URL(f, self.location).pathname));

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('book-studio-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const page = e.request.mode === 'navigate' && url.pathname === HERE;
  if (!page && !KEEP.has(url.pathname)) return;
  const key = page ? HERE : url.pathname;
  // The libraries change only with a new version: from the cache first.
  if (url.pathname.startsWith(HERE + 'vendor/')) {
    e.respondWith(caches.match(key).then((hit) => hit || fetch(e.request)));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key).then((hit) => hit || Response.error())));
});
