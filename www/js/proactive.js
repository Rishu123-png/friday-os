/* ===== FRIDAY OS — Proactive Engine =====
   JARVIS doesn't wait to be asked. This is the part that speaks first.

   Rules evaluate silently in the background. When one fires, FRIDAY offers
   a suggestion. Each rule has a cooldown so she never nags. */

import { KEYS, getList, cacheGet, cacheSet } from './store.js';
import { patterns, getFact, stats } from './memory.js';

const SEEN = 'friday_proactive_seen';
const seen = () => { try { return JSON.parse(localStorage.getItem(SEEN)) || {}; } catch (_) { return {}; } };
const markSeen = id => {
  const s = seen(); s[id] = Date.now();
  localStorage.setItem(SEEN, JSON.stringify(s));
};
const cooledDown = (id, hours) => {
  const last = seen()[id];
  return !last || (Date.now() - last) > hours * 3600000;
};

/* Each rule: { id, cooldownH, check(ctx) -> null | {text, action?, priority} } */
const RULES = [

  /* ---- Reminder about to fire ---- */
  {
    id: 'reminder_soon', cooldownH: 0.25,
    check: () => {
      const soon = getList(KEYS.REMINDERS)
        .filter(r => !r.done && r.due > Date.now() && r.due - Date.now() < 15 * 60000)
        .sort((a, b) => a.due - b.due)[0];
      if (!soon) return null;
      const mins = Math.max(1, Math.round((soon.due - Date.now()) / 60000));
      return { text: `Heads up — "${soon.text}" in ${mins} minute${mins === 1 ? '' : 's'}.`, priority: 10 };
    }
  },

  /* ---- Overdue reminders ---- */
  {
    id: 'reminder_overdue', cooldownH: 6,
    check: () => {
      const late = getList(KEYS.REMINDERS).filter(r => !r.done && r.due < Date.now() - 60000);
      if (!late.length) return null;
      return { text: late.length === 1
        ? `You missed a reminder: "${late[0].text}". Still need it?`
        : `${late.length} reminders passed without action. Want to review them?`,
        action: { type: 'open_panel', panel: 'sub-reminders' }, priority: 8 };
    }
  },

  /* ---- Rain warning ---- */
  {
    id: 'rain_alert', cooldownH: 8,
    check: ctx => {
      const p = ctx.weather?.daily?.precipitation_probability_max?.[0];
      if (p == null || p < 60) return null;
      return { text: `${p}% chance of rain today. Take an umbrella if you're heading out.`, priority: 7 };
    }
  },

  /* ---- Bad air quality (very relevant in Delhi) ---- */
  {
    id: 'aqi_alert', cooldownH: 8,
    check: ctx => {
      const aqi = ctx.aqi?.current?.us_aqi;
      if (aqi == null || aqi < 150) return null;
      const sev = aqi > 300 ? 'hazardous' : aqi > 200 ? 'very unhealthy' : 'unhealthy';
      return { text: `Air quality is ${sev} — AQI ${Math.round(aqi)}. Consider a mask if you're going outside.`, priority: 9 };
    }
  },

  /* ---- Extreme heat ---- */
  {
    id: 'heat_alert', cooldownH: 10,
    check: ctx => {
      const t = ctx.weather?.current?.temperature_2m;
      if (t == null || t < 40) return null;
      return { text: `It's ${Math.round(t)} degrees out there. Stay hydrated, and avoid the sun midday.`, priority: 7 };
    }
  },

  /* ---- Low battery ---- */
  {
    id: 'battery_low', cooldownH: 2,
    check: ctx => {
      if (!ctx.battery || ctx.battery.charging || ctx.battery.level > 18) return null;
      return { text: `Battery at ${ctx.battery.level}%. You'll want a charger soon.`, priority: 8 };
    }
  },

  /* ---- Learn the user's name ---- */
  {
    id: 'ask_name', cooldownH: 72,
    check: () => {
      if (getFact('user.name')) return null;
      if (stats().interactions < 6) return null;
      return { text: `By the way — what should I call you? Just say "call me <name>".`, priority: 3 };
    }
  },

  /* ---- Time-habit nudge ---- */
  {
    id: 'habit_nudge', cooldownH: 20,
    check: () => {
      const h = new Date().getHours();
      const band = h <= 5 ? 'night' : h <= 11 ? 'morning' : h <= 16 ? 'afternoon' : h <= 21 ? 'evening' : 'late';
      const p = patterns().find(x => x.type === 'time_habit' && x.band === band);
      if (!p) return null;
      const asks = {
        weather: 'Want the weather?', aqi: 'Want today\'s air quality?',
        news: 'Want the headlines?', briefing: 'Want your briefing?',
        reminder_add: 'Anything to remind you about today?'
      };
      const q = asks[p.intent];
      if (!q) return null;
      return { text: `${p.text}. ${q}`, priority: 4 };
    }
  },

  /* ---- Open tasks piling up ---- */
  {
    id: 'tasks_pileup', cooldownH: 24,
    check: () => {
      const open = getList(KEYS.TASKS).filter(t => !t.done);
      if (open.length < 5) return null;
      return { text: `You have ${open.length} open tasks. Want to review and clear a few?`, priority: 5 };
    }
  },

  /* ---- Suggest the Groq upgrade, once, gently ---- */
  {
    id: 'suggest_key', cooldownH: 240,
    check: ctx => {
      if (ctx.hasGroq) return null;
      if (stats().interactions < 25) return null;
      return { text: `You've been using me a fair bit. If you want deeper conversation and real coding, the optional server-configured FRIDAY Cloud backend unlocks it. Everything else already works offline.`, priority: 2 };
    }
  },

  /* ---- Welcome back after a gap ---- */
  {
    id: 'welcome_back', cooldownH: 20,
    check: ctx => {
      const last = ctx.lastSeen;
      if (!last) return null;
      const days = Math.floor((Date.now() - last) / 86400000);
      if (days < 2) return null;
      return { text: `Been ${days} days. Good to have you back. Anything I should catch up on?`, priority: 6 };
    }
  },

  /* ---- Weekly digest (Turn 13) ---- */
  /* Once a week: usage stats + suggest automating the strongest habit. */
  {
    id: 'weekly_digest', cooldownH: 24 * 6.5,
    check: () => {
      const s = stats();
      if (s.interactions < 40) return null;
      const habit = patterns().find(p => p.type === 'time_habit');
      const tip = habit
        ? ` I noticed ${habit.text.toLowerCase()}. Want me to make that an automatic routine? Just say "when I say ${habit.intent === 'weather' ? 'good morning' : habit.intent.replace(/_/g, ' ')}, ${habit.intent === 'news' ? 'tell me the news' : 'give me the weather'}".`
        : '';
      return {
        text: `Weekly digest: ${s.interactions} interactions across ${s.days} days — I know ${s.facts} things about you and noticed ${s.patterns} habits.${tip}`,
        action: { type: 'open_panel', panel: 'activity' },
        priority: 3
      };
    }
  }
];

/**
 * Evaluate all rules and return the single best suggestion (or null).
 * ctx: { weather, aqi, battery, hasGroq, lastSeen }
 */
export function suggest(ctx = {}) {
  const hits = [];
  for (const rule of RULES) {
    if (!cooledDown(rule.id, rule.cooldownH)) continue;
    let out;
    try { out = rule.check(ctx); } catch (_) { out = null; }
    if (out) hits.push({ ...out, id: rule.id });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const best = hits[0];
  markSeen(best.id);
  return best;
}

/** Track last-seen so "welcome back" works */
export function touchSession() {
  const prev = cacheGet('last_seen', true);
  cacheSet('last_seen', Date.now(), 60 * 24 * 365);
  return prev;
}

export function resetProactive() {
  localStorage.removeItem(SEEN);
}
