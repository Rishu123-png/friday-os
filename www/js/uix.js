/* ============================================================================
   FRIDAY OS — UIX: Premium UI/UX helpers (v15 Phase 8)
   Material You (dynamic color), AMOLED mode, tablet layout hints, smooth
   animation flags, navigation helpers, accessibility. Pure logic here;
   CSS (styles.css Phase-8 block) applies the visuals. No layout rewrite —
   additive + adaptive only.
   ========================================================================== */

import { getSetting } from './store.js';

/* ---------------- 1) Material You: derive a tint from a seed color ---------------- */

/** HSL → CSS string. Pure color math. */
export function hsl(h, s, l, a = 1) { return `hsla(${h},${s}%,${l}%,${a})`; }

/** Blend two hex colors (0-255 rgb) → hex. */
export function blend(c1, c2, t = 0.5) {
  const p = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const a = p(c1), b = p(c2);
  const m = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return '#' + m.map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Extract a dominant accent guess from a wallpaper-ish color list. */
export function dominantAccent(colors = []) {
  if (!colors.length) return '#00d4ff';
  const c = colors[0];
  return typeof c === 'string' && /^#([0-9a-f]{6})$/i.test(c) ? c : '#00d4ff';
}

/** Material-You palette from a seed hex: returns {bg, surface, primary, onPrimary, muted}. */
export function materialPalette(seed = '#00d4ff') {
  const p = [parseInt(seed.slice(1, 3), 16), parseInt(seed.slice(3, 5), 16), parseInt(seed.slice(5, 7), 16)];
  const lum = (p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114);
  return {
    primary: seed,
    surface: lum > 140 ? blend(seed, '#ffffff', 0.85) : blend(seed, '#0a0a1a', 0.75),
    bg: lum > 140 ? blend(seed, '#f5f5f5', 0.9) : blend(seed, '#05070f', 0.85),
    onPrimary: lum > 150 ? '#0a0a1a' : '#ffffff',
    muted: blend(seed, '#666', 0.55)
  };
}

/* ---------------- 2) AMOLED mode ---------------- */

export function amoledPolicy({ enabled = false, battery = null } = {}) {
  const lowBatt = battery != null && battery <= 20;
  return {
    pureBlack: enabled || lowBatt,          // AMOLED on = true black bg
    reduceGlow: lowBatt,
    dim: lowBatt
  };
}

/* ---------------- 3) Tablet / responsive hints ---------------- */

export function layoutHint() {
  try {
    const w = window.innerWidth || 0;
    if (w >= 1024) return { mode: 'tablet', cols: w >= 1280 ? 4 : 3 };
    if (w >= 700) return { mode: 'landscape', cols: 2 };
    return { mode: 'portrait', cols: 1 };
  } catch (_) { return { mode: 'portrait', cols: 1 }; }
}

export function isTablet() { return layoutHint().mode === 'tablet'; }

/* ---------------- 4) Navigation helpers (pure) ---------------- */

export function navItems() { return ['dashboard', 'chat', 'activity', 'settings']; }
export function isNavPanel(p) { return !navItems().includes(p); }   // panels vs views

/* ---------------- 5) Accessibility ---------------- */

export function a11yPolicy() {
  return {
    reducedMotion: getSetting('uixReducedMotion') !== false,
    highContrast: getSetting('highContrast') === true,
    textScale: parseFloat(getSetting('textScale') || '1'),
    largeTouch: getSetting('uixLargeTouch') === true
  };
}

/* ---------------- 6) Animation quality ---------------- */

export function animationPref() {
  const a = a11yPolicy();
  if (a.reducedMotion) return { duration: 0, scale: 0 };
  const p = getSetting('uixAnimations');
  if (p === 'minimal') return { duration: 0.12, scale: 1 };
  return { duration: 0.24, scale: 1.02 };   // default smooth
}

/* ---------------- 7) Runtime apply (called from app.js) ---------------- */
export function init() {
  try {
    const root = document.documentElement;
    const a = amoledPolicy({ enabled: getSetting('amoled') === true });
    root.dataset.amoled = a.pureBlack ? '1' : '0';
    const ap = a11yPolicy();
    root.dataset.hc = ap.highContrast ? '1' : '0';
    const l = layoutHint();
    root.dataset.layout = l.mode;
    root.dataset.cols = String(l.cols);
  } catch (_) {}
  return { ok: true };
}
