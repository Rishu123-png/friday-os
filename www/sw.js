/* FRIDAY OS — Service Worker v6
   Resilient precache: one missing file never kills the whole cache. */

const CACHE = 'friday-os-v6-1';

const ASSETS = [
  './', './index.html', './styles.css', './manifest.json',
  './js/app.js', './js/store.js', './js/brain.js', './js/nlp.js',
  './js/ai.js', './js/api.js', './js/device.js', './js/voice.js', './js/ui.js',
  './js/vision.js', './js/templates.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

// Never cache these (live data / auth)
const NO_CACHE = [
  'api.groq.com',
  'api.open-meteo.com',
  'air-quality-api.open-meteo.com',
  'nominatim.openstreetmap.org',
  'api.dictionaryapi.dev',
  'open.er-api.com',
  'api.rss2json.com',
  'api.mymemory.translated.net',
  'api.quotable.io'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // add individually so a single 404 doesn't reject everything
    await Promise.all(ASSETS.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(err =>
        console.warn('[sw] skip', url, err.message))
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (NO_CACHE.some(h => url.hostname.includes(h))) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Navigation: network first, fall back to cached shell
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        return (await caches.match('./index.html')) ||
               new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // Static: cache first, revalidate in background
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {});
      }
      return res;
    }).catch(() => null);

    return cached || (await network) ||
      new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
