/* ===== FRIDAY OS — Offline Generators =====
   Real, useful output with NO API key.
   Not an LLM — curated scaffolds, plans and drafts that are genuinely usable. */

/* ---------- CODE SCAFFOLDS ---------- */
const SNIPPETS = [
  {
    k: ['html', 'webpage', 'web page', 'website', 'landing'],
    lang: 'html',
    title: 'Responsive HTML starter',
    code: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My Page</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;line-height:1.6;color:#eee;background:#111}
    .wrap{max-width:900px;margin:0 auto;padding:24px}
    header{padding:48px 0;text-align:center}
    h1{font-size:clamp(1.8rem,5vw,3rem);margin-bottom:12px}
    .grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
    .card{background:#1c1c24;border:1px solid #333;border-radius:12px;padding:20px}
    button{background:#00d4ff;border:0;color:#000;padding:12px 24px;
      border-radius:8px;font-weight:600;cursor:pointer}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Hello, world</h1>
      <p>A clean responsive starting point.</p>
    </header>
    <div class="grid">
      <div class="card"><h3>One</h3><p>Content here.</p></div>
      <div class="card"><h3>Two</h3><p>Content here.</p></div>
      <div class="card"><h3>Three</h3><p>Content here.</p></div>
    </div>
    <p style="margin-top:24px"><button onclick="alert('Clicked')">Click me</button></p>
  </div>
</body>
</html>`
  },
  {
    k: ['fetch', 'api call', 'http request', 'ajax', 'rest'],
    lang: 'javascript',
    title: 'Fetch with timeout, retry and error handling',
    code: `async function request(url, { retries = 2, timeout = 8000, ...opts } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2 ** attempt * 500)); // backoff
    }
  }
}

// usage
request('https://api.example.com/data')
  .then(data => console.log(data))
  .catch(err => console.error('Failed:', err.message));`
  },
  {
    k: ['python', 'script', 'py'],
    lang: 'python',
    title: 'Python CLI script skeleton',
    code: `#!/usr/bin/env python3
"""Short description of what this script does."""

import argparse
import sys
from pathlib import Path


def process(path: Path, verbose: bool = False) -> int:
    if not path.exists():
        print(f"error: {path} not found", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    if verbose:
        print(f"Read {len(text)} characters from {path}")
    # ---- your logic here ----
    print(f"Lines: {len(text.splitlines())}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file", type=Path, help="input file")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    return process(args.file, args.verbose)


if __name__ == "__main__":
    sys.exit(main())`
  },
  {
    k: ['sort', 'sorting', 'sort a list', 'sort array'],
    lang: 'python',
    title: 'Sorting — the practical patterns',
    code: `nums = [5, 2, 9, 1, 7]

# ascending / descending
print(sorted(nums))                 # [1, 2, 5, 7, 9]
print(sorted(nums, reverse=True))   # [9, 7, 5, 2, 1]

# sort objects by a field
people = [{"name": "Ana", "age": 30}, {"name": "Bo", "age": 25}]
print(sorted(people, key=lambda p: p["age"]))

# multi-key: age ascending, then name
print(sorted(people, key=lambda p: (p["age"], p["name"])))

# in-place (mutates, returns None)
nums.sort()

# JavaScript equivalent:
# arr.sort((a, b) => a - b);
# objs.sort((a, b) => a.age - b.age || a.name.localeCompare(b.name));`
  },
  {
    k: ['react', 'component', 'jsx', 'hook'],
    lang: 'jsx',
    title: 'React component with data fetching',
    code: `import { useState, useEffect } from 'react';

export default function DataList({ url }) {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(url)
      .then(r => { if (!r.ok) throw new Error(\`HTTP \${r.status}\`); return r.json(); })
      .then(d => { if (!cancelled) { setData(d); setError(null); } })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };   // avoid setting state after unmount
  }, [url]);

  if (loading) return <p>Loading…</p>;
  if (error)   return <p role="alert">Error: {error}</p>;

  return (
    <ul>
      {data.map(item => <li key={item.id}>{item.name}</li>)}
    </ul>
  );
}`
  },
  {
    k: ['express', 'node server', 'backend', 'rest api server'],
    lang: 'javascript',
    title: 'Express REST API',
    code: `import express from 'express';

const app = express();
app.use(express.json());

const items = [];

app.get('/api/items', (req, res) => res.json(items));

app.get('/api/items/:id', (req, res) => {
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.post('/api/items', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const item = { id: crypto.randomUUID(), name, created: Date.now() };
  items.push(item);
  res.status(201).json(item);
});

app.delete('/api/items/:id', (req, res) => {
  const i = items.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  items.splice(i, 1);
  res.status(204).end();
});

// central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

app.listen(3000, () => console.log('http://localhost:3000'));`
  },
  {
    k: ['sql', 'query', 'database', 'select', 'join'],
    lang: 'sql',
    title: 'SQL patterns worth memorising',
    code: `-- join + aggregate + filter groups
SELECT  u.id,
        u.name,
        COUNT(o.id)          AS order_count,
        COALESCE(SUM(o.total), 0) AS lifetime_value
FROM        users  u
LEFT JOIN   orders o ON o.user_id = u.id
WHERE       u.created_at >= '2025-01-01'
GROUP BY    u.id, u.name
HAVING      COUNT(o.id) > 0
ORDER BY    lifetime_value DESC
LIMIT 20;

-- most recent row per group (window function)
SELECT * FROM (
  SELECT o.*,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
  FROM   orders o
) t
WHERE t.rn = 1;`
  },
  {
    k: ['regex', 'regular expression', 'validate'],
    lang: 'javascript',
    title: 'Regex cheat set',
    code: `const patterns = {
  email:    /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/,
  phoneIN:  /^(?:\\+?91[\\s-]?)?[6-9]\\d{9}$/,
  url:      /^https?:\\/\\/[^\\s/$.?#].[^\\s]*$/i,
  // 8+ chars, upper, lower, digit
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$/,
  ipv4:     /^(25[0-5]|2[0-4]\\d|1?\\d?\\d)(\\.(25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}$/,
  date:     /^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$/
};

const isValid = (kind, value) => patterns[kind].test(String(value).trim());

console.log(isValid('email', 'me@site.com'));   // true
console.log(isValid('phoneIN', '9876543210'));  // true

// extract all matches
const text = 'Mail a@b.com or c@d.org';
console.log([...text.matchAll(/[\\w.]+@[\\w.]+\\.\\w+/g)].map(m => m[0]));`
  },
  {
    k: ['debounce', 'throttle', 'performance'],
    lang: 'javascript',
    title: 'Debounce & throttle',
    code: `function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function throttle(fn, limit = 300) {
  let waiting = false;
  return (...args) => {
    if (waiting) return;
    fn(...args);
    waiting = true;
    setTimeout(() => { waiting = false; }, limit);
  };
}

// search box: wait until typing stops
input.addEventListener('input', debounce(e => search(e.target.value), 400));

// scroll: run at most 10x per second
window.addEventListener('scroll', throttle(onScroll, 100));`
  },
  {
    k: ['css', 'style', 'flexbox', 'grid', 'center'],
    lang: 'css',
    title: 'CSS layout patterns',
    code: `/* dead-centre anything */
.center { display: grid; place-items: center; min-height: 100dvh; }

/* responsive grid, no media queries */
.grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

/* sticky footer */
body { min-height: 100dvh; display: flex; flex-direction: column; }
main { flex: 1; }

/* truncate to N lines */
.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* fluid type */
h1 { font-size: clamp(1.5rem, 4vw + 1rem, 3.5rem); }

/* safe area for phone notches */
.bar { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }`
  }
];

export function offlineCode(prompt) {
  const p = prompt.toLowerCase();
  let best = null, bestScore = 0;
  for (const s of SNIPPETS) {
    // score by total matched keyword length -> specific phrases win over generic words
    const score = s.k.reduce((acc, k) => p.includes(k) ? acc + k.length : acc, 0);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (!best) return null;
  return {
    title: best.title,
    body: `**${best.title}**\n\n\`\`\`${best.lang}\n${best.code}\n\`\`\`\n\n_Offline template. Configure the optional FRIDAY Cloud backend for code written specifically for your request._`
  };
}

export function codeTopics() {
  return SNIPPETS.map(s => s.k[0]);
}

/* ---------- PLANNER ---------- */
export function offlinePlan(goal) {
  const g = goal.trim().replace(/\.$/, '');
  return `**Plan: ${g}**

**1. Clarify the outcome** _(15 min)_
• Write one sentence describing "done"
• Define how you'll measure success
• Note anything explicitly out of scope

**2. Break it down** _(30 min)_
• List every task you can think of
• Mark each: Must / Should / Could
• Delete or defer everything that isn't "Must"

**3. Order by dependency** _(15 min)_
• What blocks what?
• Identify the single riskiest unknown — do that first

**4. Time-box** _(15 min)_
• Estimate each Must task, then add 50% buffer
• Schedule the first task for a specific time today

**5. Execute in cycles**
• Work one task at a time, no parallel work
• Review progress at the end of each day
• Re-order remaining tasks as you learn

**6. Review**
• What worked, what didn't, what to change next time

_Offline template. Add a Groq key for a plan tailored to "${g}"._`;
}

/* ---------- RESEARCH ---------- */
export function offlineResearch(topic) {
  const t = topic.trim();
  const q = encodeURIComponent(t);
  return `**Research brief: ${t}**

I'm offline, so here's a structured approach plus direct sources.

**Framing questions**
• What exactly am I trying to learn, and why?
• What would change my mind?
• Who benefits from each viewpoint I read?

**Source ladder** _(work top to bottom)_
1. **Overview** — [Wikipedia](https://en.wikipedia.org/wiki/Special:Search?search=${q})
2. **Academic** — [Google Scholar](https://scholar.google.com/scholar?q=${q})
3. **Primary data** — original reports, datasets, official statistics
4. **Discussion** — [Reddit](https://www.reddit.com/search/?q=${q}), forums, practitioner blogs
5. **Recent news** — [Google News](https://news.google.com/search?q=${q})

**As you read, capture**
• Key claim + who makes it
• Evidence quality (data? anecdote? opinion?)
• Contradictions between sources
• What's still unknown

**Red flags**
• No date on the page
• No sources cited
• Single-source claims repeated everywhere
• Strong claims with commercial incentive behind them

_Tip: ask me "who is X" or "what is X" and I'll pull a live Wikipedia summary right now, no key needed._`;
}

/* ---------- WRITER ---------- */
export function offlineWrite(request) {
  const r = request.toLowerCase();

  if (/\b(email|mail)\b/.test(r)) {
    return `**Email template**

Subject: [Specific, 5–8 words]

Hi [Name],

[One line of context — why you're writing.]

[The ask, stated plainly. One sentence.]

[Any detail they need to say yes: dates, numbers, links.]

[Clear next step + deadline.]

Thanks,
[Your name]

---
**Rules that make emails work**
• Put the ask in the first two lines
• One email = one request
• Under 150 words
• Specific subject line, never "Quick question"
• Give a deadline, or it won't happen

_Offline template. Add a Groq key and I'll write the actual email._`;
  }

  if (/\b(resume|cv|cover letter)\b/.test(r)) {
    return `**Resume bullet formula**

> [Action verb] + [what you did] + [measurable result]

Weak: _"Responsible for the website"_
Strong: _"Rebuilt the marketing site, cutting load time 4.2s → 0.9s and lifting signups 23%"_

**Structure**
1. Name + contact + one-line summary
2. Experience — reverse chronological, 3–5 bullets each
3. Skills — only what you'd survive an interview on
4. Education — last if you have experience

**Checklist**
• Numbers in at least half your bullets
• No "responsible for", no "team player"
• One page under 10 years' experience
• Mirror keywords from the job posting
• Export as PDF, named \`Firstname-Lastname-Role.pdf\`

_Add a Groq key and I'll write your actual bullets._`;
  }

  if (/\b(essay|article|blog|post)\b/.test(r)) {
    return `**Article structure**

**Hook** _(1 short para)_
Open with a surprising fact, a concrete scene, or the reader's exact problem.

**Thesis** _(1–2 sentences)_
State your claim plainly. The reader should know what they'll get.

**Body** _(3–5 sections)_
• One idea per section
• Each: claim → evidence → what it means
• Concrete example in every section

**Counterpoint** _(1 section)_
Address the strongest objection honestly. This builds trust more than anything else.

**Close**
Restate the thesis with the weight of everything proven. End on an implication, not a summary.

**Editing pass**
• Cut the first paragraph — it's usually throat-clearing
• Kill adverbs and "very"
• Short sentences after long ones
• Read it aloud; fix wherever you stumble

_Add a Groq key and I'll write the piece itself._`;
  }

  return `**Writing framework**

**Before you write**
• Who is the reader, and what do they already know?
• What single thing must they take away?
• What action should they take next?

**Structure**
1. Hook — earn the next sentence
2. Context — only what's needed
3. Core message — clear and early
4. Support — evidence, examples, detail
5. Close — the action or implication

**Edit ruthlessly**
• Cut 20% of your first draft
• One idea per paragraph
• Prefer the shorter word
• Active voice
• Read aloud — stumbles mark weak spots

_Offline template. Configure the optional FRIDAY Cloud backend and I'll write the actual piece._`;
}

/* ---------- Password generator ---------- */
export function generatePassword(len = 20, opts = {}) {
  const sets = {
    lower: 'abcdefghijkmnopqrstuvwxyz',
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    digit: '23456789',
    sym: '!@#$%^&*-_=+?'
  };
  let pool = sets.lower + sets.upper + sets.digit;
  if (opts.symbols !== false) pool += sets.sym;
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, n => pool[n % pool.length]).join('');
}

/* ---------- Unit conversion ---------- */
const UNITS = {
  km: 1000, m: 1, cm: 0.01, mm: 0.001, mile: 1609.34, miles: 1609.34,
  ft: 0.3048, feet: 0.3048, foot: 0.3048, inch: 0.0254, inches: 0.0254, yard: 0.9144,
  kg: 1000, g: 1, mg: 0.001, lb: 453.592, lbs: 453.592, pound: 453.592,
  pounds: 453.592, oz: 28.3495, ounce: 28.3495, ton: 1000000
};
const GROUPS = [
  ['km', 'm', 'cm', 'mm', 'mile', 'miles', 'ft', 'feet', 'foot', 'inch', 'inches', 'yard'],
  ['kg', 'g', 'mg', 'lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce', 'ton']
];

export function convertUnit(value, from, to) {
  from = from.toLowerCase(); to = to.toLowerCase();

  // temperature
  const temps = ['c', 'celsius', 'f', 'fahrenheit', 'k', 'kelvin'];
  if (temps.includes(from) && temps.includes(to)) {
    let c;
    if (from[0] === 'c') c = value;
    else if (from[0] === 'f') c = (value - 32) * 5 / 9;
    else c = value - 273.15;
    let out;
    if (to[0] === 'c') out = c;
    else if (to[0] === 'f') out = c * 9 / 5 + 32;
    else out = c + 273.15;
    return Math.round(out * 100) / 100;
  }

  if (!(from in UNITS) || !(to in UNITS)) return null;
  const sameGroup = GROUPS.some(g => g.includes(from) && g.includes(to));
  if (!sameGroup) return null;
  return Math.round((value * UNITS[from] / UNITS[to]) * 10000) / 10000;
}
 