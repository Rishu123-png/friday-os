/* ============================================================================
   FRIDAY OS v20.0 HUD — REAL-DATA ENGINE
   Connects every HUD module to real device APIs. NO hardcoded fake values.
   Unavailable → honest "Unavailable" / "Permission required" state.
   Live: compass rotation, telemetry graph, waveform, module pulses.
   ========================================================================== */

import { $ } from './ui.js';
import * as API from './api.js';
import * as DEV from './device.js';
import * as PERFX from './perfx.js';
import * as DEVX from './devx.js';
import * as VOX from './vox.js';
import * as PLAN4 from './plannerx.js';
import * as AUTO from './automation.js';
import { CORE } from './fridaycore.js';
import * as NAT from './native.js';
import * as STORE from './store.js';
import { agentState } from './agent/agentState.js';   // PHASE 2: agent-driven HUD

/* ---------------- pure helpers (unit-tested) ---------------- */

export function compassLabel(deg) {
  if (deg == null || isNaN(deg)) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const d = ((deg % 360) + 360) % 360;
  return `${Math.round(d)}° ${dirs[Math.round(d / 45) % 8]}`;
}

export function fmtCoord(v, axis) {
  if (v == null || isNaN(v)) return '—';
  const dir = axis === 'lat' ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
  return `${Math.abs(v).toFixed(2)}° ${dir}`;
}

export function fmtSpeed(kph) {
  if (kph == null || isNaN(kph)) return '—';
  return kph.toFixed(1) + ' km/h';
}

export function fmtBytesMB(v) {
  if (v == null || isNaN(v)) return '—';
  return (v / 1048576).toFixed(1) + ' MB';
}

export function netQuality(rtt, downlink) {
  if (rtt == null && downlink == null) return '—';
  let score = 0;
  if (rtt != null) { if (rtt < 60) score += 50; else if (rtt < 150) score += 35; else if (rtt < 400) score += 18; else score += 5; }
  if (downlink != null) { if (downlink >= 5) score += 50; else if (downlink >= 1.5) score += 35; else if (downlink >= 0.5) score += 18; else score += 5; }
  return score >= 80 ? 'Excellent' : score >= 55 ? 'Good' : score >= 30 ? 'Fair' : 'Weak';
}

export function voiceStateLabel(state) {
  const map = {
    OFFLINE: 'OFFLINE', INITIALIZING: 'BOOT', READY: 'READY', LISTENING: 'LISTENING',
    UNDERSTANDING: 'THINKING', THINKING: 'THINKING', EXECUTING: 'EXECUTING',
    SPEAKING: 'SPEAKING', SLEEPING: 'STANDBY', WAITING: 'STANDBY', ERROR: 'FAULT'
  };
  return map[String(state || '').toUpperCase()] || String(state || 'READY');
}

/* ---------------- runtime (guarded) ---------------- */

const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };

let _running = false;
let _graph = [];
let _locationBusy = false;
let _lastLocationAttempt = 0;
let _networkBusy = false;
let _lastNetworkAttempt = 0;
let _weatherBusy = false;
let _lastWeatherAttempt = 0;
let _bluetoothBusy = false;
let _lastBluetoothAttempt = 0;
let _lastSuggestionAttempt = 0;
const GRAPH_MAX = 60;

/* ---- Location: real geolocation + reverse geocode ---- */
async function updateLocation() {
  const now = Date.now();
  if (_locationBusy || now - _lastLocationAttempt < 30000) return;
  _locationBusy = true;
  _lastLocationAttempt = now;
  const elCity = $('#locCity'), elRegion = $('#locRegion'), elCoords = $('#locCoords'),
        elAcc = $('#locAcc'), elAlt = $('#locAlt'), elSpeed = $('#locSpeed');
  if (!elCity) { _locationBusy = false; return; }
  try {
    const pos = await API.getPosition(7000);
    const lat = pos.lat, lon = pos.lon, acc = pos.acc;
    set('locCoords', `${fmtCoord(lat, 'lat')}, ${fmtCoord(lon, 'lon')}`);
    if (elAcc) elAcc.textContent = acc != null ? Math.round(acc) + ' m' : '—';
    if (elAlt) elAlt.textContent = pos.altitude != null ? Math.round(pos.altitude) + ' m' : 'NOT REPORTED';
    if (elSpeed) elSpeed.textContent = pos.speed != null ? fmtSpeed(pos.speed * 3.6) : 'NOT REPORTED';
    try {
      const place = await API.reverseGeocode(lat, lon);
      const parts = String(place || '').split(',');
      if (elCity) elCity.textContent = (parts[0] || 'GPS FIX').toUpperCase();
      if (elRegion) elRegion.textContent = parts.length > 1 ? parts.slice(1).join(',').trim().toUpperCase() : 'LIVE DEVICE LOCATION';
    } catch (_) {
      if (elCity) elCity.textContent = 'GPS FIX';
      if (elRegion) elRegion.textContent = 'PLACE NAME OFFLINE';
    }
  } catch (e) {
    const reason = (e && e.code === 1) ? 'PERMISSION REQUIRED' : (!navigator.onLine ? 'OFFLINE' : 'UNAVAILABLE');
    if (elCity) elCity.textContent = reason;
    if (elRegion) elRegion.textContent = 'LOCATION NOT REPORTED';
    if (elCoords) elCoords.textContent = '—';
    if (elAcc) elAcc.textContent = '—';
    if (elAlt) elAlt.textContent = '—';
    if (elSpeed) elSpeed.textContent = '—';
  } finally {
    _locationBusy = false;
  }
}

/* ---- Compass: real orientation, rotates the pointer ---- */
async function updateCompass() {
  const val = $('#compassValue'), ptr = document.querySelector('.compass-pointer');
  try {
    if (typeof DeviceOrientationEvent === 'undefined') throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
    if (DeviceOrientationEvent.requestPermission) {
      const p = await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
      if (p !== 'granted') throw Object.assign(new Error('denied'), { code: 'denied' });
    }
    const deg = await new Promise(res => {
      let done = false;
      const cleanup = () => {
        window.removeEventListener('deviceorientationabsolute', h);
        window.removeEventListener('deviceorientation', h);
      };
      const h = e => {
        if (done) return;
        let heading = null;
        if (Number.isFinite(e.webkitCompassHeading)) heading = e.webkitCompassHeading;
        else if (e.absolute === true && Number.isFinite(e.alpha)) heading = (360 - e.alpha) % 360;
        if (heading == null) return; // Never present a relative orientation as a compass bearing.
        done = true;
        cleanup();
        res(heading);
      };
      window.addEventListener('deviceorientationabsolute', h);
      window.addEventListener('deviceorientation', h);
      setTimeout(() => { if (!done) { done = true; cleanup(); res(null); } }, 1600);
    });
    if (deg == null) throw Object.assign(new Error('no reading'), { code: 'unavailable' });
    if (val) val.textContent = compassLabel(deg);
    if (ptr) ptr.style.transform = `rotate(${deg}deg)`;
    const bars = document.querySelectorAll('.signal-bars .bar');
    bars.forEach((b, i) => b.classList.toggle('on', i < 3));
    const sl = document.querySelector('.signal-label');
    if (sl) sl.textContent = 'LIVE';
  } catch (e) {
    if (val) val.textContent = e && e.code === 'denied' ? 'PERMISSION REQUIRED' : 'NOT EXPOSED';
    const sl = document.querySelector('.signal-label');
    if (sl) sl.textContent = 'NO SIGNAL';
    document.querySelectorAll('.signal-bars .bar').forEach(b => b.classList.remove('on'));
  }
}

/* ---- Network: native Wi-Fi audit when available; browser facts otherwise. ---- */
async function updateNetwork() {
  const now = Date.now();
  if (_networkBusy || now - _lastNetworkAttempt < 15000) return;
  _networkBusy = true;
  _lastNetworkAttempt = now;
  try {
    const c = typeof navigator !== 'undefined' && navigator.connection ? navigator.connection : null;
    const online = typeof navigator !== 'undefined' ? navigator.onLine : false;
    set('netStatus', online ? 'CONNECTED' : 'OFFLINE');
    set('netDown', c && typeof c.downlink === 'number' ? c.downlink.toFixed(1) + ' Mbps' : '—');
    set('netUp', 'NOT EXPOSED');
    set('netPing', c && typeof c.rtt === 'number' ? c.rtt + ' ms' : '—');

    if (!online) {
      set('netSsid', 'NO ACTIVE LINK');
      set('netSignal', '—');
      set('netIp', '—');
      return;
    }

    if (NAT.isNative()) {
      const [audit, system] = await Promise.all([
        NAT.wifiAudit().catch(() => null),
        NAT.getSystemState().catch(() => null)
      ]);
      if (audit && audit.ok) {
        set('netSsid', audit.ssid ? String(audit.ssid).toUpperCase() : 'WI-FI CONNECTED');
        const rssi = Number.isFinite(Number(audit.rssi)) ? Number(audit.rssi) : null;
        const quality = rssi == null ? '—' : rssi >= -50 ? 'EXCELLENT' : rssi >= -60 ? 'GOOD' : rssi >= -70 ? 'FAIR' : 'WEAK';
        set('netSignal', rssi == null ? '—' : `${quality} · ${Math.round(rssi)} dBm`);
        set('netIp', audit.ip || 'NOT EXPOSED');
      } else {
        const wifiOn = system && system.ok && typeof system.wifi === 'boolean' ? system.wifi : null;
        set('netSsid', wifiOn === true ? 'WI-FI ON · DETAILS LIMITED' : wifiOn === false ? 'MOBILE / OTHER LINK' : 'ACTIVE LINK');
        set('netSignal', c && (c.rtt != null || c.downlink != null) ? netQuality(c.rtt, c.downlink).toUpperCase() : 'NOT EXPOSED');
        set('netIp', 'NOT EXPOSED');
      }
      return;
    }

    const browserLink = c && (c.type || c.effectiveType) ? String(c.type || c.effectiveType).toUpperCase() : 'BROWSER LINK';
    set('netSsid', browserLink);
    set('netSignal', c && (c.rtt != null || c.downlink != null) ? netQuality(c.rtt, c.downlink).toUpperCase() : 'NOT EXPOSED');
    set('netIp', 'NOT EXPOSED BY BROWSER');
  } finally {
    _networkBusy = false;
  }
}

/* ---- Weather: Open-Meteo for the device's real location only. ---- */
async function updateWeather() {
  const now = Date.now();
  if (_weatherBusy || now - _lastWeatherAttempt < 60000) return;
  _weatherBusy = true;
  _lastWeatherAttempt = now;
  const desc = document.querySelector('.weather-desc');
  const temp = document.querySelector('.weather-main .temp');
  const icon = document.querySelector('.weather-main .weather-icon');
  const stats = document.querySelectorAll('.weather-stats .stat span:last-child');
  const forecast = document.querySelectorAll('.weather-forecast .f-day');
  try {
    const loc = await API.resolveLocation();
    const w = await API.getWeather(loc.lat, loc.lon);
    const c = w.current || {};
    const [d, emo] = API.describeWMO(c.weather_code);
    if (temp) temp.textContent = c.temperature_2m != null ? Math.round(c.temperature_2m) + '°C' : '—';
    if (desc) {
      const cacheNote = `${w._stale ? ' · CACHED WEATHER' : ''}${loc._stale ? ' · CACHED LOCATION' : ''}`;
      desc.textContent = `${(d || 'UNAVAILABLE').toUpperCase()}${cacheNote}`;
    }
    if (icon) icon.textContent = emo || '';
    if (stats[0]) stats[0].textContent = c.relative_humidity_2m != null ? Math.round(c.relative_humidity_2m) + '%' : '—';
    if (stats[1]) stats[1].textContent = c.wind_speed_10m != null ? Math.round(c.wind_speed_10m) + ' km/h' : '—';
    const uvMax = w.daily && Array.isArray(w.daily.uv_index_max) ? w.daily.uv_index_max[0] : null;
    if (stats[2]) stats[2].textContent = Number.isFinite(uvMax) ? uvMax.toFixed(1) : 'NOT PROVIDED';
    if (w.daily && forecast.length) {
      const days = w.daily.time || [];
      const mins = w.daily.temperature_2m_min || [];
      const maxes = w.daily.temperature_2m_max || [];
      const codes = w.daily.weather_code || [];
      forecast.forEach((f, i) => {
        const lbl = f.querySelector('span:first-child');
        const val = f.querySelector('span:last-child');
        if (!days[i]) { if (lbl) lbl.textContent = '—'; if (val) val.textContent = '—'; return; }
        const [dd] = API.describeWMO(codes[i]);
        if (lbl) lbl.textContent = new Date(days[i]).toLocaleDateString([], { weekday: 'short' }).toUpperCase();
        if (val) val.textContent = Number.isFinite(mins[i]) && Number.isFinite(maxes[i])
          ? `${Math.round(mins[i])}°/${Math.round(maxes[i])}°${dd ? ' ' + dd : ''}` : '—';
      });
    }
  } catch (e) {
    const reason = e && e.code === 1 ? 'PERMISSION REQUIRED' : (typeof navigator !== 'undefined' && !navigator.onLine ? 'OFFLINE' : 'UNAVAILABLE');
    if (temp) temp.textContent = '—';
    if (desc) desc.textContent = reason;
    if (icon) icon.textContent = '';
    stats.forEach(el => { el.textContent = '—'; });
    forecast.forEach(f => f.querySelectorAll('span').forEach(el => { el.textContent = '—'; }));
  } finally {
    _weatherBusy = false;
  }
}

/* ---- Bluetooth: native radio state; no fabricated device names/counts. ---- */
async function updateBluetooth() {
  const now = Date.now();
  if (_bluetoothBusy || now - _lastBluetoothAttempt < 15000) return;
  _bluetoothBusy = true;
  _lastBluetoothAttempt = now;
  const status = document.querySelector('.bt-status');
  const count = document.querySelector('.bt-count');
  const list = document.querySelector('.bt-list');
  try {
    if (!NAT.isNative()) {
      if (status) status.textContent = 'WEB PREVIEW';
      if (count) count.textContent = 'RADIO STATE NOT EXPOSED';
      if (list) list.innerHTML = '<div class="bt-device"><div class="bt-info"><span>Browser limitation</span><span>Open the APK for the real radio state</span></div></div>';
      return;
    }
    const system = await NAT.getSystemState().catch(() => null);
    if (!system || !system.ok || typeof system.bluetooth !== 'boolean') {
      if (status) status.textContent = 'UNAVAILABLE';
      if (count) count.textContent = 'RADIO STATE NOT REPORTED';
      if (list) list.innerHTML = '<div class="bt-device"><div class="bt-info"><span>Bluetooth state unavailable</span><span>No device information reported</span></div></div>';
      return;
    }
    const on = system.bluetooth;
    if (status) status.textContent = on ? 'ON' : 'OFF';
    if (count) count.textContent = on ? 'RADIO ENABLED' : 'RADIO DISABLED';
    if (list) list.innerHTML = `<div class="bt-device${on ? ' connected' : ''}"><div class="bt-info"><span>${on ? 'Bluetooth is enabled' : 'Bluetooth is disabled'}</span><span>Connected-device names are not exposed by this bridge</span></div></div>`;
  } finally {
    _bluetoothBusy = false;
  }
}

/* ---- Telemetry: measured runtime load/heap plus native storage/thermal. ---- */
function updateTelemetry() {
  const heap = PERFX.heapStats();
  const snap = DEVX.snapshot();
  const storage = snap.storage;
  const thermal = snap.thermal;
  const circles = document.querySelectorAll('.tel-circle');
  const pct = v => (v != null && !isNaN(v)) ? Math.max(0, Math.min(100, Math.round(v))) : null;
  const heapV = pct(heap.usedPct);
  const storageV = storage ? pct(storage.usedPct != null ? storage.usedPct : (storage.totalGB ? ((storage.totalGB - storage.freeGB) / storage.totalGB) * 100 : null)) : null;
  [[circles[1], heapV], [circles[2], storageV]].forEach(([circle, value]) => {
    if (!circle) return;
    circle.style.setProperty('--p', value == null ? 0 : value);
    const label = circle.querySelector('span');
    if (label) label.textContent = value == null ? '—' : value + '%';
  });
  const details = document.querySelectorAll('.tel-details span');
  if (details[0]) details[0].textContent = heap.usedMB != null && heap.totalMB != null ? `${(heap.usedMB / 1024).toFixed(1)} / ${(heap.totalMB / 1024).toFixed(1)} GB JS heap` : 'JS heap not exposed';
  if (details[1]) details[1].textContent = storage && storage.freeGB != null ? `${storage.freeGB} GB device storage free` : 'Device storage requires APK';
  const t = document.querySelector('.tel-temp span');
  if (t) t.textContent = thermal && thermal.celsius != null ? Math.round(thermal.celsius) + '°C' : 'NOT EXPOSED';
  if (heapV != null) {
    _graph.push(heapV); // Measured JS heap usage; never an invented CPU percentage.
    if (_graph.length > GRAPH_MAX) _graph.shift();
  }
  drawGraph();
}

function drawGraph() {
  const cv = $('#telemetryGraph');
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext('2d');
  const w = cv.width = cv.clientWidth || 200, h = cv.height = cv.clientHeight || 60;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 1.5; ctx.shadowColor = '#00d4ff'; ctx.shadowBlur = 6;
  ctx.beginPath();
  _graph.forEach((v, i) => {
    const x = (i / (GRAPH_MAX - 1)) * w;
    const y = h - (v / 100) * h;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/* ---- Active modules: real CORE health (v16: cached 8s to reduce CPU) ---- */
let _healthCache = null;
let _healthCacheAt = 0;
async function updateModules() {
  if (document.hidden) return; // v16 battery save
  const items = document.querySelectorAll('.modules-list .mod-item');
  if (!items.length) return;
  let health = {};
  try {
    const now = Date.now();
    if (_healthCache && (now - _healthCacheAt) < 8000) {
      health = _healthCache;
    } else {
      health = await CORE.healthMap();
      _healthCache = health;
      _healthCacheAt = now;
    }
  } catch (_) {}
  const map = { voice: 'voice', vision: 'visionx', memory: 'cognition', automation: 'autox', notifications: 'notifications', 'ai router': 'air' };
  items.forEach(item => {
    const name = String(item.textContent || '').toUpperCase();
    const key = Object.keys(map).find(k => name.includes(k.toUpperCase()));
    const h = key ? health[map[key]] : null;
    const dot = item.querySelector('.mod-dot');
    const val = item.querySelector('.mod-val');
    if (dot) {
      dot.className = 'mod-dot ' + (h && h.ok ? 'on' : h && h.state === 'error' ? 'off' : 'standby');
    }
    if (val) {
      if (key === 'automation' && h && h.ok) val.textContent = 'Active';
      else if (key === 'notifications' && h && h.ok) val.textContent = h.detail || 'Listening';
      else if (!h) val.textContent = '—';
    }
  });
}

/* ---- Agenda: real plannerx today ---- */
function updateAgenda() {
  const list = document.querySelector('.agenda-list');
  if (!list) return;
  const items = PLAN4.todayAgenda();
  if (!items.length) {
    list.innerHTML = '<div class="agenda-item"><span class="time">—</span><div class="details"><span>Nothing scheduled</span><span>Enjoy the day, Boss</span></div></div>';
    return;
  }
  list.innerHTML = items.slice(0, 4).map(it => {
    const t = it.time ? it.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    return `<div class="agenda-item"><span class="time">${t}</span><div class="details"><span>${String(it.text).slice(0, 40)}</span><span>${it.type}</span></div></div>`;
  }).join('');
}

/* ---- Suggestion + alarm + wake: real ---- */
async function updateSuggestion() {
  const now = Date.now();
  if (now - _lastSuggestionAttempt < 60000) return;
  _lastSuggestionAttempt = now;
  const p = document.querySelector('.suggestion-content p');
  if (!p) return;
  try {
    const loc = await API.resolveLocation();
    const wx = await API.getWeather(loc.lat, loc.lon).catch(() => null);
    const rain = wx && wx.daily && wx.daily.precipitation_probability_max ? wx.daily.precipitation_probability_max[0] : null;
    if (!loc._stale && wx && !wx._stale && rain != null && rain >= 50) { p.textContent = `It may rain in the next 24h (${rain}% chance) — umbrella rakho.`; return; }
  } catch (_) {}
  const b = await DEV.battery().catch(() => null);
  if (b && typeof b.level === 'number' && b.level <= 20 && !b.charging) { p.textContent = `Battery is below 20% (${Math.round(b.level)}%) — charger lagao.`; return; }
  const next = (STORE.getList(STORE.KEYS.REMINDERS) || []).filter(r => !r.done && r.due > Date.now()).sort((a, b) => a.due - b.due)[0];
  if (next) { p.textContent = `Next up: ${next.text} at ${new Date(next.due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`; return; }
  p.textContent = 'Ready when you are, Boss. Tap the core or mic to talk.';
}

function updateAlarm() {
  const time = document.querySelector('.alarm-display .alarm-time');
  const days = document.querySelector('.alarm-display .alarm-days');
  const now = new Date();
  const acceptsDay = (repeat, dow) => {
    if (repeat === 'daily' || repeat === 'once') return true;
    if (repeat === 'weekdays') return dow >= 1 && dow <= 5;
    if (repeat === 'weekends') return dow === 0 || dow === 6;
    return /^[0-6](,[0-6])*$/.test(repeat || '') && repeat.split(',').map(Number).includes(dow);
  };
  const nextAt = a => {
    const parts = String(a.time || '').split(':').map(Number);
    if (parts.length !== 2 || !Number.isInteger(parts[0]) || !Number.isInteger(parts[1])) return null;
    for (let offset = 0; offset < 8; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, parts[0], parts[1], 0, 0);
      if (d > now && acceptsDay(a.repeat, d.getDay())) return d;
    }
    return null;
  };
  const list = AUTO.alarms()
    .filter(a => a.enabled)
    .map(a => ({ alarm: a, at: nextAt(a) }))
    .filter(x => x.at)
    .sort((a, b) => a.at - b.at);
  if (!list.length) {
    if (time) time.textContent = '—';
    if (days) days.textContent = 'No alarms set';
    return;
  }
  const { alarm: a, at } = list[0];
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const dateLabel = at.toDateString() === now.toDateString() ? 'Today' : at.toDateString() === tomorrow.toDateString() ? 'Tomorrow' : at.toLocaleDateString([], { weekday: 'short' });
  const repeatLabel = a.repeat === 'daily' ? 'Everyday' : a.repeat === 'weekdays' ? 'Weekdays' : a.repeat === 'weekends' ? 'Weekends' : a.repeat === 'once' ? 'Once' : a.repeat;
  if (time) time.textContent = a.time;
  if (days) days.textContent = `${dateLabel} · ${repeatLabel}`;
}

function updateWake() {
  const text = document.querySelector('.wake-text');
  const sub = document.querySelector('.wake-sub');
  if (text) text.textContent = (STORE.getSetting('wakeKeyword') || 'FRIDAY').toUpperCase();
  if (sub) sub.textContent = STORE.getSetting('wakeWord') ? 'Wake word ON' : 'Wake word OFF — say "turn on wake word"';
}

/* ---- Battery + voice state ---- */
async function updateBattery() {
  const b = await DEV.battery().catch(() => null);
    const batteryCircle = document.querySelector('.tel-circle');
    if (b && typeof b.level === 'number') {
      const batteryPct = Math.max(0, Math.min(100, Math.round(b.level)));
      set('statusBattery', batteryPct + '%');
      const ch = $('#statusCharging');
      if (ch) ch.style.display = b.charging ? 'block' : 'none';
      if (batteryCircle) {
        batteryCircle.style.setProperty('--p', batteryPct);
        const label = batteryCircle.querySelector('span');
        if (label) label.textContent = batteryPct + '%';
      }
    } else {
      set('statusBattery', '—');
      const ch = $('#statusCharging');
      if (ch) ch.style.display = 'none';
      if (batteryCircle) {
        batteryCircle.style.setProperty('--p', 0);
        const label = batteryCircle.querySelector('span');
        if (label) label.textContent = '—';
      }
    }
}

function updateVoice() {
  if (document.hidden) return; // v16: save battery when hidden
  const st = VOX.vox.get();
  const coreStatus = $('#listeningText');
  // PHASE 2: while the agent is actively working, the core label shows the
  // REAL agent state (painted by hud-agent.js), not the voice engine
  if (coreStatus && !agentState.isActive()) coreStatus.textContent = voiceStateLabel(st);
  const bars = document.querySelectorAll('#voiceWaveform .wave-bar');
  const live = st === 'LISTENING' || st === 'SPEAKING' || st === 'UNDERSTANDING' || st === 'THINKING' || st === 'EXECUTING';
  bars.forEach(b => b.classList.toggle('active', live));
  const wb = document.querySelector('#wakeWaveform');
  if (wb && wb.getContext) {
    const ctx = wb.getContext('2d');
    const w = wb.width = wb.clientWidth || 120, h = wb.height = wb.clientHeight || 30;
    ctx.clearRect(0, 0, w, h);
    if (live) {
      ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const y = h / 2 + Math.sin(x * 0.25 + Date.now() * 0.01) * 6 + (Math.random() * 4 - 2);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

/* ---- main tick ---- */
async function tick() {
  if (typeof document !== 'undefined' && document.hidden) return;   // battery: pause hidden
  updateBattery();
  updateNetwork();
  updateBluetooth();
  updateTelemetry();
  updateAgenda();
  updateAlarm();
  updateWake();
  updateVoice();
  updateCompass();
  updateLocation();
  updateWeather();
  updateModules();
  updateSuggestion();
}

let _voiceTimer = null;
let _graphTimer = null;
let _tickTimer = null;

export function initHUDV20() {
  if (_running) return; _running = true;
  tick();
  _tickTimer = setInterval(tick, 3000);
  _voiceTimer = setInterval(() => { if (!document.hidden) updateVoice(); }, 700);
  _graphTimer = setInterval(() => { if (!document.hidden) drawGraph(); }, 1500);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      tick();
      updateVoice();
      drawGraph();
    }
  });
  return { ok: true };
}

export function stopHUDV20() {
  _running = false;
  clearInterval(_tickTimer); clearInterval(_voiceTimer); clearInterval(_graphTimer);
  return { ok: true };
}
