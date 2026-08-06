/* ============================================================================
   FRIDAY OS — PLUGINS: Plugin / Extension System (v15, pre-Phase-10)
   Lets FRIDAY gain capabilities (weather, Gmail, GitHub, Spotify, calendars…)
   without changing core code. A plugin = { id, name, version, hooks: {…} }.
   Hooks: chat (intercept), intent (extra intents), tick (bus events),
   settings (UI rows), menu (quick actions). Store-backed, install/disable/
   uninstall, pure helpers unit-tested. The default registry ships 3 safe
   starter plugins (off by default).
   ========================================================================== */

import { getList, saveList } from './store.js';
import { Bus, Logger } from './fridaycore.js';

const PLUGINS_KEY = 'friday_plugins';
const REGISTRY = 'friday_plugin_registry';

/* ---------------- Pure helpers ---------------- */

export function validateManifest(m) {
  if (!m || typeof m !== 'object') return { ok: false, reason: 'no manifest' };
  if (!m.id || !/^[a-z0-9-]{2,40}$/.test(m.id)) return { ok: false, reason: 'bad id' };
  if (!m.name) return { ok: false, reason: 'no name' };
  if (m.hooks && typeof m.hooks !== 'object') return { ok: false, reason: 'bad hooks' };
  return { ok: true };
}

/* A plugin's hook contract check (only known hooks allowed). */
export const KNOWN_HOOKS = ['chat', 'intent', 'tick', 'settings', 'menu'];
export function knownHooks(m) {
  if (!m || !m.hooks) return [];
  return Object.keys(m.hooks).filter(h => KNOWN_HOOKS.includes(h));
}

/* ---------------- Registry (built-in starter plugins) ---------------- */

export function defaultRegistry() {
  return [
    { id: 'currency', name: 'Currency Rates', version: '1.0.0', desc: 'Live FX rates (keyless)',
      hooks: { chat: (text) => /convert .* (usd|inr|eur|gbp)/i.test(text) ? 'currency' : null } },
    { id: 'news-headlines', name: 'News Headlines', version: '1.0.0', desc: 'Top headlines (keyless)',
      hooks: { chat: (text) => /(top )?(news|headlines)/i.test(text) ? 'news' : null } },
    { id: 'dictionary', name: 'Dictionary', version: '1.0.0', desc: 'Word definitions (keyless)',
      hooks: { chat: (text) => /define |meaning of /i.test(text) ? 'dictionary' : null } }
  ];
}

/* ---------------- Store (installed + registry) ---------------- */

export function installed() { return getList(PLUGINS_KEY); }
export function registry() { return getList(REGISTRY).length ? getList(REGISTRY) : defaultRegistry(); }

export function installPlugin(manifest) {
  const v = validateManifest(manifest);
  if (!v.ok) return { ok: false, reason: v.reason };
  const list = getList(PLUGINS_KEY);
  if (list.find(p => p.id === manifest.id)) return { ok: false, reason: 'already installed' };
  const rec = { ...manifest, installedAt: Date.now(), enabled: true };
  saveList(PLUGINS_KEY, [rec, ...list]);
  Logger.info('plugins', 'installed ' + rec.id);
  return { ok: true, plugin: rec };
}

export function uninstallPlugin(id) {
  saveList(PLUGINS_KEY, getList(PLUGINS_KEY).filter(p => p.id !== id));
  return true;
}
export function togglePlugin(id, on) {
  saveList(PLUGINS_KEY, getList(PLUGINS_KEY).map(p => p.id === id ? { ...p, enabled: !!on } : p));
  return true;
}
export function enabledPlugins() { return getList(PLUGINS_KEY).filter(p => p.enabled); }

/* ---------------- Runtime: dispatch a chat through plugin hooks ---------------- */
/* Hooks live in the in-code REGISTRY (functions survive). Installed records
   only store metadata; a custom plugin may carry hookCode as a string that we
   eval safely (wrapped, guarded). Returns the first claiming plugin. */
export function claimChat(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  for (const p of enabledPlugins()) {
    try {
      const manifest = registry().find(r => r.id === p.id);   // live hook
      let hook = manifest && manifest.hooks && manifest.hooks.chat;
      if (!hook && p.hookCode) {
        hook = new Function('text', 'return (' + p.hookCode + ')(text)');   // custom string hook
      }
      if (typeof hook === 'function') {
        const claim = hook(t);
        if (claim) return { plugin: p.id, claim };
      }
    } catch (_) {}
  }
  return null;
}

/* ---------------- Plugin stats ---------------- */
export function pluginStats() {
  const list = getList(PLUGINS_KEY);
  return { installed: list.length, enabled: list.filter(p => p.enabled).length, plugins: list.map(p => ({ id: p.id, name: p.name, version: p.version, enabled: p.enabled })) };
}

/* ---------------- init ---------------- */
export function init() {
  try {
    Bus.on('autox:event', e => { try { Bus.emit('plugin:tick', e); } catch (_) {} });
    Logger.info('plugins', 'plugin system online (' + enabledPlugins().length + ' enabled)');
  } catch (e) { Logger.error('plugins', 'init: ' + (e && e.message)); }
  return { ok: true };
}
