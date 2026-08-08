/* =========================================================================
   FRIDAY OS — HUD SHELL
   Plain script (not a module), loaded after app.js. Purely additive:
   - flips the `data-hud="on"` flag that hud-redesign.css keys off
   - draws the glowing connector lines from each floating node to the core
   - builds the bottom telemetry strip from values app.js already writes
     into the DOM (locCity/netSsid/etc.) — never invents data
   - turns long-press-on-core into the "hidden advanced control" reveal
   - turns the vision quick-command into a 5th floating HUD node

   To fully revert to the old dashboard: delete the two lines that
   reference hud-redesign.css and hud-shell.js in index.html. Nothing
   else needs to change.
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

    /* ---------------- connector lines ---------------- */
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'hudLinks');
    dashboard.insertBefore(svg, dashboard.firstChild);

    function nodesToLink() {
      var list = Array.prototype.slice.call(
        dashboard.querySelectorAll('.hud-module:not(.module-ai-core):not(.module-compass), .hud-vision-node')
      );
      return list.filter(function (el) {
        return getComputedStyle(el).display !== 'none';
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

    /* ---------------- vision floating node ---------------- */
    var visionSrc = document.querySelector('.cmd-btn[data-action="vision"]');
    if (visionSrc) {
      var vnode = document.createElement('div');
      vnode.className = 'hud-vision-node';
      vnode.innerHTML =
        '<div class="lbl">VISION</div>' +
        '<div class="main">STANDBY</div>';
      vnode.addEventListener('click', function () {
        visionSrc.click(); // reuse the real handler already wired in app.js
      });
      dashboard.appendChild(vnode);
    }

    /* ---------------- telemetry strip (reads real DOM values only) --- */
    var strip = document.createElement('div');
    strip.id = 'hudTeleStrip';
    strip.innerHTML =
      '<span>VOICE <b class="on" id="hudTVoice">ONLINE</b></span>' +
      '<span>VISION <b id="hudTVision">STANDBY</b></span>' +
      '<span>NET <b id="hudTNet">—</b></span>' +
      '<span>MEMORY <b class="on">ONLINE</b></span>';
    dashboard.appendChild(strip);

    function syncTelemetry() {
      var netVal = document.getElementById('netSsid');
      var tNet = document.getElementById('hudTNet');
      if (netVal && tNet) {
        var txt = netVal.textContent.trim();
        tNet.textContent = txt && txt !== '—' ? txt : 'OFFLINE';
        tNet.className = txt && txt !== '—' ? 'on' : '';
      }
      var listening = document.getElementById('listeningText');
      var tVoice = document.getElementById('hudTVoice');
      if (listening && tVoice) {
        tVoice.textContent = listening.classList.contains('active') ? 'LISTENING' : 'ONLINE';
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

    function openAdvanced() { dashboard.classList.add(EXPANDED); requestAnimationFrame(drawLinks); }
    function closeAdvanced() { dashboard.classList.remove(EXPANDED); requestAnimationFrame(drawLinks); }
    function toggleAdvanced() {
      if (dashboard.classList.contains(EXPANDED)) closeAdvanced();
      else openAdvanced();
    }
    function tapToTalk() {
      var voiceBtn = document.querySelector('.cmd-btn[data-action="voice"]');
      if (voiceBtn) voiceBtn.click(); // reuses the real V.listen() wiring in app.js, nothing duplicated
    }

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