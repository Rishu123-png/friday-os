/* ============================================================================
   FRIDAY OS — SECX: Security Engine (v13.0.0 / Phase 11)
   Security-first framework for FRIDAY — NOT antivirus. Protects user data,
   secures module communication, validates automation actions, enforces
   privacy by default, and keeps FRIDAY running when parts fail.

   Sub-systems (per the phase spec):
     Security Manager / Permission Manager / Authentication Manager /
     Encryption Manager / Secure Storage / API Security / Session Manager /
     Integrity Checker / Privacy Manager / Threat Detector / Audit Logger /
     Recovery Manager

   Reuses vault.js crypto patterns + FridayCore recovery + NAT permissions.
   Everything degrades gracefully — a missing permission never crashes.
   ========================================================================== */

import { getSetting, setSetting, getList, saveList, cacheGet, cacheSet } from './store.js';
import { Bus, Logger } from './fridaycore.js';

const AUDIT = 'friday_audit';
const THREATS = 'friday_threats';
const PRIVATE = 'friday_private';     // private (non-encrypted) app storage tier

/* ---------------- 1) Permission Manager ---------------- */
/* Central registry: every Android permission FRIDAY can use, WHY it's needed,
   and which features depend on it (so denial disables gracefully). */
export const PERMS = [
  { key: 'mic',            android: 'android.permission.RECORD_AUDIO',         why: 'Sunne ke liye — voice commands, wake word, barge-in.', features: ['voice', 'wake word'] },
  { key: 'camera',         android: 'android.permission.CAMERA',               why: 'Camera — QR scan, "kya dekh raha hoon", photos.', features: ['vision', 'camera', 'qr'] },
  { key: 'notifications',  android: 'special:notification_listener',           why: 'Notifications padhne/reply karne ke liye.', features: ['announce', 'reply', 'otp'] },
  { key: 'accessibility',  android: 'special:accessibility',                   why: 'Screen control — tap, scroll, screen read, eyes.', features: ['screen control', 'eyes', 'watchers'] },
  { key: 'health',         android: 'special:health_connect',                  why: 'Steps & health data.', features: ['steps', 'health'] },
  { key: 'bluetooth',      android: 'android.permission.BLUETOOTH_CONNECT',    why: 'Bluetooth devices — audio/headphones state.', features: ['headphone rules', 'devx'] },
  { key: 'location',       android: 'android.permission.ACCESS_FINE_LOCATION', why: 'Weather, geofences, "where is my car", SOS.', features: ['weather', 'geofence', 'sos'] },
  { key: 'storage',        android: 'android.permission.READ_EXTERNAL_STORAGE', why: 'Model files, backups, offline packs.', features: ['coder', 'models'] },
  { key: 'contacts',       android: 'android.permission.READ_CONTACTS',        why: 'Only if you want "call Ramesh" to work.', features: ['call', 'whatsapp'], optional: true },
  { key: 'calendar',       android: 'android.permission.READ_CALENDAR',        why: 'Only if you want calendar-aware briefs.', features: ['brief', 'planner'], optional: true }
];

export function permInfo(key) { return PERMS.find(p => p.key === key) || null; }
export function explainPerm(key) { const p = permInfo(key); return p ? p.why : 'Permission needed for that feature.'; }

/** Which features must disable when a permission is denied (graceful). */
export function featuresAffected(key) { const p = permInfo(key); return p ? p.features : []; }

/** Async: real status from the native layer (falls back to 'unknown' in web). */
export async function checkPerm(key, nat = null) {
  const p = permInfo(key);
  if (!p) return { key, granted: false, known: false };
  if (!nat || !nat.isNative || !nat.isNative()) return { key, granted: true, known: false, reason: 'web' };
  try {
    if (String(p.android).startsWith('special:')) {
      const kind = p.android.slice('special:'.length);
      const r = await nat.hasSpecialPermission(kind);
      return { key, granted: !!(r && r.granted), known: true, kind };
    }
    const r = await nat.checkPermission(p.android);
    return { key, granted: !!(r && r.granted), known: true };
  } catch (_) { return { key, granted: false, known: true }; }
}

export async function statusMap(nat = null) {
  const out = {};
  for (const p of PERMS) out[p.key] = await checkPerm(p.key, nat);
  return out;
}

/* ---------------- 2) Authentication Manager ---------------- */
/* App-level lock: PIN stored as a SHA-256 hash (never plaintext), optional
   biometric. Backend sessions use the server token (never logged). */
const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;

async function sha256(text) {
  const s = subtle();
  if (!s) return null;
  const buf = await s.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function setAppPin(pin) {
  if (!/^\d{4,8}$/.test(String(pin || ''))) return { ok: false, reason: 'PIN must be 4-8 digits' };
  const hash = await sha256('friday::' + pin);
  if (!hash) return { ok: false, reason: 'no_crypto' };
  setSetting('appPinHash', hash);
  setSetting('appLock', true);
  audit('auth', 'app PIN set');
  return { ok: true };
}

export async function verifyAppPin(pin) {
  const hash = await sha256('friday::' + pin);
  const stored = getSetting('appPinHash') || '';
  const ok = !!hash && !!stored && hash === stored;
  if (!ok) audit('auth', 'failed PIN attempt');
  return ok;
}

export function appLocked() { return getSetting('appLock') === true && !!getSetting('appPinHash'); }
export function unlockApp() { setSetting('appLock', false); audit('auth', 'app unlocked'); }
export function lockApp() { setSetting('appLock', true); audit('auth', 'app locked'); }

/* ================= v15 Phase 9: Biometric + Encrypted backups ================= */

/** Biometric enrollment flag + availability (native decided by app.js/native). */
export function biometricEnabled() { return getSetting('biometricLock') === true; }
export function setBiometric(on) { setSetting('biometricLock', !!on); audit('auth', on ? 'biometric enabled' : 'biometric disabled'); }

/** Guard: if biometric is set, run the native prompt first (injected), then PIN fallback. */
export async function authGate({ nativeBiometric = null } = {}) {
  if (biometricEnabled() && nativeBiometric && typeof nativeBiometric === 'function') {
    const ok = await nativeBiometric().catch(() => false);
    if (ok) { unlockApp(); return { ok: true, method: 'biometric' }; }
  }
  return { ok: false, method: 'needs_pin' };
}

/** Encrypted backup: encrypt the full exportAll() blob with a user passphrase.
    Uses encryptJSON (AES-256-GCM). Returns a portable JSON string. */
export async function encryptedBackup(passphrase, { exportAll = null } = {}) {
  if (!exportAll) return { ok: false, reason: 'no exporter' };
  const data = exportAll();
  const e = await encryptJSON(data, passphrase);
  if (!e.ok) return { ok: false, reason: e.reason };
  return { ok: true, blob: JSON.stringify({ v: 2, enc: true, at: Date.now(), data: e.value }) };
}

/** Restore an encrypted backup. */
export async function restoreEncryptedBackup(blob, passphrase) {
  try {
    const outer = JSON.parse(blob);
    if (!outer.enc) return { ok: false, reason: 'not an encrypted backup' };
    const d = await decryptJSON(outer.data, passphrase);
    if (!d.ok) return { ok: false, reason: 'wrong passphrase or corrupt' };
    return { ok: true, data: d.value };
  } catch (_) { return { ok: false, reason: 'corrupt blob' }; }
}

/** Secure key storage note: app secrets (groq/serverToken) ideally live in the
    native keystore. This exposes a save/load bridge the native layer can back
    with Android Keystore when wired (falls back to private tier locally). */
export async function secureKeyPut(name, value, { nativeKeystore = null } = {}) {
  if (nativeKeystore && typeof nativeKeystore === 'function') {
    const r = await nativeKeystore(name, value).catch(() => null);
    if (r && r.ok) return { ok: true, method: 'keystore' };
  }
  privatePut('key_' + name, value);   // local fallback (cleartext — documented)
  return { ok: true, method: 'local' };
}
export async function secureKeyGet(name, { nativeKeystore = null } = {}) {
  if (nativeKeystore && typeof nativeKeystore === 'function') {
    const r = await nativeKeystore(name).catch(() => null);
    if (r && r.ok) return { ok: true, value: r.value, method: 'keystore' };
  }
  const v = privateGet('key_' + name);
  return v != null ? { ok: true, value: v, method: 'local' } : { ok: false, reason: 'not found' };
}

export function backendToken() {
  // Session token for backend — read from settings, never logged or stored in plaintext logs.
  return (getSetting('serverToken') || '').trim();
}
export function hasSession() { return !!backendToken(); }

/* ---------------- 3) Encryption Manager ---------------- */
/* Generic AES-256-GCM (same proven pattern as vault.js) for arbitrary JSON. */
export function cryptoOk() { return !!subtle(); }

async function deriveEphemeral(secret, saltBytes) {
  const s = subtle();
  const base = await s.importKey('raw', new TextEncoder().encode('friday::' + secret),
    'PBKDF2', false, ['deriveKey']);
  return s.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 120000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Encrypt an object → base64 envelope {v, salt, iv, ct}. */
export async function encryptJSON(obj, secret) {
  const s = subtle();
  if (!s) return { ok: false, reason: 'no_crypto' };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEphemeral(secret, salt);
  const ct = await s.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  const b64 = u8 => btoa(String.fromCharCode(...new Uint8Array(u8)));
  return { ok: true, value: JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) }) };
}

export async function decryptJSON(envelope, secret) {
  const s = subtle();
  if (!s) return { ok: false, reason: 'no_crypto' };
  try {
    const e = JSON.parse(envelope);
    const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
    const key = await deriveEphemeral(secret, unb64(e.salt));
    const pt = await s.decrypt({ name: 'AES-GCM', iv: unb64(e.iv) }, key, unb64(e.ct));
    return { ok: true, value: JSON.parse(new TextDecoder().decode(pt)) };
  } catch (_) { return { ok: false, reason: 'decrypt_failed' }; }
}

/* ---------------- 4) Secure Storage (tiers) ---------------- */
/* Public cache  → store.cacheSet/cacheGet (TTL, expiring)
   Private store → localStorage namespaced key (plain)
   Encrypted    → encryptJSON + private tier (for secrets beyond the vault) */
export function privatePut(key, value) {
  try {
    const raw = localStorage.getItem(PRIVATE);
    const m = raw ? JSON.parse(raw) : {};
    m[key] = value;
    localStorage.setItem(PRIVATE, JSON.stringify(m));
    return true;
  } catch (_) { return false; }
}
export function privateGet(key) {
  try {
    const raw = localStorage.getItem(PRIVATE);
    return raw ? (JSON.parse(raw)[key]) : undefined;
  } catch (_) { return undefined; }
}
export function privateDel(key) {
  try {
    const raw = localStorage.getItem(PRIVATE);
    const m = raw ? JSON.parse(raw) : {};
    delete m[key];
    localStorage.setItem(PRIVATE, JSON.stringify(m));
  } catch (_) {}
}

export async function securePut(key, obj, secret) {
  const e = await encryptJSON(obj, secret);
  if (!e.ok) return e;
  privatePut('enc_' + key, e.value);
  return { ok: true };
}
export async function secureGet(key, secret) { return decryptJSON(privateGet('enc_' + key), secret); }

/** Auto-clear temporary files — sweep known temp/cache keys. */
export function clearTemp() {
  let before = {};
  try {
    const raw = localStorage.getItem(PRIVATE);
    before = raw ? JSON.parse(raw) : {};
  } catch (_) { before = {}; }
  const after = {};
  let n = 0;
  for (const k of Object.keys(before)) {
    if (/^tmp_|^enc_vision_/.test(k)) { n++; continue; }   // drop temp entries
    after[k] = before[k];
  }
  try { localStorage.setItem(PRIVATE, JSON.stringify(after)); } catch (_) {}
  audit('storage', 'temp cleanup removed ' + n + ' entries');
  return n;
}

/* ---------------- 5) API Security ---------------- */
export function httpsOnly(url) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return false;
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u);
  if (isLocal) return true;                       // dev hosts allowed
  return /^https:/i.test(u);                       // production: HTTPS only
}

export function validateRequest(args = {}, schema = {}) {
  for (const [k, type] of Object.entries(schema)) {
    const v = args[k];
    if (v === undefined || v === null) return { ok: false, reason: 'missing ' + k };
    if (type === 'string' && typeof v !== 'string') return { ok: false, reason: k + ' must be string' };
    if (type === 'number' && typeof v !== 'number') return { ok: false, reason: k + ' must be number' };
    if (type === 'array' && !Array.isArray(v)) return { ok: false, reason: k + ' must be array' };
  }
  return { ok: true };
}

/** Fetch with timeout + retry/backoff (Phase 8 retry pattern, network-safe). */
export async function fetchSecure(url, opts = {}, { retries = 2, backoffMs = 700, timeoutMs = 12000 } = {}) {
  if (!httpsOnly(url)) return { ok: false, reason: 'not_https' };
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await fetch(url, { ...opts, signal: ctl.signal });
      clearTimeout(to);
      /* v15 Phase 2: rate-limit aware — 429/503 get a LONGER, separate backoff
         (server asked us to slow down; hammering it makes it worse). */
      if ((res.status === 429 || res.status === 503) && attempt < retries) {
        attempt++;
        await new Promise(r => setTimeout(r, (backoffMs * 4) * Math.pow(2, attempt - 1)));
        continue;
      }
      return { ok: res.ok, status: res.status, body: res.ok ? await res.text() : null };
    } catch (e) {
      attempt++;
      if (attempt > retries) { clearTimeout(to); return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' }; }
      await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt - 1)));
    }
  }
  clearTimeout(to);
  return { ok: false, reason: 'exhausted' };
}

/* ---------------- 6) Session Manager ---------------- */
export function sessionState() {
  return {
    hasBackend: hasSession(),
    tokenAgeSec: null,                       // token not stored with timestamp by design
    appLocked: appLocked(),
    active: getSetting('serverMode') !== false
  };
}

/* ---------------- 7) Integrity Checker ---------------- */
export function checkConfig() {
  const issues = [];
  for (const k of ['serverUrl', 'serverToken']) {
    const v = getSetting(k);
    if (v && v.length > 500) issues.push('setting ' + k + ' looks corrupted (too long)');
  }
  const v = getSetting('serverUrl');
  if (v && !/^https?:\/\//i.test(v)) issues.push('serverUrl invalid');
  return issues;
}

export function checkDb() {
  const issues = [];
  for (const k of ['friday_notes', 'friday_reminders', 'friday_memory', 'friday_settings']) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) JSON.parse(raw);
    } catch (_) { issues.push('storage key ' + k + ' corrupted'); }
  }
  return issues;
}

export function checkModels() {
  const issues = [];
  for (const k of ['llmModelPath', 'voskModelPath', 'embedModelPath']) {
    const v = getSetting(k);
    if (v && !/^[a-z0-9_\-./\\]{2,400}$/i.test(v)) issues.push('model path ' + k + ' looks invalid');
  }
  return issues;
}

export async function checkServices(core = null) {
  if (!core) return [];
  try {
    const h = await core.healthMap();
    return Object.entries(h).filter(([, s]) => !s.ok).map(([name]) => name + ': ' + (s => s.error || 'down')(h[name]));
  } catch (_) { return ['health probe unavailable']; }
}

/** Full integrity report + attempt automatic recovery before notifying. */
export async function integrityReport(core = null) {
  const issues = [
    ...checkConfig().map(i => 'config: ' + i),
    ...checkDb().map(i => 'db: ' + i),
    ...checkModels().map(i => 'model: ' + i),
    ...await checkServices(core)
  ];
  if (issues.length) audit('integrity', issues.join(' | '));
  return { ok: issues.length === 0, issues };
}

/** Attempt automatic recovery (CORE restarts errored services), log, continue. */
export async function autoRecover(core = null) {
  if (!core) return { recovered: 0, ok: true };
  try {
    const h = await core.healthMap();
    let recovered = 0;
    for (const [name, s] of Object.entries(h)) {
      if (!s.ok && s.state === 'error') {
        try { await core.resume(name).catch(() => core._init && core._init(name)); recovered++; audit('recovery', name + ' restarted'); }
        catch (_) {}
      }
    }
    return { recovered, ok: recovered > 0 };
  } catch (_) { return { recovered: 0, ok: false }; }
}

/* ---------------- 8) Privacy Manager ---------------- */
export function cloudConsent() { return getSetting('cloudConsent') === true; }
export function setCloudConsent(yes) { setSetting('cloudConsent', !!yes); audit('privacy', yes ? 'cloud consent granted' : 'cloud consent revoked'); }

/** Gate a cloud-AI feature: never use cloud without explicit consent. */
export function requireCloud(feature) {
  if (cloudConsent()) return { ok: true };
  return { ok: false, reason: 'cloud consent needed for ' + feature, explain: 'FRIDAY says: "' + feature + '" runs on the cloud. Allow it? (Settings → Security & Privacy → Cloud AI consent)' };
}

export function privacyReport() {
  return {
    localFirst: true,
    cloud: cloudConsent(),
    cloudUsedWhen: cloudConsent() ? ['conversation', 'vision', 'code', 'research'] : [],
    neverUploads: ['camera photos', 'mic recordings'] ,
    encrypted: ['vault', 'app PIN hash'],
    audits: getList(AUDIT).length
  };
}

/* ---------------- 9) Audit Logger (searchable, timestamped) ---------------- */
export function audit(event, detail) {
  if (getSetting('auditEnabled') === false) return null;
  const e = { ts: Date.now(), event: String(event || 'unknown').slice(0, 40), detail: String(detail || '').slice(0, 300) };
  saveList(AUDIT, [e, ...getList(AUDIT)].slice(0, 400));
  return e;
}
export function auditLog() { return getList(AUDIT); }
export function auditSearch(q) {
  const needle = String(q || '').toLowerCase();
  if (!needle) return getList(AUDIT);
  return getList(AUDIT).filter(e => (e.event + ' ' + e.detail).toLowerCase().includes(needle));
}

/* ---------------- 10) Threat Detector ---------------- */
export function trackThreat(kind) {
  const t = getList(THREATS).filter(x => x.kind === kind);
  t.unshift({ kind, ts: Date.now() });
  saveList(THREATS, [...t, ...getList(THREATS).filter(x => x.kind !== kind)].slice(0, 200));
}

export function threatStats() {
  const all = getList(THREATS);
  const last = 3600e3;   // 1h window
  const inWindow = all.filter(t => Date.now() - t.ts < last);
  const count = k => inWindow.filter(t => t.kind === k).length;
  return { invalidConfig: count('invalid_config'), failedAuth: count('failed_auth'),
           crashes: count('crash'), apiFailures: count('api_fail'), corruption: count('corrupt'), total: inWindow.length };
}

/** Pure: turn threat counts into severity + recovery suggestions. */
export function detectThreats(stats = null) {
  const s = stats || threatStats();
  const out = [];
  const add = (id, sev, text, fix) => out.push({ id, sev, text, fix });
  if (s.invalidConfig >= 1) add('bad_config', 'warn', 'Configuration looks off (corrupted settings).', 'Say "diagnostics" — I will check and fix settings.');
  if (s.failedAuth >= 3) add('auth_brute', 'crit', 'Multiple failed lock attempts detected.', 'App lock is armed — wait or use the recovery option.');
  if (s.crashes >= 5) add('crash_storm', 'warn', 'Several crashes in the last hour.', 'I will restart the affected modules (recovery armed).');
  if (s.apiFailures >= 8) add('api_storm', 'warn', 'Repeated API failures — network or service trouble.', 'Check internet, or I will switch to offline fallbacks.');
  if (s.corruption >= 1) add('corrupt_storage', 'crit', 'Local storage may be corrupted.', 'Say "backup my data" and re-import; I will rebuild safe keys.');
  return out;
}

/* ---------------- 11) Recovery Manager ---------------- */
/** Wrap a risky operation: try, on failure log + attempt module recovery, continue. */
export async function resilient(fn, { name = 'op', core = null, fallback = null } = {}) {
  try { return await fn(); }
  catch (e) {
    audit('failure', name + ': ' + (e && e.message || e));
    trackThreat('api_fail');
    Logger.error('secx', name + ' failed — recovery attempt');
    if (core) await autoRecover(core).catch(() => {});
    return fallback !== null ? fallback : { ok: false, reason: e && e.message || 'failed' };
  }
}

/* ---------------- init (called once from app.js) ---------------- */
export function init(core = null) {
  try {
    Bus.on('secx:audit', ev => { if (ev) audit(ev.event, ev.detail); });
    Bus.on('secx:threat', ev => { if (ev) trackThreat(ev); });
    // watch the bus for permission/automation/memory events to audit (opt-in wiring)
    Bus.on('autox:event', e => { if (e && getSetting('auditEnabled') !== false) audit('automation', (e.event || '') + ' triggered'); });
    audit('secx', 'security engine initialized');
    Logger.info('secx', 'security engine online');
  } catch (e) { Logger.error('secx', 'init: ' + (e && e.message)); }
  return { ok: true };
}

export function dashboard() {
  return {
    permissions: PERMS.length,
    appLock: appLocked(),
    cloudConsent: cloudConsent(),
    audits: getList(AUDIT).length,
    threats: threatStats(),
    alerts: detectThreats()
  };
}
