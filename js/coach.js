// The Coach: advice worked out from the user's own numbers, plus a bank of motivational lines.
// Pure functions. General budgeting rules of thumb, not regulated financial advice.

const SAVE_RE = /save|saving|invest|isa|emergency|pension|fund|stocks|crypto|house|deposit|rainy/i;
const EMERGENCY_RE = /emergency|rainy|buffer|safety/i;
const ESSENTIAL_RE = /rent|mortgage|bill|council|grocer|food|needs|transport|travel|utilit|insurance/i;
const HOUSING_RE = /rent|mortgage|bill|council|needs/i;
const FUN_RE = /fun|want|spend|treat|going out|play|hobb|holiday|pocket/i;
const PERIOD = { weekly: 7, fortnightly: 14, monthly: 30.44 };
const PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12 };
const DAY = 864e5;

const monthYear = d => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

/**
 * @param state app state
 * @param h { compute, fmt, fmt0, bucketTotal }
 * @returns [{ id, tone: 'good'|'warn'|'tip', icon, title, body, action?: { label, kind, id? } }]
 */
export function insights(state, h) {
  const c = h.compute();
  const out = [];
  const pay = c.pay, yr = PER_YEAR[state.freq] || 12;
  const rows = c.rows.filter(r => r.amt > 0);
  if (pay <= 0) {
    out.push({ id: 'nopay', tone: 'tip', icon: 'coin', title: 'Start with the number', body: 'Tap the note and put in what actually landed, after tax. Everything else works off that.' });
    return out;
  }

  // Leftover with no job
  if (c.rem >= 0.01) {
    const target = rows.filter(r => SAVE_RE.test(r.b.name)).sort((a, b) => b.amt - a.amt)[0] || rows.sort((a, b) => b.amt - a.amt)[0];
    out.push({
      id: 'float', tone: 'warn', icon: 'bolt', title: `${h.fmt(c.rem)} has no job`,
      body: `Unassigned money gets spent on crap you won't remember. Give it somewhere to go.${target ? ` Sweeping it into ${target.b.name} is ${h.fmt0(c.rem * yr)} a year.` : ''}`,
      action: target ? { label: `Sweep into ${target.b.name}`, kind: 'sweep', id: target.b.id } : null
    });
  }

  // Savings rate
  const saved = rows.filter(r => SAVE_RE.test(r.b.name)).reduce((s, r) => s + r.amt, 0);
  const rate = saved / pay;
  if (rate <= 0) {
    out.push({ id: 'rate0', tone: 'warn', icon: 'vault', title: "You're saving nothing", body: `Even 5% (${h.fmt(pay * .05)}) a paycheck is ${h.fmt0(pay * .05 * yr)} a year. Start small. Start this payday.` });
  } else if (rate < .1) {
    const bump = pay * (.15 - rate);
    out.push({ id: 'rateLow', tone: 'tip', icon: 'vault', title: `Saving ${(rate * 100).toFixed(0)}%. Push for 15%`, body: `Another ${h.fmt(bump)} a paycheck is ${h.fmt0(bump * yr)} extra a year. You won't feel it after two paydays.` });
  } else if (rate < .2) {
    out.push({ id: 'rateMid', tone: 'good', icon: 'vault', title: `${(rate * 100).toFixed(0)}% saved. Solid`, body: `That's ${h.fmt0(saved * yr)} a year stacking up. Hit 20% and you're in the top bracket of savers.` });
  } else {
    out.push({ id: 'rateHigh', tone: 'good', icon: 'crown', title: `${(rate * 100).toFixed(0)}% saved. Elite`, body: `${h.fmt0(saved * yr)} a year. ${h.fmt0(saved * yr * 5)} in five years before a penny of interest. Keep doing exactly this.` });
  }

  // Goal ETAs
  for (const r of rows) {
    const g = r.b.goal; if (!g) continue;
    const have = h.bucketTotal(r.b.id), left = g - have;
    if (left <= 0) { out.push({ id: 'goal-' + r.b.id, tone: 'good', icon: 'target', title: `${r.b.name}: goal smashed`, body: `${h.fmt(have)} banked against a ${h.fmt(g)} target. Set a bigger one. You clearly can.`, action: { label: 'Raise the goal', kind: 'bucket', id: r.b.id } }); continue; }
    const n = Math.ceil(left / r.amt);
    const when = new Date(Date.now() + n * (PERIOD[state.freq] || 30.44) * DAY);
    const sooner = n - Math.ceil(left / (r.amt * 1.25));
    const tail = sooner > 0 ? ` Add ${h.fmt(r.amt * .25)} a time and it lands ${sooner} payday${sooner === 1 ? '' : 's'} sooner.` : '';
    out.push({ id: 'goal-' + r.b.id, tone: 'tip', icon: 'target', title: `${r.b.name} hits ${h.fmt0(g)} by ${monthYear(when)}`, body: `${n} more payday${n === 1 ? '' : 's'} at ${h.fmt(r.amt)}.${tail}`, action: { label: 'Tweak it', kind: 'bucket', id: r.b.id } });
  }

  // Emergency fund
  const essentials = rows.filter(r => ESSENTIAL_RE.test(r.b.name)).reduce((s, r) => s + r.amt, 0) * yr / 12;
  if (!state.buckets.some(b => EMERGENCY_RE.test(b.name))) {
    out.push({ id: 'emerg', tone: 'tip', icon: 'shield', title: 'No emergency fund', body: `Aim for three months of essentials${essentials ? ` (about ${h.fmt0(essentials * 3)})` : ''}. It's what stops a dead boiler turning into a credit card bill.`, action: { label: 'Add one', kind: 'add', id: 'Emergency fund' } });
  }

  // Housing share
  const housing = rows.filter(r => HOUSING_RE.test(r.b.name)).reduce((s, r) => s + r.amt, 0) / pay;
  if (housing > .5) out.push({ id: 'housing', tone: 'warn', icon: 'skull', title: `Bills eat ${(housing * 100).toFixed(0)}% of your pay`, body: 'The usual line is around 50%. Worth a look at energy, phone and subscriptions. One switch can free up a bucket.' });

  // Fun
  if (!rows.some(r => FUN_RE.test(r.b.name))) out.push({ id: 'fun', tone: 'tip', icon: 'star', title: 'Budget some fun', body: 'Zero-fun budgets snap, then you blow the lot in one weekend. A small guilt-free bucket keeps the rest safe.' });

  // Streak / payday
  const last = state.history[0];
  if (!last) out.push({ id: 'first', tone: 'tip', icon: 'blade', title: 'Make the first cut', body: "Swipe the blade when your pay lands. Then bank each slip as you move it. That's the whole habit." });

  return out;
}

const LINES = {
  cut: [
    'Future you just got a pay rise.',
    'Every quid has its orders.',
    "You told your money where to go instead of wondering where it went.",
    'Boring moves, big numbers. That is the whole secret.',
    'Nobody claps for budgeting. So we added confetti.',
    'Rich people do this bit. Now so do you.',
    'Small cuts, big pile.',
    'That is how it starts. Then it compounds.',
  ],
  banked: [
    'Moved, stamped, done. Absolute professional.',
    'The money is where you said it would be. Rare.',
    'Paper trail complete. Your accountant would weep.',
  ],
  vault: [
    'Consistency beats cleverness. Keep cutting.',
    'Every split in here is a decision you did not have to make later.',
    'Compound interest loves a regular.',
    'The pile only grows one way: on purpose.',
  ]
};
let lastPick = {};
export function line(kind = 'cut') {
  const pool = LINES[kind] || LINES.cut;
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === lastPick[kind]) i = (i + 1) % pool.length;
  lastPick[kind] = i;
  return pool[i];
}
