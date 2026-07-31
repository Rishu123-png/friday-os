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
  assert.ok(tr && tr.intent === 'quick_translate' && tr.action.lang === 'spanish' && tr.action.text === 'kaise ho');
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
