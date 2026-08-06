/* ===== FRIDAY OS — Keyless Data APIs =====
   Every endpoint here is FREE, requires NO API KEY, and is CORS-open.
   All responses cached so they degrade gracefully offline. */

import { cacheGet, cacheSet } from './store.js';

const j = async (url, opts = {}) => {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' }, ...opts });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
};

/* ---------- Location ---------- */
export function getPosition(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No geolocation'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      e => reject(e),
      { enableHighAccuracy: false, timeout, maximumAge: 600000 }
    );
  });
}

/** Falls back to Delhi if GPS denied */
export async function resolveLocation() {
  const cached = cacheGet('location', true);
  try {
    const pos = await getPosition();
    cacheSet('location', pos, 60);
    return pos;
  } catch (e) {
    if (cached) return cached;
    return { lat: 28.6139, lon: 77.2090, fallback: true, label: 'New Delhi' };
  }
}

export async function reverseGeocode(lat, lon) {
  const key = `rev_${lat.toFixed(2)}_${lon.toFixed(2)}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const d = await j(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12`);
    const a = d.address || {};
    const name = a.suburb || a.city || a.town || a.village || a.county || a.state || 'your location';
    cacheSet(key, name, 1440);
    return name;
  } catch (_) { return 'your location'; }
}

export async function geocodeCity(name) {
  const d = await j(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`);
  if (!d.results || !d.results.length) throw new Error('City not found');
  const r = d.results[0];
  return { lat: r.latitude, lon: r.longitude, label: `${r.name}, ${r.country_code}` };
}

/* ---------- Weather (Open-Meteo — no key, CORS open) ---------- */
const WMO = {
  0: ['Clear sky', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Foggy', '🌫️'], 48: ['Icy fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
  56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '⛈️'],
  66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '❄️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
  80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'],
  85: ['Snow showers', '🌨️'], 86: ['Snow showers', '🌨️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm w/ hail', '⛈️'], 99: ['Severe thunderstorm', '⛈️']
};
export const describeWMO = c => WMO[c] || ['Unknown', '🌡️'];

export async function getWeather(lat, lon) {
  const key = `wx_${lat.toFixed(2)}_${lon.toFixed(2)}`;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&forecast_days=7`;
  try {
    const d = await j(url);
    cacheSet(key, d, 30);
    return d;
  } catch (e) {
    const hit = cacheGet(key, true);
    if (hit) return { ...hit, _stale: true };
    throw e;
  }
}

export async function getAQI(lat, lon) {
  const key = `aqi_${lat.toFixed(2)}_${lon.toFixed(2)}`;
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&current=pm10,pm2_5,us_aqi&timezone=auto`;
  try {
    const d = await j(url);
    cacheSet(key, d, 30);
    return d;
  } catch (e) {
    const hit = cacheGet(key, true);
    if (hit) return { ...hit, _stale: true };
    throw e;
  }
}

export function aqiLabel(v) {
  if (v == null) return ['Unknown', '⚪'];
  if (v <= 50) return ['Good', '🟢'];
  if (v <= 100) return ['Moderate', '🟡'];
  if (v <= 150) return ['Unhealthy for sensitive groups', '🟠'];
  if (v <= 200) return ['Unhealthy', '🔴'];
  if (v <= 300) return ['Very unhealthy', '🟣'];
  return ['Hazardous', '🟤'];
}

/* ---------- Wikipedia (knowledge, no key) ---------- */
/* ---------- v9.0 APEX: keyless image forge (A1) ---------- */
/** pollinations.ai is free/keyless - returns a direct image URL. Pure helper. */
export function pollinationsUrl(prompt, { w = 1080, h = 1920, seed = null } = {}) {
  const p = encodeURIComponent(String(prompt || 'futuristic AI core, dark').trim().slice(0, 300));
  const s = seed === null ? Math.floor(Math.random() * 99999) : seed;
  return `https://image.pollinations.ai/prompt/${p}?width=${w}&height=${h}&nologo=true&seed=${s}&model=flux`;
}

/** Downloads the image as a data URL (needed for the native wallpaper call). */
export async function fetchImageDataUrl(url, timeout = 45000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error('img_http_' + res.status);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => resolve(rd.result);
      rd.onerror = () => reject(new Error('img_read'));
      rd.readAsDataURL(blob);
    });
  } finally { clearTimeout(t); }
}

/* ---------- v9.0 APEX: article extraction for read-aloud (A9) ---------- */
/** Keyless readability proxy: r.jina.ai turns any URL into clean markdown. */
export async function fetchReadableUrl(url, timeout = 25000) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, reason: 'bad_url' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch('https://r.jina.ai/' + u, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, reason: 'http_' + res.status };
    let text = (await res.text()).replace(/\[(?:Image|Link)\s*\d*[^\]]*\]\([^)]*\)/g, ' ').trim();
    if (!text) return { ok: false, reason: 'empty' };
    const firstLine = text.split('\n').map(x => x.trim()).find(x => x.length > 10) || '';
    return { ok: true, text: text.slice(0, 12000), title: firstLine.replace(/^#\s+/, '').slice(0, 120) };
  } catch (e) { clearTimeout(t); return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : 'network' }; }
}

export async function wikiSummary(query) {
  const key = 'wiki_' + query.toLowerCase().slice(0, 40);
  const hit = cacheGet(key, true);
  try {
    const d = await j(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
    if (d.type === 'disambiguation' || !d.extract) throw new Error('ambiguous');
    const out = { title: d.title, extract: d.extract, url: d.content_urls?.mobile?.page, thumb: d.thumbnail?.source };
    cacheSet(key, out, 10080);
    return out;
  } catch (e) {
    if (hit) return { ...hit, _stale: true };
    // fall back to search
    const s = await wikiSearch(query);
    if (s.length) return wikiSummary(s[0].title);
    throw e;
  }
}

export async function wikiSearch(query, limit = 5) {
  try {
    const d = await j(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=${limit}`);
    return (d.query?.search || []).map(r => ({
      title: r.title,
      snippet: r.snippet.replace(/<[^>]+>/g, ''),
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`
    }));
  } catch (_) { return []; }
}

/* ---------- Dictionary ---------- */
export async function define(word) {
  const key = 'def_' + word.toLowerCase();
  const hit = cacheGet(key, true);
  try {
    const d = await j(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    const e = d[0];
    const out = {
      word: e.word,
      phonetic: e.phonetic || e.phonetics?.find(p => p.text)?.text || '',
      audio: e.phonetics?.find(p => p.audio)?.audio || '',
      meanings: e.meanings.slice(0, 3).map(m => ({
        pos: m.partOfSpeech,
        def: m.definitions[0].definition,
        example: m.definitions[0].example || ''
      }))
    };
    cacheSet(key, out, 10080);
    return out;
  } catch (e) {
    if (hit) return hit;
    throw new Error('No definition found');
  }
}

/* ---------- Currency ---------- */
export async function rates(base = 'USD') {
  const key = 'fx_' + base;
  const hit = cacheGet(key, true);
  try {
    const d = await j(`https://open.er-api.com/v6/latest/${base}`);
    cacheSet(key, d.rates, 720);
    return d.rates;
  } catch (e) {
    if (hit) return hit;
    throw e;
  }
}

export async function convertCurrency(amount, from, to) {
  const r = await rates(from.toUpperCase());
  const rate = r[to.toUpperCase()];
  if (!rate) throw new Error('Unknown currency');
  return { value: amount * rate, rate };
}

/* ---------- News (RSS, no key) ---------- */
export async function news(topic = '') {
  const feed = topic
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-IN&gl=IN&ceid=IN:en`
    : `https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en`;
  const key = 'news_' + (topic || 'top');
  const hit = cacheGet(key, true);
  try {
    const d = await j(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}`);
    const items = (d.items || []).slice(0, 8).map(i => ({
      title: i.title.replace(/\s+-\s+[^-]+$/, ''),
      source: i.title.match(/-\s+([^-]+)$/)?.[1] || '',
      link: i.link,
      date: i.pubDate
    }));
    cacheSet(key, items, 30);
    return items;
  } catch (e) {
    if (hit) return hit;
    throw e;
  }
}

/* ---------- Quotes ---------- */
/* quotable.io went offline; dummyjson is keyless, CORS-open and stable. */
export async function quote() {
  const hit = cacheGet('quote_of_day');
  if (hit) return hit;
  try {
    const d = await j('https://dummyjson.com/quotes/random');
    const out = { text: d.quote, author: d.author };
    cacheSet('quote_of_day', out, 720);   // one quote per 12 h
    return out;
  } catch (_) {
    return { text: 'Sometimes you gotta run before you can walk.', author: 'Tony Stark' };
  }
}

/* ---------- Translate (LibreTranslate mirrors / MyMemory — keyless) ---------- */
export async function translate(text, from = 'auto', to = 'en') {
  // v10.1 fix: "auto" actually detects the script instead of assuming English
  const src = from === 'auto' ? (/[ऀ-ॿ]/.test(text) ? 'hi' : 'en') : from;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${src}|${to}`;
  const d = await j(url);
  const out = d.responseData?.translatedText;
  if (!out) throw new Error('Translation failed');
  return out;
}

/* ---------- v7.5: quick inline translate (keyless MyMemory, 10k chars/day) ---------- */
const TR_LANGS = {
  hindi: 'hi', hinglish: 'hi', english: 'en', spanish: 'es', french: 'fr',
  german: 'de', japanese: 'ja', arabic: 'ar', chinese: 'zh-CN', punjabi: 'pa',
  tamil: 'ta', telugu: 'te', bengali: 'bn', urdu: 'ur', marathi: 'mr',
  gujarati: 'gu', kannada: 'kn', malayalam: 'ml', russian: 'ru'
};

export async function quickTranslate(text, targetName) {
  const target = TR_LANGS[String(targetName || '').toLowerCase()];
  if (!target) return { ok: false, reason: 'lang' };
  try {
    const src = /[ऀ-ॿ]/.test(text) ? 'hi' : 'en';
    if (src === target) return { ok: true, text };
    const url = 'https://api.mymemory.translated.net/get?q='
      + encodeURIComponent(String(text).slice(0, 450)) + '&langpair=' + src + '|' + target;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    const j = await r.json();
    const t = j && j.responseData && j.responseData.translatedText;
    if (!t) return { ok: false, reason: 'empty' };
    return { ok: true, text: t };
  } catch (e) { return { ok: false, reason: 'network' }; }
}

/* ---------- v7.6: Perplexity-lite - web-grounded answers with sources ---------- */
/** Gather: wiki summary + top news headlines + links, all keyless. */
export async function deepResearch(query) {
  const out = { summary: null, headlines: [], sources: [] };
  try {
    const w = await wikiSummary(query).catch(() => null);
    if (w && w.extract) {
      out.summary = w.extract;
      if (w.url) out.sources.push({ title: 'Wikipedia', url: w.url });
    }
  } catch (_) {}
  try {
    const rss = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query)
      + '&hl=en-IN&gl=IN&ceid=IN:en';
    /* v10.1: fetch through FRIDAY Cloud when configured (public proxies are flaky) */
    const SERVER = await import('./server.js');
    let xml = '';
    if (SERVER.isConfigured()) {
      const r = await SERVER.fetchRaw(rss);
      xml = (r && r.ok && r.text) || '';
    } else {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(rss), { signal: ctrl.signal });
      clearTimeout(to);
      xml = await r.text();
    }
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const items = [...doc.querySelectorAll('item')].slice(0, 4);
    for (const it of items) {
      const title = it.querySelector('title')?.textContent || '';
      const link = it.querySelector('link')?.textContent || '';
      if (title) {
        out.headlines.push(title);
        if (link && out.sources.length < 4) out.sources.push({ title: title.slice(0, 60), url: link });
      }
    }
  } catch (_) {}
  return out;
}
