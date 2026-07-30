/* ===== FRIDAY OS — AI Layer =====
   Priority chain:
     1. Intent engine  (brain.js)  — instant, offline, free
     2. Knowledge APIs (api.js)    — keyless, needs net
     3. Groq           (optional)  — only if user adds a key
     4. Local composer             — always works, never fails

   NOTHING here is required for the app to run. No key = still works. */

import { getSetting, setSetting } from './store.js';
import { pick } from './nlp.js';

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
Today is ${new Date().toDateString()}.`;
}

/* ---------- Groq (OPTIONAL — only used if a key exists) ---------- */
export function hasGroq() {
  return !!(getSetting('groqKey') || '').trim();
}

export async function callGroq(messages, { stream = false, onToken = null, maxTokens = 1024, temperature = 0.7, model = null } = {}) {
  const key = (getSetting('groqKey') || '').trim();
  if (!key) throw new Error('NO_KEY');

  const body = {
    model: model || getSetting('groqModel') || 'llama-3.3-70b-versatile',
    messages,
    max_tokens: maxTokens,
    temperature,
    stream
  };

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('BAD_KEY');
    if (res.status === 429) throw new Error('RATE_LIMIT');
    throw new Error('GROQ_' + res.status + ' ' + txt.slice(0, 120));
  }

  if (!stream) {
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  // streaming
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = '', buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const tok = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (tok) { full += tok; onToken && onToken(tok, full); }
      } catch (_) { /* partial chunk */ }
    }
  }
  return full.trim();
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
  { type: 'function', function: { name: 'tell_battery', description: 'Phone battery level', parameters: { type: 'object', properties: {} } } }
];

/** First-pass, non-streaming call that may return tool_calls. */
export async function callGroqTools(messages, { model = null } = {}) {
  const key = (getSetting('groqKey') || '').trim();
  if (!key) throw new Error('NO_KEY');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: model || getSetting('groqModel') || 'llama-3.3-70b-versatile',
      messages, tools: TOOLS, tool_choice: 'auto',
      max_tokens: 600, temperature: 0.3
    })
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('BAD_KEY');
    if (res.status === 429) throw new Error('RATE_LIMIT');
    const txt = await res.text().catch(() => '');
    throw new Error('GROQ_' + res.status + ' ' + txt.slice(0, 120));
  }
  const data = await res.json();
  return data.choices?.[0]?.message || null;
}

export async function testGroqKey(key) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key.trim()}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        max_tokens: 5
      })
    });
    if (res.status === 401) return { ok: false, msg: 'Invalid key — check you copied it fully (starts with gsk_)' };
    if (!res.ok) return { ok: false, msg: 'Error ' + res.status };
    return { ok: true, msg: 'Key works. Cloud brain online.' };
  } catch (e) {
    return { ok: false, msg: 'No internet connection' };
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
      `I don't have that offline, ${persona().address || 'Boss'}. I can look up facts, people and places via Wikipedia — try "who is <name>" or "what is <thing>". For open reasoning, add a Groq key in Settings (free tier available).`,
      `That one needs the cloud brain. Wikipedia lookups work offline-ish — ask "what is <topic>". Otherwise add a free Groq key in Settings and I'll handle anything.`
    ]);
  }

  return pick([
    `Noted. I'm running on the offline engine — commands, reminders, notes, weather, math and lookups all work. For open conversation, add a Groq key in Settings.`,
    `I hear you. Offline mode handles tasks and commands well. Say "help" to see what I can do right now.`
  ]);
}
