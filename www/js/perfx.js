/* ============================================================================
   FRIDAY OS — PERFX: Performance & Optimization Engine (v13.1.0 / Phase 12)
   Smooth, efficient, battery-aware — tuned for the OPPO K13x. Event-driven,
   no busy loops, lazy heavy modules, priority scheduling, TTL caches,
   animation policy that respects battery + reduced-motion, and a developer
   performance monitor (FPS/CPU/RAM/latency/queues).

   Sub-systems (per the phase spec):
     Performance Manager / CPU Optimizer / Memory Optimizer / Battery
     Optimizer / Thread Manager / Cache Manager / Resource Scheduler /
     Animation Optimizer / Background Task Manager / Performance Monitor
   ========================================================================== */

import { getSetting, setSetting, cacheGet, cacheSet } from './store.js';
import { Bus, Logger } from './fridaycore.js';

/* ---------------- 1) Startup optimization (lazy registry, pure) ---------------- */
/* Heavy/optional subsystems that must NOT block cold start (<3s target). */
export const LAZY = [
  { id: 'vision',     cost: 'high',  boot: 'later',  why: 'camera/OCR loads on demand' },
  { id: 'embeddings', cost: 'high',  boot: 'later',  why: 'meaning-recall loads on demand' },
  { id: 'coder',      cost: 'high',  boot: 'later',  why: 'code engine loads on demand' },
  { id: 'planner',    cost: 'med',   boot: 'later',  why: 'runs only for multi-step goals' },
  { id: 'intelx',     cost: 'med',   boot: 'background', why: 'learns after first paint' },
  { id: 'devx',       cost: 'low',   boot: 'background', why: 'device monitor rides events' },
  { id: 'secx',       cost: 'low',   boot: 'essential',  why: 'security registers first' }
];

export function startupPlan() {
  return {
    critical: LAZY.filter(l => l.boot === 'essential').map(l => l.id),
    background: LAZY.filter(l => l.boot === 'background').map(l => l.id),
    later: LAZY.filter(l => l.boot === 'later').map(l => l.id)
  };
}

/* ---------------- 2) CPU optimizer (utilities) ---------------- */
export function throttle(fn, ms = 250) {
  let last = 0, timer = null;
  return (...a) => {
    const now = Date.now();
    const remaining = last + ms - now;
    if (remaining <= 0) { last = now; return fn(...a); }
    clearTimeout(timer);
    timer = setTimeout(() => { last = Date.now(); fn(...a); }, remaining);
  };
}
export function debounce(fn, ms = 200) {
  let timer = null;
  return (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); };
}

/* Event-driven CPU estimate: exponential-moving-average of events/sec. */
let _events = 0, _lastEmit = Date.now();
export function activity() { _events++; }
export function cpuLoad() {
  const now = Date.now();
  const span = Math.max(1, (now - _lastEmit) / 1000);
  const rate = _events / span;
  _events = 0; _lastEmit = now;
  return Math.min(100, Math.round(rate * 3));   // rough 0-100 scale
}

/* ---------------- 3) Memory optimizer ---------------- */
export function heapStats() {
  const m = typeof performance !== 'undefined' && performance.memory ? performance.memory : null;
  if (!m) return { usedMB: null, totalMB: null, usedPct: null };
  const usedMB = m.usedJSHeapSize / 1048576;
  const totalMB = m.jsHeapSizeLimit / 1048576;
  return { usedMB: Math.round(usedMB), totalMB: Math.round(totalMB), usedPct: Math.round(100 * usedMB / totalMB) };
}

/** Pure leak detector: grows too fast → warn. Feed {key, sizeNow} samples. */
export function detectLeaks(samples = [], { maxGrowthKB = 800, window = 86400e3 } = {}) {
  const out = [];
  const byKey = {};
  samples.forEach(s => { byKey[s.key] = byKey[s.key] || []; byKey[s.key].push(s); });
  for (const [key, arr] of Object.entries(byKey)) {
    if (arr.length < 2) continue;
    const recent = arr.filter(s => Date.now() - s.at <= window);
    if (recent.length < 2) continue;
    const first = recent[0].kb, last = recent[recent.length - 1].kb;
    if (last - first > maxGrowthKB) out.push({ key, growthKB: Math.round(last - first) });
  }
  return out;
}

/* Object pooling: reuse objects to cut GC churn. */
export function pool(make, reset = () => {}, max = 8) {
  const free = [];
  return {
    acquire() {
      const o = free.pop() || make();
      reset(o);
      return o;
    },
    release(o) { if (free.length < max) free.push(o); }
  };
}

/* ---------------- 4) Battery optimizer (load-on-demand + gating) ---------------- */
export const HEAVY = ['vision', 'embeddings', 'coder', 'planner'];

export function batteryGate(feature, battery = null) {
  if (!getSetting('batteryGate')) return { ok: true };
  if (!HEAVY.includes(feature)) return { ok: true };
  const pct = battery != null ? battery.level : null;
  if (pct == null) return { ok: true };
  if (pct <= 15 && battery.charging !== true) {
    return { ok: false, reason: 'battery_low', explain: 'Battery ' + pct + '% — heavy AI "' + feature + '" deferred. Charger lagao ya bolo "ignore battery".' };
  }
  return { ok: true };
}

/* ---------------- 5) Thread/lane manager (priority scheduler) ---------------- */
export const PRIORITY = { CRITICAL: 0, MEDIUM: 1, LOW: 2 };

let _queue = { 0: [], 1: [], 2: [] };
let _draining = false;

/** Schedule work by priority. Critical (0) drains first, low (2) yields. */
export function schedule(fn, { priority = PRIORITY.MEDIUM, lane = 'default' } = {}) {
  const job = { fn, lane };
  _queue[priority].push(job);
  drain();
  return () => { const q = _queue[priority]; const i = q.indexOf(job); if (i >= 0) q.splice(i, 1); };
}

function drain() {
  if (_draining) return;
  _draining = true;
  // defer so all schedules enqueue first, then drain in priority order
  Promise.resolve().then(() => {
    const step = () => {
      for (const p of [0, 1, 2]) {
        if (_queue[p].length) {
          const job = _queue[p].shift();
          try { Promise.resolve(job.fn()).catch(() => {}); } catch (_) {}
          setTimeout(step, p === 2 ? 250 : 0);   // low priority yields
          return;
        }
      }
      _draining = false;
    };
    step();
  });
}

export function queueSizes() { return { critical: _queue[0].length, medium: _queue[1].length, low: _queue[2].length }; }

/* ---------------- 6) Cache manager (TTL + AI response cache) ---------------- */
export function sweepExpired() {
  // store.cacheGet(allowStale=false) already expires; force a touch sweep:
  let n = 0;
  try {
    const raw = localStorage.getItem('friday_cache');
    if (raw) {
      const c = JSON.parse(raw);
      const now = Date.now();
      for (const k of Object.keys(c)) {
        if (c[k] && c[k].exp && now > c[k].exp) { delete c[k]; n++; }
      }
      localStorage.setItem('friday_cache', JSON.stringify(c));
    }
  } catch (_) {}
  return n;
}

/** AI response cache (safe = short TTL, only when enabled). */
export function aiCacheGet(prompt, settingsKey = '') {
  if (getSetting('aiCache') === false) return null;
  const key = 'ai_' + hashOf(prompt + '|' + settingsKey);
  return cacheGet(key, true);
}
export function aiCacheSet(prompt, answer, ttlMin = 30, settingsKey = '') {
  if (getSetting('aiCache') === false) return;
  const key = 'ai_' + hashOf(prompt + '|' + settingsKey);
  cacheSet(key, answer, ttlMin);
}
function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 31 + s.charCodeAt(i)) >>> 0);
  return h.toString(36);
}

/* ---------------- 7) Resource scheduler (pure plan) ---------------- */
export function resourcePlan({ battery = null, online = true, charging = false } = {}) {
  const low = battery != null && battery <= 20 && !charging;
  return {
    critical: ['voice', 'ui', 'notifications'],
    medium: ['memory_index', 'intelx_learn'],
    low: low ? [] : ['cleanup', 'model_updates', 'suggestions']
  };
}

/* ---------------- 8) Animation optimizer ---------------- */
let _fps = 60, _frames = 0, _fpsTimer = 0, _fpsOn = false;

export function startFpsMeter() {
  if (_fpsOn) return;
  _fpsOn = true;
  _frames = 0;
  const tick = () => {
    _frames++;
    if (!_fpsTimer) _fpsTimer = setTimeout(() => { _fps = Math.round(_frames * 1000 / 1000); _frames = 0; _fpsTimer = 0; }, 1000);
    if (_fpsOn) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
export function stopFpsMeter() { _fpsOn = false; }
export function fps() { return _fps; }

/** Animation policy: respects reduced-motion + battery (pure). */
export function animationPolicy({ battery = null, charging = false, reducedMotion = false } = {}) {
  const lowBatt = battery != null && battery <= 20 && !charging;
  if (reducedMotion) return { particles: false, glow: false, radar: false, scan: false, blur: false, reason: 'reduced-motion' };
  if (lowBatt) return { particles: false, glow: true, radar: false, scan: false, blur: false, reason: 'low-battery' };
  return { particles: true, glow: true, radar: true, scan: true, blur: true, reason: 'full' };
}

/* ---------------- 9) Performance monitor / diagnostics ---------------- */
let _aiLatency = null;
export function markAiLatency(ms) { _aiLatency = ms; }
export function aiLatency() { return _aiLatency; }

export async function perfMetrics({ battery = null, network = null } = {}) {
  return {
    fps: _fps,
    cpu: cpuLoad(),
    ram: heapStats(),
    battery: battery ? { pct: battery.level, charging: battery.charging } : null,
    aiLatencyMs: _aiLatency,
    netLatencyMs: null,
    queues: queueSizes(),
    heapMB: heapStats().usedMB,
    cacheExpired: sweepExpired()
  };
}

/* ---------------- 10) Background task manager ---------------- */
export function pauseWhenHidden() {
  const onVis = () => {
    if (document.hidden) {
      stopFpsMeter();
      Bus.emit('perfx:hidden', { at: Date.now() });
    } else {
      if (getSetting('perfMonitor')) startFpsMeter();
      Bus.emit('perfx:visible', { at: Date.now() });
    }
  };
  document.addEventListener('visibilitychange', onVis);
  return () => document.removeEventListener('visibilitychange', onVis);
}

/* ---------------- init (app.js calls once) ---------------- */
export function init({ getBattery = null, onPerf = null } = {}) {
  try {
    Bus.on('autox:battery', p => { try { activity(); } catch (_) {} });
    if (getSetting('perfMonitor')) startFpsMeter();
    Bus.on('perfx:refresh', () => {
      perfMetrics({ battery: getBattery ? null : null }).then(m => {
        if (onPerf) onPerf(m);
        Bus.emit('perfx:metrics', m);
      }).catch(() => {});
    });
    if (typeof document !== 'undefined') pauseWhenHidden();
    Logger.info('perfx', 'performance engine online');
  } catch (e) { Logger.error('perfx', 'init: ' + (e && e.message)); }
  return { ok: true };
}

export function dashboard() {
  return {
    fps: _fps,
    ram: heapStats(),
    queues: queueSizes(),
    aiLatencyMs: _aiLatency,
    lazy: startupPlan(),
    cache: 'ttl-cache active'
  };
}
