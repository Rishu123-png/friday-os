/* ============================================================================
   FRIDAY OS — STUDYX: AI Study Assistant (v15 Phase 5 — NDA flagship)
   OCR question scanner (reuses VISIONX), AI doubt solver, mock tests (PYQ),
   previous-year question (PYQ) generator, revision planner (reuses PLANX),
   formula sheets, progress analytics. Extends INTELX study tracking — no
   duplicate store (reads friday_study).
   ========================================================================== */

import { getList } from './store.js';
import { revisionPlan } from './planx.js';

const STUDY = 'friday_study';

/* ---------------- 1) Doubt solver ---------------- */
/* Build the AI prompt for a doubt/question (router hook does the rest). */
export function doubtPrompt(text) {
  return 'Student ne yeh doubt pucha hai. Step-by-step samjhao, simple Hindi-English mix, formula batao, ek example do.\n\nDoubt: ' + String(text || '').slice(0, 800);
}

/* Classify the subject of a doubt (for PYQ/formula matching). */
const SUBJ = [
  ['physics', /\b(physics|velocity|force|newton|electric|magnetic|kinetic|momentum|optics|thermo|jee advanced|neet)\b/i],
  ['chemistry', /\b(chemistry|mole|organic|acid|base|chemical|periodic|bond|redox)\b/i],
  ['maths', /\b(maths|math|algebra|calculus|trigonom|geometry|integral|derivative|matrix|permutation)\b/i],
  ['biology', /\b(biology|cell|dna|rna|photosynth|respiration|human body|neet bio)\b/i],
  ['english', /\b(english|grammar|essay|literature|comprehension)\b/i],
  ['history', /\b(history|independence|moghul|british|gupta|maurya)\b/i]
];
export function subjectOf(text) {
  const t = String(text || '');
  for (const [name, re] of SUBJ) if (re.test(t)) return name;
  return 'general';
}

/* ---------------- 2) PYQ generator ---------------- */
/* Template-based previous-year questions per subject (offline, honest). */
export const PYQ_BANK = {
  physics: [
    { q: 'A ball is thrown vertically up with 20 m/s. Find the max height and total time of flight. (PYQ)', a: 'h = v²/2g = 20²/19.6 ≈ 20.4 m; T = 2v/g ≈ 4.08 s' },
    { q: 'State Newton\'s three laws and give one real-life example of each. (PYQ)', a: '1) inertia 2) F=ma 3) action-reaction. Examples: seatbelt, pushing a cart, rocket.' },
    { q: 'Explain conservation of momentum with a bullet-gun example. (PYQ)', a: 'm1v1 = m2v2 → gun recoils opposite to bullet.' }
  ],
  chemistry: [
    { q: 'Balance: Fe + H2O → Fe3O4 + H2 (PYQ)', a: '3Fe + 4H2O → Fe3O4 + 4H2' },
    { q: 'What is a mole? How many molecules in 1 mole? (PYQ)', a: 'Mole = amount with 6.022e23 particles (Avogadro).' },
    { q: 'Difference between ionic and covalent bonds with examples. (PYQ)', a: 'Ionic = transfer (NaCl); covalent = sharing (H2O, CH4).' }
  ],
  maths: [
    { q: 'Find dy/dx if y = x³ + 2x² - 5x + 7 (PYQ)', a: 'dy/dx = 3x² + 4x - 5' },
    { q: 'Solve: 2x + 3y = 12 and x - y = 1 (PYQ)', a: 'x = 3, y = 2' },
    { q: 'What is the derivative of sin x and integral of cos x? (PYQ)', a: 'd/dx sin x = cos x; ∫ cos x dx = sin x + C' }
  ],
  biology: [
    { q: 'Explain photosynthesis in 3 steps. (PYQ)', a: 'Light reaction → Calvin cycle → glucose. Chlorophyll captures light.' },
    { q: 'What is DNA and its role? (PYQ)', a: 'Deoxyribonucleic acid carries genetic instructions.' }
  ],
  general: [
    { q: 'Write a short note on the Indian Independence movement (1942-47). (PYQ)', a: 'Quit India 1942 → INA trials → Cabinet Mission 1946 → Partition + Independence 15 Aug 1947.' },
    { q: 'What are the three states of matter and their particle arrangement? (PYQ)', a: 'Solid (fixed), liquid (close), gas (far apart).' }
  ]
};
export function pyqFor(subject = 'general', n = 3) {
  const bank = PYQ_BANK[subjectOf(subject)] || PYQ_BANK.general;
  return bank.slice(0, n);
}

/* ---------------- 3) Formula sheets ---------------- */
export const FORMULAS = {
  physics: [
    ['v = u + at', '1st equation of motion'],
    ['s = ut + ½at²', '2nd equation of motion'],
    ['v² = u² + 2as', '3rd equation of motion'],
    ['F = ma', "Newton's 2nd law"],
    ['E = mc²', 'mass-energy equivalence'],
    ['KE = ½mv²', 'kinetic energy'],
    ['PE = mgh', 'gravitational potential energy'],
    ['W = F·d·cosθ', 'work done'],
    ['P = W/t', 'power'],
    ['λ = v/f', 'wave equation']
  ],
  maths: [
    ['d/dx xⁿ = n·xⁿ⁻¹', 'power rule'],
    ['∫ xⁿ dx = xⁿ⁺¹/(n+1) + C', 'integration'],
    ['(a+b)² = a² + 2ab + b²', 'identity'],
    ['sin²θ + cos²θ = 1', 'trig identity'],
    ['D = b² - 4ac', 'discriminant'],
    ['x = (-b ± √D)/2a', 'quadratic formula']
  ],
  chemistry: [
    ['M = n/V', 'molarity'],
    ['PV = nRT', 'ideal gas law'],
    ['moles = mass / molar mass', 'mole concept'],
    ['% yield = (actual/theoretical)×100', 'yield']
  ]
};
export function formulaSheet(subject = 'physics', n = 8) {
  return (FORMULAS[subjectOf(subject)] || FORMULAS.physics).slice(0, n);
}

/* ---------------- 4) Progress analytics ---------------- */

export function progress(subject = '') {
  const sessions = getList(STUDY).filter(s => !subject || subjectOf(s.topic || '') === subject);
  const totalMin = sessions.reduce((a, s) => a + (s.min || 0), 0);
  const days = new Set(sessions.map(s => new Date(s.at).toDateString()));
  const last7 = sessions.filter(s => Date.now() - s.at < 7 * 864e5);
  const weekMin = last7.reduce((a, s) => a + (s.min || 0), 0);
  // streak
  let streak = 0;
  const d = new Date();
  while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
  return { subject: subject || 'all', sessions: sessions.length, totalMin, weekMin, days: days.size, streak };
}

/* Weekly study chart (7 bars) for the dashboard. */
export function weekChart() {
  const out = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = d.toDateString();
    const min = getList(STUDY).filter(s => new Date(s.at).toDateString() === key).reduce((a, s) => a + (s.min || 0), 0);
    out.push({ day: d.toLocaleDateString([], { weekday: 'short' }), min });
  }
  return out;
}

/* ---------------- 5) Mock test / quiz builder (pure) ---------------- */
export function mockTest(subject = 'general', n = 5) {
  const bank = PYQ_BANK[subjectOf(subject)] || PYQ_BANK.general;
  // cycle the bank to always deliver n questions (repeat with a tag)
  const picked = [];
  for (let i = 0; i < n; i++) {
    const p = bank[i % bank.length];
    picked.push({ ...p, q: i >= bank.length ? p.q + ' (revise)' : p.q });
  }
  return { subject: subjectOf(subject), questions: picked.map((p, i) => ({ i: i + 1, q: p.q, a: p.a })) };
}
export function gradeTest(answers = []) {
  const correct = answers.filter(a => a && a.correct).length;
  const total = answers.length || 1;
  const pct = Math.round(100 * correct / total);
  return { correct, total, pct, grade: pct >= 80 ? 'A' : pct >= 60 ? 'B' : pct >= 40 ? 'C' : 'D' };
}

/* ---------------- 6) Revision plan wrapper ---------------- */
export function revisionFor(subject, daysUntilExam, hoursPerDay = 2) {
  return revisionPlan(subjectOf(subject) || subject, daysUntilExam, hoursPerDay, 6);
}
