/* Step 5: pure smart-prompt and action-bound confirmation policy. */
export const CATEGORIES = Object.freeze({
  MESSAGE: 'MESSAGE', EMAIL: 'EMAIL', CALENDAR: 'CALENDAR', DELIVERY: 'DELIVERY',
  MISSED_CALL: 'MISSED_CALL', SENSITIVE: 'SENSITIVE', SYSTEM: 'SYSTEM', OTHER: 'OTHER'
});

const lower = value => String(value || '').toLowerCase();
const has = (value, terms) => terms.some(term => value.includes(term));
const clean = value => String(value || '').replace(/[\r\n\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();

export function classifyNotification(event = {}) {
  if (event.category && CATEGORIES[event.category]) return event.category;
  const pkg = lower(event.pkg);
  const all = `${lower(event.title)} ${lower(event.text)}`;
  if (has(all, ['otp', 'one time password', 'verification code', 'security code', 'bank', 'debited', 'credited', 'upi', 'transaction', 'payment'])) return CATEGORIES.SENSITIVE;
  if (has(all, ['missed call', 'call back']) || has(pkg, ['dialer', 'telecom'])) return CATEGORIES.MISSED_CALL;
  if (pkg.includes('calendar') || has(all, ['meeting', 'appointment', 'event starts', 'calendar'])) return CATEGORIES.CALENDAR;
  if (has(pkg, ['whatsapp', 'telegram', 'signal', 'messaging', 'messages', 'messenger', 'discord', 'slack']) || has(all, ['new message', 'sent you', 'replied'])) return CATEGORIES.MESSAGE;
  if (has(pkg, ['gmail', 'email', 'outlook', 'protonmail']) || has(all, ['new email', 'new mail'])) return CATEGORIES.EMAIL;
  if (has(pkg, ['amazon', 'flipkart', 'swiggy', 'zomato', 'blinkit']) || has(all, ['delivery', 'delivered', 'out for delivery', 'shipped', 'arriving', 'courier'])) return CATEGORIES.DELIVERY;
  if (pkg.startsWith('android') || pkg.includes('systemui') || has(all, ['battery', 'storage', 'update available', 'permission'])) return CATEGORIES.SYSTEM;
  return CATEGORIES.OTHER;
}

export function isSensitiveNotification(event = {}) {
  return !!event.sensitive || classifyNotification(event) === CATEGORIES.SENSITIVE
    || has(lower(event.pkg), ['authenticator', 'bank', 'wallet', 'payments']);
}

export function isQuietAt(date, start = '22:00', end = '07:00') {
  const toMinute = value => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    return m ? (+m[1] * 60 + +m[2]) : -1;
  };
  const now = date.getHours() * 60 + date.getMinutes();
  const a = toMinute(start), b = toMinute(end);
  if (a < 0 || b < 0 || a === b) return false;
  return a < b ? now >= a && now < b : now >= a || now < b;
}

export function promptFor(event = {}, { address = 'Boss', canReveal = true } = {}) {
  const category = classifyNotification(event);
  const who = clean(address) || 'Boss';
  const source = clean(event.app || event.pkg) || 'your phone';
  const sender = clean(event.title);
  const from = sender ? ` from ${sender.slice(0, 60)}` : '';
  if (isSensitiveNotification(event)) {
    return `${who}, a private notification arrived. Open it on your phone to review it securely.`;
  }
  if (!canReveal) {
    return `${who}, a private notification arrived. Unlock your phone or use headphones to hear the details.`;
  }
  if (category === CATEGORIES.MESSAGE) return `${who}, ${source} message${from}. Would you like me to read it, help draft a reply, or leave it for later?`;
  if (category === CATEGORIES.EMAIL) return `${who}, new email${from}. I can read it or leave it for later.`;
  if (category === CATEGORIES.CALENDAR) return `${who}, calendar update${from}. I can read the details or open it.`;
  if (category === CATEGORIES.DELIVERY) return `${who}, delivery update from ${source}. I can read the details or open it.`;
  if (category === CATEGORIES.MISSED_CALL) return `${who}, missed call${from}. I can open the caller or help message back.`;
  return `${who}, an important notification arrived from ${source}.`;
}

export function notificationDecision(event = {}, settings = {}, now = new Date()) {
  const category = classifyNotification(event);
  const enabled = !!settings.proactiveAssistant && settings.announceNotifications !== false;
  const selected = Array.isArray(settings.notificationCategories)
    ? settings.notificationCategories : Object.keys(CATEGORIES).filter(k => !['OTHER', 'SYSTEM'].includes(k));
  const blocked = String(settings.notificationBlockedApps || '').split(',').map(s => s.trim()).filter(Boolean);
  const blockedApp = blocked.some(pkg => pkg === event.pkg);
  const blockedSenders = String(settings.notificationBlockedContacts || '').split(',')
    .map(s => lower(s).trim()).filter(Boolean);
  const blockedSender = blockedSenders.includes(lower(event.title).trim());
  const quiet = settings.quietHoursEnabled !== false
    && isQuietAt(now, settings.quietHoursStart, settings.quietHoursEnd);
  const sensitive = isSensitiveNotification(event);
  const locked = event.canReveal === false || !!event.screenLocked;
  const privateAudio = !!event.headphones;
  const canReveal = !settings.privateMode && !sensitive
    && !(settings.privateOnLock !== false && locked && !privateAudio);
  const announce = enabled && !settings.privateMode && selected.includes(category)
    && !blockedApp && !blockedSender && !quiet
    && category !== CATEGORIES.OTHER && category !== CATEGORIES.SYSTEM;
  return { announce, category, sensitive, canReveal,
    reason: !enabled ? 'disabled' : settings.privateMode ? 'private_mode' : blockedApp ? 'blocked_app'
      : blockedSender ? 'blocked_sender' : quiet ? 'quiet_hours' : announce ? 'important' : 'filtered' };
}

export function interpretPromptResponse(input) {
  const text = lower(input).trim();
  if (/^(read( it)?|padho|padh do|details?)$/.test(text)) return 'read';
  if (/^(reply|draft( a)? reply|jawab|reply karo)$/.test(text)) return 'reply';
  if (/^(open( it)?|kholo)$/.test(text)) return 'open';
  if (/^(later|ignore|leave it|rehne do|chhodo)$/.test(text)) return 'ignore';
  return '';
}

export function createReplyAuthorization({ eventKey = '', app = '', recipient = '', text = '' }, now = Date.now()) {
  const exactText = clean(text);
  if (!eventKey || !exactText) throw new Error('An exact notification and reply text are required');
  return Object.freeze({
    id: `reply-${now}-${Math.random().toString(36).slice(2, 8)}`,
    eventKey: String(eventKey), app: clean(app), recipient: clean(recipient), text: exactText,
    createdAt: now, expiresAt: now + 2 * 60_000
  });
}

export function confirmationPrompt(auth) {
  return `Ready to send to ${auth.recipient || auth.app}: “${auth.text}”. Say “send it” to send this exact reply, or “cancel”.`;
}

export function verifyReplyAuthorization(auth, { eventKey, text, confirmation, now = Date.now() } = {}) {
  if (!auth || now > auth.expiresAt) return { ok: false, reason: 'expired' };
  if (String(eventKey || '') !== auth.eventKey || clean(text) !== auth.text) return { ok: false, reason: 'action_changed' };
  const words = lower(confirmation).trim();
  if (!/^(send it|send now|bhejo|haan bhejo|ab bhejo)$/.test(words)) return { ok: false, reason: 'explicit_confirmation_required' };
  return { ok: true, reason: 'confirmed' };
}
