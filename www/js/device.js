/* ===== FRIDAY OS — Device Layer =====
   Works in browser AND in the Capacitor APK.
   Every function degrades gracefully — never throws to the caller. */

const CAP = () => window.Capacitor;
export const isNative = () => !!(CAP() && CAP().isNativePlatform && CAP().isNativePlatform());

/* ---------- Haptics ---------- */
export function vibrate(pattern = 30) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (_) {}
}
export const tap = () => vibrate(15);
export const buzz = () => vibrate([40, 60, 40]);

/* ---------- Battery ---------- */
/* navigator.getBattery is Chromium-only and deprecated; prefer the
   native FridayNative.getBatteryDetail in the APK, fall back to web. */
let _batCache = null;
let _batCacheAt = 0;
export async function battery() {
  const now = Date.now();
  if (_batCache && now - _batCacheAt < 10000) return _batCache; // P1: 10s cache to save battery
  try {
    const c = CAP();
    if (c && c.isNativePlatform && c.isNativePlatform() && c.Plugins && c.Plugins.FridayNative) {
      const r = await c.Plugins.FridayNative.getBatteryDetail();
      if (r && r.level >= 0) {
        _batCache = { level: Math.round(r.level), charging: !!r.charging };
        _batCacheAt = now;
        return _batCache;
      }
    }
  } catch (_) {}
  try {
    if (!navigator.getBattery) return null;
    const b = await navigator.getBattery();
    _batCache = { level: Math.round(b.level * 100), charging: b.charging };
    _batCacheAt = now;
    return _batCache;
  } catch (_) { return null; }
}

/* ---------- Network ---------- */
export function network() {
  const c = navigator.connection || {};
  return { online: navigator.onLine, type: c.effectiveType || 'unknown', saveData: !!c.saveData };
}

/* ---------- Phone actions ---------- */
export function call(number) {
  if (!number) return false;
  window.location.href = `tel:${String(number).replace(/\s/g, '')}`;
  return true;
}
export function sms(number, body = '') {
  const sep = /iPhone|iPad|Mac/.test(navigator.userAgent) ? '&' : '?';
  window.location.href = `sms:${String(number).replace(/\s/g, '')}${body ? sep + 'body=' + encodeURIComponent(body) : ''}`;
  return true;
}
export function whatsapp(number, body = '') {
  const n = String(number).replace(/[^\d]/g, '');
  window.open(`https://wa.me/${n}${body ? '?text=' + encodeURIComponent(body) : ''}`, '_blank');
  return true;
}
export function email(to, subject = '', body = '') {
  window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
export function maps(query) {
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, '_blank');
}
export function openURL(url) {
  window.open(url, '_blank', 'noopener');
}

/** Try to launch an installed Android app by common scheme */
export function openApp(name) {
  const schemes = {
    whatsapp: 'whatsapp://', instagram: 'instagram://', youtube: 'vnd.youtube://',
    spotify: 'spotify://', telegram: 'tg://', twitter: 'twitter://', x: 'twitter://',
    facebook: 'fb://', maps: 'geo:0,0', gmail: 'googlegmail://', chrome: 'googlechrome://',
    camera: 'camera://', settings: 'app-settings:'
  };
  const key = Object.keys(schemes).find(k => name.toLowerCase().includes(k));
  if (key) { window.location.href = schemes[key]; return true; }
  // fallback: web search
  openURL('https://www.google.com/search?q=' + encodeURIComponent(name));
  return false;
}

/* ---------- Share ---------- */
export async function share(title, text, url) {
  try {
    if (navigator.share) { await navigator.share({ title, text, url }); return true; }
    await navigator.clipboard.writeText(text || url || title);
    return 'copied';
  } catch (_) { return false; }
}

/* ---------- Clipboard ---------- */
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); return true; } catch (e) { return false; }
    finally { ta.remove(); }
  }
}

/* ---------- Notifications ---------- */
export async function notifyPermission() {
  try {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    return await Notification.requestPermission();
  } catch (_) { return 'denied'; }
}

export async function notify(title, body, tag) {
  try {
    const perm = await notifyPermission();
    if (perm !== 'granted') return false;
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [200, 100, 200] };
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, opts);
    return true;
  } catch (_) { return false; }
}

/* ---------- Wake lock ---------- */
let _wakeLock = null;
export async function keepAwake(on = true) {
  try {
    if (on) {
      if (!('wakeLock' in navigator)) return false;
      _wakeLock = await navigator.wakeLock.request('screen');
      return true;
    }
    if (_wakeLock) { await _wakeLock.release(); _wakeLock = null; }
    return true;
  } catch (_) { return false; }
}

/* ---------- Camera ---------- */
let _stream = null, _track = null;

export async function startCamera(videoEl, facing = 'environment') {
  await stopCamera();
  _stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
  videoEl.srcObject = _stream;
  await videoEl.play().catch(() => {});
  _track = _stream.getVideoTracks()[0];
  return _stream;
}

export async function stopCamera() {
  try {
    if (_stream) _stream.getTracks().forEach(t => t.stop());
  } catch (_) {}
  _stream = null; _track = null;
}

export async function torch(on = true) {
  try {
    if (!_track) return false;
    const caps = _track.getCapabilities?.();
    if (!caps || !caps.torch) return false;
    await _track.applyConstraints({ advanced: [{ torch: on }] });
    return true;
  } catch (_) { return false; }
}

export function capture(videoEl, canvasEl) {
  const w = videoEl.videoWidth, h = videoEl.videoHeight;
  if (!w || !h) return null;
  canvasEl.width = w; canvasEl.height = h;
  canvasEl.getContext('2d').drawImage(videoEl, 0, 0, w, h);
  return canvasEl.toDataURL('image/jpeg', 0.85);
}

/* ---------- Barcode / QR (native BarcodeDetector) ---------- */
export async function scanBarcode(videoEl) {
  try {
    if (!('BarcodeDetector' in window)) return { error: 'BarcodeDetector not supported on this browser' };
    const det = new window.BarcodeDetector();
    const codes = await det.detect(videoEl);
    if (!codes.length) return null;
    return { value: codes[0].rawValue, format: codes[0].format };
  } catch (e) { return { error: e.message }; }
}

/* ---------- Sensors ---------- */
export function watchMotion(cb) {
  const handler = e => {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
    cb({ magnitude: mag, x: a.x, y: a.y, z: a.z });
  };
  window.addEventListener('devicemotion', handler);
  return () => window.removeEventListener('devicemotion', handler);
}

export async function requestMotionPermission() {
  try {
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      return await DeviceMotionEvent.requestPermission();
    }
    return 'granted';
  } catch (_) { return 'denied'; }
}

/** Shake to activate */
export function onShake(cb, threshold = 25) {
  let last = 0;
  return watchMotion(({ magnitude }) => {
    const now = Date.now();
    if (magnitude > threshold && now - last > 1200) { last = now; cb(); }
  });
}

export function watchOrientation(cb) {
  const h = e => cb({ alpha: e.alpha, beta: e.beta, gamma: e.gamma });
  window.addEventListener('deviceorientation', h);
  return () => window.removeEventListener('deviceorientation', h);
}

/* ---------- Audio analyser (real waveform) ---------- */
let _audioCtx = null, _analyser = null, _micStream = null;

export async function startMicAnalyser() {
  try {
    if (_analyser) return _analyser;
    _micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = _audioCtx.createMediaStreamSource(_micStream);
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 64;
    src.connect(_analyser);
    return _analyser;
  } catch (_) { return null; }
}

export function readLevels() {
  if (!_analyser) return null;
  const arr = new Uint8Array(_analyser.frequencyBinCount);
  _analyser.getByteFrequencyData(arr);
  return arr;
}

export function stopMicAnalyser() {
  try {
    if (_micStream) _micStream.getTracks().forEach(t => t.stop());
    if (_audioCtx) _audioCtx.close();
  } catch (_) {}
  _analyser = null; _audioCtx = null; _micStream = null;
}

/* ---------- File download (export) ---------- */
export function download(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
