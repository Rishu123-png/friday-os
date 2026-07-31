/* ===== FRIDAY OS — Health & Daily Core (v7.5) =====
   Steps, focus mode, battery guard, screen time, briefing math.
   Every feature degrades: no sensor / no permission / not native = a
   friendly answer, never an error. Banking is deliberately NOT here:
   FRIDAY never reads your money details. */

import * as S from './store.js';
import * as NAT from './native.js';
import * as D from './device.js';

const SP = () => {
  const c = typeof window !== 'undefined' ? window.Capacitor : null;
  return c && c.Plugins ? c.Plugins.FridaySensors : null;
};
export const sensorsAvailable = () => NAT.isNative() && !!SP();

const callS = async (method, args = {}) => {
  try {
    const p = SP();
    if (!p || !p[method]) return { ok: false, reason: 'not_native' };
    return await p[method](args);
  } catch (e) { return { ok: false, reason: e.message || 'error' }; }
};

/* ================= STEPS ================= */
export async function ensureSteps() {
  if (!sensorsAvailable()) return false;
  const r = await callS('startSteps');
  return !!r.ok;
}

export async function getSteps() {
  const r = await callS('getSteps');
  if (!r.ok) return null;
  return { today: r.today || 0, days: r.days || {} };
}

export function stepsGoal() { return S.getSetting('stepsGoal') || 8000; }
export function setStepsGoal(n) {
  const v = Math.max(1000, Math.min(50000, parseInt(n, 10) || 8000));
  S.setSetting('stepsGoal', v);
  return v;
}

export function stepsVerdict(today, goal) {
  const pct = Math.round((today / Math.max(1, goal)) * 100);
  if (pct >= 100) return `Goal smashed - ${pct}% of ${goal.toLocaleString()}.`;
  if (pct >= 60) return `${pct}% of your ${goal.toLocaleString()} goal - good pace.`;
  return `${pct}% of your ${goal.toLocaleString()} goal. A short walk would help.`;
}

/** last 7 days as [{day:'Mon', steps:n}] newest last - pure function, tested */
export function weekSeries(daysObj, now = Date.now()) {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    out.push({
      day: d.toLocaleDateString([], { weekday: 'short' }),
      steps: (daysObj && daysObj[key]) || 0
    });
  }
  return out;
}

export function weeklyAverage(daysObj) {
  const vals = Object.values(daysObj || {}).filter(v => v > 0);
  if (!vals.length) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/* ================= FOCUS MODE (Pomodoro + DND) ================= */
let focusTimer = null;
export function focusUntil() { return S.getSetting('focusUntil') || 0; }
export function inFocus() { return focusUntil() > Date.now(); }

export async function startFocus(minutes, offCallback) {
  const ms = Math.max(1, Math.min(180, minutes)) * 60000;
  S.setSetting('focusUntil', Date.now() + ms);
  try { await NAT.setDND(true); } catch (e) {}
  clearTimeout(focusTimer);
  focusTimer = setTimeout(async () => {
    S.setSetting('focusUntil', 0);
    try { await NAT.setDND(false); } catch (e) {}
    if (offCallback) offCallback();
  }, ms);
  return Math.round(ms / 60000);
}

export async function stopFocus() {
  clearTimeout(focusTimer);
  S.setSetting('focusUntil', 0);
  try { await NAT.setDND(false); } catch (e) {}
}

/* ================= BATTERY GUARD ================= */
let battTimer = null;
const firedAt = { low: 0, full: 0 };
export function stopBatteryGuard() { clearInterval(battTimer); battTimer = null; }
export function startBatteryGuard(onAlert) {
  if (battTimer) return;
  const tick = async () => {
    try {
      const b = await D.battery();
      if (!b) return;
      const pct = Math.round((b.level || 0) * (b.level <= 1 ? 100 : 1));
      const now = Date.now();
      const lowAt = S.getSetting('batteryWarnLow');
      const fullOn = S.getSetting('batteryWarnFull');
      if (lowAt && !b.charging && pct <= (parseInt(lowAt, 10) || 20) && now - firedAt.low > 3600000) {
        firedAt.low = now;
        D.notify('FRIDAY Battery', `Battery at ${pct}%. Plug me in, boss.`, 'batt-low');
        if (onAlert) onAlert(`Battery is at ${pct} percent Charging time.`);
      }
      if (fullOn && b.charging && pct >= 100 && now - firedAt.full > 3600000) {
        firedAt.full = now;
        D.notify('FRIDAY Battery', 'Battery full. You can unplug now.', 'batt-full');
        if (onAlert) onAlert('Battery is full. You can unplug the charger.');
      }
    } catch (e) {}
  };
  battTimer = setInterval(tick, 90000);
  setTimeout(tick, 15000);
}

/* ================= SCREEN TIME ================= */
export async function getScreenTime(days = 1) {
  const r = await NAT.getUsageStats(days);
  if (!r || !r.ok) return r;
  return r;
}

export function screenTimeVerdict(totalMinutes, days = 1) {
  const daily = Math.round(totalMinutes / Math.max(1, days));
  const h = Math.floor(daily / 60), m = daily % 60;
  const pretty = h ? `${h}h ${m}m` : `${m}m`;
  if (daily > 360) return `${pretty} a day - that is heavy screen time, boss.`;
  if (daily > 180) return `${pretty} a day on average.`;
  return `${pretty} a day - nicely under control.`;
}

/* ================= BRIEFING HELPERS ================= */
export async function stepsBrief() {
  const st = await getSteps();
  if (!st) return null;
  if (!st.today && !weeklyAverage(st.days)) return null;
  const goal = stepsGoal();
  return `Steps today: ${st.today.toLocaleString()} of ${goal.toLocaleString()}. ` +
    (st.today ? stepsVerdict(st.today, goal) : '');
}

/* ================= POCKET GUARD + EVENTS ================= */
export async function setPocketGuard(on) {
  const r = await callS('setPocketGuard', { enabled: !!on });
  return !!r.ok;
}
export async function stopPocketAlarm() {
  const r = await callS('stopPocketAlarm');
  return !!r.ok;
}
export async function setShakeListen(on) {
  const r = await callS('setShake', { enabled: !!on });
  return !!r.ok;
}
export function onShake(cb) {
  const p = SP();
  if (!p || !p.addListener) return;
  try { p.addListener('shake', () => { if (cb) cb(); }); } catch (e) {}
}
export function onPocketAlarm(cb) {
  const p = SP();
  if (!p || !p.addListener) return;
  try { p.addListener('pocketAlarm', ev => { if (cb) cb(ev); }); } catch (e) {}
}
