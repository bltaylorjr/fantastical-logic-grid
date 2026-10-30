// Report a Problem: the button in the footer under every screen of the game
// (and every page of the website, scripts/site-report.js). Two kinds:
//   Puzzle Problem   the report carries the open (or last played) puzzle and
//                    its picture, so the puzzle doctor can check and repair it
//   Web Page Issue   the report carries which screen it happened on, the app
//                    version and the window size, nothing personal
// Up to 1,000 characters of the player's own words go with either, and
// the game's Worker answers with a tracking id (PZ-XXXXXXXX) that names this
// report in the team's dashboard (server/src/puzzle-reports.js). A signed-in
// player with a confirmed email can ask to be emailed when it is fixed: the
// email apologizes, explains in plain words what was wrong and what was done,
// and links back here with ?repaired=<token>, which puts the repaired puzzle in
// Saved puzzles (openRepaired below).
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import * as account from './account.js';
import { feature } from './remote-config.js';
import { platform } from './platform.js';

const $ = (s, el = document) => el.querySelector(s);
const MAX = 1000;
const REPLY_WORDS = {
  queued: 'We emailed you a copy of your report, and will email you again when it is fixed.',
  limit: 'We will email you when it is fixed.',
  unverified: 'To get an email when it is fixed, confirm your email address first (Account).',
};

export const available = () => !!CLOUD_URL && feature('feedback');

let current = null; // { puzzle, image, where } for this report
let deps = { openDialog: () => {}, openAccount: () => {}, announce: () => {} };

function count() {
  const n = $('#report-text').value.length;
  $('#report-count').textContent = `${n.toLocaleString()} of ${MAX.toLocaleString()} characters`;
}

async function send(form) {
  const text = $('#report-text').value.trim();
  const err = $('.error-box', form);
  const done = $('#report-done');
  err.hidden = true;
  done.textContent = '';
  if (text.length < 5) { err.textContent = 'Tell us a little about the problem first.'; err.hidden = false; $('#report-text').focus(); return; }
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  try {
    const wants = !$('#report-reply-box').hidden && $('#report-reply').checked && !!account.current();
    let token = null;
    if (wants) { try { token = await account.getIdToken(); } catch (e) { /* sent without the email */ } }
    const kind = kindNow();
    const res = await fetch(`${CLOUD_URL}/v1/puzzle-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        kind, text: text.slice(0, MAX), reply: !!token, platform: platform(), version: CLOUD.appVersion || 'dev',
        where: current.where, screen: `${innerWidth}x${innerHeight}`,
        ...(kind === 'puzzle' && current.puzzle ? { puzzle: current.puzzle, image: current.image || undefined } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'The report could not be sent right now. Please try again later.');
    $('#report-text').value = '';
    count();
    done.textContent = `Thank you! Your report number is ${data.tracking}. ${kind === 'puzzle' && current.puzzle ? 'We check reported puzzles automatically and fix them as soon as we can.' : 'The team will look into it.'}${REPLY_WORDS[data.reply] ? ` ${REPLY_WORDS[data.reply]}` : ''}`;
    deps.announce(`Report sent. Your report number is ${data.tracking}.`);
  } catch (e) {
    err.textContent = navigator.onLine === false ? 'You seem to be offline. Connect to the internet and try again.' : e.message;
    err.hidden = false;
  } finally { btn.disabled = false; }
}

const kindNow = () => $('input[name=report-kind]:checked').value;
function about() {
  const p = current.puzzle;
  $('#report-about').textContent = kindNow() === 'page'
    ? 'Tell us what looked wrong or did not work on this page. We also send which screen you were on, the app version and the window size, nothing personal.'
    : p ? `About the puzzle “${p.title}”. The puzzle and its picture are sent with your report, so we can check it and fix it.`
      : 'Open the puzzle first and report it from there, so it is sent with your report. Or tell us which puzzle it was.';
}

let wired = false;
// ctx: { puzzle, image, where }. puzzle is the open or last played puzzle (or
// null); image the picture drawn for it (SVG text); where the screen's name.
export function open(ctx = {}) {
  if (!available()) return;
  current = { puzzle: ctx.puzzle || null, image: ctx.image || '', where: String(ctx.where || '').slice(0, 200) };
  const dlg = $('#dlg-report');
  if (!wired) {
    wired = true;
    $('#report-form').addEventListener('submit', (e) => { e.preventDefault(); send(e.currentTarget); });
    $('.report-kind').addEventListener('change', about);
    $('#report-text').addEventListener('input', count);
    // Cancel: close without sending, and drop what was typed.
    $('[data-close]', dlg).onclick = () => { $('#report-text').value = ''; count(); dlg.close(); };
    $('#report-signin-btn').onclick = () => { dlg.close(); deps.openAccount(); };
  }
  const me = account.current();
  const emails = feature('feedbackReplies');
  $('#report-reply-box').hidden = !me || !emails;
  $('#report-reply-to').textContent = me?.email ? ` at ${me.email}` : '';
  $('#report-signin').hidden = !!me || !emails || !account.enabled();
  $('.error-box', dlg).hidden = true;
  $('#report-done').textContent = '';
  $(`input[name=report-kind][value=${ctx.kind === 'page' || !current.puzzle ? 'page' : 'puzzle'}]`).checked = true;
  about();
  count();
  deps.openDialog(dlg, $('#report-text'));
}

// The link in the "we fixed the puzzle you reported" email: fetches the
// repaired puzzle and hands it to the game to keep in Saved puzzles. The token
// is taken out of the address bar straight away.
export async function openRepaired(addRepaired) {
  let token;
  try {
    const url = new URL(location.href);
    token = url.searchParams.get('repaired');
    if (!token) return;
    url.searchParams.delete('repaired');
    history.replaceState(history.state, '', url.pathname + (url.search || '') + url.hash);
  } catch (e) { return; }
  if (!CLOUD_URL || !/^[A-Za-z0-9_-]{32}$/.test(token)) return;
  try {
    const res = await fetch(`${CLOUD_URL}/v1/repaired/${token}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.puzzle) throw new Error(data.message || 'The repaired puzzle could not be fetched. Please try the link again later.');
    await addRepaired(data.puzzle, data.tracking);
  } catch (e) {
    deps.announce(e.message);
    addRepaired(null, null, e.message);
  }
}

export function init(options) { deps = { ...deps, ...options }; }
