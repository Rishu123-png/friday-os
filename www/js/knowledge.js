/* ============================================================================
   FRIDAY OS — KNOWLEDGE: Personal Knowledge Base (v15 Phase 4 / Productivity 3)
   Unified search + related-content + auto-categorization across the user's
   private corpus: notes, documents, and AI chats. Reads the EXISTING stores
   (friday_notes, friday_docs, friday_chat) — no duplicate storage.
   ========================================================================== */

import { KEYS, getList } from './store.js';
import { semanticSearch } from './nlu.js';
import { topicsOf, categorize } from './memex.js';   // reuse topic extractor + categorizer

/* ---------------- 1) Unified corpus ---------------- */

export function corpus() {
  const out = [];
  for (const n of getList(KEYS.NOTES)) out.push({ src: 'note', id: n.id, text: n.text || '', meta: n });
  const docs = getList('friday_docs');
  for (const d of docs) out.push({ src: 'doc', id: d.id, text: (d.summary || '') + ' ' + (d.name || ''), meta: d });
  for (const m of getList(KEYS.CHAT)) out.push({ src: 'chat', id: m.id, text: m.text || '', meta: m });
  return out;
}

/* ---------------- 2) Unified semantic search ---------------- */

export function searchAll(q, limit = 10) {
  const docs = corpus();
  if (!docs.length) return [];
  const hits = semanticSearch(String(q || ''), docs, limit * 2);
  return hits.slice(0, limit).map(h => ({ ...h, type: h.src }));
}

/* ---------------- 3) Related content ---------------- */

/** Items related to a piece of text by topic overlap. */
export function relatedContent(text, limit = 5) {
  const topics = topicsOf([String(text || '')], 6);
  if (!topics.length) return [];
  const docs = corpus().filter(d => d.src !== 'note' || true);
  const scored = docs
    .map(d => {
      const t = topics.filter(tp => d.text.toLowerCase().includes(tp)).length;
      return { d, score: t };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(x => ({ ...x.d, score: x.score }));
}

/* ---------------- 4) Automatic categorization ---------------- */

export function categorizeItem(text) { return categorize(String(text || '')); }

export function categoryCounts() {
  const counts = {};
  for (const n of getList(KEYS.NOTES)) { const c = categorize(n.text || ''); counts[c] = (counts[c] || 0) + 1; }
  return counts;
}

/* ---------------- 5) Knowledge stats ---------------- */

export function kbStats() {
  const notes = getList(KEYS.NOTES);
  const docs = getList('friday_docs');
  const chats = getList(KEYS.CHAT);
  let bytes = 0;
  for (const a of [notes, docs, chats]) for (const it of a) bytes += String(it.text || '').length * 2;
  return {
    notes: notes.length, docs: docs.length, chats: chats.length,
    total: notes.length + docs.length + chats.length,
    bytes, bytesHuman: bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : (bytes / 1024).toFixed(1) + ' KB',
    categories: categoryCounts()
  };
}
