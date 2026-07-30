/* ===== FRIDAY OS — NLP Utilities =====
   Fuzzy matching, time parsing, slot filling.
   This is what makes the offline engine feel smart. */

/* ---------- Levenshtein distance (typo tolerance) ---------- */
export function levenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      cur[j + 1] = Math.min(
        prev[j + 1] + 1,
        cur[j] + 1,
        prev[j] + (a[i] === b[j] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  return 1 - levenshtein(a, b) / max;
}

/** Does text contain a word close to `target`? Tolerates typos. */
export function fuzzyHas(text, target, threshold = 0.75) {
  const words = text.toLowerCase().split(/\s+/);
  if (target.includes(' ')) {
    return text.toLowerCase().includes(target) ||
      similarity(text.toLowerCase(), target) > threshold;
  }
  return words.some(w => w === target || similarity(w, target) >= threshold);
}

/** Score how well text matches a list of keywords (0..1) */
export function keywordScore(text, keywords) {
  if (!keywords.length) return 0;
  let hits = 0;
  for (const k of keywords) if (fuzzyHas(text, k)) hits++;
  return hits / keywords.length;
}

/* ---------- Number words ---------- */
const NUM_WORDS = {
  zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
  ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, twenty:20,
  thirty:30, forty:40, fifty:50, sixty:60, half:30, quarter:15, a:1, an:1
};
export function wordToNum(w) {
  if (w == null) return null;
  const n = parseFloat(w);
  if (!isNaN(n)) return n;
  return NUM_WORDS[String(w).toLowerCase()] ?? null;
}

/* ---------- Time parsing ----------
   Handles: "in 20 minutes", "at 5pm", "tomorrow 9am",
            "next monday", "tonight", "in 2 hours"          */
const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

export function parseTime(text) {
  const t = text.toLowerCase();
  const now = new Date();

  // "in X minutes" / "for X minutes" / "after X hours" / bare "5 minutes"
  const rel = t.match(/\b(?:in|for|after)?\s*(\d+|[a-z]+)\s*(sec|second|min|minute|hour|hr|day|week)s?\b/);
  if (rel) {
    const n = wordToNum(rel[1]);
    if (n !== null) {
      const d = new Date(now);
      const unit = rel[2];
      if (unit.startsWith('sec')) d.setSeconds(d.getSeconds() + n);
      else if (unit.startsWith('min')) d.setMinutes(d.getMinutes() + n);
      else if (unit.startsWith('h')) d.setHours(d.getHours() + n);
      else if (unit.startsWith('day')) d.setDate(d.getDate() + n);
      else if (unit.startsWith('week')) d.setDate(d.getDate() + n * 7);
      return { date: d, matched: rel[0] };
    }
  }

  // "half an hour"
  if (/\bhalf an hour\b/.test(t)) {
    const d = new Date(now); d.setMinutes(d.getMinutes() + 30);
    return { date: d, matched: 'half an hour' };
  }

  // "at 5pm" / "at 5:30 pm" / "9am"
  const clock = t.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (clock) {
    let h = parseInt(clock[1], 10);
    const m = clock[2] ? parseInt(clock[2], 10) : 0;
    const ap = clock[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (/\btomorrow\b/.test(t)) d.setDate(d.getDate() + 1);
    else if (d <= now) d.setDate(d.getDate() + 1); // next occurrence
    return { date: d, matched: clock[0] };
  }

  // 24-hour "at 17:30"
  const c24 = t.match(/\bat\s+(\d{1,2}):(\d{2})\b/);
  if (c24) {
    const d = new Date(now);
    d.setHours(parseInt(c24[1], 10), parseInt(c24[2], 10), 0, 0);
    if (/\btomorrow\b/.test(t)) d.setDate(d.getDate() + 1);
    else if (d <= now) d.setDate(d.getDate() + 1);
    return { date: d, matched: c24[0] };
  }

  // named parts of day
  const parts = { tonight: 20, morning: 8, afternoon: 14, evening: 18, noon: 12, midnight: 0 };
  for (const [word, hour] of Object.entries(parts)) {
    if (new RegExp('\\b' + word + '\\b').test(t)) {
      const d = new Date(now);
      d.setHours(hour, 0, 0, 0);
      if (/\btomorrow\b/.test(t)) d.setDate(d.getDate() + 1);
      else if (d <= now) d.setDate(d.getDate() + 1);
      return { date: d, matched: word };
    }
  }

  // "tomorrow" alone
  if (/\btomorrow\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return { date: d, matched: 'tomorrow' };
  }

  // "next monday" / "on friday"
  const dayMatch = t.match(/\b(?:next|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (dayMatch) {
    const target = DAYS.indexOf(dayMatch[1]);
    const d = new Date(now);
    let diff = (target - d.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    d.setDate(d.getDate() + diff);
    d.setHours(9, 0, 0, 0);
    return { date: d, matched: dayMatch[0] };
  }

  return null;
}

/** Human friendly "in 5 minutes" / "tomorrow at 9:00 AM" */
export function humanTime(date) {
  const diff = date.getTime() - Date.now();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'in a moment';
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs} hour${hrs === 1 ? '' : 's'}`;
  const isTomorrow = new Date().getDate() + 1 === date.getDate();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isTomorrow ? `tomorrow at ${time}`
    : `${date.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
}

/* ---------- Slot extraction ---------- */
/** Strip filler words to get the "subject" of a command */
export function cleanSubject(text, stripWords = []) {
  let s = text;
  const fillers = [
    'please', 'for me', 'can you', 'could you', 'would you',
    'friday', 'hey friday', 'jarvis', 'okay', 'ok'
  ].concat(stripWords);
  fillers.forEach(f => { s = s.replace(new RegExp('\\b' + f + '\\b', 'gi'), ''); });
  return s.replace(/\s+/g, ' ').trim().replace(/^[,.\-\s]+|[,.\-\s]+$/g, '');
}

/** Pick a random element — used for response variety */
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Safe math evaluator (no eval / no Function) — shunting-yard */
export function safeMath(expr) {
  const clean = expr
    .replace(/plus/gi, '+').replace(/minus/gi, '-')
    .replace(/(times|multiplied by|into|x)/gi, '*')
    .replace(/(divided by|over)/gi, '/')
    .replace(/percent of/gi, '% *')
    .replace(/[^0-9+\-*/().% ]/g, '');
  if (!clean.trim()) return null;

  const tokens = clean.match(/\d+\.?\d*|[+\-*/()%]/g);
  if (!tokens) return null;

  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 };
  const out = [], ops = [];
  for (const tk of tokens) {
    if (/^\d/.test(tk)) out.push(parseFloat(tk));
    else if (tk === '(') ops.push(tk);
    else if (tk === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop());
      ops.pop();
    } else {
      while (ops.length && prec[ops[ops.length - 1]] >= prec[tk]) out.push(ops.pop());
      ops.push(tk);
    }
  }
  while (ops.length) out.push(ops.pop());

  const st = [];
  for (const tk of out) {
    if (typeof tk === 'number') st.push(tk);
    else {
      const b = st.pop(), a = st.pop();
      if (a === undefined || b === undefined) return null;
      if (tk === '+') st.push(a + b);
      else if (tk === '-') st.push(a - b);
      else if (tk === '*') st.push(a * b);
      else if (tk === '/') st.push(b === 0 ? NaN : a / b);
      else if (tk === '%') st.push(a % b);
    }
  }
  const res = st[0];
  if (res === undefined || Number.isNaN(res)) return null;
  return Math.round(res * 1e10) / 1e10;
}
