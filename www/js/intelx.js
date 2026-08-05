/* ============================================================================
   FRIDAY OS — INTELX: Intelligence & Context Engine (v12.1.0 / Phase 9)
   The cognitive layer that gives FRIDAY situational awareness — proactive,
   personalized help based on current context, not only explicit commands.

   Sub-systems (per the phase spec):
     Intelligence Manager / Context Engine / Routine Learning / Prediction
     Engine / Recommendation Engine / Preference Engine / Notification
     Intelligence / Calendar Intelligence / Study Intelligence / Device
     Intelligence / Decision Engine

   Privacy: learning is LOCAL by default. No behavioral data leaves the
   device without explicit consent (intelPrivacy setting, default true).
   ========================================================================== */

import { getList, saveList, getSetting, setSetting } from './store.js';
import { Bus, Logger } from './fridaycore.js';

const INTEL = 'friday_intel';            // observations + learned patterns
const DISMISS = 'friday_intel_dismiss';  // dismissed suggestion ids
const SUGGLOG = 'friday_intel_sugg';     // suggestion history (for quality stats)
const STUDY = 'friday_study';            // study sessions

const MAX_OBS = 600;
const SUGG_COOLDOWN_MS = 6 * 3600e3;     // same suggestion at most once / 6h

/* ---------------- 1) Observation model (pure) ---------------- */

/** Normalize one observation into a compact row. */
export function normObs(kind, data, at = Date.now()) {
  return { kind, at, ...(data || {}) };
}

/* ---------------- 2) Routine Learning (pure — no hardcoded assumptions) ---------------- */

function modeOf(arr) {
  if (!arr.length) return null;
  const c = {};
  let best = arr[0], n = 0;
  for (const x of arr) { c[x] = (c[x] || 0) + 1; if (c[x] > n) { n = c[x]; best = x; } }
  return best;
}
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

/** Pure: derive routines from observations. Every value comes from data. */
export function learnRoutines(obs) {
  const firstUseHours = obs.filter(o => o.kind === 'first_use').map(o => new Date(o.at).getHours());
  const studyEvents = obs.filter(o => o.kind === 'study_session');
  const chargeEvents = obs.filter(o => o.kind === 'charge_level');
  const appOpens = obs.filter(o => o.kind === 'app_open');
  const commands = obs.filter(o => o.kind === 'command');

  const appCount = {};
  appOpens.forEach(o => { appCount[o.app || '?'] = (appCount[o.app || '?'] || 0) + 1; });
  const cmdCount = {};
  commands.forEach(o => { cmdCount[o.intent || '?'] = (cmdCount[o.intent || '?'] || 0) + 1; });
  const freq = c => Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);

  return {
    wakeHour: modeOf(firstUseHours),
    studyWindows: modeOf(studyEvents.map(e => new Date(e.at).getHours())),
    chargingLevel: modeOf(chargeEvents.filter(e => e.charging === true).map(e => Math.round((e.level || 0) / 10) * 10)),
    frequentApps: freq(appCount),
    frequentCommands: freq(cmdCount),
    sessions: studyEvents.length,
    samples: obs.length
  };
}

/* ---------------- 3) Prediction Engine (pure) ---------------- */

/** Pure: ranked predictions about what the user needs next. */
export function predictNext(routines, ctx = {}) {
  const out = [];
  const h = ctx.hour != null ? ctx.hour : new Date().getHours();
  const now = Date.now();
  if (routines.wakeHour != null && h >= routines.wakeHour && h < routines.wakeHour + 2) {
    out.push({ kind: 'morning_routine', label: 'morning brief', confidence: 0.6 + (h === routines.wakeHour ? 0.2 : 0) });
  }
  if (routines.studyWindows != null && h >= routines.studyWindows && h < routines.studyWindows + 2) {
    out.push({ kind: 'study_window', label: 'study session', confidence: 0.65 });
  }
  if (ctx.battery != null && ctx.charging === false && ctx.battery <= 35) {
    out.push({ kind: 'charge_need', label: 'charge the phone', confidence: 0.5 + (35 - ctx.battery) / 35 * 0.4 });
  }
  if (routines.frequentCommands && routines.frequentCommands.length && ctx.lastIntent) {
    out.push({ kind: 'next_command', label: routines.frequentCommands[0], confidence: 0.4 });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

/* ---------------- 4) Recommendation Engine (pure, dismissible, safe) ---------------- */

/** Pure: build suggestions. Skips dismissed ids and cooldown-armed ones. */
export function recommend(routines, ctx = {}, dismissed = [], suggLog = [], now = Date.now()) {
  const out = [];
  const push = (id, text, icon, confidence, action = null, kind = 'tip') => {
    const seen = suggLog.find(s => s.id === id && now - s.at < SUGG_COOLDOWN_MS);
    if (dismissed.includes(id) || seen) return;
    if (confidence < 0.55) return;                    // Decision Engine: confidence gate
    out.push({ id, text, icon, confidence, action, kind, dismissable: true, at: now });
  };

  // battery low before likely travel/leaving (device intelligence)
  if (ctx.battery != null && ctx.battery <= 30 && ctx.charging === false) {
    push('bat_low', `Battery ${ctx.battery}% — charge kar lo, travel ke liye power chahiye hogi.`, '🔋', 0.75);
  }
  // study window + no session today → suggest study (study intelligence)
  const studiedToday = suggLog.some(s => s.kind === 'study_done' && new Date(s.at).toDateString() === new Date(now).toDateString());
  if (!studiedToday && routines.studyWindows != null && ctx.hour === routines.studyWindows && getSetting('intelStudyMode') !== false) {
    push('study_now', 'Study window hai — 25 min padhai? Main timer aur quiz ready hoon.', '📚', 0.7, { type: 'study' }, 'study');
  }
  // wifi on + autoSetup → pack downloads can happen silently (suit-friendly)
  if (ctx.wifi === true && getSetting('autoSetup') === true) {
    push('wifi_pack', 'Wi-Fi on hai — koi pending AI pack download karun quietly?', '📡', 0.6, { type: 'auto_setup' });
  }
  // weekly backup reminder (data hygiene)
  const lastBackup = getSetting('lastBackupAt') || 0;
  if (now - lastBackup > 7 * 86400e3 && ctx.memSize > 0) {
    push('backup', 'Notes/memory ka weekly backup le lo — 2 sec ka kaam hai.', '💾', 0.6, { type: 'backup' });
  }
  // exam / upcoming reminder awareness (calendar intelligence)
  if (ctx.nextReminder) {
    push('next_rem', `Agla kaam: "${ctx.nextReminder.text}" — ${ctx.nextReminder.when}`, '⏰', 0.65, { type: 'reminder' });
  }
  return out;
}

/** Pure: what to do with the user's answer to a suggestion. */
export function suggestionVerdict(id, ok) {
  saveList(DISMISS, ok ? getList(DISMISS) : [...new Set([...getList(DISMISS), id])].slice(-200));
  saveList(SUGGLOG, [{ id, ok: !!ok, at: Date.now() }, ...getList(SUGGLOG)].slice(0, 200));
  return ok;
}

/* ---------------- 5) Notification Intelligence (pure) ---------------- */

const PRIO_APPS = {
  'com.whatsapp': 0.95, 'org.telegram.messenger': 0.92, 'com.google.android.apps.messaging': 0.9,
  'com.android.mms': 0.9, 'com.google.android.gm': 0.75, 'com.android.dialer': 0.9,
  'com.google.android.dialer': 0.9, 'com.google.android.calendar': 0.8
};
const LOW_APPS = ['com.facebook.katana', 'com.instagram.android', 'com.google.android.youtube', 'com.zhiliaoapp.musically', 'com.truecaller'];

/** Pure: score + tier a notification. tier: urgent|normal|low. */
export function notifPriority(n = {}) {
  const pkg = n.pkg || '';
  const age = Date.now() - (n.when || n.ts || Date.now());
  let score = PRIO_APPS[pkg] || 0.5;
  if (LOW_APPS.includes(pkg)) score -= 0.3;
  if (n.title && /otp|code|password|urgent|sos|payment|credit|debit/i.test(n.title + ' ' + (n.text || ''))) score += 0.2;
  if (age < 60000) score += 0.1;                 // freshness
  if (!n.text && !n.title) score -= 0.3;
  score = Math.max(0.05, Math.min(1, score));
  return { score, tier: score >= 0.8 ? 'urgent' : score >= 0.5 ? 'normal' : 'low' };
}

/** Pure: friendly short app name from a package id ("com.instagram.android" → "instagram"). */
export function shortApp(pkg) {
  const parts = String(pkg || '').split('.');
  if (parts.length > 2) return parts[parts.length - 2];
  return parts[parts.length - 1] || 'apps';
}

/** Pure: group low-priority notifications into a one-line digest. */
export function notifDigest(list, max = 4) {
  const lows = (list || []).filter(n => notifPriority(n).tier === 'low').slice(0, max);
  if (!lows.length) return '';
  return `${lows.length} low-priority from ${lows.map(n => shortApp(n.pkg)).join(', ')}: ${lows.map(n => (n.title || '').slice(0, 24)).filter(Boolean).join(' · ')}`.slice(0, 220);
}

/* ---------------- 6) Study Intelligence (pure + runtime) ---------------- */

/** Pure: aggregate study sessions. */
export function studyStats(sessions = []) {
  const today = new Date().toDateString();
  const todayMin = sessions.filter(s => new Date(s.at).toDateString() === today).reduce((a, s) => a + (s.min || 0), 0);
  const last7 = sessions.filter(s => Date.now() - s.at < 7 * 86400e3);
  const weekAvg = last7.length ? Math.round(avg(last7.map(s => s.min || 0))) : 0;
  const days = new Set(sessions.map(s => new Date(s.at).toDateString()));
  let streak = 0;
  const d = new Date();
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  return { todayMin, weekAvg, streak, totalSessions: sessions.length, totalMin: sessions.reduce((a, s) => a + (s.min || 0), 0) };
}

export function studySessions() { return getList(STUDY); }
export function studyStart() { setSetting('_studyStartedAt', Date.now()); return true; }
export function studyStop(topic = 'general') {
  const t0 = getSetting('_studyStartedAt') || 0;
  const min = t0 ? Math.max(1, Math.round((Date.now() - t0) / 60000)) : 1;
  saveList(STUDY, [{ topic, min, at: Date.now() }, ...getList(STUDY)].slice(0, 500));
  setSetting('_studyStartedAt', 0);
  observe('study_session', { topic, min });
  return { topic, min };
}

/* ---------------- 7) Decision Engine (pure) ---------------- */

/**
 * Pure: gate a proactive action.
 * Only act when confidence is high enough AND safe AND battery-cheap AND
 * (context supports it OR history supports it).
 */
export function decide(candidate, { confidence, context = true, history = true, safety = true, batteryImpact = 'low', threshold = 0.7 } = {}) {
  if (confidence == null && candidate) confidence = candidate.confidence || 0;
  const reasons = [];
  if (confidence < threshold) reasons.push('low confidence');
  if (!safety) reasons.push('unsafe');
  if (batteryImpact === 'high') reasons.push('battery heavy');
  if (!context && !history) reasons.push('no context/history support');
  return reasons.length ? { act: false, reason: reasons.join(', ') } : { act: true, reason: '' };
}

/* ---------------- 8) Runtime: context collection + observation ---------------- */

/* app.js injects fresh values here (event-driven — no polling). */
let _ctx = {};
export function injectContext(partial) { _ctx = { ..._ctx, ...(partial || {}) }; }
export function collectContext() { return { ..._ctx, hour: new Date().getHours(), dow: new Date().getDay() }; }

export function observations() { return getList(INTEL); }

/** Record one observation (capped ring). */
export function observe(kind, data = {}) {
  if (getSetting('intelEnabled') === false) return null;
  const row = normObs(kind, data);
  const list = getList(INTEL);
  list.unshift(row);
  saveList(INTEL, list.slice(0, MAX_OBS));
  Logger.debug('intelx', `obs ${kind}`);
  return row;
}

/** Learn once at boot from existing memory episodes + fresh observations. */
export function bootstrap(episodes = []) {
  const list = getList(INTEL);
  let changed = false;
  for (const ep of episodes.slice(0, 200)) {
    if (ep && ep.role === 'user' && ep.ts) {
      list.push(normObs('command', { intent: ep.intent || 'unknown' }, ep.ts));
      changed = true;
    }
  }
  if (changed) saveList(INTEL, list.slice(0, MAX_OBS));
  return learnRoutines(getList(INTEL));
}

/** Event-driven tick: called by app on bus events; may emit suggestions. */
export function tick(event, payload = {}) {
  if (getSetting('intelEnabled') === false) return 0;
  switch (event) {
    case 'battery': observe('charge_level', { level: payload.level, charging: payload.charging }); break;
    case 'app_open': observe('app_open', { app: payload.app }); break;
    case 'command': observe('command', { intent: payload.intent }); break;
    case 'first_use': observe('first_use', {}); break;
    case 'study_done': observe('study_session', { topic: payload.topic, min: payload.min }); break;
    default: break;
  }
  return maybeSuggest();
}

/** Compute current suggestions (Decision-Engine gated). Returns array. */
export function maybeSuggest() {
  const ctx = collectContext();
  const routines = learnRoutines(getList(INTEL));
  const sugg = recommend(routines, ctx, getList(DISMISS), getList(SUGGLOG));
  if (sugg.length) {
    const picked = sugg.slice(0, 2).map(s => ({ ...s, ...decide(s, {
      confidence: s.confidence, context: true, history: routines.samples > 3, safety: true, batteryImpact: 'low'
    }) }));
    const actionable = picked.filter(p => p.act);
    if (actionable.length) Bus.emit('intel:suggest', actionable);
    return actionable;
  }
  return [];
}

export function suggestions() { return getList(SUGGLOG).slice(0, 10); }

/* ---------------- 9) Dashboard (for FridayCore health + dev views) ---------------- */
export function dashboard() {
  const routines = learnRoutines(getList(INTEL));
  return {
    samples: routines.samples,
    wakeHour: routines.wakeHour,
    studyWindow: routines.studyWindows,
    chargingLevel: routines.chargingLevel,
    frequentApps: routines.frequentApps,
    frequentCommands: routines.frequentCommands,
    dismissed: getList(DISMISS).length,
    suggestions: suggestions().length
  };
}
