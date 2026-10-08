// Clean Cut: Money Score. A credit-score style health check (0-999), derived from app state.
// Pure functions, no DOM. Not a real credit score: nothing here is reported anywhere.

import { isSavings, evaluate } from './progress.js';

export const MAX = 999;

// Experian-style bands, lowest first.
export const BANDS = [
  { min: 0, name: 'Very poor', blurb: 'Starting line. Every box below is points waiting.' },
  { min: 561, name: 'Poor', blurb: 'Moving. Fill the emergency fund and bank your splits.' },
  { min: 721, name: 'Fair', blurb: 'Solid base. Consistency is what gets you higher.' },
  { min: 881, name: 'Good', blurb: 'Better than most adults. Seriously.' },
  { min: 961, name: 'Excellent', blurb: 'Top of the shop. Keep it here.' },
];

// The plan: key dates and to-dos.
export const DATES = { bday: '2027-03-15', taxEnd: '2027-04-05', newYear: '2027-04-06', payRise: '2027-09-01' };
export const TRUST = 5000;
export const CHECKS = [
  { id: 'trustask', name: 'Ask the trustees how and when the £5,000 pays out', hint: 'What ID and forms they need, and how long it takes' },
  { id: 'bank', name: 'Bank account in my name, ready for the trust money', hint: 'Sorted well before 15 March' },
  { id: 'gear', name: 'Bike gear: helmet, gloves, lock', hint: 'Before anything else' },
  { id: 'pension', name: 'Opt into the workplace pension', hint: 'Email payroll: section 7, Pensions Act 2008' },
  { id: 'catins', name: 'Cat insurance for all 3', hint: 'Lifetime cover, check the per-cat limit' },
  { id: 'catvax', name: 'Cats vaccinated and neutered', hint: 'Some insurers need jabs up to date' },
  { id: 'easy', name: 'Open an easy-access savings account', hint: 'Home for the emergency fund' },
  { id: 'lisa', name: 'Open a Dodl stocks & shares LISA', hint: 'On or after 15 March 2027, HSBC FTSE All World' },
  { id: 'lisa4k', name: 'Pay £4,000 of the trust money into the LISA', hint: 'Before 5 April 2027 = first £1,000 bonus' },
  { id: 'lisa2', name: 'Pay the second £4,000 into the LISA', hint: 'On or after 6 April 2027 = second £1,000 bonus' },
  { id: 'isa', name: 'Open a stocks & shares ISA', hint: 'From April 2027, for flexible money' },
];

const DAY = 864e5;
const n = x => (Number.isFinite(+x) ? +x : 0);
const c01 = x => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const r2 = x => Math.round(x * 100) / 100;

function parseISO(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
export function daysUntil(iso, now = new Date()) {
  const t = new Date(now); t.setHours(0, 0, 0, 0);
  return Math.round((parseISO(iso) - t) / DAY);
}
export function phase(now = new Date()) {
  const d = daysUntil(DATES.bday, now), e = daysUntil(DATES.taxEnd, now);
  return d > 0 ? 1 : e >= 0 ? 2 : 3;
}

function totalFor(state, id) {
  let t = 0;
  for (const h of state.history || []) if (h.cur === state.cur) for (const p of h.parts || []) if (p.id === id) t += n(p.amt);
  for (const m of state.moves || []) if (m.b === id && (m.cur || state.cur) === state.cur) t += n(m.amt);
  return t;
}

export function pension(gross) {
  const q = Math.max(0, Math.min(n(gross), 50270) - 6240);
  return { you: q * 0.04 / 12, relief: q * 0.01 / 12, employer: q * 0.03 / 12, total: q * 0.08 / 12 };
}

// Each factor: max points, v (0..1), what it is now, and how to raise it.
export function factors(state, fmt = x => '£' + Math.round(x)) {
  const out = [];
  const pay = Math.max(0, n(state.pay));
  const buckets = state.buckets || [];
  const base = b => Math.max(0, b.mode === 'pct' ? pay * n(b.value) / 100 : n(b.value));
  const amt = b => b.mode === 'rest' ? Math.max(0, pay - buckets.reduce((t, x) => t + (x.mode === 'rest' ? 0 : base(x)), 0)) : base(b);

  const savedPlan = buckets.filter(b => isSavings(b.name)).reduce((s, b) => s + amt(b), 0);
  const rate = pay > 0 ? savedPlan / pay : 0;
  out.push({ id: 'rate', name: 'Saving rate', max: 250, v: c01(rate / 0.5),
    now: `${Math.round(rate * 100)}% of each pay goes to saving buckets`,
    tip: rate >= 0.5 ? 'Maxed. Half your pay saved is elite.' : 'Full marks at 50% of pay into savings, ISA, LISA or emergency buckets.' });

  const em = buckets.find(b => /emergency|rainy/i.test(b.name || ''));
  const emGoal = em && n(em.goal) > 0 ? n(em.goal) : 1500;
  const emHave = em ? totalFor(state, em.id) : 0;
  out.push({ id: 'emergency', name: 'Emergency fund', max: 200, v: em ? c01(emHave / emGoal) : 0,
    now: em ? `${fmt(emHave)} of ${fmt(emGoal)}` : 'No emergency bucket',
    tip: !em ? 'Add a bucket called Emergency fund with a £1,500 goal.' : emHave >= emGoal ? 'Full. One bad month can\'t sink you.' : `Fill it to ${fmt(emGoal)} for full marks.` });

  const ev = evaluate(state);
  out.push({ id: 'streak', name: 'Consistency', max: 150, v: c01(ev.streak / 6),
    now: `${ev.streak} on-time payday${ev.streak === 1 ? '' : 's'} in a row`,
    tip: ev.streak >= 6 ? 'Six on the bounce. Habit locked in.' : 'Cut every payday on time. Full marks at 6 in a row.' });

  const recent = (state.history || []).filter(h => h.cur === state.cur).slice(0, 6);
  const banked = recent.filter(h => h.status === 'banked').length;
  out.push({ id: 'moved', name: 'Money actually moved', max: 100, v: recent.length ? banked / recent.length : 0,
    now: recent.length ? `${banked} of your last ${recent.length} splits fully banked` : 'No splits yet',
    tip: recent.length && banked === recent.length ? 'Every slip stamped.' : 'Finish the Transfer Run so the money really moves.' });

  const goals = buckets.filter(b => n(b.goal) > 0);
  const gAvg = goals.length ? goals.reduce((s, b) => s + c01(totalFor(state, b.id) / n(b.goal)), 0) / goals.length : 0;
  out.push({ id: 'goals', name: 'Goals filled', max: 100, v: gAvg,
    now: goals.length ? `${Math.round(gAvg * 100)}% across ${goals.length} goal${goals.length === 1 ? '' : 's'}` : 'No bucket goals set',
    tip: goals.length ? 'Fill your buckets towards their goals.' : 'Give your saving buckets a goal.' });

  const checks = (state.plan && state.plan.checks) || {};
  const done = CHECKS.filter(c => checks[c.id]).length;
  out.push({ id: 'plan', name: 'Plan progress', max: 150, v: done / CHECKS.length,
    now: `${done} of ${CHECKS.length} to-dos done`,
    tip: done < CHECKS.length ? 'Every to-do ticked adds points.' : 'Plan complete.' });

  const on = !!(state.plan && state.plan.penOn);
  out.push({ id: 'pension', name: 'Pension', max: 49, v: on ? 1 : 0,
    now: on ? 'Opted in' : 'Not opted in',
    tip: on ? 'Taking the free employer money.' : 'Opt in for an easy 49 points.' });
  return out;
}

export function bandFor(score) {
  let i = 0;
  while (i + 1 < BANDS.length && score >= BANDS[i + 1].min) i++;
  return { ...BANDS[i], index: i, next: BANDS[i + 1] || null };
}

export function score(state, fmt) {
  const f = factors(state, fmt);
  const total = Math.round(f.reduce((s, x) => s + x.max * c01(x.v), 0));
  return { score: total, band: bandFor(total), factors: f };
}

// One snapshot per day, last 90 kept. Returns the change over roughly the last week.
export function logScore(state, s, now = Date.now()) {
  const log = Array.isArray(state.scoreLog) ? state.scoreLog : (state.scoreLog = []);
  const day = new Date(now).toDateString();
  const last = log[log.length - 1];
  let changed = false;
  if (last && new Date(last.t).toDateString() === day) { if (last.s !== s) { last.s = s; changed = true; } }
  else { log.push({ t: now, s }); changed = true; }
  if (log.length > 90) log.splice(0, log.length - 90);
  const ref = [...log].reverse().find(e => now - e.t >= 7 * DAY) || log[0];
  return { changed, delta: ref ? s - ref.s : 0, since: ref ? ref.t : now };
}

export { r2 };
