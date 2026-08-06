/* ============================================================================
   FRIDAY OS — NOTESX: AI Notes (v15 Phase 4 / Smart Productivity 1)
   Upgrades the existing notes store (KEYS.NOTES) — no duplicate store.
   Each note gains: folder · kind (text|voice|image|ocr|doc) · pinned · tags ·
   summary · flashcards · mindmap · semantic index.
   Pure helpers are unit-tested; runtime wire in app.js.
   ========================================================================== */

import { KEYS, getList, saveList } from './store.js';
import { semanticSearch } from './nlu.js';

const NOTES = KEYS.NOTES;

/* ---------------- 1) Note model ---------------- */

/** Build a normalized note record (preserves existing {text, created}). */
export function makeNote({ text = '', folder = '', kind = 'text', pinned = false, tags = [], source = null } = {}) {
  const t = String(text || '').trim();
  return { text: t, folder: String(folder || '').trim(), kind, pinned: !!pinned, tags: tags || [], source, created: Date.now() };
}

/** All notes (newest first). */
export function notes() { return getList(NOTES); }

/** Add a note (dedupe by normalized text — no spam duplicates). */
export function addNote({ text, folder, kind, pinned, tags, source }) {
  const list = getList(NOTES);
  const norm = String(text || '').trim().toLowerCase();
  if (!norm) return null;
  const dup = list.find(n => String(n.text || '').toLowerCase() === norm);
  if (dup) return dup;                       // already have it
  const rec = makeNote({ text, folder, kind, pinned, tags, source });
  saveList(NOTES, [rec, ...list].slice(0, 800));
  return rec;
}

/** Update a note's text/folder/pinned/tags in place. */
export function updateNote(id, patch = {}) {
  const list = getList(NOTES);
  const rec = list.find(n => n.id === id);
  if (!rec) return null;
  Object.assign(rec, patch, { updated: Date.now() });
  saveList(NOTES, list);
  return rec;
}

export function deleteNote(id) { saveList(NOTES, getList(NOTES).filter(n => n.id !== id)); }
export function pinNote(id, on = true) { return updateNote(id, { pinned: !!on }); }

/* ---------------- 2) Folders ---------------- */

export function folders() {
  const f = {};
  for (const n of getList(NOTES)) {
    const k = (n.folder || '').trim() || '(uncategorized)';
    f[k] = (f[k] || 0) + 1;
  }
  return Object.entries(f).map(([name, count]) => ({ name, count }));
}
export function notesInFolder(folder = '') {
  const f = String(folder || '').trim().toLowerCase();
  return getList(NOTES).filter(n => (n.folder || '').trim().toLowerCase() === f);
}
export function moveNote(id, folder) { return updateNote(id, { folder: String(folder || '').trim() }); }

/* ---------------- 3) Semantic search (uses NLU semanticSearch) ---------------- */

export function searchNotes(q, limit = 8) {
  const docs = getList(NOTES).map(n => ({ text: n.text, meta: n }));
  const hits = semanticSearch(String(q || ''), docs, limit * 2);
  return hits.slice(0, limit).map(h => ({ note: h.meta, score: h.score }));
}

export function pinnedNotes() { return getList(NOTES).filter(n => n.pinned); }

/* ---------------- 4) AI summary (pure local + AI hook) ---------------- */
/* Local extractive: keeps the first K sentences weighted by keywords. */
const STOP = new Set(('the a an and or is are was were it this that i me my you your we our to of in on for at by with from as be am do did does have has had not no yes').split(' '));
function kwWeight(sentence, qwords) {
  const s = sentence.toLowerCase();
  let w = 0;
  for (const q of qwords) if (s.includes(q)) w++;
  return w;
}
export function localSummary(text, { maxSentences = 4 } = {}) {
  const t = String(text || '').trim();
  if (!t) return '';
  const sents = t.split(/(?<=[.!?])\s+/).filter(s => s.length > 2);
  if (sents.length <= maxSentences) return t.slice(0, 1000);
  const words = t.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOP.has(w));
  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);
  const scored = sents.map((s, i) => ({ s, i, w: kwWeight(s, top) + (i === 0 ? 2 : 0) }));
  scored.sort((a, b) => b.w - a.w);
  return scored.slice(0, maxSentences).sort((a, b) => a.i - b.i).map(x => x.s).join(' ');
}

/** Full summary: tries the AI router first, falls back to local. */
export async function summarizeNote(text, { ai = null } = {}) {
  if (ai && typeof ai === 'function') {
    try {
      const r = await ai(text);
      if (r && r.ok && r.text) return r.text;
    } catch (_) {}
  }
  return localSummary(text);
}

/* ---------------- 5) Flashcards (pure) ---------------- */

/** Extract Q/A flashcard pairs from note text. Patterns: "Q: ... A: ...",
    "? — answer", bullet "term: definition". */
export function flashcardsFrom(text, limit = 8) {
  const t = String(text || '');
  const cards = [];
  // Q:/A: blocks — same-line "Q: x A: y" or consecutive lines
  const qaInline = t.match(/(?:^|\n)\s*Q(?:\.|uestion)?\s*[:：]\s*([^\n]{2,120}?)\s+A(?:\.|nswer)?\s*[:：]\s*([^\n]{2,300})/gi);
  if (qaInline) {
    for (const b of qaInline) {
      const qm = b.match(/Q(?:\.|uestion)?\s*[:：]\s*(.+?)\s+A/i);
      const am = b.match(/A(?:\.|nswer)?\s*[:：]\s*(.+)$/i);
      if (qm && am) cards.push({ q: qm[1].trim().slice(0, 120), a: am[1].trim().slice(0, 300) });
    }
  }
  // Q:/A: on separate consecutive lines
  if (!cards.length) {
    const qaLines = t.split('\n');
    for (let i = 0; i < qaLines.length - 1; i++) {
      const qm = qaLines[i].match(/^\s*(?:Q|Q\.|Question)\s*[:：]\s*(.+)$/i);
      const am = qaLines[i + 1].match(/^\s*(?:A|A\.|Answer)\s*[:：]\s*(.+)$/i);
      if (qm && am) cards.push({ q: qm[1].trim().slice(0, 120), a: am[1].trim().slice(0, 300) });
    }
  }
  // "? — answer" inline
  if (cards.length < limit) {
    const inline = t.match(/[^.!?\n]{6,120}\?\s*[-–—]\s*([^.!?\n]{2,180})/g) || [];
    for (const m of inline) {
      const [q, a] = m.split(/\?\s*[-–—]\s*/);
      if (q && a) cards.push({ q: q.trim().replace(/^[-–—\s]+/, ''), a: a.trim() });
    }
  }
  // "term: definition" bullets (fallback)
  if (!cards.length) {
    const bullets = t.match(/^[-*•]\s*([A-Za-z][A-Za-z0-9 ]{2,40})\s*:\s*([^\n]{3,180})/gm) || [];
    for (const b of bullets.slice(0, limit)) {
      const [, q, a] = b.match(/^[-*•]\s*([^:]{2,40})\s*:\s*(.+)$/) || [];
      if (q && a) cards.push({ q: q.trim(), a: a.trim() });
    }
  }
  // dedupe
  const seen = new Set();
  return cards.filter(c => { const k = c.q.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
}

/* ---------------- 6) Mind map (pure) ---------------- */

/** Extract a topic + subtopics graph from note text. Returns {topic, nodes, edges}. */
export function mindmapFrom(text, { maxNodes = 8 } = {}) {
  const t = String(text || '');
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  const topic = lines[0] && lines[0].length < 60 ? lines[0].replace(/^[#>*\-\s]+/, '') : 'My notes';
  const nodes = [{ id: 'root', label: topic }];
  const edges = [];
  let seen = new Set(['root']);
  const add = (label) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    const node = { id: 'n' + nodes.length, label };
    nodes.push(node);
    return node;
  };
  for (const line of lines.slice(0, 40)) {
    const h = line.match(/^#{1,3}\s+(.+)$/);
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    const label = h ? h[1].trim() : bullet ? bullet[1].trim() : null;
    if (!label || label.length > 60) continue;
    const node = add(label);
    if (node) edges.push({ from: 'root', to: node.id });
  }
  return { topic, nodes: nodes.slice(0, maxNodes + 1), edges: edges.slice(0, maxNodes + 6) };
}

/* ---------------- 7) Tags / auto-tagging (pure) ---------------- */

export function autoTags(text) {
  const t = String(text || '').toLowerCase();
  const tags = [];
  const map = { exam: 'study', test: 'study', revision: 'study', workout: 'fitness', gym: 'fitness',
                recipe: 'food', lunch: 'food', medicine: 'health', doctor: 'health', trip: 'travel',
                flight: 'travel', project: 'work', meeting: 'work', idea: 'ideas', birthday: 'personal' };
  for (const [k, v] of Object.entries(map)) if (t.includes(k)) tags.push(v);
  return [...new Set(tags)].slice(0, 5);
}

/* ---------------- 8) Stats ---------------- */

export function noteStats() {
  const list = getList(NOTES);
  const byKind = {};
  list.forEach(n => { byKind[n.kind || 'text'] = (byKind[n.kind || 'text'] || 0) + 1; });
  return { total: list.length, pinned: list.filter(n => n.pinned).length, folders: folders().length, byKind };
}
