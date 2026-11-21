// Lyricly service worker: keeps the app shell cached so the home-screen app opens fast.
// Network-first for our own files, always bypassing the HTTP cache (GitHub Pages sends
// max-age=600, which would otherwise keep phones on an old version). Cache is only the
// offline fallback. Third-party requests (YouTube, lyrics, translation) are never touched.
const VERSION = 6;
const CACHE = `lyricly-v${VERSION}`;
const SHELL = ['./', './index.html', `./style.css?v=${VERSION}`, `./app.js?v=${VERSION}`, './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => r || caches.match('./index.html')))
  );
});
