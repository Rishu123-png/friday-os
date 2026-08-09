/* ============================================================================
   FRIDAY OS — IGNITION (v11.1.0 / Phase 2: Cinematic Boot)
   Extends (never replaces) the existing #bootScreen. Stage-driven, and every
   diagnostic line shows a REAL check's result — the boot can never freeze:
   each check has a timeout and failures become red '⚠' lines, not crashes.
   ============================================================================ */

export const STAGES = ['black', 'core', 'diagnostics', 'services', 'aistate', 'scan', 'welcome', 'out'];

/* ---------------- pure planning (unit-tested) ---------------- */

/** Decide which stages run and how they pace. mode: 'auto'|'full'|'short'|'off'. */
export function bootPlan({ mode = 'auto', firstRun = true, reduced = false } = {}) {
  if (mode === 'off') return { stages: [], minMs: 0, pace: 0, mode: 'off' };
  if (reduced && !firstRun) return { stages: ['black', 'welcome', 'out'], minMs: 1400, pace: 300, mode: 'short' };
  if (mode === 'full' || (mode === 'auto' && firstRun)) {
    return { stages: STAGES.slice(), minMs: 6800, pace: 340, mode: 'full' };
  }
  /* short: still gets the movie feel, just fast */
  return { stages: ['black', 'core', 'diagnostics', 'aistate', 'welcome', 'out'], minMs: 2600, pace: 150, mode: 'short' };
}

/** One diagnostic line's presentation model. */
export function diagLine(label, state, detail = '') {
  const icon = state === 'ok' ? '✓' : state === 'fail' ? '⚠' : '…';
  const cls = state === 'ok' ? 'b-ok' : state === 'fail' ? 'b-fail' : 'b-run';
  return { id: 'line-' + label.replace(/\W+/g, '-').toLowerCase(), html: `${label} <b>${icon}</b>${detail ? ` <i>${detail}</i>` : ''}`, cls };
}

/** Environment scan cell content from a raw provider result. */
export function scanCell(label, value, ok = true) {
  return { label, value: String(value).slice(0, 28), cls: ok === false ? 'b-fail' : 'b-ok' };
}

/** Welcome line trio for the time of day (device clock, real). */
export function welcomeLines(hour, name = 'Boss') {
  const part = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  return [`Good ${part}`, `Welcome back, ${name}`, 'FRIDAY Online'];
}

/** Progress bar width across the whole boot (stage index of total). */
export function stageProgress(idx, total) { return Math.min(100, Math.round(((idx + 1) / total) * 100)); }

/* ---------------- soft audio (WebAudio, optional) ---------------- */
export function bootTone(enabled, freq = 520, durMs = 90, gain = 0.025) {
  if (!enabled) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = bootTone.ctx || (bootTone.ctx = new AC());
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durMs / 1000);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + durMs / 1000);
  } catch (_) { /* audio is a garnish, never a blocker */ }
}

/* ---------------- the driver ---------------- */
const setStage = (root, s) => { if (root) root.dataset.stage = s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Real-check wrapper: 1.2s timeout, errors -> {ok:false} (never throws). */
async function probe(fn, timeoutMs = 1200) {
  try {
    return await Promise.race([Promise.resolve().then(fn), new Promise(r => setTimeout(() => r({ ok: false, detail: 'slow' }), timeoutMs))]);
  } catch (e) { return { ok: false, detail: (e && e.message ? String(e.message).slice(0, 20) : 'fail') }; }
}

/**
 * Run the cinematic boot. Resolves when the boot is done (caller then fades).
 * @param {object} o
 *   root           #bootScreen element
 *   plan           from bootPlan()
 *   checks         [{label, run}]  boot diagnostics (real)
 *   services       [{name}]        FridayCore service names (light-up uses CORE state)
 *   scan           [{label, run}]  environment scan (real values)
 *   welcome        [line1,line2,line3]
 *   initPromise    app init() runs in parallel — boot ends only when BOTH done
 *   sound          boolean
 *   bus            CORE Bus (boot:stage / boot:done events)  (optional)
 */
export async function runIgnition(o) {
  const { root, plan, checks = [], services = [], scan = [], welcome = [], initPromise = Promise.resolve(), sound = false, bus = null, core = null } = o;
  const emit = (e, p) => { try { bus && bus.emit(e, p); } catch (_) {} };
  const t0 = Date.now();
  const linesEl = root && root.querySelector('#bootStageLines');
  const spinEl = root && root.querySelector('#bootServices');
  const scanEl = root && root.querySelector('#bootScan');
  const welEl = root && root.querySelector('#bootWelcome');
  const barEl = root && root.querySelector('.boot-progress-bar');
  let skipped = false;
  const skip = () => { if (plan.stages.indexOf(root.dataset.stage) >= 1) skipped = true; };
  if (root) root.addEventListener('pointerdown', skip, { once: false });
  const stepHit = () => { if (skipped) throw SKIP; };

  const SKIP = Symbol('skip');
  try {
    const total = plan.stages.length - 1;
    for (let i = 0; i < plan.stages.length; i++) {
      const stage = plan.stages[i];
      stepHit();
      setStage(root, stage);
      emit('boot:stage', { stage, i, total });
      bootTone(sound, 420 + i * 90);
      if (barEl) barEl.style.width = stageProgress(i, total) + '%';

      if (stage === 'diagnostics' && linesEl) {
        linesEl.innerHTML = '';
        for (const c of checks) {
          stepHit();
          linesEl.insertAdjacentHTML('beforeend', `<div class="b-line b-run" id="${diagLine(c.label, 'run').id}"><span>${c.label}</span> <b>…</b></div>`);
          const r = await probe(c.run);
          const d = diagLine(c.label, r.ok ? 'ok' : 'fail', r.detail || '');
          const el = linesEl.querySelector('#' + d.id);
          if (el) { el.className = 'b-line ' + d.cls; el.innerHTML = `<span>${c.label}</span> <b>${d.ok ? '✓' : (r.ok ? '✓' : '⚠')}</b> <i>${(r.detail || '')}</i>`; }
          await sleep(Math.min(plan.pace, 260));
        }
        continue;
      }
      if (stage === 'services' && spinEl) {
        spinEl.hidden = false;
        const names = spinEl.querySelectorAll('[data-svc]');
        for (const n of names) { n.classList.add('b-node-off'); }
        for (const n of names) {
          stepHit();
          await sleep(Math.max(120, plan.pace - 60));
          const svc = core && core.get ? core.get(n.dataset.svc) : null;
          const ok = !!svc && svc.state === 'running';
          n.classList.remove('b-node-off'); n.classList.add(ok ? 'b-node-on' : 'b-node-bad');
        }
        continue;
      }
      if (stage === 'aistate') { /* orb wrapper class changes in CSS via data-stage */ await sleep(plan.pace * 2); continue; }
      if (stage === 'scan' && scanEl) {
        scanEl.hidden = false; scanEl.innerHTML = '';
        for (const s2 of scan) {
          stepHit();
          const r = await probe(s2.run);
          const cell = scanCell(s2.label, r.ok ? (r.detail || 'ok') : (r.detail || 'n/a'), r.ok);
          scanEl.insertAdjacentHTML('beforeend', `<div class="b-cell ${cell.cls}"><b>${s2.label}</b><i>${cell.value}</i></div>`);
          await sleep(Math.min(plan.pace, 240));
        }
        continue;
      }
      if (stage === 'welcome' && welEl) {
        welEl.hidden = false;
        for (const w of welcome) { stepHit(); welEl.insertAdjacentHTML('beforeend', `<div class="b-wel">${w}</div>`); await sleep(plan.pace * 1.6); }
        continue;
      }
      await sleep(stage === 'black' ? Math.min(900, plan.pace * 2) : plan.pace);
    }
  } catch (e) { if (e !== SKIP) throw e; }

  /* never reveal the HUD before BOTH the cinematic minimum AND app init are done */
  const wait = plan.minMs - (Date.now() - t0);
  if (wait > 0) await sleep(Math.min(wait, 9000));
  await Promise.race([initPromise.catch(() => {}), sleep(12000)]);
  if (root) root.removeEventListener('pointerdown', skip);
  emit('boot:done', { ms: Date.now() - t0, skipped });
  return { ms: Date.now() - t0, skipped };
}
