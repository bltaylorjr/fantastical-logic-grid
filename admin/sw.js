// Lets the admin dashboard install as a phone or desktop app. It always goes to
// the network; the app's own files are kept only so it can say it is offline.
// The API (/admin/v1) and sign-in are never stored.
//
// It also shows the owner's push alerts (server/src/alerts.js) and opens the
// right part of the dashboard when one is tapped.
const CACHE = 'flg-admin-v3';
const SHELL = ['/admin/', '/admin/admin.css', '/admin/admin.js', '/admin/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !SHELL.includes(url.pathname)) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'Logic Grid', body: e.data ? e.data.text() : '' }; }
  const link = /^[\w-]{0,40}$/.test(data.link || '') ? data.link : '';
  e.waitUntil(self.registration.showNotification(data.title || 'Logic Grid dashboard', {
    body: data.body || 'Something needs you in the dashboard.',
    icon: '/admin/icon-192.png',
    badge: '/admin/icon-192.png',
    tag: data.tag || 'flg-alert',
    renotify: true,
    data: { url: `/admin/${link ? `#${link}` : ''}` },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/admin/', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(`${location.origin}/admin/`));
    if (open) return open.focus().then((c) => (c && 'navigate' in c ? c.navigate(url) : c));
    return self.clients.openWindow(url);
  }));
});
