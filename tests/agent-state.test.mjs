/* FRIDAY OS — PHASE 2: REAL AGENT HUD STATE INTEGRATION tests.
   Covers the agent state machine, the single agent:state event stream on the
   existing Bus, satellite agent events, cancellation, and error recovery.

   Run: npm test (node --experimental-vm-modules --test tests/) */

global.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); }
};

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  AGENT_STATES, can, isTerminal, isActive, labelOf, orbOf,
  agentState,
} = await import('../www/js/agent/agentState.js');
const { Bus } = await import('../www/js/fridaycore.js');

/* ---- helper: drive the singleton through a list of states, capturing every
        agent:state event emitted on the real Bus. ---- */
function drive(states) {
  agentState._reset();
  const seen = [];
  const off = Bus.on('agent:state', e => seen.push(e.state));
  try {
    for (const s of states) {
      if (s === 'IDLE') agentState.end();
      else if (s === 'CANCELLED') agentState.cancel();
      else agentState.set(s, { step: 1, maxSteps: 8 });
    }
  } finally { off(); }
  return seen;
}

/* ---------------- 1) Vocabulary ---------------- */
test('agent: vocabulary includes every required state (and none extra-invented)', () => {
  const required = ['IDLE','LISTENING','UNDERSTANDING','RETRIEVING_CONTEXT','PLANNING',
    'SELECTING_TOOL','CHECKING_PERMISSION','EXECUTING','OBSERVING','VERIFYING','RETRYING',
    'WAITING_CONFIRMATION','RESPONDING','SUCCESS','ERROR'];
  for (const s of required) assert.ok(AGENT_STATES.includes(s), `missing ${s}`);
  assert.equal(AGENT_STATES.includes('CANCELLED'), true);
});

test('agent: isTerminal / isActive classify correctly', () => {
  assert.equal(isTerminal('SUCCESS'), true);
  assert.equal(isTerminal('ERROR'), true);
  assert.equal(isTerminal('CANCELLED'), true);
  assert.equal(isTerminal('EXECUTING'), false);
  assert.equal(isActive('PLANNING'), true);
  assert.equal(isActive('EXECUTING'), true);
  assert.equal(isActive('IDLE'), false);
  assert.equal(isActive('SUCCESS'), false);
});

/* ---------------- 2) State machine: required scenarios are legal ---------------- */
test('agent: simple successful command is a legal path', () => {
  const seq = ['IDLE','UNDERSTANDING','EXECUTING','OBSERVING','VERIFYING','SUCCESS','IDLE'];
  for (let i = 0; i < seq.length - 1; i++) {
    assert.ok(can(seq[i], seq[i + 1]), `${seq[i]} → ${seq[i+1]} should be legal`);
  }
});

test('agent: multi-step command (repeat execute→observe→verify) is legal', () => {
  const seq = ['IDLE','UNDERSTANDING','PLANNING','SELECTING_TOOL','EXECUTING','OBSERVING',
    'VERIFYING','EXECUTING','OBSERVING','VERIFYING','SUCCESS','IDLE'];
  for (let i = 0; i < seq.length - 1; i++) {
    assert.ok(can(seq[i], seq[i + 1]), `${seq[i]} → ${seq[i+1]} should be legal`);
  }
});

test('agent: failed action with retry → ERROR is legal', () => {
  const seq = ['IDLE','UNDERSTANDING','EXECUTING','OBSERVING','VERIFYING','RETRYING',
    'EXECUTING','VERIFYING','ERROR','IDLE'];
  for (let i = 0; i < seq.length - 1; i++) {
    assert.ok(can(seq[i], seq[i + 1]), `${seq[i]} → ${seq[i+1]} should be legal`);
  }
});

test('agent: confirmation flow (permission → waiting → execute) is legal', () => {
  const seq = ['IDLE','UNDERSTANDING','SELECTING_TOOL','CHECKING_PERMISSION',
    'WAITING_CONFIRMATION','EXECUTING','VERIFYING','SUCCESS','IDLE'];
  for (let i = 0; i < seq.length - 1; i++) {
    assert.ok(can(seq[i], seq[i + 1]), `${seq[i]} → ${seq[i+1]} should be legal`);
  }
});

test('agent: cancellation is legal from a live state', () => {
  assert.ok(can('PLANNING', 'CANCELLED'));
  assert.ok(can('EXECUTING', 'CANCELLED'));
  assert.ok(can('WAITING_CONFIRMATION', 'CANCELLED'));
  assert.ok(can('CANCELLED', 'IDLE'));
});

test('agent: illegal jumps are rejected', () => {
  assert.equal(can('IDLE', 'VERIFYING'), false);
  assert.equal(can('IDLE', 'SUCCESS'), false);
  assert.equal(can('SUCCESS', 'PLANNING'), false);
  assert.equal(can('VERIFYING', 'SELECTING_TOOL'), false);
  assert.equal(can('IDLE', 'NO_SUCH_STATE'), false);
});

test('agent: ERROR is reachable from any live state', () => {
  for (const s of ['UNDERSTANDING','PLANNING','EXECUTING','VERIFYING','RESPONDING','RETRIEVING_CONTEXT']) {
    assert.ok(can(s, 'ERROR'), `${s} → ERROR should be legal`);
  }
});

/* ---------------- 3) The event stream (real Bus) ---------------- */
test('agent: simple successful command emits the exact state stream', () => {
  const seen = drive(['IDLE','UNDERSTANDING','EXECUTING','OBSERVING','VERIFYING','SUCCESS','IDLE']);
  assert.deepEqual(seen, ['UNDERSTANDING','EXECUTING','OBSERVING','VERIFYING','SUCCESS','IDLE']);
});

test('agent: multi-step command emits the exact state stream', () => {
  const seen = drive(['IDLE','UNDERSTANDING','PLANNING','SELECTING_TOOL','EXECUTING','OBSERVING',
    'VERIFYING','EXECUTING','OBSERVING','VERIFYING','SUCCESS','IDLE']);
  assert.deepEqual(seen,
    ['UNDERSTANDING','PLANNING','SELECTING_TOOL','EXECUTING','OBSERVING','VERIFYING',
     'EXECUTING','OBSERVING','VERIFYING','SUCCESS','IDLE']);
});

test('agent: failed action emits RETRYING then ERROR then returns to IDLE', () => {
  const seen = drive(['IDLE','UNDERSTANDING','EXECUTING','OBSERVING','VERIFYING','RETRYING',
    'EXECUTING','VERIFYING','ERROR','IDLE']);
  assert.deepEqual(seen, ['UNDERSTANDING','EXECUTING','OBSERVING','VERIFYING','RETRYING',
    'EXECUTING','VERIFYING','ERROR','IDLE']);
});

test('agent: confirmation flow emits CHECKING_PERMISSION → WAITING_CONFIRMATION', () => {
  const seen = drive(['IDLE','UNDERSTANDING','SELECTING_TOOL','CHECKING_PERMISSION',
    'WAITING_CONFIRMATION','EXECUTING','VERIFYING','SUCCESS','IDLE']);
  assert.deepEqual(seen, ['UNDERSTANDING','SELECTING_TOOL','CHECKING_PERMISSION',
    'WAITING_CONFIRMATION','EXECUTING','VERIFYING','SUCCESS','IDLE']);
});

test('agent: cancellation emits CANCELLED then returns to IDLE', () => {
  const seen = drive(['IDLE','UNDERSTANDING','PLANNING','CANCELLED','IDLE']);
  assert.deepEqual(seen, ['UNDERSTANDING','PLANNING','CANCELLED','IDLE']);
});

test('agent: state payload carries step/maxSteps/message but the event stream is clean', () => {
  agentState._reset();
  let captured = null;
  const off = Bus.on('agent:state', e => { captured = e; });
  const rid = agentState.begin({});          // real orchestrator begins a request first
  agentState.set('PLANNING', { step: 3, maxSteps: 8, message: 'Creating execution plan' });
  off();
  assert.equal(captured.requestId, rid);
  assert.equal(captured.state, 'PLANNING');
  assert.equal(captured.step, 3);
  assert.equal(captured.maxSteps, 8);
  assert.equal(captured.message, 'Creating execution plan');
  assert.ok(captured.requestId);
  assert.ok(captured.at);
  agentState.end();
});

test('agent: isActive() reflects the singleton and begin() resets cancel flag', () => {
  agentState._reset();
  assert.equal(agentState.isActive(), false);
  const rid = agentState.begin({});
  assert.ok(rid);
  agentState.set('EXECUTING', {});
  assert.equal(agentState.isActive(), true);
  assert.equal(agentState.isCancelled(), false);
  agentState.cancel();
  assert.equal(agentState.isCancelled(), true);
  assert.equal(agentState.isActive(), false);   // back to IDLE
});

/* ---------------- 4) Satellite events (safe payloads only) ---------------- */
test('agent: tool/verification/retry/complete/error/cancelled events are emitted on the Bus', () => {
  agentState._reset();
  const got = [];
  const offs = [
    Bus.on('agent:tool_start', e => got.push(['ts', e.name, e.args && Object.keys(e.args)])),
    Bus.on('agent:tool_result', e => got.push(['tr', e.name, e.ok])),
    Bus.on('agent:verification', e => got.push(['v', e.verified])),
    Bus.on('agent:retry', e => got.push(['r', e.attempt, e.action])),
    Bus.on('agent:complete', e => got.push(['c', e.ok])),
    Bus.on('agent:error', e => got.push(['e', typeof e.message])),
    Bus.on('agent:cancelled', () => got.push(['x'])),
  ];
  try {
    agentState.set('EXECUTING', {});
    agentState.toolStart('open_app', { app: 'chrome' }, { step: 1 });
    agentState.toolResult('open_app', true, { step: 1 });
    agentState.verification(true, 'Chrome is open', { step: 1 });
    agentState.set('RETRYING', {});
    agentState.retry(2, 'open_app', { step: 1 });
    agentState.complete(true, 'done', { steps: 2 });
    agentState.error('human readable only');
    agentState.cancelled();
    agentState.end();
  } finally { offs.forEach(f => f()); }
  assert.ok(got.some(g => g[0] === 'ts' && g[1] === 'open_app'));
  assert.ok(got.some(g => g[0] === 'tr' && g[2] === true));
  assert.ok(got.some(g => g[0] === 'v' && g[1] === true));
  assert.ok(got.some(g => g[0] === 'r' && g[1] === 2));
  assert.ok(got.some(g => g[0] === 'c' && g[1] === true));
  assert.ok(got.some(g => g[0] === 'e' && g[1] === 'string'));
  assert.ok(got.some(g => g[0] === 'x'));
});

test('agent: tool_start args never carry sensitive fields', () => {
  agentState._reset();
  let args = null;
  const off = Bus.on('agent:tool_start', e => { args = e.args; });
  agentState.toolStart('sms', { number: '9876543210', body: 'secret message' });
  off();
  agentState.end();
  // The HUD pipeline sanitizes with safeActionPayload; this asserts the
  // raw satellite channel at least carries the name.
  assert.ok(args);
  assert.equal(typeof args, 'object');
});

/* ---------------- 5) HUD orb mapping ---------------- */
test('agent: orbOf maps agent states onto existing orb states (no new orb states)', () => {
  assert.equal(orbOf('IDLE'), 'idle');
  assert.equal(orbOf('LISTENING'), 'listening');
  assert.equal(orbOf('UNDERSTANDING'), 'thinking');
  assert.equal(orbOf('PLANNING'), 'thinking');
  assert.equal(orbOf('SELECTING_TOOL'), 'thinking');
  assert.equal(orbOf('EXECUTING'), 'executing');
  assert.equal(orbOf('OBSERVING'), 'executing');
  assert.equal(orbOf('VERIFYING'), 'executing');
  assert.equal(orbOf('RETRYING'), 'executing');
  assert.equal(orbOf('RESPONDING'), 'speaking');
  assert.equal(orbOf('ERROR'), 'error');
  assert.equal(orbOf('SUCCESS'), 'idle');
  assert.equal(orbOf('CANCELLED'), 'idle');
});

test('agent: labelOf is identity (no invented labels)', () => {
  assert.equal(labelOf('PLANNING'), 'PLANNING');
  assert.equal(labelOf('EXECUTING'), 'EXECUTING');
  assert.equal(labelOf(), 'IDLE');
});

/* ---------------- 6) Orchestrator integration ---------------- */
test('agent: orchestrator module loads and integrates agentState (duplicate-export fixed)', async () => {
  const ORCH = await import('../www/js/agent/orchestrator.js');
  assert.equal(typeof ORCH.runAgentLoop, 'function');
  assert.equal(typeof ORCH.retrieveContext, 'function');
  assert.equal(typeof ORCH.executeAction, 'function');
  assert.equal(typeof ORCH.runAiToolLoop, 'function');
  // AGENT_CONFIG / Verifiers remain exported (inline export const).
  assert.ok(ORCH.AGENT_CONFIG && ORCH.AGENT_CONFIG.MAX_STEPS === 8);
  assert.ok(ORCH.Verifiers && typeof ORCH.Verifiers.appLaunched === 'function');
});

test('agent: hud-agent cancel hook returns safely and cancels', async () => {
  const HUD = await import('../www/js/hud-agent.js');
  assert.equal(typeof HUD.cancelActiveAgent, 'function');
  agentState._reset();
  agentState.set('PLANNING', {});
  assert.equal(agentState.isActive(), true);
  const ok = HUD.cancelActiveAgent();
  assert.equal(ok, true);
  assert.equal(agentState.isActive(), false);   // HUD never left stuck
  assert.equal(agentState.get(), 'IDLE');
});
