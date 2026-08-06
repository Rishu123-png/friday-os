/* ============================================================================
   FRIDAY OS — AIR: AI Router + Analytics (v15 Phase 3)
   Centralized AI routing: choose the best provider per task, auto-fallback,
   provider health, retries, timeouts, streaming, usage stats + cost/token
   tracking. Pure decision logic is unit-tested; runtime calls the existing
   providers (server / groq / ollama / local) — nothing is rewritten.

   Providers (in priority order, configured in Settings):
     server  → FRIDAY Cloud (/v1/chat)
     groq    → api.groq.com (local key)
     ollama  → local ollama server (http://host:11434, user-set)
     local   → on-device llama.cpp (via LB) — last resort offline
   ========================================================================== */

import { getSetting } from './store.js';
import { Bus, Logger } from './fridaycore.js';

/* ---------------- Provider registry (pure) ---------------- */
export const PROVIDERS = [
  { id: 'server', label: 'FRIDAY Cloud', costs: false },
  { id: 'groq',   label: 'Groq',         costs: true },
  { id: 'ollama', label: 'Ollama (local)', costs: false },
  { id: 'local',  label: 'On-device LLM', costs: false }
];

/* Task → preferred providers (first available wins). (pure) */
export const TASK_PROVIDERS = {
  chat:     ['server', 'groq', 'ollama', 'local'],
  code:     ['server', 'groq', 'ollama'],
  vision:   ['server', 'groq'],
  embedding: ['local'],
  translate: ['server', 'groq']
};

export function providerById(id) {
  return PROVIDERS.find(p => p.id === id) || null;
}

/* Which providers are configured right now? (pure-ish, reads settings) */
export function availableProviders() {
  const out = [];
  if ((getSetting('serverUrl') || '').trim()) out.push('server');
  if ((getSetting('groqKey') || '').trim()) out.push('groq');
  if ((getSetting('ollamaUrl') || '').trim()) out.push('ollama');
  if ((getSetting('llmModelPath') || '').trim()) out.push('local');
  return out;
}

/* ---------------- Usage + cost tracking (store-backed) ---------------- */
const USAGE_KEY = 'friday_ai_usage';

export function usage() { return getList(USAGE_KEY); }
function bump(cat, n = 1) {
  const u = getList(USAGE_KEY);
  const rec = u.find(r => r.cat === cat);
  if (rec) { rec.n += n; rec.ts = Date.now(); }
  else u.push({ cat, n, ts: Date.now() });
  saveList(USAGE_KEY, u.slice(-200));
}
function getList(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (_) { return []; } }
function saveList(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

/* ---------------- Provider health (rolling, store-backed) ---------------- */
const HEALTH_KEY = 'friday_ai_health';
export function healthMap() {
  try { return JSON.parse(localStorage.getItem(HEALTH_KEY) || '{}'); } catch (_) { return {}; }
}
function recordHealth(id, ok, ms, err = '') {
  const h = healthMap();
  const row = h[id] || { ok: 0, fail: 0, lastMs: null, lastErr: '' };
  ok ? row.ok++ : row.fail++;
  row.lastMs = ms;
  if (err) row.lastErr = String(err).slice(0, 120);
  row.failRate = row.ok + row.fail ? Math.round(100 * row.fail / (row.ok + row.fail)) : 0;
  h[id] = row;
  try { localStorage.setItem(HEALTH_KEY, JSON.stringify(h)); } catch (_) {}
}

/* ---------------- Task classification (pure) ---------------- */
const CODE_HINT = /\b(code|function|script|debug|error in|fix my|write a program|regex|api request|component|syntax)\b/i;
const VISION_HINT = /\b(image|photo|picture|scan|see|look at|describe|ocr|what is in)\b/i;
const TRANSLATE_HINT = /\b(translate|translate to|in (hindi|english|tamil|telugu))\b/i;

export function classifyTask(text) {
  if (VISION_HINT.test(text) && /(image|photo|picture)/.test(text)) return 'vision';
  if (CODE_HINT.test(text)) return 'code';
  if (TRANSLATE_HINT.test(text)) return 'translate';
  return 'chat';
}

/* ---------------- Router (runtime) ---------------- */
/* exec(providerId, task, messages, opts) → {ok, text, ms} — injected from app.js
   so AIR never touches DOM/providers directly (keeps it testable). */

export async function route({ task = 'chat', messages = [], onToken = null,
                              exec = null, opts = {}, providers = null } = {}) {
  if (!exec) return { ok: false, reason: 'no executor', provider: null };
  const taskProviders = TASK_PROVIDERS[task] || TASK_PROVIDERS.chat;
  const available = providers || availableProviders();
  const pref = (getSetting('aiProviderPref') || '').trim();
  // user preference first (if it can do this task), then configured order
  const order = [];
  if (pref && taskProviders.includes(pref)) order.push(pref);
  for (const p of taskProviders) if (p !== pref && available.includes(p)) order.push(p);
  // local is always a fallback for chat/code even if not "configured" (bundled engine)
  if (!order.includes('local') && task === 'chat' && getSetting('llmModelPath')) order.push('local');

  const t0 = performance && performance.now ? performance.now() : Date.now();
  const errors = [];
  for (const provider of order) {
    try {
      const r = await exec(provider, messages, { ...opts, task, onToken });
      const ms = Math.round(((performance && performance.now ? performance.now() : Date.now()) - t0));
      if (r && r.ok && (r.text || r.skipped)) {
        recordHealth(provider, true, ms);
        bump(provider, 1);
        if (r.tokens) bump('tokens', r.tokens);
        return { ok: true, text: r.text || '', provider, ms };
      }
      errors.push(provider + ':' + (r && r.reason || 'empty'));
      recordHealth(provider, false, ms, r && r.reason);
    } catch (e) {
      const ms = Math.round(((performance && performance.now ? performance.now() : Date.now()) - t0));
      errors.push(provider + ':' + (e && e.message || e));
      recordHealth(provider, false, ms, e && e.message);
    }
  }
  return { ok: false, reason: errors.join(' | '), provider: null, ms: Date.now() - t0 };
}

/* ---------------- Diagnostics: aggregate usage + health (pure) ---------------- */
export function aiDiagnostics() {
  const u = usage();
  const h = healthMap();
  return {
    usage: u,
    totalCalls: u.reduce((a, r) => a + r.n, 0),
    health: h,
    providers: PROVIDERS.map(p => ({ id: p.id, label: p.label, ...(h[p.id] || { ok: 0, fail: 0, failRate: 0 }) })),
    available: availableProviders(),
    pref: getSetting('aiProviderPref') || 'auto'
  };
}

export function init() {
  try { Bus.emit('air:ready', { providers: availableProviders() }); Logger.info('air', 'router online'); } catch (_) {}
  return { ok: true };
}
