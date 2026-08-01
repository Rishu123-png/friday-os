/* ===== FRIDAY OS — UI Layer =====
   Panels, toasts, themes, particles, core canvas, waveform. */

import { getSetting } from './store.js';
import { readLevels } from './device.js';

export const $ = s => document.querySelector(s);
export const $$ = s => Array.from(document.querySelectorAll(s));

export function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = String(t);
  return d.innerHTML;
}

/* ---------- Toast ---------- */
let toastTimer = null;
export function toast(msg, icon = '🔔', ms = 2600) {
  const el = $('#toast');
  if (!el) return;
  $('#toastIcon').textContent = icon;
  $('#toastMsg').textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- Views ---------- */
export function showView(name) {
  const dash = $('#dashboard'), chat = $('#chatView');
  if (!dash || !chat) return;
  if (name === 'chat') {
    dash.style.display = 'none';
    chat.style.display = 'flex';
  } else {
    dash.style.display = 'flex';
    chat.style.display = 'none';
  }
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
}

/* ---------- Panels ---------- */
export function openPanel(name) {
  const first = !anyPanelOpen();
  closeAllPanels();
  const id = name.startsWith('sub-') ? `#${name.slice(4)}SubPanel` : `#${name}Panel`;
  const el = $(id);
  if (!el) return false;
  // one history entry per "panel session" so the back button/gesture
  // closes the panel instead of leaving the app (popstate in app.js)
  if (first) { try { history.pushState({ fridayPanel: 1 }, ''); } catch (_) {} }
  el.classList.add('open');
  return true;
}

export function closePanel(name) {
  const id = name.startsWith('sub-') ? `#${name.slice(4)}SubPanel` : `#${name}Panel`;
  const el = $(id);
  if (el) el.classList.remove('open');
}

export function closeAllPanels() {
  $$('.panel, .sub-panel').forEach(p => p.classList.remove('open'));
}

export function anyPanelOpen() {
  return $$('.panel.open, .sub-panel.open').length > 0;
}

/* ---------- Theme ---------- */
export function applyTheme(name) {
  document.documentElement.dataset.theme = name === 'cyber' ? '' : name;
  const colors = {
    cyber: '#0a0a1a', neon: '#0f0520', matrix: '#000a00',
    sunset: '#1a0a05', midnight: '#000000',
    stark: '#050d1f', crimson: '#160508', stealth: '#0b0b08'
  };
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = colors[name] || '#0a0a1a';
}

/* ---------- Core canvas (arc reactor) ---------- */
let coreRAF = null;
export function initCore(canvas, stateRef) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const SIZE = 120;
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.width = SIZE + 'px';
  canvas.style.height = SIZE + 'px';
  ctx.scale(dpr, dpr);

  const parts = Array.from({ length: 24 }, (_, i) => ({
    angle: (Math.PI * 2 / 24) * i,
    radius: 34 + Math.random() * 14,
    size: 0.8 + Math.random() * 1.8,
    speed: 0.4 + Math.random() * 1.6,
    op: 0.3 + Math.random() * 0.7
  }));

  let a = 0;
  const C = SIZE / 2;

  const colorFor = () => {
    if (stateRef.processing) return { r: 255, g: 170, b: 0 };
    if (stateRef.speaking) return { r: 0, g: 255, b: 136 };
    if (stateRef.listening) return { r: 255, g: 0, b: 110 };
    return { r: 0, g: 212, b: 255 };
  };

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    const c = colorFor();
    const rgb = `${c.r},${c.g},${c.b}`;

    // audio reactive pulse
    let boost = 0;
    if (stateRef.listening) {
      const lv = readLevels();
      if (lv) boost = (lv.reduce((s, v) => s + v, 0) / lv.length) / 255 * 8;
    }

    [[42, 0.12, 1], [32, 0.22, 1.4], [22, 0.34, 1.8]].forEach(([r, op, w]) => {
      ctx.beginPath();
      ctx.arc(C, C, r + boost * 0.4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${rgb},${op})`;
      ctx.lineWidth = w;
      ctx.stroke();
    });

    const g = ctx.createRadialGradient(C, C, 0, C, C, 20 + boost);
    g.addColorStop(0, `rgba(${rgb},0.55)`);
    g.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(C, C, 20 + boost, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(C, C, 4.5 + boost * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.shadowBlur = 18;
    ctx.shadowColor = `rgb(${rgb})`;
    ctx.fill();
    ctx.shadowBlur = 0;

    a += stateRef.processing ? 0.03 : 0.008;
    parts.forEach(p => {
      const ang = p.angle + a * p.speed;
      const x = C + Math.cos(ang) * (p.radius + boost * 0.3);
      const y = C + Math.sin(ang) * (p.radius + boost * 0.3);
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},${p.op * 0.6})`;
      ctx.fill();
    });

    coreRAF = requestAnimationFrame(draw);
  }

  cancelAnimationFrame(coreRAF);
  draw();
}

/* ---------- Particle background ---------- */
let partRAF = null;
export function initParticles(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = innerWidth * dpr;
    H = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    const count = Math.min(46, Math.floor(innerWidth / 12));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.25 * dpr,
      vy: (Math.random() - 0.5) * 0.25 * dpr,
      r: (Math.random() * 1.6 + 0.4) * dpr,
      o: Math.random() * 0.4 + 0.1
    }));
  }
  resize();
  addEventListener('resize', resize);

  function draw() {
    if (!getSetting('particleEffects')) {
      ctx.clearRect(0, 0, W, H);
      partRAF = requestAnimationFrame(draw);
      return;
    }
    ctx.clearRect(0, 0, W, H);
    const style = getComputedStyle(document.documentElement);
    const prim = (style.getPropertyValue('--primary') || '#00d4ff').trim();

    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = prim;
      ctx.globalAlpha = p.o;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    partRAF = requestAnimationFrame(draw);
  }
  cancelAnimationFrame(partRAF);
  draw();
}

/* ---------- Waveform (real audio) ---------- */
let waveRAF = null;
export function animateWaveform(container, stateRef) {
  if (!container) return;
  const bars = Array.from(container.children);
  function frame() {
    const active = stateRef.listening || stateRef.speaking || stateRef.processing;
    if (!active) {
      bars.forEach(b => { b.style.transform = 'scaleY(0.12)'; });
    } else if (stateRef.listening) {
      const lv = readLevels();
      bars.forEach((b, i) => {
        const v = lv ? lv[Math.floor(i / bars.length * lv.length)] / 255 : Math.random() * 0.5;
        b.style.transform = `scaleY(${Math.max(0.12, Math.min(1, v * 1.6))})`;
      });
    } else {
      const t = Date.now() / 220;
      bars.forEach((b, i) => {
        const v = 0.25 + Math.abs(Math.sin(t + i * 0.4)) * (stateRef.processing ? 0.45 : 0.7);
        b.style.transform = `scaleY(${v})`;
      });
    }
    waveRAF = requestAnimationFrame(frame);
  }
  cancelAnimationFrame(waveRAF);
  frame();
}

/* ---------- Markdown-lite renderer (for AI replies & code) ---------- */
export function renderRich(text) {
  let html = escapeHtml(text);

  // fenced code blocks
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = 'c' + Math.random().toString(36).slice(2, 8);
    return `<div class="code-block">
      <div class="code-head"><span>${lang || 'code'}</span>
      <button class="code-copy" data-copy="${id}">Copy</button></div>
      <pre><code id="${id}">${code.trim()}</code></pre></div>`;
  });

  html = html
    .replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^[-•] (.+)$/gm, '<div class="li">• $1</div>')
    .replace(/\n/g, '<br>');

  return html;
}

/* ---------- Empty-state helper ---------- */
export function emptyState(msg) {
  return `<p class="empty-state">${escapeHtml(msg)}</p>`;
}
