// Report a Problem: the button in the footer under every screen of the game
// (and every page of the website, site-report.js). It opens the Report a
// Problem page (web/report/, report-page.js): in a new tab on the website, so
// the puzzle stays open behind it, and in the same window in the apps. There
// the player picks one of two kinds and can attach pictures and files:
//   Puzzle Problem   the report carries the open (or last played) puzzle and
//                    its picture, so the puzzle doctor can check and repair it
//                    the moment it arrives
//   Web Page Issue   the report carries which screen it happened on, the app
//                    version and the window size, nothing personal
// The game's Worker answers with a tracking id (PZ-XXXXXXXX or WS-XXXXXXXX)
// that names the report in the team's dashboard (server/src/puzzle-reports.js).
// A signed-in player with a confirmed email can ask to be emailed when it is
// fixed: the email apologizes, explains in plain words what was wrong and what
// was done, and links back here with ?repaired=<token>, which puts the repaired
// puzzle in Saved puzzles (openRepaired below).
import { CLOUD, CLOUD_URL } from './cloud-config.js';
import { feature } from './remote-config.js';
import { platform } from './platform.js';
import { openReportPage } from './report-handoff.js';

let deps = { announce: () => {} };

export const available = () => !!CLOUD_URL && feature('feedback');

// ctx: { puzzle, image, where }. puzzle is the open or last played puzzle (or
// null); image the picture drawn for it (SVG text); where the screen's name.
export function open(ctx = {}) {
  if (!available()) return;
  const puzzle = ctx.puzzle || null;
  const p = platform();
  openReportPage('report/?from=game', {
    from: 'game', kind: ctx.kind === 'page' || !puzzle ? 'page' : 'puzzle', puzzle, image: ctx.image || '',
    where: String(ctx.where || '').slice(0, 200), platform: p, version: CLOUD.appVersion || 'dev', screen: `${innerWidth}x${innerHeight}`,
  }, { inTab: p === 'web' });
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
