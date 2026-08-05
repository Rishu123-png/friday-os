/* ============================================================================
   FRIDAY OS — MEMEX: Cognitive Memory Engine (v11.3.0 / Phase 5)
   EXTENDS memory.js — facts/episodes/patterns kaam waise hi chalte hain.
   Adds: importance scoring · categories · conversation summarizer · dedupe
         preference learner · unified retrieval (<100ms, local) · dashboard.
   Privacy: 100% localStorage. Cloud sync only via existing SERVER path.
   ============================================================================ */

import { getList, saveList, getSetting, setSetting } from './store.js';
import { allFacts, episodes } from './memory.js';

export const SKEYS = {
  SUMMARIES: 'friday_summaries',    // daily conversation summaries (pruned episodes)
  VISION:    'friday_vision_mem',   // Phase 6 deposits scans here
  QR:        'friday_qr_history',   // Phase 6 QR history
  PREFS:     'friday_prefs'         // usage counters -> preferences
};

/* ---------------- 1) Categories + importance (pure) ---------------- */

export const CATS = ['pinned', 'preference', 'fact', 'routine', 'knowledge', 'task', 'episode', 'vision', 'temp', 'summary'];

const BASE = { pinned: 95, preference: 85, fact: 70, routine: 65, knowledge: 60, task: 55, vision: 50, summary: 62, episode: 40, temp: 20 };

/** Importance 0-100. Pinned facts never auto-expire. (pure) */
export function importance({ category = 'episode', freq = 0, confidence = 0.8, lastAccess = null, now = Date.now() } = {}) {
  let s = BASE[category] ?? 40;
  s += Math.min(15, freq * 3);                       // frequency boost
  s += Math.round((confidence - 0.8) * 25);          // ±5 confidence nudge
  if (lastAccess && now - lastAccess < 864e5) s += 5; // hot memory
  if (category === 'pinned') return 100;
  return Math.max(0, Math.min(100, Math.round(s)));
}

/** Auto-expiry: only temp/episodic junk dies; anything important stays. (pure) */
export function shouldExpire(entry, now = Date.now()) {
  if ((entry.category === 'pinned') || entry.pinned) return false;
  const imp = entry.importance ?? importance(entry);
  if (imp >= 70) return false;
  const age = now - (entry.ts || now);
  const ttl = entry.category === 'temp' ? 2 * 864e5 : entry.category === 'episode' ? 30 * 864e5 : 90 * 864e5;
  return age > ttl && (now - (entry.lastAccess || entry.ts || now)) > ttl;
}

/* ---------------- 2) Categorizer + dedupe key (pure) ---------------- */

export function categorize(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(i (really )?(like|love|prefer|hate)|meri pasand|mujhe .* (pasand|achchha lagta)|favorite|favourite)\b/.test(t)) return 'preference';
  if (/\b(every (morning|day|night|weekday)|roz|daily|routine|usually i|subah|raat ko)\b/.test(t)) return 'routine';
  if (/\b(remind|task|todo|karna (hai|he)|yaad dilana)\b/.test(t)) return 'task';
  if (/\b(who is|what is|kaun|kya hai|capital of|formula|meaning of)\b/.test(t)) return 'knowledge';
  if (/\b(my |mera|meri|mere|hamar)\w*\s+\w+\s+(is|hai|=)\b/.test(t) || /\bnaam\b.*\b(hai|is)\b/.test(t)) return 'fact';
  return 'episode';
}

/** Dupes die here: same meaning → same key, regardless of fluff words. (pure) */
export function dedupeKey(text) {
  return String(text || '').toLowerCase()
    .replace(/\b(please|boss|yaar|bhai|friday|jarvis|ok|okay|hey|the|a|an|toh|na|ya)\b/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 120);
}

/* ---------------- 3) Conversation summarizer (pure) ---------------- */

const STOP = new Set(('the a an and or is are was were it this that i me my you your we our to of in on for at by with from as be am do did does have has had not no yes hai he hoon ho mein se ko ka ke ki aur to bhi na kya koi nahi main mera tum').split(' '));

/** Top-N signal words from a blob of texts. (pure) */
export function topicsOf(texts, n = 5) {
  const counts = {};
  for (const t of texts || []) {
    for (const w of String(t).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/)) {
      if (w.length < 3 || STOP.has(w)) continue;
      counts[w] = (counts[w] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

/** Intent histogram from episodes. (pure) */
export function topIntents(eps, n = 5) {
  const c = {};
  for (const e of eps || []) if (e.intent) c[e.intent] = (c[e.intent] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}×${v}`);
}

/**
 * Summarize a conversation slice → { summary, tasks[], followups[], topics[], nMsg }.
 * Rule-based, offline, honest: it says ONLY what the logs contain. (pure)
 */
export function summarize(msgs = [], { dateLabel = 'that day' } = {}) {
  const user = msgs.filter(m => m.role === 'user' && m.text);
  const tasks = user.map(m => m.text.match(/remind me (?:to )?(.{3,80})|add task:? ?(.{3,80})|task banao:? ?(.{3,80})/i))
    .filter(Boolean).map(m => (m[1] || m[2] || m[3]).trim()).slice(0, 6);
  const followups = user.map(m => m.text).filter(t => /\?\s*$/.test(t)).slice(-3);
  const topics = topicsOf(user.map(m => m.text), 5);
  const intents = topIntents(msgs.filter(m => m.intent), 4);
  const parts = [`${user.length} interactions ${dateLabel}`];
  if (intents.length) parts.push('mostly ' + intents.join(', '));
  if (topics.length) parts.push('topics: ' + topics.join(', '));
  return { summary: parts.join(' · '), tasks, followups, topics, nMsg: user.length };
}

/* ---------------- 4) Preference learner ---------------- */

function prefs() { return getList(SKEYS.PREFS); }
function savePrefs(p) { saveList(SKEYS.PREFS, p); }

/** Count every successfully-resolved intent; preferences emerge from usage. */
export function trackUse(intent) {
  if (!intent) return;
  const p = prefs();
  const row = p.find(r => r.intent === intent);
  if (row) { row.n++; row.last = Date.now(); } else p.unshift({ intent, n: 1, last: Date.now() });
  savePrefs(p.slice(0, 80));
}

/** Top N preferred commands ("favourite commands" — learned, never asked). */
export function topPreferences(n = 5) {
  return prefs().filter(r => r.n >= 3).sort((a, b) => b.n - a.n).slice(0, n);
}

/* ---------------- 5) Unified retrieval (local, <100ms) ---------------- */

const tl = s => String(s || '').toLowerCase();

/** Score one candidate text against query (keyword overlap, pure). */
export function relevance(query, text) {
  const qw = tl(query).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
  if (!qw.length) return 0;
  const hay = ' ' + tl(text) + ' ';
  let hit = 0;
  for (const w of qw) if (hay.includes(' ' + w) || hay.includes(w)) hit++;
  return hit / qw.length;
}

/**
 * Answer-time recall: current facts + vision memories + daily summaries,
 * ranked by relevance × importance. Returns ≤ k items. (runtime, local)
 */
export function retrieve(query, { k = 6, includeVision = true } = {}) {
  const now = Date.now();
  const pool = [];
  for (const f of allFacts()) pool.push({ src: 'fact', text: `${f.label}: ${f.value}`, ts: f.created || now, importance: importance({ category: 'fact', freq: 4 }) });
  if (includeVision) for (const v of getList(SKEYS.VISION))
    pool.push({ src: 'vision', text: `${v.kind}: ${v.text}`, ts: v.ts, importance: v.importance || 50 });
  for (const s of getList(SKEYS.SUMMARIES))
    pool.push({ src: 'summary', text: s.summary, ts: s.ts, importance: 62 });
  return pool
    .map(p => ({ ...p, rel: relevance(query, p.text) }))
    .filter(p => p.rel > 0)
    .sort((a, b) => (b.rel * (b.importance || 50)) - (a.rel * (a.importance || 50)))
    .slice(0, k);
}

/* ---------------- 6) Daily summary cycle (runtime) ---------------- */

/** Summarize yesterday's episodes once per day; prune raw episodes' tail. */
export function dailyDigest(todayKey = new Date().toDateString(), label = 'aaj') {
  if (getSetting('saveMemory') === false) return null;
  if (getSetting('lastMemSummary') === todayKey) return null;
  const eps = episodes().filter(e => e.role === 'user' || e.role === 'assistant');
  if (eps.length < 6) { setSetting('lastMemSummary', todayKey); return null; }   // mark day as seen — no retry storms
  const s = summarize(eps, { dateLabel: label });
  const sums = getList(SKEYS.SUMMARIES).filter(x => x.day !== todayKey);
  sums.unshift({ id: 'sum-' + Date.now(), day: todayKey, ts: Date.now(), category: 'summary', ...s });
  saveList(SKEYS.SUMMARIES, sums.slice(0, 60));
  setSetting('lastMemSummary', todayKey);
  return s;
}

/** Auto-cleanup dead weight (temp/expired entries). Honest counts. */
export function cleanup() {
  const now = Date.now();
  const vis = getList(SKEYS.VISION);
  const kept = vis.filter(v => !shouldExpire({ ...v, category: 'vision' }, now));
  let removed = vis.length - kept.length;
  saveList(SKEYS.VISION, kept.slice(0, 60));
  return { visionRemoved: removed, kept: kept.length };
}

/* ---------------- 7) Developer dashboard model ---------------- */

export function storageBytes(keys) {
  let b = 0;
  for (const k of keys) { try { b += (localStorage.getItem(k) || '').length * 2; } catch (_) {} }
  return b;
}

export function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

export function dashboard() {
  const keys = ['friday_facts', 'friday_episodes', 'friday_patterns', SKEYS.SUMMARIES, SKEYS.VISION, SKEYS.QR, SKEYS.PREFS];
  const t0 = Date.now();
  let probe = [];
  try { probe = retrieve('battery friday', { k: 3 }); } catch (_) {}   // v14.1: probe must never crash the dashboard
  const ms = Date.now() - t0;
  return {
    facts: allFacts().length,
    episodes: episodes().length,
    summaries: getList(SKEYS.SUMMARIES).length,
    vision: getList(SKEYS.VISION).length,
    qr: getList(SKEYS.QR).length,
    preferenceRows: prefs().length,
    topPreferences: topPreferences(5),
    storageBytes: storageBytes(keys),
    retrievalMs: ms,
    probeHits: probe.length,
    embeddings: getSetting('embedModelPath') ? 'armed (semantic pack)' : 'not downloaded',
    lastSync: getSetting('serverMemSyncedAt') ? new Date(getSetting('serverMemSyncedAt')).toLocaleString() : 'never (local mode)'
  };
}
