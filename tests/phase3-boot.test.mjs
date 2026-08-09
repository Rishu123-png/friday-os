import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

if (!global.localStorage) global.localStorage = {
  _m: new Map(), getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); }
};

const { BootDiagnostics, BOOT_STATE, settleOptional, runBootPlan } = await import('../www/js/boot-runtime.js');
const { resolve } = await import('../www/js/brain.js');
const AIR = await import('../www/js/airouter.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const standard = overrides => [
  { name: 'FRIDAY CORE', mandatory: true, run: async () => true },
  { name: 'HUD', mandatory: true, run: async () => true },
  { name: 'ANDROID BRIDGE', run: async () => true },
  { name: 'MEMORY', run: async () => true },
  { name: 'VOICE', run: async () => true },
  { name: 'VISION', run: async () => true },
  { name: 'LOCAL AI', skipState: BOOT_STATE.NOT_INSTALLED },
  { name: 'GROQ', skipState: BOOT_STATE.DISABLED },
  { name: 'BLACKBOX', skipState: BOOT_STATE.DISABLED },
  ...(overrides || [])
];

test('phase3 A: normal boot reaches ONLINE', async () => {
  const d = await runBootPlan(standard());
  assert.equal(d.online, true); assert.equal(d.get('HUD').state, BOOT_STATE.READY);
});

test('phase3 B: missing local model is NOT INSTALLED and boot continues', async () => {
  const d = await runBootPlan(standard());
  assert.equal(d.get('LOCAL AI').state, BOOT_STATE.NOT_INSTALLED); assert.equal(d.online, true);
});

test('phase3 C: missing Groq configuration does not block offline boot', async () => {
  const d = await runBootPlan(standard());
  assert.equal(d.get('GROQ').state, BOOT_STATE.DISABLED); assert.equal(d.online, true);
});

test('phase3 D: invalid Groq is optional/unavailable', async () => {
  const d = await runBootPlan([...standard(), { name: 'GROQ INVALID', run: async () => { throw new Error('BAD_KEY'); } }]);
  assert.equal(d.get('GROQ INVALID').state, BOOT_STATE.UNAVAILABLE); assert.equal(d.online, true);
});

test('phase3 E: backend unavailable continues offline', async () => {
  const d = await runBootPlan([...standard(), { name: 'BACKEND', run: async () => { throw new Error('network'); } }]);
  assert.equal(d.get('BACKEND').state, BOOT_STATE.UNAVAILABLE); assert.equal(d.online, true);
});

test('phase3 F: Blackbox disabled is explicit', async () => {
  const d = await runBootPlan(standard()); assert.equal(d.get('BLACKBOX').state, BOOT_STATE.DISABLED);
});

test('phase3 G: Blackbox unavailable does not become READY', async () => {
  const d = await runBootPlan([{ name: 'CORE', mandatory: true, run: async () => true }, { name: 'BLACKBOX', run: async () => false }]);
  assert.equal(d.get('BLACKBOX').state, BOOT_STATE.UNAVAILABLE); assert.equal(d.online, true);
});

test('phase3 H: optional voice engine unavailable becomes LIMITED', async () => {
  const d = new BootDiagnostics(); d.define('VOICE');
  await settleOptional('VOICE', async () => false, { diagnostics: d, failureState: BOOT_STATE.LIMITED });
  assert.equal(d.get('VOICE').state, BOOT_STATE.LIMITED);
});

test('phase3 I: optional vision engine unavailable does not block', async () => {
  const d = await runBootPlan([{ name: 'CORE', mandatory: true, run: async () => true }, { name: 'VISION', run: async () => { throw Error('missing'); }, failureState: BOOT_STATE.LIMITED }]);
  assert.equal(d.get('VISION').state, BOOT_STATE.LIMITED); assert.equal(d.online, true);
});

test('phase3 J: optional boot timeout is bounded and marked LIMITED', async () => {
  const d = new BootDiagnostics(); d.define('VOICE'); const before = Date.now();
  const r = await settleOptional('VOICE', () => new Promise(() => {}), { diagnostics: d, timeoutMs: 20 });
  assert.equal(r.timedOut, true); assert.ok(Date.now() - before < 250); assert.equal(d.get('VOICE').state, BOOT_STATE.LIMITED);
});

test('phase3 K: native bridge unavailable permits web/offline mode', async () => {
  const d = await runBootPlan([{ name: 'CORE', mandatory: true, run: async () => true }, { name: 'ANDROID BRIDGE', run: async () => false }]);
  assert.equal(d.get('ANDROID BRIDGE').state, BOOT_STATE.UNAVAILABLE); assert.equal(d.online, true);
});

test('phase3 L: offline basic commands route locally without cloud', () => {
  const phrases = ['turn on wifi', 'turn on flashlight', 'what is my battery', 'set an alarm for 5 pm', 'take a note buy milk'];
  for (const p of phrases) assert.ok(resolve(p), `offline intent missing: ${p}`);
});

test('phase3 M: provider fallback follows local then server', async () => {
  const called = [];
  const r = await AIR.route({ task: 'chat', providers: ['local', 'server'], exec: async p => {
    called.push(p); return p === 'server' ? { ok: true, text: 'cloud' } : { ok: false, reason: 'not installed' };
  }});
  assert.deepEqual(called, ['local', 'server']); assert.equal(r.provider, 'server');
});

test('phase3 N: no automatic downloads or install/download buttons', () => {
  const app = fs.readFileSync(new URL('../www/js/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../www/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /setTimeout\(autoSetupSuit/);
  assert.doesNotMatch(html, /id="(?:voskDownload|voiceDownload|earsDownload|embedDownload|modelList)"/);
  assert.doesNotMatch(html, /<button[^>]*>\s*(?:Download|Install AI|Get (?:wake|neural|offline|memory))/i);
});

test('phase3 O: a slow optional promise cannot prevent ONLINE', async () => {
  const d = await runBootPlan([
    { name: 'CORE', mandatory: true, run: async () => true },
    { name: 'HANGING OPTIONAL', run: () => new Promise(() => {}), timeoutMs: 15 }
  ]);
  assert.equal(d.online, true); assert.equal(d.get('HANGING OPTIONAL').state, BOOT_STATE.LIMITED);
});
