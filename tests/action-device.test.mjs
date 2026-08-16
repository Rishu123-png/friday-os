import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

async function loadActionDevice() {
  const calls = [];
  const submissions = [];
  const system = { volume: 0, brightness: 0, wifi: false, bluetooth: false };
  const mark = (name, result) => async (...args) => {
    calls.push({ name, args });
    return typeof result === 'function' ? result(...args) : result;
  };
  const native = {
    isNative: () => true,
    capabilities: async () => ({
      native: true, notifications: true, accessibility: true, phone: true, sendSms: true
    }),
    setTorch: mark('setTorch', { ok: true }),
    setVolume: mark('setVolume', percent => { system.volume = percent; return { ok: true }; }),
    setBrightness: mark('setBrightness', percent => { system.brightness = percent; return { ok: true }; }),
    setWifi: mark('setWifi', enabled => { system.wifi = enabled; return { ok: true }; }),
    setBluetooth: mark('setBluetooth', enabled => { system.bluetooth = enabled; return { ok: true }; }),
    getSystemState: mark('getSystemState', () => ({ ok: true, ...system })),
    mediaControl: mark('mediaControl', { ok: true }),
    launchApp: mark('launchApp', app => ({ ok: true, app: { label: app, pkg: 'com.example.app' } })),
    getForegroundApp: mark('getForegroundApp', { ok: true, pkg: 'com.example.app' }),
    setSystemAlarm: mark('setSystemAlarm', { ok: true }),
    getBatteryDetail: mark('getBatteryDetail', { ok: true, level: 73, charging: false }),
    getStorageInfo: mark('getStorageInfo', { ok: true, freeBytes: 123456 }),
    getActiveNotifications: mark('getActiveNotifications', { ok: true, items: [{ app: 'Mail', text: 'Hello' }] }),
    readScreenText: mark('readScreenText', { ok: true, text: 'Visible screen text' }),
    screenShot: mark('screenShot', { ok: true, b64: 'aGVsbG8=' }),
    placeCall: mark('placeCall', { ok: true }),
    sendSMSSilent: mark('sendSMSSilent', { ok: true })
  };
  const server = {
    isConfigured: () => true,
    claimAction: async () => ({ ok: true, action: null }),
    submitActionResult: async (actionId, envelope) => {
      submissions.push({ actionId, envelope });
      return { ok: true, action: { action_id: actionId } };
    }
  };
  const storage = new MemoryStorage();
  const context = vm.createContext({
    console,
    crypto: webcrypto,
    localStorage: storage,
    // Eliminate dispatcher verification delays without changing production code.
    setTimeout: fn => { fn(); return 1; },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    navigator: { onLine: true },
    window: { addEventListener() {}, removeEventListener() {} }
  });
  const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const nativeModule = synthetic(native);
  const serverModule = synthetic(server);
  const source = await fs.readFile(new URL('../www/js/action-device.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, {
    context,
    identifier: new URL('../www/js/action-device.js', import.meta.url).href
  });
  await module.link(specifier => {
    if (specifier === './native.js') return nativeModule;
    if (specifier === './server.js') return serverModule;
    throw new Error(`Unexpected import: ${specifier}`);
  });
  await module.evaluate();
  return { api: module.namespace, calls, submissions, storage };
}

const ACTIONS = [
  ['device.torch.set', { enabled: true }, 'unavailable'],
  ['device.volume.set', { percent: 42 }, 'verified'],
  ['device.brightness.set', { percent: 65 }, 'verified'],
  ['device.wifi.set', { enabled: true }, 'verified'],
  ['device.bluetooth.set', { enabled: true }, 'verified'],
  ['media.control', { command: 'pause' }, 'unavailable'],
  ['app.open', { app: 'Spotify' }, 'verified'],
  ['alarm.create', { hour: 19, minute: 30, label: 'Gym', repeat: 'once' }, 'unavailable'],
  ['device.battery.get', {}, 'verified'],
  ['device.storage.get', {}, 'verified'],
  ['notifications.list', {}, 'verified'],
  ['screen.read', {}, 'verified'],
  ['screen.capture', {}, 'verified'],
  ['phone.call', { number: '+919876543210' }, 'unavailable'],
  ['message.sms.send', { number: '+919876543210', body: 'I am on my way' }, 'unavailable']
];

test('Android action dispatcher implements all 15 commands with honest verification', async () => {
  const { api } = await loadActionDevice();
  assert.equal(ACTIONS.length, 15);
  for (const [type, args, verification] of ACTIONS) {
    const result = await api.executeClaim({ type, args });
    assert.equal(result.execution.status, 'succeeded', type);
    assert.equal(result.verification.status, verification, type);
    if (verification === 'unavailable') {
      assert.notEqual(result.verification.status, 'verified', type);
      assert.ok(result.verification.detail.length > 0, type);
    }
    if (type === 'screen.capture') {
      assert.equal(result.execution.output.captured, true);
      assert.equal('b64' in result.execution.output, false);
      assert.equal(JSON.stringify(result).includes('aGVsbG8='), false);
    }
  }
});

test('dynamic capability claim includes only permission-backed sensitive capabilities', async () => {
  const { api } = await loadActionDevice();
  const capabilities = await api.currentCapabilities();
  assert.deepEqual(
    Array.from(capabilities),
    ['torch', 'volume', 'brightness', 'wifi', 'bluetooth', 'media', 'apps', 'alarms',
      'battery', 'storage', 'notifications', 'screen_read', 'screenshot', 'phone', 'sms']
  );
});

test('crash journal prevents duplicate phone side effects and reports interruption honestly', async () => {
  const { api, calls, submissions, storage } = await loadActionDevice();
  storage.setItem('friday_action_journal_v1', JSON.stringify({
    'crash-call-1': { startedAt: '2026-08-15T10:00:00.000Z', savedAt: Date.now() }
  }));
  const action = {
    protocol_version: '1.0', action_id: 'crash-call-1', type: 'phone.call',
    args: { number: '+919876543210' }, lease_token: 'lease-token-at-least-twenty-characters'
  };
  await api.processClaim(action);
  assert.equal(calls.filter(call => call.name === 'placeCall').length, 0);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].envelope.execution.status, 'failed');
  assert.equal(submissions[0].envelope.execution.error, 'execution_interrupted_not_retried');
  assert.equal(submissions[0].envelope.verification.status, 'unavailable');
});

test('result retry reuses journaled envelope without repeating SMS', async () => {
  const { api, calls, submissions } = await loadActionDevice();
  const first = {
    protocol_version: '1.0', action_id: 'sms-at-most-once-1', type: 'message.sms.send',
    args: { number: '+919876543210', body: 'hello' },
    lease_token: 'first-lease-token-at-least-twenty'
  };
  await api.processClaim(first);
  await api.processClaim({ ...first, lease_token: 'second-lease-token-at-least-twenty' });
  assert.equal(calls.filter(call => call.name === 'sendSMSSilent').length, 1);
  assert.equal(submissions.length, 2);
  assert.equal(submissions[1].envelope.lease_token, 'second-lease-token-at-least-twenty');
  assert.equal(submissions[1].envelope.execution.status, 'succeeded');
  assert.equal(submissions[1].envelope.verification.status, 'unavailable');
});
