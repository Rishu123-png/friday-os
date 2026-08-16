import { test } from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
global.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); },
  clear() { memory.clear(); }
};
localStorage.setItem('friday_settings', JSON.stringify({
  serverUrl: 'https://friday.test',
  serverToken: 'test-token'
}));

const SERVER = await import('../www/js/server.js');
const PENDING_KEY = 'friday_pending_action_v1';

function sse(events, status = 200) {
  const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

function action(id, state) {
  return {
    protocol_version: '1.0', action_id: id, type: 'phone.call', args: { number: '+919876543210' },
    required_capability: 'phone', safety: {
      level: 'high', confirmation_required: true, confirmed: state !== 'awaiting_confirmation'
    },
    state, created_at: 1000, expires_at: 1300, attempt: 0
  };
}

test('server chat retries transport once with the same request id and stores pending confirmation', async () => {
  localStorage.removeItem(PENDING_KEY);
  const requests = [];
  let attempt = 0;
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (attempt++ === 0) throw new TypeError('temporary network failure');
    return sse([
      { type: 'action', action: action('action-123', 'awaiting_confirmation'), summary: 'call the number' },
      { type: 'token', text: 'Confirm?' },
      { type: 'done' }
    ]);
  };

  const seen = [];
  const answer = await SERVER.chat([{ role: 'user', content: 'call +919876543210' }], {
    onAction: (item, summary) => seen.push({ item, summary })
  });

  assert.equal(answer, 'Confirm?');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].chat_request_id, requests[1].chat_request_id);
  assert.match(requests[0].chat_request_id, /^[A-Za-z0-9._:-]{8,128}$/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].item.action_id, 'action-123');
  assert.equal(JSON.parse(localStorage.getItem(PENDING_KEY)).action_id, 'action-123');
});

test('server chat binds the retained action id to confirmation and clears it after queued event', async () => {
  localStorage.setItem(PENDING_KEY, JSON.stringify({ action_id: 'action-123', created_at: 1000 }));
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return sse([
      { type: 'action', action: action('action-123', 'queued'), summary: 'confirmed phone action' },
      { type: 'token', text: 'Queued, not completed.' },
      { type: 'done' }
    ]);
  };

  const answer = await SERVER.chat([{ role: 'user', content: 'yes' }], { requestId: 'retry-safe-request-001' });
  assert.equal(requestBody.chat_request_id, 'retry-safe-request-001');
  assert.equal(requestBody.pending_action_id, 'action-123');
  assert.equal(answer, 'Queued, not completed.');
  assert.equal(localStorage.getItem(PENDING_KEY), null);
});

test('unrelated action events do not clear a different pending confirmation', async () => {
  localStorage.setItem(PENDING_KEY, JSON.stringify({ action_id: 'pending-A', created_at: 1000 }));
  global.fetch = async () => sse([
    { type: 'action', action: { ...action('other-B', 'succeeded'), result: {
      verification: { status: 'verified', detail: 'Observed.' }
    } }, summary: 'other action' },
    { type: 'done' }
  ]);

  await SERVER.chat([{ role: 'user', content: 'status' }]);
  assert.equal(JSON.parse(localStorage.getItem(PENDING_KEY)).action_id, 'pending-A');
});

test('aborted chat is never automatically retried', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  global.fetch = async () => {
    calls += 1;
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  await assert.rejects(
    SERVER.chat([{ role: 'user', content: 'hello' }], { signal: controller.signal }),
    /aborted/
  );
  assert.equal(calls, 1);
});
