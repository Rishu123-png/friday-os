/* ============================================================================
   FRIDAY OS — WORKFLOW: AI Workflow Engine (v15 Phase 3)
   Chained AI tasks with modular nodes, error recovery, execution history and
   reusable templates. Each node = { id, tool, data, retries } and a worker
   map injected from app.js (so it stays pure/testable).

   Built-in templates (spec examples):
     image → OCR → summary → save-to-notes
     voice → translate → send-message
     document → extract-tasks → add-to-calendar
   ========================================================================== */

import { getList, saveList } from './store.js';
import { Bus, Logger } from './fridaycore.js';

const WFLOG = 'friday_workflow_log';

/* ---------------- Templates (pure) ---------------- */
export const TEMPLATES = {
  'image-to-notes': {
    name: 'Image → OCR → Summary → Notes',
    nodes: [
      { id: 'n1', tool: 'ocr', data: { input: 'image' } },
      { id: 'n2', tool: 'summarize', data: { from: 'n1' } },
      { id: 'n3', tool: 'save_note', data: { from: 'n2' } }
    ]
  },
  'voice-translate-send': {
    name: 'Voice → Translate → Send',
    nodes: [
      { id: 'n1', tool: 'translate', data: { from: 'voice' } },
      { id: 'n2', tool: 'send_message', data: { from: 'n1' } }
    ]
  },
  'doc-tasks-calendar': {
    name: 'Document → Extract Tasks → Calendar',
    nodes: [
      { id: 'n1', tool: 'ocr', data: { input: 'document' } },
      { id: 'n2', tool: 'extract_tasks', data: { from: 'n1' } },
      { id: 'n3', tool: 'add_calendar', data: { from: 'n2' } }
    ]
  }
};

export function templates() { return Object.entries(TEMPLATES).map(([id, t]) => ({ id, ...t })); }
export function templateById(id) { return TEMPLATES[id] || null; }

/* ---------------- Execution (runtime) ---------------- */
/* runWorkflow(template, ctx, { runNode }) — ctx = input payload (e.g. {image: base64}),
   runNode(node, inputs, ctx) → {ok, result} injected from app.js. */

export async function runWorkflow({ id = 'wf-' + Date.now(), template = null, nodes = null, ctx = {} } = {}, { runNode = null } = {}) {
  const steps = nodes || (template ? template.nodes : null);
  if (!steps || !steps.length) return { ok: false, reason: 'empty workflow', id };
  if (!runNode) return { ok: false, reason: 'no runner', id };

  const results = {};       // nodeId → result
  const log = [];
  const t0 = performance && performance.now ? performance.now() : Date.now();

  for (const node of steps) {
    const inputs = {};
    for (const [k, v] of Object.entries(node.data || {})) {
      if (typeof v === 'string' && v.startsWith('from:')) inputs[k] = results[v.slice(5)];
      else if (k === 'from' && typeof v === 'string' && v in results) inputs[k] = results[v];
      else if (v === 'from') inputs[k] = results[Object.keys(results).pop()];
      else inputs[k] = v;
    }
    let attempt = 0, nodeOk = false, out = null, err = '';
    const maxRetry = node.retries != null ? node.retries : 1;   // honor explicit 0
    while (attempt <= maxRetry && !nodeOk) {
      try {
        const r = await runNode(node.tool, inputs, ctx);
        if (r && r.ok) { out = r.result; nodeOk = true; }
        else { err = (r && r.reason) || 'node failed'; attempt++; }
      } catch (e) { err = e && e.message || 'node threw'; attempt++; }
    }
    log.push({ node: node.id, tool: node.tool, ok: nodeOk, err: nodeOk ? '' : err, attempts: attempt });
    results[node.id] = out;
    if (!nodeOk) {
      const wfLog = getList(WFLOG);
      wfLog.unshift({ id, template: template && template.id, ok: false, node: node.id, err, ts: Date.now() });
      saveList(WFLOG, wfLog.slice(0, 100));
      Logger.warn('workflow', `wf ${id} failed at ${node.id}: ${err}`);
      Bus.emit('workflow:fail', { id, node: node.id, err });
      return { ok: false, id, failedAt: node.id, reason: err, log };
    }
  }
  const ms = Math.round(performance && performance.now ? performance.now() - t0 : 0);
  const wfLog = getList(WFLOG);
  wfLog.unshift({ id, template: template && template.id, ok: true, ms, ts: Date.now() });
  saveList(WFLOG, wfLog.slice(0, 100));
  Logger.info('workflow', `wf ${id} done in ${ms}ms`);
  Bus.emit('workflow:done', { id, ms, results });
  return { ok: true, id, results, ms, log };
}

export function workflowLog() { return getList(WFLOG).slice(0, 50); }
