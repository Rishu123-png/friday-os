/* ===== FRIDAY OS — Intent Engine =====
   100% offline. No key, no network, no model.
   Handles ~70% of everyday assistant use instantly.

   Each intent: { id, score(text) -> 0..1, run(text, ctx) -> {say, action?} } */

import { getSetting, KEYS, addItem, getList, removeItem, updateItem, remember } from './store.js';
import { parseTime, humanTime, safeMath, cleanSubject, fuzzyHas, keywordScore, pick, wordToNum } from './nlp.js';
import { persona } from './ai.js';
import { convertUnit, generatePassword } from './templates.js';
import { parseAlarm, parseRoutine, findRoutine, alarms, describeAlarm } from './automation.js';
import { isNative } from './native.js';
import { kinshipName } from './memory.js';
import { hinglishAliases } from './nlu.js';

const ACK = () => pick(['Done.', 'Got it.', 'Consider it handled.', 'Noted.', 'On it.']);
const who = () => getSetting('userName') || persona().address || 'Boss';

/* ------------------------------------------------------------------ */
/*  INTENTS                                                            */
/* ------------------------------------------------------------------ */
const INTENTS = [];
const I = (id, matcher, run, priority = 1) => INTENTS.push({ id, matcher, run, priority });

/* ---------- Time & date ---------- */
I('time', t => /\b(what.*time|current time|time (is it|now)|samay)\b/.test(t) ? 1 : 0,
  () => {
    const now = new Date();
    return { say: `It's ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` };
  });

I('date', t => /\b(what.*date|today.*date|what day is|which day)\b/.test(t) ? 1 : 0,
  () => ({ say: `Today is ${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.` }));

/* ---------- Math ---------- */
I('math', t => {
  if (!/\d/.test(t)) return 0;
  if (/(\d+\.?\d*)\s*(?:%|percent)\s*of\s*(\d+\.?\d*)/.test(t)) return 1;
  if (/\b(calculate|compute|solve|what is|whats|how much is|plus|minus|times|divided|multiply|percent)\b/.test(t)) return 0.95;
  if (/^[\d\s+\-*/().%]+$/.test(t.trim())) return 1;
  return 0;
},
  t => {
    // percent-of handling: "15% of 2400"
    const pctOf = t.match(/(\d+\.?\d*)\s*(?:%|percent)\s*of\s*(\d+\.?\d*)/i);
    if (pctOf) {
      const r = (parseFloat(pctOf[1]) / 100) * parseFloat(pctOf[2]);
      return { say: `${pctOf[1]}% of ${pctOf[2]} is ${Math.round(r * 1e6) / 1e6}.` };
    }
    const expr = t.replace(/\b(calculate|compute|solve|what is|whats|what's|how much is|please|for me)\b/gi, '');
    const r = safeMath(expr);
    if (r === null) return null;
    return { say: `That's ${r}.` };
  }, 2);

/* ---------- Reminders ---------- */
I('reminder_add', t => {
  if (/\b(remind|reminder|alarm|wake me|alert me)\b/.test(t)) return 1;
  return 0;
},
  t => {
    const when = parseTime(t);
    let task = t
      .replace(/\b(remind me to|remind me|set a reminder to|set a reminder|reminder to|alarm to|wake me up|alert me to|alert me)\b/gi, '')
      .replace(/\bat\b\s*$/i, '');
    if (when) task = task.replace(when.matched, '');
    task = cleanSubject(task, ['to', 'at', 'in', 'on']);

    if (!task) return { say: `What should I remind you about, ${who()}?`, expect: 'reminder_text' };

    const date = when ? when.date : (() => { const d = new Date(); d.setHours(d.getHours() + 1); return d; })();
    const rec = addItem(KEYS.REMINDERS, { text: task, due: date.getTime(), done: false });
    return {
      say: `Reminder set — "${task}" ${humanTime(date)}.`,
      action: { type: 'schedule_reminder', item: rec },
      refresh: ['reminders']
    };
  }, 3);

I('reminder_list', t => /\b(my |show |list |what.*)?(reminders|alarms)\b/.test(t) && !/\b(remind me|set)\b/.test(t) ? 1 : 0,
  () => {
    const list = getList(KEYS.REMINDERS).filter(r => !r.done).sort((a, b) => a.due - b.due);
    if (!list.length) return { say: 'No active reminders.', action: { type: 'open_panel', panel: 'sub-reminders' } };
    const lines = list.slice(0, 5).map(r => `• ${r.text} — ${humanTime(new Date(r.due))}`).join('\n');
    return { say: `You have ${list.length} reminder${list.length === 1 ? '' : 's'}:\n${lines}`, action: { type: 'open_panel', panel: 'sub-reminders' } };
  }, 2);

/* ---------- Notes ---------- */
I('note_add', t => {
  if (/\b(take a note|make a note|note this|save note|write.*down|note that|remember that|remember this)\b/.test(t)) return 1;
  if (/^note[:\s]/.test(t)) return 1;
  return 0;
},
  t => {
    let body = t.replace(/\b(take a note|make a note|note this|save note|write this down|write down|note that|remember that|remember this|note)\b[:\s]*/gi, '');
    body = cleanSubject(body);
    if (!body) return { say: 'What should I write down?', expect: 'note_text' };
    addItem(KEYS.NOTES, { text: body });
    remember('note', body);
    return { say: `Saved: "${body}"`, refresh: ['notes'] };
  }, 3);

I('note_list', t => /\b(my |show |list |read )?(notes)\b/.test(t) && !/\b(note that|take a note|save note)\b/.test(t) ? 1 : 0,
  () => {
    const list = getList(KEYS.NOTES);
    if (!list.length) return { say: 'No notes saved yet.', action: { type: 'open_panel', panel: 'sub-notes' } };
    const lines = list.slice(0, 5).map(n => `• ${n.text}`).join('\n');
    return { say: `${list.length} note${list.length === 1 ? '' : 's'}:\n${lines}`, action: { type: 'open_panel', panel: 'sub-notes' } };
  }, 2);

/* ---------- Tasks ---------- */
I('task_add', t => /\b(add task|new task|todo|to-do|add to my list)\b/.test(t) ? 1 : 0,
  t => {
    const body = cleanSubject(t.replace(/\b(add task|new task|add a task|todo|to-do|add to my list)\b/gi, ''));
    if (!body) return { say: 'What task?', expect: 'task_text' };
    addItem(KEYS.TASKS, { text: body, done: false });
    return { say: `Task added: "${body}"`, refresh: ['tasks'] };
  }, 3);

/* ---------- Contacts / calling (APK-aware) ---------- */
I('call', t => /\b(call|dial|phone)\s+\w+/.test(t) && !/\b(recall|calling card)\b/.test(t) ? 1 : 0,
  t => {
    const name = cleanSubject(t.replace(/\b(call|dial|phone|please|up)\b/gi, ''));
    if (!name) return { say: 'Who should I call?' };
    // kinship resolution: "call mom" -> fact person.mother -> real contact
    const kin = kinshipName(name);
    const target = kin ? kin.name : name;
    const contacts = getList(KEYS.CONTACTS);
    const hit = contacts.find(c => c.name.toLowerCase().includes(target.toLowerCase()) || fuzzyHas(c.name, target));
    if (hit) return {
      say: kin ? `Calling your ${kin.rel}, ${hit.name}.` : `Calling ${hit.name}.`,
      action: { type: 'call', number: hit.phone, name: hit.name }
    };
    if (isNative()) return { say: null, action: { type: 'contact_lookup', name: target, mode: 'call' } };
    return { say: `I don't have "${target}" in contacts. Add them in the Contacts panel, or say the number.`, action: { type: 'open_panel', panel: 'sub-contacts' } };
  }, 3);

I('message', t => /\bmessages?\s+(of|from)\s+[a-z]/.test(t) ? 0 : (/\b(text|message|whatsapp|sms)\s+\w+/.test(t) ? 1 : 0),
  t => {
    let src = t;
    // drop a leading "open whatsapp and" / "open whatsapp then"
    src = src.replace(/^\s*open\s+(whatsapp|messages?|sms)\s+(and|then)\s+/i, '');

    let msg = '', namePart = src;
    // quoted message wins:  message Divik 'hi'
    const q = src.match(/['"\u2018\u201c]([^'"\u2019\u201d]{1,200})['"\u2019\u201d]/);
    if (q) { msg = q[1].trim(); namePart = src.slice(0, q.index); }

    if (!msg) {
      const parts = namePart.split(/\s+saying\s+|\s+that\s+|\s+:\s*|:/);
      namePart = parts[0];
      msg = parts.slice(1).join(' ').trim();
    }
    // only strip command verbs from the NAME, never from the message
    namePart = namePart.replace(/\b(send a|send|text|message|whatsapp|sms|to|a|on)\b/gi, ' ');
    const name = cleanSubject(namePart || '').replace(/\s+(and|then)$/i, '').trim();
    const kin = kinshipName(name);
    const target = kin ? kin.name : name;
    const contacts = getList(KEYS.CONTACTS);
    const hit = contacts.find(c => fuzzyHas(c.name, target));
    const isWa = /whatsapp/.test(t);
    if (hit) return {
      say: `Opening ${isWa ? 'WhatsApp' : 'messages'} for ${hit.name}.`,
      action: { type: isWa ? 'whatsapp' : 'sms', number: hit.phone, body: msg, name: hit.name }
    };
    if (isNative()) return { say: null, action: { type: 'contact_lookup', name: target, mode: isWa ? 'whatsapp' : 'sms', body: msg } };
    return { say: `No contact named "${target}". Add them first.`, action: { type: 'open_panel', panel: 'sub-contacts' } };
  }, 3);

/* ---------- Device control ---------- */
I('battery', t => /\b(battery|charge level|power level|kitni battery)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'battery' } }), 2);

I('flashlight', t => /\b(flash ?light|torch)\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'torch', on: !/\b(off|band|stop)\b/.test(t) } }), 2);

I('open_app', t => /\b(open|launch|start)\s+\w+/.test(t) ? 0.8 : 0,
  t => {
    const app = cleanSubject(t.replace(/\b(open|launch|start|app|the)\b/gi, ''));
    const panels = {
      settings: 'settings', setting: 'settings', tools: 'tools', skills: 'skills',
      notes: 'sub-notes', reminders: 'sub-reminders', calendar: 'sub-calendar',
      contacts: 'sub-contacts', translate: 'sub-translate', translator: 'sub-translate',
      weather: 'sub-weather', search: 'sub-search', camera: 'camera', coder: 'sub-coder',
      code: 'sub-coder', planner: 'sub-planner', research: 'sub-research', writer: 'sub-writer',
      tasks: 'sub-tasks', task: 'sub-tasks', todo: 'sub-tasks', 'to-do': 'sub-tasks'
    };
    for (const [k, v] of Object.entries(panels)) {
      if (fuzzyHas(app, k)) return { say: `Opening ${k}.`, action: { type: 'open_panel', panel: v } };
    }
    return { say: `Opening ${app}.`, action: { type: 'open_app', app } };
  }, 1);

I('screenshot', t => /\b(screenshot|screen shot|capture screen)\b/.test(t) ? 1 : 0,
  () => ({ say: 'Screenshot requires the APK build.', action: { type: 'screenshot' } }), 2);

/* ---------- Camera / vision ---------- */
I('camera', t => /\b(camera|open camera|take a (photo|picture)|scan|qr|barcode|read (this|text)|what.*(see|looking at))\b/.test(t) ? 1 : 0,
  t => {
    const mode = /\b(qr|barcode|scan)\b/.test(t) ? 'qr'
      : /\b(read|text|ocr)\b/.test(t) ? 'ocr' : 'photo';
    return { say: pick(['Camera online.', 'Opening optics.', 'Vision active.']), action: { type: 'camera', mode } };
  }, 2);

/* ---------- Weather (handled async in app.js) ---------- */
I('weather', t => keywordScore(t, ['weather']) > 0 || /\b(temperature|forecast|rain|mausam|hot|cold) (today|tomorrow|outside|now)?\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'weather', tomorrow: /\btomorrow\b/.test(t) } }), 2);

I('aqi', t => /\b(air quality|aqi|pollution|pm2\.?5|smog)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'aqi' } }), 2);

/* ---------- Knowledge (async) ---------- */
I('wiki', t => /^(who|what) (is|was|are|were)\s+\w+/.test(t) || /\b(tell me about|information about|search for|look up|google)\b/.test(t) ? 0.9 : 0,
  t => {
    const q = cleanSubject(t.replace(/^(who|what) (is|was|are|were)\b/i, '')
      .replace(/\b(tell me about|information about|search for|look up|google|the)\b/gi, ''));
    if (!q) return null;
    return { say: null, action: { type: 'wiki', query: q } };
  }, 1);

I('define', t => /\b(define|meaning of|what does .* mean|definition of)\b/.test(t) ? 1 : 0,
  t => {
    const w = cleanSubject(t.replace(/\b(define|the meaning of|meaning of|what does|mean|definition of|word)\b/gi, ''));
    if (!w) return { say: 'Which word?' };
    return { say: null, action: { type: 'define', word: w } };
  }, 2);

I('translate', t => /\b(translate|how do you say|in (hindi|spanish|french|german|japanese|arabic|chinese))\b/.test(t) ? 1 : 0,
  t => ({ say: 'Opening translator.', action: { type: 'open_panel', panel: 'sub-translate', prefill: t } }), 2);

I('news', t => /\b(news|headlines|what.*happening|current events)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'news' } }), 2);

I('currency', t => /\b(convert|exchange rate|how many (dollars|rupees|euros)|usd|inr|eur)\b/.test(t) && /\d/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'currency', query: t } }), 2);

/* ---------- Location ---------- */
I('location', t => /\b(where am i|my location|current location|address)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'location' } }), 2);

I('navigate', t => /\b(navigate to|directions to|take me to|map of)\b/.test(t) ? 1 : 0,
  t => {
    const dest = cleanSubject(t.replace(/\b(navigate to|directions to|take me to|map of|please)\b/gi, ''));
    return { say: `Opening maps for ${dest}.`, action: { type: 'navigate', dest } };
  }, 2);

/* ---------- System / app control ---------- */
I('stop_speaking', t => /^(stop|quiet|shut up|silence|be quiet|stop talking|chup)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'stop_speech' } }), 5);

I('clear_chat', t => /\b(clear (the )?(chat|conversation)|new chat|start over|reset chat)\b/.test(t) ? 1 : 0,
  () => ({ say: 'Chat cleared.', action: { type: 'clear_chat' } }), 3);

I('theme', t => /\b(theme|dark mode|change color|matrix mode|neon)\b/.test(t) ? 1 : 0,
  t => {
    const themes = { cyber: 'cyber', blue: 'cyber', neon: 'neon', purple: 'neon', matrix: 'matrix', green: 'matrix', sunset: 'sunset', orange: 'sunset', midnight: 'midnight', black: 'midnight' };
    for (const [k, v] of Object.entries(themes)) {
      if (fuzzyHas(t, k)) return { say: `Theme set to ${v}.`, action: { type: 'theme', theme: v } };
    }
    return { say: 'Which theme? Cyber, Neon, Matrix, Sunset, or Midnight.', action: { type: 'open_panel', panel: 'settings' } };
  }, 2);

I('help', t => /\b(help|what can you do|capabilities|features|commands|list commands)\b/.test(t) ? 1 : 0,
  () => ({ say: `Here's what I can do offline, ${who()}:
• Time & date — "what time is it"
• Reminders — "remind me to call mom in 20 minutes"
• Notes — "note buy milk"
• Math — "15% of 2400"
• Weather & air quality — "what's the weather"
• Knowledge — "who is Nikola Tesla"
• Dictionary — "define serendipity"
• News, currency, translate, maps
• Camera & QR scanning
• Call and message contacts
• Themes, timers, jokes
Say "settings" to configure. Add a free Groq key there for full conversation and coding.` }), 2);

I('joke', t => /\b(joke|make me laugh|something funny|cheer me up)\b/.test(t) ? 1 : 0,
  () => ({ say: pick([
    "Why don't scientists trust atoms? They make up everything.",
    "I told my AI friend a joke about UDP. I'm not sure it got it.",
    "Why do programmers prefer dark mode? Light attracts bugs.",
    "A SQL query walks into a bar, approaches two tables, and asks: may I join you?",
    "There are 10 kinds of people — those who understand binary, and those who don't.",
    "Debugging: being the detective in a crime movie where you're also the murderer.",
    "There's no place like 127.0.0.1.",
    "I'd tell you a UDP joke, but you might not get it. I'd tell you a TCP joke, but I'd have to keep repeating it.",
    "Why was the JavaScript developer sad? He didn't Node how to Express himself.",
    "My code doesn't have bugs. It has randomly generated features."
  ]) }), 2);

I('flip', t => /\b(flip a coin|toss a coin|heads or tails)\b/.test(t) ? 1 : 0,
  () => ({ say: `${Math.random() < 0.5 ? 'Heads' : 'Tails'}.` }), 2);

I('dice', t => /\b(roll (a )?dice|roll a die|random number)\b/.test(t) ? 1 : 0,
  t => {
    const m = t.match(/between (\d+) and (\d+)/);
    if (m) {
      const [a, b] = [parseInt(m[1]), parseInt(m[2])].sort((x, y) => x - y);
      return { say: `${Math.floor(Math.random() * (b - a + 1)) + a}.` };
    }
    return { say: `You rolled a ${Math.floor(Math.random() * 6) + 1}.` };
  }, 2);

I('timer', t => /\b(set a timer|start a timer|timer for|countdown)\b/.test(t) ? 1 : 0,
  t => {
    const when = parseTime(t);
    if (!when) return { say: 'How long should the timer run?' };
    const secs = Math.round((when.date - Date.now()) / 1000);
    return { say: `Timer started — ${humanTime(when.date)}.`, action: { type: 'timer', seconds: secs } };
  }, 3);

/* ---------- Coding (routes to Groq if available) ---------- */
I('code', t => /\b(write|create|make|build|generate|fix|debug|refactor|explain)\b.*\b(code|script|function|program|app|website|html|css|javascript|python|java|api|component|class|query|regex|sql)\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'code', prompt: t } }), 2);

/* ---------- Settings ---------- */
I('settings', t => /\b(settings|preferences|configure|options|add.*(api )?key|groq)\b/.test(t) ? 1 : 0,
  () => ({ say: 'Opening settings.', action: { type: 'open_panel', panel: 'settings' } }), 2);



/* ---------- ALARMS (backend, natural language) ---------- */
I('alarm_add', t => {
  if (!/\b(alarm|wake me|wake up)\b/.test(t)) return 0;
  if (/\b(list|show|my|what|delete|remove|cancel|turn off|disable)\b/.test(t)) return 0;
  return 1;
},
  t => {
    const a = parseAlarm(t);
    if (!a) return { say: 'What time should I set the alarm for?' };
    return { say: null, action: { type: 'alarm_add', alarm: a } };
  }, 6);

I('alarm_list', t => /\b(my |show |list |what )?(alarms?)\b/.test(t) && /\b(list|show|my|what|any)\b/.test(t) ? 1 : 0,
  () => {
    const list = alarms().filter(a => a.enabled);
    if (!list.length) return { say: 'No active alarms.' };
    return { say: `${list.length} active alarm${list.length === 1 ? '' : 's'}:\n` +
      list.map(a => `\u2022 ${a.label} \u2014 ${describeAlarm(a)}`).join('\n') };
  }, 5);

I('alarm_cancel', t => /\b(cancel|delete|remove|turn off|disable|stop)\b.*\balarm/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'alarm_cancel', query: t } }), 6);

/* ---------- ROUTINES ---------- */
I('routine_create', t => /\bwhen i say\b|\b(create|make|add)\s+(a\s+)?routine\b/.test(t) ? 1 : 0,
  t => {
    const r = parseRoutine(t);
    if (!r) return { say: 'Tell me the routine name and what it should do. For example: "when I say bedtime tell me the weather and my reminders".' };
    return { say: null, action: { type: 'routine_create', routine: r } };
  }, 6);

I('routine_run', t => {
  const clean = t.replace(/^(hey |ok |okay )?(friday|jarvis)[,\s]*/i, '').trim();
  return findRoutine(clean) ? 1 : 0;
},
  t => {
    const clean = t.replace(/^(hey |ok |okay )?(friday|jarvis)[,\s]*/i, '').trim();
    const r = findRoutine(clean);
    if (!r) return null;
    return { say: null, action: { type: 'routine_run', name: r.name } };
  }, 5);

I('routine_list', t => /\b(my |show |list |what )?(routines?|automations?)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'routine_list' } }), 5);

/* ---------- GEOFENCE ---------- */
I('geofence_add', t => /\bremind me when i (get|arrive|reach)\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'geofence_add', text: t } }), 6);

/* ---------- ACTIVITY PANEL ---------- */
I('activity', t => /\b(activity|what.*(running|scheduled|automations)|show automations)\b/.test(t) ? 1 : 0,
  () => ({ say: 'Here is everything running in the background.', action: { type: 'open_panel', panel: 'activity' } }), 4);


/* ---------- PHASE C: system toggles (native) ---------- */
I('toggle_wifi', t => /\b(wifi|wi-fi)\b/.test(t) && /\b(on|off|enable|disable|turn)\b/.test(t)
  && !/\b(who|anyone|someone)\b/.test(t) ? 1 : 0,   // "who is on my wifi" is recon, not a toggle
  t => ({ say: null, action: { type: 'sys_toggle', what: 'wifi', on: !/\b(off|disable)\b/.test(t) } }), 5);

I('toggle_bt', t => /\b(bluetooth)\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'sys_toggle', what: 'bluetooth', on: !/\b(off|disable)\b/.test(t) } }), 5);

I('toggle_dnd', t => /\b(do not disturb|dnd|silent mode)\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'sys_toggle', what: 'dnd', on: !/\b(off|disable)\b/.test(t) } }), 5);

I('volume', t => /\b(volume|sound)\b/.test(t) && /\d|\b(up|down|max|mute|full)\b/.test(t) ? 1 : 0,
  t => {
    let pct = 50;
    const m = t.match(/(\d{1,3})\s*(?:%|percent)?/);
    if (m) pct = Math.min(100, parseInt(m[1], 10));
    if (/\b(max|full)\b/.test(t)) pct = 100;
    if (/\b(mute)\b/.test(t)) pct = 0;
    if (/\bup\b/.test(t)) pct = 80;
    if (/\bdown\b/.test(t)) pct = 25;
    return { say: null, action: { type: 'sys_volume', percent: pct } };
  }, 5);

I('brightness', t => /\b(brightness|screen bright)\b/.test(t) ? 1 : 0,
  t => {
    let pct = 60;
    const m = t.match(/(\d{1,3})\s*(?:%|percent)?/);
    if (m) pct = Math.min(100, parseInt(m[1], 10));
    if (/\b(max|full)\b/.test(t)) pct = 100;
    if (/\b(low|dim)\b/.test(t)) pct = 20;
    return { say: null, action: { type: 'sys_brightness', percent: pct } };
  }, 5);

/* ---- v8.4 TRUE CONTROL: no more play/music confusion ---- */
/* "i like to play" / bare "play" / "let's play" — CONTEXT decides in app.js:
   last offer was a game -> open the game; otherwise resume media.  */
I('play_context', t => /^(?:play|let'?s play|play it|play the game|haan play|play karo|game play)\s*$|\b(?:i (?:would |really )?like to play|i want to play|i wanna play|let'?s play|yes,? let'?s play|haan,? play karo|game khelna (?:hai|he)|mujhe khelna hai)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'play_context' } }), 8);

/* "play candy crush" / "khelo ludo" — a NAMED game or app. Music words are
   excluded so "play music" still goes to the media keys. */
I('play_game', t => {
    if (/\b(?:on youtube|on spotify|youtube|spotify)\b/.test(t)) return 0;   // yt_play/spotify own those
    const m = t.match(/\b(?:play|khelo|khelna)\s+([a-z0-9][a-z0-9 .'-]{1,28})\s*$/);
    if (!m) return 0;
    return /^(music|songs?|gaana|gane|radio|playlist|spotify|something|anything|a game|the game|games)$/.test(m[1].trim()) ? 0 : 1;
  },
  t => {
    const m = t.match(/\b(?:play|khelo|khelna)\s+([a-z0-9][a-z0-9 .'-]{1,28})\s*$/);
    return { say: null, action: { type: 'play_game', name: m ? m[1].trim() : '' } };
  }, 7);

/* "off the music" / "music band karo" / "stop the music" — real media keys. */
I('media_off', t => /\b(?:stop|pause|band karo|band krdo|band kar do|rok do|rok lo)\s+(?:the\s+)?(?:music|song|gaana|audio|media)\b|\bmusic\s+(?:band|band karo|band kar do|stop|off|pause|rok do)\b|\b(?:turn off|off|kill)\s+(?:the\s+)?music\b|\b(?:music|gaana|song|audio|volume)\s+turn off\b|\bgaana band\b|\bsong (?:off|band|stop)\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'media', action: /\bstop\b/.test(t) ? 'stop' : 'pause' } }), 6);

I('media', t => /\b(play music|resume|pause|next song|next track|previous song|previous track|skip(?:\s(?:song|track))?)\b/.test(t) ? 1 : 0,
  t => {
    let a = 'playpause';
    if (/\bnext|skip\b/.test(t)) a = 'next';
    else if (/\bprevious|back\b/.test(t)) a = 'previous';
    else if (/\bpause\b/.test(t)) a = 'pause';
    else if (/\bstop\b/.test(t)) a = 'stop';
    else if (/\bplay|resume\b/.test(t)) a = 'play';
    return { say: null, action: { type: 'media', action: a } };
  }, 4);

I('nav_gesture', t => /\b(go back|go home|show recents|open notifications|quick settings|lock (the )?(phone|screen))\b/.test(t) ? 1 : 0,
  t => {
    let a = 'home';
    if (/\bback\b/.test(t)) a = 'back';
    else if (/\brecents\b/.test(t)) a = 'recents';
    else if (/\bnotifications\b/.test(t)) a = 'notifications';
    else if (/\bquick settings\b/.test(t)) a = 'quicksettings';
    else if (/\block\b/.test(t)) a = 'lock';
    return { say: null, action: { type: 'gesture', action: a } };
  }, 5);

I('otp', t => /\b(otp|verification code|read.*code|what.*otp)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'read_otp' } }), 5);

I('storage', t => /\b(storage|disk space|free space|memory left)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'storage' } }), 4);

I('bubble', t => /\b(bubble|overlay|floating)\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'bubble', on: !/\b(off|hide|disable|remove)\b/.test(t) } }), 5);

/* v7.6.4: per-app shade reading — "see the message of telegram", "whatsapp ke messages padho" */
const NOTIF_APP_RE = /\b(?:messages?|msgs?|texts?|chats?)\s+(?:of|from|on|in|ke|pe|par)\s+([a-z][a-z .]{0,18}?)(?:\s+(?:padho|batao|dikhao|sunao|suno))?$/i;
I('read_notifications', t =>
    /\b(read|see|check|show|get|any|what|my|koi)\b\s+notifications?\b/.test(t)
    || /\bnotifications?\s+(padho|batao|sunao|suno|dikhao|aayi|aya|hai|kya)\b/.test(t)
    || /\bkoi notification\b/.test(t)
    || /\bmessages?\s+(of|from|on|in)\s+(whatsapp|telegram|instagram|gmail|messenger|messages|sms)\b/.test(t)
    || /\b(whatsapp|telegram|instagram|gmail)\s+ke?\s+(?:messages?|msgs?|chats?)\b/.test(t)
    || NOTIF_APP_RE.test(t)
    ? 1 : 0,
  t => {
    const m = t.match(NOTIF_APP_RE)
      || t.match(/\b(whatsapp|telegram|instagram|gmail)\s+ke?\s+(?:messages?|msgs?|chats?)\b/i);
    return { say: null, action: { type: 'read_notifications', app: m ? m[1].trim() : null } };
  }, 8);

I('reply_notif', t => /\b(reply|respond)\b/.test(t) && !/^(reply to me|reply to this)$/i.test(t) ? 0.9 : 0,
  t => {
    // "reply to whatsapp on my way"    -> app=whatsapp  text="on my way"
    // "reply on my way"                -> app=null      text="on my way"
    let app = null, body = t.replace(/^\s*(please\s+)?(reply|respond|answer)\b\s*/i, '');
    const toApp = body.match(/^(?:to\s+)?(whatsapp|gmail|messages|sms|telegram|instagram|teams|slack|linkedin|x|twitter|facebook|snapchat)\s+(?:saying\s+|that\s+|:\s*)?(.+)$/i);
    if (toApp) { app = toApp[1].toLowerCase(); body = toApp[2].trim(); }
    body = body.replace(/^(to me|back)\s*/i, '').trim();
    if (!body) return { say: 'What should I reply?' };
    return { say: null, action: { type: 'reply_notif', app, text: body } };
  }, 5);

I('setup', t => /\b(setup|set up|permissions|grant access|enable everything|configure)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'setup' } }), 5);

/* ---------- PHASE C: system toggles end ---------- */

/* ---------- Memory ---------- */
I('what_you_know', t => /\b(what do you know about me|what have you learned|what do you remember about me|my profile|show memory|my memories)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'what_you_know' } }), 4);

I('recall', t => /\b(do you remember|what did i say about|recall|remind me what)\b/.test(t) ? 1 : 0,
  t => {
    const q = cleanSubject(t.replace(/\b(do you remember|what did i say about|recall|remind me what|when|i said)\b/gi, ''));
    if (!q) return { say: 'Remember what, specifically?' };
    return { say: null, action: { type: 'recall', query: q } };
  }, 4);

I('forget', t => /\b(forget everything|wipe your memory|forget me|erase memory)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'forget' } }), 5);

/* ---------- Unit conversion ---------- */
I('unit', t => /\b(\d+\.?\d*)\s*(km|m|cm|mm|miles?|ft|feet|foot|inch|inches|yard|kg|g|mg|lbs?|pounds?|oz|ounce|ton|c|f|celsius|fahrenheit|kelvin)\s*(?:to|in|into)\s*(km|m|cm|mm|miles?|ft|feet|foot|inch|inches|yard|kg|g|mg|lbs?|pounds?|oz|ounce|ton|c|f|celsius|fahrenheit|kelvin)\b/i.test(t) ? 1 : 0,
  t => {
    const m = t.match(/(\d+\.?\d*)\s*([a-z]+)\s*(?:to|in|into)\s*([a-z]+)/i);
    if (!m) return null;
    const r = convertUnit(parseFloat(m[1]), m[2], m[3]);
    if (r === null) return null;
    return { say: `${m[1]} ${m[2]} is ${r} ${m[3]}.` };
  }, 4);

/* ---------- Password generator ---------- */
I('password', t => /\b(generate|create|make|new)?\s*(a\s+)?(strong\s+|secure\s+|random\s+)?password\b/.test(t) ? 1 : 0,
  t => {
    const m = t.match(/(\d+)\s*(?:char|character|digit|letter)/);
    const len = m ? Math.min(64, Math.max(8, parseInt(m[1]))) : 20;
    const pw = generatePassword(len);
    return { say: `Generated a ${len}-character password. Copied to clipboard.`, action: { type: 'copy_secret', text: pw } };
  }, 3);

/* ---------- Tasks list ---------- */
I('task_list', t => /\b(my |show |list )?(tasks|todos|to-dos|todo list)\b/.test(t) && !/\b(add|new)\b/.test(t) ? 1 : 0,
  () => {
    const list = getList(KEYS.TASKS).filter(x => !x.done);
    if (!list.length) return { say: 'No open tasks.' };
    return { say: `${list.length} open task${list.length === 1 ? '' : 's'}:\n` + list.slice(0, 6).map(x => `• ${x.text}`).join('\n') };
  }, 2);

/* ---------- Greeting routine ---------- */
I('briefing', t => /\b(good morning|brief me|daily briefing|status report|whats my day|what's my day)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'briefing' } }), 4);

/* ---------- Security guard (v7.3) ---------- */
I('security_scan', t =>
  /\b(security (scan|check|audit)|scan (my )?(phone|device|mobile)|is my phone (safe|hacked|secure|ok)|check.*(hack|virus|malware|spy|suspicious|spyware)|some(one|body).*(hack|spy|steal|track)|protect my (phone|device))/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'security_scan' } }), 5);

/* ---------- Find a person on Google Maps (location sharing) ---------- */
const KIN_RE = /\b(dad|daddy|papa|father|aba|mom|mum|mumma|mummy|mother|parents?|brother|bhai|sister|didi|wife|husband|girlfriend|boyfriend|son|daughter|best friend|friend)\b/;
/* v7.6.4: "<name> location which is shared by him" — person without kin word */
const PERSON_LOC_RE = /\b([a-z][a-z]+(?:\s+[a-z][a-z]+){0,3})\s+(?:ki\s+|ka\s+|ke\s+)?location\b/i;

I('find_person', t =>
  /\b(where|find|locate|track|show me|look (for|up))\b/.test(t) && KIN_RE.test(t) ? 1 : 0
  || (PERSON_LOC_RE.test(t) && /\b(shar|bheja|sent|dikha|maps?|google)\b/.test(t) ? 1 : 0),
  t => {
    const m = t.match(KIN_RE);
    if (m) {
      const rel = m[1].toLowerCase();
      const k = kinshipName(rel);
      return { say: null, action: { type: 'find_person', rel, name: k ? k.name : null } };
    }
    // v7.6.4: explicit name — "show me vijay prakash location which is shared by him"
    const pm = t.match(PERSON_LOC_RE);
    let name = pm ? pm[1] : '';
    name = name.replace(/\b(open|maps?|google|and|show|me|the|dear|please|kripya|where|is|find|locate|track|his|her|by)\b/gi, ' ')
               .replace(/\s+/g, ' ').trim();
    return { say: null, action: { type: 'find_person', rel: null, name: name || null } };
  }, 6);

/* ---------- Password vault (v7.3) ---------- */
const VAULT_SAVE_RE = /\b(?:save|remember|store|keep)\s+(?:my\s+)?([a-z0-9][a-z0-9.]{1,19})\s+(?:password|passcode|pass|login|pin)\s*(?:as|is|to|:)?\s+(.{2,64})$/i;
I('vault_save', t => VAULT_SAVE_RE.test(t) ? 1 : 0,
  t => {
    const m = t.match(VAULT_SAVE_RE);
    return { say: null, action: { type: 'vault_save', service: m[1].toLowerCase(), password: m[2].trim() } };
  }, 6);

const VAULT_READ_RE = /\b(?:what(?:'s| is)|tell me|show me|read|get)\s+my\s+([a-z0-9][a-z0-9.]{1,19})\s+(?:password|passcode|pass|pin)\b/i;
I('vault_read', t => VAULT_READ_RE.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'vault_read', service: t.match(VAULT_READ_RE)[1].toLowerCase() } }), 6);

const VAULT_FORGET_RE = /\bforget\s+(?:my\s+)?([a-z0-9][a-z0-9.]{1,19})\s+(?:password|passcode|pass|pin)\b/i;
I('vault_forget', t => VAULT_FORGET_RE.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'vault_forget', service: t.match(VAULT_FORGET_RE)[1].toLowerCase() } }), 6);

I('vault_lock', t => /\block (my )?vault\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'vault_lock' } }), 5);

I('vault_list', t => /\b(what'?s in my vault|list (my )?(saved )?passwords|show my vault|which passwords do (you|i) (have|know))\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'vault_list' } }), 5);

/* ---------- Full-control UI commands (v7.3) ---------- */
I('ui_scroll', t => /\bscroll (down|up|left|right)\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'ui_scroll', dir: (t.match(/\b(down|up|left|right)\b/) || [])[1] || 'down' } }), 3);

I('ui_tap', t => /^tap (?:on )?(.{2,30})$/.test(t) ? 0.9 : 0,
  t => ({ say: null, action: { type: 'ui_tap', text: t.replace(/^tap (?:on )?/, '').trim() } }), 3);

I('ui_type', t => /^type (?:this |that )?(.{2,80})$/.test(t) && !/^type (of|what)/.test(t) ? 0.85 : 0,
  t => ({ say: null, action: { type: 'ui_type', text: t.replace(/^type (?:this |that )?/, '').trim() } }), 3);

/* ---------- Ethical hacker pack (v7.4 REDTEAM) ---------- */
I('net_recon', t =>
  /\b(who|anyone|someone).*(on|using|connect).*(my )?(wi-?fi|wifi|network)|\bscan (my )?(wi-?fi|network|lan)\b|\bnetwork (scan|recon|audit)\b|\bwi-?fi (audit|security|check)\b|\brecon\b|\bhacker mode\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'net_recon' } }), 7);

const IP_RE = /(\d{1,3}(?:\.\d{1,3}){3})/;
I('port_scan', t => /\bports?\b|\bport scan\b/.test(t) && IP_RE.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'port_scan', host: t.match(IP_RE)[1] } }), 5);

I('password_check', t =>
  /\b(check|test|rate|is|how)\b.*\bpassword\b.*\b(strong|safe|secure|good|weak)\b|\bhow strong is\b/.test(t) ? 1 : 0,
  t => {
    // pull the candidate: "is my password X strong" / "check password X" / "how strong is X"
    let pw = null;
    let m = t.match(/password\s+([a-z0-9!@#$%^&*._-]{3,64})\s*(?:strong|safe|secure|good|weak|\?|$)/i)
         || t.match(/(?:check|test|rate)\s+(?:the\s+)?([a-z0-9!@#$%^&*._-]{4,64})(?:\s+(?:password|for me))?(?:\s|$)/i)
         || t.match(/how strong is\s+(?:my\s+)?(?:password\s+)?([a-z0-9!@#$%^&*._-]{3,64})/i);
    if (m && !/^(my|the|this|a)$/i.test(m[1])) pw = m[1];
    return { say: null, action: { type: 'password_check', password: pw } };
  }, 6);

I('phish_check', t =>
  /\b(is|check|scan).*(link|url|site).*(safe|phish|scam|fake|dangerous)\b|\bis this (link|url|site) safe\b|\bcheck (this|the) (link|url)\b/.test(t) ? 1 : 0,
  t => {
    const m = t.match(/(https?:\/\/\S+|[a-z0-9-]+\.[a-z]{2,}\S*)/i);
    return { say: null, action: { type: 'phish_check', url: m ? m[1] : null } };
  }, 6);

I('phish_sms', t =>
  /\b(scan|check|test) my (sms|messages|texts|inbox)\b.*(phish|scam|fraud|dangerous|suspicious|link)?|\b(smishing|phishing) (scan|check|test)\b|\bam i being scammed\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'phish_sms' } }), 5);

/* ------------------------------------------------------------------ */
/*  ROUTER                                                             */
/* ------------------------------------------------------------------ */

/**
 * Try to resolve text with the offline engine.
 * @returns {null | {say, action?, refresh?, expect?}}
 */
export function resolve(text, ctx = {}) {
  const raw = text.toLowerCase().trim();
  if (!raw) return null;
  const t = hinglishAliases(raw);

  let best = null, bestScore = 0;
  for (const intent of INTENTS) {
    let s;
    try { s = intent.matcher(t); } catch (_) { s = 0; }
    if (!s) continue;
    const weighted = s * (1 + intent.priority * 0.1);
    if (weighted > bestScore) { bestScore = weighted; best = intent; }
  }

  if (!best) return null;

  try {
    const out = best.run(t, ctx);
    if (out) out.intent = best.id;
    return out;
  } catch (e) {
    console.warn('[brain] intent failed', best.id, e);
    return null;
  }
}

export function intentCount() { return INTENTS.length; }
export function intentIds() { return INTENTS.map(i => i.id); }

/* ================= v7.5 TITAN INTENTS ================= */

/* ---- steps & health ---- */
I('steps', t => /\bsteps?\b|\bkadam\b|\bhow much.*walk|walked\b/.test(t) && !/\bstep by step\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'steps' } }), 6);

I('step_goal', t => /\b(steps?\s*goal|goal\s*\d{3,5}\s*steps?)\b/.test(t) ? 1 : 0,
  t => {
    const m = t.match(/(\d{4,5})/);
    return { say: null, action: { type: 'step_goal', goal: m ? +m[1] : 0 } };
  }, 7);

I('health_summary', t => /\b(health report|fitness report|activity summary|exercise report|health summary|health score)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'health_summary' } }), 5);

I('health_sync', t => /\bhealth connect\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'health_sync' } }), 6);

/* ---- health reminders (water / medicine / eyes) ---- */
I('water_plan', t => (/\bwater\b.*\bevery\s+\d+\s*(hour|hr)/.test(t) || /\bwater reminder\b|\bpaani\b.*\breminder\b/.test(t)) ? 1 : 0,
  t => {
    const m = t.match(/every\s+(\d+)\s*(hour|hr)/);
    return { say: null, action: { type: 'water_plan', hours: m ? +m[1] : 2 } };
  }, 6);

I('med_plan', t => /\b(medicine|medicines|dawai|dawa|tablet|tablet lelo)\b.*\b(reminder|remind|lelo|routine)?\b/.test(t) && /\b(medicine|dawai|dawa|tablet)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'med_plan' } }), 6);

I('eye_break', t => /\b(eye break|eye breaks|20-20-20|eye rest)\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'eye_break', on: !/\b(off|stop|disable|band)\b/.test(t) } }), 5);

/* ---- focus mode (v9: hours/ghante + dnd-for + Hindi off-words) ---- */
I('focus_mode', t => /\b(focus mode|focus for|pomodoro|deep work|study mode|do not disturb mode|dnd for|concentrate mode|(?:stop|end|exit)\s+(?:the\s+)?(?:focus|pomodoro|dnd|deep work)|focus\s+(?:off|band)|dnd\s+off)\b/.test(t) ? 1 : 0,
  t => {
    if (/\b(off|stop|end|band|disable|hatao)\b/.test(t)) return { say: null, action: { type: 'focus_mode', off: true } };
    const m = t.match(/(\d{1,3})\s*(min(?:utes?)?|mins?|hours?|ghante|hr)/);
    let mins = m ? +m[1] : 25;
    if (m && /hour|ghante|hr/.test(m[0])) mins *= 60;
    if (mins > 720) mins = 720;
    return { say: null, action: { type: 'focus_mode', minutes: mins } };
  }, 7);

/* ---- screen time ---- */
I('screen_time', t => /\b(screen time|phone usage|usage report|kitna chalaya|how much.*(phone|screen))\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'screen_time', days: /\bweek\b|\bhafte\b/.test(t) ? 7 : 1 } }), 6);

/* ---- battery guard ---- */
I('battery_guard', t => /\b(battery full|battery low|battery warn|battery alert|battery guard)\b/.test(t) ? 1 : 0,
  t => {
    if (/\b(low|kam)\b/.test(t)) {
      const m = t.match(/(\d{1,2})\s*(%|percent)?/);
      return { say: null, action: { type: 'battery_guard', kind: 'low', level: m ? +m[1] : 20 } };
    }
    return { say: null, action: { type: 'battery_guard', kind: 'full', on: !/\b(off|stop|band)\b/.test(t) } };
  }, 6);

/* ---- find my phone (rings loudly) ---- */
I('find_phone', t =>
    /\b(find|where|where's|kahan|ring|ringing)\b.*\b(my )?(phone|mobile)\b/.test(t)
    && !/\b(papa|dad|mom|mum|mummy|bhai|didi|brother|sister|wife|husband|friend|dost)\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'find_phone', on: !/\b(stop|found|band|mil gaya)\b/.test(t) } }), 9);

/* ---- v8.1 EYES: visual screen reading (keeps plain "what's on my screen" on the
   offline text reader; only explicitly-VISUAL phrasings take the Groq vision path) ---- */
I('screen_vision', t => /\b(?:what do you see|what can you see|what am i seeing|what am i looking at)\s+(?:on |at |in )?(?:my |the |this )?(?:phone |mobile )?screen\b|\b(?:look at|analyze|analyse|describe)\s+(?:my |the |this )?(?:phone |mobile )?screen\b|\bscreen\s+pe\s+kya\b|\bscreen\s+(?:ko\s+)?(?:dekh ke bata|dekhkar bata|analyse|analyze|summary)\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'screen_vision', question: /blue button|button|tap|dabao/.test(t) ? 'Find any buttons on this screen and describe their on-screen positions.' : null } }), 7);

/* ================= v9.0 APEX ================= */

/* A1 AI Wallpaper Forge */
I('wallpaper', t => /\bwallpaper\b/.test(t) && /\b(make|create|generate|banao|bana do|set|change|laga|of|with|new|nikal)\b/.test(t) ? 1 : 0,
  t => {
    let topic = '';
    const m1 = t.match(/wallpaper\s+(?:of|with|about|pe|ka|par|banao|bana do|nikal)\s+(.+)/);
    const m2 = t.match(/(?:make|create|generate|banao|bana do)\s+(?:me\s+)?(?:a\s+)?(?:new\s+)?wallpaper\s+(.+)/);
    if (m1) topic = m1[1].trim();
    else if (m2 && !/^(of|with|about)\b/.test(m2[1])) topic = m2[1].trim();
    if (/^(change|set|laga do|new|nayi)$/.test(topic)) topic = '';
    return { say: null, action: { type: 'wallpaper', topic } };
  }, 6);

/* A3 notification history + deleted-message keeper + digest */
I('notif_history', t => /\b(deleted messages?|what did (they|he|she|[a-z']{2,}) delete|notification history|old notifications?|purani notifications?|kal ki notifications?)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'notif_history' } }), 6);
I('notif_digest', t => /\b(whatsapp digest|notification digest|aaj ka whatsapp|whatsapp (?:ka )?summary|notifications? (?:ka )?summary|summari[sz]e (?:my )?(?:whatsapp|notifications?))\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'notif_digest', app: /whatsapp/.test(t) ? 'whatsapp' : (/telegram/.test(t) ? 'telegram' : '') } }), 6);

/* A4: focus_mode and screen_time upgraded in-place above/below (scroll police
       lives in app.js); the v9 additions here avoid duplicates. */

/* A5 SOS guardian */
I('sos', t => (/\bcancel\b|\bstop\b/.test(t) ? 0 :
  (/^(?:emergency|sos|help me|bachao|save me|madad)\b|\b(?:s\.?o\.?s\.?|bachao|meri madad karo)\b/.test(t) ? 1 : 0)),
  () => ({ say: null, action: { type: 'sos' } }), 9);
I('sos_cancel', t => /\bcancel (?:the )?sos\b|\bstop sos\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'sos_cancel' } }), 9);
I('sos_set_contact', t => /emergency contact (?:is|=|:)\s*[+\d][\d\s-]{5,}/.test(t) ? 1 : 0,
  t => {
    const m = t.match(/emergency contact (?:is|=|:)\s*([+\d][\d\s-]{5,})/);
    return { say: null, action: { type: 'sos_set_contact', number: m[1].replace(/[\s-]/g, '') } };
  }, 8);

/* A6 dictation (Rambler-style) */
I('dictate', t => /\b(?:dictate|dictation|dictate karo)\b|\bmessage likh do\b|\blikh do na message\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'dictate' } }), 6);

/* A7 parked car */
I('park_save', t => /\b(?:parked here|mark my car|car parked|remember parking|gaadi (?:yahan )?park|parking yaad rakh)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'park_save' } }), 7);
I('park_find', t => /\bwhere (?:is|did) (?:i\s+)?(?:park|my car)\b|\bfind my car\b|\bgaadi kahan\b|\bcar kahan\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'park_find' } }), 7);

/* A8 sleep timer */
I('sleep_timer', t => /\bsleep timer\b|\bstop (?:the )?music in\s+|\bmusic band kar dena\b|\bturn off music in\s+/.test(t) ? 1 : 0,
  t => {
    const m = t.match(/(\d+)\s*(min(?:utes?)?|mins?|hours?|ghante|hr)/);
    let mins = m ? parseInt(m[1], 10) : 20;
    if (m && /hour|ghante|hr/.test(m[0])) mins *= 60;
    if (!m) {
      const wm = t.match(/(one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|sixty)\s*(min|minutes|hours?)/);
      if (wm) { const n = wordToNum(wm[1]); if (n) mins = n * (/hour/.test(wm[0]) ? 60 : 1); }
    }
    if (!mins || mins > 480) mins = 20;
    return { say: null, action: { type: 'sleep_timer', minutes: mins } };
  }, 7);

/* A9 read page aloud */
I('read_page', t => /\b(?:read|padho|padh ke sunao)\s+(?:this|ye|yeh)\s+(?:article|page|link|story)\b|\bread aloud\b|\barticle sunao\b|\bread https?:\/\/\S+/.test(t) ? 1 : 0,
  t => {
    const m = t.match(/https?:\/\/\S+/);
    return { say: null, action: { type: 'read_page', url: m ? m[0] : '' } };
  }, 6);

/* A10 watchers (message + screen) */
I('watch_add', t => t.match(/watch (?:my )?(whatsapp|telegram|instagram|screen) for\s+(.+)/)
                || t.match(/(?:ping|alert|notify)\s+(?:me\s+)?(?:when|if|jab)\s+(.+)/)
                || t.match(/batana (?:jab|jub)\s+(.+)\s+(?:aaye|message|text)/) ? 1 : 0,
  t => {
    let needle = '', app = '';
    const w = t.match(/watch (?:my )?(whatsapp|telegram|instagram|screen) for\s+(.+)/);
    if (w) { app = w[1]; needle = w[2].trim(); }
    else {
      const m1 = t.match(/(?:ping|alert|notify)\s+(?:me\s+)?(?:when|if|jab)\s+(.+)/);
      const m2 = t.match(/batana (?:jab|jub)\s+(.+?)\s+(?:aaye|message|text)/);
      needle = (m1 ? m1[1] : (m2 ? m2[1] : '')).trim();
      if (/whatsapp/.test(t)) app = 'whatsapp';
      else if (/telegram/.test(t)) app = 'telegram';
      needle = needle.replace(/\s+(?:texts?|messages?|calls?|comes|aaye)$/, '').trim();
    }
    return { say: null, action: { type: 'watch_add', needle, app } };
  }, 8);
I('watch_cancel', t => /\b(?:stop|cancel|band karo)\s+(?:the\s+)?watch(?:ing|ers)?\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'watch_cancel' } }), 7);
I('watch_list', t => /\bwhat are you watching\b|\bmy watchers\b|\bwatch list\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'watch_list' } }), 7);

/* ---- v8.0: Karen daily brief ---- */
I('daily_brief', t => /\b(?:morning|daily|day)\s+(?:brief|briefing|plan|update|summary)\b|\bbrief me\b|\baaj ka (?:plan|brief|update)\b|\bday\s+kaise\s+ja\s+rahi\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'daily_brief' } }), 6);

/* ---- scheduled whatsapp ---- */
I('whatsapp_schedule', t => (/\bschedule\b/.test(t) && /\bwhatsapp|message|msg\b/.test(t)) || /\bwhatsapp\b.*\b(at \d|tomorrow|kal|schedule)\b/.test(t) ? 1 : 0,
  t => {
    let src = t.replace(/\bschedule\s+(?:a\s+|ek\s+)?(?:message\s+|msg\s+)?(?:on\s+|at\s+|in\s+|pe\s+)?whatsapp\b/i, '').trim();
    const to = src.match(/(?:^|\b)(?:to|for|ko)\s+([a-z][a-z .'-]{1,30}?)(?=\s+(?:at\s+\d|\bat\b|kal\b|aaj\b|subah|shaam|raat|baje|saying|say\b|\d{1,2}\s*(?::\d{2})?\s*(?:am|pm)\b)|$)/i);
    const msg = src.match(/(?:saying|say|message|msg|bol ke|bolna|likhna)\s+(.+)$/i);
    const when = parseTime(t);
    return { say: null, action: {
      type: 'whatsapp_schedule',
      name: to ? to[1].trim() : '',
      msg: msg ? msg[1].trim() : '',
      time: when ? when.date.getTime() : null
    } };
  }, 6);

/* ---- quick inline translate (panel stays for the rest) ---- */
I('quick_translate', t => /^translate\s+.+?\s+(to|in)\s+[a-z]+$/.test(t) ? 1 : 0,
  t => {
    const m = t.match(/^translate\s+(.+?)\s+(to|in)\s+([a-z]+)$/);
    return m ? { say: null, action: { type: 'quick_translate', text: m[1], lang: m[3] } }
             : { say: 'Opening translator.', action: { type: 'open_panel', panel: 'sub-translate', prefill: t } };
  }, 6);

/* ---- wifi QR ---- */
I('wifi_qr', t => /\bwifi\s*(qr|qr code)\b|\bshare wifi\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'wifi_qr' } }), 6);

/* ---- link summarizer ---- */
I('summarize_link', t => /\b(summar(y|ize|ise)|short version|tldr|tl;dr)\b.*\bhttps?:\/\//.test(t) ? 1 : 0,
  t => {
    const m = t.match(/(https?:\/\/[^\s]+)/);
    return { say: null, action: { type: 'summarize_link', url: m ? m[1] : '' } };
  }, 6);

/* ---- anti-theft pocket guard ---- */
I('pocket_guard', t => /\b(pocket mode|pocket guard|anti ?theft|chori alarm)\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'pocket_guard', on: !/\b(off|stop|band|disable)\b/.test(t) } }), 6);

/* ---- backup ---- */
I('backup_data', t => /\b(backup|export)\b.*\b(data|settings|memory)\b|\bbackup my\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'backup_data' } }), 5);

/* ---- voice note ---- */
I('voice_note', t => /\b(voice note|record note|note bolo|dictat)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'voice_note' } }), 6);

/* ---- payment reminders (NO banking - FRIDAY never reads money details) ---- */
I('pay_remind', t => /\bremind me (to )?pay\b|\bpay reminder\b|\bpaise dene\b/.test(t) ? 1 : 0,
  t => {
    const who = t.match(/pay\s+([a-z][a-z .'-]{1,25}?)(?:\s+(?:rs|rupees|inr|₹|\d))/i);
    const amt = t.match(/(?:rs\.?|rupees|inr|₹)\s*(\d+(?:,\d{3})*(?:\.\d+)?)|(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:rs\.?|rupees|₹)/i);
    const when = parseTime(t);
    const name = who ? who[1].trim() : '';
    const amount = amt ? (amt[1] || amt[2] || '').replace(/,/g, '') : '';
    let task = 'Pay ' + (name || 'someone') + (amount ? ` ₹${amount}` : '');
    const date = when ? when.date : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; })();
    const rec = addItem(KEYS.REMINDERS, { text: task, due: date.getTime(), done: false });
    return {
      say: `Done — I'll remind you: "${task}" ${humanTime(date)}. I never see your bank or money details; I just keep the reminder.`,
      action: { type: 'schedule_reminder', item: rec },
      refresh: ['reminders']
    };
  }, 6);

I('pay_list', t => /\b(my|pending|bakaya)\s+payments?\b|\bpayments?\s+(due|pending|list)\b/.test(t) ? 1 : 0,
  () => {
    const pays = getList(KEYS.REMINDERS).filter(r => !r.done && /^pay\b/i.test(r.text));
    if (!pays.length) return { say: 'No payment reminders pending.', action: null };
    return {
      say: pays.length + ' payment' + (pays.length === 1 ? '' : 's') + ' pending:\n'
         + pays.slice(0, 6).map(r => `\u2022 ${r.text} - ${humanTime(new Date(r.due))}`).join('\n'),
      action: null
    };
  }, 6);

/* ---- hindi ui toggle ---- */
I('hindi_ui', t => /\b(hindi (ui|mode|interface)|hindi mein dikhao|english (ui|mode|interface))\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'hindi_ui', on: !/\b(english\b|off|band)/.test(t) } }), 6);

/* ================= v7.6 APEX INTENTS ================= */

/* screen eyes: "what's on my screen", "read this screen", "translate the screen" */
I('screen_read', t => /\b(screen|skreen)\b.*\b(read|parh|batao|kya hai|summarize|translate|dikha)\b|\b(read|what'?s on|whats on|parho)\b.*\bscreen\b|\b(translate|summarize)\b\s+(the\s+|my\s+)?screen\b|\bon.?screen\b/.test(t) ? 1 : 0,
  t => ({
    say: null,
    action: {
      type: 'screen_read',
      mode: /translate/.test(t) ? 'translate' : /(summar|short|simple)/.test(t) ? 'summarize' : 'read'
    }
  }), 6);

/* camera eyes: "what do you see", "ye kya hai", "look at this" */
I('eyes', t => /\bwhat (do you see|is this|is that)\b|\b(look|dekh|dekho)\b.*\b(this|ye|kya)\b|\bye kya hai\b|\bscan (this|scene)\b|\bwhat'?s in front\b/.test(t) ? 1 : 0,
  t => ({ say: null, action: { type: 'eyes', question: t } }), 6);

/* deep research: "tell me about latest budget", "research X", "ask ai with news" */
I('deep_ask', t => /\b(research|deep answer|latest (news|info|update)s? (on|about)|ask ai about|search web for)\b/.test(t) ? 1 : 0,
  t => {
    const q = t.replace(/\b(research|deep answer|latest news on|latest info on|latest updates on|latest in|ask ai about|search web for|tell me about latest)\b/gi, '').trim() || t;
    return { say: null, action: { type: 'deep_ask', query: q } };
  }, 6);

/* youtube dj: "play kesariya on youtube", "youtube pe bella ciao chalao" */
I('yt_play', t => /\byoutube\b|\byt\b/.test(t) && /\b(play|chalao|bajao|lagao|search|song|gana|video|turn on|sunao|suno)\b/.test(t) ? 1 : 0,
  t => {
    let q = t.replace(/\b(play|chalao|bajao|lagao|search for|search|on youtube|youtube|yt|pe|song|gana|video|please|ko|karke|dikhao)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    return { say: null, action: { type: 'yt_play', query: q || t } };
  }, 7);

/* universal device search: "find everything about ramesh" */
I('uni_search', t => /\b(find|search)\b.*\beverything\b|\bsearch (all|everywhere)\b|\bsab kuch\b.*\b(dhoondo|batao)\b/.test(t) ? 1 : 0,
  t => {
    const q = t.replace(/\b(find|search|everything|all|everywhere|about|sab kuch|dhoondo|batao|ke baare mein|for)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    return { say: null, action: { type: 'uni_search', query: q } };
  }, 6);

/* quiz / teacher mode: "quiz me on photosynthesis", "test me" */
I('quiz', t => /\b(quiz|test me|mcq|question answer|practice)\b/.test(t) ? 1 : 0,
  t => {
    const q = t.replace(/\b(quiz me on|quiz me|quiz on|quiz|test me on|test me|practice|mcq|start)\b/gi, '').trim();
    return { say: null, action: { type: 'quiz', topic: q || 'general knowledge' } };
  }, 6);

/* image maker: "make an image of a cyberpunk city" */
I('image_make', t => /\b(make|create|generate|draw|banao)\b.*\b(image|picture|photo|wallpaper|painting)\b|\bimage of\b/.test(t) ? 1 : 0,
  t => {
    let q = t.replace(/\b(make|create|generate|draw|banao|an|a|me|image|picture|photo|wallpaper|painting|of|please)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    return { say: null, action: { type: 'image_make', prompt: q || t } };
  }, 6);
