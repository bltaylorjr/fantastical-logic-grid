// Live preview for the admin dashboard's Website page. The dashboard shows a
// page of this site in a frame with ?design-preview and sends it the draft
// design; this applies it at once (colors, fonts, shapes, effects, words)
// without saving anything. Elsewhere it does nothing.
//
// Safety: only messages from the dashboard's own address (the game's Worker)
// are read, and while previewing the page takes no clicks, key presses or form
// sends, so a framed copy cannot be used to trick anyone into doing something.
import { CLOUD } from './cloud-config.js';
import { css, attributes, texts } from './site-design.js';

const framed = window.top !== window.self;
const asked = new URLSearchParams(location.search).has('design-preview');
let admin = '';
try { admin = new URL(CLOUD.learnUrl || CLOUD.syncUrl).origin; } catch (e) { /* no Worker address: no preview */ }
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

if (framed && asked && (admin || local)) {
  const trusted = (origin) => origin === admin || (local && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  for (const type of ['click', 'submit', 'auxclick', 'keydown']) addEventListener(type, stop, true);
  document.documentElement.classList.add('design-preview');

  const apply = (design, look) => {
    let style = document.getElementById('site-design');
    if (!style) { style = document.createElement('style'); style.id = 'site-design'; document.head.append(style); }
    style.textContent = css(design);
    for (const [k, v] of Object.entries(attributes(design))) document.documentElement.setAttribute(k, v);
    const words = texts(design);
    for (const el of document.querySelectorAll('[data-design-text]')) {
      const key = el.getAttribute('data-design-text');
      if (key in words && el.textContent !== words[key]) el.textContent = words[key];
    }
    if (look === 'light' || look === 'dark') document.documentElement.setAttribute('data-theme', look);
    // Replay the opening animation so a changed choice shows straight away.
    for (const el of document.querySelectorAll('.hero, .card, .games')) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
  };

  addEventListener('message', (e) => {
    if (!trusted(e.origin) || !e.data || e.data.type !== 'flg-design') return;
    apply(e.data.design || {}, e.data.look);
  });
  const hello = () => { try { parent.postMessage({ type: 'flg-design-ready', page: location.pathname }, local ? '*' : admin); } catch (e) { /* none */ } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hello); else hello();
}
