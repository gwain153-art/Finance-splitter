// Crimson Cut: gamification logic. Pure functions, no DOM, no deps.
// Everything here is derived from app state, so it can be recomputed at any time.

const DAY = 86400000;
const PERIOD_DAYS = { weekly: 7, fortnightly: 14, monthly: 30.44 };
const SAVINGS_RE = /save|saving|invest|isa|emergency|pension|fund|stocks|crypto|house|deposit|rainy/i;
const DEFAULT_NAMES = ['rent & bills', 'savings', 'investing', 'groceries', 'fun money', 'emergency fund', 'new bucket', ''];
const EPS = 0.01 + 1e-9;

// XP tuning (exported so the UI can explain it)
export const XP_RULES = {
  base: 100,          // per split
  savedMax: 200,      // x fraction of that split saved (20% saved = +40)
  perfect: 50,        // parts sum to the pay within 1p
  streakStep: 10,     // x current streak length, capped
  streakCap: 10,      // so max streak bonus per split is 100
  resplit: 10,        // a split within half a pay period of the previous one (a redo, not a new payday)
};

export const LEVELS = [
  { level: 1, name: 'Skint', xp: 0 },
  { level: 2, name: 'Coin Goblin', xp: 100 },
  { level: 3, name: 'Penny Pincher', xp: 300 },
  { level: 4, name: 'Budget Gremlin', xp: 600 },
  { level: 5, name: 'Spreadsheet Botherer', xp: 1000 },
  { level: 6, name: 'Wage Butcher', xp: 1600 },
  { level: 7, name: 'Cash Cutthroat', xp: 2400 },
  { level: 8, name: 'Tight-Fisted Menace', xp: 3500 },
  { level: 9, name: 'Ledger Lord', xp: 5000 },
  { level: 10, name: 'Duke of Dosh', xp: 7000 },
  { level: 11, name: 'Compound Interest Hooligan', xp: 9500 },
  { level: 12, name: 'Tax-Efficient Warlord', xp: 12500 },
  { level: 13, name: "Bank Manager's Nightmare", xp: 16000 },
  { level: 14, name: 'Crimson Baron', xp: 20000 },
  { level: 15, name: 'Grand Vizier of Wedge', xp: 25000 },
  { level: 16, name: 'Crimson Emperor', xp: 32000 },
];

export function isSavings(name) {
  return SAVINGS_RE.test(String(name || ''));
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function periodMs(freq) {
  return (PERIOD_DAYS[freq] || PERIOD_DAYS.monthly) * DAY;
}

function splitStats(entry) {
  const pay = num(entry.pay);
  const parts = Array.isArray(entry.parts) ? entry.parts : [];
  let sum = 0, saved = 0;
  for (const p of parts) {
    const a = num(p.amt);
    sum += a;
    if (isSavings(p.name)) saved += a;
  }
  return {
    pay, sum, saved,
    savedFrac: pay > 0 ? Math.min(1, saved / pay) : 0,
    perfect: pay > 0 && parts.length > 0 && Math.abs(sum - pay) <= EPS,
  };
}

// Walks history oldest to newest. Each gap is classified relative to the newer split's frequency:
//   < 0.5x period  -> 'redo' (same payday, ignored for streaks)
//   <= 1.5x period -> 'ontime' (streak +1)
//   otherwise      -> 'late' (streak resets to 0)
function walk(state) {
  const hist = Array.isArray(state && state.history) ? state.history.slice() : [];
  hist.sort((a, b) => num(a.t) - num(b.t));
  const out = [];
  let run = 0, best = 0, prevT = null;
  for (const e of hist) {
    let kind = 'first';
    if (prevT !== null) {
      const gap = num(e.t) - prevT;
      const per = periodMs(e.freq || (state && state.freq));
      if (gap < per * 0.5) kind = 'redo';
      else if (gap <= per * 1.5) { kind = 'ontime'; run++; }
      else { kind = 'late'; run = 0; }
    }
    if (kind !== 'redo') prevT = num(e.t);
    best = Math.max(best, run);
    out.push({ e, kind, run, ...splitStats(e) });
  }
  return { rows: out, streak: run, bestStreak: best };
}

function xpFromRows(rows) {
  let xp = 0;
  for (const r of rows) {
    if (r.kind === 'redo') { xp += XP_RULES.resplit; continue; }
    xp += XP_RULES.base;
    xp += Math.round(r.savedFrac * XP_RULES.savedMax);
    if (r.perfect) xp += XP_RULES.perfect;
    if (r.kind === 'ontime') xp += XP_RULES.streakStep * Math.min(r.run, XP_RULES.streakCap);
  }
  return xp;
}

export function computeXp(state) {
  return xpFromRows(walk(state).rows);
}

function levelFor(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
  return i;
}

function fmt(cur, n) {
  return (cur || '£') + Number(n).toLocaleString('en-GB');
}

const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const ratio = (have, need) => clamp01(have / need);

// Achievement definitions. `check(ctx)` returns progress 0..1; 1 means unlocked.
function defs(cur) {
  const m = (n) => fmt(cur, n);
  return [
    // Early wins
    { id: 'first_blood', name: 'First Blood', icon: 'blade', desc: 'Make your first cut. The wallet bleeds.',
      check: (c) => ratio(c.splits, 1) },
    { id: 'name_shame', name: 'Name and Shame', icon: 'star', desc: 'Rename a bucket to something that is actually yours.',
      check: (c) => (c.customNamed ? 1 : 0) },
    { id: 'hand_of_five', name: 'High Five', icon: 'shield', desc: 'Juggle 5 buckets at once. Show-off.',
      check: (c) => ratio(c.bucketCount, 5) },
    { id: 'octobudget', name: 'Octo-Budget', icon: 'shield', desc: '8 buckets. You have tentacles in every pot.',
      check: (c) => ratio(c.bucketCount, 8) },
    { id: 'hoover', name: 'Leftover Hoover', icon: 'coin', desc: 'Make a bucket to sweep up the leftovers. Nothing escapes.',
      check: (c) => (c.hasSweep ? 1 : 0) },
    { id: 'big_dreams', name: 'Big Dreams', icon: 'target', desc: 'Set a goal on a bucket. Delusional or ambitious? Yes.',
      check: (c) => (c.goalCount > 0 ? 1 : 0) },

    // Precision
    { id: 'no_penny', name: 'Not a Penny Wasted', icon: 'target', desc: 'Allocate a paycheck down to the last penny.',
      check: (c) => ratio(c.perfectCount, 1) },
    { id: 'pedant', name: 'Pedant Supreme', icon: 'target', desc: '10 perfectly allocated splits. Accountants fear you.',
      check: (c) => ratio(c.perfectCount, 10) },

    // Saving hard in one split
    { id: 'tight_arse', name: 'Tight Arse', icon: 'vault', desc: 'Save 30% or more of a single paycheck.',
      check: (c) => ratio(c.bestSavedFrac, 0.3) },
    { id: 'squirrel', name: 'Squirrel Mode', icon: 'vault', desc: 'Save half a paycheck in one go. Nuts.',
      check: (c) => ratio(c.bestSavedFrac, 0.5) },
    { id: 'monk', name: 'Monk Mode', icon: 'skull', desc: 'Save 80% of a paycheck. Do you even eat?',
      check: (c) => ratio(c.bestSavedFrac, 0.8) },

    // Split counts
    { id: 'splits_10', name: 'Getting Handy', icon: 'blade', desc: '10 splits. The knife knows your name.',
      check: (c) => ratio(c.splits, 10) },
    { id: 'splits_25', name: 'Serial Slicer', icon: 'blade', desc: '25 splits. This is a pattern now.',
      check: (c) => ratio(c.splits, 25) },
    { id: 'splits_50', name: 'Half-Centurion', icon: 'shield', desc: '50 splits. Legions tremble.',
      check: (c) => ratio(c.splits, 50) },
    { id: 'splits_100', name: 'Centurion of Cuts', icon: 'crown', desc: '100 splits. Absolute unit.',
      check: (c) => ratio(c.splits, 100) },

    // Paid milestones
    { id: 'paid_1k', name: 'Four Figures', icon: 'coin', desc: `Push ${m(1000)} through the blender.`,
      check: (c) => ratio(c.paid, 1000) },
    { id: 'paid_10k', name: 'Five Figure Flex', icon: 'coin', desc: `${m(10000)} sliced and diced.`,
      check: (c) => ratio(c.paid, 10000) },
    { id: 'paid_50k', name: 'Fifty Large', icon: 'bolt', desc: `${m(50000)} carved up. Proper money.`,
      check: (c) => ratio(c.paid, 50000) },
    { id: 'paid_100k', name: 'Six Figure Swagger', icon: 'crown', desc: `${m(100000)} through the grinder. Insufferable.`,
      check: (c) => ratio(c.paid, 100000) },

    // Saved milestones
    { id: 'saved_100', name: 'Piggy Bank Awakens', icon: 'vault', desc: `Stash your first ${m(100)}.`,
      check: (c) => ratio(c.saved, 100) },
    { id: 'saved_1k', name: 'Rainy Day Wanker', icon: 'vault', desc: `${m(1000)} saved. Let it pour.`,
      check: (c) => ratio(c.saved, 1000) },
    { id: 'saved_10k', name: 'Hoard Mode', icon: 'vault', desc: `${m(10000)} saved. Dragons are jealous.`,
      check: (c) => ratio(c.saved, 10000) },
    { id: 'saved_25k', name: 'Scrooge Tier', icon: 'crown', desc: `${m(25000)} saved. Swim in it, go on.`,
      check: (c) => ratio(c.saved, 25000) },

    // Streaks
    { id: 'streak_3', name: 'On a Roll', icon: 'flame', desc: '3 on-time paydays in a row.',
      check: (c) => ratio(c.bestStreak, 3) },
    { id: 'streak_6', name: 'Habit Forming', icon: 'flame', desc: '6 on-time paydays on the bounce.',
      check: (c) => ratio(c.bestStreak, 6) },
    { id: 'streak_12', name: 'Unstoppable Bastard', icon: 'flame', desc: '12 on-time paydays. Nobody can stop you.',
      check: (c) => ratio(c.bestStreak, 12) },

    // Goals
    { id: 'goal_hit', name: 'Goal Getter', icon: 'target', desc: "Fill a bucket to its goal. Back of the net.",
      check: (c) => clamp01(c.bestGoalFrac) },
    { id: 'goal_hat_trick', name: 'Hat-Trick Hero', icon: 'crown', desc: 'Smash 3 bucket goals. Take a bow.',
      check: (c) => ratio(c.goalsHit, 3) },

    // Oddballs
    { id: 'big_paycheck', name: 'Big Swinging Paycheck', icon: 'bolt', desc: `Split a single pay of ${m(5000)} or more.`,
      check: (c) => ratio(c.biggestPay, 5000) },
    { id: 'shapeshifter', name: 'Shapeshifter', icon: 'star', desc: 'Split on two different pay frequencies. Commitment issues.',
      check: (c) => ratio(c.freqs, 2) },
    { id: 'yolo', name: 'Living Dangerously', icon: 'skull', desc: 'Split a paycheck and save absolutely nothing. Bold.',
      check: (c) => (c.zeroSaveSplit ? 1 : 0), hidden: true },
    { id: 'nice', name: 'Nice.', icon: 'skull', desc: 'Split a pay of exactly 69 or 420. Grow up.',
      check: (c) => (c.nicePay ? 1 : 0), hidden: true },
    { id: 'oil_baron', name: 'Suspiciously Minted', icon: 'crown', desc: `A single pay of ${m(100000)}. Who did you rob?`,
      check: (c) => ratio(c.biggestPay, 100000), hidden: true },
  ];
}

function context(state, w) {
  const buckets = Array.isArray(state && state.buckets) ? state.buckets : [];
  const rows = w.rows;
  const byBucket = new Map();
  let paid = 0, saved = 0, perfectCount = 0, bestSavedFrac = 0, biggestPay = 0;
  let zeroSaveSplit = false, nicePay = false;
  const freqs = new Set();
  for (const r of rows) {
    paid += r.pay;
    saved += r.saved;
    if (r.perfect) perfectCount++;
    bestSavedFrac = Math.max(bestSavedFrac, r.savedFrac);
    biggestPay = Math.max(biggestPay, r.pay);
    if (r.pay > 0 && r.saved === 0 && (r.e.parts || []).length > 0) zeroSaveSplit = true;
    if (r.pay === 69 || r.pay === 420) nicePay = true;
    if (r.e.freq) freqs.add(r.e.freq);
    for (const p of r.e.parts || []) {
      if (p.id == null) continue;
      byBucket.set(p.id, (byBucket.get(p.id) || 0) + num(p.amt));
    }
  }
  let goalCount = 0, goalsHit = 0, bestGoalFrac = 0;
  for (const b of buckets) {
    const goal = num(b.goal);
    if (!(goal > 0)) continue;
    goalCount++;
    const frac = (byBucket.get(b.id) || 0) / goal;
    if (frac >= 1) goalsHit++;
    bestGoalFrac = Math.max(bestGoalFrac, frac);
  }
  return {
    splits: rows.length, paid, saved, perfectCount, bestSavedFrac, biggestPay,
    zeroSaveSplit, nicePay, freqs: freqs.size,
    bucketCount: buckets.length,
    customNamed: buckets.some((b) => !DEFAULT_NAMES.includes(String(b.name || '').trim().toLowerCase())),
    hasSweep: buckets.some((b) => /leftover|sweep|spare|remainder|buffer|overflow/i.test(String(b.name || ''))),
    goalCount, goalsHit, bestGoalFrac,
    bestStreak: w.bestStreak,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

export function evaluate(state) {
  const w = walk(state || {});
  const xp = xpFromRows(w.rows);
  const i = levelFor(xp);
  const cur = LEVELS[i];
  const next = LEVELS[i + 1] || null;
  const c = context(state || {}, w);
  const achievements = defs(state && state.cur).map((d) => {
    const progress = clamp01(d.check(c));
    const a = { id: d.id, name: d.name, desc: d.desc, icon: d.icon, unlocked: progress >= 1, progress };
    if (d.hidden) a.hidden = true;
    return a;
  });
  return {
    xp,
    level: cur.level,
    levelName: cur.name,
    nextName: next ? next.name : null,
    levelXp: cur.xp,
    nextXp: next ? next.xp : null,
    progress: next ? clamp01((xp - cur.xp) / (next.xp - cur.xp)) : 1,
    streak: w.streak,
    bestStreak: w.bestStreak,
    totals: {
      paid: round2(c.paid),
      saved: round2(c.saved),
      splits: c.splits,
      savedPct: c.paid > 0 ? c.saved / c.paid : 0,
    },
    achievements,
  };
}

export function newlyUnlocked(state) {
  const have = (state && state.unlocked) || {};
  return evaluate(state).achievements.filter((a) => a.unlocked && !have[a.id]);
}

export function rankUp(prevState, nextState) {
  const a = evaluate(prevState || {});
  const b = evaluate(nextState || {});
  if (a.level === b.level) return null;
  return { from: { level: a.level, name: a.levelName }, to: { level: b.level, name: b.levelName } };
}
