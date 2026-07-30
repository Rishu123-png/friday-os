/* ===== FRIDAY OS — Offline Coding Engine =====
   Runs a real code model on the phone via llama.cpp (GGUF), fully offline.

   Honest scope:
     - 1.5B Q4  ~1.0 GB  ->  71% HumanEval Python. Great for functions,
                             scripts, regex, SQL, bug fixes, explanations.
     - 3B Q4    ~1.9 GB  ->  83% HumanEval Python. Noticeably better.
     - Neither will architect a whole app. Use Groq for that.

   Everything degrades gracefully: no plugin -> templates, no crash. */

import { getSetting, setSetting, cacheGet, cacheSet } from './store.js';

const CAP = () => (typeof window !== 'undefined' ? window.Capacitor : null);
const isNative = () => {
  const c = CAP();
  return !!(c && c.isNativePlatform && c.isNativePlatform());
};
const LP = () => {
  const c = CAP();
  if (!c || !c.Plugins) return null;
  return c.Plugins.LlamaCpp || c.Plugins.Llama || null;
};
export const engineAvailable = () => isNative() && !!LP();

/* ================= MODEL REGISTRY ================= */
/* All Q4_K_M GGUF — the quality/size sweet spot. */
export const MODELS = [
  {
    id: 'qwen-coder-0.5b',
    name: 'Qwen2.5-Coder 0.5B',
    sizeMB: 400,
    minRamGB: 3,
    humanEval: 62,
    blurb: 'Tiny. Snippets and completions only.',
    url: 'https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf'
  },
  {
    id: 'qwen-coder-1.5b',
    name: 'Qwen2.5-Coder 1.5B',
    sizeMB: 1050,
    minRamGB: 4,
    humanEval: 71,
    blurb: 'Recommended. Real functions, debugging, SQL, regex.',
    recommended: true,
    url: 'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf'
  },
  {
    id: 'qwen-coder-3b',
    name: 'Qwen2.5-Coder 3B',
    sizeMB: 1930,
    minRamGB: 8,
    humanEval: 83,
    blurb: 'Best offline quality. Needs an 8 GB phone.',
    url: 'https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf'
  },
  {
    id: 'qwen-1.5b-general',
    name: 'Qwen2.5 1.5B (general)',
    sizeMB: 1000,
    minRamGB: 4,
    humanEval: 0,
    blurb: 'Conversation instead of code. Offline chat.',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf'
  }
];

export const modelById = id => MODELS.find(m => m.id === id) || null;

/* ================= DEVICE BUDGET ================= */
/* Runtime RAM ~= file size x 1.5 (KV cache + activations).
   Hard budget: 60% of device RAM. */
export async function deviceProfile() {
  let ramGB = 4;
  try {
    const c = CAP();
    const Dev = c && c.Plugins && c.Plugins.Device;
    if (Dev && Dev.getInfo) {
      const info = await Dev.getInfo();
      if (info.memUsed && info.diskTotal) { /* no total ram field */ }
    }
    if (navigator.deviceMemory) ramGB = navigator.deviceMemory;
  } catch (_) {}

  const budgetMB = ramGB * 1024 * 0.6;
  return {
    ramGB,
    budgetMB,
    fits: m => (m.sizeMB * 1.5) <= budgetMB,
    recommend: () => {
      const ok = MODELS.filter(m => m.humanEval > 0 && (m.sizeMB * 1.5) <= budgetMB);
      if (!ok.length) return MODELS[0];
      return ok.sort((a, b) => b.humanEval - a.humanEval)[0];
    }
  };
}

/* ================= MODEL FILE MANAGEMENT ================= */
const FS = () => {
  const c = CAP();
  return c && c.Plugins ? c.Plugins.Filesystem : null;
};

export function installedModelId() { return getSetting('localModel') || null; }
export function modelPath(id) { return `models/${id}.gguf`; }

export async function isInstalled(id) {
  const fs = FS();
  if (!fs) return false;
  try {
    await fs.stat({ path: modelPath(id), directory: 'DATA' });
    return true;
  } catch (_) { return false; }
}

/**
 * Download a model with progress.
 * @param {string} id
 * @param {function} onProgress  (percent, mbDone, mbTotal)
 */
export async function downloadModel(id, onProgress) {
  const m = modelById(id);
  if (!m) throw new Error('Unknown model');
  const fs = FS();
  if (!fs) throw new Error('Filesystem plugin unavailable');

  // Capacitor Filesystem can stream a download directly to disk
  if (fs.downloadFile) {
    const c = CAP();
    let sub = null;
    if (c.Plugins.Filesystem.addListener && onProgress) {
      sub = await c.Plugins.Filesystem.addListener('progress', ev => {
        const pct = ev.contentLength ? Math.round(ev.bytes / ev.contentLength * 100) : 0;
        onProgress(pct, ev.bytes / 1048576, (ev.contentLength || 0) / 1048576);
      });
    }
    try {
      await fs.mkdir({ path: 'models', directory: 'DATA', recursive: true }).catch(() => {});
      await fs.downloadFile({
        url: m.url,
        path: modelPath(id),
        directory: 'DATA',
        progress: true
      });
    } finally { if (sub && sub.remove) sub.remove(); }
    setSetting('localModel', id);
    return true;
  }

  throw new Error('Streaming download not supported on this build');
}

export async function deleteModel(id) {
  const fs = FS();
  if (!fs) return false;
  try {
    await fs.deleteFile({ path: modelPath(id), directory: 'DATA' });
    if (installedModelId() === id) setSetting('localModel', '');
    return true;
  } catch (_) { return false; }
}

/* ================= INFERENCE ================= */
let loaded = null;      // currently loaded model id
let busy = false;

export function isBusy() { return busy; }
export function loadedModel() { return loaded; }

export async function loadModel(id) {
  const p = LP();
  if (!p) throw new Error('Engine unavailable');
  if (loaded === id) return true;

  const fs = FS();
  const uri = await fs.getUri({ path: modelPath(id), directory: 'DATA' });

  await p.loadModel({
    filePath: uri.uri,
    nCtx: 4096,
    nThreads: 4,
    nGpuLayers: 0            // CPU on Android is the reliable path
  });
  loaded = id;
  return true;
}

export async function unloadModel() {
  const p = LP();
  if (!p || !loaded) return;
  try { await p.unloadModel(); } catch (_) {}
  loaded = null;
}

const SYSTEM = `You are an expert programmer. Write complete, working, runnable code.
Rules:
- Output the code in a fenced block with the language tag.
- No placeholders, no TODOs, no "rest of the code here".
- Add a one-line comment above anything non-obvious.
- If the request is ambiguous, pick the most common interpretation and proceed.
- Keep explanation to two sentences maximum, after the code.`;

/**
 * Generate code offline.
 * @param {string} prompt
 * @param {object} opts  { onToken, maxTokens, temperature, signal }
 */
export async function generate(prompt, opts = {}) {
  const p = LP();
  if (!p) throw new Error('NO_ENGINE');

  const id = installedModelId();
  if (!id) throw new Error('NO_MODEL');
  if (busy) throw new Error('BUSY');

  busy = true;
  let sub = null;
  let full = '';

  try {
    await loadModel(id);

    if (opts.onToken && p.addListener) {
      sub = await p.addListener('token', ev => {
        const t = ev && (ev.text || ev.token) || '';
        if (!t) return;
        full += t;
        opts.onToken(t, full);
      });
    }

    const res = await p.generate({
      prompt: `<|im_start|>system\n${SYSTEM}<|im_end|>\n` +
              `<|im_start|>user\n${prompt}<|im_end|>\n` +
              `<|im_start|>assistant\n`,
      stream: !!opts.onToken,
      temperature: opts.temperature ?? 0.2,
      top_p: 0.95,
      top_k: 40,
      repeat_penalty: 1.1,
      n_predict: opts.maxTokens || 1024,
      stop: ['<|im_end|>', '<|im_start|>']
    });

    const out = (res && (res.text || res.content)) || full;
    return String(out).replace(/<\|im_end\|>/g, '').trim();
  } finally {
    busy = false;
    if (sub && sub.remove) sub.remove();
  }
}

export async function stop() {
  const p = LP();
  try { if (p && p.abort) await p.abort(); } catch (_) {}
  busy = false;
}

/* ================= STATUS ================= */
export async function status() {
  const prof = await deviceProfile();
  const id = installedModelId();
  const m = id ? modelById(id) : null;
  return {
    engine: engineAvailable(),
    native: isNative(),
    ramGB: prof.ramGB,
    budgetMB: Math.round(prof.budgetMB),
    installed: id && (await isInstalled(id)) ? m : null,
    recommended: prof.recommend(),
    loaded
  };
}
