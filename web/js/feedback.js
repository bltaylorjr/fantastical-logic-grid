// The "Ideas and problems" boxes: one form for ideas (a storyline, a new theme
// or topic, a game feature, or something else), a separate one for reporting
// a problem. Both go to the game's Worker
// (server/src/feedback.js) and show up in the admin dashboard. Anonymous:
// only the text, the topic, the app version and the platform are sent.
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import { feature } from './remote-config.js';
import { platform } from './errors.js';

const $ = (s, el = document) => el.querySelector(s);

export const available = () => !!CLOUD_URL && feature('feedback');

async function send(form) {
  const kind = form.dataset.kind;
  const text = $('textarea', form).value.trim();
  const topic = kind === 'idea' ? $('input[name=idea-topic]:checked', form).value : $('#problem-topic').value;
  const err = $('.error-box', form);
  const done = $('.acct-done', form);
  const btn = $('button[type=submit]', form);
  err.hidden = true;
  done.textContent = '';
  if (text.length < 5) { err.textContent = 'Write a little more first.'; err.hidden = false; $('textarea', form).focus(); return; }
  btn.disabled = true;
  try {
    const res = await fetch(`${CLOUD_URL}/v1/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, topic, text, platform: platform(), version: CLOUD.appVersion || 'dev' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'It could not be sent right now. Please try again later.');
    $('textarea', form).value = '';
    done.textContent = kind === 'idea' ? 'Thank you! Your idea was sent.' : 'Thank you! Your report was sent.';
  } catch (e) {
    err.textContent = navigator.onLine === false ? 'You seem to be offline. Connect to the internet and try again.' : e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

let wired = false;
// kind: 'idea' or 'problem' picks the box that gets focus.
export function open(openDialog, { kind = 'idea' } = {}) {
  const dlg = $('#dlg-feedback');
  if (!wired) {
    wired = true;
    for (const form of dlg.querySelectorAll('form')) form.addEventListener('submit', (e) => { e.preventDefault(); send(form); });
    $('[data-close]', dlg).onclick = () => dlg.close();
  }
  for (const form of dlg.querySelectorAll('form')) { $('.error-box', form).hidden = true; $('.acct-done', form).textContent = ''; }
  if (kind === 'idea') $('input[name=idea-topic][value=story]').checked = true;
  openDialog(dlg, kind === 'problem' ? $('#problem-topic') : $('#idea-text'));
}
