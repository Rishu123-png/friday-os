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
import { humanTime, parseTime, pick } from './nlp.js';

const $ = U.$, $$ = U.$$;

const state = {
  listening: false, speaking: false, processing: false,
  messages: [], expect: null, lastTopic: null, lastSubject: null, booted: false
};

/* ================= BOOT ================= */
async function boot() {
  const steps = [
    ['Loading core systems', 12],
    ['Initializing intent engine', 28],
    ['Calibrating voice modules', 44],
    ['Mounting memory banks', 60],
    ['Loading personality matrix', 76],
    ['Establishing links', 90],
    ['FRIDAY OS online', 100]
  ];
  const bar = $('.boot-progress-bar'), status = $('.boot-status');
  for (const [txt, pct] of steps) {
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
  init();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= INIT ================= */
function init() {
  state.booted = true;

  U.applyTheme(S.getSetting('uiTheme'));
  U.initCore($('#coreCanvas'), state);
  U.initParticles($('#particleCanvas'));
  U.animateWaveform($('#voiceWaveform'), state);

  V.initSynthesis();
  V.initRecognition({
    onStart: () => { state.listening = true; setStatus('Listening...', true); $('#micButton').classList.add('listening'); D.tap(); },
    onInterim: txt => { $('#listeningText').textContent = txt; },
    onFinal: txt => { handleInput(txt); },
    onEnd: () => { state.listening = false; setStatus('Tap to speak'); $('#micButton').classList.remove('listening'); },
    onError: err => {
      state.listening = false;
      $('#micButton').classList.remove('listening');
      const msgs = {
        'no-speech': 'Didn\'t catch that. Tap to retry.',
        'not-allowed': 'Microphone blocked. Enable it in settings.',
        'mic-denied': 'Microphone blocked.',
        'unsupported': 'Voice not supported in this browser.',
        'network': 'Voice needs internet. Type instead.'
      };
      setStatus(msgs[err] || 'Voice error. Tap to retry.');
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

  // greeting
  const p = AI.persona();
  const hour = new Date().getHours();
  const tod = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const learnedName = MEM.getFact('user.name');
  if (learnedName && !S.getSetting('userName')) S.setSetting('userName', learnedName);
  const name = S.getSetting('userName') || learnedName || p.address;
  const greet = state.messages.length
    ? `${tod}, ${name}. Systems online.`
    : (learnedName ? `${tod}, ${name}. Systems online.` : p.greeting);
  addMsg('ai', greet);
  V.speak(greet, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });

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
async function handleInput(text, opts = {}) {
  text = String(text || '').trim();
  if (!text) return;

  // ---- command chaining: "remind me X and add task Y" ----
  if (!opts.noChain) {
    const parts = NLU.splitCommands(text);
    if (parts.length > 1) {
      addMsg('user', text);
      MEM.logEpisode({ text, intent: 'chain', role: 'user' });
      for (const part of parts) {
        await handleInput(part, { noChain: true, silentEcho: true });
      }
      return;
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

  // mood detection -> tone
  const mood = NLU.sentiment(text);
  state.mood = mood;

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

  // 3) OFFLINE COMPOSER
  reply(AI.offlineReply(text));
}

/* ================= ACTIONS ================= */
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
    case 'whatsapp': D.whatsapp(a.number, a.body); return true;
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

    case 'read_notifications': {
      if (!NAT.isNative()) { reply(nativeOnly('notification reading')); return true; }
      const caps = await NAT.capabilities();
      if (!caps.notifications) {
        reply('I need notification access first. Opening settings - find FRIDAY and enable it.');
        NAT.openSpecialSetting('notification_listener');
        return true;
      }
      if (!recentNotifs.length) { reply('Nothing new.'); return true; }
      const lines = recentNotifs.slice(0, 5)
        .map(n => `${NAT.friendlyApp(n.pkg)} - ${n.title}: ${n.text}`.slice(0, 120));
      reply(`${recentNotifs.length} recent:\n` + lines.map(l => '\u2022 ' + l).join('\n'));
      return true;
    }

    case 'setup': { await runSetup(); return true; }


    case 'alarm_add': {
      const rec = AUTO.addAlarm(a.alarm);
      refresh('alarms');
      const when = AUTO.describeAlarm(rec);
      const next = new Date(AUTO.nextOccurrence(rec));
      reply(`Alarm set \u2014 ${rec.label} at ${when}. That's ${humanTime(next)}.`);
      D.notifyPermission();
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
        AUTO.addGeofence({ name: place, lat: pos.lat, lon: pos.lon, radius: 250, onEnter: 'good morning' });
        refresh('geofences');
        reply(`Saved this spot as "${place}". I'll alert you when you arrive.`);
      } catch (e) { reply('I need location access for that.'); }
      return true;
    }

    case 'recall': {
      const hits = MEM.recall(a.query).filter(h =>
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

  const tasks = S.getList(KEYS.TASKS).filter(t => !t.done);
  if (tasks.length) bits.push(`${tasks.length} open task${tasks.length === 1 ? '' : 's'}.`);

  const b = await D.battery();
  if (b) bits.push(`Battery at ${b.level}%${b.charging ? ' and charging' : ''}.`);

  thinking(false);
  reply(bits.join(' '));
}

/* ---------- Coding ---------- */
async function doCode(prompt) {
  if (!AI.hasGroq()) {
    U.openPanel('sub-coder');
    const tpl = T.offlineCode(prompt);
    const out = $('#codeResult');
    if (tpl) {
      out.innerHTML = U.renderRich(tpl.body);
      reply(`No cloud key, so here's an offline template: ${tpl.title}. Check the Coder panel.`);
    } else {
      out.innerHTML = U.renderRich(`I have offline templates for: **${T.codeTopics().join(', ')}**.\n\nFor code written specifically for your request, add a free Groq key in Settings (console.groq.com — no card needed).`);
      reply('No offline template matches that. Add a Groq key in Settings for real coding.');
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

/* ---------- Groq chat (streaming) ---------- */
async function askGroq(text) {
  thinking(true);
  const history = state.messages.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text
  }));
  const ctxBrief = MEM.buildContext();
  const sys = AI.systemPrompt() + (ctxBrief ? '\n\n' + ctxBrief : '');
  const msgs = [{ role: 'system', content: sys }, ...history, { role: 'user', content: text }];

  let el = null, acc = '';
  try {
    const full = await AI.callGroq(msgs, {
      stream: true,
      maxTokens: 1500,
      onToken: (_, sofar) => {
        acc = sofar;
        if (!el) { hideTyping(); el = addMsg('ai', '', { returnEl: true }); }
        el.querySelector('.message-bubble').innerHTML = U.renderRich(sofar);
        scrollBottom();
      }
    });
    thinking(false);
    const final = full || acc;
    if (el) {
      el.querySelector('.message-bubble').innerHTML = U.renderRich(final);
      const rec = state.messages[state.messages.length - 1];
      if (rec) { rec.text = final; saveChat(); }
    } else {
      addMsg('ai', final);
    }
    S.remember('ai', final);
    V.speak(final, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
  } catch (e) {
    thinking(false);
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

async function initNative() {
  nativeCaps = await NAT.capabilities();
  if (!nativeCaps.native) return;

  // keep FRIDAY alive in the background
  if (S.getSetting('backgroundService') !== false) {
    NAT.startForegroundService({ wakeWord: S.getSetting('wakeWord') });
  }
  if (S.getSetting('bootStart')) NAT.setBootStart(true);

  // pull real contacts into the local store
  if (nativeCaps.contacts) {
    const list = await NAT.loadContacts();
    if (list && list.length) {
      S.saveList(KEYS.CONTACTS, list.slice(0, 500).map(c => ({
        id: 'sys_' + c.id, name: c.name, phone: c.phone, created: Date.now()
      })));
      refresh('contacts');
    }
  }

  // notification listener
  if (nativeCaps.notifications) {
    NAT.startNotificationListener();
    NAT.onNotification(handleNotification);
  }

  updateBrainBadge();
  renderCaps();
}

function handleNotification(n) {
  recentNotifs.unshift(n);
  recentNotifs = recentNotifs.slice(0, 40);

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
function reply(text) {
  addMsg('ai', text);
  S.remember('ai', text);
  V.speak(text, { onStart: () => state.speaking = true, onEnd: () => state.speaking = false });
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
  div.innerHTML = `<div class="message-bubble">${U.renderRich(msg.text)}${link}</div>
    <div class="message-meta"><span class="message-label">${label}</span><span>${time}</span></div>`;
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
function scheduleReminder(item) {
  const delay = item.due - Date.now();
  if (delay < 0 || delay > 2 ** 31 - 1) return;
  clearTimeout(timers.get(item.id));
  timers.set(item.id, setTimeout(() => {
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
  if (what === 'alarms') renderAlarms();
  if (what === 'routines') renderRoutines();
  if (what === 'geofences') renderGeofences();
  if (what === 'activity') { renderAlarms(); renderRoutines(); renderGeofences(); renderRunLog(); renderFacts(); }
  if (what === 'notes') renderList(KEYS.NOTES, '#notesList', '#notesData', 'No notes yet');
  if (what === 'reminders') renderReminders();
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
    ['contacts', 'Real contacts'], ['notifications', 'Notification reading'],
    ['sms', 'Read SMS / OTP'], ['sendSms', 'Send SMS'], ['phone', 'Direct calling'],
    ['overlay', 'Floating bubble'], ['accessibility', 'System gestures'],
    ['apps', 'Launch apps'], ['toggles', 'System toggles'], ['background', 'Background service']
  ];
  if (!nativeCaps.native) {
    el.innerHTML = '<div class="cap-row off"><span>\u25cb</span> Browser mode \u2014 install the APK to unlock phone features</div>';
    return;
  }
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
      if (p === 'settings') renderCaps();
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
    }
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
  if (key === 'backgroundService' && NAT.isNative()) v ? NAT.startForegroundService({}) : NAT.stopForegroundService();
  if (key === 'bootStart' && NAT.isNative()) NAT.setBootStart(v);
  if (key === 'bubbleEnabled' && NAT.isNative()) runAction({ type: 'bubble', on: v }, {});
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
  const sr = $('#speechRateValue'); if (sr) sr.textContent = S.getSetting('speechRate') + 'x';
  const sp = $('#speechPitchValue'); if (sp) sp.textContent = S.getSetting('speechPitch');
  const ic = $('#intentCount'); if (ic) ic.textContent = intentCount();
}

/* ================= SERVICE WORKER ================= */
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

document.addEventListener('DOMContentLoaded', boot);

// expose for debugging
window.FRIDAY = { state, handleInput, S, API, AI };
