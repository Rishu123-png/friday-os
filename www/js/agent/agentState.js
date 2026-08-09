/* ============================================================================
   FRIDAY OS — Agent State (PHASE 2: REAL AGENT HUD STATE INTEGRATION)
   Single, authoritative agent-state event stream for the Agent Orchestrator.

   The orchestrator drives this engine; the HUD reacts via the existing
   EventBus (fridaycore.js). There is deliberately NO second global event
   system — this module only publishes on `Bus`.

   Events emitted (all on the existing Bus):
     agent:state        { state, prev, requestId, step, maxSteps, message, at }
     agent:tool_start   { name, args, requestId, step }
     agent:tool_result  { name, ok, requestId, step }
     agent:verification { verified, detail, requestId, step }
     agent:retry        { attempt, action, requestId, step }
     agent:complete     { ok, finalResponse, requestId, steps }
     agent:error        { message, requestId }          // human-readable ONLY
     agent:cancelled    { requestId }

   Payloads are kept free of secrets, keys, tokens and stack traces.

   Rules (from the phase spec):
     - A state is emitted only when the operation actually begins.
     - HUD always returns to IDLE after completion, error or cancellation.
     - No arbitrary/random state transitions — the FSM below gates every move.
   ============================================================================ */

import { Bus, Logger } from '../fridaycore.js';

/* ---------------- 1) The state vocabulary ---------------- */

export const AGENT_STATES = [
  'IDLE',
  'LISTENING',
  'UNDERSTANDING',
  'RETRIEVING_CONTEXT',
  'PLANNING',
  'SELECTING_TOOL',
  'CHECKING_PERMISSION',
  'EXECUTING',
  'OBSERVING',
  'VERIFYING',
  'RETRYING',
  'WAITING_CONFIRMATION',
  'RESPONDING',
  'SUCCESS',
  'ERROR',
  'CANCELLED',
];

/* ---------------- 2) The state machine (pure) ----------------
   Legal moves only. ERROR is reachable from any live state (a fault can
   strike at any point); from terminal states the only exit is IDLE. */
const NEXT = {
  IDLE:                ['LISTENING', 'UNDERSTANDING', 'RETRIEVING_CONTEXT', 'PLANNING',
                        'SELECTING_TOOL', 'CHECKING_PERMISSION', 'EXECUTING', 'ERROR'],
  LISTENING:           ['UNDERSTANDING', 'IDLE', 'ERROR'],
  UNDERSTANDING:       ['RETRIEVING_CONTEXT', 'PLANNING', 'SELECTING_TOOL', 'EXECUTING',
                        'RESPONDING', 'IDLE', 'CANCELLED', 'ERROR'],
  RETRIEVING_CONTEXT:  ['UNDERSTANDING', 'PLANNING', 'SELECTING_TOOL', 'EXECUTING',
                        'RESPONDING', 'IDLE', 'CANCELLED', 'ERROR'],
  PLANNING:            ['SELECTING_TOOL', 'EXECUTING', 'RESPONDING', 'IDLE', 'CANCELLED', 'ERROR'],
  SELECTING_TOOL:      ['CHECKING_PERMISSION', 'EXECUTING', 'PLANNING', 'RESPONDING',
                        'IDLE', 'CANCELLED', 'ERROR'],
  CHECKING_PERMISSION: ['WAITING_CONFIRMATION', 'EXECUTING', 'IDLE', 'CANCELLED', 'ERROR'],
  WAITING_CONFIRMATION:['EXECUTING', 'CANCELLED', 'IDLE', 'ERROR'],
  EXECUTING:           ['OBSERVING', 'VERIFYING', 'EXECUTING', 'RETRYING', 'RESPONDING',
                        'IDLE', 'CANCELLED', 'ERROR'],
  OBSERVING:           ['VERIFYING', 'EXECUTING', 'RESPONDING', 'IDLE', 'CANCELLED', 'ERROR'],
  VERIFYING:           ['RETRYING', 'EXECUTING', 'SUCCESS', 'RESPONDING', 'IDLE', 'CANCELLED', 'ERROR'],
  RETRYING:            ['EXECUTING', 'VERIFYING', 'ERROR', 'IDLE', 'CANCELLED'],
  RESPONDING:          ['SUCCESS', 'IDLE', 'CANCELLED', 'ERROR'],
  SUCCESS:             ['IDLE', 'ERROR'],
  ERROR:               ['IDLE'],
  CANCELLED:           ['IDLE'],
};

/** Pure: is from → to a legal transition? ERROR is legal from anywhere. */
export function can(from, to) {
  if (!AGENT_STATES.includes(from) || !AGENT_STATES.includes(to)) return false;
  if (from === to) return true;                 // idempotent re-announce allowed
  if (to === 'ERROR' && from !== 'ERROR') return true;
  return (NEXT[from] || []).includes(to);
}

/** Pure: are terminal states (HUD must return to IDLE after these)? */
export function isTerminal(state) {
  return state === 'SUCCESS' || state === 'ERROR' || state === 'CANCELLED';
}

/** Pure: is a state considered "active / working" (not idle/terminal)? */
export function isActive(state) {
  return state !== 'IDLE' && !isTerminal(state);
}

/** Pure: human display label for a state (HUD shows this on the core). */
export function labelOf(state) {
  return String(state || 'IDLE');
}

/* ---------------- 3) Agent state → existing orb visual ----------------
   Maps onto the HUD's existing orb state vocabulary (hud.js ORB_STATES):
   idle/listening/thinking/executing/speaking/sleeping/error. No new orb
   states are invented — we reuse what the HUD already knows how to draw. */
const ORB_OF = {
  IDLE: 'idle', LISTENING: 'listening', UNDERSTANDING: 'thinking',
  RETRIEVING_CONTEXT: 'thinking', PLANNING: 'thinking', SELECTING_TOOL: 'thinking',
  CHECKING_PERMISSION: 'thinking', EXECUTING: 'executing', OBSERVING: 'executing',
  VERIFYING: 'executing', RETRYING: 'executing', WAITING_CONFIRMATION: 'thinking',
  RESPONDING: 'speaking', SUCCESS: 'idle', ERROR: 'error', CANCELLED: 'idle',
};
export function orbOf(state) {
  return ORB_OF[state] || 'idle';
}

/* ---------------- 4) The runtime singleton ----------------
   Source of truth for the currently-active agent request. Emits on Bus. */
let _state = 'IDLE';
let _requestId = null;
let _cancelled = false;
let _reqCounter = 0;

function _nextRequestId() {
  _reqCounter = (_reqCounter + 1) % 100000;
  return 'rq-' + Date.now().toString(36) + '-' + _reqCounter;
}

export const agentState = {
  /** Current FSM state. */
  get: () => _state,
  /** Current request id (null when idle). */
  requestId: () => _requestId,
  /** True if an agent operation is in progress (not idle/terminal). */
  isActive: () => isActive(_state),
  /** True if the current request has been asked to cancel. */
  isCancelled: () => _cancelled,
  /** True if the HUD should never be left stuck in a working state. */
  isTerminal: () => isTerminal(_state),

  /** Begin a new agent request. Resets cancel flag, sets IDLE, allocates id. */
  begin(payload = {}) {
    const rid = _nextRequestId();
    _cancelled = false;
    _requestId = rid;
    // Announce (or re-announce) IDLE as the anchor so the HUD resets cleanly.
    if (_state !== 'IDLE') _transition('IDLE', { requestId: rid });
    return rid;
  },

  /** Move to a new state and emit agent:state. Payload may carry
      { step, maxSteps, message } — never secrets. */
  set(next, payload = {}) {
    if (next === 'IDLE') { _requestId = null; _cancelled = false; }
    _transition(next, payload);
    return _state;
  },

  /** Ask the active request to stop. Emits CANCELLED then IDLE.
      The orchestrator checks isCancelled() between steps and bails. */
  cancel() {
    if (!_cancelled) {
      _cancelled = true;
      if (_state !== 'IDLE' && _state !== 'CANCELLED') {
        _transition('CANCELLED', { requestId: _requestId });
      }
    }
    // Always settle the HUD back to IDLE so it is never left stuck.
    if (_state !== 'IDLE') _transition('IDLE', { requestId: _requestId });
    return true;
  },

  /** End the current request and return the HUD to IDLE. */
  end() {
    if (_state !== 'IDLE') _transition('IDLE', { requestId: _requestId });
    _requestId = null; _cancelled = false;
    return true;
  },

  /* ---- Satellite events (safe payloads only) ---- */
  toolStart(name, args, meta = {}) {
    Bus.emit('agent:tool_start', { name, args, requestId: _requestId, step: meta.step });
  },
  toolResult(name, ok, meta = {}) {
    Bus.emit('agent:tool_result', { name, ok: !!ok, requestId: _requestId, step: meta.step });
  },
  verification(verified, detail, meta = {}) {
    Bus.emit('agent:verification', { verified: !!verified, detail, requestId: _requestId, step: meta.step });
  },
  retry(attempt, action, meta = {}) {
    Bus.emit('agent:retry', { attempt, action, requestId: _requestId, step: meta.step });
  },
  complete(ok, finalResponse, meta = {}) {
    Bus.emit('agent:complete', { ok: !!ok, finalResponse, requestId: _requestId, steps: meta.steps || 0 });
  },
  error(message) {
    Bus.emit('agent:error', { message, requestId: _requestId });
  },
  cancelled() {
    Bus.emit('agent:cancelled', { requestId: _requestId });
  },

  /** Reset to a clean IDLE with no request (used at boot and in tests). */
  _reset() {
    _state = 'IDLE'; _requestId = null; _cancelled = false; _reqCounter = 0;
  },
};

function _transition(next, payload) {
  if (!AGENT_STATES.includes(next)) {
    Logger.error('agent', `ignoring unknown agent state "${next}"`);
    return;
  }
  const prev = _state;
  if (next !== prev && !can(prev, next)) {
    // Like VOX, an illegal move is still applied (recovery must never trap
    // the HUD), but loudly logged — never a silent skip.
    Logger.warn('agent', `odd agent jump ${prev} → ${next}`);
  }
  _state = next;
  const evt = {
    state: next,
    prev,
    requestId: _requestId,
    step: payload.step != null ? payload.step : undefined,
    maxSteps: payload.maxSteps != null ? payload.maxSteps : undefined,
    message: payload.message != null ? String(payload.message).slice(0, 120) : undefined,
    at: Date.now(),
  };
  Bus.emit('agent:state', evt);
  Logger.info('agent', `agent: ${prev} → ${next}${evt.message ? ' · ' + evt.message : ''}`);
}
