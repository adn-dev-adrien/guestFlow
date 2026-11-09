/*
 * « Mon séjour » service worker (specs/guest-app.md rules 21, 52).
 *
 * - The shell (the page, its hashed assets, the fonts, the default photo) is served from the cache, refreshed
 *   in the background: the app opens without network.
 * - The booklet and what a session reads to show it (`/me`, `/lodging`, `/booklet…`) are read from the
 *   network first and from the cache without it; the photos (`/uploads/…`) stale-while-revalidate: the
 *   booklet stays readable offline.
 * - Never cached: the shop, the slots, the quote, the orders, the gate, the sessions — they always need the
 *   network and the app says so (« Connexion nécessaire »).
 * - The data cache holds at most MAX_UPLOADS photos, the oldest dropped first, and is emptied on the page's
 *   `purge` message, sent once the device holds no stay any more: nothing personal stays offline. The shell stays.
 */
const VERSION = 'mon-sejour-v1';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const NEVER = /^\/public\/v1\/guest\/(shop|orders|gate|sessions)(\/|$|\?)/;
const BOOKLET = /^\/public\/v1\/guest\/(me|lodging|booklet)(\/|$|\?)/;
const MAX_UPLOADS = 200;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(['/', '/fonts/marcellus-400.woff2', '/fonts/karla-variable.woff2', '/img/hero-domaine.jpg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The first load ran before this worker controlled the page: the page hands over what it fetched.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'purge') { event.waitUntil(caches.delete(DATA)); return; }
  if (data.type !== 'warm' || !Array.isArray(data.urls)) return;
  event.waitUntil(caches.open(SHELL).then((cache) => Promise.all(data.urls
    .filter((u) => { try { const p = new URL(u).pathname; return !p.startsWith('/public/') && !p.startsWith('/uploads/'); } catch { return false; } })
    .map((u) => cache.add(u).catch(() => null)))));
});

/** Keeps the newest MAX_UPLOADS photos of the data cache (Cache Storage lists keys in insertion order). */
async function capUploads(cache) {
  const uploads = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith('/uploads/'));
  await Promise.all(uploads.slice(0, Math.max(0, uploads.length - MAX_UPLOADS)).map((r) => cache.delete(r)));
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    // A full or refused cache never costs the guest the photo itself.
    if (response && response.ok) await cache.put(request, response.clone()).then(() => capUploads(cache)).catch(() => null);
    return response;
  }).catch(() => null);
  if (cached) { network.catch(() => null); return cached; }
  const fresh = await network;
  return fresh || new Response(JSON.stringify({ error: { code: 'NETWORK', message: 'offline' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('offline');
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (NEVER.test(path)) return;
  if (BOOKLET.test(path)) { event.respondWith(networkFirst(request, DATA).catch(() => caches.match(request))); return; }
  if (path.startsWith('/uploads/')) { event.respondWith(staleWhileRevalidate(request, DATA)); return; }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(SHELL).then((cache) => cache.put('/', copy)).catch(() => null);
      }
      return response;
    }).catch(() => caches.match('/')));
    return;
  }
  if (path.startsWith('/assets/') || path.startsWith('/fonts/') || path.startsWith('/img/') || path.startsWith('/icons/')) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(SHELL).then((cache) => cache.put(request, copy));
      }
      return response;
    })));
  }
});
