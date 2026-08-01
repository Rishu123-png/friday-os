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
import { humanTime, parseTime, pick } from './nlp.js';

const $ = U.$, $$ = U.$$;

const state = {
  listening: false, speaking: false, processing: false,
  messages: [], expect: null, lastTopic: null, lastSubject: null, booted: false,
  vaultPending: null
};

/* ================= BOOT ================= */
async function boot() {
  const pcts = [12, 28, 44, 60, 76, 90, 100];
  const steps = I18N.bootSteps().map((txt, i) => [txt, pcts[i]]);
  const bar = $('.boot-progress-bar'), status = $('.boot-status');
  for (const [txt, pct] of steps) {
    window.__stage = 'boot:' + txt;
    if (status) status.textContent = txt + '...';
    if (bar) bar.style.width = pct + '%';
    await sleep(260 + Math.random() * 180);
  }
  await sleep(320);
  const bs = $('#bootScreen');
  bs.classList.add('fade-out');
  await sleep(700);
  bs.style.display = 'none';
  $('#app').classList.remove('hidden');
  window.__stage = 'init';
  Promise.resolve().then(init).then(() => { window.__booted = true; window.__stage = 'idle'; })
    .catch(err => {
      window.__stage = 'init-failed';
      setTimeout(() => { throw new Error('init failed: ' + (err && err.message || err)); });
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= INIT ================= */
async function init() {
  state.booted = true;

  U.applyTheme(S.getSetting('uiTheme') || 'stark');
  U.initCore($('#coreCanvas'), state);
  U.initParticles($('#particleCanvas'));
  U.animateWaveform($('#voiceWaveform'), state);

  await V.initSynthesis();
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
      state.listening = false;
      $('#micButton').classList.remove('listening');
      $('#micContainer')?.classList.remove('listening'); $('#inputWave')?.classList.remove('on');
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
  if (!S.getSetting('showWidgets')) $('#dashWidgets').style.display = 'none';
  loadWeatherWidget();

  /* v7.7 HUD: arc-reactor rings (battery/steps) + systems status line */
  updateReactor();
  computeSystemsLine();
  setInterval(updateReactor, 60000);
  setInterval(computeSystemsLine, 120000);
  setInterval(() => { const mc = $('#micContainer'); if (mc) mc.classList.toggle('speaking', !!state.speaking); }, 700);

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

  updateBrainBadge();
  MEM.learnPatterns();
  AUTO.start(execAction);
  initNative();
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
  const on = AI.hasGroq();
  el.innerHTML = `<span class="dot ${on ? 'cloud' : ''}"></span> ${on ? 'Cloud' : 'Offline'}`;
  const sp = $('#sysProvider');
  if (sp) sp.textContent = on ? 'Groq' : 'Local';
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

async function handleInput(text, opts = {}) {
  text = String(text || '').trim();
  if (!text) return;

  /* v7.6.4: drop duplicate submissions (voice double-final, STT retries) —
     same text within 4s is an echo, not a new command. */
  clearTimeout(state.talkWait);   // v7.8: user spoke - cancel the Karen nudge
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
  }

  // follow-up capture ("What should I remind you about?")
  if (state.expect) {
    const kind = state.expect;
    state.expect = null;
    if (kind === 'note_text') { S.addItem(KEYS.NOTES, { text }); refresh('notes'); return reply(`Saved: "${text}"`); }
    if (kind === 'reminder_text') return handleInput('remind me to ' + text);
    if (kind === 'task_text') { S.addItem(KEYS.TASKS, { text, done: false }); refresh('tasks'); return reply(`Task added: "${text}"`); }
    if (kind === 'vault_pin') return handleVaultPin(text);
    if (kind === 'password_check_text') return auditPassword(text.replace(/["']/g, '').trim());
    if (kind === 'phish_link') return judgeLink(text);
    if (kind === 'quiz_answer') return quizAnswer(text);
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
  if (hit) {
    state.lastTopic = hit.intent;
    state.lastSubject = hit.action?.query || hit.action?.word || hit.action?.dest || null;
    if (hit.expect) state.expect = hit.expect;
    if (hit.action) {
      const handled = await runAction(hit.action, hit);
      if (handled !== false) {
        if (hit.say) reply(hit.say);
        (hit.refresh || []).forEach(refresh);
        return;
      }
    } else {
      if (hit.say) reply(hit.say);
      (hit.refresh || []).forEach(refresh);
      return;
    }
  }

  // 2) CLOUD (only if key present)
  if (AI.hasGroq()) return askGroq(text);

  // 2.5) OFFLINE LLM CHAT — real conversation with no key, if a local
  //      model is installed (Settings -> Offline Coder -> chat model).
  if (S.getSetting('offlineChat') !== false && CODER.ready()) return streamLocalChat(text);

  // 3) OFFLINE COMPOSER
  reply(AI.offlineReply(text));
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
      context: MEM.buildContext(),
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
      const hit = await NAT.findContact(a.name);
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
      reply(r.ok ? pick(['Done.', 'Got it.', 'Playing.']) : "Couldn't control media.");
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
      const r = await NAT.replyNotification(a.app || '', a.text);
      if (r.ok) reply(`Reply sent${r.app ? ' in ' + NAT.friendlyApp(r.app) : ''}.`);
      else if (r.reason === 'no_listener') { reply('I need notification access for that. Opening settings.'); NAT.openSpecialSetting('notification_listener'); }
      else if (r.reason === 'not_found') reply('No replyable notification found — nothing waiting for an answer.');
      else reply('That notification cannot take replies.');
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
        reply('Focus mode off. Notifications are back. Well done.');
        return true;
      }
      const mins = a.minutes || 25;
      await HEALTH.startFocus(mins, () => {
        addMsg('ai', `⏱ Focus session done (${mins} min). Take a breath - you earned it.`, { proactive: true });
        V.speak(`Focus session complete. Well done, ${S.getSetting('userName') || 'boss'}.`);
      });
      reply(`⏱ **Focus mode: ${mins} minutes.** Do Not Disturb is ON, my announcements are muted. Go.`);
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
          reply('📝 **Local summary:**\n' + first.slice(0, 700) + '\n\n(Add a free Groq key in Settings for smarter summaries.)');
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
        if (m[3] === 'pm' && hh < 12) hh += 12;
        if (m[3] === 'am' && hh === 12) hh = 0;
        target = list.find(x => parseInt(x.time.split(':')[0], 10) === hh);
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
  const rows = [
    { name: 'Notification read/reply', ok: !!caps.notifications, fix: 'Special access > Notification access > FRIDAY OS ON' },
    { name: 'FRIDAY Control (screen taps)', ok: !!caps.accessibility, fix: 'Accessibility > FRIDAY Control > ON' },
    { name: 'Floating bubble overlay', ok: !!caps.overlay, fix: 'Display over other apps > FRIDAY OS > Allow' },
    { name: 'Contacts', ok: !!caps.contacts, fix: 'say "permissions" or Settings > Apps > FRIDAY OS' },
    { name: 'SMS', ok: !!caps.sendSms, fix: 'Settings > Apps > FRIDAY OS > Permissions > SMS' },
    { name: 'Phone calls', ok: !!caps.phone, fix: 'Settings > Apps > FRIDAY OS > Permissions > Phone' }
  ];
  state.systemsRows = rows;
  const bad = rows.filter(r => !r.ok).length;
  el.className = 'systems-line ' + (bad ? 'warn' : 'ok');
  el.textContent = bad
    ? `${bad} SYSTEM${bad > 1 ? 'S' : ''} NEED${bad > 1 ? '' : 'S'} ATTENTION - TAP HERE`
    : 'ALL SYSTEMS NOMINAL';
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
    reply(`Couldn't find "${q}". Try rephrasing, or add a Groq key in Settings for open questions.`);
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
      out.innerHTML = U.renderRich(`I have offline templates for: **${T.codeTopics().join(', ')}**.\n\nFor code written specifically for your request, add a free Groq key in Settings (console.groq.com — no card needed), or install the offline coder (Settings → Offline Coder).`);
      reply('No offline template matches that. Add a Groq key, or download the offline coder.');
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
      case 'tell_battery': { const b = await D.battery(); return b ? `${b.level}%${b.charging ? ' charging' : ''}` : 'unknown'; }
      default: return 'Unknown tool';
    }
  } catch (e) { return 'Tool failed: ' + (e.message || e); }
}

async function contactByName(name) {
  const q = String(name || '').toLowerCase().trim();
  if (!q) return null;
  if (NAT.isNative()) { const h = await NAT.findContact(q); if (h) return h; }
  return S.getList(KEYS.CONTACTS).find(c => c.name.toLowerCase().includes(q)) || null;
}

const ACTIONISH = /\b(set|remind|alarm|wake|call|text|message|whatsapp|note|task|timer|weather|battery|time|schedule|notifications?|reminders?|steps?|screen|doing|working|status|location|wifi|charging)\b/i;

async function askGroq(text) {
  thinking(true);
  const history = state.messages.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text
  }));
  const ctxBrief = MEM.buildContext({ maxFacts: 22, maxPatterns: 6 });
  const sys = AI.systemPrompt() + (ctxBrief ? '\n\n' + ctxBrief : '') +
    '\nIf the user asks you to DO something (remind, alarm, call, message, note, weather...), use the appropriate tool. Confirm briefly afterward.';
  const msgs = [{ role: 'system', content: sys }, ...history, { role: 'user', content: text }];

  // streaming TTS: speech starts on the first complete sentence
  const useFeed = S.getSetting('streamingTts') !== false && S.getSetting('voiceOutput');
  const feed = useFeed ? V.createSpeechFeed({
    onStart: () => { state.speaking = true; },
    onDone: () => { state.speaking = false; }
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
      V.speak(final, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
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
  if (m.includes('BAD_KEY')) return 'That Groq key was rejected. Check it in Settings.';
  if (m.includes('RATE_LIMIT')) return 'Groq rate limit hit. Wait a moment, or switch to offline mode.';
  if (m.includes('NO_KEY')) return 'No key set. Running offline.';
  return 'Connection failed. Offline engine still works — try a command.';
}

/* ================= NATIVE (Phase B + C) ================= */
let recentNotifs = [];
let nativeCaps = { native: false };

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

async function initNative() {
  try {
  window.__stage = 'native:capabilities';
  nativeCaps = await NAT.capabilities();
  if (!nativeCaps.native) return;

  // v7.4.3: ask for the mic (etc.) ONCE, so the first mic tap never errors
  try {
    window.__stage = 'native:ask-permissions';
    if (!S.getSetting('permsAsked')) {
      const mic = await NAT.checkPermission('android.permission.RECORD_AUDIO');
      if (!mic || !mic.granted) await NAT.requestAll();
      S.setSetting('permsAsked', true);
    }
  } catch (e) { /* system dialog may not show yet - first mic tap asks again */ }

  // keep FRIDAY alive in the background
  if (S.getSetting('backgroundService') !== false) {
    window.__stage = 'native:foreground-service';
    NAT.startForegroundService({ wakeWord: S.getSetting('wakeWord') }).catch(() => {});
  }
  if (S.getSetting('bootStart')) NAT.setBootStart(true);

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
  if (HEALTH.inFocus()) return;   // focus mode: collect silently, announce nothing

  const allow = S.getSetting('announceApps') || NAT.ANNOUNCE_DEFAULTS;
  if (!allow.includes(n.pkg)) return;
  if (!S.getSetting('announceNotifications')) return;
  if (state.listening || state.speaking) return;

  const app = NAT.friendlyApp(n.pkg);
  const who = S.getSetting('userName') || 'Boss';
  const line = n.title
    ? `${who}, ${app} from ${n.title}. ${n.text}`.slice(0, 220)
    : `${who}, ${app}: ${n.text}`.slice(0, 220);

  addMsg('ai', `\ud83d\udd14 **${app}** - ${n.title || ''}\n${n.text}`, { proactive: true });
  V.speak(line, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
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
    ['notification_listener', 'notification access', 'so I can read and announce your notifications'],
    ['overlay', 'display over other apps', 'for the floating bubble'],
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
function armTalkWait(questionText) {
  clearTimeout(state.talkWait);
  if (!/\?\s*$/.test(String(questionText || '').trim())) return;
  /* v8.0 hands-free: when she asks something, she opens her own ears for the
     answer - a real back-and-forth. (Skipped when a wake word guards the mic:
     then the wake phrase re-opens the conversation instead.) */
  const handsFree = S.getSetting('handsFree') !== false;
  if (handsFree && NAT.isNative() && S.getSetting('voiceOutput') && !S.getSetting('wakeWord')) {
    state.talkWait = setTimeout(() => {
      state.talkWait = null;
      if (state.listening || state.speaking || document.hidden) return;
      V.listen();
    }, 1600);
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

function reply(text) {
  if (state.tonePrefix) { text = state.tonePrefix + ' ' + text; state.tonePrefix = null; }
  addMsg('ai', text);
  S.remember('ai', text);
  V.speak(text, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
  armTalkWait(text);
}

function addMsg(role, text, opts = {}) {
  const msg = { role, text, time: Date.now() };
  state.messages.push(msg);
  saveChat();
  const el = buildMsgEl(msg, opts);
  $('#chatMessages').appendChild(el);
  scrollBottom();
  updateCounters();
  return opts.returnEl ? el : null;
}

function buildMsgEl(msg, opts = {}) {
  const div = document.createElement('div');
  div.className = 'message ' + msg.role;
  const label = msg.role === 'user' ? 'You' : AI.persona().name;
  const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const link = opts.link ? `<a class="msg-link" href="${opts.link}" target="_blank" rel="noopener">Read more →</a>` : '';
  if (opts.proactive) div.classList.add('proactive');
  /* v8.0 Badge of Truth: shows whether an answer came from live phone data */
  const badge = opts.source === 'live' ? ' <span class="src-badge live" title="Built from LIVE on-device data">&#9889; live</span>'
              : opts.source === 'mind' ? ' <span class="src-badge mind" title="From general knowledge - not live phone data">&#128173; mind</span>' : '';
  div.innerHTML = `<div class="message-bubble">${U.renderRich(msg.text)}${link}</div>
    <div class="message-meta"><span class="message-label">${label}${badge}</span><span>${time}</span></div>`;
  return div;
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
  const c = $('#chatMessages');
  state.messages.slice(-60).forEach(m => c.appendChild(buildMsgEl(m)));
  scrollBottom();
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
    const LN = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LN || !LN.schedule) return false;
    if (LN.requestPermissions) await LN.requestPermissions();
    await LN.schedule({ notifications: [{
      id: notifId(item.id),
      title: 'FRIDAY — Reminder',
      body: item.text,
      schedule: { at: new Date(item.due), allowWhileIdle: true },
      smallIcon: 'ic_stat_icon'
    }]});
    return true;
  } catch (e) { console.warn('[reminders] native schedule failed', e); return false; }
}

function scheduleReminder(item) {
  scheduleNativeReminder(item);   // background-safe path (APK)
  const delay = item.due - Date.now();
  if (delay < 0 || delay > 2 ** 31 - 1) return;
  clearTimeout(timers.get(item.id));
  timers.set(item.id, setTimeout(async () => {
    if (item.wa) {
      try {
        const c = await NAT.findContact(item.wa.name);
        const num = c && (c.phone || c.number);
        if (num) {
          const r = await NAT.whatsappSend(num, item.wa.msg, true);
          /* v7.6.4: only claim "sent" when the accessibility auto-press actually
             ran - otherwise be honest that the chat is open and needs one tap */
          D.notify('FRIDAY',
            r && r.ok
              ? (r.autoSend ? 'WhatsApp sent to ' : 'WhatsApp is open for ') + item.wa.name
              : 'Could not send WhatsApp to ' + item.wa.name,
            item.id);
        } else {
          D.notify('FRIDAY', 'No number saved for ' + item.wa.name, item.id);
        }
      } catch (e) { D.notify('FRIDAY', 'Scheduled WhatsApp failed', item.id); }
      S.updateItem(KEYS.REMINDERS, item.id, { done: true });
      refresh('reminders');
      return;
    }
    D.buzz();
    D.notify('FRIDAY — Reminder', item.text, item.id);
    U.toast(item.text, '⏰', 6000);
    V.speak(`Reminder: ${item.text}`);
    S.updateItem(KEYS.REMINDERS, item.id, { done: true });
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
  el.innerHTML = items.map(([k, label]) =>
    `<div class="cap-row ${nativeCaps[k] ? 'on' : 'off'}"><span>${nativeCaps[k] ? '\u25cf' : '\u25cb'}</span> ${label}</div>`
  ).join('');
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
async function openCamera(mode = 'photo') {
  camMode = mode;
  const view = $('#cameraView');
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
}
function startScan() {
  clearInterval(scanLoop);
  scanLoop = setInterval(async () => {
    const r = await D.scanBarcode($('#cameraFeed'));
    if (r?.value) {
      clearInterval(scanLoop);
      D.buzz();
      closeCamera();
      const isUrl = /^https?:\/\//.test(r.value);
      addMsg('ai', `Scanned: ${r.value}`, isUrl ? { link: r.value } : {});
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
    if (state.listening) V.stopListening(); else V.listen();
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
      translate: () => U.openPanel('sub-translate')
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
          : U.emptyState('This needs a Groq key. Settings → Brain → paste key. Free at console.groq.com');
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
      out.innerHTML = `<div class="ocr-out">${U.escapeHtml(r.text)}</div>
        <div class="dim">Confidence ${r.confidence}%</div>
        <button class="tool-add-btn" id="ocrCopy">Copy text</button>`;
      $('#ocrCopy').onclick = () => D.copy(r.text).then(() => U.toast('Text copied', '📋'));
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
      S.setSetting(key, v);
      onSettingChange(key, v);
    });
  };
  bind('#aiProvider', 'aiProvider');
  bind('#groqKey', 'groqKey', 'input');
  bind('#groqModel', 'groqModel');
  bind('#aiPersonality', 'personality');
  bind('#userName', 'userName', 'input');
  bind('#voiceOutput', 'voiceOutput', 'change', 'checked');
  bind('#wakeWord', 'wakeWord', 'change', 'checked');
  bind('#speechRate', 'speechRate', 'input');
  bind('#speechPitch', 'speechPitch', 'input');
  bind('#voiceLang', 'voiceLang');
  bind('#uiTheme', 'uiTheme');
  bind('#particleEffects', 'particleEffects', 'change', 'checked');
  bind('#showWidgets', 'showWidgets', 'change', 'checked');
  bind('#saveMemory', 'saveMemory', 'change', 'checked');
  bind('#backgroundService', 'backgroundService', 'change', 'checked');
  bind('#bootStart', 'bootStart', 'change', 'checked');
  bind('#announceNotifications', 'announceNotifications', 'change', 'checked');
  bind('#bubbleEnabled', 'bubbleEnabled', 'change', 'checked');
  bind('#hindiUI', 'hindiUI', 'change', 'checked');
  bind('#batteryWarnFull', 'batteryWarnFull', 'change', 'checked');
  bind('#waCC', 'waCountryCode', 'input');
  bind('#bargeIn', 'bargeIn', 'change', 'checked');
  bind('#streamingTts', 'streamingTts', 'change', 'checked');
  bind('#handsFree', 'handsFree', 'change', 'checked');
  bind('#offlineChat', 'offlineChat', 'change', 'checked');
  bind('#porcupineKey', 'porcupineKey', 'input');

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

  $('#testKeyBtn')?.addEventListener('click', async () => {
    const k = $('#groqKey').value.trim();
    const btn = $('#testKeyBtn');
    if (!k) return U.toast('Paste a key first', '⚠️');
    btn.textContent = 'Testing…';
    const r = await AI.testGroqKey(k);
    btn.textContent = 'Test Key';
    U.toast(r.msg, r.ok ? '✅' : '❌', 3500);
    updateBrainBadge();
  });

  $('#clearKeyBtn')?.addEventListener('click', () => {
    S.setSetting('groqKey', '');
    $('#groqKey').value = '';
    updateBrainBadge();
    U.toast('Key removed — offline mode', '🔒');
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
  addEventListener('online', () => { U.toast('Back online'); AUTO.runTrigger('online'); });
  addEventListener('offline', () => { U.toast('Offline - local engine active'); AUTO.runTrigger('offline'); });

  // back button closes panels
  addEventListener('popstate', () => { if (U.anyPanelOpen()) U.closeAllPanels(); });
}

function onSettingChange(key, v) {
  if (key === 'uiTheme') U.applyTheme(v);
  if (key === 'groqKey') updateBrainBadge();
  if (key === 'speechRate') $('#speechRateValue').textContent = v + 'x';
  if (key === 'speechPitch') $('#speechPitchValue').textContent = v;
  if (key === 'wakeWord') { v ? V.startWakeWord() : V.stopWakeWord(); U.toast(v ? 'Wake word on — say "Hey Friday"' : 'Wake word off', '🎙️'); }
  if (key === 'showWidgets') $('#dashWidgets').style.display = v ? 'grid' : 'none';
  if (key === 'backgroundService' && NAT.isNative()) {
    v ? NAT.startForegroundService({}) : NAT.stopForegroundService();
    if (v && !S.getSetting('batOptAsked')) {
      S.setSetting('batOptAsked', true);
      U.toast('One-time: set FRIDAY battery to Unrestricted so the phone never kills me', '🔋');
      NAT.openSpecialSetting('battery_optimization').catch(() => {});
    }
  }
  if (key === 'bootStart' && NAT.isNative()) {
    NAT.setBootStart(v);
    if (v) U.toast('Infinix/XOS also needs - Settings > Apps > FRIDAY OS > Auto-start ON', '🛡');
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
}

function syncSettingsUI() {
  const set = (sel, val, prop = 'value') => { const e = $(sel); if (e) e[prop] = val; };
  set('#aiProvider', S.getSetting('aiProvider'));
  set('#groqKey', S.getSetting('groqKey'));
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
  set('#bubbleEnabled', S.getSetting('bubbleEnabled'), 'checked');
  set('#hindiUI', S.getSetting('hindiUI'), 'checked');
  set('#batteryWarnFull', S.getSetting('batteryWarnFull'), 'checked');
  set('#waCC', S.getSetting('waCountryCode') || '91');
  set('#bargeIn', S.getSetting('bargeIn') !== false, 'checked');
  set('#streamingTts', S.getSetting('streamingTts') !== false, 'checked');
  set('#handsFree', S.getSetting('handsFree') !== false, 'checked');
  set('#offlineChat', S.getSetting('offlineChat') !== false, 'checked');
  set('#porcupineKey', S.getSetting('porcupineKey') || '');
  const sr = $('#speechRateValue'); if (sr) sr.textContent = S.getSetting('speechRate') + 'x';
  const sp = $('#speechPitchValue'); if (sp) sp.textContent = S.getSetting('speechPitch');
  const ic = $('#intentCount'); if (ic) ic.textContent = intentCount();
}

/* ================= SERVICE WORKER ================= */
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

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
    reply('Quiz master needs the cloud brain - paste the free Groq key in Settings once, then ask again.');
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
  reply(`📝 **Quiz: ${topic}** - 5 questions, answer in one line.\\n\\n**Q1.** ${state.quiz.qs[0].q}`);
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
  reply(`${good ? '✅ Correct!' : '❌ Answer: **' + cur.a + '**'}\\n\\n**Q${qz.i + 1}.** ${qz.qs[qz.i].q}\\n\\n(Score: ${qz.score})`);
  return true;
}
