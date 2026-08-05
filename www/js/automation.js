/* ===== FRIDAY OS — Automation Engine =====
   Routines, triggers and background execution.

   Everything here runs SILENTLY in the background. The user never sees
   a control panel — they speak, FRIDAY executes, and confirms.

   Trigger types:
     time      — at 07:00, every day / weekdays / specific days
     event     — battery_low, charging, online, offline, headphones
     location  — enter/exit a geofence
     app_open  — when FRIDAY launches
     interval  — every N minutes */

import { getList, saveList, addItem, removeItem, updateItem } from './store.js';

const ROUTINES = 'friday_routines';
const ALARMS = 'friday_alarms';
const GEOFENCES = 'friday_geofences';
const RUNLOG = 'friday_runlog';

/* ================= ALARMS ================= */
/* A first-class alarm: repeating, labelled, snoozable. */

export function addAlarm({ time, label = 'Alarm', repeat = 'once', enabled = true }) {
  const all = getList(ALARMS);
  const dup = all.find(a => a.time === time && a.repeat === repeat && a.label === label);
  if (dup) { dup.enabled = enabled; dup.lastFired = 0; saveList(ALARMS, all); return dup; }
  return addItem(ALARMS, { time, label, repeat, enabled, lastFired: 0 });
}

export function alarms() { return getList(ALARMS); }
export function toggleAlarm(id, on) { return updateItem(ALARMS, id, { enabled: on }); }
export function deleteAlarm(id) { return removeItem(ALARMS, id); }

/** Should this alarm fire right now? */
function alarmDue(a, now) {
  if (!a.enabled) return false;
  const [h, m] = String(a.time).split(':').map(Number);
  if (now.getHours() !== h || now.getMinutes() !== m) return false;
  // don't double-fire within the same minute
  if (now.getTime() - (a.lastFired || 0) < 61000) return false;

  const dow = now.getDay(); // 0=Sun
  switch (a.repeat) {
    case 'daily': return true;
    case 'weekdays': return dow >= 1 && dow <= 5;
    case 'weekends': return dow === 0 || dow === 6;
    case 'once': return true;
    default:
      // explicit days e.g. "1,3,5"
      if (/^[0-6](,[0-6])*$/.test(a.repeat)) return a.repeat.split(',').map(Number).includes(dow);
      return false;
  }
}

/* ================= ROUTINES ================= */
/* A routine = trigger + list of actions, executed in order. */

export function addRoutine({ name, trigger, actions, enabled = true }) {
  const all = getList(ROUTINES);
  const existing = all.find(r => r.name.toLowerCase() === String(name).toLowerCase());
  if (existing) {                       // update in place, never duplicate
    existing.trigger = trigger;
    existing.actions = actions;
    existing.enabled = enabled;
    saveList(ROUTINES, all);
    return existing;
  }
  return addItem(ROUTINES, { name, trigger, actions, enabled, runs: 0, lastRun: 0 });
}
export function routines() { return getList(ROUTINES); }
export function toggleRoutine(id, on) { return updateItem(ROUTINES, id, { enabled: on }); }
export function deleteRoutine(id) { return removeItem(ROUTINES, id); }

export function findRoutine(name) {
  const n = String(name).toLowerCase().trim();
  return routines().find(r => r.name.toLowerCase() === n)
      || routines().find(r => r.name.toLowerCase().includes(n))
      || null;
}

/* ---- Default routines seeded on first run ---- */
export function seedDefaults() {
  if (routines().length) return;
  addRoutine({
    name: 'good morning',
    trigger: { type: 'manual' },
    actions: [{ do: 'briefing' }],
    enabled: true
  });
  addRoutine({
    name: 'bedtime',
    trigger: { type: 'manual' },
    actions: [
      { do: 'say', text: 'Winding down. Alarms are set. Good night.' },
      { do: 'summary_tomorrow' }
    ],
    enabled: true
  });
  addRoutine({
    name: 'leaving home',
    trigger: { type: 'manual' },
    actions: [{ do: 'weather' }, { do: 'aqi' }, { do: 'reminders_today' }],
    enabled: true
  });
}

/* ================= GEOFENCES ================= */
export function addGeofence({ name, lat, lon, radius = 250, onEnter, onExit }) {
  return addItem(GEOFENCES, { name, lat, lon, radius, onEnter, onExit, inside: null });
}
export function geofences() { return getList(GEOFENCES); }
export function deleteGeofence(id) { return removeItem(GEOFENCES, id); }

function distanceM(a, b) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ================= SCHEDULER ================= */
/* One heartbeat drives everything. Runs every 30s while the app is open;
   in the APK a foreground service keeps this alive. */

let heartbeat = null;
let executor = null;   // injected callback that performs an action
let lastEventState = {};

/**
 * @param {function} exec  async (action) => void   — runs one action
 */
export function start(exec) {
  executor = exec;
  seedDefaults();
  stop();
  tick();                                  // immediate
  heartbeat = setInterval(tick, 30000);    // every 30s
  runTrigger('app_open');
}

export function stop() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

async function tick() {
  const now = new Date();

  // --- alarms ---
  const list = alarms();
  let changed = false;
  for (const a of list) {
    if (!alarmDue(a, now)) continue;
    a.lastFired = now.getTime();
    changed = true;
    await fire({ do: 'alarm', label: a.label, time: a.time });
    if (a.repeat === 'once') a.enabled = false;
    log(`alarm: ${a.label} @ ${a.time}`);
  }
  if (changed) saveList(ALARMS, list);

  // --- time-triggered routines ---
  for (const r of routines()) {
    if (!r.enabled || r.trigger?.type !== 'time') continue;
    const [h, m] = String(r.trigger.at).split(':').map(Number);
    if (now.getHours() !== h || now.getMinutes() !== m) continue;
    if (now.getTime() - (r.lastRun || 0) < 61000) continue;
    await runRoutine(r);
  }

  // --- interval routines ---
  for (const r of routines()) {
    if (!r.enabled || r.trigger?.type !== 'interval') continue;
    const every = (r.trigger.minutes || 60) * 60000;
    if (now.getTime() - (r.lastRun || 0) < every) continue;
    await runRoutine(r);
  }
}

/* ---- Event triggers (called by app.js when state changes) ---- */
export async function runTrigger(eventName, payload = {}) {
  // debounce identical events
  const key = eventName + JSON.stringify(payload);
  if (lastEventState[key] && Date.now() - lastEventState[key] < 60000) return;
  lastEventState[key] = Date.now();

  for (const r of routines()) {
    if (!r.enabled) continue;
    if (r.trigger?.type !== 'event') continue;
    if (r.trigger.event !== eventName) continue;
    await runRoutine(r, payload);
  }
}

/* ---- Geofence check (called with a fresh GPS fix) ---- */
export async function checkGeofences(pos) {
  const list = geofences();
  let changed = false;
  for (const g of list) {
    const d = distanceM(pos, g);
    const inside = d <= g.radius;
    if (g.inside === null) { g.inside = inside; changed = true; continue; }
    if (inside && !g.inside) {
      g.inside = true; changed = true;
      log(`geofence enter: ${g.name}`);
      if (g.onEnter) await runNamed(g.onEnter);
    } else if (!inside && g.inside) {
      g.inside = false; changed = true;
      log(`geofence exit: ${g.name}`);
      if (g.onExit) await runNamed(g.onExit);
    }
  }
  if (changed) saveList(GEOFENCES, list);
}

/* ================= EXECUTION ================= */
export async function runRoutine(r, payload = {}) {
  if (!r || !executor) return false;
  for (const action of (r.actions || [])) {
    await fire({ ...action, _payload: payload });
  }
  const all = routines();
  const rec = all.find(x => x.id === r.id);
  if (rec) { rec.runs = (rec.runs || 0) + 1; rec.lastRun = Date.now(); saveList(ROUTINES, all); }
  log(`routine: ${r.name}`);
  return true;
}

export async function runNamed(name) {
  const r = findRoutine(name);
  return r ? runRoutine(r) : false;
}

async function fire(action) {
  try { await executor(action); }
  catch (e) { console.warn('[automation] action failed', action, e); }
}

/* ================= RUN LOG ================= */
function log(text) {
  const l = getList(RUNLOG);
  l.unshift({ text, ts: Date.now() });
  saveList(RUNLOG, l.slice(0, 100));
}
export function runLog() { return getList(RUNLOG); }

/* ================= NATURAL LANGUAGE PARSING ================= */
/* Turns "set an alarm for 5pm every weekday" into a stored alarm. */

export function parseAlarm(text) {
  const t = text.toLowerCase();

  // time
  let hh = null, mm = 0;
  const ampm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  const h24 = t.match(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/);
  if (ampm) {
    hh = parseInt(ampm[1], 10);
    mm = ampm[2] ? parseInt(ampm[2], 10) : 0;
    if (ampm[3] === 'pm' && hh < 12) hh += 12;
    if (ampm[3] === 'am' && hh === 12) hh = 0;
  } else if (h24) {
    hh = parseInt(h24[1], 10); mm = parseInt(h24[2], 10);
  } else {
    const bare = t.match(/\b(?:alarm|wake)\D{0,12}(\d{1,2})\b/);
    if (bare) {
      hh = parseInt(bare[1], 10);
      const morning = /\bmorning|\bam\b|wake/.test(t);
      const evening = /\bevening|night|\bpm\b/.test(t);
      // wake-ups default to AM; other alarms 1-9 default to PM
      if (evening && hh < 12) hh += 12;
      else if (!morning && hh >= 1 && hh <= 9) hh += 12;
    }
  }
  if (hh === null || hh > 23 || mm > 59) return null;

  // repeat
  let repeat = 'once';
  if (/\bevery ?day|daily\b/.test(t)) repeat = 'daily';
  else if (/\bweekday|working day|mon(day)?\s*(to|-)\s*fri/.test(t)) repeat = 'weekdays';
  else if (/\bweekend/.test(t)) repeat = 'weekends';
  else {
    const days = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const hits = Object.entries(days).filter(([d]) => new RegExp('\\b' + d).test(t)).map(([, n]) => n);
    if (hits.length) repeat = hits.join(',');
  }

  // label
  let label = 'Alarm';
  // "... for medicine" / "... to take pills"  (skip the time itself)
  const tail = t.match(/\b(?:for|to)\s+([a-z][a-z\s]{2,40}?)(?:\s+at\b|\s+every\b|\s+on\b|\s*$)/g) || [];
  for (const seg of tail) {
    const v = seg.replace(/^\s*(?:for|to)\s+/, '').trim();
    if (!v || /^\d/.test(v)) continue;
    if (/^(me|the|a|an|my)$/.test(v)) continue;
    if (/(am|pm|morning|evening|night|weekday|weekend|day|today|tomorrow)$/.test(v)) continue;
    label = v; break;
  }
  const called = t.match(/\b(?:called|named|labell?ed)\s+([a-z\s]{2,30})/);
  if (called) label = called[1].trim();

  return {
    time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    label: label.charAt(0).toUpperCase() + label.slice(1),
    repeat
  };
}

export function describeAlarm(a) {
  const [h, m] = a.time.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  const time = `${hh}:${String(m).padStart(2, '0')} ${ap}`;
  const rep = {
    once: '', daily: ' every day', weekdays: ' on weekdays', weekends: ' on weekends'
  }[a.repeat];
  if (rep !== undefined) return `${time}${rep}`;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${time} on ${a.repeat.split(',').map(n => names[n]).join(', ')}`;
}

/** Next occurrence in ms, for scheduling a precise timeout */
export function nextOccurrence(a) {
  const [h, m] = a.time.split(':').map(Number);
  const now = new Date();
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  // advance to a matching weekday
  for (let i = 0; i < 8; i++) {
    const dow = d.getDay();
    const ok = a.repeat === 'daily' || a.repeat === 'once'
      || (a.repeat === 'weekdays' && dow >= 1 && dow <= 5)
      || (a.repeat === 'weekends' && (dow === 0 || dow === 6))
      || (/^[0-6](,[0-6])*$/.test(a.repeat) && a.repeat.split(',').map(Number).includes(dow));
    if (ok) break;
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

/* ================= ROUTINE BUILDER FROM SPEECH ================= */
/* "when I say good morning turn on wifi and tell me the weather" */

const ACTION_WORDS = [
  { re: /\b(weather|forecast)\b/, act: { do: 'weather' } },
  { re: /\b(air quality|aqi|pollution)\b/, act: { do: 'aqi' } },
  { re: /\b(news|headlines)\b/, act: { do: 'news' } },
  { re: /\b(briefing|brief me|status)\b/, act: { do: 'briefing' } },
  { re: /\b(reminders?)\b/, act: { do: 'reminders_today' } },
  { re: /\b(tasks?|todos?)\b/, act: { do: 'tasks_today' } },
  { re: /\b(battery|power)\b/, act: { do: 'battery' } },
  { re: /\b(time)\b/, act: { do: 'time' } },
  { re: /\b(torch|flashlight)\s*(on)?\b/, act: { do: 'torch', on: true } },
  { re: /\b(silent|do not disturb|dnd)\b/, act: { do: 'say', text: 'Do not disturb needs the APK build.' } }
];

export function parseRoutine(text) {
  const t = text.toLowerCase();
  // name
  let name = null;
  const named = t.match(/\bwhen i say ([a-z\s]{2,25}?)(?:,|\s+then\b|\s+do\b|\s+turn\b|\s+tell\b|\s+run\b|\s+give\b|\s+show\b|\s+read\b|\s+with\b|$)/);
  if (named) name = named[1].trim();
  const create = t.match(/\b(?:create|make|add)\s+(?:a\s+)?routine\s+(?:called\s+|named\s+)?([a-z\s]{2,25}?)(?:\s+(?:with|that|to|which|doing)\b|$)/);
  if (!name && create) name = create[1].trim();
  if (!name) return null;

  const actions = [];
  ACTION_WORDS.forEach(a => { if (a.re.test(t)) actions.push(a.act); });
  if (!actions.length) return null;

  return { name, trigger: { type: 'manual' }, actions };
}
