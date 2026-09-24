// Clean Cut — fx.js
// One full-screen 2D canvas overlay: particles, blade trail, flashes, shockwaves
// and the banknote-splitting cutscene. No sound, no deps.

const DISPLAY = '"Big Shoulders Display", Impact, "Arial Narrow Bold", "Arial Narrow", sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
const C = {
  black: '#0A0708', panel: '#171113', g1: '#211A1D', g2: '#2F2529', g3: '#46383E', g4: '#9C8E93',
  crimson: '#DC143C', hi: '#FF3A5C', deep: '#6B0A1E', text: '#F4ECEE',
  soft: '#FF8095', n1: '#8A0D27', n2: '#5A0819', n3: '#1E0A10',
};
let CONFETTI_COLORS = [];
function rebuildConfetti() { CONFETTI_COLORS = [C.crimson, C.hi, '#F4ECEE', '#9C8E93', C.crimson, C.soft, '#46383E', '#FFFFFF', C.deep]; }
rebuildConfetti();
// Accent follows the app's note theme: { crimson, hi, deep, soft, n1, n2, n3 }.
export function setPalette(p) { Object.assign(C, p || {}); rebuildConfetti(); }

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

function hexRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (h.length !== 6 || isNaN(n)) return [255, 58, 92];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; };

function rrect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function setSpacing(g, px) { try { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; } catch (e) { /* ignore */ } }

// ---------------------------------------------------------------- sprites
const spriteCache = new Map();
function glowSprite(color) {
  let s = spriteCache.get(color);
  if (s) return s;
  const S = 64;
  s = mkCanvas(S, S);
  const g = s.getContext('2d');
  const [r, gg, b] = hexRgb(color);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, `rgba(255,255,255,1)`);
  grad.addColorStop(0.12, `rgba(${Math.min(255, r + 120)},${Math.min(255, gg + 120)},${Math.min(255, b + 120)},0.95)`);
  grad.addColorStop(0.3, `rgba(${r},${gg},${b},0.55)`);
  grad.addColorStop(0.6, `rgba(${r},${gg},${b},0.16)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  spriteCache.set(color, s);
  return s;
}

// ---------------------------------------------------------------- banknote
function drawRosette(g, cx, cy, R, loops, lobes, color, alpha, lw) {
  g.strokeStyle = rgba(color, alpha);
  g.lineWidth = lw;
  for (let i = 0; i < loops; i++) {
    const base = R * (0.55 + 0.1 * (i / loops));
    const amp = R * 0.3;
    const ph = (i / loops) * TAU / lobes * 1.7;
    g.beginPath();
    for (let k = 0; k <= 360; k++) {
      const t = (k / 360) * TAU;
      const r = base + amp * Math.sin(lobes * t + ph) * Math.cos(t * 2 + i * 0.2) * 0.9;
      const x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r;
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }
}

function renderNoteFront(w, h, dpr, note) {
  const c = mkCanvas(w * dpr, h * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const rad = Math.min(12, h * 0.08);
  rrect(g, 0, 0, w, h, rad);
  g.clip();

  // base
  let gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, C.n1);
  gr.addColorStop(0.32, C.n2);
  gr.addColorStop(0.68, C.n3);
  gr.addColorStop(1, '#0A0708');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  gr = g.createRadialGradient(w * 0.18, h * 0.25, 0, w * 0.18, h * 0.25, w * 0.7);
  gr.addColorStop(0, rgba(C.hi, 0.30));
  gr.addColorStop(1, rgba(C.hi, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);

  // guilloche waves (two families -> moire)
  g.lineWidth = 0.55;
  for (let j = 0; j < 26; j++) {
    g.strokeStyle = rgba(C.soft, 0.07 + (j % 3 === 0 ? 0.05 : 0));
    g.beginPath();
    for (let x = -4; x <= w + 4; x += 3) {
      const y = h * 0.5 + Math.sin(x * 0.03 + j * 0.24) * h * 0.22 + Math.sin(x * 0.011 - j * 0.5) * h * 0.14 + (j - 13) * h * 0.012;
      if (x < 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let j = 0; j < 18; j++) {
    g.strokeStyle = 'rgba(244,236,238,0.05)';
    g.beginPath();
    for (let x = -4; x <= w + 4; x += 3) {
      const y = h * 0.5 + Math.cos(x * 0.045 + j * 0.35) * h * 0.3 + (j - 9) * h * 0.02;
      if (x < 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }

  // rosettes
  const sx = w * 0.79, sy = h * 0.5, sr = Math.min(h * 0.42, w * 0.2);
  drawRosette(g, sx, sy, sr, 16, 11, C.hi, 0.22, 0.6);
  drawRosette(g, sx, sy, sr * 0.62, 10, 7, '#F4ECEE', 0.12, 0.5);
  drawRosette(g, w * 0.08, h * 0.92, h * 0.35, 10, 9, C.hi, 0.1, 0.5);

  // seal
  gr = g.createRadialGradient(sx, sy, 0, sx, sy, sr * 0.42);
  gr.addColorStop(0, C.n2);
  gr.addColorStop(1, C.n3);
  g.fillStyle = gr;
  g.beginPath(); g.arc(sx, sy, sr * 0.42, 0, TAU); g.fill();
  g.strokeStyle = rgba(C.hi, 0.9); g.lineWidth = 1.2;
  g.beginPath(); g.arc(sx, sy, sr * 0.42, 0, TAU); g.stroke();
  g.strokeStyle = rgba(C.hi, 0.45); g.lineWidth = 0.6;
  g.beginPath(); g.arc(sx, sy, sr * 0.36, 0, TAU); g.stroke();
  // seal tick ring
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * TAU;
    g.beginPath();
    g.moveTo(sx + Math.cos(a) * sr * 0.42, sy + Math.sin(a) * sr * 0.42);
    g.lineTo(sx + Math.cos(a) * sr * 0.47, sy + Math.sin(a) * sr * 0.47);
    g.stroke();
  }
  g.fillStyle = C.hi;
  g.font = `900 ${Math.round(sr * 0.42)}px ${DISPLAY}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('CC', sx, sy + sr * 0.02);

  // holographic sheen strip
  const hx = w * 0.6, hw = Math.max(8, w * 0.045);
  gr = g.createLinearGradient(0, 0, 0, h);
  const holo = [C.hi, '#F4ECEE', '#9C8E93', C.crimson, C.soft, '#E8E0E2', C.hi];
  holo.forEach((col, i) => gr.addColorStop(i / (holo.length - 1), rgba(col, 0.42)));
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = gr;
  g.fillRect(hx, 0, hw, h);
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 0.6;
  g.beginPath();
  for (let y = -hw; y < h + hw; y += 4) { g.moveTo(hx, y); g.lineTo(hx + hw, y + hw); }
  g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.6;
  g.strokeRect(hx + 0.5, -1, hw - 1, h + 2);

  // frame + microtext
  g.strokeStyle = rgba(C.hi, 0.6); g.lineWidth = 1;
  rrect(g, 4.5, 4.5, w - 9, h - 9, rad - 3); g.stroke();
  g.strokeStyle = 'rgba(244,236,238,0.22)'; g.lineWidth = 0.6;
  rrect(g, 11.5, 11.5, w - 23, h - 23, rad - 6); g.stroke();
  const micro = 'CLEAN CUT • ';
  g.font = `600 4.6px ${MONO}`;
  g.fillStyle = rgba(C.soft, 0.75);
  g.textAlign = 'left'; g.textBaseline = 'middle';
  const mw = g.measureText(micro).width || 40;
  const rowH = (len) => micro.repeat(Math.ceil(len / mw) + 1);
  g.save(); g.beginPath(); g.rect(12, 5, w - 24, 6); g.clip();
  g.fillText(rowH(w), 12, 8.2); g.restore();
  g.save(); g.beginPath(); g.rect(12, h - 11, w - 24, 6); g.clip();
  g.fillText(rowH(w), 12, h - 7.8); g.restore();
  g.save(); g.translate(8.2, h - 12); g.rotate(-Math.PI / 2);
  g.beginPath(); g.rect(0, -3, h - 24, 6); g.clip(); g.fillText(rowH(h), 0, 0); g.restore();
  g.save(); g.translate(w - 8.2, 12); g.rotate(Math.PI / 2);
  g.beginPath(); g.rect(0, -3, h - 24, 6); g.clip(); g.fillText(rowH(h), 0, 0); g.restore();

  // label
  const pad = Math.max(20, w * 0.06);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = C.text;
  g.font = `800 ${Math.round(clamp(h * 0.095, 10, 22))}px ${DISPLAY}`;
  setSpacing(g, 2.5);
  g.fillText(String(note.label || 'PAYCHECK').toUpperCase(), pad, 16 + h * 0.13);
  setSpacing(g, 0);
  // serial
  g.font = `600 ${Math.round(clamp(h * 0.062, 7, 13))}px ${MONO}`;
  g.fillStyle = C.hi;
  g.textAlign = 'right';
  const serial = String(note.serial || 'CC-0000');
  g.fillText(serial, w - pad, 16 + h * 0.12);
  g.save(); g.translate(w - pad * 0.72, h * 0.62); g.rotate(-Math.PI / 2);
  g.textAlign = 'center'; g.fillStyle = 'rgba(244,236,238,0.35)';
  g.font = `600 ${Math.round(clamp(h * 0.05, 6, 10))}px ${MONO}`;
  g.fillText(serial, 0, 0); g.restore();

  // amount
  const amt = String(note.amountText || '');
  const maxW = w * 0.56;
  let fs = Math.round(h * 0.36);
  g.font = `900 ${fs}px ${DISPLAY}`;
  g.textAlign = 'left';
  let tw = g.measureText(amt).width;
  if (tw > maxW) { fs = Math.max(10, Math.floor(fs * maxW / tw)); g.font = `900 ${fs}px ${DISPLAY}`; }
  const ay = h * 0.66;
  g.fillStyle = C.deep;
  g.fillText(amt, pad + 2, ay + 2);
  gr = g.createLinearGradient(0, ay - fs * 0.8, 0, ay);
  gr.addColorStop(0, '#FFFFFF');
  gr.addColorStop(0.55, '#F4ECEE');
  gr.addColorStop(1, C.soft);
  g.fillStyle = gr;
  g.fillText(amt, pad, ay);
  g.font = `600 ${Math.round(clamp(h * 0.048, 6, 10))}px ${MONO}`;
  g.fillStyle = 'rgba(244,236,238,0.55)';
  setSpacing(g, 1);
  g.fillText('LEGAL TENDER FOR ALL BUCKETS', pad, ay + h * 0.13);
  g.fillStyle = rgba(C.hi, 0.8);
  g.fillText('SERIES MMXXVI · PAY TO THE BEARER', pad, ay + h * 0.21);
  setSpacing(g, 0);

  // edge vignette
  gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  // top bevel highlight
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
  rrect(g, 0.5, 0.5, w - 1, h - 1, rad); g.stroke();
  return c;
}

function renderNoteBack(w, h, dpr) {
  const c = mkCanvas(w * dpr, h * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const rad = Math.min(12, h * 0.08);
  rrect(g, 0, 0, w, h, rad);
  g.clip();
  let gr = g.createLinearGradient(w, 0, 0, h);
  gr.addColorStop(0, '#2F2529');
  gr.addColorStop(0.5, '#171113');
  gr.addColorStop(1, C.n2);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  drawRosette(g, w * 0.5, h * 0.5, Math.min(h * 0.46, w * 0.3), 18, 13, C.hi, 0.2, 0.6);
  g.fillStyle = rgba(C.hi, 0.9);
  g.font = `900 ${Math.round(h * 0.22)}px ${DISPLAY}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  setSpacing(g, 3);
  g.fillText('CLEAN CUT', w / 2, h / 2);
  setSpacing(g, 0);
  g.strokeStyle = rgba(C.hi, 0.5); g.lineWidth = 1;
  rrect(g, 4.5, 4.5, w - 9, h - 9, rad - 3); g.stroke();
  return c;
}

function renderShadow(w, h) {
  const pad = 60;
  const c = mkCanvas(w + pad * 2, h + pad * 2);
  const g = c.getContext('2d');
  g.shadowColor = 'rgba(0,0,0,0.9)';
  g.shadowBlur = 36;
  g.shadowOffsetX = 0; g.shadowOffsetY = 0;
  g.fillStyle = '#000';
  rrect(g, pad, pad, w, h, 12);
  g.fill();
  return { c, pad };
}

function computeWidths(pieces, w) {
  const n = pieces.length;
  const minW = Math.min(w / n, Math.max(14, w * 0.045));
  let wts = pieces.map((p) => { const a = Number(p && p.amount); return isFinite(a) && a > 0 ? a : 0; });
  if (wts.reduce((s, v) => s + v, 0) <= 0) wts = wts.map(() => 1);
  const fixed = new Array(n).fill(false);
  let ws = new Array(n).fill(w / n);
  for (let iter = 0; iter <= n; iter++) {
    let freeSum = 0, fixedN = 0;
    for (let i = 0; i < n; i++) { if (fixed[i]) fixedN++; else freeSum += wts[i]; }
    const freeW = w - fixedN * minW;
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) { ws[i] = minW; continue; }
      ws[i] = freeSum > 0 ? (freeW * wts[i]) / freeSum : freeW / Math.max(1, n - fixedN);
      if (ws[i] < minW) { fixed[i] = true; changed = true; }
    }
    if (!changed) break;
  }
  const xs = []; let acc = 0;
  for (let i = 0; i < n; i++) { xs.push(acc); acc += ws[i]; }
  return { xs, ws };
}

// ================================================================ createFx
export function createFx(canvas, { reduceMotion = false } = {}) {
  let ctx = null;
  try { ctx = canvas && canvas.getContext && canvas.getContext('2d'); } catch (e) { ctx = null; }
  let W = 1, H = 1, dpr = 1;
  let raf = 0, last = 0;
  let rm = !!reduceMotion;

  const parts = [];
  const pool = [];
  const MAX = 1600;
  const scratch = {};
  const shocks = [];
  const flashes = [];
  const rings = [];
  const trail = [];
  let scene = null;
  let queue = Promise.resolve();
  let busyCount = 0;

  function resize() {
    try {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, canvas.clientWidth || window.innerWidth || 1);
      H = Math.max(1, canvas.clientHeight || window.innerHeight || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      kick();
    } catch (e) { /* ignore */ }
  }
  resize();
  try {
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
  } catch (e) { /* ignore */ }
  try {
    if (document.fonts && document.fonts.load) {
      document.fonts.load(`900 40px "Big Shoulders Display"`).catch(() => {});
      document.fonts.load(`800 40px "Big Shoulders Display"`).catch(() => {});
      document.fonts.load(`600 12px "JetBrains Mono"`).catch(() => {});
    }
  } catch (e) { /* ignore */ }

  // ---------------------------------------------------- particles
  // kinds: 0 spark streak, 1 glow sprite, 2 confetti shard, 3 coin, 4 ember
  function spawn(kind) {
    if (parts.length >= MAX) return scratch;
    const p = pool.pop() || {};
    p.kind = kind; p.x = 0; p.y = 0; p.vx = 0; p.vy = 0; p.life = 0; p.max = 1;
    p.size = 2; p.color = C.hi; p.drag = 0; p.g = 0; p.rot = 0; p.vr = 0; p.flip = 0; p.vf = 0;
    p.w = 0; p.h = 0; p.alpha = 1; p.hot = false;
    parts.push(p);
    return p;
  }

  function spark(x, y, vx, vy, color, life, size, grav = 500, drag = 2.6, hot = true) {
    const p = spawn(0);
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.color = color; p.max = life; p.size = size; p.g = grav; p.drag = drag; p.hot = hot;
    return p;
  }
  function glow(x, y, color, size, life, vx = 0, vy = 0, alpha = 1) {
    const p = spawn(1);
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.color = color; p.size = size; p.max = life; p.alpha = alpha; p.drag = 2;
    return p;
  }
  function ember(x, y, color) {
    const p = spawn(4);
    p.x = x; p.y = y; p.vx = rand(-30, 30); p.vy = rand(-90, -20); p.color = color; p.size = rand(5, 11); p.max = rand(0.35, 0.8); p.drag = 1.5; p.g = -60;
    p.rot = rand(0, TAU);
    return p;
  }

  function kick() {
    if (!raf && ctx) {
      last = performance.now();
      try { raf = requestAnimationFrame(frame); } catch (e) { raf = 0; }
    }
  }

  function active() {
    return parts.length || shocks.length || flashes.length || rings.length || trail.length || scene;
  }

  function frame(now) {
    raf = -1; // in-frame: kick() must not schedule a second loop
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.05) dt = 0.05;
    try {
      update(dt, now);
      draw(now);
    } catch (e) {
      try { console.warn('[fx]', e); } catch (_) { /* ignore */ }
      if (scene) finishScene(scene);
    }
    raf = 0;
    if (active()) raf = requestAnimationFrame(frame);
    else { try { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); } catch (e) { /* ignore */ } }
  }

  function update(dt, now) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.max || p.y > H + 80) {
        parts[i] = parts[parts.length - 1]; parts.pop(); pool.push(p);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d + p.g * dt;
      if (p.kind === 2) {
        // flutter: lift/sideways drift tied to flip phase
        p.flip += p.vf * dt;
        p.vx += Math.sin(p.flip * 0.7 + p.rot) * 60 * dt;
      } else if (p.kind === 3) {
        p.flip += p.vf * dt;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (let i = shocks.length - 1; i >= 0; i--) { shocks[i].t += dt; if (shocks[i].t >= shocks[i].max) shocks.splice(i, 1); }
    for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].t += dt; if (flashes[i].t >= flashes[i].max) flashes.splice(i, 1); }
    for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t >= rings[i].max) rings.splice(i, 1); }
    while (trail.length && now - trail[0].t > 250) trail.shift();
    if (scene) updateScene(scene, dt);
  }

  function setXf(x, y, rot, sx, sy) {
    const c = Math.cos(rot), s = Math.sin(rot);
    ctx.setTransform(dpr * c * sx, dpr * s * sx, -dpr * s * sy, dpr * c * sy, dpr * x, dpr * y);
  }

  function draw(now) {
    const g = ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (scene) drawScene(scene, now);

    // normal-composite particles
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.kind !== 2 && p.kind !== 3) continue;
      const k = p.life / p.max;
      g.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
      if (p.kind === 2) {
        const fy = Math.cos(p.flip);
        setXf(p.x, p.y, p.rot, 1, Math.abs(fy) < 0.08 ? 0.08 : fy);
        g.fillStyle = fy < 0 && p.color !== '#FFFFFF' ? p.dark || p.color : p.color;
        g.beginPath();
        g.moveTo(-p.w * 0.5, -p.h * 0.5);
        g.lineTo(p.w * 0.5, -p.h * 0.35);
        g.lineTo(p.w * 0.3, p.h * 0.5);
        g.lineTo(-p.w * 0.45, p.h * 0.3);
        g.closePath();
        g.fill();
      } else {
        const fx_ = Math.cos(p.flip);
        setXf(p.x, p.y, p.rot, Math.abs(fx_) < 0.1 ? 0.1 : Math.abs(fx_), 1);
        g.fillStyle = fx_ > 0 ? '#E8E0E2' : '#9C8E93';
        g.beginPath(); g.arc(0, 0, p.size, 0, TAU); g.fill();
        g.strokeStyle = C.crimson; g.lineWidth = 1.4;
        g.beginPath(); g.arc(0, 0, p.size * 0.72, 0, TAU); g.stroke();
        g.fillStyle = C.crimson;
        g.fillRect(-p.size * 0.18, -p.size * 0.42, p.size * 0.36, p.size * 0.84);
      }
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;

    // additive pass
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const k = p.life / p.max;
      if (p.kind === 0) {
        const a = 1 - k;
        const len = 0.028 + 0.02 * (1 - k);
        g.globalAlpha = a;
        g.strokeStyle = p.color;
        g.lineWidth = p.size * (1 - k * 0.6);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * len, p.y - p.vy * len);
        g.stroke();
        if (p.hot && k < 0.5) {
          g.strokeStyle = '#FFFFFF';
          g.lineWidth = p.size * 0.45;
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.vx * len * 0.6, p.y - p.vy * len * 0.6);
          g.stroke();
        }
      } else if (p.kind === 1) {
        const s = p.size * (1 - k * 0.5);
        g.globalAlpha = p.alpha * (1 - k) * (1 - k);
        g.drawImage(glowSprite(p.color), p.x - s / 2, p.y - s / 2, s, s);
      } else if (p.kind === 4) {
        const flick = 0.6 + 0.4 * Math.sin(p.life * 40 + p.rot);
        const s = p.size * (1 - k);
        g.globalAlpha = flick * (1 - k);
        g.drawImage(glowSprite(p.color), p.x - s / 2, p.y - s / 2, s, s);
      }
    }

    // target impact rings
    for (const r of rings) {
      const k = r.t / r.max;
      const e = easeOutCubic(k);
      const grow = 10 * e;
      g.globalAlpha = (1 - k) * 0.9;
      g.strokeStyle = r.color;
      g.lineWidth = 6 * (1 - k) + 1;
      rrect(g, r.x - grow, r.y - grow, r.w + grow * 2, r.h + grow * 2, 14 + grow);
      g.stroke();
      g.globalAlpha = (1 - k) * (1 - k) * 0.35;
      g.fillStyle = r.color;
      rrect(g, r.x, r.y, r.w, r.h, 14);
      g.fill();
    }

    // shockwaves
    for (const s of shocks) {
      const k = s.t / s.max;
      const e = easeOutExpo(k);
      const R = Math.max(1, s.r * e);
      const a = 1 - k;
      g.strokeStyle = s.color;
      g.globalAlpha = a * 0.28;
      g.lineWidth = (26 * (1 - k) + 2) * s.thick;
      g.beginPath(); g.arc(s.x, s.y, R, 0, TAU); g.stroke();
      g.globalAlpha = a * 0.85;
      g.lineWidth = (7 * (1 - k) + 1) * s.thick;
      g.beginPath(); g.arc(s.x, s.y, R, 0, TAU); g.stroke();
      g.strokeStyle = '#FFFFFF';
      g.globalAlpha = a * a;
      g.lineWidth = (2.2 * (1 - k) + 0.5) * s.thick;
      g.beginPath(); g.arc(s.x, s.y, R, 0, TAU); g.stroke();
      if (k < 0.3) {
        const gs = s.r * 0.9 * (0.4 + k);
        g.globalAlpha = (1 - k / 0.3) * 0.7;
        g.drawImage(glowSprite(s.color), s.x - gs / 2, s.y - gs / 2, gs, gs);
      }
    }

    // blade trail
    drawTrail(now);

    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // flashes
    for (const f of flashes) {
      const k = f.t / f.max;
      const a = f.s * Math.pow(1 - k, 1.7) * 0.62;
      if (a <= 0.002) continue;
      const m = clamp(k / 0.35, 0, 1);
      const r = Math.round(lerp(255, 220, m)), gg = Math.round(lerp(250, 20, m)), b = Math.round(lerp(252, 60, m));
      g.fillStyle = `rgba(${r},${gg},${b},${a})`;
      g.fillRect(0, 0, W, H);
    }
  }

  function drawTrail(now) {
    const n = trail.length;
    if (!n) return;
    const g = ctx;
    const passes = [
      [C.crimson, 22, 0.22],
      [C.hi, 9, 0.75],
      ['#FFFFFF', 3, 1],
    ];
    for (const [col, wid, al] of passes) {
      g.strokeStyle = col;
      for (let i = 1; i < n; i++) {
        const a = trail[i - 1], b = trail[i];
        const age = (now - b.t) / 250;
        const f = clamp(1 - age, 0, 1);
        if (f <= 0) continue;
        const pos = i / (n - 1);
        g.globalAlpha = al * f * (0.35 + 0.65 * pos);
        g.lineWidth = Math.max(0.5, wid * f * (0.3 + 0.7 * pos));
        g.beginPath();
        if (i > 1) {
          const z = trail[i - 2];
          g.moveTo((z.x + a.x) / 2, (z.y + a.y) / 2);
          g.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
          g.lineTo(b.x, b.y);
        } else {
          g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
        }
        g.stroke();
      }
    }
    const head = trail[n - 1];
    const f = clamp(1 - (now - head.t) / 250, 0, 1);
    if (f > 0) {
      g.globalAlpha = f;
      const s = 46;
      g.drawImage(glowSprite(C.hi), head.x - s / 2, head.y - s / 2, s, s);
    }
  }

  // ---------------------------------------------------- public effects
  function sparkBurst(x, y, { color = C.hi, count = 24, power = 1 } = {}) {
    if (rm || !ctx) return;
    try {
      x = num(x, W / 2); y = num(y, H / 2);
      count = clamp(Math.round(num(count, 24)), 0, 300);
      power = clamp(num(power, 1), 0.1, 4);
      glow(x, y, color, 120 * power, 0.28, 0, 0, 1);
      glow(x, y, '#FFFFFF', 50 * power, 0.14, 0, 0, 1);
      for (let i = 0; i < count; i++) {
        const a = rand(0, TAU);
        const sp = rand(140, 620) * power;
        spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, i % 4 === 0 ? '#FFFFFF' : color, rand(0.3, 0.75), rand(1.4, 3.2), 520, 3.2, true);
      }
      for (let i = 0; i < Math.ceil(count / 6); i++) ember(x + rand(-10, 10), y + rand(-10, 10), color);
      kick();
    } catch (e) { /* never throw */ }
  }

  function confetti(x, y, { count = 160 } = {}) {
    if (rm || !ctx) return;
    try {
      x = num(x, W / 2); y = num(y, H / 2);
      count = clamp(Math.round(num(count, 160)), 0, 600);
      for (let i = 0; i < count; i++) {
        const coin = Math.random() < 0.07;
        const p = spawn(coin ? 3 : 2);
        const a = -Math.PI / 2 + rand(-1.25, 1.25);
        const sp = rand(260, 980);
        p.x = x + rand(-8, 8); p.y = y + rand(-8, 8);
        p.vx = Math.cos(a) * sp * 1.1; p.vy = Math.sin(a) * sp;
        p.g = rand(700, 1000); p.drag = rand(1.6, 2.6);
        p.max = rand(1.6, 2.7);
        p.rot = rand(0, TAU); p.vr = rand(-9, 9);
        p.flip = rand(0, TAU); p.vf = rand(6, 16);
        if (coin) { p.size = rand(4.5, 7); p.vr = rand(-2, 2); p.vf = rand(10, 22); }
        else {
          p.color = CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0];
          p.dark = p.color === '#F4ECEE' || p.color === '#FFFFFF' ? '#B8AEB2' : p.color === '#9C8E93' ? '#6E6468' : C.deep;
          p.w = rand(5, 12); p.h = rand(3, 7);
        }
      }
      // a few glinting sparks riding the burst
      for (let i = 0; i < 26; i++) {
        const a = -Math.PI / 2 + rand(-1.4, 1.4);
        const sp = rand(300, 900);
        spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, i % 2 ? C.hi : '#FFFFFF', rand(0.4, 0.9), rand(1.5, 2.8), 700, 2.2);
      }
      kick();
    } catch (e) { /* never throw */ }
  }

  function shockwave(x, y, { color = C.hi, radius = 300 } = {}) {
    if (rm || !ctx) return;
    try {
      radius = clamp(num(radius, 300), 10, 3000);
      shocks.push({ x: num(x, W / 2), y: num(y, H / 2), color, r: radius, t: 0, max: 0.45 + radius / 1400, thick: clamp(radius / 300, 0.45, 1.6) });
      kick();
    } catch (e) { /* never throw */ }
  }

  function flash(strength = 1) {
    if (rm || !ctx) return;
    try {
      const s = clamp(num(strength, 1), 0, 1);
      if (s <= 0) return;
      flashes.push({ s, t: 0, max: 0.18 + 0.14 * s });
      kick();
    } catch (e) { /* never throw */ }
  }

  function addTrail(x, y) {
    if (rm || !ctx) return;
    try {
      x = num(x, NaN); y = num(y, NaN);
      if (isNaN(x) || isNaN(y)) return;
      const now = performance.now();
      const prev = trail[trail.length - 1];
      trail.push({ x, y, t: now });
      if (trail.length > 48) trail.shift();
      if (prev) {
        const dx = x - prev.x, dy = y - prev.y;
        const sp = Math.hypot(dx, dy);
        if (sp > 6 && Math.random() < 0.6) {
          const n = sp > 30 ? 2 : 1;
          for (let i = 0; i < n; i++) {
            spark(x, y, -dx * rand(4, 10) + rand(-80, 80), -dy * rand(4, 10) + rand(-80, 80), Math.random() < 0.5 ? '#FFFFFF' : C.hi, rand(0.2, 0.4), rand(1, 2), 300, 4);
          }
        }
      }
      kick();
    } catch (e) { /* never throw */ }
  }

  // ---------------------------------------------------- the cutscene
  function playSplit(opts = {}) {
    const run = () => new Promise((resolve) => {
      busyCount++;
      const done = () => { busyCount = Math.max(0, busyCount - 1); resolve(); };
      try {
        if (rm || !ctx) playReduced(opts || {}, done);
        else startScene(opts || {}, done);
      } catch (e) {
        try { console.warn('[fx] playSplit', e); } catch (_) { /* ignore */ }
        playReduced(opts || {}, done);
      }
    });
    busyCount++; // mark busy immediately, even while queued
    const p = queue.then(() => { busyCount--; return run(); });
    queue = p.catch(() => {});
    return p;
  }

  function safeCall(fn, ...args) {
    if (typeof fn !== 'function') return;
    try { fn(...args); } catch (e) { try { console.warn('[fx] callback', e); } catch (_) { /* ignore */ } }
  }

  function playReduced(o, done) {
    const pieces = Array.isArray(o.pieces) ? o.pieces : [];
    const total = Math.max(1, pieces.length - 1);
    let finished = false;
    const fin = () => { if (finished) return; finished = true; safeCall(o.onDone); done(); };
    setTimeout(() => {
      safeCall(o.onSlash, 0, total);
      pieces.forEach((_, i) => setTimeout(() => safeCall(o.onHit, i), 120 * (i + 1)));
      setTimeout(fin, 120 * (pieces.length + 1));
    }, 0);
  }

  function validRect(r) {
    return r && isFinite(r.x) && isFinite(r.y) && isFinite(r.width) && isFinite(r.height) && r.width > 0 && r.height > 0;
  }

  function startScene(o, done) {
    const pieces = (Array.isArray(o.pieces) ? o.pieces : []).filter((p) => p && typeof p === 'object');
    const note = o.note && typeof o.note === 'object' ? o.note : {};
    if (!pieces.length) {
      // nothing to split: a lone slash so the gesture still lands
      setTimeout(() => { safeCall(o.onSlash, 0, 1); safeCall(o.onDone); done(); }, 0);
      return;
    }
    let rect = note.rect;
    if (!validRect(rect)) {
      const w = Math.min(W * 0.9, 360), h = w * 0.46;
      rect = { x: (W - w) / 2, y: H * 0.3, width: w, height: h };
    }
    const w = Math.max(40, rect.width), h = Math.max(24, rect.height);
    const n = pieces.length;
    const total = n > 1 ? n - 1 : 1;
    const { xs, ws } = computeWidths(pieces, w);

    const front = renderNoteFront(w, h, dpr, note);
    const back = renderNoteBack(w, h, dpr);
    const shadow = renderShadow(w, h);

    // timeline (ms)
    const T_LIFT = 480;
    const cutStart = 720;
    const gap = clamp(560 / total, 60, 115);
    const TRAVEL = 70;
    const lands = [];
    for (let k = 0; k < total; k++) lands.push(cutStart + k * gap + TRAVEL);
    const lastLand = lands[lands.length - 1];
    const sepStart = lastLand + (n > 1 ? 80 : 160);
    const SEP = 380;
    const flyStart = sepStart + (n > 1 ? 280 : 200);
    const stagger = clamp(430 / n, 45, 95);
    const FLY = 640;
    const arrive = pieces.map((_, i) => flyStart + i * stagger + FLY);
    const finaleAt = arrive[n - 1] + 110;
    const endAt = finaleAt + 780;

    const liftScale = Math.min(1.1, (W * 0.92) / w, (H * 0.5) / h);
    const home = { x: W / 2, y: clamp(H * 0.4, h * liftScale * 0.6 + 20, H - h * liftScale * 0.6 - 20) };

    const cuts = [];
    if (n > 1) {
      for (let k = 0; k < total; k++) {
        const cx = xs[k + 1];
        const dir = k % 2 ? 1 : -1;
        const ang = dir * rand(0.14, 0.3);
        cuts.push({ x: cx, ang, start: lands[k] - TRAVEL, land: lands[k], landed: false });
      }
    } else {
      cuts.push({ x: w / 2, ang: -0.85, start: lands[0] - TRAVEL, land: lands[0], landed: false, big: true });
    }

    const spread = n > 1 ? Math.min(16, 90 / n) + 5 : 0;
    const sepFit = Math.min(1, (W * 0.95) / (liftScale * 1.035 * (w + (n - 1) * spread)));
    const strips = pieces.map((p, i) => {
      const target = validRect(p.target) ? p.target : null;
      const color = typeof p.color === 'string' && p.color ? p.color : C.hi;
      return {
        i, color, target,
        sx: xs[i], sw: ws[i],
        lx: xs[i] + ws[i] / 2 - w / 2,
        dx: (i - (n - 1) / 2) * spread, dy: rand(-10, 10) + (i % 2 ? 6 : -6),
        dr: rand(-0.09, 0.09),
        flying: false, hit: false,
        f: null, hist: [],
        start: flyStart + i * stagger,
        arrive: arrive[i],
      };
    });

    const s = {
      o, done, t: 0, w, h, n, total, rect, front, back, shadow, cuts, strips,
      sepFit, T_LIFT, cutStart, sepStart, SEP, flyStart, finaleAt, endAt, liftScale, home,
      shake: 0, shx: 0, shy: 0, finale: false, finished: false, dim: 0,
      N: { x: rect.x + w / 2, y: rect.y + h / 2, s: 1, r: 0 },
    };
    s.timer = setTimeout(() => finishScene(s), endAt + 4000);
    scene = s;
    kick();
  }

  function finishScene(s) {
    if (s.finished) return;
    s.finished = true;
    clearTimeout(s.timer);
    for (let k = 0; k < s.cuts.length; k++) {
      const c = s.cuts[k];
      if (!c.landed) { c.landed = true; if (s.n > 1 || k === 0) safeCall(s.o.onSlash, k, s.total); }
    }
    for (const st of s.strips) if (!st.hit) { st.hit = true; safeCall(s.o.onHit, st.i); }
    if (scene === s) scene = null;
    safeCall(s.o.onDone);
    s.done();
  }

  // world transform of strip centre while attached / separating
  function stripWorld(s, st, sepE) {
    const N = s.N;
    const lx = (st.lx + st.dx * sepE) * N.s, ly = st.dy * sepE * N.s;
    const c = Math.cos(N.r), sn = Math.sin(N.r);
    return { x: N.x + s.shx + lx * c - ly * sn, y: N.y + s.shy + lx * sn + ly * c, r: N.r + st.dr * sepE, s: N.s };
  }

  function updateScene(s, dt) {
    s.t += dt * 1000;
    const t = s.t;
    const N = s.N;

    // lift
    const lp = clamp(t / s.T_LIFT, 0, 1);
    const le = easeOutBack(lp);
    const sx0 = s.rect.x + s.w / 2, sy0 = s.rect.y + s.h / 2;
    N.x = lerp(sx0, s.home.x, le);
    N.y = lerp(sy0, s.home.y, le);
    // slow-mo hover: a gentle continuing push-in until the cuts start
    const hover = clamp((t - s.T_LIFT) / (s.cutStart - s.T_LIFT), 0, 1);
    N.s = lerp(1, s.liftScale, le) * (1 + 0.035 * easeOutCubic(hover));
    N.r = lerp(0, -0.05, le) + 0.02 * Math.sin(t / 380);
    if (t > s.sepStart) {
      const sp = easeOutCubic(clamp((t - s.sepStart) / s.SEP, 0, 1));
      N.r *= 1 - sp * 0.6;
      N.s *= lerp(1, s.sepFit, sp);
    }

    // dim
    const fin = s.finale ? clamp((t - s.finaleAt) / 520, 0, 1) : 0;
    s.dim = 0.62 * easeOutCubic(clamp(t / 380, 0, 1)) * (1 - fin);

    // shake
    s.shake *= Math.exp(-dt * 14);
    s.shx = rand(-1, 1) * s.shake; s.shy = rand(-1, 1) * s.shake;

    // cuts
    for (let k = 0; k < s.cuts.length; k++) {
      const c = s.cuts[k];
      if (!c.landed && t >= c.land) {
        c.landed = true;
        landCut(s, c, k);
      }
    }

    const sepE = easeOutCubic(clamp((t - s.sepStart) / s.SEP, 0, 1));
    // embers from glowing cut edges
    if (t > s.sepStart && t < s.flyStart + 200 && s.n > 1) {
      for (let e = 0; e < 3; e++) {
        const st = s.strips[(Math.random() * s.n) | 0];
        if (st.flying) continue;
        const W_ = stripWorld(s, st, sepE);
        const side = st.i === 0 ? 1 : st.i === s.n - 1 ? -1 : Math.random() < 0.5 ? -1 : 1;
        const ex = side * st.sw / 2 * W_.s, ey = rand(-0.5, 0.5) * s.h * W_.s;
        const c = Math.cos(W_.r), sn = Math.sin(W_.r);
        ember(W_.x + ex * c - ey * sn, W_.y + ex * sn + ey * c, st.color);
      }
    }

    // flight
    for (const st of s.strips) {
      if (st.hit) continue;
      if (!st.flying && t >= st.start) {
        const from = stripWorld(s, st, sepE);
        st.flying = true;
        const tg = st.target || { x: W / 2 - 20, y: H + 40, width: 40, height: 40 };
        const tx = tg.x + tg.width / 2, ty = tg.y + tg.height / 2;
        const endS = Math.min((tg.width * 0.8) / st.sw, (tg.height * 0.85) / s.h, from.s);
        const dist = Math.hypot(tx - from.x, ty - from.y);
        const side = (st.i - (s.n - 1) / 2) * 30 + rand(-40, 40);
        st.f = {
          x0: from.x, y0: from.y, r0: from.r, s0: from.s,
          cx: clamp((from.x + tx) / 2 + side, 30, W - 30), cy: Math.min(from.y, ty) - Math.min(260, 60 + dist * 0.45),
          x1: tx, y1: ty, s1: Math.max(0.05, endS),
          turns: (st.i % 2 ? -1 : 1) * (s.n > 6 ? 1 : 1),
          wob: rand(-0.6, 0.6),
        };
        // launch kick
        for (let k = 0; k < 8; k++) spark(from.x, from.y, rand(-200, 200), rand(-260, 60), k % 2 ? '#FFFFFF' : st.color, rand(0.25, 0.5), rand(1.2, 2.4), 400, 3);
      }
      if (st.flying) {
        const p = clamp((t - st.start) / (st.arrive - st.start), 0, 1);
        const f = st.f;
        const e = easeInOutCubic(p);
        const u = 1 - e;
        st.x = u * u * f.x0 + 2 * u * e * f.cx + e * e * f.x1;
        st.y = u * u * f.y0 + 2 * u * e * f.cy + e * e * f.y1;
        st.hist.push(st.x, st.y);
        if (st.hist.length > 20) st.hist.splice(0, 2);
        if (p < 0.98) {
          spark(st.x + rand(-4, 4), st.y + rand(-4, 4), rand(-60, 60), rand(-60, 60), Math.random() < 0.35 ? '#FFFFFF' : st.color, rand(0.25, 0.5), rand(1.2, 2.4), 260, 3, true);
          if (Math.random() < 0.7) glow(st.x, st.y, st.color, rand(18, 34), rand(0.25, 0.45), 0, 0, 0.8);
        }
        if (p >= 1) {
          st.hit = true;
          const tg = st.target;
          if (tg) {
            const tx = tg.x + tg.width / 2, ty = tg.y + tg.height / 2;
            sparkBurst(tx, ty, { color: st.color, count: 26, power: 1 });
            shockwave(tx, ty, { color: st.color, radius: Math.max(60, Math.min(140, tg.width * 0.8)) });
            rings.push({ x: tg.x, y: tg.y, w: tg.width, h: tg.height, color: st.color, t: 0, max: 0.5 });
          }
          safeCall(s.o.onHit, st.i);
        }
      }
    }

    if (!s.finale && t >= s.finaleAt) {
      s.finale = true;
      const cx = W / 2, cy = H * 0.45;
      shockwave(cx, cy, { color: C.hi, radius: Math.max(W, H) * 0.75 });
      shocks.push({ x: cx, y: cy, color: C.soft, r: Math.max(W, H) * 0.42, t: 0, max: 0.55, thick: 0.5 });
      confetti(cx, cy, { count: 170 });
      sparkBurst(cx, cy, { color: C.hi, count: 40, power: 1.6 });
      flash(0.4);
    }
    if (t >= s.endAt) finishScene(s);
  }

  function landCut(s, c, k) {
    // world-space slash line through cut
    const N = s.N;
    const ext = s.h * 0.5 + 70 / Math.max(0.5, N.s);
    const lx = c.x - s.w / 2;
    const tn = Math.tan(c.ang);
    const a = { x: lx + tn * ext, y: -ext }, b = { x: lx - tn * ext, y: ext };
    const co = Math.cos(N.r), sn = Math.sin(N.r);
    const toW = (p) => ({ x: N.x + (p.x * co - p.y * sn) * N.s, y: N.y + (p.x * sn + p.y * co) * N.s });
    const A = toW(a), B = toW(b);
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const big = !!c.big;
    const cnt = big ? 46 : 20;
    for (let i = 0; i < cnt; i++) {
      const u = rand(0.15, 0.85);
      const px = A.x + dx * u, py = A.y + dy * u;
      const side = Math.random() < 0.5 ? -1 : 1;
      const sp = rand(120, big ? 700 : 480);
      const along = rand(0.2, 0.9) * (big ? 500 : 300);
      spark(px, py, nx * side * sp + (dx / L) * along, ny * side * sp + (dy / L) * along, i % 3 === 0 ? '#FFFFFF' : i % 3 === 1 ? C.hi : C.crimson, rand(0.25, 0.6), rand(1.2, 2.8), 500, 2.8);
    }
    const mx = A.x + dx * 0.5, my = A.y + dy * 0.5;
    glow(mx, my, '#FFFFFF', big ? 260 : 150, 0.22, 0, 0, 1);
    glow(mx, my, C.hi, big ? 420 : 240, 0.3, 0, 0, 0.8);
    flash(big ? 0.55 : k === s.total - 1 ? 0.32 : 0.16);
    s.shake = Math.max(s.shake, big ? 12 : 6);
    if (big) shockwave(mx, my, { color: C.hi, radius: 220 });
    safeCall(s.o.onSlash, k, s.total);
  }

  function drawStrip(s, st, x, y, r, sc, flipX, alpha, edge) {
    const g = ctx;
    const sw = st.sw, h = s.h;
    const isBack = flipX < 0;
    const img = isBack ? s.back : s.front;
    g.globalAlpha = alpha;
    g.globalCompositeOperation = 'source-over';
    // back face: mirror the source region and un-mirror the draw so its text reads correctly
    setXf(x, y, r, sc * Math.abs(flipX), sc);
    const sx0 = isBack ? s.w - st.sx - sw : st.sx;
    const srcX = Math.max(0, Math.min(img.width - 1, sx0 * dpr));
    const srcW = Math.max(1, Math.min(img.width - srcX, sw * dpr));
    g.drawImage(img, srcX, 0, srcW, img.height, -sw / 2, -h / 2, sw, h);
    if (edge > 0.01 && s.n > 1) {
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'butt';
      const sides = [];
      const m = isBack ? -1 : 1;
      if (st.i > 0) sides.push((-sw / 2) * m);
      if (st.i < s.n - 1) sides.push((sw / 2) * m);
      for (const ex of sides) {
        g.strokeStyle = st.color;
        g.globalAlpha = alpha * edge * 0.45;
        g.lineWidth = 7 / sc;
        g.beginPath(); g.moveTo(ex, -h / 2); g.lineTo(ex, h / 2); g.stroke();
        g.globalAlpha = alpha * edge;
        g.lineWidth = 2.2 / sc;
        g.beginPath(); g.moveTo(ex, -h / 2); g.lineTo(ex, h / 2); g.stroke();
        g.strokeStyle = '#FFFFFF';
        g.globalAlpha = alpha * edge * 0.9;
        g.lineWidth = 0.8 / sc;
        g.beginPath(); g.moveTo(ex, -h / 2); g.lineTo(ex, h / 2); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
    }
  }

  function drawScene(s, now) {
    const g = ctx;
    const t = s.t;
    const N = s.N;
    if (s.dim > 0.005) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      const vg = g.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.8);
      vg.addColorStop(0, `rgba(9,9,12,${s.dim * 0.75})`);
      vg.addColorStop(1, `rgba(2,2,3,${Math.min(0.92, s.dim * 1.35)})`);
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
    }

    const sepE = easeOutCubic(clamp((t - s.sepStart) / s.SEP, 0, 1));
    const lp = clamp(t / s.T_LIFT, 0, 1);
    const cx = N.x + s.shx, cy = N.y + s.shy;

    // shadow under the (attached) note
    const anyAttached = s.strips.some((st) => !st.flying);
    if (anyAttached) {
      const sh = s.shadow;
      const fade = 1 - clamp((t - s.sepStart) / 260, 0, 1);
      g.globalAlpha = 0.85 * easeOutCubic(lp) * fade;
      setXf(cx, cy + 22 * lp * N.s, N.r, N.s * (1 + 0.04 * lp), N.s * (1 + 0.04 * lp));
      g.drawImage(sh.c, -s.w / 2 - sh.pad, -s.h / 2 - sh.pad);
      g.globalAlpha = 1;
    }

    // ---- attached note (before separation): draw as contiguous groups between landed cuts
    if (t < s.sepStart) {
      setXf(cx, cy, N.r, N.s, N.s);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.drawImage(s.front, -s.w / 2, -s.h / 2, s.w, s.h);
      // glint sweep during hover
      const gp = clamp((t - 300) / 520, 0, 1);
      if (gp > 0 && gp < 1) {
        g.save();
        rrect(g, -s.w / 2, -s.h / 2, s.w, s.h, Math.min(12, s.h * 0.08));
        g.clip();
        g.globalCompositeOperation = 'lighter';
        const gx = lerp(-s.w * 0.9, s.w * 0.9, easeInOutCubic(gp));
        const gr = g.createLinearGradient(gx - 60, -s.h / 2, gx + 60, s.h / 2);
        gr.addColorStop(0, 'rgba(255,255,255,0)');
        gr.addColorStop(0.45, 'rgba(255,190,205,0.16)');
        gr.addColorStop(0.5, 'rgba(255,255,255,0.5)');
        gr.addColorStop(0.55, 'rgba(255,190,205,0.16)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
        g.restore();
      }
      // seams for landed cuts
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'butt';
      for (const c of s.cuts) {
        if (!c.landed || c.big) continue;
        const age = (t - c.land) / 1000;
        const x = c.x - s.w / 2;
        const pulse = 0.75 + 0.25 * Math.sin(age * 40);
        g.strokeStyle = C.hi; g.globalAlpha = 0.5 * pulse; g.lineWidth = 6 / N.s;
        g.beginPath(); g.moveTo(x, -s.h / 2); g.lineTo(x, s.h / 2); g.stroke();
        g.strokeStyle = '#FFFFFF'; g.globalAlpha = 0.95; g.lineWidth = 1.4 / N.s;
        g.beginPath(); g.moveTo(x, -s.h / 2); g.lineTo(x, s.h / 2); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    } else {
      // ---- separated strips (not yet flying)
      const edge = 0.7 + 0.3 * Math.sin(t / 45);
      for (const st of s.strips) {
        if (st.flying) continue;
        const p = stripWorld(s, st, sepE);
        drawStrip(s, st, p.x, p.y, p.r, p.s, 1, 1, edge);
      }
    }

    // ---- flying strips
    for (const st of s.strips) {
      if (!st.flying || st.hit) continue;
      const f = st.f;
      const p = clamp((t - st.start) / (st.arrive - st.start), 0, 1);
      const e = easeInOutCubic(p);
      // motion ribbon
      const hs = st.hist;
      if (hs.length >= 4) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.globalCompositeOperation = 'lighter';
        g.lineCap = 'round';
        g.lineJoin = 'round';
        // tapered: draw nested tails, each shorter & wider, so the head is brightest
        for (let k = 0; k < 3; k++) {
          const from = Math.floor((hs.length / 2) * (k / 3)) * 2;
          if (hs.length - from < 4) break;
          g.strokeStyle = k === 2 ? '#FFFFFF' : st.color;
          g.globalAlpha = k === 2 ? 0.55 : 0.28;
          g.lineWidth = k === 2 ? 1.6 : (3 + 5 * k) * (1 - p * 0.4);
          g.beginPath();
          g.moveTo(hs[from], hs[from + 1]);
          for (let j = from + 2; j < hs.length; j += 2) g.lineTo(hs[j], hs[j + 1]);
          g.stroke();
        }
      }
      let sc = lerp(f.s0, f.s1, e);
      let alpha = 1;
      if (p > 0.86) { const q = (p - 0.86) / 0.14; sc *= 1 - 0.45 * q; alpha = 1 - q * 0.85; }
      const flip = Math.cos(e * TAU * f.turns);
      const flipX = Math.abs(flip) < 0.04 ? (flip < 0 ? -0.04 : 0.04) : flip;
      const rot = lerp(f.r0, 0, e) + Math.sin(p * Math.PI) * f.wob;
      const edge = Math.max(0, 1 - p * 1.3);
      drawStrip(s, st, st.x, st.y, rot, sc, flipX, alpha, edge);
    }

    // ---- slashes
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (const c of s.cuts) {
      if (t < c.start) continue;
      const age = t - c.land;
      if (age > 260) continue;
      const ext = s.h * 0.5 + (c.big ? 140 : 80) / Math.max(0.5, N.s);
      const lx = c.x - s.w / 2;
      const tn = Math.tan(c.ang);
      const co = Math.cos(N.r), sn = Math.sin(N.r);
      const toWx = (x, y) => cx + (x * co - y * sn) * N.s;
      const toWy = (x, y) => cy + (x * sn + y * co) * N.s;
      // direction alternates for a flurry feel
      const down = c.big || (s.cuts.indexOf(c) % 2 === 0);
      const ay0 = down ? -ext : ext, by0 = -ay0;
      const Ax = toWx(lx - tn * ay0, ay0), Ay = toWy(lx - tn * ay0, ay0);
      const Bx = toWx(lx - tn * by0, by0), By = toWy(lx - tn * by0, by0);
      const head = clamp((t - c.start) / (c.land - c.start), 0, 1);
      const tail = age > 0 ? clamp(age / 200, 0, 1) : 0;
      const hx = lerp(Ax, Bx, easeOutCubic(head)), hy = lerp(Ay, By, easeOutCubic(head));
      const tx0 = lerp(Ax, Bx, easeOutCubic(tail) * 0.999), ty0 = lerp(Ay, By, easeOutCubic(tail) * 0.999);
      const fade = age > 0 ? 1 - age / 260 : 1;
      const bw = c.big ? 1.6 : 1;
      g.strokeStyle = C.crimson; g.globalAlpha = 0.35 * fade; g.lineWidth = 22 * bw * fade;
      g.beginPath(); g.moveTo(tx0, ty0); g.lineTo(hx, hy); g.stroke();
      g.strokeStyle = C.hi; g.globalAlpha = 0.85 * fade; g.lineWidth = 7 * bw * fade + 1;
      g.beginPath(); g.moveTo(tx0, ty0); g.lineTo(hx, hy); g.stroke();
      g.strokeStyle = '#FFFFFF'; g.globalAlpha = fade; g.lineWidth = 2.6 * bw * fade + 0.6;
      g.beginPath(); g.moveTo(tx0, ty0); g.lineTo(hx, hy); g.stroke();
      if (head < 1 || age < 60) {
        const gs = c.big ? 140 : 80;
        g.globalAlpha = 1;
        g.drawImage(glowSprite('#FFFFFF'), hx - gs / 2, hy - gs / 2, gs, gs);
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const fx = {
    sparkBurst,
    confetti,
    shockwave,
    trail: addTrail,
    flash,
    playSplit,
    get busy() { return busyCount > 0 || !!scene; },
    get reduceMotion() { return rm; },
    set reduceMotion(v) { rm = !!v; },
    resize,
    destroy() {
      try {
        window.removeEventListener('resize', resize);
        window.removeEventListener('orientationchange', resize);
        if (raf > 0) cancelAnimationFrame(raf);
        raf = 0;
        parts.length = 0; shocks.length = 0; flashes.length = 0; rings.length = 0; trail.length = 0;
        if (scene) finishScene(scene);
        ctx && ctx.clearRect(0, 0, canvas.width, canvas.height);
      } catch (e) { /* ignore */ }
    },
  };
  return fx;
}

export default createFx;
