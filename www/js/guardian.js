/* ============================================================================
   FRIDAY OS — GUARDIAN: Personal Guardian (v15 Phase 6)
   Safety timer, breathing exercise, camera-based heart-rate estimation,
   medication reminders (reuses med-plan flow), plus the existing SOS.
   Pure math (HR estimation, breathing) is unit-tested; the camera pipeline
   is wired in app.js (existing camera flow + VISIONX-style frames).
   ========================================================================== */

import { getList, saveList, getSetting, setSetting } from './store.js';

const TIMERS = 'friday_guardian_timers';

/* ---------------- 1) Safety timer ---------------- */
/* A "check on me in X minutes" timer — if the user doesn't confirm, escalate
   (notify + optionally SOS via app.js hook). Pure model + store. */
export function safetyTimers() { return getList(TIMERS); }
export function addSafetyTimer({ minutes = 30, label = 'Safety check', escalate = false } = {}) {
  const rec = { id: 'gt-' + Date.now() + Math.random().toString(36).slice(2, 5), minutes: Math.max(1, minutes), label, escalate: !!escalate, armed: true, at: Date.now(), due: Date.now() + minutes * 60000 };
  saveList(TIMERS, [rec, ...getList(TIMERS)].slice(0, 20));
  return rec;
}
export function confirmSafetyTimer(id) {
  const list = getList(TIMERS);
  const t = list.find(x => x.id === id);
  if (t) { t.armed = false; t.confirmedAt = Date.now(); saveList(TIMERS, list); return true; }
  return false;
}
export function disarmSafetyTimers() { saveList(TIMERS, getList(TIMERS).map(t => ({ ...t, armed: false }))); }
export function dueSafetyTimers(now = Date.now()) {
  return getList(TIMERS).filter(t => t.armed && t.due <= now);
}

/* ---------------- 2) Breathing exercise (pure) ---------------- */
/* Box breathing: 4-4-4-4 pattern. Returns a phase schedule. */
export const BREATH_PHASES = [
  { name: 'Inhale', sec: 4 },
  { name: 'Hold', sec: 4 },
  { name: 'Exhale', sec: 4 },
  { name: 'Hold', sec: 4 }
];
export function breathingCycle(rounds = 4) {
  const out = [];
  for (let r = 0; r < rounds; r++) for (const p of BREATH_PHASES) out.push({ ...p, round: r + 1 });
  return out;
}
export function breathPhaseAt(cycle, elapsedSec) {
  let acc = 0;
  for (const p of cycle) { acc += p.sec; if (elapsedSec < acc) return p; }
  return null;
}

/* ---------------- 3) Camera heart-rate estimation (pure) ---------------- */
/* The real algorithm runs on RGB frames from the camera (app.js samples the
   video). This module: frame-average → signal → BPM via peak counting, plus
   confidence gating. Honest: rough estimate, not medical. */

/** Average R/G/B from a frame (0-255). app.js extracts via canvas. */
export function frameAvg(r, g, b) {
  return { r: r | 0, g: g | 0, b: b | 0 };
}

/** Normalize a channel and compute a clean PPG-ish signal from green channel
    (green best reflects blood flow). Returns {signal, mean}. */
export function ppgSignal(frames, channel = 'g', fps = 30) {
  const raw = frames.map(f => f[channel]).filter(v => typeof v === 'number');
  if (raw.length < fps * 5) return { signal: [], mean: 0, ok: false, reason: 'too few frames' };
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  // detrend: subtract moving average, then bandpass-ish by smoothing
  const win = Math.max(3, Math.round(fps * 0.6));
  const detrended = raw.map((v, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(raw.length - 1, i + win); j++) { s += raw[j]; c++; }
    return v - s / c;
  });
  return { signal: detrended, mean, ok: true, fps };
}

/** Estimate BPM from a detrended signal: count upward zero-crossings / window. */
export function bpmFromSignal(signal, fps = 30, windowSec = 10) {
  if (!signal || signal.length < fps * 6) return { bpm: null, confidence: 0, reason: 'insufficient' };
  const slice = signal.slice(-fps * windowSec);
  let crossings = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] <= 0 && slice[i] > 0) crossings++;
  }
  const bpm = Math.round((crossings / windowSec) * 60);
  if (bpm < 40 || bpm > 200) return { bpm: null, confidence: 0, reason: 'out of range' };
  const variance = slice.reduce((a, v) => a + v * v, 0) / slice.length;
  const confidence = Math.min(0.9, 0.4 + variance * 200 + (bpm >= 50 && bpm <= 120 ? 0.2 : 0));
  return { bpm, confidence: Math.round(confidence * 100) / 100, reason: 'ok' };
}

/** Convenience: frames → BPM. */
export function heartRate(frames, { fps = 30, channel = 'g' } = {}) {
  const ppg = ppgSignal(frames, channel, fps);
  if (!ppg.ok) return { bpm: null, confidence: 0, reason: ppg.reason };
  return bpmFromSignal(ppg.signal, fps);
}

/* ---------------- 4) Medication reminders (data helpers) ---------------- */
/* Reuses the existing med-plan alarm flow in app.js; here just tracking. */
export function medSchedule() { return getSetting('medSchedule') ? JSON.parse(getSetting('medSchedule')) : []; }
export function setMedSchedule(times) { setSetting('medSchedule', JSON.stringify(times)); return times; }

/* ---------------- 5) Guardian stats ---------------- */
export function guardianStats() {
  return { timers: safetyTimers().filter(t => t.armed).length, confirmedToday: getList(TIMERS).filter(t => t.confirmedAt && new Date(t.confirmedAt).toDateString() === new Date().toDateString()).length };
}
