/* ===== FRIDAY OS — Clarify Engine (C1, v10.0 JARVIS) =====
   THE RULE: never do the wrong thing — ask ONE short question first.
   JARVIS style: "YouTube pe ya Spotify pe, Boss?"

   Pure + fully unit-testable. app.js owns the pending state; this module
   only decides WHEN to ask, WHAT to ask, and HOW to merge the answer. */

import { levenshtein } from './nlp.js';
import { getList, saveList } from './store.js';

/* ---------- preference memory ("Tony Stark learns") ----------
   Stores stable user choices so the same question is never asked twice.
   Kept in a normal store list (local-only, as per the privacy charter). */
const PREFS_KEY = 'clarify_prefs';

export function loadPrefs() {
  try { return getList(PREFS_KEY) || []; } catch (_) { return []; }
}

/** prefs are [{slot, value, at}] — latest wins. */
export function getPref(slot) {
  const list = loadPrefs().filter(p => p && p.slot === slot);
  return list.length ? list[list.length - 1].value : '';
}

export function recordPref(slot, value) {
  if (!slot || !value) return;
  const list = loadPrefs().filter(p => !(p && p.slot === slot));
  list.push({ slot, value: String(value), at: Date.now() });
  while (list.length > 40) list.shift();
  try { saveList(PREFS_KEY, list); } catch (_) {}
}

/* ---------- slot rules: when a resolved action is not executable yet ----------

   Each rule: { intent, missing(action)=>bool, slot, question(action,opts),
   options:[{label, say}] , prefSlot? }
   `applyAnswer` merges the user's short answer back into the ORIGINAL text. */

const YT_SOURCES = ['youtube', 'yt'];
const MUSIC_SRC_PREF = 'music_source';

function ruleList() {
  /* NOTE (v10.2.1): brain.js ke REAL intent names + action fields.
     Pehle rules galat naam/field the (contact_call/remind/alarm_set exist
     hi nahi karte; open_app ka field 'name' nahi 'app' hai) — isliye har
     "open whatsapp" pe bhi slot "missing" dikhta tha → infinite
     "Kaunsa app kholun?" loop. Ab exact map: */
  return [
    {
      intent: 'yt_play',
      missing: a => !(a && a.query) ,
      slot: 'query',
      question: () => 'Kaunsa gaana ya video chalaaun, Boss?',
      merge: (orig, ans) => `play ${ans} on youtube`
    },
    {
      intent: 'call',
      /* sirf tab poocho jab parse hi nahi hua (naam nahi mila) — contact na
         milna (open_panel fallback) MISSING name nahi hota! */
      missing: a => !!(a && a.type === 'contact_lookup' && !(a.name || '').trim()),
      slot: 'name',
      question: () => 'Kise call karoon?',
      merge: (_orig, ans) => `call ${ans}`
    },
    {
      intent: 'message',
      missing: a => !!(a && a.type === 'contact_lookup' && !(a.name || '').trim()),
      slot: 'name',
      question: () => 'Kise message bhejoon?',
      merge: (_orig, ans) => `send message to ${ans}`
    },
    {
      intent: 'reminder_add',
      missing: a => !(a && (a.text || a.task || (a.reminder && (a.reminder.text || a.reminder.task)))),
      slot: 'text',
      question: () => 'Kis baare me remind karoon?',
      merge: (orig, ans) => orig.replace(/\bremind me\b/i, 'remind me about ' + ans)
    },
    {
      intent: 'alarm_add',
      missing: a => !(a && (a.time || a.alarm)),
      slot: 'time',
      question: () => 'Kitne baje ka alarm lagaaun?',
      merge: (orig, ans) => orig + ' at ' + ans
    },
    {
      intent: 'open_app',
      missing: a => !(a && (a.app || a.name)),
      slot: 'name',
      question: () => 'Kaunsa app kholun?',
      merge: (_orig, ans) => `open ${ans}`
    },
    {
      intent: 'translate',
      missing: a => !(a && a.text),
      slot: 'text',
      question: () => 'Kya translate karoon? Meri agli line bol do.',
      merge: (orig, ans) => orig + ' ' + ans
    }
  ];
}

/** Returns null when nothing to ask, else {slot, question, options?, pending}. */
export function checkSlots(result, text) {
  if (!result || !result.action || !result.intent) return null;
  const rule = ruleList().find(r => r.intent === result.intent);
  if (!rule || !rule.missing(result.action)) return null;
  return {
    slot: rule.slot,
    question: rule.question(result.action),
    options: rule.options || null,
    pending: { origText: text, intent: result.intent, action: result.action, slot: rule.slot }
  };
}

/* ---------- music/player preference (learns "youtube" vs "spotify") ---------- */

/** Detect a "play music"-ish command with NO explicit source. */
export function needsMusicSource(text) {
  const t = String(text || '').toLowerCase();
  if (!/\b(play|chalao|suna(o|o na)?|laga do)\b/.test(t)) return false;
  if (/\b(youtube|yt|spotify|gaana app|gaana\.com|wynk|jio ?saavn|amazon music)\b/.test(t)) return false;
  if (/\b(game|khel|ludo|candy|video)\b/.test(t)) return false;
  if (!/\b(song|gaana|music|gana|kesariya|tum hi ho|playlist)\b/.test(t) && !/\bplay \w+/i.test(t)) return false;
  return !getPref(MUSIC_SRC_PREF);
}

export function musicSourceQuestion() {
  return {
    slot: 'music_source',
    question: 'Kahan chalaaun — YouTube pe ya Spotify pe?',
    options: [
      { label: '▶️ YouTube', say: 'youtube' },
      { label: '🎵 Spotify', say: 'spotify' }
    ],
    pending: null
  };
}

export function applyMusicSource(text, source) {
  recordPref(MUSIC_SRC_PREF, source);
  const src = source === 'spotify' ? 'on spotify' : 'on youtube';
  return `${text} ${src}`;
}

/* ---------- suggestion engine ("did you mean?") ----------

   v1: typo-tolerant Levenshtein over curated example utterances.
   v2 (semantic.js) upgrades the same shape with on-device embeddings. */
export const SUGGEST_EXAMPLES = [
  { utter: 'morning brief', label: '🌅 Morning brief' },
  { utter: 'remind me to call mummy at 5', label: '⏰ Reminder' },
  { utter: 'set an alarm for 7 am', label: '⏰ Alarm' },
  { utter: 'play kesariya on youtube', label: '▶️ YouTube' },
  { utter: 'tell a joke', label: '😄 Joke' },
  { utter: 'what is the time', label: '🕐 Time' },
  { utter: 'battery kitni hai', label: '🔋 Battery' },
  { utter: 'kitne steps chala main aaj', label: '👣 Steps' },
  { utter: 'read my notifications', label: '🔔 Notifications' },
  { utter: 'what did I miss', label: '📥 Missed alerts' },
  { utter: 'translate good morning to hindi', label: '🌐 Translate' },
  { utter: 'weather kaisa hai', label: '🌤 Weather' },
  { utter: 'open whatsapp', label: '📱 Open app' },
  { utter: 'call divik', label: '📞 Call' },
  { utter: 'send message to mummy', label: '💬 SMS' },
  { utter: 'screen pe kya hai', label: '👁 Read screen' },
  { utter: 'take a note', label: '📝 Note' },
  { utter: 'focus mode', label: '🛡 Focus mode' },
  { utter: 'where is my car', label: '🚗 Find car' },
  { utter: 'wallpaper banao', label: '🎨 Wallpaper' }
];

/** nearest examples for an unmatched command (small, fast, honest). */
export function suggestFor(text, k = 3) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return [];
  const words = t.split(/\s+/).filter(w => w.length > 3);
  const scored = SUGGEST_EXAMPLES.map(ex => {
    const ews = ex.utter.split(/\s+/);
    const full = levenshtein(t, ex.utter) / Math.max(t.length, ex.utter.length, 1);
    let fuzzy = 1;
    for (const w of words) {
      let bw = 1;
      for (const ew of ews) bw = Math.min(bw, levenshtein(w, ew) / Math.max(w.length, ew.length, 1));
      fuzzy = Math.min(fuzzy, bw);
    }
    let shared = 0;
    for (const ew of ews) if (ew.length > 3 && words.indexOf(ew) !== -1) shared++;
    /* keep only when the WHOLE string or a clear fuzzy word actually matches */
    if (full >= 0.6 && fuzzy >= 0.5) return null;
    const score = Math.min(full, fuzzy * 0.9) - shared * 0.12;
    return { label: ex.label, utter: ex.utter, score };
  }).filter(Boolean);
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, k);
}

/* ---------- v10.2.1: is the new text an ANSWER, or a FRESH command? ----------
   Screenshot bug: parked "Kaunsa app kholun?" + user type kiya "explain about
   nda" → wo answer GULP kar liya gaya → "open explain about nda" ban gaya.
   Ab pehle yahi check hota hai: chhota naam-jaisa jawaab HI absorb hoga. */
export function absorbable(text, pending) {
  const t = String(text || '').trim();
  if (!t) return false;
  /* translate slot: user ko bola tha "agli line bol do" — poori line hi
     text hai, yahan filter nahi lagega. */
  if (pending && pending.intent === 'translate' && pending.slot === 'text') return true;
  /* greetings/acks kabhi slot-answer nahi hote */
  if (/^(hi+|hello|hey|yo|namaste|ok+|okay|hmm+|thanks|thank you|shukriya|dha?nyava?d|theek hai|acha)\b/i.test(t)) return false;
  /* question/command words = fresh command, answer nahi */
  if (/\b(what|why|when|who|how|explain|tell|show|list|search|open|play|call|message|text|remind|alarm|translate|weather|news|kya|kyun|kyu|kaise|kab|kaun|kahan|batao|samjhao|samjha|dikhao|dikha|chalao|chala|sunao|suna|bolo|karo|kar|kholo|khol|lagao|laga|banao|bana)\b/i.test(t)) return false;
  /* slot answers chhote hote hain (naam/app/gaana/time) — lambi line = naya command */
  if (t.length > 60 || t.split(/\s+/).length > 8) return false;
  return true;
}

/** Merge a short follow-up answer into the pending original command.
    NOTE: caller should gate with absorbable() first (v10.2.1). */
export function absorb(pending, answer) {
  if (!pending || !answer) return '';
  const a = String(answer).trim();
  if (!a) return '';
  if (pending.slot === 'music_source') {
    const src = /spotify/i.test(a) ? 'spotify' : (/yt|youtube/i.test(a) ? 'youtube' : '');
    return src ? applyMusicSource(pending.origText, src) : '';
  }
  const rule = ruleList().find(r => r.intent === pending.intent && r.slot === pending.slot);
  return rule ? rule.merge(pending.origText, a) : pending.origText + ' ' + a;
}

/** Build a no-match clarify: question + tap chips (utter used as new text). */
export function noMatchClarify(text) {
  const sug = suggestFor(text, 3);
  if (!sug.length) return null;
  return {
    question: `Pakka samajhna chahta hoon, Boss — isme se kuch tha kya?`,
    options: sug.map(s => ({ label: s.label, say: s.utter })),
    pending: null   // no merge; the chip text itself becomes the new command
  };
}
