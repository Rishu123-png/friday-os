/* ===== FRIDAY OS — Vision =====
   Real, keyless, on-device image intelligence.
   Libraries are lazy-loaded from CDN on first use, then cached by the
   service worker, so this costs 0 KB until the user actually taps it. */

const CDN = {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  tf: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  coco: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js'
};

const loaded = new Set();

function loadScript(src) {
  if (loaded.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => { loaded.add(src); resolve(); };
    s.onerror = () => reject(new Error('Failed to load ' + src.split('/').pop()));
    document.head.appendChild(s);
  });
}

/* ---------- OCR — Tesseract.js ---------- */
let ocrWorker = null;

export async function ocr(imageData, onProgress) {
  await loadScript(CDN.tesseract);
  if (!ocrWorker) {
    onProgress && onProgress('Loading text engine…');
    ocrWorker = await window.Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(`Reading… ${Math.round(m.progress * 100)}%`);
        }
      }
    });
  }
  onProgress && onProgress('Reading text…');
  const { data } = await ocrWorker.recognize(imageData);
  const text = (data.text || '').trim();
  return {
    text,
    confidence: Math.round(data.confidence || 0),
    lines: text.split('\n').filter(l => l.trim())
  };
}

export async function disposeOCR() {
  try { if (ocrWorker) await ocrWorker.terminate(); } catch (_) {}
  ocrWorker = null;
}

/* ---------- Object detection — TensorFlow.js COCO-SSD ---------- */
let cocoModel = null;

export async function detectObjects(imgEl, onProgress) {
  onProgress && onProgress('Loading vision model…');
  await loadScript(CDN.tf);
  await loadScript(CDN.coco);
  if (!cocoModel) {
    cocoModel = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
  }
  onProgress && onProgress('Analyzing…');
  const preds = await cocoModel.detect(imgEl);
  return preds
    .filter(p => p.score > 0.45)
    .map(p => ({ label: p.class, score: Math.round(p.score * 100), bbox: p.bbox }));
}

/** Turn raw detections into a spoken sentence */
export function describeScene(objects) {
  if (!objects.length) return "I can't identify anything clearly in that shot.";
  const counts = {};
  objects.forEach(o => { counts[o.label] = (counts[o.label] || 0) + 1; });
  const parts = Object.entries(counts).map(([label, n]) =>
    n === 1 ? `a ${label}` : `${n} ${label}s`);
  const list = parts.length === 1 ? parts[0]
    : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  return `I can see ${list}.`;
}

/* ---------- Helper: dataURL -> <img> ---------- */
export function toImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}
