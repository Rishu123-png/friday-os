/* FRIDAY OS — Phase 10 stress test (run: node --experimental-vm-modules tests/stress.mjs)
   Verifies stability: repeated test runs, module import integrity, boot-chain
   import time, and no crashing paths in the core pure modules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

global.localStorage = { _m: new Map(), getItem(k){ return this._m.has(k)?this._m.get(k):null; }, setItem(k,v){ this._m.set(k,String(v)); }, removeItem(k){ this._m.delete(k); } };

test('stress: all 52 modules import without throwing', async () => {
  const mods = ['brain','nlp','nlu','store','memory','memex','ai','api','device','voice','ui','vision','templates','proactive','automation','native','coder','vault','hacker','health','i18n','localbrain','ambient','clarify','semantic','embeddings','hud','ignite','vox','fridaycore','suit','herald','autox','planx','intelx','devx','secx','perfx','cinex','server','airouter','workflow','notesx','docai','knowledge','plannerx','studyx','guardian','plugins','uix','visionx','memex'];
  for (const m of mods) {
    try { await import('../www/js/' + m + '.js'); }
    catch (e) { assert.fail(m + ' failed to import: ' + (e && e.message)); }
  }
  assert.ok(true);
});

test('stress: boot-critical chain imports fast (< 1.5s total, warm)', async () => {
  const t0 = Date.now();
  await import('../www/js/store.js');
  await import('../www/js/fridaycore.js');
  await import('../www/js/brain.js');
  await import('../www/js/ai.js');
  await import('../www/js/voice.js');
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, 'boot chain took ' + ms + 'ms');
});

test('stress: pure modules return sane values on empty input (no crashes)', async () => {
  const { localSummary } = await import('../www/js/notesx.js');
  const { analyzeResume } = await import('../www/js/docai.js');
  const { priorityScore } = await import('../www/js/plannerx.js');
  const { heartRate } = await import('../www/js/guardian.js');
  assert.equal(localSummary(''), '');
  assert.ok(analyzeResume('').skills.length === 0);
  assert.equal(priorityScore(null), 0);
  assert.equal(heartRate([]).bpm, null);
});

test('stress: repeated intent resolution is stable (1000 calls)', async () => {
  const { resolve } = await import('../www/js/brain.js');
  for (let i = 0; i < 1000; i++) {
    const r = resolve('what time is it');
    assert.ok(r && r.intent === 'time');
  }
});

test('stress: plugin + workflow + router run end-to-end repeatedly', async () => {
  const WF = await import('../www/js/workflow.js');
  const AIR = await import('../www/js/airouter.js');
  for (let i = 0; i < 20; i++) {
    const r = await WF.runWorkflow({ nodes: [{ id: 'a', tool: 'x' }], ctx: {} }, { runNode: async () => ({ ok: true, result: 'ok' }) });
    assert.equal(r.ok, true);
    const rr = await AIR.route({ task: 'chat', messages: [], providers: ['groq'], exec: async () => ({ ok: true, text: 'x' }) });
    assert.equal(rr.ok, true);
  }
});
