import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
global.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); },
  clear() { memory.clear(); }
};

const secure = new Map();
let secureWrites = 0;
const FridayNative = {
  async getSecureSecret({ name }) {
    return secure.has(name)
      ? { ok: true, value: secure.get(name) }
      : { ok: false, reason: 'not_found' };
  },
  async setSecureSecret({ name, value }) {
    secureWrites += 1;
    secure.set(name, value);
    return { ok: true };
  },
  async deleteSecureSecret({ name }) {
    secure.delete(name);
    return { ok: true };
  }
};

global.window = {
  Capacitor: {
    isNativePlatform: () => true,
    Plugins: { FridayNative }
  }
};

const AI = await import('../www/js/ai.js');
const NAT = await import('../www/js/native.js');
const STORE = await import('../www/js/store.js');
const PRIMARY = 'gsk_' + 'primary_test_material_1234567890';
const STANDBY = 'gsk_' + 'standby_test_material_123456789';
const originalFetch = global.fetch;

after(() => { global.fetch = originalFetch; });

function jsonReply(text, status = 200) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: text } }]
  }), { status, headers: { 'Content-Type': 'application/json' } });
}

test('runtime Groq values persist only through the secure native bridge', async () => {
  memory.clear();
  secure.clear();
  secureWrites = 0;
  await AI.refreshGroqKeys();

  const result = await AI.saveGroqKeys(PRIMARY, STANDBY);
  assert.equal(result.ok, true);
  assert.equal(secure.get('groq_primary'), PRIMARY);
  assert.equal(secure.get('groq_standby'), STANDBY);
  assert.equal(secureWrites, 2);
  assert.equal([...memory.values()].some(value => value.includes(PRIMARY) || value.includes(STANDBY)), false);
  assert.deepEqual(AI.groqKeyStatus(), { primary: true, standby: true, secure: true });
});

test('duplicate replacement is rejected against an already configured slot', async () => {
  secure.set('groq_primary', PRIMARY);
  secure.set('groq_standby', STANDBY);
  await AI.refreshGroqKeys();
  const writesBefore = secureWrites;

  assert.deepEqual(await AI.saveGroqKeys('', PRIMARY), { ok: false, reason: 'same_key' });
  assert.deepEqual(await AI.saveGroqKeys(STANDBY, ''), { ok: false, reason: 'same_key' });
  assert.equal(secureWrites, writesBefore);
});

test('primary authentication failure uses standby exactly once', async () => {
  secure.set('groq_primary', PRIMARY);
  secure.set('groq_standby', STANDBY);
  await AI.refreshGroqKeys();
  const attempts = [];
  global.fetch = async (_url, options) => {
    attempts.push(options.headers.Authorization);
    return attempts.length === 1
      ? new Response('rejected', { status: 401 })
      : jsonReply('Standby online');
  };

  const answer = await AI.callGroq([{ role: 'user', content: 'status' }]);
  assert.equal(answer, 'Standby online');
  assert.deepEqual(attempts, [`Bearer ${PRIMARY}`, `Bearer ${STANDBY}`]);
});

test('retryable provider and network failures use standby, but a bad request does not', async () => {
  secure.set('groq_primary', PRIMARY);
  secure.set('groq_standby', STANDBY);
  await AI.refreshGroqKeys();
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return calls === 1 ? new Response('busy', { status: 503 }) : jsonReply('Recovered');
  };
  assert.equal(await AI.callGroq([{ role: 'user', content: 'hello' }]), 'Recovered');
  assert.equal(calls, 2);

  calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('network unavailable');
    return jsonReply('Network recovered');
  };
  assert.equal(await AI.callGroq([{ role: 'user', content: 'hello' }]), 'Network recovered');
  assert.equal(calls, 2);

  calls = 0;
  global.fetch = async () => { calls += 1; return new Response('bad request', { status: 400 }); };
  await assert.rejects(
    AI.callGroq([{ role: 'user', content: 'hello' }]),
    /GROQ_400_PRIMARY/
  );
  assert.equal(calls, 1);
});

test('tool requests use the same primary-to-standby failover contract', async () => {
  secure.set('groq_primary', PRIMARY);
  secure.set('groq_standby', STANDBY);
  await AI.refreshGroqKeys();
  let calls = 0;
  const toolCall = { id: 'tool-1', type: 'function', function: { name: 'set_reminder', arguments: '{"text":"study","minutes":10}' } };
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('rate limited', { status: 429 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [toolCall] } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await AI.callGroqTools([{ role: 'user', content: 'remind me' }]);
  assert.deepEqual(result.tool_calls, [toolCall]);
  assert.equal(calls, 2);
});

test('secure bridge returns after its deadline when a native callback never arrives', async () => {
  const originalGet = FridayNative.getSecureSecret;
  FridayNative.getSecureSecret = () => new Promise(() => {});
  const started = Date.now();
  try {
    const result = await NAT.getSecureSecret('groq_primary');
    assert.deepEqual(result, { ok: false, reason: 'secure_store_timeout' });
    assert.ok(Date.now() - started < 2600, 'secure bridge exceeded its bounded deadline');
  } finally {
    FridayNative.getSecureSecret = originalGet;
  }
});

test('clear removes both secure slots and leaves only false status flags', async () => {
  const result = await AI.clearGroqKeys();
  assert.deepEqual(result, { ok: true, primary: false, standby: false, secure: true });
  assert.equal(secure.size, 0);
  assert.equal([...memory.values()].some(value => value.includes(PRIMARY) || value.includes(STANDBY)), false);
});

test('existing FRIDAY Cloud route remains available when secure slots are empty', async () => {
  STORE.setSetting('serverUrl', 'https://friday.invalid');
  STORE.setSetting('serverMode', true);
  global.fetch = async url => {
    assert.equal(url, 'https://friday.invalid/v1/chat');
    return new Response(
      'data: {"type":"token","text":"Server fallback"}\n\n' +
      'data: {"type":"done"}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    );
  };
  try {
    assert.equal(await AI.callGroq([{ role: 'user', content: 'hello' }]), 'Server fallback');
  } finally {
    STORE.setSetting('serverUrl', '');
  }
});

test('a partial clear re-reads both slots and drops a credential already deleted by Android', async () => {
  secure.set('groq_primary', PRIMARY);
  secure.set('groq_standby', STANDBY);
  await AI.refreshGroqKeys();
  const originalDelete = FridayNative.deleteSecureSecret;
  FridayNative.deleteSecureSecret = async ({ name }) => {
    if (name === 'groq_primary') { secure.delete(name); return { ok: true }; }
    return { ok: false, reason: 'write_failed' };
  };
  try {
    const result = await AI.clearGroqKeys();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'secure_store_failed');
    assert.equal(result.primary, false);
    assert.equal(result.standby, true);
    assert.deepEqual(AI.groqKeyStatus(), { primary: false, standby: true, secure: true });
  } finally {
    FridayNative.deleteSecureSecret = originalDelete;
    await AI.clearGroqKeys();
  }
});
