/* ===== FRIDAY OS — On-device brain (llama.cpp bridge) =====
   Pure routing + prompt construction for the OPTIONAL native engine
   (native/LlamaCpp.java). When the engine or model is missing, every
   function returns a reason code instead of crashing, and the app falls
   back to cloud / offline engines.

   Privacy promise: in local mode NOTHING leaves the phone. No key, no
   account, no network. The trade-off is honesty in Settings: a small
   GGUF model is smart, but it is not Groq's 70B cloud model. */

import { getSetting } from './store.js';
import * as NAT from './native.js';

/** Llama-3-style chat template for GGUF instruct models. */
/* ---- v10.0 B1: per-family chat templates (2026 model menu) ----
   Wrong template = garbage output. Detect from the model FILENAME and
   format exactly the way that family was trained to see the world. */

/** 'gemma-3-4b-it-Q4_K_M.gguf' -> 'gemma'; 'Qwen3-4B-Instruct-2507' -> 'chatml' */
export function detectModelFamily(name) {
  const n = String(name || '').toLowerCase();
  if (/gemma/.test(n)) return 'gemma';
  if (/qwen|smollm|stablelm|openchat/.test(n)) return 'chatml';
  if (/phi-?4|phi-?3|phi/.test(n)) return 'phi';
  if (/mistral|mixtral|zephyr/.test(n)) return 'mistral';
  return 'llama';   // llama-3.x style is also the safe default
}

export function stopsForFamily(family) {
  switch (family) {
    case 'gemma': return ['<end_of_turn>', '<start_of_turn>'];
    case 'chatml': return ['<|im_end|>', '<|im_start|>'];
    case 'phi': return ['<|end|>', '<|user|>', '<|assistant|>'];
    case 'mistral': return ['[/INST]', '</s>'];
    default: return ['<|eot_id|>', '<|end_of_text|>', '<|start_header_id|>'];
  }
}

/** Back-compat alias – every old caller defaulting to llama-3. */
export const LOCAL_STOPS = stopsForFamily('llama');

export function buildLocalPrompt(system, user, family = 'llama') {
  const s = String(system || '').trim();
  const u = String(user || '').trim();
  switch (family) {
    case 'gemma':
      return '<start_of_turn>user\n' + (s ? s + '\n\n' : '') + u + '<end_of_turn>\n<start_of_turn>model\n';
    case 'chatml':
      return '<|im_start|>system\n' + (s || 'You are a helpful assistant.') + '<|im_end|>\n' +
             '<|im_start|>user\n' + u + '<|im_end|>\n<|im_start|>assistant\n';
    case 'phi':
      return (s ? '<|system|>' + s + '<|end|>' : '') + '<|user|>' + u + '<|end|><|assistant|>';
    case 'mistral':
      return '<s>[INST] ' + (s ? s + '\n\n' : '') + u + ' [/INST]';
    default: /* llama-3.x */
      return '<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n' +
        s + '<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n' +
        u + '<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n';
  }
}

/** Routing decision — pure, unit-testable.
 *  Local handles CONVERSATION. Actionable requests still go to the cloud
 *  path because that is where the tool/agent loop lives. Without a cloud
 *  key, local becomes the only smart brain, tools or not. */
export function shouldUseLocal(text, opts = {}) {
  const offlineBrain = opts.offlineBrain === true || opts.offlineBrain === 'true';
  if (!offlineBrain || !opts.native) return false;
  if (!opts.hasKey) return true;
  return !opts.actionish;
}

/** Reads live settings and decides. */
export function wantLocal(text, actionish) {
  return shouldUseLocal(text, {
    offlineBrain: getSetting('offlineBrain'),
    native: NAT.isNative(),
    hasKey: !!(getSetting('serverUrl') || '').trim(),
    actionish
  });
}

let loadFlight = null;   // single-flight: two asks never load twice

/** Ensures the configured model is resident. Returns { ok, reason, path }. */
export async function ensureModel() {
  const path = (getSetting('llmModelPath') || '').trim();
  if (!path) return { ok: false, reason: 'no_model_path' };
  const st = await NAT.llmStatus();
  if (st.reason && String(st.reason).includes('LLAMA_BINDING_MISSING')) return { ok: false, reason: 'binding_missing' };
  if (st.loaded && st.modelPath === path) return { ok: true, path };
  if (loadFlight) return loadFlight;
  loadFlight = (async () => {
    const r = await NAT.llmLoad(path);
    loadFlight = null;
    if (!r.ok) {
      return { ok: false, reason: String(r.reason || 'load_failed').includes('LLAMA_BINDING_MISSING') ? 'binding_missing' : 'load_failed' };
    }
    return { ok: true, path };
  })();
  return loadFlight;
}

/** One full on-device answer. Never throws. */
export async function askLocal(system, user, { onToken = null, maxTokens = 400 } = {}) {
  const ready = await ensureModel();
  if (!ready.ok) return ready;
  /* v10.0 B1: format the prompt in the model's own dialect */
  const family = detectModelFamily(getSetting('llmModelPath') || '');
  const prompt = buildLocalPrompt(system, user, family);
  let acc = '';
  const r = await NAT.llmGenerate(prompt,
    { nPredict: maxTokens, temperature: 0.7, stop: stopsForFamily(family) },
    onToken ? t => { acc += t; onToken(t, acc); } : null);
  if (!r.ok) return { ok: false, reason: r.reason || 'generate_failed' };
  const text = (r.text || acc).trim();
  if (!text) return { ok: false, reason: 'empty' };
  return { ok: true, text };
}

export async function abortLocal() { try { await NAT.llmAbort(); } catch (_) {} }

/** Human wording for failure reasons (also surfaced in Settings > AI Core). */
export function friendlyReason(reason) {
  const raw = String(reason || 'unknown');
  const m = raw.toLowerCase();
  if (m.includes('no_model_path')) return 'no model selected - Settings > AI Core';
  if (m.includes('binding_missing') || m.includes('engine_missing')) return 'engine missing in this build - rebuild with native/add_llama_dep.py';
  if (m.includes('load_failed')) return 'model failed to load - too little RAM or a bad .gguf file';
  if (m.includes('no_model_loaded')) return 'model not loaded yet';
  if (m.includes('empty')) return 'model returned an empty reply';
  if (m === 'web') return 'needs the installed APK';
  return raw.slice(0, 90);
}
