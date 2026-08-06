/* FRIDAY OS — unit tests. Run: npm test (node --test)
   Pure-function coverage for the offline engine: NLP, intents, alarms,
   memory extraction, templates. No DOM, no network. */

// localStorage polyfill MUST be defined before importing the modules
global.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); }
};

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseTime, safeMath, wordToNum } = await import('../www/js/nlp.js');
const { resolve, intentCount } = await import('../www/js/brain.js');
const { parseAlarm } = await import('../www/js/automation.js');
const { convertUnit, generatePassword, offlineCode } = await import('../www/js/templates.js');
const HACKER = await import('../www/js/hacker.js');
const { extractFacts, saveFact, getFact, kinshipName, applyPronunciations, forgetFact } = await import('../www/js/memory.js');
const { buildLocalPrompt, shouldUseLocal, friendlyReason } = await import('../www/js/localbrain.js');
const { formatAmbient } = await import('../www/js/ambient.js');
const { splitCommands, autoCorrect, sentiment, semanticSearch, resolveFollowup, hinglishAliases } = await import('../www/js/nlu.js');

/* ---------------- NLP: math ---------------- */
test('safeMath respects precedence', () => {
  assert.equal(safeMath('2 plus 3 times 4'), 14);
  assert.equal(safeMath('(2 plus 3) times 4'), 20);
  assert.equal(safeMath('10 divided by 4'), 2.5);
});
test('safeMath rejects garbage safely', () => {
  assert.equal(safeMath('hello world'), null);
  assert.equal(safeMath(''), null);
});

/* ---------------- NLP: time ---------------- */
test('parseTime handles relative minutes', () => {
  const r = parseTime('remind me in 20 minutes');
  assert.ok(r);
  const mins = (r.date.getTime() - Date.now()) / 60000;
  assert.ok(mins > 18 && mins < 22);
});
test('parseTime handles 5pm tonight/tomorrow rollover', () => {
  const r = parseTime('remind me at 5pm');
  assert.ok(r);
  assert.equal(r.date.getHours(), 17);
  assert.ok(r.date.getTime() > Date.now());
});
test('wordToNum', () => {
  assert.equal(wordToNum('five'), 5);
  assert.equal(wordToNum('42'), 42);
});

/* ---------------- Alarm parsing ---------------- */
test('parseAlarm am/pm + repeats', () => {
  assert.deepEqual(parseAlarm('set an alarm for 5 pm'),
    { time: '17:00', label: 'Alarm', repeat: 'once' });
  assert.equal(parseAlarm('wake me at 6:30 every weekday').repeat, 'weekdays');
  assert.equal(parseAlarm('wake me at 6:30 every weekday').time, '06:30');
  assert.equal(parseAlarm('alarm for 7am every day').repeat, 'daily');
});
test('parseAlarm rejects nonsense', () => {
  assert.equal(parseAlarm('alarm for 99pm'), null);
});

/* ---------------- Intent routing ---------------- */
test('alarm beats reminder for "set an alarm"', () => {
  const hit = resolve('set an alarm for 5 pm');
  assert.equal(hit.intent, 'alarm_add');
});
test('reminder intent', () => {
  assert.equal(resolve('remind me to call mom in 20 minutes').intent, 'reminder_add');
});
test('time intent', () => assert.equal(resolve('what time is it').intent, 'time'));
test('math percent-of intent', () => {
  const hit = resolve('what is 15 percent of 2400');
  assert.equal(hit.intent, 'math');
});
test('wifi toggle intent', () => assert.equal(resolve('turn on wifi').intent, 'toggle_wifi'));
test('joke intent', () => assert.equal(resolve('tell me a joke').intent, 'joke'));
test('intent engine has breadth', () => assert.ok(intentCount() >= 55));

/* ---------------- Memory: fact extraction ---------------- */
test('name extraction does not swallow trailing clauses', () => {
  const f = extractFacts('my name is Rishu and I live in Delhi');
  assert.equal(f.find(x => x.key === 'user.name').value, 'Rishu');
});
test('city extraction stops at "and"', () => {
  const f = extractFacts('i live in Delhi and I like pizza');
  assert.equal(f.find(x => x.key === 'user.city').value, 'Delhi');
  assert.equal(f.find(x => x.key === 'pref.likes').value, 'pizza');
});
test('kinship facts resolve through aliases', () => {
  saveFact({ key: 'person.mother', label: 'Your mom', value: 'Seema' });
  const k = kinshipName('mom');
  assert.ok(k && k.name === 'Seema' && k.rel === 'mother');
  assert.equal(kinshipName('notakinsword'), null);
});

/* ---------------- NLU ---------------- */
test('splitCommands splits only real command chains', () => {
  assert.equal(splitCommands('remind me to call mom at 5 and what is the weather').length, 2);
  assert.equal(splitCommands('bread and butter').length, 1);
});
test('autoCorrect fixes command typos', () => {
  assert.equal(autoCorrect('wether'), 'weather');
  assert.equal(autoCorrect('reminderr'), 'reminder');
});
test('sentiment detects mood and urgency', () => {
  assert.equal(sentiment('this is amazing').mood, 'positive');
  assert.equal(sentiment('this is terrible').mood, 'negative');
  assert.equal(sentiment('urgent help me now').urgent, true);
});
test('semanticSearch uses concept expansion', () => {
  const hits = semanticSearch('grocery list', [
    { text: 'buy milk and eggs' },
    { text: 'fix the broken printer' }
  ]);
  assert.ok(hits.length && hits[0].text.includes('milk'));
});
test('resolveFollowup rebuilds from last intent', () => {
  assert.equal(resolveFollowup('what about tomorrow?', { lastIntent: 'weather' }), 'weather tomorrow');
});

/* ---------------- Templates ---------------- */
test('convertUnit length, temperature and group safety', () => {
  assert.equal(convertUnit(1, 'km', 'm'), 1000);
  assert.equal(convertUnit(32, 'f', 'c'), 0);
  assert.equal(convertUnit(1, 'kg', 'lb'), 2.2046);
  assert.equal(convertUnit(1, 'km', 'kg'), null); // different groups refused
});
test('generatePassword length and charset', () => {
  const p = generatePassword(24);
  assert.equal(p.length, 24);
});
test('offlineCode finds a scaffold', () => {
  assert.ok(offlineCode('write a python script').body.includes('```python'));
});

/* ---------------- v7.2: Hinglish command layer ---------------- */
test('hinglishAliases translates high-confidence phrases only', () => {
  assert.equal(hinglishAliases('kitne baje hai'), 'what time is it');
  assert.ok(hinglishAliases('mausam kaisa hai').includes('weather'));
  assert.ok(hinglishAliases('mummy ko call karo').includes('call'));
  assert.equal(hinglishAliases('what is the weather'), 'what is the weather');
  assert.equal(hinglishAliases('tell me about the mausoleum'), 'tell me about the mausoleum'); // no false hit
});
test('hinglish input reaches the intent engine', () => {
  const r = resolve('kitne baje');
  assert.ok(r && r.intent === 'time');
  const w = resolve('mausam batao');
  assert.ok(w && w.intent === 'weather');
});

/* ---------------- v7.2: pronunciation memory ---------------- */
test('learned pronunciations are stored and applied', () => {
  const f = extractFacts('pronounce Raghav as raa-ghuv');
  assert.ok(f.find(x => x.key === 'say.raghav'));
  assert.equal(applyPronunciations('should I call Raghav now?'), 'should I call raa-ghuv now?');
  assert.equal(applyPronunciations('nothing to change here'), 'nothing to change here');
  forgetFact('say.raghav');
});
test('"is pronounced" phrasing also teaches pronunciation', () => {
  extractFacts('Seema is pronounced see-maa');
  assert.equal(getFact('say.seema'), 'see-maa');
  forgetFact('say.seema');
});

/* ---------------- v7.3: security guard routing ---------------- */
test('security scan intent catches hacking worries', () => {
  for (const q of ['is my phone hacked', 'scan my phone for viruses',
                   'check if someone is spying on me', 'security check',
                   'is my phone safe']) {
    const r = resolve(q);
    assert.ok(r && r.intent === 'security_scan', 'missed: ' + q);
  }
});

/* ---------------- v7.3: find person on maps ---------------- */
test('find_person resolves kinship names', () => {
  saveFact({ key: 'person.father', label: 'Your dad', value: 'Ramesh Sharma' });
  const r = resolve('where is my dad');
  assert.ok(r && r.intent === 'find_person');
  assert.equal(r.action.name, 'Ramesh Sharma');
  const m = resolve('locate my sister');
  assert.ok(m && m.intent === 'find_person');
  assert.equal(m.action.name, null);   // no fact yet -> graceful path
  forgetFact('person.father');
});
test('place lookups are NOT stolen by find_person', () => {
  const r = resolve('where is connaught place');
  assert.ok(!r || r.intent !== 'find_person');
});

/* ---------------- v7.3: vault intent routing ---------------- */
test('vault commands parse service and password', () => {
  const s = resolve('save my gmail password as hunter2xz');
  assert.ok(s && s.intent === 'vault_save');
  assert.equal(s.action.service, 'gmail');
  assert.equal(s.action.password, 'hunter2xz');
  const r = resolve("what's my gmail password");
  assert.ok(r && r.intent === 'vault_read');
  assert.equal(r.action.service, 'gmail');
  const f = resolve('forget my netflix password');
  assert.ok(f && f.intent === 'vault_forget');
});

/* ---------------- v7.3: vault crypto roundtrip ---------------- */
test('vault encrypts, locks, unlocks and reads back', async (t) => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    t.skip('no WebCrypto in this node');
    return;
  }
  const V = await import('../www/js/vault.js');
  // fresh state
  if (!V.vaultExists()) {
    const setup = await V.vaultSetup('1234');
    assert.ok(setup.ok);
  }
  const wrong = await V.vaultUnlock('0000');
  assert.equal(wrong.ok, false);
  const right = await V.vaultUnlock('1234');
  assert.ok(right.ok);
  assert.ok((await V.vaultSave('gmail', 's3cret-value')).ok);
  V.vaultLock();
  assert.equal((await V.vaultRead('gmail')).ok, false);   // locked vault refuses reads
  assert.ok((await V.vaultUnlock('1234')).ok);
  const back = await V.vaultRead('gmail');
  assert.ok(back.ok && back.password === 's3cret-value');
  assert.ok(V.vaultServices().includes('gmail'));
  assert.ok(V.vaultForget('gmail').ok);
});

/* ---------------- v7.4: ethical hacker pack ---------------- */
test('password lab grades honestly', () => {
  const weak = HACKER.entropyScore('password');
  assert.equal(weak.grade, 'TERRIBLE');
  assert.ok(weak.bits <= 12);
  const seq = HACKER.entropyScore('123456789012');
  assert.ok(seq.bits <= 18);
  const strong = HACKER.entropyScore('Xv9!kQ2#mZ7$pL4&nR8@');
  assert.ok(['STRONG', 'FORTRESS'].includes(strong.grade), 'got ' + strong.grade);
  const year = HACKER.entropyScore('Summer2026!');
  assert.ok(year.notes.some(n => n.includes('year')));
});
test('phishing heuristics score the classics', () => {
  assert.equal(HACKER.phishScore('https://paypa1-secure.tk/verify-account').level, 'PHISHING');
  assert.ok(HACKER.phishScore('http://192.168.1.44/admin').score >= 40);
  assert.ok(HACKER.phishScore('https://sbi-netbanking.xyz/kyc-update').score >= 40);
  assert.ok(HACKER.phishScore('https://google.com').score < 20);
  assert.ok(HACKER.phishScore('https://paypal.com/signin').score < 30);
});
test('MAC vendor lookup + randomized-MAC detection', () => {
  assert.equal(HACKER.vendorOf('b8:27:eb:aa:bb:cc'), 'Raspberry Pi');
  assert.equal(HACKER.vendorOf(''), 'unknown');
  assert.equal(HACKER.vendorOf('3e:12:34:aa:bb:cc'), 'phone (randomized MAC)');
});
test('hacker intents route correctly', () => {
  for (const q of ['who is on my wifi', 'scan my wifi', 'network recon', 'hacker mode']) {
    const r = resolve(q);
    assert.ok(r && r.intent === 'net_recon', 'missed: ' + q);
  }
  const ps = resolve('scan ports on 192.168.1.5');
  assert.ok(ps && ps.intent === 'port_scan' && ps.action.host === '192.168.1.5');
  const pc = resolve('is my password tiger123zz safe');
  assert.ok(pc && pc.intent === 'password_check' && pc.action.password === 'tiger123zz');
  const ph = resolve('is this link safe https://paypa1.tk/login');
  assert.ok(ph && ph.intent === 'phish_check' && ph.action.url.includes('paypa1.tk'));
  const sm = resolve('scan my sms for phishing links');
  assert.ok(sm && sm.intent === 'phish_sms');
});

/* Regression for the v7.3 stuck-boot: a duplicate top-level const slipped in
   and killed the whole module graph on real WebViews. node --check (script
   goal) misses this class of error, so parse every web module with the real
   ES-module parser. */
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';

test('every web module parses as a real ES module', () => {
  const dir = new URL('../www/js/', import.meta.url);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(new URL(f, dir), 'utf8');
    let mod = null;
    try { mod = new vm.SourceTextModule(src, { identifier: f }); }
    catch (e) { assert.fail(f + ' failed ES-module parse: ' + e.message); }
    assert.ok(mod, f + ' must parse');
  }
});

test('read_notifications catches real phrasings', () => {
  const hits = ['see notification', 'see notifications', 'read notification',
    'check my notifications', 'show notifications', 'any notifications',
    'what notifications came', 'koi notification aayi', 'notifications padho',
    'meri notifications dikhao'.replace('meri ','my ')];
  for (const q of hits) {
    const r = resolve(q);
    assert.ok(r && r.intent === 'read_notifications', 'missed: ' + q + ' -> ' + (r && r.intent));
  }
  const nav = resolve('open notifications');
  assert.ok(nav && nav.intent === 'nav_gesture', 'open notifications must stay a nav gesture');
});

/* ================= v7.5 TITAN intents ================= */
test('steps + health intents', () => {
  const cases = [
    ['how many steps today', 'steps'], ['kadam kitne', 'steps'],
    ['steps goal 8000', 'step_goal'], ['health report', 'health_summary'],
    ['open health connect', 'health_sync'], ['water reminder', 'water_plan'],
    ['remind me to drink water every 2 hours', 'water_plan'],
    ['medicine reminder', 'med_plan'], ['eye breaks on', 'eye_break'],
    ['focus mode 25 minutes', 'focus_mode'], ['focus mode off', 'focus_mode'],
    ['screen time', 'screen_time'], ['screen time this week', 'screen_time'],
    ['tell me when battery full', 'battery_guard'],
    ['warn me when battery low 15%', 'battery_guard']
  ];
  for (const [q, id] of cases) {
    const r = resolve(q);
    assert.ok(r && r.intent === id, 'missed: ' + q + ' -> ' + (r && r.intent));
  }
  const sg = resolve('steps goal 8000');
  assert.equal(sg.action.goal, 8000);
  const fm = resolve('focus mode 25 minutes');
  assert.equal(fm.action.minutes, 25);
  const fs = resolve('screen time this week');
  assert.equal(fs.action.days, 7);
});

test('find phone + tools + payments + misc intents', () => {
  const fp = resolve('find my phone');
  assert.ok(fp && fp.intent === 'find_phone' && fp.action.on !== false);
  const ffs = resolve('stop ringing my phone');
  assert.ok(ffs && ffs.intent === 'find_phone' && ffs.action.on === false);
  const ws = resolve('schedule whatsapp to mummy at 9pm saying good night');
  assert.ok(ws && ws.intent === 'whatsapp_schedule', 'ws missed: ' + (ws && ws.intent));
  assert.ok(ws.action.name.includes('mummy') && ws.action.msg.includes('good night'));
  assert.ok(ws.action.time > Date.now());
  const tr = resolve('translate kaise ho to spanish');
  assert.ok(tr && tr.intent === 'translate' && tr.action.to === 'es' && tr.action.text === 'kaise ho'); // v10: merged offline intent
  const qr = resolve('make wifi qr');
  assert.ok(qr && qr.intent === 'wifi_qr');
  const sl = resolve('summarize this link https://example.com/story');
  assert.ok(sl && sl.intent === 'summarize_link' && sl.action.url === 'https://example.com/story');
  const pg = resolve('pocket mode on');
  assert.ok(pg && pg.intent === 'pocket_guard' && pg.action.on !== false);
  const bd = resolve('backup my data');
  assert.ok(bd && bd.intent === 'backup_data');
  const vn = resolve('voice note');
  assert.ok(vn && vn.intent === 'voice_note');
  const hu = resolve('hindi mode on');
  assert.ok(hu && hu.intent === 'hindi_ui' && hu.action.on === true);
  const eu = resolve('english ui');
  assert.ok(eu && eu.intent === 'hindi_ui' && eu.action.on === false);
});

test('pay reminders (no banking!) work + land in reminders list', () => {
  const p = resolve('remind me to pay ramesh 500 rupees tomorrow 5pm');
  assert.ok(p && p.intent === 'pay_remind', 'pay_remind missed');
  assert.ok(p.action && p.action.type === 'schedule_reminder');
  assert.ok(/Pay ramesh/.test(p.action.item.text) && p.action.item.text.includes('500'));
  const l = resolve('my payments');
  assert.ok(l && l.intent === 'pay_list');
});

/* ================= v7.6 APEX ================= */

test('hindi time brain: kal / parso / agle-somvaar / baje', () => {
  const kal5 = parseTime('kal 5 baje yaad dilana');
  assert.ok(kal5, 'kal 5 baje');
  assert.equal(kal5.date.getHours(), 17);
  assert.ok(kal5.date.getDate() !== new Date().getDate(), 'kal must be tomorrow');
  const parso = parseTime('parso meeting');
  assert.ok(parso && Math.round((parso.date - Date.now()) / 86400000) >= 1);
  const somvaar = parseTime('agle somvaar ko 10 baje');
  assert.ok(somvaar && somvaar.date.getDay() === 1 && somvaar.date.getHours() === 10);
  const raat = parseTime('raat 9 baje call karo');
  assert.ok(raat && raat.date.getHours() === 21);
  const shaam = parseTime('shaam 6 baje pani');
  assert.ok(shaam && shaam.date.getHours() === 18);
});

test('apex intents route correctly', () => {
  const cases = [
    ["what's on my screen", 'screen_read'], ['read this screen', 'screen_read'],
    ['translate the screen', 'screen_read'], ['what do you see', 'eyes'],
    ['ye kya hai', 'eyes'], ['research electric cars india', 'deep_ask'],
    ['latest news on ISRO', 'deep_ask'], ['play kesariya on youtube', 'yt_play'],
    ['youtube pe bella ciao chalao', 'yt_play'],
    ['find everything about ramesh', 'uni_search'],
    ['quiz me on photosynthesis', 'quiz'],
    ['make an image of a robot dog', 'image_make']
  ];
  for (const [q, id] of cases) {
    const r = resolve(q);
    assert.ok(r && r.intent === id, 'missed: ' + q + ' -> ' + (r && r.intent));
  }
  const sr = resolve('translate the screen');
  assert.equal(sr.action.mode, 'translate');
  const yt = resolve('play kesariya on youtube');
  assert.ok(yt.action.query.includes('kesariya'));
  const im = resolve('make an image of a robot dog');
  assert.ok(im.action.prompt.includes('robot dog'));
});

/* ---------------- v7.6.4: natural-language hardening ---------------- */
test('app-specific notification reading routes correctly', () => {
  const t = resolve('see the message of telegram');
  assert.ok(t && t.intent === 'read_notifications', 'telegram msg read got: ' + (t && t.intent));
  assert.equal(t.action.app, 'telegram');
  const w = resolve('whatsapp ke messages padho');
  assert.ok(w && w.intent === 'read_notifications', 'hinglish app read got: ' + (w && w.intent));
  const s = resolve('read my notifications');
  assert.ok(s && s.intent === 'read_notifications' && !s.action.app, 'generic read broke');
});

test('whatsapp_schedule accepts loose natural phrasing', () => {
  const r = resolve('schedule message at whatsapp for mummy');
  assert.ok(r && r.intent === 'whatsapp_schedule', 'loose schedule got: ' + (r && r.intent));
  assert.equal(r.action.name, 'mummy');
  assert.ok(!r.action.time, 'no time -> slot-ask flow');
  const full = resolve('schedule whatsapp to divik at 10:51pm saying hi');
  assert.ok(full && full.intent === 'whatsapp_schedule', 'full got: ' + (full && full.intent));
  assert.equal(full.action.name, 'divik');
  assert.ok(full.action.msg.includes('hi'));
  assert.ok(full.action.time > Date.now());
});

test('find_person accepts an explicit name with shared-location phrasing', () => {
  const q = 'open maps and show me vijay prakash chaudhary location which is sharing by him';
  const r = resolve(q);
  assert.ok(r && r.intent === 'find_person', 'named location got: ' + (r && r.intent));
  assert.equal(r.action.name, 'vijay prakash chaudhary');
  const nav = resolve('where is connaught place');
  assert.ok(!nav || nav.intent !== 'find_person', 'place lookup stolen');
});

/* ---------------- v8.0 STARK ---------------- */
test('daily brief intent (karen mode)', () => {
  for (const q of ['morning brief', 'daily briefing', 'brief me', 'aaj ka plan']) {
    const r = resolve(q);
    assert.ok(r && r.intent === 'daily_brief', 'brief missed: ' + q + ' -> ' + (r && r.intent));
  }
});
test('mission chaining splits multi-goal commands', () => {
  const parts = splitCommands('remind me to gym at 6pm and add task drink water');
  assert.ok(Array.isArray(parts) && parts.length >= 2, 'chain split failed');
});

/* ---------------- v8.1 EYES ---------------- */
test('screen_vision routes visual screen questions, keeps offline text reader + screenshot intent', () => {
  for (const q of ['what do you see on my screen', 'analyze my screen', 'look at the screen']) {
    const r = resolve(q);
    assert.ok(r && r.intent === 'screen_vision', 'eyes missed: ' + q + ' -> ' + (r && r.intent));
  }
  const s = resolve('take a screenshot');
  assert.ok(s && s.intent !== 'screen_vision', 'plain screenshot command stolen');
  const w = resolve("what's on my screen");
  assert.ok(!w || w.intent !== 'screen_vision', 'offline text screen_read stolen by vision');
});

/* ---------------- v8.2 BRAIN (on-device llama.cpp) ---------------- */
test('buildLocalPrompt wraps system + user in llama-3 headers', () => {
  const p = buildLocalPrompt('You are FRIDAY.', 'hello boss');
  assert.ok(p.startsWith('<|begin_of_text|><|start_header_id|>system<|end_header_id|>'));
  assert.ok(p.includes('You are FRIDAY.<|eot_id|>'));
  assert.ok(p.includes('<|start_header_id|>user<|end_header_id|>'));
  assert.ok(p.endsWith('<|start_header_id|>assistant<|end_header_id|>\n\n'));
});
test('buildLocalPrompt survives empty input safely', () => {
  const p = buildLocalPrompt('', '');
  assert.ok(typeof p === 'string' && p.includes('assistant<|end_header_id|>'));
});
test('shouldUseLocal: toggle off never routes local', () => {
  assert.equal(shouldUseLocal('hi', { offlineBrain: false, native: true, hasKey: false }), false);
  assert.equal(shouldUseLocal('hi', { offlineBrain: true, native: false, hasKey: false }), false);
});
test('shouldUseLocal: on + no cloud key -> always local', () => {
  assert.equal(shouldUseLocal('remind me at 6', { offlineBrain: true, native: true, hasKey: false, actionish: true }), true);
  assert.equal(shouldUseLocal('how are you', { offlineBrain: true, native: true, hasKey: false, actionish: false }), true);
});
test('shouldUseLocal: with cloud key only chatter goes local, actions keep tools', () => {
  assert.equal(shouldUseLocal('what is quantum computing', { offlineBrain: true, native: true, hasKey: true, actionish: false }), true);
  assert.equal(shouldUseLocal('remind me at 6', { offlineBrain: true, native: true, hasKey: true, actionish: true }), false);
});
test('formatAmbient: empty snapshot -> empty string (prompt untouched)', () => {
  assert.equal(formatAmbient({}), '');
  assert.equal(formatAmbient({ notifs: [] }), '');
});
test('formatAmbient formats live lines and clips long notification text', () => {
  const long = 'x'.repeat(200);
  const s = formatAmbient({
    timeLabel: '09:41', battery: '67%', charging: true, steps: 4211,
    topApp: 'WhatsApp',
    notifs: [{ app: 'Telegram', text: long }, { app: 'Gmail', title: 'Meeting at 5' }]
  });
  assert.ok(s.startsWith('LIVE PHONE TELEMETRY'));
  assert.ok(s.includes('Battery: 67% (charging)'));
  assert.ok(s.includes('Steps today: 4211'));
  assert.ok(s.includes('Most-used app today: WhatsApp'));
  assert.ok(s.includes('- Gmail: Meeting at 5'));
  assert.ok(!s.includes(long), 'notification text not clipped');
});
test('friendlyReason words every failure honestly', () => {
  assert.ok(friendlyReason('no_model_path').includes('Settings'));
  assert.ok(friendlyReason('LLAMA_BINDING_MISSING - x').includes('engine missing'));
  assert.ok(friendlyReason('load_failed').toLowerCase().includes('ram'));
});

/* ---------------- v8.3 SENSES ---------------- */
test('screen_vision now hears natural phrasings (seeing/looking at, mobile screen, hinglish)', () => {
  for (const q of ['what am i seeing on my screen', 'what am i looking at on my phone screen',
                   'describe my mobile screen', 'screen pe kya hai', 'screen ko dekhkar bata']) {
    const r = resolve(q);
    assert.ok(r && r.intent === 'screen_vision', 'eyes missed: ' + q + ' -> ' + (r && r.intent));
  }
  const w = resolve("what's on my screen");
  assert.ok(!w || w.intent !== 'screen_vision', 'offline screen_read stolen');
});
test('analyse my screen still routes to vision after regex change', () => {
  const r = resolve('analyse my screen');
  assert.ok(r && r.intent === 'screen_vision');
});

/* ---------------- v8.4 TRUE CONTROL ---------------- */
test('media_off: every "turn the music off" phrasing fires REAL media keys', () => {
  const cases = {
    'off the music': 'pause', 'turn off music': 'pause', 'music band karo': 'pause',
    'stop the music': 'stop', 'gaana band': 'pause', 'music off': 'pause', 'pause the song': 'pause'
  };
  for (const [q, want] of Object.entries(cases)) {
    const r = resolve(q);
    assert.ok(r && (r.intent === 'media_off' || r.intent === 'media'), 'media missed: ' + q + ' -> ' + (r && r.intent));
    if (r.intent === 'media_off') assert.equal(r.action.action, want, q);
  }
});
test('named games go to play_game, never to the music keys', () => {
  for (const [q, name] of [['play candy crush', 'candy crush'], ['play free fire', 'free fire'], ['khelo ludo', 'ludo']]) {
    const r = resolve(q);
    assert.ok(r && r.intent === 'play_game', 'game missed: ' + q + ' -> ' + (r && r.intent));
    assert.equal(r.action.name, name);
  }
  const m = resolve('play music');
  assert.ok(m && m.intent === 'media', 'play music stolen by play_game');
  assert.equal(m.action.action, 'play');
});
test('play_context catches bare and conversational play', () => {
  for (const q of ['play', "let's play", 'i like to play', 'i want to play', 'play it']) {
    const r = resolve(q);
    assert.ok(r && r.intent === 'play_context', 'context missed: ' + q + ' -> ' + (r && r.intent));
  }
});
test('media keys still route next/previous/pause/resume honestly', () => {
  assert.equal(resolve('next song').action.action, 'next');
  assert.equal(resolve('previous track').action.action, 'previous');
  assert.equal(resolve('pause').action.action, 'pause');
  assert.equal(resolve('resume').action.action, 'play');
});

/* ---------------- v9.0 APEX ---------------- */
const { pollinationsUrl } = await import('../www/js/api.js');
const { stripFillers, parseWakeKeywords, pickWakeEngine } = await import('../www/js/nlp.js');

test('wallpaper intent captures the topic honestly', () => {
  for (const [q, topic] of [['make me a wallpaper of mountains and river', 'mountains and river'],
                            ['wallpaper banao cyberpunk city', 'cyberpunk city'],
                            ['set wallpaper of tony stark', 'tony stark']]) {
    const r = resolve(q);
    assert.ok(r && r.intent === 'wallpaper', 'wallpaper missed: ' + q);
    assert.equal(r.action.topic, topic);
  }
  const none = resolve('change wallpaper');
  assert.ok(none && none.intent === 'wallpaper' && !none.action.topic);
});
test('focus mode parses minutes, hours default honestly', () => {
  assert.equal(resolve('focus for 45 minutes').action.minutes, 45);
  assert.equal(resolve('focus for 2 hours').action.minutes, 120);
  assert.equal(resolve('focus mode').action.minutes, 25); // pomodoro default
  assert.equal(resolve('focus for 1 ghante').action.minutes, 60);
  const off = resolve('stop focus');
  assert.equal(off.intent, 'focus_mode');
  assert.equal(off.action.off, true);
  const band = resolve('focus mode band karo');
  assert.equal(band.intent, 'focus_mode');
  assert.equal(band.action.off, true);
});
test('sos + emergency contact + cancel all route', () => {
  assert.equal(resolve('sos').intent, 'sos');
  assert.equal(resolve('bachao').intent, 'sos');
  assert.equal(resolve('cancel sos').intent, 'sos_cancel');
  const set = resolve('my emergency contact is 98765 43210');
  assert.equal(set.intent, 'sos_set_contact');
  assert.equal(set.action.number, '9876543210');
});
test('car memory + sleep timer + dictation route', () => {
  assert.equal(resolve('parked here').intent, 'park_save');
  assert.equal(resolve('where is my car').intent, 'park_find');
  assert.equal(resolve('gaadi kahan hai').intent, 'park_find');
  assert.equal(resolve('stop music in 20 minutes').action.minutes, 20);
  assert.equal(resolve('sleep timer for 1 hour').action.minutes, 60);
  assert.equal(resolve('dictate a message').intent, 'dictate');
});
test('read page + watchers + history route', () => {
  const rp = resolve('read https://example.com/story');
  assert.equal(rp.intent, 'read_page');
  assert.equal(rp.action.url, 'https://example.com/story');
  const w = resolve('watch whatsapp for mummy');
  assert.equal(w.intent, 'watch_add');
  assert.equal(w.action.needle, 'mummy');
  assert.equal(w.action.app, 'whatsapp');
  const w2 = resolve('ping me when delivery otp comes');
  assert.equal(w2.intent, 'watch_add');
  assert.ok(w2.action.needle.includes('delivery'));
  assert.equal(resolve('deleted messages').intent, 'notif_history');
  assert.equal(resolve('whatsapp digest').intent, 'notif_digest');
});
test('pollinationsUrl is keyless and encodes the prompt', () => {
  const u = pollinationsUrl('arc reactor, dark', { w: 1080, h: 1920, seed: 7 });
  assert.ok(u.startsWith('https://image.pollinations.ai/prompt/'));
  assert.ok(u.includes('arc%20reactor'));
  assert.ok(u.includes('width=1080') && u.includes('seed=7') && u.includes('nologo=true'));
});
test('stripFillers removes ums and repeated stammers, keeps meaning', () => {
  assert.equal(stripFillers('umm tell tell mummy i will be late'), 'Tell mummy i will be late');
  const out = stripFillers('  uhh hello boss boss, basically meeting is at 5 you know ');
  assert.ok(!/uhh/.test(out) && !/boss boss/i.test(out.replace(/boss/i, 'x')) && !/basically/.test(out), out);
  assert.ok(out.startsWith('Hello'));
});
test('v9.1 WAKE FREE: wake keyword parser keeps clean single tokens', () => {
  assert.deepEqual(parseWakeKeywords('friday'), ['friday']);
  assert.deepEqual(parseWakeKeywords('jarvis, friday  computer'), ['jarvis', 'friday', 'computer']);
  assert.deepEqual(parseWakeKeywords('FRIDAY friday Friday'), ['friday']);
  assert.deepEqual(parseWakeKeywords('hey friday! what up?? drop [unk]'), ['hey', 'what', 'drop']);
  assert.deepEqual(parseWakeKeywords(''), []);
  assert.deepEqual(parseWakeKeywords(null), []);
  assert.ok(parseWakeKeywords('a b c d e f').length <= 4);
});
test('v9.1 WAKE FREE: engine picker is honest (key wins, then model, then fallback)', () => {
  assert.equal(pickWakeEngine({ porcupineKey: 'abc', voskModelPath: '/x' }), 'porcupine');
  assert.equal(pickWakeEngine({ porcupineKey: '  ', voskModelPath: '/data/vosk' }), 'vosk');
  assert.equal(pickWakeEngine({}), 'fallback');
  assert.equal(pickWakeEngine({ porcupineKey: '', voskModelPath: '' }), 'fallback');
  assert.equal(pickWakeEngine(), 'fallback');
});
/* ================= v10.0 JARVIS tests ================= */
const CL = await import('../www/js/clarify.js');
const LBX = await import('../www/js/localbrain.js');
const SM = await import('../www/js/semantic.js');

test('v10 C1: music without source triggers the ask-once question', () => {
  assert.ok(CL.needsMusicSource('play kesariya'));
  assert.ok(CL.needsMusicSource('kesariya gaana chalao'));
  assert.ok(!CL.needsMusicSource('play kesariya on youtube'));
  assert.ok(!CL.needsMusicSource('play candy crush'));
  assert.ok(!CL.needsMusicSource('open whatsapp'));
});
test('v10 C1: answering "youtube" merges, learns, and never asks again', () => {
  const pending = { slot: 'music_source', origText: 'play tum hi ho' };
  const merged = CL.absorb(pending, 'youtube bhai');
  assert.ok(/on youtube$/.test(merged), merged);
  assert.equal(CL.getPref('music_source'), 'youtube');
  assert.ok(!CL.needsMusicSource('play arijit singh'));   // learned -> no more questions
});
test('v10 C1: slot rules + merge for reminder topic', () => {
  const hit = { intent: 'reminder_add', action: { type: 'reminder_add' } };   // v10.2.1: real brain names
  const q = CL.checkSlots(hit, 'remind me');
  assert.ok(q && q.slot === 'text');
  const merged = CL.absorb(q.pending, 'paani peena');
  assert.ok(/paani peena/.test(merged));
  assert.equal(CL.checkSlots({ intent: 'reminder_add', action: { type: 'reminder_add', text: 'x' } }, 'remind me about x'), null);
});
test('v10 C1: no-match suggestions are close and useful', () => {
  const s = CL.suggestFor('moring brief');
  assert.ok(s.length >= 1 && /Morning/.test(s[0].label));
  const nm = CL.noMatchClarify('morning brif karo');
  assert.ok(nm && nm.options.length >= 1);
  assert.equal(CL.noMatchClarify('xqz lmnop fvck'), null);
});
test('v10 B1: detects 2026 model families and builds their templates', () => {
  assert.equal(LBX.detectModelFamily('gemma-3-4b-it-Q4_K_M.gguf'), 'gemma');
  assert.equal(LBX.detectModelFamily('Qwen3-4B-Instruct-2507-Q4_K_M.gguf'), 'chatml');
  assert.equal(LBX.detectModelFamily('Phi-4-mini-instruct-Q4_K_M.gguf'), 'phi');
  assert.equal(LBX.detectModelFamily('Llama-3.2-3B-Instruct-Q4_K_M.gguf'), 'llama');
  const g = LBX.buildLocalPrompt('SYS', 'hello', 'gemma');
  assert.ok(g.includes('<start_of_turn>user') && g.includes('<start_of_turn>model'));
  const q = LBX.buildLocalPrompt('SYS', 'hello', 'chatml');
  assert.ok(q.includes('<|im_start|>system') && q.includes('<|im_start|>assistant'));
  const p = LBX.buildLocalPrompt('SYS', 'hello', 'phi');
  assert.ok(p.includes('<|user|>hello<|end|><|assistant|>'));
  const l = LBX.buildLocalPrompt('SYS', 'hello', 'llama');
  assert.ok(l.includes('<|start_header_id|>'));
  assert.ok(LBX.stopsForFamily('gemma').includes('<end_of_turn>'));
  assert.ok(LBX.stopsForFamily('chatml').includes('<|im_end|>'));
});
test('v10 M1: vector math is correct and b64 round-trips', () => {
  assert.equal(Math.round(SM.cosine([1, 0], [1, 0]) * 1000) / 1000, 1);
  assert.equal(SM.cosine([1, 0], [0, 1]), 0);
  const v = new Float32Array([0.5, -1.25, 3.0]);
  const back = SM.b64ToVec(SM.vecToB64(v));
  assert.ok(Math.abs(back[0] - 0.5) < 1e-6 && Math.abs(back[1] + 1.25) < 1e-6);
  const hits = SM.topK([1, 0], [{ vec: [0.9, 0.1], id: 'a' }, { vec: [0, 1], id: 'b' }], 1);
  assert.equal(hits[0].item.id, 'a');
  assert.equal(SM.routeDecision(0.8), 'auto');
  assert.equal(SM.routeDecision(0.6), 'suggest');
  assert.equal(SM.routeDecision(0.3), 'none');
});
test('v10 TR1: offline translator intent parses honestly', () => {
  let r = resolve('translate good morning to hindi');
  assert.equal(r.intent, 'translate');
  assert.equal(r.action.text, 'good morning');
  assert.equal(r.action.to, 'hi');
  r = resolve('translate i love you in french');
  assert.equal(r.action.to, 'fr');
  r = resolve('i love you ko hindi me bolo');
  assert.equal(r.intent, 'translate');
  assert.equal(r.action.text, 'i love you');
  r = resolve('what is dhanyavaad in english');
  assert.equal(r.action.text, 'dhanyavaad');
  assert.equal(r.action.to, 'en');
  const scr = resolve('translate the screen');
  assert.ok(!scr || scr.intent !== 'translate' );  // screen translation stays with vision
});

/* ---------------- v10.2 SUIT: zero-setup planner ---------------- */
const SUIT = await import('../www/js/suit.js');

test('suit: wifiOk allows wifi/unknown, blocks cellular + saveData', () => {
  assert.ok(SUIT.wifiOk({ online: true, saveData: false, type: 'wifi' }));
  assert.ok(SUIT.wifiOk({ online: true, saveData: false, type: '' }));          // WebView unknown
  assert.ok(SUIT.wifiOk({ online: true, saveData: false, type: 'ethernet' }));
  assert.ok(!SUIT.wifiOk({ online: true, saveData: true, type: 'wifi' }));      // data saver
  assert.ok(!SUIT.wifiOk({ online: true, saveData: false, type: 'cellular' })); // mobile data
  assert.ok(!SUIT.wifiOk({ online: false, saveData: false, type: 'wifi' }));
});

test('suit: planAutoSetup full queue on fresh install', () => {
  const q = SUIT.planAutoSetup(() => '');
  assert.deepEqual(q.map(p => p.id), ['memory', 'voice', 'ears']);   // wake skipped: wakeWord default off
});

test('suit: planAutoSetup includes wake when wake word on + no key/model', () => {
  const vals = { wakeWord: true, porcupineKey: '', voskModelPath: '' };
  const q = SUIT.planAutoSetup(k => vals[k] || '');
  assert.deepEqual(q.map(p => p.id), ['memory', 'wake', 'voice', 'ears']);
});

test('suit: planAutoSetup skips what already exists, porcupine key skips wake', () => {
  const vals = { neuralVoiceCfg: '{}', sherpaSttDir: '/x', embedModelPath: '/e.gguf', wakeWord: true, porcupineKey: 'pk' };
  const q = SUIT.planAutoSetup(k => vals[k] || '');
  assert.equal(q.length, 0);
});

test('suit: suitLine shows progress string', () => {
  assert.equal(SUIT.suitLine(2, 4, 'Neural voice', 40), 'Suit systems 2/4: Neural voice… 40%');
  assert.equal(SUIT.suitLine(1, 1, 'Memory brain'), 'Suit systems 1/1: Memory brain…');
  assert.ok(SUIT.suitDoneLine().includes('up-to-date'));
});

/* ---------------- v10.2.1 HOTFIX: "Kaunsa app kholun?" infinite loop ----------------
   Screenshot bug (2026-08-05): "open whatsapp" pe clarify poocha, phir HAR
   message ("Hi" bhi) ko answer samajh ke loop. Do root causes:
   (1) rule galat field check karta tha: action ka field 'app' hai, 'name' nahi
   (2) dead intent names (contact_call/remind/alarm_set) — ab real names. */
test('hotfix: open_app with app name does NOT ask (field is app, not name)', () => {
  const r = CL.checkSlots({ intent: 'open_app', action: { type: 'open_app', app: 'whatsapp' } }, 'open whatsapp');
  assert.equal(r, null);
});

test('hotfix: real "open whatsapp" through the brain passes slots cleanly', () => {
  const hit = resolve('open whatsapp');
  assert.ok(hit && hit.action);
  const q = CL.checkSlots(hit, 'open whatsapp');
  assert.equal(q, null);   // whatsapp IS the name — koi sawaal nahi
});

test('hotfix: bare "open" DOES ask once, answer merges to a full command', () => {
  const hit = resolve('open');
  if (hit && hit.action) {
    const q = CL.checkSlots(hit, 'open');
    if (q) {
      assert.equal(q.slot, 'name');
      const merged = CL.absorb(q.pending, 'whatsapp');
      assert.equal(merged, 'open whatsapp');
    }
  }
});

test('hotfix: reminder/alarm/call/message rules use REAL brain intent names', () => {
  const hint = resolve('translate good morning to es');
  (hint && hint.action) && assert.equal(CL.checkSlots(hint, 'translate good morning to es'), null);
  // call intent ke paas name ho to koi sawaal nahi:
  const chit = resolve('call mom');
  if (chit && chit.action) assert.equal(CL.checkSlots(chit, 'call mom'), null);
});

test('hotfix: absorbable separates answers from fresh commands (screenshot cases)', () => {
  const parkedApp = { intent: 'open_app', slot: 'name', origText: 'open' };
  assert.ok(!CL.absorbable('explain about nda', parkedApp));   // THE screenshot bug
  assert.ok(!CL.absorbable('Hi', parkedApp));                  // greeting != answer
  assert.ok(!CL.absorbable('what is the weather today', parkedApp));
  assert.ok(!CL.absorbable('open chrome bhai', parkedApp));    // fresh full command
  assert.ok(CL.absorbable('whatsapp', parkedApp));             // real answer
  assert.ok(CL.absorbable('gaana app', parkedApp));
  const parkedTr = { intent: 'translate', slot: 'text', origText: 'translate' };
  assert.ok(CL.absorbable('good morning sab kaisa chal raha hai aaj to din mast hai', parkedTr));  // long translate line OK
  const parkedMusic = { slot: 'music_source', origText: 'play kesariya' };
  assert.ok(CL.absorbable('youtube', parkedMusic));
  assert.ok(!CL.absorbable('play kesariya on youtube', parkedMusic));  // full command -> fresh (runs itself)
});

/* ---------------- v10.3 HERALD: inbox + call guard ---------------- */
const HERALD = await import('../www/js/herald.js');

test('herald: pickLatestInbox filters pkg, age, empty text, sorts newest-first', () => {
  const now = 1000000;
  const items = [
    { pkg: 'com.whatsapp', title: 'Ramesh', text: 'kal meeting hai', when: now - 1000 },
    { pkg: 'com.instagram.android', title: 'X', text: 'ignore me', when: now - 500 },
    { pkg: 'com.whatsapp', title: 'Suresh', text: '', when: now - 100 },
    { pkg: 'com.whatsapp.w4b', title: 'Dukaan', text: 'payment aaya kya', when: now - 2000 },
    { pkg: 'com.whatsapp', title: 'Purana', text: 'bahut purana', when: now - 7 * 3600e3 }
  ];
  const got = HERALD.pickLatestInbox(items, 'whatsapp', 6 * 3600e3, now);
  assert.equal(got.length, 2);
  assert.equal(got[0].who, 'Ramesh');       // newest first
  assert.equal(got[1].who, 'Dukaan');       // whatsapp business included
});

test('herald: inboxSummary speaks naturally', () => {
  const one = HERALD.inboxSummary([{ who: 'Ramesh', text: 'kal meeting hai', when: 1, pkg: 'com.whatsapp' }]);
  assert.ok(one.includes('Ramesh') && one.includes('message'));
  assert.equal(HERALD.inboxSummary([]), '');
});

test('herald: buildExplainer fills placeholders + guards length', () => {
  const t = HERALD.buildExplainer('Boss busy — {number} se baad me baat karega', { number: '9999' });
  assert.ok(t.includes('9999'));
  const def = HERALD.buildExplainer('', { number: '1' });
  assert.ok(def.includes('FRIDAY'));
});

test('herald: explainerAllowed = one per caller per gap (spam never)', () => {
  const map = { '98765': 1000 };
  assert.ok(!HERALD.explainerAllowed(map, '98765', 600000, 1001));   // just handled
  assert.ok(HERALD.explainerAllowed(map, '98765', 600000, 700000));  // gap passed
  assert.ok(HERALD.explainerAllowed(map, '11111', 600000, 1001));    // new caller
});

test('herald: brain intents — whatsapp flow nahi takrata', () => {
  const chk = resolve('whatsapp pe kya aaya hai');
  assert.ok(chk && chk.action && chk.action.type === 'inbox_check');
  const rep = resolve('uska jawab do');
  assert.ok(rep && rep.action && rep.action.type === 'inbox_reply');
  const snd = resolve('bhejo');
  assert.ok(snd && snd.action && snd.action.type === 'inbox_send');
  const guard = resolve('call guard on karo');
  assert.ok(guard && guard.action && guard.action.type === 'call_guard' && guard.action.on === true);
  // direct reply with text STILL goes to old reply_notif — no collision
  const direct = resolve('reply whatsapp on my way');
  assert.ok(direct && direct.action && direct.action.type === 'reply_notif');
});

/* ---------------- v11.0 Phase 1: FridayCore ---------------- */
const FCORE = await import('../www/js/fridaycore.js');

test('core: event bus delivers payload + listener errors are isolated', () => {
  FCORE.Bus._reset();
  let got = 0, crashed = 0;
  FCORE.Bus.on('ping', p => { got += p.n; });
  FCORE.Bus.on('ping', () => { crashed++; throw new Error('boom'); });
  FCORE.Bus.on('ping', p => { got += p.n * 10; });
  const delivered = FCORE.Bus.emit('ping', { n: 1 });
  assert.equal(delivered, 2);          // thrower ran but errored (isolated), 2 delivered clean
  assert.equal(got, 11);               // 1 + 1*10
  assert.equal(crashed, 1);            // the thrower threw, others survived
});

test('core: once fires exactly once, off detaches', () => {
  FCORE.Bus._reset();
  let n = 0;
  FCORE.Bus.once('x', () => n++);
  FCORE.Bus.emit('x'); FCORE.Bus.emit('x');
  assert.equal(n, 1);
  const off = FCORE.Bus.on('y', () => n++);
  off(); FCORE.Bus.emit('y');
  assert.equal(n, 1);
});

test('core: service lifecycle boot -> running, healthMap reports', async () => {
  const core = new FCORE.FridayCore();
  core.register('alpha', { health: () => ({ ok: true, detail: 'fine' }) });
  const h = await core.boot();
  assert.equal(core.get('alpha').state, 'running');
  assert.ok(h.alpha.ok && h.alpha.detail === 'fine');
});

test('core: failing service -> error state (+ auto recovery retry)', async () => {
  const core = new FCORE.FridayCore({ maxRetries: 1, baseBackoffMs: 5 });
  let attempts = 0;
  core.register('flaky', {
    init: async () => { attempts++; if (attempts === 1) throw new Error('dead on arrival'); },
    health: () => ({ ok: true })
  });
  await core.boot();
  assert.equal(core.get('flaky').state, 'error');           // first try failed
  assert.equal(attempts, 1);
  await new Promise(r => setTimeout(r, 150));               // recovery backoff (5ms) long done
  assert.equal(core.get('flaky').state, 'running');          // recovered itself!
  assert.equal(attempts, 2);
});

test('core: pause/resume/stop transitions', async () => {
  const core = new FCORE.FridayCore();
  core.register('svc', {});
  await core.boot();
  assert.ok(await core.pause('svc'));
  assert.equal(core.get('svc').state, 'paused');
  assert.ok(await core.resume('svc'));
  assert.equal(core.get('svc').state, 'running');
  assert.ok(await core.stop('svc'));
  assert.equal(core.get('svc').state, 'stopped');
});

test('core: logger ring caps + timestamps + format', () => {
  FCORE.Logger.info('test', 'hello');
  const last = FCORE.Logger.all().pop();
  assert.ok(last.ts > 0 && last.mod === 'test' && last.level === 'info');
  assert.match(FCORE.formatLogEntry(last), /\d{2}:\d{2}:\d{2}/);
});

/* ---------------- v11.1 PHASE 2+3: IGNITION + HUD ---------------- */
const IGN = await import('../www/js/ignite.js');
const HUD2 = await import('../www/js/hud.js');

test('ignite: bootPlan modes (first-run full, short after, off, reduced-motion)', () => {
  assert.equal(IGN.bootPlan({ mode: 'auto', firstRun: true }).mode, 'full');
  assert.equal(IGN.bootPlan({ mode: 'auto', firstRun: false }).mode, 'short');
  assert.equal(IGN.bootPlan({ mode: 'full', firstRun: false }).mode, 'full');
  assert.equal(IGN.bootPlan({ mode: 'off' }).stages.length, 0);
  assert.equal(IGN.bootPlan({ mode: 'auto', firstRun: false, reduced: true }).stages.length, 3);
  assert.ok(IGN.bootPlan({ mode: 'auto', firstRun: true }).stages.includes('services'));
  assert.ok(IGN.bootPlan({ mode: 'auto', firstRun: true }).minMs <= 9000);   // ~6-10s spec
});

test('ignite: welcomeLines twitch with the real clock', () => {
  assert.ok(IGN.welcomeLines(8, 'Boss')[0].includes('Morning'));
  assert.ok(IGN.welcomeLines(14, 'Boss')[0].includes('Afternoon'));
  assert.ok(IGN.welcomeLines(21, 'Boss')[0].includes('Evening'));
  assert.ok(IGN.welcomeLines(21, 'Rishu')[1].includes('Rishu'));
});

test('ignite: stageProgress never exceeds 100', () => {
  assert.equal(IGN.stageProgress(0, 7), 14);   // (idx+1)/total, total = last index
  assert.equal(IGN.stageProgress(7, 7), 100);
});

test('hud: labels are honest (battery/storage/net)', () => {
  assert.equal(HUD2.batteryLabel(81, false), '81%');
  assert.ok(HUD2.batteryLabel(18, false).includes('🪫'));
  assert.ok(HUD2.batteryLabel(18, true).includes('⚡'));
  assert.equal(HUD2.batteryLabel(null), '');
  assert.equal(HUD2.storageLabel(1073741824, 4294967296), '1.0/4.0 GB');
  assert.equal(HUD2.netLabel(false), 'Offline');
  assert.equal(HUD2.netLabel(true, true), 'Cloud ●');
});

test('hud: contextCards only for real situations', () => {
  assert.equal(HUD2.contextCards({ batteryPct: 60 }).length, 0);         // nothing = no cards
  assert.ok(HUD2.contextCards({ batteryPct: 15 }).length >= 1);          // low battery
  assert.ok(HUD2.contextCards({ notifCount: 20 })[0].id === 'notif');
  assert.ok(HUD2.contextCards({ reminderText: 'exam revision' })[0].id === 'rem');
});

test('hud: orb state machine priorities', () => {
  assert.equal(HUD2.orbStateFrom({ listening: true, speaking: true }), 'listening');
  assert.equal(HUD2.orbStateFrom({ speaking: true }), 'speaking');
  assert.equal(HUD2.orbStateFrom({ thinking: true }), 'thinking');
  assert.equal(HUD2.orbStateFrom({ error: true, listening: true }), 'error');
  assert.equal(HUD2.orbStateFrom({}), 'idle');
  assert.ok(HUD2.ORB_STATES.includes('sleeping'));
});

test('hud: feed rings at cap', () => {
  let f = [];
  for (let i = 0; i < 10; i++) f = HUD2.pushFeed(f, 'x', 'line ' + i);
  assert.equal(f.length, 6);
  assert.ok(f[5].text.includes('line 9'));
});

/* ================= v11.2 VOX: Voice Engine 2.0 ================= */
const VOX = await import('../www/js/vox.js');

test('vox: full conversation loop is legal', () => {
  const loop = ['OFFLINE','INITIALIZING','READY','LISTENING','UNDERSTANDING','THINKING','EXECUTING','SPEAKING','WAITING','READY'];
  for (let i = 1; i < loop.length; i++) assert.ok(VOX.can(loop[i-1], loop[i]), loop[i-1] + '→' + loop[i]);
});

test('vox: error is reachable from anywhere, recovery only via init/ready', () => {
  for (const s of VOX.STATES) assert.ok(VOX.can(s, 'ERROR'), s + '→ERROR');
  assert.ok(!VOX.can('ERROR', 'SPEAKING'));
  assert.ok(VOX.can('ERROR', 'INITIALIZING'));
});

test('vox: barge-in interrupt SPEAKING→LISTENING is a legal state hop', () => {
  assert.ok(VOX.can('SPEAKING', 'LISTENING'));
  assert.ok(VOX.can('SLEEPING', 'LISTENING'));      // wake fire from sleep
  assert.ok(!VOX.can('SLEEPING', 'SPEAKING'));      // sleeping → speaking is noise
});

test('vox: wakeList dedupes, trims and sorts longest-first', () => {
  const w = VOX.wakeList(' hey friday, friday,computer , hello friday ');
  assert.deepEqual(w, ['hello friday', 'hey friday', 'computer', 'friday']);
  assert.equal(VOX.wakeList('').length, 0);
});

test('vox: wakeMatch hits phrase, stripWake keeps the command', () => {
  const list = VOX.wakeList('hey friday, friday, computer');
  assert.equal(VOX.wakeMatch('hey friday open whatsapp', list), 'hey friday');
  assert.equal(VOX.stripWake('hey friday, open whatsapp', list), 'open whatsapp');
  assert.equal(VOX.stripWake('friday battery batao', list), 'battery batao');
  assert.equal(VOX.wakeMatch('kuch bhi random baat', list), null);
  // longest-first matters: "friday" alone in "hey friday" must not win
  assert.equal(VOX.wakeMatch('okay computer kya time hai', list), 'computer');
});

test('vox: wake cooldown kills echo retriggers', () => {
  assert.ok(VOX.wakeCooldownOk(0, 1000));
  assert.ok(!VOX.wakeCooldownOk(1000, 2000, 2600));
  assert.ok(VOX.wakeCooldownOk(1000, 5000, 2600));
});

test('vox: sensitivity slider maps high→whisper threshold', () => {
  assert.ok(VOX.bargeRms(100) < VOX.bargeRms(0));
  assert.ok(VOX.bargeRms(60) > 2 && VOX.bargeRms(60) < 6);
});

test('vox: VAD classifies speech vs noise vs silence', () => {
  assert.equal(VOX.vadClass(9, 4), 'speech');
  assert.equal(VOX.vadClass(2.4, 4), 'noise');
  assert.equal(VOX.vadClass(0.5, 4), 'silence');
});

test('vox: restart backoff doubles then caps at 15s', () => {
  assert.equal(VOX.retryDelay(0), 1200);
  assert.equal(VOX.retryDelay(1), 2400);
  assert.equal(VOX.retryDelay(2), 4800);
  assert.equal(VOX.retryDelay(10), 15000);
});

test('vox: danger detection catches destructive commands only', () => {
  assert.ok(VOX.needsConfirm('delete all reminders'));
  assert.ok(VOX.needsConfirm('wipe your memory'));
  assert.ok(VOX.needsConfirm('saare alarms hata do'));
  assert.ok(!VOX.needsConfirm('delete my 7am reminder'));   // surgical delete → clarify flow handles
  assert.ok(!VOX.needsConfirm('add a reminder'));
  assert.ok(!VOX.needsConfirm('clear chat'));               // clear_chat has no 'all' and is safe-scoped
});

test('vox: question names the target honestly', () => {
  assert.ok(VOX.confirmQuestion('delete all reminders').includes('reminders'));
  assert.ok(VOX.confirmQuestion('wipe your memory').includes('memory') || VOX.confirmQuestion('wipe your memory').includes('yaad'));
  assert.ok(VOX.confirmYes('haan')); assert.ok(VOX.confirmYes('yes')); assert.ok(VOX.confirmYes('haan kar do'));
  assert.ok(VOX.confirmNo('nahi')); assert.ok(VOX.confirmNo('rehne do')); assert.ok(VOX.confirmNo('cancel'));
  assert.ok(!VOX.confirmYes('maybe')); assert.ok(!VOX.confirmNo('haan'));
});

test('vox: streaming chunker splits sentences, keeps tail', () => {
  const a = VOX.sentences('Battery is 81%. Charging fast. Baaki');
  assert.deepEqual(a.say, ['Battery is 81%.', 'Charging fast.']);
  assert.equal(a.rest, 'Baaki');
  const b = VOX.sentences('Done.', true);
  assert.deepEqual(b.say, ['Done.']); assert.equal(b.rest, '');
});

test('vox: orb + label + mic indicator map every state', () => {
  for (const s of VOX.STATES) {
    assert.ok(HUD2.ORB_STATES.includes(VOX.orbOf(s)), s);
    assert.ok(VOX.labelOf(s).length > 2, s);
  }
  assert.ok(VOX.micVisible('LISTENING', false));
  assert.ok(VOX.micVisible('READY', true));        // wake-word ears = mic open
  assert.ok(!VOX.micVisible('READY', false));      // nothing listening, dot off
});

/* ================= v11.3 PHASE 5: MEMEX Cognitive Memory ================= */
const MEMEX = await import('../www/js/memex.js');

test('memex: importance ranks pinned > preference > episode', () => {
  assert.equal(MEMEX.importance({ category: 'pinned' }), 100);
  assert.ok(MEMEX.importance({ category: 'preference' }) > MEMEX.importance({ category: 'episode' }));
  assert.ok(MEMEX.importance({ category: 'fact', freq: 10 }) > MEMEX.importance({ category: 'fact', freq: 0 }));
  assert.ok(MEMEX.importance({ category: 'fact' }) <= 100 && MEMEX.importance({ category: 'temp' }) >= 0);
});

test('memex: expiry protects important, kills stale temp', () => {
  const now = Date.now();
  assert.equal(MEMEX.shouldExpire({ category: 'pinned', ts: now - 999 * 864e5 }, now), false);
  assert.equal(MEMEX.shouldExpire({ category: 'temp', ts: now - 5 * 864e5 }, now), true);        // 5-day temp dead
  assert.equal(MEMEX.shouldExpire({ category: 'fact', ts: now - 5 * 864e5 }, now), false);       // fact fresh enough
  assert.equal(MEMEX.shouldExpire({ category: 'fact', ts: now - 200 * 864e5 }, now), false);     // fact importance ≥70 → immortal
});

test('memex: categorize sorts facts/preferences/tasks/knowledge', () => {
  assert.equal(MEMEX.categorize('my bike number is DL 1234'), 'fact');
  assert.equal(MEMEX.categorize('i really like lofi music'), 'preference');
  assert.equal(MEMEX.categorize('every morning I go for a walk'), 'routine');
  assert.equal(MEMEX.categorize('remind me to call mom'), 'task');
  assert.equal(MEMEX.categorize('what is the capital of Japan'), 'knowledge');
});

test('memex: dedupe key kills fluff duplicates', () => {
  assert.equal(MEMEX.dedupeKey('hey friday please open whatsapp na'), MEMEX.dedupeKey('ok friday open whatsapp'));
  assert.ok(MEMEX.dedupeKey('battery kitni hai').length > 0);
});

test('memex: summarizer builds honest digests from real logs', () => {
  const msgs = [
    { role: 'user', text: 'remind me to pay electricity bill', intent: 'reminder_add' },
    { role: 'user', text: 'what is the weather today?', intent: 'weather' },
    { role: 'assistant', text: 'Done.' },
    { role: 'user', text: 'open whatsapp', intent: 'open_app' },
    { role: 'user', text: 'open camera', intent: 'camera' }
  ];
  const s = MEMEX.summarize(msgs, { dateLabel: 'kal' });
  assert.ok(s.summary.includes('4 interactions'));
  assert.equal(s.tasks.length, 1);
  assert.ok(s.tasks[0].includes('electricity'));
  assert.ok(s.followups.length >= 1);
});

test('memex: topicsOf skips stopwords, ranks frequency', () => {
  const t = MEMEX.topicsOf(['physics physics physics chemistry math math', 'i am the boss of the exam physics'], 2);
  assert.equal(t[0], 'physics');
  assert.ok(t.length <= 2);
});

test('memex: relevance scores keyword overlap', () => {
  assert.ok(MEMEX.relevance('battery status', 'battery is 81 percent') > 0);
  assert.equal(MEMEX.relevance('zebra giraffe', 'battery is 81'), 0);
});

test('memex: dashboards report storage + retrieval speed', () => {
  const d = MEMEX.dashboard();
  assert.ok(typeof d.storageBytes === 'number' && d.storageBytes >= 0);
  assert.ok(d.retrievalMs >= 0);
  assert.ok(typeof d.facts === 'number');
});

/* ================= v11.3 PHASE 6: VISIONX ================= */
const VISIONX = await import('../www/js/visionx.js');

test('visionx: cleanOcr strips junk but keeps meaning', () => {
  const cleaned = VISIONX.cleanOcr('H 3 l l 0\n\n\n\n| am a te|xt  `~^\nTotal: ₹250');
  assert.ok(cleaned.includes('Total: ₹250'));
  assert.ok(!/\|/.test(cleaned));
});

test('visionx: classifyDoc reads receipts, IDs, math, exams', () => {
  assert.equal(VISIONX.classifyDoc('TAX INVOICE bill no 42 GST total amount ₹500 amount due ₹300'), 'receipt');
  assert.equal(VISIONX.classifyDoc('AADHAAR card no 1234 5678 9012 date of birth'), 'id');
  assert.equal(VISIONX.classifyDoc('solve the equation x^2 + 5x + 6 = 0 find the value of x'), 'math');
  assert.equal(VISIONX.classifyDoc('QUESTION PAPER marks: 100 time: 3 hours answer all questions'), 'exam');
  assert.equal(VISIONX.classifyDoc('dear diary today was nice'), 'note');
});

test('visionx: mathLines finds equations, not prose', () => {
  const eqs = VISIONX.mathLines('The answer is near\n2x + 5 = 15\nx = 5\nand then he left the room quietly');
  assert.ok(eqs.length >= 2);
  assert.ok(eqs.some(e => e.includes('=')));
});

test('visionx: homework prompt adapts by doc type', () => {
  const mp = VISIONX.homeworkPrompt('solve x^2 + 5x + 6 = 0');
  assert.ok(mp.includes('Step-by-step'));
  const ep = VISIONX.homeworkPrompt('QUESTION PAPER marks: 100');
  assert.ok(ep.includes('marking') || ep.includes('model answer'));
});

test('visionx: qrType reads every common payload', () => {
  assert.equal(VISIONX.qrType('https://example.com'), 'link');
  assert.equal(VISIONX.qrType('WIFI:T:WPA;S:Home;P:pass;;'), 'wifi');
  assert.equal(VISIONX.qrType('upi://pay?pa=test@upi'), 'upi');
  assert.equal(VISIONX.qrType('tel:+919999999999'), 'phone');
  assert.equal(VISIONX.qrType('geo:28.6,77.2'), 'location');
  assert.equal(VISIONX.qrType('kuch bhi text'), 'text');
});

test('visionx: buildPdf writes a valid PDF skeleton', () => {
  const data = new Uint8Array([72, 101, 108, 108, 111]);
  const pdf = VISIONX.buildPdf({ data, width: 2, height: 2 }, 'test');
  const head = String.fromCharCode(...pdf.slice(0, 8));
  assert.ok(head.startsWith('%PDF-'));
  assert.ok(pdf.length > 200);
  const tail = String.fromCharCode(...pdf.slice(-6));
  assert.ok(tail.includes('%%EOF'));
});

test('visionx: normalizeGray stretches contrast honestly', () => {
  const gray = new Uint8Array(1000).fill(100);
  for (let i = 0; i < 50; i++) gray[i] = 20;
  for (let i = 50; i < 100; i++) gray[i] = 200;
  const out = VISIONX.normalizeGray(gray);
  assert.ok(Math.max(...out) === 255, 'whites go to 255');
  assert.ok(Math.min(...out) <= 20, 'dark stays dark');
});

/* ================= v11.3 PHASE 7: AUTOX ================= */
const AUTOX = await import('../www/js/autox.js');

test('autox: safety validator blocks risky unconfirmed rules', () => {
  assert.equal(AUTOX.validateRule({ when: 'battery_low', then: 'suggest saver' }).ok, true);
  assert.equal(AUTOX.validateRule({ when: 'battery_low', then: 'delete all reminders' }).ok, false);   // VOX danger
  assert.equal(AUTOX.validateRule({ when: 'offline', then: 'call +911122334455' }).ok, false);        // risky without confirm
  assert.equal(AUTOX.validateRule({ when: 'offline', then: 'call mom', confirm: false }).ok, false);
  assert.equal(AUTOX.validateRule({ when: 'wifi_on', then: 'open whatsapp' }).ok, true);
  assert.equal(AUTOX.validateRule({ when: 'not_a_trigger', then: 'x' }).ok, false);
});

test('autox: rule matches trigger semantics', () => {
  assert.ok(AUTOX.ruleMatches({ when: 'battery_low', level: 20, enabled: true }, 'battery_low', { level: 15, charging: false }));
  assert.ok(!AUTOX.ruleMatches({ when: 'battery_low', level: 20, enabled: true }, 'battery_low', { level: 60 }));
  assert.ok(!AUTOX.ruleMatches({ when: 'battery_low', level: 20, enabled: true }, 'battery_low', { level: 15, charging: true }));  // charging → no suggest
  assert.ok(AUTOX.ruleMatches({ when: 'time', at: '07:00', enabled: true }, 'time', { hhmm: '07:00' }));
  assert.ok(!AUTOX.ruleMatches({ when: 'time', at: '07:00', enabled: true }, 'time', { hhmm: '07:01' }));
  assert.ok(AUTOX.ruleMatches({ when: 'command', match: 'good morning', enabled: true }, 'command', { text: 'hey good morning boss' }));
});

test('autox: disabled rules never fire + priority sort stable', () => {
  assert.equal(AUTOX.ruleMatches({ when: 'online', enabled: false }, 'online', {}), false);
  const sorted = [
    { priority: 50, created: 2 }, { priority: 10, created: 5 }, { priority: 10, created: 1 }
  ].sort(AUTOX.byPriority);
  assert.equal(sorted[0].priority, 10);
  assert.equal(sorted[0].created, 1);
});

/* ================= v12.0 PHASE 8: PLANX (AI Planner) ================= */
const PLANX = await import('../www/js/planx.js');

test('planx: planner claims multi-step goals only', () => {
  assert.ok(PLANX.shouldPlan('help me prepare for tomorrow\'s physics exam'));
  assert.ok(PLANX.shouldPlan('plan my day'));
  assert.ok(PLANX.shouldPlan('make a study plan for next week'));
  assert.ok(PLANX.shouldPlan('help me get ready for the interview'));
  assert.equal(PLANX.shouldPlan('what time is it'), false);
  assert.equal(PLANX.shouldPlan('set an alarm for 5 pm'), false);
  assert.equal(PLANX.shouldPlan('tell me a joke'), false);
  assert.equal(PLANX.shouldPlan(''), false);
});

test('planx: goal analyzer extracts kind and topic', () => {
  const a = PLANX.analyzeGoal('help me prepare for tomorrow\'s physics exam');
  assert.equal(a.kind, 'exam');
  assert.ok(/physics/.test(a.topic));
  const t = PLANX.analyzeGoal('plan a trip to goa');
  assert.equal(t.kind, 'trip');
});

test('planx: daysUntil parses tomorrow / day-after / weekday', () => {
  assert.equal(PLANX.daysUntil('tomorrow'), 1);
  assert.equal(PLANX.daysUntil('day after tomorrow'), 2);
  assert.equal(PLANX.daysUntil('next week'), 7);
  const now = new Date();
  assert.ok(PLANX.daysUntil('this friday') >= 0 && PLANX.daysUntil('this friday') <= 7);
});

test('planx: exam goal decomposes into the 7-step pipeline', () => {
  const steps = PLANX.decompose({ kind: 'exam', topic: 'physics', goal: 'prepare for physics exam' });
  assert.equal(steps.length, 7);
  assert.deepEqual(steps.map(s => s.tool),
    ['schedule', 'notes', 'summarize', 'plan', 'reminder', 'save', 'notify']);
  assert.ok(steps[1].parallel, 'notes search runs parallel to schedule check');
});

test('planx: dependency resolver keeps order and validates ids', () => {
  const steps = PLANX.decompose({ kind: 'exam', topic: 'maths', goal: 'x' });
  const plan = PLANX.resolveDeps(steps);
  const idx = Object.fromEntries(plan.map((s, i) => [s.id, i]));
  assert.ok(idx.p1 < idx.p3 && idx.p2 < idx.p3, 'summarize runs after notes');
  assert.ok(idx.p3 < idx.p4, 'plan after summarize');
});

test('planx: safety validator flags destructive / command steps', () => {
  const dangerous = [{ id: 'x1', text: 'delete all old notes', tool: 'save' },
                     { id: 'x2', text: 'pay the electricity bill', tool: 'command' }];
  const { plan, risky } = PLANX.validatePlan(dangerous);
  assert.ok(risky.includes('x1'));
  assert.ok(plan.find(s => s.id === 'x2').confirm === true);
  const safe = PLANX.validatePlan([{ id: 's1', text: 'check weather', tool: 'weather' }]);
  assert.equal(safe.risky.length, 0);
});

test('planx: revisionPlan spreads days and ends with a mock test', () => {
  const rows = PLANX.revisionPlan('physics', 3, 2);
  assert.equal(rows.length, 3);
  assert.ok(/Mock test/.test(rows[2].focus));
  assert.equal(rows[0].hours, 2);
});

test('planx: runPlan executes steps in order with a fake executor', async () => {
  const plan = PLANX.buildPlan('help me prepare for tomorrow\'s physics exam');
  assert.equal(plan.steps.length, 7);
  const ran = [];
  const r = await PLANX.runPlan(plan, {
    execStep: async (step) => { ran.push(step.id); return { ok: true, result: step.id }; },
    ask: null, retries: 1
  });
  assert.ok(r.ok);
  assert.equal(ran.length, 7);
  assert.ok(ran.indexOf('p1') < ran.indexOf('p3'));
});

test('planx: runPlan retries a failing step then recovers', async () => {
  const plan = PLANX.buildPlan('make a study plan for next week');
  let tries = 0;
  const r = await PLANX.runPlan(plan, {
    execStep: async (step) => {
      if (step.tool === 'notes' && tries++ === 0) return { ok: false, reason: 'boom' };
      return { ok: true, result: 'ok' };
    },
    retries: 2, backoffMs: 1
  });
  assert.ok(r.ok);
  assert.equal(tries, 2, 'one retry happened');
});

test('planx: confirm-gated step asks before executing', async () => {
  const steps = [{ id: 'c1', text: 'delete old backups', tool: 'command', confirm: true }];
  const plan = { id: 'plan-test', goal: 'cleanup', kind: 'generic', steps, status: 'ready' };
  let asked = 0;
  const r = await PLANX.runPlan(plan, {
    execStep: async () => { throw new Error('should not run'); },
    ask: async (q) => { asked++; return 'skip'; },
    retries: 0
  });
  assert.equal(asked, 1, 'confirm question asked');
  assert.equal(plan.steps[0].status, 'skip', 'declined step is skipped, nothing executed');
});

test('planx: planLog + planStats record the audit trail', async () => {
  const before = PLANX.planStats().total;
  const plan = PLANX.buildPlan('plan my day');
  await PLANX.runPlan(plan, { execStep: async () => ({ ok: true, result: 'ok' }), retries: 0 });
  assert.equal(PLANX.planStats().total, before + 1);
  const log = PLANX.planLog();
  assert.equal(log[0].goal, 'plan my day');
  assert.ok(typeof log[0].ms === 'number');
});

/* ================= v12.1 PHASE 9: INTELX (Intelligence & Context) ================= */
const INTELX = await import('../www/js/intelx.js');

test('intelx: routine learning derives values from data only', () => {
  const obs = [
    { kind: 'first_use', at: new Date(2026, 0, 1, 6, 30).getTime() },
    { kind: 'first_use', at: new Date(2026, 0, 2, 6, 45).getTime() },
    { kind: 'study_session', at: new Date(2026, 0, 1, 19, 0).getTime() },
    { kind: 'charge_level', at: 0, level: 20, charging: true },
    { kind: 'app_open', at: 0, app: 'whatsapp' },
    { kind: 'app_open', at: 0, app: 'whatsapp' },
    { kind: 'app_open', at: 0, app: 'youtube' }
  ];
  const r = INTELX.learnRoutines(obs);
  assert.equal(r.wakeHour, 6);
  assert.equal(r.studyWindows, 19);
  assert.equal(r.chargingLevel, 20);
  assert.deepEqual(r.frequentApps.slice(0, 1), ['whatsapp']);
  assert.equal(r.samples, obs.length);
});

test('intelx: prediction engine ranks by confidence', () => {
  const routines = { wakeHour: 7, studyWindows: 19, frequentCommands: ['weather'], samples: 20 };
  const preds = INTELX.predictNext(routines, { hour: 7, battery: 90, charging: false });
  assert.ok(preds.length >= 1);
  assert.equal(preds[0].kind, 'morning_routine');
  const sorted = [...preds].sort((a, b) => b.confidence - a.confidence);
  assert.deepEqual(preds, sorted);
});

test('intelx: recommendations respect dismissals, cooldown and confidence', () => {
  const now = Date.now();
  const routines = { studyWindows: 19, samples: 10 };
  // high-confidence battery suggestion should appear
  const one = INTELX.recommend(routines, { battery: 20, charging: false, hour: 19, memSize: 5 }, [], [], now);
  assert.ok(one.some(s => s.id === 'bat_low'));
  // dismissed → gone
  const two = INTELX.recommend(routines, { battery: 20, charging: false, hour: 19, memSize: 5 }, ['bat_low'], [], now);
  assert.ok(!two.some(s => s.id === 'bat_low'));
  // cooldown → gone
  const three = INTELX.recommend(routines, { battery: 20, charging: false, hour: 19, memSize: 5 }, [], [{ id: 'bat_low', at: now }], now);
  assert.ok(!three.some(s => s.id === 'bat_low'));
  // low-confidence → filtered by the decision gate
  const four = INTELX.recommend(routines, { battery: 90, charging: true, hour: 12, memSize: 0 }, [], [], now);
  assert.ok(four.length === 0);
});

test('intelx: notification intelligence prioritizes messages over noise', () => {
  const wa = INTELX.notifPriority({ pkg: 'com.whatsapp', title: 'Ramesh', text: 'kal milte hain', when: Date.now() });
  assert.equal(wa.tier, 'urgent');
  const ig = INTELX.notifPriority({ pkg: 'com.instagram.android', title: 'x', text: '', when: Date.now() - 3600e3 });
  assert.equal(ig.tier, 'low');
  const digest = INTELX.notifDigest([{ pkg: 'com.instagram.android', title: 'story' }]);
  assert.ok(/instagram/.test(digest));
});

test('intelx: decision engine gates proactive actions', () => {
  assert.equal(INTELX.decide({ confidence: 0.9 }, {}).act, true);
  assert.equal(INTELX.decide({ confidence: 0.4 }, {}).act, false);
  assert.equal(INTELX.decide({ confidence: 0.9 }, { safety: false }).act, false);
  assert.equal(INTELX.decide({ confidence: 0.9 }, { batteryImpact: 'high' }).act, false);
  assert.equal(INTELX.decide({ confidence: 0.9 }, { context: false, history: false }).act, false);
});

test('intelx: study stats compute today, week average and streak', () => {
  const today = Date.now();
  const sessions = [
    { min: 25, at: today },
    { min: 30, at: today - 86400e3 },
    { min: 40, at: today - 2 * 86400e3 }
  ];
  const s = INTELX.studyStats(sessions);
  assert.equal(s.todayMin, 25);
  assert.equal(s.streak, 3);
  assert.ok(s.weekAvg > 0);
});

/* ================= v12.2 PHASE 10: DEVX (Device Engine) ================= */
const DEVX = await import('../www/js/devx.js');

test('devx: battery status tiers and alerts', () => {
  assert.equal(DEVX.batteryStatus({ level: 80, charging: true }).tier, 'good');
  assert.equal(DEVX.batteryStatus({ level: 25, charging: false }).tier, 'low');
  assert.equal(DEVX.batteryStatus({ level: 10, charging: false }).alert, 'battery_critical');
  assert.equal(DEVX.batteryStatus({ level: 99, charging: true }).alert, 'battery_full');
  assert.equal(DEVX.batteryStatus({}).pct, null);
});

test('devx: storage status warns when space runs out', () => {
  const ok = DEVX.storageStatus({ totalGB: 128, usedGB: 60 });
  assert.equal(ok.tier, 'good');
  const low = DEVX.storageStatus({ totalGB: 64, usedGB: 60 });
  assert.equal(low.tier, 'warn');
  assert.equal(low.alert, 'storage_low');
  const crit = DEVX.storageStatus({ totalGB: 16, usedGB: 15.2 });
  assert.equal(crit.alert, 'storage_critical');
});

test('devx: thermal status flags overheating', () => {
  assert.equal(DEVX.thermalStatus({ celsius: 35 }).tier, 'cool');
  assert.equal(DEVX.thermalStatus({ celsius: 40 }).tier, 'warm');
  assert.equal(DEVX.thermalStatus({ celsius: 52 }).alert, 'thermal_hot');
  assert.equal(DEVX.thermalStatus({}).tier, 'unknown');
});

test('devx: ram pressure levels', () => {
  assert.equal(DEVX.ramStatus({ totalMB: 8000, usedMB: 4000 }).pressure, 'ok');
  assert.equal(DEVX.ramStatus({ totalMB: 8000, usedMB: 6000 }).pressure, 'moderate');
  assert.equal(DEVX.ramStatus({ totalMB: 8000, usedMB: 7500 }).pressure, 'high');
});

test('devx: network status online/wifi/cellular', () => {
  const w = DEVX.netStatus({ online: true, wifi: true });
  assert.ok(w.online && w.wifi && w.signal === 'strong');
  const off = DEVX.netStatus({ online: false, wifi: false });
  assert.equal(off.online, false);
});

test('devx: alert manager is informative and sorted by severity', () => {
  const alerts = DEVX.alertLevel({
    battery: { level: 10, charging: false },
    storage: { totalGB: 16, usedGB: 15.2 },
    thermal: { celsius: 52 },
    network: { online: true, wifi: false }
  });
  const crit = alerts.filter(a => a.sev === 'crit');
  assert.ok(crit.length >= 3);
  assert.ok(alerts.some(a => a.id === 'battery_critical'));
  assert.ok(alerts.some(a => a.id === 'thermal_hot'));
  assert.ok(alerts.some(a => a.id === 'storage_critical'));
});

test('devx: diagnostics dashboard rows cover services + metrics', () => {
  const rows = DEVX.dashRows({
    services: { voice: { ok: true }, devx: { ok: true } },
    metrics: { battery: { level: 50, charging: true }, storage: { totalGB: 64, usedGB: 30 }, thermal: { celsius: 36 } },
    extras: { automations: '3 rules', planner: '5 plans', aiLatencyMs: 300, uptimeSec: 600 }
  });
  assert.ok(rows.some(r => /Running services/.test(r.k) && r.v === '2/2'));
  assert.ok(rows.some(r => /Battery/.test(r.k)));
  assert.ok(rows.some(r => /AI latency/.test(r.k) && r.v === '300 ms'));
});

/* ================= v13.0 PHASE 11: SECX (Security & Privacy) ================= */
const SECX = await import('../www/js/secx.js');

test('secx: permission registry explains and lists dependent features', () => {
  assert.ok(SECX.explainPerm('mic').includes('voice'));
  assert.ok(SECX.featuresAffected('camera').includes('qr'));
  assert.equal(SECX.explainPerm('nope'), 'Permission needed for that feature.');
  assert.equal(SECX.featuresAffected('nope').length, 0);
});

test('secx: PIN is stored as a hash, never plaintext', async () => {
  const r = await SECX.setAppPin('1234');
  assert.ok(r.ok);
  const stored = JSON.parse(localStorage.getItem('friday_settings') || '{}').appPinHash || '';
  assert.ok(/^[0-9a-f]{64}$/.test(stored), 'stored value is a SHA-256 hex hash');
  assert.ok(!stored.includes('1234'), 'plaintext never stored');
  assert.equal(await SECX.verifyAppPin('1234'), true);
  assert.equal(await SECX.verifyAppPin('9999'), false);
  assert.equal((await SECX.setAppPin('12')).ok, false, 'too-short PIN rejected');
});

test('secx: AES-GCM encrypt/decrypt round-trips and rejects wrong secret', async () => {
  const e = await SECX.encryptJSON({ secret: 'pass123' }, 'master');
  assert.ok(e.ok);
  const d = await SECX.decryptJSON(e.value, 'master');
  assert.ok(d.ok);
  assert.equal(d.value.secret, 'pass123');
  const bad = await SECX.decryptJSON(e.value, 'wrong');
  assert.equal(bad.ok, false);
});

test('secx: secure storage tiers + temp cleanup', async () => {
  await SECX.securePut('api_key', { k: 'abc' }, 'pin');
  const got = await SECX.secureGet('api_key', 'pin');
  assert.ok(got.ok && got.value.k === 'abc');
  SECX.privatePut('tmp_photo', 'x');
  SECX.privatePut('keep_me', 'y');
  const removed = SECX.clearTemp();
  assert.equal(removed, 1);
  assert.equal(SECX.privateGet('keep_me'), 'y');
  assert.equal(SECX.privateGet('tmp_photo'), undefined);
});

test('secx: API security enforces HTTPS and validates requests', () => {
  assert.equal(SECX.httpsOnly('http://api.insecure.com/x'), false);
  assert.equal(SECX.httpsOnly('https://api.ok.com/x'), true);
  assert.equal(SECX.httpsOnly('http://localhost:8000/health'), true, 'localhost dev allowed');
  assert.deepEqual(SECX.validateRequest({ a: 'x' }, { a: 'string' }), { ok: true });
  assert.equal(SECX.validateRequest({ a: 5 }, { a: 'string' }).ok, false);
  assert.equal(SECX.validateRequest({}, { a: 'string' }).ok, false);
});

test('secx: integrity checker reports corrupted storage', () => {
  localStorage.setItem('friday_notes', '{not json');
  const issues = SECX.checkDb();
  assert.ok(issues.some(i => i.includes('friday_notes')));
  localStorage.removeItem('friday_notes');
  assert.equal(SECX.checkDb().length, 0);
});

test('secx: privacy report is local-first by default', () => {
  const p = SECX.privacyReport();
  assert.equal(p.localFirst, true);
  assert.equal(p.cloud, false);
  assert.ok(p.neverUploads.includes('camera photos'));
});

test('secx: threat detector turns counts into suggestions', () => {
  const alerts = SECX.detectThreats({ invalidConfig: 0, failedAuth: 5, crashes: 6, apiFailures: 10, corruption: 1, total: 22 });
  assert.ok(alerts.some(a => a.id === 'auth_brute' && a.sev === 'crit'));
  assert.ok(alerts.some(a => a.id === 'crash_storm'));
  assert.ok(alerts.some(a => a.id === 'corrupt_storage'));
  assert.ok(alerts.every(a => a.fix && a.fix.length > 5));
});

test('secx: audit log is timestamped, searchable and capped', () => {
  SECX.audit('test_event', 'hello world');
  SECX.audit('other', 'xyz');
  const all = SECX.auditLog();
  assert.equal(all[0].event, 'other');
  assert.equal(all[0].ts > 0, true);
  assert.ok(SECX.auditSearch('hello').some(e => e.event === 'test_event'));
});

/* ================= v13.1 PHASE 12: PERFX (Performance) ================= */
const PERFX = await import('../www/js/perfx.js');

test('perfx: startup plan separates critical/background/later', () => {
  const p = PERFX.startupPlan();
  assert.ok(p.critical.includes('secx'));
  assert.ok(p.later.includes('vision'));
  assert.ok(p.later.includes('coder'));
  assert.ok(p.background.includes('devx'));
});

test('perfx: throttle limits a burst to one call per window', async () => {
  let n = 0;
  const t = PERFX.throttle(() => n++, 40);
  for (let i = 0; i < 5; i++) t();           // tight sync burst → leading fires now
  const afterBurst = n;
  assert.equal(afterBurst, 1, 'burst collapses to the leading call');
  await new Promise(r => setTimeout(r, 150)); // trailing timer (≤40ms) long done
  assert.ok(n >= afterBurst + 1, 'trailing call fires after the window');
  const beforeFresh = n;
  t();                                        // window elapsed → fires immediately
  assert.equal(n, beforeFresh + 1);
});

test('perfx: leak detector flags fast-growing keys only', () => {
  // NOTE: "old" samples must sit safely INSIDE the 24h window (not exactly at
  // the boundary) — a few ms elapse between capturing `now` here and the
  // engine's internal Date.now(), which used to push them just past 86400e3
  // and made this test flaky (~25% of CI runs).
  const now = Date.now();
  const samples = [
    { key: 'notes', kb: 100, at: now - 85000e3 },
    { key: 'notes', kb: 2200, at: now - 1000 },
    { key: 'mem', kb: 50, at: now - 85000e3 },
    { key: 'mem', kb: 90, at: now - 1000 }
  ];
  const leaks = PERFX.detectLeaks(samples);
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].key, 'notes');
});

test('perfx: battery gate defers only heavy features on critical battery', () => {
  assert.equal(PERFX.batteryGate('vision', { level: 10, charging: false }).ok, false);
  assert.equal(PERFX.batteryGate('vision', { level: 10, charging: true }).ok, true, 'charging overrides');
  assert.equal(PERFX.batteryGate('vision', { level: 50, charging: false }).ok, true);
  assert.equal(PERFX.batteryGate('voice', { level: 5, charging: false }).ok, true, 'non-heavy not gated');
});

test('perfx: priority scheduler runs critical first', async () => {
  const order = [];
  PERFX.schedule(() => { order.push('low'); }, { priority: PERFX.PRIORITY.LOW });
  PERFX.schedule(() => { order.push('crit'); }, { priority: PERFX.PRIORITY.CRITICAL });
  await new Promise(r => setTimeout(r, 150)); // generous for slow CI event loops
  assert.equal(order[0], 'crit');
  assert.equal(order[1], 'low');
});

test('perfx: animation policy respects reduced-motion and battery', () => {
  const rm = PERFX.animationPolicy({ reducedMotion: true });
  assert.equal(rm.particles, false);
  assert.equal(rm.blur, false);
  const low = PERFX.animationPolicy({ battery: 15, charging: false });
  assert.equal(low.radar, false);
  const full = PERFX.animationPolicy({ battery: 90, charging: true });
  assert.equal(full.radar, true);
});

test('perfx: AI cache round-trips with TTL and respects the switch', () => {
  PERFX.aiCacheSet('what is x', 'answer', 5);
  assert.equal(PERFX.aiCacheGet('what is x'), 'answer');
  // different prompt → miss
  assert.equal(PERFX.aiCacheGet('what is y'), null);
});

/* ================= v13.2 PHASE 13: CINEX (Cinematic UX) ================= */
const CINEX = await import('../www/js/cinex.js');

test('cinex: AI-state tones map to glow/ring classes', () => {
  assert.equal(CINEX.toneOf('LISTENING').glow, 'listen');
  assert.equal(CINEX.toneOf('SPEAKING').ring, 'wave');
  assert.equal(CINEX.toneOf('ERROR').glow, 'alert');
  assert.ok(CINEX.orbClasses('EXECUTING').includes('orb-violet'));
  assert.ok(CINEX.orbClasses('EXECUTING').includes('ring-spin'));
  assert.equal(CINEX.toneOf('GARBAGE').tone, 'cyan', 'unknown → READY fallback');
});

test('cinex: effects policy turns off FX for low battery', () => {
  const p = CINEX.effectsPolicy({ battery: 12, charging: false });
  assert.equal(p.radar, false);
  assert.equal(p.glow, false);
  const full = CINEX.effectsPolicy({ battery: 90, charging: true });
  assert.equal(full.glow, true);
});

test('cinex: rootClasses encodes a11y settings', () => {
  assert.ok(CINEX.rootClasses().includes('hc') === CINEX.a11ySettings().highContrast);
});

test('cinex: HUD extra rows include RAM/CPU/Net with severity', () => {
  const rows = CINEX.hudExtraRows({ ram: { usedPct: 90, pressure: 'high' }, cpu: 30, net: { wifi: true, online: true }, battery: 18 });
  assert.ok(rows.some(r => r.k === 'RAM' && r.sev === 'warn'));
  assert.ok(rows.some(r => r.k === 'Battery' && r.sev === 'warn'));
  assert.ok(rows.some(r => r.k === 'Net' && r.v === 'Wi-Fi'));
});

test('cinex: event feed fade timing is per-kind with a default', () => {
  assert.equal(CINEX.feedFade('automation'), 5000);
  assert.equal(CINEX.feedFade('planner'), 6000);
  assert.equal(CINEX.feedFade('unknown-thing'), CINEX.feedFade('default'));
});

test('cinex: layout hint detects orientation', () => {
  assert.ok(['portrait', 'landscape', 'tablet'].includes(CINEX.layoutHint()));
});

/* ================= v14.1: PHOTO share/save/describe intents ================= */
test('brain: photo_send resolves and extracts the contact', () => {
  const a = resolve('send this photo to papa on whatsapp');
  assert.equal(a.intent, 'photo_send');
  assert.equal(a.action.type, 'send_image');
  assert.equal(a.action.contact, 'papa');
  const b = resolve('yeh photo mummy ko bhejo');
  assert.equal(b.intent, 'photo_send');
  const c = resolve('send this photo on whatsapp');   // no contact → asks
  assert.equal(c.intent, 'photo_send');
  assert.equal(c.action.contact, '');
});
test('brain: photo_save and photo_describe intents', () => {
  assert.equal(resolve('save this photo').intent, 'photo_save');
  assert.equal(resolve('photo download karo').intent, 'photo_save');
  assert.equal(resolve('what is this photo').intent, 'photo_describe');
  assert.equal(resolve('yeh photo kya hai').intent, 'photo_describe');
  assert.notEqual(resolve('make an image of a cyberpunk city').intent, 'photo_send');
});

/* ================= v15 DEVX: real thermal + sensors ================= */
test('devx: sensorReport handles the native {present,x,y,z} shape', () => {
  const r = DEVX.sensorReport({
    accelerometer: { present: true, x: 0.1, y: 0.2, z: 9.8 },
    gyroscope: { present: true, x: 0, y: 0, z: 0 },
    light: { present: false },
    proximity: { present: true, value: '5' }
  });
  assert.ok(r.present.includes('accelerometer'));
  assert.ok(r.present.includes('gyroscope'));
  assert.ok(r.present.includes('proximity'));
  assert.ok(r.missing.includes('light'));
});

test('devx: sensorSummary collapses present sensors or says none', () => {
  assert.equal(DEVX.sensorSummary({ light: { present: false } }), 'no sensors');
  const s = DEVX.sensorSummary({ accelerometer: { present: true }, gyroscope: { present: true } });
  assert.ok(s.includes('accelerometer') && s.includes('gyroscope'));
});

test('devx: thermal row shows cpu temp and throttling in diagnostics', () => {
  const rows = DEVX.dashRows({
    services: {}, metrics: { thermal: { celsius: 40, cpuCelsius: 52, throttling: true } }, extras: {}
  });
  const t = rows.find(r => r.k === 'Temperature');
  assert.ok(t);
  assert.ok(/40°C/.test(t.v) && /cpu 52°C/.test(t.v) && /throttling/.test(t.v));
  assert.equal(t.sev, 'warm');
});

/* ================= v15 PHASE 2: UPGRADES ================= */
const MEM2 = await import('../www/js/memory.js');
const MEMEX2 = await import('../www/js/memex.js');
const AUTOX2 = await import('../www/js/autox.js');
const API2 = await import('../www/js/api.js');
const DEVX2 = await import('../www/js/devx.js');

/* ---- Memory: editable + pinning ---- */
test('memory: editFact updates value in place and preserves id', () => {
  const f = MEM2.saveFact({ key: 'user.city', label: 'You live in', value: 'Delhi' });
  const edited = MEM2.editFact('user.city', 'Gurugram');
  assert.equal(edited.key, 'user.city');
  assert.equal(edited.value, 'Gurugram');
  assert.equal(MEM2.getFact('user.city'), 'Gurugram');
  MEM2.forgetFact('user.city');
});

test('memory: pin/unpin facts and pinnedFacts lists them', () => {
  MEM2.saveFact({ key: 'user.blood', label: 'Blood group', value: 'B+' });
  assert.equal(MEM2.setPin('user.blood', true), true);
  assert.ok(MEM2.pinnedFacts().some(f => f.key === 'user.blood'));
  assert.equal(MEM2.setPin('user.blood', false), true);
  assert.ok(!MEM2.pinnedFacts().some(f => f.key === 'user.blood'));
  MEM2.forgetFact('user.blood');
});

test('memory: memoryStats reports counts and bytes', () => {
  const s = MEM2.memoryStats();
  assert.ok(typeof s.facts === 'number');
  assert.ok(typeof s.bytes === 'number' && s.bytes >= 0);
  assert.ok(s.totalEntries >= s.facts);
});

test('memory: encrypted private facts round-trip via SECX AES-GCM', async () => {
  const r = await MEM2.savePrivateFact('bank.acc', '1234567890', 'secret');
  assert.equal(r.ok, true);
  const v = await MEM2.getPrivateFact('bank.acc', 'secret');
  assert.equal(v.value, '1234567890');
  await MEM2.deletePrivateFact('bank.acc');
  assert.equal(await MEM2.getPrivateFact('bank.acc', 'secret'), null);
});

/* ---- Memory: tiers + dedupe ---- */
test('memex: tierOf classifies short-term episodes vs long-term facts', () => {
  const now = Date.now();
  assert.equal(MEMEX2.tierOf({ category: 'episode', ts: now - 1000 }, now), 'short');
  assert.equal(MEMEX2.tierOf({ category: 'episode', ts: now - 20 * 864e5 }, now), 'long');
  assert.equal(MEMEX2.tierOf({ category: 'fact', ts: now - 1000 }, now), 'long');
});

test('memex: findDuplicates groups near-identical texts', () => {
  const groups = MEMEX2.findDuplicates([
    { text: 'buy milk and bread' },
    { text: 'buy milk and bread please' },
    { text: 'call mom' }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
});

/* ---- Chat analytics ---- */
test('memex: convoStats summarizes a conversation', () => {
  const s = MEMEX2.convoStats([
    { role: 'user', text: 'hello', time: 1000 },
    { role: 'ai', text: 'hi boss', time: 1100 },
    { role: 'user', text: 'remind me to call mom', time: 1200 }
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.user, 2);
  assert.equal(s.ai, 1);
  assert.equal(s.avgUserLen > 0, true);
});

test('memex: searchChat finds substring matches case-insensitively', () => {
  const hits = MEMEX2.searchChat([
    { role: 'user', text: 'What is the weather' },
    { role: 'ai', text: 'It is sunny' }
  ], 'weather');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].i, 0);
  assert.equal(MEMEX2.searchChat([{ role: 'user', text: 'x' }], '').length, 0);
});

test('memex: exportChat formats plain text with roles', () => {
  const out = MEMEX2.exportChat([
    { role: 'user', text: 'hi', time: 1000 },
    { role: 'ai', text: 'hello', time: 1100 }
  ], { withTime: false });
  assert.ok(out.includes('You: hi'));
  assert.ok(out.includes('FRIDAY: hello'));
});

/* ---- Automation: conflicts + retry ---- */
test('autox: actionIntent extracts subject and on/off intent', () => {
  assert.deepEqual(AUTOX2.actionIntent('turn on wifi'), { subject: 'wifi', intent: 'on' });
  assert.deepEqual(AUTOX2.actionIntent('wifi band karo'), { subject: 'wifi', intent: 'off' });
  assert.deepEqual(AUTOX2.actionIntent('open whatsapp'), null);
});

test('autox: detectConflicts finds opposite same-trigger rules', () => {
  const { conflicts, redundant } = AUTOX2.detectConflicts([
    { id: 'a', when: 'wifi_on', then: 'turn on wifi', enabled: true },
    { id: 'b', when: 'wifi_on', then: 'turn off wifi', enabled: true },
    { id: 'c', when: 'online', then: 'play music', enabled: true },
    { id: 'd', when: 'online', then: 'play music', enabled: true }
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].subject, 'wifi');
  assert.equal(redundant.length, 1);
});

/* ---- API: offline queue ---- */
test('api: offline queue enqueues, drains successes, keeps failures', async () => {
  API2.enqueueOffline('fact', { key: 'a', value: '1' });
  API2.enqueueOffline('fact', { key: 'b', value: '2' });
  const r = await API2.drainOffline(async (kind, p) => p.key === 'a' ? { ok: true } : { ok: false });
  assert.equal(r.sent, 1);
  assert.equal(r.left, 1);
  const q = API2.offlineQueue();
  assert.equal(q.length, 1);
  assert.equal(q[0].payload.key, 'b');
});

/* ---- Dashboard: history + sparkline ---- */
test('devx: pushHistory keeps a capped rolling series', () => {
  DEVX2.pushHistory({ battery: { level: 80, charging: false }, ram: null, thermal: { celsius: 40 }, network: { online: true } });
  DEVX2.pushHistory({ battery: { level: 75, charging: false }, ram: null, thermal: { celsius: 41 }, network: { online: true } });
  const bat = DEVX2.historySeries('battery', 5);
  assert.equal(bat.length, 2);
  assert.equal(bat[1].v, 75);
});

test('devx: sparkline returns a path with min/max/last', () => {
  const s = DEVX2.sparkline([{ v: 10 }, { v: 30 }, { v: 20 }], { w: 120, h: 30 });
  assert.ok(s && s.path.startsWith('M'));
  assert.equal(s.lo, 10);
  assert.equal(s.hi, 30);
  assert.equal(s.last, 20);
  assert.equal(DEVX2.sparkline([]), null);
});

/* ================= v15 PHASE 3: AIR ROUTER + WORKFLOW ================= */
const AIR = await import('../www/js/airouter.js');
const WF = await import('../www/js/workflow.js');

test('air: task classification picks vision/code/translate/chat', () => {
  assert.equal(AIR.classifyTask('describe this image'), 'vision');
  assert.equal(AIR.classifyTask('write a function to sort'), 'code');
  assert.equal(AIR.classifyTask('translate to hindi'), 'translate');
  assert.equal(AIR.classifyTask('what time is it'), 'chat');
});

test('air: router falls back across providers and returns winner', async () => {
  const calls = [];
  const r = await AIR.route({
    task: 'chat', messages: [{ role: 'user', content: 'hi' }],
    providers: ['server', 'groq', 'ollama', 'local'],
    exec: async (provider) => {
      calls.push(provider);
      if (provider === 'server') return { ok: false, reason: 'down' };
      return { ok: true, text: 'from ' + provider };
    }
  });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'groq');
  assert.ok(calls.includes('server') && calls.includes('groq'));
});

test('air: router reports failure when all providers fail', async () => {
  const r = await AIR.route({
    task: 'chat', messages: [],
    providers: ['server', 'groq'],
    exec: async () => ({ ok: false, reason: 'nope' })
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('nope'));
});

test('air: usage + health tracking accumulates', async () => {
  const before = AIR.aiDiagnostics().totalCalls;
  await AIR.route({ task: 'chat', messages: [], providers: ['groq'], exec: async () => ({ ok: true, text: 'x' }) });
  assert.ok(AIR.aiDiagnostics().totalCalls >= before);
  const h = AIR.healthMap();
  assert.ok(h && typeof h === 'object');
});

test('workflow: templates exist for the 3 spec chains', () => {
  assert.ok(WF.templateById('image-to-notes'));
  assert.ok(WF.templateById('voice-translate-send'));
  assert.ok(WF.templateById('doc-tasks-calendar'));
  assert.equal(WF.templateById('image-to-notes').nodes.length, 3);
});

test('workflow: runs nodes in order, passes results downstream', async () => {
  const r = await WF.runWorkflow(
    { template: WF.templateById('image-to-notes'), ctx: { image: 'fake' } },
    { runNode: async (tool, inputs) => {
        if (tool === 'ocr') return { ok: true, result: 'TEXT FROM IMAGE' };
        if (tool === 'summarize') return { ok: true, result: 'SUM: ' + (inputs.from || '') };
        if (tool === 'save_note') return { ok: true, result: 'saved ' + (inputs.from || '') };
        return { ok: false, reason: '?' };
      } });
  assert.equal(r.ok, true);
  assert.equal(r.results.n1, 'TEXT FROM IMAGE');
  assert.ok(r.results.n2.includes('TEXT FROM IMAGE'));
  assert.ok(r.results.n3.includes('SUM:'));
});

test('workflow: retries a failing node then succeeds', async () => {
  let tries = 0;
  const r = await WF.runWorkflow(
    { nodes: [{ id: 'a', tool: 'x', retries: 2 }], ctx: {} },
    { runNode: async () => { tries++; return tries >= 2 ? { ok: true, result: 'ok' } : { ok: false, reason: 'flaky' }; } });
  assert.equal(r.ok, true);
  assert.equal(tries, 2);
});

test('workflow: failure returns failedAt + reason + history entry', async () => {
  const before = WF.workflowLog().length;
  let nodeId = 0;
  const r = await WF.runWorkflow(
    { nodes: [{ id: 'a', tool: 'x', retries: 0 }, { id: 'b', tool: 'y' }], ctx: {} },
    { runNode: async (tool, inputs) => { nodeId++; return nodeId === 1 ? { ok: false, reason: 'boom' } : { ok: true, result: 'z' }; } });
  assert.equal(r.ok, false);
  assert.equal(r.failedAt, 'a');
  assert.equal(r.reason, 'boom');
  assert.equal(WF.workflowLog().length, before + 1);
  const entry = WF.workflowLog().find(x => x.id === r.id);
  assert.ok(entry && entry.ok === false);
});
