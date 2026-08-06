/* ============================================================================
   FRIDAY OS — DEVX: Device Engine (v12.2.0 / Phase 10)
   Continuous awareness of the phone's health & hardware — battery, storage,
   CPU/RAM, thermal, network, bluetooth, sensors — plus a diagnostics
   dashboard and event-driven automation hooks.

   PERFORMANCE CONTRACT (per spec, tuned for OPPO K13x): event-driven only.
   No new polling loops — DEVX rides the events the app already emits
   (the 30s battery poll, online/offline, notification, autox events) and
   recomputes on demand. idles at ~0% extra CPU.
   ========================================================================== */

import { getList, saveList } from './store.js';
import { Bus, Logger } from './fridaycore.js';

const DEVLOG = 'friday_devlog';

/* ---------------- 1) Battery Manager (pure) ---------------- */

export function batteryStatus(b = {}) {
  const pct = b.level != null ? Math.round(b.level) : null;
  const charging = !!b.charging;
  let tier = 'good', alert = null, health = 'unknown';
  if (pct == null) return { pct: null, tier: 'unknown', charging, health, alert: null, estText: '' };
  if (pct <= 15 && !charging) { tier = 'critical'; alert = 'battery_critical'; }
  else if (pct <= 30 && !charging) { tier = 'low'; alert = 'battery_low'; }
  else if (charging && pct >= 98) alert = 'battery_full';
  if (pct >= 80) health = 'good'; else if (pct >= 40) health = 'fair'; else health = 'poor';
  // rough estimate: 1%/min drain → minutes left
  const estText = charging ? (pct >= 98 ? 'charging — almost full' : 'charging…') : pct <= 30 ? `~${pct} min left (est)` : '';
  return { pct, tier, charging, health, alert, estText };
}

/* ---------------- 2) Storage Manager (pure) ---------------- */

export function storageStatus(s = {}) {
  const total = s.totalGB || 0, used = s.usedGB || 0;
  if (!total) return { freeGB: null, usedPct: null, tier: 'unknown', alert: null };
  const usedPct = Math.round((used / total) * 100);
  const freeGB = +(total - used).toFixed(1);
  let tier = 'good', alert = null;
  if (freeGB <= 1.5) { tier = 'critical'; alert = 'storage_critical'; }
  else if (freeGB <= 5) { tier = 'warn'; alert = 'storage_low'; }
  return { freeGB, usedPct, tier, alert, largeFiles: s.largeFiles || 0, cacheMB: s.cacheMB || 0 };
}

/* ---------------- 3) Thermal Monitor (pure) ---------------- */

export function thermalStatus(t = {}) {
  const c = t.celsius;
  if (c == null) return { celsius: null, tier: 'unknown', alert: null };
  let tier = 'cool', alert = null;
  if (c >= 50) { tier = 'hot'; alert = 'thermal_hot'; }
  else if (c >= 43) { tier = 'warm'; alert = 'thermal_warm'; }
  else if (c >= 38) tier = 'warm';
  return { celsius: c, tier, alert, throttling: !!t.throttling };
}

/* ---------------- 4) RAM Monitor (pure) ---------------- */

export function ramStatus(m = {}) {
  const total = m.totalMB || 0;
  const used = m.usedMB || 0;
  if (!total) return { usedPct: null, freeMB: null, cachedMB: null, pressure: 'unknown' };
  const usedPct = Math.round((used / total) * 100);
  const freeMB = Math.max(0, total - used);
  let pressure = 'ok';
  if (usedPct >= 85) pressure = 'high';
  else if (usedPct >= 70) pressure = 'moderate';
  return { usedPct, freeMB, cachedMB: m.cachedMB || 0, pressure };
}

/* ---------------- 5) Network Manager (pure) ---------------- */

export function netStatus(n = {}) {
  const online = !!n.online;
  const wifi = !!n.wifi;
  const cellular = !!n.cellular;
  let signal = 'none';
  if (wifi) signal = 'strong';
  else if (n.signal != null) signal = n.signal >= -80 ? 'good' : n.signal >= -95 ? 'weak' : 'none';
  let latencyTier = 'unknown';
  if (n.latencyMs != null) latencyTier = n.latencyMs < 80 ? 'fast' : n.latencyMs < 200 ? 'ok' : 'slow';
  return { online, wifi, cellular, signal, latencyTier, latencyMs: n.latencyMs };
}

/* ---------------- 6) Bluetooth + Sensors (pure) ---------------- */

export function sensorReport(sensors = {}) {
  /* sensor entries are { present, x?, y?, z?, value? } */
  const isPres = v => v && (v.present === true || (typeof v === 'object' && (v.x !== undefined || v.value !== undefined)));
  return {
    present: Object.entries(sensors).filter(([, v]) => isPres(v)).map(([k]) => k),
    missing: Object.entries(sensors).filter(([, v]) => !isPres(v)).map(([k]) => k)
  };
}

/** Human summary of the sensor map — used by the diagnostics dashboard. */
export function sensorSummary(sensors = {}) {
  const s = sensorReport(sensors || {});
  if (!s.present.length) return 'no sensors';
  return s.present.join(', ');
}

export function btStatus(bt = {}) {
  const devices = Array.isArray(bt.devices) ? bt.devices : [];
  return {
    on: !!bt.on,
    devices: devices.slice(0, 5),
    count: devices.length,
    audioActive: devices.some(d => d.type === 'audio' && d.connected)
  };
}

/* ---------------- 7) Alert Manager (pure — informative, not intrusive) ---------------- */

export function alertLevel(metrics = {}) {
  const alerts = [];
  const push = (id, sev, text, action = null) => alerts.push({ id, sev, text, action });

  const b = batteryStatus(metrics.battery);
  if (b.alert === 'battery_critical') push('battery_critical', 'crit', `Battery ${b.pct}% — charger lagao, ya battery saver on karun?`, { type: 'battery_saver' });
  else if (b.alert === 'battery_low') push('battery_low', 'warn', `Battery ${b.pct}% — power bacha ke chalo.`, null);

  const st = storageStatus(metrics.storage);
  if (st.alert === 'storage_critical') push('storage_critical', 'crit', `Sirf ${st.freeGB}GB storage bacha hai — cleanup karun?`, { type: 'storage_clean' });
  else if (st.alert === 'storage_low') push('storage_low', 'warn', `Storage ${st.usedPct}% full hai — cache clean-up suggest karta hoon.`, { type: 'storage_clean' });

  const th = thermalStatus(metrics.thermal);
  if (th.alert === 'thermal_hot') push('thermal_hot', 'crit', `Phone ${th.celsius}°C — heavy AI tasks pause karta hoon.`, { type: 'cool_down' });
  else if (th.alert === 'thermal_warm') push('thermal_warm', 'warn', `Phone ${th.celsius}°C — thoda cool hone de.`, null);

  const n = netStatus(metrics.network);
  if (n.online && n.signal === 'weak') push('net_weak', 'warn', 'Network weak — sync/baade downloads abhi skip. ', null);
  if (n.online === false) push('net_off', 'info', 'Offline mode: local engine sab ready hai.', null);

  return alerts;
}

/* ---------------- 8) Diagnostics Dashboard (pure formatter) ---------------- */

export function dashRows({ services = {}, metrics = {}, extras = {} } = {}) {
  const rows = [];
  const svcCount = Object.keys(services).length;
  const svcOk = Object.values(services).filter(s => s && s.ok).length;
  rows.push({ k: 'Running services', v: `${svcOk}/${svcCount}`, sev: svcOk === svcCount ? 'ok' : 'warn' });
  if (extras.aiLatencyMs != null) rows.push({ k: 'AI latency', v: extras.aiLatencyMs + ' ms', sev: extras.aiLatencyMs < 800 ? 'ok' : 'warn' });
  if (metrics.battery) rows.push({ k: 'Battery', v: batteryStatus(metrics.battery).pct + '%', sev: batteryStatus(metrics.battery).tier });
  if (metrics.thermal) {
    const t = thermalStatus(metrics.thermal);
    const th = metrics.thermal;
    let v = t.celsius != null ? t.celsius + '°C' : '—';
    if (th && th.cpuCelsius != null && th.cpuCelsius !== th.celsius) v += ' (cpu ' + th.cpuCelsius + '°C)';
    if (th && th.throttling) v += ' ⚠ throttling';
    rows.push({ k: 'Temperature', v, sev: t.tier });
  }
  if (metrics.ram) { const r = ramStatus(metrics.ram); rows.push({ k: 'RAM', v: r.usedPct != null ? r.usedPct + '% used' : '—', sev: r.pressure }); }
  if (metrics.storage) { const s = storageStatus(metrics.storage); rows.push({ k: 'Storage', v: s.usedPct != null ? s.usedPct + '% used · ' + s.freeGB + 'GB free' : '—', sev: s.tier }); }
  if (extras.automations != null) rows.push({ k: 'Active automations', v: extras.automations, sev: 'ok' });
  if (extras.voice != null) rows.push({ k: 'Voice', v: extras.voice, sev: 'ok' });
  if (extras.vision != null) rows.push({ k: 'Vision', v: extras.vision, sev: 'ok' });
  if (metrics.sensors) { const s = sensorSummary(metrics.sensors); if (s !== 'no sensors') rows.push({ k: 'Sensors', v: s, sev: 'ok' }); }
  if (extras.planner != null) rows.push({ k: 'Planner', v: extras.planner, sev: 'ok' });
  if (extras.eventQueue != null) rows.push({ k: 'Event queue', v: extras.eventQueue, sev: 'ok' });
  if (extras.uptimeSec != null) rows.push({ k: 'Uptime', v: Math.round(extras.uptimeSec / 60) + ' min', sev: 'ok' });
  if (extras.crashes != null && extras.crashes > 0) rows.push({ k: 'Recoveries', v: extras.crashes, sev: 'warn' });
  return rows;
}

/* ---------------- 9) Device event log (runtime, persisted) ---------------- */

export function devLog() { return getList(DEVLOG).slice(0, 60); }

function log(entry) {
  saveList(DEVLOG, [{ ts: Date.now(), ...entry }, ...getList(DEVLOG)].slice(0, 150));
}

/* ---------------- 10) Runtime monitor ----------------
   start(readers): readers = { battery(), storage(), network(), thermal?(), ram?(), sensors?() }
   Rides existing bus events + on-demand snapshots. Emits:
     'devx:snapshot' (metrics), 'devx:alert' (alerts[]), 'devx:event' (typed event) */
let _readers = null;
let _snap = {};
let _armed = false;

export function start(readers) {
  if (_armed) return true;
  _armed = true;
  _readers = readers || {};
  Bus.on('devx:refresh', () => { refresh().catch(() => {}); });
  // typed automation events ride the same bus AUTOX/app listen to
  Bus.on('devx:event', e => {
    if (e && e.type) {
      log({ kind: 'event', type: e.type, detail: e.detail || '' });
      Bus.emit('autox:event', { event: e.type, payload: e.payload || {} });
    }
  });
  Logger.info('devx', 'device engine armed (event-driven)');
  return true;
}

export async function refresh() {
  const out = {};
  const safe = async fn => { try { return await fn(); } catch (_) { return null; } };
  const prev = _snap;
  if (_readers.battery) out.battery = await safe(_readers.battery);
  if (_readers.storage) out.storage = await safe(_readers.storage);
  if (_readers.network) out.network = await safe(_readers.network);
  if (_readers.thermal) out.thermal = await safe(_readers.thermal);
  if (_readers.ram) out.ram = await safe(_readers.ram);
  if (_readers.sensors) out.sensors = await safe(_readers.sensors);
  _snap = out;

  // log state transitions (device state changes / thermal / network)
  const b = batteryStatus(out.battery);
  if (prev.battery && batteryStatus(prev.battery).pct !== b.pct && b.alert) log({ kind: 'battery', detail: b.alert, pct: b.pct });
  const t = thermalStatus(out.thermal);
  if (prev.thermal && thermalStatus(prev.thermal).tier !== t.tier && t.tier === 'hot') log({ kind: 'thermal', detail: t.celsius + '°C' });
  const n = netStatus(out.network);
  if (prev.network && netStatus(prev.network).online !== n.online) log({ kind: 'network', detail: n.online ? 'online' : 'offline' });

  const alerts = alertLevel(out);
  if (alerts.length) {
    Bus.emit('devx:alert', alerts);
    for (const a of alerts) log({ kind: 'alert', detail: a.id, sev: a.sev });
  }
  Bus.emit('devx:snapshot', out);
  return out;
}

export function snapshot() { return _snap; }
export function alerts() { return alertLevel(_snap); }

export function dashboard() {
  const log = getList(DEVLOG);
  return {
    events: log.length,
    alerts: alertLevel(_snap).length,
    last: log[0] || null,
    battery: batteryStatus(_snap.battery),
    storage: storageStatus(_snap.storage),
    thermal: thermalStatus(_snap.thermal),
    network: netStatus(_snap.network),
    ram: ramStatus(_snap.ram),
    sensors: sensorSummary(_snap.sensors)   // v15: real sensor availability
  };
}
