/* ===== FRIDAY OS — Voice Layer =====
   Speech recognition + synthesis + "Hey Friday" wake word.

   IMPORTANT: Android WebView has NO speechSynthesis and NO
   webkitSpeechRecognition. Inside the APK we must use the native
   FridaySpeech plugin (real Android TTS + SpeechRecognizer).

   This module picks automatically:
     APK      -> native plugin
     Browser  -> Web Speech API
*/

import { getSetting } from './store.js';

/* ---------- platform detection ---------- */
const CAP = () => (typeof window !== 'undefined' ? window.Capacitor : null);
const isNative = () => {
  const c = CAP();
  return !!(c && c.isNativePlatform && c.isNativePlatform());
};
const NP = () => {
  const c = CAP();
  return c && c.Plugins ? c.Plugins.FridaySpeech : null;
};
const useNative = () => isNative() && !!NP();

/* ---------- web fallbacks ---------- */
const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

export const voiceSupported = !!SR || useNative();

let rec = null;          // web recognizer
let wakeRec = null;      // web wake-word recognizer
let listening = false;
let wakeActive = false;
let speaking = false;
let handlers = {};
let voices = [];
let nativeReady = false;
let wakeTimer = null;

export function isListening() { return listening; }
export function isWakeActive() { return wakeActive; }
export function isSpeaking() { return speaking; }

/* ================= INIT ================= */

export async function initSynthesis() {
  if (useNative()) {
    try {
      const r = await NP().initTTS();
      nativeReady = !!r.ok;
      // native TTS events
      NP().addListener('ttsStart', () => { speaking = true; });
      NP().addListener('ttsDone', () => {
        speaking = false;
        if (pendingEnd) { const f = pendingEnd; pendingEnd = null; f(); }
      });
      return nativeReady;
    } catch (e) {
      console.warn('[voice] native TTS init failed', e);
      nativeReady = false;
    }
  }
  if (!synth) return false;
  const load = () => { voices = synth.getVoices(); };
  load();
  if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = load;
  return true;
}

export function initRecognition(cbs = {}) {
  handlers = cbs;

  if (useNative()) {
    const p = NP();
    p.addListener('sttStart', () => {
      listening = true;
      handlers.onStart && handlers.onStart();
    });
    p.addListener('sttPartial', ev => {
      if (ev && ev.text) handlers.onInterim && handlers.onInterim(ev.text);
    });
    p.addListener('sttResult', ev => {
      listening = false;
      const txt = (ev && ev.text || '').trim();
      handlers.onEnd && handlers.onEnd();
      if (txt) {
        if (wakeArmed) { handleWakePhrase(txt); }
        else handlers.onFinal && handlers.onFinal(txt);
      } else {
        scheduleWakeRestart();
      }
    });
    p.addListener('sttError', ev => {
      listening = false;
      const err = ev && ev.error || 'unknown';
      handlers.onEnd && handlers.onEnd();
      // no-speech during wake listening is normal, just restart quietly
      if (wakeArmed && (err === 'no-speech' || err === 'busy' || err === 'client')) {
        scheduleWakeRestart();
        return;
      }
      handlers.onError && handlers.onError(err);
      scheduleWakeRestart();
    });
    return true;
  }

  /* ----- web path ----- */
  if (!SR) { cbs.onError && cbs.onError('unsupported'); return false; }

  rec = new SR();
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.lang = getSetting('voiceLang');

  rec.onstart = () => { listening = true; handlers.onStart && handlers.onStart(); };

  rec.onresult = e => {
    let final = '', interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const txt = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += txt; else interim += txt;
    }
    if (interim) handlers.onInterim && handlers.onInterim(interim);
    if (final.trim()) handlers.onFinal && handlers.onFinal(final.trim());
  };

  rec.onerror = e => { listening = false; handlers.onError && handlers.onError(e.error); };

  rec.onend = () => {
    listening = false;
    handlers.onEnd && handlers.onEnd();
    if (getSetting('wakeWord') && !wakeActive) setTimeout(startWakeWord, 600);
  };

  return true;
}

/* ================= LISTEN ================= */

export function listen() {
  if (listening) return false;
  cancelSpeech();

  if (useNative()) {
    wakeArmed = false;
    clearTimeout(wakeTimer);
    NP().startListening({ lang: getSetting('voiceLang'), partial: true })
      .catch(e => handlers.onError && handlers.onError(e.message || 'error'));
    return true;
  }

  stopWakeWord();
  if (!rec) return false;
  try {
    rec.lang = getSetting('voiceLang');
    rec.start();
    return true;
  } catch (e) {
    console.warn('[voice] start failed', e);
    return false;
  }
}

export function stopListening() {
  if (useNative()) {
    NP().stopListening().catch(() => {});
    listening = false;
    return;
  }
  try { rec && rec.stop(); } catch (_) {}
  listening = false;
}

/* ================= WAKE WORD ================= */

const WAKE_PATTERNS = [
  /\bhey friday\b/i, /\bhi friday\b/i, /\bok friday\b/i, /\bokay friday\b/i,
  /\bfriday\b/i, /\bhey jarvis\b/i, /\bjarvis\b/i
];

let wakeArmed = false;   // native: currently listening FOR the wake phrase

function handleWakePhrase(txt) {
  const hit = WAKE_PATTERNS.some(p => p.test(txt));
  if (!hit) { scheduleWakeRestart(); return; }

  wakeArmed = false;
  handlers.onWake && handlers.onWake();

  // if a command followed the wake word, use it directly
  const after = txt.replace(/.*\b(hey |ok |okay |hi )?(friday|jarvis)\b[,\s]*/i, '').trim();
  if (after.length > 2) {
    handlers.onFinal && handlers.onFinal(after);
  } else {
    setTimeout(() => listen(), 300);
  }
}

function scheduleWakeRestart() {
  if (!useNative()) return;
  if (!getSetting('wakeWord')) return;
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => { if (!listening && !speaking) startWakeWord(); }, 1200);
}

export function startWakeWord() {
  if (!getSetting('wakeWord')) return false;
  if (listening || speaking) return false;

  if (useNative()) {
    wakeArmed = true;
    wakeActive = true;
    NP().startListening({ lang: getSetting('voiceLang'), partial: false })
      .catch(() => { wakeActive = false; });
    return true;
  }

  if (!SR || wakeActive) return false;
  try {
    wakeRec = new SR();
    wakeRec.continuous = true;
    wakeRec.interimResults = true;
    wakeRec.lang = getSetting('voiceLang');

    wakeRec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript.toLowerCase();
        if (WAKE_PATTERNS.some(p => p.test(txt))) {
          stopWakeWord();
          handlers.onWake && handlers.onWake();
          const after = txt.replace(/.*\b(hey |ok |okay |hi )?(friday|jarvis)\b/i, '').trim();
          setTimeout(() => {
            if (after.length > 2 && e.results[i].isFinal) handlers.onFinal && handlers.onFinal(after);
            else listen();
          }, 250);
          return;
        }
      }
    };

    wakeRec.onerror = e => {
      wakeActive = false;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        handlers.onError && handlers.onError('mic-denied');
        return;
      }
      if (getSetting('wakeWord')) setTimeout(startWakeWord, 1500);
    };

    wakeRec.onend = () => {
      wakeActive = false;
      if (getSetting('wakeWord') && !listening) setTimeout(startWakeWord, 800);
    };

    wakeRec.start();
    wakeActive = true;
    return true;
  } catch (e) {
    wakeActive = false;
    return false;
  }
}

export function stopWakeWord() {
  clearTimeout(wakeTimer);
  wakeArmed = false;
  if (useNative()) {
    wakeActive = false;
    NP().stopListening().catch(() => {});
    return;
  }
  try { wakeRec && wakeRec.abort(); } catch (_) {}
  wakeActive = false;
  wakeRec = null;
}

/* ================= SPEAK ================= */

let pendingEnd = null;

function cleanForSpeech(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_#>|]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function speak(text, { onStart, onEnd } = {}) {
  if (!getSetting('voiceOutput') || !text) { onEnd && onEnd(); return false; }

  const clean = cleanForSpeech(text);
  if (!clean) { onEnd && onEnd(); return false; }

  /* ---- native path ---- */
  if (useNative()) {
    cancelSpeech();
    speaking = true;
    pendingEnd = onEnd || null;
    onStart && onStart();
    NP().speak({
      text: clean,
      rate: parseFloat(getSetting('speechRate')) || 1,
      pitch: parseFloat(getSetting('speechPitch')) || 1.1,
      lang: getSetting('voiceLang') || 'en-US'
    }).then(r => {
      if (!r || r.ok === false) {           // TTS unavailable
        speaking = false;
        pendingEnd = null;
        onEnd && onEnd();
      }
    }).catch(() => {
      speaking = false; pendingEnd = null; onEnd && onEnd();
    });
    return true;
  }

  /* ---- web path ---- */
  if (!synth) { onEnd && onEnd(); return false; }
  cancelSpeech();

  const chunks = clean.match(/[^.!?]+[.!?]*/g) || [clean];
  const groups = [];
  let cur = '';
  for (const c of chunks) {
    if ((cur + c).length > 180) { if (cur) groups.push(cur); cur = c; }
    else cur += c;
  }
  if (cur) groups.push(cur);

  const lang = getSetting('voiceLang');
  const voice = pickVoice(lang);
  let idx = 0;

  const next = () => {
    if (idx >= groups.length) { speaking = false; onEnd && onEnd(); return; }
    const u = new SpeechSynthesisUtterance(groups[idx++]);
    u.rate = parseFloat(getSetting('speechRate')) || 1;
    u.pitch = parseFloat(getSetting('speechPitch')) || 1.1;
    u.lang = lang;
    if (voice) u.voice = voice;
    u.onend = next;
    u.onerror = () => { speaking = false; onEnd && onEnd(); };
    synth.speak(u);
  };

  speaking = true;
  onStart && onStart();
  next();
  return true;
}

function pickVoice(lang) {
  if (!synth) return null;
  if (!voices.length) voices = synth.getVoices();
  const base = lang.split('-')[0];
  const matching = voices.filter(v => v.lang.startsWith(base));
  if (!matching.length) return null;
  const exact = matching.filter(v => v.lang.replace('_', '-') === lang);
  const pool = exact.length ? exact : matching;
  const pref = pool.find(v =>
    /female|samantha|zira|aria|jenny|neerja|swara|google.*(uk|us) english female/i.test(v.name));
  return pref || pool.find(v => /google/i.test(v.name)) || pool[0];
}

export function cancelSpeech() {
  if (useNative()) {
    speaking = false;
    pendingEnd = null;
    NP().stopSpeaking().catch(() => {});
    return;
  }
  try { synth && synth.cancel(); } catch (_) {}
  speaking = false;
}

export function listVoices() {
  if (useNative()) return [];
  if (!voices.length) voices = synth ? synth.getVoices() : [];
  return voices.map(v => ({ name: v.name, lang: v.lang }));
}

/** Diagnostics for the Settings screen */
export async function speechStatus() {
  if (useNative()) {
    try {
      const r = await NP().available();
      return { mode: 'native', tts: !!r.tts, stt: !!r.stt };
    } catch (_) { return { mode: 'native', tts: false, stt: false }; }
  }
  return { mode: 'web', tts: !!synth, stt: !!SR };
}
