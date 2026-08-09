/* ============================================================================
   FRIDAY OS — HUD Agent Integration (PHASE 2)
   Purely additive. Does NOT redesign the HUD. Subscribes to the existing
   EventBus agent:* events and paints the REAL agent state onto the existing
   core (`#aiCoreWrap` orb + `#listeningText` label) plus a small status
   strip that carries step / tool / verification detail.

   Everything shown comes straight from the Agent Orchestrator via the bus.
   No fake PLANNING/EXECUTING — if the agent does not emit it, it is not drawn.
   On IDLE the panel hides and the existing VOX-driven orb/label take over.

   Rendered container is created lazily (like hud-shell.js) so index.html
   markup is left untouched.
   ============================================================================ */

import { Bus } from './fridaycore.js';
import { agentState, labelOf, orbOf } from './agent/agentState.js';
import { setOrbState } from './hud.js';
import { vox } from './vox.js';
import { orbOf as voxOrbOf, labelOf as voxLabelOf } from './vox.js';

let _running = false;
let _wrap = null;
let _panel = null;
let _el = {};

/** Build the (hidden) agent status strip inside the ai-core container. */
function ensureDom() {
  if (_panel) return;
  const wrap = document.getElementById('aiCoreWrap');
  if (!wrap) return;
  _wrap = wrap;

  const panel = document.createElement('div');
  panel.id = 'agentPanel';
  panel.className = 'agent-panel';
  panel.innerHTML =
    '<div class="agent-row agent-main">' +
      '<button type="button" id="agentCancel" class="agent-cancel" title="Cancel agent" aria-label="Cancel agent">✕</button>' +
      '<span class="agent-state" id="agentStateLabel"></span>' +
    '</div>' +
    '<div class="agent-row agent-step" id="agentStepLine" style="display:none"></div>' +
    '<div class="agent-row agent-tool" id="agentToolLine" style="display:none"></div>' +
    '<div class="agent-row agent-verify" id="agentVerifyLine" style="display:none"></div>';
  // Keep the panel visually tied to the core: insert right after the quote.
  const quote = wrap.querySelector('.core-quote');
  if (quote && quote.parentNode) quote.parentNode.insertBefore(panel, quote.nextSibling);
  else wrap.appendChild(panel);

  const cancelBtn = document.getElementById('agentCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    if (agentState.isActive() || agentState.isTerminal()) {
      agentState.cancel();          // emits CANCELLED then returns HUD to IDLE
    }
  });

  _el = {
    panel,
    state: document.getElementById('agentStateLabel'),
    step: document.getElementById('agentStepLine'),
    tool: document.getElementById('agentToolLine'),
    verify: document.getElementById('agentVerifyLine'),
    listening: document.getElementById('listeningText'),
    cancel: cancelBtn,
  };
}

function show() {
  ensureDom();
  if (_panel) _panel.style.display = 'block';
}
function hide() {
  if (_panel) _panel.style.display = 'none';
  if (_el.cancel) _el.cancel.style.display = 'none';
}

/** Programmatic safe-cancel hook (app.js / UI can call this). */
export function cancelActiveAgent() {
  return agentState.cancel();
}

/** Paint the orb + core label from the agent's real state. */
function paintState(evt) {
  ensureDom();
  const state = evt.state || 'IDLE';
  const active = agentState.isActive();
  if (_wrap) setOrbState(_wrap, orbOf(state));

  // While the agent is working, the core label shows the agent state.
  if (active) {
    if (_el.listening) {
      _el.listening.textContent = labelOf(state);
      _el.listening.classList.add('active');
    }
    if (_el.state) _el.state.textContent = labelOf(state);
    if (_el.cancel) _el.cancel.style.display = 'block';
    const stepText = (evt.step != null && evt.maxSteps != null)
      ? `STEP ${evt.step} / ${evt.maxSteps}` : '';
    const desc = evt.message ? String(evt.message).slice(0, 60) : '';
    if (_el.step) {
      const parts = [stepText, desc].filter(Boolean).join(' — ');
      _el.step.textContent = parts;
      _el.step.style.display = parts ? '' : 'none';
    }
    show();
  } else {
    // Terminal / idle: restore the VOX-driven label + orb, hide the panel.
    if (_el.listening) {
      _el.listening.textContent = voxLabelOf(vox.get());
      _el.listening.classList.toggle('active', state === 'SUCCESS' ? true : false);
    }
    if (_el.state) _el.state.textContent = state === 'SUCCESS' ? 'SUCCESS' : labelOf(state);
    // Show the terminal badge briefly, then hide.
    hideSoon(evt.state);
  }
}

let _hideTimer = null;
function hideSoon(state) {
  clearTimeout(_hideTimer);
  const delay = state === 'SUCCESS' ? 1400 : state === 'ERROR' || state === 'CANCELLED' ? 1600 : 0;
  _hideTimer = setTimeout(() => {
    ensureDom();
    if (_el.state) _el.state.textContent = '';
    hide();
    if (_wrap) setOrbState(_wrap, voxOrbOf(vox.get()));
  }, delay);
}

/** Paint tool line from agent:tool_start / agent:tool_result. */
function paintToolStart(evt) {
  ensureDom();
  if (_el.tool) _el.tool.textContent = 'TOOL  ' + String(evt.name || '').toUpperCase();
  if (_el.tool) _el.tool.style.display = '';
}
function paintToolResult(evt) {
  ensureDom();
  if (_el.tool) {
    const name = String(evt.name || '').toUpperCase();
    const res = evt.ok ? 'SUCCESS' : 'FAILED';
    _el.tool.textContent = `TOOL  ${name}   →  RESULT ${res}`;
    _el.tool.className = 'agent-row agent-tool ' + (evt.ok ? 'ok' : 'bad');
    _el.tool.style.display = '';
  }
}

/** Paint verification line from agent:verification / agent:retry. */
function paintVerification(evt) {
  ensureDom();
  if (_el.verify) {
    const head = evt.verified ? 'VERIFIED' : 'VERIFICATION FAILED';
    const detail = evt.detail ? String(evt.detail).slice(0, 48) : '';
    _el.verify.textContent = head + (detail ? ' — ' + detail : '');
    _el.verify.className = 'agent-row agent-verify ' + (evt.verified ? 'ok' : 'bad');
    _el.verify.style.display = '';
  }
}
function paintRetry(evt) {
  ensureDom();
  if (_el.verify) {
    _el.verify.textContent = `RETRYING (attempt ${evt.attempt || 1})`;
    _el.verify.className = 'agent-row agent-verify warn';
    _el.verify.style.display = '';
  }
}
function paintComplete(evt) {
  ensureDom();
  if (_el.step) {
    _el.step.textContent = evt.ok ? 'Task complete' : 'Task finished with issues';
    _el.step.style.display = '';
  }
}
function paintError(evt) {
  ensureDom();
  if (_el.state) _el.state.textContent = 'ERROR';
  if (_el.verify) {
    _el.verify.textContent = evt.message ? String(evt.message).slice(0, 60) : 'Something went wrong';
    _el.verify.className = 'agent-row agent-verify bad';
    _el.verify.style.display = '';
  }
  if (_wrap) setOrbState(_wrap, 'error');
  show();
  hideSoon('ERROR');
}
function paintCancelled() {
  ensureDom();
  if (_el.state) _el.state.textContent = 'CANCELLED';
  if (_el.verify) { _el.verify.textContent = 'Action cancelled'; _el.verify.className = 'agent-row agent-verify warn'; _el.verify.style.display = ''; }
  show();
  hideSoon('CANCELLED');
}

/** Boot the integration: subscribe to agent events on the existing Bus. */
export function initAgentHUD() {
  if (_running) return { ok: true };
  if (typeof document === 'undefined' || !document.getElementById) {
    // Headless/test env: still idempotent, just no DOM work.
    _running = true;
    return { ok: true };
  }
  _running = true;

  Bus.on('agent:state', paintState);
  Bus.on('agent:tool_start', paintToolStart);
  Bus.on('agent:tool_result', paintToolResult);
  Bus.on('agent:verification', paintVerification);
  Bus.on('agent:retry', paintRetry);
  Bus.on('agent:complete', paintComplete);
  Bus.on('agent:error', paintError);
  Bus.on('agent:cancelled', paintCancelled);

  return { ok: true };
}
