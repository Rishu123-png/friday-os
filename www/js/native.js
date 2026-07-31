/* ===== FRIDAY OS — Native Bridge (Phase B + C) =====
   Talks to the custom Capacitor plugin "FridayNative".

   EVERY function degrades gracefully:
     - In a browser  -> returns { ok:false, reason:'web' } and the app carries on
     - In the APK    -> calls real Android APIs

   Nothing here can crash the app. */

import { getSetting } from './store.js';

const CAP = () => (typeof window !== 'undefined' ? window.Capacitor : null);

export function isNative() {
  const c = CAP();
  return !!(c && c.isNativePlatform && c.isNativePlatform());
}

function plugin() {
  const c = CAP();
  return c && c.Plugins ? c.Plugins.FridayNative : null;
}

/** Named-plugin access (FridaySensors / FridayHealthConnect / ...). */
function pluginNamed(name) {
  const c = CAP();
  return c && c.Plugins ? c.Plugins[name] || null : null;
}

const WEB = (reason = 'web') => ({ ok: false, reason });

async function call(method, args = {}) {
  const p = plugin();
  if (!p || typeof p[method] !== 'function') return WEB();
  try {
    const res = await p[method](args);
    return { ok: true, ...res };
  } catch (e) {
    console.warn('[native]', method, e?.message || e);
    return { ok: false, reason: e?.message || 'error' };
  }
}

/* ================= PERMISSIONS ================= */
export const PERMS = {
  contacts: 'android.permission.READ_CONTACTS',
  sms: 'android.permission.READ_SMS',
  phone: 'android.permission.CALL_PHONE',
  location: 'android.permission.ACCESS_FINE_LOCATION'
};

export async function checkPermission(name) {
  return call('checkPermission', { permission: name });
}
export async function requestPermission(name) {
  return call('requestPermission', { permission: name });
}
export async function requestAll() {
  return call('requestAllPermissions');
}

/** Special permissions that need a settings screen, not a dialog */
export async function openSpecialSetting(kind) {
  // kind: 'overlay' | 'notification_listener' | 'accessibility' | 'battery_optimization' | 'exact_alarm'
  return call('openSpecialSetting', { kind });
}
export async function hasSpecialPermission(kind) {
  return call('hasSpecialPermission', { kind });
}

/* ================= CONTACTS (Phase B) ================= */
let contactCache = null;

export async function loadContacts(force = false) {
  if (contactCache && !force) return contactCache;
  const r = await call('getContacts');
  if (!r.ok) return null;
  contactCache = (r.contacts || []).map(c => ({
    name: c.name || '',
    phone: (c.phone || '').replace(/\s|-/g, ''),
    id: c.id
  })).filter(c => c.name && c.phone);
  return contactCache;
}

/** Fuzzy-find a contact by spoken name */
export async function findContact(spoken) {
  const list = await loadContacts();
  if (!list || !list.length) return null;
  const q = String(spoken).toLowerCase().trim();
  if (!q) return null;

  // exact
  let hit = list.find(c => c.name.toLowerCase() === q);
  if (hit) return hit;
  // starts with
  hit = list.find(c => c.name.toLowerCase().startsWith(q));
  if (hit) return hit;
  // contains
  hit = list.find(c => c.name.toLowerCase().includes(q));
  if (hit) return hit;
  // first-name match
  hit = list.find(c => c.name.toLowerCase().split(/\s+/)[0] === q);
  if (hit) return hit;
  // fuzzy (1-2 edits on first name)
  const lev = (a, b) => {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
      const cur = [i + 1];
      for (let j = 0; j < b.length; j++)
        cur[j + 1] = Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + (a[i] === b[j] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  };
  let best = null, bestD = 99;
  list.forEach(c => {
    const first = c.name.toLowerCase().split(/\s+/)[0];
    const d = lev(q, first);
    if (d < bestD) { bestD = d; best = c; }
  });
  return bestD <= 2 ? best : null;
}

/* ================= CALLING (Phase B) ================= */
/** Places the call directly — no dialer screen (needs CALL_PHONE) */
export async function placeCall(number) {
  return call('placeCall', { number: String(number).replace(/\s/g, '') });
}
export async function endCall() { return call('endCall'); }

/* ================= SMS (Phase B) ================= */
export async function sendSMSSilent(number, message) {
  return call('sendSMS', { number: String(number).replace(/\s/g, ''), message });
}
export async function getLatestOTP(withinSeconds = 300) {
  return call('getLatestOTP', { within: withinSeconds });
}
export async function getRecentSMS(limit = 10) {
  return call('getRecentSMS', { limit });
}

/* ================= NOTIFICATION LISTENER (Phase B) ================= */
/* Reads notifications from every app. Requires the user to enable
   FRIDAY in Settings > Notification access. */

let notifHandler = null;

export function onNotification(cb) {
  notifHandler = cb;
  const p = plugin();
  if (!p || !p.addListener) return () => {};
  const sub = p.addListener('notificationPosted', ev => {
    if (notifHandler) notifHandler(ev);
  });
  return () => { try { sub.remove && sub.remove(); } catch (_) {} };
}

export async function startNotificationListener() {
  return call('startNotificationListener');
}
export async function getActiveNotifications() {
  return call('getActiveNotifications');
}

export async function getUsageStats(days = 1) {
  return call('getUsageStats', { days });
}
export async function phoneFinder(on = true) {
  return call('phoneFinder', { enabled: on });
}
export async function hcStatus() {
  try {
    const p = pluginNamed('FridayHealthConnect');
    if (!p) return { ok: false, reason: 'not_native' };
    return await p.status();
  } catch (e) { return { ok: false, reason: e.message }; }
}
export async function hcOpenSettings() {
  try {
    const p = pluginNamed('FridayHealthConnect');
    if (!p) return { ok: false, reason: 'not_native' };
    return await p.openSettings();
  } catch (e) { return { ok: false, reason: e.message }; }
}
export async function hcReadSteps(days = 1) {
  try {
    const p = pluginNamed('FridayHealthConnect');
    if (!p) return { ok: false, reason: 'not_native' };
    return await p.readSteps({ days });
  } catch (e) { return { ok: false, reason: e.message }; }
}

/* Apps worth announcing — everything else stays silent */
export const ANNOUNCE_DEFAULTS = [
  'com.whatsapp', 'com.google.android.gm', 'com.android.mms',
  'com.google.android.apps.messaging', 'org.telegram.messenger',
  'com.instagram.android', 'com.microsoft.teams', 'com.slack'
];

export function friendlyApp(pkg) {
  const map = {
    'com.whatsapp': 'WhatsApp',
    'com.google.android.gm': 'Gmail',
    'com.android.mms': 'Messages',
    'com.google.android.apps.messaging': 'Messages',
    'org.telegram.messenger': 'Telegram',
    'com.instagram.android': 'Instagram',
    'com.microsoft.teams': 'Teams',
    'com.slack': 'Slack',
    'com.linkedin.android': 'LinkedIn',
    'com.twitter.android': 'X',
    'com.facebook.katana': 'Facebook',
    'com.snapchat.android': 'Snapchat'
  };
  return map[pkg] || (pkg || '').split('.').pop();
}

/* ================= BACKGROUND SERVICE (Phase B) ================= */
export async function startForegroundService(opts = {}) {
  return call('startForegroundService', {
    title: opts.title || 'FRIDAY is listening',
    text: opts.text || 'Say "Hey Friday"',
    wakeWord: opts.wakeWord !== false
  });
}
export async function stopForegroundService() { return call('stopForegroundService'); }
export async function setBootStart(enabled) { return call('setBootStart', { enabled }); }

/* ================= SYSTEM TOGGLES (Phase C) ================= */
export async function setWifi(on) { return call('setWifi', { enabled: on }); }
export async function setBluetooth(on) { return call('setBluetooth', { enabled: on }); }
export async function setTorch(on) { return call('setTorch', { enabled: on }); }
export async function setDND(on) { return call('setDND', { enabled: on }); }
export async function setVolume(percent) { return call('setVolume', { percent }); }
export async function setBrightness(percent) { return call('setBrightness', { percent }); }
export async function setAirplane(on) { return call('setAirplane', { enabled: on }); }
export async function getSystemState() { return call('getSystemState'); }

/* ================= APP LAUNCHING (Phase C) ================= */
let appCache = null;

export async function listApps(force = false) {
  if (appCache && !force) return appCache;
  const r = await call('listApps');
  if (!r.ok) return null;
  appCache = r.apps || [];
  return appCache;
}

export async function launchApp(nameOrPkg) {
  const apps = await listApps();
  if (!apps) return WEB();
  const q = String(nameOrPkg).toLowerCase().trim();
  const hit = apps.find(a => a.label.toLowerCase() === q)
    || apps.find(a => a.label.toLowerCase().startsWith(q))
    || apps.find(a => a.label.toLowerCase().includes(q))
    || apps.find(a => a.pkg.toLowerCase().includes(q));
  if (!hit) return { ok: false, reason: 'not_found' };
  const r = await call('launchApp', { pkg: hit.pkg });
  return { ...r, app: hit };
}

/* ================= SYSTEM ALARM / TIMER ================= */
export async function setSystemAlarm(hour, minute, label, repeat) {
  return call('setSystemAlarm', { hour, minute, label, repeat });
}
export async function setSystemTimer(seconds, label) {
  return call('setSystemTimer', { seconds, label });
}
export async function showAlarms() { return call('showAlarms'); }

/* ================= WHATSAPP ================= */
export async function whatsappSend(number, message, autoSend = true) {
  let cc = '91';
  try { cc = getSetting('waCountryCode') || '91'; } catch (_) {}
  return call('whatsappSend', { number, message, autoSend, cc });
}

/* ================= OVERLAY BUBBLE (Phase C) ================= */
export async function showBubble(on = true) { return call('showBubble', { enabled: on }); }
export async function updateBubble(state) { return call('updateBubble', { state }); }

/* ================= MEDIA (Phase C) ================= */
export async function mediaControl(action) {
  // play | pause | next | previous | stop
  return call('mediaControl', { action });
}

/* ================= DEVICE ACTIONS (Phase C) ================= */
export async function takeScreenshot() { return call('takeScreenshot'); }
export async function lockScreen() { return call('lockScreen'); }
export async function ringLoud() { return call('ringLoud'); }
export async function readClipboard() { return call('readClipboard'); }
export async function getBatteryDetail() { return call('getBatteryDetail'); }
export async function getStorageInfo() { return call('getStorageInfo'); }

/* ================= ACCESSIBILITY (Phase C) ================= */
export async function performGlobalAction(action) {
  // back | home | recents | notifications | quicksettings
  return call('globalAction', { action });
}

/* ================= QS TILE ================= */
/** One-shot: did the user launch via the Quick Settings tile? */
export async function consumeTileRequest() { return call('consumeTileRequest'); }

/* ================= WIDGET ================= */
export async function updateWidget(text, meta = '') {
  return call('updateWidget', { text: String(text).slice(0, 120), meta: String(meta).slice(0, 60) });
}

/* ================= NATIVE GEOFENCING ================= */
export async function geofenceSync(fences) {
  return call('syncGeofences', {
    fences: (fences || []).map(f => ({ id: String(f.id), name: f.name, lat: f.lat, lon: f.lon, radius: f.radius || 250 }))
  });
}
export async function geofenceAddNative(f) {
  return call('addGeofence', { id: String(f.id), name: f.name, lat: f.lat, lon: f.lon, radius: f.radius || 250 });
}
export function onGeofence(cb) {
  const p = plugin();
  if (!p || !p.addListener) return () => {};
  const sub = p.addListener('geofenceEvent', ev => cb(ev));
  return () => { try { sub.remove && sub.remove(); } catch (_) {} };
}

/* ================= NOTIFICATION REPLY (RemoteInput) ================= */
export async function replyNotification(app, text) {
  return call('replyNotification', { app: app || '', text });
}

/* ================= ACCESSIBILITY v2 ================= */
export async function tapText(text) { return call('tapText', { text }); }
export async function scrollScreen(dir = 'down') { return call('scrollScreen', { dir }); }
export async function typeText(text) { return call('typeText', { text }); }

/* ================= SECURITY GUARD ================= */
/** Full on-device device-hygiene audit. */
export async function securityAudit() { return call('securityAudit'); }

/** Fires the moment any app gets installed outside the Play Store. */
export function onSecurityAlert(cb) {
  const p = plugin();
  if (!p || !p.addListener) return () => {};
  const sub = p.addListener('securityAlert', ev => cb(ev));
  return () => { try { sub.remove && sub.remove(); } catch (_) {} }
}

/* ================= NETWORK RECON (own network only) ================= */
export async function wifiAudit() { return call('wifiAudit'); }
export async function lanScan() { return call('lanScan'); }
export async function portScan(host) { return call('portScan', { host }); }

/* ================= CAPABILITY REPORT ================= */
/** What actually works on this device right now */
export async function capabilities() {
  if (!isNative()) {
    return {
      native: false,
      contacts: false, sms: false, notifications: false, overlay: false,
      toggles: false, apps: false, background: false, accessibility: false
    };
  }
  const r = await call('capabilities');
  return { native: true, ...(r.ok ? r : {}) };
}
