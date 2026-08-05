/* ============================================================================
   FRIDAY OS — VOX: Voice Engine 2.0 (v11.2.0 / Phase 4)
   One formal AI voice state machine, owned by FridayCore.

     OFFLINE → INITIALIZING → READY → LISTENING → UNDERSTANDING
       → THINKING → EXECUTING → SPEAKING → WAITING → READY  (loop)
     SLEEPING ↔ READY        ERROR can come from anywhere

   Everything here is REAL state: the orb, the mic dot and the HUD line all
   read this engine — nobody draws a fake voice state. Modules only CALL
   vox.set(...); the HUD reacts via the bus. Pure helpers are unit-tested.
   ============================================================================ */

import { Bus, Logger } from './fridaycore.js';

/* ---------------- 1) Formal state machine (pure) ---------------- */

export const STATES = ['OFFLINE','INITIALIZING','READY','LISTENING','UNDERSTANDING',
                       'THINKING','EXECUTING','SPEAKING','WAITING','SLEEPING','ERROR'];

/* Legal moves. ERROR is allowed from anywhere; from ERROR only a rebuild is legal. */
const NEXT = {
  OFFLINE:      ['INITIALIZING'],
  INITIALIZING: ['READY','ERROR'],
  READY:        ['LISTENING','THINKING','SPEAKING','SLEEPING','INITIALIZING','ERROR'],  // THINKING/SPEAKING entries cover TYPED commands + proactive speech (no mic involved)
  LISTENING:    ['UNDERSTANDING','READY','THINKING','ERROR'],
  UNDERSTANDING:['THINKING','LISTENING','READY','ERROR'],
  THINKING:     ['EXECUTING','SPEAKING','READY','ERROR'],
  EXECUTING:    ['THINKING','SPEAKING','READY','ERROR'],
  SPEAKING:     ['WAITING','LISTENING','READY','SPEAKING','ERROR'],  // LISTENING = barge-in
  WAITING:      ['READY','LISTENING','THINKING','EXECUTING','SPEAKING','SLEEPING','ERROR'],  // THINKING/EXECUTING: confirmed danger answer re-runs the parked command
  SLEEPING:     ['READY','LISTENING','ERROR'],
  ERROR:        ['INITIALIZING','READY']
};

/** Pure: is from→to legal? Same-state is always legal (idempotent).
    ERROR is reachable from any live state (a fault can strike anywhere). */
export function can(from, to) {
  if (!STATES.includes(from) || !STATES.includes(to)) return false;
  if (from === to) return true;
  if (to === 'ERROR' && from !== 'ERROR') return true;
  return (NEXT[from] || []).includes(to);
}

/* ---------------- 2) Multi wake-word engine helpers (pure) ---------------- */

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** " hey friday, friday ,computer " → ['friday','computer','hey friday'] deduped, longest-first.
    Longest-first matters: match "hey friday" BEFORE bare "friday" so stripping eats the whole phrase. */
export function wakeList(raw) {
  const seen = {};
  const out = [];
  String(raw || '').toLowerCase().split(/[\n,;|]/).map(w => w.trim()).filter(w => w.length >= 3 && w.length <= 40)
    .forEach(w => { if (!seen[w]) { seen[w] = 1; out.push(w); } });
  out.sort((a, b) => b.length - a.length);
  return out;
}

/** Pure: does text START with (or contain) a wake phrase? Returns the best (longest) hit. */
export function wakeMatch(text, list) {
  const t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
  for (const w of list || []) {
    const re = new RegExp('\\b' + esc(w) + '\\b');
    if (re.test(t)) return w;
  }
  return null;
}

/** Pure: remove the longest wake phrase + leading filler, keep the real command. */
export function stripWake(text, list) {
  const w = wakeMatch(text, list);
  if (!w) return String(text || '').trim();
  const re = new RegExp('^.*\\b' + esc(w) + '\\b[,.\\s]*', 'i');
  return String(text).replace(re, '').replace(/\s+/g, ' ').trim();
}

/** False-trigger protection: same fire inside ms = echo/music, not a user. */
export function wakeCooldownOk(lastFireAt, now = Date.now(), ms = 2600) {
  return !lastFireAt || (now - lastFireAt) >= ms;
}

/* ---------------- 3) VAD / sensitivity helpers (pure) ---------------- */

/** Sensitivity slider (0-100) → RMS threshold for hot-mic barge-in.
    Sensitive (100) = whisper cancels speech; deaf (0) = you must shout. */
export function bargeRms(sens = 60) {
  const s = Math.min(100, Math.max(0, Number(sens) || 0));
  return +(6.8 - s * 0.043).toFixed(2);          // 0 → 6.8 RMS, 100 → 2.5 RMS
}

/** Hearing classifier from a raw RMS reading (pure). */
export function vadClass(rms, thr) {
  if (rms >= thr * 1.6) return 'speech';
  if (rms >= thr * 0.55) return 'noise';
  return 'silence';
}

/** Exponential restart backoff for a crashed wake/STT engine: 1.2s → 2.4 → … → 15s cap. */
export function retryDelay(fails, base = 1200) {
  const n = Math.max(0, fails | 0);
  return Math.min(15000, Math.round(base * Math.pow(2, n)));
}

/* ---------------- 4) Dangerous-action confirmation (pure) ---------------- */

/* destructive verb × bulk word — Hindi puts "saare X" BEFORE the verb too:
   "saare alarms hata do" (bulk→verb) vs "delete all alarms" (verb→bulk). */
const BULK = /\b(all|sab|saare|saari|sari|poora|poori|everything|har ek)\b/i;
const DEL  = /\b(delete|remove|erase|wipe|clear|hatao|hata do|hata de|saaf kar|saaf|mita|mita do|delete karo|remove karo)\b/i;
const DANGER_FULL = new RegExp('(' + DEL.source + '[\\s\\w]{0,28}' + BULK.source + ')|(' + BULK.source + '[\\s\\w]{0,28}' + DEL.source + ')', 'i');
const DANGER_MEM  = /\bforget (everything|everything about me)\b|\bwipe (your |my |the )?memory\b|\berase (your |my )?memory\b|\bclear (your |all )?memory\b/i;
const DANGER_ALL  = /\b(delete|remove|clear|erase|wipe)\s+all\b/i;

const CONFIRM_YES = /^(ha|han|haan|hanji|yes|yeah|yup|yep|ok|okay|sure|bilkul|kar do|kardo|karo|do it|go ahead|thik|theek|correct|confirm|haan kar|haan karo|haan kar do)[\s.!]*$/i;
const CONFIRM_NO  = /^(nahi|nhi|na|no|nope|nah|mat|mat karo|mat kar|ruk|ruko|roko|cancel|rehne|rehne do|chhod|chhod do|bas|stop|band|band kar)[\s.!]*$/i;

/** Pure: is this utterance destructive enough to deserve a "pakka?" first? */
export function needsConfirm(text) {
  const t = String(text || '');
  return DANGER_FULL.test(t) || DANGER_MEM.test(t) || DANGER_ALL.test(t);
}

/** Pure: human description of what would be destroyed (for the question). */
export function confirmWhat(text) {
  const t = String(text || '').toLowerCase();
  if (/reminder/.test(t)) return 'saare reminders';
  if (/alarm/.test(t)) return 'saare alarms';
  if (/note/.test(t)) return 'saare notes';
  if (/task|todo/.test(t)) return 'saare tasks';
  if (/contact/.test(t)) return 'saare contacts';
  if (/memory|yaad/.test(t)) return 'meri poori memory';
  if (/chat/.test(t)) return 'poori chat history';
  return 'yeh sab';
}

/** Pure: build the FRIDAY-flavoured confirmation question. */
export function confirmQuestion(text) {
  return `Ruko Boss — ${confirmWhat(text)} delete kar du? Ye wapas nahi milega. Bolo "haan" ya "nahi".`;
}
export function confirmYes(text) { return CONFIRM_YES.test(String(text || '').trim()); }
export function confirmNo(text)  { return CONFIRM_NO.test(String(text || '').trim()); }

/* ---------------- 5) Streaming sentence chunker (pure) ---------------- */

/** Pull complete speakable sentences off a streaming buffer.
    Returns { say: [...], rest } — rest is the unfinished tail. */
export function sentences(buf, final = false) {
  const t = String(buf || '').replace(/\s+/g, ' ');
  const out = [];
  let rest = t;
  const re = /(.+?[.!?\u0964\u2026]+[\])"'”’]?)(\s+|$)/g;
  let m, lastEnd = 0;
  while ((m = re.exec(t)) !== null) {
    const s = m[1].trim();
    if (s.length >= 2) out.push(s);
    lastEnd = re.lastIndex;
  }
  rest = t.slice(lastEnd).trim();
  if (final && rest.length >= 2) { out.push(rest); rest = ''; }
  return { say: out, rest };
}

/* ---------------- 6) HUD mapping (pure) ---------------- */

const ORB_OF = {
  OFFLINE: 'error', INITIALIZING: 'thinking', READY: 'idle', LISTENING: 'listening',
  UNDERSTANDING: 'listening', THINKING: 'thinking', EXECUTING: 'executing',
  SPEAKING: 'speaking', WAITING: 'idle', SLEEPING: 'sleeping', ERROR: 'error'
};
export function orbOf(state) { return ORB_OF[state] || 'idle'; }

const LABEL_OF = {
  OFFLINE: 'VOICE OFFLINE', INITIALIZING: 'VOICE BOOT', READY: 'READY',
  LISTENING: 'LISTENING', UNDERSTANDING: 'UNDERSTANDING', THINKING: 'THINKING',
  EXECUTING: 'EXECUTING', SPEAKING: 'SPEAKING', WAITING: 'STANDBY',
  SLEEPING: 'SLEEPING', ERROR: 'VOICE FAULT'
};
export function labelOf(state) { return LABEL_OF[state] || state; }

/** Mic dot visibility: honest indicator — on whenever ANY mic path is open. */
export function micVisible(state, wakeOn) {
  return state === 'LISTENING' || state === 'UNDERSTANDING' || !!wakeOn;
}

/* ---------------- 7) The engine (runtime singleton) ---------------- */

let _state = 'OFFLINE';
let _since = Date.now();
let _readyTimer = null;

export const vox = {
  get: () => _state,
  since: () => _since,
  _reset() { _state = 'OFFLINE'; _since = Date.now(); clearTimeout(_readyTimer); },

  /** Move the machine. Illegal moves still apply (recovery must never trap us),
      but get a loud warning — never a silent jump. */
  set(next, detail = '') {
    if (next === _state) return true;
    if (!can(_state, next)) {
      Logger.warn('vox', `odd jump ${_state} → ${next}${detail ? ' (' + detail + ')' : ''}`);
    }
    clearTimeout(_readyTimer);
    const prev = _state;
    _state = next; _since = Date.now();
    Bus.emit('vox:state', { state: next, prev, detail, at: _since });
    Logger.info('vox', `${prev} → ${next}${detail ? ' · ' + detail : ''}`);
    /* WAITING is a transit hall, not a home: if nobody takes over (hands-free
       chain calls LISTENING next), settle to READY on our own. */
    if (next === 'WAITING') vox.armReady(2800);
    return true;
  },

  /** Hold current state, then fall to READY in ms unless someone else speaks up.
      Used after speech ends while the hands-free chain decides what happens next. */
  armReady(ms = 900) {
    clearTimeout(_readyTimer);
    const from = _state;
    _readyTimer = setTimeout(() => {
      if (_state === from) vox.set('READY', 'idle timeout');
    }, ms);
  },

  /** Re-emit the CURRENT state (no transition) — for async facts that become
      true after the state was set (e.g. wake engine flips on a beat later,
      so the mic dot can repaint honestly). */
  touch() {
    Bus.emit('vox:state', { state: _state, prev: _state, detail: 'touch', at: Date.now() });
    return true;
  }
};

/* These run in the app shell too — bus has no DOM dependency. */
