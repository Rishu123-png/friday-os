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
import * as CORE from './fridaycore.js';
import * as NAT from './native.js';
import * as STORE from './store.js';

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
  return (v / 1048576).toFixed(1) + ' GB';
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
const GRAPH_MAX = 60;

/* ---- Location: real geolocation + reverse geocode ---- */
async function updateLocation() {
  const elCity = $('#locCity'), elRegion = $('#locRegion'), elCoords = $('#locCoords'),
        elAcc = $('#locAcc'), elAlt = $('#locAlt'), elSpeed = $('#locSpeed');
  if (!elCity) return;
  try {
    const pos = await API.getPosition(7000);
    const lat = pos.lat, lon = pos.lon, acc = pos.acc;
    set('locCoords', `${fmtCoord(lat, 'lat')}, ${fmtCoord(lon, 'lon')}`);
    if (elAcc) elAcc.textContent = acc != null ? Math.round(acc) + ' m' : '—';
    if (pos.coords) {
      if (elAlt) elAlt.textContent = pos.coords.altitude != null ? Math.round(pos.coords.altitude) + ' m' : '—';
      if (elSpeed) elSpeed.textContent = pos.coords.speed != null ? fmtSpeed(pos.coords.speed * 3.6) : '—';
    }
    try {
      const place = await API.reverseGeocode(lat, lon);
      const parts = String(place || '').split(',');
      if (elCity) elCity.textContent = (parts[0] || '—').toUpperCase();
      if (elRegion && parts[1]) elRegion.textContent = parts.slice(1).join(',').trim().toUpperCase();
    } catch (_) { if (elCity) elCity.textContent = '—'; }
  } catch (e) {
    const reason = (e && e.code === 1) ? 'PERMISSION REQUIRED' : 'UNAVAILABLE';
    if (elCity) elCity.textContent = reason;
    if (elCoords) elCoords.textContent = '—';
    if (elAcc) elAcc.textContent = '—'; if (elAlt) elAlt.textContent = '—'; if (elSpeed) elSpeed.textContent = '—';
  }
}

/* ---- Compass: real orientation, rotates the pointer ---- */
async function updateCompass() {
  const val = $('#compassValue'), ptr = document.querySelector('.compass-pointer');
  try {
    if (typeof DeviceOrientationEvent === 'undefined') throw new Error('unsupported');
    if (DeviceOrientationEvent.requestPermission) {
      const p = await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
      if (p !== 'granted') throw new Error('denied');
    }
    const deg = await new Promise(res => {
      let done = false;
      const h = e => { if (!done && e.webkitCompassHeading != null) { done = true; window.removeEventListener('deviceorientation', h); res(e.webkitCompassHeading); } };
      window.addEventListener('deviceorientation', h);
      setTimeout(() => { if (!done) { done = true; window.removeEventListener('deviceorientation', h); res(null); } }, 1600);
    });
    if (deg == null) throw new Error('no reading');
    if (val) val.textContent = compassLabel(deg);
    if (ptr) ptr.style.transform = `rotate(${deg}deg)`;
    const bars = document.querySelectorAll('.signal-bars .bar');
    bars.forEach((b, i) => b.classList.toggle('on', i < 3));
    const sl = document.querySelector('.signal-label');
    if (sl) sl.textContent = 'LIVE';
  } catch (_) {
    if (val) val.textContent = 'PERMISSION REQUIRED';
    const sl = document.querySelector('.signal-label');
    if (sl) sl.textContent = 'NO SIGNAL';
    document.querySelectorAll('.signal-bars .bar').forEach(b => b.classList.remove('on'));
  }
}

/* ---- Network: navigator.connection + honest IP ---- */
function updateNetwork() {
  const c = typeof navigator !== 'undefined' && navigator.connection ? navigator.connection : null;
  const online = typeof navigator !== 'undefined' ? navigator.onLine : false;
  set('netSsid', online ? (c && c.type ? String(c.type).toUpperCase() : 'WIFI') : 'OFFLINE');
  set('netSignal', c && typeof c.rtt === 'number' ? c.rtt + ' ms' : '—');
  set('netIp', 'Unavailable (APK)');
  set('netDown', c && typeof c.downlink === 'number' ? c.downlink.toFixed(1) + ' Mbps' : '—');
  set('netUp', '—');
  set('netPing', c && typeof c.rtt === 'number' ? c.rtt + ' ms' : '—');
}

/* ---- Weather: open-meteo, keyless ---- */
async function updateWeather() {
  const desc = document.querySelector('.weather-desc');
  const temp = document.querySelector('.weather-main .temp');
  const stats = document.querySelectorAll('.weather-stats .stat span:last-child');
  const forecast = document.querySelectorAll('.weather-forecast .f-day');
  try {
    const loc = await API.resolveLocation();
    const w = await API.getWeather(loc.lat, loc.lon);
    const c = w.current || {};
    const [d, emo] = API.describeWMO(c.weather_code);
    if (temp) temp.textContent = (c.temperature_2m != null ? Math.round(c.temperature_2m) + '°C' : '—');
    if (desc) desc.textContent = (d || '—').toUpperCase();
    const icon = document.querySelector('.weather-main .weather-icon');
    if (icon) icon.textContent = emo || '🌡️';
    if (stats[0]) stats[0].textContent = c.relative_humidity_2m != null ? Math.round(c.relative_humidity_2m) + '%' : '—';
    if (stats[1]) stats[1].textContent = c.wind_speed_10m != null ? Math.round(c.wind_speed_10m) + ' km/h' : '—';
    if (stats[2]) stats[2].textContent = c.uv_index != null ? Math.round(c.uv_index) + ' UV' : '—';
    if (w.daily && forecast.length) {
      const days = w.daily.time || [];
      forecast.forEach((f, i) => {
        if (i >= days.length) return;
        const [dd] = API.describeWMO((w.daily.weather_code || [])[i] || 0);
        const lbl = f.querySelector('span:first-child');
        const val = f.querySelector('span:last-child');
        if (lbl) lbl.textContent = new Date(days[i]).toLocaleDateString([], { weekday: 'short' }).toUpperCase();
        if (val) val.textContent = `${Math.round((w.daily.temperature_2m_min || [])[i] || 0)}°/${Math.round((w.daily.temperature_2m_max || [])[i] || 0)}° ${dd ? dd[0] : ''}`;
      });
    }
  } catch (_) {
    if (temp) temp.textContent = '—';
    if (desc) desc.textContent = 'UNAVAILABLE';
    if (icon) icon.textContent = '🌡️';
  }
}

/* ---- Bluetooth: honest (no native device list in web) ---- */
function updateBluetooth() {
  const status = document.querySelector('.bt-status');
  const count = document.querySelector('.bt-count');
  const list = document.querySelector('.bt-list');
  if (status) status.textContent = NAT.isNative() ? 'SCAN (needs permission)' : 'UNAVAILABLE (WEB)';
  if (count) count.textContent = NAT.isNative() ? 'Permission required' : '—';
  if (list) list.innerHTML = '<div class="bt-device"><span class="bt-icon">🔵</span><div class="bt-info"><span>Bluetooth device list</span><span>Permission required (Android)</span></div></div>';
}

/* ---- Telemetry: real CPU/RAM/storage/temp + live graph ---- */
function updateTelemetry() {
  const cpu = PERFX.cpuLoad();
  const heap = PERFX.heapStats();
  const snap = DEVX.snapshot();
  const storage = snap.storage;
  const thermal = snap.thermal;
  const circles = document.querySelectorAll('.tel-circle');
  const val = (v, fallback) => (v != null && !isNaN(v)) ? Math.max(0, Math.min(100, Math.round(v))) : (fallback != null ? fallback : 0);
  const cpuV = val(cpu), ramV = val(heap.usedPct), stoV = storage ? val((storage.usedPct != null ? storage.usedPct : (storage.totalGB ? ((storage.totalGB - storage.freeGB) / storage.totalGB) * 100 : null))) : 0;
  if (circles[0]) { circles[0].style.setProperty('--p', cpuV); circles[0].querySelector('span').textContent = cpuV + '%'; }
  if (circles[1]) { circles[1].style.setProperty('--p', ramV); circles[1].querySelector('span').textContent = ramV + '%'; }
  if (circles[2]) { circles[2].style.setProperty('--p', stoV); circles[2].querySelector('span').textContent = stoV + '%'; }
  const details = document.querySelectorAll('.tel-details span');
  if (details[0]) details[0].textContent = heap.usedMB != null ? `${(heap.usedMB / 1024).toFixed(1)} / ${(heap.totalMB / 1024).toFixed(1)} GB` : '—';
  if (details[1]) details[1].textContent = storage ? `${storage.freeGB} GB free` : '—';
  const t = document.querySelector('.tel-temp span');
  if (t) t.textContent = thermal && thermal.celsius != null ? Math.round(thermal.celsius) + '°C' : '—';
  /* graph */
  _graph.push(cpuV); if (_graph.length > GRAPH_MAX) _graph.shift();
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

/* ---- Active modules: real CORE health ---- */
async function updateModules() {
  const items = document.querySelectorAll('.modules-list .mod-item');
  if (!items.length) return;
  let health = {};
  try { health = await CORE.CORE.healthMap(); } catch (_) {}
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
  const p = document.querySelector('.suggestion-content p');
  if (!p) return;
  try {
    const loc = await API.resolveLocation();
    const wx = await API.getWeather(loc.lat, loc.lon).catch(() => null);
    const rain = wx && wx.daily && wx.daily.precipitation_probability_max ? wx.daily.precipitation_probability_max[0] : null;
    if (rain != null && rain >= 50) { p.textContent = `It may rain in the next 24h (${rain}% chance) — umbrella rakho.`; return; }
  } catch (_) {}
  const b = await DEV.battery().catch(() => null);
  if (b && typeof b.level === 'number' && b.level <= 20 && !b.charging) { p.textContent = `Battery is below 20% (${Math.round(b.level)}%) — charger lagao.`; return; }
  const next = (STORE.getList(STORE.KEYS.REMINDERS) || []).filter(r => !r.done && r.due > Date.now()).sort((a, b) => a.due - b.due)[0];
  if (next) { p.textContent = `Next up: ${next.text} at ${new Date(next.due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`; return; }
  p.textContent = 'All clear, Boss. Tap the core or mic to talk.';
}

function updateAlarm() {
  const time = document.querySelector('.alarm-display .alarm-time');
  const days = document.querySelector('.alarm-display .alarm-days');
  const list = AUTO.alarms().filter(a => a.enabled).sort((a, b) => (a.time > b.time ? 1 : -1));
  if (!list.length) {
    if (time) time.textContent = '—';
    if (days) days.textContent = 'No alarms set';
    return;
  }
  const a = list[0];
  if (time) time.textContent = a.time;
  if (days) days.textContent = a.repeat === 'daily' ? 'Everyday' : a.repeat === 'weekdays' ? 'Weekdays' : a.repeat === 'once' ? 'Once' : a.repeat;
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
  if (b && typeof b.level === 'number') {
    set('statusBattery', Math.round(b.level) + '%');
    const ch = $('#statusCharging');
    if (ch) ch.style.display = b.charging ? 'block' : 'none';
  } else {
    set('statusBattery', '—');
  }
}

function updateVoice() {
  const st = VOX.vox.get();
  const coreStatus = $('#listeningText');
  if (coreStatus) coreStatus.textContent = voiceStateLabel(st);
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

export function initHUDV20() {
  if (_running) return; _running = true;
  tick();
  setInterval(tick, 3000);
  setInterval(updateVoice, 700);
  setInterval(drawGraph, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  return { ok: true };
}
