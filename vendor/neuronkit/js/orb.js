// NeuronKit orb — the Orion shader (liquid, aurora, core, star, black hole,
// galaxy), as used in the voice pill's dial. One offscreen WebGL context
// paints every visible orb, so a page of orbs costs one GPU context.
//
//   <canvas class="nk-orb" width="160" height="160" data-style="aurora" data-tint="#91c9ff"></canvas>
//   import { initOrbs } from "./js/orb.js"; initOrbs();
//
// The orb's envelope never changes size; only its inner flow moves, and it
// holds still under prefers-reduced-motion. It never touches a microphone.

const FRAGMENT = "precision highp float;\nuniform float phase;\nuniform float style;\nuniform vec3 tint;\nuniform float level;\nuniform vec2 resolution;\nfloat hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }\nvoid main(){\nvec2 p=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y);\nvec2 ctr=resolution*0.5;\nfloat R=resolution.x*(25.0/62.0);\nvec4 fx=vec4(style+2.0,level,phase,0.33);\n      vec2 q = (p - ctr) / R; float rr = min(length(q), 1.0), ang = atan(q.y, q.x); if(length(q)>1.0+1.5/R)discard;\n      vec4 artv = vec4(tint, 0.0); vec3 art = artv.rgb; float lvl = clamp(fx.y, 0.0, 1.0), t = fx.z, sp = max(fx.w, 0.05);   // fx.z = accumulated phase (radians), integrated on the CPU: always increasing, so speed may vary but rotation never reverses\n      if (abs(artv.w) > 0.001) { float hs = artv.w * 6.2832, ca = cos(hs), sa = sin(hs);    // hue shift (YIQ rotation) \u2192 state colour\n        art = clamp(mat3(0.299 + 0.701 * ca + 0.168 * sa, 0.587 - 0.587 * ca + 0.330 * sa, 0.114 - 0.114 * ca - 0.497 * sa,\n                         0.299 - 0.299 * ca - 0.328 * sa, 0.587 + 0.413 * ca + 0.035 * sa, 0.114 - 0.114 * ca + 0.292 * sa,\n                         0.299 - 0.300 * ca + 1.250 * sa, 0.587 - 0.588 * ca - 1.050 * sa, 0.114 + 0.886 * ca - 0.203 * sa) * art, 0.0, 1.0); }\n      float zz = sqrt(max(0.0, 1.0 - rr * rr)); vec3 n3 = vec3(q, zz);\n      float lam = clamp(dot(n3, normalize(vec3(-0.45, -0.55, 0.72))), 0.0, 1.0);      // sphere shading\n      float fres = pow(1.0 - zz, 2.5);                                                 // rim falloff\n      float e = 0.0, sharp = 0.0, dim = 0.0; vec3 extra = vec3(0.0);\n      if (fx.x < 2.5) {                                                                // liquid flow: the card's ridges pushed through a swirling (domain-warped) field\n        vec2 w = q + 0.36 * vec2(sin(q.y * 2.6 + t * 0.50), cos(q.x * 2.3 - t * 0.42));\n        vec2 w2 = w + 0.30 * vec2(sin(w.y * 3.1 - t * 0.35), cos(w.x * 2.7 + t * 0.40));\n        float s1 = pow(0.5 + 0.5 * sin(w.x * 3.2 + w.y * 1.6 + t * 0.60), 6.0);\n        float s2 = pow(0.5 + 0.5 * sin(w2.y * 3.6 - w2.x * 1.2 - t * 0.45), 4.0) * 0.6;\n        // one genuinely thin streak: distance from the wave crest converted to SCREEN PIXELS (like the card's front, exp(-px/7)),\n        // so its width does not depend on how fast the warped field happens to change here\n        float ph = (w.x * 3.2 + w.y * 1.6) * 0.42 + t * 0.60;      // SAME field/direction as the main ridges, lower frequency \u2192 one leading streak\n        float dpx = sqrt(max(0.0, 2.0 * (1.0 - sin(ph)))) * R / 1.6;\n        sharp = exp(-dpx / 3.5);\n        float env = 0.30 + 0.70 * exp(-pow(rr / (0.95 * sp * 3.0), 3.0));\n        e = (s1 + s2) * env; sharp *= env;\n      } else if (fx.x < 3.5) {                                                         // aurora: bands flowing across, warped\n        float y = q.y + 0.20 * sin(q.x * 3.0 + t * 0.6) + 0.10 * sin(q.x * 6.0 - t * 0.9);\n        float s1 = pow(0.5 + 0.5 * sin(y * 7.0 - t * 0.9), 6.0);\n        float s2 = pow(0.5 + 0.5 * sin(y * 4.2 + q.x * 2.0 + t * 0.5), 4.0) * 0.6;\n        e = (s1 + s2) * (0.35 + 0.65 * exp(-pow(rr / (0.9 * sp * 3.0), 3.0)));\n      } else if (fx.x < 4.5) {                                                          // core: pulsing centre, rays, halo\n        float pulse = 0.30 + 0.18 * sin(t * 1.7) + 0.35 * lvl;\n        e = exp(-pow(rr / (0.26 * pulse + 0.10), 2.0)) * 1.15\n          + pow(0.5 + 0.5 * sin(ang * 9.0 + t * 0.7), 8.0) * exp(-rr * 2.4) * 0.8\n          + exp(-pow((rr - pulse * 1.1) / (0.14 * sp * 3.0), 2.0)) * 0.85;\n      } else if (fx.x < 5.5) {                                                          // STAR (Orion): white-hot core, turbulent corona, thin flares, 4-point diffraction spikes\n        float sz = 0.09 + 0.05 * lvl + 0.010 * sin(t * 2.3) + 0.006 * sin(t * 5.1);       // twinkle\n        float core = exp(-pow(rr / sz, 1.5));\n        float corona = exp(-rr / (0.26 + 0.16 * lvl * sp * 3.0)) * (0.55 + 0.45 * (0.5 + 0.5 * sin(ang * 7.0 + t * 0.6 + sin(ang * 3.0 - t * 0.4) * 1.5)));\n        float flares = pow(0.5 + 0.5 * sin(ang * 13.0 + sin(ang * 3.0 + t * 0.5) * 2.0), 12.0) * exp(-rr * 2.2) * 0.9;\n        float spike = (exp(-abs(q.y) * R / 2.5) + exp(-abs(q.x) * R / 2.5)) * exp(-rr * 2.0) * (0.35 + 0.3 * lvl);\n        e = core * 1.7 + corona + flares + spike;\n        extra = vec3(1.0, 0.94, 0.82) * pow(core, 0.8) * 1.5;                             // white-hot centre, warm edge\n      } else if (fx.x < 6.5) {                                                          // BLACK HOLE: horizon, photon ring, layered accretion disc (near edge-on) + the lensed arc over the top\n        float horizon = smoothstep(0.295, 0.25, rr);\n        vec2 ed = vec2(q.x, q.y * 3.4); float rd = length(ed), ad = atan(ed.y, ed.x);\n        float spread = 0.20 * sp * 3.0;\n        float inner = exp(-pow((rd - 0.44) / (spread * 0.55), 2.0));                        // hot inner ring\n        float mid   = exp(-pow((rd - 0.66) / spread, 2.0));                                 // main disc\n        float outer = exp(-pow((rd - 0.92) / (spread * 1.6), 2.0)) * 0.55;                  // faint outer band\n        float orbit = pow(0.5 + 0.5 * sin(ad * 3.0 - t * 1.30 + rd * 7.0), 5.0)\n                    + pow(0.5 + 0.5 * sin(ad * 5.0 - t * 2.05 + rd * 11.0 + 1.4), 7.0) * 0.6;\n        float doppler = 0.30 + 0.70 * smoothstep(-0.75, 0.75, q.x);\n        vec2 la = vec2(q.x, (q.y + 0.30) * 1.5); float lensed = exp(-pow((length(la) - 0.42) / 0.055, 2.0)) * smoothstep(0.1, -0.35, q.y) * 0.9;\n        float photon = exp(-abs(rr - 0.30) * R / 3.5);\n        float discs = (inner * 1.25 + mid + outer) * (0.40 + 0.95 * orbit) * doppler;\n        e = (discs + lensed + photon * 1.6) * (1.0 - horizon);\n        dim = horizon;                                                                     // the horizon swallows even the glass shading\n        extra = (vec3(1.0, 0.86, 0.62) * (photon + inner * 0.5) * (0.55 + 0.4 * lvl)\n              + vec3(1.0, 0.93, 0.80) * lensed * 0.5) * (1.0 - horizon);\n      } else {                                                                            // GALAXY: two logarithmic spiral arms, bright bulge, dust lanes, star speckles\n        float lr = log(max(rr, 0.03)), ph = ang * 2.0 - lr * 5.0 + t * 1.30;      // same rate as the accretion disc (sign = direction of the spin)\n        float arms = pow(0.5 + 0.5 * sin(ph), 3.0) * exp(-rr * 1.3);\n        float dust = pow(0.5 + 0.5 * sin(ph + 0.95), 5.0) * 0.6;                    // dust lanes ride the same phase \u2192 they rotate with the arms\n        float bulge = exp(-pow(rr / (0.15 + 0.05 * lvl), 1.4)) * 1.4;\n        // stars: two layers, each rotating at its own (differential) rate and jittered per cell, with a twinkle \u2014 a field, not a moving grid\n        float speck = 0.0;\n        for (int li = 0; li < 2; li++) { float lf = float(li);\n          float wsp = 1.30 * (0.35 + 0.30 * lf), ca2 = cos(t * wsp), sa2 = sin(t * wsp);\n          vec2 sq = mat2(ca2, -sa2, sa2, ca2) * q * (5.5 + 3.5 * lf) + vec2(11.0 * lf);\n          vec2 cell = floor(sq), fr = fract(sq);\n          vec2 jit = vec2(hash(cell), hash(cell + 37.7));                                  // star placed anywhere in its cell\n          float d2 = length(fr - jit), br = hash(cell + 91.3);\n          float tw = 0.65 + 0.35 * sin(t * (2.0 + 6.0 * br) + br * 30.0);                  // each twinkles at its own rate\n          speck += smoothstep(0.10, 0.0, d2) * pow(br, 7.0) * 9.0 * tw * (1.0 - 0.35 * lf); }\n        speck *= exp(-rr * 1.1);\n        e = (arms * (1.1 + 0.6 * lvl) + bulge + speck) * (1.0 - dust * 0.55);\n        extra = vec3(1.0, 0.93, 0.80) * bulge * 0.5 + vec3(1.0) * speck * 0.6;\n      }\n      e *= (0.55 + 0.8 * lvl);\n      vec3 deep = art * 0.10 + vec3(0.012, 0.018, 0.040);\n      float glassy = fx.x < 4.5 ? 1.0 : 0.45;                                            // cosmic styles: keep the glass, dial the body shading down\n      vec3 orb = deep * (0.5 + 0.8 * lam) * glassy\n               + art * e * 0.95 + extra\n               + vec3(0.85, 0.93, 1.0) * pow(clamp(e, 0.0, 2.0), 2.2) * 0.5\n               + (art * 0.35 + vec3(0.30, 0.36, 0.48)) * fres * (0.30 + 0.35 * lvl);\n      orb *= 1.0 - dim;\n      orb += vec3(0.85, 0.93, 1.0) * sharp * (0.55 + 0.5 * lvl);                                       // the sharp leading streak\n      vec2 hl = q - vec2(-0.38, -0.44);                                                                  // top-left: broad glow + hot spot \u2192 reads spherical\n      orb += (vec3(0.30, 0.36, 0.48) * exp(-dot(hl, hl) / 0.085) * 0.7 + vec3(0.62, 0.70, 0.85) * exp(-dot(hl, hl) / 0.016) * 0.7) * glassy * (1.0 - dim);\n      orb += vec3(0.85, 0.93, 1.0) * exp(-abs(rr - 0.985) * R / 4.0) * (0.45 + 0.45 * lvl);   // thin bright edge\n      gl_FragColor = vec4(orb, 1.0-smoothstep(1.0-1.5/R,1.0+1.5/R,length(q)));\n}\n";

const STYLES = { liquid: 0, aurora: 1, core: 2, star: 3, blackhole: 4, galaxy: 5 };
const SIZE = 160;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

let gl, uniforms, offscreen, running = false;
const orbs = new Set();

function setup() {
  offscreen = document.createElement("canvas");
  offscreen.width = offscreen.height = SIZE;
  gl = offscreen.getContext("webgl", { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) return false;
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}"));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  uniforms = Object.fromEntries(["phase", "style", "level", "resolution", "tint"].map((n) => [n, gl.getUniformLocation(program, n)]));
  gl.viewport(0, 0, SIZE, SIZE);
  gl.uniform2f(uniforms.resolution, SIZE, SIZE);
  return true;
}

function paint(orb) {
  const c = orb.canvas;
  const style = STYLES[c.dataset.style] ?? Number(c.dataset.style ?? 1);
  const tint = c.dataset.tint || getComputedStyle(c).getPropertyValue("--voice").trim() || "#91c9ff";
  const active = c.dataset.active === "true";
  gl.uniform1f(uniforms.style, style);
  gl.uniform3f(uniforms.tint, ...rgb(tint));
  gl.uniform1f(uniforms.level, active ? 0.42 : 0.14);
  gl.uniform1f(uniforms.phase, orb.phase);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  orb.ctx.clearRect(0, 0, c.width, c.height);
  orb.ctx.drawImage(offscreen, 0, 0, c.width, c.height);
}

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let last = 0;
function tick(now) {
  requestAnimationFrame(tick);
  if (document.hidden || now - last < 40) return;
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  for (const orb of orbs) {
    if (!orb.canvas.isConnected) { orbs.delete(orb); continue; }
    const r = orb.canvas.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || !r.width) continue;   // off screen: skip
    if (!reduced.matches && orb.canvas.dataset.still !== "true") {
      orb.phase += dt * (orb.canvas.dataset.active === "true" ? 1.2 : 0.65) * Number(orb.canvas.dataset.speed ?? 1);
    }
    paint(orb);
  }
}

/** Mount one canvas as an orb. Falls back to a flat disc without WebGL. */
export function mountOrb(canvas) {
  if (canvas.dataset.nkOrb) return;
  canvas.dataset.nkOrb = "1";
  if (!canvas.width) canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!gl && !setup()) {
    ctx.fillStyle = canvas.dataset.tint || "#91c9ff";
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width * 0.4, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const orb = { canvas, ctx, phase: 1.5 + Math.random() };
  orbs.add(orb);
  paint(orb);
  if (!running) { running = true; requestAnimationFrame(tick); }
}

/** Mount every canvas.nk-orb under root, now and as they are added. */
export function initOrbs(root = document) {
  root.querySelectorAll("canvas.nk-orb").forEach(mountOrb);
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches("canvas.nk-orb")) mountOrb(n);
      n.querySelectorAll?.("canvas.nk-orb").forEach(mountOrb);
    }
  }).observe(root === document ? document.body : root, { childList: true, subtree: true });
}
