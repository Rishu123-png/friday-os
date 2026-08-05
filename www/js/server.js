
/* ===== FRIDAY OS — Server Client (the "real Friday" backend) =====
   Drop-in brain: when Settings → "FRIDAY Cloud" has a server URL, this
   module replaces Groq for chat, and provides server STT/TTS so the phone
   needs NO model downloads (no neural voice / offline ears / wake brain /
   memory brain / coder downloads).

   Wiring (FRIDAY-BACKEND.md):
     ai.js    callGroq():  if (SERVER.isConfigured()) return SERVER.chat(...)
     ai.js    callGroqTools(): same — server runs its own tool loop
     voice.js speak():     if (SERVER.isConfigured()) SERVER.ttsAndPlay(...)
     voice.js listen():    if (SERVER.isConfigured()) SERVER.stt(...) → text

   Protocol (see backend/main.py):
     POST /v1/chat -> SSE lines  data: {"type":"tool"|"token"|"done"|"error", ...}
     POST /v1/stt  -> multipart audio -> {text, language}
     POST /v1/tts  -> {"text"} -> audio/mpeg body
*/

import { getSetting } from './store.js';

export function isConfigured() {
  return !!(getSetting('serverUrl') || '').trim();
}

function headers(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  const token = (getSetting('serverToken') || '').trim();
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

function base() {
  return String(getSetting('serverUrl') || '').trim().replace(/\/+$/, '');
}

/** Server health — call on boot to flip the "FRIDAY Cloud: online" badge. */
export async function health() {
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    const r = await fetch(base() + '/health', { headers: headers({ 'Content-Type': undefined }) });
    if (!r.ok) return { ok: false, reason: 'http_' + r.status };
    const j = await r.json();
    return { ok: true, ...j };
  } catch (e) { return { ok: false, reason: 'network' }; }
}

/**
 * Stream a chat completion from the server.
 * @param {Array} messages  OpenAI-style [{role, content}, ...]
 * @param {Object} opts     { onToken(text), onTool(name, result), signal }
 * @returns {Promise<string>} the full assistant reply
 */
export async function chat(messages, opts = {}) {
  const res = await fetch(base() + '/v1/chat', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ messages }),
    signal: opts.signal
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('SERVER_HTTP_' + res.status + ' ' + txt.slice(0, 120));
  }
  if (!res.body) throw new Error('SERVER_NO_STREAM');

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
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
      if (!payload) continue;
      let ev;
      try { ev = JSON.parse(payload); } catch (_) { continue; }
      if (ev.type === 'token') { full += ev.text; opts.onToken && opts.onToken(ev.text, full); }
      else if (ev.type === 'tool') { opts.onTool && opts.onTool(ev.name, ev.result); }
      else if (ev.type === 'error') { throw new Error(ev.message || 'SERVER_ERROR'); }
      else if (ev.type === 'done') return full.trim();
    }
  }
  return full.trim();
}

/** Transcribe an audio blob (from the mic or a file) via the server. */
export async function stt(blob) {  const fd = new FormData();
  fd.append('file', blob, 'audio.webm');
  const r = await fetch(base() + '/v1/stt', {
    method: 'POST',
    headers: { Authorization: headers()['Authorization'] || '' },
    body: fd
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error((j && j.detail) || 'SERVER_STT_' + r.status);
  return j;
}

/** Synthesize speech via the server and play it (returns the Audio element). */
export async function ttsAndPlay(text, { voice = null } = {}) {
  const r = await fetch(base() + '/v1/tts', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ text: String(text).slice(0, 2000), voice })
  });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new Error((j && j.detail) || 'SERVER_TTS_' + r.status);
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  audio.play().catch(() => {});
  return audio;
}

/** Push a fact the intent engine extracted ("my name is Rishu"). */
export async function rememberFact({ key, label, value }) {
  if (!isConfigured()) return { ok: false };
  try {
    const r = await fetch(base() + '/v1/memory/fact', {
      method: 'POST', headers: headers(), body: JSON.stringify({ key, label, value })
    });
    return { ok: r.ok };
  } catch (_) { return { ok: false }; }
}

/** Pull server-side memory (facts + notes) — cross-device sync. */
export async function pullMemory() {
  if (!isConfigured()) return { ok: false };
  try {
    const r = await fetch(base() + '/v1/memory', { headers: headers() });
    if (!r.ok) return { ok: false };
    return { ok: true, ...(await r.json()) };
  } catch (_) { return { ok: false }; }
}

/** Fetch a URL's raw text through the server (replaces flaky public proxies). */
export async function fetchRaw(url) {
  if (!isConfigured()) return { ok: false };
  try {
    const r = await fetch(base() + '/v1/web', {
      method: 'POST', headers: headers(), body: JSON.stringify({ url })
    });
    if (!r.ok) return { ok: false };
    return await r.json();
  } catch (_) { return { ok: false }; }
}

/** Describe an image via the FRIDAY Cloud server (/v1/vision). */
export async function vision(base64Image, question = '') {
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    const r = await fetch(base() + '/v1/vision', {
      method: 'POST', headers: headers(), body: JSON.stringify({ image_b64: base64Image, question })
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return { ok: false, reason: (j && j.detail) || 'SERVER_VISION_' + r.status };
    return { ok: !!j.ok, text: j.text || '', reason: j.ok ? '' : (j.detail || '') };
  } catch (_) { return { ok: false, reason: 'network' }; }
}
