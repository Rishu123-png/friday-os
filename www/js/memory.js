/* ===== FRIDAY OS — Memory & Context Engine =====
   This is what makes FRIDAY feel like JARVIS instead of a chatbot.

   It does four things:
     1. LOG      — records every interaction with structure
     2. EXTRACT  — pulls facts about you out of normal conversation
     3. LEARN    — detects habits and patterns over time
     4. RECALL   — builds a context brief injected into every AI reply

   100% on-device. No Firebase, no cloud, no account. */

import { KEYS, getList, saveList, addItem, getSetting } from './store.js';

const FACTS = 'friday_facts';
const PATTERNS = 'friday_patterns';
const EPISODES = 'friday_episodes';

/* ================= 1. EPISODIC LOG ================= */
/** Every interaction, structured for analysis. */
export function logEpisode({ text, intent, role = 'user', meta = {} }) {
  if (!getSetting('saveMemory')) return;
  const d = new Date();
  const ep = {
    id: Date.now() + Math.random().toString(36).slice(2, 6),
    text: String(text).slice(0, 500),
    intent: intent || null,
    role,
    ts: d.getTime(),
    hour: d.getHours(),
    dow: d.getDay(),          // 0=Sun
    meta
  };
  const log = getList(EPISODES);
  log.unshift(ep);
  saveList(EPISODES, log.slice(0, 1500));
  return ep;
}

export function episodes() { return getList(EPISODES); }

/* ================= 2. FACT EXTRACTION ================= */
/* Pulls durable facts out of ordinary sentences, so you never
   have to "train" FRIDAY — she just picks things up. */

const FACT_RULES = [
  { re: /\bmy name is ([a-z][a-z\s]{1,24})\b/i,                key: 'user.name',      label: 'Your name' },
  { re: /\bcall me ([a-z][a-z\s]{1,20})\b/i,                   key: 'user.name',      label: 'Your name' },
  { re: /\bi(?:'m| am) (?:a |an )?([a-z\s]{3,30}?) (?:by profession|by trade)\b/i, key: 'user.job', label: 'Your work' },
  { re: /\bi work (?:as|at) (?:a |an )?([a-z0-9\s&.]{2,35})\b/i, key: 'user.job',     label: 'Your work' },
  { re: /\bi (?:study|am studying) ([a-z\s]{3,30})\b/i,        key: 'user.study',     label: 'You study' },
  { re: /\bi live in ([a-z\s,]{2,30})\b/i,                     key: 'user.city',      label: 'You live in' },
  { re: /\bmy (?:birthday|bday) is ([a-z0-9\s,]{3,20})\b/i,    key: 'user.birthday',  label: 'Your birthday' },
  { re: /\bmy (mother|father|mom|dad|sister|brother|wife|husband|girlfriend|boyfriend|friend|boss)(?:'s)? name is ([a-z][a-z\s]{1,20})\b/i,
    key: m => 'person.' + m[1].toLowerCase(), label: m => 'Your ' + m[1], val: m => m[2] },
  { re: /\bi (?:like|love|enjoy) ([a-z\s]{3,30})\b/i,          key: 'pref.likes',     label: 'You like', multi: true },
  { re: /\bi (?:hate|dislike|can'?t stand) ([a-z\s]{3,30})\b/i,key: 'pref.dislikes',  label: 'You dislike', multi: true },
  { re: /\bi(?:'m| am) allergic to ([a-z\s]{2,25})\b/i,        key: 'health.allergy', label: 'Allergic to', multi: true },
  { re: /\bmy favou?rite ([a-z\s]{2,20}) is ([a-z0-9\s]{2,30})\b/i,
    key: m => 'fav.' + m[1].trim().replace(/\s+/g, '_'), label: m => 'Favourite ' + m[1], val: m => m[2] },
  { re: /\bi (?:usually|always|normally) ([a-z0-9\s:.]{4,50})/i, key: 'habit.stated',  label: 'You usually', multi: true },
  { re: /\bremember (?:that )?(.{4,120})/i,                    key: 'note.explicit',  label: 'You told me', multi: true }
];

const clean = s => String(s).trim().replace(/[.,!?;]+$/, '').replace(/\s+/g, ' ');

export function extractFacts(text) {
  const found = [];
  for (const rule of FACT_RULES) {
    const m = text.match(rule.re);
    if (!m) continue;
    const key = typeof rule.key === 'function' ? rule.key(m) : rule.key;
    const label = typeof rule.label === 'function' ? rule.label(m) : rule.label;
    const value = clean(rule.val ? rule.val(m) : m[1]);
    if (!value || value.length < 2) continue;
    found.push({ key, label, value, multi: !!rule.multi });
  }
  found.forEach(saveFact);
  return found;
}

export function saveFact({ key, label, value, multi }) {
  const facts = getList(FACTS);
  if (multi) {
    const lv = value.toLowerCase();
    // treat substrings as the same fact — keep the longer/more complete one
    const dup = facts.find(f => f.key === key && (
      f.value.toLowerCase() === lv ||
      f.value.toLowerCase().includes(lv) ||
      lv.includes(f.value.toLowerCase())
    ));
    if (dup && lv.length > dup.value.length) dup.value = value;
    if (dup) { dup.count = (dup.count || 1) + 1; dup.updated = Date.now(); saveList(FACTS, facts); return dup; }
    facts.unshift({ key, label, value, count: 1, created: Date.now(), updated: Date.now() });
  } else {
    const existing = facts.find(f => f.key === key);
    if (existing) { existing.value = value; existing.updated = Date.now(); saveList(FACTS, facts); return existing; }
    facts.unshift({ key, label, value, count: 1, created: Date.now(), updated: Date.now() });
  }
  saveList(FACTS, facts.slice(0, 300));
  return facts[0];
}

export function allFacts() { return getList(FACTS); }
export function getFact(key) { return getList(FACTS).find(f => f.key === key)?.value || null; }
export function forgetFact(key, value) {
  const rest = getList(FACTS).filter(f => !(f.key === key && (!value || f.value === value)));
  saveList(FACTS, rest);
}

/* ================= 3. PATTERN LEARNING ================= */
/* Finds habits from the episode log — no ML, just counting. */

export function learnPatterns() {
  const eps = episodes().filter(e => e.role === 'user' && e.intent);
  if (eps.length < 8) return [];

  const found = [];

  // A) intent × hour-band  → "you usually check weather in the morning"
  const bands = { night: [0, 5], morning: [6, 11], afternoon: [12, 16], evening: [17, 21], late: [22, 23] };
  const byIntentBand = {};
  eps.forEach(e => {
    const band = Object.keys(bands).find(b => e.hour >= bands[b][0] && e.hour <= bands[b][1]) || 'day';
    const k = e.intent + '|' + band;
    byIntentBand[k] = (byIntentBand[k] || 0) + 1;
  });
  Object.entries(byIntentBand).forEach(([k, n]) => {
    if (n < 3) return;
    const [intent, band] = k.split('|');
    const total = eps.filter(e => e.intent === intent).length;
    if (n / total < 0.5) return;
    found.push({ type: 'time_habit', intent, band, count: n,
      text: `You usually ask about ${humanIntent(intent)} in the ${band}` });
  });

  // B) most-used intents → "your top commands"
  const counts = {};
  eps.forEach(e => { counts[e.intent] = (counts[e.intent] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  top.forEach(([intent, n]) => {
    if (n >= 4) found.push({ type: 'top_intent', intent, count: n,
      text: `${humanIntent(intent)} is one of your most-used commands (${n}×)` });
  });

  // C) recurring reminder subjects → "you often remind yourself to X"
  const rems = getList(KEYS.REMINDERS);
  const words = {};
  rems.forEach(r => {
    String(r.text).toLowerCase().split(/\s+/)
      .filter(w => w.length > 3 && !STOP.has(w))
      .forEach(w => { words[w] = (words[w] || 0) + 1; });
  });
  Object.entries(words).filter(([, n]) => n >= 3).slice(0, 3).forEach(([w, n]) => {
    found.push({ type: 'recurring_task', keyword: w, count: n,
      text: `You often set reminders about "${w}"` });
  });

  // D) active hours → "you're usually active around 9pm"
  const hours = {};
  eps.forEach(e => { hours[e.hour] = (hours[e.hour] || 0) + 1; });
  const peak = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
  if (peak && peak[1] >= 5) {
    found.push({ type: 'active_hour', hour: +peak[0], count: peak[1],
      text: `You're most active around ${fmtHour(+peak[0])}` });
  }

  saveList(PATTERNS, found);
  return found;
}

export function patterns() { return getList(PATTERNS); }

const STOP = new Set(['the','and','for','with','that','this','from','have','about','call','send','buy','get','need','make','take']);

function humanIntent(i) {
  const map = {
    weather: 'the weather', aqi: 'air quality', reminder_add: 'reminders', note_add: 'notes',
    math: 'calculations', wiki: 'knowledge lookups', news: 'the news', time: 'the time',
    briefing: 'your daily briefing', currency: 'currency', translate: 'translation',
    call: 'calling people', task_add: 'tasks', joke: 'jokes', define: 'definitions'
  };
  return map[i] || i.replace(/_/g, ' ');
}
function fmtHour(h) {
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh} ${ap}`;
}

/* ================= 4. CONTEXT RECALL ================= */
/* The brief that gets injected into every cloud AI call, so FRIDAY
   answers like she knows you — because she does. */

export function buildContext({ maxFacts = 14, maxPatterns = 4 } = {}) {
  const lines = [];

  const facts = allFacts();
  if (facts.length) {
    const grouped = {};
    facts.slice(0, maxFacts).forEach(f => {
      grouped[f.label] = grouped[f.label] || [];
      grouped[f.label].push(f.value);
    });
    lines.push('WHAT YOU KNOW ABOUT THE USER:');
    Object.entries(grouped).forEach(([label, vals]) => {
      lines.push(`- ${label}: ${[...new Set(vals)].join(', ')}`);
    });
  }

  const pats = patterns().slice(0, maxPatterns);
  if (pats.length) {
    lines.push('OBSERVED HABITS:');
    pats.forEach(p => lines.push(`- ${p.text}`));
  }

  const rems = getList(KEYS.REMINDERS).filter(r => !r.done && r.due > Date.now())
    .sort((a, b) => a.due - b.due).slice(0, 3);
  if (rems.length) {
    lines.push('UPCOMING REMINDERS:');
    rems.forEach(r => lines.push(`- ${r.text} (${new Date(r.due).toLocaleString()})`));
  }

  const tasks = getList(KEYS.TASKS).filter(t => !t.done).slice(0, 4);
  if (tasks.length) lines.push('OPEN TASKS: ' + tasks.map(t => t.text).join('; '));

  const notes = getList(KEYS.NOTES).slice(0, 4);
  if (notes.length) lines.push('RECENT NOTES: ' + notes.map(n => n.text).join('; '));

  if (!lines.length) return '';
  return lines.join('\n') +
    '\n\nUse this naturally. Reference it only when relevant — never recite it back.';
}

/* ================= 5. SEARCH ================= */
export function recall(query, limit = 6) {
  const q = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (!q.length) return [];
  const scored = [];

  allFacts().forEach(f => {
    const hay = (f.label + ' ' + f.value).toLowerCase();
    const s = q.reduce((a, w) => a + (hay.includes(w) ? 2 : 0), 0);
    if (s) scored.push({ score: s, kind: 'fact', text: `${f.label}: ${f.value}` });
  });

  episodes().slice(0, 400).forEach(e => {
    const hay = e.text.toLowerCase();
    const s = q.reduce((a, w) => a + (hay.includes(w) ? 1 : 0), 0);
    if (s) scored.push({ score: s, kind: 'episode', text: e.text, ts: e.ts });
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ================= 6. STATS ================= */
export function stats() {
  const eps = episodes();
  const userEps = eps.filter(e => e.role === 'user');
  const days = new Set(eps.map(e => new Date(e.ts).toDateString())).size;
  return {
    interactions: userEps.length,
    facts: allFacts().length,
    patterns: patterns().length,
    days,
    firstSeen: eps.length ? eps[eps.length - 1].ts : null
  };
}

export function wipeMemory() {
  saveList(FACTS, []); saveList(PATTERNS, []); saveList(EPISODES, []);
}

export function exportMemory() {
  return { facts: allFacts(), patterns: patterns(), episodes: episodes() };
}
