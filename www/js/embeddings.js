/* ===== FRIDAY OS — Semantic Embeddings (on-device) =====
   transformers.js (MiniLM) lazy-loaded from CDN once, then cached by
   the service worker - meaning-based recall forever, fully offline.
   Falls back silently: if the model can't load, callers use TF-IDF. */

import { cacheGet, cacheSet } from './store.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
const MODEL = 'Xenova/all-MiniLM-L6-v2';

let extractorP = null;

async function getExtractor() {
  if (!extractorP) {
    extractorP = (async () => {
      const mod = await import(LIB);
      if (mod.env) { mod.env.allowLocalModels = false; mod.env.useBrowserCache = true; }
      return mod.pipeline('feature-extraction', MODEL, { quantized: true });
    })();
    extractorP.catch(() => { extractorP = null; });   // retry next time
  }
  return extractorP;
}

async function vecOf(text) {
  const ex = await getExtractor();
  const out = await ex(String(text).slice(0, 512), { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

const dot = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };

/* Vector cache (texts rarely change) */
const vKey = t => 'vec_' + String(t).length + '_' +
  [...String(t)].reduce((h, c) => ((h * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36);

/** Is the embedding engine ready without a download prompt? */
export async function available() {
  try { await getExtractor(); return true; } catch (_) { return false; }
}

/**
 * Rank texts by true meaning similarity.
 * @returns [{i, score}] sorted desc, or null when embeddings unavailable
 */
export async function rank(query, texts) {
  try {
    if (!texts.length) return [];
    const q = await vecOf(query);
    const scored = [];
    for (let i = 0; i < texts.length; i++) {
      const k = vKey(texts[i]);
      let v = cacheGet(k, true);
      if (!v) { v = await vecOf(texts[i]); cacheSet(k, v, 60 * 24 * 30); }
      scored.push({ i, score: dot(q, v) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
  } catch (_) { return null; }
}
