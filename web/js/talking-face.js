// Talking faces: the character who is speaking appears in a lifelike picture
// whose lips move with their voice, who blinks and moves their head a little.
// All of it runs on this device, for free:
//  - face-worker.js finds the eyes, lips and chin in the picture once
//    (MediaPipe Face Landmarker), and the result is kept on this device;
//  - a small WebGL program bends the picture each frame: the jaw drops as the
//    voice gets louder, showing a mouth with teeth, and the eyelids close for
//    a blink;
//  - the loudness comes from the voice clip itself (decoded once), so the lips
//    follow the real words. Device voices give no sound to measure, so the
//    lips move in a speaking rhythm instead.
// Without WebGL, or when no face is found (a drawn portrait), the picture
// stays still and glows while that character speaks.
import * as store from './store.js';

// ---------------------------------------------------------------------------
// Finding the face
// ---------------------------------------------------------------------------
let worker = null;
let jobs = 0;
const waiting = new Map();
function faceWorker() {
  if (!worker) {
    worker = new Worker(new URL('../face-worker.js', import.meta.url));
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.face);
    };
    worker.onerror = (e) => { for (const w of waiting.values()) w.reject(new Error(e.message || 'Face finder failed')); waiting.clear(); worker = null; };
  }
  return worker;
}

// The face's points in a picture ({ mouthL: [x, y], ... } from 0 to 1), or
// null when there is no face. key names the picture, so each is looked at once.
export async function findFace(key, blob) {
  const saved = await store.getMedia(`face-points|${key}`).catch(() => null);
  if (saved) { try { return JSON.parse(await saved.text()); } catch (e) { /* look again */ } }
  if (typeof window !== 'undefined' && window.__talkingFaceStub) return window.__talkingFaceStub(key);
  const bitmap = await createImageBitmap(blob);
  const id = ++jobs;
  const face = await new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    faceWorker().postMessage({ id, bitmap }, [bitmap]);
  });
  await store.putMedia(`face-points|${key}`, new Blob([JSON.stringify(face)], { type: 'application/json' })).catch(() => {});
  return face;
}

// ---------------------------------------------------------------------------
// How loud the voice is
// ---------------------------------------------------------------------------
const FPS = 60;
let decoder = null;
// Loudness 60 times a second, from 0 to 1, scaled to the clip's own loud parts.
export async function loudnessOf(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  decoder ||= new Ctx();
  const buf = await decoder.decodeAudioData(await blob.arrayBuffer());
  const data = buf.getChannelData(0);
  const step = Math.max(1, Math.round(buf.sampleRate / FPS));
  const out = new Float32Array(Math.ceil(data.length / step));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    const end = Math.min(data.length, (i + 1) * step);
    for (let j = i * step; j < end; j++) sum += data[j] * data[j];
    out[i] = Math.sqrt(sum / Math.max(1, end - i * step));
  }
  const sorted = Array.from(out).sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] || 1;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] / loud);
  return out;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
const VERT = `attribute vec2 a; varying vec2 v; void main(){ v = a * 0.5 + 0.5; v.y = 1.0 - v.y; gl_Position = vec4(a, 0.0, 1.0); }`;
// Everything is worked out in the picture's pixels. Around the mouth the
// picture is measured from the middle of the lips, in half mouth widths, with
// y pointing down the face.
const FRAG = `precision highp float;
varying vec2 v;
uniform sampler2D uTex;
uniform vec2 uImg;      // picture size in pixels
uniform vec3 uView;     // crop centre (xy) and crop size, pixels
uniform vec3 uHead;     // head turn (radians), nod (pixels), breathing scale
uniform vec2 uM;        // middle of the lips
uniform vec2 uAx;       // along the mouth, left to right (unit)
uniform float uW;       // half the mouth's width
uniform float uCurve;   // how far the mouth corners sit below the middle
uniform float uChin;    // chin, below the lips
uniform float uOpen;    // jaw drop, in half mouth widths
uniform vec4 uEyeL;     // eye centre (xy), half width, half height
uniform vec4 uEyeR;
uniform float uBlink;   // 0 open, 1 shut

vec2 ay() { return vec2(-uAx.y, uAx.x); }
vec4 tex(vec2 p) { return texture2D(uTex, clamp(p / uImg, vec2(0.0), vec2(1.0))); }
float across(float x, float y) {
  float hw = 1.0 + 0.75 * clamp(y / uChin, 0.0, 1.0);
  return 1.0 - smoothstep(0.5 * hw, 1.1 * hw, abs(x));
}
float down(float y) {
  return (1.0 - 0.25 * clamp(y / uChin, 0.0, 1.0)) * (1.0 - smoothstep(uChin, uChin + 1.1, y));
}
// A blink: the upper lid (with its lashes) slides down over the eye, and the
// part of the eye still showing is squeezed below it.
vec2 eyelid(vec2 p, vec4 eye) {
  if (uBlink <= 0.01) return p;
  vec2 d = p - eye.xy;
  float x = dot(d, uAx) / eye.z;
  float y = dot(d, ay()) / eye.z;
  float reach = smoothstep(1.3, 0.95, abs(x));
  if (reach <= 0.0) return p;
  float k = eye.w / eye.z * max(0.2, sqrt(max(0.0, 1.0 - x * x)));
  float T = -2.4 * k;
  float O = -k;
  float B = k;
  float lid = O + (B - O) * uBlink;
  float sy = y;
  if (y >= T && y <= lid) sy = T + (y - T) * (O - T) / max(0.0001, lid - T);
  else if (y > lid && y <= B) sy = B - lid < 0.001 ? B : O + (y - lid) * (B - O) / (B - lid);
  sy = mix(y, sy, reach);
  return eye.xy + (uAx * x + ay() * sy) * eye.z;
}

void main() {
  // Screen point -> picture point, with the head's small movements.
  vec2 q = (v - 0.5) * uView.z / uHead.z;
  float c = cos(uHead.x), s = sin(uHead.x);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y) + uView.xy + vec2(0.0, uHead.y);
  q = eyelid(eyelid(q, uEyeL), uEyeR);

  vec2 d = q - uM;
  float lx = dot(d, uAx) / uW;
  float ly = dot(d, ay()) / uW;
  float line = uCurve * lx * lx;
  float y = ly - line;
  float h0 = across(lx, 0.0);
  float up = uOpen * 0.16 * h0;
  float dn = uOpen * h0;
  vec4 col;
  if (uOpen > 0.002 && h0 > 0.002 && y > -up && y < dn) {
    // Inside the open mouth: dark, upper teeth at the top, a hint of tongue.
    float t = (y + up) / max(0.0001, up + dn);
    float side = smoothstep(0.85, 0.2, abs(lx));
    vec3 inner = mix(vec3(0.10, 0.03, 0.04), vec3(0.30, 0.08, 0.09), side * 0.6);
    float teeth = step(t, 0.3 + 0.1 * (1.0 - h0)) * smoothstep(0.85, 0.55, abs(lx));
    inner = mix(inner, vec3(0.86, 0.83, 0.78) * (0.75 + 0.25 * side), teeth * smoothstep(0.0, 0.08, uOpen));
    inner = mix(inner, vec3(0.55, 0.22, 0.24), smoothstep(0.7, 1.0, t) * smoothstep(0.15, 0.3, uOpen) * side);
    // Soft lip edges.
    vec2 upLip = uM + (uAx * lx + ay() * (line - up + 0.02)) * uW;
    vec2 lowLip = uM + (uAx * lx + ay() * (line + 0.02)) * uW;
    float eU = smoothstep(0.0, 0.06, y + up);
    float eD = smoothstep(0.0, 0.06, dn - y);
    col = vec4(inner, 1.0);
    col = mix(tex(upLip), col, eU);
    col = mix(tex(lowLip), col, eD);
  } else if (y >= dn) {
    // Below the lips: the lower lip, jaw and chin move down.
    float sy = y;
    for (int i = 0; i < 4; i++) sy = y - uOpen * across(lx, max(sy, 0.0)) * down(max(sy, 0.0));
    col = tex(uM + (uAx * lx + ay() * (sy + line)) * uW);
  } else {
    // Above the lips: the upper lip lifts a little.
    float sy = y + up * (1.0 - smoothstep(0.0, 0.9, -y));
    col = tex(uM + (uAx * lx + ay() * (sy + line)) * uW);
  }
  gl_FragColor = vec4(col.rgb, 1.0);
}`;

function program(gl) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'program');
  return p;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (a) => Math.hypot(a[0], a[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// The shape numbers the drawing program needs, from the face's points.
export function faceGeometry(face, width, height) {
  const px = (k) => [face[k][0] * width, face[k][1] * height];
  const L = px('mouthL'); const R = px('mouthR');
  const along = sub(R, L);
  const w = len(along) / 2;
  const ax = [along[0] / (2 * w), along[1] / (2 * w)];
  const ay = [-ax[1], ax[0]];
  const M = mid(px('lipUpIn'), px('lipLowIn'));
  const local = (p) => { const d = sub(p, M); return [(d[0] * ax[0] + d[1] * ax[1]) / w, (d[0] * ay[0] + d[1] * ay[1]) / w]; };
  const corners = (local(L)[1] + local(R)[1]) / 2;
  const chin = Math.max(1.2, local(px('chin'))[1]);
  const eye = (out, inn, top, bot) => {
    const c = mid(px(out), px(inn));
    return [c[0], c[1], len(sub(px(out), px(inn))) / 2, Math.max(2, len(sub(px(top), px(bot))) / 2)];
  };
  const eyeL = eye('eyeLOut', 'eyeLIn', 'eyeLTop', 'eyeLBot');
  const eyeR = eye('eyeROut', 'eyeRIn', 'eyeRTop', 'eyeRBot');
  // Show the head and shoulders: centred between the eyes and the chin.
  const eyesMid = [(eyeL[0] + eyeR[0]) / 2, (eyeL[1] + eyeR[1]) / 2];
  const chinP = px('chin');
  const faceH = len(sub(chinP, eyesMid));
  const centre = [(eyesMid[0] + chinP[0]) / 2, (eyesMid[1] + chinP[1]) / 2 - faceH * 0.12];
  // Kept inside the picture, so its edges never smear.
  const view = Math.min(Math.max(faceH * 3.1, w * 6), width, height) / 1.03;
  const keep = (c, size) => Math.min(Math.max(c, view * 0.52), size - view * 0.52);
  return { M, ax, w, curve: corners, chin, eyeL, eyeR, view: [keep(centre[0], width), keep(centre[1], height), view] };
}

// A canvas that shows one face and makes it talk.
//   const t = createTalker(canvas); await t.show(blob, face); t.speak(level)
// level() returns how loud the voice is now (0 to 1), or null when quiet.
export function createTalker(canvas, { reducedMotion = false } = {}) {
  let gl = null;
  try { gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true }) || null; } catch (e) { gl = null; }
  let prog = null;
  let tex = null;
  let geo = null;
  let img = [1, 1];
  let level = () => null;
  let raf = 0;
  let open = 0;
  let nextBlink = performance.now() + 1500;
  let blinkStart = -1;
  let nod = 0;
  let heldBlink = null;
  const start = performance.now();
  if (gl) {
    try {
      prog = program(gl);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      tex = gl.createTexture();
    } catch (e) { console.warn('Talking face not available:', e.message); gl = null; }
  }
  const u = (name) => gl.getUniformLocation(prog, name);

  function frame(now) {
    raf = 0;
    if (!gl || !geo) return;
    const t = (now - start) / 1000;
    // Jaw: opens fast with the voice, closes a little slower.
    const lv = level();
    const target = lv == null ? 0 : Math.max(0, Math.min(1, (lv - 0.08) * 1.5)) * 0.42;
    open += (target - open) * (target > open ? 0.55 : 0.3);
    if (open < 0.004) open = 0;
    // Blinks every 2.5 to 6 seconds, 0.16 seconds each.
    let blink = 0;
    if (blinkStart < 0 && now > nextBlink) blinkStart = now;
    if (blinkStart >= 0) {
      const p = Math.max(0, now - blinkStart) / 160;
      blink = p >= 1 ? 0 : Math.sin(Math.PI * p);
      if (p >= 1) { blinkStart = -1; nextBlink = now + 2500 + Math.random() * 3500; }
    }
    if (heldBlink != null) blink = heldBlink;
    const still = reducedMotion ? 0 : 1;
    nod += (open * 0.012 - nod) * 0.08;
    const turn = still * (0.012 * Math.sin(t * 0.63) + 0.006 * Math.sin(t * 1.71));
    const drift = still * (geo.view[2] * (0.004 * Math.sin(t * 0.9) + nod));
    const breathe = 1.02 + still * 0.006 * Math.sin(t * 1.25);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.uniform1i(u('uTex'), 0);
    gl.uniform2f(u('uImg'), img[0], img[1]);
    gl.uniform3f(u('uView'), geo.view[0], geo.view[1], geo.view[2]);
    gl.uniform3f(u('uHead'), turn, drift, breathe);
    gl.uniform2f(u('uM'), geo.M[0], geo.M[1]);
    gl.uniform2f(u('uAx'), geo.ax[0], geo.ax[1]);
    gl.uniform1f(u('uW'), geo.w);
    gl.uniform1f(u('uCurve'), geo.curve);
    gl.uniform1f(u('uChin'), geo.chin);
    gl.uniform1f(u('uOpen'), open);
    gl.uniform4f(u('uEyeL'), ...geo.eyeL);
    gl.uniform4f(u('uEyeR'), ...geo.eyeR);
    gl.uniform1f(u('uBlink'), blink);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!stopped) raf = requestAnimationFrame(frame);
  }
  let stopped = true;
  const run = () => { stopped = false; if (!raf) raf = requestAnimationFrame(frame); };

  return {
    // True when the picture moves; false when it can only be shown still.
    async show(blob, face) {
      if (!gl || !face) { geo = null; return false; }
      const bitmap = await createImageBitmap(blob);
      img = [bitmap.width, bitmap.height];
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      if (bitmap.close) bitmap.close();
      geo = faceGeometry(face, img[0], img[1]);
      run();
      return true;
    },
    speak(fn) { level = fn || (() => null); },
    quiet() { level = () => null; },
    // A blink now, or (for tests) eyelids held part-way: blink(0.5).
    blink(hold) { if (hold == null) blinkStart = performance.now(); else heldBlink = hold; },
    pause() { stopped = true; if (raf) cancelAnimationFrame(raf); raf = 0; },
    resume() { if (geo) run(); },
    get moving() { return !!(gl && geo); },
    get mouth() { return open; },
  };
}

// A speaking rhythm for voices whose sound can't be measured (device voices):
// syllables about five a second, with short pauses.
export function rhythm() {
  const t0 = performance.now();
  return () => {
    const t = (performance.now() - t0) / 1000;
    const syl = Math.max(0, Math.sin(t * Math.PI * 2 * 2.6));
    const phrase = Math.sin(t * 0.9) > -0.85 ? 1 : 0.1;
    return 0.15 + 0.75 * syl * phrase;
  };
}
