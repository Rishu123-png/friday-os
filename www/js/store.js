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
  bargeIn: true,
  streamingTts: true,
  // offline brain
  offlineChat: true,
  porcupineKey: '',
  wakeKeyword: 'jarvis',
  voskModelPath: '',
  // v10.0 JARVIS packs
  neuralVoice: false,
  neuralVoiceCfg: '',
  offlineEars: false,
  sherpaSttDir: '',
  embedModelPath: '',
  // UI
  uiTheme: 'cyber',
  particleEffects: true,
  showWidgets: true,
  // Data
  saveMemory: true,
  locationAccess: false,
  // native (APK only)
  backgroundService: true,
  bootStart: false,
  announceNotifications: true,
  announceApps: null,
  bubbleEnabled: false,
  // v10.1 FRIDAY Cloud (backend server mode — no model downloads)
  serverUrl: '',
  serverToken: '',
  serverMode: true,
  serverMemSyncedAt: 0,
  // v10.2 JARVIS zero-setup: suit keeps its own systems updated (WiFi, silent)
  autoSetup: true,
  // v10.3 HERALD: call guard (decline + explainer) + inbox drafts
  callGuard: false,
  callGuardTemplate: 'Boss is busy right now — bataiye kya kaam hai, main unhe bata dunga. — FRIDAY',
  callGuardMode: 'sms',
  // v11.1 IGNITION: cinematic boot + HUD
  bootSeen: false,
  bootMode: 'auto',        // auto | full | short | off
  bootSound: false,
  // v11.2 VOX: Voice Engine 2.0
  wakeWords: 'hey friday, hello friday, friday, computer',
  wakeSensitivity: 60,     // 0-100 → barge-in RMS gate
  dangerConfirm: true,     // destructive commands ask "pakka?" first
  duckAudio: true,         // duck music while FRIDAY speaks (audio focus)
  voxFeedback: true,       // orb + feed + status line follow the formal voice states
  // v11.3 COGNITION: Memory/Vision/Automation engines
  autoEngine: true,        // Phase 7 rule pipeline master switch
  lastMemSummary: '',      // daily digest marker
  // v12.0 PHASE 8 PLANX: AI Planner & Reasoning Engine
  plannerEnabled: true,    // master switch (planner only claims multi-step goals)
  // v12.1 PHASE 9 INTELX: Intelligence & Context Engine
  intelEnabled: true,      // proactive awareness master switch
  intelStudyMode: true,    // study-session suggestions
  lastBackupAt: 0,         // weekly backup suggestion marker
  // v12.2 PHASE 10 DEVX: Device Engine
  devxAlerts: true,        // informative device alerts (low battery, heat, storage)
  // v13.0 PHASE 11 SECX: Security & Privacy Framework
  appLock: false,          // app lock (PIN, SHA-256 hash stored — never plaintext)
  appPinHash: '',          // SHA-256 of PIN (never stored in plaintext)
  cloudConsent: false,     // privacy-first: cloud AI only with explicit consent
  cloudConsentSet: false,
  auditEnabled: true,      // audit trail (permissions, automation, security events)
  // v13.1 PHASE 12 PERFX: Performance & Optimization
  perfMonitor: false,      // developer performance monitor (FPS/CPU/RAM/latency)
  batteryGate: true,       // defer heavy AI when battery is critically low
  aiCache: true,           // short-TTL AI response cache (30 min)
  // v13.2 PHASE 13 CINEX: Cinematic UX
  cinematic: true,         // cinematic mode master switch
  glassFX: true,           // glassmorphism + subtle blur
  glowFX: true,            // neon glow effects
  highContrast: false,     // high-contrast mode
  textScale: '1',          // text scale (1 | 1.1 | 1.25 | 1.5)
  // v15 PHASE 3 AIR: AI Router
  aiProviderPref: '',      // preferred provider: '' | server | groq | ollama | local
  ollamaUrl: '',           // http://host:11434 (local Ollama server)
  ollamaModel: 'llama3',   // Ollama model name
  aiAnalytics: true,       // usage + health tracking (local only)
  // telephony
  waCountryCode: '91'
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
  // never leak API keys / secrets into a backup file
  if (dump[KEYS.SETTINGS]) {
    dump[KEYS.SETTINGS] = {
      ...dump[KEYS.SETTINGS],
      groqKey: '',
      serverToken: '',        // v15: FRIDAY Cloud token is a secret too
      porcupineKey: '',       // v15: wake-word access key is a secret too
      _note: 'API keys & tokens are intentionally not exported. Re-add them after import.'
    };
  }
  return { version: 7, exported: new Date().toISOString(), data: dump };
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
