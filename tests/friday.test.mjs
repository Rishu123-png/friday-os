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
