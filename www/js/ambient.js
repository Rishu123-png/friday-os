/* ===== FRIDAY OS — Ambient telemetry =====
   Collects a tiny live snapshot (time, battery, steps, notifications,
   most-used app) that rides inside the system prompt, so the brain can
   answer "what am I doing?" / "anything new?" from REAL on-device data
   without waiting for a tool call.

   Everything here is best-effort: any missing source simply disappears
   from the snapshot. Empty snapshot = empty string = prompt unchanged.

   Privacy: the snapshot goes ONLY to the brain the user chose - Groq in
   cloud mode, or nowhere (it stays on the phone) in on-device mode. */

import * as NAT from './native.js';

/** Pure formatter — unit-testable with plain objects. */
export function formatAmbient(snap = {}) {
  const lines = [];
  if (snap.timeLabel) lines.push('Local time: ' + snap.timeLabel);
  if (snap.battery) lines.push('Battery: ' + snap.battery + (snap.charging ? ' (charging)' : ''));
  if (Number.isFinite(snap.steps)) lines.push('Steps today: ' + snap.steps);
  if (snap.topApp) lines.push('Most-used app today: ' + snap.topApp);
  if (Array.isArray(snap.notifs) && snap.notifs.length) {
    lines.push('Recent notifications:');
    for (const n of snap.notifs.slice(0, 5)) {
      const t = String(n.text || n.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (t) lines.push('- ' + (n.app || 'app') + ': ' + t);
    }
  }
  if (!lines.length) return '';
  return 'LIVE PHONE TELEMETRY (real, on-device. Treat it as ground truth; never contradict or invent beyond it):\n' + lines.join('\n');
}

let cache = null, cacheAt = 0;

/** Gathers the snapshot. Native-only; caches for maxAgeMs. Never throws. */
export async function collectAmbient({ maxAgeMs = 60000 } = {}) {
  if (!NAT.isNative()) return '';
  const now = Date.now();
  if (cache !== null && now - cacheAt < maxAgeMs) return cache;

  const snap = {};
  try {
    snap.timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    snap.dateLabel = new Date().toDateString();
  } catch (_) {}

  try {
    const b = await NAT.batteryDetail();
    if (b && b.ok && Number.isFinite(b.level)) { snap.battery = b.level + '%'; snap.charging = !!b.charging; }
  } catch (_) {}

  try {
    const s = await NAT.hcReadSteps(1);
    if (s && s.ok && Number.isFinite(s.steps)) snap.steps = Number(s.steps);
  } catch (_) {}

  try {
    const u = await NAT.getUsageStats(1);
    const it = u && (u.items || u.stats);
    if (Array.isArray(it) && it.length && it[0]) snap.topApp = it[0].label || it[0].app || '';
  } catch (_) {}

  try {
    const n = await NAT.getActiveNotifications();
    const list = n && (n.notifications || n.items);
    if (Array.isArray(list)) {
      snap.notifs = list.slice(0, 5).map(x => ({
        app: x.app || (x.pkg ? NAT.friendlyApp(x.pkg) : '') || x.title || 'app',
        title: x.title || '',
        text: x.text || ''
      }));
    }
  } catch (_) {}

  cache = formatAmbient(snap);
  cacheAt = now;
  return cache;
}
