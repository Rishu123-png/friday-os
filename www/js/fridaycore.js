/* ============================================================================
   FRIDAY OS — FridayCore (v11.0.0 FOUNDATION / Phase 1)
   The central controller every module registers with. PHASE 1 ADOPTION RULE:
   existing working modules are NOT rewritten — FridayCore wraps them,
   supervises their lifecycle, logs centrally and recovers failures, while
   modules keep working exactly as before. Communication hub grows here.

   Deliverables (per the phase spec):
     1. FridayCore      — central controller, health monitoring
     2. EventBus        — internal bus (modules talk via CORE.emit/on)
     3. ServiceManager  — register + lifecycle (init/start/pause/resume/stop)
     4. Logger          — centralized timestamped ring log (local-only)
     5. Recovery        — restart-on-failure with backoff + error isolation
   ========================================================================== */

/* ---------------- 1+4 Logger ---------------- */
const LOG_KEY = 'friday_core_logs';
const RING = 500;          // in-memory ring
const PERSIST = 150;       // persisted tail (localStorage budget safe)

const _ring = [];
function _push(level, mod, msg) {
  const e = { ts: Date.now(), level, mod: String(mod || 'core'), msg: String(msg).slice(0, 300) };
  _ring.push(e);
  if (_ring.length > RING) _ring.shift();
  return e;
}
export const Logger = {
  debug: (mod, msg) => _push('debug', mod, msg),
  info: (mod, msg) => _push('info', mod, msg),
  warn: (mod, msg) => _push('warn', mod, msg),
  error: (mod, msg) => _push('error', mod, msg),
  all: () => _ring.slice(),
  persist() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(_ring.slice(-PERSIST))); } catch (_) {}
  },
  loadPersisted() {
    try {
      const arr = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
};

/* ---------------- 2 EventBus ---------------- */
const _subs = new Map();   // event -> Set<fn>
export const Bus = {
  on(evt, fn) {
    if (!_subs.has(evt)) _subs.set(evt, new Set());
    _subs.get(evt).add(fn);
    return () => Bus.off(evt, fn);
  },
  off(evt, fn) { const s = _subs.get(evt); if (s) s.delete(fn); },
  once(evt, fn) {
    const off = Bus.on(evt, (...a) => { off(); fn(...a); });
    return off;
  },
  /** Fan out to every listener; one broken listener can never hurt others. */
  emit(evt, payload) {
    const s = _subs.get(evt);
    if (!s) return 0;
    let n = 0;
    for (const fn of [...s]) {
      try { fn(payload); n++; }
      catch (e) { Logger.error('bus', `listener crash on "${evt}": ${e && e.message || e}`); }
    }
    return n;
  },
  listenerCount(evt) { const s = _subs.get(evt); return s ? s.size : 0; },
  _reset() { _subs.clear(); }   // tests only
};

/* ---------------- 3+5 ServiceManager + Recovery ----------------
   A service: { init?, start?, pause?, resume?, stop?, health? }
   States: registered -> init -> running -> paused -> running -> stopped
                       \-> error (recoverable via retry with backoff) */
export const SVC = {
  REGISTERED: 'registered', INIT: 'init', RUNNING: 'running',
  PAUSED: 'paused', STOPPED: 'stopped', ERROR: 'error'
};

export class FridayCore {
  constructor({ maxRetries = 2, baseBackoffMs = 800 } = {}) {
    this.services = new Map();
    this.maxRetries = maxRetries;
    this.baseBackoffMs = baseBackoffMs;
    this.startedAt = 0;
  }

  register(name, svc) {
    if (!name || !svc) throw new Error('service needs a name and impl');
    this.services.set(name, { name, impl: svc, state: SVC.REGISTERED, error: null, retries: 0, startedAt: 0 });
    Logger.info('core', `service registered: ${name}`);
    return this;
  }

  get(name) { return this.services.get(name) || null; }
  list() { return [...this.services.keys()]; }

  /** Full supervised boot: init all, then start all. Never rejects. */
  async boot() {
    this.startedAt = Date.now();
    Logger.info('core', 'FRIDAY CORE boot sequence started');
    Bus.emit('core:boot');
    const results = {};
    for (const [name] of this.services) results[name] = await this._init(name);
    for (const [name] of this.services) if (results[name]) await this._start(name);
    const ok = this.list().filter(n => this.get(n).state === SVC.RUNNING).length;
    Logger.info('core', `boot done: ${ok}/${this.services.size} services running`);
    Bus.emit('core:ready', { ok, total: this.services.size });
    Logger.persist();
    return this.healthMap();
  }

  async _init(name) {
    const s = this.get(name);
    if (!s || s.state === SVC.RUNNING) return false;
    s.state = SVC.INIT;
    try {
      if (s.impl.init) await s.impl.init();
      s.error = null;
      Bus.emit('service:init', { name });
      Logger.info('svc', `${name}: initialized`);
      return true;
    } catch (e) {
      return this._fail(name, 'init', e);
    }
  }

  async _start(name) {
    const s = this.get(name);
    if (!s) return false;
    try {
      if (s.impl.start) await s.impl.start();
      s.state = SVC.RUNNING;
      s.error = null; s.retries = 0; s.startedAt = Date.now();
      Bus.emit('service:start', { name });
      Logger.info('svc', `${name}: running`);
      return true;
    } catch (e) {
      return this._fail(name, 'start', e);
    }
  }

  _fail(name, phase, e) {
    const s = this.get(name);
    s.state = SVC.ERROR;
    s.error = `${phase}: ${e && e.message || e}`;
    Logger.error('svc', `${name} FAILED during ${phase} — ${s.error} (cobra: recovery armed)`);
    Bus.emit('service:error', { name, phase, error: s.error });
    this._scheduleRecovery(name);
    return false;
  }

  /** Restart-on-failure: bounded retries with exponential backoff. */
  _scheduleRecovery(name) {
    const s = this.get(name);
    if (s.retries >= this.maxRetries) {
      Logger.error('core', `${name}: recovery gave up after ${s.retries} tries`);
      Bus.emit('service:dead', { name });
      return;
    }
    s.retries++;
    const wait = this.baseBackoffMs * Math.pow(2, s.retries - 1);
    Logger.warn('core', `${name}: recovery attempt ${s.retries}/${this.maxRetries} in ${wait}ms`);
    setTimeout(() => {
      if (this.get(name).state !== SVC.ERROR) return;   // already fixed
      Bus.emit('service:recovering', { name, attempt: s.retries });
      this._init(name).then(ok => { if (ok) this._start(name); });
    }, wait);
  }

  async pause(name) {
    const s = this.get(name);
    if (!s || s.state !== SVC.RUNNING) return false;
    try { if (s.impl.pause) await s.impl.pause(); } catch (e) { Logger.warn('svc', `${name} pause hiccup: ${e && e.message}`); }
    s.state = SVC.PAUSED; Bus.emit('service:pause', { name });
    return true;
  }

  async resume(name) {
    const s = this.get(name);
    if (!s || s.state !== SVC.PAUSED) return false;
    try { if (s.impl.resume) await s.impl.resume(); } catch (e) { Logger.warn('svc', `${name} resume hiccup: ${e && e.message}`); }
    s.state = SVC.RUNNING; Bus.emit('service:resume', { name });
    return true;
  }

  async stop(name) {
    const s = this.get(name);
    if (!s || s.state === SVC.STOPPED) return false;
    try { if (s.impl.stop) await s.impl.stop(); } catch (e) { Logger.warn('svc', `${name} stop hiccup: ${e && e.message}`); }
    s.state = SVC.STOPPED; Bus.emit('service:stop', { name });
    Logger.info('svc', `${name}: stopped`);
    return true;
  }

  /** Health probe for every service: {name:{state, ok, detail}}. */
  async healthMap() {
    const out = {};
    for (const [name, s] of this.services) {
      let detail = '', ok = s.state === SVC.RUNNING;
      try {
        if (s.impl.health) { const h = await Promise.resolve(s.impl.health()); if (h) detail = h.detail || ''; if (h && h.ok === false) ok = false; }
      } catch (e) { ok = false; detail = 'health probe crash'; }
      out[name] = { state: s.state, ok, detail, error: s.error || '' };
    }
    Bus.emit('core:health', out);
    return out;
  }
}

/* Singleton used by the app. */
export const CORE = new FridayCore();

/* Handy log formatter for Activity/Systems views. */
export function formatLogEntry(e) {
  const t = new Date(e.ts);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  const icon = e.level === 'error' ? '❌' : e.level === 'warn' ? '⚠️' : '•';
  return `${hh}:${mm}:${ss} ${icon} [${e.mod}] ${e.msg}`;
}
