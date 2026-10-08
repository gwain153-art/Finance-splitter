// Core state: persistence, migration, money maths, formatting, payday dates.

export const KEY = 'crimson-cut-v2';
const V1_KEY = 'crimson-cut-v1';

export const CUR = { '£': 'GBP', '$': 'USD', '€': 'EUR' };
export const FREQ = { weekly: 52, fortnightly: 26, monthly: 12 };
// Bucket colours: £50 reds, £20 purples, and silver. Nothing else.
export const SHADES = ['#D0263F', '#8E4FD0', '#FF6B7E', '#B98AF5', '#8A1227', '#5E2E96', '#B9B4C2', '#6E6878'];
// Older palettes (crimson v1/v2, four-note v3) map onto the new one.
const REMAP = {
  '#DC143C': '#D0263F', '#FF3A5C': '#FF6B7E', '#B8AEB2': '#B9B4C2', '#9E0F2E': '#8A1227', '#FF8095': '#FF6B7E', '#6E6468': '#6E6878', '#E8E0E2': '#B9B4C2', '#5E0B1D': '#5E2E96',
  '#DB7326': '#FF6B7E', '#1F9C95': '#B98AF5', '#FF7A8C': '#FF6B7E', '#FFA257': '#B9B4C2', '#5FD6CE': '#5E2E96'
};
const reshade = c => REMAP[String(c).toUpperCase()] || c;

export const uid = () => Math.random().toString(36).slice(2, 9);
export const round2 = n => Math.round(n * 100) / 100;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function defaults() {
  return {
    v: 2,
    pay: 2400,
    freq: 'monthly',
    cur: '£',
    nextPayday: null,
    touched: false,
    settings: { sound: true, haptics: true, motion: false, note: '50', whole: false, calm: false },
    payCalc: { useHours: false, rate: 8, otMult: 1.5, hours: 184.2, otHours: 0 },
    moves: [],
    bills: [],
    lastBackup: 0,
    backupNag: 0,
    unlocked: {},
    progressFrom: 0,
    plan: { checks: {}, penOn: false, gross: 17680 },
    scoreLog: [],
    resets: 1,
    history: [],
    buckets: [
      { id: uid(), name: 'Rent & bills', mode: 'fixed', value: 950, color: '#D0263F', goal: null, auto: true },
      { id: uid(), name: 'Savings', mode: 'pct', value: 20, color: '#8E4FD0', goal: 5000 },
      { id: uid(), name: 'Investing', mode: 'pct', value: 10, color: '#B98AF5', goal: null },
      { id: uid(), name: 'Groceries', mode: 'pct', value: 12, color: '#FF6B7E', goal: null },
      { id: uid(), name: 'Fun money', mode: 'pct', value: 10, color: '#B9B4C2', goal: null },
      { id: uid(), name: 'Emergency fund', mode: 'pct', value: 5, color: '#5E2E96', goal: 1500 }
    ]
  };
}

function normalise(s) {
  const d = defaults();
  const out = Object.assign(d, s);
  out.v = 2;
  out.settings = Object.assign(defaults().settings, s.settings || {});
  if (out.settings.note !== '20') out.settings.note = '50';
  out.settings.whole = !!out.settings.whole; out.settings.calm = !!out.settings.calm;
  if (typeof s.sound === 'boolean') out.settings.sound = s.sound;
  delete out.sound;
  out.unlocked = s.unlocked && typeof s.unlocked === 'object' ? s.unlocked : {};
  out.progressFrom = +s.progressFrom || 0;
  const pl = s.plan && typeof s.plan === 'object' ? s.plan : {};
  out.plan = { checks: pl.checks && typeof pl.checks === 'object' ? pl.checks : {}, penOn: !!pl.penOn, gross: +pl.gross > 0 ? +pl.gross : 17680 };
  out.scoreLog = (Array.isArray(s.scoreLog) ? s.scoreLog : []).filter(e => e && +e.t > 0 && Number.isFinite(+e.s)).map(e => ({ t: +e.t, s: +e.s })).slice(-90);
  // One-off: v3 restarts everyone's rank and achievements (history is kept).
  if (!(+s.resets >= 1)) { out.unlocked = {}; out.progressFrom = Date.now(); out.resets = 1; justReset = true; }
  out.buckets = (Array.isArray(s.buckets) ? s.buckets : d.buckets).map(b => ({
    id: b.id || uid(), name: String(b.name ?? 'Bucket'), mode: b.mode === 'fixed' ? 'fixed' : 'pct',
    value: Math.max(0, +b.value || 0), color: reshade(b.color || SHADES[0]), goal: b.goal > 0 ? +b.goal : null, auto: !!b.auto,
    goalDate: /^\d{4}-\d{2}-\d{2}$/.test(b.goalDate || '') ? b.goalDate : null,
    kind: ['lisa', 'spend'].includes(b.kind) ? b.kind : '', icon: typeof b.icon === 'string' ? b.icon : ''
  }));
  const pc = s.payCalc && typeof s.payCalc === 'object' ? s.payCalc : {};
  out.payCalc = { useHours: !!pc.useHours, rate: +pc.rate > 0 ? +pc.rate : 8, otMult: +pc.otMult > 0 ? +pc.otMult : 1.5, hours: +pc.hours >= 0 ? +pc.hours : 184.2, otHours: +pc.otHours >= 0 ? +pc.otHours : 0 };
  out.moves = (Array.isArray(s.moves) ? s.moves : []).filter(m => m && m.b && Number.isFinite(+m.amt) && +m.amt !== 0)
    .map(m => ({ id: m.id || uid(), t: +m.t || Date.now(), b: String(m.b), amt: round2(+m.amt), note: String(m.note || '').slice(0, 60), cur: m.cur || out.cur || '£' })).slice(-2000);
  out.bills = (Array.isArray(s.bills) ? s.bills : []).filter(x => x && x.name).map(x => ({
    id: x.id || uid(), name: String(x.name).slice(0, 40), amt: Math.max(0, round2(+x.amt || 0)), day: clamp(Math.round(+x.day || 1), 1, 31), bucket: x.bucket || null
  }));
  out.lastBackup = +s.lastBackup || 0; out.backupNag = +s.backupNag || 0;
  // v1 history parts had no bucket id; match on name so goals still count.
  const byName = new Map(out.buckets.map(b => [b.name.trim().toLowerCase(), b.id]));
  // Splits made before the Transfer Run existed count as already banked.
  out.history = (Array.isArray(s.history) ? s.history : []).map(h => {
    const legacy = !h.status;
    const parts = (h.parts || []).map(p => ({
      id: p.id || byName.get(String(p.name).trim().toLowerCase()) || null, name: p.name, amt: +p.amt || 0, color: reshade(p.color),
      auto: !!p.auto, done: legacy ? true : !!(p.done || p.auto)
    }));
    return {
      id: h.id || uid(), t: +h.t || Date.now(), pay: +h.pay || 0, cur: h.cur || out.cur, freq: h.freq || out.freq, n: +h.n || 0,
      parts, status: legacy ? 'banked' : (parts.every(p => p.done) ? 'banked' : 'pending'), bankedAt: h.bankedAt || null
    };
  });
  // Serial numbers are fixed at cut time so deleting a split doesn't renumber the rest.
  const n0 = out.history.length;
  out.history.forEach((h, i) => { if (!h.n) h.n = n0 - i; });
  if (!FREQ[out.freq]) out.freq = 'monthly';
  if (!CUR[out.cur]) out.cur = '£';
  return out;
}

export let justReset = false;

export function load() {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem(V1_KEY);
    if (raw) { const s = JSON.parse(raw); if (s && Array.isArray(s.buckets)) return normalise(s); }
  } catch (e) {}
  return defaults();
}

export const state = load();
if (justReset) try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}

let saveT;
export function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }, 150);
}

export function replaceState(next) {
  const n = normalise(next);
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, n);
  save();
}

export function resetState() { replaceState(defaults()); }

export function exportJSON() { return JSON.stringify(state, null, 2); }

export function resetProgress() { state.unlocked = {}; state.progressFrom = Date.now(); save(); }

/* ---------- money ---------- */
export function amountOf(b, pay) {
  const a = Math.max(0, b.mode === 'pct' ? pay * b.value / 100 : b.value);
  // Whole pounds: easier to type into a bank app. The pennies stay in "left to assign".
  return state && state.settings && state.settings.whole ? Math.floor(a + 1e-9) : round2(a);
}
export function compute() {
  const pay = Math.max(0, +state.pay || 0);
  const rows = state.buckets.map(b => ({ b, amt: amountOf(b, pay) }));
  const alloc = round2(rows.reduce((s, r) => s + r.amt, 0));
  const rem = round2(pay - alloc);
  return { pay, rows, alloc, rem, over: rem < -0.004, done: pay > 0 && Math.abs(rem) < 0.005 };
}
/* ---------- transfer runs ---------- */
export const pending = () => state.history.filter(h => h.status === 'pending');
export function pendingLeft(h) { return h.parts.filter(p => !p.done).reduce((s, p) => s + p.amt, 0); }
export function setPartDone(h, i, done) {
  const p = h.parts[i]; if (!p || p.auto) return;
  p.done = !!done;
  const all = h.parts.every(x => x.done);
  if (all && h.status !== 'banked') { h.status = 'banked'; h.bankedAt = Date.now(); }
  else if (!all) { h.status = 'pending'; h.bankedAt = null; }
  save();
}
export const nextSerialN = () => state.history.reduce((m, h) => Math.max(m, h.n || 0), 0) + 1;

// Everything ever cut into a bucket (ignores money taken out).
export function cutTotal(id) {
  let t = 0;
  for (const h of state.history) if (h.cur === state.cur) for (const p of h.parts) if (p.id === id) t += p.amt;
  return round2(t);
}
// What's actually in the bucket now: cut in, plus manual put-ins, minus take-outs.
export function bucketTotal(id) {
  let t = cutTotal(id);
  for (const m of state.moves || []) if (m.b === id && (m.cur || state.cur) === state.cur) t += m.amt;
  return round2(t);
}
export function addMove(b, amt, note = '') {
  const m = { id: uid(), t: Date.now(), b, amt: round2(amt), note: String(note).slice(0, 60), cur: state.cur };
  state.moves.push(m); save(); return m;
}
export function removeMove(id) { state.moves = state.moves.filter(m => m.id !== id); save(); }
export const movesFor = id => (state.moves || []).filter(m => m.b === id && (m.cur || state.cur) === state.cur).sort((a, b) => b.t - a.t);
// LISA: 25% bonus on what goes in, up to £4,000 a tax year (6 April to 5 April).
export function lisaBonus(id) {
  const byYear = new Map();
  const ty = t => { const d = new Date(t); const y = d.getFullYear(); return (d.getMonth() > 3 || (d.getMonth() === 3 && d.getDate() >= 6)) ? y : y - 1; };
  const add = (t, a) => { if (a > 0) byYear.set(ty(t), (byYear.get(ty(t)) || 0) + a); };
  for (const h of state.history) if (h.cur === state.cur) for (const p of h.parts) if (p.id === id) add(h.t, p.amt);
  for (const m of state.moves || []) if (m.b === id && m.amt > 0) add(m.t, m.amt);
  let bonus = 0; byYear.forEach(v => { bonus += Math.min(v, 4000) * 0.25; });
  return round2(bonus);
}

/* ---------- formatting ---------- */
let nf, nf0;
export function mkFormat() {
  nf = new Intl.NumberFormat('en-GB', { style: 'currency', currency: CUR[state.cur], minimumFractionDigits: 2, maximumFractionDigits: 2 });
  nf0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: CUR[state.cur], maximumFractionDigits: 0 });
}
mkFormat();
export const fmt = n => nf.format(n);
export const fmt0 = n => nf0.format(n);
export const fmtShort = n => {
  const a = Math.abs(n);
  if (a >= 1e6) return state.cur + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'm';
  if (a >= 1e4) return state.cur + (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'k';
  return fmt0(n);
};
export const parseNum = s => { const v = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isFinite(v) ? v : 0; };
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- payday ---------- */
const DAY = 864e5;
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function parseISO(s) { const [y, m, d] = String(s).split('-').map(Number); return y ? new Date(y, m - 1, d) : null; }
export function toISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addPeriod(d, freq, n = 1) {
  const x = new Date(d);
  if (freq === 'monthly') {
    const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n);
    x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
  } else x.setDate(x.getDate() + n * (freq === 'weekly' ? 7 : 14));
  return x;
}
// Next payday on or after today, rolling the stored anchor forward by the pay frequency.
export function nextPayday() {
  const anchor = parseISO(state.nextPayday); if (!anchor) return null;
  const today = startOfDay(new Date());
  let d = anchor, guard = 0;
  while (d < today && guard++ < 1000) d = addPeriod(d, state.freq);
  return { date: d, days: Math.round((d - today) / DAY) };
}
