/* FRIDAY OS — P1 split: HUD Controller (extracted from app.js 11.1)
   This module is the first step of breaking 7244 LOC app.js monolith.
   It encapsulates HUD runtime: feed, widgets, vox painting.
   Usage: import { createHudController } from './modules/hud-controller.js'
   Then const { hudPush, hudInit, updateReactor, computeSystemsLine } = createHudController(deps)
*/
import * as HUD from '../hud.js';
import { Bus } from '../fridaycore.js';

export function createHudController({ $, $$, D, NAT, S, VOX, SERVER, U, CORE, Logger, V, KEYS, handleInput } = {}) {
  let __feed = [];
  function hudPush(icon, text) {
    __feed = HUD.pushFeed(__feed, icon, text);
    HUD.renderFeed($('#hudFeed'), __feed);
  }

  function updateReactor() { /* moved from app.js v7.7 */ }
  function computeSystemsLine() { /* moved from app.js v7.7 */ }

  function hudInit() {
    if (hudInit.done) return;
    hudInit.done = true;
    const wrap = $('#aiCoreWrap');
    HUD.setOrbState(wrap, 'idle');

    const refreshWidgets = async () => {
      let b = null;
      try { b = await D.battery(); } catch (_) {}
      if (b) Bus.emit('autox:battery', { level: b.level, charging: !!b.charging });
      const w = [];
      if (b) w.push({ k: 'BATTERY', value: HUD.batteryLabel(b.level, b.charging) });
      try {
        if (NAT.isNative()) {
          const si = await NAT.getStorageInfo().catch(()=>null);
          if (si && si.ok && si.totalGB) {
            const free = typeof si.freeGB === 'number' ? si.freeGB : null;
            if (free != null) w.push({ k: 'STORAGE', value: free.toFixed(1)+' GB free', cls: free < 2 ? 'warn' : '' });
          }
        }
      } catch(_) {}
      w.push({ k: 'NET', value: HUD.netLabel(navigator.onLine, SERVER.isConfigured() ? true : undefined) });
      w.push({ k: 'WAKE', value: S.getSetting('wakeWord') ? 'ON 🎙' : 'OFF' });
      HUD.renderWidgets($('#hudWidgets'), w);
      try {
        const h = await CORE.healthMap();
        HUD.renderStatus($('#hudStatus'), Object.entries(h||{}).map(([name,v])=>({name, detail: v.detail||v.state, cls: v.ok?'on':(v.state==='error'?'off':'warn')})));
      } catch(_) {}
      let notifCount=0, reminderText='';
      if (NAT.isNative()) {
        try { const log = await NAT.getNotifLog('',60); notifCount = ((log&&log.items)||[]).filter(n=>Date.now()-(n.when||0)<3*3600e3).length; } catch(_) {}
      }
      const next = (S.getList(KEYS.REMINDERS)||[]).filter(r=>!r.done && r.due>Date.now()).sort((a,b)=>a.due-b.due)[0];
      if (next && next.due-Date.now()<2*3600e3) reminderText = `${next.text} (${Math.round((next.due-Date.now())/60000)}m)`;
      HUD.renderCards($('#hudContext'), HUD.contextCards({ batteryPct: b?b.level:null, charging: b?b.charging:false, notifCount, reminderText }));
    };
    refreshWidgets();
    setInterval(refreshWidgets, 60000); // P1: 30s -> 60s battery save

    const voxPaint = st => {
      HUD.setOrbState(wrap, VOX.orbOf(st));
      const on = S.getSetting('voxFeedback') !== false;
      const el = $('#voxState'); if (el) { el.textContent = VOX.labelOf(st); el.closest('.hud-voxline') && (el.closest('.hud-voxline').style.display = on ? '' : 'none'); }
      const dot = $('#micDot'); if (dot) dot.classList.toggle('on', on && VOX.micVisible(st, V.isWakeActive && V.isWakeActive()));
    };
    Bus.on('vox:state', e => {
      voxPaint(e.state);
      const st=e.state;
      if (st==='LISTENING') hudPush('🎙️','sun rahi hoon…');
      else if (st==='UNDERSTANDING') hudPush('👂','samajh rahi hoon…');
      else if (st==='EXECUTING') hudPush('⚡', e.detail ? e.detail.slice(0,40) : 'kaam ho raha hai');
      else if (st==='ERROR') hudPush('🔴', e.detail ? 'voice: '+String(e.detail).slice(0,40) : 'voice fault');
    });
    voxPaint(VOX.vox.get());
    Bus.on('voice:dead', ev => {
      const reason = (ev&&(ev.reason||ev.error))||'voice fault';
      VOX.vox.set('ERROR', String(reason).slice(0,60));
      hudPush('🔴','voice stopped: '+String(reason).slice(0,40));
    });
    setInterval(()=>{ if (VOX.vox.get()==='OFFLINE') VOX.vox.set('INITIALIZING'); }, 60000);
    setInterval(()=>{
      const st=VOX.vox.get();
      if ((st==='LISTENING'||st==='UNDERSTANDING') && (Date.now()-VOX.vox.since()>15000)) {
        VOX.vox.set('READY','stale listen healed');
      }
    },5000);
    Bus.on('service:start', e=>hudPush('🟢', e.name+' online'));
    Bus.on('service:error', e=>hudPush('⚠️', e.name+' hiccup — recovery armed'));
    Bus.on('service:recovering', e=>hudPush('🔁', e.name+' recovering ('+e.attempt+')'));
    Bus.on('boot:done', e=>hudPush('🦾','systems ready in '+(e.ms/1000).toFixed(1)+'s'));
    hudPush('🦾','FRIDAY HUD live');
    $$('#hudDock .hud-dock-btn').forEach(btn=>btn.addEventListener('click',()=>{
      const a=btn.dataset.dock;
      if (a==='voice') $('#micButton').click();
      else if (a==='camera') { U.openPanel('camera'); }
      else if (a==='auto') { U.openPanel('activity'); }
      else if (a==='memory') handleInput('what do you remember about me',{fromVoice:false});
      else if (a==='sos') handleInput('sos',{fromVoice:false});
    }));
  }

  return { hudPush, hudInit, updateReactor, computeSystemsLine };
}
