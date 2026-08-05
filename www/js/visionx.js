/* ============================================================================
   FRIDAY OS — VISIONX: AI Vision System helpers (v11.3.0 / Phase 6)
   EXTENDS vision.js (OCR/objects/lookAround untouched) and the camera flow.
   Adds: doc classification · OCR post-process · homework mode brain · QR
   history · vision memory (deposited into memex — searchable by Memory
   Engine) · image→PDF builder (pure, offline) · contrast normalize (pure).
   Privacy: frames never upload by default; temp frames dropped immediately.
   ============================================================================ */

import { getList, saveList } from './store.js';
import { SKEYS } from './memex.js';

/* ---------------- 1) OCR post-processing (pure) ---------------- */

/** Tesseract noise → clean text. Whitespace sane, junk lines out. */
export function cleanOcr(text) {
  return String(text || '')
    .replace(/[|]/g, 'I')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .split('\n')
    .map(l => l.replace(/[^\p{L}\p{N}\p{P}\p{Zs}₹$€£°=+%×÷−-]/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 1 || /\d/.test(l))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------- 2) Document classification (pure) ---------------- */

export function classifyDoc(text) {
  const t = String(text || '').toLowerCase();
  const rupee = (t.match(/₹|rs\.?|inr/g) || []).length;
  const nums = (t.match(/\d/g) || []).length;
  if (/roll no|admit card|aadhaar|aadhar|pan card|driving licen[cs]e|voter id|employee id\b/.test(t)) return 'id';
  if (/invoice|receipt|bill no|total amount|amount due|gst\b|tax invoice|cash memo/.test(t) || (rupee >= 2 && nums > 8)) return 'receipt';
  if (/proceedings|abstract|chapter|fig\.|et al\.|references|isbn/.test(t)) return 'book';
  if (/(solve|prove that|find the value|equation|integral|derivative|theorem|triangle|\^\d|= ?\?|√)/.test(t)) return 'math';
  if (/question paper|marks|time: \d|answer all|section [a-c]\b/.test(t)) return 'exam';
  return 'note';
}

/** Equation-looking lines → "solve karne layak" flag (homework mode trigger). */
export function mathLines(text) {
  return String(text || '').split('\n')
    .filter(l => /\d/.test(l) && /[=+×x*\/÷^-]/.test(l) && l.length < 60)
    .slice(0, 6);
}

/* ---------------- 3) Homework mode (pure prompt builder) ---------------- */

export function homeworkPrompt(ocrText) {
  const kind = classifyDoc(ocrText);
  const eqs = mathLines(ocrText);
  const q = String(ocrText || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  if (kind === 'math' || eqs.length) {
    return 'Ye homework hai. Step-by-step solve karo, simple words me, student-friendly (Hinglish ok). Har step batao, final answer box karo:\n' + (eqs.length ? eqs.join('\n') : q);
  }
  if (kind === 'exam') return 'Ye exam paper hai. Har question ka short model answer do, marking-style points me:\n' + q;
  return 'Ye document padh ke explain karo — 5 bullet me, aasaan bhasha me. Important terms bold karo:\n' + q;
}

/* ---------------- 4) QR history + vision memory (runtime) ---------------- */

export function qrType(value) {
  const v = String(value || '');
  if (/^https?:\/\//i.test(v)) return 'link';
  if (/^WIFI:/i.test(v)) return 'wifi';
  if (/^upi:/i.test(v)) return 'upi';
  if (/^(mailto:|BEGIN:VCARD)/i.test(v)) return 'contact';
  if (/^(tel:|sms:)/i.test(v)) return 'phone';
  if (/^geo:/i.test(v)) return 'location';
  return 'text';
}

export function qrLog(value) {
  const h = getList(SKEYS.QR);
  if (h[0] && h[0].value === value && Date.now() - h[0].ts < 60000) return h[0];   // same code twice = same event
  const rec = { id: 'qr-' + Date.now(), value: String(value).slice(0, 500), type: qrType(value), ts: Date.now() };
  saveList(SKEYS.QR, [rec, ...h].slice(0, 40));
  return rec;
}
export function qrHistory() { return getList(SKEYS.QR); }

/** Deposit any scan into the shared memory pool (memex searches it). */
export function remember({ kind, text, ref = '' }) {
  const list = getList(SKEYS.VISION);
  const dup = list.find(v => v.text === text && v.kind === kind);
  if (dup) return dup;                                   // no duplicate memories (spec)
  const rec = {
    id: 'vis-' + Date.now() + Math.random().toString(36).slice(2, 5),
    kind,                       // ocr | qr | scene | doc | homework
    text: String(text).slice(0, 1200),
    ref, ts: Date.now(), category: 'vision', importance: 50
  };
  if (qrType(text) !== 'text' || text.length > 80) rec.importance = 60;
  saveList(SKEYS.VISION, [rec, ...list].slice(0, 60));
  return rec;
}
export function visionMemory() { return getList(SKEYS.VISION); }

/* ---------------- 5) Image → PDF (pure, offline, no libs) ---------------- */

const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * Build a minimal VALID PDF holding one RGB image. Pure — runs on K13x
 * without a single network call. (pure bytes out)
 * @param {{data:Uint8Array,width:number,height:number}} img RGB raw pixels
 */
export function buildPdf(img, title = 'FRIDAY scan') {
  const { data, width, height } = img;
  const A4W = 595, A4H = 842, pad = 28;
  const scale = Math.min((A4W - 2 * pad) / width, (A4H - 2 * pad) / height, 1.6);
  const w = Math.round(width * scale), h = Math.round(height * scale);
  const x = Math.round((A4W - w) / 2), y = Math.round((A4H - h) / 2);
  const raw = [];   // byte chunks
  const pushStr = s => { for (let i = 0; i < s.length; i++) raw.push(s.charCodeAt(i) & 0xff); };
  let imgId = 4;
  pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const offs = [0];
  const obj = (n, body) => { offs[n] = raw.length; pushStr(`${n} 0 obj\n${body}\nendobj\n`); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4W} ${A4H}] /Resources << /XObject << /Im1 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>`);
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`);
  for (let i = 0; i < data.length; i++) raw.push(data[i]);
  pushStr('\nendstream\nendobj\n');
  const stream = `q ${w} 0 0 ${h} ${x} ${y} cm /Im1 Do Q\nBT /F1 9 Tf 28 806 Td (${esc(title)}) Tj ET`;
  obj(5, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  obj(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const xref = raw.length, count = 7;
  pushStr(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) pushStr(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
  pushStr(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Uint8Array(raw);
}

/* ---------------- 6) Pixel contrast normalize (pure, doc-scan look) ---------------- */

/** Histogram stretch on grayscale bytes → whiteboard/receipt readable. (pure) */
export function normalizeGray(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let lo = 0, hi = 255;
  const cut = Math.floor(gray.length * 0.02);
  let acc = 0;
  while (lo < 255) { acc += hist[lo]; if (acc >= cut) break; lo++; }
  acc = 0;
  while (hi > 0) { acc += hist[hi]; if (acc >= cut) break; hi--; }
  if (hi <= lo) { lo = 0; hi = 255; }
  const out = new Uint8Array(gray.length);
  const k = 255 / (hi - lo || 1);
  for (let i = 0; i < gray.length; i++) out[i] = Math.max(0, Math.min(255, Math.round((gray[i] - lo) * k)));
  return out;
}

/* ---------------- 7) Caption for dashboards (pure) ---------------- */

export function visionCaption(mem) {
  if (!mem) return '';
  const t = qrType(mem.text);
  return mem.kind.toUpperCase() + (mem.kind === 'qr' ? ':' + t : '') + ' · ' + String(mem.text).slice(0, 42);
}
