/* ============================================================================
   FRIDAY OS — PLANX: AI Planner & Reasoning Engine (v12.0.0 / Phase 8)
   EXTENDS the intent system — never replaces it. The planner activates ONLY
   when a request needs multiple steps or reasoning; single commands keep
   flowing through brain.js exactly as before.

   Pipeline (per the phase spec):
     User Request → Intent Analysis → Context Collection → Goal Extraction
     → Task Decomposition → Dependency Analysis → Execution Plan → Safety Check
     → Execute → Verify → Final Response

   Sub-systems implemented here:
     Planner Manager / Intent Analyzer / Goal Extractor / Task Decomposer /
     Dependency Resolver / Tool Selector / Execution Planner / Safety Validator /
     Progress Tracker / Retry Manager / Result Verifier
   ========================================================================== */

import { getList, saveList, getSetting } from './store.js';
import { Bus, Logger } from './fridaycore.js';
import { needsConfirm } from './vox.js';      // VOX danger rules reuse (house style)

const PLANS = 'friday_plans';      // plan records (scheduled/resumed kept here)
const PLANLOG = 'friday_planlog';  // run audit trail: goal, steps, time, success, retries

/* ---------------- 1) Tool registry (pure) ----------------
   Every step maps to a tool. The app injects executors; PLANX ships pure
   fallbacks for the tools that need no app (save/notify/plan). */
export const TOOLS = [
  'schedule', 'notes', 'summarize', 'plan', 'reminder', 'alarm', 'save', 'notify',
  'search', 'weather', 'translate', 'ask', 'command', 'wait'
];
export const TOOL_LABELS = {
  schedule: '📅', notes: '🗒️', summarize: '📝', plan: '🧭', reminder: '⏰',
  alarm: '⏰', save: '💾', notify: '🔔', search: '🔎', weather: '🌤️',
  translate: '🌐', ask: '❓', command: '⚡', wait: '⏳'
};

/* ---------------- 2) Intent Analyzer — should this request be planned? ----------------
   Conservative gate: single commands stay in the intent engine. We only claim
   multi-step work when the request is clearly a plan-able goal. */
const EXPLICIT = /^(help me |please )?(plan|prepare|arrange|organise|organize|get ready|set up|make a (?:plan|study plan|revision plan))/i;
const GOAL_WORDS = /\b(exam|test|interview|presentation|meeting|party|trip|travel|vacation|event|function|studies|study|revision|day|week|weekend|holiday)\b/i;
const PLAN_VERBS = /\b(plan|prepare|arrange|organise|organize|get ready|set up|revision|study (?:schedule|plan))\b/i;

/** Pure: should FRIDAY hand this to the planner instead of a single command? */
export function shouldPlan(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 6) return false;
  if (EXPLICIT.test(t)) return true;
  // "plan my day/week/studies" or a plan verb + a goal word
  return PLAN_VERBS.test(t) && GOAL_WORDS.test(t);
}

/** Pure: classify the goal. Returns {goal, kind, topic, confidence}. */
export function analyzeGoal(text) {
  const t = String(text || '').trim();
  let goal = t.replace(/^(help me |please |hey friday|ok friday|friday[,\s]*)/i, '').trim();
  let kind = 'generic', topic = '';

  const EXAM = t.match(/\b(?:for|my|the|in|of)?\s*([a-z][a-z\s-]{1,24}?)\s*(exam|test)\b/i);
  // "trip to goa" / "trip to goa next week"  AND  "goa trip" both work
  const TRIP_TO = t.match(/\b(?:trip|travel|vacation|tour)\s+(?:to|for)\s+([a-z][a-z\s]{1,24}?)(?:\s+(?:next|this|from|on|after|before)|$)/i);
  const TRIP = t.match(/\b(?:to|for|in)\s+([a-z][a-z\s]{1,24}?)\s*(?:trip|travel|vacation|tour|jaana|jaane)\b/i);
  const EVENT = t.match(/\b(?:for|the|my|a)?\s*([a-z][a-z\s]{1,24}?)\s*(party|event|function|meeting|interview|presentation)\b/i);
  const STUDY = /study|revision|padhai|prepare/i.test(t);

  if (EXAM) { kind = 'exam'; topic = EXAM[1].trim().replace(/\s+/g, ' '); }
  else if (TRIP_TO) { kind = 'trip'; topic = TRIP_TO[1].trim().replace(/\s+/g, ' '); }
  else if (TRIP) { kind = 'trip'; topic = TRIP[1].trim().replace(/\s+/g, ' '); }
  else if (EVENT) { kind = 'event'; topic = EVENT[1].trim().replace(/\s+/g, ' '); }
  else if (STUDY) { kind = 'study'; }

  if (!goal) goal = t;
  return { goal, kind, topic, confidence: kind === 'generic' ? 0.55 : 0.85 };
}

/* ---------------- 3) Goal Extractor + Task Decomposer (pure templates) ---------------- */

/** Pure: how many days until a mentioned date ("tomorrow", "next week", "saturday"). */
export function daysUntil(text) {
  const t = String(text || '').toLowerCase();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/\btonight\b/.test(t)) return 0;
  if (/\bday after tomorrow\b|parso\b/.test(t)) return 2;   // check BEFORE bare "tomorrow"
  if (/\btomorrow\b|kal\b/.test(t)) return 1;
  if (/\bnext week\b/.test(t)) return 7;
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for (let i = 0; i < days.length; i++) {
    if (new RegExp('\\b' + days[i] + '\\b').test(t)) {
      const target = new Date(today);
      let d = (i - today.getDay() + 7) % 7; if (d === 0) d = 7;
      target.setDate(today.getDate() + d);
      return Math.round((target - today) / 86400000);
    }
  }
  return 1;   // unknown → assume tomorrow (honest default)
}

/** Pure: build the step list for a goal. Every step: {id,text,tool,data,dependsOn,parallel}. */
export function decompose({ kind, topic, goal }, ctx = {}) {
  const steps = [];
  const P = (id, text, tool, data, dependsOn = [], parallel = false) =>
    steps.push({ id, text, tool, data: data || {}, dependsOn, parallel, status: 'wait', retries: 0, result: null });

  switch (kind) {
    case 'exam': {
      const subj = topic || 'the subject';
      P('p1', 'Check the schedule for the exam date', 'schedule', { days: 1 }, []);
      P('p2', `Find ${subj} notes on this phone`, 'notes', { topic: subj }, [], true);        // parallel with p1
      P('p3', 'Summarize the notes into key points', 'summarize', { topic: subj }, ['p2']);
      P('p4', 'Create a revision plan', 'plan', { topic: subj }, ['p3']);
      P('p5', 'Schedule revision reminders', 'reminder', { topic: subj }, ['p4']);
      P('p6', 'Save the plan and summary', 'save', { topic: subj }, ['p5']);
      P('p7', 'Notify when everything is ready', 'notify', {}, ['p6']);
      break;
    }
    case 'trip': {
      const dest = topic || 'your destination';
      P('t1', 'Check the weather at ' + dest, 'weather', { place: dest }, []);
      P('t2', 'Search travel info for ' + dest, 'search', { query: dest + ' travel' }, [], true);
      P('t3', 'Build a packing checklist', 'plan', { kind: 'pack', place: dest }, ['t1']);
      P('t4', 'Set departure reminders', 'reminder', { topic: dest }, ['t3']);
      P('t5', 'Save the trip plan', 'save', { topic: dest }, ['t4']);
      P('t6', 'Notify when the plan is ready', 'notify', {}, ['t5']);
      break;
    }
    case 'event': {
      const ev = topic || 'the event';
      P('e1', 'Check the date in your calendar/reminders', 'schedule', { days: 1 }, []);
      P('e2', 'List what needs to be arranged', 'plan', { kind: 'checklist', topic: ev }, ['e1']);
      P('e3', 'Set preparation reminders', 'reminder', { topic: ev }, ['e2']);
      P('e4', 'Save the checklist', 'save', { topic: ev }, ['e3']);
      P('e5', 'Notify when ready', 'notify', {}, ['e4']);
      break;
    }
    case 'study':
    default: {
      P('s1', 'Check today\'s schedule', 'schedule', { days: 0 }, []);
      P('s2', 'Find related notes', 'notes', { topic: topic || '' }, [], true);
      P('s3', 'Build a study plan', 'plan', { topic: topic || 'study' }, ['s1']);
      P('s4', 'Set study reminders', 'reminder', { topic: topic || 'study' }, ['s3']);
      P('s5', 'Save progress', 'save', {}, ['s4']);
      P('s6', 'Notify completion', 'notify', {}, ['s5']);
    }
  }
  return steps;
}

/* ---------------- 4) Dependency Resolver + Tool Selector (pure) ---------------- */

/** Pure: annotate the plan — order steps so deps come first; group parallel ones. */
export function resolveDeps(steps) {
  const plan = steps.map(s => ({ ...s }));
  // topological-ish: stable sort by (dependsOn length, id) keeps template order
  plan.sort((a, b) => (a.dependsOn.length - b.dependsOn.length) || (a.id < b.id ? -1 : 1));
  // mark parallel groups: a step is 'parallel' when it has no deps on the previous
  // sequential step AND its own deps are already resolved — we keep the flag the
  // template set; here we just validate ids resolve.
  const ids = new Set(plan.map(s => s.id));
  for (const s of plan) s.dependsOn = (s.dependsOn || []).filter(d => ids.has(d));
  return plan;
}

/** Pure: pick a tool for a step (template already sets it; this is the fallback). */
export function selectTool(step) {
  if (step && step.tool && TOOLS.includes(step.tool)) return step.tool;
  const t = String((step && step.text) || '').toLowerCase();
  if (/remind|reminder|yaad/.test(t)) return 'reminder';
  if (/weather|mausam/.test(t)) return 'weather';
  if (/summar/.test(t)) return 'summarize';
  if (/note/.test(t)) return 'notes';
  if (/save|store/.test(t)) return 'save';
  if (/search|find|look up/.test(t)) return 'search';
  if (/notify|tell me|alert/.test(t)) return 'notify';
  if (/schedule|calendar|exam date/.test(t)) return 'schedule';
  return 'command';
}

/* ---------------- 5) Safety Validator (pure) ----------------
   Never auto-execute data deletion / payments / system changes. VOX danger
   rules + a money/destructive regex force `confirm:true` on the step. */
const DESTRUCTIVE = /(delete|remove|clear|erase|wipe|format|factory reset|pay|payment|transfer|order|purchase|buy|cancel subscription|uninstall|reset)/i;

/** Pure: mark steps that MUST be confirmed, return {plan, risky:[ids]}. */
export function validatePlan(plan) {
  const risky = [];
  for (const s of plan) {
    const text = String(s.text || '') + ' ' + String(s.data && s.data.topic || '');
    const danger = needsConfirm(text) || DESTRUCTIVE.test(text) || s.tool === 'command';
    if (danger) { s.confirm = true; risky.push(s.id); }
  }
  return { plan, risky };
}

/* ---------------- 6) Execution Planner — revision timetable (pure) ---------------- */

/** Pure: spread study topics across days until the exam. Returns day rows. */
export function revisionPlan(topic, daysUntilExam, hoursPerDay = 2, chunkCount = 6) {
  const days = Math.max(1, Math.min(30, Math.round(daysUntilExam || 1)));
  const out = [];
  for (let i = 1; i <= days; i++) {
    const isLast = i === days;
    out.push({
      day: i,
      focus: isLast ? `Mock test + weak areas — ${topic}` : `Day ${i}: ${topic} — unit ${((i - 1) % chunkCount) + 1} (concept + quick recall)`,
      hours: isLast ? Math.min(3, hoursPerDay) : hoursPerDay,
      done: false
    });
  }
  return out;
}

/* ---------------- 7) Store + audit log ---------------- */

export function planLog() { return getList(PLANLOG).slice(0, 50); }
export function planStats() {
  const log = getList(PLANLOG);
  const ok = log.filter(l => l.success).length;
  return {
    total: log.length,
    success: ok,
    failRate: log.length ? Math.round(100 * (log.length - ok) / log.length) : 0,
    avgMs: log.length ? Math.round(log.reduce((a, l) => a + (l.ms || 0), 0) / log.length) : 0,
    retries: log.reduce((a, l) => a + (l.retries || 0), 0),
    last: log[0] || null
  };
}
export function activePlan() { return getList(PLANS).find(p => p.status === 'running' || p.status === 'scheduled') || null; }

function savePlan(plan) { saveList(PLANS, [plan, ...getList(PLANS)].slice(0, 20)); }
function logRun(entry) { saveList(PLANLOG, [entry, ...getList(PLANLOG)].slice(0, 80)); }

/* ---------------- 8) Progress Tracker / Retry Manager / Result Verifier ----------------
   Runtime engine. execStep(step) → {ok, result?, reason?}; verify(step, result) → bool;
   ask(question) → Promise<string|boolean> for interactive/confirm steps; onStep(plan) → UI. */
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function runPlan(plan, opts = {}) {
  const {
    execStep = null, verify = null, ask = null, onStep = null,
    retries = 2, backoffMs = 900, maxScheduledWaitMs = 6 * 3600e3
  } = opts;

  if (!execStep) return { ok: false, reason: 'no executor' };
  plan.status = 'running';
  plan.startedAt = Date.now();
  savePlan(plan);
  Bus.emit('planx:built', { planId: plan.id, goal: plan.goal, steps: plan.steps.length });

  /* Operate on the ORIGINAL steps (mutate in place) so the UI checklist and
     callers see live statuses — not on resolveDeps' copies. */
  const steps = plan.steps;
  const _ids = new Set(steps.map(s => s.id));
  for (const s of steps) s.dependsOn = (s.dependsOn || []).filter(d => _ids.has(d));
  const byId = Object.fromEntries(steps.map(s => [s.id, s]));
  const done = new Set();
  const results = {};   // stepId → verified result (chained steps read earlier output)
  let retryTotal = 0, failures = [];

  const setStep = (id, patch) => {
    const s = byId[id];
    if (!s) return;
    Object.assign(s, patch);
    if (onStep) { try { onStep({ ...plan }); } catch (_) {} }
    Bus.emit('planx:step', { planId: plan.id, stepId: id, status: s.status, tool: s.tool, result: s.result });
  };

  const depsDone = s => s.dependsOn.every(d => done.has(d));

  // conditional steps: predicate on context/data (pure string check)
  const condTrue = s => {
    if (!s.if) return true;
    if (typeof s.if === 'function') { try { return !!s.if(plan.ctx || {}); } catch (_) { return true; } }
    const key = String(s.if);
    const ctx = plan.ctx || {};
    if (key.startsWith('!')) return !ctx[key.slice(1)];
    return !!ctx[key];
  };

  // scheduled step: wait until `when` (HH:MM today or ms), capped
  const waitFor = async s => {
    if (!s.when) return true;
    let target;
    if (typeof s.when === 'number') target = s.when;
    else {
      const [hh, mm] = String(s.when).split(':').map(Number);
      const d = new Date(); d.setHours(hh || 0, mm || 0, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      target = d.getTime();
    }
    const wait = target - Date.now();
    if (wait > maxScheduledWaitMs) { setStep(s.id, { status: 'scheduled' }); plan.status = 'scheduled'; plan.resumeAt = target; savePlan(plan); return false; }
    if (wait > 0) { setStep(s.id, { status: 'wait' }); await sleep(Math.min(wait, 2000)); }
    return true;
  };

  const execute = async s => {
    if (!condTrue(s)) { setStep(s.id, { status: 'skip', result: 'condition not met' }); done.add(s.id); return; }
    if (!(await waitFor(s))) return;   // parked as scheduled

    /* Safety Validator (enforced): risky steps (deletion / money / system
       changes / raw commands) must be confirmed by the user first. */
    if (s.confirm) {
      if (!ask) { setStep(s.id, { status: 'skip', result: 'needs confirmation, none available' }); done.add(s.id); return; }
      setStep(s.id, { status: 'ask' });
      const verdict = await ask(`Pakka? "${s.text}" — say "go" to execute, or "skip".`, s);
      if (verdict !== 'go' && verdict !== true) {
        setStep(s.id, { status: 'skip', result: 'user declined' });
        done.add(s.id);
        Logger.info('planx', `step ${s.id} declined by user`);
        return;
      }
    }

    let attempt = 0;
    while (attempt <= retries) {
      setStep(s.id, { status: 'run' });
      let r;
      try { r = await execStep(s, results); } catch (e) { r = { ok: false, reason: e && e.message || 'exec threw' }; }
      const verified = r && r.ok && (verify ? verify(s, r.result, results) !== false : true);
      if (verified) {
        results[s.id] = r.result;                 // Result Verifier: pass verified output downstream
        setStep(s.id, { status: 'done', result: r.result });
        done.add(s.id);
        Logger.info('planx', `step ${s.id} ok: ${s.tool}`);
        return;
      }
      // retry with backoff (Retry Manager)
      attempt++; retryTotal++;
      setStep(s.id, { status: 'run', result: r && r.reason });
      Logger.warn('planx', `step ${s.id} failed (${r && r.reason || 'unknown'}) — retry ${attempt}/${retries}`);
      if (attempt <= retries) await sleep(backoffMs * Math.pow(2, attempt - 1));
    }

    // exhausted retries → interactive rescue: continue / skip / abort
    failures.push(s.id);
    if (ask && typeof ask === 'function') {
      const verdict = await ask(`Step "${s.text}" failed after retries. Continue? Say "go", "skip", or "stop".`, s);
      if (verdict === 'go' || verdict === true) { await execute(s); return; }
      if (verdict === 'skip') { setStep(s.id, { status: 'skip', result: 'user skipped' }); done.add(s.id); return; }
      plan.status = 'aborted';
      setStep(s.id, { status: 'fail' });
      finish('aborted', failures, retryTotal);
      return;
    }
    setStep(s.id, { status: 'fail', result: 'failed after ' + retries + ' retries' });
    done.add(s.id);
  };

  const finish = (status, fails, retriesUsed) => {
    plan.status = status;
    plan.endedAt = Date.now();
    plan.ms = plan.endedAt - plan.startedAt;
    plan.retries = retriesUsed;
    savePlan(plan);
    logRun({
      id: plan.id, goal: plan.goal, kind: plan.kind, steps: plan.steps.length,
      done: done.size, failed: fails, retries: retriesUsed,
      ms: plan.ms, success: status === 'done', at: Date.now()
    });
    Logger.info('planx', `plan ${status} — ${done.size}/${plan.steps.length} steps, ${retriesUsed} retries`);
    Bus.emit('planx:done', { planId: plan.id, status, success: status === 'done', ms: plan.ms });
  };

  // Execution Planner: process steps in dependency order; parallel pairs run concurrently.
  let i = 0;
  while (i < steps.length && plan.status === 'running') {
    const s = steps[i];
    if (done.has(s.id) || s.status === 'skip' || s.status === 'scheduled') { i++; continue; }
    if (!depsDone(s)) { i++; continue; }   // wait for deps (they run earlier or in flight)
    const mate = steps.find(x => x.parallel && x.id !== s.id && depsDone(x) && !done.has(x.id) && x.status === 'wait');
    if (mate && plan.status === 'running') {
      await Promise.allSettled([execute(s), execute(mate)]);
      i++;
    } else {
      await execute(s);
    }
    i++;
    if (plan.status === 'scheduled') break;   // parked; resumePlan() continues later
  }
  if (plan.status === 'running') finish('done', failures, retryTotal);
  return { ok: plan.status === 'done', plan };
}

/** Resume a parked (scheduled) plan. */
export async function resumePlan(id, opts = {}) {
  const plan = getList(PLANS).find(p => p.id === id);
  if (!plan || (plan.status !== 'scheduled' && plan.status !== 'running')) return { ok: false, reason: 'not resumable' };
  plan.status = 'running';
  plan.ctx = opts.ctx || plan.ctx || {};
  return runPlan(plan, opts);
}

/* ---------------- 9) Build a full plan from text (the public entry) ---------------- */
export function buildPlan(text, ctx = {}) {
  const { goal, kind, topic, confidence } = analyzeGoal(text);
  const steps = decompose({ kind, topic, goal }, ctx);
  const resolved = resolveDeps(steps);
  const { plan: safe, risky } = validatePlan(resolved);
  const days = daysUntil(text);
  return {
    id: 'plan-' + Date.now() + Math.random().toString(36).slice(2, 5),
    goal, kind, topic, confidence, days, ctx,
    steps: safe, risky, status: 'ready', createdAt: Date.now()
  };
}

export function describeStep(s) {
  return `${TOOL_LABELS[s.tool] || ''} ${s.text}${s.confirm ? ' (⚠️ will confirm first)' : ''}`;
}

export function renderPlanText(plan) {
  return `**Plan: ${plan.goal}** (${plan.steps.length} steps)\n` +
    plan.steps.map((s, i) =>
      `${s.status === 'done' ? '✅' : s.status === 'skip' ? '⏭️' : s.status === 'run' ? '⚡' : s.status === 'fail' ? '❌' : s.status === 'ask' ? '❓' : '▫️'} ${i + 1}. ${s.text}`
    ).join('\n');
}
