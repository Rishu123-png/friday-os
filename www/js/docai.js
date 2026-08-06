/* ============================================================================
   FRIDAY OS — DOCAI: AI Document Assistant (v15 Phase 4 / Smart Productivity 2)
   PDF/text reading, summarization, Q&A, table extraction, and specialized
   analysis (resume / contract / research paper) — pure helpers testable offline;
   AI paths hook the router. Files are read in app.js (FileReader) and handed
   here as plain text.
   ========================================================================== */

import { getList, saveList } from './store.js';

/* ---------------- 1) Text extraction (pure, from raw file content) ---------------- */

/** Very light PDF→text for simple PDFs (plain text streams). For real PDFs
    app.js uses pdfjs lazy-load; this handles the extracted-text case. */
export function pdfTextFrom(raw) {
  const s = String(raw || '');
  // crude: if it's already mostly text (no binary markers), pass through
  if (s.includes('%PDF')) return '';
  return s;
}

/** Clean a document blob into normalized text lines. */
export function cleanDoc(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------------- 2) Summaries ---------------- */

export function localDocSummary(text, { maxSentences = 5 } = {}) {
  const t = cleanDoc(text);
  if (!t) return '';
  const sents = t.split(/(?<=[.!?])\s+/).filter(s => s.length > 2);
  if (sents.length <= maxSentences) return t.slice(0, 1200);
  const words = t.toLowerCase().split(/\W+/).filter(w => w.length > 4);
  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]);
  const scored = sents.map((s, i) => ({ s, i, w: top.filter(q => s.toLowerCase().includes(q)).length + (i === 0 ? 2 : 0) }));
  scored.sort((a, b) => b.w - a.w);
  return scored.slice(0, maxSentences).sort((a, b) => a.i - b.i).map(x => x.s).join(' ');
}

/* ---------------- 3) Table extraction (pure) ---------------- */

/** Extract markdown/pipe tables from text. */
export function extractTables(text) {
  const t = String(text || '');
  const rows = t.split('\n');
  const tables = [];
  let cur = [];
  const flush = () => { if (cur.length >= 2) tables.push(cur.slice()); cur = []; };
  for (const line of rows) {
    const isTable = /^\s*\|/.test(line) && line.includes('|') && line.trim().length > 3;
    if (isTable) cur.push(line.trim().replace(/^\||\|$/g, ''));
    else flush();
  }
  flush();
  return tables
    .map(tbl => {
      const cells = tbl.filter(r => !/^\s*:?-+:?\s*(\|\s*:?-+:?\s*)*$/.test(r));  // drop separator
      return cells.map(r => r.split('|').map(c => c.trim()));
    })
    .filter(tbl => tbl.length >= 2);
}

/* ---------------- 4) Resume analysis (pure heuristics) ---------------- */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d[\d\s\-()]{7,15}\d)/;

export function analyzeResume(text) {
  const t = String(text || '');
  const email = t.match(EMAIL_RE);
  const phone = t.match(PHONE_RE);
  const skills = [];
  const SKILLS = ['python','javascript','java','c++','sql','react','node','flutter','android','machine learning','ai','aws','docker','git','excel','powerpoint','communication','leadership','teamwork','data analysis','product','marketing','sales','finance','design','figma'];
  for (const s of SKILLS) if (new RegExp('\\b' + s.replace(/[.+]/g, '\\$&') + '\\b', 'i').test(t)) skills.push(s);
  const lines = t.split('\n');
  const name = lines.find(l => { const c = l.trim(); return c && c.length > 2 && c.length < 40 && !c.includes('@') && !/\d{4}/.test(c); });
  const workCount = (t.match(/\b(experience|worked at|company|role|internship)\b/gi) || []).length;
  return {
    name: name ? name.trim().slice(0, 40) : null,
    email: email ? email[0] : null,
    phone: phone ? phone[0].replace(/\s+/g, '') : null,
    skills: [...new Set(skills)].slice(0, 12),
    experienceMentions: workCount,
    hasEducation: /\b(education|b\.?tech|m\.?tech|bachelor|master|degree|school|university|college)\b/i.test(t),
    verdict: skills.length >= 6 && workCount >= 2 ? 'strong' : skills.length >= 3 ? 'ok' : 'needs work'
  };
}

/* ---------------- 5) Contract analysis (pure heuristics) ---------------- */

export function analyzeContract(text) {
  const t = String(text || '');
  const money = [...new Set((t.match(/(?:Rs\.?|₹|INR|USD|\$)\s?\d[\d,]*\.?\d{0,2}/g) || []))].slice(0, 8);
  const dates = [...new Set((t.match(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b/gi) || []))].slice(0, 8);
  const parties = [...new Set((t.match(/\b(?:between|by and between|party|parties)\s+([A-Z][^,;\n]{2,60})/gi) || []))].slice(0, 6);
  const risk = [];
  if (/\b(indemnif|confidential|non-compete|penalty|termination)\b/i.test(t)) risk.push('has legal clauses (indemnity/confidentiality/termination)');
  if (/\b(no refund|cannot cancel|non-refundable)\b/i.test(t)) risk.push('unfavorable: no-refund / no-cancel');
  if (/\b(auto.?renew)\b/i.test(t)) risk.push('auto-renewal clause');
  return { money, dates, parties, risk: risk.slice(0, 4), length: t.length };
}

/* ---------------- 6) Research paper summary (pure) ---------------- */

export function researchSummary(text) {
  const t = String(text || '');
  const abstract = t.match(/\babstract\b[:\s]*([\s\S]{0,600})/i);
  const intro = t.match(/\bintroduction\b[:\s]*([\s\S]{0,400})/i);
  const concl = t.match(/\bconclusion\b[:\s]*([\s\S]{0,400})/i);
  return {
    abstract: abstract ? abstract[1].slice(0, 500) : '',
    intro: intro ? intro[1].slice(0, 350) : '',
    conclusion: concl ? concl[1].slice(0, 350) : '',
    citations: (t.match(/\b(et al\.|\(19|\(20|doi[: ]|arxiv)/gi) || []).length,
    methodMentioned: /\b(methodology|dataset|experiment|results|findings)\b/i.test(t)
  };
}

/* ---------------- 7) Q&A over a document (local keyword fallback) ---------------- */

export function answerFromDoc(text, question) {
  const q = String(question || '').toLowerCase();
  const sents = String(text || '').split(/(?<=[.!?])\s+/).filter(s => s.length > 4);
  const qwords = q.split(/\W+/).filter(w => w.length > 3);
  let best = null, bestScore = 0;
  for (const s of sents) {
    const sl = s.toLowerCase();
    const score = qwords.filter(w => sl.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore >= 1 ? best : null;
}

/* ---------------- 8) Stored docs (knowledge base support) ---------------- */

const DOCS = 'friday_docs';
export function docs() { return getList(DOCS); }
export function addDoc({ name, kind = 'text', text, summary = '' }) {
  const t = String(text || '').slice(0, 50000);
  if (!t.trim()) return null;
  const list = getList(DOCS);
  const dup = list.find(d => d.name === name && d.kind === kind);
  if (dup) return dup;
  const rec = { id: 'doc-' + Date.now() + Math.random().toString(36).slice(2, 5), name: String(name).slice(0, 120), kind, text: t, summary: summary || localDocSummary(t), created: Date.now() };
  saveList(DOCS, [rec, ...list].slice(0, 100));
  return rec;
}
export function deleteDoc(id) { saveList(DOCS, getList(DOCS).filter(d => d.id !== id)); }
export function docStats() { const l = getList(DOCS); return { total: l.length, kinds: l.reduce((a, d) => { a[d.kind] = (a[d.kind] || 0) + 1; return a; }, {}), bytes: l.reduce((a, d) => a + d.text.length, 0) }; }
