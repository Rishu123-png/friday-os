/* ============================================================================
   FRIDAY OS — HUD (v11.1.0 / Phase 3) v16 P2: XSS-safe
   Living command center: live ring widgets around the AI orb, service status
   lights, rolling event feed, context cards, orb state machine. Pure helpers
   are unit-tested; runtime is wired by app.js. Every widget shows REAL data
   or disappears — no fake vitals, ever.
   ============================================================================ */

/* ---------------- pure helpers (unit-tested) ---------------- */

export function batteryLabel(pct, charging) {
  if (pct == null || isNaN(pct)) return '';
  const p = Math.round(pct);
  return p + '%' + (charging ? ' ⚡' : p <= 20 ? ' 🪫' : '');
}

export function storageLabel(used, quota) {
  if (!quota) return '';
  const gb = v => (v / 1073741824).toFixed(1);
  return `${gb(used || 0)}/${gb(quota)} GB`;
}

export function netLabel(online, cloud) {
  if (!online) return 'Offline';
  if (cloud === true) return 'Cloud ●';
  if (cloud === false) return 'Cloud ○';
  return 'Online';
}

/** Feed line model; keep at most `cap` (default 6) items. */
export function pushFeed(feed, icon, text, cap = 6) {
  const out = (feed || []).concat([{ icon, text: String(text).slice(0, 60), at: Date.now() }]);
  while (out.length > cap) out.shift();
  return out;
}

/** Context cards: only for REAL situations (empty when nothing matters). */
export function contextCards(s) {
  const cards = [];
  if (s.batteryPct != null && s.batteryPct <= 20 && !s.charging) cards.push({ id: 'bat', icon: '🪫', text: `Battery low — ${Math.round(s.batteryPct)}%` });
  if (s.tempC != null && s.tempC <= 6) cards.push({ id: 'cold', icon: '🥶', text: `${Math.round(s.tempC)}°C — cold outside` });
  if (s.missedCalls > 0) cards.push({ id: 'missed', icon: '📞', text: `${s.missedCalls} missed call${s.missedCalls > 1 ? 's' : ''}` });
  if ((s.notifCount || 0) >= 12) cards.push({ id: 'notif', icon: '🔔', text: `${s.notifCount} notifications — "notifications padho" bolo` });
  if (s.reminderText) cards.push({ id: 'rem', icon: '⏰', text: String(s.reminderText).slice(0, 48) });
  return cards.slice(0, 3);
}

/** AI states visible on the orb (the only valid ones). */
export const ORB_STATES = ['idle', 'listening', 'thinking', 'executing', 'speaking', 'sleeping', 'error'];

/** State classifier from the live app-state flags (pure). */
export function orbStateFrom({ listening = false, speaking = false, thinking = false, executing = false, sleeping = false, error = false } = {}) {
  if (error) return 'error';
  if (listening) return 'listening';
  if (speaking) return 'speaking';
  if (executing) return 'executing';
  if (thinking) return 'thinking';
  if (sleeping) return 'sleeping';
  return 'idle';
}

/** Service light → 'on'|'warn'|'off' → CSS class. */
export function svcLight(ok, warnLabel = '') {
  return ok === true ? 'on' : ok === false ? 'off' : 'warn';
}

/* ---------------- runtime (wired by app.js) ---------------- */

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/** Set the orb state class on the HUD wrapper. */
export function setOrbState(wrap, state) {
  if (!wrap) return;
  const s = ORB_STATES.includes(state) ? state : 'idle';
  for (const x of ORB_STATES) wrap.classList.toggle('st-' + x, x === s);
  wrap.dataset.aiState = s;
}

/** Render a feed array into #hudFeed (newest on top, auto-fade via CSS). */
export function renderFeed(el, feed) {
  if (!el) return;
  el.innerHTML = (feed || []).slice().reverse()
    .map(f => `<div class="hud-feed-line"><b>${esc(f.icon)}</b> ${esc(f.text)}</div>`).join('');
}

/** Render context cards into #hudContext. */
export function renderCards(el, cards) {
  if (!el) return;
  el.innerHTML = (cards || []).map(c => `<div class="hud-card" id="hc-${esc(c.id)}">${esc(c.icon)} ${esc(c.text)}</div>`).join('');
}

/** Render ring widgets into #hudWidgets (only non-empty values). */
export function renderWidgets(el, widgets) {
  if (!el) return;
  el.innerHTML = (widgets || []).filter(w => w && w.value)
    .map(w => `<div class="hud-widget ${esc(w.cls || '')}"><span class="hw-k">${esc(w.k)}</span><span class="hw-v">${esc(w.value)}</span></div>`).join('');
}

/** Render service status lights into #hudStatus. */
export function renderStatus(el, rows) {
  if (!el) return;
  el.innerHTML = (rows || [])
    .map(r => `<div class="hud-svc"><span class="hud-dot ${esc(r.cls)}"></span>${esc(r.name)}<i>${esc(r.detail || '')}</i></div>`).join('');
}
