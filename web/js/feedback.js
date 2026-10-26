// The "Ideas and problems" boxes: one form for storyline and other ideas, a
// separate one for reporting a problem. Both go to the game's Worker
// (server/src/feedback.js) and show up in the admin dashboard. Anonymous:
// only the text, the topic, the app version and the platform are sent. A
// signed-in player can also ask for a thank-you email; then the sign-in
// token goes along so the server can find the account's confirmed address
// (server/src/replies.js), which is never stored with the message.
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as account from './account.js';
import { feature } from './remote-config.js';
import { platform } from './errors.js';

const $ = (s, el = document) => el.querySelector(s);

const REPLY_WORDS = {
  queued: 'We\'ll email you a thank-you note soon.',
  unverified: 'To get a thank-you email, confirm your email address first (Account).',
  limit: 'You already got a thank-you email today, so we won\'t send another.',
};

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
    const box = $('.fb-reply', form);
    const reply = !box.hidden && $('[data-reply]', box).checked && !!account.current();
    let token = null;
    if (reply) { try { token = await account.getIdToken(); } catch (e) { /* sent without a note */ } }
    const res = await fetch(`${CLOUD_URL}/v1/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ kind, topic, text, platform: platform(), version: CLOUD.appVersion || 'dev', reply: !!token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'It could not be sent right now. Please try again later.');
    $('textarea', form).value = '';
    done.textContent = (kind === 'idea' ? 'Thank you! Your idea was sent.' : 'Thank you! Your report was sent.') + (REPLY_WORDS[data.reply] ? ` ${REPLY_WORDS[data.reply]}` : '');
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
  const me = account.current();
  for (const form of dlg.querySelectorAll('form')) {
    $('.error-box', form).hidden = true;
    $('.acct-done', form).textContent = '';
    $('.fb-reply', form).hidden = !me || !feature('feedbackReplies');
    $('.fb-reply-to', form).textContent = me?.email ? ` at ${me.email}` : '';
  }
  if (kind === 'idea') $('input[name=idea-topic][value=story]').checked = true;
  openDialog(dlg, kind === 'problem' ? $('#problem-topic') : $('#idea-text'));
}
