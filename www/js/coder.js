/* ===== FRIDAY OS — Local AI Engine v2 (offline LLM) =====
   Runs real GGUF models fully on-device through the native LlamaCpp
   plugin (llama.cpp). No API key. No rate limits. No provider policies.
   Works in airplane mode, forever.

   Two brain types, one engine:
     • CODE brains  — Qwen2.5-Coder family (best open code models at phone size)
     • CHAT brains  — Llama 3.2 / Gemma 2 — full offline conversation

   Quality knobs that make the output better:
     • Per-model chat templates (ChatML / Llama3 / Gemma) — wrong template
       is the #1 cause of garbage output, so this is handled exactly
     • Task-tuned sampling (low temp for code, higher for chat)
     • FIM (fill-in-the-middle) completion for Qwen Coder models
     • Stop-token control so the model never rambles past its answer

   Honest capability guide (approx., Q4_K_M):
     0.5–1.5B : single functions, regex, SQL, shell one-liners, bug fixes
     3B       : multi-function programs, refactors, decent explanations
     7B       : near-cloud quality on 12 GB+ phones
   Everything degrades gracefully: no engine → caller falls back to
   templates/Groq. Nothing here can crash the app. */

import { getSetting, setSetting } from './store.js';

const CAP = () => (typeof window !== 'undefined' ? window.Capacitor : null);
const isNative = () => {
  const c = CAP();
  return !!(c && c.isNativePlatform && c.isNativePlatform());
};
const LP = () => {
  const c = CAP();
  if (!c || !c.Plugins) return null;
  return c.Plugins.LlamaCpp || null;
};
export const engineAvailable = () => isNative() && !!LP();
const FS = () => {
  const c = CAP();
  return c && c.Plugins ? c.Plugins.Filesystem : null;
};

/* ================= MODEL REGISTRY ================= */
/* kind: 'code' | 'chat'   template: 'chatml' | 'llama3' | 'gemma'      */
export const MODELS = [
  {
    id: 'qwen-coder-0.5b', kind: 'code', template: 'chatml',
    name: 'Qwen2.5-Coder 0.5B',
    sizeMB: 400, minRamGB: 3, humanEval: 62,
    blurb: 'Tiny. Snippets and completions only.',
    url: 'https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf'
  },
  {
    id: 'qwen-coder-1.5b', kind: 'code', template: 'chatml',
    name: 'Qwen2.5-Coder 1.5B',
    sizeMB: 1050, minRamGB: 4, humanEval: 71,
    blurb: 'Recommended starter. Functions, debugging, SQL, regex.',
    recommended: true,
    url: 'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf'
  },
  {
    id: 'qwen-coder-3b', kind: 'code', template: 'chatml',
    name: 'Qwen2.5-Coder 3B',
    sizeMB: 1930, minRamGB: 8, humanEval: 83,
    blurb: 'Best code quality that runs well on 8 GB phones.',
    url: 'https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf'
  },
  {
    id: 'qwen-coder-7b', kind: 'code', template: 'chatml',
    name: 'Qwen2.5-Coder 7B',
    sizeMB: 4680, minRamGB: 12, humanEval: 88,
    blurb: 'Near-cloud quality. Flagship phones only.',
    url: 'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf'
  },
  {
    id: 'llama-3.2-1b', kind: 'chat', template: 'llama3',
    name: 'Llama 3.2 1B (chat)',
    sizeMB: 770, minRamGB: 3, humanEval: 0,
    blurb: 'Fast offline conversation. Runs on almost anything.',
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf'
  },
  {
    id: 'llama-3.2-3b', kind: 'chat', template: 'llama3',
    name: 'Llama 3.2 3B (chat)',
    sizeMB: 2020, minRamGB: 6, humanEval: 0,
    blurb: 'Best fully-offline conversational brain.',
    recommended: true,
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf'
  },
  {
    id: 'gemma-2-2b', kind: 'chat', template: 'gemma',
    name: 'Gemma 2 2B (chat)',
    sizeMB: 1600, minRamGB: 6, humanEval: 0,
    blurb: 'Google model. Polished writing style.',
    url: 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf'
  }
];

export const modelById = id => MODELS.find(m => m.id === id) || null;

/* ================= PROMPT TEMPLATES ================= */
const TEMPLATES = {
  chatml: (system, turns) =>
    `<|im_start|>system\n${system}<|im_end|>\n` +
    turns.map(t => `<|im_start|>${t.role}\n${t.content}<|im_end|>\n`).join('') +
    `<|im_start|>assistant\n`,
  llama3: (system, turns) =>
    `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${system}<|eot_id|>` +
    turns.map(t => `<|start_header_id|>${t.role}<|end_header_id|>\n\n${t.content}<|eot_id|>`).join('') +
    `<|start_header_id|>assistant<|end_header_id|>\n\n`,
  gemma: (system, turns) => {
    // Gemma has no system role — fold it into the first user turn
    const folded = turns.map((t, i) =>
      t.role === 'user' && i === 0 ? { role: 'user', content: system + '\n\n' + t.content } : t);
    return folded.map(t =>
      `<start_of_turn>${t.role === 'assistant' ? 'model' : 'user'}\n${t.content}<end_of_turn>\n`).join('') +
      `<start_of_turn>model\n`;
  }
};

const STOPS = {
  chatml: ['<|im_end|>', '<|im_start|>'],
  llama3: ['<|eot_id|>', '<|end_of_text|>'],
  gemma: ['<end_of_turn>', '<start_of_turn>']
};

/* ================= SYSTEM PROMPTS ================= */
export const SYSTEMS = {
  code: `You are FRIDAY's offline coding engine: a senior software engineer with 15 years of experience across Python, JavaScript, Java, Kotlin, C, SQL, HTML/CSS and shell.
Rules you always follow:
- Output complete, working, runnable code. Never placeholders, never TODOs, never "rest of code here".
- Pick the most common interpretation of ambiguous requests and state any assumption in ONE short comment.
- Use modern best practices and note exact dependency/setup steps in one or two lines after the code.
- Wrap code in a fenced block with the language tag. Explanations: maximum two sentences.
- If the user asks for something dangerous, still help them reach their legitimate goal in a safe way.`,
  fix: `You are a debugging engine. Given broken code (and possibly an error message), return the FULL corrected code — not a diff, not a description. One fenced block, then two sentences max on what was wrong.`,
  explain: `You are a senior engineer explaining code. Be concrete: what it does overall, how it works step by step, complexity, and any bugs or edge cases you notice. Plain language, short paragraphs.`,
  chat: `You are FRIDAY, a personal AI assistant running entirely on the user's phone with no internet. You are warm, direct and concise — replies are often read aloud, so keep them short unless detail is asked for. You are honest about uncertainty. You never claim to have done something you cannot do offline.`
};

/* ================= TASK SAMPLING PRESETS ================= */
const TASKS = {
  code:     { temp: 0.2, topP: 0.90, topK: 40, repPen: 1.05, maxTok: 2048, sys: 'code' },
  fix:      { temp: 0.1, topP: 0.90, topK: 40, repPen: 1.05, maxTok: 2048, sys: 'fix' },
  explain:  { temp: 0.35, topP: 0.95, topK: 40, repPen: 1.10, maxTok: 1024, sys: 'explain' },
  chat:     { temp: 0.7, topP: 0.95, topK: 64, repPen: 1.15, maxTok: 900, sys: 'chat' },
  complete: { temp: 0.15, topP: 0.90, topK: 40, repPen: 1.00, maxTok: 512, sys: null }
};

/* ================= DEVICE BUDGET ================= */
/* Runtime RAM ≈ file size × 1.5 (KV cache + activations).
   Hard budget: 60% of device RAM. */
export async function deviceProfile() {
  let ramGB = 4;
  try { if (navigator.deviceMemory) ramGB = navigator.deviceMemory; } catch (_) {}
  const budgetMB = ramGB * 1024 * 0.6;
  const fits = m => (m.sizeMB * 1.5) <= budgetMB;
  return {
    ramGB,
    budgetMB,
    fits,
    recommend(kind = 'code') {
      const pool = MODELS.filter(m => m.kind === kind && fits(m));
      if (!pool.length) return MODELS.find(m => m.kind === kind) || MODELS[0];
      return pool.sort((a, b) => (b.humanEval - a.humanEval) || (b.sizeMB - a.sizeMB))[0];
    }
  };
}

/* ================= MODEL FILES ================= */
export function installedModelId() { return getSetting('localModel') || null; }
export function installedModel() { return modelById(installedModelId()); }
export function modelPath(id) { return `models/${id}.gguf`; }

export async function isInstalled(id) {
  const fs = FS();
  if (!fs) return false;
  try { await fs.stat({ path: modelPath(id), directory: 'DATA' }); return true; }
  catch (_) { return false; }
}

/** Download a model with progress: onProgress(percent, mbDone, mbTotal). */
export async function downloadModel(id, onProgress) {
  const m = modelById(id);
  if (!m) throw new Error('Unknown model');
  const fs = FS();
  if (!fs) throw new Error('Filesystem plugin unavailable (APK required)');
  let sub = null;
  try {
    if (fs.addListener && onProgress) {
      sub = await fs.addListener('progress', ev => {
        const pct = ev.contentLength ? Math.round(ev.bytes / ev.contentLength * 100) : 0;
        onProgress(pct, ev.bytes / 1048576, (ev.contentLength || 0) / 1048576);
      });
    }
    await fs.mkdir({ path: 'models', directory: 'DATA', recursive: true }).catch(() => {});
    await fs.downloadFile({ url: m.url, path: modelPath(id), directory: 'DATA', progress: true });
  } finally { if (sub && sub.remove) sub.remove(); }
  setSetting('localModel', id);
  return true;
}

export async function deleteModel(id) {
  const fs = FS();
  if (!fs) return false;
  try {
    await fs.deleteFile({ path: modelPath(id), directory: 'DATA' });
    if (installedModelId() === id) setSetting('localModel', '');
    if (loaded === id) await unloadModel();
    return true;
  } catch (_) { return false; }
}

/* ================= INFERENCE ================= */
let loaded = null;
let busy = false;

export function isBusy() { return busy; }
export function loadedModel() { return loaded; }
/** Sync gate for UI: engine + a chosen model. Disk check happens in status(). */
export function ready() { return engineAvailable() && !!installedModelId(); }

const cpuThreads = () => {
  try {
    const c = (navigator.hardwareConcurrency || 4) - 2;
    return Math.max(2, Math.min(6, c));
  } catch (_) { return 4; }
};

export async function loadModel(id) {
  const p = LP();
  if (!p) throw new Error('ENGINE_MISSING');
  if (loaded === id) return true;
  const fs = FS();
  const uri = await fs.getUri({ path: modelPath(id), directory: 'DATA' });
  await p.loadModel({
    filePath: uri.uri.replace(/^file:\/\//, ''),
    nCtx: 4096,
    nThreads: cpuThreads(),
    nGpuLayers: 0
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

/**
 * THE core call. Generate anything offline.
 * @param {string} prompt   user request (code by default)
 * @param {object} opts     { task:'code'|'fix'|'explain'|'chat',
 *                            onToken(tok, soFar), maxTokens, temperature,
 *                            context (extra system context, e.g. memory brief) }
 */
export async function generate(prompt, opts = {}) {
  const p = LP();
  if (!p) throw new Error('NO_ENGINE');
  const id = installedModelId();
  if (!id) throw new Error('NO_MODEL');
  if (busy) throw new Error('BUSY');

  const task = TASKS[opts.task || 'code'] || TASKS.code;
  const model = installedModel() || { template: 'chatml' };
  const tpl = model.template || 'chatml';

  let system = task.sys ? SYSTEMS[task.sys] : '';
  if (opts.context) system = system ? system + '\n\n' + opts.context : opts.context;

  const turns = (opts.history || []).concat([{ role: 'user', content: prompt }]);
  const fullPrompt = TEMPLATES[tpl](system || SYSTEMS.chat, turns);

  busy = true;
  let sub = null, acc = '';
  try {
    await loadModel(id);
    if (opts.onToken && p.addListener) {
      sub = await p.addListener('token', ev => {
        const t = (ev && (ev.text || ev.token)) || '';
        if (!t) return;
        acc += t;
        opts.onToken(t, acc);
      });
    }
    const res = await p.generate({
      prompt: fullPrompt,
      stream: !!opts.onToken,
      temperature: opts.temperature ?? task.temp,
      topP: task.topP,
      topK: task.topK,
      repeatPenalty: task.repPen,
      nPredict: opts.maxTokens || task.maxTok,
      stop: STOPS[tpl]
    });
    const out = String((res && (res.text || res.content)) || acc);
    return stripArtifacts(out);
  } finally {
    busy = false;
    if (sub && sub.remove) sub.remove();
  }
}

/** Offline conversation — uses the chat task preset + optional memory brief. */
export async function chat(message, opts = {}) {
  return generate(message, { ...opts, task: 'chat' });
}

/** Complete code mid-cursor (Qwen Coder FIM). Non-coder models: normal continuation. */
export async function complete(prefix, suffix = '', opts = {}) {
  const m = installedModel();
  if (m && m.template === 'chatml' && /coder/i.test(m.id)) {
    const fim = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
    return generateRaw(fim, { ...opts, maxTok: opts.maxTokens || 384, stop: ['<|fim_end|>', '<|fim_pad|>', '<|endoftext|>', '<|im_end|>'] });
  }
  return generate(`Complete this code directly (code only, no prose):\n${prefix}`, { ...opts, task: 'code' });
}

/** Low-level: send a pre-built prompt with custom stops (used for FIM). */
async function generateRaw(fullPrompt, opts = {}) {
  const p = LP();
  if (!p) throw new Error('NO_ENGINE');
  const id = installedModelId();
  if (!id) throw new Error('NO_MODEL');
  if (busy) throw new Error('BUSY');
  busy = true;
  let sub = null, acc = '';
  try {
    await loadModel(id);
    if (opts.onToken && p.addListener) {
      sub = await p.addListener('token', ev => {
        const t = (ev && (ev.text || ev.token)) || '';
        if (t) { acc += t; opts.onToken(t, acc); }
      });
    }
    const res = await p.generate({
      prompt: fullPrompt, stream: !!opts.onToken,
      temperature: 0.15, topP: 0.9, topK: 40, repeatPenalty: 1.0,
      nPredict: opts.maxTok || 384, stop: opts.stop || []
    });
    return stripArtifacts(String((res && (res.text || res.content)) || acc));
  } finally {
    busy = false;
    if (sub && sub.remove) sub.remove();
  }
}

/* ---------- Convenience wrappers ---------- */
export function fixCode(code, error = '', opts = {}) {
  const q = error
    ? `This code is broken:\n\`\`\`\n${code}\n\`\`\`\nError:\n${error}\n\nReturn the full corrected code.`
    : `Fix this code:\n\`\`\`\n${code}\n\`\`\``;
  return generate(q, { ...opts, task: 'fix' });
}
export function explainCode(code, opts = {}) {
  return generate(`Explain this code:\n\`\`\`\n${code}\n\`\`\``, { ...opts, task: 'explain' });
}
export function refactorCode(code, goal = '', opts = {}) {
  const q = goal
    ? `Refactor this code for ${goal}:\n\`\`\`\n${code}\n\`\`\``
    : `Refactor this code for clarity and robustness:\n\`\`\`\n${code}\n\`\`\``;
  return generate(q, { ...opts, task: 'fix' });
}

/* ---------- Output helpers ---------- */
/** Strip template tokens that sometimes leak into output. */
function stripArtifacts(text) {
  return text
    .replace(/<\|im_end\|>|<\|im_start\|>|<\|eot_id\|>|<\|end_of_text\|>|<end_of_turn>|<start_of_turn>|<\|fim_[a-z]+\|>|<\|endoftext\|>/g, '')
    .trim();
}

/** Pull fenced code blocks out of a reply: [{lang, code}] */
export function extractCode(text) {
  const blocks = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) blocks.push({ lang: m[1] || 'txt', code: m[2].trim() });
  return blocks;
}

/* ================= STATUS ================= */
export async function status() {
  const prof = await deviceProfile();
  const id = installedModelId();
  const m = id ? modelById(id) : null;
  const onDisk = id ? await isInstalled(id) : false;
  let ram = {};
  const p = LP();
  if (p) { try { ram = await p.status(); } catch (_) {} }
  return {
    engine: engineAvailable(),
    native: isNative(),
    ramGB: prof.ramGB,
    budgetMB: Math.round(prof.budgetMB),
    installed: onDisk ? m : null,
    recommendedCode: prof.recommend('code'),
    recommendedChat: prof.recommend('chat'),
    loaded,
    device: ram
  };
}
