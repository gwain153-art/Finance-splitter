// Crimson Cut - synthesized sound engine.
//
// Everything is generated in code and pre-rendered to AudioBuffers with an
// OfflineAudioContext, so playback is a single BufferSource per sound.
//
// iOS / iPhone home-screen notes (why the unlock code looks the way it does):
//  1. Safari puts a page with an AudioContext in the "ambient" audio session,
//     which obeys the ring/silent switch, so with the switch on you hear nothing.
//     Fix A (Safari 16.4+/17+): navigator.audioSession.type = 'playback', set
//     BEFORE the AudioContext is created and again on every gesture.
//     Fix B (older iOS / belt and braces): a looping, silent, NOT-muted <audio>
//     element started inside a gesture moves the page into the media/playback
//     category (the approach of unmute.js / unmute-ios-audio). It is paused
//     while the page is hidden so it does not linger on the lock screen.
//     Trade-off: the "playback" category is non-mixable, so it pauses other
//     music (Spotify etc.) while the app makes sound. That is the price of
//     playing through the silent switch.
//  2. WebKit only treats touchend / click / keydown as user activation. Resuming
//     on pointerdown / touchstart does nothing on iOS. We listen on those three,
//     capture phase, passive, and keep listening forever (cheap) so any later
//     interruption is recovered on the next tap.
//  3. iOS moves the context to 'interrupted' (calls, Siri, app switch, lock).
//     We try resume() on visibilitychange / pageshow / statechange and on the
//     next gesture; if a resume inside a gesture still does not reach 'running'
//     the context is thrown away and recreated on the following gesture.

const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
const E = 0.0001;
const RENDER_RATE = 48000; // iPhone hardware rate; BufferSource resamples if the live ctx differs

// ---------------------------------------------------------------- state
let installed = false;
let enabled = true;
let ctx = null;
let master = null; // GainNode feeding the limiter
let needsRecreate = false;
let keepAlive = null;
let keepAliveUrl = null;
let rendering = false;
const buffers = new Map(); // key -> AudioBuffer
const pending = new Map(); // key -> [{name, opts, at}]
let lastTick = 0;
const active = new Set();
let charge = null;

const LEVEL = {
  tick: 0.32, key: 0.5, tap: 0.42, toggle: 0.45, open: 0.42, close: 0.36,
  pop: 0.6, delete: 0.6, coin: 0.5, whoosh: 0.5, slash: 0.95, thump: 0.95,
  fanfare: 0.9, error: 0.38, sweep: 0.55, achievement: 0.72, levelup: 0.85,
  boot: 0.82, lock: 0.85, fizzle: 0.45,
};

const safe = (fn, fallback) => (...a) => { try { return fn(...a); } catch (e) { return fallback; } };
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const semis = (n) => Math.pow(2, n / 12);

// ---------------------------------------------------------------- iOS session helpers
function setSession() {
  try {
    const s = navigator.audioSession;
    if (s && s.type !== 'playback') s.type = 'playback';
  } catch (e) { /* ignore */ }
}

function silentWavUrl() {
  // 0.5 s of 16-bit mono silence at 44.1 kHz as a Blob URL.
  const sr = 44100, n = sr / 2, bytes = 44 + n * 2;
  const b = new ArrayBuffer(bytes), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

function ensureKeepAlive() {
  if (keepAlive || typeof document === 'undefined') return;
  keepAliveUrl = silentWavUrl();
  const a = document.createElement('audio');
  a.setAttribute('x-webkit-airplay', 'deny');
  a.setAttribute('playsinline', '');
  a.setAttribute('webkit-playsinline', '');
  a.setAttribute('aria-hidden', 'true');
  a.preload = 'auto';
  a.loop = true;
  a.controls = false;
  a.disableRemotePlayback = true;
  a.src = keepAliveUrl;
  a.style.display = 'none';
  keepAlive = a;
  try { (document.body || document.documentElement).appendChild(a); } catch (e) { /* ignore */ }
}

function startKeepAlive() {
  if (!enabled || !keepAlive || document.hidden) return;
  if (!keepAlive.paused) return;
  try {
    const p = keepAlive.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* ignore */ }
}

function stopKeepAlive() {
  try { if (keepAlive && !keepAlive.paused) keepAlive.pause(); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- context
function createCtx() {
  setSession(); // must precede construction for the session to apply
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -8;
  comp.knee.value = 6;
  comp.ratio.value = 12;
  comp.attack.value = 0.002;
  comp.release.value = 0.14;
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp);
  comp.connect(ctx.destination);
  ctx.onstatechange = () => {
    try {
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden) ctx.resume().catch(() => {});
    } catch (e) { /* ignore */ }
  };
  needsRecreate = false;
}

function kickSilentBuffer() {
  // classic iOS unlock: start a 1-sample buffer inside the gesture
  try {
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
  } catch (e) { /* ignore */ }
}

function onGesture() {
  try {
    if (!AC) return;
    setSession();
    if (needsRecreate && ctx) {
      stopCharge(false, true);
      try { ctx.close(); } catch (e) { /* ignore */ }
      ctx = null;
    }
    if (!ctx) createCtx();
    ensureKeepAlive();
    startKeepAlive();
    if (ctx.state !== 'running') {
      const c = ctx;
      try { const p = c.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
      setTimeout(() => {
        if (ctx === c && c.state !== 'running' && c.state !== 'closed' && !document.hidden) needsRecreate = true;
      }, 600);
    }
    kickSilentBuffer();
    renderAll();
  } catch (e) { /* never throw from a gesture */ }
}

function onVisible() {
  try {
    if (document.hidden) {
      stopKeepAlive();
      if (charge) stopCharge(false, true);
      return;
    }
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
    startKeepAlive();
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- synthesis toolkit (runs on an OfflineAudioContext)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kit(c, seed = 1) {
  const R = rng(seed);
  let noiseBuf = null;
  const getNoise = () => {
    if (noiseBuf) return noiseBuf;
    const len = c.sampleRate * 2;
    noiseBuf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = noiseBuf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = R() * 2 - 1;
    }
    return noiseBuf;
  };

  const panTo = (node, pan, dest) => {
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node.connect(p); p.connect(dest);
    } else node.connect(dest);
  };

  const envGain = (t, a, v, d, hold = 0) => {
    const g = c.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + a);
    if (hold > 0) p.setValueAtTime(v, t + a + hold);
    p.exponentialRampToValueAtTime(E, t + a + hold + d);
    return g;
  };

  // oscillator voice with optional pitch glide + optional lowpass
  const tone = (dest, o) => {
    const { type = 'sine', f = 440, f2, glide, t = 0, a = 0.002, d = 0.2, hold = 0, v = 0.5, pan = 0, detune = 0, lp, lp2, lpT, q = 1 } = o;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + (glide ?? (a + hold + d)));
    osc.detune.value = detune;
    const g = envGain(t, a, v, d, hold);
    let head = osc;
    if (lp) {
      const fl = c.createBiquadFilter();
      fl.type = 'lowpass'; fl.Q.value = q;
      fl.frequency.setValueAtTime(lp, t);
      if (lp2) fl.frequency.exponentialRampToValueAtTime(lp2, t + (lpT ?? d));
      osc.connect(fl); head = fl;
    }
    head.connect(g);
    panTo(g, pan, dest);
    osc.start(t);
    osc.stop(t + a + hold + d + 0.05);
    return g;
  };

  // filtered noise burst with optional filter sweep
  const noise = (dest, o) => {
    const { t = 0, a = 0.002, d = 0.1, hold = 0, v = 0.4, type = 'bandpass', f = 2000, f2, sweep, q = 1, pan = 0, rate = 1 } = o;
    const s = c.createBufferSource();
    s.buffer = getNoise(); s.loop = true; s.playbackRate.value = rate;
    const fl = c.createBiquadFilter();
    fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + (sweep ?? (a + hold + d)));
    const g = envGain(t, a, v, d, hold);
    s.connect(fl); fl.connect(g);
    panTo(g, pan, dest);
    s.start(t, R() * 1.5);
    s.stop(t + a + hold + d + 0.05);
    return g;
  };

  // struck metal / bell: inharmonic partials
  const bell = (dest, o) => {
    const { f = 880, t = 0, v = 0.4, d = 0.8, pan = 0, ratios = [1, 2.0, 2.76, 5.4, 8.93], bright = 1 } = o;
    ratios.forEach((r, i) => {
      const fr = f * r;
      if (fr > c.sampleRate * 0.45) return;
      tone(dest, { f: fr, t, a: 0.001, d: d / (1 + i * 0.7), v: v * Math.pow(0.55, i) * (i ? bright : 1), pan });
    });
  };

  // generated impulse response -> ConvolverNode (returns send input)
  const reverb = (dest, seconds = 1.8, decay = 3, wet = 0.35, predelay = 0.012) => {
    const len = Math.floor(c.sampleRate * seconds);
    const ir = c.createBuffer(2, len, c.sampleRate);
    const pre = Math.floor(predelay * c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const x = (i - pre) / (len - pre);
        const damp = 0.25 + 0.7 * x; // darker as it decays
        lp = lp + (1 - damp) * ((R() * 2 - 1) - lp);
        d[i] = lp * Math.pow(1 - x, decay);
      }
      // a few early reflections
      for (let k = 0; k < 6; k++) {
        const at = pre + Math.floor((0.004 + R() * 0.05) * c.sampleRate);
        if (at < len) d[at] += (R() < 0.5 ? -1 : 1) * (0.5 - k * 0.06);
      }
    }
    const conv = c.createConvolver();
    conv.normalize = true;
    conv.buffer = ir;
    const send = c.createGain();
    send.gain.value = wet;
    send.connect(conv); conv.connect(dest);
    return send;
  };

  // soft saturation (adds audible harmonics to lows on phone speakers)
  const drive = (dest, amount = 2) => {
    const sh = c.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    const norm = Math.tanh(amount);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * amount) / norm; }
    sh.curve = curve;
    sh.oversample = '2x';
    sh.connect(dest);
    return sh;
  };

  const bus = (dest, gain = 1) => { const g = c.createGain(); g.gain.value = gain; g.connect(dest); return g; };

  return { R, tone, noise, bell, reverb, drive, bus };
}

function renderOffline(seconds, build, seed) {
  return new Promise((resolve, reject) => {
    const sr = RENDER_RATE;
    const len = Math.max(1, Math.ceil(seconds * sr));
    let c;
    try { c = new OAC(2, len, sr); } catch (e) { c = new OAC(2, len, 44100); }
    const out = c.createGain();
    out.connect(c.destination);
    build(c, out, kit(c, seed));
    let done = false;
    const fin = (buf) => { if (done) return; done = true; finish(buf); resolve(buf); };
    c.oncomplete = (e) => fin(e.renderedBuffer);
    const p = c.startRendering();
    if (p && p.then) p.then(fin, reject);
  });
}

function finish(buf) {
  // normalize to 0.95 peak and fade the last 4ms to avoid clicks
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  const k = peak > 1e-6 ? 0.95 / peak : 1;
  const fade = Math.min(buf.length, Math.floor(buf.sampleRate * 0.004));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= k;
    for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
  }
}

// ---------------------------------------------------------------- sound designs
// Each entry: [seconds, build(c, out, K)]
const DESIGNS = {};

DESIGNS.tick = [0.05, (c, out, K) => {
  K.noise(out, { type: 'highpass', f: 3500, q: 0.7, a: 0.0005, d: 0.006, v: 0.9 });
  K.tone(out, { f: 2600, f2: 2200, glide: 0.015, a: 0.0005, d: 0.018, v: 0.5 });
  K.tone(out, { type: 'triangle', f: 5200, a: 0.0003, d: 0.008, v: 0.2 });
}];

for (let i = 0; i < 12; i++) {
  // premium mechanical key: low "thock" body + bright click + tiny release tick
  DESIGNS['key' + i] = [0.12, (c, out, K) => {
    const body = 170 + ((i * 37) % 90);
    const click = 3000 + ((i * 523) % 1800);
    const pan = ((i % 3) - 1) * 0.12;
    K.noise(out, { type: 'bandpass', f: click, q: 2.5, a: 0.0005, d: 0.012, v: 1.0, pan });
    K.tone(out, { type: 'triangle', f: body * 2.2, f2: body * 1.6, glide: 0.02, a: 0.0008, d: 0.03, v: 0.45, pan });
    K.tone(out, { f: body, f2: body * 0.8, glide: 0.04, a: 0.001, d: 0.045, v: 0.55, pan });
    K.noise(out, { type: 'lowpass', f: 900, q: 0.8, a: 0.001, d: 0.02, v: 0.35, pan });
    K.noise(out, { type: 'bandpass', f: click * 1.3, q: 3, t: 0.045, a: 0.0005, d: 0.008, v: 0.25, pan });
  }, 100 + i];
}

DESIGNS.tap = [0.09, (c, out, K) => {
  K.noise(out, { type: 'bandpass', f: 2600, q: 1.5, a: 0.0005, d: 0.01, v: 0.6 });
  K.tone(out, { f: 900, f2: 560, glide: 0.04, a: 0.001, d: 0.05, v: 0.6 });
  K.tone(out, { type: 'triangle', f: 1800, f2: 1300, glide: 0.03, a: 0.001, d: 0.025, v: 0.2 });
}];

DESIGNS.toggle_on = [0.16, (c, out, K) => {
  K.noise(out, { type: 'bandpass', f: 3000, q: 2, a: 0.0005, d: 0.01, v: 0.5 });
  K.tone(out, { type: 'triangle', f: 660, a: 0.001, d: 0.05, v: 0.5 });
  K.tone(out, { type: 'triangle', f: 990, t: 0.05, a: 0.001, d: 0.09, v: 0.55 });
  K.tone(out, { f: 1980, t: 0.05, a: 0.001, d: 0.05, v: 0.15 });
}];
DESIGNS.toggle_off = [0.16, (c, out, K) => {
  K.noise(out, { type: 'bandpass', f: 2200, q: 2, a: 0.0005, d: 0.01, v: 0.45 });
  K.tone(out, { type: 'triangle', f: 880, a: 0.001, d: 0.05, v: 0.45 });
  K.tone(out, { type: 'triangle', f: 587, t: 0.05, a: 0.001, d: 0.09, v: 0.5 });
}];

DESIGNS.open = [0.42, (c, out, K) => {
  K.noise(out, { type: 'bandpass', f: 350, f2: 3800, sweep: 0.26, q: 1.4, a: 0.12, d: 0.2, v: 0.7 });
  K.tone(out, { f: 280, f2: 640, glide: 0.25, a: 0.08, d: 0.22, v: 0.25 });
  K.tone(out, { type: 'triangle', f: 1320, t: 0.2, a: 0.004, d: 0.18, v: 0.12 });
}];
DESIGNS.close = [0.34, (c, out, K) => {
  K.noise(out, { type: 'bandpass', f: 3200, f2: 300, sweep: 0.22, q: 1.4, a: 0.03, d: 0.22, v: 0.65 });
  K.tone(out, { f: 560, f2: 240, glide: 0.2, a: 0.02, d: 0.2, v: 0.25 });
  K.noise(out, { type: 'lowpass', f: 600, t: 0.2, a: 0.001, d: 0.05, v: 0.3 });
}];

DESIGNS.pop = [0.3, (c, out, K) => {
  K.tone(out, { f: 260, f2: 980, glide: 0.045, a: 0.002, d: 0.13, v: 0.8 });
  K.tone(out, { type: 'triangle', f: 520, f2: 1960, glide: 0.045, a: 0.002, d: 0.08, v: 0.25 });
  K.noise(out, { type: 'bandpass', f: 2400, q: 2, a: 0.0005, d: 0.012, v: 0.5 });
  K.bell(out, { f: 1960, t: 0.05, v: 0.12, d: 0.2 });
}];

DESIGNS.delete = [0.42, (c, out, K) => {
  const crunch = K.drive(out, 5);
  K.tone(crunch, { type: 'sawtooth', f: 420, f2: 55, glide: 0.22, a: 0.002, d: 0.26, v: 0.5, lp: 3000, lp2: 300, lpT: 0.22 });
  K.tone(crunch, { type: 'square', f: 210, f2: 40, glide: 0.25, a: 0.002, d: 0.24, v: 0.3, detune: 15, lp: 1800 });
  K.noise(out, { type: 'lowpass', f: 3000, f2: 400, sweep: 0.2, q: 2, a: 0.001, d: 0.2, v: 0.6 });
  K.noise(out, { type: 'bandpass', f: 1400, q: 4, t: 0.05, a: 0.001, d: 0.04, v: 0.35 });
}];

const COIN_STEPS = [0, 2, 4, 7, 9, 12, 14, 16];
COIN_STEPS.forEach((st, i) => {
  DESIGNS['coin' + i] = [0.75, (c, out, K) => {
    const f = 659.25 * semis(st);
    const pan = ((i % 4) - 1.5) * 0.18;
    const rv = K.reverb(out, 0.7, 4, 0.22);
    const both = K.bus(out); both.connect(rv);
    K.noise(both, { type: 'highpass', f: 6000, a: 0.0005, d: 0.01, v: 0.35, pan });
    // two-step "ka-ching": short grace note then the ringing note a fourth up
    K.tone(both, { type: 'square', f, a: 0.001, d: 0.045, v: 0.18, lp: 5000, pan });
    K.bell(both, { f, v: 0.25, d: 0.08, pan });
    const f2 = f * 1.3348;
    K.tone(both, { type: 'square', f: f2, t: 0.055, a: 0.001, d: 0.32, v: 0.16, lp: 7000, lp2: 2500, lpT: 0.3, pan });
    K.bell(both, { f: f2, t: 0.055, v: 0.5, d: 0.6, pan, ratios: [1, 2.0, 3.01, 4.2, 5.43, 6.8], bright: 1.3 });
  }, 200 + i];
});

[['whoosh_s', 0.3], ['whoosh_m', 0.55], ['whoosh_l', 1.0]].forEach(([k, dur]) => {
  DESIGNS[k] = [dur + 0.12, (c, out, K) => {
    K.noise(out, { type: 'bandpass', f: 300, f2: 2600, sweep: dur * 0.55, q: 1.1, a: dur * 0.55, d: dur * 0.45, v: 0.8, pan: -0.3 });
    K.noise(out, { type: 'bandpass', f: 500, f2: 4200, sweep: dur * 0.6, q: 2.5, a: dur * 0.6, d: dur * 0.4, v: 0.35, pan: 0.3, rate: 0.7 });
    K.tone(out, { f: 140, f2: 90, a: dur * 0.5, d: dur * 0.5, v: 0.12 });
  }];
});

for (let i = 0; i < 4; i++) {
  // katana "shing": air cut + blade contact transient + ringing metal + reverb tail
  DESIGNS['slash' + i] = [1.5, (c, out, K) => {
    const s = 1 + i * 0.055;
    const pan = [-0.25, 0.25, -0.1, 0.1][i];
    const rv = K.reverb(out, 1.3, 3.5, 0.35);
    const wet = K.bus(out); wet.connect(rv);
    // air swish just before contact
    K.noise(out, { type: 'bandpass', f: 1200 * s, f2: 7000 * s, sweep: 0.09, q: 1.8, a: 0.07, d: 0.05, v: 0.7, pan: -pan });
    const t = 0.08;
    // contact transient
    K.noise(wet, { t, type: 'highpass', f: 2500, a: 0.0005, d: 0.03, v: 1.0, pan });
    K.noise(wet, { t, type: 'bandpass', f: 5200 * s, q: 6, a: 0.001, d: 0.35, v: 0.5, pan });
    // ringing blade partials, slight upward scrape on onset
    const base = 1480 * s;
    const partials = [[1, 0.5, 0.9], [1.51, 0.35, 0.7], [2.26, 0.3, 0.6], [2.93, 0.22, 0.5], [4.07, 0.16, 0.35], [5.33, 0.1, 0.25]];
    partials.forEach(([r, v, d], k) => {
      K.tone(wet, { t, f: base * r * 0.97, f2: base * r, glide: 0.04, a: 0.001, d: d * 1.1, v, pan: pan + (k % 2 ? 0.15 : -0.15) });
    });
    // slight beating for shimmer
    K.tone(wet, { t, f: base * 1.006, a: 0.001, d: 0.8, v: 0.3, pan: -pan });
    // body weight
    K.tone(out, { t, f: 220, f2: 110, glide: 0.08, a: 0.001, d: 0.1, v: 0.25 });
  }, 300 + i];
}

DESIGNS.thump = [0.7, (c, out, K) => {
  const d = K.drive(out, 2.5); // harmonics so phones can hear it
  K.tone(d, { f: 140, f2: 42, glide: 0.18, a: 0.002, d: 0.5, v: 0.9 });
  K.tone(d, { type: 'triangle', f: 280, f2: 90, glide: 0.1, a: 0.001, d: 0.18, v: 0.35 });
  K.noise(out, { type: 'lowpass', f: 1800, f2: 200, sweep: 0.1, a: 0.001, d: 0.12, v: 0.6 });
  K.noise(out, { type: 'bandpass', f: 3000, q: 1, a: 0.0005, d: 0.01, v: 0.3 });
}];

DESIGNS.fanfare = [2.6, (c, out, K) => {
  const rv = K.reverb(out, 2.4, 2.6, 0.45, 0.02);
  const wet = K.bus(out); wet.connect(rv);
  const T = 0.42; // impact
  // riser
  K.noise(wet, { type: 'bandpass', f: 400, f2: 6000, sweep: T, q: 2, a: T, d: 0.08, v: 0.35 });
  K.tone(wet, { type: 'sawtooth', f: 146.8, f2: 587, glide: T, a: T * 0.9, d: 0.06, v: 0.12, lp: 600, lp2: 4000, lpT: T });
  // impact: sub + crash
  const d = K.drive(out, 2.2);
  K.tone(d, { t: T, f: 120, f2: 40, glide: 0.25, a: 0.002, d: 0.7, v: 0.8 });
  K.noise(wet, { t: T, type: 'highpass', f: 4000, a: 0.001, d: 1.4, v: 0.35 });
  K.noise(out, { t: T, type: 'lowpass', f: 2000, f2: 200, sweep: 0.15, a: 0.001, d: 0.2, v: 0.5 });
  // brass chord: D major add9, detuned saws, filter swell
  const notes = [146.83, 220, 293.66, 369.99, 440, 587.33, 659.25, 739.99];
  notes.forEach((f, n) => {
    const pan = ((n / (notes.length - 1)) - 0.5) * 1.2;
    [-9, 0, 9].forEach((det, j) => {
      K.tone(wet, { type: 'sawtooth', f, detune: det, t: T + n * 0.012, a: 0.03, hold: 1.0, d: 0.9, v: 0.07, pan: pan + (j - 1) * 0.25, lp: 500, lp2: 2600, lpT: 0.18, q: 2 });
    });
  });
  // octave lead stab on top
  K.tone(wet, { type: 'square', f: 1174.66, t: T, a: 0.01, hold: 0.5, d: 0.8, v: 0.05, lp: 5000 });
  // shimmer arpeggio
  [1174.66, 1479.98, 1760, 2349.32, 2959.96, 3520].forEach((f, k) => {
    K.bell(wet, { f, t: T + 0.08 + k * 0.075, v: 0.16, d: 0.9, pan: (k % 2 ? 0.5 : -0.5) });
  });
}, 400];

DESIGNS.error = [0.36, (c, out, K) => {
  const d = K.drive(out, 3);
  [[233.08, 0], [196, 0.15]].forEach(([f, t]) => {
    K.tone(d, { type: 'square', f, t, a: 0.003, hold: 0.07, d: 0.05, v: 0.35, lp: 1600 });
    K.tone(d, { type: 'sawtooth', f: f * 1.01, t, a: 0.003, hold: 0.07, d: 0.05, v: 0.25, lp: 1200 });
  });
}];

DESIGNS.sweep = [1.1, (c, out, K) => {
  const rv = K.reverb(out, 0.9, 3, 0.35);
  const wet = K.bus(out); wet.connect(rv);
  K.noise(wet, { type: 'bandpass', f: 900, f2: 7000, sweep: 0.4, q: 1.5, a: 0.3, d: 0.15, v: 0.4 });
  for (let k = 0; k < 22; k++) {
    const t = Math.pow(k / 22, 0.8) * 0.42;
    const f = 1800 + K.R() * 3500 + k * 90;
    K.tone(wet, { f, t, a: 0.001, d: 0.05 + K.R() * 0.06, v: 0.12 + K.R() * 0.1, pan: K.R() * 1.6 - 0.8 });
  }
  K.bell(wet, { f: 1760, t: 0.45, v: 0.4, d: 0.5 });
  K.bell(wet, { f: 2637, t: 0.47, v: 0.3, d: 0.5, pan: 0.3 });
}, 500];

DESIGNS.achievement = [1.6, (c, out, K) => {
  const rv = K.reverb(out, 1.4, 3, 0.4);
  const wet = K.bus(out); wet.connect(rv);
  const seq = [783.99, 1046.5, 1318.51, 1567.98];
  seq.forEach((f, k) => {
    const t = k * 0.09;
    K.bell(wet, { f, t, v: 0.35, d: 0.5, pan: (k - 1.5) * 0.25 });
    K.tone(wet, { type: 'triangle', f, t, a: 0.002, d: 0.2, v: 0.25 });
  });
  const T = 0.36;
  [523.25, 659.25, 783.99, 1046.5, 1567.98].forEach((f, k) => {
    K.tone(wet, { type: 'triangle', f, t: T, a: 0.01, hold: 0.3, d: 0.7, v: 0.12, pan: (k - 2) * 0.3 });
    K.tone(wet, { type: 'square', f, t: T, a: 0.01, hold: 0.2, d: 0.5, v: 0.025, lp: 3000, pan: (2 - k) * 0.3 });
  });
  K.bell(wet, { f: 2093, t: T, v: 0.3, d: 1.0 });
  K.noise(wet, { t: T, type: 'highpass', f: 7000, a: 0.002, d: 0.6, v: 0.12 });
}, 600];

DESIGNS.levelup = [2.3, (c, out, K) => {
  const rv = K.reverb(out, 2.0, 2.8, 0.42);
  const wet = K.bus(out); wet.connect(rv);
  // two-octave 16th-note run
  const run = [0, 4, 7, 12, 16, 19, 24, 28, 31, 36];
  run.forEach((st, k) => {
    const f = 261.63 * semis(st);
    const t = k * 0.055;
    K.tone(wet, { type: 'square', f, t, a: 0.002, d: 0.12, v: 0.12, lp: 4000, pan: (k % 2 ? 0.35 : -0.35) });
    K.bell(wet, { f: f * 2, t, v: 0.14, d: 0.25 });
  });
  const T = run.length * 0.055 + 0.02;
  const d = K.drive(out, 2);
  K.tone(d, { t: T, f: 130, f2: 45, glide: 0.2, a: 0.002, d: 0.6, v: 0.7 });
  K.noise(wet, { t: T, type: 'highpass', f: 5000, a: 0.001, d: 1.2, v: 0.3 });
  // big wide chord C major 9 with detuned saws
  [130.81, 196, 261.63, 329.63, 392, 493.88, 587.33, 783.99].forEach((f, n) => {
    [-11, 0, 11].forEach((det, j) => {
      K.tone(wet, { type: 'sawtooth', f, detune: det, t: T, a: 0.02, hold: 0.7, d: 0.8, v: 0.065, pan: (n / 7 - 0.5) + (j - 1) * 0.3, lp: 700, lp2: 3200, lpT: 0.2, q: 2 });
    });
  });
  [2093, 2637, 3136, 4186].forEach((f, k) => K.bell(wet, { f, t: T + 0.05 + k * 0.07, v: 0.18, d: 0.9, pan: (k % 2 ? 0.6 : -0.6) }));
}, 700];

DESIGNS.boot = [1.5, (c, out, K) => {
  const rv = K.reverb(out, 1.6, 2.8, 0.45);
  const wet = K.bus(out); wet.connect(rv);
  const T = 0.38;
  // reverse-swell into the cut
  K.noise(wet, { type: 'bandpass', f: 300, f2: 5000, sweep: T, q: 3, a: T, d: 0.03, v: 0.45 });
  K.tone(wet, { type: 'sawtooth', f: 73.4, f2: 146.8, glide: T, a: T, d: 0.05, v: 0.15, lp: 300, lp2: 2400, lpT: T });
  // blade shing
  [1, 1.51, 2.26, 2.93, 4.07].forEach((r, k) => K.tone(wet, { t: T, f: 1600 * r, a: 0.001, d: 0.7 / (1 + k * 0.4), v: 0.35 * Math.pow(0.7, k), pan: k % 2 ? 0.3 : -0.3 }));
  K.noise(wet, { t: T, type: 'highpass', f: 3000, a: 0.0005, d: 0.04, v: 0.8 });
  // impact + dark D minor chord
  const d = K.drive(out, 2.5);
  K.tone(d, { t: T, f: 110, f2: 38, glide: 0.25, a: 0.002, d: 0.6, v: 0.9 });
  [73.42, 146.83, 220, 293.66, 349.23, 440].forEach((f, n) => {
    [-8, 8].forEach((det, j) => K.tone(wet, { type: 'sawtooth', f, detune: det, t: T, a: 0.01, hold: 0.25, d: 0.7, v: 0.07, pan: (j ? 0.4 : -0.4), lp: 2400, lp2: 400, lpT: 0.8, q: 1.5 }));
  });
}, 800];

DESIGNS.lock = [1.2, (c, out, K) => {
  // charge success: mechanical latch clank + sub + bright chord stab
  const rv = K.reverb(out, 1.1, 3, 0.35);
  const wet = K.bus(out); wet.connect(rv);
  K.noise(wet, { type: 'bandpass', f: 2600, q: 3, a: 0.0005, d: 0.03, v: 0.9 });
  K.noise(wet, { t: 0.035, type: 'bandpass', f: 4200, q: 4, a: 0.0005, d: 0.02, v: 0.6 });
  K.bell(wet, { f: 1318.5, v: 0.4, d: 0.7, ratios: [1, 2.76, 5.4] });
  const d = K.drive(out, 2.2);
  K.tone(d, { f: 150, f2: 45, glide: 0.15, a: 0.002, d: 0.45, v: 0.8 });
  [293.66, 440, 587.33, 739.99, 880].forEach((f, n) => {
    K.tone(wet, { type: 'sawtooth', f, detune: n % 2 ? 7 : -7, t: 0.01, a: 0.005, hold: 0.08, d: 0.5, v: 0.08, lp: 5000, lp2: 700, lpT: 0.4, pan: (n - 2) * 0.25 });
  });
}, 900];

DESIGNS.fizzle = [0.5, (c, out, K) => {
  K.noise(out, { type: 'bandpass', f: 1800, f2: 200, sweep: 0.35, q: 3, a: 0.002, d: 0.4, v: 0.5 });
  K.tone(out, { type: 'triangle', f: 400, f2: 90, glide: 0.35, a: 0.002, d: 0.35, v: 0.3 });
}];

// render order: things you hear first render first
const ORDER = [
  'tap', 'tick', ...Array.from({ length: 12 }, (_, i) => 'key' + i), 'toggle_on', 'toggle_off', 'open', 'close',
  'boot', 'pop', 'delete', ...COIN_STEPS.map((_, i) => 'coin' + i), 'thump', 'whoosh_m', 'error',
  'slash0', 'slash1', 'slash2', 'slash3', 'lock', 'fizzle', 'fanfare', 'sweep', 'whoosh_s', 'whoosh_l',
  'achievement', 'levelup',
];

async function renderOne(key) {
  if (buffers.has(key)) return;
  const d = DESIGNS[key];
  if (!d) return;
  const buf = await renderOffline(d[0], d[1], d[2] || 7);
  buffers.set(key, buf);
  const q = pending.get(key);
  if (q) {
    pending.delete(key);
    const t = now();
    q.forEach((p) => { if (t - p.at < 250) playKey(key, p.name, p.opts); });
  }
}

function renderAll() {
  if (rendering || !OAC) return;
  rendering = true;
  (async () => {
    for (const k of ORDER) {
      try { await renderOne(k); } catch (e) { /* skip broken one */ }
      await new Promise((r) => setTimeout(r, 0)); // yield to UI
    }
  })();
}

// ---------------------------------------------------------------- playback
function resolveKey(name, opts) {
  switch (name) {
    case 'tick': return ['tick', 0.8 + clamp(+opts.v || 0, 0, 1) * 0.9];
    case 'key': { const i = ((Math.round(+opts.i || 0) % 12) + 12) % 12; return ['key' + i, 1]; }
    case 'toggle': return [opts.on === false ? 'toggle_off' : 'toggle_on', 1];
    case 'coin': {
      const i = Math.max(0, Math.round(+opts.i || 0));
      if (i < COIN_STEPS.length) return ['coin' + i, 1];
      // keep rising past 8: reuse top variant, step up a whole tone each time
      return ['coin' + (COIN_STEPS.length - 1), Math.min(2, semis((i - COIN_STEPS.length + 1) * 2))];
    }
    case 'whoosh': {
      const dur = clamp(+opts.dur || 0.55, 0.1, 3);
      const k = dur < 0.42 ? 'whoosh_s' : dur < 0.78 ? 'whoosh_m' : 'whoosh_l';
      const base = { whoosh_s: 0.3, whoosh_m: 0.55, whoosh_l: 1.0 }[k];
      return [k, clamp(base / dur, 0.6, 1.6)];
    }
    case 'slash': { const i = Math.max(0, Math.round(+opts.i || 0)); return ['slash' + (i % 4), 1 + (Math.floor(i / 4) % 3) * 0.04]; }
    default: return [name, 1];
  }
}

function playKey(key, name, opts) {
  if (!ctx || !master || ctx.state !== 'running') return;
  const buf = buffers.get(key);
  if (!buf) return;
  const [, rate] = resolveKey(name, opts);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = (opts.rate || 1) * rate;
  const g = ctx.createGain();
  g.gain.value = (LEVEL[name] ?? 0.5) * clamp(opts.vol ?? 1, 0, 2);
  src.connect(g);
  if (opts.pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(+opts.pan, -1, 1);
    g.connect(p); p.connect(master);
  } else g.connect(master);
  // voice cap
  if (active.size > 28) {
    const oldest = active.values().next().value;
    try { oldest.stop(); } catch (e) { /* ignore */ }
    active.delete(oldest);
  }
  active.add(src);
  src.onended = () => { active.delete(src); try { g.disconnect(); } catch (e) { /* ignore */ } };
  src.start(ctx.currentTime + (opts.delay ? clamp(+opts.delay, 0, 5) : 0));
}

function play(name, opts = {}) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  opts = opts || {};
  if (name === 'tick') {
    const t = now();
    if (t - lastTick < 30) return;
    lastTick = t;
  }
  const [key] = resolveKey(name, opts);
  if (!DESIGNS[key]) return;
  if (!buffers.has(key)) {
    // not rendered yet: queue briefly and bump it to the front
    const q = pending.get(key) || [];
    if (q.length < 4) q.push({ name, opts, at: now() });
    pending.set(key, q);
    renderOne(key).catch(() => {});
    return;
  }
  playKey(key, name, opts);
}

// ---------------------------------------------------------------- charge riser (realtime nodes)
function startCharge() {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  if (charge) stopCharge(false, true);
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.22, t + 0.08);
  const trem = ctx.createGain(); trem.gain.value = 0.8;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 5;
  const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.18;
  lfo.connect(lfoAmt); lfoAmt.connect(trem.gain);
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass'; filt.frequency.value = 350; filt.Q.value = 7;
  const oscs = [
    ['sawtooth', -9, 0.5], ['sawtooth', 9, 0.5], ['square', 1200, 0.18], ['sine', -1200, 0.6],
  ].map(([type, det, v]) => {
    const o = ctx.createOscillator(); o.type = type; o.detune.value = det; o.frequency.value = 90;
    const g = ctx.createGain(); g.gain.value = v;
    o.connect(g); g.connect(filt);
    return o;
  });
  // airy hiss that grows with charge
  const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = nb.getChannelData(0); const R = rng(99);
  for (let i = 0; i < nd.length; i++) nd[i] = R() * 2 - 1;
  const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2000; nf.Q.value = 1.2;
  const ng = ctx.createGain(); ng.gain.value = 0;
  ns.connect(nf); nf.connect(ng); ng.connect(trem);
  filt.connect(trem); trem.connect(out); out.connect(master);
  oscs.forEach((o) => o.start(t)); lfo.start(t); ns.start(t);
  charge = { out, filt, oscs, lfo, ns, nf, ng, v: 0 };
  setCharge(0);
}

function setCharge(v) {
  if (!charge || !ctx) return;
  v = clamp(+v, 0, 1);
  charge.v = v;
  const t = ctx.currentTime, tc = 0.03;
  const f = 90 * Math.pow(2, v * 2.6);
  charge.oscs.forEach((o) => o.frequency.setTargetAtTime(f, t, tc));
  charge.filt.frequency.setTargetAtTime(350 + v * v * 5200, t, tc);
  charge.filt.Q.setTargetAtTime(6 + v * 8, t, tc);
  charge.lfo.frequency.setTargetAtTime(5 + v * v * 25, t, tc);
  charge.ng.gain.setTargetAtTime(v * 0.35, t, tc);
  charge.nf.frequency.setTargetAtTime(1500 + v * 6000, t, tc);
  charge.out.gain.setTargetAtTime(0.2 + v * 0.12, t, tc);
}

function stopCharge(success, silent) {
  const ch = charge;
  charge = null;
  if (!ch || !ctx) return;
  const t = ctx.currentTime;
  let end;
  const cancel = (p) => { try { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); } catch (e) { /* ignore */ } };
  [ch.out.gain, ch.filt.frequency].concat(ch.oscs.map((o) => o.frequency)).forEach(cancel);
  if (silent) {
    ch.out.gain.linearRampToValueAtTime(0, t + 0.04);
    end = t + 0.06;
  } else if (success) {
    ch.oscs.forEach((o) => o.frequency.exponentialRampToValueAtTime(Math.max(40, o.frequency.value) * 2, t + 0.08));
    ch.filt.frequency.exponentialRampToValueAtTime(9000, t + 0.08);
    ch.out.gain.setValueAtTime(ch.out.gain.value, t + 0.05);
    ch.out.gain.linearRampToValueAtTime(0, t + 0.12);
    end = t + 0.15;
    play('lock');
  } else {
    ch.oscs.forEach((o) => o.frequency.exponentialRampToValueAtTime(28, t + 0.45));
    ch.filt.frequency.exponentialRampToValueAtTime(140, t + 0.45);
    ch.out.gain.linearRampToValueAtTime(0, t + 0.5);
    end = t + 0.52;
    if (ch.v > 0.08) play('fizzle', { vol: 0.4 + ch.v * 0.6 });
  }
  ch.oscs.forEach((o) => { try { o.stop(end); } catch (e) { /* ignore */ } });
  try { ch.lfo.stop(end); ch.ns.stop(end); } catch (e) { /* ignore */ }
  setTimeout(() => { try { ch.out.disconnect(); } catch (e) { /* ignore */ } }, (end - t) * 1000 + 100);
}

// ---------------------------------------------------------------- install
function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  setSession();
  const opt = { capture: true, passive: true };
  ['touchend', 'click', 'keydown'].forEach((ev) => document.addEventListener(ev, onGesture, opt));
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('pagehide', () => { stopKeepAlive(); });
  // Offline rendering needs no gesture: warm the cache while the UI settles.
  const idle = globalThis.requestIdleCallback || ((f) => setTimeout(f, 60));
  idle(() => { try { renderAll(); } catch (e) { /* ignore */ } });
}

export const Sound = {
  install: safe(install),
  get enabled() { return enabled; },
  set enabled(v) {
    try {
      enabled = !!v;
      if (!enabled) { stopCharge(false, true); stopKeepAlive(); }
      else { startKeepAlive(); } // the document-level gesture listener already unlocked the ctx
    } catch (e) { /* ignore */ }
  },
  get ready() { try { return !!ctx && ctx.state === 'running'; } catch (e) { return false; } },
  get state() { try { return ctx ? ctx.state : 'none'; } catch (e) { return 'none'; } },
  get rendered() { return buffers.size; },
  play: safe(play),
  startCharge: safe(startCharge),
  setCharge: safe(setCharge),
  stopCharge: safe((success) => stopCharge(!!success, false)),
  // dev helper: render a named design offline, returns {peak, rms, seconds}
  analyze: async (key) => {
    try {
      const d = DESIGNS[key]; if (!d) return null;
      const b = buffers.get(key) || await renderOffline(d[0], d[1], d[2] || 7);
      let peak = 0, sum = 0, n = 0;
      for (let ch = 0; ch < b.numberOfChannels; ch++) {
        const x = b.getChannelData(ch);
        for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; sum += x[i] * x[i]; n++; }
      }
      return { peak, rms: Math.sqrt(sum / n), seconds: b.duration };
    } catch (e) { return { error: String(e) }; }
  },
  get designs() { return Object.keys(DESIGNS); },
};

export default Sound;
