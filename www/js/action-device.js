/* FRIDAY Action Protocol v1.0 — Android hands dispatcher.
   The backend owns intent/queue/safety; this module claims only capabilities the
   device currently has, executes exactly one typed action, and returns honest
   execution + verification evidence. */
import * as NAT from './native.js';
import * as SERVER from './server.js';

export const PROTOCOL_VERSION = '1.0';
const JOURNAL_KEY = 'friday_action_journal_v1';
let timer = null;
let running = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

function deviceId() {
  let id = localStorage.getItem('friday_action_device_id');
  if (id && /^[A-Za-z0-9._:-]{3,128}$/.test(id)) return id;
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '')
    || Math.random().toString(36).slice(2) + Date.now().toString(36);
  id = `android-${random}`;
  localStorage.setItem('friday_action_device_id', id);
  return id;
}

function journal() {
  try { return JSON.parse(localStorage.getItem(JOURNAL_KEY) || '{}') || {}; }
  catch (_) { return {}; }
}
function journalPut(actionId, value) {
  const all = journal();
  all[actionId] = { ...value, savedAt: Date.now() };
  const trimmed = Object.fromEntries(Object.entries(all)
    .sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0)).slice(0, 80));
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(trimmed));
}

export async function currentCapabilities() {
  if (!NAT.isNative()) return [];
  const c = await NAT.capabilities().catch(() => ({ native: true }));
  const out = ['torch', 'volume', 'brightness', 'wifi', 'bluetooth', 'media',
    'apps', 'alarms', 'battery', 'storage'];
  if (c.notifications) out.push('notifications');
  if (c.accessibility) out.push('screen_read', 'screenshot');
  if (c.phone) out.push('phone');
  if (c.sendSms) out.push('sms');
  return out;
}

function verified(method, evidence = {}, detail = '') {
  return { status: 'verified', method, evidence, detail };
}
function unavailable(method, detail, evidence = {}) {
  return { status: 'unavailable', method, evidence, detail };
}
function failedVerification(method, detail, evidence = {}) {
  return { status: 'failed', method, evidence, detail };
}
function compact(value, depth = 0) {
  if (depth > 4) return '[depth-limited]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 8000);
  if (Array.isArray(value)) return value.slice(0, 30).map(x => compact(x, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    Object.entries(value).slice(0, 40).forEach(([k, v]) => {
      if (!/^(b64|base64|image)$/i.test(k)) out[k.slice(0, 80)] = compact(v, depth + 1);
    });
    return out;
  }
  return String(value).slice(0, 500);
}

function executionFailure(result) {
  const reason = String(result?.reason || 'native_action_failed').slice(0, 300);
  const denied = /permission|denied|no_(?:write|dnd|sms|phone|camera)|a11y_off|accessibility_off/i.test(reason);
  const unsupported = /unsupported|not_found|engine_missing|missing/i.test(reason);
  return {
    execution: { status: denied ? 'denied' : unsupported ? 'unsupported' : 'failed', output: {}, error: reason },
    verification: unavailable('not_run', 'Execution did not complete.')
  };
}

async function verifyState(key, expected, tolerance = 0) {
  await sleep(350);
  const observed = await NAT.getSystemState();
  if (!observed.ok || observed[key] === undefined) {
    return unavailable('system_state_readback', `${key} state could not be read.`);
  }
  const matches = typeof expected === 'number'
    ? Math.abs(Number(observed[key]) - expected) <= tolerance
    : observed[key] === expected;
  return matches
    ? verified('system_state_readback', { key, expected, observed: observed[key] })
    : failedVerification('system_state_readback', `${key} did not reach the requested state.`,
      { key, expected, observed: observed[key] });
}

/** Execute one already-confirmed claimed action. */
export async function executeClaim(action) {
  const a = action.args || {};
  let r;
  switch (action.type) {
    case 'device.torch.set':
      r = await NAT.setTorch(a.enabled);
      if (!r.ok) return executionFailure(r);
      return { execution: { status: 'succeeded', output: { requested: a.enabled } },
        verification: unavailable('android_api_acceptance', 'Android accepted the torch request, but this build cannot independently observe torch state.') };
    case 'device.volume.set':
      r = await NAT.setVolume(a.percent);
      if (!r.ok) return executionFailure(r);
      return { execution: { status: 'succeeded', output: { requestedPercent: a.percent } },
        verification: await verifyState('volume', a.percent, 3) };
    case 'device.brightness.set':
      r = await NAT.setBrightness(a.percent);
      if (!r.ok) return executionFailure(r);
      return { execution: { status: 'succeeded', output: { requestedPercent: a.percent } },
        verification: await verifyState('brightness', a.percent, 2) };
    case 'device.wifi.set':
      r = await NAT.setWifi(a.enabled);
      if (!r.ok) return executionFailure(r);
      return { execution: { status: 'succeeded', output: { requested: a.enabled, openedPanel: !!r.opened_panel } },
        verification: r.opened_panel
          ? unavailable('system_panel', 'Android requires the user to complete this change in the opened system panel.')
          : await verifyState('wifi', a.enabled) };
    case 'device.bluetooth.set':
      r = await NAT.setBluetooth(a.enabled);
      if (!r.ok) return executionFailure(r);
      return { execution: { status: 'succeeded', output: { requested: a.enabled, openedPanel: !!r.opened_panel } },
        verification: r.opened_panel
          ? unavailable('system_panel', 'Android requires the user to complete this change in the opened system panel.')
          : await verifyState('bluetooth', a.enabled) };
    case 'media.control':
      r = await NAT.mediaControl(a.command);
      if (!r.ok) return executionFailure(r);
      return { execution: { status: 'succeeded', output: { command: a.command } },
        verification: unavailable('media_key_dispatch', 'The media key was dispatched, but playback state is not independently readable.') };
    case 'app.open': {
      r = await NAT.launchApp(a.app);
      if (!r.ok) return executionFailure(r);
      await sleep(500);
      const foreground = await NAT.getForegroundApp();
      const expectedPkg = r.app?.pkg;
      const observedPkg = foreground.pkg || foreground.package || '';
      const verification = !foreground.ok || !expectedPkg || !observedPkg
        ? unavailable('foreground_app_readback', 'The launch intent was accepted; foreground-app observation is unavailable.')
        : observedPkg === expectedPkg
          ? verified('foreground_app_readback', { package: expectedPkg })
          : failedVerification('foreground_app_readback', 'A different app is in the foreground.', { expectedPkg, observedPkg });
      return { execution: { status: 'succeeded', output: { app: r.app?.label || a.app, package: expectedPkg || '' } }, verification };
    }
    case 'alarm.create':
      r = await NAT.setSystemAlarm(a.hour, a.minute, a.label, a.repeat);
      if (!r.ok) return executionFailure(r);
      return { execution: { status: 'succeeded', output: compact({ hour: a.hour, minute: a.minute, label: a.label, repeat: a.repeat }) },
        verification: unavailable('alarm_intent_acceptance', 'Android accepted the alarm intent; the resulting alarm cannot be independently queried.') };
    case 'device.battery.get':
      r = await NAT.getBatteryDetail();
      if (!r.ok) return executionFailure(r);
      return { execution: { status: 'succeeded', output: compact(r) },
        verification: verified('battery_manager_read', { observed: true }) };
    case 'device.storage.get':
      r = await NAT.getStorageInfo();
      if (!r.ok) return executionFailure(r);
      return { execution: { status: 'succeeded', output: compact(r) },
        verification: verified('statfs_read', { observed: true }) };
    case 'notifications.list': {
      r = await NAT.getActiveNotifications();
      if (!r.ok) return executionFailure(r);
      const items = compact(r.items || r.notifications || []);
      return { execution: { status: 'succeeded', output: { items, count: items.length } },
        verification: verified('notification_listener_read', { count: items.length }) };
    }
    case 'screen.read':
      r = await NAT.readScreenText();
      if (!r.ok) return executionFailure(r);
      return { execution: { status: 'succeeded', output: { text: String(r.text || '').slice(0, 8000) } },
        verification: verified('accessibility_tree_read', { characters: String(r.text || '').length }) };
    case 'screen.capture': {
      r = await NAT.screenShot();
      if (!r.ok || !r.b64) return executionFailure(r);
      const bytes = Math.floor(r.b64.length * 3 / 4);
      return { execution: { status: 'succeeded', output: { captured: true, bytes } },
        verification: verified('accessibility_screenshot_callback', { captured: true, bytes }) };
    }
    case 'phone.call':
      r = await NAT.placeCall(a.number);
      if (!r.ok) return executionFailure(r);
      return { execution: { status: 'succeeded', output: { requestAccepted: true } },
        verification: unavailable('call_intent_acceptance', 'The call request was accepted; connection/answer state is not observed.') };
    case 'message.sms.send':
      r = await NAT.sendSMSSilent(a.number, a.body);
      if (!r.ok) return executionFailure(r);
      return { execution: { status: 'succeeded', output: { requestAccepted: true, characters: a.body.length } },
        verification: unavailable('sms_manager_acceptance', 'SmsManager accepted the message; delivery is not tracked by this build.') };
    default:
      return { execution: { status: 'unsupported', output: {}, error: 'unsupported_action_type' },
        verification: unavailable('not_run', 'This action type is not implemented by the device.') };
  }
}

function resultEnvelope(action, outcome, startedAt) {
  return {
    protocol_version: PROTOCOL_VERSION,
    action_id: action.action_id,
    device_id: deviceId(),
    lease_token: action.lease_token,
    started_at: startedAt,
    finished_at: now(),
    execution: outcome.execution,
    verification: outcome.verification
  };
}

export async function processClaim(action) {
  const saved = journal()[action.action_id];
  let envelope;
  if (saved?.result) {
    envelope = { ...saved.result, device_id: deviceId(), lease_token: action.lease_token,
      action_id: action.action_id, protocol_version: PROTOCOL_VERSION };
  } else if (saved?.startedAt) {
    // Crash-safe at-most-once policy: never repeat a possibly completed call/SMS.
    envelope = resultEnvelope(action, {
      execution: { status: 'failed', output: {}, error: 'execution_interrupted_not_retried' },
      verification: unavailable('crash_journal', 'Execution was interrupted. It was deliberately not repeated to avoid duplicate side effects.')
    }, saved.startedAt);
    journalPut(action.action_id, { startedAt: saved.startedAt, result: envelope });
  } else {
    const startedAt = now();
    journalPut(action.action_id, { startedAt });
    let outcome;
    try { outcome = await executeClaim(action); }
    catch (error) {
      outcome = { execution: { status: 'failed', output: {}, error: String(error?.message || 'device_exception').slice(0, 300) },
        verification: unavailable('exception', 'Device execution threw before verification.') };
    }
    envelope = resultEnvelope(action, outcome, startedAt);
    journalPut(action.action_id, { startedAt, result: envelope });
  }
  return SERVER.submitActionResult(action.action_id, envelope);
}

export async function pollOnce(maxClaims = 3) {
  if (running || !NAT.isNative() || !SERVER.isConfigured()) return { ok: false, reason: 'inactive' };
  running = true;
  let processed = 0;
  try {
    const capabilities = await currentCapabilities();
    while (processed < maxClaims) {
      const claimed = await SERVER.claimAction(deviceId(), capabilities);
      if (!claimed.ok) return { ok: false, reason: claimed.reason, processed };
      if (!claimed.action) break;
      await processClaim(claimed.action);
      processed++;
    }
    return { ok: true, processed };
  } finally { running = false; }
}

export function startActionLoop(intervalMs = 2500) {
  if (timer || !NAT.isNative()) return () => stopActionLoop();
  const tick = () => {
    if (document.visibilityState !== 'hidden' && navigator.onLine) pollOnce().catch(() => {});
  };
  tick();
  timer = setInterval(tick, Math.max(1500, intervalMs));
  window.addEventListener('online', tick);
  document.addEventListener('visibilitychange', tick);
  startActionLoop._tick = tick;
  return () => stopActionLoop();
}

export function stopActionLoop() {
  if (timer) clearInterval(timer);
  timer = null;
  const tick = startActionLoop._tick;
  if (tick) {
    window.removeEventListener('online', tick);
    document.removeEventListener('visibilitychange', tick);
  }
  startActionLoop._tick = null;
}
