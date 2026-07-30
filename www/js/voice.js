/* ===== FRIDAY OS — Voice Layer =====
   Speech recognition + synthesis + "Hey Friday" wake word.
   Free, no key. Uses the OS speech engine. */

import { getSetting } from './store.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;

let rec = null;
let wakeRec = null;
let listening = false;
let wakeActive = false;
let handlers = {};

export function isListening() { return listening; }
export function isWakeActive() { return wakeActive; }

/* ---------- Main recognition ---------- */
export function initRecognition(cbs = {}) {
  handlers = cbs;
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

  rec.onerror = e => {
    listening = false;
    handlers.onError && handlers.onError(e.error);
  };

  rec.onend = () => {
    listening = false;
    handlers.onEnd && handlers.onEnd();
    // resume wake word after a command
    if (getSetting('wakeWord') && !wakeActive) setTimeout(startWakeWord, 600);
  };

  return true;
}

export function listen() {
  if (!rec || listening) return false;
  stopWakeWord();
  cancelSpeech();
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
  try { rec && rec.stop(); } catch (_) {}
  listening = false;
}

/* ---------- Wake word: "Hey Friday" ---------- */
const WAKE_PATTERNS = [
  /\bhey friday\b/i, /\bhi friday\b/i, /\bok friday\b/i, /\bokay friday\b/i,
  /\bfriday\b/i, /\bhey jarvis\b/i, /\bjarvis\b/i
];

export function startWakeWord() {
  if (!SR || wakeActive || listening) return false;
  if (!getSetting('wakeWord')) return false;

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
          // strip the wake phrase; if a command followed, use it
          const after = txt.replace(/.*\b(hey |ok |okay |hi )?(friday|jarvis)\b/i, '').trim();
          setTimeout(() => {
            if (after.length > 2 && e.results[i].isFinal) {
              handlers.onFinal && handlers.onFinal(after);
            } else {
              listen();
            }
          }, 250);
          return;
        }
      }
    };

    wakeRec.onerror = e => {
      wakeActive = false;
      // 'no-speech' / 'aborted' are normal — quietly restart
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
  try { wakeRec && wakeRec.abort(); } catch (_) {}
  wakeActive = false;
  wakeRec = null;
}

/* ---------- Speech synthesis ---------- */
const synth = window.speechSynthesis;
let voices = [];
let speaking = false;

export function initSynthesis() {
  if (!synth) return false;
  const load = () => { voices = synth.getVoices(); };
  load();
  if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = load;
  return true;
}

export function isSpeaking() { return speaking; }

function pickVoice(lang) {
  if (!voices.length) voices = synth.getVoices();
  const base = lang.split('-')[0];
  const matching = voices.filter(v => v.lang.startsWith(base));
  if (!matching.length) return null;
  const exact = matching.filter(v => v.lang.replace('_', '-') === lang);
  const pool = exact.length ? exact : matching;
  // Prefer female-sounding voices for FRIDAY
  const pref = pool.find(v => /female|samantha|zira|aria|jenny|neerja|swara|google.*(uk|us) english female/i.test(v.name));
  return pref || pool.find(v => /google/i.test(v.name)) || pool[0];
}

export function speak(text, { onStart, onEnd } = {}) {
  if (!synth || !getSetting('voiceOutput') || !text) { onEnd && onEnd(); return false; }

  cancelSpeech();

  // Strip markdown/code so TTS doesn't read symbols aloud
  const clean = String(text)
    .replace(/```[\s\S]*?```/g, ' — code block — ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_#>|]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) { onEnd && onEnd(); return false; }

  // Chrome truncates long utterances — chunk by sentence
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

export function cancelSpeech() {
  try { synth && synth.cancel(); } catch (_) {}
  speaking = false;
}

export function listVoices() {
  if (!voices.length) voices = synth?.getVoices() || [];
  return voices.map(v => ({ name: v.name, lang: v.lang }));
}
