// Native bridge for the Android and iOS apps. The app shell loads this before
// the game's own scripts, so the web code stays the same everywhere. It fills
// the gaps a phone WebView leaves: printing, saving files, keeping the screen
// on, the device voice (Android), the back button (Android), the colour of
// the system bars and the fingerprint or face check for signing in (Android,
// used by web/js/biometric.js).
(() => {
  const android = window.FLGAndroid;
  const ios = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.flg;
  if (!android && !ios) return;
  const platform = android ? 'android' : 'ios';
  const send = (type, data = {}) => {
    if (android) android.post(type, JSON.stringify(data));
    else ios.postMessage(Object.assign({ type }, data));
  };
  window.FLGNative = { platform };

  // Fingerprint or face check (Android's BiometricPrompt). The WebView has no
  // WebAuthn, so biometric.js asks here instead.
  if (android) {
    const waiting = new Map();
    let n = 0;
    window.__flgBiometric = (id, result) => { const done = waiting.get(id); if (done) { waiting.delete(id); done(result); } };
    const ask = (type, data = {}) => new Promise((resolve) => { const id = `b${++n}`; waiting.set(id, resolve); send(type, Object.assign({ id }, data)); });
    window.FLGNative.biometric = {
      available: () => ask('biometricCheck').then((r) => r === 'ok'),
      verify: ({ title, subtitle } = {}) => ask('biometric', { title, subtitle }).then((r) => r === 'ok'),
    };
  }
  document.documentElement.dataset.native = platform;

  // Printing: the WebView has no print dialog of its own, so hand the page to
  // the system print service (Save as PDF works there too).
  window.print = () => send('print', { title: document.title });

  // Saving files: <a download href="blob:..."> does nothing in a WebView, so
  // read the blob and let the system "Save to" picker write it.
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const href = this.href || '';
    if (this.hasAttribute('download') && /^(blob|data):/.test(href)) {
      const name = this.getAttribute('download') || 'download';
      fetch(href).then((r) => r.blob()).then((blob) => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve({ blob, data: String(fr.result).split(',')[1] || '' });
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      })).then(({ blob, data }) => send('save', { name, mime: blob.type || 'application/octet-stream', data }))
        .catch((e) => console.error('Save failed', e));
      return;
    }
    return click.call(this);
  };

  // Screen Wake Lock: keep the screen on through the app instead.
  const held = new Set();
  const update = () => send('keepAwake', { on: held.size > 0 });
  const wakeLock = {
    request(type = 'screen') {
      if (type !== 'screen') return Promise.reject(new TypeError('Only screen wake locks are supported'));
      if (document.visibilityState !== 'visible') return Promise.reject(new DOMException('The page is not visible', 'NotAllowedError'));
      const s = new EventTarget();
      s.type = 'screen';
      s.released = false;
      s.onrelease = null;
      s.release = () => {
        if (!s.released) {
          s.released = true;
          held.delete(s);
          update();
          const ev = new Event('release');
          s.dispatchEvent(ev);
          if (typeof s.onrelease === 'function') s.onrelease(ev);
        }
        return Promise.resolve();
      };
      held.add(s);
      update();
      return Promise.resolve(s);
    },
  };
  try { Object.defineProperty(navigator, 'wakeLock', { value: wakeLock, configurable: true }); } catch (e) { /* keep the WebView's own */ }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') for (const s of [...held]) s.release();
  });

  // Device voice: Android's WebView has no speechSynthesis, so speak through
  // Android text-to-speech with the same API the game already uses.
  if (android && !window.speechSynthesis) {
    const waiting = new Map();
    let voices = [];
    let next = 0;
    const fire = (u, type) => {
      const ev = new Event(type);
      ev.utterance = u;
      u.dispatchEvent(ev);
      if (typeof u['on' + type] === 'function') u['on' + type](ev);
    };
    class Utterance extends EventTarget {
      constructor(text = '') {
        super();
        Object.assign(this, { text, lang: '', voice: null, rate: 1, pitch: 1, volume: 1, onstart: null, onend: null, onerror: null });
      }
    }
    const synth = new EventTarget();
    Object.assign(synth, {
      speaking: false, pending: false, paused: false, onvoiceschanged: null,
      getVoices: () => voices.slice(),
      speak(u) {
        const id = String(++next);
        waiting.set(id, u);
        synth.pending = true;
        send('speak', { id, text: String(u.text || ''), lang: u.lang || (u.voice && u.voice.lang) || '', voice: (u.voice && u.voice.voiceURI) || '', rate: +u.rate || 1, pitch: +u.pitch || 1 });
      },
      cancel() {
        send('stopSpeaking');
        const all = [...waiting.values()];
        waiting.clear();
        synth.speaking = synth.pending = false;
        for (const u of all) fire(u, 'end');
      },
      pause() {}, resume() {},
    });
    window.__flgSpeech = (id, type) => {
      const u = waiting.get(id);
      if (!u) return;
      if (type === 'start') synth.speaking = true;
      if (type === 'end' || type === 'error') {
        waiting.delete(id);
        synth.speaking = waiting.size > 0;
        synth.pending = waiting.size > 0;
      }
      fire(u, type);
    };
    window.__flgVoices = (list) => {
      voices = list.map((v) => ({ name: v.name, lang: v.lang, voiceURI: v.name, localService: !v.network, default: !!v.default }));
      const ev = new Event('voiceschanged');
      synth.dispatchEvent(ev);
      if (typeof synth.onvoiceschanged === 'function') synth.onvoiceschanged(ev);
    };
    window.speechSynthesis = synth;
    window.SpeechSynthesisUtterance = Utterance;
    send('voices');
  }

  // Back button (Android): close the top dialog the way Escape does, then step
  // back from a puzzle or lesson towards home. Returns false on the home screen
  // with nothing open, and the app then goes to the background.
  window.__flgBack = () => {
    const open = [...document.querySelectorAll('dialog[open]')];
    const top = open[open.length - 1];
    if (top) {
      if (top.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close();
      return true;
    }
    // An open menu or popup; a section the player opened on purpose (data-disclosure) stays.
    const expanded = document.querySelector('[aria-expanded="true"]:not([data-disclosure])');
    if (expanded) {
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return true;
    }
    // A puzzle, a lesson or NINETIMESNINE steps back towards home (app.js).
    if (window.__flgScreenBack && window.__flgScreenBack()) return true;
    return false;
  };

  // System bars follow the game's own theme (light, dark or high contrast).
  let last = '';
  const syncBars = () => {
    const el = document.querySelector('header') || document.body;
    if (!el) return;
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/\d+(\.\d+)?/g);
    if (!m || (m.length > 3 && +m[3] === 0)) return;
    const [r, g, b] = m.map(Number);
    const color = '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
    const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
    if (color + dark === last) return;
    last = color + dark;
    send('bars', { color, dark });
  };
  const watch = () => {
    syncBars();
    const mo = new MutationObserver(() => { requestAnimationFrame(syncBars); setTimeout(syncBars, 350); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncBars);
    setTimeout(syncBars, 500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
