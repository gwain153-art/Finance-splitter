/* Clean Cut service worker. All paths are relative to this file's scope,
   so it works at a domain root (Netlify) or under a sub-path (GitHub Pages). */
const VERSION = 'cc-v10-2026-10-08';
const PREFIX = 'cc-';

const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'css/fonts.css',
  'js/app.js',
  'js/state.js',
  'js/audio.js',
  'js/haptics.js',
  'js/bg.js',
  'js/fx.js',
  'js/progress.js',
  'js/score.js',
  'js/money.js',
  'js/pwa.js',
  'js/bankrun.js',
  'js/coach.js',
  'js/theme.js',
  'js/banknote.js',
  'js/vaultdoor.js',
  'css/bankrun.css',
  'css/vaultdoor.css',
  'manifest.webmanifest',
  'icons/logo.svg',
  'icons/favicon.svg',
  'icons/favicon-32.png',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'fonts/big-shoulders-display-latin.woff2',
  'fonts/figtree-latin.woff2',
  'fonts/jetbrains-mono-latin.woff2',
];

// Splash images are large (~0.3-0.8 MB each); iOS fetches only the matching one.
// Cache them lazily on first request instead of precaching all ten.

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Add each file on its own so one missing file never fails the install.
    await Promise.all(SHELL.map(async (path) => {
      try {
        const req = new Request(path, { cache: 'reload' });
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res);
      } catch (_) { /* tolerate missing / offline */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith(PREFIX) && k !== VERSION)
      .map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page and code always come from the same version: network first for HTML, JS, CSS and the
  // manifest, cache only when offline. Fonts, icons and images stay cache-first-ish (they don't change).
  if (req.mode === 'navigate' || /\.(?:html|js|mjs|css|webmanifest)$/.test(url.pathname)) {
    event.respondWith(networkFirst(event));
  } else {
    event.respondWith(staleWhileRevalidate(event));
  }
});

async function networkFirst(event) {
  const req = event.request;
  const cache = await caches.open(VERSION);
  try {
    const preload = req.mode === 'navigate' && event.preloadResponse ? await event.preloadResponse : null;
    const res = preload || await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit || req.mode !== 'navigate') return hit || new Response('', { status: 503 });
    return (await cache.match('index.html'))
      || (await cache.match('./'))
      || new Response('<h1>Offline</h1>', { status: 503, headers: { 'Content-Type': 'text/html' } });
  }
}

async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then((res) => {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  return (await network) || new Response('', { status: 504 });
}
