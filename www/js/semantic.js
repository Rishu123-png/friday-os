/* ===== FRIDAY OS — Semantic Memory + Meaning Router (M1, v10.0 JARVIS) =====
   On-device embeddings via the EXISTING llama.cpp engine (bge-small, ~30MB).
   Everything local-only (privacy charter). Powers:
     1. semantic memory: "meri bike ka number kya tha?" -> recall by MEANING
     2. meaning router: understand paraphrased commands, feed C1 suggestions

   Pure parts are unit-tested; the runtime part degrades honestly:
   no model downloaded -> semantic features simply stay off. */

import * as NAT from './native.js';
import { getSetting, setSetting, getList, saveList } from './store.js';

/* ---------- pure vector math (unit-tested) ---------- */

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** top-K items by cosine to `q`. items = [{vec, ...}] */
export function topK(q, items, k = 3) {
  const scored = [];
  for (let i = 0; i < items.length; i++) {
    const s = cosine(q, items[i].vec);
    if (s > 0) scored.push({ item: items[i], score: s });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, k);
}

/** Float32Array -> compact base64 (storage-friendly) and back. */
export function vecToB64(vec) {
  const f = vec instanceof Float32Array ? vec : new Float32Array(vec);
  const u8 = new Uint8Array(f.buffer);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

export function b64ToVec(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Float32Array(u8.buffer);
}

/** router decision bands (research-backed: clarify between, act above) */
export function routeDecision(score) {
  if (score >= 0.75) return 'auto';
  if (score >= 0.50) return 'suggest';
  return 'none';
}

/* ---------- runtime: vector store ---------- */

const VECS_KEY = 'semantic_vecs';
const ROUTER_KEY = 'semantic_router';
const MAX_VECS = 800;

export function loadVeclist() {
  try { return getList(VECS_KEY) || []; } catch (_) { return []; }
}

function saveVeclist(list) {
  while (list.length > MAX_VECS) list.shift();
  try { saveList(VECS_KEY, list); } catch (_) {}
}

export function semanticMemorySize() { return loadVeclist().length; }

/* ---------- runtime: embedding engine bridge ---------- */

export async function embedStatus() {
  if (!NAT.isNative() || !NAT.llmAvailable()) return { ok: false, reason: 'engine_missing' };
  return NAT.llmStatus(); // carries embedLoaded since v10.0
}

/** Load the embedding model lazily from the stored path (or the default
    HF download: bge-small q8, ~30MB, English+Hinglish-friendly). */
export async function ensureEmbedModel() {
  if (!NAT.isNative() || !NAT.llmAvailable()) return { ok: false, reason: 'engine_missing' };
  const path = (getSetting('embedModelPath') || '').trim();
  if (!path) return { ok: false, reason: 'no_model' };
  const st = await NAT.llmStatus();
  if (st && st.embedLoaded && st.embedPath === path) return { ok: true };
  const r = await NAT.llmEmbedLoad(path);
  return r && r.ok ? { ok: true } : { ok: false, reason: (r && r.reason) || 'load_failed' };
}

export async function embedText(text) {
  const ready = await ensureEmbedModel();
  if (!ready.ok) return { ok: false, reason: ready.reason };
  return NAT.llmEmbed(String(text || '').slice(0, 900));
}

/* ---------- semantic memory ---------- */

/** facts worth remembering get embedded here (called from memory hooks). */
export async function rememberSemantic(text, meta = {}) {
  const r = await embedText(text);
  if (!r || !r.ok || !r.vec) return false;
  const list = loadVeclist();
  list.push({ vec: vecToB64(r.vec), text: String(text).slice(0, 300), meta, at: Date.now() });
  saveVeclist(list);
  return true;
}

/** recall up to k most-meaningful memories for a query. */
export async function recallSemantic(query, k = 3, minScore = 0.45) {
  const r = await embedText(query);
  if (!r || !r.ok || !r.vec) return [];
  const items = loadVeclist().map(v => ({ ...v, vec: b64ToVec(v.vec) }));
  return topK(r.vec, items, k)
    .filter(h => h.score >= minScore)
    .map(h => ({ text: h.item.text, meta: h.item.meta, score: Math.round(h.score * 100) / 100 }));
}

/* ---------- meaning router (v2 backend for C1 suggestions) ---------- */

/** Caches embedded command examples; trains lazily on first route() call. */
async function ensureRouterTrained(examples) {
  try {
    const cached = JSON.parse(localStorage.getItem(ROUTER_KEY) || 'null');
    if (cached && cached.n === examples.length && cached.dims) return cached;
  } catch (_) {}
  const out = { n: examples.length, dims: 0, items: [] };
  for (const ex of examples) {
    const r = await embedText(ex.utter);
    if (!r || !r.ok || !r.vec) return null;   // model missing -> router silent
    out.dims = r.vec.length;
    out.items.push({ vec: vecToB64(r.vec), label: ex.label, utter: ex.utter });
  }
  try { localStorage.setItem(ROUTER_KEY, JSON.stringify(out)); } catch (_) {}
  return out;
}

/** Route a command by MEANING. Returns {label, utter, score, decision} or null. */
export async function routeByMeaning(text, examples) {
  if (!(getSetting('embedModelPath') || '').trim()) return null;
  const trained = await ensureRouterTrained(examples);
  if (!trained || !trained.items.length) return null;
  const r = await embedText(text);
  if (!r || !r.ok || !r.vec) return null;
  const items = trained.items.map(v => ({ ...v, vec: b64ToVec(v.vec) }));
  const best = topK(r.vec, items, 1)[0];
  if (!best) return null;
  const score = Math.round(best.score * 100) / 100;
  return { label: best.item.label, utter: best.item.utter, score, decision: routeDecision(score) };
}

/** one-tap model setup from Settings (bge-small q8 via the HF downloader). */
export async function downloadEmbedModel(onProgress) {
  if (!NAT.isNative()) return { ok: false, reason: 'web' };
  const r = await NAT.hfDownload({ repo: 'CompendiumLabs/bge-small-en-v1.5-gguf', dest: 'bge-small' });
  if (!r || !r.ok || !r.dir) return { ok: false, reason: (r && r.reason) || 'download_failed' };
  const files = r.files || [];
  let gg = 'bge-small-en-v1.5-q8_0.gguf';
  let found = false;
  for (const f of files) { if (f === gg) { found = true; break; } }
  if (!found) for (const f of files) { if (/\.gguf$/i.test(f)) { gg = f; found = true; break; } }
  if (!found) return { ok: false, reason: 'no_gguf' };
  const path = r.dir + '/' + gg;
  setSetting('embedModelPath', path);
  return { ok: true, path };
}
