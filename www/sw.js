/* FRIDAY OS — Service Worker v16
   P0 FIX: offline-first HUD
   - v15 missed css/hud-v21.css, hud-agent, hud_v20, hud-shell, agent modules → broken offline styling
   - v16 adds self-hosted fonts (no CDN), bumps CACHE, includes all critical HUD assets.
   Resilient precache: one missing file never kills the whole cache.
   CDN libraries are cached so on-device AI features work offline after first use. */

const CACHE = 'friday-os-v16';

const ASSETS = [
  './', './index.html', './styles.css', './manifest.json',
  './css/hud-v21.css', './css/fonts-local.css',
  './fonts/Orbitron-500.woff2', './fonts/Orbitron-700.woff2',
  './fonts/Rajdhani-500.woff2', './fonts/Rajdhani-600.woff2',
  './fonts/JetBrainsMono-500.woff2',
  './js/app.js', './js/store.js', './js/brain.js', './js/nlp.js',
  './js/ai.js', './js/api.js', './js/device.js', './js/voice.js', './js/ui.js',
  './js/vision.js', './js/templates.js', './js/memory.js', './js/proactive.js',
  './js/nlu.js', './js/automation.js', './js/native.js', './js/coder.js',
  './js/ambient.js', './js/clarify.js', './js/embeddings.js', './js/hacker.js',
  './js/health.js', './js/i18n.js', './js/localbrain.js', './js/semantic.js',
  './js/vault.js', './js/server.js',
  './js/airouter.js', './js/workflow.js',
  './js/notesx.js', './js/docai.js', './js/knowledge.js', './js/plannerx.js',
  './js/studyx.js', './js/guardian.js', './js/plugins.js', './js/uix.js',
  './js/devconsole.js', './js/suit.js', './js/herald.js', './js/fridaycore.js', './js/ignite.js', './js/hud.js', './js/vox.js',
  './js/memex.js', './js/visionx.js', './js/autox.js',
  './js/planx.js', './js/intelx.js', './js/devx.js',
  './js/secx.js', './js/perfx.js', './js/cinex.js',
  /* P0 FIX: HUD real-data engine + agent HUD + shell were missing */
  './js/hud_v20.js', './js/hud-agent.js', './js/hud-shell.js',
  './js/agent/agentState.js', './js/agent/orchestrator.js', './js/agent/verification.js',
  './js/action-device.js', './js/boot-runtime.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

/* Never cache: live data / auth'd API calls */
const NO_CACHE = [
  'api.groq.com',
  'api.open-meteo.com',
  'air-quality-api.open-meteo.com',
  'nominatim.openstreetmap.org',
  'api.dictionaryapi.dev',
  'open.er-api.com',
  'api.rss2json.com',
  'api.mymemory.translated.net',
  'dummyjson.com'
];

/* Cross-origin hosts whose scripts/models SHOULD be cached (offline AI) */
const CACHEABLE_CDN = ['cdn.jsdelivr.net', 'huggingface.co'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
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

  // Navigation: network first, cached shell offline
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

  // Static + AI CDN: cache first, revalidate in background
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const cacheable = res => res && res.status === 200 &&
      (res.type === 'basic' || CACHEABLE_CDN.some(h => url.hostname === h));
    const network = fetch(req).then(res => {
      if (cacheable(res)) {
        caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {});
      }
      return res;
    }).catch(() => null);

    if (cached) {
      network.catch(() => {}); // background refresh, ignore failures
      return cached;
    }
    return (await network) ||
      new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
