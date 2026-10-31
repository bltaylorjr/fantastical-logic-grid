// Talking faces: the character who is speaking appears in a lifelike picture,
// head and shoulders, whose lips move with their voice and who acts the way
// they feel: a nervous witness blinks fast and fidgets with worried brows, a
// cheerful one smiles and bobs, a sly one smirks, a caught culprit hangs their
// head. All of it runs on this device, for free:
//  - face-worker.js finds the eyes, lips and chin in the picture once
//    (MediaPipe Face Landmarker), and the result is kept on this device;
//  - a small WebGL program bends the picture each frame: the jaw drops as the
//    voice gets louder, showing a mouth with teeth; the mouth corners and
//    brows show the mood; the eyelids close for a blink or hang heavy; a
//    smile lifts the cheeks and crinkles the eyes; the head turns and
//    nods on the neck while the shoulders breathe, sway and shrug;
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
  // Only decodes, never plays: kept suspended so it doesn't hold the sound
  // hardware awake.
  if (!decoder) { decoder = new Ctx(); decoder.suspend?.(); }
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
  // Smoothed over a few frames, so the lips follow syllables, not every
  // flicker in the sound.
  const raw = out.slice();
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) { sum += raw[j]; n++; }
    out[i] = sum / n;
  }
  const sorted = Array.from(out).sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] || 1;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] / loud);
  return out;
}

// ---------------------------------------------------------------------------
// Moods: how a character acts (castbook.js MOODS). smile lifts (or drops) the
// mouth corners, smirk lifts one; brow raises (or lowers) the brows and inner
// raises their inner ends (worry); motion and pace scale the head's
// movements; nod is how much the head bobs with the words; pitch tips the
// head down (or the chin up); tilt leans it; jitter adds small quick
// fidgets; blink is the gap between blinks in seconds; jaw scales the mouth;
// lids is how far the upper lids hang (0 to 1).
// ---------------------------------------------------------------------------
const CALM = { smile: 0, smirk: 0, brow: 0, inner: 0, motion: 1, pace: 1, nod: 1, pitch: 0, tilt: 0, jitter: 0, blink: [2.5, 6], jaw: 1, lids: 0 };
export const ACTING = {
  calm: CALM,
  cheerful: { smile: 0.55, brow: 0.25, motion: 1.3, pace: 1.2, nod: 1.6 },
  excited: { smile: 0.7, brow: 0.5, motion: 1.8, pace: 1.5, nod: 2.2, jaw: 1.2 },
  nervous: { smile: -0.1, brow: 0.3, inner: 0.7, motion: 0.8, pace: 2.2, jitter: 1, pitch: 0.25, blink: [0.7, 1.8] },
  guilty: { smile: -0.3, inner: 0.6, motion: 0.5, pace: 0.7, pitch: 0.7, tilt: -0.3, jitter: 0.3, blink: [0.9, 2.2], jaw: 0.85, lids: 0.2 },
  sly: { smile: 0.1, smirk: 0.7, brow: -0.25, motion: 0.8, pace: 0.6, tilt: 0.5, blink: [3, 7], lids: 0.3 },
  grumpy: { smile: -0.55, brow: -0.7, motion: 0.7, pace: 0.6, pitch: 0.15, lids: 0.25 },
  proud: { smile: 0.35, brow: 0.1, pitch: -0.6, motion: 0.9 },
  kind: { smile: 0.45, brow: 0.15, inner: 0.15, motion: 0.9, pace: 0.8, tilt: 0.3 },
  shy: { smile: 0.15, inner: 0.35, motion: 0.5, pitch: 0.55, jaw: 0.75, blink: [1.4, 3], lids: 0.1 },
  dreamy: { smile: 0.2, brow: 0.2, motion: 1, pace: 0.5, tilt: 0.6, blink: [3, 7], lids: 0.15 },
  formal: { motion: 0.45, pace: 0.8, pitch: -0.15 },
  dramatic: { brow: 0.6, motion: 2, pace: 1.1, nod: 2, jaw: 1.25 },
  playful: { smile: 0.5, smirk: 0.3, brow: 0.3, motion: 1.4, pace: 1.4, tilt: 0.4 },
  curious: { brow: 0.45, tilt: 0.6, motion: 1.1, pace: 1.1 },
  blunt: { brow: -0.2, motion: 0.6 },
  chatty: { smile: 0.35, brow: 0.2, motion: 1.3, pace: 1.3, nod: 1.4 },
  bookish: { brow: 0.15, motion: 0.7, pace: 0.8, pitch: 0.1, lids: 0.1 },
  bold: { smile: 0.3, brow: 0.1, pitch: -0.3, motion: 1.3, nod: 1.3 },
};
export const actingOf = (mood) => ({ ...CALM, ...(ACTING[mood] || {}) });

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
uniform vec4 uView;     // crop centre (xy), crop width and height, pixels
uniform vec3 uHead;     // head roll (radians), nod (pixels, + is down), side shift (pixels)
uniform vec2 uNeck;     // where the head turns on the neck
uniform float uFaceH;   // eyes to chin, pixels
uniform vec2 uBody;     // shoulders lifted (pixels), breath (0 to 1)
uniform vec2 uM;        // middle of the lips
uniform vec2 uAx;       // along the mouth, left to right (unit)
uniform float uW;       // half the mouth's width
uniform float uCurve;   // how far the mouth corners sit below the middle
uniform float uChin;    // chin, below the lips
uniform float uOpen;    // jaw drop, in half mouth widths
uniform vec2 uSmile;    // corners up (+) or down (-); the right corner's extra lift (smirk)
uniform vec2 uBrow;     // brows up (+) or down (-); inner ends up (worry)
uniform vec4 uEyeL;     // eye centre (xy), half width, half height
uniform vec4 uEyeR;
uniform float uBlink;   // 0 open, 1 shut
uniform float uCheek;   // a real smile: cheeks and lower lids lift, eyes crinkle

vec2 ay() { return vec2(-uAx.y, uAx.x); }
vec4 tex(vec2 p) { return texture2D(uTex, clamp(p / uImg, vec2(0.5) / uImg, vec2(1.0) - vec2(0.5) / uImg)); }
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
// A real smile reaches the eyes: the cheek and lower lid below each eye rise,
// narrowing the eye from below.
vec2 cheek(vec2 p, vec4 eye) {
  if (uCheek <= 0.01) return p;
  vec2 d = p - eye.xy;
  float x = dot(d, uAx) / eye.z;
  float y = dot(d, ay()) / eye.z;
  float k = eye.w / eye.z;
  float wx = exp(-x * x / 1.6);
  float wy = smoothstep(-0.2 * k, 0.8 * k, y) * (1.0 - smoothstep(1.5, 3.2, y));
  return p + ay() * uCheek * 0.55 * eye.w * wx * wy;
}
// The brow above one eye moves up or down; inward is +1 towards the nose.
vec2 brow(vec2 p, vec4 eye, float inward) {
  vec2 d = p - eye.xy;
  float x = dot(d, uAx) / eye.z;
  float y = dot(d, ay()) / eye.z;
  float wx = exp(-x * x / 1.1);
  // Only the brow and the forehead above it move: the upper lid and its
  // crease stay where they are, or the eye looks stretched.
  float lidTop = -2.2 * eye.w / eye.z;
  float wy = exp(-(y + 1.3) * (y + 1.3) / 0.2) * smoothstep(lidTop + 0.05, lidTop - 0.3, y);
  float inner = smoothstep(-0.8, 0.9, x * inward);
  float lift = clamp(uBrow.x + uBrow.y * inner, -0.8, 0.8) * 0.45 * eye.z * wx * wy;
  return p + ay() * lift;
}

void main() {
  // Screen point -> picture point.
  vec2 p = uView.xy + (v - 0.5) * uView.zw;
  vec2 down2 = ay();
  float along = dot(p - uNeck, down2);
  // The body: shoulders rise for a shrug and with each breath.
  float side = abs(dot(p - uNeck, uAx)) / uFaceH;
  float body = smoothstep(-0.05, 0.35, along / uFaceH);
  float shoulders = body * smoothstep(0.2, 0.75, side) * (1.0 - smoothstep(1.6, 2.4, along / uFaceH));
  p += down2 * (uBody.x * shoulders + uBody.y * 0.012 * uFaceH * body * smoothstep(0.0, 1.5, along / uFaceH));
  // The head turns and nods on the neck; the body stays put.
  float head = 1.0 - smoothstep(-0.25, 0.25, along / uFaceH);
  float a = -uHead.x * head;
  vec2 r = p - uNeck;
  p = uNeck + vec2(cos(a) * r.x - sin(a) * r.y, sin(a) * r.x + cos(a) * r.y) - (down2 * uHead.y + uAx * uHead.z) * head;
  vec2 q = eyelid(eyelid(brow(brow(cheek(cheek(p, uEyeL), uEyeR), uEyeL, 1.0), uEyeR, -1.0), uEyeL), uEyeR);

  vec2 d = q - uM;
  float lx = dot(d, uAx) / uW;
  float ly = dot(d, ay()) / uW;
  // Mouth corners lift for a smile, drop for a frown; one lifts for a smirk.
  float corner = smoothstep(0.1, 0.95, abs(lx)) * (1.0 - smoothstep(1.1, 1.9, abs(lx))) * exp(-ly * ly / 0.7);
  float lift = (uSmile.x + uSmile.y * step(0.0, lx)) * 0.42 * corner;
  ly += lift;
  q += ay() * lift * uW;
  float line = uCurve * lx * lx;
  float y = ly - line;
  float h0 = across(lx, 0.0);
  float up = uOpen * 0.16 * h0;
  float dn = uOpen * h0;
  vec4 col;
  if (uOpen > 0.002 && h0 > 0.002 && y > -up && y < dn) {
    // Inside the open mouth: dark, upper teeth at the top, a hint of tongue.
    float t = (y + up) / max(0.0001, up + dn);
    float sd = smoothstep(0.85, 0.2, abs(lx));
    vec3 inner = mix(vec3(0.10, 0.03, 0.04), vec3(0.30, 0.08, 0.09), sd * 0.6);
    float teeth = step(t, 0.3 + 0.1 * (1.0 - h0)) * smoothstep(0.85, 0.55, abs(lx));
    inner = mix(inner, vec3(0.86, 0.83, 0.78) * (0.75 + 0.25 * sd), teeth * smoothstep(0.0, 0.08, uOpen));
    inner = mix(inner, vec3(0.55, 0.22, 0.24), smoothstep(0.7, 1.0, t) * smoothstep(0.15, 0.3, uOpen) * sd);
    // Soft lip edges.
    vec2 upLip = uM + (uAx * lx + ay() * (line - up + 0.02)) * uW;
    vec2 lowLip = uM + (uAx * lx + ay() * (line + 0.02)) * uW;
    col = vec4(inner, 1.0);
    col = mix(tex(upLip), col, smoothstep(0.0, 0.06, y + up));
    col = mix(tex(lowLip), col, smoothstep(0.0, 0.06, dn - y));
  } else if (y >= dn) {
    // Below the lips: the lower lip, jaw and chin move down.
    float sy = y;
    for (int i = 0; i < 4; i++) sy = y - uOpen * across(lx, max(sy, 0.0)) * down(max(sy, 0.0));
    col = tex(q + ay() * (sy - y) * uW);
  } else {
    // Above the lips: the upper lip lifts a little.
    float sy = y + up * (1.0 - smoothstep(0.0, 0.9, -y));
    col = tex(q + ay() * (sy - y) * uW);
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
// aspect: the frame's height over its width.
export function faceGeometry(face, width, height, aspect = 1.25) {
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
  const eyesMid = [(eyeL[0] + eyeR[0]) / 2, (eyeL[1] + eyeR[1]) / 2];
  const chinP = px('chin');
  const faceH = len(sub(chinP, eyesMid));
  // The head turns about the top of the neck, a little below the chin.
  const neck = [chinP[0] + ay[0] * faceH * 0.15, chinP[1] + ay[1] * faceH * 0.15];
  // Head and shoulders: the face in the top part of a tall frame. Kept inside
  // the picture, so its edges never smear.
  let vw = Math.max(faceH * 3.2, w * 6.5);
  vw = Math.min(vw, width / 1.04, (height / aspect) / 1.04);
  const vh = vw * aspect;
  const centre = [eyesMid[0], eyesMid[1] + vh * 0.2];
  const keep = (c, view, size) => Math.min(Math.max(c, view * 0.51), size - view * 0.51);
  return { M, ax, w, curve: corners, chin, eyeL, eyeR, neck, faceH, view: [keep(centre[0], vw, width), keep(centre[1], vh, height), vw, vh] };
}

// A canvas that shows one face and makes it talk.
//   const t = createTalker(canvas); await t.show(blob, face);
//   t.speak(level, 'nervous'); t.gesture('shrug')
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
  let mood = actingOf('calm');
  const now0 = performance.now();
  // Expression values ease towards the mood's, so changes look natural.
  const ex = { smile: 0, smirk: 0, brow: 0, inner: 0, pitch: 0, tilt: 0, lids: 0 };
  let nextBlink = now0 + 1500;
  let blinkStart = -1;
  let heldBlink = null;
  let nod = 0;
  let gesture = null;
  let jitterAt = 0;
  let jitter = [0, 0];
  let fidget = [0, 0];
  let last = now0;
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
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const t = (now - now0) / 1000;
    const m = mood;
    const still = reducedMotion ? 0.15 : 1;
    // Jaw: follows the voice, opening a little quicker than it closes, and
    // smoothed so the lips glide between sounds instead of snapping.
    const lv = level();
    const target = lv == null ? 0 : Math.max(0, Math.min(1, (lv - 0.08) * 1.5)) * 0.42 * m.jaw;
    // (Eased by time, not by frame, so a slow machine moves the mouth as fast.)
    open += (target - open) * (1 - Math.pow(target > open ? 0.62 : 0.76, dt * 60));
    if (open < 0.004) open = 0;
    for (const k of Object.keys(ex)) ex[k] += (m[k] - ex[k]) * Math.min(1, dt * 4);
    // Blinks, more often when nervous.
    let blink = 0;
    if (blinkStart < 0 && now > nextBlink) blinkStart = now;
    if (blinkStart >= 0) {
      const p = Math.max(0, now - blinkStart) / 160;
      blink = p >= 1 ? 0 : Math.sin(Math.PI * p);
      if (p >= 1) { blinkStart = -1; nextBlink = now + 1000 * (m.blink[0] + Math.random() * (m.blink[1] - m.blink[0])); }
    }
    if (heldBlink != null) blink = heldBlink;
    // Heavy lids (sly, grumpy, guilty) hang part-way; a blink closes the rest.
    const lids = heldBlink != null ? 0 : ex.lids;
    blink = lids + (1 - lids) * blink;
    // A gesture runs for its length, rising and falling.
    let shrug = 0;
    let gNod = 0;
    let gShake = 0;
    let gBrow = 0;
    if (gesture) {
      const p = (now - gesture.at) / gesture.ms;
      if (p >= 1) gesture = null;
      else {
        const k = Math.sin(Math.PI * Math.min(1, p));
        if (gesture.kind === 'shrug') { shrug = k; gBrow = 0.5 * k; }
        if (gesture.kind === 'nod') gNod = Math.sin(p * Math.PI * 4) * (1 - p);
        if (gesture.kind === 'shake') gShake = Math.sin(p * Math.PI * 4) * (1 - p);
      }
    }
    // Small fidgets, a few times a second. Each one glides to its new spot
    // (a jump would look like a dropped frame).
    if (m.jitter && now > jitterAt) { fidget = [(Math.random() - 0.5) * m.jitter, (Math.random() - 0.5) * m.jitter]; jitterAt = now + 250 + Math.random() * 400; }
    if (!m.jitter) fidget = [0, 0];
    const glide = 1 - Math.pow(0.88, dt * 60);
    jitter = [jitter[0] + (fidget[0] - jitter[0]) * glide, jitter[1] + (fidget[1] - jitter[1]) * glide];
    const fh = geo.faceH;
    nod += (open * 0.02 * m.nod - nod) * (1 - Math.pow(0.9, dt * 60));
    const sp = m.pace;
    // The mood's pose (tilt, head down or chin up) holds even with reduced motion.
    const roll = ex.tilt * 0.07 + still * (m.motion * (0.02 * Math.sin(t * 0.63 * sp) + 0.01 * Math.sin(t * 1.71 * sp)) + jitter[0] * 0.025 + gShake * 0.06 + shrug * 0.05);
    const pitch = fh * (ex.pitch * 0.08 + still * (nod + gNod * 0.06 + jitter[1] * 0.02 + m.motion * 0.006 * Math.sin(t * 0.9 * sp)));
    const sway = still * fh * (m.motion * 0.025 * Math.sin(t * 0.41 * sp) + gShake * 0.05 + jitter[0] * 0.03);
    const breath = 0.5 + 0.5 * Math.sin(t * 1.3);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.uniform1i(u('uTex'), 0);
    gl.uniform2f(u('uImg'), img[0], img[1]);
    gl.uniform4f(u('uView'), ...geo.view);
    gl.uniform3f(u('uHead'), roll, pitch, sway);
    gl.uniform2f(u('uNeck'), geo.neck[0], geo.neck[1]);
    gl.uniform1f(u('uFaceH'), fh);
    gl.uniform2f(u('uBody'), shrug * fh * 0.14 + (reducedMotion ? 0 : 0), still * breath);
    gl.uniform2f(u('uM'), geo.M[0], geo.M[1]);
    gl.uniform2f(u('uAx'), geo.ax[0], geo.ax[1]);
    gl.uniform1f(u('uW'), geo.w);
    gl.uniform1f(u('uCurve'), geo.curve);
    gl.uniform1f(u('uChin'), geo.chin);
    gl.uniform1f(u('uOpen'), open);
    gl.uniform2f(u('uSmile'), ex.smile, ex.smirk);
    gl.uniform2f(u('uBrow'), ex.brow + gBrow, ex.inner);
    gl.uniform4f(u('uEyeL'), ...geo.eyeL);
    gl.uniform4f(u('uEyeR'), ...geo.eyeR);
    gl.uniform1f(u('uBlink'), blink);
    gl.uniform1f(u('uCheek'), Math.max(0, Math.min(1, ex.smile * 1.4)));
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
      geo = faceGeometry(face, img[0], img[1], canvas.height / canvas.width);
      run();
      return true;
    },
    speak(fn, how) { level = fn || (() => null); if (how) mood = actingOf(how); },
    act(how) { mood = actingOf(how); },
    quiet() { level = () => null; },
    // 'shrug', 'nod' or 'shake'.
    gesture(kind, ms = kind === 'shrug' ? 900 : 1100) { gesture = { kind, ms, at: performance.now() }; },
    // A blink now, or (for tests) eyelids held part-way: blink(0.5).
    blink(hold) { if (hold == null) blinkStart = performance.now(); else heldBlink = hold; },
    // Stops moving, with the mouth shut, so they never come back mid-word.
    pause() { stopped = true; if (raf) cancelAnimationFrame(raf); raf = 0; level = () => null; open = 0; frame(performance.now()); },
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
