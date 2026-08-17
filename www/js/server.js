
/* ===== FRIDAY OS — Server Client (the "real Friday" backend) =====
   Drop-in brain: when Settings → "FRIDAY Cloud" has a server URL, this
   module replaces Groq for chat, and provides server STT/TTS so the phone
   needs NO model downloads (no neural voice / offline ears / wake brain /
   memory brain / coder downloads).

   Wiring (FRIDAY-BACKEND.md):
     ai.js    callGroq(): runtime Groq first; this route when no direct key exists
     ai.js    callGroqTools(): direct keys use local tools; this route owns its loop
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

const PENDING_ACTION_KEY = 'friday_pending_action_v1';
const PENDING_TTL_MS = 5 * 60 * 1000; // v16 P0: auto-expire after 5 minutes

function chatRequestId() {
  try { if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch (_) {}
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function pendingActionId() {
  try {
    const raw = localStorage.getItem(PENDING_ACTION_KEY);
    if (!raw) return '';
    const item = JSON.parse(raw);
    // v16: TTL check — stale pending would block next confirmation
    // Backward compat: very old small placeholders (e.g. 1000 used in unit tests) skip TTL
    if (item && typeof item.created_at === 'number') {
      if (item.created_at < 1e9) {
        // test placeholder or ancient sec value — keep alive for test compat
      } else {
        const createdMs = item.created_at > 1e12 ? item.created_at : item.created_at * 1000;
        if (Date.now() - createdMs > PENDING_TTL_MS) {
          localStorage.removeItem(PENDING_ACTION_KEY);
          return '';
        }
      }
    }
    return item && typeof item.action_id === 'string' ? item.action_id : '';
  } catch (_) { return ''; }
}

function rememberActionEvent(action) {
  if (!action || typeof action.action_id !== 'string') return;
  try {
    if (action.state === 'awaiting_confirmation') {
      localStorage.setItem(PENDING_ACTION_KEY, JSON.stringify({
        action_id: action.action_id,
        created_at: Date.now() // v16: store ms, not seconds, for precise TTL
      }));
    } else if (pendingActionId() === action.action_id) {
      localStorage.removeItem(PENDING_ACTION_KEY);
    }
  } catch (_) {}
}

/** Public helper for chat abort cleanup — prevents stale confirmation lock */
export function clearPendingAction() {
  try { localStorage.removeItem(PENDING_ACTION_KEY); } catch (_) {}
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
 * @param {Object} opts     { onToken(text), onTool(name, result), onAction(action, summary), signal }
 * @returns {Promise<string>} the full assistant reply
 */
export async function chat(messages, opts = {}) {
  // Keep one request id across a transport retry: chat-created action keys are
  // derived from it, so a lost HTTP response cannot enqueue the same phone
  // side effect twice. Callers may also supply requestId when retrying later.
  const requestId = opts.requestId || chatRequestId();
  const request = {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      messages,
      chat_request_id: requestId,
      pending_action_id: pendingActionId() || undefined
    }),
    signal: opts.signal
  };
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(base() + '/v1/chat', request);
    } catch (error) {
      if (attempt > 0 || opts.signal?.aborted || error?.name === 'AbortError') throw error;
      continue;
    }
    if (attempt === 0 && [502, 503, 504].includes(res.status)) {
      try { await res.body?.cancel(); } catch (_) {}
      continue;
    }
    break;
  }
  if (!res) throw new Error('SERVER_NETWORK');
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
      else if (ev.type === 'action') {
        rememberActionEvent(ev.action);
        opts.onAction && opts.onAction(ev.action, ev.summary || '');
      }
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

/* ================= ACTION PROTOCOL v1.0 ================= */
const ACTION_PROTOCOL_VERSION = '1.0';

async function actionRequest(path, { method = 'GET', body = null } = {}) {
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    const response = await fetch(base() + path, {
      method,
      headers: headers(),
      body: body == null ? undefined : JSON.stringify(body)
    });
    if (response.status === 204) return { ok: true, action: null };
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data && data.detail;
      return { ok: false, reason: (detail && (detail.code || detail.message)) || `http_${response.status}`, detail };
    }
    return { ok: true, action: data };
  } catch (_) { return { ok: false, reason: 'network' }; }
}

export async function actionCapabilities() {
  return actionRequest('/v1/actions/capabilities');
}

export async function enqueueAction(type, args, { idempotencyKey, confirmed = false, expiresInSeconds = 300 } = {}) {
  const key = idempotencyKey || `app-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return actionRequest('/v1/actions', { method: 'POST', body: {
    protocol_version: ACTION_PROTOCOL_VERSION,
    type, args: args || {}, idempotency_key: key,
    expires_in_seconds: expiresInSeconds, safety: { confirmed: !!confirmed }
  } });
}

export async function confirmAction(actionId) {
  return actionRequest(`/v1/actions/${encodeURIComponent(actionId)}/confirm`, { method: 'POST', body: {} });
}

export async function getAction(actionId) {
  return actionRequest(`/v1/actions/${encodeURIComponent(actionId)}`);
}

export async function claimAction(deviceId, capabilities) {
  return actionRequest('/v1/actions/claim', { method: 'POST', body: {
    protocol_version: ACTION_PROTOCOL_VERSION,
    device_id: deviceId,
    capabilities: Array.from(new Set(capabilities || []))
  } });
}

export async function submitActionResult(actionId, result) {
  return actionRequest(`/v1/actions/${encodeURIComponent(actionId)}/result`, {
    method: 'POST', body: result
  });
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
