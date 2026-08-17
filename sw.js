// Offline shell for the installed game. Every asset URL is versioned by the
// deploy stamp (?v=N on index.html's script and every module import), so
// cached entries are immutable: cache-first is always safe for them.
// Navigations go network-first so a new deploy shows on the next visit, with
// the cached page as the offline fallback. deploy.mjs replaces __BUILD__ with
// the build version; each deploy therefore installs a fresh worker and drops
// the previous build's cache on activation.
const CACHE = 'onisolo-__BUILD__';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      try {
        const fresh = await fetch(req);
        cache.put('__page__', fresh.clone());
        return fresh;
      } catch {
        return (await cache.match('__page__')) || Response.error();
      }
    }
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  })());
});
