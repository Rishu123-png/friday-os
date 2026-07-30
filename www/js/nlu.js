/* ===== FRIDAY OS — Advanced NLU =====
   Four capabilities that make conversation feel natural, all offline:

   1. SEMANTIC SEARCH  — TF-IDF + cosine similarity (meaning, not keywords)
   2. ANAPHORA         — "what about tomorrow?" knows what you meant
   3. CHAINING         — "remind me X and add task Y" runs both
   4. SENTIMENT        — detects mood, adapts tone

   No model download, no network, no key. Pure math. */

/* ================= 1. SEMANTIC SEARCH (TF-IDF) ================= */

const STOP = new Set(['a','an','the','is','are','was','were','be','been','am','i','you','he','she',
  'it','we','they','my','your','his','her','its','our','their','me','him','them','this','that',
  'these','those','to','of','in','on','at','for','with','by','from','up','about','into','over',
  'and','or','but','if','then','so','than','as','not','no','do','does','did','have','has','had',
  'will','would','can','could','should','shall','may','might','must','what','which','who','whom',
  'whose','when','where','why','how','all','any','both','each','few','more','most','some','such']);

const STEM = w => w
  .replace(/(ing|edly|edness)$/, '')
  .replace(/(ies)$/, 'y')
  .replace(/(es|s)$/, '')
  .replace(/(ed)$/, '');

/* Concept expansion — the missing link that makes TF-IDF behave semantically.
   Each group: any member expands to a shared concept token. */
const CONCEPTS = [
  ['wifi','internet','router','network','broadband','password','credential','login','ssid'],
  ['grocery','shopping','milk','egg','bread','vegetable','fruit','store','market','buy','rice','flour'],
  ['medical','health','doctor','medicine','prescription','allergy','allergic','hospital','clinic','sick','pill','tablet'],
  ['money','payment','bill','rent','salary','bank','cash','pay','expense','budget','emi','loan'],
  ['work','office','job','meeting','project','deadline','client','boss','team','colleague','presentation'],
  ['family','mother','father','mom','dad','sister','brother','wife','husband','parent','son','daughter'],
  ['travel','trip','flight','train','ticket','hotel','vacation','journey','booking','airport'],
  ['food','eat','lunch','dinner','breakfast','restaurant','meal','cook','recipe','hungry'],
  ['study','exam','college','school','class','course','assignment','homework','lecture','semester'],
  ['vehicle','car','bike','fuel','petrol','service','insurance','licence','license'],
  ['name','called','identity','myself'],
  ['home','house','flat','apartment','address','room'],
  ['friend','buddy','mate','pal'],
  ['birthday','anniversary','celebration','party','festival']
];
const CONCEPT_MAP = new Map();
CONCEPTS.forEach((group, i) => {
  const tag = '~c' + i;
  group.forEach(w => {
    const st = STEM(w);
    const list = CONCEPT_MAP.get(st) || [];
    list.push(tag);
    CONCEPT_MAP.set(st, list);
  });
});

export function tokenize(text) {
  return String(text).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
    .map(STEM)
    .flatMap(w => {
      const tags = CONCEPT_MAP.get(w);
      return tags ? [w, ...tags] : [w];
    });
}

function termFreq(tokens) {
  const tf = new Map();
  tokens.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
  const max = Math.max(1, ...tf.values());
  tf.forEach((v, k) => tf.set(k, 0.5 + 0.5 * v / max)); // normalized
  return tf;
}

/**
 * Rank documents by semantic similarity to a query.
 * @param {string} query
 * @param {Array<{id?, text}>} docs
 * @returns {Array} docs with .score, sorted desc
 */
export function semanticSearch(query, docs, limit = 8) {
  if (!docs.length) return [];
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];

  const docTokens = docs.map(d => tokenize(d.text));

  // inverse document frequency
  const N = docs.length;
  const df = new Map();
  docTokens.forEach(toks => {
    new Set(toks).forEach(t => df.set(t, (df.get(t) || 0) + 1));
  });
  const idf = t => Math.log(1 + N / (1 + (df.get(t) || 0)));

  const qtf = termFreq(qTokens);
  const qVec = new Map();
  qtf.forEach((v, t) => qVec.set(t, v * idf(t)));
  const qMag = Math.sqrt([...qVec.values()].reduce((s, v) => s + v * v, 0)) || 1;

  const scored = docs.map((doc, i) => {
    const dtf = termFreq(docTokens[i]);
    let dot = 0, dMagSq = 0;
    dtf.forEach((v, t) => {
      const w = v * idf(t);
      dMagSq += w * w;
      if (qVec.has(t)) dot += w * qVec.get(t);
    });
    const dMag = Math.sqrt(dMagSq) || 1;
    return { ...doc, score: dot / (qMag * dMag) };
  });

  return scored.filter(d => d.score > 0.04)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* ================= 2. ANAPHORA / CONTEXT RESOLUTION ================= */
/* Turns follow-ups into complete commands using the previous turn. */

const FOLLOWUPS = [
  { re: /^(?:and\s+)?what about (.+?)\??$/i,        kind: 'topic_shift' },
  { re: /^(?:and\s+)?how about (.+?)\??$/i,          kind: 'topic_shift' },
  { re: /^(?:what|how) about (?:it|that|this)\??$/i,kind: 'repeat' },
  { re: /^(?:and\s+)?(tomorrow|today|tonight|this week|next week)\??$/i, kind: 'time_shift' },
  { re: /^(?:do|tell me) (?:it|that) again\??$/i,   kind: 'repeat' },
  { re: /^(?:and )?(?:the )?same (?:for|with) (.+?)\??$/i, kind: 'topic_shift' },
  { re: /^more(?: details?| info(?:rmation)?)?\??$/i, kind: 'elaborate' },
  { re: /^(?:tell me )?more about (?:it|that|this)\??$/i, kind: 'elaborate' }
];

/** Templates to rebuild a full command from the last intent. */
const REBUILD = {
  weather:  (arg) => arg ? `weather ${arg}` : 'what is the weather',
  aqi:      (arg) => arg ? `air quality ${arg}` : 'air quality',
  news:     () => 'latest news',
  wiki:     (arg) => arg ? `who is ${arg}` : null,
  define:   (arg) => arg ? `define ${arg}` : null,
  currency: (arg) => arg ? `convert ${arg}` : null,
  time:     () => 'what time is it',
  briefing: () => 'good morning'
};

/**
 * @param {string} text  user input
 * @param {object} ctx   { lastIntent, lastSubject }
 * @returns {string|null} rewritten command, or null if not a follow-up
 */
export function resolveFollowup(text, ctx = {}) {
  const t = text.trim();
  if (t.length > 44) return null;
  if (!ctx.lastIntent) return null;

  for (const f of FOLLOWUPS) {
    const m = t.match(f.re);
    if (!m) continue;

    const builder = REBUILD[ctx.lastIntent];
    if (!builder) return null;

    // strip trailing punctuation from the captured argument
    const arg = m[1] ? m[1].replace(/[?!.,;:\s]+$/, '').trim() : null;

    if (f.kind === 'repeat' || f.kind === 'elaborate') {
      return builder(ctx.lastSubject) || null;
    }
    if (f.kind === 'time_shift') return builder(arg);
    if (f.kind === 'topic_shift') return builder(arg);
  }
  return null;
}

/* ================= 3. COMMAND CHAINING ================= */
/* "remind me to call mom at 5 and add task buy milk and what's the weather" */

const SPLIT_RE = /\s+(?:and then|then|also|and also|,\s*and|\band\b)\s+/i;

const COMMAND_STARTERS = /^(remind|note|add|set|call|text|message|open|show|tell|what|who|when|where|how|turn|play|search|find|convert|translate|define|scan|generate|create|make|start|stop|clear|delete)/i;

/**
 * Split a compound utterance into individual commands.
 * Conservative: only splits when each part looks like a real command.
 */
export function splitCommands(text) {
  const t = text.trim();
  if (t.length < 18) return [t];
  if (!SPLIT_RE.test(t)) return [t];

  const raw = t.split(SPLIT_RE).map(s => s.trim()).filter(Boolean);
  if (raw.length < 2 || raw.length > 4) return [t];

  // every part must look like a command, else treat as one sentence
  const ok = raw.every(p => p.length >= 4 && COMMAND_STARTERS.test(p));
  if (!ok) return [t];

  return raw;
}

/* ================= 4. SENTIMENT / MOOD ================= */

const POS = ['good','great','awesome','amazing','love','happy','excellent','perfect','thanks',
  'thank','nice','cool','brilliant','wonderful','fantastic','glad','excited','best'];
const NEG = ['bad','terrible','awful','hate','sad','angry','annoyed','frustrated','tired',
  'exhausted','stressed','worried','anxious','depressed','sick','pain','worst','stupid','useless'];
const URGENT = ['urgent','emergency','asap','immediately','now','quick','hurry','help me','critical'];

export function sentiment(text) {
  const t = text.toLowerCase();
  const words = t.split(/\s+/);
  let score = 0;
  words.forEach(w => {
    const s = w.replace(/[^a-z]/g, '');
    if (POS.includes(s)) score += 1;
    if (NEG.includes(s)) score -= 1;
  });
  const urgent = URGENT.some(u => t.includes(u));
  const mood = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
  return { mood, score, urgent };
}

/** Tone prefix FRIDAY can prepend based on mood */
export function toneFor(mood, urgent) {
  if (urgent) return ['Right away.', 'On it.', 'Immediately.'];
  if (mood === 'negative') return ['Understood.', "I'm on it.", 'Let me help with that.'];
  if (mood === 'positive') return ['Happy to.', 'Of course.', 'Absolutely.'];
  return [];
}

/* ================= 5b. HINGLISH COMMAND LAYER ================= */
/* Normalizes common Hindi/Hinglish command phrases to English intents
   BEFORE the intent engine runs, so every existing intent just works.
   Conservative: only high-confidence command phrases are translated. */

const HINGLISH = [
  [/\bkitne baje( hai| hain| hai kya)?\b/, 'what time is it'],
  [/\bsamay kya( hai| hain)?\b/, 'what time is it'],
  [/\btarikh kya( hai| hain)?\b/, 'what is the date'],
  [/\bmausam( kaisa hai| kaisa| batao| bataye)?\b/, 'weather'],
  [/\byaad dila ?(?:do|na|o)?\b/, 'remind me'],
  [/\balarm (?:laga ?do|lagao|laga do na|set karo)\b/, 'set an alarm'],
  [/\b(?:call|phone|dial) (?:karo|kar do|karna|milao)\b/, 'call'],
  [/\b(?:message|sms|text) bhejo\b/, 'send message'],
  [/\bkhabar(?:ein| en)?|samachar\b/, 'news'],
  [/\bkholo\b|\bkhol do\b|\bkholiye\b/, 'open'],
  [/\bband (?:karo|kar do)\b/, 'turn off'],
  [/\bchalu (?:karo|kar do)\b|\bchalao\b/, 'turn on'],
  [/\b(awaaz|awaz) (?:kam|zyada|badha|ghata|mute)\b/, 'volume'],
  [/\bkitni battery( hai)?\b|\bbattery kitna\b/, 'battery'],
  [/\bjoke suna ?(?:o|na)?\b|\bmazaak\b/, 'tell me a joke'],
  [/\bnikal do\b|\bhata do\b/, 'delete'],
  [/\bphoto kheencho\b|\btasveer lo\b/, 'take a photo']
];

/** Translate high-confidence Hinglish phrases to English commands. */
export function hinglishAliases(text) {
  let t = ' ' + String(text).toLowerCase().trim() + ' ';
  for (const [re, en] of HINGLISH) {
    t = t.replace(re, ' ' + en + ' ');
  }
  return t.replace(/\s+/g, ' ').trim();
}

/* ================= 5. SPELL CORRECTION for commands ================= */

const VOCAB = ['weather','reminder','remind','note','task','calendar','contact','translate',
  'battery','flashlight','torch','camera','scan','search','news','currency','convert','define',
  'settings','theme','timer','password','briefing','location','navigate','joke','music','call',
  'message','memory','remember','forget','quality','temperature','tomorrow','morning','evening',
  'notes','tasks','flashlight','turn','show','open','what','when','where','about','please'];

function lev(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      cur[j + 1] = Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + (a[i] === b[j] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Fix obvious typos in command words: "wether" -> "weather" */
export function autoCorrect(text) {
  return text.split(/(\s+)/).map(tok => {
    const w = tok.toLowerCase();
    if (w.length < 4 || !/^[a-z]+$/.test(w)) return tok;
    if (VOCAB.includes(w)) return tok;
    let best = null, bestD = 99;
    for (const v of VOCAB) {
      if (Math.abs(v.length - w.length) > 2) continue;
      const d = lev(w, v);
      if (d < bestD) { bestD = d; best = v; }
    }
    // only correct if very close (1 edit for short, 2 for long)
    const limit = w.length >= 5 ? 2 : 1;
    return bestD <= limit ? best : tok;
  }).join('');
}
