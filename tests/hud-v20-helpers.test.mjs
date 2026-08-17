import { test } from 'node:test';
import assert from 'node:assert/strict';

if (!global.localStorage) global.localStorage = { _m: new Map(), getItem(k){return this._m.get(k)??null}, setItem(k,v){this._m.set(k,String(v))}, removeItem(k){this._m.delete(k)} };
if (!global.document) global.document = { hidden: false, addEventListener(){}, querySelector(){return null}, querySelectorAll(){return []}, getElementById(){return null} };
if (!global.navigator) global.navigator = { onLine: true };
if (!global.window) global.window = { Capacitor: null };

const { compassLabel, fmtCoord, fmtSpeed, fmtBytesMB, netQuality, voiceStateLabel } = await import('../www/js/hud_v20.js');

test('hudv20: compassLabel maps degrees honestly', () => {
  assert.equal(compassLabel(null), '—');
  assert.equal(compassLabel(undefined), '—');
  assert.equal(compassLabel(0), '0° N');
  assert.equal(compassLabel(90), '90° E');
  assert.equal(compassLabel(180), '180° S');
  assert.equal(compassLabel(270), '270° W');
  assert.equal(compassLabel(360), '0° N');
  assert.match(compassLabel(45), /NE/);
});

test('hudv20: fmtCoord and fmtSpeed honest', () => {
  assert.equal(fmtCoord(null, 'lat'), '—');
  assert.equal(fmtCoord(28.61, 'lat'), '28.61° N');
  assert.equal(fmtCoord(-77.20, 'lon'), '77.20° W');
  assert.equal(fmtSpeed(null), '—');
  assert.match(fmtSpeed(5), /km\/h/);
});

test('hudv20: fmtBytesMB honest', () => {
  assert.equal(fmtBytesMB(null), '—');
  assert.match(fmtBytesMB(1048576), /1\.0 MB/);
});

test('hudv20: netQuality scoring', () => {
  assert.equal(netQuality(null, null), '—');
  assert.equal(netQuality(30, 10), 'Excellent');
  assert.equal(netQuality(500, 0.1), 'Weak');
  assert.ok(['Excellent','Good','Fair','Weak','—'].includes(netQuality(100,2)));
});

test('hudv20: voiceStateLabel mapping', () => {
  assert.equal(voiceStateLabel('OFFLINE'), 'OFFLINE');
  assert.equal(voiceStateLabel('LISTENING'), 'LISTENING');
  assert.equal(voiceStateLabel('THINKING'), 'THINKING');
  assert.equal(voiceStateLabel('SPEAKING'), 'SPEAKING');
  assert.equal(voiceStateLabel(null), 'READY');
});
