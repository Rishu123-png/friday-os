/* ===== FRIDAY OS — Intent Engine =====
   100% offline. No key, no network, no model.
   Handles ~70% of everyday assistant use instantly.

   Each intent: { id, score(text) -> 0..1, run(text, ctx) -> {say, action?} } */

import { getSetting, KEYS, addItem, getList, removeItem, updateItem, remember } from './store.js';
import { parseTime, humanTime, safeMath, cleanSubject, fuzzyHas, keywordScore, pick } from './nlp.js';
import { persona } from './ai.js';
import { convertUnit, generatePassword } from './templates.js';
import { parseAlarm, parseRoutine, findRoutine, alarms, describeAlarm } from './automation.js';
import { isNative } from './native.js';

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
    const contacts = getList(KEYS.CONTACTS);
    const hit = contacts.find(c => c.name.toLowerCase().includes(name.toLowerCase()) || fuzzyHas(c.name, name));
    if (hit) return { say: `Calling ${hit.name}.`, action: { type: 'call', number: hit.phone, name: hit.name } };
    if (isNative()) return { say: null, action: { type: 'contact_lookup', name, mode: 'call' } };
    return { say: `I don't have "${name}" in contacts. Add them in the Contacts panel, or say the number.`, action: { type: 'open_panel', panel: 'sub-contacts' } };
  }, 3);

I('message', t => /\b(text|message|whatsapp|sms)\s+\w+/.test(t) ? 1 : 0,
  t => {
    const rest = t.replace(/\b(send a|send|text|message|whatsapp|sms|to)\b/gi, '').trim();
    const [namePart, ...msgParts] = rest.split(/\s+saying\s+|\s+that\s+|:/);
    const name = cleanSubject(namePart || '');
    const msg = msgParts.join(' ').trim();
    const contacts = getList(KEYS.CONTACTS);
    const hit = contacts.find(c => fuzzyHas(c.name, name));
    const isWa = /whatsapp/.test(t);
    if (hit) return {
      say: `Opening ${isWa ? 'WhatsApp' : 'messages'} for ${hit.name}.`,
      action: { type: isWa ? 'whatsapp' : 'sms', number: hit.phone, body: msg, name: hit.name }
    };
    if (isNative()) return { say: null, action: { type: 'contact_lookup', name, mode: 'sms', body: msg } };
    return { say: `No contact named "${name}". Add them first.`, action: { type: 'open_panel', panel: 'sub-contacts' } };
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
      code: 'sub-coder', planner: 'sub-planner', research: 'sub-research', writer: 'sub-writer'
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
I('toggle_wifi', t => /\b(wifi|wi-fi)\b/.test(t) && /\b(on|off|enable|disable|turn)\b/.test(t) ? 1 : 0,
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

I('media', t => /\b(play|pause|resume|next song|next track|previous song|skip|stop music)\b/.test(t) && !/\b(play (a |the )?(game|video)|playlist)\b/.test(t) ? 1 : 0,
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

I('read_notifications', t => /\b(read.*notifications?|any notifications?|what.*notifications?|my notifications?)\b/.test(t) ? 1 : 0,
  () => ({ say: null, action: { type: 'read_notifications' } }), 5);

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

/* ------------------------------------------------------------------ */
/*  ROUTER                                                             */
/* ------------------------------------------------------------------ */

/**
 * Try to resolve text with the offline engine.
 * @returns {null | {say, action?, refresh?, expect?}}
 */
export function resolve(text, ctx = {}) {
  const t = text.toLowerCase().trim();
  if (!t) return null;

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
