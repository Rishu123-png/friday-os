/* ===== FRIDAY OS — Hindi UI pack (v7.5) =====
   Settings toggle "hindiUI". Swaps the VISIBLE shell: boot steps, statuses,
   quick-action labels, widget headings, greetings. Voice replies stay in
   your normal language (the brain already speaks Hinglish on demand).

   DOM-agnostic: instead of touching markup we walk elements and replace
   textContent that EXACTLY matches a dictionary key, so no index.html
   surgery is needed. Reversible with the same map. */

import * as S from './store.js';

/* English text  ->  Hindi text */
const DICT = {
  'Tap to speak': 'Bolne ke liye dabaiye',
  'Listening...': 'Sun rahi hoon...',
  'Thinking...': 'Soch rahi hoon...',
  'TIME': 'SAMAY',
  'WEATHER': 'MAUSAM',
  'NOTE': 'NOTE',
  'JOKE': 'JOKES',
  'VISION': 'NAZAR',
  'SEARCH': 'KHOJ',
  'REMINDERS': 'YAADASHT',
  'QUICK NOTES': 'QUICK NOTES',
  'SYSTEM': 'SYSTEM',
  'No reminders': 'Koi yaadasht nahi',
  'No notes yet': 'Abhi koi note nahi',
  'Settings': 'Settings',
  'Memory Items': 'Yaadein',
  'Chat Messages': 'Messages',
  'Active Reminders': 'Active Yaadasht',
  'AI Provider': 'AI Provider'
};

const BOOT_EN = [
  'Loading core systems', 'Initializing intent engine', 'Calibrating voice modules',
  'Mounting memory banks', 'Loading personality matrix', 'Establishing links', 'FRIDAY OS online'
];
const BOOT_HI = [
  'Core system load ho raha hai', 'Intent engine taiyaar ho raha hai', 'Voice module calibrate ho raha hai',
  'Memory banks mount ho rahe hain', 'Personality matrix load ho rahi hai', 'Links ban rahi hain', 'FRIDAY OS online'
];

const GREET_HI = h =>
  h < 12 ? 'Suprabhat' : h < 17 ? 'Namaste' : 'Shubh sandhya';

export function hindiUI() { return !!S.getSetting('hindiUI'); }

export function bootSteps() { return hindiUI() ? BOOT_HI : BOOT_EN; }

/** Status line shown under the orb. */
export function status(text) {
  if (!hindiUI()) return text;
  return DICT[text] || text;
}

/** Greeting word for the current hour. */
export function greetWord(hour) {
  if (!hindiUI()) return null;
  return GREET_HI(hour == null ? new Date().getHours() : hour);
}

/* Replace textContent that exactly matches a key (or a stored original). */
function swap(root, from, to) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const v = n.nodeValue && n.nodeValue.trim();
    if (!v) continue;
    if (from[v] != null) n.nodeValue = n.nodeValue.replace(v, from[v]);
    else if (to && to[v] != null) n.nodeValue = n.nodeValue.replace(v, to[v]);
  }
}

const REV = Object.fromEntries(Object.entries(DICT).map(([a, b]) => [b, a]));

/** Call after toggling the setting (and after big UI re-renders). */
export function applyHindiUI() {
  try {
    if (hindiUI()) swap(document.body, DICT, null);
    else swap(document.body, REV, null);
  } catch (e) {}
}

export function t(key) { return hindiUI() ? (DICT[key] || key) : key; }
