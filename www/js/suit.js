/* ===== FRIDAY OS — Suit Auto-Setup (v10.2.0) =====
   JARVIS rule #1: never say "Sir, download this first".
   The suit keeps ITS systems up-to-date by itself — silently, on WiFi,
   one pack at a time. This module holds the PURE decision logic
   (unit-tested); app.js wires it to the real downloads.

   Priorities (small → big so the user feels progress fast):
     1. memory  bge-small embed model  (~26MB)  meaning-recall
     2. wake    vosk small en-in       (~37MB)  keyless wake word
     3. voice   sherpa piper vits      (~75MB)  natural offline voice
     4. ears    sherpa moonshine       (~120MB) offline dictation
*/

export const PACKS = [
  { id: 'memory', label: 'Memory brain', mb: 26 },
  { id: 'wake', label: 'Wake brain', mb: 37 },
  { id: 'voice', label: 'Neural voice', mb: 75 },
  { id: 'ears', label: 'Offline ears', mb: 120 }
];

/** True when a WiFi-ish, non-metered connection is available.
 *  @param {{online:boolean, saveData:boolean, type?:string}} c */
export function wifiOk(c) {
  if (!c || !c.online) return false;
  if (c.saveData) return false;
  const t = (c.type || '').toLowerCase();
  /* 'unknown'/'' inside a Capacitor WebView usually means WiFi but the
     network info API is absent — allow it (the app's real traffic is
     tiny; pack downloads only happen once). */
  if (!t || t === 'unknown' || t === 'none') return true;
  return ['wifi', 'ethernet', 'wimax'].includes(t);
}

/** Decide which packs are missing and should be silently fetched.
 *  @param {(k:string)=>any} get  settings getter
 *  @returns {Array<{id:string,label:string,mb:number}>} ordered queue */
export function planAutoSetup(get) {
  const q = [];
  if (!(get('embedModelPath') || '').trim()) q.push(PACKS[0]);
  /* wake pack only when the user actually uses the wake word and has
     neither a Porcupine key nor an existing vosk model */
  if (get('wakeWord') && !(get('porcupineKey') || '').trim() && !(get('voskModelPath') || '').trim()) q.push(PACKS[1]);
  if (!(get('neuralVoiceCfg') || '').trim()) q.push(PACKS[2]);
  if (!(get('sherpaSttDir') || '').trim()) q.push(PACKS[3]);
  return q;
}

/** Chip text while a pack is being fetched. */
export function suitLine(idx, total, label, pct) {
  const p = (typeof pct === 'number' && pct > 0) ? ` ${pct}%` : '';
  return `Suit systems ${idx}/${total}: ${label}…${p}`;
}

/** Final chip line once the queue finishes. */
export function suitDoneLine() {
  return 'Suit systems ready — sab kuch up-to-date, Boss.';
}
