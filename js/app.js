import {
  state, save, compute, fmt, fmt0, fmtShort, mkFormat, parseNum, esc, uid, round2, clamp,
  SHADES, FREQ, bucketTotal, nextPayday, exportJSON, replaceState, resetState,
  pending, pendingLeft, setPartDone, nextSerialN, resetProgress, justReset,
  amountOf, cutTotal, addMove, removeMove, movesFor, lisaBonus, toISO,
  nextOnDay, payFromHours, resetPeriodHours, refreshPay
} from './state.js';
import * as Money from './money.js';

/* ---------- optional modules: the app still runs if one of them fails ---------- */
const noop = () => {};
const soft = async (path, pick, fallback) => { try { const m = await import(path); return pick(m) || fallback; } catch (e) { console.warn('module failed', path, e); return fallback; } };
const Sound = await soft('./audio.js', m => m.Sound, { install: noop, play: noop, startCharge: noop, setCharge: noop, stopCharge: noop, enabled: true, ready: false });
const Haptics = await soft('./haptics.js', m => m.Haptics, { install: noop, tap: noop, light: noop, medium: noop, heavy: noop, success: noop, error: noop, tick: noop, pattern: noop, enabled: true });
const createBackground = await soft('./bg.js', m => m.createBackground, null);
const createFx = await soft('./fx.js', m => m.createFx, null);
const progress = await soft('./progress.js', m => m, null);
const Score = await soft('./score.js', m => m, null);
const openBankRun = await soft('./bankrun.js', m => m.openBankRun, null);
const createVaultDoor = await soft('./vaultdoor.js', m => m.createVaultDoor, null);
const coach = await soft('./coach.js', m => m, null);
const theme = await soft('./theme.js', m => m, null);
const banknote = await soft('./banknote.js', m => m, null);
const fxMod = await soft('./fx.js', m => m, null);
const pwa = await soft('./pwa.js', m => m, { registerSW: noop, isStandalone: () => false, isIOS: () => false, requestPersistentStorage: async () => false });

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const wait = ms => new Promise(r => setTimeout(r, ms));
const rectOf = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
const centre = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

/* ---------- engines ---------- */
Sound.install(); Haptics.install();
Sound.enabled = state.settings.sound; Haptics.enabled = state.settings.haptics;
const NOBG = { ok: false, setMood: noop, setCharge: noop, pulse: noop, setTilt: noop };
let bg = NOBG;
try { if (createBackground) bg = createBackground($('#bg'), { reduceMotion: reduce }) || NOBG; } catch (e) { console.warn(e); }
if (!bg.ok) $('#bg').hidden = true;
const NOFX = { sparkBurst: noop, confetti: noop, shockwave: noop, trail: noop, flash: noop, playSplit: null };
let rawFx = NOFX;
try { if (createFx) rawFx = createFx($('#fx'), { reduceMotion: reduce }) || NOFX; } catch (e) { console.warn(e); }
// Calm mode: effects only while a cut is playing.
const fx = new Proxy({}, { get(_, k) { const v = rawFx[k]; if (typeof v !== 'function' || k === 'playSplit') return v; return (...a) => (state.settings.calm && !splitting ? undefined : v.apply(rawFx, a)); } });
function setCalm(on) {
  document.body.classList.toggle('calm', on);
  if (on) { try { bg.destroy && bg.destroy(); } catch (e) {} bg = NOBG; $('#bg').hidden = true; }
  else if (!bg.ok && createBackground) {
    const c = $('#bg'), fresh = c.cloneNode(false); c.replaceWith(fresh); fresh.hidden = false;
    try { bg = createBackground(fresh, { reduceMotion: reduce }) || NOBG; } catch (e) { bg = NOBG; }
    if (!bg.ok) fresh.hidden = true; else { try { applyTheme(state.settings.note || '50'); } catch (e) {} bg.setMood(baseMood()); }
  }
}

/* ---------- toast ---------- */
let toastT;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (action ? ` <button class="ghost" style="margin-left:8px;padding:6px 10px">${esc(action.label)}</button>` : '');
  t.style.pointerEvents = action ? 'auto' : 'none';
  if (action) t.querySelector('button').onclick = () => { t.classList.remove('show'); action.fn(); };
  t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove('show'); t.style.pointerEvents = 'none'; }, action ? 4500 : 2600);
}

/* ---------- odometer ---------- */
const DIGITS = '<b>0</b><b>1</b><b>2</b><b>3</b><b>4</b><b>5</b><b>6</b><b>7</b><b>8</b><b>9</b>';
const isD = ch => ch >= '0' && ch <= '9';
function odo(el, { fast = false } = {}) {
  let chars = [];
  if (fast) el.classList.add('fast');
  function build(arr, prev) {
    el.textContent = '';
    arr.forEach((ch, i) => {
      if (isD(ch)) {
        const c = document.createElement('span'); c.className = 'c'; c.setAttribute('aria-hidden', 'true');
        const s = document.createElement('span'); s.innerHTML = DIGITS; c.appendChild(s); el.appendChild(c);
        const p = prev[i - arr.length + prev.length];
        s.style.transition = 'none'; s.style.transform = `translateY(${-(isD(p || '') ? +p : 0)}em)`;
      } else {
        const s = document.createElement('span'); s.className = 's'; s.textContent = ch; s.setAttribute('aria-hidden', 'true'); el.appendChild(s);
      }
    });
    void el.offsetWidth;
  }
  return {
    set(str) {
      str = String(str); const arr = [...str];
      if (str === chars.join('')) return;
      const same = arr.length === chars.length && arr.every((ch, i) => isD(ch) === isD(chars[i]) && (isD(ch) || ch === chars[i]));
      if (!same) build(arr, chars);
      const cols = el.children, n = arr.length;
      arr.forEach((ch, i) => {
        if (!isD(ch)) return;
        const s = cols[i].firstChild;
        s.style.transition = '';
        s.style.transitionDelay = reduce ? '0s' : ((n - i) * 22) + 'ms';
        s.style.transform = `translateY(${-ch}em)`;
      });
      chars = arr;
      el.setAttribute('aria-label', str);
    }
  };
}

/* ---------- mood ---------- */
let dragging = false, splitting = false;
function baseMood() { return compute().over ? 'over' : 'idle'; }
function syncMood() { if (!dragging && !splitting) bg.setMood(baseMood()); }

/* =========================================================
   NOTE + KEYPAD
   ========================================================= */
const payOdo = odo($('#payOdo'));
const fmtPayDigits = v => v.toLocaleString('en-GB', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
let artKey = '', noteImg = null;
function renderNoteArt(key) {
  if (!banknote || artKey === key) return;
  artKey = key;
  $('#noteArt').innerHTML = banknote.noteSVG(key, { hero: true, serial: `CC${key} ${String(nextSerialN()).padStart(6, '0')}` });
}
// "48 x £50 · 1 x £20 · +£10.00": how an amount comes out in notes.
function cashLine(amt) {
  if (!banknote) return '';
  const { n50, n20, change } = banknote.breakdown(amt), c = state.cur, bits = [];
  if (n50) bits.push(`${n50} × ${c}50`);
  if (n20) bits.push(`${n20} × ${c}20`);
  if (change > 0) bits.push(`+${fmt(change)}`);
  return bits.join(' · ') || fmt(0);
}
function renderNote() {
  $('#noteSym').textContent = state.cur;
  payOdo.set(fmtPayDigits(state.pay));
  $('#note').dataset.len = String(Math.min(10, fmtPayDigits(state.pay).length));
  const pc = state.payCalc;
  $('#noteCash').textContent = pc.useHours
    ? `${+pc.hours.toFixed(2)} hrs × ${fmt(pc.rate)}${pc.otHours ? ` + ${pc.otHours} OT` : ''} · paid the ${ordinal(pc.payDay)}`
    : state.pay > 0 ? '= ' + cashLine(state.pay) : 'Tap to put your pay in';
  $('#noteSerial').textContent = serial(nextSerialN());
  $('#exampleTag').hidden = !!state.touched;
}
const serial = n => `CC-${String(n).padStart(4, '0')}`;
function touch() { if (!state.touched) { state.touched = true; $('#exampleTag').hidden = true; } save(); }

let kp = '';
let kpMode = 'amount';
function kpPay() {
  const pc = state.payCalc, gross = Money.grossFromHours(parseNum(kp), pc.rate, parseNum($('#kpOt').value), pc.otMult);
  return Money.takeHome(gross, state.freq, { pension: !!state.plan.penOn });
}
function kpSetMode(m) {
  kpMode = m; state.payCalc.useHours = m === 'hours';
  $$('#kpMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.kpmode === m));
  const hrs = m === 'hours';
  $('#kpHours').hidden = !hrs; $('#kpUnit').hidden = !hrs; $('#kpSym').hidden = hrs;
  $('#kpEyebrow').textContent = hrs ? `Hours this ${state.freq === 'monthly' ? 'month' : state.freq === 'weekly' ? 'week' : 'fortnight'} at ${fmt(state.payCalc.rate)}/hr` : 'What landed this time';
  kp = hrs ? (state.payCalc.hours ? String(state.payCalc.hours) : '') : (state.pay ? String(state.pay) : '');
  $('#kpOt').value = hrs && state.payCalc.otHours ? String(state.payCalc.otHours) : '';
  kpQuickChips(); kpRender();
}
function kpQuickChips() {
  if (kpMode === 'hours') {
    const u = Money.usualHours(state.freq, state.payCalc.weekly);
    $('#kpQuick').innerHTML = `<button class="chip sm" data-pay="${u}">Usual: ${u} hrs</button>` + (kp ? '<button class="chip sm" data-pay="clear">Clear</button>' : '');
    return;
  }
  const seen = new Set(), quick = [];
  for (const h of state.history) { if (h.cur === state.cur && !seen.has(h.pay) && h.pay !== state.pay) { seen.add(h.pay); quick.push(h.pay); } if (quick.length >= 3) break; }
  $('#kpQuick').innerHTML = quick.map(p => `<button class="chip sm" data-pay="${p}">${esc(fmt(p))}</button>`).join('') + (kp ? `<button class="chip sm" data-pay="clear">Clear</button>` : '');
}
function kpBreak() {
  if (kpMode !== 'hours') return;
  const t = kpPay();
  $('#kpBreak').innerHTML = `<div><span>Gross</span><b>${fmt(t.gross)}</b></div><div><span>Tax</span><b>−${fmt(t.tax)}</b></div><div><span>National Insurance</span><b>−${fmt(t.ni)}</b></div>${t.pension ? `<div><span>Pension (you)</span><b>−${fmt(t.pension)}</b></div>` : ''}<div class="tot"><span>Take-home</span><b>${fmt(t.net)}</b></div><small>Estimate on a standard 1257L tax code. Your payslip wins.</small>`;
}
function kpRender(pop) {
  kpBreak();
  const v = $('#kpVal');
  let show = kp || '0';
  const [i, d] = show.split('.');
  show = (+i).toLocaleString('en-GB') + (d !== undefined ? '.' + d : '');
  v.textContent = show;
  if (pop && !reduce) { v.classList.remove('pop'); void v.offsetWidth; v.classList.add('pop'); }
}
function kpShake() { const v = $('#kpVal'); v.classList.remove('shake'); void v.offsetWidth; v.classList.add('shake'); Sound.play('error'); Haptics.error(); }
function kpPress(k, btn) {
  const [i = '', d] = kp.split('.');
  if (k === 'back') { if (!kp) return kpShake(); kp = kp.slice(0, -1); }
  else if (k === '.') { if (kp.includes('.')) return kpShake(); kp = (kp || '0') + '.'; }
  else {
    if (d !== undefined && d.length >= 2) return kpShake();
    if (d === undefined && i.replace(/^0+/, '').length >= 7) return kpShake();
    kp = (kp === '0' ? '' : kp) + k;
  }
  Sound.play('key', { i: k === 'back' ? 11 : k === '.' ? 10 : +k }); Haptics.tap();
  if (btn && !reduce) {
    const r = document.createElement('i'); r.className = 'rip'; btn.appendChild(r);
    setTimeout(() => r.remove(), 520);
  }
  kpRender(true);
}
function openKeypad() {
  $('#kpSym').textContent = state.cur;
  kpSetMode(state.payCalc.useHours ? 'hours' : 'amount');
  showSheet($('#keypad'), { onClose: commitKeypad });
}
function commitKeypad() {
  if (kpMode === 'hours') { state.payCalc.hours = round2(parseNum(kp)); state.payCalc.otHours = round2(parseNum($('#kpOt').value)); save(); }
  const v = kpMode === 'hours' ? kpPay().net : round2(parseNum(kp));
  if (v === state.pay) return;
  state.pay = v; touch();
  const n = $('#note'); n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump');
  const d = $('#donut'); d.classList.remove('spin'); void d.offsetWidth; if (!reduce) d.classList.add('spin');
  Sound.play('sweep'); Haptics.success();
  const c = centre($('#payOdo')); fx.sparkBurst(c.x, c.y, { count: 30 }); bg.pulse(c.x, c.y, .8);
  renderNote(); update();
}
$('#note').addEventListener('click', openKeypad);
$('#kpGrid').addEventListener('pointerdown', e => {
  const b = e.target.closest('button'); if (!b) return;
  e.preventDefault();
  b.classList.add('down');
  kpPress(b.dataset.k, b);
  if (b.dataset.k === 'back') {
    const t = setTimeout(() => { if (b.classList.contains('down')) { kp = ''; kpRender(true); Haptics.heavy(); Sound.play('delete'); } }, 550);
    b.addEventListener('pointerup', () => clearTimeout(t), { once: true });
  }
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('#kpGrid').addEventListener(ev, e => { const b = e.target.closest('button'); if (b) b.classList.remove('down'); }, true));
$('#kpQuick').addEventListener('click', e => {
  const b = e.target.closest('[data-pay]'); if (!b) return;
  kp = b.dataset.pay === 'clear' ? '' : String(b.dataset.pay);
  kpQuickChips();
  Sound.play('tap'); Haptics.light(); kpRender(true);
});
$('#kpDone').addEventListener('click', () => closeSheet());
$('#kpMode').addEventListener('click', e => { const b = e.target.closest('[data-kpmode]'); if (!b || b.dataset.kpmode === kpMode) return; Sound.play('toggle', { on: true }); Haptics.light(); kpSetMode(b.dataset.kpmode); save(); });
$('#kpOt').addEventListener('input', kpBreak);
addEventListener('keydown', e => {
  if (!openSheetRef || openSheetRef.el.id !== 'keypad' || e.target.id === 'kpOt') return;
  if (/^[0-9]$/.test(e.key)) kpPress(e.key);
  else if (e.key === '.' || e.key === ',') kpPress('.');
  else if (e.key === 'Backspace') kpPress('back');
  else if (e.key === 'Enter') closeSheet();
});

/* frequency */
function renderFreq() { $$('#freq .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.freq === state.freq)); }
$('#freq').addEventListener('click', e => {
  const b = e.target.closest('[data-freq]'); if (!b || b.dataset.freq === state.freq) return;
  state.freq = b.dataset.freq;
  if (state.payCalc.useHours) { state.payCalc.hours = Money.usualHours(state.freq, state.payCalc.weekly); state.payCalc.otHours = 0; refreshPay(); renderNote(); }
  Sound.play('toggle', { on: true }); Haptics.light(); touch(); renderFreq(); update(); renderHeader();
});

/* =========================================================
   DONUT
   ========================================================= */
const R = 80, CIRC = 2 * Math.PI * R;
const segs = new Map();
let segOrder = [], donutRaf = 0;
(function ticks() {
  let h = '';
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * Math.PI * 2, r1 = 98, r2 = i % 6 ? 95 : 91;
    h += `<line x1="${(100 + Math.cos(a) * r1).toFixed(2)}" y1="${(100 + Math.sin(a) * r1).toFixed(2)}" x2="${(100 + Math.cos(a) * r2).toFixed(2)}" y2="${(100 + Math.sin(a) * r2).toFixed(2)}"/>`;
  }
  $('#ticks').innerHTML = h;
})();
function setDonut(c) {
  const total = Math.max(c.pay, c.alloc) || 1;
  const wanted = c.rows.map(r => ({ id: r.b.id, v: r.amt / total, color: r.b.color }));
  wanted.push({ id: '_rem', v: Math.max(0, c.rem) / total, color: 'url(#hatch)' });
  const ids = new Set(wanted.map(w => w.id));
  wanted.forEach(w => {
    let s = segs.get(w.id);
    if (!s) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      el.setAttribute('cx', 100); el.setAttribute('cy', 100); el.setAttribute('r', R); el.setAttribute('class', 'seg');
      el.setAttribute('stroke-dasharray', `0 ${CIRC}`); el.dataset.id = w.id;
      $('#segs').appendChild(el);
      s = { el, cur: 0, target: 0, dying: false }; segs.set(w.id, s);
    }
    s.target = w.v; s.dying = false;
    s.el.setAttribute('stroke', w.color); s.el.style.color = w.color;
  });
  segs.forEach((s, id) => { if (!ids.has(id)) { s.target = 0; s.dying = true; } });
  segOrder = [...wanted.map(w => w.id), ...[...segs.keys()].filter(id => !ids.has(id))];
  if (!donutRaf) donutRaf = requestAnimationFrame(donutFrame);
}
function donutFrame() {
  let acc = 0, moving = false;
  for (const id of segOrder) {
    const s = segs.get(id); if (!s) continue;
    const d = s.target - s.cur;
    if (Math.abs(d) > .0004 && !reduce) { s.cur += d * .13; moving = true; } else s.cur = s.target;
    const len = s.cur * CIRC, gap = len > 4 ? 1.8 : 0;
    s.el.setAttribute('stroke-dasharray', `${Math.max(0, len - gap)} ${CIRC}`);
    s.el.setAttribute('stroke-dashoffset', -acc * CIRC);
    acc += s.cur;
    if (s.dying && s.cur === 0) { s.el.remove(); segs.delete(id); }
  }
  donutRaf = moving ? requestAnimationFrame(donutFrame) : 0;
}
function highlight(id, on) {
  if (!id) return;
  const s = segs.get(id); if (s) s.el.classList.toggle('hl', on);
  const card = cardOf(id); if (card) card.classList.toggle('hl', on);
}
$('#segs').addEventListener('pointerover', e => highlight(e.target.dataset?.id, true));
$('#segs').addEventListener('pointerout', e => highlight(e.target.dataset?.id, false));
$('#segs').addEventListener('click', e => {
  const id = e.target.dataset?.id; const card = id && cardOf(id); if (!card) return;
  card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  card.classList.remove('hit'); void card.offsetWidth; card.classList.add('hit'); Sound.play('tap'); Haptics.light();
});
const cOdo = odo($('#cOdo'), { fast: true });

/* =========================================================
   BUCKETS
   ========================================================= */
const list = $('#buckets');
const amtOdos = new Map();
let seen = new Set();
const cardOf = id => list.querySelector(`.bucket[data-id="${id}"]`);
const cardIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('off', !e.isIntersecting)), { rootMargin: '80px' }) : null;
const showVal = v => String(+(+v).toFixed(2));
const rangeMax = (b, pay) => b.mode === 'pct' ? 100 : Math.max(100, Math.ceil(pay), Math.ceil(b.value));
const WAVE = 'M0 6 Q12.5 0 25 6 T50 6 T75 6 T100 6 T125 6 T150 6 T175 6 T200 6 V12 H0Z';
const DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

function cardEl(b, pay) {
  const el = document.createElement('article');
  el.className = 'bucket'; el.dataset.id = b.id; el.style.setProperty('--c', b.color);
  const pct = b.mode === 'pct';
  el.innerHTML = `
    <div class="liquid" aria-hidden="true"><svg viewBox="0 0 200 12" preserveAspectRatio="none"><path d="${WAVE}"/></svg><svg viewBox="0 0 200 12" preserveAspectRatio="none"><path d="${WAVE}"/></svg></div>
    <div class="b-row1">
      <button class="swatch" aria-label="Change colour">${icon(bucketIcon(b))}</button>
      <input class="b-name" id="name-${b.id}" value="${esc(b.name)}" maxlength="28" aria-label="Bucket name" enterkeyhint="done">
      ${b.auto ? '<span class="b-auto" title="Moves automatically">AUTO</span>' : ''}
      <button class="more" aria-label="Options for ${esc(b.name)}">${DOTS}</button>
    </div>
    <div class="b-row2">
      <span class="odo b-amt"></span>
      <div class="b-ctl">
        <div class="mode" role="group" aria-label="Split by">
          <button data-mode="pct" aria-pressed="${pct}" aria-label="Percent of pay">%</button>
          <button data-mode="fixed" aria-pressed="${!pct}" aria-label="Fixed amount">${esc(state.cur)}</button>
        </div>
        <label class="b-val"><span>${pct ? '' : esc(state.cur)}</span><input class="b-num" id="num-${b.id}" type="number" inputmode="decimal" min="0" step="${pct ? .5 : 1}" value="${showVal(b.value)}" aria-label="${pct ? 'Percent' : 'Amount'}"><span>${pct ? '%' : ''}</span></label>
      </div>
    </div>
    <input class="b-range" id="rng-${b.id}" type="range" min="0" max="${rangeMax(b, pay)}" step="${pct ? .5 : 5}" value="${b.value}" aria-label="${esc(b.name)} slider">
    <div class="cash" aria-hidden="true"><span class="pile p50"></span><span class="pile p20"></span><small></small></div>
    <div class="b-foot tab"><span class="b-share"></span><span class="b-goal"></span><span class="b-year"></span></div>
    <div class="b-status tab" hidden></div>`;
  return el;
}
function renderBuckets() {
  const pay = compute().pay;
  const prev = new Map([...amtOdos].map(([id]) => [id, true]));
  list.textContent = ''; amtOdos.clear();
  let n = 0;
  state.buckets.forEach(b => {
    const el = cardEl(b, pay);
    if (!seen.has(b.id)) { el.classList.add('enter'); el.style.animationDelay = (n++ * 60) + 'ms'; }
    list.appendChild(el);
    amtOdos.set(b.id, odo(el.querySelector('.b-amt')));
  });
  seen = new Set(state.buckets.map(b => b.id));
  void prev;
  // Pause the liquid waves on cards that are off screen, so scrolling stays smooth.
  if (cardIO) list.querySelectorAll('.bucket').forEach(el => cardIO.observe(el));
  renderSweepChips();
  update();
}
// The one line under a bucket that matters: pace, daily allowance or LISA bonus.
function perMonthOf(amt) { return amt * FREQ[state.freq] / 12; }
function lastCutPart(id) { for (const h of state.history) if (h.cur === state.cur) { const p = h.parts.find(x => x.id === id); if (p) return { h, p }; } return null; }
function spendLeft(b, plannedAmt) {
  const last = lastCutPart(b.id);
  const base = last ? last.p.amt : plannedAmt, since = last ? last.h.t : 0;
  const out = movesFor(b.id).filter(m => m.t >= since).reduce((s2, m) => s2 + m.amt, 0);
  const left = round2(base + out), pd = nextPayday();
  const days = pd ? Math.max(1, pd.days) : Math.round(365 / FREQ[state.freq]);
  return { left, days, perDay: left / days, cut: !!last };
}
function statusLine(b, amt, pay) {
  const bits = [];
  if (b.kind === 'spend') {
    const s2 = spendLeft(b, amt);
    bits.push(s2.left < 0 ? `<b class="neg">${esc(fmt(-s2.left))} over</b> until payday` : `<b>${esc(fmt(s2.left))}</b> left · <b>${esc(fmt(s2.perDay))}</b>/day for ${s2.days} day${s2.days === 1 ? '' : 's'}`);
  } else {
    const bal = bucketTotal(b.id);
    if (bal !== cutTotal(b.id) || bal > 0) bits.push(`<b>${esc(fmt(bal))}</b> in it now`);
  }
  if (b.kind === 'lisa') { const bo = lisaBonus(b.id); if (bo > 0) bits.push(`<b class="plus">+${esc(fmt(bo))}</b> bonus`); }
  if (b.goal && b.goalDate) {
    const pc = Money.pace({ goal: b.goal, have: bucketTotal(b.id) + (b.kind === 'lisa' ? lisaBonus(b.id) : 0), goalDate: b.goalDate, perMonth: perMonthOf(amt) });
    if (pc) bits.push(pc.done ? '<span class="pill ok">Goal hit</span>' : pc.late ? `<span class="pill bad">Date passed, ${esc(fmt(pc.gap))} short</span>` : pc.ok ? '<span class="pill ok">On track</span>' : `<span class="pill bad">Behind: +${esc(fmt(pc.short))}/mo needed</span>`);
  }
  return bits.join(' <i class="dot">·</i> ');
}
function update() {
  const c = compute(), mult = FREQ[state.freq];
  c.rows.forEach(r => {
    const el = cardOf(r.b.id); if (!el) return;
    amtOdos.get(r.b.id)?.set(fmt(r.amt));
    const share = c.pay ? r.amt / c.pay : 0;
    el.querySelector('.b-share').textContent = `${(share * 100).toFixed(1)}% of pay`;
    el.querySelector('.b-year').textContent = `${fmtShort(r.amt * mult)}/yr`;
    const g = el.querySelector('.b-goal');
    const bonus = r.b.kind === 'lisa' ? lisaBonus(r.b.id) : 0;
    if (r.b.goal) {
      const got = bucketTotal(r.b.id) + bonus, p = clamp(got / r.b.goal, 0, 1);
      g.innerHTML = `<span class="goal-mini"><span class="bar"><i style="width:${p * 100}%"></i></span>${Math.floor(p * 100)}%</span>`;
    } else g.textContent = '';
    const st = el.querySelector('.b-status'), line = statusLine(r.b, r.amt, c.pay);
    st.hidden = !line; st.innerHTML = line;
    const rng = el.querySelector('.b-range'), max = rangeMax(r.b, c.pay);
    if (+rng.max !== max) rng.max = max;
    rng.style.setProperty('--p', clamp(r.b.value / max * 100, 0, 100) + '%');
    el.style.setProperty('--lvl', (6 + clamp(share, 0, 1) * 94) + '%');
    renderCash(el, r.amt);
    el.classList.toggle('zero', r.amt <= 0);
  });
  setDonut(c);

  document.body.classList.toggle('over', c.over);
  document.body.classList.toggle('done', c.done);
  document.body.classList.toggle('nopay', c.pay <= 0);
  if (c.pay <= 0) { $('#cLabel').textContent = 'No pay yet'; cOdo.set(fmt(0)); $('#cSub').textContent = 'Tap the note'; }
  else if (c.over) { $('#cLabel').textContent = 'Over by'; cOdo.set(fmt(-c.rem)); $('#cSub').textContent = 'Trim a bucket'; }
  else if (c.done) { $('#cLabel').textContent = 'Every penny placed'; cOdo.set(fmt(c.pay)); $('#cSub').textContent = 'Ready to cut'; }
  else { $('#cLabel').textContent = 'Left to assign'; cOdo.set(fmt(c.rem)); $('#cSub').textContent = `${(c.rem / c.pay * 100).toFixed(1)}% floating`; }

  const pct = c.pay ? c.alloc / c.pay * 100 : 0;
  $('#mPct').textContent = pct.toFixed(pct % 1 ? 1 : 0) + '%';
  $('#mAlloc').textContent = `${fmt(c.alloc)} of ${fmt(c.pay)}`;
  $('#mBar').style.width = clamp(pct, 0, 100) + '%';

  const showSweep = c.pay > 0 && c.rem >= 0.01 && state.buckets.length > 0;
  $('#sweep').hidden = !showSweep;
  if (showSweep) $('#sweepAmt').textContent = fmt(c.rem);
  renderCutbar(c);
  syncMood();
  queueCoach();
}

/* =========================================================
   COACH
   ========================================================= */
let coachT, coachSig = '';
function queueCoach() { clearTimeout(coachT); coachT = setTimeout(renderCoach, 350); }
function renderCoach() {
  if (!coach) { $('#coach').hidden = true; return; }
  let list = [];
  try { list = coach.insights(state, { compute, fmt, fmt0: fmtShort, bucketTotal }); } catch (e) { console.warn(e); }
  const sig = JSON.stringify(list);
  if (sig === coachSig) return;
  coachSig = sig;
  const track = $('#coachTrack'), keep = track.scrollLeft;
  $('#coach').hidden = !list.length;
  track.innerHTML = list.map((a, i) => `<article class="coach-card tone-${a.tone}" data-i="${i}">
      <span class="cc-ic">${icon(a.icon)}</span>
      <div class="cc-body"><b>${esc(a.title)}</b><p>${esc(a.body)}</p>${a.action ? `<button class="cc-act" data-kind="${a.action.kind}" data-id="${esc(a.action.id || '')}">${esc(a.action.label)}</button>` : ''}</div>
    </article>`).join('');
  $('#coachDots').innerHTML = list.length > 1 ? list.map((_, i) => `<i data-i="${i}"></i>`).join('') : '';
  track.scrollLeft = keep;
  coachDots();
}
function coachDots() {
  const track = $('#coachTrack'), w = track.clientWidth || 1;
  const i = Math.round(track.scrollLeft / w);
  $$('#coachDots i').forEach((d, k) => d.classList.toggle('on', k === i));
  return i;
}
let coachIdx = 0;
$('#coachTrack').addEventListener('scroll', () => { const i = coachDots(); if (i !== coachIdx) { coachIdx = i; Haptics.tick(); Sound.play('tick', { v: .3 }); } }, { passive: true });
$('#coachDots').addEventListener('click', e => { const d = e.target.closest('i'); if (!d) return; const t = $('#coachTrack'); t.scrollTo({ left: +d.dataset.i * t.clientWidth, behavior: 'smooth' }); });
$('#coachTrack').addEventListener('click', e => {
  const b = e.target.closest('.cc-act'); if (!b) return;
  const { kind, id } = b.dataset;
  if (kind === 'sweep') sweepInto(id, b);
  else if (kind === 'bucket') openBucketSheet(id);
  else if (kind === 'add') { addBucket(id); toast(`${id} added. Give it a slice.`); }
});
function renderSweepChips() {
  $('#sweepChips').innerHTML = state.buckets.map(b => `<button class="chip" data-id="${b.id}" style="--c:${b.color}"><i></i>${esc(b.name || 'Untitled')}</button>`).join('');
}

let lastStep = new Map();
list.addEventListener('input', e => {
  const card = e.target.closest('.bucket'); if (!card) return;
  const b = state.buckets.find(x => x.id === card.dataset.id); if (!b) return;
  if (e.target.classList.contains('b-name')) { b.name = e.target.value; renderSweepChips(); }
  else if (e.target.classList.contains('b-range')) {
    b.value = +e.target.value;
    card.querySelector('.b-num').value = showVal(b.value);
    Sound.play('tick', { v: e.target.value / e.target.max });
    if (lastStep.get(b.id) !== b.value) { Haptics.tick(); lastStep.set(b.id, b.value); }
  } else if (e.target.classList.contains('b-num')) {
    b.value = Math.max(0, parseNum(e.target.value));
    card.querySelector('.b-range').value = b.value;
  }
  touch(); update();
});
list.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.b-name,.b-num')) e.target.blur(); });
list.addEventListener('focusout', e => { if (e.target.classList.contains('b-name')) queueProgress(); });
list.addEventListener('click', e => {
  const card = e.target.closest('.bucket'); if (!card) return;
  const b = state.buckets.find(x => x.id === card.dataset.id); if (!b) return;
  const pay = compute().pay;
  if (e.target.closest('.swatch')) {
    b.color = SHADES[(SHADES.indexOf(b.color) + 1) % SHADES.length];
    card.style.setProperty('--c', b.color);
    const c = centre(e.target.closest('.swatch')); fx.sparkBurst(c.x, c.y, { color: b.color, count: 14, power: .6 });
    Sound.play('toggle', { on: true }); Haptics.light(); touch(); renderSweepChips(); update();
  } else if (e.target.closest('.mode button')) {
    const mode = e.target.closest('button').dataset.mode;
    if (mode === b.mode) return;
    const amt = b.mode === 'pct' ? pay * b.value / 100 : b.value;
    b.mode = mode;
    b.value = mode === 'fixed' ? Math.round(amt) : (pay ? Math.round(amt / pay * 10000) / 100 : 0);
    Sound.play('toggle', { on: mode === 'fixed' }); Haptics.light(); touch(); renderBuckets();
  } else if (e.target.closest('.more')) {
    openBucketSheet(b.id);
  }
});
if (finePointer && !reduce) {
  list.addEventListener('pointermove', e => {
    const card = e.target.closest('.bucket'); if (!card) return;
    const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--mx', x * 100 + '%'); card.style.setProperty('--my', y * 100 + '%');
    if (!e.target.matches('input')) card.style.transform = `perspective(900px) rotateX(${(.5 - y) * 4}deg) rotateY(${(x - .5) * 5}deg) translateY(-2px)`;
  });
  list.addEventListener('pointerout', e => { const c = e.target.closest('.bucket'); if (c && !c.contains(e.relatedTarget)) { c.style.transform = ''; highlight(c.dataset.id, false); } });
  list.addEventListener('pointerover', e => { const c = e.target.closest('.bucket'); if (c) highlight(c.dataset.id, true); });
}
function hitCard(id, i = 0) {
  const card = cardOf(id); if (!card) return;
  card.classList.remove('hit'); void card.offsetWidth; card.classList.add('hit');
  const a = card.querySelector('.b-amt'); if (a) { const c = centre(a); fx.sparkBurst(c.x, c.y, { color: card.style.getPropertyValue('--c') || undefined, count: 18, power: .7 }); }
}

function deleteBucket(id) {
  const idx = state.buckets.findIndex(x => x.id === id); if (idx < 0) return;
  const removed = state.buckets[idx];
  const card = cardOf(id);
  Sound.play('delete'); Haptics.medium();
  if (card) { card.classList.add('leaving'); const c = centre(card); fx.sparkBurst(c.x, c.y, { color: removed.color, count: 26 }); }
  setTimeout(() => {
    state.buckets = state.buckets.filter(x => x.id !== id); touch(); renderBuckets();
    toast(`Binned ${removed.name || 'bucket'}`, { label: 'Undo', fn: () => { state.buckets.splice(idx, 0, removed); seen.delete(removed.id); touch(); renderBuckets(); Sound.play('pop'); } });
  }, reduce ? 0 : 320);
}

$('#addBtn').addEventListener('click', () => addBucket());
function addBucket(name = 'New bucket') {
  const used = new Set(state.buckets.map(b => b.color));
  const color = SHADES.find(s => !used.has(s)) || SHADES[state.buckets.length % SHADES.length];
  const b = { id: uid(), name, mode: 'pct', value: 0, color, goal: null };
  state.buckets.push(b); touch(); renderBuckets();
  Sound.play('pop'); Haptics.medium();
  const card = cardOf(b.id);
  if (card) {
    card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => { const c = centre(card); fx.sparkBurst(c.x, c.y, { color, count: 30 }); }, 250);
    if (name === 'New bucket') { const inp = card.querySelector('.b-name'); inp.focus(); inp.select(); }
  }
  queueProgress();
}

// George's plan: £1,350 a month, emergency fund first, LISA money for 6 April.
const MY_PLAN = [
  { name: 'Emergency fund', value: 250, goal: 1500, icon: 'shield' },
  { name: 'Second LISA year', value: 510, goal: 3000, goalDate: '2027-04-06', icon: 'house' },
  { name: 'Cats (rent)', value: 150, icon: 'cat', auto: false },
  { name: 'Bike: insurance + fuel', value: 150, icon: 'bike' },
  { name: 'Driving', value: 40, icon: 'car' },
  { name: 'Irregular: tools, servicing, clothes', value: 50, icon: 'tool' },
  { name: 'Fun money', value: 200, icon: 'star', kind: 'spend' }
];
const PRESETS = {
  503020: [['Needs', 50], ['Wants', 30], ['Savings', 20]],
  saver: [['Bills', 45], ['Savings', 30], ['Investing', 15], ['Fun money', 10]],
  even: [['Bills', 25], ['Savings', 25], ['Food', 25], ['Fun', 25]]
};
$('#presets').addEventListener('click', e => {
  const p = e.target.closest('[data-preset]'); if (!p) return;
  const before = state.buckets;
  if (p.dataset.preset === 'mine') {
    // Keep ids for buckets with the same name so their history and balances carry over.
    const byName = new Map(state.buckets.map(b => [b.name.trim().toLowerCase(), b]));
    state.buckets = MY_PLAN.map((x, i) => {
      const old = byName.get(x.name.toLowerCase());
      return { id: old ? old.id : uid(), name: x.name, mode: 'fixed', value: x.value, color: SHADES[i % SHADES.length], goal: x.goal || null, goalDate: x.goalDate || null, auto: !!(old && old.auto), kind: x.kind || '', icon: x.icon };
    });
    if (!state.touched) { state.pay = 1350; state.freq = 'monthly'; renderNote(); renderFreq(); }
  } else state.buckets = PRESETS[p.dataset.preset].map(([name, value], i) => ({ id: uid(), name, mode: 'pct', value, color: SHADES[i], goal: null }));
  touch(); renderBuckets(); Sound.play('whoosh'); Haptics.medium();
  const c = centre(list); bg.pulse(c.x, c.y, .7);
  toast(`Loaded ${p.textContent.trim()}`, { label: 'Undo', fn: () => { state.buckets = before; seen.clear(); touch(); renderBuckets(); } });
  queueProgress();
});

$('#sweepChips').addEventListener('click', e => {
  const chip = e.target.closest('[data-id]'); if (chip) sweepInto(chip.dataset.id, chip);
});
function sweepInto(id, chip) {
  const c = compute(), b = state.buckets.find(x => x.id === id);
  if (!b || c.rem <= 0) return;
  if (b.mode === 'pct') b.value = Math.round((b.value + c.rem / c.pay * 100) * 10000) / 10000;
  else b.value = round2(b.value + c.rem);
  const card = cardOf(b.id);
  if (card) { card.querySelector('.b-num').value = showVal(b.value); card.querySelector('.b-range').value = b.value; }
  const from = centre(chip);
  fx.sparkBurst(from.x, from.y, { color: b.color, count: 20 });
  setTimeout(() => hitCard(b.id), 120);
  Sound.play('sweep'); Haptics.success(); touch(); update();
  toast(`Swept ${fmt(c.rem)} into ${b.name || 'that bucket'}`);
}

/* bucket sheet */
let bsId = null;
function openBucketSheet(id) {
  const b = state.buckets.find(x => x.id === id); if (!b) return;
  bsId = id;
  const sheet = $('#bucketSheet'); sheet.style.setProperty('--c', b.color);
  $('#bsSw').innerHTML = icon(bucketIcon(b));
  $('#bsName').value = b.name; $('#bsCur').textContent = state.cur;
  $('#bsGoal').value = b.goal ? String(b.goal) : '';
  $('#bsGoalDate').value = b.goalDate || '';
  $('#bsAuto').checked = !!b.auto;
  $('#bsMoveAmt').value = ''; $('#bsMoveNote').value = ''; $('#bsMoveCur').textContent = state.cur;
  renderBsKind(b); renderBsIcons(b); renderBsMoney(b);
  $('#bsColors').innerHTML = SHADES.map(s => `<button style="--c:${s}" data-c="${s}" aria-label="Colour ${s}" aria-pressed="${s === b.color}"></button>`).join('');
  renderBsProgress(b);
  const del = $('#bsDelete'); del.classList.remove('armed'); del.textContent = 'Delete bucket';
  showSheet(sheet, { onClose: () => { bsId = null; renderBuckets(); queueProgress(); } });
}
function renderBsProgress(b) {
  const got = bucketTotal(b.id) + (b.kind === 'lisa' ? lisaBonus(b.id) : 0);
  let txt = b.goal ? `<b>${fmt(got)}</b> of ${fmt(b.goal)} (${Math.floor(clamp(got / b.goal, 0, 1) * 100)}%).` : got ? `<b>${fmt(got)}</b> in here.` : 'Set a target and this bucket fills up as you split.';
  if (b.goal && b.goalDate) {
    const pc = Money.pace({ goal: b.goal, have: got, goalDate: b.goalDate, perMonth: perMonthOf(amountOf(b, compute().pay)) });
    if (pc && pc.done) txt += ' Goal hit.';
    else if (pc && pc.late) txt += ` The date's passed and you're ${fmt(pc.gap)} short.`;
    else if (pc) txt += pc.ok ? ` On track: you need ${fmt(pc.need)} a month and you're putting in ${fmt(pc.have)}.${pc.finish ? ' Done around ' + dayFmt.format(pc.finish) + '.' : ''}` : ` Behind: you need ${fmt(pc.need)} a month but only put in ${fmt(pc.have)}. Add ${fmt(pc.short)} a month.`;
  } else if (b.goal) txt += ' Add a date to see if you\'re on track.';
  $('#bsProgress').innerHTML = txt;
}
const KIND_HINT = { '': 'A normal pot. Its balance is everything cut in, minus what you take out.', spend: 'Shows what\'s left and how much a day you can spend until payday. Log spends with Take out.', lisa: 'Adds the government\'s 25% bonus on what goes in, up to £4,000 a tax year.' };
function renderBsKind(b) { $$('#bsKind button').forEach(x => x.setAttribute('aria-pressed', x.dataset.kind === (b.kind || ''))); $('#bsKindHint').textContent = KIND_HINT[b.kind || '']; }
function renderBsIcons(b) {
  const cur = bucketIcon(b);
  $('#bsIcons').innerHTML = Object.keys(BICONS).map(k => `<button data-icon="${k}" aria-label="${k}" aria-pressed="${k === cur}">${icon(k)}</button>`).join('');
}
const moveDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const bsBalOdo = odo($('#bsBal'), { fast: true });
function renderBsMoney(b) {
  const bal = bucketTotal(b.id), bo = b.kind === 'lisa' ? lisaBonus(b.id) : 0;
  const spend = b.kind === 'spend' ? spendLeft(b, amountOf(b, compute().pay)) : null;
  $('#bsMoney .eyebrow').textContent = spend ? 'Left until payday' : b.kind === 'lisa' ? 'In the LISA with bonus' : 'In this bucket now';
  bsBalOdo.set(fmt(spend ? spend.left : bal + bo));
  const cutIn = cutTotal(b.id), moved = round2(bal - cutIn);
  $('#bsBalSub').textContent = spend
    ? `${fmt(spend.perDay)} a day for ${spend.days} day${spend.days === 1 ? '' : 's'} · ${fmt(bal)} in total`
    : [`${fmt(cutIn)} cut in`, moved ? `${moved > 0 ? '+' : '−'}${fmt(Math.abs(moved))} moved` : '', bo ? `+${fmt(bo)} bonus` : ''].filter(Boolean).join(' · ');
  const ms = movesFor(b.id).slice(0, 8);
  $('#bsMoves').innerHTML = ms.map(m => `<li><span class="when">${esc(moveDate.format(m.t))}</span><span class="what">${esc(m.note || (m.amt < 0 ? 'Taken out' : 'Put in'))}</span><b class="${m.amt < 0 ? 'neg' : 'plus'}">${m.amt < 0 ? '−' : '+'}${esc(fmt(Math.abs(m.amt)))}</b><button class="x" data-move="${m.id}" aria-label="Undo this">×</button></li>`).join('');
}
function bsMove(sign) {
  const b = bsB(); if (!b) return;
  const v = round2(parseNum($('#bsMoveAmt').value));
  if (!(v > 0)) { Sound.play('error'); Haptics.error(); toast('Put an amount in first'); return; }
  addMove(b.id, sign * v, $('#bsMoveNote').value.trim());
  $('#bsMoveAmt').value = ''; $('#bsMoveNote').value = '';
  Sound.play(sign < 0 ? 'coin' : 'sweep'); Haptics.success();
  renderBsMoney(b); renderBsProgress(b); touch(); update();
  const box = $('#bsMoney'), bal = $('#bsBal');
  box.classList.remove('up', 'down', 'bump'); bal.classList.remove('bump'); void box.offsetWidth;
  box.classList.add(sign < 0 ? 'down' : 'up'); bal.classList.add('bump');
  const first = $('#bsMoves li'); if (first) first.classList.add('new');
  const bc = centre($(sign < 0 ? '#bsTake' : '#bsPut')); fx.sparkBurst(bc.x, bc.y, { color: sign < 0 ? '#D0263F' : '#B98AF5', count: 22, power: .7 });
  toast(sign < 0 ? `${fmt(v)} out of ${b.name}` : `${fmt(v)} into ${b.name}`);
  queueProgress();
}
$('#bsTake').addEventListener('click', () => bsMove(-1));
$('#bsPut').addEventListener('click', () => bsMove(1));
$('#bsMoves').addEventListener('click', e => {
  const x = e.target.closest('[data-move]'); const b = bsB(); if (!x || !b) return;
  removeMove(x.dataset.move); Sound.play('delete'); Haptics.light(); renderBsMoney(b); renderBsProgress(b); update(); queueProgress();
});
$('#bsKind').addEventListener('click', e => {
  const k = e.target.closest('[data-kind]'); const b = bsB(); if (!k || !b) return;
  b.kind = k.dataset.kind; touch(); Sound.play('toggle', { on: true }); Haptics.light();
  renderBsKind(b); renderBsMoney(b); renderBsProgress(b);
});
$('#bsIcons').addEventListener('click', e => {
  const k = e.target.closest('[data-icon]'); const b = bsB(); if (!k || !b) return;
  b.icon = k.dataset.icon; touch(); Sound.play('tap'); Haptics.light(); renderBsIcons(b); $('#bsSw').innerHTML = icon(b.icon);
});
$('#bsGoalDate').addEventListener('change', e => { const b = bsB(); if (b) { b.goalDate = e.target.value || null; touch(); renderBsProgress(b); } });
const bsB = () => state.buckets.find(x => x.id === bsId);
$('#bsName').addEventListener('input', e => { const b = bsB(); if (b) { b.name = e.target.value; touch(); } });
$('#bsGoal').addEventListener('input', e => { const b = bsB(); if (b) { const v = parseNum(e.target.value); b.goal = v > 0 ? v : null; touch(); renderBsProgress(b); } });
$('#bsAuto').addEventListener('change', e => {
  const b = bsB(); if (!b) return;
  b.auto = e.target.checked; touch();
  Sound.play('toggle', { on: b.auto }); Haptics.light();
  if (b.auto) toast(`${b.name || 'This bucket'} will come pre-stamped`);
});
$('#bsColors').addEventListener('click', e => {
  const s = e.target.closest('[data-c]'); const b = bsB(); if (!s || !b) return;
  b.color = s.dataset.c; $('#bucketSheet').style.setProperty('--c', b.color);
  $$('#bsColors button').forEach(x => x.setAttribute('aria-pressed', x === s));
  Sound.play('toggle', { on: true }); Haptics.light(); touch();
});
let bsArmT;
$('#bsDelete').addEventListener('click', e => {
  const btn = e.currentTarget, id = bsId;
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed'); btn.textContent = 'Tap again to bin it'; Haptics.medium(); Sound.play('error');
    clearTimeout(bsArmT); bsArmT = setTimeout(() => { btn.classList.remove('armed'); btn.textContent = 'Delete bucket'; }, 3000);
    return;
  }
  closeSheet(true); deleteBucket(id);
});
$('#bsDone').addEventListener('click', () => closeSheet());

/* =========================================================
   SWIPE TO CUT
   ========================================================= */
const track = $('#cutTrack'), knob = $('#cutKnob');
let drag = null, knobX = 0, cutStep = 0, lockReason = '';
function maxX() { return Math.max(1, track.clientWidth - knob.offsetWidth - 8); }
function setKnob(x) {
  const m = maxX(); knobX = clamp(x, 0, m);
  const p = knobX / m;
  track.style.setProperty('--knob-x', knobX + 'px');
  track.style.setProperty('--p', p.toFixed(3));
  track.setAttribute('aria-valuenow', Math.round(p * 100));
  return p;
}
function renderCutbar(c = compute()) {
  const live = c.rows.filter(r => r.amt > 0).length;
  lockReason = c.pay <= 0 ? 'Tap the note and put your pay in first' : c.over ? `You've assigned ${fmt(-c.rem)} more than you earn. Trim a bucket.` : !live ? 'Give at least one bucket some money' : '';
  track.classList.toggle('locked', !!lockReason);
  $('#cutLbl').textContent = lockReason ? (c.over ? 'Over budget' : 'Locked') : 'Swipe to cut';
  $('#cutSub').textContent = lockReason ? (c.over ? `${fmt(-c.rem)} too much` : c.pay <= 0 ? 'Add your pay first' : 'Fill a bucket') : `${fmt(c.pay)} into ${live} bucket${live === 1 ? '' : 's'}`;
  if (!drag && !splitting) track.classList.toggle('idle', !lockReason && !reduce);
}
function refuse() {
  track.classList.remove('nope'); void track.offsetWidth; track.classList.add('nope');
  Sound.play('error'); Haptics.error(); toast(lockReason);
  if (compute().over) { const c = centre($('.donut-wrap')); bg.pulse(c.x, c.y, 1); }
}
track.addEventListener('pointerdown', e => {
  if (splitting || e.button > 0) return;
  e.preventDefault();
  if (lockReason) return refuse();
  try { track.setPointerCapture(e.pointerId); } catch (_) {}
  drag = { x0: e.clientX - knobX, id: e.pointerId };
  dragging = true; cutStep = 0;
  track.classList.remove('spring', 'idle'); track.classList.add('dragging');
  Sound.startCharge(); Haptics.light(); bg.setMood('charging');
});
track.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const p = setKnob(e.clientX - drag.x0);
  Sound.setCharge(p); bg.setCharge(p);
  const step = Math.floor(p * 14);
  if (step !== cutStep) { cutStep = step; Haptics.tick(); }
  track.classList.toggle('hot', p > .72 && !reduce);
  const k = centre(knob); fx.trail(k.x, k.y);
  if (p >= .97) commitCut();
});
function releaseCut() {
  if (!drag) return;
  drag = null; dragging = false;
  track.classList.remove('dragging', 'hot'); track.classList.add('spring');
  setKnob(0); Sound.stopCharge(false); bg.setCharge(0); syncMood();
  setTimeout(() => { track.classList.remove('spring'); renderCutbar(); }, 520);
}
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => track.addEventListener(ev, releaseCut));
function commitCut() {
  drag = null;
  track.classList.remove('dragging', 'hot', 'idle');
  setKnob(maxX());
  Sound.stopCharge(true); Haptics.heavy(); bg.setCharge(1);
  const k = centre(knob); fx.flash(.5); fx.sparkBurst(k.x, k.y, { count: 40, power: 1.2 }); fx.shockwave(k.x, k.y, { radius: 220 });
  runSplit().finally(() => {
    dragging = false; bg.setCharge(0);
    track.classList.add('spring'); setKnob(0);
    setTimeout(() => { track.classList.remove('spring'); renderCutbar(); }, 520);
  });
}
track.addEventListener('keydown', async e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  if (splitting) return;
  if (lockReason) return refuse();
  dragging = true; track.classList.remove('idle'); Sound.startCharge(); bg.setMood('charging');
  const t0 = performance.now();
  while (true) {
    await frame();
    const p = clamp((performance.now() - t0) / 650, 0, 1);
    setKnob(p * maxX()); Sound.setCharge(p); bg.setCharge(p);
    if (p >= 1) break;
  }
  commitCut();
});

// Fanned stacks of mini £50s and £20s on each bucket. Only redraws when the note count changes.
function renderCash(el, amt) {
  const box = el.querySelector('.cash'); if (!box || !banknote) return;
  const { n50, n20 } = banknote.breakdown(amt);
  const key = n50 + ':' + n20;
  if (box.dataset.k === key) return;
  const prev = (box.dataset.k || '0:0').split(':').map(Number);
  box.dataset.k = key;
  const pile = (sel, n, d, had) => {
    const shown = Math.min(n, 6), p = box.querySelector(sel);
    p.style.setProperty('--n', Math.max(1, shown));
    p.hidden = !n;
    p.innerHTML = Array.from({ length: shown }, (_, k) => `<svg class="${k >= Math.min(had, 6) ? 'drop' : ''}" style="--k:${k}"><use href="#bn-mini-${d}"/></svg>`).join('');
  };
  pile('.p50', n50, '50', prev[0]); pile('.p20', n20, '20', prev[1]);
  box.querySelector('small').innerHTML = amt > 0 ? cashLine(amt).replace(/(\d+) ×/g, '<b>$1</b> ×') : 'Empty';
}

/* =========================================================
   THE CUT (cutscene)
   ========================================================= */
const stage = $('#stage');
async function runSplit() {
  if (splitting) return;
  const c = compute();
  const live = c.rows.filter(r => r.amt > 0);
  if (!live.length || c.over || c.pay <= 0) return;
  splitting = true;
  const sBefore = Score ? scoreNow().score : null;

  // build the stage
  const tiles = $('#stageTiles');
  tiles.classList.toggle('three', live.length > 6);
  tiles.innerHTML = live.map((r, i) => `<div class="tile" style="--c:${r.b.color};animation-delay:${i * 40}ms"><span>${esc(r.b.name || 'Untitled')}</span><strong class="odo"></strong></div>`).join('');
  const tileEls = [...tiles.children];
  const tileOdos = tileEls.map(t => { const o = odo(t.querySelector('.odo')); o.set(fmt(0)); return o; });
  $('#stamp').hidden = true;
  stage.classList.remove('out'); stage.hidden = false;
  Sound.play('whoosh'); Haptics.medium();
  await frame(); await frame(); await wait(reduce ? 0 : 380);

  const noteRect = rectOf($('#stageNote'));
  const nc = { x: noteRect.x + noteRect.width / 2, y: noteRect.y + noteRect.height / 2 };
  bg.pulse(nc.x, nc.y, 1);
  const pieces = live.map((r, i) => ({ amount: r.amt, color: r.b.color, label: r.b.name, target: rectOf(tileEls[i]) }));
  const onSlash = k => {
    Sound.play('slash', { i: k }); Haptics.heavy();
    if (!reduce) { stage.classList.remove('quake'); void stage.offsetWidth; stage.classList.add('quake'); }
    bg.pulse(nc.x, nc.y, .8);
  };
  const onHit = i => {
    const t = tileEls[i]; if (!t) return;
    t.classList.add('hit'); tileOdos[i].set(fmt(live[i].amt));
    Sound.play('coin', { i }); Haptics.medium();
    const tc = centre(t); bg.pulse(tc.x, tc.y, .45);
  };

  if (fx.playSplit) {
    try {
      let image = null;
      try { if (banknote) image = await banknote.noteImage(state.settings.note || '50', { value: state.cur + fmtPayDigits(c.pay), serial: `CC${state.settings.note || '50'} ${String(nextSerialN()).padStart(6, '0')}` }); } catch (e) {}
      await fx.playSplit({ note: { rect: noteRect, amountText: fmt(c.pay), label: 'PAYCHECK', serial: serial(nextSerialN()), image }, pieces, onSlash, onHit, onDone: noop });
    } catch (e) { console.warn(e); pieces.forEach((_, i) => onHit(i)); }
  } else {
    onSlash(0, 1);
    for (let i = 0; i < pieces.length; i++) { await wait(reduce ? 60 : 180); onHit(i); }
  }

  // bank it
  const parts = live.map(r => ({ id: r.b.id, name: r.b.name || 'Untitled', amt: r.amt, color: r.b.color, auto: !!r.b.auto, done: !!r.b.auto }));
  const allAuto = parts.every(p => p.auto);
  const entry = { id: uid(), n: nextSerialN(), t: Date.now(), pay: c.pay, cur: state.cur, freq: state.freq, parts, status: allAuto ? 'banked' : 'pending', bankedAt: allAuto ? Date.now() : null };
  state.history.unshift(entry);
  state.history = state.history.slice(0, 500);
  touch();
  const sAfter = Score ? scoreNow().score : null;

  Sound.play('fanfare'); Haptics.success(); bg.setMood('celebrate');
  if (!reduce) { fx.confetti(innerWidth / 2, innerHeight * .42, { count: 200 }); fx.shockwave(innerWidth / 2, innerHeight * .42, { radius: Math.max(innerWidth, innerHeight) * .7 }); }
  $('#stampSub').textContent = `${fmt(c.pay)} into ${live.length} bucket${live.length === 1 ? '' : 's'}`;
  $('#stampXp').textContent = sBefore != null && sAfter !== sBefore ? `Score ${sAfter > sBefore ? '+' : ''}${sAfter - sBefore}` : '';
  $('#stampLine').textContent = coach ? coach.line('cut') : '';
  const toMove = parts.filter(p => !p.auto);
  $('#stampDone').textContent = allAuto ? 'Nice' : 'Bank it';
  $('#stampLater').hidden = allAuto;
  $('#stamp').hidden = false;
  const choice = await new Promise(res => {
    const bank = () => { off(); res('bank'); }, later = () => { off(); res('later'); };
    const off = () => { $('#stampDone').removeEventListener('click', bank); $('#stampLater').removeEventListener('click', later); };
    $('#stampDone').addEventListener('click', bank); $('#stampLater').addEventListener('click', later);
  });
  Haptics.light();
  if (choice === 'bank' && !allAuto && openBankRun) {
    // The run deals in over the stage, then the stage quietly goes away underneath it.
    const run = bankRun(entry, { onDone: finishSplit });
    setTimeout(() => { stage.hidden = true; $('#stamp').hidden = true; }, reduce ? 0 : 450);
    void run;
    return;
  }
  Sound.play('close');
  if (!allAuto) toast(`${toMove.length} transfer${toMove.length === 1 ? '' : 's'} waiting. Bank them when you've moved the money.`);
  stage.classList.add('out');
  await wait(reduce ? 0 : 340);
  stage.hidden = true; stage.classList.remove('out');
  finishSplit();
  function finishSplit() {
    splitting = false;
    if (state.payCalc.useHours) resetPeriodHours();
    renderNote(); update(); renderHeader(); renderPending();
    live.forEach((r, i) => setTimeout(() => hitCard(r.b.id, i), reduce ? 0 : 80 * i));
    processProgress();
  }
}

/* =========================================================
   TRANSFER RUN
   ========================================================= */
let bankOpen = false;
function bankRun(entry, { onDone } = {}) {
  if (!openBankRun || bankOpen) return null;
  bankOpen = true;
  return openBankRun({
    entry: { ...entry, serial: serial(entry.n || 0) },
    fmt, Sound, Haptics, fx, bg, reduceMotion: reduce,
    onToggle(i, done) {
      setPartDone(entry, i, done);
      renderPending(); renderHeader();
      if (tab === 'vault') renderVault();
    },
    onScrap() {
      state.history = state.history.filter(h => h.id !== entry.id); save();
      lastLevel = progress ? progress.evaluate(state).level : 1;
    },
    onClose(result) {
      bankOpen = false;
      stage.hidden = true; stage.classList.remove('out'); $('#stamp').hidden = true;
      renderPending(); renderNote(); renderHeader(); syncMood();
      if (tab === 'vault') renderVault();
      if (result === 'scrapped') toast('Split scrapped. Like it never happened.');
      if (result === 'later') { const left = pendingLeft(entry); if (left > 0) toast(`${fmt(left)} still to move. It'll wait.`); }
      if (onDone) onDone(); else processProgress();
    }
  });
}
function renderPending() {
  const list = pending();
  const strip = $('#pendingStrip');
  $('#vaultDot').hidden = !list.length;
  if (!list.length) { strip.hidden = true; return; }
  const left = list.reduce((s, h) => s + pendingLeft(h), 0);
  const slips = list.reduce((s, h) => s + h.parts.filter(p => !p.done).length, 0);
  $('#psTitle').textContent = list.length === 1 ? `${slips} transfer${slips === 1 ? '' : 's'} to bank` : `${list.length} splits to bank`;
  $('#psSub').textContent = `${fmt(left)} still to move`;
  strip.hidden = false;
}
$('#pendingStrip').addEventListener('click', () => {
  const list = pending(); if (!list.length) return;
  Sound.play('open'); bankRun(list[0]);
});

/* =========================================================
   PROGRESS: achievements, rank ups, banners
   ========================================================= */
const BICONS = {
  house: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  bike: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-7h5l3 7M10 10 8 6H5M15 10l1-3h2"/>',
  cat: '<path d="M5 20c-1-4 0-8 2-10L6 4l4 3h4l4-3-1 6c2 2 3 6 2 10z"/><circle cx="10" cy="13" r=".8"/><circle cx="14" cy="13" r=".8"/>',
  car: '<path d="M4 16V12l2-5h12l2 5v4z"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/><path d="M4 12h16"/>',
  piggy: '<path d="M19 11c0-3.3-3.1-6-7-6S5 7.7 5 11c0 1.8.9 3.4 2.3 4.5V19h3v-2h3.4v2h3v-3.5c.8-.6 1.5-1.3 1.9-2.2H21v-3h-2z"/><circle cx="15" cy="10" r=".8"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h4"/>',
  food: '<path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-2 0-3 2-3 5s1 5 3 5v8"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  tool: '<path d="M14 6a4 4 0 0 1 5 5l-9 9-4-4 9-9"/><path d="M4 20l2-2"/>',
  gift: '<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M3 13h18M12 9v12M12 9C10 5 6 6 8 9M12 9c2-4 6-3 4 0"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'
};
const ICON_GUESS = [[/emergency|rainy|buffer/i, 'shield'], [/lisa|house|deposit|home|rent|mortgage/i, 'house'], [/cat|pet|dog|vet/i, 'cat'], [/bike|125|motor/i, 'bike'],
  [/driv|car|lesson|fuel|petrol/i, 'car'], [/invest|isa|stock|share|pension/i, 'chart'], [/sav/i, 'piggy'], [/bill|insur|subscr/i, 'card'],
  [/food|grocer|lunch/i, 'food'], [/phone/i, 'phone'], [/tool|irregular|clothes|servic/i, 'tool'], [/gift|xmas|christmas|birthday/i, 'gift'], [/fun|spend|going out/i, 'star']];
const bucketIcon = b => b.icon || (ICON_GUESS.find(([re]) => re.test(b.name || '')) || [])[1] || 'piggy';
const ICONS = {
  blade: '<path d="M3 21 17 7l4-4-2 6L6 22z"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',
  crown: '<path d="M3 7l4 4 5-7 5 7 4-4-2 12H5z"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7z"/>',
  vault: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  skull: '<path d="M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z"/><circle cx="9" cy="11" r="1.5"/><circle cx="15" cy="11" r="1.5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>'
};
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || BICONS[n] || ICONS.star}</svg>`;

let lastLevel = progress ? progress.evaluate(state).level : 1;
const scoreNow = () => (Score ? Score.score(state, fmt0) : null);
let lastScore = Score ? scoreNow().score : 0;
// Money score: banner when it climbs, the big overlay when you move up a band.
function processProgress({ quiet = false } = {}) {
  if (!Score) return;
  const sc = scoreNow();
  const before = lastScore, prevBand = Score.bandFor(before);
  lastScore = sc.score;
  if (Score.logScore(state, sc.score).changed) save();
  renderHeader();
  if (tab === 'ranks') renderRanks();
  if (quiet || sc.score === before) return;
  if (sc.score > before && tab !== 'ranks') $('#ranksDot').hidden = false;
  if (sc.band.index > prevBand.index) showRankUp({ from: prevBand.name, to: sc.band.name });
  else if (sc.score > before) queueBanner({ icon: 'bolt', eyebrow: 'Money score', name: `+${sc.score - before} points`, desc: `Now ${sc.score}. ${sc.band.name}.` });
}
let progT;
function queueProgress() { clearTimeout(progT); progT = setTimeout(() => { if (!splitting) processProgress(); }, 700); }

const bannerQ = []; let bannerBusy = false;
function queueBanner(a) { bannerQ.push(a); if (!bannerBusy) nextBanner(); }
async function nextBanner() {
  const a = bannerQ.shift(); if (!a) { bannerBusy = false; return; }
  bannerBusy = true;
  const el = document.createElement('div'); el.className = 'banner';
  el.innerHTML = `<span class="ic">${icon(a.icon)}</span><span><span class="eyebrow">${esc(a.eyebrow || 'Score up')}</span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span>`;
  el.onclick = () => { setTab('ranks'); el.classList.add('out'); };
  $('#banners').appendChild(el);
  Sound.play('achievement'); Haptics.success();
  await wait(60);
  const c = centre(el); fx.sparkBurst(c.x - 120, c.y, { count: 24 });
  await wait(bannerQ.length ? 2200 : 3200);
  el.classList.add('out'); await wait(340); el.remove();
  nextBanner();
}
function showRankUp({ from, to }) {
  return new Promise(res => {
    const r = $('#rankup');
    $('#ruFrom').textContent = from; $('#ruTo').textContent = to;
    r.hidden = false; r.classList.remove('out');
    Sound.play('levelup'); Haptics.pattern([60, 40, 60, 40, 160]); bg.setMood('celebrate');
    if (!reduce) setTimeout(() => { fx.confetti(innerWidth / 2, innerHeight / 2, { count: 240 }); fx.shockwave(innerWidth / 2, innerHeight / 2, { radius: innerHeight }); fx.flash(.6); }, 250);
    $('#ruDone').onclick = async () => { Sound.play('close'); r.classList.add('out'); await wait(340); r.hidden = true; syncMood(); res(); };
  });
}

/* =========================================================
   HEADER
   ========================================================= */
function renderHeader() {
  if (Score) {
    const sc = scoreNow();
    $('#rankLvl').textContent = sc.score; $('#rankName').textContent = sc.band.name;
    $('#rankRing').style.strokeDashoffset = 94.25 * (1 - sc.score / Score.MAX);
    $('#rankPill').dataset.band = sc.band.index;
  } else $('#rankPill').hidden = true;
  const pd = nextPayday(), pill = $('#paydayPill');
  pill.classList.remove('soon', 'today');
  if (!pd) $('#paydayTxt').textContent = 'Set payday';
  else if (pd.days === 0) { $('#paydayTxt').textContent = 'PAYDAY'; pill.classList.add('today'); }
  else { $('#paydayTxt').textContent = pd.days === 1 ? 'Payday tomorrow' : `Payday in ${pd.days}d`; if (pd.days <= 3) pill.classList.add('soon'); }
  const today = !!pd && pd.days === 0;
  const cutToday = state.history.some(h => new Date(h.t).toDateString() === new Date().toDateString());
  document.body.classList.toggle('payday', today);
  $('#paydayBanner').hidden = !today || cutToday;
}
$('#rankPill').addEventListener('click', () => setTab('ranks'));
$('#paydayPill').addEventListener('click', () => { openSettings(); setTimeout(() => $('#setPayday').focus(), 400); });

/* =========================================================
   VAULT
   ========================================================= */
const vPaid = odo($('#vPaid')), vSaved = odo($('#vSaved')), vSplits = odo($('#vSplits')), vStreak = odo($('#vStreak'));
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
function renderVault(newId) {
  const hist = state.history.filter(h => h.cur === state.cur);
  const ev = progress ? progress.evaluate(state) : null;
  const paid = hist.reduce((s, h) => s + h.pay, 0);
  vPaid.set(fmt(paid));
  // All-time, like "paid in" (rank totals only count since the last reset).
  const savedAll = progress ? hist.reduce((t, h) => t + h.parts.filter(p => progress.isSavings(p.name)).reduce((u, p) => u + p.amt, 0), 0) : 0;
  vSaved.set(progress ? fmtShort(savedAll) : '-');
  vSplits.set(String(hist.length));
  vStreak.set(String(ev ? ev.streak : 0));
  if (coach && !$('#vaultLine').textContent) $('#vaultLine').textContent = coach.line('vault');
  const pend = pending().filter(h => h.cur === state.cur), owed = pend.reduce((s, h) => s + pendingLeft(h), 0);
  let vp = $('#vaultPending');
  if (!vp) { vp = document.createElement('div'); vp.id = 'vaultPending'; vp.className = 'vault-pending'; $('.vault-hero').appendChild(vp); }
  vp.textContent = owed > 0 ? `${fmt(owed)} cut but not moved yet` : '';

  // chart
  const last = hist.slice(0, 12).reverse();
  $('#chartMeta').textContent = last.length ? `${last.length} most recent` : '';
  if (!last.length) $('#chart').innerHTML = '<div class="empty">Your splits stack up here. Go cut something.</div>';
  else {
    const W = 600, H = 220, pl = 44, pr = 8, pt = 10, pb = 24;
    const max = Math.max(...last.map(h => h.pay)) || 1;
    const step = Math.pow(10, Math.floor(Math.log10(max))) / 2;
    const top = Math.ceil(max / step) * step;
    const bw = Math.min(90, (W - pl - pr) / last.length);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = top * i / 4, y = pt + (H - pt - pb) * (1 - i / 4);
      g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text x="${pl - 6}" y="${y + 3}" text-anchor="end">${esc(fmtShort(v))}</text>`;
    }
    last.forEach((h, i) => {
      const x = pl + i * bw + bw * .18, w = bw * .64;
      let y = H - pb, bars = '';
      h.parts.forEach(p => {
        const hh = (H - pt - pb) * p.amt / top;
        y -= hh;
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, hh - 1).toFixed(1)}" rx="2" fill="${p.color}"/>`;
      });
      g += `<g class="bar-g" style="--i:${i}">${bars}</g>`;
      if (last.length <= 8 || i % 2 === last.length % 2 || i === last.length - 1) g += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(dayFmt.format(h.t))}</text>`;
    });
    $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Your last ${last.length} paychecks, stacked by bucket">${g}</svg>`;
    $$('#chart .bar-g rect').forEach((r, i) => r.style.animationDelay = (i * 18) + 'ms');
  }

  // by bucket
  const agg = new Map();
  hist.forEach(h => h.parts.forEach(p => {
    const k = p.id || 'n:' + p.name.trim().toLowerCase();
    const a = agg.get(k) || { id: p.id, name: p.name, color: p.color, amt: 0 };
    a.amt += p.amt; agg.set(k, a);
  }));
  state.buckets.forEach(b => { const a = agg.get(b.id); if (a) { a.name = b.name; a.color = b.color; } });
  const rows = [...agg.values()].sort((a, b) => b.amt - a.amt);
  const topAmt = rows[0]?.amt || 1;
  $('#vbars').innerHTML = rows.length ? rows.map(r => {
    const b = state.buckets.find(x => x.id === r.id);
    const now = b ? bucketTotal(b.id) + (b.kind === 'lisa' ? lisaBonus(b.id) : 0) : r.amt;
    const goal = b?.goal ? `<small>Goal ${Math.floor(clamp(now / b.goal, 0, 1) * 100)}% of ${esc(fmt(b.goal))}${Math.abs(now - r.amt) > .004 ? ` · ${esc(fmt(now))} in it now` : ''}</small>` : (b && Math.abs(now - r.amt) > .004 ? `<small>${esc(fmt(now))} in it now</small>` : '');
    return `<div class="vbar" style="--c:${r.color}"><span><i></i>${esc(r.name)}</span><b class="tab">${esc(fmt(r.amt))}</b><div class="bar"><i data-w="${(r.amt / topAmt * 100).toFixed(1)}"></i></div>${goal}</div>`;
  }).join('') : '<div class="empty">Nothing banked yet.</div>';
  requestAnimationFrame(() => requestAnimationFrame(() => $$('#vbars .bar i').forEach(i => i.style.width = i.dataset.w + '%')));

  // history
  $('#clearBtn').hidden = !state.history.length;
  $('#history').innerHTML = state.history.length ? state.history.slice(0, 100).map(h => {
    const f = new Intl.NumberFormat('en-GB', { style: 'currency', currency: ({ '£': 'GBP', '$': 'USD', '€': 'EUR' })[h.cur] || 'GBP' });
    const todo = h.status === 'pending' ? h.parts.filter(p => !p.done).length : 0;
    const chip = h.status === 'pending' ? `<span class="h-chip pending">${todo} to bank</span>` : `<span class="h-chip banked">Banked${h.bankedAt ? ' ' + esc(dayFmt.format(h.bankedAt)) : ''}</span>`;
    return `<li class="h-item${h.id === newId ? ' new' : ''}${h.status === 'pending' ? ' pending' : ''}" data-id="${h.id}">
      <time datetime="${new Date(h.t).toISOString()}">${dateFmt.format(h.t)} · ${esc(h.freq)}</time>
      <b class="tab">${esc(f.format(h.pay))}</b>
      <button class="h-del" aria-label="Remove this split"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="stack">${h.parts.map(p => `<i class="${p.done ? '' : 'todo'}" style="--c:${p.color};flex:${p.amt}" title="${esc(p.name)} ${esc(f.format(p.amt))}"></i>`).join('')}</div>
      ${chip}
    </li>`;
  }).join('') : '<li class="empty">No splits yet</li>';
}
$('#history').addEventListener('click', e => {
  const d = e.target.closest('.h-del');
  if (!d) {
    const li = e.target.closest('.h-item'); const h = li && state.history.find(x => x.id === li.dataset.id);
    if (h && openBankRun) { Sound.play('open'); bankRun(h); }
    return;
  }
  const li = d.closest('.h-item'), idx = state.history.findIndex(h => h.id === li.dataset.id);
  if (idx < 0) return;
  const [removed] = state.history.splice(idx, 1);
  Sound.play('delete'); Haptics.medium(); save(); renderVault(); renderHeader(); renderNote();
  lastLevel = progress ? progress.evaluate(state).level : 1;
  toast('Split removed', { label: 'Undo', fn: () => { state.history.splice(idx, 0, removed); save(); renderVault(); renderHeader(); renderNote(); lastLevel = progress ? progress.evaluate(state).level : 1; } });
});
let clearArm;
$('#clearBtn').addEventListener('click', e => {
  const b = e.currentTarget;
  if (!b.classList.contains('armed')) {
    b.classList.add('armed'); b.textContent = 'Tap again'; Sound.play('error'); Haptics.medium();
    clearTimeout(clearArm); clearArm = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Clear'; }, 3000);
    return;
  }
  clearTimeout(clearArm); b.classList.remove('armed'); b.textContent = 'Clear';
  const before = state.history; state.history = []; save();
  Sound.play('delete'); Haptics.heavy(); renderVault(); renderHeader(); renderNote();
  lastLevel = progress ? progress.evaluate(state).level : 1;
  toast('History wiped', { label: 'Undo', fn: () => { state.history = before; save(); renderVault(); renderHeader(); renderNote(); lastLevel = progress ? progress.evaluate(state).level : 1; } });
});

/* =========================================================
   BILLS + CALENDAR
   ========================================================= */
function renderBills() {
  const pd = nextPayday();
  const rows = state.bills.map(b => ({ b, nx: Money.nextBillDate(b.day) })).sort((x, y) => x.nx.days - y.nx.days);
  const monthly = state.bills.reduce((s2, b) => s2 + b.amt, 0);
  $('#billsMeta').textContent = state.bills.length ? `${fmt(monthly)} a month` : '';
  $('#billsList').innerHTML = rows.length ? rows.map(({ b, nx }) => {
    const bk = state.buckets.find(x => x.id === b.bucket);
    const before = pd && nx.days < pd.days;
    const short = bk && before && bucketTotal(bk.id) < b.amt;
    const when = nx.days === 0 ? 'today' : nx.days === 1 ? 'tomorrow' : `in ${nx.days} days`;
    return `<li class="${short ? 'warn' : ''}"><span class="b-ic" style="--c:${bk ? bk.color : 'var(--line-2)'}">${icon(bk ? bucketIcon(bk) : 'card')}</span>
      <span class="b-txt"><b>${esc(b.name)}</b><small>${ordinal(b.day)} · ${when}${bk ? ' · from ' + esc(bk.name) : ''}${short ? ` · <em>${esc(bk.name)} only has ${esc(fmt(bucketTotal(bk.id)))}</em>` : before ? ' · before payday' : ''}</small></span>
      <b class="tab">${esc(fmt(b.amt))}</b><button class="x" data-bill="${b.id}" aria-label="Delete ${esc(b.name)}">×</button></li>`;
  }).join('') : '<li class="empty">Add the things that go out every month: insurance, phone, subscriptions.</li>';
  $('#billBucket').innerHTML = '<option value="">From which bucket?</option>' + state.buckets.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
}
function ordinal(n) { return n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'); }
$('#billForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#billName').value.trim(), amt = round2(parseNum($('#billAmt').value)), day = Math.round(parseNum($('#billDay').value));
  if (!name || !(amt > 0) || !(day >= 1 && day <= 31)) { Sound.play('error'); Haptics.error(); toast('Name, amount and a day from 1 to 31'); return; }
  state.bills.push({ id: uid(), name, amt, day, bucket: $('#billBucket').value || null });
  const newId = state.bills[state.bills.length - 1].id;
  e.target.reset(); save(); renderBills(); Sound.play('pop'); Haptics.medium(); toast(`${name} added`);
  const li = $(`#billsList [data-bill="${newId}"]`)?.closest('li'); if (li) li.classList.add('new');
});
$('#billsList').addEventListener('click', e => {
  const x = e.target.closest('[data-bill]'); if (!x) return;
  const i = state.bills.findIndex(b => b.id === x.dataset.bill); if (i < 0) return;
  const gone = state.bills.splice(i, 1)[0]; save(); renderBills(); Sound.play('delete'); Haptics.light();
  toast(`${gone.name} removed`, { label: 'Undo', fn: () => { state.bills.splice(i, 0, gone); save(); renderBills(); } });
});
$('#calBtn').addEventListener('click', async () => {
  const pd = nextPayday();
  const dates = Score ? [
    { id: 'bday', date: Score.DATES.bday, title: 'Turn 18: open the Dodl LISA', desc: 'Trust money lands. Pay £4,000 into the LISA before 5 April.' },
    { id: 'taxend', date: Score.DATES.taxEnd, title: 'Last day: £4,000 into the LISA for this year\'s bonus' },
    { id: 'newyear', date: Score.DATES.newYear, title: 'New tax year: second £4,000 into the LISA' },
    { id: 'payrise', date: Score.DATES.payRise, title: 'Pay rise due: update Clean Cut' }
  ] : [];
  const ics = Money.buildICS({ payday: pd ? pd.date : null, freq: state.freq, bills: state.bills, dates, fmt });
  if (await shareFile('clean-cut.ics', ics, 'text/calendar', 'Clean Cut dates')) toast(pd ? 'Calendar file made. Open it to add the dates' : 'Calendar file made. Set your payday in Settings to include paydays');
});

/* =========================================================
   RANKS
   ========================================================= */
function gaugeSVG(score) {
  const cx = 160, cy = 160, r = 130, A = v => Math.PI + (v / 999) * Math.PI;
  const pt = a => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const arc = (a0, a1) => { const p0 = pt(a0), p1 = pt(a1); return `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A${r} ${r} 0 0 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`; };
  const len = Math.PI * r;
  const segs = Score.BANDS.map((b, i) => {
    const to = (Score.BANDS[i + 1] ? Score.BANDS[i + 1].min : 1000) - 1;
    const col = i >= 3 ? 'var(--alt-hi)' : i === 2 ? 'var(--acc-soft)' : 'var(--crimson)';
    return `<path class="g-seg" d="${arc(A(b.min) + (i ? .02 : 0), A(to))}" stroke="${col}" opacity=".16"/>`;
  }).join('');
  const deg = (score / 999) * 180 - 90;
  return `<svg viewBox="0 0 320 178" aria-hidden="true">
    <defs><linearGradient id="gGrad" x1="0" x2="1"><stop offset="0" stop-color="var(--crimson-deep)"/><stop offset=".55" stop-color="var(--crimson)"/><stop offset="1" stop-color="var(--alt-hi)"/></linearGradient></defs>
    <path class="g-track" d="${arc(Math.PI, 2 * Math.PI)}"/>${segs}
    <path class="g-fill" d="${arc(Math.PI, 2 * Math.PI)}" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${len.toFixed(1)}" data-off="${(len * (1 - score / 999)).toFixed(1)}"/>
    <g class="g-needle" style="transform:rotate(-90deg)" data-rot="${deg.toFixed(1)}"><line x1="160" y1="160" x2="160" y2="52" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="160" cy="160" r="7" fill="#fff"/></g>
    <text class="g-tick" x="18" y="176">0</text><text class="g-tick" x="284" y="176">999</text>
  </svg>`;
}
const tickSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
let shownScore = null, countRaf = 0;
function countTo(el, to) {
  const from = shownScore == null ? Math.max(0, to - 120) : shownScore;
  shownScore = to; cancelAnimationFrame(countRaf);
  if (reduce || from === to) { el.textContent = to; return; }
  const t0 = performance.now(), dur = 900;
  let lastTick = from;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3), v = Math.round(from + (to - from) * e);
    el.textContent = v;
    if (Math.abs(v - lastTick) >= 12) { lastTick = v; Haptics.tick(); }
    if (p < 1) countRaf = requestAnimationFrame(step);
    else { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  };
  countRaf = requestAnimationFrame(step);
}
function renderRanks() {
  if (!Score) return;
  const sc = scoreNow();
  const g = $('#scoreGauge');
  g.innerHTML = gaugeSVG(sc.score);
  g.setAttribute('aria-label', `Money score ${sc.score} out of 999, ${sc.band.name}`);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const f = g.querySelector('.g-fill'), nd = g.querySelector('.g-needle');
    if (f) f.style.strokeDashoffset = f.dataset.off;
    if (nd) nd.style.transform = `rotate(${nd.dataset.rot}deg)`;
  }));
  countTo($('#scoreNum'), sc.score);
  const bandEl = $('#scoreBand'); bandEl.textContent = sc.band.name; bandEl.className = 'score-band b' + sc.band.index;
  $('#scoreBlurb').textContent = sc.band.next ? `${sc.band.blurb} ${sc.band.next.min - sc.score} to ${sc.band.next.name}.` : sc.band.blurb;
  const log = Array.isArray(state.scoreLog) ? state.scoreLog : [];
  const ref = [...log].reverse().find(e => Date.now() - e.t >= 7 * 864e5) || log[0];
  const d = ref ? sc.score - ref.s : 0, de = $('#scoreDelta');
  de.className = 'score-delta tab' + (d > 0 ? ' up' : d < 0 ? ' down' : '');
  de.textContent = ref && d !== 0 ? `${d > 0 ? '+' : ''}${d} since ${dayFmt.format(new Date(ref.t))}` : '';

  const pts = sc.factors.reduce((s2, x) => s2 + Math.round(x.max * Math.max(0, Math.min(1, x.v))), 0);
  $('#factorMeta').textContent = `${pts} / 999`;
  $('#factors').innerHTML = sc.factors.map(x => {
    const p = Math.round(x.max * Math.max(0, Math.min(1, x.v)));
    return `<li class="${p >= x.max ? 'full' : ''}"><div class="f-top"><b>${esc(x.name)}</b><span class="f-pts"><em>${p}</em> / ${x.max}</span></div><div class="bar"><i data-w="${(p / x.max * 100).toFixed(0)}"></i></div><small>${esc(x.now)} <span>&middot; ${esc(x.tip)}</span></small></li>`;
  }).join('');

  requestAnimationFrame(() => requestAnimationFrame(() => $$('#factors .bar i').forEach(i => { i.style.width = i.dataset.w + '%'; })));
  // score over time
  const spk = log.slice(-30);
  if (spk.length >= 2) {
    const W = 260, H = 44, lo = Math.min(...spk.map(e => e.s)), hi = Math.max(...spk.map(e => e.s)), span = Math.max(40, hi - lo);
    const xy = spk.map((e, i) => [i / (spk.length - 1) * W, H - 4 - (e.s - lo) / span * (H - 8)]);
    $('#scoreSpark').innerHTML = `<svg viewBox="0 0 ${W} ${H}"><path d="M${xy.map(p => p.map(v => v.toFixed(1)).join(' ')).join(' L')}" fill="none" stroke="url(#gGrad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${xy[xy.length - 1][0].toFixed(1)}" cy="${xy[xy.length - 1][1].toFixed(1)}" r="3.5" fill="#fff"/></svg><small>Last ${spk.length} days</small>`;
  } else $('#scoreSpark').innerHTML = '<small>Your score history builds up here day by day.</small>';

  // projection
  const pay = compute().pay;
  const saving = state.buckets.filter(b => progress && progress.isSavings(b.name));
  const perMonth = saving.reduce((s2, b) => s2 + amountOf(b, pay), 0) * FREQ[state.freq] / 12;
  const now0 = saving.reduce((s2, b) => s2 + bucketTotal(b.id) + (b.kind === 'lisa' ? lisaBonus(b.id) : 0), 0);
  const series = Money.project({ start: now0, perMonth, months: 18, lump: Score.TRUST, lumpDate: Score.DATES.bday });
  const PW = 320, PH = 120, top = Math.max(...series.map(p => p.v), 1);
  const px = i => 8 + i / 18 * (PW - 16), py = v => PH - 18 - v / top * (PH - 30);
  const bdayI = Math.ceil(Money.monthsUntil(Score.DATES.bday));
  $('#projChart').innerHTML = `<svg viewBox="0 0 ${PW} ${PH}" role="img" aria-label="Projected savings over 18 months">
    <path d="M${px(0)} ${py(0)} ${series.map(p => `L${px(p.i).toFixed(1)} ${py(p.v).toFixed(1)}`).join(' ')} L${px(18)} ${py(0)}Z" fill="rgba(208,38,63,.14)"/>
    <path d="${series.map((p, i) => `${i ? 'L' : 'M'}${px(p.i).toFixed(1)} ${py(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="url(#gGrad)" stroke-width="2.5" stroke-linejoin="round"/>
    ${bdayI >= 0 && bdayI <= 18 ? `<line x1="${px(bdayI)}" x2="${px(bdayI)}" y1="8" y2="${PH - 18}" stroke="var(--alt-hi)" stroke-dasharray="3 3"/><text x="${px(bdayI) + 4}" y="16" class="g-tick">18th +£5k trust</text>` : ''}
    <text x="8" y="${PH - 4}" class="g-tick">Now</text><text x="${PW - 8}" y="${PH - 4}" class="g-tick" text-anchor="end">${esc(dayFmt.format(series[18].d))}</text>
    <text x="${PW - 8}" y="${Math.max(30, py(series[18].v) - 6).toFixed(1)}" class="g-tick" text-anchor="end">${esc(fmtShort(series[18].v))}</text>
  </svg>`;
  const v1 = Money.valueOn(now0, perMonth, Score.DATES.bday), v2 = Money.valueOn(now0, perMonth, Score.DATES.newYear, Score.TRUST, Score.DATES.bday);
  $('#projStats').innerHTML = `<div><span>By your 18th</span><b class="tab">${fmtShort(v1)}</b></div><div><span>By 6 April + trust</span><b class="tab">${fmtShort(v2)}</b></div><div><span>LISA at 25, on the plan</span><b class="tab">${fmtShort(Money.lisaAt25())}</b></div>`;
  $('#projNote').textContent = perMonth > 0
    ? `${fmt(perMonth)} a month goes into saving buckets on your current split. Spending money and bills aren't counted. LISA figure assumes ~£10k in by April 2027, £4,000 a year plus bonus after, and 5% a year growth above inflation. Not guaranteed.`
    : 'None of your buckets look like savings yet. Name one Savings, ISA, LISA or Emergency fund and it shows up here.';

  // the plan
  const ph = Score.phase();
  const names = [['Phase 1', 'Now to 14 Mar: emergency fund, then second-year LISA money'], ['Phase 2', '15 Mar to 5 Apr: trust money lands, £4,000 into the LISA'], ['Phase 3', 'From 6 Apr: second £4,000 in, then the ISA']];
  $('#phaseMeta').textContent = `Phase ${ph} of 3`;
  $('#phases').innerHTML = names.map((nm, i) => `<div class="phase ${i + 1 === ph ? 'cur' : i + 1 < ph ? 'done' : ''}"><b>${nm[0]}</b>${esc(nm[1])}</div>`).join('');
  const em = sc.factors.find(x => x.id === 'emergency');
  let msg;
  if (ph === 1) msg = (em && em.v < 1 ? `Fill the emergency fund first (${em.now}). Then everything spare goes towards the second £4,000 for the LISA. ` : 'Emergency fund done. Everything spare goes towards the second £4,000 for the LISA. ')
    + `The £${Score.TRUST.toLocaleString('en-GB')} trust money at 18 covers the first £4,000. Ask the trustees now how long the payout takes.`;
  else if (ph === 2) msg = `Open the Dodl LISA and pay £4,000 of the trust money in before 5 April. ${Math.max(0, Score.daysUntil(Score.DATES.taxEnd))} days left for this tax year's £1,000 bonus. Don't spend the other £1,000: it's part of the 6 April payment.`;
  else msg = (Score.daysUntil('2027-04-30') >= 0 ? 'Pay the second £4,000 into the LISA (the £1,000 left from the trust plus your savings). ' : '') + 'With this year\'s LISA allowance used, spare money goes to the ISA. Pay rise due around September 2027: update your pay when it lands.';
  $('#nextUp').textContent = msg;
  const clocks = [[Score.DATES.bday, 'to your 18th', 'LISA can open'], [Score.DATES.taxEnd, 'to tax-year end', '£4k in by then'], [Score.DATES.payRise, 'to the pay rise', '~£10.85/hr']];
  $('#clocks').innerHTML = clocks.map(c => `<div class="clock"><b class="tab">${Math.max(0, Score.daysUntil(c[0]))}</b><span>days ${c[1]}</span><small>${esc(c[2])}<br>${longDate.format(new Date(c[0] + 'T12:00'))}</small></div>`).join('');

  // to-dos
  const checks = state.plan.checks || {};
  const done = Score.CHECKS.filter(c => checks[c.id]).length;
  $('#checksMeta').textContent = `${done} / ${Score.CHECKS.length}`;
  $('#checks').innerHTML = Score.CHECKS.map(c => `<li class="${checks[c.id] ? 'on' : ''}" data-check="${c.id}" role="checkbox" aria-checked="${!!checks[c.id]}" tabindex="0"><span class="tick">${tickSVG}</span><span class="c-txt">${esc(c.name)}<small>${esc(c.hint)}</small></span></li>`).join('');

  // pension
  const pen = Score.pension(state.plan.gross);
  $('#penOn').checked = !!state.plan.penOn;
  if (document.activeElement !== $('#penGross')) $('#penGross').value = state.plan.gross ? String(state.plan.gross) : '';
  $('#penRows').innerHTML = `<div><span>You pay (after tax relief)</span><b>${fmt(pen.you)}</b></div><div><span>Tax relief adds</span><b class="plus">+${fmt(pen.relief)}</b></div><div><span>Employer must add</span><b class="plus">+${fmt(pen.employer)}</b></div><div class="tot"><span>Going in a month</span><b>${fmt(pen.total)}</b></div>`;
  $('#penNote').textContent = state.plan.penOn
    ? `Comes out before your take-home, so the pay you split should already be about ${fmt(pen.you)} lower. Free money in: ${fmt(pen.relief + pen.employer)} a month.`
    : `Not opted in yet. That's ${fmt((pen.relief + pen.employer) * 12)} a year of free money left on the table.`;

  // bands
  $('#ladder').innerHTML = [...Score.BANDS].reverse().map(b => {
    const top = Score.BANDS[Score.BANDS.indexOf(b) + 1];
    const range = `${b.min}-${top ? top.min - 1 : 999}`;
    return `<li class="${b.name === sc.band.name ? 'cur' : sc.score > b.min ? 'done' : ''}"><span>${b.name === sc.band.name ? '&#9654;' : ''}</span>${esc(b.name)}<small>${range}</small></li>`;
  }).join('');
}
function planChanged() { save(); if (state.payCalc.useHours) { refreshPay(); renderNote(); update(); } renderRanks(); processProgress(); }
$('#checks').addEventListener('click', e => {
  const li = e.target.closest('[data-check]'); if (!li) return;
  const id = li.dataset.check, on = !state.plan.checks[id];
  state.plan.checks[id] = on;
  if (id === 'pension') state.plan.penOn = on;
  Sound.play(on ? 'coin' : 'tap'); on ? Haptics.success() : Haptics.light();
  planChanged();
  if (on) {
    const t = $(`#checks [data-check="${id}"] .tick`);
    if (t) { t.classList.add('pop'); const c = centre(t); fx.sparkBurst(c.x, c.y, { count: 18, power: .6 }); }
  }
});
$('#checks').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-check]')) { e.preventDefault(); e.target.click(); } });
$('#penOn').addEventListener('change', e => {
  state.plan.penOn = e.target.checked; state.plan.checks.pension = e.target.checked;
  Sound.play('tap'); Haptics.light(); planChanged();
});
$('#penGross').addEventListener('change', e => { state.plan.gross = Math.max(0, parseNum(e.target.value)); planChanged(); });

/* =========================================================
   TABS
   ========================================================= */
let tab = 'split';
function setTab(t) {
  if (t === tab) return;
  const order = ['split', 'vault', 'ranks'], dir = order.indexOf(t) > order.indexOf(tab) ? 'from-right' : 'from-left';
  tab = t; document.body.dataset.tab = t;
  $$('.view').forEach(v => { const on = v.dataset.view === t; v.hidden = !on; v.classList.remove('in', 'from-right', 'from-left'); if (on && !reduce) { void v.offsetWidth; v.classList.add(dir); } });
  $$('#tabbar button').forEach(b => b.toggleAttribute('aria-current', b.dataset.tab === t));
  $$('#tabbar button').forEach(b => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); });
  scrollTo({ top: 0, behavior: 'auto' });
  if (t === 'vault') { renderVault(); renderBills(); openVaultDoor(); }
  if (t === 'ranks') { renderRanks(); $('#ranksDot').hidden = true; }
  Sound.play('tap'); Haptics.light();
}
$('#tabbar').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });

/* =========================================================
   SHEETS
   ========================================================= */
let openSheetRef = null, sheetToken = 0;
const scrim = $('#scrim');
function showSheet(el, { onClose } = {}) {
  if (openSheetRef) closeSheet(true);
  const tok = ++sheetToken;
  scrim.classList.remove('out'); scrim.hidden = false;
  el.classList.remove('out'); el.style.transform = ''; el.hidden = false; el.scrollTop = 0;
  openSheetRef = { el, onClose, tok };
  document.body.classList.add('sheet-open');
  Sound.play('open'); Haptics.light();
}
function closeSheet(instant = false) {
  const s = openSheetRef; if (!s) return;
  openSheetRef = null;
  document.body.classList.remove('sheet-open');
  try { s.onClose && s.onClose(); } catch (e) { console.warn(e); }
  if (document.activeElement && s.el.contains(document.activeElement)) document.activeElement.blur();
  if (instant || reduce) { s.el.hidden = true; scrim.hidden = true; return; }
  Sound.play('close');
  s.el.classList.add('out'); scrim.classList.add('out');
  setTimeout(() => {
    if (openSheetRef && openSheetRef.tok !== s.tok && openSheetRef.el === s.el) return;
    s.el.hidden = true; s.el.classList.remove('out'); s.el.style.transform = '';
    if (!openSheetRef) { scrim.hidden = true; scrim.classList.remove('out'); }
  }, 280);
}
scrim.addEventListener('click', () => closeSheet());
addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
// drag down to dismiss
// Only the grab handle drags, so the rest of the sheet scrolls like a normal list.
$$('.sheet').forEach(sh => {
  let y0 = null, dy = 0;
  sh.addEventListener('pointerdown', e => {
    if (!e.target.closest('.grab')) return;
    y0 = e.clientY; dy = 0; sh.classList.add('dragging');
    try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
  });
  sh.addEventListener('pointermove', e => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    sh.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null; sh.classList.remove('dragging');
    if (dy > 90) closeSheet();
    else { sh.style.transition = 'transform .35s cubic-bezier(.34,1.56,.64,1)'; sh.style.transform = ''; setTimeout(() => sh.style.transition = '', 360); }
  };
  sh.addEventListener('pointerup', end); sh.addEventListener('pointercancel', end);
});

/* =========================================================
   SETTINGS
   ========================================================= */
function openSettings() {
  $('#setSound').checked = state.settings.sound;
  $('#setHaptics').checked = state.settings.haptics;
  $('#setMotion').checked = state.settings.motion;
  $('#setCur').value = state.cur;
  $('#setPayday').value = state.nextPayday || '';
  $('#setCalm').checked = !!state.settings.calm; $('#setWhole').checked = !!state.settings.whole;
  $('#setRate').value = String(state.payCalc.rate); $('#setOt').value = String(state.payCalc.otMult);
  $('#setWeekly').value = String(state.payCalc.weekly); $('#setPayDay').value = String(state.payCalc.payDay);
  renderBackupAge();
  $('#installHint').hidden = !(pwa.isIOS() && !pwa.isStandalone());
  const r = $('#resetBtn'); r.classList.remove('armed'); r.textContent = 'Reset everything';
  const rr = $('#resetRankBtn'); rr.classList.remove('armed'); rr.textContent = 'Reset score history';
  showSheet($('#settings'));
}
$('#settingsBtn').addEventListener('click', openSettings);
$('#setCalm').addEventListener('change', e => { state.settings.calm = e.target.checked; save(); setCalm(e.target.checked); Sound.play('toggle', { on: e.target.checked }); Haptics.light(); });
$('#setWhole').addEventListener('change', e => { state.settings.whole = e.target.checked; save(); update(); Sound.play('toggle', { on: e.target.checked }); Haptics.light(); });
const payChanged = () => { refreshPay(); renderNote(); update(); renderHeader(); };
$('#setRate').addEventListener('change', e => { const v = parseNum(e.target.value); if (v > 0) { state.payCalc.rate = round2(v); payChanged(); } e.target.value = String(state.payCalc.rate); });
$('#setOt').addEventListener('change', e => { const v = parseNum(e.target.value); if (v >= 1) { state.payCalc.otMult = round2(v); payChanged(); } e.target.value = String(state.payCalc.otMult); });
$('#setWeekly').addEventListener('change', e => {
  const v = parseNum(e.target.value);
  if (v > 0 && v <= 80) { state.payCalc.weekly = round2(v); state.payCalc.hours = Money.usualHours(state.freq, state.payCalc.weekly); state.payCalc.otHours = 0; payChanged(); }
  e.target.value = String(state.payCalc.weekly);
});
$('#setPayDay').addEventListener('change', e => {
  const v = Math.round(parseNum(e.target.value));
  if (v >= 1 && v <= 31) { state.payCalc.payDay = v; if (state.freq === 'monthly') { state.nextPayday = nextOnDay(v); $('#setPayday').value = state.nextPayday; } save(); renderNote(); renderHeader(); }
  e.target.value = String(state.payCalc.payDay);
});
function backupDays() { return state.lastBackup ? Math.floor((Date.now() - state.lastBackup) / 864e5) : null; }
function renderBackupAge() {
  const d = backupDays();
  $('#backupAge').textContent = d === null ? 'Never backed up.' : d === 0 ? 'Last backup: today.' : `Last backup: ${d} day${d === 1 ? '' : 's'} ago.`;
  $('#backupAge').classList.toggle('stale', d === null || d > 14);
}
async function shareFile(name, text, type, title) {
  const blob = new Blob([text], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return true; }
  } catch (e) { if (e && e.name === 'AbortError') return false; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
$('#setDone').addEventListener('click', () => closeSheet());
$('#setSound').addEventListener('change', e => { state.settings.sound = Sound.enabled = e.target.checked; save(); Sound.play('toggle', { on: e.target.checked }); });
$('#setHaptics').addEventListener('change', e => { state.settings.haptics = Haptics.enabled = e.target.checked; save(); Haptics.medium(); Sound.play('toggle', { on: e.target.checked }); });
$('#setMotion').addEventListener('change', async e => {
  const on = e.target.checked;
  Sound.play('toggle', { on });
  if (on) {
    const ok = await enableMotion(true);
    if (!ok) { e.target.checked = false; toast('Motion access was blocked. Allow it in Safari settings.'); return; }
  } else disableMotion();
  state.settings.motion = on; save();
});
$('#setCur').addEventListener('change', e => {
  state.cur = e.target.value; mkFormat(); touch();
  renderNote(); renderBuckets(); renderVault(); Sound.play('toggle', { on: true });
});
$('#setPayday').addEventListener('change', e => { state.nextPayday = e.target.value || null; save(); renderHeader(); Sound.play('tap'); });
async function doBackup() {
  const name = `clean-cut-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (!(await shareFile(name, exportJSON(), 'application/json', 'Clean Cut backup'))) return;
  state.lastBackup = Date.now(); save(); renderBackupAge(); toast('Backup exported');
}
$('#exportBtn').addEventListener('click', doBackup);
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || !Array.isArray(data.buckets)) throw new Error('bad');
    replaceState(data); mkFormat(); seen.clear(); applySettings(); renderAll();
    lastLevel = progress ? progress.evaluate(state).level : 1;
    Sound.play('sweep'); Haptics.success(); toast('Backup restored'); closeSheet();
  } catch (err) { Sound.play('error'); Haptics.error(); toast("That file isn't a Clean Cut backup"); }
  e.target.value = '';
});
let rankArm;
$('#resetRankBtn').addEventListener('click', e => {
  const b = e.currentTarget;
  if (!b.classList.contains('armed')) {
    b.classList.add('armed'); b.textContent = 'Tap again to clear it'; Sound.play('error'); Haptics.medium();
    clearTimeout(rankArm); rankArm = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Reset score history'; }, 3500);
    return;
  }
  clearTimeout(rankArm); b.classList.remove('armed'); b.textContent = 'Reset score history';
  state.scoreLog = []; save(); lastScore = Score ? scoreNow().score : 0;
  renderHeader(); renderRanks(); renderVault();
  Sound.play('delete'); Haptics.heavy(); toast('Score history cleared. Splits kept.');
});
let resetArm;
$('#resetBtn').addEventListener('click', e => {
  const b = e.currentTarget;
  if (!b.classList.contains('armed')) {
    b.classList.add('armed'); b.textContent = 'Tap again. It all goes.'; Sound.play('error'); Haptics.heavy();
    clearTimeout(resetArm); resetArm = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Reset everything'; }, 3500);
    return;
  }
  resetState(); mkFormat(); seen.clear(); applySettings(); renderAll();
  lastLevel = progress ? progress.evaluate(state).level : 1;
  closeSheet(); Sound.play('delete'); Haptics.heavy(); toast('Wiped clean');
});

/* =========================================================
   NOTE THEME
   ========================================================= */
function applyTheme(key, { celebrate = false } = {}) {
  if (!theme) return;
  const t = theme.applyNote(key);
  renderNoteArt(key);
  $$('#notePick button').forEach(b => b.setAttribute('aria-pressed', b.dataset.note === String(key)));
  const o = theme.otherOf(key);
  try { fxMod && fxMod.setPalette && fxMod.setPalette({ crimson: t.main, hi: t.hi, deep: t.deep, soft: t.soft, n1: t.n1, n2: t.n2, n3: t.n3, alt: o.main, altHi: o.hi }); } catch (e) {}
  // Smoke lit in the other note's colour, veins in the lead: both notes in the background.
  try { bg.setAccent && bg.setAccent({ crim: theme.rgb01(t.main), hi: theme.rgb01(t.hi), deep: theme.rgb01(t.deep), blood: theme.rgb01(o.blood) }); } catch (e) {}
  noteImg = null;
  if (celebrate) {
    const n = centre($('#notePick'));
    fx.flash(.35); fx.sparkBurst(n.x, n.y, { color: t.hi, count: 40, power: 1 }); bg.pulse(innerWidth / 2, innerHeight / 2, 1.2);
    Sound.play('sweep'); Haptics.success();
  }
}
$('#notePick').addEventListener('click', e => {
  const b = e.target.closest('[data-note]'); if (!b || b.dataset.note === state.settings.note) return;
  state.settings.note = b.dataset.note; save();
  applyTheme(b.dataset.note, { celebrate: true });
  toast(`Running on ${theme ? theme.noteOf(b.dataset.note).label + 's' : 'that'} now`);
});

/* =========================================================
   TILT
   ========================================================= */
const note = $('#note');
let tiltRaf = 0, tx = 0, ty = 0, idleT;
function setTilt(x, y) {
  tx = clamp(x, -1, 1); ty = clamp(y, -1, 1);
  if (tiltRaf) return;
  tiltRaf = requestAnimationFrame(() => {
    tiltRaf = 0;
    note.style.setProperty('--tx', tx.toFixed(3)); note.style.setProperty('--ty', ty.toFixed(3));
    bg.setTilt(tx, ty);
    note.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => note.classList.add('idle'), 2500);
  });
}
if (finePointer && !reduce) addEventListener('pointermove', e => setTilt(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1), { passive: true });
function onOrient(e) { if (e.gamma == null) return; setTilt(e.gamma / 28, ((e.beta || 0) - 40) / 28); }
async function enableMotion(fromGesture) {
  if (reduce || typeof DeviceOrientationEvent === 'undefined') return false;
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      if (!fromGesture) return false;
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return false;
    }
    addEventListener('deviceorientation', onOrient); return true;
  } catch (e) { return false; }
}
function disableMotion() { removeEventListener('deviceorientation', onOrient); setTilt(0, 0); }

/* =========================================================
   BOOT
   ========================================================= */
function applySettings() {
  Sound.enabled = state.settings.sound; Haptics.enabled = state.settings.haptics;
  applyTheme(state.settings.note || '50');
  if (state.settings.motion) {
    // iOS needs a tap to re-grant motion each launch; ask on the first touch.
    enableMotion(false).then(ok => { if (!ok) addEventListener('touchend', () => enableMotion(true), { once: true }); });
  }
}
function renderAll() { renderNote(); renderFreq(); renderBuckets(); renderHeader(); renderVault(); renderBills(); renderRanks(); renderPending(); }

/* vault door */
let door = null, doorBusy = false;
function openVaultDoor() {
  if (!createVaultDoor) return;
  try {
    if (!door) door = createVaultDoor($('.vault-hero'), { Sound, Haptics, reduceMotion: reduce });
    if (doorBusy) return;
    doorBusy = true;
    door.close();
    Promise.resolve(door.open()).finally(() => { doorBusy = false; });
  } catch (e) { console.warn(e); }
}

if (banknote) document.body.insertAdjacentHTML('afterbegin', banknote.miniSprite());
applySettings();
if (state.settings.calm) setCalm(true);
renderAll();
// Nudge a backup every couple of weeks once there's something worth losing.
setTimeout(function nag() {
  if (openSheetRef || splitting) return setTimeout(nag, 5000);
  const d = backupDays();
  if (state.history.length >= 2 && (d === null || d > 14) && Date.now() - state.backupNag > 3 * 864e5) {
    state.backupNag = Date.now(); save();
    toast(d === null ? 'Nothing backed up yet. Your data lives only on this phone' : `Last backup ${d} days ago`, { label: 'Back up', fn: doBackup });
  }
}, 4000);
// Warm the embedded fonts so the first cut doesn't wait on them.
if (banknote) setTimeout(() => banknote.noteImage('50', { value: '£0' }).catch(() => {}), 2500);
// After a rank reset, let the achievements you still qualify for pop again instead of unlocking silently.
if (justReset) setTimeout(() => processProgress(), 1700); else processProgress({ quiet: true });
note.classList.add('idle');
document.body.dataset.tab = 'split';

const boot = $('#boot');
let booted = false;
function endBoot() {
  if (booted) return; booted = true;
  boot.classList.add('gone'); document.body.classList.remove('booting');
  setTimeout(() => boot.remove(), 600);
  if (!reduce) {
    ['.note', '.freq', '.alloc', '.col-b .sec-head', '#buckets', '#addBtn', '.cutbar'].forEach((s, i) => { const el = $(s); if (el) { el.classList.add('rise'); el.style.animationDelay = (i * 70) + 'ms'; } });
    setTimeout(() => { const c = centre($('#note')); bg.pulse(c.x, c.y, .9); }, 200);
  }
}
boot.addEventListener('click', endBoot);
setTimeout(endBoot, reduce ? 0 : 1350);

pwa.registerSW(apply => toast('New version ready', { label: 'Update', fn: apply }));
if (pwa.isStandalone()) pwa.requestPersistentStorage();
setInterval(renderHeader, 60 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderHeader(); });

/* logo: slash it for fun */
let slashes = 0, slashT;
$('.hdr-brand').addEventListener('click', () => {
  const c = centre($('.hdr-brand svg'));
  slashes++; clearTimeout(slashT); slashT = setTimeout(() => { slashes = 0; }, 1200);
  Sound.play('slash', { i: slashes }); Haptics.heavy();
  fx.sparkBurst(c.x, c.y, { count: 20 + slashes * 8, power: .6 + slashes * .15 }); bg.pulse(c.x, c.y, .5 + slashes * .1);
  if (slashes === 5) { fx.flash(.5); fx.confetti(innerWidth / 2, innerHeight * .3, { count: 120 }); Sound.play('fanfare'); toast('Alright, calm down.'); slashes = 0; }
});
