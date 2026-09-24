// Core state: persistence, migration, money maths, formatting, payday dates.

export const KEY = 'crimson-cut-v2';
const V1_KEY = 'crimson-cut-v1';

export const CUR = { '£': 'GBP', '$': 'USD', '€': 'EUR' };
export const FREQ = { weekly: 52, fortnightly: 26, monthly: 12 };
// Bucket colours: the four Bank of England notes, then lighter tints of each.
export const SHADES = ['#D0263F', '#8E4FD0', '#DB7326', '#1F9C95', '#FF7A8C', '#B98AF5', '#FFA257', '#5FD6CE'];
const OLD_SHADES = ['#DC143C', '#FF3A5C', '#B8AEB2', '#9E0F2E', '#FF8095', '#6E6468', '#E8E0E2', '#5E0B1D'];
const reshade = c => { const i = OLD_SHADES.indexOf(String(c).toUpperCase()); return i >= 0 ? SHADES[i] : c; };

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
    settings: { sound: true, haptics: true, motion: false, note: '50' },
    unlocked: {},
    progressFrom: 0,
    resets: 1,
    history: [],
    buckets: [
      { id: uid(), name: 'Rent & bills', mode: 'fixed', value: 950, color: '#D0263F', goal: null, auto: true },
      { id: uid(), name: 'Savings', mode: 'pct', value: 20, color: '#8E4FD0', goal: 5000 },
      { id: uid(), name: 'Investing', mode: 'pct', value: 10, color: '#1F9C95', goal: null },
      { id: uid(), name: 'Groceries', mode: 'pct', value: 12, color: '#DB7326', goal: null },
      { id: uid(), name: 'Fun money', mode: 'pct', value: 10, color: '#FF7A8C', goal: null },
      { id: uid(), name: 'Emergency fund', mode: 'pct', value: 5, color: '#5FD6CE', goal: 1500 }
    ]
  };
}

function normalise(s) {
  const d = defaults();
  const out = Object.assign(d, s);
  out.v = 2;
  out.settings = Object.assign(defaults().settings, s.settings || {});
  if (typeof s.sound === 'boolean') out.settings.sound = s.sound;
  delete out.sound;
  out.unlocked = s.unlocked && typeof s.unlocked === 'object' ? s.unlocked : {};
  out.progressFrom = +s.progressFrom || 0;
  // One-off: v3 restarts everyone's rank and achievements (history is kept).
  if (!(+s.resets >= 1)) { out.unlocked = {}; out.progressFrom = Date.now(); out.resets = 1; justReset = true; }
  out.buckets = (Array.isArray(s.buckets) ? s.buckets : d.buckets).map(b => ({
    id: b.id || uid(), name: String(b.name ?? 'Bucket'), mode: b.mode === 'fixed' ? 'fixed' : 'pct',
    value: Math.max(0, +b.value || 0), color: reshade(b.color || SHADES[0]), goal: b.goal > 0 ? +b.goal : null, auto: !!b.auto
  }));
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
  return round2(Math.max(0, b.mode === 'pct' ? pay * b.value / 100 : b.value));
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

export function bucketTotal(id) {
  let t = 0;
  for (const h of state.history) if (h.cur === state.cur) for (const p of h.parts) if (p.id === id) t += p.amt;
  return round2(t);
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
