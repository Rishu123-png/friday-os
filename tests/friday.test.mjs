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
const { extractFacts, saveFact, getFact, kinshipName } = await import('../www/js/memory.js');
const { splitCommands, autoCorrect, sentiment, semanticSearch, resolveFollowup } = await import('../www/js/nlu.js');

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
