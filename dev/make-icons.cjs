// Renders the Clean Cut icon set and iOS launch screens with Playwright.
// Run from the repo root: NODE_PATH=$(npm root -g) node dev/make-icons.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RED = '#D0263F', PURPLE = '#8E4FD0';
const NOTES = [PURPLE, RED]; // ring halves: £20 purple bottom-right, £50 red top-left
const C = 2 * Math.PI * 19, Q = C / 2, GAP = 6;
const ROT = -45 + (GAP / C) * 180; // centre the gaps on the diagonals so the blade passes through them

function mark(uid) {
  // The disc is sliced along the diagonal and the two halves slide apart, with a blade glint in the gap.
  const arcs = NOTES.map((c, i) => `<circle cx="24" cy="24" r="19" fill="none" stroke="${c}" stroke-width="4.4" stroke-linecap="round" stroke-dasharray="${(Q - GAP).toFixed(2)} ${(C - Q + GAP).toFixed(2)}" stroke-dashoffset="${(-i * Q).toFixed(2)}"/>`).join('');
  const body = `<g transform="rotate(${ROT.toFixed(2)} 24 24)">${arcs}</g><circle cx="24" cy="24" r="10.5" fill="url(#sv${uid})"/>`;
  const d = 1.7; // how far each half slides
  return `<defs>
    <radialGradient id="sv${uid}" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#D9D5DF"/><stop offset="1" stop-color="#7E7788"/></radialGradient>
    <clipPath id="ca${uid}"><polygon points="-10,-10 58,-10 -10,58"/></clipPath>
    <clipPath id="cb${uid}"><polygon points="58,-10 58,58 -10,58"/></clipPath>
    <linearGradient id="bl${uid}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <g transform="translate(${-d} ${-d})"><g clip-path="url(#ca${uid})">${body}</g></g>
  <g transform="translate(${d} ${d})"><g clip-path="url(#cb${uid})">${body}</g></g>
  <path d="M3 45 L45 3" stroke="url(#bl${uid})" stroke-width=".9" stroke-linecap="round"/>`;
}

// Charcoal tile with a faint four-colour glow behind the mark.
function tileSVG(size, markScale) {
  const m = size * markScale, o = (size - m) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#1D1A24"/><stop offset=".6" stop-color="#0F0E13"/><stop offset="1" stop-color="#07070A"/></radialGradient>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${size * 0.06}"/></filter>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <g filter="url(#blur)" opacity=".55">
    <circle cx="${size * .36}" cy="${size * .38}" r="${size * .2}" fill="${RED}"/>
    <circle cx="${size * .64}" cy="${size * .62}" r="${size * .2}" fill="${PURPLE}"/>
  </g>
  <svg x="${o}" y="${o}" width="${m}" height="${m}" viewBox="0 0 48 48">${mark('t')}</svg>
</svg>`;
}

const fontCSS = `
@font-face{font-family:BSD;src:url('file://${ROOT}/fonts/big-shoulders-display-latin.woff2') format('woff2');font-weight:600 900}
@font-face{font-family:JBM;src:url('file://${ROOT}/fonts/jetbrains-mono-latin.woff2') format('woff2');font-weight:400 600}`;

function splashHTML(w, h, dpr) {
  const cw = w / dpr, ch = h / dpr, logo = Math.round(Math.min(cw, ch) * 0.34);
  return `<!doctype html><html><head><style>${fontCSS}
  html,body{margin:0;width:${cw}px;height:${ch}px;background:radial-gradient(80% 55% at 50% 42%,#1B1822,#0B0A0E 60%,#060609);overflow:hidden}
  .w{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(logo * .16)}px}
  .glow{position:absolute;width:${logo * 2}px;height:${logo * 2}px;left:50%;top:50%;transform:translate(-50%,-62%);filter:blur(${logo * .28}px);opacity:.45;background:linear-gradient(135deg,${RED},${PURPLE});border-radius:50%}
  svg{position:relative;width:${logo}px;height:${logo}px}
  h1{position:relative;margin:0;font-family:BSD;font-weight:900;font-size:${Math.round(logo * .38)}px;letter-spacing:.06em;color:#F2F0F5;text-transform:uppercase;line-height:1}
  h1 b{font-weight:900;background:linear-gradient(90deg,#FF4B62,#B98AF5);-webkit-background-clip:text;background-clip:text;color:transparent}
  p{position:relative;margin:0;font-family:JBM;font-size:${Math.round(logo * .07)}px;letter-spacing:.32em;color:#8D8797;text-transform:uppercase}
  </style></head><body><div class="w"><div class="glow"></div><svg viewBox="0 0 48 48">${mark('s')}</svg><h1>Clean <b>Cut</b></h1><p>Paycheck splitter</p></div></body></html>`;
}

(async () => {
  const b = await chromium.launch();
  const shot = async (html, w, h, file, dpr = 1, transparent = false) => {
    const p = await b.newPage({ viewport: { width: Math.round(w / dpr), height: Math.round(h / dpr) }, deviceScaleFactor: dpr });
    const tmp = path.join(ROOT, 'dev', '_render.html');
    fs.writeFileSync(tmp, html);
    await p.goto('file://' + tmp, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts && document.fonts.ready);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(ROOT, 'icons', file), omitBackground: transparent });
    await p.close();
  };
  const page = (svg, s) => `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace(`width="${s}" height="${s}"`, `width="${s}" height="${s}" style="display:block"`)}</body></html>`;

  for (const [file, s, scale] of [['apple-touch-icon.png', 180, .66], ['icon-192.png', 192, .66], ['icon-512.png', 512, .66], ['maskable-512.png', 512, .5]]) {
    await shot(page(tileSVG(s, scale), s), s, s, file);
  }
  // favicon: mark only, transparent
  const fav = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${mark('f')}</svg>`;
  fs.writeFileSync(path.join(ROOT, 'icons/favicon.svg'), fav);
  fs.writeFileSync(path.join(ROOT, 'icons/logo.svg'), tileSVG(512, .66).replace('<defs>', '<title>Clean Cut</title><defs>'));
  await shot(`<!doctype html><html><body style="margin:0;background:transparent">${fav.replace('viewBox', 'width="32" height="32" style="display:block" viewBox')}</body></html>`, 32, 32, 'favicon-32.png', 1, true);

  for (const f of fs.readdirSync(path.join(ROOT, 'icons')).filter(f => /^splash-\d+x\d+\.png$/.test(f))) {
    const [w, h] = f.match(/(\d+)x(\d+)/).slice(1).map(Number);
    const dpr = w >= 1000 ? 3 : 2;
    await shot(splashHTML(w, h, dpr), w, h, f, dpr);
  }
  await b.close();
  fs.rmSync(path.join(ROOT, 'dev', '_render.html'), { force: true });
  console.log('icons written');
})();
