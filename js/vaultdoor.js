// Crimson Cut - vault door.
//
// A heavy round safe door that covers an element (the Vault hero) and opens:
// dial spins L/R/L, the spoked wheel ratchets round, the bolts slam back,
// the door unseals, swings out on a left hinge in 3D and the whole rig
// flies past the camera so the numbers behind are fully usable.
//
//   const door = createVaultDoor(host, { Sound, Haptics, reduceMotion });
//   await door.open();   // resolves when fully open and out of the way
//   door.close();        // instantly re-seal, ready for the next open()
//
// Everything inside the rig is sized in em: the script sets the root
// font-size to 1/100 of the door assembly diameter (which comes from the
// host's smaller side), so the art scales from a 361x260 phone panel to a
// 1100px desktop one. Public methods never throw.

const BOLT_ANGLES = Array.from({ length: 16 }, (_, i) => i * 22.5).filter((a) => a !== 180);
const FACETS = 24;
const THICK = 13; // door thickness, em
const DOOR_R = 37; // door radius, em (assembly radius is 50)
const HINGE_X = -45.5; // hinge axis x from the centre, em

let cssPromise = null;
let sessionOpens = 0;
let uid = 0;

function injectCss() {
  if (cssPromise) return cssPromise;
  cssPromise = new Promise((resolve) => {
    try {
      const href = new URL('../css/vaultdoor.css', import.meta.url).href;
      const existing = document.querySelector('link[data-vaultdoor]');
      if (existing) { resolve(); return; }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.vaultdoor = '';
      link.onload = () => resolve();
      link.onerror = () => resolve();
      (document.head || document.documentElement).appendChild(link);
    } catch (e) { resolve(); }
  });
  return cssPromise;
}

// ------------------------------------------------------------------ easing
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOutCubic = (x) => 1 - (1 - x) ** 3;
const easeOutQuart = (x) => 1 - (1 - x) ** 4;
const easeInCubic = (x) => x * x * x;
const easeInQuad = (x) => x * x;
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOutBack = (x, s = 1.9) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;

function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const d = dx(t);
      if (Math.abs(d) < 1e-5) break;
      t -= (sx(t) - x) / d;
    }
    t = clamp01(t);
    return sy(t);
  };
}
const swingEase = bezier(0.52, 0, 0.18, 1.06);

// ------------------------------------------------------------------ timelines (seconds)
function timeline(fast) {
  if (fast) {
    return {
      fast: true,
      dial: [[0.0, 0.13, 0, -150], [0.14, 0.23, -150, -80]],
      light: 0.22,
      wheel: [0.12, 0.38],
      bolts: [0.36, 0.46],
      unseal: [0.45, 0.51],
      swing: [0.48, 0.77],
      fade: [0.6, 0.84],
      end: 0.84,
    };
  }
  const L = 0.08;
  return {
    fast: false,
    dial: [[L + 0.0, L + 0.27, 0, -290], [L + 0.29, L + 0.45, -290, -115], [L + 0.47, L + 0.59, -115, -205]],
    light: L + 0.6,
    wheel: [L + 0.6, L + 1.02],
    bolts: [L + 1.02, L + 1.18],
    unseal: [L + 1.18, L + 1.3],
    swing: [L + 1.27, L + 1.84],
    fade: [L + 1.68, L + 2.08],
    end: L + 2.08,
  };
}

// ------------------------------------------------------------------ markup
function rivets(n, r, rad, id, offset = 0) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = ((i / n) * 360 + offset) * Math.PI / 180;
    const x = (Math.cos(a) * r).toFixed(2), y = (Math.sin(a) * r).toFixed(2);
    s += `<circle cx="${(+x + rad * 0.28).toFixed(2)}" cy="${(+y + rad * 0.38).toFixed(2)}" r="${(rad * 1.18).toFixed(2)}" fill="rgba(0,0,0,.55)"/>`;
    s += `<circle cx="${x}" cy="${y}" r="${rad}" fill="url(#${id}riv)"/>`;
  }
  return s;
}

function rivetDefs(id) {
  return `<radialGradient id="${id}riv" cx=".36" cy=".3" r=".75">
    <stop offset="0" stop-color="#e6dde0"/><stop offset=".22" stop-color="#8d8186"/>
    <stop offset=".62" stop-color="#2e272a"/><stop offset="1" stop-color="#0b0809"/></radialGradient>`;
}

function ringSvg(id) {
  let sockets = '';
  BOLT_ANGLES.forEach((a) => {
    sockets += `<g transform="rotate(${a})">
      <rect x="37.6" y="-3.1" width="6.1" height="6.2" rx="1.5" fill="#020101"/>
      <rect x="37.6" y="-3.1" width="6.1" height="6.2" rx="1.5" fill="url(#${id}sock)"/>
      <rect x="38.1" y="-2.6" width="5.1" height="5.2" rx="1.1" fill="none" stroke="rgba(0,0,0,.9)" stroke-width=".35"/>
    </g>`;
  });
  return `<svg class="vd-ring-svg" viewBox="-50 -50 100 100" aria-hidden="true">
    <defs>${rivetDefs(id)}
      <radialGradient id="${id}sock" cx="0" cy="0" r="1" gradientUnits="objectBoundingBox">
        <stop offset="0" stop-color="#000"/><stop offset=".7" stop-color="#0c0909"/><stop offset="1" stop-color="#2a2326"/></radialGradient>
    </defs>
    ${sockets}
    <circle r="44.05" fill="none" stroke="rgba(0,0,0,.85)" stroke-width=".3"/>
    <circle r="44.4" fill="none" stroke="rgba(255,240,244,.16)" stroke-width=".25"/>
    <circle r="49.75" fill="none" stroke="rgba(255,240,244,.12)" stroke-width=".22"/>
    ${rivets(32, 47.1, 0.95, id, 5.625)}
  </svg>`;
}

function faceSvg(id) {
  return `<svg class="vd-face-svg" viewBox="-37 -37 74 74" aria-hidden="true">
    <defs>${rivetDefs(id)}
      <path id="${id}arcT" d="M -26.2 0 A 26.2 26.2 0 0 1 26.2 0"/>
      <linearGradient id="${id}enamel" x1="0" y1="-1" x2="0" y2="1" gradientUnits="objectBoundingBox">
        <stop offset="0" stop-color="#ff3a5c"/><stop offset=".5" stop-color="#dc143c"/><stop offset="1" stop-color="#7a0b22"/></linearGradient>
    </defs>
    <!-- machined grooves around the text band -->
    <circle r="30.05" fill="none" stroke="rgba(0,0,0,.7)" stroke-width=".32"/>
    <circle r="30.35" fill="none" stroke="rgba(255,240,244,.09)" stroke-width=".2"/>
    <circle r="23.9" fill="none" stroke="rgba(0,0,0,.6)" stroke-width=".3"/>
    <circle r="24.2" fill="none" stroke="rgba(255,240,244,.08)" stroke-width=".2"/>
    <!-- crimson enamel inlay -->
    <circle r="31.35" fill="none" stroke="#1a0409" stroke-width="1.15"/>
    <circle r="31.35" fill="none" stroke="url(#${id}enamel)" stroke-width=".7"/>
    <circle r="31.1" fill="none" stroke="rgba(255,170,185,.45)" stroke-width=".12"/>
    <!-- engraved, crimson-filled lettering -->
    <g class="vd-engrave">
      <text transform="translate(0 .26)" fill="rgba(255,240,244,.2)"><textPath href="#${id}arcT" startOffset="50%" text-anchor="middle">CRIMSON &#x2022; CUT</textPath></text>
      <text transform="translate(0 -.16)" fill="#050304"><textPath href="#${id}arcT" startOffset="50%" text-anchor="middle">CRIMSON &#x2022; CUT</textPath></text>
      <text fill="url(#${id}enamel)"><textPath href="#${id}arcT" startOffset="50%" text-anchor="middle">CRIMSON &#x2022; CUT</textPath></text>
    </g>
    <g class="vd-engrave-sm">
      <text x="27.2" y="5.2" text-anchor="middle" fill="rgba(255,240,244,.14)" transform="translate(0 .15)">SEAL</text>
      <text x="27.2" y="5.2" text-anchor="middle" fill="#070506">SEAL</text>
      <text x="-26.6" y="-3.4" text-anchor="middle" fill="rgba(255,240,244,.14)" transform="translate(0 .15)">TIME</text>
      <text x="-26.6" y="-3.4" text-anchor="middle" fill="#070506">TIME</text>
      <text x="-26.6" y="4.9" text-anchor="middle" fill="rgba(255,240,244,.14)" transform="translate(0 .15)">LOCK</text>
      <text x="-26.6" y="4.9" text-anchor="middle" fill="#070506">LOCK</text>
    </g>
    <!-- bezel rivets -->
    ${rivets(24, 34.7, 0.72, id, 7.5)}
  </svg>`;
}

function dialSvg(id) {
  let ticks = '';
  for (let i = 0; i < 100; i++) {
    const major = i % 5 === 0;
    const r1 = major ? 8.75 : 9.35;
    ticks += `<line x1="0" y1="-${r1}" x2="0" y2="-10.25" transform="rotate(${i * 3.6})" stroke="${i % 10 === 0 ? '#f4ecee' : major ? '#b8aeb2' : '#6e6468'}" stroke-width="${major ? 0.3 : 0.16}"/>`;
  }
  let nums = '';
  for (let i = 0; i < 100; i += 10) {
    nums += `<text transform="rotate(${i * 3.6}) translate(0 -6.55)" text-anchor="middle">${i}</text>`;
  }
  return `<svg class="vd-dial-svg" viewBox="-12 -12 24 24" aria-hidden="true">
    <defs>
      <radialGradient id="${id}knob" cx=".38" cy=".3" r=".8">
        <stop offset="0" stop-color="#8e8388"/><stop offset=".45" stop-color="#3a3135"/><stop offset="1" stop-color="#120e10"/></radialGradient>
      <mask id="${id}cut" maskUnits="userSpaceOnUse" x="-6" y="-6" width="12" height="12">
        <rect x="-6" y="-6" width="12" height="12" fill="#fff"/>
        <rect x="-6" y="-.32" width="12" height=".64" fill="#000" transform="rotate(-45)"/>
      </mask>
    </defs>
    ${ticks}
    <g class="vd-dial-num">${nums}</g>
    <circle r="5.35" fill="#070506"/>
    <circle r="5.05" fill="url(#${id}knob)"/>
    <circle r="5.05" fill="none" stroke="rgba(255,240,244,.18)" stroke-width=".18"/>
    <g mask="url(#${id}cut)">
      <circle r="2.55" fill="none" stroke="#dc143c" stroke-width=".62"/>
      <circle r="1.25" fill="#ff3a5c"/>
    </g>
    <rect x="-3.4" y="-.07" width="6.8" height=".14" fill="#f4ecee" opacity=".7" transform="rotate(-45)"/>
  </svg>`;
}

function gaugeSvg(id) {
  let ticks = '';
  for (let i = 0; i <= 30; i++) {
    const a = -135 + i * 9;
    const major = i % 5 === 0;
    ticks += `<line x1="0" y1="-${major ? 11.6 : 12.4}" x2="0" y2="-13.4" transform="rotate(${a})" stroke="${i >= 24 ? '#ff3a5c' : '#b8aeb2'}" stroke-width="${major ? 0.5 : 0.25}"/>`;
  }
  let nums = '';
  [0, 1, 2, 3, 4, 5, 6].forEach((n, i) => {
    const a = (-135 + i * 45) * Math.PI / 180;
    nums += `<text x="${(Math.sin(a) * 9.2).toFixed(2)}" y="${(-Math.cos(a) * 9.2 + 1).toFixed(2)}" text-anchor="middle">${n * 50}</text>`;
  });
  return `<svg viewBox="-16 -16 32 32" aria-hidden="true">
    <path d="M ${(Math.sin(81 * Math.PI / 180) * 13.9).toFixed(2)} ${(-Math.cos(81 * Math.PI / 180) * 13.9).toFixed(2)} A 13.9 13.9 0 0 1 ${(Math.sin(135 * Math.PI / 180) * 13.9).toFixed(2)} ${(-Math.cos(135 * Math.PI / 180) * 13.9).toFixed(2)}" fill="none" stroke="#dc143c" stroke-width="1" opacity=".85"/>
    ${ticks}
    <g class="vd-gauge-num">${nums}</g>
    <text class="vd-gauge-lbl" y="6.4" text-anchor="middle">VAULT PSI</text>
  </svg>`;
}

function build(id) {
  const bolts = BOLT_ANGLES.map((a) => `<div class="vd-bolt" style="transform:rotate(${a}deg) translateX(33.4em)"><i></i></div>`).join('');
  const facets = Array.from({ length: FACETS }, (_, i) => {
    const phi = (i / FACETS) * 360;
    // outward normal (screen space, y down) vs a light from the upper left
    const nx = Math.sin(phi * Math.PI / 180), ny = -Math.cos(phi * Math.PI / 180);
    const lit = clamp01(0.5 + 0.5 * (nx * -0.55 + ny * -0.83));
    return `<i class="vd-facet" style="--sh:${(0.78 - lit * 0.7).toFixed(2)};transform:rotateZ(${phi}deg) translateY(-${DOOR_R - 0.4}em) translateZ(-${THICK / 2}em) rotateX(90deg)"></i>`;
  }).join('');
  const spokes = [45, 135, 225, 315].map((a) => `<i class="vd-spoke" style="--a:${a}"></i>`).join('');
  const knobs = [45, 135, 225, 315].map((a) => `<i class="vd-knob" style="--ka:${a}"></i>`).join('');
  return `
  <div class="vd-rig">
    <div class="vd-c vd-under"><div class="vd-flood"></div><div class="vd-bore"></div></div>
    <div class="vd-wall">
      <div class="vd-side vd-side-l"><div class="vd-gauge"><div class="vd-gauge-face">${gaugeSvg(id)}<i class="vd-needle"></i><b></b></div></div></div>
      <div class="vd-side vd-side-r"><div class="vd-name"><span class="vd-name-t">Crimson <em>Cut</em></span><span class="vd-name-s">Reserve vault &middot; N&ordm; 0451</span><i></i><i></i><i></i><i></i></div></div>
    </div>
    <div class="vd-c vd-mid">
      <div class="vd-ring"><div class="vd-chshade"></div>${ringSvg(id)}</div>
      <div class="vd-hinge-plate"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="vd-hinge"></div>
      <div class="vd-seam"></div>
      <div class="vd-bloom"></div>
      <div class="vd-rays"></div>
    </div>
    <div class="vd-c vd-top">
      <div class="vd-stage">
        <div class="vd-door">
          ${facets}
          <div class="vd-back"></div>
          <div class="vd-bolts">${bolts}</div>
          <div class="vd-face">
            <div class="vd-plate-in"></div>
            ${faceSvg(id)}
            <div class="vd-hubshadow"></div>
            <div class="vd-wshadow">${spokes}${knobs}</div>
            <div class="vd-led"><i></i></div>
            <div class="vd-plate"><span>N&ordm; 0451 &middot; CC</span><i></i><i></i><i></i><i></i></div>
            <div class="vd-glint"></div>
            <div class="vd-fshade"></div>
          </div>
          <div class="vd-arm vd-arm-t"><b></b><i></i><i></i></div>
          <div class="vd-arm vd-arm-b"><b></b><i></i><i></i></div>
          <div class="vd-dial"><div class="vd-drot">${dialSvg(id)}</div><div class="vd-dsheen"></div></div>
          <div class="vd-wheel"><div class="vd-wrot">${spokes}${knobs}</div><div class="vd-hub"></div></div>
          <div class="vd-index"></div>
        </div>
      </div>
    </div>
    <div class="vd-fx"><div class="vd-c vd-fxc"></div></div>
  </div>`;
}

// ------------------------------------------------------------------ factory
const NOOP_API = () => ({ open: () => Promise.resolve(), close: () => {}, el: null });

export function createVaultDoor(host, opts = {}) {
  try {
    return create(host, opts || {});
  } catch (e) {
    try { console.warn('vaultdoor: create failed', e); } catch (_) { /* ignore */ }
    return NOOP_API();
  }
}

function create(host, { Sound, Haptics, reduceMotion = false } = {}) {
  if (!host || typeof document === 'undefined') return NOOP_API();
  const css = injectCss();
  const id = 'vd' + (++uid) + '_';

  const snd = (name, o) => { try { if (Sound && Sound.play) Sound.play(name, o || {}); } catch (e) { /* ignore */ } };
  const hap = (m) => { try { if (Haptics && typeof Haptics[m] === 'function') Haptics[m](); } catch (e) { /* ignore */ } };
  const reduced = () => { try { return typeof reduceMotion === 'function' ? !!reduceMotion() : !!reduceMotion; } catch (e) { return false; } };

  try {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  } catch (e) { /* ignore */ }

  const root = document.createElement('div');
  root.className = 'vd';
  root.setAttribute('aria-hidden', 'true');
  // critical inline styles: cover the host even before the stylesheet lands
  root.style.cssText = 'position:absolute;inset:0;overflow:hidden;border-radius:inherit;background:#0d0a0b;z-index:6;';
  root.innerHTML = build(id);
  host.appendChild(root);

  const q = (s) => root.querySelector(s);
  const el = {
    rig: q('.vd-rig'), door: q('.vd-door'), drot: q('.vd-drot'), wheel: q('.vd-wheel'), wrot: q('.vd-wrot'),
    wshadow: q('.vd-wshadow'), bolts: [...root.querySelectorAll('.vd-bolt > i')], seam: q('.vd-seam'),
    flood: q('.vd-flood'), bore: q('.vd-bore'), bloom: q('.vd-bloom'), rays: q('.vd-rays'),
    fshade: q('.vd-fshade'), glint: q('.vd-glint'), needle: q('.vd-needle'), fx: q('.vd-fxc'),
  };

  // ---------------------------------------------------------------- sizing
  let unit = 0;
  function layout() {
    try {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      const A = Math.min(w, h) * 0.95;
      unit = A / 100;
      root.style.fontSize = unit.toFixed(3) + 'px';
      const sideEm = ((w - A) / 2) / unit;
      root.classList.toggle('is-wide', sideEm >= 62);
      root.classList.toggle('is-xwide', sideEm >= 120);
    } catch (e) { /* ignore */ }
  }
  layout();
  let ro = null;
  try {
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => layout()); ro.observe(host); }
    else window.addEventListener('resize', layout);
  } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------- state
  let state = 'sealed'; // sealed | opening | open
  let run = null; // { T, t, rate, last, raf, resolve, cues, ci, prevDial, prevWheel, watchdog }
  let pending = null; // promise of the running open()
  const puffs = new Set();
  let lightState = '';

  function setLight(s) {
    if (s === lightState) return;
    lightState = s;
    root.dataset.light = s;
  }

  // ---------------------------------------------------------------- frame
  function dialAngle(T, t) {
    let a = T.dial[0][2];
    for (const s of T.dial) {
      if (t >= s[1]) { a = s[3]; continue; }
      if (t > s[0]) { a = lerp(s[2], s[3], easeOutQuart(seg(t, s[0], s[1]))); }
      break;
    }
    return a;
  }

  function wheelLinear(T, t) {
    return 270 * easeInOutCubic(seg(t, T.wheel[0], T.wheel[1]));
  }

  function wheelAngle(T, t) {
    const lin = wheelLinear(T, t);
    const k = lin / 30, n = Math.floor(k), f = k - n;
    const stepped = (n + f * f * f) * 30;
    let a = lin * 0.4 + stepped * 0.6;
    const r = seg(t, T.wheel[1], T.wheel[1] + (T.fast ? 0.08 : 0.14));
    if (r > 0 && r < 1) a -= 5 * Math.sin(Math.PI * r);
    return a;
  }

  function shakes(T) {
    const bd = T.bolts[1] - T.bolts[0];
    return [
      [T.bolts[0] + bd * 0.72, 0.9, 0.13],
      [T.unseal[0], 0.45, 0.09],
      [T.swing[1] - 0.04, 0.35, 0.1],
    ];
  }

  function render(T, t) {
    // dial + wheel
    const da = dialAngle(T, t);
    el.drot.style.transform = `rotate(${da.toFixed(2)}deg)`;
    const wa = wheelAngle(T, t);
    el.wrot.style.transform = `rotate(${wa.toFixed(2)}deg)`;
    el.wshadow.style.transform = `translate(1.3em,2.3em) rotate(${wa.toFixed(2)}deg)`;
    el.wheel.style.setProperty('--wa', wa.toFixed(2));

    // bolts: slam back, rippling round the ring, tiny rebound
    const pb = seg(t, T.bolts[0], T.bolts[1]);
    const n = el.bolts.length;
    for (let i = 0; i < n; i++) {
      const st = (i / (n - 1)) * 0.3;
      const p = clamp01((pb - st) / 0.62);
      const rb = seg(pb, st + 0.62, st + 0.62 + 0.14);
      const travel = easeInCubic(p) - 0.1 * Math.sin(Math.PI * rb);
      el.bolts[i].style.transform = travel ? `translateX(${(-6.2 * travel).toFixed(3)}em)` : '';
    }

    // door: wheel judder, unseal pop, swing
    const pw = seg(t, T.wheel[0], T.wheel[1]);
    const jud = pw > 0 && pw < 1 ? Math.sin(pw * Math.PI) * 0.1 : 0;
    const jx = jud * Math.sin(t * 97), jy = jud * Math.cos(t * 83);
    const pu = seg(t, T.unseal[0], T.unseal[1]);
    const pop = pu ? easeOutBack(pu, 2.4) * 2.4 : 0;
    const sd = T.swing[1] - T.swing[0];
    const ps = seg(t, T.swing[0], T.swing[1]);
    const ry = -105 * swingEase(ps);
    el.door.style.transform = `translate3d(${jx.toFixed(3)}em,${jy.toFixed(3)}em,${pop.toFixed(3)}em) rotateY(${ry.toFixed(2)}deg)`;

    const turn = clamp01(-ry / 90);
    el.fshade.style.opacity = (turn * 0.62).toFixed(3);
    el.glint.style.transform = `translateX(${(-70 + 190 * clamp01(-ry / 70)).toFixed(1)}%) rotate(18deg)`;
    el.glint.style.opacity = ps > 0 && ps < 1 ? '1' : '0';

    // light
    const seamIn = pu;
    const seamOut = seg(t, T.swing[0] + sd * 0.25, T.swing[0] + sd * 0.7);
    el.seam.style.opacity = (seamIn * (1 - seamOut)).toFixed(3);
    const pf = seg(t, T.fade[0], T.fade[1]);
    const fl = seg(t, T.swing[0] + sd * 0.08, T.swing[0] + sd * 0.5) * (1 - seg(t, T.fade[0] + (T.fade[1] - T.fade[0]) * 0.2, T.fade[1]));
    el.flood.style.opacity = (fl * 0.92).toFixed(3);
    el.bloom.style.opacity = fl.toFixed(3);
    el.rays.style.opacity = (fl * 0.85).toFixed(3);
    el.rays.style.transform = `rotate(${(t * 24).toFixed(2)}deg)`;
    el.bore.style.opacity = seg(t, T.swing[0], T.swing[0] + sd * 0.25).toFixed(3);

    // gauge needle drops as the seal lets go
    if (el.needle) {
      const g = seg(t, T.unseal[0] - 0.04, T.unseal[1] + (T.fast ? 0.1 : 0.3));
      el.needle.style.transform = `rotate(${(112 - 232 * easeOutBack(g, 1.4)).toFixed(2)}deg)`;
    }

    // camera shake + fly-through
    let sx = 0, sy = 0;
    for (const [t0, amp, dec] of shakes(T)) {
      const d = t - t0;
      if (d < 0 || d > dec * 5) continue;
      const k = amp * Math.exp(-d / dec);
      sx += k * Math.sin(d * 2 * Math.PI * 23);
      sy += k * Math.cos(d * 2 * Math.PI * 19 + 1);
    }
    const sc = 1 + 1.05 * easeInCubic(pf);
    el.rig.style.transform = `translate(${sx.toFixed(3)}em,${sy.toFixed(3)}em) scale(${sc.toFixed(4)})`;
    el.rig.style.opacity = (1 - easeInQuad(pf)).toFixed(3);
  }

  function resetVisual() {
    const Z = timeline(false);
    render(Z, -1);
    el.rig.style.transform = '';
    el.rig.style.opacity = '';
    setLight('idle');
  }

  // ---------------------------------------------------------------- particles
  function puff(x, y, o) {
    const p = document.createElement('i');
    p.className = 'vd-puff' + (o.cls ? ' ' + o.cls : '');
    p.style.width = p.style.height = o.size + 'em';
    p.style.left = p.style.top = (-o.size / 2) + 'em';
    el.fx.appendChild(p);
    puffs.add(p);
    const done = () => { puffs.delete(p); try { p.remove(); } catch (e) { /* ignore */ } };
    try {
      const a = p.animate([
        { transform: `translate(${x}em,${y}em) scale(${o.s0})`, opacity: o.o0 },
        { transform: `translate(${x + o.dx * 0.6}em,${y + o.dy * 0.6}em) scale(${lerp(o.s0, o.s1, 0.7)})`, opacity: o.o0 * 0.55, offset: 0.35 },
        { transform: `translate(${x + o.dx}em,${y + o.dy + (o.g || 0)}em) scale(${o.s1})`, opacity: 0 },
      ], { duration: o.dur, easing: 'cubic-bezier(.2,.75,.35,1)', fill: 'forwards', delay: o.delay || 0 });
      a.onfinish = done;
      a.oncancel = done;
    } catch (e) { done(); }
  }

  function dust(fast) {
    const n = fast ? 1 : 2;
    BOLT_ANGLES.forEach((deg, i) => {
      const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      for (let k = 0; k < n; k++) {
        const d = 5 + Math.random() * 7, tang = (Math.random() - 0.5) * 6;
        puff(c * 41, s * 41, {
          size: 4 + Math.random() * 4, s0: 0.35, s1: 1.7 + Math.random(), o0: 0.85,
          dx: c * d - s * tang, dy: s * d + c * tang, g: -2, dur: 650 + Math.random() * 350, delay: i * 6,
        });
      }
      if (!fast || i % 2 === 0) {
        const d = 12 + Math.random() * 12;
        puff(c * 42.5, s * 42.5, { cls: 'vd-spark', size: 0.9, s0: 1, s1: 0.2, o0: 1, dx: c * d, dy: s * d, g: 6, dur: 380 + Math.random() * 200, delay: i * 6 });
      }
    });
  }

  function steam(fast) {
    const n = fast ? 14 : 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2, c = Math.cos(a), s = Math.sin(a);
      const d = 6 + Math.random() * 8, sw = (Math.random() - 0.5) * 8;
      puff(c * 37.5, s * 37.5, {
        cls: 'vd-steam', size: 5 + Math.random() * 5, s0: 0.3, s1: 2 + Math.random() * 1.2, o0: 0.9,
        dx: c * d - s * sw, dy: s * d + c * sw, g: -3, dur: 700 + Math.random() * 400, delay: Math.random() * 60,
      });
    }
  }

  function clearPuffs() {
    puffs.forEach((p) => { try { p.getAnimations().forEach((a) => a.cancel()); p.remove(); } catch (e) { /* ignore */ } });
    puffs.clear();
  }

  // ---------------------------------------------------------------- cues
  function buildCues(T) {
    const c = [];
    const bd = T.bolts[1] - T.bolts[0];
    const sd = T.swing[1] - T.swing[0];
    T.dial.forEach((s, i) => c.push([s[1], () => { snd('key', { i: 3 + i * 2, vol: 0.85 }); hap('light'); }]));
    c.push([T.light, () => { setLight('armed'); snd('toggle', { on: true }); }]);
    c.push([T.wheel[1], () => { snd('key', { i: 9, rate: 0.55 }); hap('medium'); }]);
    c.push([T.bolts[0] + bd * 0.1, () => { snd('key', { i: 1, rate: 0.7 }); }]);
    c.push([T.bolts[0] + bd * 0.72, () => { snd('thump'); hap('heavy'); dust(T.fast); }]);
    c.push([T.unseal[0], () => { snd('pop', { rate: 0.5, vol: 0.8 }); hap('medium'); steam(T.fast); }]);
    c.push([T.swing[0], () => { snd('whoosh', { dur: sd + 0.2 }); }]);
    if (!T.fast) c.push([T.swing[0] + sd * 0.4, () => { snd('sweep', { vol: 0.4 }); }]);
    c.push([T.swing[1] - 0.04, () => { snd('thump', { vol: 0.4, rate: 0.75 }); hap('light'); }]);
    c.push([T.fade[0], () => { root.classList.add('is-passive'); }]);
    return c.sort((a, b) => a[0] - b[0]);
  }

  function fireCues(upTo, silent) {
    while (run && run.ci < run.cues.length && run.cues[run.ci][0] <= upTo) {
      const fn = run.cues[run.ci][1];
      run.ci++;
      if (!silent) { try { fn(); } catch (e) { /* ignore */ } }
    }
  }

  // continuous mechanical sounds: dial notches + wheel ratchet
  function crossings(T, t) {
    const da = dialAngle(T, t);
    const notch = Math.floor(da / 7.2);
    if (notch !== run.prevNotch) {
      const dt = Math.max(0.001, t - run.prevT);
      const v = clamp01(Math.abs(da - run.prevDial) / dt / 1500);
      snd('tick', { v: 0.15 + v * 0.85, vol: 0.55 + v * 0.45 });
      hap('tick');
    }
    run.prevNotch = notch;
    run.prevDial = da;
    const step = Math.floor(wheelLinear(T, t) / 30 + 1e-6);
    if (step !== run.prevStep) {
      snd('key', { i: step, rate: 0.62 + (step % 3) * 0.04, vol: 0.9 });
      hap('tick');
    }
    run.prevStep = step;
    run.prevT = t;
  }

  function frame(now) {
    if (!run) return;
    try {
      const dt = Math.min(0.05, Math.max(0, (now - run.last) / 1000));
      run.last = now;
      run.t += dt * run.rate;
      const t = Math.min(run.t, run.T.end);
      render(run.T, t);
      if (run.skipped) { run.prevNotch = Math.floor(dialAngle(run.T, t) / 7.2); run.prevStep = Math.floor(wheelLinear(run.T, t) / 30 + 1e-6); run.prevT = t; }
      else crossings(run.T, t);
      fireCues(t, false);
      if (run.t >= run.T.end) { finish(); return; }
      run.raf = requestAnimationFrame(frame);
    } catch (e) {
      finish();
    }
  }

  function finish() {
    if (!run) return;
    const r = run;
    run = null;
    try { cancelAnimationFrame(r.raf); } catch (e) { /* ignore */ }
    try { clearTimeout(r.watchdog); } catch (e) { /* ignore */ }
    state = 'open';
    root.classList.add('is-open', 'is-passive');
    clearPuffs();
    pending = null;
    try { r.resolve(true); } catch (e) { /* ignore */ }
  }

  function skip() {
    if (!run || run.skipped) return;
    run.skipped = true;
    fireCues(Math.max(run.t, run.T.fade[0]) - 1e-6, true);
    run.t = Math.max(run.t, run.T.fade[0]);
    run.rate = 2.2;
    root.classList.add('is-passive');
    setLight('armed');
    snd('whoosh', { dur: 0.3 });
    hap('light');
  }

  // ---------------------------------------------------------------- public
  function open(o) {
    try {
      if (state === 'open') return Promise.resolve(true);
      if (state === 'opening' && pending) return pending;
      layout();
      if (reduced()) {
        state = 'open';
        root.classList.add('is-open', 'is-passive');
        return Promise.resolve(true);
      }
      const fast = o && typeof o.fast === 'boolean' ? o.fast : sessionOpens > 0;
      sessionOpens++;
      state = 'opening';
      root.classList.remove('is-open', 'is-passive');
      setLight('arming');
      const T = timeline(fast);
      pending = new Promise((resolve) => {
        const go = () => {
          if (state !== 'opening' || run) return;
          layout();
          run = {
            T, t: 0, rate: 1, last: performance.now(), raf: 0, resolve, skipped: false,
            cues: buildCues(T), ci: 0, prevDial: 0, prevNotch: 0, prevStep: 0, prevT: 0,
            watchdog: setTimeout(() => { if (run) { render(run.T, run.T.end); finish(); } }, (T.end + 2.5) * 1000),
          };
          run.raf = requestAnimationFrame(frame);
        };
        closeResolvers.add(resolve);
        const waitCss = Promise.race([css, new Promise((r) => setTimeout(r, 1200))]);
        waitCss.then(() => { closeResolvers.delete(resolve); if (state === 'opening') go(); else resolve(false); }, () => go());
      });
      return pending;
    } catch (e) {
      finishHard();
      return Promise.resolve(false);
    }
  }
  const closeResolvers = new Set();

  function finishHard() {
    try {
      if (run) finish();
      state = 'open';
      root.classList.add('is-open', 'is-passive');
    } catch (e) { /* ignore */ }
  }

  function close() {
    try {
      if (run) {
        const r = run;
        run = null;
        try { cancelAnimationFrame(r.raf); } catch (e) { /* ignore */ }
        try { clearTimeout(r.watchdog); } catch (e) { /* ignore */ }
        try { r.resolve(false); } catch (e) { /* ignore */ }
      }
      closeResolvers.forEach((r) => { try { r(false); } catch (e) { /* ignore */ } });
      closeResolvers.clear();
      pending = null;
      clearPuffs();
      state = 'sealed';
      root.classList.remove('is-open', 'is-passive');
      layout();
      resetVisual();
    } catch (e) { /* ignore */ }
  }

  root.addEventListener('pointerdown', (e) => {
    try {
      if (state === 'opening') { skip(); e.preventDefault(); }
      else if (state === 'sealed') open();
    } catch (err) { /* ignore */ }
  });

  // debug/verification hook (not part of the contract): freeze at time t
  function seek(t, o) {
    try {
      if (run) { const r = run; run = null; cancelAnimationFrame(r.raf); clearTimeout(r.watchdog); r.resolve(false); }
      state = 'sealed';
      root.classList.remove('is-open', 'is-passive');
      layout();
      const T = timeline(!!(o && o.fast));
      render(T, t);
      setLight(t >= T.light ? 'armed' : 'arming');
      return T;
    } catch (e) { return null; }
  }

  resetVisual();

  return {
    open: (o) => { try { return open(o); } catch (e) { return Promise.resolve(false); } },
    close: () => { try { close(); } catch (e) { /* ignore */ } },
    el: root,
    get state() { return state; },
    __seek: seek,
    __dust: () => { try { dust(false); } catch (e) { /* ignore */ } },
    __steam: () => { try { steam(false); } catch (e) { /* ignore */ } },
    destroy: () => { try { close(); if (ro) ro.disconnect(); root.remove(); } catch (e) { /* ignore */ } },
  };
}

export default createVaultDoor;
