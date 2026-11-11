// Turns a spoken clip into a whisper, for story moments that should be
// hushed (engine/src/beats.js WHISPERS).
//
// A whisper is breath shaped by the mouth, with no buzz from the voice box.
// So each short slice of sound keeps the shape of its spectrum (smoothed, so
// the voice's pitch harmonics go) and gets random phases, which swaps the
// buzz for breath. Low notes are thinned out and a little extra air is added
// at the top, as in a real whisper. Free, on this device, no service needed.

const N = 512;          // slice length (about 21 ms at 24 kHz)
const HOP = N / 4;
const SMOOTH = 4;       // bins either side when smoothing the spectrum

function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// samples: Float32Array (mono, -1..1). Returns a new Float32Array the same
// length, whispered, at about the same loudness. `random` is for tests.
export function whisperSamples(samples, rate = 24000, random = Math.random) {
  const len = samples.length;
  const out = new Float32Array(len);
  if (len < N) return out;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const norm = new Float32Array(len);
  const re = new Float64Array(N), im = new Float64Array(N);
  const mag = new Float64Array(N / 2 + 1);
  const binHz = rate / N;
  for (let start = 0; start + N <= len; start += HOP) {
    for (let i = 0; i < N; i++) { re[i] = samples[start + i] * win[i]; im[i] = 0; }
    fft(re, im, false);
    for (let k = 0; k <= N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    for (let k = 0; k <= N / 2; k++) {
      // Smoothed spectrum (by power, so loudness stays): the mouth's shape
      // without the voice's pitch.
      let sum = 0, cnt = 0;
      for (let j = Math.max(0, k - SMOOTH); j <= Math.min(N / 2, k + SMOOTH); j++) { sum += mag[j] * mag[j]; cnt++; }
      const hz = k * binHz;
      const tilt = hz < 300 ? (hz / 300) ** 2 : hz > 2500 ? 1.25 : 1;
      const m = Math.sqrt(sum / cnt) * tilt;
      const ph = random() * 2 * Math.PI;
      re[k] = m * Math.cos(ph); im[k] = m * Math.sin(ph);
      if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    im[0] = 0; im[N / 2] = 0;
    fft(re, im, true);
    for (let i = 0; i < N; i++) { out[start + i] += re[i] * win[i]; norm[start + i] += win[i] * win[i]; }
  }
  // (The edges, covered by fewer slices, are not boosted.)
  for (let i = 0; i < len; i++) out[i] /= Math.max(norm[i], 0.75);
  // Same loudness as before (smoothing and the low cut take some away).
  let a = 0, b = 0;
  for (let i = 0; i < len; i++) { a += samples[i] * samples[i]; b += out[i] * out[i]; }
  const gain = b > 0 ? Math.min(12, Math.sqrt(a / b)) : 1;
  let peak = 0;
  for (let i = 0; i < len; i++) { out[i] *= gain; peak = Math.max(peak, Math.abs(out[i])); }
  if (peak > 0.98) for (let i = 0; i < len; i++) out[i] *= 0.98 / peak;
  return out;
}

// A 16-bit mono WAV file from samples.
export function wavBytes(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Uint8Array(buf);
}

// A clip (any audio the browser can read) made into a whispered WAV clip.
// If the browser can't read it, the clip comes back as it was.
export async function whisperBlob(blob) {
  try {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) return blob;
    const ctx = new Ctx(1, 1, 24000);
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const ch = audio.getChannelData(0);
    return new Blob([wavBytes(whisperSamples(ch, audio.sampleRate), audio.sampleRate)], { type: 'audio/wav' });
  } catch (e) {
    return blob;
  }
}
