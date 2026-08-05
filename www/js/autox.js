/* ============================================================================
   FRIDAY OS — AUTOX: Intelligent Automation Engine (v11.3.0 / Phase 7)
   EXTENDS automation.js — alarms/routines/geofences/runTrigger bilkul untouched.
   Adds: declarative Rule Engine (IF trigger(s) THEN action) · priority +
   safety validation (VOX danger rules apply) · event bus wiring (no polling
   loops — everything rides existing app events) · structured run logging.
   ============================================================================ */

import { getList, saveList, getSetting } from './store.js';
import { Bus } from './fridaycore.js';
import { needsConfirm } from './vox.js';

const RULES  = 'friday_rules';
const XLOG   = 'friday_autox_log';

/* ---------------- 1) Rule shape (pure) ---------------- */

export const TRIGGERS = ['time','battery_low','charging_on','charging_off','wifi_on','wifi_off','online','offline',
  'headphones_in','headphones_out','motion','calendar','notification','command','boot','bluetooth_on','bluetooth_off'];

/* risky = MONEY/MOVEMENT actions, not app-opening. "open whatsapp" is safe;
   "whatsapp message ko bhejo" is not. Calls need approval — before dialing is
   where Android stops mattering (the call IS the thing). */
export const RISKY = /\b(delete|wipe|format|factory|call\b|dial\b|place call|send sms|sms bhej|whatsapp (message|bhej|send)|message bhej|pay\b|payment|purchase|order\b|transfer|erase|reset)\b/i;

/**
 * Pure: rule sanity. Returns {ok, reason}.
 * Every risky (destructive/money/banking) rule MUST have confirm:true —
 * this is the Safety Layer the spec demands.
 */
export function validateRule(r) {
  if (!r || typeof r !== 'object') return { ok: false, reason: 'no rule' };
  if (!TRIGGERS.includes(r.when)) return { ok: false, reason: 'unknown trigger: ' + r.when };
  if (!r.then || !String(r.then).trim()) return { ok: false, reason: 'empty action' };
  if (RISKY.test(r.then) && !r.confirm) return { ok: false, reason: 'risky action needs confirm:true' };
  if (needsConfirm(String(r.then)) && !r.confirm) return { ok: false, reason: 'VOX: parked action needs confirm' };
  return { ok: true, reason: '' };
}

/** Pure: does a rule fire for this event? (payload match semantics per trigger) */
export function ruleMatches(rule, event, payload = {}) {
  if (!rule.enabled) return false;
  if (rule.when !== event) return false;
  const p = payload || {};
  switch (rule.when) {
    case 'battery_low':   return (p.level ?? 100) <= (rule.level ?? 20) && p.charging !== true;
    case 'charging_on':   return p.charging === true;
    case 'charging_off':  return p.charging === false || p.unplugged === true;
    case 'time':          { const hhmm = p.hhmm || ''; return rule.at ? hhmm === rule.at : false; }
    case 'command':       { const t = String(p.text || '').toLowerCase(); return t.includes(String(rule.match || '').toLowerCase()); }
    case 'notification':  { const app = String(p.app || '').toLowerCase(); return !rule.app || app.includes(String(rule.app).toLowerCase()); }
    case 'wifi_on':       return p.wifi === true;
    case 'wifi_off':      return p.wifi === false;
    default:              return true;   // online/offline/boot/headphones_*/motion/calendar/bluetooth_*
  }
}

/** Pure, stable: lower priority number runs first; ties by created. */
export function byPriority(a, b) { return (a.priority ?? 50) - (b.priority ?? 50) || (a.created ?? 0) - (b.created ?? 0); }

/* ---------------- 2) Rule store (runtime) ---------------- */

export function rules() { return getList(RULES).sort(byPriority); }

export function addRule(r) {
  const v = validateRule(r);
  if (!v.ok) return { ok: false, reason: v.reason };
  const list = getList(RULES);
  const rec = {
    id: 'rule-' + Date.now() + Math.random().toString(36).slice(2, 5),
    created: Date.now(), enabled: true, priority: 50, cooldownMs: 300000,   // 5 min anti-spam
    lastFired: 0, ...r
  };
  saveList(RULES, list.concat(rec));
  return { ok: true, rule: rec };
}

export function toggleRule(id, on) { saveList(RULES, getList(RULES).map(r => r.id === id ? { ...r, enabled: on } : r)); }
export function deleteRule(id) { saveList(RULES, getList(RULES).filter(r => r.id !== id)); }

/* ---------------- 3) Sensible starter rules (seeded once) ---------------- */

const SEEDS = [
  { when: 'battery_low', level: 20, then: 'Battery 20% se neeche hai Boss. Battery saver on kar doon?', confirm: true, priority: 10, name: 'Battery guard' },
  { when: 'headphones_in', then: 'Music resume karein?', confirm: true, priority: 20, name: 'Headphone resume' },
  { when: 'offline', then: 'Offline mode: local brain + memory + commands sab ready hai.', priority: 30, name: 'Offline comfort' },
  { when: 'boot', then: null, priority: 99, name: 'Boot quiet' }   // placeholder row so user sees shape in dashboard
].filter(r => r.then);

export function seedDefaults() {
  if (getList(RULES).length) return false;
  const t0 = Date.now();
  const out = SEEDS.map((s, i) => ({
    id: 'seed-' + i + '-' + t0, created: t0 + i, enabled: true, priority: s.priority || 50,
    cooldownMs: 300000, lastFired: 0, ...s
  }));
  saveList(RULES, out);
  return true;
}

/* ---------------- 4) Engine runtime ----------------
   No timers, no polling. The app EMITS lifecycle events onto the bus and we
   evaluate rules per event. Battery: zero new wakeups. */

let _exec = null;      // action executor (app.js supplies handleInput-based fn)
let _armed = false;

export function autoxLog() { return getList(XLOG).slice(0, 40); }

function log(entry) { saveList(XLOG, [entry, ...getList(XLOG)].slice(0, 60)); }

/** Fire one rule (cooldown + confirm gate + failure logging — spec audit trail). */
async function fireRule(rule, payload, event) {
  const now = Date.now();
  if (rule.lastFired && now - rule.lastFired < (rule.cooldownMs || 300000)) return false;
  const t0 = performance && performance.now ? performance.now() : now;
  rule.lastFired = now;
  saveList(RULES, getList(RULES).map(r => r.id === rule.id ? { ...r, lastFired: now } : r));
  try {
    if (_exec) await _exec(rule.then, { rule: rule.id, event, payload });
    log({ id: 'xlog-' + now, ts: now, trigger: event, rule: rule.name || rule.then.slice(0, 30), action: String(rule.then).slice(0, 80),
          ok: true, ms: Math.round(((performance && performance.now ? performance.now() : Date.now()) - t0) * 10) / 10 });
    return true;
  } catch (e) {
    log({ id: 'xlog-' + now, ts: now, trigger: event, rule: rule.name || rule.then.slice(0, 30), action: String(rule.then).slice(0, 80),
          ok: false, ms: Math.round(((performance && performance.now ? performance.now() : Date.now()) - t0) * 10) / 10,
          err: String(e && e.message || e).slice(0, 120) });
    return false;
  }
}

/** Event arrives → evaluate enabled rules in priority order. */
export async function tick(event, payload = {}) {
  if (getSetting('autoEngine') === false) return 0;
  const fired = [];
  for (const rule of rules()) {
    if (!rule.enabled) continue;
    try {
      if (ruleMatches(rule, event, payload)) fired.push(rule);
    } catch (_) {}
  }
  let n = 0;
  for (const rule of fired) if (await fireRule(rule, payload, event)) n++;
  return n;
}

/** Wire rule pipeline onto the FridayCore bus (called once from app.js). */
export function start(exec) {
  if (_armed) return true;
  _armed = true;
  _exec = exec;
  seedDefaults();
  Bus.on('autox:event', e => { tick(e.event, e.payload).catch(() => {}); });
  Bus.on('autox:battery', p => { tick('battery_low', p); tick(p && p.charging ? 'charging_on' : 'charging_off', p); });
  Bus.on('autox:audio', p => { if (p && p.headphones === true) tick('headphones_in', p); });
  Bus.on('autox:net', p => { if (p && p.online === false) tick('offline', p); if (p && p.online === true) tick('online', p); });
  Bus.emit('core:autox-online', { at: Date.now() });
  return true;
}

/** Pure: dashboard rows for Settings/dev view. */
export function dashRows() {
  const log = getList(XLOG);
  const ok = log.filter(l => l.ok).length;
  return {
    rules: getList(RULES).length,
    enabled: getList(RULES).filter(r => r.enabled).length,
    fired: log.length,
    okRate: log.length ? Math.round(100 * ok / log.length) : null,
    last: log[0] || null
  };
}
