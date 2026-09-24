// Run: node dev/progress.test.mjs
import assert from 'node:assert/strict';
import { LEVELS, XP_RULES, computeXp, evaluate, newlyUnlocked, rankUp, isSavings } from '../js/progress.js';

const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 2);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok  ', name); }
  catch (e) { console.error('FAIL', name); throw e; }
}

const buckets = [
  { id: 'b1', name: 'Rent & bills', mode: 'fixed', value: 950, color: '#DC143C', goal: null },
  { id: 'b2', name: 'Savings', mode: 'pct', value: 20, color: '#FF3A5C', goal: 1000 },
  { id: 'b3', name: 'Fun money', mode: 'pct', value: 10, color: '#FF8095', goal: null },
];
const base = (over = {}) => ({
  v: 2, pay: 2400, freq: 'weekly', cur: '£', nextPayday: null, buckets,
  history: [], settings: { sound: true, haptics: true, motion: true }, unlocked: {}, ...over,
});
// pay 1000: 500 rent, 300 savings, 200 fun (perfect, 30% saved)
const split = (t, over = {}) => ({
  id: 'h' + t, t, pay: 1000, cur: '£', freq: 'weekly', status: 'pending',
  parts: [
    { id: 'b1', name: 'Rent & bills', amt: 500, color: '#000' },
    { id: 'b2', name: 'Savings', amt: 300, color: '#000' },
    { id: 'b3', name: 'Fun money', amt: 200, color: '#000' },
  ],
  ...over,
});
// newest first, n weekly splits
const weekly = (n, gapDays = 7) => Array.from({ length: n }, (_, i) => split(T0 + i * gapDays * DAY)).reverse();
const ach = (ev, id) => ev.achievements.find((a) => a.id === id);

test('levels ladder is sane', () => {
  assert.ok(LEVELS.length >= 14 && LEVELS.length <= 17);
  assert.equal(LEVELS[0].xp, 0);
  assert.equal(LEVELS[0].name, 'Skint');
  assert.equal(LEVELS.at(-1).name, 'Sterling Emperor');
  for (let i = 1; i < LEVELS.length; i++) {
    assert.ok(LEVELS[i].xp > LEVELS[i - 1].xp);
    assert.equal(LEVELS[i].level, i + 1);
  }
});

test('savings regex', () => {
  for (const n of ['Savings', 'ISA', 'Emergency fund', 'Pension', 'House deposit', 'Crypto', 'Rainy day', 'Stocks'])
    assert.ok(isSavings(n), n);
  for (const n of ['Rent & bills', 'Groceries', 'Fun money']) assert.ok(!isSavings(n), n);
});

test('empty history', () => {
  const ev = evaluate(base());
  assert.equal(ev.xp, 0);
  assert.equal(ev.level, 1);
  assert.equal(ev.levelName, 'Skint');
  assert.equal(ev.nextName, LEVELS[1].name);
  assert.equal(ev.levelXp, 0);
  assert.equal(ev.nextXp, LEVELS[1].xp);
  assert.equal(ev.progress, 0);
  assert.equal(ev.streak, 0);
  assert.deepEqual(ev.totals, { paid: 0, saved: 0, splits: 0, savedPct: 0 });
  assert.ok(ev.achievements.length >= 25 && ev.achievements.length <= 45);
  const icons = new Set(['blade', 'coin', 'crown', 'flame', 'vault', 'target', 'bolt', 'skull', 'star', 'shield']);
  const ids = new Set();
  for (const a of ev.achievements) {
    assert.ok(icons.has(a.icon), a.id);
    assert.ok(!ids.has(a.id), 'dup ' + a.id); ids.add(a.id);
    assert.ok(a.progress >= 0 && a.progress <= 1);
    assert.ok(!/—/.test(a.name + a.desc), 'em dash in ' + a.id);
  }
  // only 'big_dreams' (goal set on Savings) should be unlocked without any splits
  assert.deepEqual(ev.achievements.filter((a) => a.unlocked).map((a) => a.id), ['big_dreams']);
  // totally empty object does not throw
  assert.equal(evaluate({}).xp, 0);
});

test('one split', () => {
  const s = base({ history: [split(T0)] });
  const ev = evaluate(s);
  // base 100 + 30% saved (60) + perfect (50), no streak
  assert.equal(computeXp(s), XP_RULES.base + 60 + XP_RULES.perfect);
  assert.equal(ev.xp, 210);
  assert.equal(ev.level, 2);
  assert.equal(ev.levelName, 'Coin Goblin');
  assert.equal(ev.progress, (210 - 100) / (300 - 100));
  assert.deepEqual(ev.totals, { paid: 1000, saved: 300, splits: 1, savedPct: 0.3 });
  for (const id of ['first_blood', 'no_penny', 'tight_arse', 'paid_1k', 'saved_100'])
    assert.ok(ach(ev, id).unlocked, id);
  assert.ok(!ach(ev, 'squirrel').unlocked);
  assert.equal(ach(ev, 'squirrel').progress, 0.6);
  assert.equal(ach(ev, 'goal_hit').progress, 0.3);
});

test('imperfect split gets no perfect bonus', () => {
  const s = base({ history: [split(T0, { pay: 1000.02 })] });
  assert.ok(!ach(evaluate(s), 'no_penny').unlocked);
  const s2 = base({ history: [split(T0, { pay: 1000.01 })] });
  assert.ok(ach(evaluate(s2), 'no_penny').unlocked);
});

test('streaks: on-time, late, redo', () => {
  assert.equal(evaluate(base({ history: weekly(4) })).streak, 3);
  // 10 days apart is within 1.5x of 7
  assert.equal(evaluate(base({ history: weekly(4, 10) })).streak, 3);
  // 11 days breaks it
  assert.equal(evaluate(base({ history: weekly(4, 11) })).streak, 0);
  // late gap in the middle: newest run counts only
  const h = [split(T0 + 40 * DAY), split(T0 + 33 * DAY), split(T0 + 26 * DAY), split(T0 + 7 * DAY), split(T0)];
  const ev = evaluate(base({ history: h }));
  assert.equal(ev.streak, 2);
  assert.equal(ev.bestStreak, 2);
  // a redo on the same day neither breaks nor extends
  const r = [split(T0 + 14 * DAY + 3600000), split(T0 + 14 * DAY), split(T0 + 7 * DAY), split(T0)];
  assert.equal(evaluate(base({ history: r })).streak, 2);
  // monthly frequency uses its own period
  const m = [0, 31, 59, 90].map((d) => split(T0 + d * DAY, { freq: 'monthly' })).reverse();
  assert.equal(evaluate(base({ freq: 'monthly', history: m })).streak, 3);
});

test('streak achievements use best streak', () => {
  const ev = evaluate(base({ history: weekly(13) }));
  assert.equal(ev.streak, 12);
  for (const id of ['streak_3', 'streak_6', 'streak_12', 'splits_10']) assert.ok(ach(ev, id).unlocked, id);
  // then a late payday: current streak drops but achievements stay
  const late = [split(T0 + 200 * DAY), ...weekly(13)];
  const ev2 = evaluate(base({ history: late }));
  assert.equal(ev2.streak, 0);
  assert.ok(ach(ev2, 'streak_12').unlocked);
});

test('streak XP bonus and redo XP', () => {
  const two = computeXp(base({ history: weekly(2) }));
  assert.equal(two, 210 * 2 + XP_RULES.streakStep * 1);
  const redo = computeXp(base({ history: [split(T0 + 3600000), split(T0)] }));
  assert.equal(redo, 210 + XP_RULES.resplit);
});

test('goals hit by summed bucket history', () => {
  const s = base({ history: weekly(3) }); // 900 into b2, goal 1000
  assert.ok(!ach(evaluate(s), 'goal_hit').unlocked);
  assert.equal(ach(evaluate(s), 'goal_hit').progress, 0.9);
  const s2 = base({ history: weekly(4) }); // 1200
  assert.ok(ach(evaluate(s2), 'goal_hit').unlocked);
  assert.ok(!ach(evaluate(s2), 'goal_hat_trick').unlocked);
  const three = buckets.map((b) => ({ ...b, goal: 500 }));
  assert.ok(ach(evaluate(base({ buckets: three, history: weekly(4) })), 'goal_hat_trick').unlocked);
});

test('bucket-state achievements', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: 'x' + i, name: i === 0 ? 'Leftovers' : 'Savings', mode: 'pct', value: 1, color: '#fff', goal: null }));
  const ev = evaluate(base({ buckets: many }));
  for (const id of ['hand_of_five', 'octobudget', 'hoover', 'name_shame']) assert.ok(ach(ev, id).unlocked, id);
  assert.ok(!ach(evaluate(base()), 'name_shame').unlocked);
});

test('oddballs and currency in copy', () => {
  const s = base({ cur: '$', history: [split(T0, { pay: 420, parts: [{ id: 'b3', name: 'Fun money', amt: 420 }] })] });
  const ev = evaluate(s);
  assert.ok(ach(ev, 'nice').unlocked);
  assert.ok(ach(ev, 'yolo').unlocked);
  assert.ok(ach(ev, 'paid_1k').desc.includes('$1,000'));
  const rich = evaluate(base({ history: [split(T0, { pay: 120000, parts: [{ id: 'b2', name: 'ISA', amt: 120000 }] })] }));
  for (const id of ['big_paycheck', 'oil_baron', 'paid_100k', 'saved_25k', 'monk']) assert.ok(ach(rich, id).unlocked, id);
  const shifty = evaluate(base({ history: [split(T0 + 7 * DAY, { freq: 'fortnightly' }), split(T0)] }));
  assert.ok(ach(shifty, 'shapeshifter').unlocked);
});

test('level-ups and max level', () => {
  const lots = evaluate(base({ history: weekly(150) }));
  assert.equal(lots.level, LEVELS.at(-1).level);
  assert.equal(lots.nextName, null);
  assert.equal(lots.nextXp, null);
  assert.equal(lots.progress, 1);
  assert.ok(ach(lots, 'splits_100').unlocked);
  // monotonic
  let prev = 0;
  for (let n = 0; n <= 40; n++) {
    const l = evaluate(base({ history: weekly(n) })).level;
    assert.ok(l >= prev); prev = l;
  }
});

test('rankUp', () => {
  assert.equal(rankUp(base(), base()), null);
  const r = rankUp(base(), base({ history: [split(T0)] }));
  assert.deepEqual(r, { from: { level: 1, name: 'Skint' }, to: { level: 2, name: 'Coin Goblin' } });
  assert.equal(rankUp(base({ history: weekly(1) }), base({ history: weekly(1) })), null);
  const r2 = rankUp(base({ history: weekly(2) }), base({ history: weekly(3) }));
  assert.ok(r2 && r2.to.level > r2.from.level);
});

test('newlyUnlocked', () => {
  // a recent split, so the week-old-pending achievement doesn't fire
  const s = base({ history: [split(Date.now() - DAY)] });
  const ids = newlyUnlocked(s).map((a) => a.id).sort();
  assert.deepEqual(ids, ['big_dreams', 'first_blood', 'no_penny', 'paid_1k', 'saved_100', 'tight_arse']);
  const recorded = Object.fromEntries(ids.map((id) => [id, 123]));
  assert.deepEqual(newlyUnlocked({ ...s, unlocked: recorded }), []);
  const s2 = { ...s, unlocked: recorded, history: weekly(4) };
  assert.deepEqual(newlyUnlocked(s2).map((a) => a.id).sort(), ['goal_hit', 'loose_ends', 'saved_1k', 'streak_3']);
  assert.deepEqual(newlyUnlocked(base({ unlocked: undefined })).map((a) => a.id), ['big_dreams']);
});

console.log(`\n${passed} tests passed`);

test('banking bonus and transfer achievements', () => {
  const pend = base({ history: [split(T0)] });
  const banked = base({ history: [split(T0, { status: 'banked', bankedAt: T0 + 30 * 60 * 1000 })] });
  const slow = base({ history: [split(T0, { status: 'banked', bankedAt: T0 + 3 * DAY })] });
  assert.equal(computeXp(banked) - computeXp(pend), XP_RULES.banked + XP_RULES.fastBank);
  assert.equal(computeXp(slow) - computeXp(pend), XP_RULES.banked);
  const ev = evaluate(banked);
  assert.ok(ach(ev, 'paper_trail').unlocked);
  assert.ok(ach(ev, 'same_day').unlocked);
  assert.ok(!ach(evaluate(slow), 'same_day').unlocked);
  assert.ok(!ach(evaluate(pend), 'paper_trail').unlocked);
  // legacy entries with no status count as banked for XP
  const legacy = base({ history: [split(T0, { status: undefined })] });
  assert.equal(computeXp(legacy) - computeXp(pend), XP_RULES.banked);
  assert.ok(ach(evaluate(base({ buckets: [{ ...buckets[0], auto: true }] })), 'autopilot').unlocked);
});
