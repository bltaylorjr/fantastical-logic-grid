// Report a Problem on the website's own pages (scripts/seo.mjs puts the button
// in every page footer). The same two kinds as in the game (puzzle-report.js):
// a Puzzle Problem with a puzzle shown on this page, or a Web Page Issue. The
// report carries the page's address, the window size and up to 1,000
// characters; the Worker gives it a tracking id in its category (PZ- or WS-,
// server/src/puzzle-reports.js). The website has no sign-in, so the box says
// how to get an email about it: report it from the game while signed in.
import { CLOUD, CLOUD_URL } from './cloud-config.js';

const MAX = 1000;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function build() {
  const dlg = document.createElement('dialog');
  dlg.id = 'site-report';
  dlg.className = 'report-dlg';
  dlg.setAttribute('aria-labelledby', 'site-report-h');
  dlg.innerHTML = `<h2 id="site-report-h">Report a Problem</h2>
  <form novalidate>
    <fieldset class="report-kind"><legend>What is the problem with?</legend>
      <label><input type="radio" name="site-report-kind" value="puzzle"> Puzzle Problem</label>
      <label><input type="radio" name="site-report-kind" value="page" checked> Web Page Issue</label>
    </fieldset>
    <p class="help">We send this page's address and your window size with your words, nothing personal. To get an email when it is fixed, report it from the game while signed in.</p>
    <label for="site-report-text">What went wrong?</label>
    <textarea id="site-report-text" rows="5" maxlength="${MAX}" aria-describedby="site-report-count"></textarea>
    <p class="help" id="site-report-count" aria-live="polite">0 of 1,000 characters</p>
    <p class="error" role="alert" hidden></p>
    <p class="done" role="status"></p>
    <div class="report-actions"><button class="btn" type="submit">Submit</button> <button class="btn quiet" type="button" data-close>Cancel</button></div>
  </form>`;
  document.body.append(dlg);
  const text = dlg.querySelector('textarea');
  const count = () => { dlg.querySelector('#site-report-count').textContent = `${text.value.length.toLocaleString()} of ${MAX.toLocaleString()} characters`; };
  text.addEventListener('input', count);
  // Cancel: close without sending, and drop what was typed.
  dlg.querySelector('[data-close]').addEventListener('click', () => { text.value = ''; count(); dlg.close(); });
  dlg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = dlg.querySelector('.error');
    const done = dlg.querySelector('.done');
    err.hidden = true;
    done.textContent = '';
    const words = text.value.trim();
    if (words.length < 5) { err.textContent = 'Tell us a little about the problem first.'; err.hidden = false; text.focus(); return; }
    const btn = dlg.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const kind = dlg.querySelector('input[name=site-report-kind]:checked').value;
      const res = await fetch(`${CLOUD_URL}/v1/puzzle-report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, text: words.slice(0, MAX), page: location.pathname.slice(0, 200), screen: `${innerWidth}x${innerHeight}`, platform: 'site', version: CLOUD.appVersion || 'site' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The report could not be sent right now. Please try again later.');
      text.value = '';
      count();
      done.textContent = `Thank you! Your report number is ${data.tracking}. The team will look into it.`;
    } catch (ex) {
      err.textContent = navigator.onLine === false ? 'You seem to be offline. Connect to the internet and try again.' : ex.message;
      err.hidden = false;
    } finally { btn.disabled = false; }
  });
  return dlg;
}

const button = document.querySelector('[data-report-problem]');
if (button && CLOUD_URL) {
  button.hidden = false;
  let dlg = null;
  button.addEventListener('click', () => {
    dlg ||= build();
    // Puzzle pages (daily, printables, picks) start on Puzzle Problem.
    const onPuzzle = !!document.querySelector('.lgrid, [data-puzzle-page]');
    dlg.querySelector(`input[value=${onPuzzle ? 'puzzle' : 'page'}]`).checked = true;
    dlg.querySelector('.done').textContent = '';
    dlg.showModal();
    dlg.querySelector('textarea').focus();
  });
}
