// Crimson Cut: the Transfer Run.
// The app can't move real money. After a cut you move each amount yourself in your bank
// app, then stamp the matching slip BANKED here. Until every slip is stamped the split
// stays pending. Self-contained: builds its own overlay and injects css/bankrun.css.
//
// openBankRun({ entry, fmt, Sound, Haptics, fx, bg, reduceMotion, onToggle, onScrap, onClose }) -> { close(result?) }

const STYLE_ID = 'cc-bankrun-css';
const THRESH = 0.45;        // share of slip width you drag before letting go stamps it
const FLICK = 0.9;          // px/ms: a fast flick past half the threshold also counts
const MAX_PILE = 8;         // slips gathered into the finale pile
const INK = '#DC143C';
const INK_HI = '#FF3A5C';
const RESULTS = new Set(['later', 'complete', 'scrapped']);

const noop = () => {};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pad2 = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const centreOf = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const warn = e => { try { console.warn('[bankrun]', e); } catch (_) { /* ignore */ } };
const mq = q => { try { return matchMedia(q).matches; } catch (_) { return false; } };

/* ---------- stylesheet ---------- */
let cssReady = null;
function ensureCss() {
  if (cssReady) return cssReady;
  cssReady = new Promise(res => {
    try {
      const href = new URL('../css/bankrun.css', import.meta.url).href;
      const have = document.getElementById(STYLE_ID) || [...document.querySelectorAll('link[rel~="stylesheet"]')].find(l => l.href === href);
      const done = () => res();
      if (have) {
        if (have.sheet) return res();
        have.addEventListener('load', done); have.addEventListener('error', done);
        setTimeout(done, 1500); return;
      }
      const l = document.createElement('link');
      l.id = STYLE_ID; l.rel = 'stylesheet'; l.href = href;
      l.addEventListener('load', done); l.addEventListener('error', done);
      (document.head || document.documentElement).appendChild(l);
      setTimeout(done, 2000);
    } catch (e) { warn(e); res(); }
  });
  return cssReady;
}
try { if (typeof document !== 'undefined') ensureCss(); } catch (_) { /* ignore */ }

/* ---------- money helpers ---------- */
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function words(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + words(n % 100) : '');
  for (const [v, w] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (n >= v) { const hi = Math.floor(n / v), lo = n % v; return words(hi) + ' ' + w + (lo ? (lo < 100 ? ' and ' : ' ') + words(lo) : ''); }
  }
  return String(n);
}
const UNITS = { '£': ['pound', 'pounds', 'p'], '$': ['dollar', 'dollars', 'c'], '€': ['euro', 'euros', 'c'] };
function amountWords(amt, sym) {
  try {
    const u = UNITS[sym]; if (!u || !(amt >= 0) || amt >= 1e12) return '';
    const cents = Math.round(amt * 100), whole = Math.floor(cents / 100), frac = cents % 100;
    const s = words(whole) + ' ' + (whole === 1 ? u[0] : u[1]) + (frac ? ` and ${frac}${u[2]}` : ' only');
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch (_) { return ''; }
}
// '£1,234.56' -> { pre: '£', int: '1,234', dec: '.56', post: '' }
function splitMoney(str) {
  const s = String(str);
  const a = s.search(/\d/);
  if (a < 0) return { pre: '', int: s, dec: '', post: '' };
  let b = s.length - 1; while (b > a && !/\d/.test(s[b])) b--;
  const core = s.slice(a, b + 1);
  const m = /^(.*?)([.,]\d{2})$/.exec(core);
  return { pre: s.slice(0, a).trim(), int: m ? m[1] : core, dec: m ? m[2] : '', post: s.slice(b + 1).trim() };
}
const timeFmt = (() => { try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return null; } })();
const dayFmt = (() => { try { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }); } catch (_) { return null; } })();
const fmtTime = d => { try { return timeFmt ? timeFmt.format(d) : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; } catch (_) { return ''; } };
const fmtDay = t => { try { return dayFmt && t ? dayFmt.format(new Date(t)) : ''; } catch (_) { return ''; } };
const safeColor = c => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : INK);

/* ---------- odometer (same feel as the app's) ---------- */
const DIGITS = '<b>0</b><b>1</b><b>2</b><b>3</b><b>4</b><b>5</b><b>6</b><b>7</b><b>8</b><b>9</b>';
const isD = ch => ch >= '0' && ch <= '9';
function odo(el, reduce) {
  let chars = [];
  function build(arr, prev) {
    el.textContent = '';
    arr.forEach((ch, i) => {
      if (isD(ch)) {
        const c = document.createElement('span'); c.className = 'c';
        const s = document.createElement('span'); s.innerHTML = DIGITS; c.appendChild(s); el.appendChild(c);
        const p = prev[i - arr.length + prev.length];
        s.style.transition = 'none'; s.style.transform = `translateY(${-(isD(p || '') ? +p : 0)}em)`;
      } else {
        const s = document.createElement('span'); s.className = 's' + (/[£$€]/.test(ch) ? ' cur' : ''); s.textContent = ch; el.appendChild(s);
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
        const s = cols[i] && cols[i].firstChild; if (!s) return;
        s.style.transition = reduce ? 'none' : '';
        s.style.transitionDelay = reduce ? '0s' : ((n - i) * 24) + 'ms';
        s.style.transform = `translateY(${-ch}em)`;
      });
      chars = arr;
    }
  };
}

/* ---------- icons ---------- */
const SV = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const IC = {
  copy: SV('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>', ' class="ic-copy"'),
  tick: SV('<path d="M4.5 12.5 9.5 17.5 19.5 6.5" pathLength="1"/>', ' class="ic-tick" stroke-width="3"'),
  stamp: SV('<path d="M9.5 3.5h5v3.2c0 1-.4 1.8-1.1 2.4l-.4.4V13h5.5a2 2 0 0 1 2 2v2.5H3.5V15a2 2 0 0 1 2-2H11V9.5l-.4-.4a3.2 3.2 0 0 1-1.1-2.4z"/><path d="M4 21h16"/>'),
  phone: SV('<rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M10.5 18.5h3"/><path d="M9.5 9.5h5M12 7v5"/>')
};

/* ---------- entry point ---------- */
let current = null;

export function openBankRun(opts) {
  try { return createRun(opts && typeof opts === 'object' ? opts : {}); }
  catch (e) {
    warn(e);
    setTimeout(() => { try { opts && typeof opts.onClose === 'function' && opts.onClose('later'); } catch (_) { /* ignore */ } }, 0);
    return { close: noop };
  }
}
export default openBankRun;

function createRun(o) {
  if (current) { try { current.close('later', true); } catch (_) { /* ignore */ } }

  /* ----- engines, all failure-proof ----- */
  const call = (obj, m, ...a) => { try { if (obj && typeof obj[m] === 'function') return obj[m](...a); } catch (e) { warn(e); } };
  const snd = (n, x) => call(o.Sound, 'play', n, x);
  const hap = m => call(o.Haptics, m);
  const fx = (m, ...a) => call(o.fx, m, ...a);
  const bg = (m, ...a) => call(o.bg, m, ...a);
  const cb = (name, ...a) => { try { if (typeof o[name] === 'function') o[name](...a); } catch (e) { warn(e); } };
  const reduce = !!o.reduceMotion || mq('(prefers-reduced-motion: reduce)');
  const fmt = n => {
    try { const s = typeof o.fmt === 'function' ? o.fmt(n) : null; if (typeof s === 'string' && s) return s; } catch (_) { /* fall through */ }
    return '£' + (+n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  /* ----- data ----- */
  const entry = o.entry && typeof o.entry === 'object' ? o.entry : {};
  const serial = String(entry.serial || 'CC-0000');
  const parts = (Array.isArray(entry.parts) ? entry.parts : []).map((p, i) => {
    p = p && typeof p === 'object' ? p : {};
    const auto = !!p.auto;
    return { i, name: String(p.name || 'Untitled').trim() || 'Untitled', amt: Math.max(0, Math.round((+p.amt || 0) * 100) / 100), color: safeColor(p.color), auto, done: !!(p.done || auto), at: null, busy: false, rot: +rnd(-12, -5).toFixed(1) };
  });
  const N = parts.length;
  const total = Math.round(parts.reduce((s, p) => s + p.amt, 0) * 100) / 100;
  const bankedAmt = () => Math.round(parts.reduce((s, p) => s + (p.done ? p.amt : 0), 0) * 100) / 100;
  const leftN = () => parts.filter(p => !p.done).length;
  const allDone = () => parts.every(p => p.done);
  const allAuto = N > 0 && parts.every(p => p.auto);
  const t0 = Date.now();

  /* ----- lifecycle bits ----- */
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { warn(e); } }, ms); timers.add(id); return id; };
  const cancel = id => { clearTimeout(id); timers.delete(id); };
  const sleep = ms => new Promise(r => later(r, ms));
  const guard = fn => (...a) => { try { const r = fn(...a); if (r && typeof r.catch === 'function') r.catch(warn); return r; } catch (e) { warn(e); } };
  const anim = (el, frames, opt) => { try { return el && el.animate ? el.animate(frames, opt) : null; } catch (e) { warn(e); return null; } };
  let closing = false, finaleOn = false, locked = false, drag = null, suppressClick = false;
  let reorderT = 0, lastStamped = null, scrapArmed = false, scrapT = 0, pctShown = 0, pctRaf = 0, pileY = 0;
  const prevFocus = document.activeElement;
  const html = document.documentElement;
  const prevOverflow = html.style.overflow;

  /* ----- DOM ----- */
  const segs = parts.map(p => `<i class="br-seg${p.auto ? ' auto' : ''}" style="flex:${Math.max(p.amt, total * 0.02, 0.01)}"></i>`).join('');
  const root = document.createElement('div');
  root.className = 'br' + (reduce ? ' rm' : '');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', `Transfer run ${serial}`);
  root.tabIndex = -1;
  root.style.visibility = 'hidden';
  const day = fmtDay(entry.t);
  root.innerHTML = `
    <div class="br-bd" aria-hidden="true"></div>
    <div class="br-shell">
      <div class="br-scroll">
        <header class="br-hero">
          <div class="br-top"><span class="br-eye"><i></i>Transfer run</span><span class="br-serial">${esc(serial)}${day ? ' · ' + esc(day) : ''}</span></div>
          <h1 class="br-title">Move the <em>money.</em></h1>
        </header>
        <div class="br-dockwrap"><section class="br-dock" aria-label="Progress">
          <div class="br-read"><span class="br-odo" aria-hidden="true"></span><span class="br-pct" aria-hidden="true"><b>0</b><small>%</small></span></div>
          <div class="br-of"><span class="br-ofl">of <b>${esc(fmt(total))}</b> banked</span><span class="br-left"></span></div>
          <div class="br-bar" aria-hidden="true">${segs}</div>
        </section></div>
        <p class="br-tip">${IC.phone}<span>Open your bank app, move each amount, then <b>swipe the slip right</b> to stamp it.</span></p>
        <div class="br-list"></div>
      </div>
      <footer class="br-foot">
        <button type="button" class="br-scrap">Scrap this split</button>
        <button type="button" class="br-later">Later<small>Split stays pending</small></button>
      </footer>
    </div>
    <div class="br-pile" aria-hidden="true"></div>
    <div class="br-fin" hidden>
      <div class="fin-stamp" aria-hidden="true"><div class="fin-ink"><span>Banked.</span></div></div>
      <div class="fin-copy">
        <span class="br-eye"><i></i>${esc(serial)} · run complete</span>
        <p class="fin-sub"></p>
        <p class="fin-stats"></p>
        <button type="button" class="br-btn fin-nice">Nice</button>
        <button type="button" class="fin-undo" hidden>Hang on, undo that last one</button>
      </div>
    </div>
    <div class="br-sr" aria-live="polite"></div>`;
  const $ = s => root.querySelector(s);
  const list = $('.br-list'), dock = $('.br-dock'), dockWrap = $('.br-dockwrap'), scroller = $('.br-scroll');
  const pctEl = $('.br-pct b'), leftEl = $('.br-left'), odoEl = $('.br-odo');
  const segEls = [...root.querySelectorAll('.br-seg')];
  const pile = $('.br-pile'), fin = $('.br-fin'), live = $('.br-sr');
  const scrapBtn = $('.br-scrap'), laterBtn = $('.br-later');
  const amtOdo = odo(odoEl, reduce);

  const divider = document.createElement('div');
  divider.className = 'br-div';
  divider.setAttribute('role', 'separator');

  parts.forEach(p => {
    const m = splitMoney(fmt(p.amt));
    const no = `${serial}-${pad2(p.i + 1)}`;
    const plain = p.amt.toFixed(2);
    const el = document.createElement('article');
    el.className = 'br-slip' + (p.auto ? ' auto' : '') + (p.done ? ' banked' : '');
    el.dataset.i = String(p.i);
    el.style.setProperty('--c', p.color);
    el.style.setProperty('--rot', p.rot + 'deg');
    el.innerHTML = `
      <div class="slip-track">
        <div class="slip-under" aria-hidden="true"><span class="under-ic">${IC.stamp}</span><span class="under-t"><b>Stamp it</b><i>Let go</i></span></div>
        <div class="slip-body">
          <div class="slip-paper">
            <span class="slip-guil" aria-hidden="true"></span>
            <i class="slip-stripe" aria-hidden="true"></i>
            <div class="slip-main">
              <div class="slip-r1"><span class="slip-kind">Transfer slip</span><span class="slip-no">No. ${esc(no)}</span></div>
              <div class="slip-payee"><small>Pay to</small><b>${esc(p.name)}</b></div>
              <div class="slip-amt" aria-hidden="true">${m.pre ? `<span class="sym">${esc(m.pre)}</span>` : ''}<span class="int">${esc(m.int)}</span>${m.dec ? `<span class="dec">${esc(m.dec)}</span>` : ''}${m.post ? `<span class="sym post">${esc(m.post)}</span>` : ''}</div>
              <div class="slip-words" aria-hidden="true">${esc(amountWords(p.amt, m.pre || m.post) || 'Crimson Cut transfer slip')}</div>
              <div class="slip-acts">
                <button type="button" class="slip-copy" data-act="copy" aria-label="Copy ${esc(plain)}, the amount for ${esc(p.name)}">${IC.copy}${IC.tick}<span>Copy amount</span></button>
                <button type="button" class="slip-go" data-act="stamp" aria-label="Stamp ${esc(p.name)} as banked">${IC.stamp}<span>Stamp it</span></button>
                <button type="button" class="slip-ask" data-act="ask" aria-label="Unstamp ${esc(p.name)}">Undo stamp</button>
                <span class="slip-note"><b>Moves on its own.</b><br>Standing order's got this one.</span>
              </div>
            </div>
            <div class="slip-stub" aria-hidden="true"><b>${pad2(p.i + 1)}</b><small>of ${pad2(N)}</small><span class="stub-v">${esc(no)}</span><i class="stub-bar"></i></div>
          </div>
          <div class="slip-stamp" aria-hidden="true"><div class="stamp-ink"><b>${p.auto ? 'Auto' : 'Banked'}</b><small>${p.auto ? 'Standing order' : esc(no)}</small></div></div>
          <div class="slip-blots" aria-hidden="true"></div>
        </div>
      </div>
      <div class="slip-confirm"><div><div class="conf-in"><span>Unstamp this one?</span><button type="button" class="conf-keep" data-act="keep">Keep it</button><button type="button" class="conf-go" data-act="unstamp">Unstamp</button></div></div></div>`;
    p.el = el;
    p.body = el.querySelector('.slip-body');
    p.stampEl = el.querySelector('.slip-stamp');
    p.stampSmall = el.querySelector('.stamp-ink small');
    p.blotsEl = el.querySelector('.slip-blots');
    p.seg = segEls[p.i];
    labelSlip(p);
  });
  const partOf = el => { const s = el && el.closest && el.closest('.br-slip'); return s && s.dataset.i != null ? parts[+s.dataset.i] : null; };

  function labelSlip(p) {
    p.el.setAttribute('aria-label', `${p.name}, ${fmt(p.amt)}, ${p.auto ? 'moves automatically' : p.done ? 'banked' : 'not banked yet'}`);
  }
  function announce(msg) { try { live.textContent = ''; later(() => { live.textContent = msg; }, 30); } catch (_) { /* ignore */ } }

  /* ----- order ----- */
  const desired = () => [...parts.filter(p => !p.done), ...parts.filter(p => p.done)];
  function updateDivider() {
    const d = N - leftN();
    divider.hidden = !d || !leftN();
    divider.innerHTML = `Banked <b>${d}</b> of ${N}`;
  }
  function placeAll() {
    const want = desired(), pend = want.filter(p => !p.done).length;
    [...want.slice(0, pend).map(p => p.el), divider, ...want.slice(pend).map(p => p.el)].forEach(el => list.appendChild(el));
    updateDivider();
  }
  placeAll();

  /* ----- progress readout ----- */
  function setPct(target, animate) {
    cancelAnimationFrame(pctRaf);
    if (!animate || reduce) { pctShown = target; pctEl.textContent = String(target); return; }
    const from = pctShown, ts = performance.now(), dur = 750;
    const step = now => {
      const k = clamp((now - ts) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
      pctShown = Math.round(from + (target - from) * e); pctEl.textContent = String(pctShown);
      if (k < 1 && !closing) pctRaf = requestAnimationFrame(step);
    };
    pctRaf = requestAnimationFrame(step);
  }
  function renderProgress(hit, animate = true) {
    const b = bankedAmt(), n = leftN();
    amtOdo.set(fmt(b));
    setPct(allDone() ? 100 : total > 0 ? Math.min(99, Math.floor(b / total * 100)) : 0, animate);
    leftEl.textContent = n ? `${n} slip${n === 1 ? '' : 's'} left` : 'All banked';
    leftEl.classList.toggle('zero', !n);
    parts.forEach(p => p.seg && p.seg.classList.toggle('on', p.done));
    if (hit && hit.seg && !reduce) { hit.seg.classList.remove('hit'); void hit.seg.offsetWidth; hit.seg.classList.add('hit'); }
    if (hit && !reduce) { dock.classList.remove('bump'); void dock.offsetWidth; dock.classList.add('bump'); }
  }

  /* ----- open ----- */
  document.body.appendChild(root);
  try { html.style.overflow = 'hidden'; } catch (_) { /* ignore */ }
  addEventListener('keydown', onKey, true);
  addEventListener('resize', onResize);

  ensureCss().then(guard(() => {
    if (closing) return;
    root.style.visibility = '';
    try { root.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    renderProgress(null, false);
    if (allDone()) { finale({ instant: true }); return; }
    snd('open');
    deal();
  }));

  function deal() {
    if (reduce) return;
    const H = innerHeight;
    const slips = [...list.children].filter(el => el.classList.contains('br-slip'));
    let k = 0;
    slips.forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top > H + 20) return;
      const delay = 240 + k * 95, side = k % 2 ? 1 : -1;
      anim(el, [
        { transform: `translate(${(side * rnd(18, 46)).toFixed(0)}px, ${(H - r.top + 60).toFixed(0)}px) rotate(${(side * rnd(8, 16)).toFixed(1)}deg) scale(.94)` },
        { transform: 'translate(0,-6px) rotate(0deg) scale(1.01)', offset: .78 },
        { transform: 'none' }
      ], { duration: 680, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
      const kk = k;
      later(() => { snd('tick', { v: clamp(.25 + kk * .14, 0, 1) }); hap('tick'); }, delay + 70);
      k++;
    });
    if (!divider.hidden) anim(divider, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 240 + k * 95, fill: 'backwards' });
  }

  /* ----- drag to stamp ----- */
  const rubber = (d, max) => max * (1 - 1 / (d / max + 1));
  function onDown(e) {
    if (closing || finaleOn || locked || drag || (e.button != null && e.button > 0) || e.isPrimary === false) return;
    if (e.target.closest('button, .slip-confirm')) return;
    const p = partOf(e.target); if (!p || p.done || p.busy) return;
    drag = { p, id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, w: p.body.offsetWidth || 320, x: 0, prog: 0, step: 0, lx: e.clientX, lt: performance.now(), vx: 0 };
  }
  function onMove(e) {
    const d = drag; if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.1) return;
      d.active = true;
      try { d.p.body.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      d.p.el.classList.add('dragging');
      d.p.body.style.transition = 'none';
      hideConfirms();
      hap('light');
    }
    if (e.cancelable) e.preventDefault();
    const now = performance.now(), dt = Math.max(1, now - d.lt);
    d.vx = d.vx * .6 + ((e.clientX - d.lx) / dt) * .4; d.lx = e.clientX; d.lt = now;
    const T = d.w * THRESH;
    const x = dx < 0 ? -rubber(-dx, 34) : dx <= T ? dx * .94 : T * .94 + rubber(dx - T, d.w * .32);
    const prog = clamp(dx / T, 0, 1);
    d.x = x; d.prog = prog;
    d.p.body.style.transform = `translate3d(${x.toFixed(1)}px,0,0) rotate(${(x * .012).toFixed(2)}deg)`;
    d.p.el.style.setProperty('--p', prog.toFixed(3));
    const step = Math.min(4, Math.floor(prog * 4 + 1e-6));
    if (step !== d.step) {
      if (step > d.step) {
        if (step >= 4) { hap('medium'); snd('toggle', { on: true }); }
        else { hap('tick'); snd('tick', { v: prog }); }
      } else if (d.step >= 4) { hap('light'); snd('toggle', { on: false }); }
      d.step = step;
      d.p.el.classList.toggle('armed', step >= 4);
    }
  }
  function onUp(e) {
    const d = drag; if (!d || e.pointerId !== d.id) return;
    drag = null;
    if (!d.active) return;
    suppressClick = true; later(() => { suppressClick = false; }, 80);
    try { d.p.body.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    d.p.el.classList.remove('dragging', 'armed');
    const flick = d.vx > FLICK && d.prog > .5;
    if (e.type === 'pointerup' && (d.prog >= 1 || flick) && !closing && !finaleOn) stamp(d.p, 'drag');
    else springBack(d.p);
  }
  function springBack(p) {
    const b = p.body;
    b.style.transition = reduce ? 'none' : 'transform .55s cubic-bezier(.34,1.56,.64,1)';
    b.style.transform = '';
    p.el.style.setProperty('--p', '0');
    later(() => { b.style.transition = ''; }, 580);
  }

  /* ----- the slam ----- */
  async function stamp(p, from = 'button') {
    if (closing || finaleOn || locked || !p || p.done || p.busy) return;
    p.busy = true;
    hideConfirms();
    cancel(reorderT);
    p.done = true; p.at = new Date(); lastStamped = p;
    p.stampSmall.textContent = fmtTime(p.at) ? `${fmtTime(p.at)} · ${fmtDay(p.at)}` : 'Banked';
    cb('onToggle', p.i, true);
    labelSlip(p);
    const { el, body, stampEl: st } = p;
    const hadFocus = el.contains(document.activeElement);
    const dragged = body.style.transform;
    body.style.transition = 'none'; body.style.transform = '';
    el.classList.remove('dragging', 'armed', 'peek');
    el.classList.add('banked');
    el.style.setProperty('--p', '1');
    if (hadFocus) refocus(p);
    if (reduce) { impact(p); p.busy = false; afterStamp(); return; }
    if (dragged) anim(body, [{ transform: dragged }, { transform: 'none' }], { duration: 190, easing: 'cubic-bezier(.2,.9,.25,1)' });
    const r = p.rot;
    const S = (sc, rot, x) => Object.assign({ transform: `translate(-50%,-50%) rotate(${rot}deg) scale(${sc})` }, x);
    const drg = from === 'drag';
    const dur = drg ? 380 : 310, hitAt = drg ? .62 : .56;
    anim(st, drg ? [
      S(1.12, r, { opacity: .95, filter: 'blur(0px)', easing: 'cubic-bezier(.2,.8,.3,1)' }),
      S(2.5, r - 16, { opacity: .5, filter: 'blur(2px)', offset: .27, easing: 'cubic-bezier(.8,0,1,.6)' }),
      S(.88, r, { opacity: 1, filter: 'blur(0px)', offset: hitAt, easing: 'cubic-bezier(.2,1.9,.4,1)' }),
      S(1, r, { opacity: 1, filter: 'blur(0px)' })
    ] : [
      S(2.6, r - 20, { opacity: 0, filter: 'blur(3px)', easing: 'cubic-bezier(.8,0,1,.6)' }),
      S(.88, r, { opacity: 1, filter: 'blur(0px)', offset: hitAt, easing: 'cubic-bezier(.2,1.9,.4,1)' }),
      S(1, r, { opacity: 1, filter: 'blur(0px)' })
    ], { duration: dur });
    await sleep(dur * hitAt);
    if (closing) return;
    impact(p);
    await sleep(dur * (1 - hitAt) + 30);
    p.busy = false;
    afterStamp();
  }
  function impact(p) {
    const c = centreOf(p.stampEl);
    snd('thump'); hap('heavy');
    const k = parts.filter(x => x.done && !x.auto).length;
    later(() => snd('coin', { i: Math.max(0, k - 1) }), 110);
    fx('sparkBurst', c.x, c.y, { color: INK, count: 32, power: .85 });
    fx('shockwave', c.x, c.y, { color: INK_HI, radius: 120 });
    bg('pulse', c.x, c.y, .9);
    if (!reduce) {
      anim(p.body, [
        { transform: 'none' },
        { transform: 'translateY(5px) scale(.972,.955)', offset: .22 },
        { transform: 'translateY(-2px) scale(1.006)', offset: .58 },
        { transform: 'none' }
      ], { duration: 380, easing: 'ease-out' });
      blots(p);
      root.classList.remove('jolt'); void root.offsetWidth; root.classList.add('jolt');
    }
    const n = leftN();
    announce(`${p.name} stamped banked. ${n ? `${n} slip${n === 1 ? '' : 's'} left.` : 'All banked.'}`);
    flyPlus(p, c, () => renderProgress(p));
  }
  function refocus(p) {
    try {
      const next = parts.find(x => !x.done && x !== p);
      (next ? next.el.querySelector('.slip-go') : root).focus({ preventScroll: true });
    } catch (_) { /* ignore */ }
  }
  function afterStamp() {
    if (closing) return;
    if (allDone()) { cancel(reorderT); reorderT = later(() => finale({}), reduce ? 250 : 640); }
    else scheduleReorder();
  }
  function blots(p) {
    try {
      const br = p.body.getBoundingClientRect(), sr = p.stampEl.getBoundingClientRect();
      const cx = sr.left + sr.width / 2 - br.left, cy = sr.top + sr.height / 2 - br.top;
      const rx = sr.width / 2, ry = sr.height / 2, n = 8 + (Math.random() * 5 | 0);
      let h = '';
      for (let k = 0; k < n; k++) {
        const a = rnd(0, Math.PI * 2), f = rnd(.82, 1.4);
        const x = cx + Math.cos(a) * rx * f, y = cy + Math.sin(a) * ry * f;
        const streak = k >= n - 3, big = k < 2;
        const w = streak ? rnd(12, 24) : big ? rnd(7, 11) : rnd(2, 6.5), hh = streak ? rnd(2, 3.4) : w * rnd(.8, 1.15);
        h += `<i class="blot${streak ? ' s' : ''}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${w.toFixed(1)}px;height:${hh.toFixed(1)}px;--a:${a.toFixed(2)}rad;animation-delay:${(rnd(0, 60) | 0)}ms"></i>`;
      }
      p.blotsEl.innerHTML = h;
    } catch (e) { warn(e); }
  }
  function flyPlus(p, from, done) {
    let fired = false;
    const go = () => { if (!fired && !closing) { fired = true; done(); } };
    if (reduce) return go();
    try {
      const chip = document.createElement('span');
      chip.className = 'br-fly'; chip.textContent = '+' + fmt(p.amt);
      root.appendChild(chip);
      const to = centreOf(odoEl);
      const tx = to.x - from.x, ty = to.y - from.y;
      chip.style.left = from.x + 'px'; chip.style.top = from.y + 'px';
      const a = anim(chip, [
        { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
        { transform: `translate(calc(-50% + ${(tx * .1).toFixed(0)}px), calc(-50% - 46px)) scale(1.18)`, opacity: 1, offset: .26 },
        { transform: `translate(calc(-50% + ${tx.toFixed(0)}px), calc(-50% + ${ty.toFixed(0)}px)) scale(.5)`, opacity: .85 }
      ], { duration: 760, easing: 'cubic-bezier(.55,0,.35,1)', delay: 40 });
      const end = () => { try { chip.remove(); } catch (_) { /* ignore */ } go(); };
      if (a) a.onfinish = end;
      later(end, 900);
    } catch (e) { warn(e); go(); }
  }

  /* ----- unstamp ----- */
  function showConfirm(p) {
    hideConfirms(p);
    p.el.classList.add('confirming');
    cancel(p.confirmT); p.confirmT = later(() => hideConfirm(p), 5000);
    snd('tap'); hap('light');
    later(() => {
      try { p.el.querySelector('.conf-keep').focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      try { p.el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); } catch (_) { /* ignore */ }
    }, reduce ? 0 : 360);
  }
  function hideConfirm(p) { if (p && p.el) { p.el.classList.remove('confirming'); cancel(p.confirmT); } }
  function hideConfirms(except) { parts.forEach(p => { if (p !== except) hideConfirm(p); }); }
  async function unstamp(p) {
    if (closing || finaleOn || locked || !p || !p.done || p.auto || p.busy) return;
    p.busy = true;
    hideConfirm(p);
    cancel(reorderT);
    p.done = false; p.at = null;
    if (lastStamped === p) lastStamped = null;
    cb('onToggle', p.i, false);
    labelSlip(p);
    snd('whoosh', { dur: .3 }); hap('medium');
    const r = p.rot;
    if (!reduce) {
      anim(p.stampEl, [
        { transform: `translate(-50%,-50%) rotate(${r}deg) scale(1)`, opacity: 1, filter: 'blur(0px)' },
        { transform: `translate(-50%,-50%) rotate(${r + 4}deg) scale(.94)`, opacity: 1, filter: 'blur(0px)', offset: .18 },
        { transform: `translate(-50%,-50%) rotate(${r - 22}deg) scale(2.5)`, opacity: 0, filter: 'blur(4px)' }
      ], { duration: 460, easing: 'cubic-bezier(.3,0,.5,1)' });
      anim(p.blotsEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease-in' });
    }
    p.el.classList.remove('banked');
    p.el.style.setProperty('--p', '0');
    renderProgress(null);
    announce(`${p.name} unstamped. ${leftN()} slip${leftN() === 1 ? '' : 's'} left.`);
    await sleep(reduce ? 0 : 460);
    p.blotsEl.innerHTML = '';
    p.stampSmall.textContent = `${serial}-${pad2(p.i + 1)}`;
    p.busy = false;
    scheduleReorder(160);
  }

  /* ----- FLIP reorder: pending up top, banked sink ----- */
  function scheduleReorder(ms = 620) { cancel(reorderT); reorderT = later(reorder, reduce ? 0 : ms); }
  function reorder() {
    if (closing || finaleOn) return;
    if ((drag && drag.active) || parts.some(p => p.busy)) { scheduleReorder(260); return; }
    const want = desired(), pend = want.filter(p => !p.done).length;
    const seq = [...want.slice(0, pend).map(p => p.el), divider, ...want.slice(pend).map(p => p.el)];
    const cur = [...list.children];
    const divWas = divider.hidden;
    updateDivider();
    if (seq.length === cur.length && seq.every((el, k) => el === cur[k]) && divWas === divider.hidden) return;
    const active = document.activeElement;
    const hadFocus = active && list.contains(active);
    const first = new Map(seq.map(el => [el, el.getBoundingClientRect().top]));
    seq.forEach(el => list.appendChild(el));
    if (hadFocus) {
      const next = parts.find(p => !p.done);
      try { (list.contains(active) && active.offsetParent ? active : next ? next.el.querySelector('.slip-go') : laterBtn).focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }
    if (reduce) return;
    let moved = false;
    seq.forEach(el => {
      if (el === divider) { if (!divider.hidden && divWas) anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: 200, fill: 'backwards' }); if (divider.hidden || divWas) return; }
      const dy = first.get(el) - el.getBoundingClientRect().top;
      if (!isFinite(dy) || Math.abs(dy) < 1) return;
      const far = Math.abs(dy) > 140;
      if (far) { moved = true; el.classList.add('flying'); later(() => el.classList.remove('flying'), 640); }
      anim(el, far ? [
        { transform: `translateY(${dy}px)` },
        { transform: `translateY(${(dy * .45).toFixed(0)}px) scale(.96) rotate(${dy > 0 ? -1.2 : 1.2}deg)`, offset: .45 },
        { transform: 'none' }
      ] : [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: far ? 620 : 520, easing: 'cubic-bezier(.2,.9,.25,1)' });
    });
    if (moved) snd('whoosh', { dur: .3 });
  }

  /* ----- copy amount ----- */
  async function copyAmt(p, btn) {
    if (!btn || btn.classList.contains('copied')) return;
    const text = p.amt.toFixed(2);
    let ok = false;
    try { if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') { await navigator.clipboard.writeText(text); ok = true; } } catch (_) { ok = false; }
    if (!ok) ok = fallbackCopy(text);
    if (closing) return;
    const lbl = btn.querySelector('span');
    if (ok && !btn.style.width) btn.style.width = btn.offsetWidth + 'px';
    btn.classList.remove('copied', 'nocopy'); void btn.offsetWidth;
    btn.classList.add(ok ? 'copied' : 'nocopy');
    lbl.textContent = ok ? 'Copied' : `Copy failed. It's ${text}`;
    if (ok) {
      const ic = btn.querySelector('.ic-tick') || btn, c = centreOf(ic);
      fx('sparkBurst', c.x, c.y, { color: INK_HI, count: 10, power: .3 });
      snd('pop'); hap('light');
      announce(`Copied ${text}`);
    } else { snd('error'); hap('error'); }
    cancel(p.copyT);
    p.copyT = later(() => { btn.classList.remove('copied', 'nocopy'); btn.style.width = ''; lbl.textContent = 'Copy amount'; }, ok ? 1800 : 3500);
  }
  function fallbackCopy(text) {
    let inp = null;
    const had = document.activeElement;
    try {
      inp = document.createElement('input');
      inp.value = text; inp.readOnly = true; inp.tabIndex = -1;
      inp.setAttribute('aria-hidden', 'true');
      inp.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;';
      root.appendChild(inp);
      inp.focus({ preventScroll: true }); inp.select(); inp.setSelectionRange(0, text.length);
      return !!(document.execCommand && document.execCommand('copy'));
    } catch (_) { return false; }
    finally {
      try { if (inp) inp.remove(); } catch (_) { /* ignore */ }
      try { if (had && had.focus && root.contains(had)) had.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }
  }

  /* ----- little touches ----- */
  function nudge(p) {
    if (p.busy) return;
    hap('light'); snd('tap');
    if (reduce) return;
    p.el.classList.add('peek'); later(() => p.el.classList.remove('peek'), 820);
    anim(p.body, [
      { transform: 'none' },
      { transform: 'translateX(54px) rotate(.7deg)', offset: .32, easing: 'cubic-bezier(.3,0,.2,1)' },
      { transform: 'translateX(-5px)', offset: .74 },
      { transform: 'none' }
    ], { duration: 780, easing: 'ease-out' });
  }
  function wiggle(p) {
    hap('light'); snd('tap');
    if (reduce) return;
    anim(p.body, [{ transform: 'none' }, { transform: 'rotate(-1.2deg)' }, { transform: 'rotate(1deg)' }, { transform: 'none' }], { duration: 360, easing: 'ease-in-out' });
  }

  /* ----- finale ----- */
  function measurePile() {
    pileY = Math.round(clamp(innerHeight * .39, 170, 400));
    root.style.setProperty('--py', pileY + 'px');
  }
  function buildPile(instant) {
    pile.textContent = '';
    const els = [...list.querySelectorAll('.br-slip')];
    const sel = els.slice(0, MAX_PILE);
    const n = sel.length, W = innerWidth;
    let ph = 120;
    sel.forEach((el, k) => {
      const r = el.getBoundingClientRect();
      const paper = el.querySelector('.slip-paper'), pr = paper ? paper.getBoundingClientRect() : r;
      const c = el.cloneNode(true);
      c.removeAttribute('data-i'); c.removeAttribute('aria-label');
      c.classList.remove('confirming', 'dragging', 'armed', 'peek', 'flying');
      c.querySelectorAll('button').forEach(b => { b.tabIndex = -1; });
      c.style.left = pr.left + 'px'; c.style.top = pr.top + 'px'; c.style.width = pr.width + 'px';
      c.style.zIndex = String(k + 1);
      c.style.transformOrigin = `50% ${pr.height / 2}px`;
      pile.appendChild(c);
      const s = Math.min(.84, (W - 44) / pr.width);
      ph = pr.height * s;
      const top = k === n - 1;
      const rot = top ? rnd(-2.5, 2.5) : rnd(-8, 8);
      const tx = W / 2 - (pr.left + pr.width / 2);
      const ty = pileY - (pr.top + pr.height / 2) - k * 3.2 + (n - 1) * 1.6;
      const end = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${s.toFixed(3)})`;
      c.style.transform = end;
      if (!instant && !reduce) {
        const delay = k * 75;
        anim(c, [
          { transform: 'none' },
          { transform: `translate(${(tx * .7).toFixed(1)}px, ${(ty * .7 - 26).toFixed(1)}px) rotate(${(rot * 2.2).toFixed(1)}deg) scale(${(s * 1.03).toFixed(3)})`, offset: .62 },
          { transform: end }
        ], { duration: 600, delay, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'backwards' });
        later(() => { snd('tick', { v: .2 + (k / Math.max(1, n)) * .6 }); hap('tick'); }, delay + 560);
      }
    });
    fin.style.setProperty('--ph2', Math.round(ph / 2) + 'px');
    return n;
  }
  async function finale({ instant = false }) {
    if (closing || finaleOn || !allDone()) return;
    finaleOn = true;
    cancel(reorderT); hideConfirms();
    if (drag) { springBack(drag.p); drag = null; }
    measurePile();
    root.classList.add('fin-prep');
    if (!instant && !reduce) {
      bg('setMood', 'charging');
      snd('whoosh', { dur: .8 });
      await sleep(360);
      if (closing) return;
    }
    const n = buildPile(instant);
    root.classList.add('fin-on');
    if (!instant && !reduce) { await sleep(n * 75 + 600 + 140); if (closing) return; }
    // copy
    const stampedNow = parts.filter(p => p.at).length, autoN = parts.filter(p => p.auto).length;
    const secs = Math.round((Date.now() - t0) / 1000);
    const bits = [`${N} slip${N === 1 ? '' : 's'}`];
    if (autoN) bits.push(`${autoN} on autopilot`);
    if (stampedNow && !instant) bits.push(`done in ${Math.floor(secs / 60)}:${pad2(secs % 60)}`);
    $('.fin-sub').innerHTML = allAuto
      ? 'Nothing for you to move. Your standing orders did the lot.'
      : N === 0 ? 'Nothing on this one. Clean sheet.'
        : `<b>${esc(fmt(total))}</b> moved. Every penny where it belongs.`;
    $('.fin-stats').textContent = bits.join(' · ');
    $('.fin-undo').hidden = instant || !lastStamped;
    fin.hidden = false;
    // slam
    const st = $('.fin-stamp');
    const dur = instant ? 420 : 600, hitAt = .55;
    if (!reduce) {
      anim(st, [
        { transform: 'translate(-50%,-50%) rotate(-26deg) scale(3.2)', opacity: 0, filter: 'blur(12px)', easing: 'cubic-bezier(.8,0,1,.55)' },
        { transform: 'translate(-50%,-50%) rotate(-7deg) scale(.9)', opacity: 1, filter: 'blur(0px)', offset: hitAt, easing: 'cubic-bezier(.2,1.8,.4,1)' },
        { transform: 'translate(-50%,-50%) rotate(-7deg) scale(1)', opacity: 1, filter: 'blur(0px)' }
      ], { duration: dur, fill: 'backwards' });
      await sleep(dur * hitAt);
      if (closing) return;
    }
    const cx = innerWidth / 2, cy = pileY;
    snd('thump'); hap('heavy');
    if (!reduce) {
      pile.style.transformOrigin = `${cx}px ${cy}px`;
      anim(pile, [{ transform: 'none' }, { transform: 'scale(.97,.93)', offset: .25 }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
      root.classList.remove('quake'); void root.offsetWidth; root.classList.add('quake');
    }
    if (instant) {
      fx('sparkBurst', cx, cy, { color: INK, count: 28, power: .9 });
      bg('pulse', cx, cy, 1);
    } else {
      fx('flash', .45);
      fx('shockwave', cx, cy, { color: INK_HI, radius: Math.max(innerWidth, innerHeight) * .75 });
      fx('confetti', cx, cy, { count: 220 });
      fx('sparkBurst', cx, cy, { color: INK, count: 50, power: 1.5 });
      bg('setMood', 'celebrate'); bg('pulse', cx, cy, 2);
      later(() => { snd('fanfare'); hap('success'); }, 90);
    }
    announce(allAuto ? 'Nothing to move. All on standing orders.' : `All banked. ${fmt(total)} moved.`);
    later(() => { try { $('.fin-nice').focus({ preventScroll: true }); } catch (_) { /* ignore */ } }, reduce ? 0 : 650);
  }
  async function undoLast() {
    const p = lastStamped;
    if (!p || closing || !finaleOn) return;
    snd('whoosh', { dur: .4 }); hap('medium');
    bg('setMood', 'idle');
    if (!reduce) {
      anim(fin, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in', fill: 'forwards' });
      anim(pile, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(30px)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' });
      await sleep(270);
      if (closing) return;
    }
    fin.hidden = true;
    try { fin.getAnimations().forEach(a => a.cancel()); pile.getAnimations().forEach(a => a.cancel()); } catch (_) { /* ignore */ }
    pile.textContent = '';
    finaleOn = false;
    root.classList.remove('fin-prep', 'fin-on', 'quake');
    await sleep(reduce ? 0 : 120);
    try { p.el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); } catch (_) { /* ignore */ }
    unstamp(p);
  }

  /* ----- scrap ----- */
  function disarmScrap() { scrapArmed = false; scrapBtn.classList.remove('armed'); scrapBtn.textContent = 'Scrap this split'; }
  async function scrapTap() {
    if (closing || locked) return;
    if (!scrapArmed) {
      scrapArmed = true; scrapBtn.classList.add('armed'); scrapBtn.textContent = 'Tap again to scrap it';
      snd('error'); hap('medium');
      cancel(scrapT); scrapT = later(disarmScrap, 3200);
      return;
    }
    cancel(scrapT); scrapArmed = false; locked = true;
    scrapBtn.textContent = 'Scrapped.';
    hideConfirms();
    cb('onScrap');
    snd('delete'); hap('heavy');
    if (!reduce) {
      const c = centreOf(scrapBtn);
      fx('sparkBurst', c.x, c.y, { color: '#9C8E93', count: 22, power: .7 });
      let k = 0;
      [...list.querySelectorAll('.br-slip')].forEach(el => {
        const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
        const rot = rnd(-38, 38), dx = rnd(-90, 90);
        anim(el, [
          { transform: 'none', opacity: 1, easing: 'cubic-bezier(.2,.8,.4,1)' },
          { transform: `translate(${(dx * .12).toFixed(0)}px,-18px) rotate(${(rot * .15).toFixed(1)}deg)`, opacity: 1, offset: .16, easing: 'cubic-bezier(.5,0,.85,.4)' },
          { transform: `translate(${dx.toFixed(0)}px,${Math.round(innerHeight * 1.05)}px) rotate(${rot.toFixed(1)}deg)`, opacity: .5 }
        ], { duration: 600, delay: k++ * 45, easing: 'linear', fill: 'forwards' });
      });
      root.classList.remove('quake'); void root.offsetWidth; root.classList.add('quake');
      await sleep(600 + Math.min(k, 4) * 45);
    }
    close('scrapped');
  }

  /* ----- events ----- */
  list.addEventListener('pointerdown', guard(onDown));
  list.addEventListener('pointermove', guard(onMove), { passive: false });
  list.addEventListener('pointerup', guard(onUp));
  list.addEventListener('pointercancel', guard(onUp));
  list.addEventListener('lostpointercapture', guard(onUp));
  list.addEventListener('dragstart', e => e.preventDefault());
  list.addEventListener('click', guard(e => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
    if (closing || finaleOn || locked) return;
    const p = partOf(e.target); if (!p) return;
    const btn = e.target.closest('[data-act]'), act = btn && btn.dataset.act;
    if (act === 'copy') return copyAmt(p, btn);
    if (act === 'stamp') return stamp(p, 'button');
    if (act === 'ask') return showConfirm(p);
    if (act === 'keep') { hideConfirm(p); snd('tap'); hap('light'); try { p.el.querySelector('.slip-ask').focus({ preventScroll: true }); } catch (_) { /* ignore */ } return; }
    if (act === 'unstamp') return unstamp(p);
    if (e.target.closest('.slip-confirm')) return;
    if (p.auto) return wiggle(p);
    if (p.done) return p.el.classList.contains('confirming') ? hideConfirm(p) : showConfirm(p);
    nudge(p);
  }));
  laterBtn.addEventListener('click', guard(() => { if (!locked) close('later'); }));
  scrapBtn.addEventListener('click', guard(scrapTap));
  $('.fin-nice').addEventListener('click', guard(() => close('complete')));
  $('.fin-undo').addEventListener('click', guard(undoLast));
  scroller.addEventListener('scroll', () => {
    if (drag && !drag.active) drag = null;
    try { dockWrap.classList.toggle('stuck', scroller.scrollTop > 2 && dockWrap.getBoundingClientRect().top <= scroller.getBoundingClientRect().top + 8); } catch (_) { /* ignore */ }
  }, { passive: true });

  function onKey(e) {
    try {
      if (closing || e.key !== 'Escape') return;
      e.preventDefault();
      if (locked) return;
      close(finaleOn ? 'complete' : 'later');
    } catch (err) { warn(err); }
  }
  function onResize() {
    try {
      if (!finaleOn || closing) return;
      measurePile();
      buildPile(true);
    } catch (e) { warn(e); }
  }

  /* ----- close ----- */
  function close(result, instant = false) {
    if (closing) return;
    closing = true;
    result = RESULTS.has(result) ? result : allDone() ? 'complete' : 'later';
    timers.forEach(clearTimeout); timers.clear();
    cancelAnimationFrame(pctRaf);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onResize);
    drag = null;
    if (current === api) current = null;
    let finished = false;
    const finish = () => {
      if (finished) return; finished = true;
      try { root.remove(); } catch (_) { /* ignore */ }
      try { if (!document.querySelector('.br[role="dialog"]')) html.style.overflow = prevOverflow; } catch (_) { /* ignore */ }
      try { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
      cb('onClose', result);
    };
    if (instant || reduce || root.style.visibility === 'hidden') { finish(); return; }
    if (result !== 'scrapped') { snd('close'); hap('light'); }
    root.classList.add('out', result === 'complete' ? 'out-up' : result === 'scrapped' ? 'out-scrap' : 'out-down');
    setTimeout(finish, result === 'scrapped' ? 320 : 450);
  }

  const api = { close: (result, instant) => { try { close(result, !!instant); } catch (e) { warn(e); } } };
  current = api;
  return api;
}
