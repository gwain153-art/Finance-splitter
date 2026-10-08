// Clean Cut: money maths that isn't splitting. Pure functions, no DOM.
// UK 2026/27 rules, simplified: tax code 1257L, standard NI, relief-at-source pension.

export const PERIODS = { weekly: 52, fortnightly: 26, monthly: 12 };
const PA = 12570, BASIC_TOP = 50270, PEN_LOW = 6240;
const r2 = n => Math.round(n * 100) / 100;

// Gross pay for one pay period -> take-home for that period.
export function takeHome(grossPeriod, freq = 'monthly', { pension = false } = {}) {
  const per = PERIODS[freq] || 12;
  const g = Math.max(0, +grossPeriod || 0) * per;
  const tax = 0.2 * Math.max(0, Math.min(g, BASIC_TOP) - PA) + 0.4 * Math.max(0, Math.min(g, 125140) - BASIC_TOP);
  const ni = 0.08 * Math.max(0, Math.min(g, BASIC_TOP) - PA) + 0.02 * Math.max(0, g - BASIC_TOP);
  const pen = pension ? 0.04 * Math.max(0, Math.min(g, BASIC_TOP) - PEN_LOW) : 0; // 5% less 1% tax relief
  return { gross: r2(g / per), tax: r2(tax / per), ni: r2(ni / per), pension: r2(pen / per), net: r2((g - tax - ni - pen) / per) };
}
export function grossFromHours(hours, rate, otHours = 0, otMult = 1.5) {
  return r2(Math.max(0, +hours || 0) * rate + Math.max(0, +otHours || 0) * rate * otMult);
}
// Usual contracted hours in one pay period, from 42.5 a week.
export const usualHours = (freq, weekly = 42.5) => r2(weekly * 52 / (PERIODS[freq] || 12));

/* ---------- goal pace ---------- */
const DAY = 864e5;
const parseISO = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export function monthsUntil(iso, now = Date.now()) { return (parseISO(iso) - now) / (30.44 * DAY); }
// perMonth: what the bucket gets each month on the current split.
export function pace({ goal, have, goalDate, perMonth }) {
  if (!goal || !goalDate) return null;
  const gap = goal - have;
  if (gap <= 0) return { done: true };
  const m = monthsUntil(goalDate);
  if (m <= 0) return { late: true, gap: r2(gap) };
  const need = gap / Math.max(m, 0.25);
  const finish = perMonth > 0 ? new Date(Date.now() + (gap / perMonth) * 30.44 * DAY) : null;
  return { need: r2(need), have: r2(perMonth), ok: perMonth >= need - 0.5, short: r2(Math.max(0, need - perMonth)), finish, gap: r2(gap) };
}

/* ---------- projection ---------- */
// Month-by-month cash projection of saving buckets, with a one-off lump on a date.
export function project({ start, perMonth, months = 18, lump = 0, lumpDate = null }) {
  const pts = []; let v = start; const now = new Date();
  const lumpAt = lumpDate ? Math.ceil(monthsUntil(lumpDate)) : -1;
  for (let i = 0; i <= months; i++) {
    if (i > 0) v += perMonth;
    if (i === lumpAt) v += lump;
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    pts.push({ i, d, v: r2(v) });
  }
  return pts;
}
export function valueOn(start, perMonth, iso, lump = 0, lumpDate = null) {
  const m = Math.max(0, monthsUntil(iso));
  const withLump = lumpDate && monthsUntil(lumpDate) <= m ? lump : 0;
  return r2(start + perMonth * m + withLump);
}
// LISA at 25 if the plan is followed: ~£10k in by April 2027, then £4k a year + 25% bonus, 5% a year real growth.
export function lisaAt25({ startApr2027 = 10000, yearly = 5000, growth = 0.05, years = 7 } = {}) {
  let v = startApr2027;
  for (let y = 0; y < years; y++) v = v * (1 + growth) + yearly;
  return Math.round(v / 100) * 100;
}

/* ---------- calendar file ---------- */
const pad = n => String(n).padStart(2, '0');
const icsDate = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const icsEsc = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
export function buildICS({ payday, freq, bills = [], dates = [], fmt = v => '£' + v }) {
  const now = new Date(), stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = [];
  const add = ({ uid, date, title, desc = '', rrule = '' }) => ev.push([
    'BEGIN:VEVENT', `UID:${uid}@clean-cut`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(date)}`,
    `DTEND;VALUE=DATE:${icsDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1))}`,
    `SUMMARY:${icsEsc(title)}`, desc ? `DESCRIPTION:${icsEsc(desc)}` : '', rrule ? `RRULE:${rrule}` : '',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(title)}`, 'TRIGGER:-PT15H', 'END:VALARM', 'END:VEVENT'
  ].filter(Boolean).join('\r\n'));
  if (payday) {
    const rrule = freq === 'weekly' ? 'FREQ=WEEKLY' : freq === 'fortnightly' ? 'FREQ=WEEKLY;INTERVAL=2' : 'FREQ=MONTHLY';
    add({ uid: 'payday', date: payday, title: 'Payday: cut it in Clean Cut', desc: 'Open Clean Cut, put the pay in, swipe to cut, then bank it.', rrule });
  }
  for (const b of bills) {
    const d = new Date(now.getFullYear(), now.getMonth(), Math.min(b.day, 28));
    if (d < now) d.setMonth(d.getMonth() + 1);
    add({ uid: 'bill-' + b.id, date: d, title: `${b.name} ${fmt(b.amt)} goes out`, rrule: `FREQ=MONTHLY;BYMONTHDAY=${b.day > 28 ? -1 : b.day}` });
  }
  for (const x of dates) add({ uid: 'date-' + x.id, date: parseISO(x.date), title: x.title, desc: x.desc || '' });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Clean Cut//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Clean Cut', ...ev, 'END:VCALENDAR'].join('\r\n');
}

/* ---------- bills ---------- */
// Next date a bill on day-of-month `day` goes out, on or after today.
export function nextBillDate(day, now = new Date()) {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const clampDay = (y, m) => Math.min(day, new Date(y, m + 1, 0).getDate());
  let d = new Date(t.getFullYear(), t.getMonth(), clampDay(t.getFullYear(), t.getMonth()));
  if (d < t) d = new Date(t.getFullYear(), t.getMonth() + 1, clampDay(t.getFullYear(), t.getMonth() + 1));
  return { date: d, days: Math.round((d - t) / DAY) };
}
