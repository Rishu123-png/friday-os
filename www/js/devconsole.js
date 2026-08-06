/* ============================================================================
   FRIDAY OS — DEVCONSOLE: Internal Developer Console + Telemetry (RC1)
   Privacy-respecting, opt-in diagnostics: crash/profiling counters, perf
   snapshots, and a data export for a (future) telemetry dashboard. Nothing
   leaves the device unless the user explicitly exports. This is a release
   tool — not a user feature.
   ========================================================================== */

import { getList, saveList, getSetting, setSetting } from './store.js';
import { Bus } from './fridaycore.js';

const TELEM = 'friday_telemetry';
const MAX = 200;

/* ---------------- 1) Crash + perf telemetry (opt-in) ---------------- */

export function telemetryOn() { return getSetting('telemetry') === true; }
export function setTelemetry(on) { setSetting('telemetry', !!on); }

export function telemetry() { return getList(TELEM); }

export function record(kind, data = {}) {
  if (!telemetryOn()) return null;
  const rec = { kind, ts: Date.now(), ...data };
  saveList(TELEM, [rec, ...getList(TELEM)].slice(0, MAX));
  return rec;
}

/* Wire CORE error events + unhandled JS errors into telemetry (opt-in). */
export function init() {
  try {
    Bus.on('service:error', e => { if (e) record('service_error', { name: e.name, err: String(e.error || '').slice(0, 120) }); });
    Bus.on('core:health', () => {});
    if (typeof window !== 'undefined') {
      window.addEventListener('error', ev => {
        if (ev && ev.message && telemetryOn()) record('js_error', { msg: String(ev.message).slice(0, 160), file: ev.filename ? ev.filename.split('/').pop() : '' });
      });
    }
  } catch (_) {}
  return { ok: true };
}

/* ---------------- 2) Profiling snapshot ---------------- */

export function snapshot({ perf = null, core = null } = {}) {
  const out = { at: Date.now(), telemetry: telemetryOn() };
  if (perf && typeof perf.aiLatency === 'function') out.aiLatencyMs = perf.aiLatency();
  if (perf && typeof perf.queueSizes === 'function') out.queues = perf.queueSizes();
  if (core && typeof core.healthMap === 'function') {
    core.healthMap().then(h => {
      out.services = Object.keys(h).length;
      out.servicesOk = Object.values(h).filter(s => s && s.ok).length;
    }).catch(() => {});
  }
  const telem = getList(TELEM);
  const errors = telem.filter(t => t.kind === 'js_error' || t.kind === 'service_error');
  out.lastErrors = errors.slice(0, 5);
  out.crashCount = errors.length;
  return out;
}

/* ---------------- 3) Export for the (optional) telemetry dashboard ---------------- */

export function exportTelemetry() {
  return { v: 1, app: 'friday-os', at: Date.now(), telemetry: getList(TELEM), settings: telemetryOn() ? { keys: Object.keys(getList('friday_settings') || {}).length } : {} };
}

/* ---------------- 4) Dev console report (for "dev console" command) ---------------- */

export function devReport({ perf = null, core = null, air = null } = {}) {
  const snap = snapshot({ perf, core });
  const rows = [
    `• Telemetry: ${telemetryOn() ? 'ON (opt-in)' : 'OFF (default)'}`,
    `• AI latency: ${snap.aiLatencyMs != null ? snap.aiLatencyMs + ' ms' : '—'}`,
    `• Queues: ${snap.queues ? `crit ${snap.queues.critical} · med ${snap.queues.medium} · low ${snap.queues.low}` : '—'}`,
    `• Crash count (this session): ${snap.crashCount}`,
    `• Telemetry entries: ${getList(TELEM).length}`
  ];
  if (air && typeof air.aiDiagnostics === 'function') {
    const d = air.aiDiagnostics();
    rows.push(`• AI providers: ${d.available.length ? d.available.join(', ') : 'none'} · calls ${d.totalCalls}`);
  }
  return rows.join('\n');
}
