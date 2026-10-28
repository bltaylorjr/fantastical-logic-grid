// The "Ideas and problems" boxes: one form for ideas (a storyline, a new theme
// or topic, a game feature, or something else), a separate one for reporting
// a problem. Both go to the game's Worker
// (server/src/feedback.js) and show up in the admin dashboard. Anonymous:
// only the text, the topic, the app version and the platform are sent. A
// signed-in player can also tick "Email me an update": a thank-you email
// quoting what they wrote, and another with the team's note once it is
// addressed. Then the sign-in token goes along so the server can find the
// account's confirmed address (server/src/replies.js), which is never stored
// with the message. Ticking
// "Let the team reply to me" links this one message to the account, so the
// team can answer it in Menu > Messages (server/src/messages.js).
// "Suggest a storyline" also shows a "Which theme is it for?" list of the themes
// players can pick (admin-switched-off ones are left out); the chosen theme
// id goes along and shows in the admin inbox. Signed in, it also offers "make
// me a puzzle from it": once the team approves the storyline, a puzzle told
// with it lands in the player's saved puzzles and arrives as a PDF by email
// (server/src/story-gifts.js).
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as account from './account.js';
import { feature, disabledThemes } from './remote-config.js';
import { platform } from './errors.js';

const $ = (s, el = document) => el.querySelector(s);

const REPLY_WORDS = {
  queued: 'We\'ll email you a thank-you note soon.',
  unverified: 'To get email updates, confirm your email address first (Account).',
  limit: 'You already got a thank-you email today, so we won\'t send another.',
};
const UPDATE_WORDS = 'We\'ll email you again when the team acts on it.';
const GIFT_WORDS = {
  queued: 'If the team approves your storyline, your puzzle will appear in your saved puzzles and arrive by email.',
  unverified: 'To get a puzzle made from your storyline, confirm your email address first (Account).',
  limit: 'You asked for several storyline puzzles today already, so this one can\'t get its own puzzle.',
};
const TALK_WORDS = {
  linked: 'The team can reply to you in Menu > Messages.',
  limit: 'You have many messages waiting for the team already, so this one can\'t get a reply in Messages.',
};

export const available = () => !!CLOUD_URL && feature('feedback');

async function send(form) {
  const kind = form.dataset.kind;
  const text = $('textarea', form).value.trim();
  const topic = kind === 'idea' ? $('input[name=idea-topic]:checked', form).value : $('#problem-topic').value;
  const theme = kind === 'idea' && topic === 'story' ? $('#idea-theme').value || undefined : undefined;
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
    const talkBox = $('.fb-talk', form);
    const talk = !talkBox.hidden && $('[data-talk]', talkBox).checked && !!account.current();
    const giftBox = $('.fb-puzzle', form);
    const puzzle = !!giftBox && !giftBox.hidden && $('[data-puzzle]', giftBox).checked && topic === 'story' && !!account.current();
    let token = null;
    if (reply || talk || puzzle) { try { token = await account.getIdToken(); } catch (e) { /* sent without a note */ } }
    const res = await fetch(`${CLOUD_URL}/v1/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ kind, topic, text, platform: platform(), version: CLOUD.appVersion || 'dev', reply: !!token && reply, talk: !!token && talk, puzzle: !!token && puzzle, theme }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'It could not be sent right now. Please try again later.');
    $('textarea', form).value = '';
    done.textContent = (kind === 'idea' ? 'Thank you! Your idea was sent.' : 'Thank you! Your report was sent.') + (REPLY_WORDS[data.reply] ? ` ${REPLY_WORDS[data.reply]}` : '') + (data.update ? ` ${UPDATE_WORDS}` : '') + (TALK_WORDS[data.talk] ? ` ${TALK_WORDS[data.talk]}` : '') + (GIFT_WORDS[data.gift] ? ` ${GIFT_WORDS[data.gift]}` : '');
  } catch (e) {
    err.textContent = navigator.onLine === false ? 'You seem to be offline. Connect to the internet and try again.' : e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

// The theme list, and for signed-in players the "make me a puzzle" box, only
// show while "Suggest a storyline" is picked.
const showThemes = () => {
  const story = $('input[name=idea-topic]:checked').value === 'story';
  $('#idea-theme-field').hidden = !story;
  $('#idea-form .fb-puzzle').hidden = !story || !account.current();
  // Storyline and theme ideas can be longer than other messages (server/src/feedback.js IDEA_MAX).
  const long = story || $('input[name=idea-topic]:checked').value === 'theme';
  $('#idea-text').maxLength = long ? 2000 : 1000;
  $('#idea-count').textContent = `${$('#idea-text').value.length} of ${$('#idea-text').maxLength} characters`;
};

let wired = false;
// kind: 'idea' or 'problem' picks the box that gets focus. themes: the
// engine's theme list ({ id, name }), for the storyline idea's theme picker.
export function open(openDialog, { kind = 'idea', themes = [] } = {}) {
  const dlg = $('#dlg-feedback');
  if (!wired) {
    wired = true;
    for (const form of dlg.querySelectorAll('form')) form.addEventListener('submit', (e) => { e.preventDefault(); send(form); });
    $('#idea-form fieldset').addEventListener('change', showThemes);
    $('#idea-text').addEventListener('input', () => { $('#idea-count').textContent = `${$('#idea-text').value.length} of ${$('#idea-text').maxLength} characters`; });
    $('[data-close]', dlg).onclick = () => dlg.close();
  }
  const me = account.current();
  for (const form of dlg.querySelectorAll('form')) {
    $('.error-box', form).hidden = true;
    $('.acct-done', form).textContent = '';
    $('.fb-reply', form).hidden = !me || !feature('feedbackReplies');
    $('.fb-reply-to', form).textContent = me?.email ? ` at ${me.email}` : '';
    $('.fb-talk', form).hidden = !me || !feature('messages');
  }
  $('#idea-form .fb-puzzle-to').textContent = me?.email ? ` (to ${me.email})` : '';
  const off = disabledThemes();
  const pick = $('#idea-theme');
  const was = pick.value;
  pick.innerHTML = '<option value="">Any theme / not sure</option>' + themes.filter((t) => !off.has(t.id))
    .map((t) => `<option value="${t.id}">${t.name.replace(/[<>&"]/g, '')}</option>`).join('');
  pick.value = [...pick.options].some((o) => o.value === was) ? was : '';
  if (kind === 'idea') $('input[name=idea-topic][value=story]').checked = true;
  showThemes();
  openDialog(dlg, kind === 'problem' ? $('#problem-topic') : $('#idea-text'));
}
