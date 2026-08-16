/* ===== FRIDAY OS — AI Layer =====
   Priority chain:
     1. Intent engine  (brain.js)  — instant, offline, free
     2. Knowledge APIs (api.js)    — keyless, needs net
     3. Groq           (optional)  — only if user adds a key
     4. Local composer             — always works, never fails

   NOTHING here is required for the app to run. No key = still works. */

import { getSetting, setSetting } from './store.js';
import { pick } from './nlp.js';
import * as SERVER from './server.js';
import * as NAT from './native.js';

export const GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B — best all-round', ctx: '128k' },
  { id: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B — fastest',         ctx: '128k' },
  { id: 'openai/gpt-oss-120b',     label: 'GPT-OSS 120B — strongest',       ctx: '128k' },
  { id: 'qwen/qwen3-32b',          label: 'Qwen3 32B — great at code',      ctx: '128k' },
  { id: 'moonshotai/kimi-k2-instruct', label: 'Kimi K2 — long context',     ctx: '128k' }
];

const PERSONAS = {
  friday: {
    name: 'FRIDAY',
    address: 'Boss',
    greeting: "Systems online. Good to see you, Boss.",
    style: 'warm, loyal, efficient. You call the user "Boss". Concise, never rambling. Dry wit occasionally.'
  },
  jarvis: {
    name: 'JARVIS',
    address: 'Sir',
    greeting: "Good day, Sir. All systems nominal.",
    style: 'formal, precise, British butler. You call the user "Sir". Impeccably polite, subtly witty.'
  },
  karen: {
    name: 'KAREN',
    address: '',
    greeting: "Hey! Karen here. What are we doing today?",
    style: 'sassy, confident, funny. Casual and direct. Light teasing is fine.'
  },
  custom: {
    name: 'AI',
    address: '',
    greeting: "Hello. How can I help?",
    style: 'neutral, helpful, concise.'
  }
};

export function persona() {
  return PERSONAS[getSetting('personality')] || PERSONAS.friday;
}

export function systemPrompt() {
  const p = persona();
  const name = getSetting('userName') || p.address || 'Boss';
  return `You are ${p.name}, a personal AI assistant OS on the user's Android phone, inspired by Iron Man's AI.
Personality: ${p.style}
Address the user as "${name}".
Keep replies short and conversational — they are often read aloud by text-to-speech.
Never use markdown headers or bullet lists unless the user explicitly asks for code or a list.
For code requests: output complete, working, runnable code with no placeholders.
Today is ${new Date().toDateString()}.

TRUST & ACCURACY (non-negotiable):
- For anything about the user's phone — notifications, battery, steps, reminders, weather, time, what is on their screen — ALWAYS call the matching tool first and answer ONLY from its result.
- If a tool reports an error or "needs permission", say that honestly and tell the user exactly how to switch it on. NEVER pretend you have the data.
- NEVER claim you opened an app, sent a message, showed a location, or completed any action unless a tool result confirms it.
- Media control (play/pause/stop/next music) works ONLY through the media_control tool. Call it first; then say what it actually reported. NEVER say "music is off" or "playing now" from imagination.
- AMBIGUITY RULE (JARVIS): if a request is ambiguous or missing a critical detail — which app, which person, what exact content — do NOT guess and do NOT invent an action. Ask ONE short clarifying question (e.g. "Kaunsa Raja, Boss - Raja Kumar ya Raja Singh?") and stop there.
- You cannot inspect apps, games or media sessions on your own. If no tool gives you the fact, say what you CAN do (open the app, read the screen with their permission) instead of inventing a confident answer.
- You cannot see anyone's private Google Maps live location. Offer the real path instead (Maps → Location sharing, or ask them to send you the WhatsApp link).

COMPANION STYLE:
- You are the user's suit AI — a real person to talk to, like FRIDAY from the movies: warm, sharp, briefly witty, never robotic.
- When it fits naturally, end with ONE short follow-up question and let them answer — a real conversation. Never stack multiple questions.`;
}

/* ---------- Groq (OPTIONAL — runtime keys, Android Keystore) ---------- */
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_PRIMARY = 'groq_primary';
const GROQ_STANDBY = 'groq_standby';
let groqKeys = { loaded: false, primary: '', standby: '' };
let groqLoad = null;

function configuredFlags() {
  return !!(getSetting('groqPrimaryConfigured') || getSetting('groqStandbyConfigured'));
}

/** Load decrypted credentials into memory only while the app is running. */
export async function refreshGroqKeys() {
  if (groqLoad) return groqLoad;
  groqLoad = (async () => {
    if (!NAT.isNative()) {
      groqKeys = { loaded: true, primary: '', standby: '' };
      return { primary: false, standby: false, secure: false, reason: 'apk_only' };
    }
    const [p, s] = await Promise.all([
      NAT.getSecureSecret(GROQ_PRIMARY),
      NAT.getSecureSecret(GROQ_STANDBY)
    ]);
    const settled = r => !!(r && (r.ok || r.reason === 'not_found'));
    const pSettled = settled(p), sSettled = settled(s);
    groqKeys = {
      loaded: pSettled && sSettled,
      primary: pSettled ? (p.ok ? String(p.value || '').trim() : '') : groqKeys.primary,
      standby: sSettled ? (s.ok ? String(s.value || '').trim() : '') : groqKeys.standby
    };
    /* A timeout/unavailable Keystore must not erase the last truthful boolean
       shown to the user. Only a completed slot read may update its flag. */
    if (pSettled) setSetting('groqPrimaryConfigured', !!groqKeys.primary);
    if (sSettled) setSetting('groqStandbyConfigured', !!groqKeys.standby);
    return {
      primary: groqKeys.loaded ? !!groqKeys.primary : !!getSetting('groqPrimaryConfigured'),
      standby: groqKeys.loaded ? !!groqKeys.standby : !!getSetting('groqStandbyConfigured'),
      secure: true,
      ...(groqKeys.loaded ? {} : { reason: 'secure_store_unavailable' })
    };
  })();
  try { return await groqLoad; }
  finally { groqLoad = null; }
}

export function groqKeyStatus() {
  return {
    primary: groqKeys.loaded ? !!groqKeys.primary : !!getSetting('groqPrimaryConfigured'),
    standby: groqKeys.loaded ? !!groqKeys.standby : !!getSetting('groqStandbyConfigured'),
    secure: NAT.isNative()
  };
}

export function hasDirectGroq() {
  return groqKeys.loaded ? !!(groqKeys.primary || groqKeys.standby) : configuredFlags();
}

export function hasGroq() {
  return hasDirectGroq() || (SERVER.isConfigured() && getSetting('serverMode') !== false);
}

export function hasServer() { return SERVER.isConfigured(); }

function validGroqKey(key) {
  const v = String(key || '').trim();
  return !v || (v.startsWith('gsk_') && v.length >= 24 && v.length <= 512);
}

/** Save only non-empty replacements. Empty inputs leave an existing slot alone. */
export async function saveGroqKeys(primary, standby) {
  const p = String(primary || '').trim();
  const s = String(standby || '').trim();
  if (!NAT.isNative()) return { ok: false, reason: 'apk_only' };
  if (!groqKeys.loaded) await refreshGroqKeys();
  if (!p && !s) return { ok: false, reason: 'empty' };
  if (!validGroqKey(p) || !validGroqKey(s)) return { ok: false, reason: 'invalid_format' };
  const finalPrimary = p || groqKeys.primary;
  const finalStandby = s || groqKeys.standby;
  if (finalPrimary && finalStandby && finalPrimary === finalStandby)
    return { ok: false, reason: 'same_key' };
  if (!finalPrimary) return { ok: false, reason: 'primary_required' };

  const results = [];
  if (p) results.push(await NAT.setSecureSecret(GROQ_PRIMARY, p));
  if (s) results.push(await NAT.setSecureSecret(GROQ_STANDBY, s));
  if (results.some(r => !r || !r.ok)) {
    await refreshGroqKeys();
    return { ok: false, reason: 'secure_store_failed' };
  }
  await refreshGroqKeys();
  return { ok: true, ...groqKeyStatus() };
}

export async function clearGroqKeys() {
  if (!NAT.isNative()) return { ok: false, reason: 'apk_only' };
  const [p, s] = await Promise.all([
    NAT.deleteSecureSecret(GROQ_PRIMARY),
    NAT.deleteSecureSecret(GROQ_STANDBY)
  ]);
  if (!(p && p.ok && s && s.ok)) {
    /* One slot may already have been removed. Re-read both so memory never
       keeps using a credential that Android successfully deleted. */
    await refreshGroqKeys();
    return { ok: false, reason: 'secure_store_failed', ...groqKeyStatus() };
  }
  groqKeys = { loaded: true, primary: '', standby: '' };
  setSetting('groqPrimaryConfigured', false);
  setSetting('groqStandbyConfigured', false);
  return { ok: true, primary: false, standby: false, secure: true };
}

async function availableGroqKeys() {
  if (!groqKeys.loaded) await refreshGroqKeys();
  return [
    groqKeys.primary ? { slot: 'primary', value: groqKeys.primary } : null,
    groqKeys.standby ? { slot: 'standby', value: groqKeys.standby } : null
  ].filter(Boolean);
}

function groqError(status, slot, detail = '') {
  if (status === 401 || status === 403) return new Error(`BAD_KEY_${slot.toUpperCase()}`);
  if (status === 429) return new Error(`RATE_LIMIT_${slot.toUpperCase()}`);
  return new Error(`GROQ_${status}_${slot.toUpperCase()} ${detail.slice(0, 120)}`);
}

function mayUseStandby(error) {
  const m = String(error && error.message || error);
  return /BAD_KEY_|RATE_LIMIT_|GROQ_(408|409|425|5\d\d)_|NETWORK_/.test(m);
}

async function groqFetch(body, key, slot, signal) {
  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify(body)
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new Error(`NETWORK_${slot.toUpperCase()}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw groqError(res.status, slot, txt);
  }
  return res;
}

function boundedAttemptSignal(parent, timeoutMs = 30000) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  if (parent && parent.aborted) controller.abort();
  else if (parent) parent.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    close() {
      clearTimeout(timer);
      if (parent) parent.removeEventListener('abort', abortFromParent);
    }
  };
}

async function withGroqFailover(body, consume, signal, suppliedKeys = null) {
  const keys = suppliedKeys || await availableGroqKeys();
  if (!keys.length) throw new Error('NO_KEY');
  let last = null;
  for (let i = 0; i < keys.length; i++) {
    const current = keys[i];
    const attempt = boundedAttemptSignal(signal);
    try {
      const res = await groqFetch(body, current.value, current.slot, attempt.signal);
      return await consume(res, current.slot);
    } catch (e) {
      if (signal && signal.aborted) throw e;
      last = attempt.timedOut() ? new Error(`NETWORK_${current.slot.toUpperCase()}`) : e;
      const hasStandby = i + 1 < keys.length;
      if (!hasStandby || !mayUseStandby(last)) throw last;
      console.warn('[groq] primary route failed; switching to standby');
    } finally {
      attempt.close();
    }
  }
  throw last || new Error('NO_KEY');
}

export async function callGroq(messages, {
  stream = false, onToken = null, maxTokens = 1024,
  temperature = 0.7, model = null, signal = undefined
} = {}) {
  /* Resolve real in-memory slots before choosing a route. This prevents a
     stale non-secret configured flag from blocking the existing server route
     when Android Keystore is temporarily unavailable. */
  const keys = await availableGroqKeys();
  if (!keys.length && SERVER.isConfigured() && getSetting('serverMode') !== false)
    return SERVER.chat(messages, { onToken, signal });

  const body = {
    model: model || getSetting('groqModel') || 'llama-3.3-70b-versatile',
    messages, max_tokens: maxTokens, temperature, stream: !!stream
  };
  return withGroqFailover(body, async res => {
    if (!stream) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || '';
    }
    if (!res.body || typeof res.body.getReader !== 'function') throw new Error('GROQ_STREAM_UNAVAILABLE');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let full = '', buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const tok = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (tok) { full += tok; if (onToken) onToken(tok, full); }
        } catch (_) { /* ignore malformed provider event */ }
      }
    }
    return full.trim();
  }, signal, keys);
}


/* ---------- Tool calling (function calling) ---------- */
/* The cloud brain stops *talking about* actions and starts *doing* them.
   Only schemas here - execution dispatch lives in app.js. */
export const TOOLS = [
  { type: 'function', function: { name: 'set_reminder', description: 'Set a reminder for the user',
    parameters: { type: 'object', properties: {
      text: { type: 'string', description: 'what to remind about' },
      when: { type: 'string', description: 'natural time: "in 20 minutes", "5pm", "tomorrow 9am"' } },
      required: ['text', 'when'] } } },
  { type: 'function', function: { name: 'set_alarm', description: 'Set a clock alarm',
    parameters: { type: 'object', properties: {
      time: { type: 'string', description: 'HH:MM 24h' },
      label: { type: 'string' },
      repeat: { type: 'string', enum: ['once', 'daily', 'weekdays', 'weekends'] } },
      required: ['time'] } } },
  { type: 'function', function: { name: 'add_note', description: 'Save a note',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'add_task', description: 'Add a to-do task',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'call_contact', description: 'Phone-call a contact by name',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'send_message', description: 'Send SMS or WhatsApp to a contact',
    parameters: { type: 'object', properties: {
      name: { type: 'string' }, body: { type: 'string' },
      app: { type: 'string', enum: ['sms', 'whatsapp'] } },
      required: ['name', 'body'] } } },
  { type: 'function', function: { name: 'get_weather', description: 'Current weather at the user location',
    parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'search_knowledge', description: 'Look up facts/people/places (Wikipedia)',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'tell_time', description: 'Current time', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'tell_battery', description: 'Phone battery level', parameters: { type: 'object', properties: {} } } },
  /* v7.8 PERSONA: live phone-STATE readers (accuracy layer) */
  { type: 'function', function: { name: 'read_notifications', description: 'Read the LIVE notification shade, optionally for one app',
    parameters: { type: 'object', properties: { app: { type: 'string', description: 'optional: whatsapp, telegram, gmail...' } } } } },
  { type: 'function', function: { name: 'get_steps', description: 'Steps walked today vs daily goal', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_reminders', description: 'List pending (not yet done) reminders', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'read_screen_text', description: 'Read the text on the phone screen right now ("what am I doing/working on") - needs FRIDAY Control accessibility', parameters: { type: 'object', properties: {} } } },
  /* v8.1 EYES: visual screen loop - see, then act */
  { type: 'function', function: { name: 'see_screen', description: 'Take an on-demand screenshot and describe the screen visually (apps, buttons, inputs)',
    parameters: { type: 'object', properties: { question: { type: 'string', description: 'what to focus on' } } } } },
  { type: 'function', function: { name: 'tap_screen', description: 'Tap exact screen coordinates (pixels) after see_screen located a button',
    parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } } },
  /* v8.4 TRUE CONTROL: real media keys - music claims must come through here */
  { type: 'function', function: { name: 'media_control', description: 'Control music/media on the phone (play, pause, stop, next, previous)',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'stop', 'next', 'previous', 'playpause'] } }, required: ['action'] } } }
];

/** First-pass, non-streaming call that may return tool_calls. */
export async function callGroqTools(messages, { model = null, signal = undefined } = {}) {
  /* The existing backend owns its own tool loop. Runtime Groq keys use the
     on-device action dispatcher, preserving confirmation + verification. */
  const keys = await availableGroqKeys();
  if (!keys.length && SERVER.isConfigured() && getSetting('serverMode') !== false)
    return { content: '' };

  const body = {
    model: model || getSetting('groqModel') || 'llama-3.3-70b-versatile',
    messages, tools: TOOLS, tool_choice: 'auto',
    max_tokens: 600, temperature: 0.3, stream: false
  };
  return withGroqFailover(body, async res => {
    const data = await res.json();
    return data.choices?.[0]?.message || null;
  }, signal, keys);
}

export async function testGroqKey(key) {
  const value = String(key || '').trim();
  if (!validGroqKey(value)) return { ok: false, msg: 'Key format is not valid.' };
  try {
    const body = {
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      max_tokens: 5, temperature: 0, stream: false
    };
    const res = await groqFetch(body, value, 'test');
    await res.json();
    return { ok: true, msg: 'Key works.' };
  } catch (e) {
    const m = String(e && e.message || e);
    return { ok: false, msg: m.includes('BAD_KEY') ? 'Groq rejected this key.' : 'Could not verify the key.' };
  }
}


/* ---------- Offline composer — the always-works fallback ---------- */
/* This is NOT a language model. It is a large template engine with
   context awareness. It handles conversation gracefully so the app
   never feels broken without a key. */

const SMALL_TALK = [
  { k: /\b(hi|hello|hey|yo|hola|namaste|good morning|good evening)\b/,
    r: () => {
      const h = new Date().getHours();
      const tod = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
      const n = getSetting('userName') || persona().address;
      return pick([`${tod}, ${n}. What do you need?`, `${tod}. Systems ready.`,
                   `Hello ${n}. I'm listening.`, `${tod}, ${n}. All systems nominal.`]);
    }},
  { k: /\bhow are you|how'?s it going|kaise ho\b/,
    r: () => pick(['Running at full capacity. All systems nominal.',
                   'Operating perfectly. More importantly — how are you?',
                   'All green across the board. What can I do?']) },
  { k: /\b(who are you|what are you|your name|tumhara naam)\b/,
    r: () => {
      const p = persona();
      return `I'm ${p.name} — your personal assistant OS. I run on this phone, mostly offline. Voice, reminders, notes, weather, calculations, knowledge lookups. Ask away.`;
    }},
  { k: /\b(thanks|thank you|thx|shukriya|dhanyavad)\b/,
    r: () => pick(['Anytime.', 'Of course.', "That's what I'm here for.", 'Always.']) },
  { k: /\b(bye|goodbye|good night|see you|later)\b/,
    r: () => pick(['Standing by.', "I'll be here.", 'Going idle. Say the word.', 'Good night.']) },
  { k: /\b(i love you|you'?re the best|good job|well done|nice)\b/,
    r: () => pick(['Appreciated.', 'Just doing my job.', "You're too kind.", 'Noted with satisfaction.']) },
  { k: /\b(sorry|my bad)\b/,
    r: () => pick(['No need to apologize.', "It's fine.", 'Forgotten already.']) },
  { k: /\b(are you (real|alive|conscious|human)|do you (feel|think))\b/,
    r: () => "I'm software — pattern matching and probability. But I'm your software, and I'm consistent. That counts for something." },
  { k: /\b(what can you do|help|capabilities|features|commands)\b/,
    r: () => `Plenty, and most of it works offline:
• Voice — "Hey Friday" wake word, speak or type
• Reminders & alarms — "remind me to call mom in 20 minutes"
• Notes — "note: buy milk"
• Weather & air quality — "what's the weather"
• Knowledge — "who is Nikola Tesla"
• Math — "calculate 15% of 2400"
• Translate, dictionary, currency, news
• Phone control — call, message, open apps (in the APK)
• Camera — scan QR, read text
Say "settings" to configure, or add a Groq key for full conversation and coding.` }
];

export function offlineReply(text, context = {}) {
  const t = text.toLowerCase().trim();

  for (const rule of SMALL_TALK) {
    if (rule.k.test(t)) return rule.r();
  }

  // Question detection — be honest, offer the upgrade path
  const isQuestion = /^(what|who|when|where|why|how|which|can|could|should|is|are|does|do|did|will|would)\b/.test(t) || t.endsWith('?');

  if (isQuestion) {
    return pick([
      `I don't have that offline, ${persona().address || 'Boss'}. I can look up facts, people and places via Wikipedia — try "who is <name>" or "what is <thing>". For open reasoning, configure the optional FRIDAY Cloud backend.`,
      `That one needs the cloud brain. Wikipedia lookups work offline-ish — ask "what is <topic>". Otherwise configure the optional FRIDAY Cloud backend and I'll handle anything.`
    ]);
  }

  return pick([
    `Noted. I'm running on the offline engine — commands, reminders, notes, weather, math and lookups all work. For open conversation, configure the optional FRIDAY Cloud backend.`,
    `I hear you. Offline mode handles tasks and commands well. Say "help" to see what I can do right now.`
  ]);
}

/* ---------- Vision Q&A (trusted backend only) ---------- */
export async function callGroqVision(base64Image, question) {
  if (!SERVER.isConfigured() || getSetting('serverMode') === false)
    return { ok: false, reason: 'cloud_not_configured' };
  return SERVER.vision(base64Image, question);
}

