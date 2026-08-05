/* ============================================================================
   FRIDAY OS — CINEX: Cinematic UX & Polish (v13.2.0 / Phase 13)
   Premium, futuristic, glassy — without sacrificing performance or
   accessibility. Most visuals are CSS (see styles.css v13 section); this
   module holds the PURE logic that drives them: AI-state → tone/glow map,
   effects policy (reduced-motion/battery aware), accessibility settings,
   micro-interaction helpers, HUD extra rows, event-feed timing.

   Performance rule (per spec): no excessive blur, no heavy 3D, small assets.
   ========================================================================== */

import { getSetting } from './store.js';
import { Bus } from './fridaycore.js';

/* ---------------- 1) Design tokens: AI state → tone/glow (pure) ---------------- */
export const STATE_TONES = {
  OFFLINE:      { tone: 'dim',   glow: 'none',   ring: 'static' },
  INITIALIZING: { tone: 'cyan',  glow: 'pulse',  ring: 'spin' },
  READY:        { tone: 'cyan',  glow: 'soft',   ring: 'static' },
  LISTENING:    { tone: 'green', glow: 'listen', ring: 'expand' },
  UNDERSTANDING:{ tone: 'amber', glow: 'pulse',  ring: 'spin' },
  THINKING:     { tone: 'amber', glow: 'pulse',  ring: 'spin' },
  EXECUTING:    { tone: 'violet',glow: 'exec',   ring: 'spin' },
  SPEAKING:     { tone: 'cyan',  glow: 'speak',  ring: 'wave' },
  SLEEPING:     { tone: 'dim',   glow: 'none',   ring: 'static' },
  ERROR:        { tone: 'red',   glow: 'alert',  ring: 'blink' }
};

/** Pure: tone for a VOX state (unknown → READY defaults). */
export function toneOf(state) {
  return STATE_TONES[String(state || 'READY').toUpperCase()] || STATE_TONES.READY;
}

/** Pure: css classes to apply to the orb/root for a state. */
export function orbClasses(state) {
  const t = toneOf(state);
  return `orb-${t.tone} fx-${t.glow} ring-${t.ring}`;
}

/* ---------------- 2) Effects policy (pure — accessibility + battery) ---------------- */
export function effectsPolicy({ battery = null, charging = false, reducedMotion = null } = {}) {
  const rm = reducedMotion !== null ? reducedMotion : prefersReducedMotion();
  if (getSetting('particleEffects') === false) rm.particles = false;
  if (rm.particles === false && rm.radar === false && rm.scan === false) {
    return { particles: false, glow: false, radar: false, scan: false, blur: false, glass: false };
  }
  const lowBatt = battery != null && battery <= 20 && !charging;
  const p = {
    particles: rm.particles !== false && !lowBatt,
    glow: getSetting('glowFX') !== false && !lowBatt,
    radar: rm.radar !== false && !lowBatt,
    scan: rm.scan !== false && !lowBatt,
    blur: getSetting('glassFX') !== false && !lowBatt,
    glass: getSetting('glassFX') !== false
  };
  return p;
}

export function prefersReducedMotion() {
  if (typeof matchMedia === 'undefined') return {};
  try {
    const rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return { particles: !rm, radar: !rm, scan: !rm };
  } catch (_) { return {}; }
}

/* ---------------- 3) Accessibility (pure) ---------------- */
export function a11ySettings() {
  return {
    reducedMotion: prefersReducedMotion(),
    textScale: getSetting('textScale') || '1',
    highContrast: getSetting('highContrast') === true,
    screenReader: false
  };
}

/** Pure: css classes that encode a11y/effects onto <html>. */
export function rootClasses() {
  const a = a11ySettings();
  const parts = [];
  if (a.highContrast) parts.push('hc');
  if (a.reducedMotion.particles === false) parts.push('rm');
  if (getSetting('cinematic') === false) parts.push('no-fx');
  if (a.textScale && a.textScale !== '1') parts.push('text-' + a.textScale.replace('.', '-'));
  return parts;
}

/* ---------------- 4) Micro-interactions (runtime, guarded) ---------------- */
export function tapFx(el) {
  if (!el) return;
  try {
    el.classList.remove('tap-pulse');
    void el.offsetWidth;                 // restart animation
    el.classList.add('tap-pulse');
  } catch (_) {}
}

/* ---------------- 5) HUD extra rows (pure — Phase 10 monitor + perf) ---------------- */
export function hudExtraRows({ ram = null, cpu = null, net = null, battery = null, ai = null } = {}) {
  const rows = [];
  if (ram && ram.usedPct != null) rows.push({ k: 'RAM', v: ram.usedPct + '%', sev: ram.pressure === 'high' ? 'warn' : 'ok' });
  if (cpu != null) rows.push({ k: 'CPU', v: cpu + '%', sev: cpu > 70 ? 'warn' : 'ok' });
  if (net) rows.push({ k: 'Net', v: net.wifi ? 'Wi-Fi' : net.online ? 'Data' : 'Offline', sev: net.online ? 'ok' : 'warn' });
  if (battery != null) rows.push({ k: 'Battery', v: battery + '%', sev: battery <= 20 ? 'warn' : 'ok' });
  if (ai != null) rows.push({ k: 'AI', v: ai + ' ms', sev: ai < 800 ? 'ok' : 'warn' });
  return rows;
}

/* ---------------- 6) Event feed timing (pure) ---------------- */
export const FEED_FADE_MS = {
  automation: 5000, reminder: 5000, device: 4000, memory: 4000,
  planner: 6000, default: 4500
};
export function feedFade(kind) { return FEED_FADE_MS[kind] || FEED_FADE_MS.default; }

/* ---------------- 7) Responsiveness hint (pure) ---------------- */
export function layoutHint() {
  try {
    const w = window.innerWidth || 0;
    if (w >= 1024) return 'tablet';
    if (w > 640) return 'landscape';
    return 'portrait';
  } catch (_) { return 'portrait'; }
}

/* ---------------- init (app.js calls once) ---------------- */
export function init() {
  try {
    const apply = () => {
      const p = effectsPolicy();
      const root = document.documentElement;
      root.dataset.fx = JSON.stringify(p);
      root.className = rootClasses().join(' ');
    };
    apply();
    Bus.on('vox:state', e => {
      try {
        const root = document.documentElement;
        if (root) root.dataset.orb = orbClasses(e.state || 'READY');
      } catch (_) {}
    });
    Bus.on('autox:battery', p => { try { apply(); } catch (_) {} });
    document.addEventListener('visibilitychange', () => {
      const root = document.documentElement;
      if (root) root.dataset.hidden = document.hidden ? '1' : '0';   // CSS pauses anims
    });
  } catch (e) { /* never break boot */ }
  return { ok: true };
}
