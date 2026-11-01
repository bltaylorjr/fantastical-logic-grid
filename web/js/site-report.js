// Report a Problem on the website's own pages (scripts/seo.mjs puts the button
// in every page footer). It opens the Report a Problem page (web/report/,
// report-page.js) in a new tab, the same page the game uses, with this page's
// address. There the player chooses a Puzzle Problem or a Web Page Issue, writes
// up to 1,000 characters and can attach pictures and files; the Worker gives it
// a tracking id in its category (PZ- or WS-, server/src/puzzle-reports.js).
// The website has no sign-in, so the page says how to get an email about it:
// report it from the game while signed in.
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import { openReportPage } from './report-handoff.js';

const button = document.querySelector('[data-report-problem]');
if (button && CLOUD_URL) {
  button.hidden = false;
  button.addEventListener('click', () => {
    // Puzzle pages (daily, printables, picks) start on Puzzle Problem.
    const onPuzzle = !!document.querySelector('.lgrid, [data-puzzle-page]');
    openReportPage(new URL('../report/?from=site', import.meta.url).href, {
      from: 'site', kind: onPuzzle ? 'puzzle' : 'page', page: location.pathname.slice(0, 200),
      platform: 'site', version: CLOUD.appVersion || 'site', screen: `${innerWidth}x${innerHeight}`,
    });
  });
}
