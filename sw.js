// Service worker: jaringan dulu, cache sebagai cadangan (aplikasi tetap terbuka saat offline).
const V = 'swl-v6';
const SHELL = ['./', 'index.html', 'manifest.json', 'css/themes.css', 'css/main.css',
  'js/app.js', 'js/core.js', 'js/db.js', 'js/github.js', 'js/sync.js', 'js/store.js',
  'js/ui.js', 'js/map.js', 'js/dashboard.js', 'js/search.js', 'js/forms.js', 'js/parts.js', 'js/bom.js',
  'js/sheets.js', 'js/xlsx.js', 'js/users.js', 'js/report.js', 'js/scanner.js', 'js/qr.js', 'js/opname.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // API GitHub tidak di-cache
  e.respondWith(
    fetch(e.request)
      .then((r) => { if (r.ok) { const copy = r.clone(); caches.open(V).then((c) => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('index.html')))
  );
});
