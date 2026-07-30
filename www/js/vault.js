/* ===== FRIDAY OS — Password Vault =====
   "If I forget my password, I ask FRIDAY."
   Real encryption: AES-256-GCM, key derived from your vault PIN with
   PBKDF2 (60k rounds, SHA-256). The PIN itself is never stored - without
   it the entries are random bytes. Unlock lasts for this session only.

   IMPORTANT: unlock only happens when the user TYPES the digits
   (speech-to-text would echo the PIN into the episode log). */

import { getList, saveList, cacheGet, cacheSet } from './store.js';

const ENTRIES = 'friday_vault_entries';
const META = 'friday_vault_meta';        // { salt, check, iv } - key-verifier block
const ITERATIONS = 60000;

let sessionKey = null;                   // CryptoKey while unlocked

const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
export function cryptoOk() { return !!subtle(); }

/* ---------- encoding helpers ---------- */
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/* ---------- key derivation ---------- */
async function deriveKey(pin, saltBytes) {
  const base = await subtle().importKey('raw', new TextEncoder().encode(String(pin)),
    'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function enc(key, plainText) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(plainText));
  return { cipher: b64(ct), iv: b64(iv.buffer) };
}

async function dec(key, entry) {
  const ct = Uint8Array.from(atob(entry.cipher), c => c.charCodeAt(0));
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(entry.iv) },
    key, ct.buffer);
  return new TextDecoder().decode(pt);
}

/* ---------- status ---------- */
export function vaultExists() { return !!cacheGet(META, true); }
export function vaultUnlocked() { return !!sessionKey; }

/* ---------- setup / unlock / lock ---------- */
export async function vaultSetup(pin) {
  if (!cryptoOk()) return { ok: false, reason: 'no_crypto' };
  if (vaultExists()) return { ok: false, reason: 'exists' };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt);
  const check = await enc(key, 'friday-vault-ok');
  cacheSet(META, { salt: b64(salt.buffer), check: check.cipher, iv: check.iv }, 60 * 24 * 365 * 5);
  sessionKey = key;
  return { ok: true };
}

export async function vaultUnlock(pin) {
  if (!cryptoOk()) return { ok: false, reason: 'no_crypto' };
  const meta = cacheGet(META, true);
  if (!meta) return { ok: false, reason: 'no_vault' };
  try {
    const key = await deriveKey(pin, unb64(meta.salt));
    const plain = await dec(key, { cipher: meta.check, iv: meta.iv });
    if (plain !== 'friday-vault-ok') return { ok: false, reason: 'wrong_pin' };
    sessionKey = key;
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: 'wrong_pin' };
  }
}

export function vaultLock() { sessionKey = null; }

/* ---------- entries ---------- */
const svc = s => String(s || '').toLowerCase().trim();
const locked = () => ({ ok: false, reason: 'locked' });

export async function vaultSave(service, password) {
  if (!sessionKey) return locked();
  service = svc(service);
  if (!service || !password) return { ok: false, reason: 'bad_args' };
  const list = getList(ENTRIES);
  const hit = list.find(e => e.service === service);
  const payload = await enc(sessionKey, String(password));
  if (hit) {
    hit.cipher = payload.cipher; hit.iv = payload.iv; hit.updated = Date.now();
  } else {
    list.unshift({ id: Date.now() + '', service, ...payload, updated: Date.now() });
  }
  saveList(ENTRIES, list.slice(0, 100));
  return { ok: true };
}

export async function vaultRead(service) {
  if (!sessionKey) return locked();
  service = svc(service);
  const hit = getList(ENTRIES).find(e => e.service === service);
  if (!hit) return { ok: false, reason: 'not_found' };
  try {
    return { ok: true, password: await dec(sessionKey, hit) };
  } catch (_) {
    return { ok: false, reason: 'corrupt' };
  }
}

export function vaultForget(service) {
  if (!sessionKey) return locked();
  service = svc(service);
  const list = getList(ENTRIES);
  const next = list.filter(e => e.service !== service);
  if (next.length === list.length) return { ok: false, reason: 'not_found' };
  saveList(ENTRIES, next);
  return { ok: true };
}

export function vaultServices() {
  if (!sessionKey) return [];
  return getList(ENTRIES).map(e => e.service);
}
