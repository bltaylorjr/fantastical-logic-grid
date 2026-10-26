// Kokoro text-to-speech (Apache-2.0) running on this computer, off the main
// thread. The speech engine (onnxruntime-web) and the voice files ship with the
// app; only the model itself downloads once from Hugging Face, after which the
// browser keeps it and voices work offline.
import { KokoroTTS, env } from './vendor/kokoro/kokoro.web.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const VOICES = ['af_heart', 'af_bella', 'af_nicole', 'af_aoede', 'am_michael', 'am_fenrir', 'am_puck'];
env.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;

// The library looks voices up in this cache by their Hugging Face address, so
// the bundled copies are placed there and never need downloading.
async function seedVoices() {
  const cache = await caches.open('kokoro-voices');
  await Promise.all(VOICES.map(async (v) => {
    const url = `https://huggingface.co/${MODEL}/resolve/main/voices/${v}.bin`;
    if (await cache.match(url)) return;
    const res = await fetch(new URL(`./vendor/kokoro/voices/${v}.bin`, import.meta.url));
    if (res.ok) await cache.put(url, res);
  }));
}

let loading = null;
function load() {
  if (!loading) {
    loading = (async () => {
      await seedVoices().catch(() => {});
      return KokoroTTS.from_pretrained(MODEL, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => { if (p.status === 'progress') postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total }); },
      });
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    const tts = await load();
    if (type === 'load') { postMessage({ id, ok: true }); return; }
    if (type === 'speak') {
      // A voice that doesn't ship with the game downloads once; if it can't
      // (offline), its stand-in speaks instead.
      let voice = data.voice || 'af_heart';
      let audio;
      try {
        audio = await tts.generate(data.text, { voice, speed: data.speed || 1 });
      } catch (e) {
        if (!data.standIn || data.standIn === voice) throw e;
        voice = data.standIn;
        audio = await tts.generate(data.text, { voice, speed: data.speed || 1 });
      }
      const wav = audio.toWav();
      postMessage({ id, ok: true, wav, voice }, [wav]);
    }
  } catch (e) {
    postMessage({ id, ok: false, error: (e && e.message) || String(e) });
  }
};
