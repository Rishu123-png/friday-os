/* ===== FRIDAY OS v6 — Main Controller =====
   Offline-first. Optional Groq key. Nothing required to run. */

import * as S from './store.js';
import { KEYS } from './store.js';
import * as V from './voice.js';
import * as U from './ui.js';
import * as D from './device.js';
import * as API from './api.js';
import * as AI from './ai.js';
import { resolve, intentCount } from './brain.js';
import * as VIS from './vision.js';
import * as T from './templates.js';
import * as MEM from './memory.js';
import * as PRO from './proactive.js';
import * as NLU from './nlu.js';
import * as AUTO from './automation.js';
import * as NAT from './native.js';
import * as CODER from './coder.js';
import * as VAULT from './vault.js';
import * as HACKER from './hacker.js';
import * as HEALTH from './health.js';
import * as I18N from './i18n.js';
import * as LB from './localbrain.js';
import * as AMB from './ambient.js';
import * as CLARIFY from './clarify.js';
import * as SEM from './semantic.js';
import * as SUIT from './suit.js';
import * as HERALD from './herald.js';
import * as PROACTIVE from './proactive-assistant.js';
import { CORE, Bus, Logger } from './fridaycore.js';   // v11 Phase 1
import * as IGN from './ignite.js';   // v11.1 Phase 2: cinematic boot
import * as HUD from './hud.js';      // v11.1 Phase 3: living HUD
import * as VOX from './vox.js';      // v11.2 Phase 4: Voice Engine 2.0 — formal state machine
import * as MEMEX from './memex.js';  // v11.3 Phase 5: Cognitive Memory Engine
import * as VISIONX from './visionx.js'; // v11.3 Phase 6: AI Vision System
import * as AUTOX from './autox.js';  // v11.3 Phase 7: Intelligent Automation Engine
import * as AIR from './airouter.js'; // v15 Phase 3: AI Router + Analytics
import * as WF from './workflow.js';  // v15 Phase 3: AI Workflow Engine
import * as NOTESX from './notesx.js';// v15 Phase 4: AI Notes
import * as DOCAI from './docai.js';  // v15 Phase 4: AI Document Assistant
import * as KNOW from './knowledge.js';// v15 Phase 4: Personal Knowledge Base
import * as PLANX4 from './plannerx.js';// v15 Phase 4: Smart Planner
import * as STUDYX from './studyx.js'; // v15 Phase 5: AI Study Assistant
import * as GUARD from './guardian.js';// v15 Phase 6: Personal Guardian
import * as PLUGINS from './plugins.js';// v15 pre-10: Plugin System
import * as UIX from './uix.js';       // v15 Phase 8: Premium UI/UX
import * as DEVCON from './devconsole.js';// RC1: developer console + telemetry
import * as PLANX from './planx.js';  // v12.0 Phase 8: AI Planner & Reasoning Engine
import * as INTELX from './intelx.js';// v12.1 Phase 9: Intelligence & Context Engine
import * as DEVX from './devx.js';    // v12.2 Phase 10: Device Engine
import * as SECX from './secx.js';    // v13.0 Phase 11: Security & Privacy Framework
import * as PERFX from './perfx.js';  // v13.1 Phase 12: Performance & Optimization
import * as CINEX from './cinex.js';  // v13.2 Phase 13: Cinematic UX
import * as HUDV20 from './hud_v20.js'; // v20.0 HUD real-data engine
/* v15.1 AGENT ORCHESTRATOR: unified agent loop wrapping intent engine + planner + AI */
import { runAgentLoop, AGENT_CONFIG } from './agent/orchestrator.js';
/* PHASE 2: REAL AGENT HUD STATE INTEGRATION — agent state → existing HUD */
import { initAgentHUD } from './hud-agent.js';
import { BootDiagnostics, BOOT_STATE, settleOptional } from './boot-runtime.js';

/* Phase 3 boot truth: mandatory shell/core, everything else degrades. */
export const BOOT = new BootDiagnostics();
BOOT.define('FRIDAY CORE', { mandatory: true });
BOOT.define('HUD', { mandatory: true });
BOOT.define('ANDROID BRIDGE');
BOOT.define('MEMORY');
BOOT.define('VOICE');
BOOT.define('WAKE WORD');
BOOT.define('VISION');
BOOT.define('LOCAL AI');
BOOT.define('GROQ');
BOOT.define('BLACKBOX');
BOOT.define('AUTOMATION');
if (typeof window !== 'undefined') window.__fridayBoot = BOOT;

/* ================= v11.0 Phase 1: FridayCore wiring =================
   PRESERVE-FIRST: modules are NOT rewritten — they register with the core
   and give it lifecycle + health probes. The bus becomes the one place
   where cross-module signals flow. */
const bootFridayCore = () => {
  if (bootFridayCore.done) return; bootFridayCore.done = true;
  /* v14.1: every health probe is wrapped — a crash in one module must report
     ITS OWN error (shown in the diagnostics/status), not "health probe crash",
     and can never take down the health loop. */
  const probe = (name, fn) => {
    try { return fn() || { ok: false, detail: name + ': no result' }; }
    catch (e) { Logger.error('core', name + ' health probe error: ' + (e && e.message || e)); return { ok: false, detail: name + ' error: ' + (e && e.message || e).slice(0, 80) }; }
  };
  try {
    CORE.register('voice', {
      health: () => probe('voice', () => ({ ok: VOX.vox.get() !== 'ERROR' && VOX.vox.get() !== 'OFFLINE',
        detail: VOX.vox.get().toLowerCase() + ((typeof V.isSherpaVoiceArmed === 'function' && V.isSherpaVoiceArmed()) ? ' · neural' : '')
          + (V.isWakeActive && V.isWakeActive() ? ' · ears on' : '') }))
    });
    CORE.register('memory', {
      health: () => probe('memory', () => { const d = MEMEX.dashboard(); return { ok: true, detail: d.facts + ' facts · ' + d.summaries + ' digests' }; })
    });
    /* v11.3: Phase 5/6/7 engines report as services too */
    CORE.register('cognition', {
      health: () => probe('cognition', () => { const d = MEMEX.dashboard(); return { ok: true, detail: d.retrievalMs + 'ms recall · ' + d.preferenceRows + ' prefs' }; })
    });
    CORE.register('visionx', {
      health: () => probe('visionx', () => { const d = MEMEX.dashboard(); return { ok: true, detail: d.vision + ' scans · ' + d.qr + ' qr' }; })
    });
    CORE.register('autox', {
      health: () => probe('autox', () => { const d = AUTOX.dashRows(); return { ok: true, detail: d.enabled + '/' + d.rules + ' rules' + (d.last ? ' · ok ' + (d.okRate ?? '—') + '%' : '') }; })
    });
    /* v12.0-12.2: Phases 8-10 engines report as services too */
    CORE.register('planx', {
      health: () => probe('planx', () => { const s = PLANX.planStats(); return { ok: true, detail: s.total + ' plans · ' + s.failRate + '% fail · ' + s.retries + ' retries' }; })
    });
    CORE.register('intelx', {
      health: () => probe('intelx', () => { const d = INTELX.dashboard(); return { ok: true, detail: d.samples + ' obs · wake ' + (d.wakeHour != null ? d.wakeHour + ':00' : '?') + ' · apps ' + d.frequentApps.length }; })
    });
    CORE.register('devx', {
      health: () => probe('devx', () => { const d = DEVX.dashboard(); return { ok: true, detail: (d.battery && d.battery.pct != null ? d.battery.pct + '%' : '—') + ' · ' + (d.storage && d.storage.freeGB != null ? d.storage.freeGB + 'GB free' : '—') + (d.thermal && d.thermal.celsius != null ? ' · ' + d.thermal.celsius + '°C' : '') + (d.sensors && d.sensors !== 'no sensors' ? ' · ' + d.sensors.split(', ').length + ' sensors' : '') + (d.thermal && d.thermal.tier === 'hot' ? ' · 🔥' : '') }; })
    });
    /* v13.0-13.2: Phases 11-13 engines report as services too */
    CORE.register('secx', {
      health: () => probe('secx', () => { const d = SECX.dashboard(); return { ok: true, detail: (d.appLock ? '🔒 locked · ' : '') + d.audits + ' audits · ' + d.alerts.length + ' alerts' }; })
    });
    CORE.register('perfx', {
      health: () => probe('perfx', () => { const d = PERFX.dashboard(); return { ok: true, detail: (d.fps || '—') + ' fps · ' + (d.ram && d.ram.usedPct != null ? d.ram.usedPct + '% ram' : 'ram —') + ' · ' + (d.aiLatencyMs != null ? d.aiLatencyMs + 'ms ai' : 'ai —') }; })
    });
    /* v15 Phase 4: Smart Productivity engines report as services */
    CORE.register('notesx', {
      health: () => probe('notesx', () => { const s = NOTESX.noteStats(); return { ok: true, detail: s.total + ' notes · ' + s.folders + ' folders · ' + s.pinned + ' pinned' }; })
    });
    CORE.register('docai', {
      health: () => probe('docai', () => { const s = DOCAI.docStats(); return { ok: true, detail: s.total + ' docs · ' + s.kinds.pdf + ' pdf' }; })
    });
    CORE.register('knowledge', {
      health: () => probe('knowledge', () => { const s = KNOW.kbStats(); return { ok: true, detail: s.total + ' items · ' + s.bytesHuman }; })
    });
    CORE.register('plannerx', {
      health: () => probe('plannerx', () => { const s = PLANX4.plannerStats(); return { ok: true, detail: s.openTasks + ' tasks · ' + s.pendingReminders + ' reminders · ' + s.today + ' today' }; })
    });
    /* v15 Phase 5-9: Study · Guardian · Plugins · UI report as services */
    CORE.register('studyx', {
      health: () => probe('studyx', () => { const p = STUDYX.progress(); return { ok: true, detail: p.sessions + ' sessions · ' + p.weekMin + 'm/wk · streak ' + p.streak }; })
    });
    CORE.register('guardian', {
      health: () => probe('guardian', () => { const s = GUARD.guardianStats(); return { ok: true, detail: s.timers + ' timers · ' + s.confirmedToday + ' confirmed today' }; })
    });
    CORE.register('plugins', {
      health: () => probe('plugins', () => { const s = PLUGINS.pluginStats(); return { ok: true, detail: s.installed + ' plugins · ' + s.enabled + ' enabled' }; })
    });
    CORE.register('uix', {
      health: () => probe('uix', () => ({ ok: true, detail: UIX.isTablet() ? 'tablet layout' : 'phone · ' + UIX.layoutHint().mode }))
    });
    CORE.register('devconsole', {
      health: () => probe('devconsole', () => ({ ok: true, detail: 'telemetry ' + (DEVCON.telemetryOn() ? 'on' : 'off') + ' · ' + DEVCON.telemetry().length + ' entries' }))
    });
    /* v15 Phase 3: AI router + workflow report as services */
    CORE.register('air', {
      health: () => probe('air', () => { const d = AIR.aiDiagnostics(); return { ok: true, detail: d.available.length + ' providers · ' + d.totalCalls + ' calls · fail ' + d.providers.reduce((a, p) => a + (p.fail || 0), 0) }; })
    });
    CORE.register('workflow', {
      health: () => probe('workflow', () => ({ ok: true, detail: WF.workflowLog().length + ' runs' }))
    });
    CORE.register('cinex', {
      health: () => probe('cinex', () => { const a = CINEX.a11ySettings(); return { ok: true, detail: 'fx ' + (S.getSetting('cinematic') !== false ? 'on' : 'off') + (a.highContrast ? ' · hc' : '') + (a.reducedMotion.particles === false ? ' · rm' : '') }; })
    });
    CORE.register('vision', { health: () => probe('vision', () => ({ ok: true, detail: 'camera on demand' })) });
    CORE.register('automation', { health: () => probe('automation', () => ({ ok: true, detail: 'routines+alarms' })) });
    CORE.register('notifications', {
      health: () => probe('notifications', () => ({ ok: true, detail: NAT.isNative() ? 'listener service' : 'web mode (native only)' }))
    });
    /* a few live signals onto the bus — keep chatter tiny */
    Bus.on('service:error', ev => { state.systemsRows = state.systemsRows || []; });
    Bus.emit('core:online', { at: Date.now() });
    CORE.boot().catch(() => {});
  } catch (e) { Logger.error('core', 'boot wiring failed: ' + (e && e.message)); }
};
import * as SERVER from './server.js';
import * as ACTION_DEVICE from './action-device.js';
import { humanTime, parseTime, pick, stripFillers } from './nlp.js';

const $ = U.$, $$ = U.$$;

const state = {
  listening: false, speaking: false, processing: false,
  messages: [], expect: null, lastTopic: null, lastSubject: null, booted: false,
  vaultPending: null, proactiveEvent: null, proactiveReminder: null, pendingInboxSend: null
};

/* ================= BOOT (v11.1 IGNITION: cinematic + REAL checks) ================= */
async function boot() {
  const firstRun = !S.getSetting('bootSeen');
  let reduced = false;
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
  if (S.getSetting('particleEffects') === false) reduced = true;
  VOX.vox.set('INITIALIZING', 'boot sequence');          // v11.2 VOX: engine wakes
  const plan = IGN.bootPlan({ mode: S.getSetting('bootMode') || 'auto', firstRun, reduced });
  if (!plan.stages.length) {
    /* boot OFF: go straight to the HUD, but init() ALWAYS runs */
    await startApp();
    try { await init(); window.__stage = 'online'; }
    catch (err) { BOOT.set('HUD', BOOT_STATE.FAILED, err && err.message); window.__stage = 'init-failed'; }
    window.__booted = BOOT.finish();
    return;
  }

  /* app init starts IMMEDIATELY and runs in parallel with the movie */
  let initError = null;
  const initPromise = Promise.resolve().then(init)
    .then(() => { window.__stage = 'online'; })
    .catch(err => { initError = err; BOOT.set('HUD', BOOT_STATE.FAILED, err && err.message); window.__stage = 'init-failed'; Logger.error('boot', 'init failed: ' + (err && err.message || err)); });
  try {
    await IGN.runIgnition({
      root: $('#bootScreen'),
      plan,
      checks: bootChecks(),
      services: [{ name: 'voice' }, { name: 'memory' }, { name: 'vision' }, { name: 'automation' }, { name: 'notifications' }],
      scan: bootScan(),
      welcome: IGN.welcomeLines(new Date().getHours(), S.getSetting('userName') || 'Boss'),
      initPromise,
      sound: !!S.getSetting('bootSound'),
      bus: Bus,
      core: CORE
    });
  } catch (e) { Logger.error('boot', 'ignition crashed safely: ' + (e && e.message)); }
  await startApp();
  S.setSetting('bootSeen', true);   // next boots: short version (skip-after-first-launch rule)
  await initPromise;
  window.__booted = BOOT.finish();
  if (initError) Logger.error('boot', 'continuing in limited mode: ' + (initError && initError.message || initError));
}

/* v11.1: every boot line shows a REAL system truth (never invented). */
function bootChecks() {
  const row = (name, fallback = BOOT_STATE.PENDING) => ({
    label: name,
    run: async () => {
      const r = BOOT.get(name) || { state: fallback, detail: '' };
      const ok = r.state === BOOT_STATE.READY;
      return { ok, detail: r.state + (r.detail ? ' · ' + r.detail : '') };
    }
  });
  return [
    row('FRIDAY CORE'), row('ANDROID BRIDGE'), row('MEMORY'), row('VOICE'),
    row('WAKE WORD'), row('VISION'), row('LOCAL AI'), row('GROQ'),
    row('BLACKBOX'), row('AUTOMATION'), row('HUD')
  ];
}

function bootScan() {
  return [
    { label: 'CPU', run: async () => ({ ok: true, detail: (navigator.hardwareConcurrency || '?') + ' cores' }) },
    { label: 'Battery', run: async () => { const b = await D.battery(); return b ? { ok: true, detail: HUD.batteryLabel(b.level, b.charging) } : { ok: false, detail: 'n/a' }; } },
    { label: 'Storage', run: async () => {
        /* v15: real device storage in the APK; browser-origin quota is NOT
           device storage (it showed misleading "0.0/10.0 GB") — so in web we
           say n/a instead of reporting a number that means nothing. */
        if (NAT.isNative()) {
          const r = await NAT.getStorageInfo().catch(() => null);
          if (r && r.ok && r.totalGB) return { ok: true, detail: (typeof r.freeGB === 'number' ? r.freeGB.toFixed(1) : '?') + ' GB free' };
          return { ok: false, detail: 'n/a' };
        }
        return { ok: false, detail: 'n/a' };
      } },
    { label: 'Network', run: async () => ({ ok: navigator.onLine, detail: HUD.netLabel(navigator.onLine) }) },
    { label: 'FRIDAY Cloud', run: async () => {
        if (!SERVER.isConfigured()) return { ok: true, detail: 'not configured' };
        const h = await SERVER.health();
        return h && h.ok ? { ok: true, detail: 'connected ●' } : { ok: false, detail: 'unreachable' };
      } },
    { label: 'Offline Models', run: async () => {
        const n = ['neuralVoiceCfg', 'sherpaSttDir', 'embedModelPath', 'voskModelPath'].filter(k => (S.getSetting(k) || '').trim()).length;
        return { ok: true, detail: n + '/4 packs' };
      } },
    { label: 'Microphone', run: async () => {
        if (!NAT.isNative()) return { ok: true, detail: 'web' };
        const r = await NAT.checkPermission('android.permission.RECORD_AUDIO');
        return { ok: !!(r && r.granted), detail: r && r.granted ? 'granted' : 'pending' };
      } },
    { label: 'Local Time', run: async () => ({ ok: true, detail: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) }
  ];
}

async function startApp() {
  const bs = $('#bootScreen');
  if (bs && bs.style.display !== 'none') {
    bs.classList.add('fade-out');
    await sleep(700);
    bs.style.display = 'none';
  }
  $('#app').classList.remove('hidden');
  /* v15 Phase 9: if app-lock + biometric are on, prompt to unlock after boot */
  setTimeout(() => {
    if (SECX.biometricEnabled() && NAT.isNative()) {
      SECX.authGate({ nativeBiometric: () => NAT.biometricPrompt() }).then(r => {
        if (r.ok) { U.toast('Unlocked 🔓', '✅'); SECX.unlockApp(); }
      }).catch(() => {});
    }
  }, 2500);
  window.__stage = 'hud-visible';
  /* v11.2 VOX: boot finished → the voice engine parks at READY (or SLEEPING
     if the wake word is armed — startWakeWord moves it there itself). */
  if (!S.getSetting('wakeWord')) VOX.vox.set('READY', 'boot complete');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= v11.1 PHASE 3: HUD runtime =================
   Live state, real data. Polls cheaply; feed rides the FridayCore Bus. */
let __feed = [];
function hudPush(icon, text) { __feed = HUD.pushFeed(__feed, icon, text); HUD.renderFeed($('#hudFeed'), __feed); }

function hudInit() {
  if (hudInit.done) return; hudInit.done = true;
  const wrap = $('#aiCoreWrap');
  HUD.setOrbState(wrap, 'idle');

  const refreshWidgets = async () => {
    let b = null;
    try { b = await D.battery(); } catch (_) {}
    if (b) Bus.emit('autox:battery', { level: b.level, charging: !!b.charging });   // v11.3 Phase 7: existing 30s poll doubles as trigger — zero new wakeups
    const w = [];
    if (b) w.push({ k: 'BATTERY', value: HUD.batteryLabel(b.level, b.charging) });
    /* v14.1 fix: navigator.storage.estimate() is BROWSER ORIGIN quota, not
       device storage — it showed "0.0/10.0 GB" and misled. In the APK use
       real device storage; in web show nothing (HUD motto: no fake vitals). */
    try {
      if (NAT.isNative()) {
        const si = await NAT.getStorageInfo().catch(() => null);
        if (si && si.ok && si.totalGB) {
          const free = typeof si.freeGB === 'number' ? si.freeGB : null;
          if (free != null) w.push({ k: 'STORAGE', value: free.toFixed(1) + ' GB free', cls: free < 2 ? 'warn' : '' });
        }
      }
    } catch (_) {}
    w.push({ k: 'NET', value: HUD.netLabel(navigator.onLine, SERVER.isConfigured() ? true : undefined) });
    w.push({ k: 'WAKE', value: S.getSetting('wakeWord') ? 'ON 🎙' : 'OFF' });
    HUD.renderWidgets($('#hudWidgets'), w);

    try {
      const h = await CORE.healthMap();
      HUD.renderStatus($('#hudStatus'), Object.entries(h || {})
        .map(([name, v]) => ({ name, detail: v.detail || v.state, cls: v.ok ? 'on' : (v.state === 'error' ? 'off' : 'warn') })));
    } catch (_) {}

    /* context cards: only real situations */
    let notifCount = 0, reminderText = '';
    if (NAT.isNative()) {
      try { const log = await NAT.getNotifLog('', 60); notifCount = ((log && log.items) || []).filter(n => Date.now() - (n.when || 0) < 3 * 3600e3).length; } catch (_) {}
    }
    const next = (S.getList(KEYS.REMINDERS) || []).filter(r => !r.done && r.due > Date.now()).sort((a, b2) => a.due - b2.due)[0];
    if (next && next.due - Date.now() < 2 * 3600e3) reminderText = `${next.text} (${Math.round((next.due - Date.now()) / 60000)}m)`;
    HUD.renderCards($('#hudContext'), HUD.contextCards({ batteryPct: b ? b.level : null, charging: b ? b.charging : false, notifCount, reminderText }));
  };
  refreshWidgets();
  setInterval(refreshWidgets, 30000);

  /* ===== v11.2 PHASE 4 (VOX): orb is driven by the FORMAL state machine now.
     No 650ms poller — the Voice Engine emits 'vox:state' on the bus and the
     HUD reacts. Fallback reconcile only poller 4x slower for typed flows. */
  const voxPaint = st => {
    HUD.setOrbState(wrap, VOX.orbOf(st));
    const on = S.getSetting('voxFeedback') !== false;
    const el = $('#voxState'); if (el) { el.textContent = VOX.labelOf(st); el.closest('.hud-voxline') && (el.closest('.hud-voxline').style.display = on ? '' : 'none'); }
    const dot = $('#micDot'); if (dot) dot.classList.toggle('on', on && VOX.micVisible(st, V.isWakeActive && V.isWakeActive()));
  };
  Bus.on('vox:state', e => {
    voxPaint(e.state);
    /* notable transitions become feed lines so the pipeline is visible:
       Recognition → Understanding → Execution → Completion */
    const st = e.state;
    if (st === 'LISTENING') hudPush('🎙️', 'sun rahi hoon…');
    else if (st === 'UNDERSTANDING') hudPush('👂', 'samajh rahi hoon…');
    else if (st === 'EXECUTING') hudPush('⚡', e.detail ? e.detail.slice(0, 40) : 'kaam ho raha hai');
    else if (st === 'ERROR') hudPush('🔴', e.detail ? 'voice: ' + String(e.detail).slice(0, 40) : 'voice fault');
  });
  voxPaint(VOX.vox.get());
  /* v14.1: a dead voice engine (3 real failures) must NOT be auto-revived
     silently — that was the "recovery never succeeds" loop. User taps = retry. */
  Bus.on('voice:dead', ev => {
    state.voiceGiveUp = true;
    const reason = (ev && (ev.reason || ev.error)) || 'voice fault';
    VOX.vox.set('ERROR', String(reason).slice(0, 60));
    hudPush('🔴', 'voice stopped: ' + String(reason).slice(0, 40));
    setStatus('Voice fault: ' + String(reason).slice(0, 50) + ' — tap mic to retry', true);
    Logger.error('voice', 'voice engine dead: ' + String(reason));
  });
  /* typed commands skip the mic path, so a slow reconcile keeps the orb
     honest for keyboard traffic too (cheap — 2.5s, only touches classes) */
  setInterval(() => { if (!state.voiceGiveUp && VOX.vox.get() === 'OFFLINE') VOX.vox.set('INITIALIZING'); }, 30000);
  setInterval(() => {
    const st = VOX.vox.get();
    if ((st === 'LISTENING' || st === 'UNDERSTANDING') && !state.listening && (Date.now() - VOX.vox.since() > 15000)) {
      VOX.vox.set('READY', 'stale listen healed');     // zombie LISTENING never sticks
    }
  }, 5000);

  /* event feed rides the bus */
  Bus.on('service:start', e => hudPush('🟢', e.name + ' online'));
  Bus.on('service:error', e => hudPush('⚠️', e.name + ' hiccup — recovery armed'));
  Bus.on('service:recovering', e => hudPush('🔁', e.name + ' recovering (' + e.attempt + ')'));
  Bus.on('boot:done', e => hudPush('🦾', 'systems ready in ' + (e.ms / 1000).toFixed(1) + 's'));
  hudPush('🦾', 'FRIDAY HUD live');

  /* command dock */
  $$('#hudDock .hud-dock-btn').forEach(btn => btn.addEventListener('click', () => {
    const a = btn.dataset.dock;
    if (a === 'voice') $('#micButton').click();
    else if (a === 'camera') { U.openPanel('camera'); openCamera('photo'); }
    else if (a === 'auto') { U.openPanel('activity'); refresh('activity'); }
    else if (a === 'memory') handleInput('what do you remember about me', { fromVoice: false });
    else if (a === 'sos') handleInput('sos', { fromVoice: false });
  }));

  /* orb interactions: double-tap = FridayCore health, long-press = chat,
     tap DURING speech = interrupt (v11.2 VOX barge-in by hand) */
  let lastTap = 0, lpTimer = null;
  if (wrap) {
    wrap.addEventListener('pointerdown', () => {
      const now = Date.now();
      if (now - lastTap < 320) {
        CORE.healthMap().then(h => {
          const bad = Object.entries(h || {}).filter(([, v]) => !v.ok).length;
          U.toast(bad ? `FridayCore: ${bad} service hiccup` : `FridayCore: all green · voice ${VOX.vox.get().toLowerCase()}`, bad ? '⚠️' : '🦾');
        }).catch(() => {});
        lastTap = now;
        return;
      }
      lastTap = now;
      /* v11.2: one tap while she talks = STOP TALKING, open ears instantly */
      if (VOX.vox.get() === 'SPEAKING' || state.speaking) {
        V.cancelSpeech();
        state.speaking = false;
        U.toast('Interrupted — bolo Boss', '✋', 1200);
        setTimeout(() => V.listen(), 220);
        return;
      }
      lpTimer = setTimeout(() => U.showView('chat'), 550);
    });
    wrap.addEventListener('pointerup', () => clearTimeout(lpTimer));
    wrap.addEventListener('pointerleave', () => clearTimeout(lpTimer));
  }
}

/* ================= INIT ================= */
async function init() {
  state.booted = true;
  window.__stage = 'init';
  if (!$('#app') || !$('#bootScreen')) throw new Error('Mandatory application shell is missing');
  BOOT.set('FRIDAY CORE', BOOT_STATE.READY, intentCount() + ' offline skills');
  BOOT.set('HUD', BOOT_STATE.PENDING, 'initializing');
  BOOT.set('MEMORY', BOOT_STATE.READY, 'local storage available');
  BOOT.set('ANDROID BRIDGE', NAT.isNative() ? BOOT_STATE.READY : BOOT_STATE.UNAVAILABLE, NAT.isNative() ? 'Capacitor native' : 'web preview');
  BOOT.set('LOCAL AI', (S.getSetting('llmModelPath') || '').trim() ? BOOT_STATE.READY : BOOT_STATE.NOT_INSTALLED, (S.getSetting('llmModelPath') || '').trim() ? 'configured' : 'Optional model unavailable.');
  BOOT.set('GROQ', SERVER.isConfigured() ? BOOT_STATE.LIMITED : BOOT_STATE.DISABLED, SERVER.isConfigured() ? 'server configured; health not yet verified' : 'backend not configured');
  BOOT.set('BLACKBOX', BOOT_STATE.DISABLED, 'server-controlled optional fallback');

  U.applyTheme(S.getSetting('uiTheme') || 'stark');
  U.initCore($('#coreCanvas'), state);
  U.initParticles($('#particleCanvas'));
  U.animateWaveform($('#voiceWaveform'), state);

  const voiceBoot = await settleOptional('VOICE', () => V.initSynthesis(), {
    timeoutMs: 2500, diagnostics: BOOT, readyDetail: 'system speech available',
    timeoutState: BOOT_STATE.LIMITED, timeoutDetail: 'TTS initialization slow; text input available',
    failureState: BOOT_STATE.LIMITED
  });
  if (!voiceBoot.ok && !voiceBoot.timedOut) BOOT.set('VOICE', BOOT_STATE.LIMITED, 'speech unavailable; text input available');
  setTimeout(() => { V.armSherpaVoice(); V.armSherpaEars(); }, 3000);   // v10.0: pick up downloaded packs at boot
  setTimeout(syncCallGuardNative, 4000);   // v10.3: keep call-guard prefs alive (receiver reads even when app closed)
  /* Phase 3: never auto-download optional models or packs. */
  V.initRecognition({
    onStart: () => { state.listening = true; setStatus('Listening...', true); $('#micButton').classList.add('listening'); $('#micContainer')?.classList.add('listening'); $('#inputWave')?.classList.add('on'); D.tap(); },
    onInterim: txt => { $('#listeningText').textContent = txt; },
    /* v7.6.4: Android fires several "final" segments per utterance. Merging them into
       ONE submission — otherwise one spoken command executed 2-3 times and the
       leftover segment leaked into the cloud chat (fake confident answers). */
    onFinal: txt => {
      state.voiceBuf = state.voiceBuf ? state.voiceBuf + ' ' + txt : txt;
      clearTimeout(state.voiceFlush);
      state.voiceFlush = setTimeout(() => {
        const out = state.voiceBuf; state.voiceBuf = '';
        if (out) handleInput(out, { fromVoice: true });
      }, 900);
    },
    onEnd: () => {
      state.listening = false; setStatus('Tap to speak'); $('#micButton').classList.remove('listening');
      $('#micContainer')?.classList.remove('listening'); $('#inputWave')?.classList.remove('on');
      clearTimeout(state.voiceFlush);
      if (state.voiceBuf) { const out = state.voiceBuf; state.voiceBuf = ''; handleInput(out, { fromVoice: true }); }
    },
    onError: err => {
      const wasChain = state.chainListen;         // v8.3: auto re-listen heard nothing -> end quietly
      state.chainListen = false;
      state.listening = false;
      $('#micButton').classList.remove('listening');
      $('#micContainer')?.classList.remove('listening'); $('#inputWave')?.classList.remove('on');
      state.voiceLastErr = err;                    // v14.1: keep the real cause for the status/audit
      Logger.error('voice', 'voice onError: ' + String(err));
      if (wasChain && (err === 'no-speech' || err === 'busy' || err === 'client')) {
        setStatus('Tap to speak');
        return;
      }
      const msgs = {
        'no-speech': 'Didn\'t catch that. Tap to retry.',
        'not-allowed': 'Mic off: Settings > Apps > FRIDAY OS > Permissions > Microphone > Allow',
        'mic-denied': 'Mic off: Settings > Apps > FRIDAY OS > Permissions > Microphone > Allow',
        'unsupported': 'Voice not supported in this browser.',
        'network': 'Voice needs internet. Type instead.',
        'server': 'Speech service hiccup. Try again.',
        'client': 'Voice engine glitch. Tap to retry.',
        'audio': 'Mic busy in another app. Close it and retry.',
        'busy': 'Voice engine busy. One moment...',
        'unknown': 'Voice error. Tap to retry.'
      };
      const txt = msgs[err] || msgs.unknown;
      setStatus(txt, err === 'not-allowed' || err === 'mic-denied');
      if (err === 'not-allowed' || err === 'mic-denied') {
        addMsg('ai', '**Microphone is off for me.** Fix: Settings → Apps → FRIDAY OS → Permissions → Microphone → **Allow**. Then tap the mic again.', { proactive: true });
        /* v8.3: open the exact system page once instead of making the user hunt */
        if (NAT.isNative() && !S.getSetting('micFixOpened')) {
          S.setSetting('micFixOpened', true);
          setTimeout(() => NAT.openSpecialSetting('app_settings').catch(() => {}), 900);
        }
      }
    },
    onWake: () => { D.buzz(); U.toast('Yes?', '🎙️', 1400); setStatus('Listening...', true); }
  });

  loadChat();
  bindEvents();
  syncSettingsUI();
  refreshAll();
  startClock();
  scheduleAllReminders();
  if (S.getSetting('wakeWord')) V.startWakeWord();
  D.startMicAnalyser().catch(() => {});
  if (!S.getSetting('showWidgets')) { const dw = $('#dashWidgets'); if (dw) dw.style.display = 'none'; }
  bootFridayCore();
  BOOT.set('AUTOMATION', BOOT_STATE.READY, 'local routines available');
  BOOT.set('WAKE WORD', (S.getSetting('voskModelPath') || S.getSetting('porcupineKey')) ? BOOT_STATE.LIMITED : BOOT_STATE.NOT_INSTALLED, (S.getSetting('voskModelPath') || S.getSetting('porcupineKey')) ? 'configured; starts on demand' : 'Optional model unavailable.');
  BOOT.set('VISION', BOOT_STATE.LIMITED, 'camera/basic OCR on demand; advanced model optional');
  // v11 Phase 1: central controller takes attendance (fire-and-forget)
  hudInit();          // v11.1 Phase 3: living HUD (widgets, feed, dock, orb states)
  /* v11.3: Phase 7 engine rides existing events — zero new polling */
  try { AUTOX.start(async (action, meta) => {
    const v = AUTOX.validateRule({ when: meta.event, then: action, confirm: true });
    if (!v.ok || (action && /\?/.test(action))) {   // question-shaped action → speak, don't execute
      return reply(action);                          // seed rules speak their suggestion honestly
    }
    return handleInput(action, { silentEcho: true, dedupeSkip: true, _confirmed: true });
  }); } catch (e) {}
  bootPhase8to10();   // v12.0-12.2: Planner + Intelligence + Device engines (fire-and-forget)
  bootPhase11to14();  // v13-14: Security + Performance + Cinematic + release wiring
  AIR.init();         // v15 Phase 3: AI router online
  PLUGINS.init();     // v15 pre-10: plugin system
  DEVCON.init();      // RC1: dev console telemetry (opt-in)
  UIX.init();         // v15 Phase 8: UI helpers apply (Material-You/AMOLED/tablet)
  /* v15 Phase 7: dynamic shortcuts (APK) + plugin claim hook into chat */
  try {
    if (NAT.isNative()) NAT.setShortcuts([
      { title: 'Voice', action: 'voice' },
      { title: 'Study', action: 'study_doubt' },
      { title: 'Notes', action: 'note_save' },
      { title: 'SOS', action: 'sos' }
    ]).catch(() => {});
  } catch (_) {}
  /* v11.3 Phase 5: daily digest + cleanup of expired vision memories */
  setTimeout(() => { try {
    const s = MEMEX.dailyDigest(new Date().toDateString(), 'ke sessions me');
    const c = MEMEX.cleanup();
    if (s && s.tasks.length) hudPush('🧠', `${s.tasks.length} task${s.tasks.length > 1 ? 's' : ''} kal/parso se pending`);
    if (c && c.visionRemoved) Logger.info('memex', 'cleanup removed ' + c.visionRemoved + ' stale scans');
  } catch (_) {} }, 7000);
  loadWeatherWidget();

  /* v20.0 HUD: connect every module to real device data */
  try { HUDV20.initHUDV20(); } catch (e) { Logger.error('hud', 'init: ' + (e && e.message)); }

  /* PHASE 2: Agent HUD integration — paints REAL agent state onto the core */
  try { initAgentHUD(); } catch (e) { Logger.error('hud', 'agent hud init: ' + (e && e.message)); }

  /* v7.7 HUD: arc-reactor rings (battery/steps) + systems status line */
  updateReactor();
  computeSystemsLine();
  setInterval(updateReactor, 60000);
  setInterval(computeSystemsLine, 120000);
  setInterval(() => { const mc = $('#micContainer'); if (mc) mc.classList.toggle('speaking', !!state.speaking); }, 700);
  /* v14.1: status banner reacts to voice/core changes instead of only the
     2-min poll — throttled so a flapping state can't thrash the DOM. */
  const systemsThrottle = PERFX.throttle(() => computeSystemsLine(), 2500);
  Bus.on('vox:state', () => systemsThrottle());
  Bus.on('core:health', () => systemsThrottle());

  /* v8.0: Karen morning brief - once per day, first open before noon */
  try {
    const todayKey = new Date().toDateString();
    if (new Date().getHours() < 12 && S.getSetting('lastBriefDate') !== todayKey) {
      S.setSetting('lastBriefDate', todayKey);
      setTimeout(() => handleInput('morning brief', { silentEcho: true, dedupeSkip: true }), 4500);
    }
  } catch (e) {}

  // greeting (v7.6.4: throttled - aggressive OEMs restart the WebView often,
  // and "Systems online" was spamming the chat on every restart)
  const lastGreetAt = S.getSetting('lastGreetAt') || 0;
  if (Date.now() - lastGreetAt > 20 * 60 * 1000) {
    S.setSetting('lastGreetAt', Date.now());
    const p = AI.persona();
    const hour = new Date().getHours();
    const tod = I18N.greetWord(hour) || (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');
    const learnedName = MEM.getFact('user.name');
    if (learnedName && !S.getSetting('userName')) S.setSetting('userName', learnedName);
    const name = S.getSetting('userName') || learnedName || p.address;
    const greet = state.messages.length
      ? `${tod}, ${name}. Systems online.`
      : (learnedName ? `${tod}, ${name}. Systems online.` : p.greeting);
    addMsg('ai', greet);
    const spoke = V.speak(greet, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
    if (!spoke) {
      // TTS engine may still be warming up on first launch
      setTimeout(() => V.speak(greet, {
        onStart: () => state.speaking = true, onEnd: () => state.speaking = false
      }), 1500);
    }
  }

  BOOT.set('HUD', BOOT_STATE.READY, 'interactive');
  updateBrainBadge();
  MEM.learnPatterns();
  AUTO.start(execAction);
  initNative();

  /* v10.1 FRIDAY Cloud: health check + one-time memory pull (cross-device) */
  if (SERVER.isConfigured()) {
    serverHealthCheck();
    syncServerMemory();
    ACTION_DEVICE.startActionLoop();
  }
  /* PWA shortcuts (?action=voice|chat|qr) — was dead code */
  const act = new URLSearchParams(location.search).get('action');
  if (act === 'voice') setTimeout(() => V.listen(), 1500);
  else if (act === 'qr') setTimeout(() => { U.openPanel('camera'); openCamera('qr'); }, 1500);
  else if (act === 'chat') U.showView('chat');
  setTimeout(checkShareInbox, 1800);                    // v9.0 (A2): cold-start share
  document.addEventListener('visibilitychange', () => {  // warm-start share
    if (!document.hidden) checkShareInbox();
  });
  lastSeenPrev = PRO.touchSession();
  setTimeout(runProactive, 6000);
  setInterval(runProactive, 5 * 60000);
}

function syncBubble() {
  if (!NAT.isNative()) return;
  const st = state.listening ? 'listening' : state.speaking ? 'speaking'
    : state.processing ? 'processing' : 'idle';
  NAT.updateBubble(st);
}

function setStatus(txt, active = false) {
  syncBubble();
  const el = $('#listeningText');
  if (el) { el.textContent = txt; el.classList.toggle('active', active); }
}

function startClock() {
  const tick = () => {
    const el = $('#statusTime');
    if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 10000);
}

function updateBrainBadge() {
  const el = $('#aiStatus');
  if (!el) return;
  const on = AI.hasGroq() || SERVER.isConfigured();
  el.innerHTML = `<span class="dot ${on ? 'cloud' : ''}"></span> ${on ? 'Cloud' : 'Offline'}`;
  const sp = $('#sysProvider');
  if (sp) sp.textContent = SERVER.isConfigured() ? 'FRIDAY Cloud' : on ? 'Groq' : 'Local';
}

/* ---------- v10.1 FRIDAY Cloud helpers ---------- */
async function serverHealthCheck() {
  const h = await SERVER.health().catch(() => null);
  const chip = $('#serverStatusChip');
  if (h && h.ok) {
    const gp = h.providers && h.providers.groq;
    const bp = h.providers && h.providers.blackbox;
    BOOT.set('GROQ', gp && gp.configured ? BOOT_STATE.LIMITED : BOOT_STATE.DISABLED,
      gp && gp.configured ? 'configured server-side; validated on first request' : 'server key missing');
    BOOT.set('BLACKBOX', bp && bp.configured ? BOOT_STATE.LIMITED : BOOT_STATE.DISABLED,
      bp && bp.configured ? 'explicit fallback configured; validated on first request' : ((bp && bp.reason) || 'disabled'));
  } else {
    BOOT.set('GROQ', BOOT_STATE.UNAVAILABLE, 'backend unreachable');
    BOOT.set('BLACKBOX', BOOT_STATE.DISABLED, 'backend unavailable');
  }
  if (chip) {
    chip.textContent = h && h.ok
      ? `FRIDAY Cloud: ● online (${h.engines?.llm === 'configured' ? 'provider configured' : 'offline-only'})`
      : 'FRIDAY Cloud: ○ unreachable — offline commands remain available';
    chip.classList.toggle('ok', !!(h && h.ok));
  }
}

/* Pull server-side facts/notes once and merge into local memory. */
async function syncServerMemory() {
  try {
    if (Date.now() - (S.getSetting('serverMemSyncedAt') || 0) < 6 * 3600e3) return;
    const mem = await SERVER.pullMemory();
    if (!mem || !mem.ok) return;
    S.setSetting('serverMemSyncedAt', Date.now());
    for (const f of mem.facts || []) {
      if (f.key && f.value && !MEM.getFact(f.key)) MEM.saveFact({ key: f.key, label: f.label || f.key, value: f.value });
    }
    if (mem.notes && mem.notes.length) {
      const have = S.getList(KEYS.NOTES).map(n => n.text);
      mem.notes.slice(0, 20).forEach(n => { if (!have.includes(n.text)) S.addItem(KEYS.NOTES, { text: n.text }); });
      refresh('notes');
    }
  } catch (e) { /* offline — retry next boot */ }
}

/* ================= INPUT PIPELINE ================= */
/* ================= v8.0 STARK: Mission mode =================
   "remind me X and add task Y and send Z" becomes a visible checklist.
   Steps that touch the outside world pause and ask for a "go" first. */
const MISSION_RISKY = /\b(send|pay|paid|order|book|delete|remove|post|call|whatsapp|message|sms)\b/i;

async function runMission(parts) {
  const items = parts.map(p => ({ text: p, status: 'wait' }));
  const el = addMsg('ai', '', { returnEl: true, proactive: true });
  const draw = () => {
    if (!el) return;
    el.querySelector('.message-bubble').innerHTML = U.renderRich(
      `**Mission: ${items.length} steps**\n` + items.map((it, i) =>
        `${it.status === 'done' ? '\u2705' : it.status === 'skip' ? '\u23ed' : it.status === 'run' ? '\u26a1' : it.status === 'ask' ? '\u2753' : '\u25ab'} ${i + 1}. ${it.text}`
      ).join('\n'));
    scrollBottom();
  };
  state.mission = { items, draw };
  reply(`On it, Boss - ${items.length} steps. Watch me work.`);
  draw();
  return runMissionFrom(0);
}

async function runMissionFrom(startIdx) {
  const ms = state.mission;
  if (!ms) return true;
  for (let j = startIdx; j < ms.items.length; j++) {
    const it = ms.items[j];
    if (it.status === 'done' || it.status === 'skip') continue;
    it.status = 'run'; ms.draw();
    if (MISSION_RISKY.test(it.text)) {
      it.status = 'ask'; ms.draw();
      state.expect = 'mission_go';
      reply(`Step ${j + 1}: "${it.text}" - this touches the outside world. Say "go" to execute it, or "skip".`);
      return true;
    }
    await handleInput(it.text, { noChain: true, silentEcho: true, dedupeSkip: true });
    it.status = 'done'; ms.draw();
  }
  state.mission = null;
  reply('Mission complete, Boss.');
  return true;
}

async function handleAssistantPromptResponse(text, opts = {}) {
  const normalized = String(text || '').trim().toLowerCase();
  const reminder = state.proactiveReminder;
  if (reminder) {
    const done = /^(done|mark (it )?done|complete|ho gaya|kar diya)$/.test(normalized);
    const cancel = /^(ignore|later|leave it|rehne do|chhodo)$/.test(normalized);
    const snooze = /^(snooze|snooze( it)?( for)?( \d+)?( minutes?)?|baad me|dus minute)$/.test(normalized);
    const rescheduleRequest = /^(reschedule|change (the )?time)\b/.test(normalized);
    const rescheduleTime = (rescheduleRequest || reminder.awaitingReschedule) ? parseTime(normalized) : null;
    const reschedule = rescheduleRequest || (!!reminder.awaitingReschedule && !!rescheduleTime);
    const open = /^(open|open friday)$/.test(normalized);
    if (done || cancel || snooze || reschedule || open) {
      if (!opts.silentEcho) addMsg('user', text);
      if (done) {
        S.updateItem(KEYS.REMINDERS, reminder.id, { done: true });
        await NAT.cancelAssistantReminder(reminder.id);
        state.proactiveReminder = null; refresh('reminders');
        reply('Done, Boss. Reminder complete.'); return true;
      }
      if (snooze) {
        const m = Math.max(1, Math.min(24 * 60, +(normalized.match(/\d+/) || [10])[0]));
        const due = Date.now() + m * 60_000;
        S.updateItem(KEYS.REMINDERS, reminder.id, { due, done: false });
        const updated = { ...reminder, due, done: false };
        scheduleReminder(updated); state.proactiveReminder = null; refresh('reminders');
        reply(`Snoozed for ${m} minutes, Boss.`); return true;
      }
      if (reschedule) {
        const when = rescheduleTime;
        if (!when) {
          state.proactiveReminder = { ...reminder, awaitingReschedule: true };
          reply('Tell me the new time, for example: “tomorrow at 8 AM”.');
          return true;
        }
        const due = when.date.getTime();
        S.updateItem(KEYS.REMINDERS, reminder.id, { due, done: false });
        const updated = { ...reminder, due, done: false };
        scheduleReminder(updated); state.proactiveReminder = null; refresh('reminders');
        reply(`Rescheduled for ${humanTime(when.date)}, Boss.`); return true;
      }
      if (open) { state.proactiveReminder = null; U.openPanel('activity'); refresh('activity'); reply('Reminder list is open. You can choose a new time.'); return true; }
      state.proactiveReminder = null; reply('Okay, I will leave it pending.'); return true;
    }
  }

  const event = state.proactiveEvent;
  if (!event || Date.now() > event.expiresAt) {
    if (event) state.proactiveEvent = null;
    return false;
  }
  const answer = PROACTIVE.interpretPromptResponse(text);
  if (!answer) return false;
  if (!opts.silentEcho) addMsg('user', text);
  if (answer === 'ignore') { state.proactiveEvent = null; reply('Left for later, Boss.'); return true; }
  if (answer === 'read') {
    if (NAT.isNative()) {
      const status = await NAT.getAssistantStatus();
      if (status && status.privateMode) event.canReveal = false;
    }
    if (!event.canReveal) {
      reply(event.sensitive
        ? 'That notification is classified as private, so I will not read its contents aloud.'
        : 'Unlock your phone or use private audio before I read that notification.');
      return true;
    }
    const detail = `${event.title || event.app}. ${event.text || 'No text was exposed by that app.'}`;
    addMsg('ai', `🔔 **${event.app}** — ${event.title || ''}\n${event.text || '_No readable content exposed._'}`, { proactive: true });
    V.speak(detail.slice(0, 500));
    return true;
  }
  if (answer === 'open') {
    state.proactiveEvent = null;
    const opened = await NAT.launchApp(event.pkg);
    reply(opened && opened.ok ? `Opening ${event.app}.` : 'Android could not open that source app.');
    return true;
  }
  if (answer === 'reply') {
    if (NAT.isNative()) {
      const status = await NAT.getAssistantStatus();
      if (status && status.privateMode) event.canReveal = false;
    }
    if (!event.canReveal) {
      reply('Unlock your phone or use private audio before drafting a reply to that notification.');
      return true;
    }
    return runAction({ type: 'inbox_reply', app: event.pkg, eventKey: event.key }, {});
  }
  return false;
}

async function handleInput(text, opts = {}) {
  text = String(text || '').trim();
  if (!text) return;
  Bus.emit('command', { text: text.slice(0, 80), voice: !!opts.fromVoice });   // v11: bus hears every command

  /* v7.6.4: drop duplicate submissions (voice double-final, STT retries) —
     same text within 4s is an echo, not a new command. */
  clearTimeout(state.talkWait);   // v7.8: user spoke - cancel the Karen nudge
  clearTimeout(state.convoWait);  // legacy guard
  state.chainListen = false;
  /* v8.3: remember whether this turn is voice or typed - voice turns keep
     the mic chaining (continuous conversation), typed turns stay one-shot. */
  state.lastInputWasVoice = !!opts.fromVoice;
  /* v11.2 VOX: engine hears intent start — THINKING covers typed turns too */
  if (!opts.noChain) VOX.vox.set('THINKING', (opts.fromVoice ? 'voice' : 'typed') + ' input');

  /* Step 5: short, event-bound responses are handled before generic NLU. */
  if (!opts.noChain && await handleAssistantPromptResponse(text, opts)) return;

  /* ===== v11.2 VOX: SMART CONFIRMATION for destructive commands =====
     "delete all reminders" never fires silently — FRIDAY asks "pakka?".
     Answer loop: "haan" → run it, "nahi" → drop it honestly. */
  if (state.pendingDanger && !opts.noChain) {
    const pending = state.pendingDanger;
    const stale2 = pending.at && (Date.now() - pending.at > 90000);   // 90s self-destruct
    state.pendingDanger = null;
    if (!stale2) {
      if (VOX.confirmNo(text)) {
        addMsg('user', text);
        VOX.vox.set('READY', 'danger cancelled');
        return reply('Theek hai Boss, kuch bhi delete nahi kiya. Sab safe hai. 🛡️');
      }
      if (VOX.confirmYes(text)) {
        addMsg('user', text);
        return handleInput(pending.text, { noChain: true, silentEcho: true, dedupeSkip: true, _confirmed: true });
      }
      /* not an answer → the pending danger is dead; treat as fresh command */
    }
  }
  if (!opts.noChain && !opts._confirmed && S.getSetting('dangerConfirm') !== false && VOX.needsConfirm(text)) {
    state.pendingDanger = { text, at: Date.now() };
    VOX.vox.set('WAITING', 'awaiting confirmation');
    Ui_confirmBadge();
    if (!opts.silentEcho) addMsg('user', text);      // show the parked command in chat — fake value kabhi nahi
    return reply(VOX.confirmQuestion(text));
  }
  state.autoListens = 0;
  /* v9.0 APEX (A6): after "dictate", the next voice input becomes a cleaned
     draft in the input box instead of a command (Rambler-style). */
  if (state.dictateNext && opts.fromVoice) {
    state.dictateNext = false;
    doDictateFinish(text);
    return;
  }
  /* v10.0 C1 CLARIFY: if FRIDAY asked a question last turn, this turn is the
     ANSWER - merge it into the parked command instead of re-parsing alone.
     v10.2.1 FIX: agar naya text KHUD ek fresh command hai (apna action
     resolve hota hai), to parked sawaal CANCEL — warna "Hi"/"explain nda"
     bhi answer ban jaata tha aur loop kabhi khatam nahi hota tha. */
  if (state.pendingClarify && !opts.noChain) {
    const pending = state.pendingClarify;
    const stale = pending.at && (Date.now() - pending.at > 120000);   // 2 min se purana sawaal bhool jao
    state.pendingClarify = null;
    let merged = '';
    if (!stale && CLARIFY.absorbable(text, pending)) {
      const own = resolve(text, { lastTopic: state.lastTopic });
      const fresh = !!(own && own.action && own.intent !== pending.intent);
      if (!fresh) merged = CLARIFY.absorb(pending, text);
    }
    if (merged) {
      addMsg('user', text);
      return handleInput(merged, { ...opts, noChain: true, silentEcho: true });
    }
    /* not an answer -> treat as a brand-new command (fall through) */
  }
  if (state.llmBusy) { state.llmBusy = false; LB.abortLocal(); }  // v8.2: new input stops on-device generation
  if (!opts.dedupeSkip) {
    const norm = text.toLowerCase().replace(/\s+/g, ' ');
    if (norm === state.lastSubmitted && Date.now() - state.lastSubmittedAt < 4000) return;
    state.lastSubmitted = norm; state.lastSubmittedAt = Date.now();
  }

  // ---- mission mode (v8.0 STARK): multi-step commands become a live checklist ----
  if (!opts.noChain) {
    const parts = NLU.splitCommands(text);
    if (parts.length > 1) {
      addMsg('user', text);
      MEM.logEpisode({ text, intent: 'chain', role: 'user' });
      return runMission(parts);
    }
  }

  // ---- follow-up resolution: "what about tomorrow?" ----
  if (!opts.noChain) {
    const rewritten = NLU.resolveFollowup(text, {
      lastIntent: state.lastTopic, lastSubject: state.lastSubject
    });
    if (rewritten) {
      addMsg('user', text);
      MEM.logEpisode({ text, intent: state.lastTopic, role: 'user' });
      return handleInput(rewritten, { noChain: true, silentEcho: true });
    }
  }

  if (!opts.silentEcho) addMsg('user', text);

  /* v10.0 C1: music with no source and no learned taste -> ask once,
     learn forever ("YouTube pe ya Spotify pe?"). */
  if (!opts.noChain && CLARIFY.needsMusicSource(text)) {
    const q = CLARIFY.musicSourceQuestion();
    askClarify(q.question, q.options);
    state.pendingClarify = { slot: 'music_source', origText: text, at: Date.now() };
    return;
  }
  /* learned taste applies silently to future music commands */
  const musicPref = CLARIFY.getPref('music_source');
  if (musicPref && !opts.noChain) {
    const low = text.toLowerCase();
    if (/\bplay\b|\bchalao\b|\bsunao\b/.test(low) && !/\byoutube|\byt\b|spotify|game|video/.test(low)
        && /\b(song|gaana|music|gana)\b/.test(low)) {
      text += musicPref === 'spotify' ? ' on spotify' : ' on youtube';
    }
  }
  S.remember('user', text);
  $('#textInput').value = '';

  // mood detection -> tone (prepended once to the next reply)
  const mood = NLU.sentiment(text);
  state.mood = mood;
  state.tonePrefix = null;
  if (mood.urgent || mood.mood === 'negative') {
    const tones = NLU.toneFor(mood.mood, mood.urgent);
    if (tones.length) state.tonePrefix = pick(tones);
  }

  // learn from what was said
  const learned = MEM.extractFacts(text);
  if (learned.length) {
    const f = learned[0];
    if (f.key === 'user.name') { S.setSetting('userName', f.value); syncSettingsUI(); }
    U.toast(`Learned: ${f.label} — ${f.value}`, '🧠', 2200);
    /* v10.1: push learned facts to the FRIDAY Cloud server (cross-device) */
    learned.forEach(ff => SERVER.rememberFact({ key: ff.key, label: ff.label, value: ff.value })
      .then(r => { if (!(r && r.ok)) API.enqueueOffline('fact', { key: ff.key, label: ff.label, value: ff.value }); })
      .catch(() => API.enqueueOffline('fact', { key: ff.key, label: ff.label, value: ff.value })));   // v15 Phase 2: offline-safe learning
  }

  // follow-up capture ("What should I remind you about?")
  if (state.expect) {
    const kind = state.expect;
    state.expect = null;
    /* Step 5: exact recipient/text/action confirmation. Bare "yes" is not enough. */
    if (kind === 'inbox_send_confirm') {
      const auth = state.pendingInboxSend;
      if (!auth) return reply('That reply approval expired. Nothing was sent.');
      if (/^(cancel|no|nahi|chhodo|rehne do)$/.test(text.trim().toLowerCase())) {
        state.pendingInboxSend = null; return reply('Cancelled. Nothing was sent.');
      }
      const verified = PROACTIVE.verifyReplyAuthorization(auth, {
        eventKey: auth.eventKey, text: auth.text, confirmation: text, now: Date.now()
      });
      if (!verified.ok) {
        if (verified.reason === 'expired') { state.pendingInboxSend = null; return reply('That approval expired. I did not send anything.'); }
        state.expect = 'inbox_send_confirm';
        return reply('Please say exactly “send it” to send that recipient-bound draft, or “cancel”.');
      }
      state.pendingInboxSend = null;
      const nativeAuthorization = await NAT.authorizeNotificationReply({
        eventKey: auth.eventKey,
        app: auth.app,
        recipient: auth.recipient,
        text: auth.text,
        confirmation: text
      });
      if (!nativeAuthorization || !nativeAuthorization.ok || !nativeAuthorization.authorizationToken) {
        return reply(`I could not authorize that exact reply: ${(nativeAuthorization && (nativeAuthorization.reason || nativeAuthorization.error)) || 'the notification changed'}. Nothing was sent.`);
      }
      const sent = await NAT.replyNotification(
        auth.app, auth.text, auth.eventKey, nativeAuthorization.authorizationToken);
      if (sent && sent.ok) return reply(`Sent to ${auth.recipient || auth.app} ✅`);
      return reply(`I could not send it: ${(sent && (sent.reason || sent.error)) || 'RemoteInput is unavailable'}. The draft was not redirected to anyone else.`);
    }
    /* v12.0 Phase 8: PLANX interactive steps (confirm / rescue / ask) */
    if (kind === 'plan_answer' && state.planAsk) {
      const done = state.planAsk; state.planAsk = null;
      done(text.trim()); return;
    }
    /* v14.1: "send this photo" → next input is the contact name */
    if (kind === 'send_img_to') return sendSharedImageTo(text);
    if (kind === 'note_text') { S.addItem(KEYS.NOTES, { text }); refresh('notes'); return reply(`Saved: "${text}"`); }
    if (kind === 'reminder_text') return handleInput('remind me to ' + text);
    if (kind === 'task_text') { S.addItem(KEYS.TASKS, { text, done: false }); refresh('tasks'); return reply(`Task added: "${text}"`); }
    if (kind === 'vault_pin') return handleVaultPin(text);
    if (kind === 'password_check_text') return auditPassword(text.replace(/["']/g, '').trim());
    if (kind === 'phish_link') return judgeLink(text);
    if (kind === 'quiz_answer') return quizAnswer(text);
    if (kind === 'mock_answer') return mockAnswer(text);
    if (kind === 'safety_ok') {
      if (/^(ok|sab theek|theek hai|yes|haan|good|safe)\b/i.test(text.trim())) {
        GUARD.confirmSafetyTimer(state.safetyTimerId); reply('Theek hai. Main hoon yahan. 🛡'); return true;
      }
      if (/^(help|sos|emergency|madad)\b/i.test(text.trim())) {
        GUARD.confirmSafetyTimer(state.safetyTimerId); return runAction({ type: 'sos' }, {});
      }
      state.expect = 'safety_ok'; return reply('Bolo "sab theek" ya "help".');
    }
    if (kind === 'voice_note') {
      S.addItem(KEYS.NOTES, { text: '🎙 ' + text, created: Date.now() });
      refresh('notes');
      return reply(`Voice note saved: "${text}"`);
    }
    if (kind === 'med_times') return createMedAlarms(text);
    if (kind === 'wifi_qr_pass') return finishWifiQr(text);
    /* v7.6.4: whatsapp schedule slot-filling (natural language) */
    if (kind === 'wa_sched_name') return collectWaSchedule({ name: text.replace(/^(to|for|ko)\s+/i, '').trim() });
    if (kind === 'wa_sched_msg') return collectWaSchedule({ msg: text.trim() });
    if (kind === 'wa_sched_time') {
      const w = parseTime(text.toLowerCase());
      if (!w) { state.expect = 'wa_sched_time'; return reply('Give me a time like "9pm", "tomorrow 8am", "kal 8 baje".'); }
      return collectWaSchedule({ time: w.date.getTime() });
    }
    /* v8.0: mission step confirmation ("go" / "skip") */
    if (kind === 'mission_go') {
      const it = state.mission && state.mission.items.find(i => i.status === 'ask');
      if (!it) return reply('No pending mission step.');
      const go = /^(go|yes|haan|kar|karo|do|ok|okay|sure|send it|haan ji)\b/i.test(text.trim());
      const skip = /^(skip|no|nahi|nope|cancel|rehne)\b/i.test(text.trim());
      if (!go && !skip) {
        state.expect = 'mission_go';
        return reply('Say "go" to execute it, or "skip" to leave it.');
      }
      if (go) {
        it.status = 'run';
        if (state.mission) state.mission.draw();
        await handleInput(it.text, { noChain: true, silentEcho: true, dedupeSkip: true });
        it.status = 'done';
      } else it.status = 'skip';
      if (state.mission) state.mission.draw();
      const nextIdx = state.mission ? state.mission.items.findIndex(i => i.status === 'wait') : -1;
      if (nextIdx >= 0) return runMissionFrom(nextIdx);
      state.mission = null;
      return reply('Mission complete, Boss.');
    }

    /* v15.1 AGENT ORCHESTRATOR: handle agent confirmation response */
    if (kind === 'agent_confirm' && state.agentConfirmQuestion) {
      const go = /^(go|yes|haan|kar|karo|do|ok|okay|sure|send it|haan ji)\b/i.test(text.trim());
      const skip = /^(skip|no|nahi|nope|cancel|rehne)\b/i.test(text.trim());
      state.agentConfirmQuestion = null;
      if (!go && !skip) {
        state.expect = 'agent_confirm';
        return reply('Bolo "go" to proceed, or "cancel" to drop it.');
      }
      if (skip) {
        return reply('Action cancelled. Nothing was changed.');
      }
      // User confirmed — re-run the command via handleInput
      state.expect = null;
      state.pendingDanger = null;
      VOX.vox.set('READY', 'confirmed');
      return handleInput(text, { noChain: true, silentEcho: true, _confirmed: true });
    }
  }

  /* v7.6.4: bare "send" after scheduling a WhatsApp = send it now via WhatsApp
     (was falling into the SMS path and falsely claiming "Message sent") */
  if (/^(send|send it|send now|bhej do|bhejo|bhej de|send kar do)$/i.test(text)) {
    const pendingWa = (S.getList(KEYS.REMINDERS) || []).filter(r => r.wa && !r.done).sort((x, y) => x.due - y.due)[0];
    if (pendingWa && NAT.isNative()) {
      const c = await NAT.findContact(pendingWa.wa.name);
      if (!c || !c.phone) { reply(`I couldn't find "${pendingWa.wa.name}" in your contacts.`); return; }
      const r = await NAT.whatsappSend(c.phone, pendingWa.wa.msg, true);
      if (r && r.ok) {
        S.updateItem(KEYS.REMINDERS, pendingWa.id, { done: true });
        refresh('reminders');
        reply(r.autoSend
          ? `Sending "${pendingWa.wa.msg}" to ${pendingWa.wa.name} on WhatsApp.`
          : `WhatsApp is open for ${pendingWa.wa.name} - tap send there, or enable FRIDAY Control (Accessibility) so I can press it myself.`);
      } else reply('Could not open WhatsApp for that.');
      return;
    }
  }

  // 1) OFFLINE INTENT ENGINE
  let hit = resolve(text, { lastTopic: state.lastTopic });
  if (!hit) {
    const fixed = NLU.autoCorrect(text);
    if (fixed !== text) hit = resolve(fixed, { lastTopic: state.lastTopic });
  }
  MEM.logEpisode({ text, intent: hit ? hit.intent : null, role: 'user' });
  try { INTELX.tick('command', { intent: hit ? hit.intent : null }); } catch (_) {}   // v12.1: preference learner
  if (hit && hit.intent) { try { MEMEX.trackUse(hit.intent); } catch (_) {} }   // v11.3: preference learner
  /* v10.0 M1: facts about the user's life get embedded for meaning-recall
     (silent no-op when the memory brain is not downloaded). */
  if (/\b(my|mera|meri|mere|mujhe|main|hamara|hamari)\b/i.test(text) && text.length > 12 && text.length < 240) {
    SEM.rememberSemantic(text, { kind: 'fact' }).catch(() => {});
  }
  if (hit) {
    /* v10.0 C1: action resolved but a CRITICAL slot is empty -> ask ONE
       short question instead of guessing wrong (JARVIS rule). */
    const slotQ = CLARIFY.checkSlots(hit, text);
    if (slotQ) {
      askClarify(slotQ.question, slotQ.options);
      state.pendingClarify = { ...slotQ.pending, at: Date.now() };   // v10.2.1: 2-min self-destruct
      return;
    }
    state.lastTopic = hit.intent;
    state.lastSubject = hit.action?.query || hit.action?.word || hit.action?.dest || null;
    if (hit.expect) state.expect = hit.expect;
    if (hit.action) {
      VOX.vox.set('EXECUTING', hit.intent);                     // v11.2 VOX: bright pulse
      const handled = await runAction(hit.action, hit);
      if ((VOX.vox.get() === 'EXECUTING')) VOX.vox.set('THINKING', 'action done');   // reply() moves it to SPEAKING
      if (handled !== false) {
        if (hit.say) reply(hit.say);
        (hit.refresh || []).forEach(refresh);
        if (!V.isSpeaking()) VOX.vox.armReady(1200);      // v11.2 VOX: silent action settles honestly
        return;
      }
    } else {
      if (hit.say) reply(hit.say);
      (hit.refresh || []).forEach(refresh);
      if (!V.isSpeaking()) VOX.vox.armReady(1200);        // v11.2 VOX
      return;
    }
  }

  /* v12.1 Phase 9: study-done phrase ends a tracked study session
     (user echo already added upstream — no duplicate bubble) */
  if (/^(study done|study over|study finished|padhai (khatam|ho gayi|done))\b/i.test(text)) {
    const r = INTELX.studyStop();
    const st = INTELX.studyStats(INTELX.studySessions());
    reply(`Nice, Boss — ${r.min} min logged. Today: ${st.todayMin} min · streak: ${st.streak} day${st.streak === 1 ? '' : 's'}.`);
    try { INTELX.tick('study_done', { topic: r.topic, min: r.min }); } catch (_) {}
    return;
  }

  /* v12.0 Phase 8: the PLANNER claims multi-step / reasoning goals when the
     intent engine found no single command. Single commands are untouched. */
  if (!hit && S.getSetting('plannerEnabled') !== false && PLANX.shouldPlan(text)) {
    return runPlannerFlow(text, opts);
  }

  /* ================= v15.1 AGENT ORCHESTRATOR =================
     When the intent engine found nothing AND AI is available,
     run the unified agent loop: understand → context → decide →
     execute → observe → verify → respond.

     This wraps the existing intent engine, planner, and AI tools
     into a single bounded multi-step loop (max AGENT_CONFIG.MAX_STEPS).

     The agent loop calls runAction() for each action, so all existing
     action handlers work exactly as before. The difference: after each
     action, the verification layer checks real device state before
     claiming success.

     vFIX: in FRIDAY Cloud mode the backend already runs its own bounded
     tool loop (server-side tools + memory). The on-device orchestrator's
     client-side tool call (callGroqTools) is a stub, so running it for
     plain chat made FRIDAY reply "I'm not sure I understand" instead of
     reaching the LLM. For non-action conversation, stream straight from
     the server. Device-action phrasing still goes through the orchestrator
     so reminders/calls/etc. execute on-device. */
  const wantsAgent = ACTIONISH.test(text);
  if (!hit && (AI.hasGroq() || SERVER.isConfigured()) &&
      !(SERVER.isConfigured() && S.getSetting('serverMode') !== false && !wantsAgent)) {
    try {
      const agentResult = await runAgentLoop(text, {
        maxSteps: AGENT_CONFIG.MAX_STEPS,
        onStep: (stepInfo) => {
          // Update HUD/chat with agent progress
          if (stepInfo.type === 'action') {
            VOX.vox.set('EXECUTING', stepInfo.action);
          } else if (stepInfo.type === 'respond') {
            // Agent produced a response — add to chat
            addMsg('ai', stepInfo.message, { source: 'live' });
          } else if (stepInfo.type === 'clarify') {
            reply(stepInfo.question);
          } else if (stepInfo.type === 'confirm') {
            // Dangerous action needs confirmation
            state.pendingDanger = { text, at: Date.now(), agentQuestion: stepInfo.question };
            VOX.vox.set('WAITING', 'awaiting confirmation');
            Ui_confirmBadge();
          }
        },
        onConfirm: async (question) => {
          // Wait for user confirmation — set expect and return
          state.expect = 'agent_confirm';
          state.agentConfirmQuestion = question;
          reply(question);
          return null; // will be resolved when user responds
        },
        respond: (message) => {
          reply(message);
        },
      });

      // If the agent produced a final response, we're done
      if (agentResult.done && agentResult.finalResponse) {
        return;
      }

      // If the agent needs more input (clarification), it's handled via the callbacks
      if (!agentResult.done && agentResult.pendingClarification) {
        return;
      }
    } catch (e) {
      Logger.error('agent', 'agent loop error: ' + (e && e.message));
      // Fall through to existing cloud path
    }
  }

  // 2) CLOUD (server mode or Groq key present)
  if (AI.hasGroq() || SERVER.isConfigured()) {
    /* v10.0 C1: unmatched ACTION-ish command -> offer smart guesses first
       (cheaper and more honest than a hallucinated "done").
       C1 v2: if the meaning-router is armed (bge-small embed model), route
       by MEANING first — auto-run high-confidence hits, suggest mid-band. */
    if (/play|call|message|remind|alarm|translate|open|wallpaper|send|karo|banao|chalao|dikhao|lagao/i.test(text)) {
      const r = await SEM.routeByMeaning(text, CLARIFY.SUGGEST_EXAMPLES);
      if (r && r.decision === 'auto' && r.utter && r.utter !== text) return handleInput(r.utter, opts);
      if (r && r.decision === 'suggest') {
        const nm0 = CLARIFY.noMatchClarify(text);
        const opts0 = [{ label: r.label, say: r.utter }].concat(nm0 ? nm0.options : []);
        askClarify(`Pakka samajhna chahta hoon, Boss — "${r.label}" tha kya?`, opts0);
        return;
      }
      const nm = CLARIFY.noMatchClarify(text);
      if (nm) { askClarify(nm.question, nm.options); return; }
    }
    return askGroq(text);
  }

  // 2.5) OFFLINE LLM CHAT — real conversation with no key, if a local
  //      model is installed (Settings -> Offline Coder -> chat model).
  if (S.getSetting('offlineChat') !== false && CODER.ready()) return streamLocalChat(text);

  // 3) OFFLINE COMPOSER
  reply(AI.offlineReply(text));
}

/* v11.3 Phase 5: deep-recall block for AI prompts — only relevant memories,
   local retrieval (<100ms). Nothing injected → empty string, zero tokens burned. */
function memexBrief(text) {
  try {
    const hits = MEMEX.retrieve(text, { k: 3 }).filter(h => h.rel >= 0.34 && h.src !== 'fact');
    if (!hits.length) return '';
    return '\n\nDEEP MEMORY (recalled locally, may reference if natural):' + hits.map(h => '\n- ' + h.text.slice(0, 140)).join('');
  } catch (_) { return ''; }
}

/* Fully-offline LLM chat: memory brief + streamed tokens, no network. */
async function streamLocalChat(text) {
  thinking(true);
  let el = null, acc = '', rafPending = false;
  const flush = () => {
    rafPending = false;
    if (!el) return;
    el.querySelector('.message-bubble').innerHTML = U.renderRich(acc);
    scrollBottom();
  };
  try {
    const final = await CODER.chat(text, {
      /* v11.3 Phase 5: on top of facts+patterns, inject RELEVANT deep recall
         (vision scans, digests, hot memories) — spec: only relevant memories. */
      context: MEM.buildContext() + memexBrief(text),
      history: state.messages.slice(-6).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
      maxTokens: 700,
      onToken: (_, sofar) => {
        acc = sofar;
        if (!el) { hideTyping(); el = addMsg('ai', '', { returnEl: true }); }
        if (!rafPending) { rafPending = true; requestAnimationFrame(flush); }
      }
    });
    thinking(false);
    const out = (final || acc).trim() || AI.offlineReply(text);
    if (el) {
      acc = out; flush();
      const rec = state.messages[state.messages.length - 1];
      if (rec) { rec.text = out; saveChat(); }
    } else {
      addMsg('ai', out);
    }
    S.remember('ai', out);
    V.speak(out, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
  } catch (e) {
    thinking(false);
    reply(AI.offlineReply(text));
  }
}

/* v10.1 FRIDAY Cloud chat: fully streamed from the backend (no key, no
   model downloads). The server injects memory + runs its own tool loop. */
async function streamServerChat(text) {
  thinking(true);
  showStopBtn();                                   // v15 Phase 2: stop generation
  const ctl = new AbortController(); state.abortCtl = ctl;
  let el = null, acc = '', rafPending = false, stopped = false;
  const flush = () => {
    rafPending = false;
    if (!el) return;
    el.querySelector('.message-bubble').innerHTML = U.renderRich(acc);
    scrollBottom();
  };
  try {
    const history = state.messages.slice(-10).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant', content: m.text
    }));
    const final = await SERVER.chat([...history, { role: 'user', content: text }], {
      signal: ctl.signal,
      onToken: (_, sofar) => {
        if (ctl.signal.aborted) { stopped = true; return; }
        acc = sofar;
        if (!el) { hideTyping(); el = addMsg('ai', '', { returnEl: true, source: 'live' }); }
        if (!rafPending) { rafPending = true; requestAnimationFrame(flush); }
      }
    });
    thinking(false);
    const out = (final || acc).trim() || AI.offlineReply(text);
    if (el) {
      acc = out; flush();
      const rec = state.messages[state.messages.length - 1];
      if (rec) { rec.text = out; saveChat(); }
    } else {
      addMsg('ai', out, { source: 'live' });
    }
    S.remember('ai', out);
    V.speak(out, { onStart: () => state.speaking = true, onEnd: () => { state.speaking = false; continueConvoAfterSpeech(out); } });
    armTalkWait(out);
  } catch (e) {
    thinking(false);
    /* user pressed Stop → keep what streamed, don't error out */
    if (stopped || (e && e.name === 'AbortError')) {
      const out = (acc || '').trim();
      if (out && el) { el.querySelector('.message-bubble').innerHTML = U.renderRich(out); const rec = state.messages[state.messages.length - 1]; if (rec) { rec.text = out; saveChat(); } S.remember('ai', out); }
      setStatus('Stopped — tap mic to continue');
    } else {
      reply(errMsg(e));
    }
  } finally {
    if (state.abortCtl === ctl) state.abortCtl = null;
    const sb = $('#stopGenBtn'); if (sb) sb.remove();
  }
}

/* v8.1 EYES: one shared pipeline - screenshot -> vision description.
   Honest at every failure step (a11y off, old android, no Groq key). */
async function performScreenVision(question) {
  if (!NAT.isNative()) return { ok: false, text: 'Screen vision needs the installed FRIDAY app.' };
  const shot = await NAT.screenShot();
  if (!shot || !shot.ok) {
    if (shot && shot.reason === 'a11y_off') return { ok: false, text: 'FRIDAY Control (accessibility) is OFF. Opening settings - enable it, then ask me again.', openA11y: true };
    if (shot && shot.reason === 'unsupported_android') return { ok: false, text: 'Screen vision needs Android 11 or newer.' };
    return { ok: false, text: 'Screen capture failed - the current app may be protected (banking/lock screens block screenshots). Try on a normal screen.' };
  }
  if (!AI.hasGroq()) {
    try {
      const t = await NAT.readScreenText();
      if (t && t.ok && t.text) return { ok: true, text: 'Cloud vision unavailable, but the screen shows: ' + String(t.text).slice(0, 500) };
    } catch (e) {}
    return { ok: false, text: 'Visual screen analysis needs the optional FRIDAY Cloud backend.' };
  }
  const v = await AI.callGroqVision('data:image/jpeg;base64,' + shot.b64,
    question || 'Describe what is on this phone screen: which app, what is happening, and which buttons or inputs are visible. Be brief and factual.');
  return v && v.ok ? { ok: true, text: v.text } : { ok: false, text: 'Vision service hiccup. Try again.' };
}

/* ================= ACTIONS ================= */
/* v7.6.4: progressive WhatsApp scheduling - fill missing slots by asking. */
function collectWaSchedule(slots) {
  state.waSched = Object.assign({}, state.waSched, slots);
  const w = state.waSched;
  if (!w.name) { state.expect = 'wa_sched_name'; reply('Who should I send it to on WhatsApp? Give me a contact name.'); return true; }
  if (!w.msg)  { state.expect = 'wa_sched_msg';  reply(`What should I say to ${w.name}?`); return true; }
  if (!w.time) { state.expect = 'wa_sched_time'; reply(`When should it go? e.g. "9pm", "tomorrow 8am", "kal 8 baje".`); return true; }
  state.waSched = null;
  const item = S.addItem(KEYS.REMINDERS, {
    text: `💬 WhatsApp ${w.name}: ${w.msg}`,
    due: w.time, done: false,
    wa: { name: w.name, msg: w.msg }
  });
  scheduleReminder(item);
  refresh('reminders');
  const ht = humanTime(new Date(w.time));
  reply(`Scheduled - ${/^in /.test(ht) ? ht : 'at ' + ht} I'll open WhatsApp and send "${w.msg}" to ${w.name}. (Works best when the phone is unlocked - I press the send button for you.)`);
  return true;
}

/* v8.0 Karen morning brief - live data in, warm human brief out. */
async function buildDailyBrief() {
  const bits = [];
  try {
    const loc = await API.resolveLocation();
    const wx = await API.getWeather(loc.lat, loc.lon);
    const [desc] = API.describeWMO(wx.current.weather_code);
    bits.push(`Weather: ${Math.round(wx.current.temperature_2m)}°C ${desc}`);
  } catch (e) {}
  try { const st = await HEALTH.getSteps(); if (st) bits.push(`Steps so far: ${st.today} of ${HEALTH.stepsGoal()}`); } catch (e) {}
  try { const b = await D.battery(); if (b && typeof b.level === 'number') bits.push(`Battery ${b.level}%`); } catch (e) {}
  const rs = (S.getList(KEYS.REMINDERS) || []).filter(r => !r.done && r.due).sort((x, y) => x.due - y.due).slice(0, 3);
  if (rs.length) bits.push('Reminders: ' + rs.map(r => `${r.text} (${humanTime(new Date(r.due))})`).join('; '));
  if (NAT.isNative()) {
    try {
      const u = await NAT.getUsageStats(1);
      const top = u && u.ok && (u.items || [])[0];
      if (top) bits.push(`Your most-used app yesterday: ${top.label}`);
    } catch (e) {}
  }
  return bits;
}

async function runAction(a, hit) {
  switch (a.type) {
    case 'open_panel': U.openPanel(a.panel); if (a.prefill) prefillPanel(a.panel, a.prefill); return true;
    case 'stop_speech': V.cancelSpeech(); state.speaking = false; setStatus('Tap to speak'); return true;
    case 'clear_chat': state.messages = []; $('#chatMessages').innerHTML = ''; S.saveList(KEYS.CHAT, []); return true;
    case 'theme': S.setSetting('uiTheme', a.theme); U.applyTheme(a.theme); syncSettingsUI(); return true;
    case 'call': {
      if (NAT.isNative()) {
        const r = await NAT.placeCall(a.number);
        if (r.ok) return true;
      }
      D.call(a.number);
      return true;
    }
    case 'sms': {
      if (NAT.isNative() && a.body) {
        const r = await NAT.sendSMSSilent(a.number, a.body);
        if (r.ok) { reply(`Message sent to ${a.name || 'them'}.`); return true; }
      }
      D.sms(a.number, a.body);
      return true;
    }
    case 'whatsapp': {
      if (NAT.isNative()) {
        const r = await NAT.whatsappSend(a.number, a.body || '', true);
        if (r.ok) {
          reply(a.body
            ? (r.autoSend
                ? `Sending "${a.body}" to ${a.name || 'them'} on WhatsApp.`
                : `WhatsApp is open with your message. Tap send \u2014 or enable Accessibility so I can tap it for you.`)
            : `Opening WhatsApp for ${a.name || 'them'}.`);
          return true;
        }
      }
      D.whatsapp(a.number, a.body);
      return true;
    }
    case 'navigate': D.maps(a.dest); return true;
    case 'open_app': {
      if (NAT.isNative()) {
        const r = await NAT.launchApp(a.app);
        if (r.ok) { reply(`Opening ${r.app ? r.app.label : a.app}.`); return true; }
        if (r.reason === 'not_found') { reply(`I can't find an app called "${a.app}".`); return true; }
      }
      D.openApp(a.app);
      return true;
    }
    case 'camera': U.openPanel('camera'); openCamera(a.mode); return true;

    /* ================= v10.3 HERALD: INBOX + CALL GUARD ================= */
    case 'inbox_check': {      /* "whatsapp pe kya aaya?" */
      const log = await NAT.getNotifLog(a.app || 'whatsapp', 40);
      const items = HERALD.pickLatestInbox((log && log.items) || [], a.app || 'whatsapp');
      if (!items.length) {
        reply(NAT.isNative() ? `Abhi koi naya ${a.app || 'whatsapp'} message nahi dikha, Boss. (Notification access ON hai na?)`
                             : 'Inbox sirf installed app me kaam karta hai.');
        return true;
      }
      reply(HERALD.inboxSummary(items) + ' — "uska jawab do" bolo to draft bana doon.');
      return true;
    }
    case 'inbox_reply': {      /* draft is bound to one notification action */
      let target = null;
      if (a.eventKey && state.proactiveEvent && state.proactiveEvent.key === a.eventKey) {
        const e = state.proactiveEvent;
        target = { key: e.key, pkg: e.pkg, who: e.title || 'Someone', text: e.text,
          replyable: e.replyable, sensitive: e.sensitive, when: e.time || Date.now() };
      }
      if (!target) {
        const log = await NAT.getNotifLog(a.app || 'whatsapp', 40);
        const items = HERALD.pickLatestInbox((log && log.items) || [], a.app || 'whatsapp');
        target = items[0] || null;
      }
      if (!target) { reply('I could not find a recent message to bind this reply to, Boss.'); return true; }
      const p = HERALD.draftPromptFor(target.who, target.text, MEM.buildContext ? MEM.buildContext() : '');
      let draft = '';
      if (SERVER.isConfigured() || AI.hasGroq()) {
        try { draft = await AI.callGroq([{ role: 'system', content: p.sys }, { role: 'user', content: p.usr }], { maxTokens: 120 }); } catch (_) {}
      }
      if (!draft || !String(draft).trim()) draft = `Haan ${target.who}, Boss abhi busy hain — thodi der me reply karte hain.`;
      draft = String(draft).trim();
      if (!target.key || target.replyable === false) {
        state.pendingInboxSend = null;
        reply(`Draft for ${target.who}: “${draft}”\n\nThat notification does not expose an Android RemoteInput action, so I cannot send it. I can only copy it or open the source app.`);
        return true;
      }
      state.pendingInboxSend = PROACTIVE.createReplyAuthorization({
        eventKey: target.key, app: target.pkg || a.app || 'whatsapp', recipient: target.who, text: draft
      });
      state.expect = 'inbox_send_confirm';
      reply(PROACTIVE.confirmationPrompt(state.pendingInboxSend));
      addClarifyChips([
        { label: '✅ Send this exact reply', say: 'send it' },
        { label: '❌ Cancel', say: 'cancel' }
      ]);
      return true;
    }
    case 'inbox_send': {
      if (!state.pendingInboxSend) { reply('There is no recipient-bound reply waiting for approval. Nothing was sent.'); return true; }
      state.expect = 'inbox_send_confirm';
      reply(PROACTIVE.confirmationPrompt(state.pendingInboxSend));
      return true;
    }
    case 'inbox_reshoot': {    /* chip "naya draft" */
      if (!state.pendingInboxSend) { reply('Koi draft pending nahi hai — "uska jawab do" bolo pehle.'); return true; }
      const kept = state.pendingInboxSend;
      state.pendingInboxSend = null;
      return handleInput(`uska jawab do`, { noChain: true });
    }
    case 'call_guard': {       /* "call guard on karo" */
      S.setSetting('callGuard', !!a.on);
      const chk = $('#callGuard'); if (chk) chk.checked = !!a.on;
      const saved = await syncCallGuardNative();
      if (!saved || !saved.ok) {
        S.setSetting('callGuard', !a.on);
        if (chk) chk.checked = !a.on;
        reply('I could not save that Call Assistant change, so I left the previous native state in place.');
        return true;
      }
      reply(a.on
        ? 'Call Assistant ON — incoming calls can be announced with Accept, Decline, Silence, and previewed Message controls where Android permits them.'
        : 'Call Assistant off. FRIDAY will not control incoming calls.');
      return true;
    }

    case 'torch': {
      if (NAT.isNative()) {
        const r = await NAT.setTorch(a.on);
        if (r.ok) { reply(`Torch ${a.on ? 'on' : 'off'}.`); return true; }
      }
      const okw = await D.torch(a.on);
      reply(okw ? `Torch ${a.on ? 'on' : 'off'}.` : 'Torch needs the camera open, or the installed app.');
      return true;
    }
    case 'contact_lookup': {
      /* v10.1 fix: fall back to locally-saved contacts (web/browser mode) */
      const hit = await contactByName(a.name);
      if (hit) {
        if (a.mode === 'call') return runAction({ type: 'call', number: hit.phone, name: hit.name }, {});
        if (a.mode === 'sms') return runAction({ type: 'sms', number: hit.phone, body: a.body, name: hit.name }, {});
        if (a.mode === 'whatsapp') return runAction({ type: 'whatsapp', number: hit.phone, body: a.body, name: hit.name }, {});
      }
      reply(`I couldn't find "${a.name}" in your contacts.`);
      return true;
    }

    case 'battery': {
      const b = await D.battery();
      reply(b ? `Power at ${b.level}%${b.charging ? ', charging' : ''}.` : 'Battery info unavailable in this browser.');
      return true;
    }
    case 'timer': {
      setTimeout(() => { D.buzz(); D.notify('FRIDAY', 'Timer complete.'); U.toast('Timer complete', '⏰'); V.speak('Timer complete.'); }, a.seconds * 1000);
      return true;
    }
    case 'schedule_reminder': scheduleReminder(a.item); return true;
    case 'weather': await doWeather(a.tomorrow); return true;
    case 'aqi': await doAQI(); return true;
    case 'location': await doLocation(); return true;
    case 'wiki': await doWiki(a.query); return true;
    case 'define': await doDefine(a.word); return true;
    case 'news': await doNews(); return true;
    case 'currency': await doCurrency(a.query); return true;
    case 'code': await doCode(a.prompt); return true;
    case 'copy_secret': {
      await D.copy(a.text);
      addMsg('ai', '```\n' + a.text + '\n```');
      return true;
    }
    case 'briefing': await doBriefing(); return true;

    /* ===== PHASE B/C native actions ===== */
    case 'sys_toggle': {
      if (!NAT.isNative()) { reply(nativeOnly(a.what)); return true; }
      const fn = { wifi: NAT.setWifi, bluetooth: NAT.setBluetooth, dnd: NAT.setDND }[a.what];
      const r = await fn(a.on);
      if (r.opened_panel) reply(`Android won't let apps toggle ${a.what} directly. I opened the panel for you.`);
      else if (r.ok) reply(`${a.what === 'dnd' ? 'Do not disturb' : a.what.charAt(0).toUpperCase() + a.what.slice(1)} ${a.on ? 'on' : 'off'}.`);
      else if (r.reason === 'no_dnd_access') { reply('I need Do Not Disturb access. Opening settings.'); NAT.openSpecialSetting('dnd'); }
      else reply(`Couldn't change ${a.what}.`);
      return true;
    }

    case 'sys_volume': {
      if (!NAT.isNative()) { reply(nativeOnly('volume control')); return true; }
      const r = await NAT.setVolume(a.percent);
      reply(r.ok ? `Volume ${a.percent}%.` : "Couldn't change volume.");
      return true;
    }

    case 'sys_brightness': {
      if (!NAT.isNative()) { reply(nativeOnly('brightness')); return true; }
      const r = await NAT.setBrightness(a.percent);
      if (r.reason === 'no_write_settings') { reply('I need permission to modify system settings. Opening that now.'); NAT.openSpecialSetting('write_settings'); }
      else reply(r.ok ? `Brightness ${a.percent}%.` : "Couldn't change brightness.");
      return true;
    }

    case 'media': {
      if (!NAT.isNative()) { reply(nativeOnly('media control')); return true; }
      const r = await NAT.mediaControl(a.action);
      /* v8.4: honest verbs, no more bare "Playing." */
      const verbs = {
        play: 'Music playing.', pause: 'Music paused.', stop: 'Music stopped.',
        next: 'Next track.', previous: 'Previous track.', playpause: 'Toggled play/pause.'
      };
      reply(r.ok ? (verbs[a.action] || 'Done.') : "Couldn't reach a media player - is anything actually playing right now?");
      return true;
    }

    /* v8.4 TRUE CONTROL: named game/app via "play candy crush" */
    case 'play_game': {
      if (!NAT.isNative()) { reply(nativeOnly('launching games')); return true; }
      const r0 = await NAT.launchApp(a.name);
      if (r0 && r0.ok && r0.app) { reply(`Opening ${r0.app.label}. Enjoy, ${S.getSetting('userName') || 'Boss'}.`); return true; }
      reply(`I couldn't find a game or app called "${a.name}" on this phone. Check the exact name, or install it first.`);
      return true;
    }

    /* v8.4 TRUE CONTROL: "i like to play" - context decides game vs music.
       Scans my last message for a title that matches an installed app; falls
       back honestly instead of blindly firing the music key (the old bug:
       "i like to play" started your last music session). */
    case 'play_context': {
      if (!NAT.isNative()) { reply(nativeOnly('games and media')); return true; }
      const last = [...state.messages].reverse().find(m => m.role === 'ai');
      const src = last ? String(last.text || '').toLowerCase() : '';
      const words = src.match(/[a-z][a-z0-9']{2,}/g) || [];
      const pairs = [];
      for (let i = 0; i + 1 < words.length; i++) pairs.push(words[i] + ' ' + words[i + 1]);
      const stopw = ['would','like','that','this','with','your','from','have','what','when','then','them','they','boss','friday','open','opening','same','checking','notification','game','play','market','music','song','want','lets','need','see','now','candies','blast','sugar','spread','master','sweetest','puzzle','games'];
      const cands = [...pairs, ...words].filter(w => w.trim() && !stopw.includes(w.trim()));
      for (const c of cands) {
        const hit = await NAT.launchApp(c);
        if (hit && hit.ok && hit.app) { reply(`Opening ${hit.app.label}. Enjoy!`); return true; }
      }
      if (/play|game|khel/.test(src)) {
        reply('Tell me the game\'s name - say "play Ludo" or "open Candy Crush" and I\'ll open it.');
        return true;
      }
      const rp = await NAT.mediaControl('play');
      reply(rp && rp.ok ? 'Music playing.' : 'Nothing to play right now. Name a game ("play Ludo") or start some music first.');
      return true;
    }

    /* ================= v9.0 APEX cases ================= */
    case 'wallpaper':      return doWallpaper(a.topic);
    case 'notif_history':  return doNotifHistory();
    case 'notif_digest':   return doNotifDigest(a.app || '');
    case 'sos':            return doSOS();
    case 'sos_cancel': {
      if (state.sosTimer) { clearTimeout(state.sosTimer); state.sosTimer = null; reply('SOS cancelled. Nothing was sent.'); }
      else reply('No SOS is armed right now.');
      return true;
    }
    case 'sos_set_contact': {
      S.setSetting('emergencyContact', a.number);
      reply(`Emergency contact locked in: ${a.number}. If you ever say "SOS", I send them your live location by SMS after an 8-second cancel window.`);
      return true;
    }
    case 'dictate': {
      state.dictateNext = true;
      reply('Speak your message - ums and aahs allowed. I will clean it into a proper draft.');
      setTimeout(() => { if (state.dictateNext) V.listen(); }, 900);
      return true;
    }
    case 'park_save':      return doCarSave();
    case 'park_find':      return doCarFind();
    case 'sleep_timer':    return doSleepTimer(a.minutes || 20);
    case 'read_page':      return doReadPage(a.url || '');
    case 'watch_add':      return doWatchAdd(a.needle, a.app);
    case 'watch_cancel': {
      state.watchers = [];
      clearInterval(state.watchLoop); state.watchLoop = null;
      reply('All watchers cancelled.');
      return true;
    }
    case 'watch_list': {
      if (!state.watchers || !state.watchers.length) reply('No active watchers. Say "watch whatsapp for mummy" to set one.');
      else reply('Watching for: ' + state.watchers.map(w => {
        const left = Math.max(1, Math.round((w.until - Date.now()) / 60000));
        return `"${w.needle}"${w.app ? ' in ' + w.app : ''} (${left}m left)`;
      }).join(', '));
      return true;
    }

    case 'gesture': {
      if (!NAT.isNative()) { reply(nativeOnly('system gestures')); return true; }
      const r = await NAT.performGlobalAction(a.action);
      if (r.reason === 'accessibility_off') {
        reply('That needs the accessibility service. Opening settings - find FRIDAY and turn it on.');
        NAT.openSpecialSetting('accessibility');
      } else if (!r.ok) reply("Couldn't do that.");
      return true;
    }

    case 'read_otp': {
      if (!NAT.isNative()) { reply(nativeOnly('SMS reading')); return true; }
      const r = await NAT.getLatestOTP();
      if (r.ok && r.otp) {
        await D.copy(r.otp);
        reply(`Your code is ${r.otp.split('').join(' ')}. Copied to clipboard.`);
      } else if (r.reason === 'no_permission') {
        reply('I need SMS permission for that. Say "setup" to grant it.');
      } else reply('No recent code found.');
      return true;
    }

    case 'storage': {
      if (!NAT.isNative()) { reply(nativeOnly('storage info')); return true; }
      const r = await NAT.getStorageInfo();
      reply(r.ok ? `${r.freeGB} GB free of ${r.totalGB} GB. ${r.usedPercent}% used.` : 'Storage info unavailable.');
      return true;
    }

    case 'bubble': {
      if (!NAT.isNative()) { reply(nativeOnly('the floating bubble')); return true; }
      const r = await NAT.showBubble(a.on);
      if (r.reason === 'no_overlay_permission') {
        reply('I need overlay permission for the bubble. Opening settings.');
        NAT.openSpecialSetting('overlay');
      } else reply(r.ok ? (a.on ? 'Bubble on. Drag it anywhere, tap to open me.' : 'Bubble off.') : "Couldn't do that.");
      return true;
    }

    case 'reply_notif': {
      if (!NAT.isNative()) { reply(nativeOnly('notification replies')); return true; }
      reply('For safety I cannot send an unbound notification reply. Say “check my inbox”, choose the exact message, review the recipient and draft, then confirm “send it”.');
      return true;
    }

    /* ---------- v7.3: find a person on Google Maps ---------- */
    case 'find_person': return findPersonOnMaps(a);

    /* ---------- v7.3: security guard ---------- */
    case 'security_scan': return runSecurityScan();

    /* ---------- v7.3: password vault ---------- */
    case 'vault_save': {
      if (!VAULT.cryptoOk()) { reply('Your WebView is too old for the encrypted vault.'); return true; }
      state.vaultPending = { kind: 'save', service: a.service, password: a.password };
      if (!VAULT.vaultExists()) {
        reply(`I'll keep that in your encrypted vault. First-time setup — type a 4-8 digit vault PIN (digits only, it's never spoken or stored).`);
        state.expect = 'vault_pin';
        return true;
      }
      if (!VAULT.vaultUnlocked()) {
        reply('Vault is locked. Type your vault PIN (digits only).');
        state.expect = 'vault_pin';
        return true;
      }
      return finishVaultPending();
    }
    case 'vault_read': {
      if (!VAULT.vaultExists()) { reply(`No vault yet. Say "save my gmail password as …" and I'll create one.`); return true; }
      state.vaultPending = { kind: 'read', service: a.service };
      if (!VAULT.vaultUnlocked()) { reply('Type your vault PIN first (digits only).'); state.expect = 'vault_pin'; return true; }
      return finishVaultPending();
    }
    case 'vault_forget': {
      if (!VAULT.vaultExists()) { reply('No vault yet.'); return true; }
      state.vaultPending = { kind: 'forget', service: a.service };
      if (!VAULT.vaultUnlocked()) { reply('Type your vault PIN first (digits only).'); state.expect = 'vault_pin'; return true; }
      return finishVaultPending();
    }
    case 'vault_lock': {
      VAULT.vaultLock();
      reply('Vault locked. Your passwords are sealed again.');
      return true;
    }
    case 'vault_list': {
      if (!VAULT.vaultExists()) { reply('No vault yet.'); return true; }
      if (!VAULT.vaultUnlocked()) {
        state.vaultPending = { kind: 'list' };
        reply('Type your vault PIN first (digits only).');
        state.expect = 'vault_pin';
        return true;
      }
      const svcs = VAULT.vaultServices();
      reply(svcs.length
        ? `Your vault holds ${svcs.length}: ${svcs.map(s => '"' + s + '"').join(', ')}. Ask "what's my <name> password".`
        : 'Vault is empty. Say "save my gmail password as …".');
      return true;
    }

    /* ---------- v7.4 REDTEAM: ethical hacker pack ---------- */
    case 'net_recon': return runNetRecon();
    case 'port_scan': return runPortScan(a.host);
    case 'password_check': {
      if (!a.password) {
        state.expect = 'password_check_text';
        reply('Type the password to audit. It is checked **locally** — never stored, never spoken.');
        return true;
      }
      return auditPassword(a.password);
    }
    case 'phish_check': {
      if (!a.url) {
        state.expect = 'phish_link';
        reply('Paste the link and I will judge it.');
        return true;
      }
      return judgeLink(a.url);
    }
    case 'phish_sms': return scanSmsForPhishing();

    /* ---------- v7.3: full-control UI commands ---------- */
    case 'ui_tap':
    case 'ui_scroll':
    case 'ui_type': {
      if (!NAT.isNative()) { reply(nativeOnly('screen control')); return true; }
      const caps = await NAT.capabilities();
      if (!caps.accessibility) {
        reply('I need my Accessibility service for screen control. Opening settings — enable "FRIDAY Control".');
        NAT.openSpecialSetting('accessibility');
        return true;
      }
      let r;
      if (a.type === 'ui_tap') r = await NAT.tapText(a.text);
      else if (a.type === 'ui_scroll') r = await NAT.scrollScreen(a.dir);
      else r = await NAT.typeText(a.text);
      if (r.ok) reply(a.type === 'ui_tap' ? `Tapped "${a.text}".`
                      : a.type === 'ui_scroll' ? `Scrolled ${a.dir}.` : 'Typed.');
      else reply(a.type === 'ui_tap'
        ? `Couldn't find "${a.text}" on screen.`
        : 'Nothing on screen took that action.');
      return true;
    }

    case 'read_notifications': {
      if (!NAT.isNative()) { reply(nativeOnly('notification reading')); return true; }
      const caps = await NAT.capabilities();
      if (!caps.notifications) {
        reply('I need notification access first. Opening settings - turn FRIDAY on, then ask me again.');
        NAT.openSpecialSetting('notification_listener');
        return true;
      }
      // v7.4.3: read the real shade, not just events seen since app start
      let items = [];
      try {
        const r = await NAT.getActiveNotifications();
        if (r && r.ok && Array.isArray(r.items)) items = r.items;
      } catch (e) {}
      if (!items.length) items = recentNotifs;
      if (!items.length) { reply('Your notification shade is empty. Nothing to read.'); return true; }
      // v7.6.4: per-app filter — "see the message of telegram"
      const NOTIF_PKGS = {
        whatsapp: ['whatsapp'], telegram: ['telegram'], instagram: ['instagram'],
        gmail: ['gm', 'gmail'], messenger: ['facebook.orca'],
        messages: ['messaging', 'mms'], sms: ['messaging', 'mms']
      };
      if (a.app) {
        const key = Object.keys(NOTIF_PKGS).find(k => a.app.toLowerCase().includes(k));
        const pats = (key ? NOTIF_PKGS[key] : [a.app.toLowerCase().replace(/\s+/g, '')]).filter(p => p.length >= 2);
        const label = key || a.app;
        items = items.filter(n => pats.some(p =>
          (n.pkg || '').toLowerCase().includes(p) || (n.title || '').toLowerCase().includes(p)));
        if (!items.length) { reply(`Nothing from ${label} in the shade right now.`); return true; }
        const lines = items.slice(0, 5).map(n => {
          const hidden = /sensitive notification content hidden/i.test(n.text || '');
          return hidden
            ? `${NAT.friendlyApp(n.pkg)} - ${n.title}: (content hidden by lock-screen privacy - disable "Hide sensitive content" for ${NAT.friendlyApp(n.pkg)} to let me read it)`
            : `${NAT.friendlyApp(n.pkg)} - ${n.title}: ${n.text}`.slice(0, 140);
        });
        reply(`${items.length} from ${label}:\n` + lines.map(l => '\u2022 ' + l).join('\n'));
        return true;
      }
      const lines = items.slice(0, 5)
        .map(n => `${NAT.friendlyApp(n.pkg)} - ${n.title}: ${n.text}`.slice(0, 120));
      reply(`${items.length} in your shade:\n` + lines.map(l => '\u2022 ' + l).join('\n'));
      return true;
    }

    /* ================= v7.5 TITAN ================= */

    case 'steps': {
      if (!NAT.isNative()) { reply(nativeOnly('step counting')); return true; }
      await HEALTH.ensureSteps();
      const st = await HEALTH.getSteps();
      if (!st) {
        reply('Step sensor needs the Physical Activity permission. Say "permissions" or allow it when asked, then try again.');
        NAT.requestAll();
        return true;
      }
      const goal = HEALTH.stepsGoal();
      const avg = HEALTH.weeklyAverage(st.days);
      reply(`👟 **${st.today.toLocaleString()} steps** today (${HEALTH.stepsVerdict(st.today, goal)})`
        + (avg ? `\nWeekly average: ${avg.toLocaleString()}/day.` : ''));
      return true;
    }

    case 'step_goal': {
      if (!a.goal) { reply('Say it with a number: "steps goal 8000" or "steps goal 10000".'); return true; }
      const g = HEALTH.setStepsGoal(a.goal);
      reply(`Step goal set to ${g.toLocaleString()} a day. I'll track your progress with the phone's step sensor.`);
      return true;
    }

    case 'health_summary': {
      if (!NAT.isNative()) { reply(nativeOnly('health summary')); return true; }
      const st = await HEALTH.getSteps();
      if (!st) { reply('No health data yet. Walk a little with the phone and ask again.'); return true; }
      const series = HEALTH.weekSeries(st.days);
      const bars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇'];
      const max = Math.max(1, ...series.map(x => x.steps));
      const chart = series.map(x => `${x.day} ${bars[Math.min(6, Math.round(x.steps / max * 6))]} ${x.steps.toLocaleString()}`).join('\n');
      reply(`**Weekly health**\n${chart}\n\nAverage: ${HEALTH.weeklyAverage(st.days).toLocaleString()} steps/day - goal ${HEALTH.stepsGoal().toLocaleString()}.`);
      return true;
    }

    case 'health_sync': {
      if (!NAT.isNative()) { reply(nativeOnly('Health Connect')); return true; }
      const st = await NAT.hcStatus();
      if (!st || !st.ok) { reply('Health Connect is not available in this build. Your own step sensor keeps working regardless.'); return true; }
      const r = await NAT.hcReadSteps(1);
      if (!r.ok && r.reason === 'hc_permission') {
        reply('Opening Health Connect - find FRIDAY and allow Steps. Then say "health connect" again.');
        NAT.hcOpenSettings();
        return true;
      }
      if (!r.ok) {
        reply('Health Connect is not set up on this phone. Opening its store page - or just use my built-in step counter, it needs no setup.');
        NAT.hcOpenSettings();
        return true;
      }
      reply(`Health Connect says ${Number(r.steps || 0).toLocaleString()} steps today. My own sensor tracks you even without it - say "my steps".`);
      return true;
    }

    case 'water_plan': {
      const h = Math.max(1, Math.min(6, a.hours || 2));
      const times = [];
      for (let t = 8 * 60; t <= 22 * 60; t += h * 60) {
        times.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'));
      }
      for (const tm of times) AUTO.addAlarm({ time: tm, label: '💧 Drink water', repeat: 'daily' });
      refresh('alarms');
      D.notifyPermission();
      reply(`💧 Water plan armed - every ${h} hour${h === 1 ? '' : 's'} from 8 AM to 10 PM (${times.length} alarms daily). Stay hydrated, boss.`);
      return true;
    }

    case 'med_plan': {
      state.expect = 'med_times';
      reply('What times? Say like: **medicine 8am 2pm 8pm** and I will set daily alarms.');
      return true;
    }

    case 'eye_break': {
      const label = '👁 Eye break';
      if (a.on === false) {
        const gone = AUTO.alarms().filter(al => al.label === label);
        gone.forEach(al => AUTO.deleteAlarm(al.id));
        refresh('alarms');
        reply(`Eye-break alarms off (${gone.length} removed).`);
        return true;
      }
      const times = [];
      for (let t = 9 * 60; t <= 18 * 60; t += 60) {
        times.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'));
      }
      for (const tm of times) AUTO.addAlarm({ time: tm, label, repeat: 'daily' });
      refresh('alarms');
      reply('👁 Eye breaks on - hourly from 9 to 6. 20-20-20 rule: every alarm, look at something 20 feet away for 20 seconds.');
      return true;
    }

    case 'focus_mode': {
      if (a.off) {
        await HEALTH.stopFocus();
        clearInterval(state.focusLoop); state.focusLoop = null;   // v9 police off
        state.focus = null;
        reply('Focus mode off. Notifications are back. Well done.');
        return true;
      }
      const mins = a.minutes || 25;
      await HEALTH.startFocus(mins, () => {
        clearInterval(state.focusLoop); state.focusLoop = null;   // v9 police auto-off
        state.focus = null;
        addMsg('ai', `⏱ Focus session done (${mins} min). Take a breath - you earned it.`, { proactive: true });
        V.speak(`Focus session complete. Well done, ${S.getSetting('userName') || 'boss'}.`);
      });
      /* v9.0: arm the scroll police beside the existing DND focus */
      state.focus = { until: Date.now() + mins * 60000, warned: {} };
      startFocusLoop();
      reply(`⏱ **Focus mode: ${mins} minutes.** Do Not Disturb is ON, my announcements are muted - and I'll nudge you if you drift into scroll apps. Go.`);
      return true;
    }

    case 'screen_time': {
      if (!NAT.isNative()) { reply(nativeOnly('screen time report')); return true; }
      const days = a.days || 1;
      const r = await NAT.getUsageStats(days);
      if (!r || !r.ok) {
        reply('I need Usage Access for that. Opening settings - find FRIDAY and allow "Usage access".');
        NAT.openSpecialSetting('usage_access');
        return true;
      }
      const items = (r.items || []).slice(0, 5);
      const lines = items.map(i => `\u2022 **${i.label}** - ${Math.floor(i.minutes / 60) ? Math.floor(i.minutes / 60) + 'h ' : ''}${i.minutes % 60}m`).join('\n');
      const tot = Math.round(r.totalMinutes || 0);
      reply(`📱 Screen time${days > 1 ? ' (7 days)' : ' today'}: **${Math.floor(tot / 60)}h ${tot % 60}m** total.\n${lines}\n\n${HEALTH.screenTimeVerdict(tot, days)}`);
      return true;
    }

    case 'translate': {
      const LANG_NAME = { hi: 'Hindi', en: 'English', mr: 'Marathi', ta: 'Tamil', te: 'Telugu', bn: 'Bengali',
        ur: 'Urdu', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', es: 'Spanish', fr: 'French',
        de: 'German', zh: 'Chinese', ja: 'Japanese', ar: 'Arabic', ru: 'Russian', pt: 'Portuguese', it: 'Italian',
        ko: 'Korean', th: 'Thai' };
      const to = a.to || 'hi';
      const name = LANG_NAME[to] || to;
      if (!a.text) {
        askClarify('Kya translate karoon, Boss? Bol do.');
        state.pendingClarify = { slot: 'text', intent: 'translate', origText: 'translate', action: a };
        return true;
      }
      const r = await NAT.translateText({ text: a.text, to, from: a.from || '' });
      if (r && r.ok) {
        reply(r.same ? `Ye already ${name} me hai, Boss: "${r.text}"` : `🌐 **${name}**: "${r.text}"`);
      } else if (r && (r.reason === 'not_installed' || r.reason === 'engine_missing')) {
        reply('Translator engine is build me nahi aaya (naya APK chahiye). Groq se try karun?');
      } else if (r && r.reason === 'web') {
        reply('Translator sirf installed app me chalta hai. Web build me Groq use karke translate kar sakti hoon.');
      } else {
        reply(`Pehli baar ${name} model download hota hai - ek baar internet on rakho, phir hamesha offline. Phir se try karo.`);
      }
      return true;
    }

    case 'battery_guard': {
      if (a.kind === 'low') {
        S.setSetting('batteryWarnLow', a.level || 20);
        reply(`Battery guard: I'll warn you when the battery drops to ${a.level || 20}%, even in the background.`);
      } else {
        S.setSetting('batteryWarnFull', a.on !== false);
        reply(a.on === false ? 'Full-battery alert off.' : 'I will tell you the moment the battery hits 100%. Unplug early, battery stays young.');
      }
      HEALTH.startBatteryGuard(msg => V.speak(msg));
      return true;
    }

    case 'find_phone': {
      if (!NAT.isNative()) { reply(nativeOnly('find my phone')); return true; }
      if (a.on === false) {
        await NAT.phoneFinder(false);
        reply('Alarm stopped. Found it, good.');
        return true;
      }
      const r = await NAT.phoneFinder(true);
      reply(r.ok ? '🔊 Ringing at FULL VOLUME. Say "stop ringing" when you have it.' : 'Could not ring this phone right now.');
      return true;
    }

    case 'whatsapp_schedule': {
      /* v7.6.4: natural-language slot filling - ask for the missing piece one
         by one instead of demanding an exact command format */
      return collectWaSchedule({
        name: (a.name || '').replace(/^(to|for|ko)\s+/i, '').trim(),
        msg: (a.msg || '').trim(),
        time: a.time || null
      });
    }

    case 'screen_vision': {
      thinking(true);
      const r = await performScreenVision(a.question);
      thinking(false);
      reply(r.text);
      if (r.openA11y) NAT.openSpecialSetting('accessibility');
      return true;
    }

    case 'daily_brief': {
      thinking(true);
      const bits = await buildDailyBrief();
      thinking(false);
      const name = S.getSetting('userName') || 'Boss';
      if (AI.hasGroq() && bits.length) {
        try {
          const out = await AI.callGroq([
            { role: 'system', content: 'You are FRIDAY, the user\'s suit AI (Iron Man style). Turn this data into ONE warm 3-4 sentence spoken brief for ' + name + '. Talk like a person - no bullets, no headers, no emoji spam. Data: ' + bits.join(' | ') },
            { role: 'user', content: 'Give me my brief.' }
          ], { maxTokens: 230, temperature: 0.6 });
          if (out) { reply(out); return true; }
        } catch (e) {}
      }
      const greet = new Date().getHours() < 12 ? 'Good morning' : 'Here is your brief';
      reply(bits.length
        ? `${greet}, ${name}. ` + bits.join('. ') + '.'
        : `${greet}, ${name}. No live data right now - weather is offline or permissions are pending.`);
      return true;
    }

    case 'quick_translate': {
      /* v10.0: legacy alias — the offline ML Kit engine handles it now,
         with the cloud API + panel as deeper fallbacks. */
      const QL = { hindi: 'hi', english: 'en', marathi: 'mr', tamil: 'ta', telugu: 'te', bengali: 'bn',
        urdu: 'ur', gujarati: 'gu', kannada: 'kn', spanish: 'es', french: 'fr', german: 'de', chinese: 'zh',
        japanese: 'ja', arabic: 'ar', russian: 'ru' };
      const tr = await NAT.translateText({ text: a.text, to: QL[a.lang] || a.lang || 'hi', from: '' });
      if (tr && tr.ok) { reply(`🌐 "${a.text}" → **${tr.text}** (${a.lang})`); return true; }
      const r = await API.quickTranslate(a.text, a.lang);
      if (!r.ok) {
        reply('Opening the translator panel instead.');
        U.openPanel('sub-translate');
        prefillPanel('sub-translate', a.text);
        return true;
      }
      reply(`🌐 "${a.text}" → **${r.text}** (${a.lang})`);
      return true;
    }

    case 'wifi_qr': {
      if (!NAT.isNative()) { reply(nativeOnly('wifi QR')); return true; }
      const w = await NAT.wifiAudit();
      if (!w || !w.ok || !w.ssid) { reply('You are not on WiFi right now. Connect first, then ask me.'); return true; }
      state.wifiQr = { ssid: w.ssid, enc: w.security || 'WPA' };
      state.expect = 'wifi_qr_pass';
      reply(`WiFi **${w.ssid}** found. TYPE its password and I'll make the QR (I use it once and forget it).`);
      return true;
    }

    case 'summarize_link': {
      if (!a.url) { reply('Give me the full link to summarize.'); return true; }
      thinking(true);
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 14000);
        const r = await fetch('https://r.jina.ai/' + a.url, { signal: ctrl.signal });
        clearTimeout(to);
        const txt = (await r.text()).slice(0, 4500);
        if (!txt || txt.length < 80) throw new Error('empty');
        if (AI.hasGroq()) {
          const g = await AI.callGroq([
            { role: 'system', content: 'Summarize in 5 short bullet points, plain words, no fluff.' },
            { role: 'user', content: txt }
          ], { maxTokens: 300 });
          reply('📝 **Summary:**\n' + String(g || '').trim());
        } else {
          const first = txt.split(/(?<=[.!?])\s+/).slice(0, 4).join(' ');
          reply('📝 **Local summary:**\n' + first.slice(0, 700) + '\n\n(Configure the optional FRIDAY Cloud backend for smarter summaries.)');
        }
      } catch (e) {
        reply('Could not read that link (blocked or offline). Open it once in the browser and try again.');
      }
      thinking(false);
      return true;
    }

    case 'pocket_guard': {
      if (!NAT.isNative()) { reply(nativeOnly('pocket guard')); return true; }
      if (a.on === false) {
        await HEALTH.stopPocketAlarm();
        reply('Pocket guard disarmed.');
        return true;
      }
      const okArm = await HEALTH.setPocketGuard(true);
      reply(okArm
        ? '🛡 Pocket guard ARMED. If the phone moves for more than a second, a loud alarm fires - works with the screen off. Say "pocket mode off" when you pick it up.'
        : 'This phone has no motion sensor available for pocket guard.');
      return true;
    }

    case 'backup_data': {
      try {
        D.download(`friday-backup-${Date.now()}.json`, JSON.stringify(S.exportAll(), null, 2));
        reply('Backup downloaded - reminders, memory, notes, settings (API keys are never exported, on purpose).');
      } catch (e) {
        D.copy(JSON.stringify(S.exportAll()));
        reply('Backup copied to clipboard - paste it anywhere to keep it safe.');
      }
      return true;
    }

    case 'voice_note': {
      reply('Go ahead - I am listening for your note.');
      state.expect = 'voice_note';
      setTimeout(() => { if (!state.listening) V.listen(); }, 700);
      return true;
    }

    case 'hindi_ui': {
      S.setSetting('hindiUI', a.on);
      I18N.applyHindiUI();
      reply(a.on
        ? 'Hindi UI on - screens, buttons aur boot ab Hinglish mein dikhenge. Voice replies stay the same.'
        : 'English UI on. Everything back to English.');
      return true;
    }

    /* ================= v7.6 APEX ================= */

    case 'screen_read': {
      if (!NAT.isNative()) { reply(nativeOnly('screen reading')); return true; }
      const r = await NAT.readScreenText();
      if (!r || !r.ok) {
        reply('I need the FRIDAY Control accessibility service for this. Opening settings - turn it on.');
        NAT.openSpecialSetting('accessibility');
        return true;
      }
      const text = (r.text || '').trim();
      if (!text) { reply('The screen reads empty - this app may block screen reading.'); return true; }
      if (a.mode === 'translate') {
        const tr = await API.quickTranslate(text.slice(0, 450),
          /[ऀ-ॿ]/.test(text) ? 'english' : 'hindi');
        reply(tr.ok ? '🌐 Screen, translated:\n' + tr.text : 'Translation needs internet. Screen stays as-is.');
        return true;
      }
      if (a.mode === 'summarize' && AI.hasGroq()) {
        const g = await AI.callGroq([
          { role: 'system', content: 'Summarize this phone screen content in 3 short useful lines.' },
          { role: 'user', content: text.slice(0, 3500) }
        ], { maxTokens: 220 });
        reply('📱 Screen summary:\n' + String(g || '').trim());
        return true;
      }
      const clean = text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 14).join('. ').slice(0, 700);
      reply('📱 On your screen:\n' + clean);
      return true;
    }

    case 'eyes': {
      reply('Looking through the camera... one second.');
      thinking(true);
      const r = await VIS.lookAround(a.question, () => {});
      thinking(false);
      if (!r.ok) {
        reply(r.reason === 'camera_blocked'
          ? 'Camera is blocked for me. Settings > Apps > FRIDAY OS > Permissions > Camera > Allow, then try again.'
          : 'The camera is not available right now.');
        return true;
      }
      reply('📷 ' + r.text);
      return true;
    }

    case 'deep_ask': {
      const q = a.query || '';
      if (!q) { reply('Research what? Try: "latest news on ISRO" or "research electric cars India".'); return true; }
      thinking(true);
      const data = await API.deepResearch(q);
      let answer = '';
      if (AI.hasGroq() && (data.summary || data.headlines.length)) {
        const g = await AI.callGroq([
          { role: 'system', content: 'Answer using ONLY the given material, in 4-6 short lines, plain words, no made-up facts.' },
          { role: 'user', content: 'Question: ' + q + '\n\nMaterial:\n' +
              (data.summary || '') + '\n' + data.headlines.join('\n') }
        ], { maxTokens: 350 });
        answer = String(g || '').trim();
      } else if (data.summary) {
        answer = data.summary.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ');
        if (data.headlines.length) answer += '\n\nLatest:\n' + data.headlines.slice(0, 3).map(h => '\u2022 ' + h).join('\n');
      }
      thinking(false);
      if (!answer) { reply('Nothing solid found on that. Try different words or check internet.'); return true; }
      addMsg('ai', '🔎 **' + q + '**\n' + answer, data.sources[0] ? { link: data.sources[0].url } : {});
      V.speak(answer.slice(0, 320));
      return true;
    }

    case 'yt_play': {
      if (!a.query) { reply('Play what? "play kesariya on youtube".'); return true; }
      if (NAT.isNative()) {
        await NAT.openUrl('https://www.youtube.com/results?search_query=' + encodeURIComponent(a.query));
        reply(`🎵 YouTube is open with "${a.query}" - tap the first video. (Auto-tapping titles is unreliable, you pick the good one.)`);
      } else {
        reply(nativeOnly('YouTube play'));
      }
      return true;
    }

    case 'uni_search': {
      const q = (a.query || '').toLowerCase();
      if (!q) { reply('Search what? "find everything about ramesh".'); return true; }
      const inS = v => String(v || '').toLowerCase().includes(q);
      const hits = [];
      S.getList(KEYS.CONTACTS).filter(c => inS(c.name) || inS(c.phone)).slice(0, 3)
        .forEach(c => hits.push('👤 Contact: **' + c.name + '** ' + (c.phone || '')));
      S.getList(KEYS.NOTES).filter(n => inS(n.text)).slice(0, 3)
        .forEach(n => hits.push('📝 Note: ' + n.text.slice(0, 60)));
      S.getList(KEYS.REMINDERS).filter(r => !r.done && inS(r.text)).slice(0, 3)
        .forEach(r => hits.push('⏰ Reminder: ' + r.text));
      S.getList(KEYS.TASKS).filter(t => !t.done && inS(t.text)).slice(0, 3)
        .forEach(t => hits.push('✅ Task: ' + t.text));
      recentNotifs.filter(n => inS(n.title) || inS(n.text)).slice(0, 3)
        .forEach(n => hits.push('🔔 ' + (n.title || '') + ': ' + (n.text || '').slice(0, 50)));
      if (NAT.isNative() && NAT.getRecentSMS) {
        try {
          const r = await NAT.getRecentSMS(100);
          if (r && r.ok && r.messages) {
            r.messages.filter(m => inS(m.body) || inS(m.from)).slice(0, 3)
              .forEach(m => hits.push('💬 SMS from ' + m.from + ': ' + m.body.slice(0, 60)));
          }
        } catch (e) {}
      }
      reply(hits.length
        ? `**Everything I have on "${a.query}":**\n` + hits.join('\n')
        : `Nothing found about "${a.query}" - checked contacts, notes, reminders, tasks, notifications${NAT.isNative() ? ', SMS' : ''}.`);
      return true;
    }

    case 'quiz': {
      await startQuiz(a.topic || 'general knowledge');
      return true;
    }

    case 'image_make': {
      const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(a.prompt)
        + '?width=768&height=768&nologo=true';
      D.copy(url);
      addMsg('ai', `🎨 **${a.prompt}**\n${url}\n\n(link copied - open to view, long-press to save)`, { link: url });
      V.speak(`Image of ${a.prompt.slice(0, 60)} is ready, boss. Link is in the chat and copied.`);
      return true;
    }

    case 'setup': { await runSetup(); return true; }

    /* ================= v12.0 Phase 8: PLANNER ================= */
    case 'plan': return runPlannerFlow(a.goal, {});

    /* ================= v12.2 Phase 10: DEVICE DIAGNOSTICS ================= */
    case 'device_status': return runDiagnostics();

    /* ================= v14.1: PHOTO actions (shared/captured image) ================= */
    case 'send_image': {
      const name = a.contact || a.name || '';
      if (!name) {
        reply('Kisko bhejna hai? Bolo contact ka naam — jaise "papa".');
        state.expect = 'send_img_to';
        return true;
      }
      return sendSharedImageTo(name);
    }
    case 'save_image': return saveSharedImageTo();
    case 'photo_describe': {
      const img = state.sharedImage;
      if (!img) { reply('Abhi koi photo nahi hai describe karne ke liye.'); return true; }
      thinking(true);
      const v = await AI.callGroqVision(img.dataUrl, a.question || 'Describe this image').catch(() => null);
      thinking(false);
      reply(v && v.ok && v.text ? v.text : 'Vision unavailable (' + ((v && v.reason) || 'error') + ').', { source: 'live' });
      return true;
    }

    /* ================= v15 Phase 2: CHAT management ================= */
    case 'chat_stats': {
      const s = MEMEX.convoStats(state.messages);
      const mins = Math.round(s.durationMs / 60000);
      reply(`**Chat stats** — ${s.total} messages (you ${s.user}, FRIDAY ${s.ai})\n• Avg you: ${s.avgUserLen} chars · Avg FRIDAY: ${s.avgAiLen} chars\n• Session: ~${mins} min · Topics: ${s.topics.length ? s.topics.join(', ') : '—'}`);
      return true;
    }
    case 'chat_export': {
      const text = MEMEX.exportChat(state.messages);
      D.download(`friday-chat-${Date.now()}.txt`, text, 'text/plain');
      reply('Chat export kiya — file download ho gayi.');
      return true;
    }
    case 'chat_share': {
      const text = MEMEX.exportChat(state.messages.slice(-80));
      if (NAT.isNative()) { await D.share('FRIDAY chat', text).catch(() => D.copy(text).then(() => reply('Share sheet nahi khula — chat copied kiya.'))); reply('Chat share ho raha hai.'); }
      else { D.copy(text); reply('Chat copied to clipboard — kahin bhi paste karo.'); }
      return true;
    }
    /* ================= v15 Phase 4: SMART PRODUCTIVITY ================= */
    /* ---- Notes ---- */
    case 'note_save': {
      const rec = NOTESX.addNote({ text: a.text, folder: a.folder || '', kind: a.kind || 'text', tags: a.tags ? NOTESX.autoTags(a.text) : [] });
      refresh('notes');
      if (rec) reply(a.folder ? `Note saved in "${a.folder}".` : 'Note saved.');
      else reply('Note khali hai — kuch likh do.');
      return true;
    }
    case 'note_summary': {
      const q = (a.topic || '').trim();
      const n = q ? NOTESX.searchNotes(q, 1)[0] : null;
      if (!n) { reply(q ? `"${q}" se koi note nahi mila.` : 'Kis note ka summary? Bolo "summarize note <kuch>".'); return true; }
      const sum = await NOTESX.summarizeNote(n.note.text, { ai: async (txt) => askViaRouter(txt, [], 'You are a summarizer. 4-6 plain lines.') }).catch(() => NOTESX.localSummary(n.note.text));
      reply(`**${q}** — summary:\n${sum}`);
      return true;
    }
    case 'note_flashcards': {
      const q = (a.topic || '').trim();
      const n = q ? NOTESX.searchNotes(q, 1)[0] : null;
      const text = n ? n.note.text : (a.text || '');
      const cards = NOTESX.flashcardsFrom(text, 6);
      if (!cards.length) { reply('Flashcards nahi ban paye — note me Q/A ya "term: definition" pattern chahiye.'); return true; }
      addMsg('ai', `**Flashcards** — ${cards.length}:\n` + cards.map((c, i) => `${i + 1}. **${c.q}**\n   ${c.a}`).join('\n'));
      return true;
    }
    case 'note_mindmap': {
      const q = (a.topic || '').trim();
      const n = q ? NOTESX.searchNotes(q, 1)[0] : null;
      const text = n ? n.note.text : (a.text || '');
      const mm = NOTESX.mindmapFrom(text);
      const lines = [`**Mind map: ${mm.topic}**`];
      for (const e of mm.edges) { const node = mm.nodes.find(x => x.id === e.to); if (node) lines.push(`  ↳ ${node.label}`); }
      reply(lines.join('\n'));
      return true;
    }
    case 'note_folder': {
      const name = (a.name || '').trim();
      if (!name) { reply('Folder ka naam bolo — "move note <kuch> to <folder>".'); return true; }
      const folders = NOTESX.folders();
      reply(folders.length ? `Folders: ${folders.map(f => `${f.name} (${f.count})`).join(', ')}` : 'Abhi koi folder nahi — note save karo with folder.');
      return true;
    }
    /* ---- Documents ---- */
    case 'doc_summary': {
      const d = (a.doc || '').trim();
      const found = DOCAI.docs().find(x => x.name.toLowerCase().includes(d.toLowerCase())) || (d ? null : DOCAI.docs()[0]);
      if (!found) { reply(d ? `"${d}" document nahi mila. Pehle "read pdf" se upload karo.` : 'Koi document nahi hai. Pehle "read pdf" se upload karo.'); return true; }
      reply(`📄 **${found.name}** — summary:\n${found.summary || DOCAI.localDocSummary(found.text)}`);
      return true;
    }
    case 'doc_ask': {
      const q = (a.question || '').trim();
      const d = (a.doc || '').trim();
      const found = DOCAI.docs().find(x => x.name.toLowerCase().includes(d.toLowerCase())) || DOCAI.docs()[0];
      if (!found) { reply('Pehle ek document upload karo ("read pdf").'); return true; }
      const ans = DOCAI.answerFromDoc(found.text, q);
      reply(ans ? `📄 From ${found.name}:\n${ans}` : 'Us document me iska answer nahi mila. Try a different question.');
      return true;
    }
    /* ---- Knowledge base ---- */
    case 'kb_search': {
      const q = (a.query || '').trim();
      if (!q) { reply('Kya search karun? "search all <kuch>".'); return true; }
      const hits = KNOW.searchAll(q, 6);
      if (!hits.length) { reply(`"${q}" kahi nahi mila (notes/docs/chat).`); return true; }
      reply(`🔎 **"${q}"** — ${hits.length} results:\n` + hits.map(h => `• [${h.src}] ${String(h.text).slice(0, 70)}`).join('\n'));
      return true;
    }
    case 'kb_stats': {
      const s = KNOW.kbStats();
      reply(`🧠 **Knowledge base** — ${s.notes} notes · ${s.docs} docs · ${s.chats} chat msgs\n• Size: ${s.bytesHuman}\n• Categories: ${Object.entries(s.categories).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}`);
      return true;
    }
    /* ---- Planner ---- */
    case 'plan_today': {
      const ag = PLANX4.todayAgenda();
      if (!ag.length) { reply('Aaj kuch schedule nahi hai. Enjoy!'); return true; }
      reply(`📅 **Today** — ${ag.length} items:\n` + ag.map((x, i) => `${i + 1}. ${x.time ? x.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' : ''}[${x.type}] ${x.text}`).join('\n'));
      return true;
    }
    case 'plan_week': {
      const wk = PLANX4.weeklyPlan(7);
      const lines = wk.map(d => `• ${d.label}: ${d.items.length ? d.items.slice(0, 3).map(i => i.text.slice(0, 30)).join(', ') + (d.items.length > 3 ? ' +' + (d.items.length - 3) : '') : 'free'}`);
      reply(`🗓 **This week**\n` + lines.join('\n'));
      return true;
    }
    case 'plan_priorities': {
      const tops = PLANX4.topPriorities(new Date(), 4);
      if (!tops.length) { reply('Aaj koi priority nahi — sab clear!'); return true; }
      reply(`🎯 **Today's priorities**\n` + tops.map((t, i) => `${i + 1}. ${t.text} (${t.score}/100)`).join('\n'));
      return true;
    }
    /* ---- Document read (file picker) + analysis ---- */
    case 'doc_read': return pickAndReadDoc();
    case 'doc_resume': return analyzeLastDoc('resume');
    case 'doc_contract': return analyzeLastDoc('contract');

    /* ================= v15 Phase 5: STUDY ASSISTANT ================= */
    case 'study_doubt': {
      const q = (a.query || '').trim();
      if (!q) { reply('Kya doubt hai? Bolo "solve <question>" ya "doubt <question>".'); return true; }
      const subj = STUDYX.subjectOf(q);
      thinking(true);
      const r = await AIR.route({ task: 'chat', messages: [{ role: 'user', content: STUDYX.doubtPrompt(q) }], exec: routerExec, opts: { maxTokens: 700 } });
      thinking(false);
      reply(r.ok ? `🎓 **${subj}** — ${r.text}` : `Doubt solver offline right now (${r.reason}). Try again ya later.`);
      return true;
    }
    case 'study_pyq': {
      const subj = (a.subject || '').trim();
      const pyq = STUDYX.pyqFor(subj, 3);
      reply(`📚 **PYQ — ${STUDYX.subjectOf(subj || 'general')}**\n` + pyq.map((p, i) => `${i + 1}. ${p.q}\n   *(${p.a})*`).join('\n'));
      return true;
    }
    case 'study_formula': {
      const subj = (a.subject || '').trim();
      const sheet = STUDYX.formulaSheet(subj, 8);
      reply(`🧮 **Formula sheet — ${STUDYX.subjectOf(subj || 'physics')}**\n` + sheet.map(([f, n]) => `\`${f}\` — ${n}`).join('\n'));
      return true;
    }
    case 'study_revision': {
      const subj = (a.subject || '').trim();
      const days = Math.max(1, parseInt(a.days, 10) || 7);
      const plan = STUDYX.revisionFor(subj || 'physics', days, 2);
      reply(`🗓 **Revision plan — ${STUDYX.subjectOf(subj || 'physics')}** (${days}d)\n` + plan.map((d, i) => `• Day ${i + 1}: ${d.focus}`).join('\n'));
      return true;
    }
    case 'study_progress': {
      const subj = (a.subject || '').trim();
      const p = STUDYX.progress(subj);
      const chart = STUDYX.weekChart();
      const bars = chart.map(d => `${d.day}: ${'█'.repeat(Math.min(12, Math.round(d.min / 10)))} ${d.min}m`).join('\n');
      reply(`📊 **Study progress — ${p.subject}**\n• ${p.sessions} sessions · ${p.totalMin} min total\n• Today: ${p.todayMin} min / ${p.goal} min goal · This week: ${p.weekMin} min · streak: ${p.streak}d\n${bars}`);
      return true;
    }
    case 'study_mock': {
      const subj = (a.subject || '').trim();
      const test = STUDYX.mockTest(subj, 5);
      state.mockTest = test;
      state.mockIdx = 0; state.mockScore = 0;
      reply(`📝 **Mock test — ${test.subject}** (5 questions)\n**Q1.** ${test.questions[0].q}`);
      state.expect = 'mock_answer';
      return true;
    }

    /* ================= v15 Phase 6: PERSONAL GUARDIAN ================= */
    case 'safety_timer': {
      const mins = Math.max(1, parseInt(a.minutes, 10) || 30);
      const rec = GUARD.addSafetyTimer({ minutes: mins, escalate: S.getSetting('safetyTimerEscalate') === true });
      state.safetyTimerId = rec.id;
      reply(`🛡 Safety timer set — ${mins} min. Jab time ho, main poochunga "sab theek hai?" — bolo "ok" ya "sab theek".`);
      setTimeout(() => runSafetyCheck(rec.id), mins * 60000);
      return true;
    }
    case 'safety_cancel': { GUARD.disarmSafetyTimers(); reply('Safety timers off.'); return true; }
    case 'breathe': {
      const rounds = Math.max(1, parseInt(a.rounds, 10) || 4);
      const cycle = GUARD.breathingCycle(rounds);
      reply(`🌬 **Breathing exercise** — box breathing (4-4-4-4), ${rounds} rounds.\n` + cycle.map((p, i) => `${i + 1}. ${p.name} (${p.sec}s)`).join('\n') + `\n\nBolo "breathe done" jab khatam ho.`);
      state.breatheCycle = cycle;
      return true;
    }
    case 'heart_rate': return runHeartRate();
    case 'med_reminder': {
      const times = (a.times || '').split(/[\s,]+/).filter(Boolean).slice(0, 6);
      if (!times.length) { state.expect = 'med_times'; reply('Kis time pe? "medicine 8am 2pm 8pm".'); return true; }
      GUARD.setMedSchedule(times);
      createMedAlarms(times.join(' '));
      return true;
    }

    /* ================= v15 Phase 8: PREMIUM UI ================= */
    case 'amoled': {
      S.setSetting('amoled', a.on !== false);
      UIX.init();
      reply(a.on === false ? 'AMOLED mode off.' : 'AMOLED mode on — pure black, battery friendly.');
      return true;
    }
    case 'ui_pref': {
      const k = (a.key || '').trim(), v = a.value;
      if (!k) { reply('UI pref set karne ke liye: "set ui <key> <value>".'); return true; }
      S.setSetting(k, v);
      UIX.init();
      reply(`UI preference "${k}" = ${JSON.stringify(v)}.`);
      return true;
    }

    /* ================= v15 Phase 9: SECURITY & PRIVACY ================= */
    case 'biometric': {
      S.setSetting('biometricLock', a.on !== false);
      reply(a.on === false ? 'Biometric lock off.' : 'Biometric lock on — FRIDAY ko kholne ke liye fingerprint/face chahiye (APK me).');
      return true;
    }
    case 'backup_encrypted': {
      const pass = (a.passphrase || '').trim();
      if (pass.length < 6) { reply('Encrypted backup ke liye 6+ char passphrase chahiye. Bolo "encrypted backup <passphrase>".'); return true; }
      const r = await SECX.encryptedBackup(pass, { exportAll: () => S.exportAll() });
      if (!r.ok) { reply('Backup encrypt nahi hua: ' + r.reason); return true; }
      D.download(`friday-encrypted-${Date.now()}.json`, r.blob, 'application/json');
      reply('🔐 **Encrypted backup** ready (AES-256-GCM). Passphrase yaad rakho — koi aur nahi khol sakta.');
      return true;
    }
    case 'restore_encrypted': {
      state.expect = 'restore_enc';
      reply('Paste the encrypted backup JSON, phir passphrase bolo ("decrypt <passphrase>").');
      return true;
    }

    /* ================= v15 pre-10: PLUGIN SYSTEM ================= */
    case 'plugin_list': {
      const s = PLUGINS.pluginStats();
      reply(`🧩 **Plugins** — ${s.installed} installed · ${s.enabled} enabled\n` + (s.plugins.length ? s.plugins.map(p => `• ${p.name} (${p.id}) v${p.version} — ${p.enabled ? 'on' : 'off'}`).join('\n') : 'None installed. Registry: ' + PLUGINS.registry().map(p => p.id).join(', ')));
      return true;
    }
    case 'plugin_install': {
      const id = (a.id || '').trim();
      const manifest = PLUGINS.registry().find(p => p.id === id);
      if (!manifest) { reply(`Plugin "${id}" registry me nahi hai. Available: ${PLUGINS.registry().map(p => p.id).join(', ')}.`); return true; }
      const r = PLUGINS.installPlugin(manifest);
      reply(r.ok ? `🧩 Plugin "${manifest.name}" install ho gaya.` : 'Install fail: ' + r.reason);
      return true;
    }
    case 'plugin_uninstall': {
      PLUGINS.uninstallPlugin(a.id);
      reply(`Plugin "${a.id}" uninstall ho gaya.`);
      return true;
    }

    /* ================= RC1: DEV CONSOLE (release tool) ================= */
    case 'dev_console': {
      const report = DEVCON.devReport({ perf: PERFX, core: CORE, air: AIR });
      addMsg('ai', '**🛠 Dev console**\n' + report, { proactive: true });
      return true;
    }
    case 'telemetry': {
      const on = a.on !== false;
      DEVCON.setTelemetry(on);
      reply(on ? 'Telemetry ON (opt-in) — crashes/perf counters recorded locally. "export telemetry" se file milegi.' : 'Telemetry OFF.');
      return true;
    }
    case 'telemetry_export': {
      const native = NAT.isNative() ? await NAT.collectNativeDiagnostics().catch(e => ({ ok: false, reason: e?.message || 'failed' })) : { ok: false, reason: 'web' };
      const payload = {
        ...DEVCON.exportTelemetry(),
        nativeDiagnostics: native.ok ? native.text : null,
        nativeDiagnosticsStatus: native.ok ? { ok: true, crashCount: native.crashCount || 0 } : native
      };
      D.download(`friday-diagnostics-${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json');
      reply(native.ok
        ? `Diagnostics export kiya — JS telemetry, ${native.crashCount || 0} saved native crash report(s), app logcat, aur download states. File local hai; kuch automatically upload nahi hota.`
        : 'JS telemetry export kiya. Native crash/logcat unavailable tha: ' + (native.reason || 'unknown') + '. Kuch automatically upload nahi hota.');
      return true;
    }

    /* ================= v15 Phase 3: AI ROUTER / WORKFLOW / ANALYTICS ================= */
    case 'ai_diag': {
      const d = AIR.aiDiagnostics();
      const rows = d.providers.map(p => `• ${p.label}: ${p.ok} ok / ${p.fail} fail (${p.failRate}%)`).join('\n');
      reply(`**AI diagnostics**\n• Providers configured: ${d.available.length ? d.available.join(', ') : 'none'} · pref: ${d.pref}\n• Total calls: ${d.totalCalls}\n${rows}\n\nSay "workflows" to list chains.`);
      return true;
    }
    case 'wf_list': {
      const t = WF.templates().map(x => `${x.id} — ${x.name}`).join('\n');
      reply(`**Workflow templates**\n${t}\n\nSay "run workflow image-to-notes" (with a photo shared).`);
      return true;
    }
    case 'wf_run': return runWorkflowFlow(a.name, { image: state.sharedImage ? state.sharedImage.dataUrl : null, name: (a.extra || '').trim() });

    /* ================= v15 Phase 3: NOTIFICATION INTELLIGENCE ================= */
    case 'notif_search': {
      if (!NAT.isNative()) { reply(nativeOnly('notification search')); return true; }
      const q = (a.query || '').trim();
      if (!q) { reply('Kya search karun? Bolo "search notifications <kuch>".'); return true; }
      const r = await NAT.getNotifLog('', 80).catch(() => null);
      const items = (r && r.items) || recentNotifs;
      const hits = items.filter(n => (n.title + ' ' + (n.text || '')).toLowerCase().includes(q.toLowerCase())).slice(0, 6);
      if (!hits.length) { reply(`"${q}" notifications me nahi mila.`); return true; }
      reply(`"${q}" — ${hits.length} match${hits.length > 1 ? 'es' : ''}:\n` + hits.map(n => `• ${NAT.friendlyApp(n.pkg)}: ${n.title} — ${String(n.text || '').slice(0, 60)}`).join('\n'));
      return true;
    }

    case 'chat_search': {
      const q = (a.query || '').trim();
      if (!q) { reply('Kya search karun? Bolo "search chat <kuch>".'); return true; }
      const hits = MEMEX.searchChat(state.messages, q);
      if (!hits.length) { reply(`"${q}" chat me nahi mila.`); return true; }
      const lines = hits.slice(-5).map(h => `• ${h.msg.role === 'user' ? 'You' : 'FRIDAY'}: ${String(h.msg.text).slice(0, 80)}`);
      reply(`"${q}" — ${hits.length} match${hits.length > 1 ? 'es' : ''}:\n` + lines.join('\n'));
      return true;
    }

    /* ================= v13 Phase 11-13: SECURITY / PERF / CINEMATIC ================= */
    case 'audit_log': return showAuditLog(a.query || '');
    case 'privacy_report': return showPrivacyReport();
    case 'perf_stats': return showPerfStats();
    case 'cinematic': {
      const on = a.on !== false;
      S.setSetting('cinematic', on);
      CINEX.init();
      reply(on ? 'Cinematic mode on — full holographic glow.' : 'Cinematic mode off — clean, minimal, battery-first.');
      return true;
    }


    case 'alarm_add': {
      const rec = AUTO.addAlarm(a.alarm);
      refresh('alarms');
      const when = AUTO.describeAlarm(rec);
      const next = new Date(AUTO.nextOccurrence(rec));
      D.notifyPermission();
      if (NAT.isNative()) {
        const [hh, mm] = rec.time.split(':').map(Number);
        const r = await NAT.setSystemAlarm(hh, mm, rec.label, rec.repeat);
        if (r.ok) {
          reply(`Alarm set in your Clock app \u2014 ${rec.label} at ${when}.`);
        } else {
          // never dump raw Android errors into chat - translate them
          const why = String(r.reason || '');
          console.warn('[alarm] clock sync failed:', why);
          reply(`Alarm set \u2014 ${rec.label} at ${when}. That's ${humanTime(next)}.`);
          if (why.includes('SET_ALARM')) {
            addMsg('ai', '\u26a0\ufe0f Your phone blocked Clock-app sync (missing alarm permission in this build). The alarm **will still ring inside FRIDAY**. Rebuild with the updated manifest to enable Clock-app alarms.');
          } else if (why.includes('ActivityNotFound') || why.includes('NO_ACTIVITY')) {
            addMsg('ai', '\u26a0\ufe0f No system clock app found to mirror this alarm. The in-app alarm still works.');
          }
        }
      } else {
        reply(`Alarm set \u2014 ${rec.label} at ${when}. That's ${humanTime(next)}.`);
      }
      return true;
    }

    case 'alarm_cancel': {
      const list = AUTO.alarms().filter(x => x.enabled);
      if (!list.length) { reply('No active alarms to cancel.'); return true; }
      const m = a.query.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
      let target = null;
      if (m) {
        let hh = parseInt(m[1], 10);
        const mm = m[2] ? parseInt(m[2], 10) : -1;   // v10.1 fix: match minutes too
        if (m[3] === 'pm' && hh < 12) hh += 12;
        if (m[3] === 'am' && hh === 12) hh = 0;
        target = list.find(x => {
          const [xh, xm] = x.time.split(':').map(Number);
          return xh === hh && (mm < 0 || xm === mm);
        });
      }
      if (!target && list.length === 1) target = list[0];
      if (!target) { reply(`Which one? ` + list.map(x => AUTO.describeAlarm(x)).join(', ')); return true; }
      AUTO.deleteAlarm(target.id);
      refresh('alarms');
      reply(`Cancelled the ${AUTO.describeAlarm(target)} alarm.`);
      return true;
    }

    case 'routine_create': {
      AUTO.addRoutine(a.routine);
      refresh('routines');
      reply(`Routine "${a.routine.name}" created with ${a.routine.actions.length} action${a.routine.actions.length === 1 ? '' : 's'}. Just say "${a.routine.name}" anytime.`);
      return true;
    }

    case 'routine_run': {
      const r = AUTO.findRoutine(a.name);
      if (!r) { reply(`No routine called "${a.name}".`); return true; }
      await AUTO.runRoutine(r);
      refresh('routines');
      return true;
    }

    case 'routine_list': {
      const rs = AUTO.routines();
      if (!rs.length) { reply('No routines yet. Say "when I say bedtime tell me the weather" to create one.'); return true; }
      reply(`${rs.length} routine${rs.length === 1 ? '' : 's'}:\n` +
        rs.map(r => `\u2022 ${r.name} \u2014 ${r.actions.length} action${r.actions.length === 1 ? '' : 's'}${r.runs ? ` (run ${r.runs}\u00d7)` : ''}`).join('\n'));
      return true;
    }

    case 'geofence_add': {
      try {
        const pos = await API.resolveLocation();
        const nameM = a.text.match(/when i (?:get|arrive|reach) (?:to |at )?(?:the )?([a-z\s]{2,20})/i);
        const place = nameM ? nameM[1].trim() : 'here';
        const fence = AUTO.addGeofence({ name: place, lat: pos.lat, lon: pos.lon, radius: 250, onEnter: 'good morning' });
        NAT.geofenceAddNative(fence);
        refresh('geofences');
        reply(`Saved this spot as "${place}". I'll alert you when you arrive.`);
      } catch (e) { reply('I need location access for that.'); }
      return true;
    }

    case 'recall': {
      const hits = (await MEM.recallAsync(a.query)).filter(h =>
        h.kind !== 'episode' || !h.text.toLowerCase().includes(a.query.toLowerCase()));
      if (!hits.length) { reply(`I don't have anything on "${a.query}".`); return true; }
      reply(`Here's what I remember:\n` + hits.map(h => `• ${h.text}`).join('\n'));
      return true;
    }
    case 'what_you_know': {
      const f = MEM.allFacts(), p = MEM.patterns(), st = MEM.stats();
      if (!f.length && !p.length) { reply(`Not much yet — we've only spoken ${st.interactions} times. Tell me things like "call me Rishu" or "I live in Delhi" and I'll remember.`); return true; }
      const lines = [];
      if (f.length) lines.push(f.slice(0, 10).map(x => `• ${x.label}: ${x.value}`).join('\n'));
      if (p.length) lines.push('\n**Habits I\'ve noticed**\n' + p.slice(0, 4).map(x => `• ${x.text}`).join('\n'));
      lines.push(`\n_${st.facts} facts · ${st.interactions} interactions · ${st.days} days_`);
      addMsg('ai', `**Here's what I know about you**\n` + lines.join('\n'));
      V.speak(`I know ${st.facts} things about you, learned over ${st.days} days.`);
      return true;
    }
    case 'forget': { MEM.wipeMemory(); PRO.resetProactive(); reply('Memory wiped. Clean slate.'); return true; }

    /* ============ v11.3 PHASE 5: cognitive memory actions ============ */
    case 'mem_dashboard': {
      const d = MEMEX.dashboard();
      reply([
        `🧠 **Memory Dashboard (dev)**`,
        `Facts: ${d.facts} · Episodes: ${d.episodes} · Digests: ${d.summaries}`,
        `Vision: ${d.vision} scans · QR: ${d.qr} · Pref rows: ${d.preferenceRows}`,
        `Storage: ${MEMEX.fmtBytes(d.storageBytes)} · Retrieval: ${d.retrievalMs}ms (${d.probeHits} hits)`,
        `Embeddings: ${d.embeddings} · Last cloud sync: ${d.lastSync}`,
        d.topPreferences.length ? `Favourite commands: ` + d.topPreferences.map(p => `${p.intent}×${p.n}`).join(', ') : 'Preferences abhi bann rahi hain (3+ uses pe track hota hai).'
      ].join('\n'));
      return true;
    }
    case 'mem_deep_recall': {
      const hits = MEMEX.retrieve(a.query || '', { k: 5 });
      if (!hits.length) return reply(`Memory me "${a.query}" se kuch nahi mila, Boss.`, {});
      reply(`Deep recall — "${a.query}":\n` + hits.map(h => `• [${h.src}] ${h.text.slice(0, 90)}`).join('\n'));
      return true;
    }
    case 'mem_digest': {
      const sums = S.getList(MEMEX.SKEYS.SUMMARIES);
      if (!sums.length) return reply('Abhi koi digest nahi — kal se har din ka summary banega automatically.');
      const s0 = sums[0];
      reply(`📅 **${s0.day}** — ${s0.summary}` +
        (s0.tasks.length ? `\nTasks: ${s0.tasks.map(t => '• ' + t).join(' ')}` : '') +
        (s0.followups.length ? `\nOpen questions: ${s0.followups.map(t => '• ' + t).join(' ')}` : ''));
      return true;
    }

    /* ============ v11.3 PHASE 6: vision memory actions ============ */
    case 'qr_history': {
      const h = VISIONX.qrHistory();
      if (!h.length) return reply('Koi QR scan nahi hai abhi tak. Camera dock se 👁️ dabao.');
      reply('QR history:\n' + h.slice(0, 8).map(x => `• [${x.type}] ${String(x.value).slice(0, 60)} (${new Date(x.ts).toLocaleDateString()})`).join('\n'));
      return true;
    }
    case 'vision_memory': {
      const v = VISIONX.visionMemory();
      if (!v.length) return reply('Vision memory khaali hai — kuch scan karo to main yaad rakh dunga.');
      reply('Vision memory:\n' + v.slice(0, 6).map(m => '• ' + VISIONX.visionCaption(m)).join('\n'));
      return true;
    }

    /* ============ v11.3 PHASE 7: automation rule actions ============ */
    case 'rules_list': {
      const rs = AUTOX.rules();
      if (!rs.length) return reply('Koi automation rule nahi. Seed rules seed ho jaate hain boot pe.');
      reply('⚙️ Automation rules:\n' + rs.slice(0, 10).map(r =>
        `${r.enabled ? '🟢' : '⚪'} ${r.name || r.then.slice(0, 30)} — when: ${r.when}${r.when === 'time' ? ' @' + r.at : r.when === 'battery_low' ? ' <' + (r.level ?? 20) + '%' : ''}`
      ).join('\n') + '\nBolo: "rule off Battery guard" ya Settings me toggles.');
      return true;
    }
    case 'rule_toggle': {
      const rs = AUTOX.rules();
      const hit2 = rs.find(r => (r.name || '').toLowerCase().includes((a.name || '').toLowerCase()));
      if (!hit2) return reply(`"${a.name}" naam ka rule nahi mila. "rules dikha" bolkar list dekho.`);
      AUTOX.toggleRule(hit2.id, a.on);
      reply(`${hit2.name || hit2.then.slice(0, 30)} — ab ${a.on ? 'ON 🟢' : 'OFF ⚪'}.`);
      return true;
    }
    case 'screenshot': {
      if (NAT.isNative()) {
        const r = await NAT.performGlobalAction('screenshot');
        if (r.ok) { reply('Screenshot taken.'); return true; }
        reply('That needs the accessibility service. Say "setup" to enable it.');
        return true;
      }
      reply('Screenshots need the installed app.');
      return true;
    }
    default: return false;
  }
}

/* ================= v13.0-13.2: PHASES 11-13 ENGINES ================= */

/* Boot wiring for Security / Performance / Cinematic engines. */
function bootPhase11to14() {
  if (bootPhase11to14.done) return; bootPhase11to14.done = true;
  try {
    /* ---- Phase 11 SECX: security + privacy ---- */
    SECX.init(CORE);
    SECX.audit('app', 'session started');
    /* privacy consent defaults: local-first unless user opts in */
    if (!S.getSetting('cloudConsentSet')) { S.setSetting('cloudConsentSet', true); }
    /* non-blocking integrity check + auto recovery */
    setTimeout(() => { SECX.integrityReport(CORE).then(r => {
      if (!r.ok) {
        Logger.warn('secx', 'integrity issues at boot: ' + r.issues.slice(0, 3).join(' | '));
        SECX.autoRecover(CORE);
      }
    }).catch(() => {}); }, 4000);

    /* ---- Phase 12 PERFX: performance + battery ---- */
    PERFX.init({ getBattery: () => D.battery() });
    Bus.on('perfx:metrics', m => {
      try {
        if (m && m.battery && m.battery.pct <= 15 && !m.battery.charging) {
          const el = $('#hudStatus');   // subtle, not intrusive
          if (el) el.setAttribute('data-lowbat', '1');
        }
      } catch (_) {}
    });
    /* AI latency tracking: wrap callGroq/server chat roughly */
    const _origCall = AI.callGroq;
    if (typeof _origCall === 'function' && !AI.callGroq._perfWrapped) {
      AI.callGroq = async (...a) => {
        const t0 = performance.now();
        try { return await _origCall(...a); }
        finally { PERFX.markAiLatency(Math.round(performance.now() - t0)); }
      };
      AI.callGroq._perfWrapped = true;
    }
    setInterval(() => { try { Bus.emit('perfx:refresh'); } catch (_) {} }, 60000);

    /* ---- Phase 13 CINEX: cinematic + accessibility ---- */
    CINEX.init();
    Bus.on('vox:state', () => { /* orb classes applied via data-attr in CINEX */ });

    Logger.info('core', 'phases 11-14 online (secx · perfx · cinex)');
  } catch (e) { Logger.error('core', 'phase11-14 wiring failed: ' + (e && e.message)); }
}

/* ---- Phase 11: audit-log view ---- */
async function showAuditLog(q = '') {
  const log = SECX.auditSearch(q).slice(0, 14);
  if (!log.length) { reply('Audit log is empty.'); return true; }
  const lines = log.map(e => {
    const t = new Date(e.ts);
    const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    return `• ${hh} [${e.event}] ${e.detail}`;
  });
  addMsg('ai', '**🔐 Security audit log**' + (q ? ` — filter "${q}"` : '') + '\n' + lines.join('\n'), { proactive: true });
  return true;
}

/* ---- Phase 11: privacy report ---- */
function showPrivacyReport() {
  const p = SECX.privacyReport();
  const lines = [
    '• Local-first processing: **' + (p.localFirst ? 'yes' : 'no') + '**',
    '• Cloud AI consent: ' + (p.cloud ? '**granted**' : '**not granted** (cloud blocked until you allow)'),
    p.cloud ? '• Cloud used for: ' + p.cloudUsedWhen.join(', ') : '• Nothing leaves the device for AI.',
    '• Never silently uploads: ' + p.neverUploads.join(', '),
    '• Encrypted: ' + p.encrypted.join(', '),
    '• Audit trail: ' + p.audits + ' events'
  ];
  addMsg('ai', '**🛡 Privacy report**\n' + lines.join('\n'), { proactive: true });
  V.speak(p.cloud ? 'Privacy report ready. Cloud consent is on.' : 'Privacy report ready. Everything is local-first, cloud is off.');
  return true;
}

/* ---- Phase 12: performance stats ---- */
async function showPerfStats() {
  thinking(true);
  try {
    const b = await D.battery().catch(() => null);
    const m = await PERFX.perfMetrics({ battery: b, network: D.network() });
    const rows = [
      `• FPS: **${m.fps}**${m.fps >= 55 ? '' : ' (low — effects reduced)'}`,
      `• CPU: **${m.cpu}%** (event-driven estimate)`,
      `• RAM: **${m.ram.usedPct != null ? m.ram.usedPct + '% (' + m.ram.usedMB + '/' + m.ram.totalMB + 'MB)' : '—'}**`,
      `• Battery: **${m.battery ? m.battery.pct + '%' + (m.battery.charging ? ' ⚡' : '') : '—'}**`,
      `• AI latency: **${m.aiLatencyMs != null ? m.aiLatencyMs + ' ms' : '—'}**`,
      `• Queues: critical ${m.queues.critical} · medium ${m.queues.medium} · low ${m.queues.low}`,
      `• Expired cache swept: ${m.cacheExpired}`
    ];
    addMsg('ai', '**⚡ Performance stats**\n' + rows.join('\n'), { proactive: true });
    V.speak(`Performance check done. ${m.fps} frames per second, ${m.ram.usedPct != null ? m.ram.usedPct + ' percent ram' : 'ram unknown'}, ${m.battery ? m.battery.pct + ' percent battery' : ''}.`);
  } catch (e) { reply('Performance stats hiccup: ' + (e && e.message)); }
  thinking(false);
  return true;
}

/* ================= v12.0-12.2: PHASES 8-10 ENGINES ================= */

/* Interactive prompt for PLANX: pauses the plan, waits for the next input. */
function promptUser(question, step) {
  return new Promise(res => {
    state.planAsk = res;
    state.expect = 'plan_answer';
    reply(question);
    addClarifyChips([{ label: '✅ Go', say: 'go' }, { label: '⏭️ Skip', say: 'skip' }, { label: '🛑 Stop', say: 'stop' }]);
  });
}

/* Re-render the live plan checklist bubble. */
function planStepUI(plan) {
  if (!state.planEl) return;
  state.planEl.querySelector('.message-bubble').innerHTML = U.renderRich(
    PLANX.renderPlanText(plan) + (plan.status === 'running' ? '\n\n_working on it…_' : ''));
  scrollBottom();
}

/* Tool executor — maps PLANX tools onto existing FRIDAY skills. */
async function planExecStep(plan, step, results) {
  const tool = PLANX.selectTool(step);
  switch (tool) {
    case 'schedule': {
      const end = new Date(); end.setDate(end.getDate() + (plan.days || 1)); end.setHours(23, 59, 59, 999);
      const rs = S.getList(KEYS.REMINDERS).filter(r => !r.done && r.due >= Date.now() && r.due <= end.getTime()).slice(0, 4);
      const al = AUTO.alarms().filter(x => x.enabled).slice(0, 4);
      const bits = [];
      if (rs.length) bits.push('Reminders: ' + rs.map(r => r.text + ' (' + humanTime(new Date(r.due)) + ')').join('; '));
      if (al.length) bits.push('Alarms: ' + al.map(AUTO.describeAlarm).join('; '));
      return { ok: true, result: bits.length ? bits.join('. ') : 'Schedule clear — no reminders or alarms.' };
    }
    case 'notes': {
      const q = String(step.data.topic || '').toLowerCase();
      const notes = S.getList(KEYS.NOTES).filter(n => !q || String(n.text).toLowerCase().includes(q)).slice(0, 3);
      const text = notes.length ? notes.map(n => '• ' + n.text.slice(0, 140)).join('\n')
        : (q ? `No notes matching "${q}" — plan from scratch.` : 'No notes yet — plan from scratch.');
      return { ok: true, result: { text, notes } };
    }
    case 'summarize': {
      const prev = Object.values(results || {}).find(r => r && r.notes);
      if (!prev || !prev.notes.length) return { ok: true, result: 'Nothing to summarize — no notes found.' };
      const raw = prev.notes.map(n => n.text).join(' ').slice(0, 1200);
      if (AI.hasGroq()) {
        try {
          const g = await AI.callGroq([
            { role: 'system', content: 'Summarize these notes into 4-6 key points, plain words, Hinglish ok, no headers.' },
            { role: 'user', content: raw }], { maxTokens: 220 });
          if (g) return { ok: true, result: g };
        } catch (_) {}
      }
      return { ok: true, result: raw.split(/(?<=[.!?])\s+/).slice(0, 4).join(' ').slice(0, 500) };
    }
    case 'plan': {
      const days = plan.days || 1;
      const rows = PLANX.revisionPlan(step.data.topic || plan.topic || 'study', days, 2);
      const text = `**Revision plan (${days} day${days > 1 ? 's' : ''})**\n` +
        rows.map(r => `- Day ${r.day} (${r.hours}h): ${r.focus}`).join('\n');
      step._planText = text;
      return { ok: true, result: text };
    }
    case 'reminder': {
      const d = new Date(); d.setDate(d.getDate() + (plan.days || 1)); d.setHours(8, 0, 0, 0);
      const label = `📚 Revision — ${step.data.topic || plan.topic || 'study'}`;
      const rec = S.addItem(KEYS.REMINDERS, { text: label, due: d.getTime(), done: false });
      scheduleReminder(rec); refresh('reminders');
      return { ok: true, result: 'Reminder set ' + humanTime(d) + ': ' + label };
    }
    case 'save': {
      const body = step._planText || (step.result ? String(step.result).slice(0, 400) : step.text);
      S.addItem(KEYS.NOTES, { text: '🗺 ' + (plan.topic || 'plan') + ': ' + body });
      refresh('notes');
      return { ok: true, result: 'Saved to notes.' };
    }
    case 'notify': {
      D.notify('FRIDAY — Plan ready', plan.goal.slice(0, 80), 'plan-' + plan.id);
      U.toast('Plan ready ✅', '🧭');
      return { ok: true, result: 'notified' };
    }
    case 'search': {
      const r = await API.wikiSearch(step.data.query || step.data.topic || '', 3).catch(() => []);
      return { ok: true, result: r.length ? r.map(x => '• ' + x.title).join('\n') : 'No search results.' };
    }
    case 'weather': {
      const loc = await API.resolveLocation();
      const wx = await API.getWeather(loc.lat, loc.lon);
      const [desc] = API.describeWMO(wx.current.weather_code);
      return { ok: true, result: `${Math.round(wx.current.temperature_2m)}°C ${desc} @ ${step.data.place || 'your area'}` };
    }
    case 'translate': {
      const r = await API.quickTranslate(step.data.topic || step.text, 'english').catch(() => null);
      return { ok: true, result: r && r.ok ? r.text : 'Translation unavailable.' };
    }
    case 'ask': {
      const a = await promptUser(step.data.question || step.text, step);
      return { ok: true, result: a };
    }
    case 'command':
    default: {
      await handleInput(step.text.replace(/^\w+\.\s*/i, ''), { silentEcho: true, noChain: true, dedupeSkip: true });
      return { ok: true, result: 'done' };
    }
  }
}

/* v12.0 Phase 8: the planner flow — build, show checklist, execute, report. */
async function runPlannerFlow(text, opts = {}) {
  if (S.getSetting('plannerEnabled') === false) return false;
  VOX.vox.set('EXECUTING', 'planner');
  const plan = PLANX.buildPlan(text);
  if (!plan.steps.length) {
    reply('Could not break that into steps, Boss. Try "plan my day" or "prepare for my physics exam".');
    return true;
  }
  const el = addMsg('ai', '', { returnEl: true, proactive: true });
  state.planEl = el;
  planStepUI(plan);

  const summary = await PLANX.runPlan(plan, {
    execStep: (step, results) => planExecStep(plan, step, results),
    ask: (q, s) => promptUser(q, s),
    onStep: () => planStepUI(plan),
    retries: 2, backoffMs: 900
  });
  planStepUI(plan);          // final render while the element ref is still set
  state.planEl = null;

  const failed = plan.steps.filter(s => s.status === 'fail' || s.status === 'skip').length;
  if (summary.ok) {
    reply(`Plan complete, Boss. ${plan.steps.length} steps done.`);
    V.speak(`Plan complete. ${plan.steps.length} steps done. ${plan.goal}`);
  } else if (plan.status === 'aborted') {
    reply('Plan stopped. Kuch aur?');
  } else if (plan.status === 'scheduled') {
    reply('Plan paused — I will continue at the scheduled time. Keep me alive in the background.');
  } else {
    reply(`Plan wrapped up — ${failed} step${failed > 1 ? 's' : ''} skipped or failed, rest done.`);
  }
  if (VOX.vox.armReady) VOX.vox.armReady(900);
  return true;
}

/* v12.1 + v12.2: boot wiring — intelligence context, device readers, suggestions. */
function bootPhase8to10() {
  if (bootPhase8to10.done) return; bootPhase8to10.done = true;
  try {
    /* ---- v12.1 INTELX: Intelligence & Context ---- */
    INTELX.injectContext({ memSize: S.getList(KEYS.MEMORY).length + S.getList(KEYS.NOTES).length });
    try { INTELX.bootstrap(MEM.episodes()); } catch (_) {}
    Bus.on('autox:battery', p => { try { INTELX.tick('battery', p); } catch (_) {} });
    Bus.on('intel:suggest', list => { try { (list || []).slice(0, 2).forEach(surfaceIntelSuggestion); } catch (_) {} });
    if (!S.getSetting('intelSeeded')) { S.setSetting('intelSeeded', true); try { INTELX.tick('first_use'); } catch (_) {} }

    /* ---- v12.2 DEVX: Device Engine (event-driven, zero new polling) ---- */
    try {
      DEVX.start({
        battery: () => D.battery(),
        storage: async () => {
          if (!NAT.isNative()) return null;
          const r = await NAT.getStorageInfo().catch(() => null);
          if (!r || !r.ok) return null;
          return { totalGB: r.totalGB, usedGB: Math.max(0, r.totalGB - r.freeGB), largeFiles: 0, cacheMB: 0 };
        },
        network: () => {
          const n = D.network() || {};
          return { online: navigator.onLine !== false, wifi: n.type === 'wifi',
                   cellular: /(cellular|4g|3g|2g|slow)/.test(String(n.type || '')) };
        },
        ram: () => {
          const m = typeof performance !== 'undefined' && performance.memory ? performance.memory : null;
          return m ? { totalMB: m.jsHeapSizeLimit / 1048576, usedMB: m.usedJSHeapSize / 1048576, cachedMB: 0 } : null;
        },
        /* v15: real thermal + sensor reads (APK); web degrades to null */
        thermal: async () => {
          if (!NAT.isNative()) return null;
          const r = await NAT.getThermal().catch(() => null);
          if (!r || !r.ok) return null;
          return { celsius: r.celsius, batteryCelsius: r.batteryCelsius, cpuCelsius: r.cpuCelsius, throttling: !!r.throttling };
        },
        sensors: async () => {
          if (!NAT.isNative()) return null;
          const r = await NAT.getSensors().catch(() => null);
          if (!r || !r.ok || !r.sensors) return null;
          return r.sensors;
        }
      });
      Bus.on('autox:battery', () => { DEVX.refresh().then(m => { if (m) DEVX.pushHistory(m); }).catch(() => {}); });
      setInterval(() => Bus.emit('devx:refresh'), 120000);
      Bus.on('devx:alert', alerts => {
        if (S.getSetting('devxAlerts') === false) return;
        const top = (alerts || [])[0];
        if (!top) return;
        U.toast(top.text, top.sev === 'crit' ? '🚨' : '⚠️', 5000);
        addMsg('ai', `${top.sev === 'crit' ? '🚨' : '⚠️'} **${top.text}**`, { proactive: true });
        if (top.sev === 'crit' && !state.speaking) V.speak(top.text);
      });
    } catch (_) {}

    /* resume a scheduled plan parked from a previous session */
    try {
      const ap = PLANX.activePlan();
      if (ap && ap.status === 'scheduled' && ap.resumeAt && ap.resumeAt <= Date.now()) {
        PLANX.resumePlan(ap.id, {
          execStep: (s, r) => planExecStep(ap, s, r), ask: promptUser,
          onStep: () => planStepUI(ap)
        }).catch(() => {});
      }
    } catch (_) {}
    Logger.info('core', 'phases 8-10 online (planx · intelx · devx)');
  } catch (e) { Logger.error('core', 'phase8-10 wiring failed: ' + (e && e.message)); }
}

/* v12.2 Phase 10: hidden diagnostics dashboard ("diagnostics" / "device health"). */
async function runDiagnostics() {
  thinking(true);
  try {
    await DEVX.refresh().then(m => { if (m) DEVX.pushHistory(m); }).catch(() => {});
    const svc = await CORE.healthMap().catch(() => ({}));
    const metrics = DEVX.snapshot();
    const logs = Logger.all();
    const pstats = PLANX.planStats();
    const extras = {
      automations: (AUTOX.dashRows() ? AUTOX.dashRows().enabled : 0) + ' rules',
      voice: VOX.vox.get().toLowerCase(),
      vision: ((MEMEX.dashboard && MEMEX.dashboard()) || {}).vision + ' scans',
      planner: pstats.total + ' plans · ' + pstats.failRate + '% fail',
      eventQueue: logs.length + ' log entries',
      uptimeSec: CORE.startedAt ? Math.round((Date.now() - CORE.startedAt) / 1000) : 0,
      crashes: logs.filter(l => l.level === 'error').length
    };
    const rows = DEVX.dashRows({ services: svc, metrics, extras });
    const warn = rows.filter(r => r.sev === 'warn' || r.sev === 'crit');
    /* v15 Phase 2: battery history sparkline inline in the diagnostics card */
    const bat = DEVX.sparkline(DEVX.historySeries('battery', 30), { w: 120, h: 26 });
    const spark = bat ? `\n\n📈 **Battery (last ~1h)** — ${bat.last}% (min ${bat.lo} · max ${bat.hi})\n` +
      `<svg viewBox="${bat.viewBox}" style="width:100%;max-width:280px;height:34px;background:rgba(0,229,255,.05);border-radius:6px"><path d="${bat.path}" fill="none" stroke="#00e5ff" stroke-width="1.5"/></svg>` : '';
    const text = '**🔬 Device diagnostics**\n' + rows.map(r =>
      (r.sev === 'ok' ? '✅' : r.sev === 'warn' ? '⚠️' : '🔴') + ' ' + r.k + ': ' + r.v).join('\n') + spark;
    addMsg('ai', text, { proactive: true });
    V.speak(`Diagnostics done. ${rows.length} checks, ${warn.length} need attention.`);
  } catch (e) { reply('Diagnostics hiccup: ' + (e && e.message)); }
  thinking(false);
  return true;
}

/* Dismissible proactive suggestion card (Phase 9 — spec: relevant AND dismissible). */
function surfaceIntelSuggestion(s) {
  const box = $('#chatMessages');
  if (!box) return;
  const row = document.createElement('div');
  row.className = 'suggest-card';
  row.innerHTML = `<div class="suggest-body">${s.icon || '💡'} ${U.escapeHtml(s.text)}</div>
    <div class="suggest-actions">
      <button class="clarify-chip suggest-go" type="button">Do it</button>
      <button class="clarify-chip suggest-x" type="button">✕</button>
    </div>`;
  row.querySelector('.suggest-go').addEventListener('click', () => {
    row.remove();
    INTELX.suggestionVerdict(s.id, true);
    const act = {
      study: () => { INTELX.studyStart(); reply('Focus on, Boss — 25 min padhai. Jab khatam ho, bolo "study done".'); },
      auto_setup: () => handleInput('check updates', { silentEcho: true, noChain: true }),
      backup: () => handleInput('backup my data', { silentEcho: true, noChain: true }),
      reminder: () => reply('Noted, Boss.'),
      battery_saver: () => reply('Battery saver: Settings → Battery → Battery saver → on. Ya baad mein kar lo.')
    }[s.action && s.action.type];
    if (act) act(); else if (s.action) runAction(s.action, {}).catch(() => {});
  });
  row.querySelector('.suggest-x').addEventListener('click', () => {
    row.remove();
    INTELX.suggestionVerdict(s.id, false);
    U.toast('Noted — I won\'t suggest that again', '🙈');
  });
  box.appendChild(row);
  scrollBottom();
}

/* ================= v15 Phase 3: AI ROUTER + WORKFLOW ================= */

/* Router executor — one provider call. Returns {ok, text|skipped, reason, ms}. */
async function routerExec(provider, messages, opts = {}) {
  switch (provider) {
    case 'server': {
      if (!SERVER.isConfigured()) return { ok: false, reason: 'not configured' };
      let acc = '';
      const full = await SERVER.chat(messages, {
        signal: opts.signal,
        onToken: opts.onToken ? (t, sofar) => { acc = sofar; opts.onToken(t, sofar); } : null
      });
      if (!full && !acc) return { ok: false, reason: 'empty' };
      return { ok: true, text: (full || acc), tokens: Math.round((full || acc).length / 4) };
    }
    case 'groq': {
      if (!AI.hasGroq()) return { ok: false, reason: 'no key' };
      const full = await AI.callGroq(messages, {
        stream: !!opts.onToken, onToken: opts.onToken, maxTokens: opts.maxTokens || 1024,
        temperature: opts.temperature, model: opts.model
      });
      if (!full) return { ok: false, reason: 'empty' };
      return { ok: true, text: full, tokens: Math.round(full.length / 4) };
    }
    case 'ollama': {
      const base = (S.getSetting('ollamaUrl') || '').trim().replace(/\/+$/, '');
      if (!base) return { ok: false, reason: 'not configured' };
      const model = S.getSetting('ollamaModel') || 'llama3';
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 60000);
      try {
        const res = await fetch(base + '/api/chat', {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, stream: !!opts.onToken })
        });
        clearTimeout(to);
        if (!res.ok) return { ok: false, reason: 'http ' + res.status };
        if (!opts.onToken) {
          const j = await res.json();
          const text = (j.message && j.message.content) || '';
          return text ? { ok: true, text } : { ok: false, reason: 'empty' };
        }
        // streaming: ndjson lines
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '', full = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const j = JSON.parse(line);
              const piece = (j.message && j.message.content) || '';
              if (piece) { full += piece; opts.onToken(piece, full); }
            } catch (_) {}
          }
        }
        return full ? { ok: true, text: full } : { ok: false, reason: 'empty' };
      } catch (e) {
        clearTimeout(to);
        return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
      }
    }
    case 'local': {
      /* on-device llama.cpp via localbrain */
      if (!LB.wantLocal(String((messages[messages.length - 1] || {}).content || ''), true)) return { ok: false, reason: 'local unavailable' };
      const q = String((messages[messages.length - 1] || {}).content || '');
      const r = await LB.askLocal(AI.systemPrompt().split('TRUST & ACCURACY')[0].trim(), q, {
        onToken: opts.onToken ? (_, sofar) => opts.onToken('', sofar) : null
      });
      const text = (r.ok ? r.text : '').trim();
      return text ? { ok: true, text } : { ok: false, reason: 'empty' };
    }
    default: return { ok: false, reason: 'unknown provider' };
  }
}

/* Route a chat through AIR (used by askGroq when not on server/local-first). */
async function askViaRouter(text, messages, sys) {
  const task = AIR.classifyTask(text);
  return AIR.route({
    task, messages: [{ role: 'system', content: sys }, ...messages, { role: 'user', content: text }],
    onToken: null, exec: routerExec,
    opts: { maxTokens: 1200, temperature: 0.6 }
  });
}

/* Workflow node runners — map tools onto existing FRIDAY skills. */
async function workflowNode(tool, inputs, ctx) {
  switch (tool) {
    case 'ocr': {
      const img = inputs.image || inputs.input || ctx.image;
      if (!img) return { ok: false, reason: 'no image' };
      const src = img.startsWith('data:') ? img : 'data:image/jpeg;base64,' + img;
      const r = await VIS.ocr(src, () => {});
      return { ok: !!(r && r.text), result: (r && r.text) || '', reason: r ? '' : 'ocr failed' };
    }
    case 'summarize': {
      const text = inputs.from || inputs.text || '';
      if (!text) return { ok: false, reason: 'no text' };
      if (AI.hasGroq() || SERVER.isConfigured()) {
        try {
          const g = await AI.callGroq([{ role: 'system', content: 'Summarize in 4-6 short plain lines.' }, { role: 'user', content: String(text).slice(0, 3000) }], { maxTokens: 240 });
          if (g) return { ok: true, result: g };
        } catch (_) {}
      }
      const first = String(text).split(/(?<=[.!?])\s+/).slice(0, 4).join(' ');
      return { ok: true, result: first.slice(0, 600) };
    }
    case 'save_note': {
      S.addItem(KEYS.NOTES, { text: '📎 ' + String(inputs.from || inputs.text || '').slice(0, 800) });
      refresh('notes');
      return { ok: true, result: 'saved' };
    }
    case 'translate': {
      const text = inputs.from || inputs.text || '';
      const to = inputs.to || ctx.to || 'hi';
      const r = await API.quickTranslate(String(text), to).catch(() => null);
      return r && r.ok ? { ok: true, result: r.text } : { ok: false, reason: 'translate failed' };
    }
    case 'send_message': {
      const name = inputs.name || ctx.name || '';
      const body = inputs.from || inputs.text || '';
      if (!name) return { ok: false, reason: 'no contact' };
      const c = await contactByName(name);
      if (!c || !c.phone) return { ok: false, reason: 'contact not found' };
      if (ctx.app === 'whatsapp' || inputs.app === 'whatsapp') {
        await runAction({ type: 'whatsapp', number: c.phone, body, name: c.name }, {});
      } else {
        await runAction({ type: 'sms', number: c.phone, body, name: c.name }, {});
      }
      return { ok: true, result: 'sent to ' + name };
    }
    case 'extract_tasks': {
      const text = inputs.from || '';
      const matches = String(text).match(/(?:^|\n|\b)(?:task|todo|karna hai|do this|remember to)\s*[:,\-]?\s*([^\n]{3,80})/gi) || [];
      const tasks = matches.slice(0, 6).map(m => m.replace(/^(?:task|todo|karna hai|do this|remember to)\s*[:,\-]?\s*/i, '').trim());
      return { ok: true, result: tasks };
    }
    case 'add_calendar': {
      const tasks = inputs.from || [];
      (Array.isArray(tasks) ? tasks : [tasks]).slice(0, 6).forEach(t => S.addItem(KEYS.EVENTS, { text: t }));
      refresh('events');
      return { ok: true, result: 'added ' + (Array.isArray(tasks) ? tasks.length : 1) + ' events' };
    }
    /* v15 Phase 4: extract deadlines/dates from text → calendar events */
    case 'extract_deadlines': {
      const text = inputs.from || inputs.text || '';
      const dates = DOCAI.analyzeContract(text).dates;
      const events = dates.map((d, i) => ({ text: '📌 Deadline ' + (i + 1) + ': ' + d, created: Date.now() }));
      events.forEach(e => S.addItem(KEYS.EVENTS, e));
      refresh('events');
      return { ok: true, result: 'extracted ' + events.length + ' deadlines' };
    }
    default: return { ok: false, reason: 'unknown tool ' + tool };
  }
}

/* Run a workflow template by name (or custom id) with ctx. */
async function runWorkflowFlow(name, ctx = {}) {
  const tpl = WF.templateById(name);
  if (!tpl) { reply(`Workflow "${name}" nahi mila. Templates: ${WF.templates().map(t => t.id).join(', ')}.`); return true; }
  thinking(true);
  const r = await WF.runWorkflow({ template: tpl, ctx }, { runNode: workflowNode }).catch(() => ({ ok: false, reason: 'workflow crashed' }));
  thinking(false);
  if (r.ok) {
    reply(`⚙️ **${tpl.name}** complete in ${r.ms}ms.`);
    V.speak(`${tpl.name} ho gaya.`);
  } else {
    reply(`Workflow failed at "${r.failedAt || '?'}" — ${r.reason}.`);
  }
  return true;
}

/* ---- Phase 4: read a document file (txt/md/pdf via FileReader) and store it ---- */
function pickAndReadDoc() {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.txt,.md,.pdf,.csv';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) { reply('Koi file select nahi hui.'); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        const raw = String(reader.result || '');
        let text = raw;
        /* if it looks like a real PDF (binary), try lazy pdfjs, else say so */
        if (/\.pdf$/i.test(f.name) && raw.includes('%PDF')) {
          try {
            const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.mjs');
            const doc = await pdfjs.getDocument({ data: new Uint8Array(raw.length) }).promise;
            let out = '';
            for (let p = 1; p <= Math.min(doc.numPages, 20); p++) {
              const page = await doc.getPage(p);
              const tc = await page.getTextContent();
              out += tc.items.map(it => it.str).join(' ') + '\n';
            }
            text = out;
          } catch (e) { text = ''; }
        }
        if (!text.trim()) { reply('Us file se text extract nahi hua (encrypted PDF ya image-based?). Screenshot pe "read text" use karo.'); return; }
        const rec = DOCAI.addDoc({ name: f.name, kind: /\.pdf$/i.test(f.name) ? 'pdf' : 'text', text });
        reply(`📄 **${f.name}** read kar liya — ${DOCAI.localDocSummary(text).slice(0, 140)}…\nAsk me: "ask pdf <question>" ya "pdf summary".`);
      };
      reader.readAsText(f);
    };
    inp.click();
    res(true);
  });
}

/* ---- Phase 4: analyze the most recent doc (resume / contract) ---- */
async function analyzeLastDoc(kind) {
  const d = DOCAI.docs()[0];
  if (!d) { reply('Pehle ek document upload karo ("read pdf").'); return true; }
  if (kind === 'resume') {
    const r = DOCAI.analyzeResume(d.text);
    const lines = [
      `• Name: ${r.name || '—'}`,
      `• Email: ${r.email || '—'}`,
      `• Phone: ${r.phone || '—'}`,
      `• Skills (${r.skills.length}): ${r.skills.join(', ') || '—'}`,
      `• Experience mentions: ${r.experienceMentions} · Education: ${r.hasEducation ? 'yes' : 'no'}`,
      `• Verdict: **${r.verdict}**`
    ];
    reply(`📄 **Resume analysis** (${d.name})\n` + lines.join('\n'));
  } else {
    const c = DOCAI.analyzeContract(d.text);
    const lines = [
      `• Amounts: ${c.money.length ? c.money.join(', ') : '—'}`,
      `• Dates: ${c.dates.length ? c.dates.join(', ') : '—'}`,
      `• Parties: ${c.parties.length ? c.parties.join('; ') : '—'}`,
      ...c.risk.map(r => `⚠️ ${r}`)
    ];
    reply(`📄 **Contract review** (${d.name})\n` + lines.join('\n') + (c.risk.length ? '' : '\n• No obvious red flags.'));
  }
  return true;
}

/* ---- Phase 6: safety-timer check-in ---- */
function runSafetyCheck(id) {
  const t = GUARD.safetyTimers().find(x => x.id === id);
  if (!t || !t.armed) return;
  state.safetyTimerId = id;
  state.expect = 'safety_ok';
  addMsg('ai', `🛡 **Safety check** — sab theek hai? Bolo "sab theek" ya "help".`, { proactive: true });
  V.speak('Safety check. Sab theek hai? Bol do ok ya help.');
}

/* ---- Phase 6: camera heart-rate estimation ---- */
async function runHeartRate() {
  if (!NAT.isNative()) { reply('Heart rate sirf installed app me (camera).'); return true; }
  reply('Put your finger on the camera lens — 15 seconds, light on.');
  U.openPanel('camera');
  openCamera('photo');
  // sample frames from the video feed
  const frames = [];
  const vid = $('#cameraFeed');
  const canvas = $('#cameraCanvas');
  const ctx = canvas.getContext('2d');
  const sample = setInterval(() => {
    if (!vid || vid.readyState < 2) return;
    canvas.width = 32; canvas.height = 32;
    ctx.drawImage(vid, 0, 0, 32, 32);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    let r = 0, g = 0, b = 0, n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    frames.push(GUARD.frameAvg(r / n, g / n, b / n));
  }, 66);   // ~15 fps
  setTimeout(async () => {
    clearInterval(sample);
    closeCamera();
    const hr = GUARD.heartRate(frames, { fps: 15 });
    if (hr.bpm) {
      reply(`❤️ Heart rate ~**${hr.bpm} bpm** (estimate, confidence ${Math.round(hr.confidence * 100)}%). Ye medical nahi hai — doctor se confirm karo agar doubt ho.`);
    } else {
      reply(`Heart rate nahi nikal paya (${hr.reason}). Better light + finger ko lens pe firmly rakho.`);
    }
  }, 16000);
  return true;
}

/* ---- Phase 5: mock test answer grading ---- */
function mockAnswer(text) {
  const t = state.mockTest;
  if (!t) return true;
  const cur = t.questions[state.mockIdx];
  const expected = String(cur.a || '').toLowerCase();
  const got = text.toLowerCase();
  const key = expected.split(/[,;(]/)[0].trim();
  const words = key.split(/\s+/).filter(w => w.length > 3);
  const hits = words.filter(w => got.includes(w)).length;
  const good = (key && got.includes(key)) || (words.length && hits >= Math.max(1, Math.ceil(words.length * 0.6)));
  if (good) state.mockScore++;
  state.mockIdx++;
  if (state.mockIdx >= t.questions.length) {
    const g = STUDYX.gradeTest(t.questions.map(q => ({ user: true, correct: true })));   // placeholder
    const pct = Math.round(100 * state.mockScore / t.questions.length);
    state.mockTest = null;
    reply(`🏁 **Mock test done** — ${state.mockScore}/${t.questions.length} (${pct}%)\n` + (pct >= 80 ? 'Excellent, Boss! NDA level 💪' : pct >= 60 ? 'Solid. Ek aur round?' : 'Practice karo — main yahan hoon.'));
    return true;
  }
  reply(`${good ? '✅ Sahi!' : '❌ Answer: ' + cur.a}\n\n**Q${state.mockIdx + 1}.** ${t.questions[state.mockIdx].q}`);
  return true;
}

/* ================= ASYNC SKILLS ================= */
function thinking(on) {
  state.processing = on;
  if (on) showTyping(); else hideTyping();
}

/* ================= v7.7 HUD ================= */
/* Arc-reactor rings: outer ring = battery %, mid ring = steps-to-goal %.
   All data optional - rings just dim when a source is unavailable. */
async function updateReactor() {
  try {
    const rb = $('#ringBattery');
    if (rb) {
      try {
        const b = await D.battery();
        const pct = b && typeof b.level === 'number' ? Math.max(0, Math.min(100, b.level)) : null;
        rb.style.setProperty('--p', pct == null ? 0 : pct);
        rb.style.opacity = pct == null ? .25 : .85;
        rb.title = pct == null ? 'Battery: unknown' : `Battery ${pct}%${b.charging ? ' (charging)' : ''}`;
      } catch (e) { rb.style.opacity = .25; }
    }
    const rs = $('#ringSteps');
    if (rs) {
      try {
        const st = await HEALTH.getSteps();
        const goal = HEALTH.stepsGoal() || 0;
        const sp = st && goal > 0 ? Math.min(100, Math.round(st.today / goal * 100)) : 0;
        rs.style.setProperty('--p', sp);
        rs.title = sp ? `Steps: ${sp}% of goal` : 'Steps: waiting for permission';
      } catch (e) { rs.style.setProperty('--p', 0); }
    }
  } catch (e) {}
}

/* "ALL SYSTEMS NOMINAL" line - computed from REAL capability flags.
   Tap it and FRIDAY posts a per-system card with fix instructions. */
async function computeSystemsLine() {
  const el = $('#systemsLine'); if (!el) return;
  if (!NAT.isNative()) {
    state.systemsRows = [];
    el.className = 'systems-line';
    el.textContent = 'WEB PREVIEW - RUN THE APK FOR SYSTEMS CHECK';
    return;
  }
  let caps = {};
  try { caps = await NAT.capabilities() || {}; } catch (e) {}
  /* capability rows (permissions) */
  const rows = [
    { name: 'Notification read/reply', ok: !!caps.notifications, fix: 'Special access > Notification access > FRIDAY OS ON' },
    { name: 'FRIDAY Control (screen taps)', ok: !!caps.accessibility, fix: 'Accessibility > FRIDAY Control > ON' },
    { name: 'Floating bubble overlay', ok: !!caps.overlay, fix: 'Display over other apps > FRIDAY OS > Allow' },
    { name: 'Contacts', ok: !!caps.contacts, fix: 'say "permissions" or Settings > Apps > FRIDAY OS' },
    { name: 'SMS', ok: !!caps.sendSms, fix: 'Settings > Apps > FRIDAY OS > Permissions > SMS' },
    { name: 'Phone calls', ok: !!caps.phone, fix: 'Settings > Apps > FRIDAY OS > Permissions > Phone' }
  ];
  /* v14.1: aggregate CORE service health + VOX state too — the old banner only
     looked at permissions, so it said "ALL SYSTEMS NOMINAL" while voice was
     dead and probes were crashing. */
  let health = {};
  try { health = await CORE.healthMap(); } catch (e) {}
  const CRITICAL = ['voice', 'memory', 'secx', 'autox', 'planx', 'devx'];
  const critFails = CRITICAL
    .map(n => ({ n, s: health[n] }))
    .filter(x => x.s && x.s.ok === false);
  const warnFails = Object.entries(health).filter(([, s]) => s && s.ok === false && !CRITICAL.includes(s.name || '')).length;
  const permMissing = rows.filter(r => !r.ok).length;
  const voiceState = VOX.vox.get();
  const voiceDead = voiceState === 'ERROR';

  const critNames = critFails.map(x => x.n);
  if (voiceDead && !critNames.includes('voice')) critNames.unshift('voice');

  state.systemsRows = rows.concat(critFails.map(x => ({
    name: 'Service: ' + x.n, ok: false, sev: 'crit', fix: (x.s && x.s.error) || (x.s && x.s.detail) || 'fault'
  })));

  const sev = critNames.length ? 'crit' : (permMissing || warnFails) ? 'warn' : 'ok';
  el.className = 'systems-line ' + (sev === 'crit' ? 'crit' : sev === 'warn' ? 'warn' : 'ok');
  if (sev === 'crit') {
    el.textContent = `🔴 SYSTEM DEGRADED - ${critNames.slice(0, 3).join(', ')} - TAP HERE`;
  } else if (sev === 'warn') {
    el.textContent = `🟡 ${permMissing + warnFails} SYSTEM${(permMissing + warnFails) > 1 ? 'S' : ''} NEED${(permMissing + warnFails) > 1 ? '' : 'S'} ATTENTION - TAP HERE`;
  } else {
    el.textContent = '🟢 ALL SYSTEMS NOMINAL';
  }
}

async function loadWeatherWidget() {
  try {
    const loc = await API.resolveLocation();
    const [wx, place] = await Promise.all([
      API.getWeather(loc.lat, loc.lon),
      loc.label ? Promise.resolve(loc.label) : API.reverseGeocode(loc.lat, loc.lon)
    ]);
    renderWeatherWidget(wx, place);
  } catch (e) {
    const el = $('#weatherData');
    if (el) el.innerHTML = '<span class="dim">Offline</span>';
  }
}

async function doWeather(tomorrow) {
  thinking(true);
  try {
    const loc = await API.resolveLocation();
    const [wx, place] = await Promise.all([
      API.getWeather(loc.lat, loc.lon),
      loc.label ? Promise.resolve(loc.label) : API.reverseGeocode(loc.lat, loc.lon)
    ]);
    thinking(false);
    if (tomorrow) {
      const d = wx.daily;
      const [desc, emo] = API.describeWMO(d.weather_code[1]);
      reply(`Tomorrow in ${place}: ${desc} ${emo}, ${Math.round(d.temperature_2m_min[1])}° to ${Math.round(d.temperature_2m_max[1])}°C. Rain chance ${d.precipitation_probability_max[1]}%.`);
    } else {
      const c = wx.current;
      const [desc, emo] = API.describeWMO(c.weather_code);
      reply(`${place}: ${Math.round(c.temperature_2m)}°C, ${desc} ${emo}. Feels like ${Math.round(c.apparent_temperature)}°, humidity ${c.relative_humidity_2m}%, wind ${Math.round(c.wind_speed_10m)} km/h.${wx._stale ? ' (cached — offline)' : ''}`);
    }
    renderWeatherWidget(wx, place);
  } catch (e) {
    thinking(false);
    reply('Weather unavailable — no connection.');
  }
}

async function doAQI() {
  thinking(true);
  try {
    const loc = await API.resolveLocation();
    const d = await API.getAQI(loc.lat, loc.lon);
    thinking(false);
    const aqi = d.current?.us_aqi, pm = d.current?.pm2_5;
    const [label, emo] = API.aqiLabel(aqi);
    reply(`Air quality index ${Math.round(aqi)} — ${label} ${emo}. PM2.5 at ${Math.round(pm)} µg/m³.`);
  } catch (e) { thinking(false); reply('Air quality data unavailable.'); }
}

async function doLocation() {
  thinking(true);
  try {
    const loc = await API.resolveLocation();
    const place = loc.label || await API.reverseGeocode(loc.lat, loc.lon);
    thinking(false);
    reply(`You're in ${place} — ${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}.${loc.fallback ? ' (GPS unavailable, using default)' : ''}`);
  } catch (e) { thinking(false); reply('Location unavailable.'); }
}

async function doWiki(q) {
  thinking(true);
  try {
    const r = await API.wikiSummary(q);
    thinking(false);
    const short = r.extract.length > 420 ? r.extract.slice(0, 420).replace(/\s+\S*$/, '') + '…' : r.extract;
    addMsg('ai', `**${r.title}**\n${short}`, { link: r.url });
    V.speak(short, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
  } catch (e) {
    thinking(false);
    if (AI.hasGroq()) return askGroq(q);
    reply(`Couldn't find "${q}". Try rephrasing, or configure the optional FRIDAY Cloud backend for open questions.`);
  }
}

async function doDefine(w) {
  thinking(true);
  try {
    const d = await API.define(w);
    thinking(false);
    const body = d.meanings.map(m => `_${m.pos}_ — ${m.def}`).join('\n');
    addMsg('ai', `**${d.word}** ${d.phonetic}\n${body}`);
    V.speak(`${d.word}. ${d.meanings[0].def}`);
  } catch (e) { thinking(false); reply(`No definition found for "${w}".`); }
}

async function doNews() {
  thinking(true);
  try {
    const items = await API.news();
    thinking(false);
    const body = items.slice(0, 5).map((n, i) => `${i + 1}. ${n.title}`).join('\n');
    addMsg('ai', `**Top headlines**\n${body}`);
    V.speak('Top headlines. ' + items.slice(0, 3).map(n => n.title).join('. '));
  } catch (e) { thinking(false); reply('News unavailable — no connection.'); }
}

async function doCurrency(q) {
  thinking(true);
  try {
    const m = q.match(/(\d+\.?\d*)\s*([a-z]{3})\s*(?:to|in)\s*([a-z]{3})/i);
    if (!m) { thinking(false); return reply('Try: "convert 100 USD to INR".'); }
    const r = await API.convertCurrency(parseFloat(m[1]), m[2], m[3]);
    thinking(false);
    reply(`${m[1]} ${m[2].toUpperCase()} = ${r.value.toFixed(2)} ${m[3].toUpperCase()}.`);
  } catch (e) { thinking(false); reply('Currency conversion unavailable.'); }
}

async function doBriefing() {
  thinking(true);
  const bits = [];
  const hour = new Date().getHours();
  bits.push(`${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${S.getSetting('userName') || 'Boss'}.`);
  bits.push(`It's ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}.`);

  try {
    const loc = await API.resolveLocation();
    const [wx, aq] = await Promise.all([
      API.getWeather(loc.lat, loc.lon).catch(() => null),
      API.getAQI(loc.lat, loc.lon).catch(() => null)
    ]);
    if (wx?.current) {
      const [desc] = API.describeWMO(wx.current.weather_code);
      const rain = wx.daily?.precipitation_probability_max?.[0];
      bits.push(`Outside it's ${Math.round(wx.current.temperature_2m)} degrees, ${desc.toLowerCase()}${rain > 40 ? `, with a ${rain}% chance of rain` : ''}.`);
    }
    if (aq?.current?.us_aqi != null) {
      const [label] = API.aqiLabel(aq.current.us_aqi);
      bits.push(`Air quality is ${label.toLowerCase()} at ${Math.round(aq.current.us_aqi)}.`);
    }
  } catch (_) {}

  const rem = S.getList(KEYS.REMINDERS).filter(r => !r.done && r.due > Date.now()).sort((a, b) => a.due - b.due);
  bits.push(rem.length
    ? `You have ${rem.length} reminder${rem.length === 1 ? '' : 's'}. Next: ${rem[0].text}, ${humanTime(new Date(rem[0].due))}.`
    : 'No reminders scheduled.');

  try {
    const sb = await HEALTH.stepsBrief();
    if (sb) bits.push(sb);
  } catch (_) {}

  const tasks = S.getList(KEYS.TASKS).filter(t => !t.done);
  if (tasks.length) bits.push(`${tasks.length} open task${tasks.length === 1 ? '' : 's'}.`);

  const b = await D.battery();
  if (b) bits.push(`Battery at ${b.level}%${b.charging ? ' and charging' : ''}.`);

  thinking(false);
  reply(bits.join(' '));
}

/* ---------- Coding ---------- */
/* Priority: 1) on-device LLM (install once, unlimited, no key)
             2) Groq cloud (if key)
             3) curated offline templates                        */
async function doCode(prompt) {
  if (CODER.ready()) return streamLocalCode(prompt);
  /* v10.1: FRIDAY Cloud generates code server-side — no 1GB download */
  if (SERVER.isConfigured() && S.getSetting('serverMode') !== false) return streamServerCode(prompt);
  if (CODER.engineAvailable() && !CODER.installedModelId()) {
    U.openPanel('sub-coder');
    $('#codeResult').innerHTML = U.renderRich(
      'The offline coding engine is bundled but **no model is installed yet**.\n\n' +
      'Open **Settings → Offline Coder** and download one (Qwen Coder 1.5B ≈ 1 GB, recommended). ' +
      'After that one-time step, code generation works with **no internet and no key**.');
    reply('The offline coder needs a one-time model download. Opening Settings.');
    setTimeout(() => { U.closeAllPanels(); U.openPanel('settings'); }, 1600);
    return;
  }
  if (!AI.hasGroq()) {
    U.openPanel('sub-coder');
    const tpl = T.offlineCode(prompt);
    const out = $('#codeResult');
    if (tpl) {
      out.innerHTML = U.renderRich(tpl.body);
      reply(`No cloud key, so here's an offline template: ${tpl.title}. Check the Coder panel.`);
    } else {
      out.innerHTML = U.renderRich(`I have offline templates for: **${T.codeTopics().join(', ')}**.\n\nFor code written specifically for your request, configure the optional FRIDAY Cloud backend (console.groq.com — no card needed), or install the offline coder (Settings → Offline Coder).`);
      reply('No offline template matches that. Configure FRIDAY Cloud; offline templates remain available.');
    }
    return;
  }
  U.openPanel('sub-coder');
  const out = $('#codeResult');
  out.innerHTML = '<div class="agent-thinking">Generating…</div>';
  try {
    const code = await AI.callGroq([
      { role: 'system', content: 'You are an expert programmer. Output complete, working, production-ready code. Include brief setup notes. Use fenced code blocks with the language tag. No placeholders or TODOs.' },
      { role: 'user', content: prompt }
    ], { maxTokens: 4096, temperature: 0.3, model: 'qwen/qwen3-32b' });
    out.innerHTML = U.renderRich(code);
    reply('Code ready in the Coder panel.');
  } catch (e) {
    out.innerHTML = U.emptyState(errMsg(e));
  }
}

/* Stream code from the on-device LLM (tokens arrive live, no network). */
async function streamLocalCode(prompt) {
  U.openPanel('sub-coder');
  const out = $('#codeResult');
  out.innerHTML = '<div class="agent-thinking">Generating on-device… (first load takes a few seconds)</div>';
  let acc = '', live = null, rafPending = false;

  const flush = () => {
    rafPending = false;
    if (!acc) return;
    if (!live) { out.innerHTML = ''; live = document.createElement('div'); out.appendChild(live); }
    live.innerHTML = U.renderRich(acc);
  };

  try {
    const final = await CODER.generate(prompt, {
      onToken: (_, sofar) => {
        acc = sofar;
        if (!rafPending) { rafPending = true; requestAnimationFrame(flush); }
      }
    });
    if (final && final !== acc) { acc = final; }
    flush();
    reply('Code ready — generated locally, no cloud used.');
  } catch (e) {
    const m = String(e.message || e);
    out.innerHTML = U.emptyState(
      m.includes('LLAMA_BINDING_MISSING') ? 'Engine binding missing — rebuild with native/add_llama_dep.py (see llama_setup.md).'
      : m === 'NO_MODEL' ? 'Download a model in Settings → Offline Coder.'
      : m === 'BUSY' ? 'Still generating the previous answer — one moment.'
      : 'Offline coder failed: ' + m);
  }
}

/* v10.1: stream code from the FRIDAY Cloud backend (no model download). */
async function streamServerCode(prompt) {
  U.openPanel('sub-coder');
  const out = $('#codeResult');
  out.innerHTML = '<div class="agent-thinking">Generating on FRIDAY Cloud…</div>';
  let acc = '', live = null, rafPending = false;
  const flush = () => {
    rafPending = false;
    if (!acc) return;
    if (!live) { out.innerHTML = ''; live = document.createElement('div'); out.appendChild(live); }
    live.innerHTML = U.renderRich(acc);
  };
  try {
    const final = await SERVER.chat([
      { role: 'system', content: 'You are an expert programmer. Output complete, working, production-ready code with fenced code blocks and a language tag. Include setup/run notes. No placeholders or TODOs.' },
      { role: 'user', content: prompt }
    ], {
      onToken: (_, sofar) => {
        acc = sofar;
        if (!rafPending) { rafPending = true; requestAnimationFrame(flush); }
      }
    });
    if (final && final !== acc) acc = final;
    flush();
    reply('Code ready — generated on FRIDAY Cloud, no download needed.');
  } catch (e) {
    out.innerHTML = U.emptyState('Server coder failed: ' + (e.message || e));
  }
}

/* ---------- Offline Coder settings UI ---------- */
async function renderCoder() {
  const box = $('#coderStatus'); if (!box) return;
  const list = $('#modelList');
  const st = await CODER.status();

  if (!st.native) {
    box.innerHTML = '<div class="bs-row"><span class="bs-dot"></span><div><strong>APK only</strong><div class="dim">The offline coder runs in the installed Android app, not the browser.</div></div></div>';
    if (list) list.innerHTML = '';
    return;
  }
  if (!st.engine) {
    box.innerHTML = '<div class="bs-row"><span class="bs-dot"></span><div><strong>Engine not linked</strong><div class="dim">This build lacks the llama.cpp binding (see native/llama_setup.md). Templates &amp; Groq still work.</div></div></div>';
    if (list) list.innerHTML = '';
    return;
  }

  box.innerHTML = `<div class="bs-row"><span class="bs-dot ok"></span><div><strong>llama.cpp engine ready</strong><div class="dim">~${st.ramGB} GB RAM · budget ${st.budgetMB} MB · recommended: ${U.escapeHtml(st.recommendedCode.name)} (code) · ${U.escapeHtml(st.recommendedChat.name)} (chat)</div></div></div>`;

  if (!list) return;
  const rowFor = m => {
    const installed = st.installed && st.installed.id === m.id;
    const fits = (m.sizeMB * 1.5) <= st.budgetMB;
    const meta = `${m.kind === 'code' ? '💻' : '💬'} ${m.sizeMB} MB${m.humanEval ? ` · HumanEval ${m.humanEval}%` : ''} · ${m.blurb}`;
    return `<div class="model-row ${installed ? 'on' : ''}">
      <div class="model-info"><strong>${m.name}</strong><div class="dim">${meta}</div></div>
      ${installed
        ? `<button class="danger-btn" data-model-del="${m.id}">Delete</button>`
        : `<button class="tool-add-btn" data-model-dl="${m.id}" ${fits ? '' : 'disabled'}>${fits ? 'Download' : 'Too big'}</button>`}
    </div>`;
  };
  list.innerHTML = MODELS_ORDERED(st).map(rowFor).join('');
}
function MODELS_ORDERED(st) {
  // recommended first, then by size ascending
  const rec = new Set([st.recommendedCode.id, st.recommendedChat.id]);
  return [...CODER.MODELS].sort((a, b) => (rec.has(b.id) - rec.has(a.id)) || (a.sizeMB - b.sizeMB));
}

async function downloadModelFlow(id) {
  const dl = $('#dlProgress'), fill = $('#dlFill'), txt = $('#dlText');
  if (dl) dl.style.display = 'block';
  try {
    await CODER.downloadModel(id, (pct, done, total) => {
      if (fill) fill.style.width = pct + '%';
      if (txt) txt.textContent = `${done.toFixed(0)} / ${total.toFixed(0)} MB (${pct}%) — keep FRIDAY open`;
    });
    U.toast('Model ready — fully offline from now on', '✅', 3200);
  } catch (e) {
    U.toast('Download failed: ' + (e.message || e), '❌', 3500);
  }
  if (dl) dl.style.display = 'none';
  renderCoder();
}

/* ---------- Groq chat: agent mode (tools) + streaming TTS ---------- */

/* Execute a model-requested tool. Side effects happen here; the string
   goes back to the model so IT speaks the summary (no double-talk).  */
async function runToolByName(name, args = {}) {
  try {
    switch (name) {
      case 'set_reminder': {
        const when = args.when ? parseTime(String(args.when)) : null;
        const due = when ? when.date : new Date(Date.now() + 3600000);
        const rec = S.addItem(KEYS.REMINDERS, { text: args.text, due: due.getTime(), done: false });
        scheduleReminder(rec); refresh('reminders');
        return `Reminder "${args.text}" set for ${humanTime(due)}`;
      }
      case 'set_alarm': {
        const rec = AUTO.addAlarm({ time: String(args.time || '07:00'), label: args.label || 'Alarm', repeat: args.repeat || 'once' });
        refresh('alarms');
        if (NAT.isNative()) {
          const [h, m] = rec.time.split(':').map(Number);
          NAT.setSystemAlarm(h, m, rec.label, rec.repeat).catch(() => {});
        }
        return `Alarm set at ${AUTO.describeAlarm(rec)}`;
      }
      case 'add_note': S.addItem(KEYS.NOTES, { text: args.text }); refresh('notes'); return `Note saved: "${args.text}"`;
      case 'add_task': S.addItem(KEYS.TASKS, { text: args.text, done: false }); refresh('tasks'); return `Task added: "${args.text}"`;
      case 'call_contact': {
        const hit = await contactByName(args.name);
        if (!hit) return `No contact named ${args.name}`;
        runAction({ type: 'call', number: hit.phone, name: hit.name }, {});
        return `Calling ${hit.name}`;
      }
      case 'send_message': {
        const hit = await contactByName(args.name);
        if (!hit) return `No contact named ${args.name}`;
        await runAction({ type: args.app === 'whatsapp' ? 'whatsapp' : 'sms', number: hit.phone, body: args.body, name: hit.name }, {});
        return `Message queued to ${hit.name}`;
      }
      case 'get_weather': {
        try {
          const loc = await API.resolveLocation();
          const wx = await API.getWeather(loc.lat, loc.lon);
          const [desc] = API.describeWMO(wx.current.weather_code);
          return `${Math.round(wx.current.temperature_2m)}°C, ${desc}, feels ${Math.round(wx.current.apparent_temperature)}°, humidity ${wx.current.relative_humidity_2m}%`;
        } catch (_) { return 'Weather unavailable (offline)'; }
      }
      case 'search_knowledge': {
        try { const r = await API.wikiSummary(args.query); return r.extract.slice(0, 400); }
        catch (_) { return 'No knowledge result'; }
      }
      case 'tell_time': return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      /* ---- v7.8 PERSONA: live phone-state readers (the accuracy layer) ---- */
      case 'read_notifications': {
        if (!NAT.isNative()) return 'Notification reading needs the installed FRIDAY app + notification access.';
        try {
          const r = await NAT.getActiveNotifications();
          let items = (r && r.ok && Array.isArray(r.items)) ? r.items : [];
          if (!items.length) items = recentNotifs;
          if (!items.length) return 'Shade is empty (or notification access is OFF - if the user expected data, tell them to enable it in Special app access > Notification access).';
          if (args.app) {
            const q = String(args.app).toLowerCase();
            items = items.filter(n => (n.pkg || '').toLowerCase().includes(q) || (n.title || '').toLowerCase().includes(q));
          }
          if (!items.length) return `Nothing from ${args.app} in the shade right now.`;
          return items.slice(0, 8).map(n => `${NAT.friendlyApp(n.pkg)}: ${n.title} - ${n.text}`).join(' | ').slice(0, 900);
        } catch (e) { return 'Notification reader error.'; }
      }
      case 'get_steps': {
        try {
          const st = await HEALTH.getSteps();
          if (!st) return 'Step counter needs the Physical Activity permission - ask the user to say "permissions" and allow it.';
          return `${st.today} steps today (goal ${HEALTH.stepsGoal()}).`;
        } catch (e) { return 'Steps unavailable right now.'; }
      }
      case 'list_reminders': {
        const rs = (S.getList(KEYS.REMINDERS) || []).filter(r => !r.done).slice(0, 8);
        if (!rs.length) return 'No pending reminders.';
        return rs.map(r => `${r.text} (${humanTime(new Date(r.due))})`).join(' | ');
      }
      case 'read_screen_text': {
        if (!NAT.isNative()) return 'Screen reading needs the installed FRIDAY app.';
        try {
          const r = await NAT.readScreenText();
          if (!r || !r.ok || r.reason === 'a11y_off') return 'Screen reader (FRIDAY Control accessibility) is OFF - tell the user to enable it, then ask again.';
          const txt = (r.text || '').trim();
          return txt ? txt.slice(0, 1500) : 'The screen looks empty right now.';
        } catch (e) { return 'Screen reader error.'; }
      }
      /* ---- v8.1 EYES: visual see + tap tools ---- */
      case 'see_screen': {
        const r = await performScreenVision(String(args.question || ''));
        return r.text;
      }
      case 'tap_screen': {
        if (!NAT.isNative()) return 'Screen taps need the installed FRIDAY app.';
        const r = await NAT.tapAt(Number(args.x), Number(args.y));
        return r && r.ok ? `Tapped at (${args.x}, ${args.y}).` : 'Tap failed - FRIDAY Control may be off, or the spot was protected.';
      }
      case 'tell_battery': { const b = await D.battery(); return b ? `${b.level}%${b.charging ? ' charging' : ''}` : 'unknown'; }
      case 'media_control': {
        if (!NAT.isNative()) return 'Media keys need the installed FRIDAY app.';
        const act = String(args.action || 'playpause');
        const r = await NAT.mediaControl(act);
        return r && r.ok ? `Media key "${act}" sent to the active player.` : 'No active media player answered - ask the user if anything is actually playing.';
      }
      default: return 'Unknown tool';
    }
  } catch (e) { return 'Tool failed: ' + (e.message || e); }
}

/* ================= v9.0 APEX feature engines ================= */

function fmtAgo(ts) {

  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

/* ---- A1 AI Wallpaper Forge (keyless pollinations.ai + WallpaperManager) ---- */
async function doWallpaper(topic) {
  if (!navigator.onLine) { reply('The wallpaper forge needs internet for generation - no key, just data.'); return true; }
  reply(topic ? `Forging a wallpaper of "${topic}" - model needs 20-45 seconds...` : 'Forging you a fresh Stark-grade wallpaper...');
  const url = API.pollinationsUrl(topic || 'tony stark arc reactor core, dark cinematic, glowing blue');
  let dataUrl;
  try { dataUrl = await API.fetchImageDataUrl(url); }
  catch (e) { reply('Generation timed out - the free forge is busy right now. Try again in a minute.'); return true; }
  addMsg('ai', 'Here it is.', { image: dataUrl });
  if (NAT.isNative()) {
    const r = await NAT.setWallpaper(dataUrl);
    reply(r && r.ok ? 'Set as your wallpaper - check your home screen.'
                   : `Showed it above, but could not set the wallpaper (${(r && r.reason) || 'error'}).`);
  } else {
    reply('Showing it above. Inside the phone app I set it as your wallpaper automatically.');
  }
  return true;
}

/* ---- A3 notification history / digest ---- */
async function doNotifHistory() {
  if (!NAT.isNative()) { reply(nativeOnly('notification history')); return true; }
  const r = await NAT.getNotifLog('', 8);
  const items = (r && r.items) || [];
  if (!items.length) { reply('No history yet - it builds from now on, and it survives messages the sender deletes.'); return true; }
  reply(`Last ${items.length} notifications (these survive sender deletes):\n` +
    items.map(n => `• ${NAT.friendlyApp(n.pkg)} — ${n.title}: ${(n.text || '').slice(0, 60)} · ${fmtAgo(n.when)}`).join('\n'),
    { source: 'live' });
  return true;
}

async function doNotifDigest(app) {
  if (!NAT.isNative()) { reply(nativeOnly('digest')); return true; }
  const r = await NAT.getNotifLog(app || '', 60);
  const items = ((r && r.items) || []).filter(n => Date.now() - n.when < 24 * 3600e3);
  if (!items.length) { reply(app ? `Nothing from ${NAT.friendlyApp(app)} in the last day.` : 'No notifications logged in the last day.'); return true; }
  const label = app ? NAT.friendlyApp(app) : 'your apps';
  if (AI.hasGroq()) {
    try {
      const raw = items.map(n => `${n.title}: ${n.text}`).join(' | ').slice(0, 3500);
      const out = await AI.callGroq([
        { role: 'system', content: 'Summarize this notification log into a short spoken digest: who messaged, what actually matters, anything urgent. 3-5 plain sentences, no bullets, no headers.' },
        { role: 'user', content: raw }
      ], { maxTokens: 240, temperature: 0.5 });
      if (out) { reply(out, { source: 'live' }); return true; }
    } catch (e) {}
  }
  reply(`Today from ${label}: ` + items.slice(0, 5).map(n => `${n.title} (${fmtAgo(n.when)})`).join(', ') +
    (items.length > 5 ? `, plus ${items.length - 5} more` : '') + '.', { source: 'live' });
  return true;
}

/* ---- A4 focus mode + scroll police + screen time ---- */
const SCROLL_APPS = {
  'com.instagram.android': 'Instagram', 'com.google.android.youtube': 'YouTube',
  'com.zhiliaoapp.musically': 'TikTok', 'com.facebook.katana': 'Facebook',
  'com.twitter.android': 'X', 'com.snapchat.android': 'Snapchat', 'com.reddit.frontpage': 'Reddit'
};

function startFocusLoop() {
  clearInterval(state.focusLoop);
  state.focusLoop = setInterval(async () => {
    if (!state.focus || Date.now() > state.focus.until) {
      // quiet expiry: HEALTH.startFocus's own completion does the talking/DND lift
      clearInterval(state.focusLoop); state.focusLoop = null; state.focus = null; return;
    }
    try {
      const fg = await NAT.getForegroundApp();
      const label = fg && fg.pkg ? SCROLL_APPS[fg.pkg] : null;
      if (!label || document.hidden) return;
      if (Date.now() - (state.focus.warned[fg.pkg] || 0) < 90000) return;
      state.focus.warned[fg.pkg] = Date.now();
      const line = pick([
        `${label} during focus time, Boss? Back to the mission.`,
        `${label} can wait - your focus timer is still on.`,
        `Scroll police: ${label} spotted. Eyes back on the prize?`
      ]);
      U.toast(line, '🛡️', 4500);
      V.speak(line);
    } catch (e) {}
  }, 9000);
}

/* ---- A5 SOS guardian ---- */
async function doSOS() {
  const num = (S.getSetting('emergencyContact') || '').replace(/[^\d+]/g, '');
  if (!num) {
    reply('No emergency contact yet. Say "my emergency contact is 9876543210" - then "SOS" sends them your live location by SMS.');
    return true;
  }
  reply(`SOS armed. Sending your live location to ${num} in 8 seconds. Say "cancel SOS" to abort.`);
  D.buzz();
  clearTimeout(state.sosTimer);
  state.sosTimer = setTimeout(async () => {
    state.sosTimer = null;
    let loc = null;
    try { loc = await API.getPosition(9000); } catch (e) {}
    const link = loc ? `https://maps.google.com/?q=${loc.lat.toFixed(5)},${loc.lon.toFixed(5)}` : '(location unavailable - GPS refused)';
    const msg = `SOS from ${S.getSetting('userName') || 'me'} - I need help. My location: ${link} (sent by FRIDAY OS)`;
    const r = NAT.isNative() ? await NAT.sendSMSSilent(num, msg) : { ok: false };
    reply(r && r.ok ? `SOS sent to ${num}. Stay strong, ${S.getSetting('userName') || 'Boss'} - help knows where you are.`
                   : `SMS failed (${(r && r.reason) || 'no native SMS'}). Say "call ${num}" to dial them directly.`,
          { source: 'live' });
  }, 8000);
  return true;
}

/* ---- A7 parked car ---- */
async function doCarSave() {
  reply('Marking this spot...');
  try {
    const p = await API.getPosition(9000);
    S.setSetting('parkedCar', JSON.stringify({ lat: p.lat, lng: p.lon, at: Date.now() }));
    reply('Parking spot locked in. Say "where is my car" when you need it.');
  } catch (e) { reply('GPS refused - allow location for FRIDAY and try again.'); }
  return true;
}

function doCarFind() {
  let p = null;
  try { p = JSON.parse(S.getSetting('parkedCar') || 'null'); } catch (e) {}
  if (!p) { reply('No parking spot saved. When you park, just tell me "parked here".'); return true; }
  const url = `https://maps.google.com/?q=${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  addMsg('ai', `Your car is parked here (saved ${fmtAgo(p.at)}). Tap below to navigate.`, { link: url });
  S.remember('ai', 'Car location shared.');
  V.speak('Opening your car location on the map.');
  if (NAT.isNative()) NAT.openUrl(url); else window.open(url, '_blank');
  return true;
}

/* ---- A8 sleep timer ---- */
function doSleepTimer(minutes) {
  clearTimeout(state.sleepTimer);
  state.sleepTimer = setTimeout(async () => {
    state.sleepTimer = null;
    const r = NAT.isNative() ? await NAT.mediaControl('pause') : { ok: false };
    const done = `Sleep timer done - music ${r && r.ok ? 'paused' : 'off'}. Good night, ${S.getSetting('userName') || 'Boss'}.`;
    addMsg('ai', done, { proactive: true });
    V.speak(done);
  }, minutes * 60000);
  reply(`Sleep timer set - music stops in ${minutes} minutes. Keep my background service on so I can reach the keys.`);
  return true;
}

/* ---- A9 read page aloud ---- */
async function doReadPage(url) {
  if (!url) { reply('Give me the link - say "read https://..." or share the page to me (Share → FRIDAY OS).'); return true; }
  reply('Fetching the page and reading. One moment.');
  const r = await API.fetchReadableUrl(url);
  if (!r.ok) { reply('Could not read that page (' + r.reason + '). Some sites block extraction - try another link.'); return true; }
  addMsg('ai', `**${r.title || 'Article'}**\n${r.text.slice(0, 550).trim()}…`, { link: url });
  const feed = V.createSpeechFeed({
    onStart: () => state.speaking = true,
    onDone: () => { state.speaking = false; continueConvoAfterSpeech('article done'); }
  });
  if (r.title) feed.push(r.title);
  const body = r.text.slice(0, 4500);
  const sents = body.match(/[^.!?]+[.!?]+/g) || [body];
  sents.forEach(s => feed.push(s));
  feed.markDone();
  return true;
}

/* ---- A10 watchers ---- */
async function doWatchAdd(needle, app) {
  if (!NAT.isNative()) { reply(nativeOnly('watchers')); return true; }
  if (!needle) { reply('Watch for what? Say "watch whatsapp for mummy" or "ping me when delivery OTP comes".'); return true; }
  state.watchers = state.watchers || [];
  if (state.watchers.length >= 3) { reply('Three watchers max. Say "stop watching" to clear them.'); return true; }
  state.watchers.push({ needle: needle.toLowerCase(), app: (app || '').toLowerCase(), since: Date.now(), until: Date.now() + 2 * 3600e3 });
  startWatchLoop();
  reply(`Watcher set. The moment "${needle}" appears${app ? ' in ' + app : ' on screen'} I alert you - two hour window. Keep my background service on.`);
  return true;
}

function startWatchLoop() {
  if (state.watchLoop) return;
  state.watchLoop = setInterval(async () => {
    if (!state.watchers || !state.watchers.length) { clearInterval(state.watchLoop); state.watchLoop = null; return; }
    const now = Date.now();
    for (const w of [...state.watchers]) {
      if (now > w.until) { state.watchers = state.watchers.filter(x => x !== w); continue; }
      try {
        let hitText = '';
        if (w.app) {
          const r = await NAT.getNotifLog(w.app, 6);
          const items = (r && r.items) || [];
          const hit = items.find(n => n.when > w.since - 3000 && (n.title + ' ' + n.text).toLowerCase().includes(w.needle));
          if (hit) hitText = `${hit.title}: ${(hit.text || '').slice(0, 120)}`;
        } else {
          const r = await NAT.readScreenText();
          if (r && r.ok && r.text && String(r.text).toLowerCase().includes(w.needle)) hitText = 'It is on your screen right now.';
        }
        if (hitText) {
          state.watchers = state.watchers.filter(x => x !== w);
          D.buzz();
          const msg = `Watcher hit - "${w.needle}": ${hitText}`;
          addMsg('ai', msg, { proactive: true, source: 'live' });
          D.notify('FRIDAY watcher', msg, 'watch-' + w.needle.slice(0, 12));
          V.speak(`Boss, watcher alert. ${hitText}`);
        }
      } catch (e) {}
    }
  }, 15000);
}

/* ---- A6 dictation finish: raw speech -> clean draft in the input box ---- */
async function doDictateFinish(raw) {
  let clean = stripFillers(raw);
  if (AI.hasGroq() && navigator.onLine) {
    try {
      const out = await AI.callGroq([
        { role: 'system', content: 'Rewrite this voice-dictated message: remove filler words and stammers, fix grammar lightly, keep the meaning and the Hindi-English mix EXACTLY as spoken. Output ONLY the rewritten message - no quotes, no commentary.' },
        { role: 'user', content: raw.slice(0, 1200) }
      ], { maxTokens: 400, temperature: 0.3 });
      if (out) clean = out;
    } catch (e) {}
  }
  const inp = $('#textInput');
  if (inp) { inp.value = clean; inp.focus(); }
  addMsg('ai', `Clean draft is in your input box:\n"${clean}"\nEdit it there, or say "send to <name>" to fire it.`);
  V.speak('Draft ready. Edit above, or say send to someone.');
}

/* ---- A2 share inbox: anything shared to FRIDAY answers instantly ---- */
async function doSummarizeShared(url, text) {
  thinking(true);
  let body = text;
  if (url) {
    const r = await API.fetchReadableUrl(url);
    body = r.ok ? ((r.title ? r.title + '\n' : '') + r.text.slice(0, 3500)) : text;
  }
  thinking(false);
  if (AI.hasGroq()) {
    try {
      const out = await AI.callGroq([
        { role: 'system', content: 'This content was just shared to FRIDAY (a personal AI). Summarize what it is in 2-4 plain spoken sentences for the user. No bullets, no headers.' },
        { role: 'user', content: String(body).slice(0, 3500) }
      ], { maxTokens: 220 });
      if (out) { reply(out, { source: 'live' }); return; }
    } catch (e) {}
  }
  reply('Received it: ' + String(body).slice(0, 280).trim() + (String(body).length > 280 ? '…' : ''));
}

async function checkShareInbox() {
  if (!NAT.isNative()) return;
  let r;
  try { r = await NAT.getSharedContent(); } catch (e) { return; }
  if (!r || !r.ok) return;
  const text = (r.text || '').trim();
  const img = r.imageBase64;
  if (!text && !img) return;
  if (img) {
    const mime = r.mime || 'image/jpeg';
    const dataUrl = 'data:' + mime + ';base64,' + img;
    state.sharedImage = { dataUrl, mime, b64: img, at: Date.now() };   // v14.1: keep for send/save
    addMsg('user', 'Shared an image with you.', { image: dataUrl });
    const v = await AI.callGroqVision(dataUrl, text || 'Describe this shared image').catch(() => null);
    if (v && v.ok && v.text) {
      reply(v.text, { source: 'live' });
    } else {
      reply('Photo mil gayi. ' + ((v && v.reason) || 'Vision unavailable') + ' — but I can send it or save it for you. 👇', { source: 'live' });
    }
    offerImageActions(dataUrl, mime);
    return;
  }
  const urlM = text.match(/https?:\/\/\S+/);
  addMsg('user', urlM ? 'Shared a link: ' + urlM[0] : 'Shared text: ' + text.slice(0, 200));
  if (urlM) doSummarizeShared(urlM[0], text);
  else doSummarizeShared(null, text);
}

/* v14.1: tappable actions for any photo — WhatsApp-send, save to gallery,
   re-describe. Rendered as chips right under the image bubble. */
function offerImageActions(dataUrl, mime) {
  const box = $('#chatMessages');
  if (!box) return;
  const row = document.createElement('div');
  row.className = 'clarify-chips img-actions';
  const mk = (label, say) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'clarify-chip'; b.textContent = label;
    b.addEventListener('click', () => { row.remove(); handleInput(say, { noChain: true }); });
    row.appendChild(b);
  };
  mk('📤 Send on WhatsApp', 'send this photo on whatsapp');
  mk('💾 Save photo', 'save this photo');
  mk('🔍 Describe again', 'describe this photo');
  box.appendChild(row);
  scrollBottom();
}

async function sendSharedImageTo(contactName, opts = {}) {
  const img = state.sharedImage;
  if (!img) { reply('Koi photo abhi share nahi hui — pehle photo share karo, phir bolo "send to <name>".'); return true; }
  const name = String(contactName || '').replace(/^(to|ko|for|se)\s+/i, '').trim();
  if (!name) { reply('Kisko bhejna hai? Bolo "send to <naam>" — jaise "send to papa".'); return true; }
  const c = await contactByName(name);
  if (!c || !c.phone) { reply(`"${name}" contacts me nahi mila. Pehle "my father's name is Ramesh" jaise bolo, ya contact save karo.`); return true; }
  if (!NAT.isNative()) { reply('Photo bhejna installed app me chalta hai (web build me WhatsApp kholke khud bhejo).'); return true; }
  thinking(true);
  const r = await NAT.sendImage(c.phone, img.b64, { caption: 'Sent by FRIDAY', mime: img.mime }).catch(() => null);
  thinking(false);
  if (r && r.ok) {
    reply(`WhatsApp khul gaya — **${c.name}** ke chat me photo attached hai. Send dabao. 📤`);
    V.speak(`WhatsApp open kar diya ${c.name} ke liye. Photo ready hai, bas send dabao.`);
  } else {
    reply('Photo WhatsApp me nahi khul payi (' + ((r && r.reason) || 'error') + '). WhatsApp installed hai?');
  }
  return true;
}

async function saveSharedImageTo() {
  const img = state.sharedImage;
  if (!img) { reply('Koi photo nahi hai save karne ke liye.'); return true; }
  if (!NAT.isNative()) { reply('Web build me photo save nahi kar sakti — long-press karke save karo.'); return true; }
  const r = await NAT.saveImage(img.b64, { mime: img.mime }).catch(() => null);
  reply(r && r.ok ? 'Photo gallery me save ho gayi — **Pictures/FRIDAY** 📸' : 'Photo save nahi hui (' + ((r && r.reason) || 'error') + ').');
  return true;
}

async function contactByName(name) {
  const q = String(name || '').toLowerCase().trim();
  if (!q) return null;
  if (NAT.isNative()) { const h = await NAT.findContact(q); if (h) return h; }
  return S.getList(KEYS.CONTACTS).find(c => c.name.toLowerCase().includes(q)) || null;
}

const ACTIONISH = /\b(set|remind|alarm|wake|call|text|message|whatsapp|note|task|timer|weather|battery|time|schedule|notifications?|reminders?|steps?|screen|doing|working|status|location|wifi|charging|music|songs?|media|play|pause|game)\b/i;

/* v8.2: try the on-device llama.cpp brain for one full answer.
   Returns true when it produced (and rendered) a reply; false lets the
   caller fall through to the cloud path. Never throws. */
async function askLocalFirst(text) {
  thinking(true);
  state.llmBusy = true;
  try {
    /* Local mode has no tools: strip the tool instructions from the system
       prompt, then bolt on live telemetry - the private ideal case: the
       snapshot never leaves the phone. */
    const sysLocal = AI.systemPrompt().split('TRUST & ACCURACY')[0].trim() +
      '\nYou run fully on-device with no live tools in this mode. For actions (reminders, calls, messages) tell the user to keep cloud mode on or phrase it as a command. Never invent battery, notification or step counts.';
    const amb = await AMB.collectAmbient();
    const sys = sysLocal + (amb ? '\n\n' + amb : '');

    let el = null, acc = '';
    const r = await LB.askLocal(sys, text, {
      onToken: (_, sofar) => {
        acc = sofar;
        if (!el) { hideTyping(); el = addMsg('ai', '', { returnEl: true, source: 'on-device' }); }
        el.querySelector('.message-bubble').innerHTML = U.renderRich(sofar);
        scrollBottom();
      }
    });
    const final = (r.ok ? r.text : acc || '').trim();
    if (!final) {
      if (el) {
        el.remove();
        const rec = state.messages[state.messages.length - 1];
        if (rec && rec.role === 'ai') state.messages.pop();   // don't persist a blank bubble
        saveChat();
      }
      if (!state.llmHintShown) {
        state.llmHintShown = true;
        U.toast('On-device brain not ready (' + LB.friendlyReason(r.reason) + ') — using the other engines', '🧠');
      }
      return false;
    }
    if (el) {
      el.querySelector('.message-bubble').innerHTML = U.renderRich(final);
      const rec = state.messages[state.messages.length - 1];
      if (rec) { rec.text = final; saveChat(); }
    } else {
      addMsg('ai', final, { source: 'on-device' });
    }
    V.speak(final, { onStart: () => state.speaking = true, onEnd: () => { state.speaking = false; continueConvoAfterSpeech(final); } });
    S.remember('ai', final);
    armTalkWait(final);   // Karen loop works on-device too
    return true;
  } catch (e) {
    console.warn('[localbrain]', e.message || e);
    if (!state.llmHintShown) { state.llmHintShown = true; U.toast('On-device brain hiccup — using the other engines', '🧠'); }
    return false;
  } finally {
    state.llmBusy = false;
    thinking(false);
  }
}

async function askGroq(text) {
  /* v8.2 BRAIN: on-device llama.cpp answers first when the user enabled it
     and the message needs no tools. Falls through to cloud on any failure. */
  if (LB.wantLocal(text, ACTIONISH.test(text))) {
    const done = await askLocalFirst(text);
    if (done) return;
  }
  /* v10.1 FRIDAY Cloud: server brain first — no key in the app,
     server runs its own tools + memory and streams the answer. */
  if (SERVER.isConfigured() && S.getSetting('serverMode') !== false) return streamServerChat(text);
  thinking(true);
  const history = state.messages.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text
  }));
  const ctxBrief = MEM.buildContext({ maxFacts: 22, maxPatterns: 6 });
  const amb = await AMB.collectAmbient();   // v8.2: live telemetry in every cloud call
  /* v10.0 M1: recall memories by MEANING (on-device embeddings, local-only) */
  let semBlock = '';
  try {
    if ((S.getSetting('embedModelPath') || '').trim()) {
      const hits = await SEM.recallSemantic(text, 2, 0.55);
      if (hits.length) semBlock = '\n\nSEMANTIC MEMORY (recalled on-device by meaning):\n' + hits.map(h => '- ' + h.text).join('\n');
    }
  } catch (_) {}
  const sys = AI.systemPrompt() + (amb ? '\n\n' + amb : '') + (ctxBrief ? '\n\n' + ctxBrief : '') + semBlock + memexBrief(text) +
    '\nIf the user asks you to DO something (remind, alarm, call, message, note, weather...), use the appropriate tool. Confirm briefly afterward.';
  const msgs = [{ role: 'system', content: sys }, ...history, { role: 'user', content: text }];

  // streaming TTS: speech starts on the first complete sentence
  const useFeed = S.getSetting('streamingTts') !== false && S.getSetting('voiceOutput');
  const feed = useFeed ? V.createSpeechFeed({
    onStart: () => { state.speaking = true; },
    onDone: () => { state.speaking = false; continueConvoAfterSpeech(acc); }
  }) : null;
  let boundaryCursor = 0;
  const feedFrom = sofar => {
    if (!feed) return;
    let cut = -1;
    for (let i = boundaryCursor; i < sofar.length; i++) {
      if ('.!?\n'.includes(sofar[i])) cut = i + 1;
    }
    if (cut > boundaryCursor) { feed.push(sofar.slice(boundaryCursor, cut)); boundaryCursor = cut; }
  };

  let el = null, acc = '', toolsUsed = false;
  try {
    // --- pass 1: tool detection (only when the request looks actionable) ---
    if (ACTIONISH.test(text)) {
      try {
        const first = await AI.callGroqTools(msgs);
        if (first && Array.isArray(first.tool_calls) && first.tool_calls.length) {
          msgs.push({ role: 'assistant', content: first.content || '', tool_calls: first.tool_calls });
          for (const tc of first.tool_calls) {
            let out;
            try { out = await runToolByName(tc.function?.name, JSON.parse(tc.function?.arguments || '{}')); }
            catch (e) { out = 'Tool failed'; }
            toolsUsed = true;
            msgs.push({ role: 'tool', tool_call_id: tc.id, name: tc.function?.name, content: String(out) });
          }
        }
      } catch (toolErr) { console.warn('[agent] tool pass failed, continuing plain', toolErr.message); }
    }

    // --- pass 2: final answer, streamed ---
    const full = await AI.callGroq(msgs, {
      stream: true,
      maxTokens: 1500,
      onToken: (_, sofar) => {
        acc = sofar;
        if (!el) { hideTyping(); el = addMsg('ai', '', { returnEl: true, source: toolsUsed ? 'live' : 'mind' }); }
        el.querySelector('.message-bubble').innerHTML = U.renderRich(sofar);
        scrollBottom();
        feedFrom(sofar);
      }
    });
    thinking(false);
    const final = full || acc;
    if (feed) {
      if (boundaryCursor < final.length) feed.push(final.slice(boundaryCursor));
      feed.markDone();
    } else {
      V.speak(final, { onStart: () => state.speaking = true, onEnd: () => { state.speaking = false; continueConvoAfterSpeech(final); } });
    }
    if (el) {
      el.querySelector('.message-bubble').innerHTML = U.renderRich(final);
      const rec = state.messages[state.messages.length - 1];
      if (rec) { rec.text = final; saveChat(); }
    } else {
      addMsg('ai', final, { source: toolsUsed ? 'live' : 'mind' });
    }
    S.remember('ai', final);
    armTalkWait(final);   // v7.8: companion waits for your answer, re-asks gently
  } catch (e) {
    thinking(false);
    if (feed) feed.cancel();
    reply(errMsg(e));
  }
}

function errMsg(e) {
  const m = String(e.message || e);
  if (m.includes('SERVER_NO_KEY')) return 'FRIDAY Cloud is up, but it has no Groq key set on the server. Add GROQ_API_KEY to the server .env.';
  if (m.includes('SERVER_BAD_KEY')) return 'FRIDAY Cloud says its Groq key is wrong. Fix GROQ_API_KEY on the server.';
  if (m.includes('SERVER_RATE_LIMIT')) return 'FRIDAY Cloud is rate-limited. Wait a moment and try again.';
  if (m.includes('SERVER_HTTP')) return 'FRIDAY Cloud answered with an error — check the server URL and that it is running.';
  if (m.includes('SERVER_')) return 'FRIDAY Cloud error: ' + m.slice(0, 140);
  if (m.includes('BAD_KEY')) return 'The server-side Groq key was rejected. Rotate GROQ_API_KEY in backend/.env.';
  if (m.includes('RATE_LIMIT')) return 'Groq rate limit hit. Wait a moment, or switch to offline mode.';
  if (m.includes('NO_KEY')) return 'No key set. Running offline.';
  return 'Connection failed. Offline engine still works — try a command.';
}

/* ================= NATIVE (Phase B + C) ================= */
let recentNotifs = [];
let nativeCaps = { native: false };
let assistantSettingsRevision = 0;
let backgroundServiceRevision = 0;
let bootStartRevision = 0;
let callGuardDetailsRevision = 0;
let callGuardEnabledRevision = 0;

function nativeOnly(what) {
  return `${what.charAt(0).toUpperCase() + what.slice(1)} only works in the installed app, not the browser. Build the APK and it'll work.`;
}

/* ================= v7.3 GUARDIAN HELPERS ================= */

/* Tap something on screen with patience: apps take seconds to open. */
async function tapRetry(label, tries = 4, gapMs = 1100) {
  for (let i = 0; i < tries; i++) {
    const r = await NAT.tapText(label);
    if (r.ok) return true;
    if (r.reason === 'accessibility_off') return 'a11y_off';
    await sleep(gapMs);
  }
  return false;
}

/* "Where is my dad" — opens Google Maps and taps through to the person's
   shared location. Best-effort UI automation: Maps' layout changes, so on
   any miss we hand the user exact tap instructions instead of failing. */
async function findPersonOnMaps(a) {
  const name = a.name || null;
  const nameShort = name ? name.split(/\s+/)[0] : null;
  const stepsText = `your profile photo (top right) → "Location sharing"${nameShort ? ` → "${nameShort}"` : ' → their name'}`;

  if (!NAT.isNative()) {
    reply(`On your phone: open Google Maps → tap ${stepsText}.`);
    return true;
  }

  const caps = await NAT.capabilities();
  if (!caps.accessibility) {
    reply(`I can drive Maps for you — but I need my Accessibility service first. Opening settings: enable "FRIDAY Control", then ask me again. (Or do it by hand: Maps → ${stepsText}.)`);
    NAT.openSpecialSetting('accessibility');
    return true;
  }

  reply(`Opening Maps and looking for ${name || 'your ' + (a.rel || 'contact')}'s shared location. A few seconds — please don't touch the screen.`);

  const opened = await NAT.launchApp('maps');
  if (!opened.ok) {
    reply(`Couldn't open Google Maps — is it installed? Do it by hand: Maps → ${stepsText}.`);
    return true;
  }

  await sleep(3800);                                  // Maps cold start
  let step = await tapRetry('profile photo', 4, 1200);
  if (step === true) {
    await sleep(1500);
    step = await tapRetry('Location sharing');
  }
  if (step === true && nameShort) {
    await sleep(1900);
    step = await tapRetry(nameShort, 3, 1400);
    if (step === true) {
      reply(`That's ${name} — their shared location should be on the map now.`);
      return true;
    }
  }

  if (step === 'a11y_off') {
    reply('Accessibility switched off mid-way, so I had to stop. Enable "FRIDAY Control" and ask again.');
    return true;
  }
  if (step === true) {
    // reached the Location-sharing screen but no name known/found
    reply(nameShort
      ? `You're on the Location sharing screen. I couldn't spot "${nameShort}" — tap them if you see them. (Is ${name} sharing their location with your Google account?)`
      : `You're on the Location sharing screen — tap the person. Tip: teach me their name, e.g. "my father's name is Ramesh", and I'll tap straight to them next time.`);
    return true;
  }
  reply(`Maps fought back — layout changed. Finish by hand: tap ${stepsText}.`);
  return true;
}

/* Full device-hygiene audit, explained in plain language. */
async function runSecurityScan() {
  if (!NAT.isNative()) { reply(nativeOnly('the security scan')); return true; }
  addMsg('ai', '🛡️ Running a security scan — installed apps, device admins, listeners, developer options…');
  const a = await NAT.securityAudit();
  if (!a.ok) { reply('Scan failed — the native layer did not answer.'); return true; }

  const SELF = 'com.rishu.fridayos';
  const good = [], warn = [], danger = [];
  const splitPkgs = s => (String(s || '').match(/[a-z][a-z0-9_]*(\.[a-z0-9_]+)+(?=\/|:)/gi) || [])
    .filter(p => p !== SELF);

  // sideloaded apps
  const side = Array.isArray(a.sideloaded) ? a.sideloaded : [];
  if (!side.length) good.push('Every app came from the Play Store');
  side.slice(0, 6).forEach(x => danger.push(
    `"${x.name || x.pkg}" was installed outside the Play Store (via ${x.installer || 'unknown'}) — uninstall it if you don't fully trust it`));
  if (side.length > 6) danger.push(`…and ${side.length - 6} more sideloaded apps`);

  // device admins
  const admins = (Array.isArray(a.deviceAdmins) ? a.deviceAdmins : []).filter(p => p !== SELF);
  if (!admins.length) good.push('No app holds Device Admin power');
  admins.forEach(p => danger.push(`"${p}" holds **Device Admin** power — it can lock or wipe your phone. Review it under Settings → Security → Device admin apps`));

  // accessibility services
  const acc = splitPkgs(a.accessibilityServices);
  if (!acc.length) good.push('No other app can see/control your screen');
  acc.forEach(p => warn.push(`"${p}" has **Accessibility access** — it can read and tap everything on screen. Remove it unless you trust it completely`));

  // notification listeners
  const nls = splitPkgs(a.notifListeners);
  nls.forEach(p => warn.push(`"${p}" can **read all your notifications** (OTP codes included). Disable if you didn't allow it on purpose`));

  // dev options
  if (a.adbEnabled) warn.push('**USB debugging is ON** — anyone with a cable can control this phone. Turn it off unless you are developing');
  if (a.devSettings && !a.adbEnabled) warn.push('Developer options are ON — consider turning them off');

  // lock screen
  if (a.lockScreenSet === false) danger.push('**No lock screen PIN/pattern is set** — anyone picking up your phone owns it. Set one now');

  const score = danger.length * 2 + warn.length;
  const verdict = score === 0
    ? 'Verdict: CLEAN. Your phone looks well protected.'
    : score <= 2
      ? 'Verdict: FAIR — a couple of things deserve your attention.'
      : 'Verdict: AT RISK — fix the flagged items, starting from the top.';

  const text = ['**Security report**', verdict, '']
    .concat(good.map(g => '✅ ' + g))
    .concat(warn.map(w => '⚠️ ' + w))
    .concat(danger.map(d => '🚨 ' + d))
    .join('\n');
  addMsg('ai', text);
  S.remember('ai', '[security scan] ' + verdict);
  V.speak(score === 0
    ? 'Security scan complete. Your phone is clean.'
    : `Security scan complete. ${danger.length} serious and ${warn.length} warning-level findings. Check the report.`,
    { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
  return true;
}

/* PIN gate: unlock/setup happens ONLY from typed digits (never via STT,
   so the PIN never lands in transcripts or the episode log). */
async function handleVaultPin(text) {
  const digits = String(text).trim();
  if (/^(cancel|never ?mind|stop)$/i.test(digits)) {
    state.vaultPending = null;
    reply('Vault closed. Nothing was saved or shown.');
    return;
  }
  if (!/^\d{4,8}$/.test(digits)) {
    state.expect = 'vault_pin';   // keep waiting
    reply('PIN must be 4-8 digits. Type only the numbers — or say "cancel".');
    return;
  }
  if (!VAULT.vaultExists()) {
    const r = await VAULT.vaultSetup(digits);
    if (!r.ok) { state.vaultPending = null; reply('Could not create the vault on this device.'); return; }
    reply('Vault created and PIN set. Locked to this phone only.');
  } else {
    const r = await VAULT.vaultUnlock(digits);
    if (!r.ok) {
      state.vaultPending = null;
      reply('Wrong PIN. Vault is still locked — issue your command again to retry.');
      return;
    }
    reply('Vault unlocked.');
  }
  finishVaultPending();
}

async function finishVaultPending() {
  const p = state.vaultPending;
  state.vaultPending = null;
  if (!p) return;
  if (p.kind === 'save') {
    const r = await VAULT.vaultSave(p.service, p.password);
    if (r.ok) {
      addMsg('ai', `🔐 Saved: **${p.service}** password is now in your encrypted vault.`);
      V.speak(`${p.service} password saved to your vault.`, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
    } else reply('Could not save that.');
    return;
  }
  if (p.kind === 'read') {
    const r = await VAULT.vaultRead(p.service);
    if (r.ok) {
      addMsg('ai', `🔓 **${p.service}** password: \`${r.password}\`\n\n(Shown once, on screen only — never spoken. Say "lock my vault" when done.)`);
    } else {
      const others = VAULT.vaultServices();
      reply(`Nothing saved for "${p.service}".${others.length ? ' You have: ' + others.join(', ') + '.' : ''}`);
    }
    return;
  }
  if (p.kind === 'forget') {
    const r = VAULT.vaultForget(p.service);
    reply(r.ok ? `Forgotten: "${p.service}" password is wiped from the vault.` : `Nothing saved for "${p.service}".`);
    return;
  }
  if (p.kind === 'list') {
    const svcs = VAULT.vaultServices();
    reply(svcs.length
      ? `Vault holds: ${svcs.join(', ')}.`
      : 'Vault is empty.');
    return;
  }
}

/* ================= v7.4 REDTEAM HELPERS ================= */

/* HaveIBeenPwned range check (k-anonymity). Only the FIRST 5 chars of the
   SHA-1 hash ever leave the phone — the password itself never does.
   This is the same technique real password managers use. */
async function breachCount(password) {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const res = await fetch('https://api.pwnedpasswords.com/range/' + hex.slice(0, 5));
    if (!res.ok) return null;
    const suffix = hex.slice(5);
    const rows = (await res.text()).split('\n');
    for (const row of rows) {
      const [suf, count] = row.split(':');
      if (suf && suf.trim() === suffix) return parseInt(count, 10) || 0;
    }
    return 0;
  } catch (_) { return null; }   // offline -> skip quietly
}

const speakShort = (text) => V.speak(text, {
  onStart: () => state.speaking = true,
  onEnd: () => state.speaking = false
});

async function auditPassword(pw) {
  if (!pw || pw.length < 2) { reply('Give me a fuller password to audit (it is never stored).'); return true; }
  const s = HACKER.entropyScore(pw);
  addMsg('ai', `🧪 **Password lab** — ${pw.length} chars\n` +
    `Verdict: **${s.grade}** (~${s.bits} bits of entropy)\n` +
    s.notes.map(n => '▸ ' + n).join('\n'));
  const bc = await breachCount(pw);
  if (bc === null) {
    addMsg('ai', '_Breach check skipped — offline. (Uses k-anonymity: only 5 hash-chars leave the phone, never the password.)_');
  } else if (bc > 0) {
    addMsg('ai', `🚨 **Seen ${bc.toLocaleString()} times in public breach dumps.** Treat this password as burned — change it everywhere it is used.`);
  } else {
    addMsg('ai', '✅ Not found in any public breach dump (k-anonymity check, HaveIBeenPwned).');
  }
  speakShort(`Password audit: ${s.grade}, about ${s.bits} bits.` +
    (bc > 0 ? ' Warning — it has leaked in data breaches.' : ''));
  return true;
}

function judgeLink(url) {
  const r = HACKER.phishScore(url);
  const icon = r.level === 'PHISHING' ? '🚨' : r.level === 'SUS' ? '⚠️'
             : r.level === 'CAUTION' ? '🟡' : '✅';
  addMsg('ai', `🎣 **Link verdict: ${r.level}** (risk ${r.score}/100)\n` +
    `\`${String(url).slice(0, 90)}\`\n` + r.flags.map(f => '▸ ' + f).join('\n') +
    (r.level === 'PHISHING' ? '\n\nVerdict says do NOT open it, and definitely do not type any password or OTP there.' : ''));
  speakShort(`Link check: ${r.level}. ${r.flags[0] || ''}`);
  return true;
}

async function scanSmsForPhishing() {
  if (!NAT.isNative()) { reply(nativeOnly('SMS scanning')); return true; }
  const res = await NAT.getRecentSMS(20);
  if (!res.ok) {
    reply(res.reason === 'no_permission'
      ? 'I need SMS read permission. Say "give permissions" first.'
      : 'Could not read messages.');
    return true;
  }
  const msgs = Array.isArray(res.messages) ? res.messages : [];
  const flagged = [];
  let checkedLinks = 0;
  msgs.forEach(m => {
    const links = String(m.body || '').match(/https?:\/\/[^\s)"]+|[a-z0-9-]+\.(?:tk|ml|ga|cf|gq|xyz|top|click|link)\b[^\s)"]*/gi) || [];
    links.forEach(l => {
      checkedLinks++;
      const r = HACKER.phishScore(l);
      if (r.score >= 20) flagged.push({ from: m.from || '?', url: l, ...r });
    });
  });
  flagged.sort((a, b) => b.score - a.score);
  if (!checkedLinks) {
    reply('Looked through your 20 latest messages — no links at all. Inbox looks clean.');
    return true;
  }
  if (!flagged.length) {
    reply(`Checked ${checkedLinks} link(s) in your last 20 messages — nothing phishy. ✅`);
    return true;
  }
  const lines = flagged.slice(0, 5).map(f =>
    `▸ **${f.level}** (${f.score}) from ${f.from}\n  \`${f.url.slice(0, 70)}\``);
  addMsg('ai', `🎣 **Smishing scan** — ${checkedLinks} links checked, ${flagged.length} suspicious:\n` +
    lines.join('\n') +
    `\n\nGolden rule: banks, IRCTC and delivery firms never ask for OTP/password over SMS links. When in doubt, ask me to check the link first.`);
  speakShort(`Smishing scan done. ${flagged.length} suspicious link${flagged.length > 1 ? 's' : ''} found — check the report.`);
  return true;
}

/* ---- v7.5 helpers ---- */
/* "medicine 8am 2pm 8pm" -> up-to-5 daily alarms */
function createMedAlarms(text) {
  const times = [];
  const rx = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/gi;
  let m;
  while ((m = rx.exec(text)) && times.length < 5) {
    let hh = parseInt(m[1], 10) % 12;
    if (m[3].toLowerCase() === 'pm') hh += 12;
    const mm = String(m[2] || '00').padStart(2, '0');
    times.push(String(hh).padStart(2, '0') + ':' + mm);
  }
  if (!times.length) { reply('No times heard - say like: "medicine 8am 2pm 8pm".'); return true; }
  for (const tm of times) AUTO.addAlarm({ time: tm, label: '💊 Medicine time', repeat: 'daily' });
  refresh('alarms');
  D.notifyPermission();
  reply(`💊 Medicine alarms set daily: ${times.join(', ')}. Health first, boss.`);
  return true;
}

/* finish the wifi QR after the user TYPES the password (used once, then forgotten) */
function finishWifiQr(pass) {
  const meta = state.wifiQr;
  state.wifiQr = null;
  if (!meta) return true;
  const raw = `WIFI:T:${meta.enc === 'open' ? 'nopass' : 'WPA'};S:${meta.ssid};P:${pass};;`;
  const url = 'https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=' + encodeURIComponent(raw);
  state.wifiQr = null;
  D.copy(url);
  reply(`📶 QR for **${meta.ssid}** is ready:\n${url}\n\nLink copied - open it in any browser and let people scan. Password used once and forgotten; nothing was stored.`);
  return true;
}

async function runNetRecon() {
  if (!NAT.isNative()) { reply(nativeOnly('network recon')); return true; }
  addMsg('ai', '🛰 Recon running — auditing WiFi security and sweeping your network (~15 seconds)…');
  const [audit, lan] = await Promise.all([NAT.wifiAudit(), NAT.lanScan()]);
  const hosts = (lan.ok && Array.isArray(lan.hosts)) ? lan.hosts : [];
  hosts.sort((x, y) => ((y.isGateway ? 1 : 0) - (x.isGateway ? 1 : 0))
    || x.ip.localeCompare(y.ip, undefined, { numeric: true }));
  addMsg('ai', HACKER.netReport(audit.ok ? audit : null, hosts));
  const unknown = hosts.filter(h => HACKER.vendorOf(h.mac) === 'unknown' && !h.isSelf && !h.isGateway).length;
  const weakWifi = audit.ok && /open|wep/.test(String(audit.security));

  if (lan.ok && lan.gateway) {
    addMsg('ai', `_Now probing the router (${lan.gateway}) for risky open ports…_`);
    const ps = await NAT.portScan(lan.gateway);
    if (ps.ok) {
      const opens = (Array.isArray(ps.open) ? ps.open : []).sort((x, y) => x - y);
      if (!opens.length) {
        addMsg('ai', `✅ Router (${lan.gateway}) exposes nothing. Tight ship.`);
      } else {
        addMsg('ai', `**Open ports on ${lan.gateway}:**\n` + opens.map(p => {
          const d = HACKER.describePort(p);
          const ic = d.risk === 'crit' ? '🚨' : d.risk === 'high' ? '🔥' : d.risk === 'warn' ? '⚠️' : 'ℹ️';
          return `${ic} **${p}** ${d.name}${d.why ? ' — ' + d.why : ''}`;
        }).join('\n') + `\nSay "scan ports on 192.168.x.x" to check any device.`);
      }
    }
  }
  speakShort(`Recon complete — ${hosts.length} devices online` +
    (unknown ? `, ${unknown} I don't recognize.` : '.') +
    (weakWifi ? ' Warning: your WiFi encryption is weak.' : ''));
  return true;
}

async function runPortScan(host) {
  if (!NAT.isNative()) { reply(nativeOnly('port scanning')); return true; }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(host || ''))) {
    reply('Give me an IP on your own network, e.g. "scan ports on 192.168.1.5".');
    return true;
  }
  addMsg('ai', `🎯 Scanning ${host} — 23 ports that matter…`);
  const ps = await NAT.portScan(host);
  if (!ps.ok) { reply('Scan failed — host unreachable or scan blocked.'); return true; }
  const opens = (Array.isArray(ps.open) ? ps.open : []).sort((x, y) => x - y);
  if (!opens.length) {
    reply(`✅ ${host} answers on none of the 23 common ports. Either quiet or well-locked.`);
    return true;
  }
  const crit = opens.filter(p => ['crit', 'high'].includes(HACKER.describePort(p).risk));
  addMsg('ai', `**${host}** — ${opens.length} open:\n` + opens.map(p => {
    const d = HACKER.describePort(p);
    const ic = d.risk === 'crit' ? '🚨' : d.risk === 'high' ? '🔥' : d.risk === 'warn' ? '⚠️' : 'ℹ️';
    return `${ic} **${p}** ${d.name}${d.why ? ' — ' + d.why : ''}`;
  }).join('\n') + (crit.length ? `\n\n⚠ ${crit.length} of those are attack targets. Close them unless you know exactly why they're open.` : ''));
  speakShort(`${host} has ${opens.length} open ports${crit.length ? `, ${crit.length} risky` : ''}.`);
  return true;
}

function minuteOfDay(value, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!m) return fallback;
  return Math.max(0, Math.min(1439, (+m[1] * 60) + +m[2]));
}

async function syncAssistantNative() {
  if (!NAT.isNative()) return { ok: false, reason: 'web' };
  return NAT.configureAssistant({
    enabled: !!S.getSetting('proactiveAssistant'),
    notificationsEnabled: S.getSetting('announceNotifications') !== false,
    privateMode: !!S.getSetting('proactivePrivateMode'),
    privateOnLock: S.getSetting('privateOnLock') !== false,
    quietEnabled: S.getSetting('quietHoursEnabled') !== false,
    quietStart: minuteOfDay(S.getSetting('quietHoursStart'), 22 * 60),
    quietEnd: minuteOfDay(S.getSetting('quietHoursEnd'), 7 * 60),
    categories: (S.getSetting('notificationCategories') || []).join(','),
    blockedPackages: S.getSetting('notificationBlockedApps') || '',
    blockedContacts: S.getSetting('notificationBlockedContacts') || '',
    rateLimitSeconds: Math.max(5, +(S.getSetting('notificationRateSeconds') || 20)),
    maxPerHour: Math.max(1, +(S.getSetting('notificationMaxPerHour') || 12)),
    address: S.getSetting('assistantAddress') || 'Boss',
    callAnnouncements: S.getSetting('callAnnouncements') !== false
  });
}

async function reconcileAssistantState(statusSnapshot = null) {
  const status = statusSnapshot || await NAT.getAssistantStatus();
  let firedReminder = null;
  if (status && Array.isArray(status.reminders)) {
    for (const native of status.reminders) {
      const local = S.getList(KEYS.REMINDERS).find(r => String(r.id) === String(native.id));
      if (!local) continue;
      if (native.state === 'done' && !local.done) S.updateItem(KEYS.REMINDERS, local.id, { done: true });
      if (native.state === 'scheduled' && native.dueAt && native.dueAt !== local.due)
        S.updateItem(KEYS.REMINDERS, local.id, { due: native.dueAt, done: false });
      if (native.state === 'fired' && !local.done) firedReminder = local;
    }
    refresh('reminders');
  }
  const pending = await NAT.consumeAssistantEvent();
  const event = pending && pending.event;
  if (event && String(event.key || '').startsWith('reminder:')) {
    const id = String(event.key).slice('reminder:'.length);
    const local = S.getList(KEYS.REMINDERS).find(r => String(r.id) === id);
    state.proactiveReminder = local || { id, text: event.text || 'Reminder' };
    firedReminder = null;
    addMsg('ai', `⏰ **Reminder** — ${event.text || ''}\nMark done, snooze, or reschedule?`, { proactive: true });
  } else if (event) {
    handleNotification({ ...event, nativeAnnounced: true, time: event.at || Date.now() });
  }
  if (firedReminder) {
    state.proactiveReminder = firedReminder;
    addMsg('ai', `⏰ **Reminder** — ${firedReminder.text}\nMark done, snooze, or reschedule?`, { proactive: true });
  }
}

async function initNative() {
  try {
  window.__stage = 'native:capabilities';
  nativeCaps = await NAT.capabilities();
  if (!nativeCaps.native) return;
  /* Native Pause/Private actions are durable and must win over stale WebView state. */
  const assistantSnapshot = await NAT.getAssistantStatus().catch(() => null);
  if (assistantSnapshot && typeof assistantSnapshot.enabled === 'boolean')
    S.setSetting('proactiveAssistant', assistantSnapshot.enabled);
  if (assistantSnapshot && typeof assistantSnapshot.privateMode === 'boolean')
    S.setSetting('proactivePrivateMode', assistantSnapshot.privateMode);
  syncSettingsUI();
  const assistantConfigured = await syncAssistantNative();
  if (!assistantConfigured || !assistantConfigured.ok) {
    U.toast('FRIDAY could not persist the native Always-On settings; background claims are withheld.', '⚠️', 5600);
  }

  // v7.4.3: ask for the mic (etc.) ONCE, so the first mic tap never errors
  try {
    window.__stage = 'native:ask-permissions';
    if (!S.getSetting('permsAsked')) {
      const mic = await NAT.checkPermission('android.permission.RECORD_AUDIO');
      if (!mic || !mic.granted) await NAT.requestAll();
      S.setSetting('permsAsked', true);
    }
  } catch (e) { /* system dialog may not show yet - first mic tap asks again */ }

  // Explicitly enabled always-on host. Event receivers remain independently durable.
  if (S.getSetting('backgroundService') !== false && S.getSetting('proactiveAssistant')) {
    if (!assistantConfigured || !assistantConfigured.ok) {
      S.setSetting('backgroundService', false);
      syncSettingsUI();
    } else {
      window.__stage = 'native:foreground-service';
      const started = await NAT.startForegroundService({ wakeWord: S.getSetting('wakeWord') });
      if (!started || !started.ok) {
        S.setSetting('backgroundService', false);
        syncSettingsUI();
        U.toast(`Android did not keep the always-on host running: ${(started && started.reason) || 'not running'}`, '⚠️', 5600);
      }
    }
  }
  if (S.getSetting('bootStart')) {
    const bootSaved = await NAT.setBootStart(true);
    if (!bootSaved || !bootSaved.ok) {
      S.setSetting('bootStart', false);
      syncSettingsUI();
      U.toast('FRIDAY could not persist reboot start, so the setting was turned off.', '⚠️', 5200);
    }
  }

  // pull real contacts into the local store
  try {
    if (nativeCaps.contacts) {
      window.__stage = 'native:contacts';
      const list = await NAT.loadContacts();
      if (list && list.length) {
        S.saveList(KEYS.CONTACTS, list.slice(0, 500).map(c => ({
          id: 'sys_' + c.id, name: c.name, phone: c.phone, created: Date.now()
        })));
        refresh('contacts');
      }
    }
  } catch (e) { /* contacts permission denied - not fatal */ }

  // notification listener
  try {
    if (nativeCaps.notifications) {
      window.__stage = 'native:notifications';
      NAT.startNotificationListener();
      NAT.onNotification(handleNotification);
    }
  } catch (e) { /* listener not enabled - not fatal */ }
  await reconcileAssistantState(assistantSnapshot).catch(() => {});
  // ---- v7.5 health wiring (all optional, all degrade silently) ----
  try {
    if (S.getSetting('stepsAuto') !== false) HEALTH.ensureSteps();
    HEALTH.startBatteryGuard(msg => { if (!state.speaking) V.speak(msg); });
    HEALTH.onPocketAlarm(() => {
      addMsg('ai', '🚨 **Pocket guard triggered!** Your phone is moving. Say "pocket mode off" to disarm.', { proactive: true });
    });
  } catch (e) {}
  window.__stage = 'native:done';
  } catch (e) {
    window.__stage = 'native:failed';
    console.warn('initNative failed:', e);
  }

  updateBrainBadge();
  renderCaps();
  renderCoder();

  // native geofences: hardware-level, fires with app closed
  NAT.geofenceSync(AUTO.geofences());
  NAT.onGeofence(async ev => {
    const g = AUTO.geofences().find(x => x.name === ev.name);
    addMsg('ai', `📍 ${ev.transition === 'exit' ? 'Left' : 'Arrived at'} **${ev.name}**.`, { proactive: true });
    if (g) {
      if (ev.transition === 'enter' && g.onEnter) await AUTO.runNamed(g.onEnter);
      if (ev.transition === 'exit' && g.onExit) await AUTO.runNamed(g.onExit);
    }
  });

  // launched via the Quick Settings tile -> start listening
  const tile = await NAT.consumeTileRequest();
  if (tile && tile.listen) setTimeout(() => V.listen(), 2000);

  // security guard: a non-Play-Store app just got installed on the device
  NAT.onSecurityAlert(ev => {
    const label = ev.label || ev.pkg || 'An app';
    addMsg('ai',
      `🛡️ **Security alert:** "${label}" was just installed **outside the Play Store** (via ${ev.source || 'unknown'}). ` +
      `If that wasn't you, uninstall it now — or ask me to "scan my phone" for the full picture.`,
      { proactive: true });
    V.speak('Security alert. A new app was installed outside the Play Store.',
      { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
  });

  syncWidget();
}

/* ============ HOME-SCREEN WIDGET SYNC ============ */
function syncWidget() {
  if (!NAT.isNative()) return;
  const rem = S.getList(KEYS.REMINDERS).filter(r => !r.done && r.due > Date.now()).sort((a, b) => a.due - b.due)[0];
  const al = AUTO.alarms().filter(x => x.enabled).sort((a, b) => AUTO.nextOccurrence(a) - AUTO.nextOccurrence(b))[0];
  let text = 'All clear. Say "Hey Friday".';
  if (rem) text = 'Next: ' + rem.text;
  else if (al) text = 'Alarm: ' + AUTO.describeAlarm(al);
  const meta = rem ? humanTime(new Date(rem.due)) : (al ? al.time : '');
  NAT.updateWidget(text, meta);
}

function handleNotification(n) {
  recentNotifs.unshift(n);
  recentNotifs = recentNotifs.slice(0, 40);
  if (HEALTH.inFocus()) return;   // focus mode: collect silently

  const settings = {
    proactiveAssistant: S.getSetting('proactiveAssistant'),
    announceNotifications: S.getSetting('announceNotifications'),
    notificationCategories: S.getSetting('notificationCategories'),
    notificationBlockedApps: S.getSetting('notificationBlockedApps'),
    notificationBlockedContacts: S.getSetting('notificationBlockedContacts'),
    privateMode: S.getSetting('proactivePrivateMode'),
    privateOnLock: S.getSetting('privateOnLock'),
    quietHoursEnabled: S.getSetting('quietHoursEnabled'),
    quietHoursStart: S.getSetting('quietHoursStart'), quietHoursEnd: S.getSetting('quietHoursEnd')
  };
  const decision = PROACTIVE.notificationDecision(n, settings);
  /* In the APK, native policy owns DND, importance, dedupe and rate limits.
     Never let the visible WebView re-announce an event native deliberately filtered. */
  if ((NAT.isNative() && n.nativeAnnounced === false) || (!decision.announce && !n.nativeAnnounced)) return;

  const app = NAT.friendlyApp(n.pkg);
  const event = {
    ...n, app, category: decision.category, sensitive: decision.sensitive,
    canReveal: decision.canReveal, expiresAt: Date.now() + 90_000
  };
  state.proactiveEvent = event;
  const hidden = !decision.canReveal;
  addMsg('ai', `🔔 **${app}** — ${hidden ? 'Private update' : (n.title || '')}\n${hidden ? '_Details protected by your privacy settings._' : (n.text || '_No readable content exposed._')}`, { proactive: true });
  const prompt = PROACTIVE.promptFor(event, {
    address: S.getSetting('assistantAddress') || 'Boss', canReveal: decision.canReveal
  });
  if (!n.nativeAnnounced && !state.listening && !state.speaking) {
    V.speak(prompt, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
  }
  D.vibrate(25);
}

/* ---- Setup wizard: walks through every special permission ---- */
async function runSetup() {
  if (!NAT.isNative()) {
    reply('Setup only applies to the installed app. In the browser everything that can work already does.');
    return;
  }
  reply('Running setup. I\'ll ask for each permission one at a time.');
  await NAT.requestAll();
  await sleep(1200);

  const steps = [
    ['notification_listener', 'notification access', 'so I can classify important notifications and expose reply actions'],
    ['exact_alarm', 'alarms and reminders', 'so durable reminders fire at the requested time'],
    ['overlay', 'display over other apps', 'for call controls and the floating bubble'],
    ['accessibility', 'accessibility', 'so I can navigate your phone'],
    ['battery_optimization', 'battery optimisation', 'so I keep running in the background']
  ];

  for (const [kind, label, why] of steps) {
    const has = await NAT.hasSpecialPermission(kind);
    if (has.granted) continue;
    reply(`Opening ${label} - enable FRIDAY there ${why}.`);
    await NAT.openSpecialSetting(kind);
    await sleep(2500);
  }

  nativeCaps = await NAT.capabilities();
  const on = Object.entries(nativeCaps).filter(([k, v]) => v === true && k !== 'native').length;
  reply(`Setup complete. ${on} capabilities active. Say "what can you do" anytime.`);
  await initNative();
}

/* ================= AUTOMATION EXECUTOR ================= */
/* Runs one action from a routine or alarm. Everything happens in the
   background \u2014 the user never opens a tool panel. */
async function execAction(a) {
  switch (a.do) {
    case 'alarm': {
      D.buzz();
      await D.notify('FRIDAY \u2014 Alarm', a.label || 'Alarm', 'alarm-' + a.time);
      U.toast(`${a.label} \u2014 ${a.time}`, '\u23f0', 7000);
      addMsg('ai', `\u23f0 **${a.label}** \u2014 it's ${a.time}.`, { proactive: true });
      V.speak(`${a.label}. It's ${a.time}.`);
      refresh('alarms');
      break;
    }
    case 'say':      reply(a.text); break;
    case 'weather':  await doWeather(false); break;
    case 'aqi':      await doAQI(); break;
    case 'news':     await doNews(); break;
    case 'briefing': await doBriefing(); break;
    case 'time':     reply(`It's ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`); break;
    case 'contact_lookup': {
      const hit = await NAT.findContact(a.name);
      if (hit) {
        if (a.mode === 'call') return runAction({ type: 'call', number: hit.phone, name: hit.name }, {});
        if (a.mode === 'sms') return runAction({ type: 'sms', number: hit.phone, body: a.body, name: hit.name }, {});
      }
      reply(`I couldn't find "${a.name}" in your contacts.`);
      return true;
    }

    case 'battery': {
      const b = await D.battery();
      reply(b ? `Power at ${b.level}%${b.charging ? ', charging' : ''}.` : 'Battery info unavailable.');
      break;
    }
    case 'torch':    await D.torch(a.on !== false); break;
    case 'reminders_today': {
      const today = new Date(); today.setHours(23, 59, 59, 999);
      const rs = S.getList(KEYS.REMINDERS).filter(r => !r.done && r.due <= today.getTime() && r.due > Date.now());
      reply(rs.length ? `Today: ` + rs.map(r => r.text).join(', ') : 'Nothing else scheduled today.');
      break;
    }
    case 'tasks_today': {
      const ts = S.getList(KEYS.TASKS).filter(t => !t.done);
      reply(ts.length ? `${ts.length} open task${ts.length === 1 ? '' : 's'}: ` + ts.slice(0, 5).map(t => t.text).join(', ') : 'No open tasks.');
      break;
    }
    case 'summary_tomorrow': {
      const tm = new Date(); tm.setDate(tm.getDate() + 1); tm.setHours(23, 59, 59, 999);
      const rs = S.getList(KEYS.REMINDERS).filter(r => !r.done && r.due <= tm.getTime());
      const al = AUTO.alarms().filter(x => x.enabled);
      const bits = [];
      if (al.length) bits.push(`${al.length} alarm${al.length === 1 ? '' : 's'} set`);
      if (rs.length) bits.push(`${rs.length} reminder${rs.length === 1 ? '' : 's'} due`);
      reply(bits.length ? 'For tomorrow: ' + bits.join(' and ') + '.' : 'Nothing scheduled for tomorrow.');
      break;
    }
    default: console.warn('[exec] unknown action', a);
  }
}

/* ================= PROACTIVE ================= */
let lastSeenPrev = null;

async function runProactive() {
  if (state.listening || state.speaking || state.processing) return;
  const ctx = { hasGroq: AI.hasGroq(), lastSeen: lastSeenPrev };
  try {
    const loc = await API.resolveLocation();
    ctx.weather = await API.getWeather(loc.lat, loc.lon).catch(() => null);
    ctx.aqi = await API.getAQI(loc.lat, loc.lon).catch(() => null);
  } catch (_) {}
  ctx.battery = await D.battery();
  if (ctx.battery) {
    if (ctx.battery.level <= 15 && !ctx.battery.charging) AUTO.runTrigger('battery_low', { level: ctx.battery.level });
    if (ctx.battery.charging) AUTO.runTrigger('charging');
  }
  try {
    if (S.getSetting('locationAccess')) {
      const pos = await API.getPosition(6000);
      await AUTO.checkGeofences(pos);
    }
  } catch (_) {}

  const s = PRO.suggest(ctx);
  if (!s) return;
  addMsg('ai', s.text, { proactive: true });
  V.speak(s.text, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
  if (s.action) runAction(s.action, {});
  D.vibrate(20);
}

/* ================= MESSAGES ================= */
/* v7.8 PERSONA (Karen behavior): when FRIDAY asks a question she WAITS for the
   answer, and if silence stretches she gently asks once more - like a person. */
const TALK_NUDGES = [
  'Boss? You went quiet on me. Take your time - I am still listening.',
  'Still with me? No rush.',
  'Hello? Suit still on? I am right here when you are ready.'
];
/* v8.3 CONTINUOUS CONVERSATION: a normal AI doesn't die after one answer.
   When the last input came from the mic, FRIDAY re-opens her ears after every
   spoken reply - a real back-and-forth until you fall silent. One unheard
   cycle (no-speech) ends the chain quietly. Questions are excluded here
   because armTalkWait already re-arms for them (and covers typed flows too). */
function chainMic() {
  if (!NAT.isNative() || S.getSetting('handsFree') === false || !S.getSetting('voiceOutput') || S.getSetting('wakeWord')) return;
  if (!state.lastInputWasVoice) return;
  if ((state.autoListens || 0) >= 12) return;          // burst cap, safety
  state.autoListens = (state.autoListens || 0) + 1;
  state.chainListen = true;                            // lets onError stay silent on no-speech
  waitForQuietThenListen();
}

function continueConvoAfterSpeech(text) {
  if (/\?\s*$/.test(String(text || '').trim())) return;   // armTalkWait owns questions
  chainMic();
}

/* v8.3: shared "open her ears" helper. The killer bug it fixes: the old code
   listened at a FIXED 1600 ms even while FRIDAY was still talking - listen()
   cancels speech, so her voice got CUT mid-sentence and the mic then captured
   the tail of her own voice. Now we wait for real silence first. */
function waitForQuietThenListen(maxWaitMs = 24000) {
  const t0 = Date.now();
  const tick = () => {
    if (Date.now() - t0 > maxWaitMs) { state.talkWait = null; return; }
    if (state.speaking || V.isSpeaking()) { state.talkWait = setTimeout(tick, 250); return; }
    state.talkWait = setTimeout(() => {
      state.talkWait = null;
      if (state.listening || state.speaking || V.isSpeaking() || state.processing || document.hidden) return;
      V.listen();
    }, 450);
  };
  tick();
}

function armTalkWait(questionText) {
  clearTimeout(state.talkWait);
  if (!/\?\s*$/.test(String(questionText || '').trim())) return;
  /* v8.0 hands-free: when she asks something, she opens her own ears for the
     answer - a real back-and-forth. (Skipped when a wake word guards the mic:
     then the wake phrase re-opens the conversation instead.) */
  const handsFree = S.getSetting('handsFree') !== false;
  if (handsFree && NAT.isNative() && S.getSetting('voiceOutput') && !S.getSetting('wakeWord')) {
    waitForQuietThenListen();
    return;
  }
  state.talkWait = setTimeout(() => {
    state.talkWait = null;
    if (state.listening || state.speaking || document.hidden) return;
    const nudge = pick(TALK_NUDGES);
    addMsg('ai', nudge, { proactive: true });
    if (S.getSetting('voiceOutput')) {
      V.speak(nudge, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
    }
  }, 42000);
}

function reply(text, opts = {}) {
  if (state.tonePrefix) { text = state.tonePrefix + ' ' + text; state.tonePrefix = null; }
  addMsg('ai', text, opts);
  S.remember('ai', text);
  V.speak(text, {
    onStart: () => state.speaking = true,
    onEnd: () => { state.speaking = false; continueConvoAfterSpeech(text); }   // v8.3: keep the conversation alive
  });
  armTalkWait(text);
}

/* ---- v10.0 C1: clarifying questions with tappable quick-answer chips ---- */
function askClarify(question, options) {
  reply(question);
  if (options && options.length) addClarifyChips(options);
}

/* v11.2 VOX: when a dangerous command is parked for confirmation, show a
   live badge — "fake value kabhi nahi" means the pending state is VISIBLE. */
function Ui_confirmBadge() {
  const el = $('#voxState');
  if (el) { el.textContent = 'CONFIRM?'; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2200); }
  hudPush('🛡️', 'danger parked — confirm pending');
}

function addClarifyChips(options) {
  const box = $('#chatMessages');
  if (!box) return;
  const old = box.querySelector('.clarify-chips');
  if (old) old.remove();
  const row = document.createElement('div');
  row.className = 'clarify-chips';
  for (const opt of options.slice(0, 4)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'clarify-chip';
    b.textContent = opt.label;
    b.addEventListener('click', () => {
      row.remove();
      handleInput(opt.say, { fromVoice: false });
    });
    row.appendChild(b);
  }
  box.appendChild(row);
  scrollBottom();
}

function addMsg(role, text, opts = {}) {
  const msg = { role, text, time: Date.now() };
  state.messages.push(msg);
  saveChat();
  const el = buildMsgEl(msg, { ...opts, idx: state.messages.length - 1 });
  $('#chatMessages').appendChild(el);
  scrollBottom();
  updateCounters();
  return opts.returnEl ? el : null;
}

function buildMsgEl(msg, opts = {}) {
  const div = document.createElement('div');
  div.className = 'message ' + msg.role + (msg.pinned ? ' pinned' : '');
  const label = msg.role === 'user' ? 'You' : AI.persona().name;
  const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const link = opts.link ? `<a class="msg-link" href="${opts.link}" target="_blank" rel="noopener">Read more →</a>` : '';
  if (opts.proactive) div.classList.add('proactive');
  /* v8.0 Badge of Truth: shows whether an answer came from live phone data.
     v8.2: third state - generated entirely on-device by the local model. */
  const badge = opts.source === 'live' ? ' <span class="src-badge live" title="Built from LIVE on-device data">&#9889; live</span>'
              : opts.source === 'mind' ? ' <span class="src-badge mind" title="From general knowledge - not live phone data">&#128173; mind</span>'
              : opts.source === 'on-device' ? ' <span class="src-badge local" title="Generated 100% on this phone - no cloud, no key">&#129504; on-device</span>' : '';
  const img = opts.image ? `<img class="msg-image" src="${opts.image}" alt="shared or generated image">` : '';
  const idx = opts.idx != null ? opts.idx : '';
  /* v15 Phase 2: per-message actions — copy / pin / regenerate(AI) / delete */
  const actions = `<span class="msg-actions">
      <button type="button" class="msg-act" data-msg-copy="${idx}" title="Copy">⧉</button>
      <button type="button" class="msg-act" data-msg-pin="${idx}" title="${msg.pinned ? 'Unpin' : 'Pin'}">📌</button>
      ${msg.role === 'ai' ? `<button type="button" class="msg-act" data-msg-regen="${idx}" title="Regenerate">↻</button>` : ''}
      <button type="button" class="msg-act msg-del" data-msg-del="${idx}" title="Delete">✕</button>
    </span>`;
  div.innerHTML = `<div class="message-bubble">${img}${U.renderRich(msg.text)}${link}</div>
    <div class="message-meta"><span class="message-label">${label}${badge}</span><span>${time}</span>${actions}</div>`;
  return div;
}

/* Rebuild the whole chat list from state (used by delete/pin/regen/load). */
function renderChat() {
  const c = $('#chatMessages');
  if (!c) return;
  c.innerHTML = '';
  state.messages.forEach((m, i) => c.appendChild(buildMsgEl(m, { idx: i })));
  scrollBottom();
}

/* v15 Phase 2: stop an in-flight generation (AbortController on the stream). */
function stopGeneration() {
  if (state.abortCtl) { try { state.abortCtl.abort(); } catch (_) {} state.abortCtl = null; }
  state.llmBusy = false;
  hideTyping();
  thinking(false);
  const sb = $('#stopGenBtn'); if (sb) sb.remove();
  setStatus('Tap to speak');
}
function showStopBtn() {
  if ($('#stopGenBtn')) return;
  const wrap = $('#inputWrapper');
  if (!wrap) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'stopGenBtn'; b.className = 'stop-gen-btn'; b.textContent = '■ Stop';
  b.addEventListener('click', stopGeneration);
  wrap.insertBefore(b, $('#sendButton'));
}

function showTyping() {
  if ($('#typingIndicator')) return;
  const el = document.createElement('div');
  el.className = 'message ai';
  el.id = 'typingIndicator';
  el.innerHTML = `<div class="message-bubble"><div class="typing-indicator">
    <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
  $('#chatMessages').appendChild(el);
  scrollBottom();
}
function hideTyping() { $('#typingIndicator')?.remove(); }

function scrollBottom() {
  requestAnimationFrame(() => {
    const c = $('#chatMessages');
    if (c) c.scrollTop = c.scrollHeight;
  });
}

function saveChat() { S.saveList(KEYS.CHAT, state.messages.slice(-200)); }
function loadChat() {
  state.messages = S.getList(KEYS.CHAT);
  renderChat();
}

/* ================= REMINDERS ================= */
const timers = new Map();

/* stable numeric id for LocalNotifications (int32) */
function notifId(seed) {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = ((h * 31 + s.charCodeAt(i)) >>> 0);
  return (h % 2000000000) + 1;
}

/* Native schedule: fires even when the app is closed/killed (APK only). */
async function scheduleNativeReminder(item) {
  try {
    if (!NAT.isNative()) return false;
    let context = {
      actionType: item.actionType || '', target: item.target || item.phone || '', message: item.message || ''
    };
    if (item.wa) {
      const contact = await NAT.findContact(item.wa.name);
      context = { actionType: 'message', target: contact && contact.phone || '', message: item.wa.msg || '' };
    }
    const durable = await NAT.scheduleAssistantReminder(String(item.id), item.text, item.due, context);
    if (durable && durable.ok) return true;
    /* Backward-compatible fallback for an older APK shell. */
    const LN = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LN || !LN.schedule) return false;
    if (LN.requestPermissions) await LN.requestPermissions();
    await LN.schedule({ notifications: [{
      id: notifId(item.id), title: 'FRIDAY — Reminder', body: item.text,
      schedule: { at: new Date(item.due), allowWhileIdle: true }, smallIcon: 'ic_stat_icon'
    }]});
    return true;
  } catch (e) { console.warn('[reminders] native schedule failed', e); return false; }
}

function scheduleReminder(item) {
  if (NAT.isNative()) { scheduleNativeReminder(item); return; } // AlarmManager owns APK delivery
  const delay = item.due - Date.now();
  if (delay < 0 || delay > 2 ** 31 - 1) return;
  clearTimeout(timers.get(item.id));
  timers.set(item.id, setTimeout(() => {
    D.buzz();
    const body = item.wa ? `${item.text} — message draft for ${item.wa.name}` : item.text;
    D.notify('FRIDAY — Reminder', body, item.id);
    U.toast(body, '⏰', 6000);
    state.proactiveReminder = { ...item, expiresAt: Date.now() + 10 * 60_000 };
    V.speak(`${S.getSetting('assistantAddress') || 'Boss'}, reminder: ${body}. Mark it done, snooze it, or open Friday?`);
    refresh('reminders');
  }, delay));
}
function scheduleAllReminders() {
  S.getList(KEYS.REMINDERS).filter(r => !r.done && r.due > Date.now()).forEach(scheduleReminder);
}

/* ================= PANEL RENDERERS ================= */
function refresh(what) {
  if (what === 'alarms') { renderAlarms(); syncWidget(); }
  if (what === 'routines') renderRoutines();
  if (what === 'geofences') renderGeofences();
  if (what === 'activity') { renderAlarms(); renderRoutines(); renderGeofences(); renderRunLog(); renderFacts(); }
  if (what === 'notes') renderList(KEYS.NOTES, '#notesList', '#notesData', 'No notes yet');
  if (what === 'reminders') { renderReminders(); syncWidget(); }
  if (what === 'tasks') renderList(KEYS.TASKS, '#tasksList', null, 'No tasks');
  if (what === 'contacts') renderContacts();
  if (what === 'events') renderList(KEYS.EVENTS, '#eventsList', null, 'No events');
  updateCounters();
}
function refreshAll() { ['notes', 'reminders', 'tasks', 'contacts', 'events', 'activity'].forEach(refresh); }

function renderList(key, listSel, widgetSel, empty) {
  const items = S.getList(key);
  const list = $(listSel);
  if (list) {
    list.innerHTML = items.length ? items.map(i => `
      <div class="item-row" data-id="${i.id}">
        <div class="item-text">${U.escapeHtml(i.text)}</div>
        <div class="item-meta">${new Date(i.created).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
        <button class="item-del" data-del="${key}|${i.id}">✕</button>
      </div>`).join('') : U.emptyState(empty);
  }
  const w = widgetSel && $(widgetSel);
  if (w) w.innerHTML = items.length
    ? items.slice(0, 3).map(i => `<div class="w-line">• ${U.escapeHtml(i.text.slice(0, 40))}</div>`).join('')
    : `<span class="dim">${empty}</span>`;
}

function renderReminders() {
  const items = S.getList(KEYS.REMINDERS).sort((a, b) => a.due - b.due);
  const active = items.filter(r => !r.done);
  const list = $('#remindersList');
  if (list) {
    list.innerHTML = items.length ? items.map(r => `
      <div class="item-row ${r.done ? 'done' : ''}" data-id="${r.id}">
        <div class="item-text">${U.escapeHtml(r.text)}</div>
        <div class="item-meta">${r.done ? 'completed' : humanTime(new Date(r.due))}</div>
        <button class="item-del" data-del="${KEYS.REMINDERS}|${r.id}">✕</button>
      </div>`).join('') : U.emptyState('No reminders');
  }
  const w = $('#remindersData');
  if (w) w.innerHTML = active.length
    ? active.slice(0, 3).map(r => `<div class="w-line">• ${U.escapeHtml(r.text.slice(0, 30))} <span class="dim">${humanTime(new Date(r.due))}</span></div>`).join('')
    : '<span class="dim">No reminders</span>';
}

function renderContacts() {
  const items = S.getList(KEYS.CONTACTS);
  const list = $('#contactsList');
  if (!list) return;
  list.innerHTML = items.length ? items.map(c => `
    <div class="item-row" data-id="${c.id}">
      <div class="item-text">${U.escapeHtml(c.name)}<span class="dim"> ${U.escapeHtml(c.phone)}</span></div>
      <button class="item-call" data-call="${U.escapeHtml(c.phone)}">📞</button>
      <button class="item-del" data-del="${KEYS.CONTACTS}|${c.id}">✕</button>
    </div>`).join('') : U.emptyState('No contacts. Add as "Name: 9876543210"');
}

function renderCaps() {
  const el = $('#capsList'); if (!el) return;
  const items = [
    ['_tts', 'Voice output (speaking)'], ['_stt', 'Voice input (listening)'],
    ['contacts', 'Real contacts'], ['notifications', 'Notification reading'],
    ['sms', 'Read SMS / OTP'], ['sendSms', 'Send SMS'], ['phone', 'Direct calling'],
    ['overlay', 'Floating bubble'], ['accessibility', 'System gestures'],
    ['apps', 'Launch apps'], ['toggles', 'System toggles'], ['background', 'Background service']
  ];
  if (!nativeCaps.native) {
    el.innerHTML = '<div class="cap-row off"><span>\u25cb</span> Browser mode \u2014 install the APK to unlock phone features</div>';
    return;
  }
  V.speechStatus().then(st => {
    nativeCaps._tts = st.tts; nativeCaps._stt = st.stt;
    const rows = el.querySelectorAll('.cap-row');
    if (rows[0]) { rows[0].className = 'cap-row ' + (st.tts ? 'on' : 'off');
      rows[0].innerHTML = `<span>${st.tts ? '\u25cf' : '\u25cb'}</span> Voice output (speaking)`; }
    if (rows[1]) { rows[1].className = 'cap-row ' + (st.stt ? 'on' : 'off');
      rows[1].innerHTML = `<span>${st.stt ? '\u25cf' : '\u25cb'}</span> Voice input (listening)`; }
  });
  /* v8.4: grey rows are tappable - they open the exact Android setting page
     that turns the feature on. "System gestures" being grey is why the eyes
     seemed dead: nobody told the user it's ONE tap away. */
  const FIX_FOR = {
    overlay: 'overlay', accessibility: 'accessibility', notifications: 'notification_listener',
    background: 'battery_optimization'
  };
  el.innerHTML = items.map(([k, label]) => {
    const on = !!nativeCaps[k];
    const fix = !on && FIX_FOR[k] ? ` data-fix="${FIX_FOR[k]}" style="cursor:pointer" title="Tap to enable"` : '';
    return `<div class="cap-row ${on ? 'on' : 'off'}"${fix}><span>${on ? '\u25cf' : '\u25cb'}</span> ${label}${fix ? ' <span class="dim">— tap to enable</span>' : ''}</div>`;
  }).join('');
  el.querySelectorAll('[data-fix]').forEach(row => row.addEventListener('click', () => {
    U.toast('Opening settings - turn FRIDAY ON there, then come back', '🔧');
    NAT.openSpecialSetting(row.dataset.fix).catch(() => {});
  }));
}

function renderAlarms() {
  const el = $('#alarmsList'); if (!el) return;
  const list = AUTO.alarms();
  el.innerHTML = list.length ? list.map(a => `
    <div class="item-row ${a.enabled ? '' : 'done'}">
      <div class="item-text">${U.escapeHtml(a.label)}<div class="dim">${AUTO.describeAlarm(a)}</div></div>
      <button class="item-del" data-alarm-del="${a.id}">\u2715</button>
    </div>`).join('') : U.emptyState('No alarms. Say "set an alarm for 5 pm".');
}

function renderRoutines() {
  const el = $('#routinesList'); if (!el) return;
  const list = AUTO.routines();
  el.innerHTML = list.length ? list.map(r => `
    <div class="item-row">
      <div class="item-text">${U.escapeHtml(r.name)}<div class="dim">${r.actions.length} action${r.actions.length === 1 ? '' : 's'}${r.runs ? ` \u00b7 run ${r.runs}\u00d7` : ''}</div></div>
      <button class="item-call" data-routine-run="${U.escapeHtml(r.name)}">\u25b6</button>
      <button class="item-del" data-routine-del="${r.id}">\u2715</button>
    </div>`).join('') : U.emptyState('No routines yet.');
}

function renderGeofences() {
  const el = $('#geofenceList'); if (!el) return;
  const list = AUTO.geofences();
  el.innerHTML = list.length ? list.map(g => `
    <div class="item-row">
      <div class="item-text">${U.escapeHtml(g.name)}<div class="dim">${g.radius}m radius</div></div>
      <button class="item-del" data-geo-del="${g.id}">\u2715</button>
    </div>`).join('') : U.emptyState('No saved locations.');
}

function renderRunLog() {
  const el = $('#runLog'); if (!el) return;
  const list = AUTO.runLog();
  el.innerHTML = list.length ? list.slice(0, 12).map(l => `
    <div class="log-row"><span>${U.escapeHtml(l.text)}</span>
    <span class="dim">${new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('')
    : U.emptyState('Nothing yet.');
}

function renderFacts() {
  const el = $('#factsList'); if (!el) return;
  const f = MEM.allFacts();
  el.innerHTML = f.length ? f.slice(0, 12).map(x => `
    <div class="item-row"><div class="item-text">${U.escapeHtml(x.label)}<div class="dim">${U.escapeHtml(x.value)}</div></div></div>`).join('')
    : U.emptyState('Tell me about yourself and I will remember.');
}

function renderWeatherWidget(wx, place) {
  const el = $('#weatherData');
  if (!el || !wx?.current) return;
  const c = wx.current;
  const [desc, emo] = API.describeWMO(c.weather_code);
  el.innerHTML = `<div class="wx-temp">${Math.round(c.temperature_2m)}°<span>C</span></div>
    <div class="wx-desc">${emo} ${desc}</div><div class="dim">${U.escapeHtml(place)}</div>`;
  const full = $('#weatherFull');
  if (full && wx.daily) {
    full.innerHTML = `<div class="wx-hero">${emo}<div class="wx-temp big">${Math.round(c.temperature_2m)}°C</div>
      <div>${desc} · feels ${Math.round(c.apparent_temperature)}°</div><div class="dim">${U.escapeHtml(place)}</div></div>
      <div class="wx-days">${wx.daily.time.map((d, i) => {
        const [dd, ee] = API.describeWMO(wx.daily.weather_code[i]);
        return `<div class="wx-day"><span>${new Date(d).toLocaleDateString([], { weekday: 'short' })}</span>
          <span>${ee}</span><span>${Math.round(wx.daily.temperature_2m_max[i])}° / ${Math.round(wx.daily.temperature_2m_min[i])}°</span></div>`;
      }).join('')}</div>`;
  }
}

function updateCounters() {
  const set = (sel, v) => { const e = $(sel); if (e) e.textContent = v; };
  set('#sysMemCount', S.getList(KEYS.MEMORY).length);
  set('#sysChatCount', state.messages.length);
  set('#sysRemCount', S.getList(KEYS.REMINDERS).filter(r => !r.done).length);
}

function prefillPanel(panel, text) {
  if (panel === 'sub-translate') { const i = $('#translateInput'); if (i) i.value = text; }
}

/* ================= CAMERA ================= */
let camMode = 'photo', scanLoop = null;

/* v8.3: Capacitor's WebView does NOT grant camera to getUserMedia - the live
   preview only works in a real browser. Inside the APK we open the phone's
   real camera app instead (intent-based capture through the WebView file
   chooser, the same proven path the attach button uses. Needs no CAMERA
   permission dialog - the camera app mediates it.) */
function pickNativePhoto() {
  return new Promise(res => {
    let inp = document.getElementById('nativePhotoPick');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file';
      inp.id = 'nativePhotoPick';
      inp.accept = 'image/*';
      inp.setAttribute('capture', 'environment');
      inp.style.display = 'none';
      document.body.appendChild(inp);
    }
    inp.value = '';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return res(null);
      const rd = new FileReader();
      rd.onload = () => res(rd.result);
      rd.onerror = () => res(null);
      rd.readAsDataURL(f);
    };
    try { inp.click(); } catch (_) { res(null); }
  });
}

/* v11.3 PHASE 6: document scanner — pure pipeline, zero network:
   photo → grayscale → histogram normalize → raw RGB → pure PDF writer.
   The file downloads locally; nothing uploads anywhere. */
async function saveScanPdf(src, ocrText) {
  U.toast('Building PDF…', '📄', 1800);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const id = cx.getImageData(0, 0, cv.width, cv.height);
    const N = cv.width * cv.height;
    const gray = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const o = i * 4; gray[i] = (id.data[o] * 3 + id.data[o + 1] * 6 + id.data[o + 2]) / 10 | 0; }
    const norm = VISIONX.normalizeGray(gray);
    const rgb = new Uint8Array(N * 3);
    for (let i = 0; i < N; i++) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = norm[i]; }
    /* PDF XObject needs FlateDecode — rawFixedDeflate wraps bytes in a VALID
       zlib stream (stored blocks). No libs, no network, opens everywhere. */
    const packed = rawFixedDeflate(rgb);
    const pdf = VISIONX.buildPdf({ data: packed, width: cv.width, height: cv.height }, 'FRIDAY scan — ' + (ocrText || '').split('\n')[0].slice(0, 40));
    const blob = new Blob([pdf], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'friday-scan-' + Date.now() + '.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    VISIONX.remember({ kind: 'doc', text: (ocrText || '').slice(0, 1200) });
    U.toast('PDF saved (searchable OCR text stored in vision memory)', '📄', 2600);
  } catch (e) {
    U.toast('PDF failed: ' + (e && e.message), '⚠️', 3000);
  }
}

/* Minimal VALID zlib stream (stored deflate blocks + adler32). No libs —
   guaranteed to decode in every PDF/DEFLATE reader ever shipped. */
function rawFixedDeflate(data) {
  const out = [0x78, 0x01];    // zlib CMF/FLG (no compression preset)
  for (let i = 0; i < data.length; i += 65535) {
    const chunk = data.subarray(i, i + 65535);
    const last = (i + 65535) >= data.length ? 1 : 0;
    out.push(last, chunk.length & 0xff, (chunk.length >> 8) & 0xff,
             (~chunk.length) & 0xff, ((~chunk.length) >> 8) & 0xff);
    for (let j = 0; j < chunk.length; j++) out.push(chunk[j]);
  }
  let s1 = 1, s2 = 0;
  for (let i = 0; i < data.length; i++) { s1 = (s1 + data[i]) % 65521; s2 = (s2 + s1) % 65521; }
  out.push((s2 >> 8) & 0xff, s2 & 0xff, (s1 >> 8) & 0xff, s1 & 0xff);
  return new Uint8Array(out);
}

/* Auto-describe the capture with the Groq vision model and SPEAK it -
   "Friday, what am I looking at?" finally answers out loud. */
async function describeNativePhoto(dataUrl) {
  const out = $('#cameraAnalysis');
  if (!AI.hasGroq()) {
    if (out) out.textContent = 'Photo captured. Cloud vision unavailable for a spoken description - use Analyze (on-device objects) or Read text below.';
    return;
  }
  if (out) out.textContent = 'Asking my vision model…';
  try {
    const v = await AI.callGroqVision(dataUrl, 'Describe what you see');
    const desc = v && v.ok ? v.text : null;
    if (desc) {
      if (out) out.innerHTML = U.renderRich(desc);
      addMsg('ai', desc, { source: 'live' });
      S.remember('ai', desc);
      V.speak(desc, {
        onStart: () => state.speaking = true,
        onEnd: () => { state.speaking = false; continueConvoAfterSpeech(desc); }
      });
    } else if (out) {
      out.textContent = 'Vision unavailable (' + ((v && v.reason) || 'error') + '). Buttons below still work offline.';
    }
  } catch (e) {
    if (out) out.textContent = 'Vision failed: ' + (e.message || e);
  }
}

async function openCamera(mode = 'photo') {
  camMode = mode;
  const view = $('#cameraView');
  if (NAT.isNative() && mode === 'photo') {
    U.toast('Opening camera…', '📷');
    const dataUrl = await pickNativePhoto();
    if (!dataUrl) { U.toast('No photo taken', '📷'); return; }
    view.classList.add('open');
    const feed = $('#cameraFeed'); if (feed) feed.style.display = 'none';
    $('#capturedImage').src = dataUrl;
    $('#cameraResult').style.display = 'block';
    describeNativePhoto(dataUrl);
    return;
  }
  view.classList.add('open');
  try {
    await D.startCamera($('#cameraFeed'));
    if (mode === 'qr') startScan();
  } catch (e) {
    U.toast('Camera blocked', '⚠️');
    closeCamera();
  }
}
function closeCamera() {
  clearInterval(scanLoop);
  D.stopCamera();
  $('#cameraView').classList.remove('open');
  $('#cameraResult').style.display = 'none';
  const feed = $('#cameraFeed'); if (feed) feed.style.display = '';   // back to live preview for next time
}
function startScan() {
  clearInterval(scanLoop);
  scanLoop = setInterval(async () => {
    const r = await D.scanBarcode($('#cameraFeed'));
    if (r?.value) {
      clearInterval(scanLoop);
      D.buzz();
      closeCamera();
      /* v11.3 Phase 6: QR history + vision memory (searchable via memex) */
      try {
        const rec = VISIONX.qrLog(r.value);
        VISIONX.remember({ kind: 'qr', text: r.value });
        hudPush('📷', 'qr saved (' + rec.type + ') — "qr history dikha" to revisit');
      } catch (_) {}
      const isUrl = /^https?:\/\//.test(r.value);
      addMsg('ai', `Scanned (${VISIONX.qrType(r.value)}): ${r.value}`, isUrl ? { link: r.value } : {});
      V.speak('Code scanned.');
    }
  }, 700);
}

function offlineAgent(btnSel, input) {
  if (btnSel === '#planBtn') return T.offlinePlan(input);
  if (btnSel === '#researchBtn') return T.offlineResearch(input);
  if (btnSel === '#writeBtn') return T.offlineWrite(input);
  if (btnSel === '#codeBtn') { const t = T.offlineCode(input); return t ? t.body : null; }
  return null;
}

/* ================= EVENTS ================= */
function bindEvents() {
  // Mic
  $('#micButton').addEventListener('click', () => {
    if (state.speaking) { V.cancelSpeech(); state.speaking = false; return; }
    if (state.listening) V.stopListening(); else {
      state.voiceGiveUp = false;      // v14.1: tap mic = explicit retry
      V.listen();
    }
  });

  // Send
  const send = () => {
    const t = $('#textInput').value.trim();
    if (t) handleInput(t);
  };
  $('#sendButton').addEventListener('click', send);
  $('#textInput').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

  // Nav
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => {
    const p = b.dataset.panel;
    D.tap();
    U.closeAllPanels();
    if (p === 'dashboard' || p === 'chat') U.showView(p);
    else {
      U.openPanel(p);
      if (p === 'activity') refresh('activity');
      if (p === 'settings') { renderCaps(); renderCoder(); }
      $$('.nav-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    }
  }));

  // Panel close
  document.addEventListener('click', e => {
    /* v15 Phase 2: per-message actions (copy / pin / regenerate / delete) */
    const mc = e.target.closest('[data-msg-copy]');
    if (mc) { const m = state.messages[+mc.dataset.msgCopy]; if (m) D.copy(m.text).then(() => U.toast('Copied', '📋')); return; }
    const mp = e.target.closest('[data-msg-pin]');
    if (mp) {
      const i = +mp.dataset.msgPin, m = state.messages[i];
      if (m) { m.pinned = !m.pinned; saveChat(); renderChat(); U.toast(m.pinned ? 'Pinned 📌' : 'Unpinned', '📌'); }
      return;
    }
    const mr = e.target.closest('[data-msg-regen]');
    if (mr) {
      const i = +mr.dataset.msgRegen;
      let user = '';
      for (let j = i - 1; j >= 0; j--) { if (state.messages[j] && state.messages[j].role === 'user') { user = state.messages[j].text; break; } }
      if (user) { state.messages.splice(i, 1); saveChat(); renderChat(); return handleInput(user, { noChain: true, silentEcho: true }); }
      U.toast('No prompt to regenerate', '⚠️');
      return;
    }
    const md = e.target.closest('[data-msg-del]');
    if (md) {
      const i = +md.dataset.msgDel;
      if (state.messages[i]) { state.messages.splice(i, 1); saveChat(); renderChat(); updateCounters(); }
      return;
    }
    const closeBtn = e.target.closest('.panel-close');
    if (closeBtn) {
      U.closePanel(closeBtn.dataset.close);
      if (!U.anyPanelOpen()) U.showView('dashboard');
      return;
    }

    // alarm delete
    const ad = e.target.closest('[data-alarm-del]');
    if (ad) { AUTO.deleteAlarm(ad.dataset.alarmDel); refresh('alarms'); D.tap(); U.toast('Alarm removed', '\u23f0'); return; }

    // routine run / delete
    const rr = e.target.closest('[data-routine-run]');
    if (rr) { U.closeAllPanels(); U.showView('chat'); handleInput(rr.dataset.routineRun); return; }
    const rd = e.target.closest('[data-routine-del]');
    if (rd) { AUTO.deleteRoutine(rd.dataset.routineDel); refresh('routines'); D.tap(); return; }

    // geofence delete
    const gd = e.target.closest('[data-geo-del]');
    if (gd) { AUTO.deleteGeofence(gd.dataset.geoDel); refresh('geofences'); D.tap(); return; }

    // delete row
    const del = e.target.closest('[data-del]');
    if (del) {
      const [key, id] = del.dataset.del.split('|');
      if (key === KEYS.REMINDERS) NAT.cancelAssistantReminder(String(id)).catch(() => {});
      S.removeItem(key, isNaN(id) ? id : id);
      const rec = S.getList(key);
      S.saveList(key, rec.filter(r => String(r.id) !== String(id)));
      refreshAll();
      D.tap();
      return;
    }

    // call contact
    const callBtn = e.target.closest('[data-call]');
    if (callBtn) { D.call(callBtn.dataset.call); return; }

    // copy code
    const cp = e.target.closest('.code-copy');
    if (cp) {
      const code = document.getElementById(cp.dataset.copy)?.textContent || '';
      D.copy(code).then(() => { cp.textContent = 'Copied'; setTimeout(() => cp.textContent = 'Copy', 1500); });
      return;
    }

    // coder model download / delete
    const mdl = e.target.closest('[data-model-dl]');
    if (mdl) { downloadModelFlow(mdl.dataset.modelDl); return; }
    const mx = e.target.closest('[data-model-del]');
    if (mx) { CODER.deleteModel(mx.dataset.modelDel).then(() => { U.toast('Model deleted', '🗑️'); renderCoder(); }); return; }
  });

  // Quick actions
  $$('.quick-action').forEach(b => b.addEventListener('click', () => {
    D.tap();
    const a = b.dataset.action;
    const acts = {
      time: () => handleInput('what time is it'),
      weather: () => { U.showView('chat'); doWeather(false); },
      note: () => { U.showView('chat'); $('#textInput').focus(); U.toast('Say or type: note ...', '\u270e'); },
      joke: () => handleInput('tell me a joke'),
      camera: () => openCamera('photo'),
      search: () => U.openPanel('sub-search'),
      reminder: () => { U.closeAllPanels(); U.openPanel('activity'); refresh('activity'); },
      translate: () => U.openPanel('sub-translate'),
      /* v20 HUD quick commands (cmd-btn) */
      voice: () => { if (!state.listening && !state.speaking) V.listen(); },
      vision: () => openCamera('photo'),
      memory: () => { U.openPanel('activity'); refresh('activity'); },
      automation: () => { U.openPanel('activity'); refresh('activity'); },
      notes: () => { U.openPanel('activity'); refresh('notes'); },
      music: () => { if (NAT.isNative()) NAT.mediaControl('playpause').catch(() => {}); else U.toast('Music needs the APK', '🎵'); },
      calls: () => { U.openPanel('activity'); refresh('activity'); },
      more: () => { U.openPanel('settings'); }
    };
    (acts[a] || (() => {}))();
  }));

  /* v20 HUD: .cmd-btn quick commands share the same action map */
  $$('.cmd-btn').forEach(b => b.addEventListener('click', () => {
    D.tap();
    const a = b.dataset.action;
    const acts = {
      voice: () => { if (!state.listening && !state.speaking) V.listen(); },
      vision: () => openCamera('photo'),
      memory: () => { U.openPanel('activity'); refresh('activity'); },
      automation: () => { U.openPanel('activity'); refresh('activity'); },
      notes: () => { U.openPanel('activity'); refresh('notes'); },
      music: () => { if (NAT.isNative()) NAT.mediaControl('playpause').catch(() => {}); else U.toast('Music needs the APK', '🎵'); },
      calls: () => { U.openPanel('activity'); refresh('activity'); },
      more: () => { U.openPanel('settings'); }
    };
    (acts[a] || (() => {}))();
  }));

  // Sub-panel adders
  const adder = (btnSel, inputSel, fn) => {
    const btn = $(btnSel), inp = $(inputSel);
    if (!btn || !inp) return;
    const go = () => { const v = inp.value.trim(); if (!v) return; fn(v); inp.value = ''; D.tap(); };
    btn.addEventListener('click', go);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  };
  adder('#addNoteBtn', '#noteInput', v => { S.addItem(KEYS.NOTES, { text: v }); refresh('notes'); U.toast('Note saved', '📝'); });
  adder('#addTaskBtn', '#taskInput', v => { S.addItem(KEYS.TASKS, { text: v, done: false }); refresh('tasks'); U.toast('Task added', '✅'); });
  adder('#addReminderBtn', '#reminderInput', v => {
    const when = parseTime(v);
    const date = when ? when.date : new Date(Date.now() + 3600000);
    const text = when ? v.replace(when.matched, '').trim() : v;
    const rec = S.addItem(KEYS.REMINDERS, { text, due: date.getTime(), done: false });
    scheduleReminder(rec); refresh('reminders');
    U.toast(`Reminder ${humanTime(date)}`, '⏰');
  });
  adder('#addEventBtn', '#eventInput', v => { S.addItem(KEYS.EVENTS, { text: v }); refresh('events'); U.toast('Event added', '📅'); });
  adder('#addContactBtn', '#contactInput', v => {
    const [name, phone] = v.split(/[:,]/).map(s => s.trim());
    if (!name || !phone) return U.toast('Format: Name: 9876543210', '⚠️');
    S.addItem(KEYS.CONTACTS, { name, phone }); refresh('contacts'); U.toast('Contact saved', '📇');
  });
  adder('#searchBtn', '#searchInput', async v => {
    const box = $('#searchResults');
    box.innerHTML = '<div class="agent-thinking">Searching…</div>';
    try {
      const r = await API.wikiSearch(v, 6);
      box.innerHTML = r.length ? r.map(x => `<a class="search-item" href="${x.url}" target="_blank" rel="noopener">
        <strong>${U.escapeHtml(x.title)}</strong><span>${U.escapeHtml(x.snippet)}</span></a>`).join('')
        : U.emptyState('No results');
    } catch (e) { box.innerHTML = U.emptyState('Search needs internet'); }
  });
  adder('#translateBtn', '#translateInput', async v => {
    const box = $('#translateResult');
    box.innerHTML = '<div class="agent-thinking">Translating…</div>';
    try {
      const out = await API.translate(v, $('#translateFrom').value, $('#translateTo').value);
      box.innerHTML = `<div class="tr-out">${U.escapeHtml(out)}</div>`;
      V.speak(out);
    } catch (e) { box.innerHTML = U.emptyState('Translation needs internet'); }
  });

  // Agent panels (need Groq)
  const agent = (btnSel, inputSel, outSel, sys, model) => {
    const btn = $(btnSel), inp = $(inputSel), out = $(outSel);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const v = inp.value.trim();
      if (!v) return;
      if (!AI.hasGroq()) {
        const fb = offlineAgent(btnSel, v);
        out.innerHTML = fb ? U.renderRich(fb)
          : U.emptyState('This needs the optional FRIDAY Cloud backend. API keys stay server-side.');
        return;
      }
      out.innerHTML = '<div class="agent-thinking">Working…</div>';
      try {
        const r = await AI.callGroq(
          [{ role: 'system', content: sys }, { role: 'user', content: v }],
          { maxTokens: 3000, temperature: 0.4, model }
        );
        out.innerHTML = U.renderRich(r);
      } catch (e) { out.innerHTML = U.emptyState(errMsg(e)); }
    });
  };
  agent('#codeBtn', '#codeInput', '#codeResult',
    'You are an expert programmer. Output complete, working, production-ready code with fenced code blocks and a language tag. Include setup/run instructions. No placeholders.', 'qwen/qwen3-32b');
  agent('#planBtn', '#planInput', '#planResult',
    'You are a planning expert. Produce a clear, actionable step-by-step plan with time estimates. Be concise.');
  agent('#researchBtn', '#researchInput', '#researchResult',
    'You are a research assistant. Give a structured, factual briefing with key points, context and caveats. Note uncertainty where it exists.');
  agent('#writeBtn', '#writeInput', '#writeResult',
    'You are an expert writer. Produce polished, well-structured prose matching the requested tone and format.');

  // Camera controls
  $('#camClose')?.addEventListener('click', closeCamera);
  $('#camSnap')?.addEventListener('click', () => {
    const img = D.capture($('#cameraFeed'), $('#cameraCanvas'));
    if (!img) return;
    $('#capturedImage').src = img;
    $('#cameraResult').style.display = 'block';
    D.tap();
  });
  $('#camRetake')?.addEventListener('click', () => { $('#cameraResult').style.display = 'none'; });
  $('#camAnalyze')?.addEventListener('click', async () => {
    const out = $('#cameraAnalysis');
    const src = $('#capturedImage').src;
    if (!src) return;
    out.textContent = 'Loading vision model (first run downloads ~6 MB)…';
    try {
      const img = await VIS.toImage(src);
      const objs = await VIS.detectObjects(img, m => { out.textContent = m; });
      const desc = VIS.describeScene(objs);
      out.innerHTML = U.renderRich(desc + (objs.length
        ? '\n\n' + objs.map(o => `• ${o.label} — ${o.score}%`).join('\n') : ''));
      V.speak(desc);
    } catch (e) {
      out.textContent = 'Vision failed: ' + e.message + (navigator.onLine ? '' : ' (needs internet on first use)');
    }
  });

  $('#camOCR')?.addEventListener('click', async () => {
    const out = $('#cameraAnalysis');
    const src = $('#capturedImage').src;
    if (!src) return;
    out.textContent = 'Loading text engine (first run downloads ~2 MB)…';
    try {
      const r = await VIS.ocr(src, m => { out.textContent = m; });
      if (!r.text) { out.textContent = 'No readable text found. Try better lighting or get closer.'; return; }
      /* v11.3 Phase 6: clean + classify + remember + homework-mode offer */
      const clean = VISIONX.cleanOcr(r.text);
      const kind = VISIONX.classifyDoc(clean);
      VISIONX.remember({ kind: 'ocr', text: clean.slice(0, 1200) });
      const eqs = VISIONX.mathLines(clean);
      out.innerHTML = `<div class="ocr-out">${U.escapeHtml(clean)}</div>
        <div class="dim">Confidence ${r.confidence}% · Doc: ${kind}</div>
        <button class="tool-add-btn" id="ocrCopy">Copy text</button>
        <button class="tool-add-btn" id="ocrSolve">${eqs.length ? '🧮 Homework solve karo' : '🤓 Explain karo'}</button>
        <button class="tool-add-btn" id="ocrPdf">📄 PDF save</button>`;
      $('#ocrCopy').onclick = () => D.copy(clean).then(() => U.toast('Text copied', '📋'));
      $('#ocrSolve').onclick = () => { U.showView('chat'); handleInput(VISIONX.homeworkPrompt(clean), { silentEcho: true, fromVoice: false }); };
      $('#ocrPdf').onclick = () => saveScanPdf(src, clean);
      V.speak(r.lines.slice(0, 3).join('. '));
    } catch (e) {
      out.textContent = 'OCR failed: ' + e.message + (navigator.onLine ? '' : ' (needs internet on first use)');
    }
  });

  // Settings
  const bind = (sel, key, ev = 'change', prop = 'value') => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener(ev, () => {
      const v = prop === 'checked' ? el.checked : el.value;
      const previous = S.getSetting(key);
      S.setSetting(key, v);
      onSettingChange(key, v, previous);
    });
  };
  bind('#aiProvider', 'aiProvider');
  bind('#groqModel', 'groqModel');
  bind('#aiPersonality', 'personality');
  bind('#userName', 'userName', 'input');
  bind('#voiceOutput', 'voiceOutput', 'change', 'checked');
  bind('#wakeWord', 'wakeWord', 'change', 'checked');
  /* v11.2 VOX settings */
  bind('#wakeWords', 'wakeWords', 'input');
  bind('#wakeSensitivity', 'wakeSensitivity', 'input');
  bind('#dangerConfirm', 'dangerConfirm', 'change', 'checked');
  bind('#duckAudio', 'duckAudio', 'change', 'checked');
  bind('#voxFeedback', 'voxFeedback', 'change', 'checked');
  /* v11.3 COGNITION settings */
  bind('#autoEngine', 'autoEngine', 'change', 'checked');
  { const mr = $('#memDashRefresh'); if (mr) mr.addEventListener('click', renderMemDash); }
  renderRulesList();
  bind('#speechRate', 'speechRate', 'input');
  bind('#speechPitch', 'speechPitch', 'input');
  bind('#voiceLang', 'voiceLang');
  bind('#uiTheme', 'uiTheme');
  bind('#particleEffects', 'particleEffects', 'change', 'checked');
  bind('#showWidgets', 'showWidgets', 'change', 'checked');
  bind('#saveMemory', 'saveMemory', 'change', 'checked');
  bind('#backgroundService', 'backgroundService', 'change', 'checked');
  /* v11.2 F6 FIX (audit): one-tap battery-optimization exemption — OPPO/ColorOS
     kills wake-word listeners in the background without this. */
  { const b = $('#batteryExemptBtn'); if (b) b.addEventListener('click', () => {
      NAT.openSpecialSetting('battery_optimization').then(() => U.toast('List me FRIDAY OS dhundo → "Don\'t optimize" choose karo', '🔋', 5200)).catch(() => {});
    }); }
  bind('#bootStart', 'bootStart', 'change', 'checked');
  bind('#announceNotifications', 'announceNotifications', 'change', 'checked');
  bind('#proactiveAssistant', 'proactiveAssistant', 'change', 'checked');
  bind('#assistantAddress', 'assistantAddress');
  bind('#proactivePrivateMode', 'proactivePrivateMode', 'change', 'checked');
  bind('#privateOnLock', 'privateOnLock', 'change', 'checked');
  bind('#quietHoursEnabled', 'quietHoursEnabled', 'change', 'checked');
  bind('#quietHoursStart', 'quietHoursStart');
  bind('#quietHoursEnd', 'quietHoursEnd');
  bind('#notificationBlockedApps', 'notificationBlockedApps', 'input');
  bind('#notificationBlockedContacts', 'notificationBlockedContacts', 'input');
  bind('#notificationRateSeconds', 'notificationRateSeconds', 'change');
  bind('#notificationMaxPerHour', 'notificationMaxPerHour', 'change');
  bind('#callAnnouncements', 'callAnnouncements', 'change', 'checked');
  const catControls = {
    notifyMessages: 'MESSAGE', notifyEmail: 'EMAIL', notifyCalendar: 'CALENDAR',
    notifyDelivery: 'DELIVERY', notifyMissedCalls: 'MISSED_CALL', notifySensitive: 'SENSITIVE'
  };
  Object.entries(catControls).forEach(([id, category]) => {
    const el = $('#' + id); if (!el) return;
    el.addEventListener('change', () => {
      const previous = [...(S.getSetting('notificationCategories') || [])];
      const selected = new Set(previous);
      el.checked ? selected.add(category) : selected.delete(category);
      S.setSetting('notificationCategories', [...selected]);
      onSettingChange('notificationCategories', [...selected], previous);
    });
  });
  { const b = $('#notificationAccessBtn'); if (b) b.addEventListener('click', () => NAT.openSpecialSetting('notification_listener')); }
  { const b = $('#exactAlarmBtn'); if (b) b.addEventListener('click', () => NAT.openSpecialSetting('exact_alarm')); }
  bind('#bubbleEnabled', 'bubbleEnabled', 'change', 'checked');
  bind('#hindiUI', 'hindiUI', 'change', 'checked');
  bind('#batteryWarnFull', 'batteryWarnFull', 'change', 'checked');
  bind('#waCC', 'waCountryCode', 'input');
  bind('#emergencyContact', 'emergencyContact', 'input');
  bind('#bargeIn', 'bargeIn', 'change', 'checked');
  bind('#streamingTts', 'streamingTts', 'change', 'checked');
  bind('#handsFree', 'handsFree', 'change', 'checked');
  bind('#offlineChat', 'offlineChat', 'change', 'checked');
  bind('#offlineBrain', 'offlineBrain', 'change', 'checked');
  bind('#llmModelPath', 'llmModelPath', 'input');
  const llmScan = $('#llmScan'), llmLoad = $('#llmLoad'), llmUnload = $('#llmUnload');
  if (llmScan) llmScan.addEventListener('click', llmScanUI);
  if (llmLoad) llmLoad.addEventListener('click', llmLoadUI);
  if (llmUnload) llmUnload.addEventListener('click', llmUnloadUI);
  bind('#porcupineKey', 'porcupineKey', 'input');
  bind('#wakeKeyword', 'wakeKeyword', 'input');
  const voskDl = $('#voskDownload'), voskSc = $('#voskScan');
  if (voskDl) voskDl.addEventListener('click', () => voskDownloadUI(false));
  if (voskSc) voskSc.addEventListener('click', voskScanUI);
  if (NAT.voskAddListener) NAT.voskAddListener('voskProgress', ev => {
    const chip = $('#voskStatusChip');
    if (chip && (ev.percent || 0) < 100) chip.textContent = `Wake brain: downloading… ${ev.percent || 0}%`;
  });
  /* v10.0: all hf pack downloads share one progress pipe into the active chip */
  if (NAT.hfAddProgressListener) NAT.hfAddProgressListener(ev => {
    const chip = state.hfChip ? $(state.hfChip) : null;
    if (chip && (ev.percent || 0) < 100) chip.textContent = `${chip.dataset.base || 'Pack:'} downloading… ${ev.percent || 0}%`;
  });
  const vdl = $('#voiceDownload'), vtest = $('#voiceTest'), edl = $('#earsDownload'), mdl = $('#embedDownload');
  if (vtest) vtest.addEventListener('click', async () => {
    if (!NAT.isNative()) { U.toast('Only in the installed app', '⚠️'); return; }
    if (!V.isSherpaVoiceArmed()) { U.toast('Pehle voice pack download karo', '🔊'); return; }
    NAT.sherpaSpeak('Neural voice online, Boss. Ab main pehle se zyada insaan lagti hoon, hain na?').catch(() => {});
  });
  bind('#neuralVoice', 'neuralVoice', 'change', 'checked');
  bind('#offlineEars', 'offlineEars', 'change', 'checked');
  bind('#embedModelPath', 'embedModelPath', 'input');
  /* v10.1 FRIDAY Cloud (backend server mode) */
  bind('#serverUrl', 'serverUrl', 'input');
  bind('#serverToken', 'serverToken', 'input');
  bind('#serverMode', 'serverMode', 'change', 'checked');
  /* v13 Phase 11-13: security / performance / cinematic toggles */
  bind('#appLock', 'appLock', 'change', 'checked');
  bind('#cloudConsent', 'cloudConsent', 'change', 'checked');
  bind('#auditEnabled', 'auditEnabled', 'change', 'checked');
  bind('#perfMonitor', 'perfMonitor', 'change', 'checked');
  bind('#batteryGate', 'batteryGate', 'change', 'checked');
  bind('#aiCache', 'aiCache', 'change', 'checked');
  bind('#cinematic', 'cinematic', 'change', 'checked');
  bind('#highContrast', 'highContrast', 'change', 'checked');
  bind('#textScale', 'textScale', 'change');
  const appPin = $('#appPin');
  if (appPin) appPin.addEventListener('change', async () => {
    const v = appPin.value.trim();
    if (!v) return;
    const r = await SECX.setAppPin(v);
    U.toast(r.ok ? 'App PIN set 🔒' : 'PIN must be 4-8 digits', r.ok ? '🔒' : '⚠️');
    appPin.value = '';
  });
  /* v10.2: JARVIS zero-setup — suit keeps itself updated (WiFi, silent) */

  /* v10.3 HERALD: call guard + inbox */
  bind('#callGuardTemplate', 'callGuardTemplate', 'input');
  bind('#callGuardMode', 'callGuardMode', 'change');
  $('#callGuard')?.addEventListener('change', async e => {
    const requested = e.target.checked;
    const revision = ++callGuardEnabledRevision;
    S.setSetting('callGuard', requested);
    const saved = await syncCallGuardNative();
    if (revision !== callGuardEnabledRevision) {
      await syncCallGuardNative();
      return;
    }
    if (!saved || !saved.ok) {
      S.setSetting('callGuard', !requested);
      e.target.checked = !requested;
      U.toast('Call Assistant setting could not be saved; the previous state remains active.', '⚠️');
      return;
    }
    U.toast(requested ? 'Call Assistant ON — caller announcement and supported controls active' : 'Call Assistant off', '📞');
  });
  $('#inboxTestBtn')?.addEventListener('click', () => { U.showView('chat'); handleInput('uska jawab do', { fromVoice: false }); });
  /* v11.1 IGNITION settings */
  bind('#bootMode', 'bootMode', 'change');
  bind('#bootSound', 'bootSound', 'change', 'checked');
  /* FRIDAY handled a call while app was open -> announce */
  if (NAT.onCallHandled) NAT.onCallHandled(ev => {
    const num = (ev && ev.number) || 'caller';
    const act = (ev && ev.action) || '';
    reply(act === 'sms_sent' ? `📞 ${num} ko maine sambhaal liya, Boss — polite decline + tumhara SMS bhej diya.`
        : act === 'sms_requested' ? `📞 ${num} ka call decline hua. Android ne SMS request accept ki hai; final sent result ka wait hai.`
        : act === 'whatsapp_draft' ? `📞 ${num} ko decline kiya — WhatsApp draft khul gaya hai, tap to send.`
        : act === 'whatsapp_unavailable' ? `📞 ${num} decline hua, par WhatsApp draft nahi khula. Koi SMS nahi bheja gaya.`
        : act === 'message_guard_blocked' ? `📞 ${num} decline hua; duplicate-message guard ne doosra message rok diya.`
        : act === 'sms_failed' ? `📞 ${num} decline hua, par SMS nahi gaya (SIM/SMS permission check karo).`
        : `📞 ${num} ke liye guard hua (${act}).`);
  });

  $('#systemsLine')?.addEventListener('click', () => {
    const rows = state.systemsRows || [];
    if (!rows.length) { computeSystemsLine(); return; }
    const lines = rows.map(r => `${r.ok ? '✅' : '⚠️'} ${r.name}${r.ok ? '' : ' — ' + r.fix}`);
    addMsg('ai', `**Systems check**\n` + lines.join('\n') + `\n\nFix a ⚠️ row, then say "read my notifications" or try the bubble again.`, { proactive: true });
  });
  $('#setupBtn')?.addEventListener('click', () => { U.closeAllPanels(); U.showView('chat'); runSetup(); });
  $('#syncContactsBtn')?.addEventListener('click', async () => {
    if (!NAT.isNative()) return U.toast('Only in the installed app', '\u26a0');
    const list = await NAT.loadContacts(true);
    if (!list) { U.toast('Grant contacts permission first', '\u26a0'); NAT.requestPermission(NAT.PERMS.contacts); return; }
    S.saveList(KEYS.CONTACTS, list.slice(0, 500).map(c => ({ id: 'sys_' + c.id, name: c.name, phone: c.phone, created: Date.now() })));
    refresh('contacts');
    U.toast(`${list.length} contacts synced`, '\u2713');
  });


  $('#clearChat')?.addEventListener('click', () => {
    state.messages = []; $('#chatMessages').innerHTML = ''; S.saveList(KEYS.CHAT, []);
    U.toast('Chat cleared', '🗑️'); updateCounters();
  });
  $('#clearMemory')?.addEventListener('click', () => {
    if (!confirm('Erase all memories? This cannot be undone.')) return;
    S.saveList(KEYS.MEMORY, []); U.toast('Memory wiped', '🧠'); updateCounters();
  });
  $('#exportBtn')?.addEventListener('click', () => {
    D.download(`friday-backup-${Date.now()}.json`, JSON.stringify(S.exportAll(), null, 2));
    U.toast('Backup exported', '💾');
  });
  $('#importInput')?.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { S.importAll(JSON.parse(r.result)); U.toast('Backup restored', '✅'); setTimeout(() => location.reload(), 900); }
      catch (err) { U.toast('Invalid backup file', '❌'); }
    };
    r.readAsText(f);
  });

  // shake to talk
  D.onShake(() => { if (!state.listening) { D.buzz(); V.listen(); } });

  // online/offline
  addEventListener('online', () => { U.toast('Back online'); AUTO.runTrigger('online'); Bus.emit('autox:net', { online: true });
    /* v15 Phase 2: replay queued offline writes (learned facts → server) */
    API.drainOffline(async (kind, payload) => {
      if (kind === 'fact' && SERVER.isConfigured()) return SERVER.rememberFact({ key: payload.key, label: payload.label, value: payload.value });
      return { ok: false };
    }).then(r => { if (r.sent) Logger.info('core', 'offline queue drained: ' + r.sent + ' sent'); });
  });   // v11.3
  addEventListener('offline', () => { U.toast('Offline - local engine active'); AUTO.runTrigger('offline'); Bus.emit('autox:net', { online: false }); });   // v11.3

  // back button closes panels
  addEventListener('popstate', () => { if (U.anyPanelOpen()) U.closeAllPanels(); });
}

function onSettingChange(key, v, previousValue) {
  if (key === 'uiTheme') U.applyTheme(v);
  if (key === 'speechRate') $('#speechRateValue').textContent = v + 'x';
  if (key === 'wakeSensitivity') { const ws = $('#wakeSensValue'); if (ws) ws.textContent = v; }   // v11.2 VOX
  if (key === 'wakeWords') {                                                                      // v11.2 VOX: hot-reload wake list
    if (S.getSetting('wakeWord')) { V.stopWakeWord(); setTimeout(() => V.startWakeWord(), 600); }
  }
  if (key === 'speechPitch') $('#speechPitchValue').textContent = v;
  if (key === 'wakeWord') {
    v ? V.startWakeWord() : V.stopWakeWord();
    const w = ((S.getSetting('wakeKeyword') || 'friday').trim().split(/[\s,]+/)[0]) || 'friday';
    U.toast(v ? `Wake word on — say "${w}"` : 'Wake word off', '🎙️');
    if (v && !(S.getSetting('porcupineKey') || '').trim() && !(S.getSetting('voskModelPath') || '').trim()) {
      setTimeout(() => U.toast('Tip: tap "Get wake brain" in Settings for a true offline hotword — free, 36MB, no account', '🎙️', 5600), 900);
    }
    refreshVoskStatus();
  }
  if (key === 'showWidgets') { const dw = $('#dashWidgets'); if (dw) dw.style.display = v ? 'grid' : 'none'; }
  if (key === 'backgroundService' && NAT.isNative()) {
    const revision = ++backgroundServiceRevision;
    if (v && S.getSetting('proactiveAssistant')) {
      NAT.startForegroundService({}).then(r => {
        if (revision !== backgroundServiceRevision) {
          if (S.getSetting('backgroundService') === false) NAT.stopForegroundService();
          return;
        }
        if (!r || !r.ok) {
          S.setSetting('backgroundService', false);
          syncSettingsUI();
          U.toast(`Always-on host could not start: ${(r && r.reason) || 'Android blocked it'}`, '⚠️', 5200);
          return;
        }
        U.toast('Always-on host is active. Manual Force Stop still disables it until FRIDAY is reopened.', '🛡️', 5200);
      });
    } else {
      NAT.stopForegroundService();
    }
    if (v && S.getSetting('proactiveAssistant') && !S.getSetting('batOptAsked')) {
      S.setSetting('batOptAsked', true);
      U.toast('One-time: set FRIDAY battery to Unrestricted for the best background reliability', '🔋');
      NAT.openSpecialSetting('battery_optimization').catch(() => {});
    }
  }
  if (key === 'bootStart' && NAT.isNative()) {
    const revision = ++bootStartRevision;
    NAT.setBootStart(v).then(r => {
      if (revision !== bootStartRevision) {
        NAT.setBootStart(!!S.getSetting('bootStart'));
        return;
      }
      if (!r || !r.ok) {
        S.setSetting('bootStart', !v);
        syncSettingsUI();
        U.toast('FRIDAY could not save the reboot setting.', '⚠️');
      } else if (v) {
        U.toast('Your phone may also require Settings > Apps > FRIDAY OS > Auto-start ON', '🛡');
      }
    });
  }
  const assistantKeys = new Set(['proactiveAssistant', 'assistantAddress', 'proactivePrivateMode', 'privateOnLock',
    'quietHoursEnabled', 'quietHoursStart', 'quietHoursEnd', 'notificationCategories',
    'notificationBlockedApps', 'notificationBlockedContacts', 'notificationRateSeconds', 'notificationMaxPerHour',
    'callAnnouncements', 'announceNotifications']);
  if (assistantKeys.has(key) && NAT.isNative()) {
    const revision = ++assistantSettingsRevision;
    const configured = syncAssistantNative();
    if (key === 'proactiveAssistant') {
      if (!v) {
        NAT.stopForegroundService();
        configured.then(async r => {
          if (revision !== assistantSettingsRevision) {
            await syncAssistantNative();
            return;
          }
          if (r && r.ok) return;
          const status = await NAT.getAssistantStatus();
          if (status && typeof status.enabled === 'boolean') {
            S.setSetting('proactiveAssistant', status.enabled);
            syncSettingsUI();
          }
          U.toast('FRIDAY could not persist the Pause setting; check Always-On Assistant status.', '⚠️', 5200);
        });
      } else {
        configured.then(async r => {
          if (revision !== assistantSettingsRevision) {
            await syncAssistantNative();
            return;
          }
          if (!r || !r.ok) {
            S.setSetting('proactiveAssistant', false);
            syncSettingsUI();
            U.toast('FRIDAY could not save Always-On Assistant settings, so it stayed off.', '⚠️', 5200);
            return;
          }
          NAT.hasSpecialPermission('notification_listener').then(permission => {
            if (!permission || !permission.granted) NAT.openSpecialSetting('notification_listener');
          }).catch(() => {});
          if (S.getSetting('backgroundService') !== false) {
            const started = await NAT.startForegroundService({});
            if (!started || !started.ok) {
              S.setSetting('backgroundService', false);
              syncSettingsUI();
              U.toast(`Proactive events are enabled, but Android blocked the always-on host: ${(started && started.reason) || 'not running'}`, '⚠️', 6200);
              return;
            }
            U.toast('Always-on mode is active. Manual Force Stop still disables it until FRIDAY is reopened.', '🛡️', 5200);
          } else {
            U.toast('Proactive reminders and smart notification handling are enabled; the foreground host is off.', '🛡️', 5200);
          }
        });
      }
    } else {
      configured.then(async r => {
        if (revision !== assistantSettingsRevision) {
          await syncAssistantNative();
          return;
        }
        if (r && r.ok) return;
        if (previousValue !== undefined) S.setSetting(key, previousValue);
        syncSettingsUI();
        U.toast('That assistant setting could not be saved; the previous value was restored.', '⚠️');
      });
    }
  }
  if ((key === 'callGuardTemplate' || key === 'callGuardMode') && NAT.isNative()) {
    const revision = ++callGuardDetailsRevision;
    syncCallGuardNative().then(async r => {
      if (revision !== callGuardDetailsRevision) {
        await syncCallGuardNative();
        return;
      }
      if (r && r.ok) return;
      if (previousValue !== undefined) S.setSetting(key, previousValue);
      syncSettingsUI();
      U.toast('Call Assistant details could not be saved; the previous value was restored.', '⚠️');
    }).catch(() => {});
  }
  if (key === 'bubbleEnabled' && NAT.isNative()) runAction({ type: 'bubble', on: v }, {});
  if (key === 'announceNotifications' && NAT.isNative() && v) {
    NAT.hasSpecialPermission('notification_listener').then(r => {
      if (!r || !r.granted) {
        U.toast('Opening Notification access - turn FRIDAY OS ON there, then say read my notifications', '🔔');
        NAT.openSpecialSetting('notification_listener').catch(() => {});
      }
    }).catch(() => {});
  }
  if (key === 'batteryWarnFull' && v) U.toast('I will alert at 100% while the background service is running', '🔋');
  if (key === 'hindiUI') I18N.applyHindiUI();
  if (key === 'personality') { const p = AI.persona(); U.toast(`Now running as ${p.name}`, '🤖'); }
  if (key === 'offlineBrain') {
    if (v && !NAT.isNative()) U.toast('On-device brain only works inside the installed APK - web build keeps using cloud', 'ℹ️');
    else if (v && !(S.getSetting('llmModelPath') || '').trim()) U.toast('Pick a .gguf model below (Scan finds them in Downloads), then Load', '🧠');
    else if (v) U.toast('On-device brain on — conversations run 100% on this phone', '🧠');
    refreshLlmStatus();
  }
  if (key === 'llmModelPath') refreshLlmStatus();
  if (key === 'neuralVoice') {
    if (v) V.armSherpaVoice().then(ok => { if (!ok) U.toast('Pehle "Get neural voice" dabao (upar button)', '🔊'); refreshSherpaChips(); });
    else { V.armSherpaVoice(); refreshSherpaChips(); }
  }
  if (key === 'offlineEars') {
    if (v) V.armSherpaEars().then(ok => { if (!ok) U.toast('Pehle "Get offline ears" dabao (upar button)', '🎙️'); refreshSherpaChips(); });
    else { V.armSherpaEars(); refreshSherpaChips(); }
  }
  if (key === 'embedModelPath') refreshEmbedChip();
  if (key === 'serverUrl' || key === 'serverMode') {
    updateBrainBadge();
    if (key === 'serverUrl') serverHealthCheck();
    if (SERVER.isConfigured()) syncServerMemory();
  }
  /* v13 Phase 11-13 setting reactions */
  if (key === 'appLock') {
    const row = $('#appPinRow');
    if (row) row.style.display = v ? '' : 'none';
    if (v && !S.getSetting('appPinHash')) U.toast('PIN set karo (4-8 digits) — niche field me', '🔒');
    if (!v) { S.setSetting('appPinHash', ''); U.toast('App lock off', '🔓'); }
  }
  if (key === 'cloudConsent') SECX.setCloudConsent(!!v);
  if (key === 'perfMonitor') { v ? PERFX.startFpsMeter() : PERFX.stopFpsMeter(); U.toast(v ? 'Performance monitor on' : 'Monitor off', '⚡'); }
  if (key === 'cinematic' || key === 'highContrast' || key === 'textScale' || key === 'glassFX' || key === 'glowFX') {
    try { CINEX.init(); } catch (_) {}
  }
}

/* ================= v8.2 AI CORE (on-device brain UI) ================= */

function llmBase(p) { return String(p || '').split('/').pop() || p; }

async function refreshLlmStatus() {
  const chip = $('#llmStatusChip');
  if (!chip) return;
  if (!NAT.isNative()) { chip.textContent = 'Engine status: web build — engine ships only in the installed APK.'; return; }
  if (!NAT.llmAvailable()) { chip.textContent = 'Engine status: llama.cpp plugin missing in this build.'; return; }
  const st = await NAT.llmStatus();
  const path = (S.getSetting('llmModelPath') || '').trim();
  if (st.reason && String(st.reason).includes('LLAMA_BINDING_MISSING')) {
    chip.textContent = 'Engine status: binding missing — rebuild with native/add_llama_dep.py.';
  } else if (st.loaded) {
    chip.textContent = `Engine status: ● loaded — ${llmBase(st.modelPath)} · ${st.freeRamMB || '?'} MB free heap`;
  } else {
    chip.textContent = 'Engine status: ○ ready, no model loaded' + (path ? ` — will load ${llmBase(path)} on first use` : ' — set a .gguf path');
  }
}

async function llmScanUI() {
  U.toast('Scanning Downloads/Documents for .gguf models…', '🔍');
  const models = await NAT.scanModels();
  const row = $('#llmPickRow'), sel = $('#llmPick');
  if (!models.length) { U.toast('No .gguf files found. Download one into Downloads first (0.8–2.5 GB Q4 models).', '🧠'); return; }
  if (sel) {
    sel.innerHTML = models.map(m =>
      `<option value="${m.path}">${m.name} · ${m.sizeMB} MB</option>`).join('');
    if (row) row.style.display = '';
    sel.onchange = () => { S.setSetting('llmModelPath', sel.value); const inp = $('#llmModelPath'); if (inp) inp.value = sel.value; };
    S.setSetting('llmModelPath', models[0].path);
    const inp = $('#llmModelPath'); if (inp) inp.value = models[0].path;
  }
  U.toast(`Found ${models.length} model(s) — tap Load to wake the on-device brain`, '🧠');
  refreshLlmStatus();
}

async function llmLoadUI() {
  const path = (S.getSetting('llmModelPath') || '').trim();
  if (!path) { U.toast('Set a model path first (or Scan)', '🧠'); return; }
  U.toast(`Loading ${llmBase(path)} — first load maps the file, give it a moment…`, '⬇️');
  const r = await NAT.llmLoad(path);
  U.toast(r.ok ? `Loaded: ${llmBase(path)}. Ask me anything — no internet needed.` : 'Load failed: ' + LB.friendlyReason(r.reason), r.ok ? '🧠' : '⚠️');
  refreshLlmStatus();
}

async function llmUnloadUI() {
  await NAT.llmUnload();
  U.toast('On-device model unloaded — RAM freed', '🧠');
  refreshLlmStatus();
}

/* ================= v9.1 WAKE FREE (keyless Vosk hotword UI) ================= */

async function refreshVoskStatus() {
  const chip = $('#voskStatusChip');
  if (!chip) return;
  if (!NAT.isNative()) { chip.textContent = 'Wake brain: web build — the keyless engine ships only in the installed APK.'; return; }
  const st = await NAT.voskStatus();
  if (!st || !st.ok) { chip.textContent = 'Wake brain: engine missing in this build — rebuild the APK.'; return; }
  if (st.running) { chip.textContent = `Wake brain: ● listening for "${S.getSetting('wakeKeyword') || 'friday'}" — offline, keyless.`; return; }
  if ((S.getSetting('voskModelPath') || '').trim() || st.defaultModelReady) {
    chip.textContent = 'Wake brain: ○ ready — turn Wake Word on and say your word.'; return;
  }
  chip.textContent = 'Wake brain: not downloaded — tap "Get wake brain" once (36MB, then offline forever).';
}

/* ============ v10.2.0: Suit Auto-Setup — JARVIS never says ============
   "Sir, download this first". On WiFi the suit quietly keeps its systems
   up-to-date: memory brain → wake brain → neural voice → offline ears. */
function suitChip(show, html) {
  let chip = $('#suitChip');
  if (!chip) return;
  chip.hidden = !show;
  if (html != null) chip.innerHTML = html;
}

function netFacts() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
  return { online: navigator.onLine !== false, saveData: !!c.saveData, type: c.type || c.effectiveType || '' };
}

/* v10.3: mirror the call-guard settings into the native receiver prefs. */
async function syncCallGuardNative() {
  if (!NAT.isNative() || !NAT.setCallGuard) return { ok: false, reason: 'web' };
  return NAT.setCallGuard({
    enabled: !!S.getSetting('callGuard'),
    template: S.getSetting('callGuardTemplate') || '',
    mode: S.getSetting('callGuardMode') || 'sms'
  });
}

async function autoSetupSuit() {
  /* Disabled by Phase 3 policy: no background or Settings-triggered model downloads. */
  return { ok: false, reason: 'downloads_disabled' };
}

async function voskDownloadUI(quiet) {
  quiet = (quiet === true);
  if (!NAT.isNative()) { U.toast('Only in the installed app', '⚠️'); return; }
  const chip = quiet ? $('#suitChip') : $('#voskStatusChip');
  if (!quiet) {
    if (chip) chip.textContent = 'Wake brain: downloading… 0%';
    U.toast('Downloading the wake brain (36MB, one time) — a small offline ear. No account, no key.', '🎙️');
  }
  const r = await NAT.voskDownload(null, percent => {
    if (chip && percent < 100) chip.textContent = `Wake brain: downloading… ${Math.max(0, Math.round(percent || 0))}%`;
  });
  if (r && r.ok) {
    S.setSetting('voskModelPath', r.path || '');
    if (!quiet) {
      const sc = $('#voskStatusChip');
      if (sc) sc.textContent = `Wake brain: ✅ ready (${r.mb || '?'}MB) — your word now wakes FRIDAY, offline.`;
      U.toast('Wake brain ready! Turn Wake Word on and say your word.', '🎙️');
    }
    if (S.getSetting('wakeWord')) { V.stopWakeWord(); V.startWakeWord(); }
  } else if (!quiet) {
    const sc = $('#voskStatusChip');
    if (sc) sc.textContent = 'Wake brain: download failed — check internet and tap again.';
    U.toast('Download failed: ' + (r && r.reason ? r.reason : 'network'), '⚠️');
  }
  refreshVoskStatus();
}

async function voskScanUI() {
  if (!NAT.isNative()) { U.toast('Only in the installed app', '⚠️'); return; }
  const r = await NAT.voskScanModels();
  const items = (r && r.items) || [];
  if (!items.length) { U.toast('No wake model found — tap "Get wake brain" instead.', '🎙️'); return; }
  S.setSetting('voskModelPath', items[0].path);
  U.toast(`Wake brain found: ${items[0].name} (${items[0].mb}MB)`, '🎙️');
  refreshVoskStatus();
}

/* ================= v10.0 JARVIS: pack downloads + chips ================= */

async function refreshSherpaChips() {
  const vc = $('#sherpaVoiceChip'), sc = $('#sherpaSttChip');
  if (!NAT.isNative()) {
    if (vc) vc.textContent = 'Neural voice: installed app only (not web).';
    if (sc) sc.textContent = 'Offline ears: installed app only (not web).';
    return;
  }
  const st = await NAT.sherpaStatus();
  /* v10.2.2: honest broken reason from the last arm attempt (kabhi fake OK nahi) */
  let brk = null;
  try { brk = JSON.parse(S.getSetting('sherpaBroken') || 'null'); } catch (_) {}
  const brkVoice = brk && brk.what === 'voice' ? ' (' + brk.reason + ')' : '';
  const brkEars = brk && brk.what === 'ears' ? ' (' + brk.reason + ')' : '';
  if (vc) vc.textContent = V.isSherpaVoiceArmed()
    ? `Neural voice: ● LIVE${st && st.ttsLabel ? ' — ' + st.ttsLabel.split(':').pop() : ''}`
    : ((S.getSetting('neuralVoiceCfg') || '') ? 'Neural voice: ○ pack ready — toggle on.' + brkVoice : 'Neural voice: using Android TTS (robotic).');
  if (sc) sc.textContent = V.isSherpaSttArmed()
    ? 'Offline ears: ● LIVE — moonshine tiny'
    : ((S.getSetting('sherpaSttDir') || '') ? 'Offline ears: ○ pack ready — toggle on.' + brkEars : 'Offline ears: using Google STT (needs internet).');
}

async function refreshEmbedChip() {
  const chip = $('#embedStatusChip');
  if (!chip) return;
  const path = (S.getSetting('embedModelPath') || '').trim();
  if (!NAT.isNative()) { chip.textContent = 'Memory brain: installed app only (not web).'; return; }
  if (!path) { chip.textContent = 'Memory brain: not downloaded — meaning-recall off.'; return; }
  let st = null;
  try { st = await NAT.llmStatus(); } catch (_) {}
  const cnt = SEM.semanticMemorySize();
  chip.textContent = (st && st.embedLoaded)
    ? `Memory brain: ● loaded — ${cnt} memories, meaning-recall ON.`
    : `Memory brain: ○ set — loads on first recall (${cnt} memories).`;
}

async function sherpaVoiceDownloadUI(quiet) {
  quiet = (quiet === true);
  if (!NAT.isNative()) { U.toast('Only in the installed app', '⚠️'); return; }
  const chip = quiet ? $('#suitChip') : $('#sherpaVoiceChip');
  state.hfChip = quiet ? '#suitChip' : '#sherpaVoiceChip';
  if (chip) { chip.dataset.base = quiet ? 'Suit:' : 'Neural voice:'; if (!quiet) chip.textContent = 'Neural voice: downloading… 0%'; }
  if (!quiet) U.toast('Downloading the neural voice (~75MB, one time, then offline)…', '🔊');
  const r = await NAT.hfDownload({ repo: 'csukuangfj/vits-piper-en_US-lessac-medium', dest: 'voice-piper-en' });
  if (!(r && r.ok && r.dir)) {
    if (!quiet && chip) chip.textContent = 'Neural voice: download failed — internet check karke phir try karo.';
    return;
  }
  const files = r.files || [];
  const onnx = files.find(f => /\.onnx$/i.test(f));
  const hasTokens = files.some(f => /(^|\/)tokens\.txt$/i.test(f));
  const hasEspeak = files.some(f => /^espeak-ng-data\//i.test(f));
  if (!onnx || !hasTokens) { if (chip) chip.textContent = 'Neural voice: pack files incomplete — report this bug.'; return; }
  const cfg = {
    kind: 'vits',
    modelPath: r.dir + '/' + onnx,
    tokensPath: r.dir + '/tokens.txt',
    lexiconPath: '',
    dataDir: hasEspeak ? r.dir + '/espeak-ng-data' : '',
    dictDir: ''
  };
  S.setSetting('neuralVoiceCfg', JSON.stringify(cfg));
  S.setSetting('neuralVoice', true);
  const chk = $('#neuralVoice'); if (chk) chk.checked = true;
  const ok = await V.armSherpaVoice();
  refreshSherpaChips();
  if (quiet) return;
  if (ok) {
    U.toast('Neural voice LIVE! "Test" dabao.', '🔊');
    NAT.sherpaSpeak('Neural voice online, Boss. Ab main pehle se zyada insaan lagti hoon, hain na?').catch(() => {});
  } else {
    U.toast('Voice engine init failed (maybe rebuild pending)', '⚠️');
  }
}

async function sherpaEarsDownloadUI(quiet) {
  quiet = (quiet === true);
  if (!NAT.isNative()) { U.toast('Only in the installed app', '⚠️'); return; }
  const chip = quiet ? $('#suitChip') : $('#sherpaSttChip');
  state.hfChip = quiet ? '#suitChip' : '#sherpaSttChip';
  if (chip) { chip.dataset.base = quiet ? 'Suit:' : 'Offline ears:'; if (!quiet) chip.textContent = 'Offline ears: downloading… 0%'; }
  if (!quiet) U.toast('Downloading offline ears (~120MB, one time, then no-net dictation)…', '🎙️');
  const r = await NAT.hfDownload({ repo: 'csukuangfj/sherpa-onnx-moonshine-tiny-en-int8', dest: 'ears-moonshine' });
  if (!(r && r.ok && r.dir)) {
    if (!quiet && chip) chip.textContent = 'Offline ears: download failed — internet check karke phir try karo.';
    return;
  }
  S.setSetting('sherpaSttDir', r.dir);
  S.setSetting('offlineEars', true);
  const chk = $('#offlineEars'); if (chk) chk.checked = true;
  const ok = await V.armSherpaEars();
  refreshSherpaChips();
  if (quiet) return;
  U.toast(ok ? 'Offline ears LIVE! Ab basement me bhi sunungi.' : 'Ears engine init failed (maybe rebuild pending)', ok ? '🎙️' : '⚠️');
}

async function embedDownloadUI(quiet) {
  quiet = (quiet === true);
  if (!NAT.isNative()) { U.toast('Only in the installed app', '⚠️'); return; }
  const chip = quiet ? $('#suitChip') : $('#embedStatusChip');
  state.hfChip = quiet ? '#suitChip' : '#embedStatusChip';
  if (chip) { chip.dataset.base = quiet ? 'Suit:' : 'Memory brain:'; if (!quiet) chip.textContent = 'Memory brain: downloading… 0%'; }
  if (!quiet) U.toast('Downloading the memory brain (~30MB) — meaning-recall, fully on-device…', '🧠');
  const r = await SEM.downloadEmbedModel();
  refreshEmbedChip();
  const inp = $('#embedModelPath'); if (inp && r.path) inp.value = r.path;
  if (quiet) return;
  U.toast(r.ok ? 'Memory brain ready! "mera naam yaad rakhna" se shuru karo.' : 'Download failed — internet check karke phir try karo.', r.ok ? '🧠' : '⚠️');
}

function syncSettingsUI() {
  const set = (sel, val, prop = 'value') => { const e = $(sel); if (e) e[prop] = val; };
  set('#aiProvider', S.getSetting('aiProvider'));
  set('#groqModel', S.getSetting('groqModel'));
  set('#aiPersonality', S.getSetting('personality'));
  set('#userName', S.getSetting('userName'));
  set('#voiceOutput', S.getSetting('voiceOutput'), 'checked');
  set('#wakeWord', S.getSetting('wakeWord'), 'checked');
  set('#speechRate', S.getSetting('speechRate'));
  set('#speechPitch', S.getSetting('speechPitch'));
  set('#voiceLang', S.getSetting('voiceLang'));
  set('#uiTheme', S.getSetting('uiTheme'));
  set('#particleEffects', S.getSetting('particleEffects'), 'checked');
  set('#showWidgets', S.getSetting('showWidgets'), 'checked');
  set('#saveMemory', S.getSetting('saveMemory'), 'checked');
  set('#backgroundService', S.getSetting('backgroundService'), 'checked');
  set('#bootStart', S.getSetting('bootStart'), 'checked');
  set('#announceNotifications', S.getSetting('announceNotifications'), 'checked');
  set('#proactiveAssistant', !!S.getSetting('proactiveAssistant'), 'checked');
  set('#assistantAddress', S.getSetting('assistantAddress') || 'Boss');
  set('#proactivePrivateMode', !!S.getSetting('proactivePrivateMode'), 'checked');
  set('#privateOnLock', S.getSetting('privateOnLock') !== false, 'checked');
  set('#quietHoursEnabled', S.getSetting('quietHoursEnabled') !== false, 'checked');
  set('#quietHoursStart', S.getSetting('quietHoursStart') || '22:00');
  set('#quietHoursEnd', S.getSetting('quietHoursEnd') || '07:00');
  set('#notificationBlockedApps', S.getSetting('notificationBlockedApps') || '');
  set('#notificationBlockedContacts', S.getSetting('notificationBlockedContacts') || '');
  set('#notificationRateSeconds', S.getSetting('notificationRateSeconds') || 20);
  set('#notificationMaxPerHour', S.getSetting('notificationMaxPerHour') || 12);
  set('#callAnnouncements', S.getSetting('callAnnouncements') !== false, 'checked');
  const selectedCategories = new Set(S.getSetting('notificationCategories') || []);
  set('#notifyMessages', selectedCategories.has('MESSAGE'), 'checked');
  set('#notifyEmail', selectedCategories.has('EMAIL'), 'checked');
  set('#notifyCalendar', selectedCategories.has('CALENDAR'), 'checked');
  set('#notifyDelivery', selectedCategories.has('DELIVERY'), 'checked');
  set('#notifyMissedCalls', selectedCategories.has('MISSED_CALL'), 'checked');
  set('#notifySensitive', selectedCategories.has('SENSITIVE'), 'checked');
  set('#bubbleEnabled', S.getSetting('bubbleEnabled'), 'checked');
  set('#hindiUI', S.getSetting('hindiUI'), 'checked');
  set('#batteryWarnFull', S.getSetting('batteryWarnFull'), 'checked');
  set('#waCC', S.getSetting('waCountryCode') || '91');
  set('#emergencyContact', S.getSetting('emergencyContact') || '');
  set('#bargeIn', S.getSetting('bargeIn') !== false, 'checked');
  set('#streamingTts', S.getSetting('streamingTts') !== false, 'checked');
  set('#handsFree', S.getSetting('handsFree') !== false, 'checked');
  set('#offlineChat', S.getSetting('offlineChat') !== false, 'checked');
  set('#offlineBrain', S.getSetting('offlineBrain'), 'checked');
  set('#llmModelPath', S.getSetting('llmModelPath') || '');
  refreshLlmStatus();
  set('#porcupineKey', S.getSetting('porcupineKey') || '');
  set('#wakeKeyword', S.getSetting('wakeKeyword') || '');
  refreshVoskStatus();
  set('#neuralVoice', !!S.getSetting('neuralVoice'), 'checked');
  set('#offlineEars', !!S.getSetting('offlineEars'), 'checked');
  set('#embedModelPath', S.getSetting('embedModelPath') || '');
  set('#serverUrl', S.getSetting('serverUrl') || '');
  set('#serverToken', S.getSetting('serverToken') || '');
  set('#serverMode', S.getSetting('serverMode') !== false, 'checked');
  set('#appLock', S.getSetting('appLock') === true, 'checked');
  set('#cloudConsent', S.getSetting('cloudConsent') === true, 'checked');
  set('#auditEnabled', S.getSetting('auditEnabled') !== false, 'checked');
  set('#perfMonitor', S.getSetting('perfMonitor') === true, 'checked');
  set('#batteryGate', S.getSetting('batteryGate') !== false, 'checked');
  set('#aiCache', S.getSetting('aiCache') !== false, 'checked');
  set('#cinematic', S.getSetting('cinematic') !== false, 'checked');
  set('#highContrast', S.getSetting('highContrast') === true, 'checked');
  set('#textScale', S.getSetting('textScale') || '1');
  const pinRow = $('#appPinRow');
  if (pinRow) pinRow.style.display = S.getSetting('appLock') ? '' : 'none';
  const secxChip = $('#secxStatusChip');
  if (secxChip) {
    const d = SECX.dashboard();
    secxChip.textContent = `Security: ${d.appLock ? '🔒 locked · ' : ''}${d.cloudConsent ? 'cloud on · ' : 'local-first · '}${d.audits} audit events · ${d.alerts.length} alerts`;
  }
  set('#autoSetup', S.getSetting('autoSetup') !== false, 'checked');
  set('#callGuard', !!S.getSetting('callGuard'), 'checked');
  set('#callGuardTemplate', S.getSetting('callGuardTemplate') || '');
  set('#callGuardMode', S.getSetting('callGuardMode') || 'sms');
  set('#bootMode', S.getSetting('bootMode') || 'auto');
  set('#bootSound', !!S.getSetting('bootSound'), 'checked');
  /* v11.2 VOX */
  set('#wakeWords', S.getSetting('wakeWords') || 'hey friday, hello friday, friday, computer');
  set('#wakeSensitivity', S.getSetting('wakeSensitivity') || 60);
  set('#dangerConfirm', S.getSetting('dangerConfirm') !== false, 'checked');
  set('#duckAudio', S.getSetting('duckAudio') !== false, 'checked');
  set('#voxFeedback', S.getSetting('voxFeedback') !== false, 'checked');
  { const ws = $('#wakeSensValue'); if (ws) ws.textContent = S.getSetting('wakeSensitivity') || 60; }
  set('#autoEngine', S.getSetting('autoEngine') !== false, 'checked');            // v11.3
  renderRulesList();                                                            // v11.3
  refreshSherpaChips();
  refreshEmbedChip();
  const sr = $('#speechRateValue'); if (sr) sr.textContent = S.getSetting('speechRate') + 'x';
  const sp = $('#speechPitchValue'); if (sp) sp.textContent = S.getSetting('speechPitch');
  const ic = $('#intentCount'); if (ic) ic.textContent = intentCount();
}

/* v11.3 PHASE 5: Memory Dashboard renderer (dev page, REAL numbers only) */
function renderMemDash() {
  const out = $('#memDashOut');
  if (!out) return;
  try {
    const d = MEMEX.dashboard();
    out.textContent = [
      `facts ${d.facts} · digests ${d.summaries} · episodes ${d.episodes}`,
      `vision ${d.vision} · qr ${d.qr} · prefs ${d.preferenceRows}`,
      `storage ${MEMEX.fmtBytes(d.storageBytes)} · retrieval ${d.retrievalMs}ms (${d.probeHits} hits)`,
      `embeddings: ${d.embeddings}`,
      `last sync: ${d.lastSync}`,
      d.topPreferences.length ? 'prefs: ' + d.topPreferences.map(p => p.intent + '×' + p.n).join(', ') : 'prefs: (3+ uses pe track)'
    ].join('\n');
  } catch (e) { out.textContent = 'dashboard error: ' + (e && e.message); }
}

/* v11.3 PHASE 7: Rules list with toggle switches (Settings) */
function renderRulesList() {
  const box = $('#ruleList');
  if (!box) return;
  const rs = AUTOX.rules();
  if (!rs.length) { box.innerHTML = '<p class="hint">Koi rule nahi abhi.</p>'; return; }
  box.innerHTML = '';
  rs.forEach(r => {
    const row = document.createElement('div');
    row.className = 'setting-item rule-row';
    const label = document.createElement('label');
    label.textContent = (r.name || r.then.slice(0, 28)) + '  ·  ' + r.when +
      (r.when === 'battery_low' ? ' <' + (r.level ?? 20) + '%' : r.when === 'time' ? ' @' + (r.at || '--:--') : '');
    const wrap = document.createElement('div');
    wrap.className = 'toggle-switch';
    const inp = document.createElement('input');
    inp.type = 'checkbox'; inp.checked = !!r.enabled;
    inp.addEventListener('change', () => { AUTOX.toggleRule(r.id, inp.checked); U.toast(`${r.name || 'Rule'} ${inp.checked ? 'ON' : 'OFF'}`, '⚙️', 1400); });
    const span = document.createElement('span'); span.className = 'toggle-slider';
    wrap.appendChild(inp); wrap.appendChild(span);
    row.appendChild(label); row.appendChild(wrap);
    box.appendChild(row);
  });
}

/* ================= SERVICE WORKER ================= */
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* Last-resort watchdog recovery. Optional initialization may be slow, but the
   shell must remain usable. This never marks a failed component READY. */
addEventListener('friday:boot-timeout', () => {
  const fatal = BOOT.mandatoryFailure();
  if (fatal) { Logger.error('boot', 'mandatory failure: ' + fatal.name + ' — ' + fatal.detail); return; }
  Logger.warn('boot', 'watchdog recovery: revealing offline HUD');
  for (const row of BOOT.all()) if (row.state === BOOT_STATE.PENDING && !row.mandatory)
    BOOT.set(row.name, BOOT_STATE.LIMITED, 'initialization slow; continuing offline');
  startApp().then(() => { window.__booted = BOOT.finish(); window.__stage = 'online-limited'; }).catch(() => {});
});

/* Robust boot: module scripts normally run before DOMContentLoaded, but if
   the WebView already fired it (cache race) we must not wait forever. */
window.__stage = 'module-loaded';
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// expose for debugging
window.FRIDAY = { state, handleInput, S, API, AI };

/* ================= v7.6 QUIZ ENGINE ================= */
async function startQuiz(topic) {
  if (!AI.hasGroq()) {
    reply('Quiz master needs the cloud brain - configure FRIDAY Cloud on the server, then ask again.');
    return;
  }
  thinking(true);
  let qs = null;
  try {
    const out = await AI.callGroq([
      { role: 'system', content: 'You write school quizzes. Reply ONLY a JSON array of exactly 5 objects like [{"q":"question","a":"answer"}]. Short factual questions, one-line answers, mixed difficulty.' },
      { role: 'user', content: 'Quiz topic: ' + topic }
    ], { maxTokens: 700 });
    const m = String(out || '').match(/\[[\s\S]*\]/);
    qs = m ? JSON.parse(m[0]) : null;
  } catch (e) {}
  thinking(false);
  if (!qs || !qs.length) { reply('Could not build a quiz on that. Try "quiz me on photosynthesis" or "quiz me on Indian history".'); return; }
  state.quiz = { topic, qs: qs.slice(0, 5), i: 0, score: 0 };
  reply(`📝 **Quiz: ${topic}** - 5 questions, answer in one line.\n\n**Q1.** ${state.quiz.qs[0].q}`);
  state.expect = 'quiz_answer';
}

function quizAnswer(text) {
  const qz = state.quiz;
  if (!qz) return true;
  const cur = qz.qs[qz.i];
  const expected = String(cur.a || '').toLowerCase();
  const got = text.toLowerCase();
  const key = expected.split(/[,;(]/)[0].trim();
  const words = key.split(/\s+/).filter(w => w.length > 3);
  const hits = words.filter(w => got.includes(w)).length;
  const good = (key && got.includes(key)) || (words.length && hits >= Math.max(1, Math.ceil(words.length * 0.6)));
  if (good) qz.score++;
  qz.i++;
  if (qz.i >= qz.qs.length) {
    state.quiz = null;
    reply(`🏁 Quiz finished! Score: **${qz.score}/${qz.qs.length}**` +
      (qz.score === qz.qs.length ? ' - PERFECT. Subject mastered, boss.' :
       qz.score >= 3 ? ' - solid. One more round?' : ' - keep practicing, you will get there.'));
    return true;
  }
  reply(`${good ? '✅ Correct!' : '❌ Answer: **' + cur.a + '**'}\n\n**Q${qz.i + 1}.** ${qz.qs[qz.i].q}\n\n(Score: ${qz.score})`);
  return true;
}
