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
export async function readScreenText() {
  return call('readScreenText');
}
/* v8.1 EYES */
export async function screenShot() { return call('screenShot'); }
export async function tapAt(x, y) { return call('tapAt', { x, y }); }
export async function openUrl(url) {
  return call('openUrl', { url });
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

/* ================= v14.1: PHOTO share / save ================= */
/** Attach a real image (base64) to a WhatsApp chat and open it. */
export async function sendImage(number, base64, { caption = '', mime = '', cc = null } = {}) {
  let c = '91';
  try { c = cc || getSetting('waCountryCode') || '91'; } catch (_) {}
  return call('sendImage', { number: String(number || '').replace(/\s/g, ''), base64, caption, mime, cc: c });
}
/** Save an image (base64) to the device gallery (Pictures/FRIDAY). */
export async function saveImage(base64, { mime = '' } = {}) {
  return call('saveImage', { base64, mime });
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
/* v15 DEVX Phase-10 completion: real thermal + sensor reads (APK only) */
export async function getThermal() {
  return call('getThermal');
}
export async function getSensors() {
  return call('getSensors');
}
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

/* ---------- v10.3 HERALD: call guard ---------- */
export async function setCallGuard(cfg) { return call('setCallGuard', cfg); }
export async function getCallGuard() { return call('getCallGuard', {}); }
export async function getCallGuardLog() { return call('getCallGuardLog', {}); }
export function onCallHandled(cb) {
  const p = plugin();
  if (!p || !p.addListener) return () => {};
  const sub = p.addListener('callHandled', ev => cb(ev));
  return () => { try { sub.remove && sub.remove(); } catch (_) {} };
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

/* ================= ON-DEVICE LLM (llama.cpp) =================
   JS half of the LlamaCpp native plugin. The AAR with the C++ engine is
   bundled by native/add_llama_dep.py; the GGUF model file is picked by
   the user at runtime (too big to ship inside the APK).
   Every call degrades to { ok:false, reason } - nothing throws. */
const llama = () => pluginNamed('LlamaCpp');

/** True when the native engine plugin exists (installed APK builds). */
export function llmAvailable() { return isNative() && !!llama(); }

export async function llmStatus() {
  const p = llama();
  if (!p || typeof p.status !== 'function') return { ok: false, loaded: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { return { ok: true, ...(await p.status()) }; }
  catch (e) { return { ok: false, loaded: false, reason: e?.message || 'error' }; }
}

export async function llmLoad(path, opts = {}) {
  const p = llama();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try {
    await p.loadModel({
      filePath: path,
      nCtx: opts.nCtx || 4096,
      nThreads: opts.nThreads || 4,
      nGpuLayers: opts.nGpuLayers || 0
    });
    return { ok: true };
  } catch (e) { return { ok: false, reason: e?.message || 'load_failed' }; }
}

export async function llmUnload() {
  const p = llama();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { await p.unloadModel(); return { ok: true }; }
  catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

/** Streams tokens through the plugin's "token" event while generating. */
export async function llmGenerate(prompt, opts = {}, onToken = null) {
  const p = llama();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  let sub = null;
  try {
    if (onToken && p.addListener) sub = p.addListener('token', ev => onToken(ev.text || ''));
    const res = await p.generate({
      prompt,
      stream: !!onToken,
      temperature: opts.temperature !== undefined ? opts.temperature : 0.7,
      topP: opts.topP !== undefined ? opts.topP : 0.9,
      topK: opts.topK !== undefined ? opts.topK : 40,
      repeatPenalty: opts.repeatPenalty !== undefined ? opts.repeatPenalty : 1.1,
      nPredict: opts.nPredict || 512,
      stop: Array.isArray(opts.stop) ? opts.stop : []
    });
    return { ok: true, text: (res && res.text) || '' };
  } catch (e) {
    return { ok: false, reason: e?.message || 'generate_failed' };
  } finally {
    if (sub) { try { sub.remove(); } catch (_) {} }
  }
}

export async function llmAbort() {
  const p = llama();
  if (!p) return { ok: false };
  try { await p.abort(); return { ok: true }; }
  catch (_) { return { ok: false }; }
}

/** Finds *.gguf files on device storage (Downloads/Documents/app dirs). */
export async function scanModels() {
  const r = await call('scanModels');
  return r.ok && Array.isArray(r.models) ? r.models : [];
}

/** Battery level + charging from the native BatteryManager. */
export async function batteryDetail() { return call('getBatteryDetail'); }

/* ================= v9.0 APEX ================= */
/** Consumes a share-sheet payload sent to FRIDAY (text and/or base64 image). */
export async function getSharedContent() { return call('getSharedContent'); }

/** Sets the device wallpaper from a base64 image. */
export async function setWallpaper(base64) { return call('setWallpaper', { base64 }); }

/** Local notification history ring (most recent first). */
export async function getNotifLog(app = '', limit = 40) { return call('getNotifLog', { app, limit }); }

/** Package name of the app currently in the foreground (needs accessibility). */
export async function getForegroundApp() { return call('getForegroundApp'); }

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

/* ================= KEYLESS WAKE WORD (v9.1 - Vosk) =================
   No key, no account, no internet after a one-time ~36MB model download.
   ANY custom word works ("friday", "jarvis"...). Falls back gracefully:
   w/o AAR -> not_installed, w/o model -> no_model, w/o mic -> no_mic. */
const vosk = () => pluginNamed('FridayVosk');

/** True when the FridayVosk plugin exists in the running APK. */
export function voskAvailable() { return isNative() && !!vosk(); }

export async function voskStatus() {
  const p = vosk();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web', installed: false, running: false };
  try { return await p.status(); }
  catch (e) { return { ok: false, reason: e?.message || 'error', installed: false, running: false }; }
}

export async function voskStart(modelPath, keyword = 'friday') {
  const p = vosk();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { return await p.start({ modelPath: modelPath || '', keyword }); }
  catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

export async function voskStop() {
  const p = vosk();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { return await p.stop(); }
  catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

export async function voskScanModels() {
  const p = vosk();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web', items: [] };
  try { return await p.scanModels(); }
  catch (e) { return { ok: false, reason: e?.message || 'error', items: [] }; }
}

export async function voskDownload(url, onProgress = null) {
  const p = vosk();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  const modelUrl = url || 'https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip';
  try {
    const result = await downloadFilePersistent({
      url: modelUrl,
      dest: 'vosk/wake-model.zip',
      extractZip: true,
      stripTopLevel: true
    }, onProgress);
    if (!result?.ok || !result.path) return result || { ok: false, reason: 'download_failed' };

    // FridayVosk only lists directories containing the model's required am/final.mdl.
    // Do not retain a path merely because the ZIP worker completed successfully.
    const scan = await voskScanModels();
    const wanted = String(result.path).replace(/\/+$/, '');
    const model = (scan?.items || []).find(item => String(item.path || '').replace(/\/+$/, '') === wanted);
    if (!model) return { ...result, ok: false, reason: 'bad_model', path: '' };
    return { ...result, ok: true, path: model.path, mb: model.mb };
  } catch (e) { return { ok: false, reason: e?.message || 'download_failed' }; }
}

/** Subscribe to wake-word engine events: 'wake' | 'voskProgress' | 'voskError'. */
export function voskAddListener(event, cb) {
  const p = vosk();
  if (!p || typeof p.addListener !== 'function') return null;
  try { return p.addListener(event, cb); } catch (_) { return null; }
}

/* ================= v10.0 M1: on-device embeddings (semantic memory) ================= */
export async function llmEmbedLoad(path) {
  const p = llama();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { await p.loadEmbedModel({ filePath: path }); return { ok: true }; }
  catch (e) { return { ok: false, reason: e?.message || 'load_failed' }; }
}

export async function llmEmbedUnload() {
  const p = llama();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { await p.unloadEmbedModel(); return { ok: true }; }
  catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

export async function llmEmbed(text) {
  const p = llama();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { return await p.embed({ text }); }
  catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

/* ================= PERSISTENT FOREGROUND DOWNLOADS =================
   WorkManager owns the transfer, so Android can recreate the Activity or the
   process without losing a multi-GB model download. Re-enqueuing the same
   destination reconnects to the surviving/completed unique job. */
const downloads = () => pluginNamed('FridayDownloads');
const downloadProgressHandlers = new Set();

function emitDownloadProgress(status) {
  downloadProgressHandlers.forEach(cb => {
    try { cb({
      jobId: status.jobId,
      file: status.file || '',
      done: Number(status.bytes || 0),
      total: Number(status.totalBytes || 0),
      percent: Number(status.percent || 0),
      state: status.state
    }); } catch (_) {}
  });
}

export async function downloadStatus(jobId) {
  const p = downloads();
  if (!p) return { ok: false, reason: isNative() ? 'download_engine_missing' : 'web' };
  try { return await p.status({ jobId }); }
  catch (e) { return { ok: false, reason: e?.message || 'status_failed' }; }
}

export async function cancelDownload(jobId) {
  const p = downloads();
  if (!p) return { ok: false, reason: isNative() ? 'download_engine_missing' : 'web' };
  try { return await p.cancel({ jobId }); }
  catch (e) { return { ok: false, reason: e?.message || 'cancel_failed' }; }
}

export async function downloadJobs() {
  const p = downloads();
  if (!p) return { ok: false, jobs: [], reason: isNative() ? 'download_engine_missing' : 'web' };
  try { return await p.jobs(); }
  catch (e) { return { ok: false, jobs: [], reason: e?.message || 'status_failed' }; }
}

export async function waitForDownload(jobId, onProgress = null) {
  for (;;) {
    const status = await downloadStatus(jobId);
    if (!status.jobId) return status;
    emitDownloadProgress(status);
    if (onProgress) {
      try { onProgress(status.percent || 0, status.bytes || 0, status.totalBytes || 0, status); } catch (_) {}
    }
    if (status.state === 'succeeded') return { ...status, ok: true };
    if (['failed', 'cancelled'].includes(status.state)) return { ...status, ok: false };
    await new Promise(resolve => setTimeout(resolve, 750));
  }
}

/** Persistent arbitrary HTTPS file download into app-private DATA. */
export async function downloadFilePersistent({
  url, dest, expectedBytes = 0, sha256 = '', extractZip = false, stripTopLevel = false
}, onProgress = null) {
  const p = downloads();
  if (!p) return { ok: false, reason: isNative() ? 'download_engine_missing' : 'web' };
  try {
    const queued = await p.enqueue({ url, dest, expectedBytes, sha256, extractZip, stripTopLevel });
    if (!queued?.jobId) return queued || { ok: false, reason: 'enqueue_failed' };
    return await waitForDownload(queued.jobId, onProgress);
  } catch (e) { return { ok: false, reason: e?.message || 'download_failed' }; }
}

/** Persistent Hugging Face repository download, preserving the old API. */
export async function hfDownload({ repo, dest }) {
  const p = downloads();
  if (!p) return { ok: false, reason: isNative() ? 'download_engine_missing' : 'web' };
  try {
    const queued = await p.enqueueHuggingFace({ repo, dest });
    if (!queued?.jobId) return queued || { ok: false, reason: 'enqueue_failed' };
    return await waitForDownload(queued.jobId);
  } catch (e) { return { ok: false, reason: e?.message || 'download_failed' }; }
}

/** Backwards-compatible progress subscription for Hugging Face screens. */
export function hfAddProgressListener(cb) {
  if (typeof cb !== 'function') return null;
  downloadProgressHandlers.add(cb);
  return { remove: () => downloadProgressHandlers.delete(cb) };
}

/* ================= USER-INITIATED NATIVE DIAGNOSTICS ================= */
export async function collectNativeDiagnostics() {
  const p = pluginNamed('FridayDiagnostics');
  if (!p) return { ok: false, reason: isNative() ? 'diagnostics_missing' : 'web' };
  try { return await p.collect(); }
  catch (e) { return { ok: false, reason: e?.message || 'diagnostics_failed' }; }
}

export async function clearNativeDiagnostics() {
  const p = pluginNamed('FridayDiagnostics');
  if (!p) return { ok: false, reason: isNative() ? 'diagnostics_missing' : 'web' };
  try { return await p.clear(); }
  catch (e) { return { ok: false, reason: e?.message || 'diagnostics_failed' }; }
}

/* ================= v10.0 TR1: offline ML Kit translator ================= */
const trPlugin = () => pluginNamed('FridayTranslate');

export async function translateStatus() {
  const p = trPlugin();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web', installed: false };
  try { return await p.status(); }
  catch (e) { return { ok: false, reason: e?.message || 'error', installed: false }; }
}

export async function translateText({ text, to, from }) {
  const p = trPlugin();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { return await p.translate({ text, to: to || 'hi', from: from || '' }); }
  catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

/* ================= v10.0 T1/T2: sherpa-onnx (neural voice + offline ears) ================= */
const sherpa = () => pluginNamed('FridaySherpa');

export function sherpaAvailable() { return isNative() && !!sherpa(); }

export async function sherpaStatus() {
  const p = sherpa();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { return await p.status(); }
  catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

export async function sherpaTtsInit(cfg) {
  const p = sherpa();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { return await p.ttsInit(cfg); }
  catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

export async function sherpaSpeak(text, opts = {}) {
  const p = sherpa();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { return await p.speak({ text, sid: opts.sid || 0, speed: opts.speed || 1.0 }); }
  catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

export async function sherpaStopSpeaking() {
  const p = sherpa();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { return await p.stopSpeaking(); } catch (e) { return { ok: false }; }
}

export async function sherpaSttInit(modelDir) {
  const p = sherpa();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { return await p.sttInit({ modelDir }); }
  catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

export async function sherpaListen() {
  const p = sherpa();
  if (!p) return { ok: false, reason: isNative() ? 'engine_missing' : 'web' };
  try { return await p.listenOnce(); }
  catch (e) { return { ok: false, reason: e?.message || 'error' }; }
}

export async function sherpaStopListen() {
  const p = sherpa();
  if (!p) return { ok: false };
  try { return await p.stopListen(); } catch (e) { return { ok: false }; }
}

export function sherpaAddListener(event, cb) {
  const p = sherpa();
  if (!p || typeof p.addListener !== 'function') return null;
  try { return p.addListener(event, cb); } catch (_) { return null; }
}

/* ================= v15 Phase 7: DYNAMIC SHORTCUTS ================= */
/** Set Android launcher dynamic shortcuts (APK only). */
export async function setShortcuts(shortcuts) {
  return call('setShortcuts', { shortcuts: (shortcuts || []).map((s, i) => ({ id: 'sc' + i, title: s.title, action: s.action })) });
}

/* ================= v15 Phase 9: BIOMETRIC AUTH ================= */
/** Native BiometricPrompt (fingerprint/face). Returns {ok} or {ok:false, reason}. */
export async function biometricPrompt() {
  return call('biometricAuth');
}
