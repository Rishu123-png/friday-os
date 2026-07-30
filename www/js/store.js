/* ===== FRIDAY OS — Storage Layer =====
   Unified storage. Uses localStorage now; swap to SQLite in APK later.
   Every module talks to storage ONLY through this file. */

export const KEYS = {
  SETTINGS: 'friday_settings',
  CHAT: 'friday_chat',
  MEMORY: 'friday_memory',
  NOTES: 'friday_notes',
  REMINDERS: 'friday_reminders',
  EVENTS: 'friday_events',
  CONTACTS: 'friday_contacts',
  TASKS: 'friday_tasks',
  CACHE: 'friday_cache'
};

export const DEFAULTS = {
  // AI
  aiProvider: 'auto',        // auto | local | groq
  groqKey: '',
  groqModel: 'llama-3.3-70b-versatile',
  // Persona
  personality: 'friday',
  userName: 'Boss',
  // Voice
  voiceOutput: true,
  speechRate: '1',
  speechPitch: '1.1',
  voiceLang: 'en-US',
  wakeWord: false,
  autoListen: false,
  // UI
  uiTheme: 'cyber',
  particleEffects: true,
  showWidgets: true,
  // Data
  saveMemory: true,
  locationAccess: false,
  units: 'metric'
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('[store] read failed', key, e);
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('[store] write failed (quota?)', key, e);
    return false;
  }
}

/* ---------- Settings ---------- */
let _settings = read(KEYS.SETTINGS, {});

export function getSetting(key) {
  return key in _settings ? _settings[key] : DEFAULTS[key];
}
export function setSetting(key, value) {
  _settings[key] = value;
  write(KEYS.SETTINGS, _settings);
}
export function allSettings() {
  return { ...DEFAULTS, ..._settings };
}

/* ---------- Generic collections (notes, reminders, etc) ---------- */
export function getList(key) {
  return read(key, []);
}
export function saveList(key, arr) {
  write(key, arr);
  return arr;
}
export function addItem(key, item) {
  const list = getList(key);
  const record = { id: Date.now() + Math.random().toString(36).slice(2, 7), created: Date.now(), ...item };
  list.unshift(record);
  saveList(key, list);
  return record;
}
export function updateItem(key, id, patch) {
  const list = getList(key).map(i => (i.id === id ? { ...i, ...patch } : i));
  saveList(key, list);
  return list;
}
export function removeItem(key, id) {
  const list = getList(key).filter(i => i.id !== id);
  saveList(key, list);
  return list;
}

/* ---------- Memory ---------- */
export function remember(type, data) {
  if (!getSetting('saveMemory')) return null;
  const mem = getList(KEYS.MEMORY);
  mem.unshift({ id: Date.now(), type, data: String(data).slice(0, 2000), timestamp: Date.now() });
  saveList(KEYS.MEMORY, mem.slice(0, 800));
  return true;
}
export function searchMemory(q) {
  const mem = getList(KEYS.MEMORY);
  if (!q) return mem;
  const needle = q.toLowerCase();
  return mem.filter(m => String(m.data).toLowerCase().includes(needle));
}

/* ---------- Network cache (offline fallback for APIs) ---------- */
export function cacheSet(name, data, ttlMin = 60) {
  const c = read(KEYS.CACHE, {});
  c[name] = { data, exp: Date.now() + ttlMin * 60000 };
  write(KEYS.CACHE, c);
}
export function cacheGet(name, allowStale = false) {
  const c = read(KEYS.CACHE, {});
  const hit = c[name];
  if (!hit) return null;
  if (!allowStale && Date.now() > hit.exp) return null;
  return hit.data;
}

/* ---------- Backup ---------- */
export function exportAll() {
  const dump = {};
  Object.values(KEYS).forEach(k => { dump[k] = read(k, null); });
  return { version: 6, exported: new Date().toISOString(), data: dump };
}
export function importAll(payload) {
  if (!payload || !payload.data) throw new Error('Invalid backup file');
  Object.entries(payload.data).forEach(([k, v]) => { if (v !== null) write(k, v); });
  _settings = read(KEYS.SETTINGS, {});
  return true;
}
export function clearAll() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  _settings = {};
}
