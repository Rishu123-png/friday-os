/* =========================================================================
   FRIDAY OS — HUD SHELL
   Plain script (not a module), loaded after app.js:
   - activates the standalone portrait HUD stylesheet
   - draws restrained connector lines from the four live cards to the core
   - builds the bottom service rail from values the real HUD engine writes
   - turns long-press-on-core into the hidden advanced control deck

   No service, location, network or device value is invented here.
   ========================================================================= */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    document.documentElement.setAttribute('data-hud', 'on');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#020611');

    var dashboard = document.getElementById('dashboard');
    var coreWrap = document.getElementById('aiCoreWrap');
    if (!dashboard || !coreWrap) return; // old markup — bail out safely

    /* ---------------- cinematic central core ----------------
       Decorative geometry only: state and data still come from the existing
       VOX/core engines. This keeps the HUD honest while giving it the approved
       calm-idle / powerful-active visual language. */
    var coreVisual = document.getElementById('aiCoreVisual') || coreWrap;
    if (!coreVisual.querySelector('.friday-core-architecture')) {
      var architecture = document.createElement('div');
      architecture.className = 'friday-core-architecture';
      architecture.setAttribute('aria-hidden', 'true');
      architecture.innerHTML =
        '<span class="friday-orbit orbit-a"></span>' +
        '<span class="friday-orbit orbit-b"></span>' +
        '<span class="friday-orbit orbit-c"></span>' +
        '<span class="friday-reticle reticle-n"></span>' +
        '<span class="friday-reticle reticle-e"></span>' +
        '<span class="friday-reticle reticle-s"></span>' +
        '<span class="friday-reticle reticle-w"></span>';
      coreVisual.insertBefore(architecture, coreVisual.firstChild);

      var signature = document.createElement('div');
      signature.className = 'friday-core-signature';
      signature.setAttribute('aria-hidden', 'true');
      signature.innerHTML = '<span>F.R.I.D.A.Y</span><i>PERSONAL INTELLIGENCE</i>';
      coreWrap.appendChild(signature);
    }

    function coreState() {
      if (coreWrap.dataset && coreWrap.dataset.aiState) return coreWrap.dataset.aiState;
      var states = ['listening', 'thinking', 'executing', 'speaking', 'sleeping', 'error'];
      for (var i = 0; i < states.length; i++) {
        if (coreWrap.classList.contains('st-' + states[i])) return states[i];
      }
      return 'idle';
    }
    function syncHudState() {
      var state = coreState();
      document.body.setAttribute('data-hud-state', state);
      document.body.classList.toggle('hud-active', state !== 'idle' && state !== 'sleeping');
      requestAnimationFrame(drawLinks);
    }
    syncHudState();
    if (window.MutationObserver) {
      new MutationObserver(syncHudState).observe(coreWrap, {
        attributes: true, attributeFilter: ['class', 'data-ai-state']
      });
    }

    /* ---------------- connector lines ---------------- */
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'hudLinks');
    dashboard.insertBefore(svg, dashboard.firstChild);

    function nodesToLink() {
      var list = Array.prototype.slice.call(
        dashboard.querySelectorAll('.hud-module:not(.module-ai-core):not(.module-compass), .hud-vision-node')
      );
      return list.filter(function (el) {
        var r = el.getBoundingClientRect();
        return getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0 && r.width > 1 && r.height > 1;
      });
    }

    function drawLinks() {
      var stageRect = dashboard.getBoundingClientRect();
      var coreRect = coreWrap.getBoundingClientRect();
      var cx = coreRect.left + coreRect.width / 2 - stageRect.left;
      var cy = coreRect.top + coreRect.height / 2 - stageRect.top;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      nodesToLink().forEach(function (el) {
        var r = el.getBoundingClientRect();
        var nx = r.left + r.width / 2 - stageRect.left;
        var ny = r.top + r.height / 2 - stageRect.top;
        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', nx); line.setAttribute('y1', ny);
        line.setAttribute('x2', cx); line.setAttribute('y2', cy);
        svg.appendChild(line);
      });
    }

    /* ---------------- service rail (reads real DOM values only) ------ */
    var strip = document.createElement('div');
    strip.id = 'hudTeleStrip';
    strip.innerHTML =
      '<span>VOICE <b id="hudTVoice">IDLE</b></span>' +
      '<span>VISION <b id="hudTVision">ON DEMAND</b></span>' +
      '<span>NET <b id="hudTNet">—</b></span>' +
      '<span>MEMORY <b>LOCAL</b></span>';
    dashboard.appendChild(strip);

    function syncTelemetry() {
      var netVal = document.getElementById('netStatus');
      var tNet = document.getElementById('hudTNet');
      if (netVal && tNet) {
        var txt = netVal.textContent.trim();
        tNet.textContent = txt && txt !== '—' ? txt : 'UNAVAILABLE';
        tNet.className = txt === 'CONNECTED' ? 'on' : '';
      }
      var tVoice = document.getElementById('hudTVoice');
      if (tVoice) {
        var voiceState = coreState().toUpperCase();
        tVoice.textContent = voiceState;
        tVoice.className = /^(LISTENING|THINKING|EXECUTING|SPEAKING)$/.test(voiceState) ? 'on' : '';
      }
    }
    setInterval(syncTelemetry, 1500);
    syncTelemetry();

    /* ---------------- core interaction: tap = talk, hold = advanced ---
       Your app never had a tap target on the core itself — voice only
       started from wake-word or the (now hidden) quick-command grid.
       This forwards a real tap to that same existing, working button
       instead of reimplementing listen() logic here. */
    var pressTimer = null;
    var EXPANDED = 'hud-expanded';
    var longPressFired = false;
    var HOLD_MS = 550;
    var deckClose = document.createElement('button');
    deckClose.type = 'button';
    deckClose.className = 'hud-deck-close';
    deckClose.textContent = 'CLOSE SYSTEM DECK';
    deckClose.setAttribute('aria-label', 'Close expanded system controls');
    dashboard.appendChild(deckClose);

    coreWrap.setAttribute('role', 'button');
    coreWrap.setAttribute('tabindex', '0');
    coreWrap.setAttribute('aria-label', 'Talk to FRIDAY. Press and hold for system controls.');
    coreWrap.setAttribute('aria-expanded', 'false');

    function openAdvanced() {
      dashboard.classList.add(EXPANDED);
      coreWrap.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(function () {
        drawLinks();
        try { deckClose.focus({ preventScroll: true }); } catch (_) { deckClose.focus(); }
      });
    }
    function closeAdvanced() {
      dashboard.classList.remove(EXPANDED);
      coreWrap.setAttribute('aria-expanded', 'false');
      requestAnimationFrame(drawLinks);
    }
    function toggleAdvanced() {
      if (dashboard.classList.contains(EXPANDED)) closeAdvanced();
      else openAdvanced();
    }
    function tapToTalk() {
      var voiceBtn = document.querySelector('.cmd-btn[data-action="voice"]');
      if (voiceBtn) voiceBtn.click(); // reuses the real V.listen() wiring in app.js, nothing duplicated
    }
    deckClose.addEventListener('click', function (e) { e.stopPropagation(); closeAdvanced(); });
    coreWrap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tapToTalk(); }
    });

    var startX = 0, startY = 0, moved = false;
    coreWrap.addEventListener('touchstart', function (e) {
      moved = false; longPressFired = false;
      var t = e.touches[0]; startX = t.clientX; startY = t.clientY;
      pressTimer = setTimeout(function () {
        if (!moved) { longPressFired = true; toggleAdvanced(); }
      }, HOLD_MS);
    }, { passive: true });
    coreWrap.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
        moved = true; clearTimeout(pressTimer);
      }
    }, { passive: true });
    coreWrap.addEventListener('touchend', function () {
      clearTimeout(pressTimer);
      if (!moved && !longPressFired) tapToTalk();
    });

    // desktop/testing fallback (mouse)
    coreWrap.addEventListener('mousedown', function () {
      longPressFired = false;
      pressTimer = setTimeout(function () { longPressFired = true; toggleAdvanced(); }, HOLD_MS);
    });
    coreWrap.addEventListener('mouseup', function () {
      clearTimeout(pressTimer);
      if (!longPressFired) tapToTalk();
    });
    coreWrap.addEventListener('mouseleave', function () { clearTimeout(pressTimer); });

    /* tap outside the expanded telemetry collapses it again */
    dashboard.addEventListener('click', function (e) {
      if (!dashboard.classList.contains(EXPANDED)) return;
      if (coreWrap.contains(e.target)) return;
      if (e.target.closest('.hud-bottom-row, .hud-footer-row, .quick-commands-grid')) return;
      closeAdvanced();
    });

    /* ---------------- keep links accurate ---------------- */
    window.addEventListener('resize', drawLinks);
    window.addEventListener('orientationchange', function () { setTimeout(drawLinks, 200); });
    var ro = window.ResizeObserver ? new ResizeObserver(drawLinks) : null;
    if (ro) ro.observe(dashboard);
    setTimeout(drawLinks, 60);
    setTimeout(drawLinks, 400); // fonts/canvas settle late on first paint
  });
})();