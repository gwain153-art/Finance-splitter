// Note themes: the app's accent follows a Bank of England note colour. Dark UI throughout.
// main = buttons and fills, hi = glows and highlights, deep = dark washes,
// blood = lit smoke in the background shader, soft = pale tint for text on dark,
// n1..n3 = the paycheck note's gradient from light to dark.

export const NOTES = {
  50: { label: '£50', name: 'Red', main: '#D0263F', hi: '#FF4B62', deep: '#6E1220', blood: '#8A1426', soft: '#FFB3BF', n1: '#8A1227', n2: '#560A18', n3: '#1D0A10' },
  20: { label: '£20', name: 'Purple', main: '#8E4FD0', hi: '#B98AF5', deep: '#3E1F63', blood: '#55298A', soft: '#D9C2FA', n1: '#5E2E96', n2: '#3A1B60', n3: '#150D20' }
};
export const NOTE_KEYS = ['50', '20'];
export const otherOf = key => NOTES[String(key) === '20' ? 50 : 20];

const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const rgb01 = hex => rgb(hex).map(v => v / 255);

export function noteOf(key) { return NOTES[key] || NOTES[50]; }

// The CSS palettes live in css/app.css under :root[data-note]; this flips the attribute.
export function applyNote(key) {
  const k = String(key) in NOTES ? String(key) : '50';
  document.documentElement.dataset.note = k;
  return NOTES[k];
}
