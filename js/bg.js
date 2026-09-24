// Crimson Cut: living WebGL background.
// Domain-warped fbm "ink in water" in near-black, with restrained crimson veins,
// film grain, vignette and up to 4 shockwave ripples. WebGL1, no dependencies.

const MAX_RIPPLES = 4;
const RIPPLE_LIFE = 1.8;          // seconds
const CELEBRATE_TIME = 3.0;       // seconds before easing back to idle
const MAX_SIDE = 900;             // cap on internal render resolution (longest side)
const RES_SCALE = 0.6;            // internal pixels per CSS pixel
const IDLE_FRAME_MS = 1000 / 30;  // ~30fps idle
const ACTIVE_FRAME_MS = 1000 / 60;

// Per-mood shader parameters (crossfaded).
//   speed : flow speed multiplier       energy: warp amount / turbulence
//   heat  : crimson vein intensity      glow  : overall crimson bloom
//   alarm : pulsing red warning         lift  : overall exposure
const MOODS = {
  idle:      { speed: 1.0, energy: 0.0, heat: 0.55, glow: 0.0,  alarm: 0.0, lift: 1.0 },
  charging:  { speed: 1.6, energy: 0.35, heat: 0.8, glow: 0.15, alarm: 0.0, lift: 1.08 },
  over:      { speed: 2.2, energy: 0.7, heat: 1.0,  glow: 0.25, alarm: 1.0, lift: 1.05 },
  celebrate: { speed: 3.6, energy: 0.6, heat: 1.35, glow: 0.85, alarm: 0.0, lift: 1.3 },
};
const PARAM_KEYS = Object.keys(MOODS.idle);

const VERT = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  uRes;
uniform float uTime;     // flow phase (integrated speed)
uniform float uClock;    // real seconds, for grain / pulses
uniform vec2  uTilt;
uniform float uCharge;
uniform float uEnergy;
uniform float uHeat;
uniform float uGlow;
uniform float uAlarm;
uniform float uLift;
uniform vec4  uRip[${MAX_RIPPLES}]; // xy = pos (0..1, y up), z = age (s), w = strength (0 = off)

const vec3 BLACK  = vec3(0.039, 0.027, 0.031);
const vec3 INK    = vec3(0.067, 0.047, 0.055);
const vec3 GREY1  = vec3(0.129, 0.102, 0.114);
const vec3 GREY2  = vec3(0.184, 0.145, 0.161);
const vec3 CRIM   = vec3(0.863, 0.078, 0.235);
const vec3 CRIMHI = vec3(1.000, 0.227, 0.361);
const vec3 DEEP   = vec3(0.420, 0.039, 0.118);
const vec3 BLOOD  = vec3(0.560, 0.030, 0.085);  // lit-smoke crimson (less blue, avoids pink)

float hash(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);
float fbm4(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ s += a * noise(p); p = ROT * p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
float fbm5(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ s += a * noise(p); p = ROT * p * 2.01 + 11.7; a *= 0.5; }
  return s / 0.96875;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;                        // 0..1
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);      // aspect-correct, centred

  // ---- ripples: radial displacement + light ring
  float ringLight = 0.0;
  vec2 disp = vec2(0.0);
  for (int i = 0; i < ${MAX_RIPPLES}; i++){
    vec4 r = uRip[i];
    if (r.w <= 0.0) continue;
    vec2 d = p - (r.xy - 0.5) * vec2(aspect, 1.0);
    float dist = length(d);
    float age = r.z;
    float radius = 0.95 * (0.75 + 0.25 * r.w) * (1.0 - exp(-age * 1.4)); // fast out, eases off
    float life = clamp(1.0 - age / ${RIPPLE_LIFE.toFixed(2)}, 0.0, 1.0);
    float width = 0.012 + age * 0.03;
    float x = (dist - radius) / width;
    float ring = exp(-x * x) * life * sqrt(life);
    // shock profile: push outward ahead of the front, pull behind
    disp += normalize(d + 1e-5) * (-x * exp(-x * x)) * 0.06 * r.w * life;
    ringLight += ring * r.w * 0.9;
    // brief core flash at the origin
    ringLight += exp(-dist * dist * 90.0) * exp(-age * 7.0) * r.w * 1.5;
  }
  p += disp;

  // ---- domain-warped flow field
  float t = uTime * 0.035;
  vec2 q0 = p * 1.35 + uTilt * vec2(0.12, 0.08);
  q0.y -= t * 0.6;                               // slow rise, like smoke
  float warp = 3.2 + uEnergy * 1.4;

  vec2 q = vec2(fbm4(q0 + t * vec2(0.9, 0.3)),
                fbm4(q0 + vec2(5.2, 1.3) - t * vec2(0.4, 0.7)));
  vec2 r = vec2(fbm4(q0 + warp * q + vec2(1.7, 9.2) + t * 1.3),
                fbm4(q0 + warp * q + vec2(8.3, 2.8) - t * 1.1));
  vec2 fp = q0 + warp * r + t * 0.5;
  float f  = fbm5(fp);
  float f2 = fbm5(fp + vec2(0.045, 0.07));        // offset sample for rim light

  float n = smoothstep(0.28, 0.80, f);
  float smoke = n * n;

  // ---- charge: crimson rising from the bottom, following the smoke
  float riseEdge = uCharge * 1.05 - 0.15;
  float rise = smoothstep(riseEdge + 0.22, riseEdge - 0.2, uv.y + (f - 0.5) * 0.45) * uCharge;

  // ---- where the smoke is lit from within by blood-red light
  // warm underlight: the scene is lit from below, so there's always some blood in the lower smoke
  float under = smoothstep(0.75, -0.05, uv.y + (q.x - 0.5) * 0.4) * 0.65;
  float zone = max(smoothstep(0.48, 0.86, r.x + 0.4 * (q.y - 0.5)), under);
  zone = clamp(zone * min(uHeat * 1.3, 1.0) + rise * 1.1 + uAlarm * 0.35 * smoothstep(0.3, 0.8, r.x) + uGlow * 0.55, 0.0, 1.0);

  vec3 smokeCol = mix(GREY2 * 0.85, BLOOD, zone);
  vec3 col = mix(BLACK, smokeCol, smoke * 0.9);

  // rim light on billow edges
  float rim = clamp((f - f2) * 10.0, 0.0, 1.0);
  col += mix(GREY2 * 0.9, CRIM * 0.8, zone) * rim * smoke * 0.55;

  // ---- veins: glowing filaments riding the warp, only inside the smoke
  float fil = fbm4(q0 * 1.25 + warp * 0.9 * r + vec2(t * 0.8, -t * 0.3));
  float dd = abs(fil - 0.5);
  float w0 = 0.0045 + uEnergy * 0.002;
  float line = w0 / (dd + w0);
  line *= line;
  float lineMask = smoothstep(0.15, 0.7, n) * (0.25 + 0.75 * zone);
  float heat = uHeat + rise * 1.2 + ringLight * 0.8 + uAlarm * 0.3;
  col += CRIM * line * lineMask * heat * 0.7;
  col += CRIMHI * line * line * lineMask * heat * 0.45;

  // rising charge: molten underglow lighting the smoke from below
  col += BLOOD * rise * smoke * 0.55;
  col += DEEP * rise * rise * 0.08;

  // ---- over: angry pulsing warning, strongest at the edges
  float beat = pow(0.5 + 0.5 * sin(uClock * 6.2), 3.0);
  float edge = smoothstep(0.3, 1.0, length((uv - 0.5) * vec2(aspect * 1.2, 1.0)) * 1.4);
  col += BLOOD * uAlarm * (0.14 + 0.45 * beat) * (edge * (0.3 + smoke) + zone * smoke * 0.6);
  col.gb *= 1.0 - 0.45 * uAlarm;  // strip the cool tones: pure angry red

  // ---- celebrate: bloom
  vec2 bc = (uv - vec2(0.5, 0.42)) * vec2(aspect, 1.0);
  float bloom = exp(-dot(bc, bc) * 4.5);
  col += BLOOD * uGlow * smoke * (0.35 + 1.1 * bloom) * (0.5 + zone);
  col += CRIM * uGlow * bloom * 0.16;
  col += CRIMHI * uGlow * 0.7 * line * smoothstep(0.1, 0.6, n);

  // ---- ripple light
  col += mix(CRIM, CRIMHI, 0.4) * ringLight * (0.22 + smoke * 1.0);

  col *= uLift;

  // ---- vignette
  vec2 v = (uv - 0.5) * vec2(aspect > 1.0 ? 1.0 : 0.85, 1.0);
  float vig = smoothstep(0.95, 0.2, length(v) * 1.15);
  col *= mix(0.3, 1.0, vig);

  // ---- soft tone map: filmic shoulder, never clipped white
  float lum = dot(col, vec3(0.3, 0.55, 0.15)) + max(col.r - 0.5, 0.0) * 0.5;
  col = col / (1.0 + lum * 0.9);

  // ---- film grain
  float g = hash(frag + fract(uClock * 7.13) * 431.0) - 0.5;
  col += g * 0.028;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

function noop() {}

export function createBackground(canvas, { reduceMotion = false } = {}) {
  const dead = {
    ok: false,
    setMood: noop, setCharge: noop, pulse: noop, setTilt: noop, destroy: noop,
  };
  if (!canvas || typeof canvas.getContext !== 'function') return dead;

  const ctxOpts = {
    alpha: false, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  };
  let gl = canvas.getContext('webgl', ctxOpts) || canvas.getContext('experimental-webgl', ctxOpts);
  if (!gl) {
    canvas.style.display = 'none';
    return dead;
  }

  // ---------- state
  const cur = { ...MOODS.idle };
  let target = { ...MOODS.idle };
  let mood = 'idle';
  let celebrateLeft = 0;
  let charge = 0, chargeTarget = 0;
  const tilt = [0, 0], tiltTarget = [0, 0];
  const ripples = []; // {x, y, age, s}
  const ripData = new Float32Array(MAX_RIPPLES * 4);

  let prog = null, buf = null, U = {};
  let raf = 0, lastNow = 0, lastDraw = 0;
  let phase = 7.0; // flow phase; start mid-flow so the first frame is already developed
  let clock = 0;
  let lost = false, destroyed = false;
  let w = 0, h = 0;

  // ---------- GL setup
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('bg shader: ' + log);
    }
    return s;
  }
  function initGL() {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error('bg link: ' + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.useProgram(prog);
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // single oversized triangle covering the viewport
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    U = {};
    for (const n of ['uRes', 'uTime', 'uClock', 'uTilt', 'uCharge', 'uEnergy', 'uHeat',
      'uGlow', 'uAlarm', 'uLift', 'uRip']) {
      U[n] = gl.getUniformLocation(prog, n === 'uRip' ? 'uRip[0]' : n);
    }
    w = h = 0; // force viewport update
  }

  try {
    initGL();
  } catch (err) {
    console.warn(err);
    canvas.style.display = 'none';
    return dead;
  }

  // ---------- sizing
  function resize() {
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || window.innerHeight;
    let s = RES_SCALE;
    const longest = Math.max(cw, ch) * s;
    if (longest > MAX_SIDE) s *= MAX_SIDE / longest;
    const nw = Math.max(1, Math.round(cw * s));
    const nh = Math.max(1, Math.round(ch * s));
    if (nw !== w || nh !== h) {
      w = nw; h = nh;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      return true;
    }
    return false;
  }

  // ---------- frame
  function draw() {
    if (lost || destroyed) return;
    resize();
    gl.uniform2f(U.uRes, w, h);
    gl.uniform1f(U.uTime, phase);
    gl.uniform1f(U.uClock, clock);
    gl.uniform2f(U.uTilt, tilt[0], tilt[1]);
    gl.uniform1f(U.uCharge, charge);
    gl.uniform1f(U.uEnergy, cur.energy + charge * 0.45);
    gl.uniform1f(U.uHeat, cur.heat);
    gl.uniform1f(U.uGlow, cur.glow);
    gl.uniform1f(U.uAlarm, cur.alarm);
    gl.uniform1f(U.uLift, cur.lift + charge * 0.12);
    ripData.fill(0);
    for (let i = 0; i < ripples.length; i++) {
      const r = ripples[i];
      ripData[i * 4] = r.x; ripData[i * 4 + 1] = r.y;
      ripData[i * 4 + 2] = r.age; ripData[i * 4 + 3] = r.s;
    }
    gl.uniform4fv(U.uRip, ripData);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function approach(a, b, k) { return a + (b - a) * k; }

  function step(dt) {
    // crossfade ~0.6s to 95%
    const k = 1 - Math.exp(-dt / 0.2);
    let settling = false;
    for (const key of PARAM_KEYS) {
      cur[key] = approach(cur[key], target[key], k);
      if (Math.abs(cur[key] - target[key]) > 0.002) settling = true;
    }
    charge = approach(charge, chargeTarget, 1 - Math.exp(-dt / 0.08));
    if (Math.abs(charge - chargeTarget) > 0.002) settling = true;
    const kt = 1 - Math.exp(-dt / 0.35);
    tilt[0] = approach(tilt[0], tiltTarget[0], kt);
    tilt[1] = approach(tilt[1], tiltTarget[1], kt);
    if (Math.abs(tilt[0] - tiltTarget[0]) + Math.abs(tilt[1] - tiltTarget[1]) > 0.003) settling = true;

    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age > RIPPLE_LIFE) ripples.splice(i, 1);
    }
    if (mood === 'celebrate') {
      celebrateLeft -= dt;
      if (celebrateLeft <= 0) applyMood('idle');
    }
    phase += dt * (cur.speed + charge * 1.2);
    clock += dt;
    return settling;
  }

  function isActive(settling) {
    return settling || ripples.length > 0 || mood === 'charging' || mood === 'celebrate' ||
      mood === 'over' || chargeTarget > 0.001;
  }

  function loop(now) {
    raf = 0;
    if (destroyed || lost || document.hidden) return;
    let dt = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    if (dt > 0.1) dt = 0.1; // resume after a stall without a jump
    lastNow = now;
    const settling = step(dt);
    const active = isActive(settling);
    // idle: throttle to ~30fps (small tolerance so a 60Hz display lands on every 2nd frame)
    // active: cap at ~60fps (ProMotion displays run rAF at 120Hz)
    if (now - lastDraw >= (active ? ACTIVE_FRAME_MS : IDLE_FRAME_MS) - 4) {
      lastDraw = now;
      draw();
    }
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (reduceMotion || raf || destroyed || lost || document.hidden) return;
    lastNow = 0;
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function renderStatic() {
    // reduced motion: snap everything to targets and draw once
    Object.assign(cur, target);
    charge = chargeTarget;
    tilt[0] = tiltTarget[0]; tilt[1] = tiltTarget[1];
    draw();
  }

  function applyMood(m) {
    if (!MOODS[m]) return;
    mood = m;
    target = { ...MOODS[m] };
    if (m === 'celebrate') celebrateLeft = CELEBRATE_TIME;
    if (reduceMotion) {
      // celebrate would never ease back without a clock; show it as idle-bright only
      if (m === 'celebrate') { mood = 'idle'; target = { ...MOODS.idle, heat: 0.8, lift: 1.1 }; }
      renderStatic();
    }
  }

  // ---------- events
  function onVisibility() {
    if (document.hidden) stop();
    else if (reduceMotion) renderStatic();
    else start();
  }
  function onResize() {
    if (reduceMotion) { if (resize()) draw(); }
    // animated mode picks up the new size on the next frame
  }
  function onLost(e) {
    e.preventDefault();
    lost = true;
    stop();
  }
  function onRestored() {
    lost = false;
    try {
      initGL();
    } catch (err) {
      console.warn(err);
      return;
    }
    if (reduceMotion) renderStatic(); else start();
  }

  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);

  if (reduceMotion) renderStatic();
  else start();

  // ---------- public API
  return {
    setMood(m) {
      if (destroyed || m === mood && m !== 'celebrate') return;
      applyMood(m);
      start();
    },
    setCharge(v) {
      if (destroyed) return;
      v = Math.min(1, Math.max(0, Number(v) || 0));
      chargeTarget = v;
      if (reduceMotion) return; // static frame only changes on mood change
      start();
    },
    pulse(x, y, strength = 1) {
      if (destroyed || reduceMotion) return;
      const cw = canvas.clientWidth || window.innerWidth;
      const ch = canvas.clientHeight || window.innerHeight;
      const r = canvas.getBoundingClientRect();
      const nx = (x - r.left) / (cw || 1);
      const ny = 1 - (y - r.top) / (ch || 1);
      const s = Math.min(2, Math.max(0.1, Number(strength) || 1));
      if (ripples.length >= MAX_RIPPLES) ripples.shift(); // drop the oldest
      ripples.push({ x: nx, y: ny, age: 0, s });
      start();
    },
    setTilt(x, y) {
      if (destroyed) return;
      tiltTarget[0] = Math.min(1, Math.max(-1, Number(x) || 0));
      tiltTarget[1] = Math.min(1, Math.max(-1, Number(y) || 0));
      if (!reduceMotion) start();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      if (!gl.isContextLost()) {
        gl.deleteBuffer(buf);
        gl.deleteProgram(prog);
      }
    },
    get ok() { return !destroyed; },
  };
}
