import {
  state, save, compute, fmt, fmtShort, mkFormat, parseNum, esc, uid, round2, clamp,
  SHADES, FREQ, bucketTotal, nextPayday, exportJSON, replaceState, resetState,
  pending, pendingLeft, setPartDone, nextSerialN, resetProgress, justReset
} from './state.js';

/* ---------- optional modules: the app still runs if one of them fails ---------- */
const noop = () => {};
const soft = async (path, pick, fallback) => { try { const m = await import(path); return pick(m) || fallback; } catch (e) { console.warn('module failed', path, e); return fallback; } };
const Sound = await soft('./audio.js', m => m.Sound, { install: noop, play: noop, startCharge: noop, setCharge: noop, stopCharge: noop, enabled: true, ready: false });
const Haptics = await soft('./haptics.js', m => m.Haptics, { install: noop, tap: noop, light: noop, medium: noop, heavy: noop, success: noop, error: noop, tick: noop, pattern: noop, enabled: true });
const createBackground = await soft('./bg.js', m => m.createBackground, null);
const createFx = await soft('./fx.js', m => m.createFx, null);
const progress = await soft('./progress.js', m => m, null);
const openBankRun = await soft('./bankrun.js', m => m.openBankRun, null);
const createVaultDoor = await soft('./vaultdoor.js', m => m.createVaultDoor, null);
const coach = await soft('./coach.js', m => m, null);
const theme = await soft('./theme.js', m => m, null);
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
let fx = NOFX;
try { if (createFx) fx = createFx($('#fx'), { reduceMotion: reduce }) || NOFX; } catch (e) { console.warn(e); }

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
function renderNote() {
  $('#noteSym').textContent = state.cur;
  payOdo.set(fmtPayDigits(state.pay));
  $('#noteSerial').textContent = serial(nextSerialN());
  $('#exampleTag').hidden = !!state.touched;
}
const serial = n => `CC-${String(n).padStart(4, '0')}`;
function touch() { if (!state.touched) { state.touched = true; $('#exampleTag').hidden = true; } save(); }

let kp = '';
function kpRender(pop) {
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
  kp = state.pay ? String(state.pay) : '';
  $('#kpSym').textContent = state.cur;
  const seen = new Set(), quick = [];
  for (const h of state.history) { if (h.cur === state.cur && !seen.has(h.pay) && h.pay !== state.pay) { seen.add(h.pay); quick.push(h.pay); } if (quick.length >= 3) break; }
  $('#kpQuick').innerHTML = quick.map(p => `<button class="chip sm" data-pay="${p}">${esc(fmt(p))}</button>`).join('') + (kp ? `<button class="chip sm" data-pay="clear">Clear</button>` : '');
  kpRender();
  showSheet($('#keypad'), { onClose: commitKeypad });
}
function commitKeypad() {
  const v = round2(parseNum(kp));
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
  Sound.play('tap'); Haptics.light(); kpRender(true);
});
$('#kpDone').addEventListener('click', () => closeSheet());
addEventListener('keydown', e => {
  if (!openSheetRef || openSheetRef.el.id !== 'keypad') return;
  if (/^[0-9]$/.test(e.key)) kpPress(e.key);
  else if (e.key === '.' || e.key === ',') kpPress('.');
  else if (e.key === 'Backspace') kpPress('back');
  else if (e.key === 'Enter') closeSheet();
});

/* frequency */
function renderFreq() { $$('#freq .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.freq === state.freq)); }
$('#freq').addEventListener('click', e => {
  const b = e.target.closest('[data-freq]'); if (!b || b.dataset.freq === state.freq) return;
  state.freq = b.dataset.freq; Sound.play('toggle', { on: true }); Haptics.light(); touch(); renderFreq(); update(); renderHeader();
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
      <button class="swatch" aria-label="Change colour"></button>
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
    <div class="b-foot tab"><span class="b-share"></span><span class="b-goal"></span><span class="b-year"></span></div>`;
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
function update() {
  const c = compute(), mult = FREQ[state.freq];
  c.rows.forEach(r => {
    const el = cardOf(r.b.id); if (!el) return;
    amtOdos.get(r.b.id)?.set(fmt(r.amt));
    const share = c.pay ? r.amt / c.pay : 0;
    el.querySelector('.b-share').textContent = `${(share * 100).toFixed(1)}% of pay`;
    el.querySelector('.b-year').textContent = `${fmtShort(r.amt * mult)}/yr`;
    const g = el.querySelector('.b-goal');
    if (r.b.goal) {
      const got = bucketTotal(r.b.id), p = clamp(got / r.b.goal, 0, 1);
      g.innerHTML = `<span class="goal-mini"><span class="bar"><i style="width:${p * 100}%"></i></span>${Math.floor(p * 100)}%</span>`;
    } else g.textContent = '';
    const rng = el.querySelector('.b-range'), max = rangeMax(r.b, c.pay);
    if (+rng.max !== max) rng.max = max;
    rng.style.setProperty('--p', clamp(r.b.value / max * 100, 0, 100) + '%');
    el.style.setProperty('--lvl', (6 + clamp(share, 0, 1) * 94) + '%');
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

const PRESETS = {
  503020: [['Needs', 50], ['Wants', 30], ['Savings', 20]],
  saver: [['Bills', 45], ['Savings', 30], ['Investing', 15], ['Fun money', 10]],
  even: [['Bills', 25], ['Savings', 25], ['Food', 25], ['Fun', 25]]
};
$('#presets').addEventListener('click', e => {
  const p = e.target.closest('[data-preset]'); if (!p) return;
  const before = state.buckets;
  state.buckets = PRESETS[p.dataset.preset].map(([name, value], i) => ({ id: uid(), name, mode: 'pct', value, color: SHADES[i], goal: null }));
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
  $('#bsName').value = b.name; $('#bsCur').textContent = state.cur;
  $('#bsGoal').value = b.goal ? String(b.goal) : '';
  $('#bsAuto').checked = !!b.auto;
  $('#bsColors').innerHTML = SHADES.map(s => `<button style="--c:${s}" data-c="${s}" aria-label="Colour ${s}" aria-pressed="${s === b.color}"></button>`).join('');
  renderBsProgress(b);
  const del = $('#bsDelete'); del.classList.remove('armed'); del.textContent = 'Delete bucket';
  showSheet(sheet, { onClose: () => { bsId = null; renderBuckets(); queueProgress(); } });
}
function renderBsProgress(b) {
  const got = bucketTotal(b.id);
  $('#bsProgress').innerHTML = b.goal ? `<b>${fmt(got)}</b> banked of ${fmt(b.goal)} (${Math.floor(clamp(got / b.goal, 0, 1) * 100)}%). Counts every split since you made this bucket.` : got ? `<b>${fmt(got)}</b> banked here so far.` : 'Set a target and this bucket fills up as you split.';
}
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
  const before = progress ? progress.evaluate(state) : null;

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
      await fx.playSplit({ note: { rect: noteRect, amountText: fmt(c.pay), label: 'PAYCHECK', serial: serial(nextSerialN()) }, pieces, onSlash, onHit, onDone: noop });
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
  const after = progress ? progress.evaluate(state) : null;

  Sound.play('fanfare'); Haptics.success(); bg.setMood('celebrate');
  if (!reduce) { fx.confetti(innerWidth / 2, innerHeight * .42, { count: 200 }); fx.shockwave(innerWidth / 2, innerHeight * .42, { radius: Math.max(innerWidth, innerHeight) * .7 }); }
  $('#stampSub').textContent = `${fmt(c.pay)} into ${live.length} bucket${live.length === 1 ? '' : 's'}`;
  $('#stampXp').textContent = before && after ? `+${Math.round(after.xp - before.xp)} XP` : '';
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
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ICONS.star}</svg>`;

let lastLevel = progress ? progress.evaluate(state).level : 1;
function processProgress({ quiet = false } = {}) {
  if (!progress) return;
  const fresh = progress.newlyUnlocked(state) || [];
  fresh.forEach(a => { state.unlocked[a.id] = Date.now(); });
  if (fresh.length) save();
  const ev = progress.evaluate(state);
  const leveled = ev.level > lastLevel ? { from: progress.LEVELS.find(l => l.level === lastLevel)?.name || '', to: ev.levelName } : null;
  lastLevel = ev.level;
  renderHeader();
  if (quiet) return;
  if (fresh.length) $('#ranksDot').hidden = false;
  // More than three at once gets rolled up so you're not sat through 30 seconds of banners.
  const show = fresh.length > 3 ? [...fresh.slice(0, 2), { icon: 'star', name: `+${fresh.length - 2} more`, desc: fresh.slice(2).map(a => a.name).join(', ') }] : fresh;
  if (leveled) showRankUp(leveled).then(() => show.forEach(queueBanner));
  else show.forEach(queueBanner);
}
let progT;
function queueProgress() { clearTimeout(progT); progT = setTimeout(() => { if (!splitting) processProgress(); }, 700); }

const bannerQ = []; let bannerBusy = false;
function queueBanner(a) { bannerQ.push(a); if (!bannerBusy) nextBanner(); }
async function nextBanner() {
  const a = bannerQ.shift(); if (!a) { bannerBusy = false; return; }
  bannerBusy = true;
  const el = document.createElement('div'); el.className = 'banner';
  el.innerHTML = `<span class="ic">${icon(a.icon)}</span><span><span class="eyebrow">Achievement unlocked</span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span>`;
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
  if (progress) {
    const ev = progress.evaluate(state);
    $('#rankLvl').textContent = ev.level; $('#rankName').textContent = ev.levelName;
    $('#rankRing').style.strokeDashoffset = 94.25 * (1 - ev.progress);
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
    const goal = b?.goal ? `<small>Goal ${Math.floor(clamp(r.amt / b.goal, 0, 1) * 100)}% of ${esc(fmt(b.goal))}</small>` : '';
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
   RANKS
   ========================================================= */
function renderRanks() {
  if (!progress) return;
  const ev = progress.evaluate(state);
  $('#rbLvl').textContent = ev.level; $('#rankTitle').textContent = ev.levelName;
  requestAnimationFrame(() => requestAnimationFrame(() => { $('#xpFill').style.width = (ev.progress * 100) + '%'; }));
  $('#xpNow').textContent = `${Math.round(ev.xp).toLocaleString('en-GB')} XP`;
  $('#xpNext').textContent = ev.nextXp != null ? `${Math.round(ev.nextXp - ev.xp).toLocaleString('en-GB')} to ${ev.nextName}` : 'Max rank. Absolute unit.';
  const got = ev.achievements.filter(a => a.unlocked).length;
  $('#achCount').textContent = `${got} / ${ev.achievements.length}`;
  const sorted = [...ev.achievements].sort((a, b) => (b.unlocked - a.unlocked) || ((b.progress || 0) - (a.progress || 0)));
  $('#achGrid').innerHTML = sorted.map(a => {
    const secret = a.hidden && !a.unlocked;
    return `<div class="ach${a.unlocked ? ' on' : ''}"><span class="ic">${icon(secret ? 'skull' : a.icon)}</span><b>${esc(secret ? '???' : a.name)}</b><small>${esc(secret ? 'Hidden. Keep splitting.' : a.desc)}</small>${!a.unlocked && !secret ? `<div class="bar"><i style="width:${Math.round((a.progress || 0) * 100)}%"></i></div>` : ''}</div>`;
  }).join('');
  $('#ladder').innerHTML = progress.LEVELS.map(l => `<li class="${l.level < ev.level ? 'done' : l.level === ev.level ? 'cur' : ''}"><span>${l.level}</span>${esc(l.name)}<small>${l.xp.toLocaleString('en-GB')} XP</small></li>`).join('');
}

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
  if (t === 'vault') { renderVault(); openVaultDoor(); }
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
  $('#installHint').hidden = !(pwa.isIOS() && !pwa.isStandalone());
  const r = $('#resetBtn'); r.classList.remove('armed'); r.textContent = 'Reset everything';
  const rr = $('#resetRankBtn'); rr.classList.remove('armed'); rr.textContent = 'Reset rank';
  showSheet($('#settings'));
}
$('#settingsBtn').addEventListener('click', openSettings);
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
$('#exportBtn').addEventListener('click', async () => {
  const name = `clean-cut-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Clean Cut backup' }); toast('Backup exported'); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Backup exported');
});
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
    b.classList.add('armed'); b.textContent = 'Tap again. Back to Skint.'; Sound.play('error'); Haptics.medium();
    clearTimeout(rankArm); rankArm = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Reset rank'; }, 3500);
    return;
  }
  clearTimeout(rankArm); b.classList.remove('armed'); b.textContent = 'Reset rank';
  resetProgress(); lastLevel = 1;
  renderHeader(); renderRanks(); renderVault();
  Sound.play('delete'); Haptics.heavy(); toast('Rank and achievements reset. History kept.');
  setTimeout(() => processProgress(), 900);
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
  $('#noteDenom').textContent = String(key);
  $$('#notePick button').forEach(b => b.setAttribute('aria-pressed', b.dataset.note === String(key)));
  try { fxMod && fxMod.setPalette && fxMod.setPalette({ crimson: t.main, hi: t.hi, deep: t.deep, soft: t.soft, n1: t.n1, n2: t.n2, n3: t.n3 }); } catch (e) {}
  try { bg.setAccent && bg.setAccent({ crim: theme.rgb01(t.main), hi: theme.rgb01(t.hi), deep: theme.rgb01(t.deep), blood: theme.rgb01(t.blood) }); } catch (e) {}
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
function renderAll() { renderNote(); renderFreq(); renderBuckets(); renderHeader(); renderVault(); renderRanks(); renderPending(); }

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

applySettings();
renderAll();
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
