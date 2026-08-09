/* FRIDAY OS — failure-tolerant boot primitives.
   This module has no DOM dependency so the same rules are unit-tested in Node. */

export const BOOT_STATE = Object.freeze({
  PENDING: 'PENDING', READY: 'READY', LIMITED: 'LIMITED',
  UNAVAILABLE: 'UNAVAILABLE', NOT_INSTALLED: 'NOT INSTALLED',
  DISABLED: 'DISABLED', FAILED: 'FAILED', SLOW: 'SLOW'
});

const TERMINAL = new Set([
  BOOT_STATE.READY, BOOT_STATE.LIMITED, BOOT_STATE.UNAVAILABLE,
  BOOT_STATE.NOT_INSTALLED, BOOT_STATE.DISABLED, BOOT_STATE.FAILED
]);

export class BootDiagnostics {
  constructor() { this.rows = new Map(); this.online = false; this.startedAt = Date.now(); }
  define(name, { mandatory = false, state = BOOT_STATE.PENDING, detail = '' } = {}) {
    this.rows.set(name, { name, mandatory, state, detail, at: Date.now() });
    return this.get(name);
  }
  set(name, state, detail = '') {
    const old = this.rows.get(name) || { name, mandatory: false };
    const row = { ...old, state, detail: String(detail || '').slice(0, 160), at: Date.now() };
    this.rows.set(name, row);
    return row;
  }
  get(name) { return this.rows.get(name) || null; }
  all() { return [...this.rows.values()]; }
  mandatoryFailure() {
    return this.all().find(r => r.mandatory && (r.state === BOOT_STATE.FAILED || r.state === BOOT_STATE.UNAVAILABLE)) || null;
  }
  canGoOnline() { return !this.mandatoryFailure(); }
  finish() { this.online = this.canGoOnline(); return this.online; }
}

/** Resolve optional work by its deadline. Late completion is ignored, not cancelled. */
export async function settleOptional(name, work, {
  timeoutMs = 2500, diagnostics = null,
  readyDetail = 'ready', timeoutState = BOOT_STATE.LIMITED,
  timeoutDetail = 'initialization slow; continuing without it',
  failureState = BOOT_STATE.UNAVAILABLE
} = {}) {
  let timer;
  try {
    const outcome = await Promise.race([
      Promise.resolve().then(work).then(value => ({ kind: 'value', value }), error => ({ kind: 'error', error })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs); })
    ]);
    clearTimeout(timer);
    if (outcome.kind === 'timeout') {
      diagnostics && diagnostics.set(name, timeoutState, timeoutDetail);
      return { ok: false, timedOut: true, value: null };
    }
    if (outcome.kind === 'error') {
      const detail = outcome.error && outcome.error.message ? outcome.error.message : String(outcome.error || 'failed');
      diagnostics && diagnostics.set(name, failureState, detail);
      return { ok: false, timedOut: false, error: outcome.error, value: null };
    }
    const ok = outcome.value !== false && !(outcome.value && outcome.value.ok === false);
    diagnostics && diagnostics.set(name, ok ? BOOT_STATE.READY : failureState,
      ok ? readyDetail : ((outcome.value && outcome.value.reason) || 'unavailable'));
    return { ok, timedOut: false, value: outcome.value };
  } finally { clearTimeout(timer); }
}

export async function runBootPlan(steps, diagnostics = new BootDiagnostics()) {
  for (const step of steps) {
    if (!diagnostics.get(step.name)) diagnostics.define(step.name, { mandatory: !!step.mandatory });
    if (step.skipState) { diagnostics.set(step.name, step.skipState, step.skipDetail || ''); continue; }
    const result = await settleOptional(step.name, step.run, {
      timeoutMs: step.timeoutMs || 2500,
      diagnostics,
      readyDetail: step.readyDetail || 'ready',
      timeoutState: step.mandatory ? BOOT_STATE.FAILED : (step.timeoutState || BOOT_STATE.LIMITED),
      timeoutDetail: step.timeoutDetail || 'initialization timed out',
      failureState: step.mandatory ? BOOT_STATE.FAILED : (step.failureState || BOOT_STATE.UNAVAILABLE)
    });
    if (step.mandatory && !result.ok) break;
  }
  diagnostics.finish();
  return diagnostics;
}

export function isTerminalBootState(state) { return TERMINAL.has(state); }
