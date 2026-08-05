/* ===== FRIDAY OS — HERALD helpers (v10.3.0) =====
   Pure functions for the INBOX (WhatsApp quick-reply drafting) and
   CALL GUARD (decline + explainer) features. Unit-testable. */

/* Messaging packages FRIDAY can answer through their own quick-reply
   action (works for anything that posts a RemoteInput reply button). */
export const INBOX_PKGS = {
  whatsapp: ['com.whatsapp', 'com.whatsapp.w4b'],
  telegram: ['org.telegram.messenger'],
  messages: ['com.google.android.apps.messaging', 'com.android.messaging']
};

/** Flatten the notif-log into {pkg, who, text, when} entries for day apps. */
export function pickLatestInbox(items, app = 'whatsapp', maxAgeMs = 6 * 3600e3, now = Date.now()) {
  const pkgs = INBOX_PKGS[app] || [app];
  const list = (Array.isArray(items) ? items : [])
    .filter(n => n && pkgs.includes(n.pkg) && (n.text || '').trim())
    .filter(n => !maxAgeMs || (now - (n.when || 0)) < maxAgeMs)
    .sort((a, b) => (b.when || 0) - (a.when || 0));
  return list.map(n => ({ pkg: n.pkg, who: n.title || 'Someone', text: String(n.text).trim(), when: n.when || 0 }));
}

/** Short Hinglish summary of the inbox for speaking aloud. */
export function inboxSummary(entries) {
  if (!entries.length) return '';
  const fmt = entries.slice(0, 3).map(e => `${e.who} likhta hai: "${e.text.slice(0, 60)}"`);
  return entries.length === 1
    ? `Ek message aaya hai — ${fmt[0]}`
    : `${entries.length} messages — ${fmt.join(' ... ')}`;
}

/** LLM prompt that drafts a reply as the user's assistant (short, spoken-tone). */
export function draftPromptFor(who, text, brief = '') {
  const sys = 'You are FRIDAY, the user\'s personal assistant. Draft ONE short reply to a WhatsApp message, ' +
    'as if the user typed it themselves. Hinglish ok. No emojis unless the message uses them. ' +
    'Never reveal private facts not present in the conversation. Output ONLY the reply text.';
  const usr = `${brief ? 'CONTEXT (private, never recite):\n' + brief + '\n\n' : ''}` +
    `Message from ${who}: "${text}"\nReply:`;
  return { sys, usr };
}

/** Fill {name}/{number} placeholders in the call-guard explainer template. */
export function buildExplainer(template, { name = '', number = 'unknown' } = {}) {
  const t = String(template || '').trim() || 'Boss is busy right now — bataiye kya kaam hai, main unhe bata dunga. — FRIDAY';
  return t.split('{name}').join(name || number).split('{number}').join(number).slice(0, 300);
}

/** Guard against the assistant spamming: at most ONE explainer per caller per gap. */
export function explainerAllowed(lastHandled, number, gapMs = 10 * 60e3, now = Date.now()) {
  const at = lastHandled && lastHandled[number];
  return !at || (now - at) > gapMs;
}
