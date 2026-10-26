// Play in any language. US English is the default; a player can choose any
// of 100 languages in Settings. The game is written in English and the page
// is translated as it shows: every text and label (menus, stories, clues,
// hints, messages) is swapped for its translation, and swapped back for
// English. Texts the player types (notes, names) are never translated.
//
// Where translations come from, free:
//   1. the browser's own translator on the device (Chrome's built-in
//      Translator), when it has the language;
//   2. otherwise the game's server (POST /v1/translate), which uses Cloudflare
//      Workers AI's free allowance and keeps each translation for everyone.
// Each device also keeps the translations it has seen, so they work offline.
// Until a text's translation arrives it shows in English.
import { CLOUD_URL } from './cloud-config.js';
import * as store from './store.js';
import * as remote from './remote-config.js';

export const DEFAULT = 'en-US';

// The same list as the server's (server/src/translate.js).
const CODES = ['af', 'am', 'ar', 'ast', 'az', 'ba', 'be', 'bg', 'bn', 'br', 'bs', 'ca', 'ceb', 'cs', 'cy', 'da', 'de', 'el', 'es', 'et',
  'fa', 'ff', 'fi', 'fr', 'fy', 'ga', 'gd', 'gl', 'gu', 'ha', 'he', 'hi', 'hr', 'ht', 'hu', 'hy', 'id', 'ig', 'ilo', 'is', 'it', 'ja', 'jv', 'ka',
  'kk', 'km', 'kn', 'ko', 'lb', 'lg', 'ln', 'lo', 'lt', 'lv', 'mg', 'mk', 'ml', 'mn', 'mr', 'ms', 'my', 'ne', 'nl', 'no', 'ns', 'oc', 'or', 'pa',
  'pl', 'ps', 'pt', 'ro', 'ru', 'sd', 'si', 'sk', 'sl', 'so', 'sq', 'sr', 'ss', 'su', 'sv', 'sw', 'ta', 'th', 'tl', 'tn', 'tr', 'uk', 'ur', 'uz',
  'vi', 'wo', 'xh', 'yi', 'yo', 'zh', 'zu'];
const RTL = new Set(['ar', 'fa', 'he', 'ps', 'sd', 'ur', 'yi']);
// Standard (BCP 47) tags where the translation model's code differs.
const TAG = { ns: 'nso', tl: 'fil' };
export const tagOf = (code) => (code === DEFAULT ? 'en-US' : TAG[code] || code);

// [{ code, name (in its own language), english }], US English first.
export function languages() {
  const en = safeNames('en');
  const list = CODES.map((code) => ({ code, name: safeNames(tagOf(code)).of(tagOf(code)) || code, english: en.of(tagOf(code)) || code }));
  list.sort((a, b) => a.english.localeCompare(b.english, 'en'));
  return [{ code: DEFAULT, name: 'English (US)', english: 'English (US)' }, ...list];
}
function safeNames(locale) {
  try { return new Intl.DisplayNames([locale, 'en'], { type: 'language' }); } catch (e) { return { of: () => '' }; }
}
export const nameOf = (code) => (languages().find((l) => l.code === code) || {}).name || code;

let lang = DEFAULT;
let english = false; // "English" pressed: show the original for now
export const current = () => lang;
export const isEnglish = () => lang === DEFAULT || english;
export const showingEnglish = () => english;
export const known = (code) => code === DEFAULT || CODES.includes(code);

// ---- Translations kept on this device: English text -> translation
const KEEP = 6000;
let mem = new Map();
let saveTimer = null;
function keep(en, t) {
  mem.delete(en);
  mem.set(en, t);
  if (saveTimer) return;
  const forLang = lang;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (forLang !== lang) return;
    while (mem.size > KEEP) mem.delete(mem.keys().next().value);
    store.putMedia(`tr:${forLang}`, Object.fromEntries(mem)).catch(() => {});
  }, 1500);
}

// ---- Getting translations
let device = null; // the browser's translator, once ready
let waitingForTap = false;
async function deviceTranslator(tapped) {
  if (typeof self === 'undefined' || !('Translator' in self)) return null;
  const want = lang;
  try {
    const opts = { sourceLanguage: 'en', targetLanguage: tagOf(want) };
    const a = await self.Translator.availability(opts);
    if (a === 'unavailable' || want !== lang) return null;
    // Downloading a language needs a tap or key press first.
    if (a !== 'available' && !tapped) { waitForTap(); return null; }
    const t = await self.Translator.create(opts);
    return want === lang ? t : null;
  } catch (e) { return null; }
}
function waitForTap() {
  if (waitingForTap) return;
  waitingForTap = true;
  const go = async () => {
    removeEventListener('pointerdown', go, true);
    removeEventListener('keydown', go, true);
    waitingForTap = false;
    const t = await deviceTranslator(true);
    if (t) { device = t; missed.clear(); refresh(); }
  };
  addEventListener('pointerdown', go, true);
  addEventListener('keydown', go, true);
}

const queue = new Set();
const missed = new Set(); // couldn't be translated just now: try later
const asking = new Set(); // on their way
const waiters = new Map(); // English -> [resolve]
let flushTimer = null;
let restUntil = 0;
let running = 0;

function request(en) {
  if (mem.has(en) || missed.has(en) || asking.has(en)) return;
  queue.add(en);
  if (!flushTimer) flushTimer = setTimeout(flush, 60);
}

async function viaServer(list) {
  if (!CLOUD_URL || !remote.feature('translate') || Date.now() < restUntil) return {};
  const res = await fetch(`${CLOUD_URL}/v1/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: lang, texts: list }) });
  if (!res.ok) { restUntil = Date.now() + (res.status === 429 ? 60_000 : 600_000); return {}; }
  const body = await res.json();
  if (body.reason === 'used_up' || body.reason === 'switched_off' || body.reason === 'not_set_up') restUntil = Date.now() + 1800_000;
  return Object.fromEntries(list.map((en, i) => [en, body.texts && body.texts[i]]));
}

async function flush() {
  flushTimer = null;
  if (lang === DEFAULT || !queue.size) return;
  if (running >= 2) { flushTimer = setTimeout(flush, 200); return; }
  // Up to 40 texts and 10,000 letters a request, as the server allows.
  const list = [];
  let size = 0;
  for (const en of queue) {
    if (list.length >= 40 || size + en.length > 10_000) break;
    list.push(en); size += en.length;
  }
  list.forEach((en) => { queue.delete(en); asking.add(en); });
  if (queue.size) flushTimer = setTimeout(flush, 0);
  const forLang = lang;
  running++;
  let got = {};
  try {
    if (device) {
      for (const en of list) { try { got[en] = await device.translate(en); } catch (e) { /* the server can try */ } }
      const rest = list.filter((en) => !got[en]);
      if (rest.length) Object.assign(got, await viaServer(rest));
    } else got = await viaServer(list);
  } catch (e) { restUntil = Date.now() + 60_000; }
  running--;
  list.forEach((en) => asking.delete(en));
  if (forLang !== lang) return;
  for (const en of list) {
    const t = got[en];
    if (t) keep(en, t); else missed.add(en);
    for (const done of waiters.get(en) || []) done(t || en);
    waiters.delete(en);
  }
  refresh();
}
// Texts that could not be translated are tried again every few minutes.
setInterval(() => { if (missed.size && Date.now() >= restUntil) { missed.clear(); refresh(); } }, 300_000);

// One text, for speech, the screen reader and pictures: resolves with the
// translation, or the English text when there is none yet.
export function t(text) {
  const en = String(text || '').trim();
  if (isEnglish() || !worth(en)) return Promise.resolve(text);
  if (mem.has(en)) return Promise.resolve(mem.get(en));
  if (missed.has(en)) return Promise.resolve(text);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(text), 8000);
    waiters.set(en, [...(waiters.get(en) || []), (v) => { clearTimeout(timer); resolve(v || text); }]);
    request(en);
  });
}
export const tAll = (texts) => Promise.all(texts.map(t));

// ---- The page
const SKIP = 'script,style,noscript,textarea,code,pre,[translate=no],.notranslate,[contenteditable=""],[contenteditable=true]';
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'aria-roledescription'];
const origText = new WeakMap(); // text node -> its English
const shownText = new WeakMap(); // text node -> what this module put there
const origAttr = new WeakMap(); // element -> { attr: [English, shown] }
// Worth translating: at least two letters (X and O are marks, 12:30 a time).
const worth = (s) => (s.match(/\p{L}/gu) || []).length >= 2;

function textNode(node) {
  const el = node.parentElement;
  if (!el || el.closest(SKIP)) return;
  let en = origText.get(node);
  if (en === undefined || node.data !== shownText.get(node)) { en = node.data; origText.set(node, en); shownText.set(node, en); }
  const core = en.trim();
  if (!worth(core)) return;
  let want = en;
  if (!isEnglish()) {
    const tr = mem.get(core);
    if (tr == null) { request(core); return; }
    want = en.slice(0, en.length - en.trimStart().length) + tr + en.slice(en.trimEnd().length);
  }
  if (node.data !== want) { shownText.set(node, want); node.data = want; }
}

function attrs(el) {
  if (el.closest('[translate=no],.notranslate')) return;
  const list = ATTRS.filter((a) => el.hasAttribute(a));
  if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.hasAttribute('value')) list.push('value');
  if (!list.length) return;
  let rec = origAttr.get(el);
  if (!rec) { rec = {}; origAttr.set(el, rec); }
  for (const a of list) {
    const v = el.getAttribute(a);
    if (!rec[a] || v !== rec[a][1]) rec[a] = [v, v];
    const en = rec[a][0];
    const core = en.trim();
    if (!worth(core)) continue;
    let want = en;
    if (!isEnglish()) {
      const tr = mem.get(core);
      if (tr == null) { request(core); continue; }
      want = tr;
    }
    if (v !== want) { rec[a][1] = want; el.setAttribute(a, want); }
  }
}

function walk(root) {
  if (root.nodeType === 3) { textNode(root); return; }
  if (root.nodeType !== 1) return;
  if (root.matches && root.matches('[translate=no],.notranslate,script,style')) return;
  attrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 && n.matches('[translate=no],.notranslate,script,style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) textNode(n); else attrs(n);
  }
}

let refreshTimer = null;
function refresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; walk(document.documentElement); notify(); }, 30);
}

let observer = null;
function watch() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((records) => {
    if (lang === DEFAULT) return;
    for (const r of records) {
      if (r.type === 'characterData') textNode(r.target);
      else if (r.type === 'attributes') attrs(r.target);
      else r.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, 'value'] });
}

// Resolves once the texts inside root have their translations (or after ms),
// for printing.
export function settle(root, ms = 8000) {
  if (isEnglish()) return Promise.resolve();
  walk(root);
  const end = Date.now() + ms;
  return new Promise((resolve) => {
    const check = () => {
      const pending = queue.size + running;
      if (!pending || Date.now() > end) { walk(root); resolve(); } else setTimeout(check, 100);
    };
    setTimeout(check, 80);
  });
}

// ---- Listeners (the settings window, the English button)
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function notify() { for (const fn of listeners) { try { fn(); } catch (e) { /* ignore */ } } }

function pageLanguage() {
  const root = document.documentElement;
  const code = isEnglish() ? DEFAULT : lang;
  root.lang = tagOf(code);
  root.dir = !isEnglish() && RTL.has(lang) ? 'rtl' : 'ltr';
}

// Chooses the language; tapped says a tap or key press led here (the
// browser's translator can then download the language at once).
export async function setLanguage(code, { tapped = false } = {}) {
  if (!known(code)) code = DEFAULT;
  if (code === lang) { pageLanguage(); refresh(); return; }
  lang = code;
  english = false;
  device = null;
  queue.clear(); missed.clear(); asking.clear(); restUntil = 0;
  for (const [, list] of waiters) list.forEach((done) => done(null));
  waiters.clear();
  mem = new Map();
  pageLanguage();
  if (code !== DEFAULT) {
    // The kept translations first, so nothing already known is asked for again.
    try { const kept = await store.getMedia(`tr:${code}`); if (kept && code === lang) mem = new Map(Object.entries(kept)); } catch (e) { /* start empty */ }
    if (code !== lang) return;
    watch();
    deviceTranslator(tapped).then((d) => { if (d && code === lang) { device = d; refresh(); } });
  }
  walk(document.documentElement);
  notify();
}

// The English button: shows the original text for now without changing the setting.
export function showEnglish(on) {
  english = !!on;
  pageLanguage();
  walk(document.documentElement);
  notify();
}

// The language a device voice should speak, as a tag such as 'es'.
export const speechTag = () => (isEnglish() ? 'en-US' : tagOf(lang));
