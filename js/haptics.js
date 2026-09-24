// Crimson Cut - haptics.
//
// Android / Chromium: navigator.vibrate.
// iOS (Safari has no Vibration API): toggling an <input type="checkbox" switch>
// (Safari 17.4+) fires the Taptic Engine on iOS 18+. Clicking the <label> that
// owns the switch toggles it and produces the tick; this is what the
// "ios-haptics" library does (label.click() on a hidden label + switch).
//
// Caveats (cannot be verified off-device):
//  - The tick is reliable when label.click() runs inside a user gesture
//    (click/touchend handler). Clicks from setTimeout (multi-pulse patterns)
//    worked on iOS 18.x in the wild but are best-effort; we attempt them anyway.
//  - Reports say iOS 26.5 blocks programmatic switch toggles from JS entirely;
//    then only direct taps on a real switch buzz. Everything here degrades to
//    a silent no-op in that case.
//  - The iOS tick has a single fixed strength; light/medium/heavy differ only
//    in pulse count/spacing.

let installed = false;
let enabled = true;
let label = null;
let input = null;
let lastTick = 0;
const timers = new Set();

const hasVibrate = () => {
  try { return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'; } catch (e) { return false; }
};

const isIOS = () => {
  try {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  } catch (e) { return false; }
};

const switchSupported = () => {
  try { return typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype; } catch (e) { return false; }
};

function build() {
  if (label || typeof document === 'undefined') return;
  const id = 'cc-haptic-switch';
  input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = id;
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  label = document.createElement('label');
  label.htmlFor = id;
  label.setAttribute('aria-hidden', 'true');
  label.appendChild(input);
  // Keep it out of layout and out of the app's delegated click handlers.
  label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
  const stop = (e) => { e.stopPropagation(); };
  label.addEventListener('click', stop);
  input.addEventListener('click', stop);
  input.addEventListener('change', stop);
  (document.body || document.documentElement).appendChild(label);
}

function iosPulse() {
  try {
    if (!label || !label.isConnected) { label = null; build(); }
    if (label) label.click();
  } catch (e) { /* ignore */ }
}

function pulse(ms) {
  if (!enabled) return;
  if (hasVibrate()) {
    try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
    return;
  }
  iosPulse();
}

// arr like navigator.vibrate: [on, off, on, off, ...]
function pattern(arr) {
  if (!enabled) return;
  const a = (Array.isArray(arr) ? arr : [arr]).map((n) => Math.max(0, Number(n) || 0));
  if (!a.length) return;
  if (hasVibrate()) {
    try { navigator.vibrate(a); } catch (e) { /* ignore */ }
    return;
  }
  // iOS: one tick per "on" segment; long "on" segments get an extra tick every ~70ms
  let t = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % 2 === 0) {
      const ticks = Math.max(1, Math.min(4, Math.round(a[i] / 70)));
      for (let k = 0; k < ticks; k++) schedule(t + k * 70);
    }
    t += a[i];
  }
}

function schedule(ms) {
  if (ms <= 0) { iosPulse(); return; }
  const id = setTimeout(() => { timers.delete(id); if (enabled) iosPulse(); }, ms);
  timers.add(id);
}

const safe = (fn) => (...a) => { try { return fn(...a); } catch (e) { return undefined; } };

export const Haptics = {
  install: safe(() => {
    if (installed) return;
    installed = true;
    if (!hasVibrate()) build();
  }),
  get enabled() { return enabled; },
  set enabled(v) {
    enabled = !!v;
    if (!enabled) {
      timers.forEach((id) => clearTimeout(id)); timers.clear();
      try { if (hasVibrate()) navigator.vibrate(0); } catch (e) { /* ignore */ }
    }
  },
  get supported() { return hasVibrate() || (isIOS() && switchSupported()); },
  tap: safe(() => pulse(10)),
  light: safe(() => pulse(6)),
  medium: safe(() => pattern([18])),
  heavy: safe(() => { if (hasVibrate()) pulse(40); else if (enabled) { iosPulse(); schedule(35); } }),
  success: safe(() => pattern([12, 90, 30])),
  error: safe(() => pattern([30, 70, 30, 70, 40])),
  tick: safe(() => {
    const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (t - lastTick < 40) return;
    lastTick = t;
    pulse(4);
  }),
  pattern: safe(pattern),
};

export default Haptics;
