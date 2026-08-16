import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('portrait HUD is standalone and preserves the real-data engine and shell', async () => {
  const [html, app] = await Promise.all([read('www/index.html'), read('www/js/app.js')]);
  const v21 = html.indexOf('css/hud-v21.css');
  const engine = html.indexOf('js/hud_v20.js');
  const shell = html.indexOf('js/hud-shell.js');
  assert.ok(v21 >= 0, 'the portrait HUD stylesheet must load');
  assert.doesNotMatch(html, /href="css\/hud-redesign\.css"/, 'retired override must not shape the runtime HUD');
  assert.ok(engine >= 0 && shell > engine, 'the interaction shell must load after the real-data HUD engine');
  assert.match(html, /class="hud-identity"/);
  assert.match(html, /id="aiCoreWrap"/);
  assert.match(html, /id="coreCanvas"/);
  assert.equal((html.match(/class="cmd-btn"/g) || []).length, 6, 'HUD has the approved controls plus direct chat access');
  for (const action of ['voice', 'chat', 'vision', 'reminder', 'notes', 'more']) {
    assert.match(html, new RegExp(`data-action="${action}"`));
  }
  assert.match(app, /chat:\s*\(\)\s*=>\s*\{\s*U\.closeAllPanels\(\);\s*U\.showView\('chat'\)/, 'chat action must open the working conversation view');
  assert.match(app, /\$\('#textInput'\)\?\.focus/, 'chat action should focus the real message input');
});

test('HUD shell mirrors real core/network state and does not hard-code online service claims', async () => {
  const shell = await read('www/js/hud-shell.js');
  assert.match(shell, /friday-core-architecture/);
  assert.match(shell, /setAttribute\('data-hud-state', state\)/);
  assert.match(shell, /MutationObserver\(syncHudState\)/);
  assert.match(shell, /attributeFilter: \['class', 'data-ai-state'\]/);
  assert.match(shell, /document\.getElementById\('netStatus'\)/);
  assert.match(shell, /coreState\(\)\.toUpperCase\(\)/);
  assert.doesNotMatch(shell, /VOICE[^\n]+ONLINE|MEMORY[^\n]+ONLINE/);
  assert.match(shell, /aria-label', 'Talk to FRIDAY/);
});

test('all four visible cards use real sources or explicit limited states', async () => {
  const [hud, api] = await Promise.all([read('www/js/hud_v20.js'), read('www/js/api.js')]);
  assert.match(hud, /API\.getPosition\(7000\)/);
  assert.match(hud, /API\.getWeather\(loc\.lat, loc\.lon\)/);
  assert.match(hud, /NAT\.wifiAudit\(\)/);
  assert.match(hud, /NAT\.getSystemState\(\)/);
  assert.match(hud, /typeof system\.bluetooth [!=]== 'boolean'/);
  assert.match(hud, /NOT EXPOSED BY BROWSER/);
  assert.match(hud, /PERMISSION REQUIRED/);
  assert.doesNotMatch(api, /28\.6139|77\.2090|New Delhi/);
  assert.match(api, /previously cached real fix/);
});

test('portrait HUD includes reference layout, active, compact, landscape, reduced-motion and deck policies', async () => {
  const css = await read('www/css/hud-v21.css');
  assert.match(css, /Standalone reference-shaped shell/);
  assert.match(css, /--core-size:\s*min\(76vw, 44vh, 590px\)/);
  assert.match(css, /\.module-location\s*\{[^}]*top:\s*16%/s);
  assert.match(css, /\.module-network\s*\{[^}]*top:\s*16%/s);
  assert.match(css, /\.module-weather\s*\{[^}]*var\(--core-size\)/s);
  assert.match(css, /\.module-bluetooth\s*\{[^}]*var\(--core-size\)/s);
  assert.match(css, /body\.hud-active \.ai-core-container/);
  assert.match(css, /body\[data-hud-state="thinking"\]/);
  assert.match(css, /body\[data-hud-state="speaking"\]/);
  assert.match(css, /\.quick-commands-grid\s*\{[^}]*display:\s*flex !important/s);
  assert.match(css, /#hudTeleStrip\s*\{[^}]*border-radius:\s*24px 24px 0 0/s);
  assert.match(css, /@media \(max-width: 390px\), \(max-height: 690px\)/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 520px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /data-fx\*='"particles":false'/);
  assert.match(css, /\.dashboard\.hud-expanded\s*\{[^}]*overflow-y: auto !important/s);
  assert.match(css, /\.hud-deck-close[^}]*min-height: 44px/s);
});
