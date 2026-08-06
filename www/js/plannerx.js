/* ============================================================================
   FRIDAY OS — PLANNERX: Smart Planner (v15 Phase 4 / Smart Productivity 4)
   AI to-do list, smart reminders, daily agenda, weekly planner, priority
   suggestions. Reads the EXISTING stores (tasks, reminders, events) — no
   duplicate data. Pure logic is unit-tested; AI prioritize() hooks the router.
   ========================================================================== */

import { KEYS, getList } from './store.js';
import { parseTime } from './nlp.js';

/* ---------------- 1) Unified day view ---------------- */

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

/** Everything due on a given date: reminders + tasks + events. */
export function agendaFor(date = new Date()) {
  const start = startOfDay(date).getTime(), end = endOfDay(date).getTime();
  const items = [];
  for (const r of getList(KEYS.REMINDERS)) {
    if (!r.done && r.due >= start && r.due <= end) items.push({ type: 'reminder', time: new Date(r.due), text: r.text, done: false, ref: r });
  }
  for (const t of getList(KEYS.TASKS)) {
    if (!t.done) items.push({ type: 'task', time: t.created ? new Date(t.created) : null, text: t.text, done: false, ref: t });
  }
  for (const e of getList(KEYS.EVENTS)) {
    items.push({ type: 'event', time: e.ts ? new Date(e.ts) : null, text: e.text, done: false, ref: e });
  }
  items.sort((a, b) => (a.time ? a.time.getTime() : 0) - (b.time ? b.time.getTime() : 0));
  return items;
}

/** Today's agenda — the "good morning" planner output. */
export function todayAgenda() { return agendaFor(new Date()); }

/** Next 7 days: { dateKey, label, items:[...] } */
export function weeklyPlan(n = 7) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    out.push({
      dateKey: dayKey(d),
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric' }),
      items: agendaFor(d)
    });
  }
  return out;
}

/* ---------------- 2) Smart reminders (parse natural time + text) ---------------- */

/** Split "remind me to X at Y" into {text, when} using parseTime. */
export function parseSmartReminder(input) {
  const t = String(input || '').trim();
  if (!t) return null;
  const when = parseTime(t);
  let text = t;
  if (when) text = t.replace(when.matched, '').trim();
  text = text.replace(/^(remind me to |remind me |set a reminder |reminder to )/i, '').trim();
  if (!text) text = 'Reminder';
  return { text, due: when ? when.date : null };
}

/* ---------------- 3) Priority suggestions (pure scoring) ---------------- */

/** Score an item 0-100 for priority: urgency, type weight, done. */
export function priorityScore(item, now = Date.now()) {
  if (!item) return 0;
  if (item.done) return 0;
  let score = 40;
  const typeWeight = { reminder: 15, task: 8, event: 5 };
  score += typeWeight[item.type] || 0;
  if (item.time) {
    const diffMs = item.time.getTime() - now;
    const hours = diffMs / 3600000;
    if (diffMs < 0) score += 20;                       // overdue
    else if (hours < 3) score += 18;
    else if (hours < 12) score += 12;
    else if (hours < 48) score += 6;
    else score += 1;
  }
  const t = String(item.text || '').toLowerCase();
  if (/\b(urgent|important|asap|emergency|deadline|due today|aaj hi)\b/.test(t)) score += 10;
  if (/\b(birthday|medicine|doctor|payment|bill|meeting|interview|exam)\b/.test(t)) score += 6;
  return Math.min(100, Math.round(score));
}

/** Top priorities for a date (default today). */
export function topPriorities(date = new Date(), limit = 5) {
  return agendaFor(date)
    .map(item => ({ item, score: priorityScore(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => ({ ...x.item, score: x.score }));
}

/** AI-tuned suggestion: router hook (optional) → fallback text. */
export async function suggestPriority(items, { ai = null } = {}) {
  const top = (items || topPriorities()).slice(0, 3);
  if (!top.length) return 'Nothing pressing today. Enjoy the calm.';
  if (ai && typeof ai === 'function') {
    try {
      const r = await ai(top.map(t => `${t.text} (${t.score}/100)`).join(' | '));
      if (r && r.ok && r.text) return r.text;
    } catch (_) {}
  }
  const first = top[0];
  return `Start with "${first.text}"${first.time ? ' (' + first.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')' : ''} — sabse zyada priority.`;
}

/* ---------------- 4) Statistics ---------------- */

export function plannerStats() {
  const tasks = getList(KEYS.TASKS);
  const rem = getList(KEYS.REMINDERS);
  return {
    openTasks: tasks.filter(t => !t.done).length,
    doneTasks: tasks.filter(t => t.done).length,
    pendingReminders: rem.filter(r => !r.done && r.due > Date.now()).length,
    overdueReminders: rem.filter(r => !r.done && r.due < Date.now()).length,
    today: todayAgenda().length
  };
}
