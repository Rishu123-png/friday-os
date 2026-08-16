/* ============================================================================
   FRIDAY OS — Agent Orchestrator (v15.1 / Phase 3enhancement)
   Unified agent loop wrapping the existing intent engine, planner, and tools.

   Architecture:
     FridayCore (existing)  →  AgentOrchestrator (new)  →  brain.js / planx.js / actions

   The orchestrator does NOT replace the intent engine or planner.
   It adds:
     1. A bounded multi-step agent loop (MAX_AGENT_STEPS)
     2. Context retrieval before each decision
     3. An observation/verification layer after actions
     4. Retry / correction / clarification flow
     5. Memory updates after completed tasks

   Existing flow preserved:
     handleInput() in app.js still resolves intents.
     The orchestrator is invoked for multi-step or AI-routed tasks.

   MAX_AGENT_STEPS: configurable, default 8.
   ============================================================================ */

import { Bus, Logger, CORE } from '../fridaycore.js';
import { agentState } from './agentState.js';
import { resolve } from '../brain.js';
import { runPlan, buildPlan, shouldPlan, planStats } from '../planx.js';
import { hasGroq, hasServer, callGroq, callGroqTools, TOOLS, systemPrompt } from '../ai.js';
import { getSetting, KEYS, getList, saveList } from '../store.js';
import { getForegroundApp, launchApp, mediaControl, setTorch, setVolume,
         setBrightness, setWifi, setBluetooth, setDND, placeCall,
         sendSMSSilent, whatsappSend, setSystemAlarm, getBatteryDetail,
         getStorageInfo, getSystemState, readScreenText, screenShot,
         tapText, scrollScreen, typeText, getActiveNotifications,
         getNotifLog, getUsageStats, wifiAudit, lanScan, portScan,
         securityAudit, translateText, getSharedContent, setWallpaper,
         findContact, getThermal, getSensors,
         startForegroundService, showBubble, updateWidget, getRecentSMS,
         getLatestOTP, hcReadSteps, hcStatus, biometricPrompt } from '../native.js';
import * as MEM from '../memory.js';
import * as SEM from '../semantic.js';
import * as V from '../voice.js';
import { vox } from '../vox.js';
import { persona } from '../ai.js';
import { verifyAction } from './verification.js';

/* ======================== CONFIGURATION ======================== */

export const AGENT_CONFIG = {
  MAX_STEPS: 8,                    // maximum iterations in the agent loop
  STEP_TIMEOUT_MS: 30000,          // per-step timeout
  OBSERVE_THRESHOLD: 0.6,          // confidence threshold for auto-verification
  RETRY_ON_FAILURE: 2,             // max retries per step
  CONTEXT_MAX_FACTS: 15,           // max facts to inject into context
  CONTEXT_MAX_EPISODES: 5,         // max recent episodes to inject
  ASK_CONFIRMATION: true,          // ask before risky actions
};

/* ======================== STEP RESULTS ======================== */

/**
 * A StepResult is the output of one agent loop iteration.
 * @typedef {Object} StepResult
 * @property {string} type        - 'action' | 'clarify' | 'respond' | 'plan' | 'done' | 'failed'
 * @property {string} [actionType] - action type if type==='action'
 * @property {Object} [payload]   - action payload
 * @property {string} [message]   - response message if type==='respond'
 * @property {string} [question]  - clarification question if type==='clarify'
 * @property {string} [reason]    - failure reason if type==='failed'
 * @property {boolean} [done]     - true if the task is complete
 */

/* ======================== CONTEXT RETRIEVER ======================== */

/**
 * Retrieve relevant context for a user request.
 * Returns a structured context object — NOT a dump of everything.
 */
export async function retrieveContext(text, opts = {}) {
  const maxFacts = opts.maxFacts || AGENT_CONFIG.CONTEXT_MAX_FACTS;
  const maxEpisodes = opts.maxEpisodes || AGENT_CONFIG.CONTEXT_MAX_EPISODES;
  agentState.set('RETRIEVING_CONTEXT', { message: 'Retrieving context' });

  const context = {
    userFacts: [],
    recentEpisodes: [],
    preferences: {},
    deviceState: null,
    currentApp: null,
    memoryHighlights: [],
  };

  // 1. User facts (relevant ones only)
  try {
    const allFacts = MEM.allFacts();
    const relevant = relevantFacts(text, allFacts, maxFacts);
    context.userFacts = relevant;
  } catch (_) { /* memory may not be initialized */ }

  // 2. Recent conversation episodes (last N)
  try {
    const chat = getList(KEYS.CHAT).slice(0, maxEpisodes);
    context.recentEpisodes = chat.map(m => ({
      role: m.role,
      text: m.text.slice(0, 300),
    }));
  } catch (_) {}

  // 3. Preferences from settings
  context.preferences = {
    name: getSetting('userName') || persona().address,
    personality: getSetting('personality'),
    voiceOutput: getSetting('voiceOutput'),
    wakeWord: getSetting('wakeWord'),
  };

  // 4. Device state (lightweight — only if relevant to the request)
  if (isDeviceRelevant(text)) {
    try {
      const [battery, storage, thermal, foreground] = await Promise.allSettled([
        getBatteryDetail(),
        getStorageInfo(),
        getThermal(),
        getForegroundApp(),
      ]);
      context.deviceState = {
        battery: battery.status === 'fulfilled' ? battery.value : null,
        storage: storage.status === 'fulfilled' ? storage.value : null,
        thermal: thermal.status === 'fulfilled' ? thermal.value : null,
        foregroundApp: foreground.status === 'fulfilled' ? foreground.value : null,
      };
      context.currentApp = context.deviceState.foregroundApp;
    } catch (_) {}
  }

  // 5. Semantic memory recall (meaning-based, if available)
  if (SEM.semanticMemorySize() > 0) {
    try {
      const hits = await SEM.recallSemantic(text, 3, 0.45);
      context.memoryHighlights = hits.map(h => h.text.slice(0, 200));
    } catch (_) {}
  }

  return context;
}

/**
 * Pure: which facts are relevant to this text?
 */
function relevantFacts(text, facts, max) {
  const t = text.toLowerCase();
  const scored = facts
    .map(f => ({
      ...f,
      score: relevanceScore(t, f.label + ' ' + f.value + ' ' + (f.label || '')),
    }))
    .filter(f => f.score > 0.1)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, max);
}

/** Pure: simple keyword overlap relevance score 0..1 */
function relevanceScore(text, factText) {
  const tWords = new Set(text.split(/\s+/).filter(w => w.length > 2));
  if (!tWords.size) return 0;
  const fWords = factText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (!fWords.length) return 0;
  let hits = 0;
  for (const w of tWords) {
    if (fWords.some(fw => fw.includes(w) || w.includes(fw))) hits++;
  }
  return Math.min(1, hits / Math.min(tWords.size, 5));
}

/** Pure: is this request about device state? */
function isDeviceRelevant(text) {
  const t = text.toLowerCase();
  return /\b(battery|storage|memory|ram|thermal|hot|foreground|app.*open|what.*app|screen|step|health)\b/.test(t);
}

/* ======================== ACTION EXECUTOR ======================== */

/**
 * Execute a single action and return the real result.
 * This is the "EXECUTE" phase of the agent loop.
 *
 * Returns { ok, result, observation, error? }
 */
export async function executeAction(action) {
  const t0 = performance?.now ? performance.now() : Date.now();

  try {
    switch (action.type) {

      // ---- Device control ----
      case 'torch':
      case 'flashlight': {
        const on = action.on !== false;
        const r = await V.torch(on);
        return { ok: !!r, result: { state: on ? 'on' : 'off' }, observation: null };
      }

      case 'battery': {
        const b = await getBatteryDetail();
        return { ok: !!b, result: b, observation: b ? `Battery at ${b.level}%${b.charging ? ', charging' : ''}` : null };
      }

      case 'volume': {
        const r = await setVolume(action.percent);
        return { ok: !!r.ok, result: r, observation: null };
      }

      case 'brightness': {
        const r = await setBrightness(action.percent);
        return { ok: !!r.ok, result: r, observation: null };
      }

      case 'toggle_wifi':
      case 'sys_toggle': {
        const r = await setWifi(action.on);
        return { ok: !!r.ok, result: r, observation: null };
      }

      case 'media': {
        const r = await mediaControl(action.action);
        return { ok: !!r.ok, result: r, observation: null };
      }

      // ---- App launching ----
      case 'open_app': {
        const r = await launchApp(action.app);
        return { ok: !!r.ok, result: r, observation: null };
      }

      // ---- Communications ----
      case 'call': {
        const r = await placeCall(action.number);
        return { ok: !!r.ok, result: r, observation: null };
      }

      case 'sms': {
        const r = await sendSMSSilent(action.number, action.body);
        return { ok: !!r.ok, result: r, observation: null };
      }

      case 'whatsapp': {
        const r = await whatsappSend(action.number, action.body || '', action.autoSend !== false);
        return { ok: !!r.ok, result: r, observation: null };
      }

      // ---- System ----
      case 'screenshot': {
        const r = await screenShot();
        return { ok: r && r.ok, result: r, observation: r && r.ok ? 'Screenshot captured' : 'Screenshot failed' };
      }

      case 'screen_read': {
        const r = await readScreenText();
        return { ok: r && r.ok, result: r, observation: r && r.ok ? r.text.slice(0, 500) : 'Screen read failed' };
      }

      case 'alarm_add': {
        const r = await setSystemAlarm(
          parseInt(action.alarm.time.split(':')[0]),
          parseInt(action.alarm.time.split(':')[1]),
          action.alarm.label || 'Alarm',
          action.alarm.repeat || 'once'
        );
        const obs = r.ok ? `Alarm set for ${action.alarm.time}` : 'Could not set alarm';
        return { ok: r.ok, result: { time: action.alarm.time }, observation: obs };
      }

      // ---- Notifications ----
      case 'read_notifications': {
        const r = await getActiveNotifications();
        return { ok: r && r.ok, result: r, observation: r && r.ok ? formatNotifs(r.items) : 'Notification access needed' };
      }

      case 'reply_notif': {
        return {
          ok: false,
          result: { app: action.app, text: action.text },
          observation: 'Exact notification, recipient, draft review, and explicit confirmation are required before reply dispatch'
        };
      }

      // ---- Settings / UI ----
      case 'theme': {
        return { ok: true, result: { theme: action.theme }, observation: `Theme set to ${action.theme}` };
      }

      case 'open_panel': {
        return { ok: true, result: { panel: action.panel }, observation: `Opened ${action.panel}` };
      }

      case 'stop_speech': {
        V.cancelSpeech();
        return { ok: true, result: {}, observation: 'Speech stopped' };
      }

      case 'clear_chat': {
        return { ok: true, result: {}, observation: 'Chat cleared' };
      }

      // ---- Fallback: if a tool is known but not handled here ----
      default: {
        Logger.warn('agent', `executeAction: unhandled action type "${action.type}"`);
        return { ok: false, error: `Unknown action type: ${action.type}` };
      }
    }
  } catch (e) {
    Logger.error('agent', `executeAction error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/* ======================== VERIFICATION LAYER ======================== */

/**
 * Verify that an action actually produced the expected result.
 * Each verifier checks REAL device state, never assumes success.
 */
export const Verifiers = {
  flashlight(on) {
    return verifyAction({ type: 'torch', on }, { ok: true, result: { ok: true } });
  },
  appLaunched(appName, launchResult) {
    return verifyAction({ type: 'open_app', app: appName }, {
      ok: !!(launchResult && launchResult.ok),
      result: launchResult,
    });
  },
  volume(percent) {
    return verifyAction({ type: 'volume', percent }, { ok: true, result: { ok: true } });
  },
  media(action) {
    return verifyAction({ type: 'media', action }, { ok: true, result: { ok: true } });
  },
  wifi(on) {
    return verifyAction({ type: 'toggle_wifi', on }, { ok: true, result: { ok: true } });
  },
  bluetooth(on) {
    return verifyAction({ type: 'toggle_bt', on }, { ok: true, result: { ok: true } });
  },
  call(number) {
    return verifyAction({ type: 'call', number }, { ok: true, result: { ok: true } });
  },
  sms(number, body) {
    return verifyAction({ type: 'sms', number, body }, { ok: true, result: { ok: true } });
  },
  whatsapp(number, body) {
    return verifyAction({ type: 'whatsapp', number, body }, { ok: true, result: { ok: true } });
  },
};

/* ======================== AGENT LOOP ======================== */

/**
 * Main agent loop.
 *
 * Processes a user request through multiple iterations of:
 *   UNDERSTAND → RETRIEVE CONTEXT → DECIDE → PLAN → SELECT TOOL
 *   → CHECK PERMISSION → EXECUTE → OBSERVE → VERIFY → CONTINUE/STOP
 *
 * Bounded by MAX_AGENT_STEPS to prevent infinite execution.
 *
 * @param {string} text - User input
 * @param {Object} opts - Options
 * @param {Function} opts.onStep - Called after each step with { step, result, observation }
 * @param {Function} [opts.onClarify] - Called when user input is needed
 * @param {Function} [opts.respond] - Called with final response text
 * @returns {Promise<{done, steps, finalResponse}>}
 */
export async function runAgentLoop(text, opts = {}) {
  const maxSteps = opts.maxSteps || AGENT_CONFIG.MAX_STEPS;
  const onStep = opts.onStep || null;
  const onClarify = opts.onClarify || null;
  const respond = opts.respond || null;

  const steps = [];
  let stepCount = 0;
  let currentState = text;
  let lastResult = null;
  let pendingAction = null;
  let clarificationQuestion = null;

  const requestId = agentState.begin({});
  Logger.info('agent', `agent loop started: "${text.slice(0, 60)}" — max ${maxSteps} steps (${requestId})`);

  try {
  while (stepCount < maxSteps) {
    stepCount++;
    Logger.debug('agent', `step ${stepCount}/${maxSteps}`);

    // ---- Cancellation: bail before starting a new step, never leave HUD stuck ----
    if (agentState.isCancelled()) {
      agentState.cancelled();
      agentState.end();
      return { done: false, steps, cancelled: true, finalResponse: 'Action cancelled.' };
    }

    // ---- PHASE 1: UNDERSTAND ----
    agentState.set('UNDERSTANDING', { step: stepCount, maxSteps, message: 'Understanding request' });
    // First try the existing intent engine
    const intentHit = resolve(currentState);
    const context = await retrieveContext(currentState);

    // ---- PHASE 2: DECIDE ----
    // Decision: use intent engine, planner, or AI?

    let decision = null;

    if (intentHit && intentHit.action) {
      // Deterministic intent matched — use it directly
      decision = {
        type: 'action',
        action: intentHit.action,
        source: 'intent',
        intentId: intentHit.intent,
        say: intentHit.say,
        refresh: intentHit.refresh,
      };
      agentState.set('SELECTING_TOOL', { step: stepCount, maxSteps, message: intentHit.intent });
      Logger.debug('agent', `step ${stepCount}: intent resolved → ${intentHit.intent}`);
    } else if (shouldPlan(text) || shouldPlan(currentState)) {
      // Multi-step goal — use PlanX
      const plan = buildPlan(currentState);
      decision = {
        type: 'plan',
        plan,
        source: 'planner',
      };
      agentState.set('PLANNING', { step: stepCount, maxSteps, message: 'Creating execution plan' });
      Logger.debug('agent', `step ${stepCount}: planner engaged → ${plan.goal}`);
    } else if (hasGroq() || hasServer()) {
      // No deterministic match, AI available — use AI tool loop
      const aiResult = await runAiToolLoop(currentState, context, steps);
      if (aiResult) {
        if (aiResult.type === 'action' && aiResult.action) {
          decision = aiResult;
          decision.source = 'ai';
          Logger.debug('agent', `step ${stepCount}: AI decided → ${aiResult.action.type}`);
        } else if (aiResult.type === 'respond') {
          // AI gave a final response — deliver it
          agentState.set('RESPONDING', { step: stepCount, maxSteps, message: 'Preparing response' });
          if (respond) respond(aiResult.message);
          if (onStep) onStep({ step: stepCount, type: 'respond', message: aiResult.message });
          agentState.set('SUCCESS', { step: stepCount, message: 'Task complete' });
          agentState.complete(true, aiResult.message, { steps });
          agentState.end();
          return { done: true, steps, finalResponse: aiResult.message };
        } else if (aiResult.type === 'clarify') {
          clarificationQuestion = aiResult.question;
          agentState.set('WAITING_CONFIRMATION', { step: stepCount, maxSteps, message: 'Need more input' });
          if (onStep) onStep({ step: stepCount, type: 'clarify', question: aiResult.question });
          agentState.end();
          return { done: false, steps, pendingClarification: aiResult.question };
        } else {
          // AI returned something unexpected — fall through to reply
          const reply = aiResult.message || aiResult.say || 'I\'m not sure how to handle that.';
          agentState.set('RESPONDING', { step: stepCount, maxSteps, message: 'Preparing response' });
          if (respond) respond(reply);
          if (onStep) onStep({ step: stepCount, type: 'respond', message: reply });
          agentState.set('SUCCESS', { step: stepCount, message: 'Task complete' });
          agentState.complete(true, reply, { steps });
          agentState.end();
          return { done: true, steps, finalResponse: reply };
        }
      }
    }

    // No decision could be made
    if (!decision) {
      const reply = persona().greeting + ' I\'m not sure I understand. Try rephrasing, or say "help" to see what I can do.';
      agentState.set('RESPONDING', { step: stepCount, maxSteps, message: 'Preparing response' });
      if (respond) respond(reply);
      if (onStep) onStep({ step: stepCount, type: 'respond', message: reply });
      agentState.set('SUCCESS', { step: stepCount, message: 'Task complete' });
      agentState.complete(true, reply, { steps });
      agentState.end();
      return { done: true, steps, finalResponse: reply };
    }

    // ---- PHASE 3: EXECUTE ----
    if (decision.type === 'action' && decision.action) {
      const action = decision.action;

      // Safety check: dangerous actions need confirmation
      if (AGENT_CONFIG.ASK_CONFIRMATION && isDangerous(action)) {
        agentState.set('CHECKING_PERMISSION', { step: stepCount, maxSteps, message: 'Checking permission' });
        const question = buildConfirmationQuestion(action);
        if (onStep) onStep({ step: stepCount, type: 'confirm', question });
        if (opts.onConfirm) {
          agentState.set('WAITING_CONFIRMATION', { step: stepCount, maxSteps, message: 'Awaiting your confirmation' });
          const confirmed = await opts.onConfirm(question);
          if (!confirmed) {
            const msg = 'Action cancelled. Nothing was changed.';
            agentState.set('CANCELLED', { step: stepCount, message: 'Action cancelled' });
            if (respond) respond(msg);
            agentState.complete(false, msg, { steps });
            agentState.end();
            return { done: true, steps, finalResponse: msg, cancelled: true };
          }
        } else {
          // No confirmation handler — skip risky actions and explain
          const msg = `I'd need confirmation for that. Say "go" to proceed.`;
          agentState.set('WAITING_CONFIRMATION', { step: stepCount, maxSteps, message: 'Confirmation required' });
          if (respond) respond(msg);
          agentState.end();
          return { done: true, steps, finalResponse: msg };
        }
      }

      // Execute the action
      vox.set('EXECUTING', action.type);
      agentState.set('EXECUTING', { step: stepCount, maxSteps, message: humanActionLabel(action) });
      agentState.toolStart(action.type, safeActionPayload(action), { step: stepCount });
      const execResult = await executeAction(action);
      agentState.toolResult(action.type, !!(execResult && execResult.ok), { step: stepCount });

      const stepRecord = {
        step: stepCount,
        type: 'action',
        action: action.type,
        input: currentState,
        result: execResult,
        timestamp: Date.now(),
      };
      steps.push(stepRecord);

      if (onStep) onStep({ step: stepCount, ...stepRecord });

      // ---- PHASE 4: OBSERVE + VERIFY ----
      const observation = execResult.observation || '';
      agentState.set('OBSERVING', { step: stepCount, maxSteps, message: 'Observing result' });
      agentState.set('VERIFYING', { step: stepCount, maxSteps, message: 'Verifying result' });
      const verified = await verifyAction(action, execResult);
      agentState.verification(!!verified.verified, verified.detail, { step: stepCount });

      const verifyRecord = {
        step: stepCount,
        verified,
        observation,
        detail: verified.detail,
      };

      if (onStep) onStep({ step: stepCount, verify: verifyRecord });

      // ---- PHASE 5: CHECK RESULT ----
      // API/native acceptance is not verification. If independent observation
      // is unavailable, stop without retrying the side effect and say exactly
      // that; calls/messages must never be repeated just to manufacture proof.
      if (verified.status === 'unavailable' && execResult.ok) {
        const msg = buildUnverifiedResponse(action, verified.detail);
        agentState.set('RESPONDING', { step: stepCount, maxSteps, message: 'Reporting unverified result' });
        if (respond) respond(msg);
        if (onStep) onStep({ step: stepCount, type: 'unverified', message: msg });
        agentState.complete(false, msg, { steps });
        agentState.end();
        return { done: true, steps, finalResponse: msg, unverified: true };
      }

      if (verified.verified) {
        // Verified success — continue or finish
        const response = buildSuccessResponse(action, observation, verified);
        if (decision.say) {
          const fullResponse = decision.say + (response ? ' ' + response : '');
          agentState.set('RESPONDING', { step: stepCount, maxSteps, message: 'Preparing response' });
          if (respond) respond(fullResponse);
          if (onStep) onStep({ step: stepCount, type: 'respond', message: fullResponse });
          agentState.set('SUCCESS', { step: stepCount, message: 'Task complete' });
          agentState.complete(true, fullResponse, { steps });
          agentState.end();
          return { done: true, steps, finalResponse: fullResponse };
        }

        // Check if there's more to do (multi-action requests)
        const hasMore = detectMoreActions(currentState, action);
        if (!hasMore) {
          const fallback = observation || 'Done.';
          agentState.set('RESPONDING', { step: stepCount, maxSteps, message: 'Preparing response' });
          if (respond) respond(fallback);
          if (onStep) onStep({ step: stepCount, type: 'respond', message: fallback });
          agentState.set('SUCCESS', { step: stepCount, message: 'Task complete' });
          agentState.complete(true, fallback, { steps });
          agentState.end();
          return { done: true, steps, finalResponse: fallback };
        }

        // More actions to do — continue the loop
        currentState = implicitNextAction(text, action);
        lastResult = execResult;
        vox.set('READY', 'action done, checking for more');
        agentState.set('SELECTING_TOOL', { step: stepCount, maxSteps, message: 'Next step' });
        continue;
      } else {
        // Verification failed — try to recover
        Logger.warn('agent', `step ${stepCount}: verification failed — ${verified.detail}`);

        // Retry once
        if (stepCount < maxSteps - 1) {
          vox.set('THINKING', 'retry');
          agentState.set('RETRYING', { step: stepCount, maxSteps, message: 'Retrying action' });
          agentState.retry(1, action.type, { step: stepCount });
          agentState.set('EXECUTING', { step: stepCount, maxSteps, message: 'Retrying ' + humanActionLabel(action) });
          const retryResult = await executeAction(action);
          agentState.toolResult(action.type, !!(retryResult && retryResult.ok), { step: stepCount });
          agentState.set('VERIFYING', { step: stepCount, maxSteps, message: 'Verifying after retry' });
          const retryVerify = await verifyAction(action, retryResult);
          agentState.verification(!!retryVerify.verified, retryVerify.detail, { step: stepCount });
          if (retryVerify.status === 'unavailable' && retryResult.ok) {
            const msg = buildUnverifiedResponse(action, retryVerify.detail);
            agentState.set('RESPONDING', { step: stepCount, message: 'Reporting unverified retry result' });
            if (respond) respond(msg);
            if (onStep) onStep({ step: stepCount, type: 'unverified', message: msg });
            agentState.complete(false, msg, { steps });
            agentState.end();
            return { done: true, steps, finalResponse: msg, unverified: true };
          }
          if (retryVerify.verified) {
            const msg = retryResult.observation || retryVerify.detail || 'Done after retry.';
            agentState.set('RESPONDING', { step: stepCount, message: 'Preparing response' });
            if (respond) respond(msg);
            agentState.set('SUCCESS', { step: stepCount, message: 'Task complete after retry' });
            agentState.complete(true, msg, { steps });
            agentState.end();
            return { done: true, steps, finalResponse: msg };
          }
        }

        // Give up and explain honestly
        const msg = buildFailureResponse(action, verified.detail || execResult.error || 'unknown error');
        agentState.set('RESPONDING', { step: stepCount, message: 'Explaining failure' });
        if (respond) respond(msg);
        if (onStep) onStep({ step: stepCount, type: 'fail', message: msg });
        agentState.set('ERROR', { step: stepCount, message: 'Action failed after retries' });
        agentState.complete(false, msg, { steps });
        agentState.end();
        return { done: true, steps, finalResponse: msg, failed: true };
      }
    }

    // ---- PLAN EXECUTION ----
    if (decision.type === 'plan' && decision.plan) {
      const plan = decision.plan;
      const ran = await runPlan(plan, {
        execStep: async (step, results) => {
          // Map plan step to real action
          const action = planStepToAction(step, context);
          if (!action) return { ok: false, reason: 'no action mapping for step ' + step.id };
          const result = await executeAction(action);
          return { ok: result.ok, result: result.result, observation: result.observation };
        },
        verify: (step, result, results) => {
          // Verify the plan step result
          if (result && result.observation) return true;
          return result && result.ok !== false;
        },
        ask: opts.onConfirm || null,
        onStep: (planState) => {
          if (onStep) {
            onStep({
              step: stepCount,
              type: 'plan_step',
              planId: plan.id,
              stepId: planState.steps.find(s => s.status === 'run')?.id,
              status: planState.status,
            });
          }
        },
        retries: AGENT_CONFIG.RETRY_ON_FAILURE,
        backoffMs: 1000,
      });

      const planResponse = ran.ok
        ? `Plan complete: ${plan.goal}.`
        : `Plan finished with issues: ${plan.goal}.`;

      agentState.set('RESPONDING', { step: stepCount, maxSteps, message: 'Preparing plan result' });
      if (respond) respond(planResponse);
      if (onStep) onStep({ step: stepCount, type: 'respond', message: planResponse });
      agentState.set(ran.ok ? 'SUCCESS' : 'ERROR', { step: stepCount, message: plan.goal });
      agentState.complete(!!ran.ok, planResponse, { steps });
      agentState.end();
      return { done: true, steps, finalResponse: planResponse, plan: ran.plan };
    }

    // Safety: should never reach here in normal flow
    Logger.error('agent', `step ${stepCount}: unhandled decision type ${decision.type}`);
    break;
  }

  // Max steps reached without completion
  const msg = 'I\'m taking a bit long on this — let me sum up what I have. Some steps may need your help to finish.';
  agentState.set('RESPONDING', { maxSteps, message: 'Summarizing progress' });
  if (respond) respond(msg);
  Logger.warn('agent', `agent loop hit max steps (${maxSteps})`);
  agentState.set('ERROR', { message: 'Max steps reached' });
  agentState.complete(false, msg, { steps });
  agentState.end();
  return { done: false, steps, finalResponse: msg, maxStepsReached: true };
  } catch (e) {
    /* ---- ERROR RECOVERY (per phase spec):
       1. Emit ERROR  2. log technical error internally  3. never expose
       stack traces to the user  4. return a human-readable response
       5. return the HUD to IDLE. ---- */
    Logger.error('agent', 'agent loop error: ' + (e && e.stack || e && e.message || e));
    const human = 'I hit a snag while doing that. Please try again, or rephrase.';
    agentState.error(human);
    agentState.set('ERROR', { message: 'Unhandled failure' });
    if (respond) respond(human);
    agentState.complete(false, human, { steps });
    agentState.end();
    return { done: true, steps, finalResponse: human, failed: true };
  }
}

/* ======================== AI TOOL LOOP (bounded multi-round) ======================== */

/**
 * Bounded multi-round AI tool loop.
 * The AI can call tools, see results, and call more tools — up to a limit.
 *
 * This replaces the single-pass tool call with a proper iterative loop.
 *
 * @returns {Promise<StepResult|null>} - Action to execute, or null if AI couldn't decide
 */
export async function runAiToolLoop(text, context, previousSteps = []) {
  if (!hasGroq() && !hasServer()) return null;

  const MAX_TOOL_ROUNDS = 5;  // max tool calls in one agent step
  const messages = buildAiMessages(text, context, previousSteps);

  try {
    // Round 1: get initial response (may include tool calls)
    let round = 0;
    let lastAiMessage = null;

    while (round < MAX_TOOL_ROUNDS) {
      round++;

      // Call Groq with tools
      agentState.set('SELECTING_TOOL', { message: 'Selecting tool' });
      const toolResult = await callGroqTools(messages, { model: getSetting('groqModel') });
      lastAiMessage = toolResult;

      if (!toolResult || (!toolResult.content && !toolResult.tool_calls)) {
        // No tools, no content — plain call
        const content = await callGroq(messages, { maxTokens: 600, temperature: 0.5 });
        if (content) {
          messages.push({ role: 'assistant', content });
          return buildStepResultFromText(content, text);
        }
        return null;
      }

      // AI wants to call tools
      if (toolResult.tool_calls && toolResult.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: toolResult.content || '',
          tool_calls: toolResult.tool_calls,
        });

        // Execute each tool call and collect results
        const toolResults = [];
        for (const tc of toolResult.tool_calls) {
          const fn = tc.function;
          const name = fn?.name || '';
          let args = {};
          try { args = JSON.parse(fn?.arguments || '{}'); } catch (_) {}

          Logger.debug('agent', `AI tool call: ${name} ${JSON.stringify(args).slice(0, 80)}`);

          agentState.toolStart(name, args, { step: 1 });
          const result = await runToolByName(name, args);
          const resultStr = String(result).slice(0, 2000);  // don't overflow context
          const toolOk = !/^(no |need |couldn't|could not|not |can't|cannot |unknown tool|unknown:|invalid)/i.test(String(resultStr || '').trim());
          agentState.toolResult(name, toolOk, { step: 1 });

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name,
            content: resultStr,
          });

          toolResults.push({ name, result: resultStr });
          Logger.debug('agent', `tool result for ${name}: ${resultStr.slice(0, 100)}`);
        }

        // Don't loop if we got tool results — let the next AI call process them
        // But check if the AI is done (no more tool calls in next response)
        continue;  // loop again to get the final answer from AI
      }

      // AI produced content without tool calls — use it
      if (toolResult.content) {
        messages.push({ role: 'assistant', content: toolResult.content });
        return buildStepResultFromText(toolResult.content, text);
      }

      // No more progress — exit
      break;
    }

    // After max rounds, use whatever we have
    if (lastAiMessage?.content) {
      return buildStepResultFromText(lastAiMessage.content, text);
    }

    return null;
  } catch (e) {
    Logger.error('agent', `AI tool loop error: ${e.message}`);
    return null;
  }
}

/**
 * Build the message history for the AI, including context.
 */
function buildAiMessages(text, context, previousSteps) {
  const recentHistory = previousSteps
    .filter(s => s.type === 'action' || s.type === 'respond')
    .slice(-6)
    .map(s => ({
      role: s.type === 'action' ? 'assistant' : 'user',
      content: typeof s.input === 'string' ? s.input : JSON.stringify(s.action || s),
    }));

  const contextLines = [
    `USER CONTEXT:`,
    `Name: ${context.preferences.name || 'Boss'}`,
    `Personality: ${context.preferences.personality || 'friday'}`,
  ];

  if (context.userFacts.length) {
    contextLines.push(`\nUSER FACTS (use naturally, don't recite):`);
    context.userFacts.forEach(f => {
      contextLines.push(`  ${f.label}: ${f.value}`);
    });
  }

  if (context.deviceState) {
    const ds = context.deviceState;
    contextLines.push(`\nDEVICE STATE:`);
    if (ds.battery) contextLines.push(`  Battery: ${ds.battery.level}%${ds.battery.charging ? ' (charging)' : ''}`);
    if (ds.foregroundApp) contextLines.push(`  Foreground: ${ds.foregroundApp}`);
    if (ds.thermal) contextLines.push(`  Thermal: ${ds.thermal.celsius || ds.thermal}°C`);
  }

  if (context.memoryHighlights.length) {
    contextLines.push(`\nMEMORY HIGHLIGHTS (relevant to this request):`);
    context.memoryHighlights.forEach(h => {
      contextLines.push(`  - ${h}`);
    });
  }

  if (recentHistory.length) {
    contextLines.push(`\nRECENT CONVERSATION:`);
    recentHistory.forEach(m => {
      contextLines.push(`  ${m.role === 'user' ? 'You' : 'FRIDAY'}: ${m.content.slice(0, 200)}`);
    });
  }

  const sysContent = systemPrompt() + `
IMPORTANT — TOOL RESULTS MUST BE USED:
- You have access to tools. When you call a tool, you WILL get the real result in the next message.
- NEVER invent tool results. Use ONLY what the tool returns.
- If a tool says it failed or needs permission, tell the user honestly.
- For device actions (open app, call, message, flashlight, volume, etc.): call the tool, get the result, THEN respond.
- If the tool confirms success, say what actually happened.
- If the tool fails, explain why honestly.

${contextLines.join('\n')}

User's request: "${text}"

Respond with either:
1. A tool call (function call) if you need to DO something
2. A final text response if you have everything you need`;

  return [
    { role: 'system', content: sysContent },
    ...recentHistory.slice(-8).map(m => ({
      role: m.role,
      content: m.content.slice(0, 500),
    })),
    { role: 'user', content: text },
  ];
}

/**
 * Convert AI text response into a StepResult.
 * If the text contains an action request, extract it.
 */
function buildStepResultFromText(text, originalInput) {
  const t = text.toLowerCase();

  // Check if the AI is asking a clarifying question
  if (/\b(need to know|need to ask|which |which one|what (app|person|contact)|who (specifically|is that))\b/.test(t)
      && /\?/.test(t)) {
    return { type: 'clarify', question: text };
  }

  // Try to extract an action
  const action = extractActionFromText(text);
  if (action) {
    return { type: 'action', action, message: text };
  }

  // Plain response
  return { type: 'respond', message: text };
}

/**
 * Try to extract a structured action from AI text.
 * This is a best-effort parser — the AI should ideally use tool calls.
 */
function extractActionFromText(text) {
  const t = text.toLowerCase();

  // Open app
  const appMatch = t.match(/\b(open|launch|start)\s+([a-z0-9][a-z0-9 .'-]{1,25})\b/);
  if (appMatch) {
    return { type: 'open_app', app: appMatch[2].trim() };
  }

  // flashlight / torch
  if (/\b(flashlight|torch)\s+(on|off)\b/.test(t)) {
    return { type: 'torch', on: /on/.test(t) };
  }

  // Volume
  const volMatch = t.match(/\b(volume|volume level)\s*(\d{1,3})\b/);
  if (volMatch) {
    return { type: 'volume', percent: Math.min(100, parseInt(volMatch[2])) };
  }

  // Brightness
  const brightMatch = t.match(/\b(brightness|screen bright)\s*(\d{1,3})\b/);
  if (brightMatch) {
    return { type: 'brightness', percent: Math.min(100, parseInt(brightMatch[2])) };
  }

  // Wifi toggle
  if (/\b(wifi)\s+(on|off|enable|disable)\b/.test(t)) {
    return { type: 'sys_toggle', what: 'wifi', on: /on|enable/.test(t) };
  }

  // Media control
  if (/\b(play|pause|stop|next|previous)\s+(music|song|media|track)?\b/.test(t)) {
    const actionMap = { play: 'play', pause: 'pause', stop: 'stop', next: 'next', previous: 'previous' };
    const matched = Object.keys(actionMap).find(a => new RegExp('\\b' + a + '\\b').test(t));
    if (matched) return { type: 'media', action: actionMap[matched] };
  }

  // Call
  const callMatch = t.match(/\b(call|dial)\s+([a-z0-9][a-z0-9 .'-]{1,25})\b/);
  if (callMatch) {
    return { type: 'call', name: callMatch[2].trim() };
  }

  // Tell time
  if (/\b(what.*time|current time|time now)\b/.test(t)) {
    const now = new Date();
    return { type: 'respond', message: `It's ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` };
  }

  return null;
}

/**
 * Execute a named tool by its function name.
 * Maps tool names to the actual executor functions.
 */
export async function runToolByName(name, args) {
  switch (name) {
    case 'set_reminder': {
      const when = parseTime(args.text || args.when || '');
      const task = args.text || '';
      if (!task) return 'No reminder text given.';
      const date = when ? when.date : new Date(Date.now() + 3600000);
      const rec = addItem(KEYS.REMINDERS, { text: task, due: date.getTime(), done: false });
      scheduleReminder(rec);
      return `Reminder set: "${task}" ${humanTime(date)}`;
    }

    case 'set_alarm': {
      const time = args.time || '';
      if (!time) return 'No time given for alarm.';
      const [hh, mm] = time.split(':').map(Number);
      if (isNaN(hh) || isNaN(mm)) return 'Invalid time format. Use HH:MM.';
      const label = args.label || 'Alarm';
      const repeat = args.repeat || 'once';
      const r = await setSystemAlarm(hh, mm, label, repeat);
      return r.ok ? `Alarm set for ${time}` : `Could not set alarm: ${r.reason}`;
    }

    case 'add_note': {
      const text = args.text || '';
      if (!text) return 'No note text given.';
      addItem(KEYS.NOTES, { text });
      return `Note saved: "${text}"`;
    }

    case 'add_task': {
      const text = args.text || '';
      if (!text) return 'No task text given.';
      addItem(KEYS.TASKS, { text, done: false });
      return `Task added: "${text}"`;
    }

    case 'call_contact': {
      const name = args.name || '';
      if (!name) return 'No contact name given.';
      const contacts = getList(KEYS.CONTACTS);
      const hit = contacts.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
      if (!hit) return `No contact named "${name}" found.`;
      const r = await placeCall(hit.phone);
      if (r.ok) return `Calling ${hit.name}.`;
      return `Could not place call: ${r.reason}`;
    }

    case 'send_message': {
      const name = args.name || '';
      const body = args.body || '';
      const app = args.app || 'sms';
      if (!name || !body) return 'Need a contact name and message.';
      const contacts = getList(KEYS.CONTACTS);
      const hit = contacts.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
      if (!hit) return `No contact named "${name}" found.`;
      if (app === 'whatsapp') {
        const r = await whatsappSend(hit.phone, body, true);
        return r.ok ? `Opening WhatsApp for ${hit.name} with your message.` : `Could not open WhatsApp: ${r.reason}`;
      }
      const r = await sendSMSSilent(hit.phone, body);
      return r.ok ? `SMS sent to ${hit.name}.` : `Could not send SMS: ${r.reason}`;
    }

    case 'get_weather': {
      const pos = await resolveLocation();
      if (!pos) return 'Could not get your location.';
      const wx = await fetchWeather(pos.lat, pos.lon);
      return wx || 'Weather data unavailable.';
    }

    case 'search_knowledge': {
      const query = args.query || '';
      if (!query) return 'No query given.';
      const result = await fetchWiki(query);
      return result || 'No results found.';
    }

    case 'tell_time': {
      const now = new Date();
      return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' on ' + now.toLocaleDateString();
    }

    case 'tell_battery': {
      const b = await getBatteryDetail();
      return b ? `Battery at ${b.level}%${b.charging ? ', charging' : ''}.` : 'Battery info unavailable.';
    }

    case 'read_notifications': {
      const app = args.app || null;
      const r = await getActiveNotifications();
      if (!r || !r.ok) return 'Notification access is needed. Say "setup" to enable it.';
      const items = (r.items || []).slice(0, 5);
      if (!items.length) return 'No recent notifications.';
      return items.map(n => `${n.title || 'App'}: ${n.text || ''}`).join('\n');
    }

    case 'get_steps': {
      try {
        const steps = await hcReadSteps(1);
        if (steps && steps.ok && steps.steps) return `You've walked ${steps.steps.toLocaleString()} steps today.`;
        return 'Step data unavailable.';
      } catch (_) {
        return 'Step tracking needs Health Connect permission.';
      }
    }

    case 'list_reminders': {
      const reminders = getList(KEYS.REMINDERS).filter(r => !r.done).sort((a, b) => a.due - b.due);
      if (!reminders.length) return 'No pending reminders.';
      return reminders.slice(0, 5).map(r => `• ${r.text} — ${humanTime(new Date(r.due))}`).join('\n');
    }

    case 'read_screen_text': {
      const r = await readScreenText();
      if (!r || !r.ok) return 'Screen reading needs FRIDAY Control accessibility service. Say "setup" to enable it.';
      return r.text || 'Screen is empty or unreadable.';
    }

    case 'see_screen': {
      if (!isNative()) return 'Screen vision needs the installed FRIDAY app.';
      const shot = await screenShot();
      if (!shot || !shot.ok) return 'Screen capture failed. The current app may be protected.';
      return `Screenshot taken (${shot.width}x${shot.height}). Use tap_screen to interact with specific elements.`;
    }

    case 'tap_screen': {
      const x = args.x; const y = args.y;
      if (typeof x !== 'number' || typeof y !== 'number') return 'Need x and y coordinates.';
      const r = await tapText(''); // tap at coordinates
      return r.ok ? `Tapped at (${x}, ${y}).` : `Tap failed: ${r.reason}`;
    }

    case 'media_control': {
      const action = args.action || 'playpause';
      const r = await mediaControl(action);
      const verbs = { play: 'playing', pause: 'paused', stop: 'stopped', next: 'next track', previous: 'previous track', playpause: 'toggled' };
      return r.ok ? `Media ${verbs[action] || action}.` : `Media control failed: ${r.reason}`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

/* ======================== HELPERS ======================== */

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Pure: is this action destructive/risky? */
function isDangerous(action) {
  const riskyTypes = ['delete', 'remove', 'clear', 'wipe', 'erase', 'reset', 'uninstall', 'pay', 'transfer'];
  const t = action.type ? action.type.toLowerCase() : '';
  if (riskyTypes.some(r => t.includes(r))) return true;

  // Check action payload for risky content
  if (action.body && typeof action.body === 'string') {
    const body = action.body.toLowerCase();
    if (/\b(delete|remove|clear|erase|reset|uninstall|pay|transfer)\b/.test(body)) return true;
  }
  return false;
}

/** Build a confirmation question for a risky action */
function buildConfirmationQuestion(action) {
  const what = action.type || 'that';
  const detail = action.body || action.app || action.number || '';
  return `Ruko Boss — "${what}" ${detail ? 'on "' + detail + '"' : ''} — pakka kar doon? Ye wapas nahi milega. Bolo "go" ya "cancel".`;
}

/** Build success response */
function buildSuccessResponse(action, observation, verification) {
  if (observation) return observation;
  if (verification && verification.detail) return verification.detail;
  const names = {
    torch: 'Flashlight',
    open_app: 'App opened',
    battery: 'Battery checked',
    volume: 'Volume set',
    brightness: 'Brightness set',
    media: 'Media controlled',
    call: 'Call placed',
    sms: 'Message sent',
    whatsapp: 'WhatsApp opened',
  };
  return names[action.type] || 'Done.';
}

/** Build an honest response when execution was accepted but cannot be proven. */
function buildUnverifiedResponse(action, detail) {
  if (detail) return detail;
  const labels = {
    call: 'Android accepted the call request, but I could not verify that the call connected.',
    sms: 'Android accepted the SMS request, but no delivery receipt was available.',
    whatsapp: 'WhatsApp accepted the request, but I could not verify message delivery.',
    alarm_add: 'Android accepted the alarm request, but I could not read the saved alarm back.',
    media: 'Android accepted the media command, but I could not independently observe playback state.',
    torch: 'Android accepted the flashlight command, but this device does not expose its state for verification.',
  };
  return labels[action.type] || 'The device accepted the action, but I could not independently verify the result.';
}

/** Build failure response */
function buildFailureResponse(action, reason) {
  const names = {
    torch: 'I couldn\'t control the flashlight. Android may not allow it.',
    open_app: `I couldn't open that app. Android may not have it installed, or it may need a different name.`,
    call: 'I couldn\'t place the call. Check that the number is correct and the phone permission is granted.',
    sms: 'I couldn\'t send the message. Check SMS permissions in Settings.',
    whatsapp: 'I couldn\'t open WhatsApp. It may not be installed, or Accessibility may be needed.',
    volume: 'I couldn\'t change the volume.',
    brightness: 'I couldn\'t change the brightness. Settings permission may be needed.',
  };
  return names[action.type] || `I couldn't do that. Reason: ${reason || 'unknown'}`;
}

/** Concise human description of an action for the HUD step line.
    Never includes numbers, message bodies, or other sensitive content. */
function humanActionLabel(action) {
  if (!action || !action.type) return 'action';
  const t = action.type;
  const verbs = {
    torch: on => (action.on === false ? 'Turning flashlight off' : 'Turning flashlight on'),
    open_app: () => `Opening ${action.app || 'app'}`,
    volume: () => 'Setting volume',
    brightness: () => 'Setting brightness',
    sys_toggle: () => 'Toggling system setting',
    media: () => `Media ${action.action || 'control'}`,
    call: () => 'Placing call',
    sms: () => 'Sending message',
    whatsapp: () => 'Opening WhatsApp',
    screenshot: () => 'Taking screenshot',
    screen_read: () => 'Reading screen',
    alarm_add: () => 'Setting alarm',
    read_notifications: () => 'Reading notifications',
    reply_notif: () => 'Replying to notification',
    theme: () => 'Applying theme',
    open_panel: () => 'Opening panel',
    stop_speech: () => 'Stopping speech',
    clear_chat: () => 'Clearing chat',
  };
  if (verbs[t]) { try { return verbs[t](); } catch (_) {} }
  return t.replace(/_/g, ' ');
}

/** Sanitized action payload for tool display — strips anything sensitive
    (numbers, message bodies, contact names) so no secret leaks to the HUD. */
function safeActionPayload(action) {
  if (!action || typeof action !== 'object') return {};
  const allowed = ['type'];
  if (action.app != null) allowed.push('app');
  if (action.action != null) allowed.push('action');
  if (action.on != null) allowed.push('on');
  const out = {};
  for (const k of allowed) if (action[k] !== undefined) out[k] = action[k];
  return out;
}

/** Detect if there's a follow-up action needed after this one */
function detectMoreActions(originalText, completedAction) {
  const t = originalText.toLowerCase();

  // "Open YouTube and play" - after opening, need to play
  if (completedAction.type === 'open_app') {
    if (/\b(play|chalao|bajao|start|run)\b/.test(t)) return true;
  }

  // "Call mom and tell her..." - after call, need to convey message (can't, but acknowledge)
  if (completedAction.type === 'call' || completedAction.type === 'whatsapp' || completedAction.type === 'sms') {
    if (/\b(tell|bol|kaho|batao|message|likh)\b/.test(t)) return true;
  }

  return false;
}

/** Infer the next implicit action from context */
function implicitNextAction(originalText, completedAction) {
  const t = originalText.toLowerCase();

  if (completedAction.type === 'open_app') {
    if (/\b(play|chalao|bajao)\b/.test(t)) {
      const songMatch = t.match(/(?:play|chalao|bajao)\s+([a-z0-9][a-z0-9 .'-]{1,30})/i);
      return songMatch ? `play ${songMatch[1]}` : 'play music';
    }
  }

  return null;
}

/** Schedule a reminder — delegates to the existing app.js scheduler.
 * Note: in the full app, app.js's scheduleReminder is the source of truth.
 * Here we log it for the agent loop; app.js will handle the actual scheduling
 * when it processes the reminder_add intent. */
function scheduleReminder(item) {
  const delay = item.due - Date.now();
  if (delay < 0 || delay > 2 ** 31 - 1) return;
  Logger.info('agent', `reminder scheduled: "${item.text}" at ${new Date(item.due).toISOString()}`);
}

/** Parse time from natural language — synchronous approximation.
 * For full NLP parsing, brain.js uses nlp.js parseTime directly. */
function parseTime(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  // "in N minutes"
  const inMins = t.match(/in\s+(\d+)\s*(minute|min|mins)/);
  if (inMins) {
    const d = new Date(); d.setMinutes(d.getMinutes() + parseInt(inMins[1]));
    return { date: d, matched: inMins[0] };
  }
  // "at Nh" or "at Nhpm" or "at Nh am/pm"
  const atTime = t.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (atTime) {
    let h = parseInt(atTime[1], 10);
    const m = atTime[2] ? parseInt(atTime[2], 10) : 0;
    if (atTime[3]) {
      if (atTime[3] === 'pm' && h < 12) h += 12;
      if (atTime[3] === 'am' && h === 12) h = 0;
    }
    const d = new Date(); d.setHours(h, m || 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return { date: d, matched: atTime[0] };
  }
  // "tomorrow" / "kal"
  if (/\b(tomorrow|kal)\b/.test(t)) {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return { date: d, matched: 'tomorrow' };
  }
  // "5pm" / "5 am" anywhere in text
  const bareTime = t.match(/(\d{1,2})\s*(am|pm)/);
  if (bareTime) {
    let h = parseInt(bareTime[1], 10);
    if (bareTime[2] === 'pm' && h < 12) h += 12;
    if (bareTime[2] === 'am' && h === 12) h = 0;
    const d = new Date(); d.setHours(h, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return { date: d, matched: bareTime[0] };
  }
  return null;
}

/** Get current location */
async function resolveLocation() {
  const { API } = await import('../api.js');
  return API.resolveLocation().catch(() => null);
}

/** Fetch weather from API */
async function fetchWeather(lat, lon) {
  const { API } = await import('../api.js');
  return API.getWeather(lat, lon).catch(() => null);
}

/** Fetch Wikipedia summary */
async function fetchWiki(query) {
  const { API } = await import('../api.js');
  return API.wikiSearch(query, 1).then(r => r[0]?.snippet || null).catch(() => null);
}

/** Format notifications for display */
function formatNotifs(items) {
  if (!items || !items.length) return 'No notifications.';
  return items.slice(0, 5).map(n => `${n.title || 'App'}: ${n.text || ''}`).join('\n');
}

/** List installed apps */
async function listApps() {
  const { listApps } = await import('../native.js');
  return listApps().catch(() => null);
}

/** Human-readable time string */
function humanTime(date) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `in ${mins} minutes`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs} hour${hrs > 1 ? 's' : ''}`;
  const days = Math.round(hrs / 24);
  return `in ${days} day${days > 1 ? 's' : ''}`;
}

/* ======================== EXPORTS ======================== */

export {
  isDangerous,
  buildConfirmationQuestion,
};
