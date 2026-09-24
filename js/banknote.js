// Clean Cut banknotes: our own £50 and £20, drawn as SVG in dark red and dark purple.
// Built on the layout of the current polymer notes (big numeral, foil window, rosette,
// serials, microtext) but branded Clean Cut and marked "not legal tender". Not replicas.

export const NOTE = {
  50: { word: 'FIFTY', main: '#D0263F', hi: '#FF4B62', deep: '#6E1220', soft: '#FFB3BF', n1: '#8A1227', n2: '#560A18', n3: '#1D0A10' },
  20: { word: 'TWENTY', main: '#8E4FD0', hi: '#B98AF5', deep: '#3E1F63', soft: '#D9C2FA', n1: '#5E2E96', n2: '#3A1B60', n3: '#150D20' }
};
const W = 480, H = 256;
const DISPLAY = "'Big Shoulders Display','Oswald','Arial Narrow',Impact,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,Menlo,monospace";
const f = n => n.toFixed(1);

// Two crossing families of sine lines: the moiré "guilloche" background every note has.
function guilloche(lines, col, op) {
  let d = '';
  for (let j = 0; j < lines; j++) {
    let p = '';
    for (let x = -6; x <= W + 6; x += 8) {
      const y = H * .5 + Math.sin(x * .021 + j * .33) * H * .2 + Math.sin(x * .0093 - j * .6) * H * .12 + (j - lines / 2) * H * .018;
      p += (p ? 'L' : 'M') + f(x) + ' ' + f(y);
    }
    d += p;
  }
  return `<path d="${d}" fill="none" stroke="${col}" stroke-width=".55" opacity="${op}"/>`;
}
// Spirograph rosette.
function rosette(cx, cy, R, r, dd, col, op, steps = 720) {
  let p = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps * Math.PI * 2 * r / gcd(R, r);
    const x = cx + (R - r) * Math.cos(t) + dd * Math.cos((R - r) / r * t);
    const y = cy + (R - r) * Math.sin(t) - dd * Math.sin((R - r) / r * t);
    p += (i ? 'L' : 'M') + f(x) + ' ' + f(y);
  }
  return `<path d="${p}" fill="none" stroke="${col}" stroke-width=".5" opacity="${op}"/>`;
}
function gcd(a, b) { return b ? gcd(b, a % b) : a; }
// Engraved Clean Cut mark in the portrait spot: hatched rings, sliced.
function engraving(cx, cy, s, col) {
  let rings = '';
  for (let i = 0; i < 9; i++) rings += `<circle cx="${cx}" cy="${cy}" r="${f(s * (.3 + i * .08))}" fill="none" stroke="${col}" stroke-width="${i % 3 ? .45 : .9}" opacity="${.25 + (i % 3 ? 0 : .2)}"/>`;
  return `${rings}<circle cx="${cx}" cy="${cy}" r="${f(s * .26)}" fill="${col}" opacity=".55"/>
    <path d="M${f(cx - s)} ${f(cy + s)} L${f(cx + s)} ${f(cy - s)}" stroke="#0A090C" stroke-width="${f(s * .1)}" stroke-linecap="round"/>
    <path d="M${f(cx - s)} ${f(cy + s)} L${f(cx + s)} ${f(cy - s)}" stroke="#fff" stroke-width=".6" opacity=".7"/>`;
}

let uidN = 0;
/**
 * @param denom '50' | '20'
 * @param o { hero: omit the centre value so the app can overlay its own; value: text for the centre;
 *            serial; fonts: extra CSS (@font-face) to embed when rasterising }
 */
export function noteSVG(denom = '50', o = {}) {
  const c = NOTE[denom] || NOTE[50], u = 'bn' + (++uidN), d = String(denom);
  const serial = o.serial || `CC${d} ${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
  const micro = ('CLEAN CUT · ' + c.word + ' POUNDS · ').repeat(14);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"${o.hero ? '' : ` role="img" aria-label="Clean Cut ${d} pound note"`}>
  <defs>
    ${o.fonts ? `<style>${o.fonts}</style>` : ''}
    <linearGradient id="${u}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.n1}"/><stop offset=".4" stop-color="${c.n2}"/><stop offset="1" stop-color="${c.n3}"/></linearGradient>
    <radialGradient id="${u}r" cx="30%" cy="35%" r="70%"><stop offset="0" stop-color="${c.hi}" stop-opacity=".22"/><stop offset="1" stop-color="${c.hi}" stop-opacity="0"/></radialGradient>
    <linearGradient id="${u}foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F4F2F7" stop-opacity=".85"/><stop offset=".35" stop-color="${c.soft}" stop-opacity=".55"/><stop offset=".6" stop-color="#9E98A8" stop-opacity=".6"/><stop offset="1" stop-color="#EDEAF2" stop-opacity=".8"/></linearGradient>
    <clipPath id="${u}c"><rect width="${W}" height="${H}" rx="14"/></clipPath>
  </defs>
  <g clip-path="url(#${u}c)">
    <rect width="${W}" height="${H}" fill="url(#${u}g)"/>
    <rect width="${W}" height="${H}" fill="url(#${u}r)"/>
    ${guilloche(o.mini ? 8 : 26, c.soft, .13)}
    ${o.mini ? '' : rosette(150, 128, 90, 34, 58, c.hi, .22)}
    ${o.mini ? '' : rosette(150, 128, 60, 21, 30, c.soft, .2, 540)}
    <!-- portrait spot: engraved mark -->
    ${engraving(418, 118, o.mini ? 38 : 44, c.soft)}
    <!-- see-through foil window -->
    <rect x="330" y="-2" width="${o.mini ? 30 : 38}" height="${H + 4}" fill="url(#${u}foil)" opacity=".75"/>
    <rect x="330" y="-2" width="${o.mini ? 30 : 38}" height="${H + 4}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8"/>
    <text x="${o.mini ? 345 : 349}" y="${H * .5}" text-anchor="middle" dominant-baseline="middle" font-family="${DISPLAY}" font-weight="900" font-size="${o.mini ? 26 : 30}" fill="${c.deep}" opacity=".85" transform="rotate(-90 ${o.mini ? 345 : 349} ${H * .5})">${d}</text>
    <!-- big outline numeral -->
    ${o.mini ? '' : `<text x="${W - 22}" y="${H - 18}" text-anchor="end" font-family="${DISPLAY}" font-weight="900" font-size="120" fill="none" stroke="${c.soft}" stroke-opacity=".45" stroke-width="1.6">${d}</text>`}
    ${o.mini ? `<text x="${W - 26}" y="${H - 26}" text-anchor="end" font-family="${DISPLAY}" font-weight="900" font-size="120" fill="${c.soft}">${d}</text>` : ''}
    ${o.hero || o.mini ? '' : `
    <text x="26" y="44" font-family="${DISPLAY}" font-weight="900" font-size="24" letter-spacing="3" fill="${c.soft}">CLEAN CUT</text>
    <text x="26" y="62" font-family="${MONO}" font-size="8" letter-spacing="1.2" fill="${c.soft}" opacity=".75">PROMISE TO SPLIT THE BEARER ON DEMAND</text>
    <text x="26" y="${H * .62}" font-family="${DISPLAY}" font-weight="900" font-size="${o.value && o.value.length > 6 ? 70 : 86}" fill="#F4F2F7">${o.value || '£' + d}</text>
    <text x="26" y="${H * .62 + 22}" font-family="${MONO}" font-size="9" letter-spacing="1.5" fill="${c.soft}" opacity=".8">${c.word} POUNDS</text>`}
    ${o.mini ? '' : `
    ${o.hero ? '' : `<text x="${W - 22}" y="30" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="1.5" fill="${c.soft}" opacity=".85">${serial}</text>
    <text x="26" y="${H - 16}" font-family="${MONO}" font-size="9" letter-spacing="1.5" fill="${c.hi}" opacity=".9">${serial}</text>`}
    <text x="0" y="${H - 5}" font-family="${MONO}" font-size="4.2" letter-spacing=".6" fill="${c.soft}" opacity=".45">${micro}</text>
    <text x="0" y="8" font-family="${MONO}" font-size="4.2" letter-spacing=".6" fill="${c.soft}" opacity=".45">${micro}</text>
    <text x="${W - 22}" y="44" text-anchor="end" font-family="${MONO}" font-size="6" letter-spacing="1.4" fill="${c.soft}" opacity=".6">NOT LEGAL TENDER</text>`}
    <rect x="7" y="7" width="${W - 14}" height="${H - 14}" rx="10" fill="none" stroke="${c.soft}" stroke-opacity=".28" stroke-width="1"/>
  </g>
</svg>`;
}

// Sprite of mini notes, used by the bucket cash stacks via <use href="#bn-mini-50">.
export function miniSprite() {
  const strip = svg => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <symbol id="bn-mini-50" viewBox="0 0 ${W} ${H}">${strip(noteSVG('50', { mini: true }))}</symbol>
    <symbol id="bn-mini-20" viewBox="0 0 ${W} ${H}">${strip(noteSVG('20', { mini: true }))}</symbol>
  </svg>`;
}

// How an amount breaks into notes: £50s, £20s, and loose change.
export function breakdown(amt) {
  const a = Math.max(0, Math.round(amt * 100) / 100);
  const n50 = Math.floor(a / 50), r = Math.round((a - n50 * 50) * 100) / 100;
  const n20 = Math.floor(r / 20), change = Math.round((r - n20 * 20) * 100) / 100;
  return { n50, n20, change };
}

// Rasterise a note to an <img> for the canvas cutscene. Fonts are embedded as data URLs so the image renders them.
let fontCSS = null;
async function embeddedFonts() {
  if (fontCSS !== null) return fontCSS;
  try {
    const load = async (file, fam, w) => {
      const b = await (await fetch(new URL(`../fonts/${file}`, import.meta.url))).blob();
      const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
      return `@font-face{font-family:'${fam}';src:url(${url}) format('woff2');font-weight:${w}}`;
    };
    fontCSS = (await load('big-shoulders-display-latin.woff2', 'Big Shoulders Display', '600 900')) + (await load('jetbrains-mono-latin.woff2', 'JetBrains Mono', '400 600'));
  } catch (e) { fontCSS = ''; }
  return fontCSS;
}
export async function noteImage(denom, o = {}) {
  const svg = noteSVG(denom, { ...o, fonts: await embeddedFonts() });
  const img = new Image();
  img.decoding = 'async';
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  try { await img.decode(); } catch (e) { await new Promise(r => { img.onload = r; img.onerror = r; }); }
  return img;
}
