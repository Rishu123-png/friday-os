import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, classifyNotification, isQuietAt, notificationDecision, promptFor,
  createReplyAuthorization, confirmationPrompt, verifyReplyAuthorization
} from '../www/js/proactive-assistant.js';

test('smart notification categories distinguish messages, deliveries and sensitive events', () => {
  assert.equal(classifyNotification({ pkg: 'com.whatsapp', title: 'Ria', text: 'hello' }), CATEGORIES.MESSAGE);
  assert.equal(classifyNotification({ pkg: 'com.amazon.mShop.android.shopping', text: 'Out for delivery' }), CATEGORIES.DELIVERY);
  assert.equal(classifyNotification({ pkg: 'com.bank.app', text: 'OTP 129944 for transaction' }), CATEGORIES.SENSITIVE);
});

test('quiet hours support overnight and daytime ranges', () => {
  assert.equal(isQuietAt(new Date(2026, 0, 1, 23, 0), '22:00', '07:00'), true);
  assert.equal(isQuietAt(new Date(2026, 0, 1, 12, 0), '22:00', '07:00'), false);
  assert.equal(isQuietAt(new Date(2026, 0, 1, 12, 0), '09:00', '17:00'), true);
});

test('decision filters system noise, blocked apps and quiet-hour interruptions', () => {
  const base = { proactiveAssistant: true, announceNotifications: true,
    notificationCategories: ['MESSAGE'], quietHoursEnabled: false };
  assert.equal(notificationDecision({ pkg: 'com.whatsapp', text: 'new message' }, base).announce, true);
  assert.equal(notificationDecision({ pkg: 'com.whatsapp', text: 'private', canReveal: false },
    { ...base, privateOnLock: true }).canReveal, false);
  assert.equal(notificationDecision({ pkg: 'com.whatsapp', text: 'private' },
    { ...base, privateMode: true }).canReveal, false);
  assert.equal(notificationDecision({ pkg: 'android', text: 'battery' }, base).announce, false);
  assert.equal(notificationDecision({ pkg: 'com.whatsapp', text: 'hi' }, { ...base, notificationBlockedApps: 'com.whatsapp' }).reason, 'blocked_app');
  assert.equal(notificationDecision({ pkg: 'com.whatsapp', title: 'Private contact', text: 'hi' },
    { ...base, notificationBlockedContacts: 'Private contact' }).reason, 'blocked_sender');
});

test('sensitive prompt never recites OTP or promises headphone disclosure', () => {
  const event = { pkg: 'Bank', title: 'OTP', text: 'Your OTP is 998877' };
  const prompt = promptFor(event, { address: 'Sir', canReveal: true });
  assert.match(prompt, /^Sir, a private notification/);
  assert.match(prompt, /review it securely/);
  assert.doesNotMatch(prompt, /998877|headphones/);
});

test('non-sensitive locked prompt reveals neither source nor sender', () => {
  const prompt = promptFor({ pkg: 'com.whatsapp', app: 'WhatsApp', title: 'Ria', text: 'hello' },
    { address: 'Boss', canReveal: false });
  assert.match(prompt, /^Boss, a private notification/);
  assert.doesNotMatch(prompt, /WhatsApp|Ria|hello/);
});

test('reply authorization is bound to exact event, recipient text and explicit phrase', () => {
  const auth = createReplyAuthorization({ eventKey: 'notification-7', app: 'com.whatsapp', recipient: 'Ria', text: 'I will call at 7.' }, 1_000);
  assert.match(confirmationPrompt(auth), /Ria/);
  assert.match(confirmationPrompt(auth), /I will call at 7/);
  assert.equal(verifyReplyAuthorization(auth, { eventKey: 'notification-7', text: auth.text, confirmation: 'yes', now: 2_000 }).ok, false);
  assert.equal(verifyReplyAuthorization(auth, { eventKey: 'notification-8', text: auth.text, confirmation: 'send it', now: 2_000 }).reason, 'action_changed');
  assert.equal(verifyReplyAuthorization(auth, { eventKey: 'notification-7', text: 'changed', confirmation: 'send it', now: 2_000 }).reason, 'action_changed');
  assert.equal(verifyReplyAuthorization(auth, { eventKey: 'notification-7', text: auth.text, confirmation: 'send it', now: 2_000 }).ok, true);
  assert.equal(verifyReplyAuthorization(auth, { eventKey: 'notification-7', text: auth.text, confirmation: 'send it', now: 122_000 }).reason, 'expired');
});
