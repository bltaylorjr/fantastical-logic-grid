// The puzzle doctor's rounds, run by the GitHub Action puzzle-reports.yml every
// 15 minutes (server/PUZZLE-REPORTS.md): asks the Worker for puzzles players
// reported (POST /admin/v1/puzzle-reports/claim), checks each with the game's
// engine and rebuilds it when it can (scripts/puzzle-doctor.mjs), and sends the
// results back (POST /admin/v1/puzzle-reports/done). The Worker then emails the
// players who asked, through the Thank-you emails Action.
// The repository is public, so this prints only counts.
// Needs FLG_CLOUD_URL and FLG_ADMIN_TOKEN; without them it says so and stops.
import { examine } from './puzzle-doctor.mjs';

const API = (process.env.FLG_CLOUD_URL || '').trim().replace(/\/+$/, '');
const TOKEN = (process.env.FLG_ADMIN_TOKEN || '').trim();

async function call(path, body) {
  const res = await fetch(`${API}/admin/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'flg-puzzle-doctor' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`The Worker answered ${res.status} for ${path}.`);
  return res.json();
}

if (!API || !TOKEN) {
  console.log('The puzzle doctor is not set up yet (needs FLG_CLOUD_URL and FLG_ADMIN_TOKEN). See server/PUZZLE-REPORTS.md.');
} else {
  let rounds = 0;
  const total = { examined: 0, repaired: 0, needsFix: 0, noFault: 0, emailed: 0 };
  // A few rounds of up to 5, so a busy day is cleared quickly.
  while (rounds++ < 6) {
    const { reports } = await call('puzzle-reports/claim', { limit: 5 });
    if (!reports.length) break;
    const results = reports.map((r) => {
      try { return { id: r.id, ...examine(r.puzzle) }; } catch (e) { return { id: r.id, findings: [{ code: 'unreadable', text: 'The puzzle was saved in a damaged form, so the game could not read all of its parts.' }], repaired: null }; }
    });
    const done = await call('puzzle-reports/done', { results });
    total.examined += reports.length;
    for (const k of ['repaired', 'needsFix', 'noFault', 'emailed']) total[k] += done[k] || 0;
  }
  console.log(total.examined
    ? `Examined ${total.examined}: ${total.repaired} repaired (${total.emailed} emails queued), ${total.needsFix} need a fix in the code, ${total.noFault} with no fault found.`
    : 'No reported puzzles waiting.');
}
