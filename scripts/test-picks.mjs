// The Hand-picked collection (scripts/seo.mjs): days an admin picked come
// first, then the best-rated daily puzzles from the Worker, never today's.
// Builds the website pages again into a copy of dist/site against a pretend
// Worker. Run after `npm run build`.
import { readFileSync, mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeo } from './seo.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };
const built = join(root, 'dist', 'site');
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
// A few days on, so there are past daily puzzles to pick from.
const today = addDays(JSON.parse(readFileSync(join(built, 'daily', 'latest.json'), 'utf8')).date, 4);

let quality = null; // the pretend Worker has no numbers until the second build
const server = createServer((req, res) => {
  if (req.url === '/v1/quality' && quality) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(quality)); return; }
  res.writeHead(404); res.end('{}');
}).listen(0);
await new Promise((r) => server.once('listening', r));
process.env.FLG_CLOUD_URL = `http://localhost:${server.address().port}`;
process.env.FLG_SITE_URL = process.env.FLG_CLOUD_URL;
process.env.FLG_TODAY = today;

const site = mkdtempSync(join(tmpdir(), 'flg-picks-'));
try {
  cpSync(built, site, { recursive: true });
  await buildSeo({ root, site });
  assert(JSON.parse(readFileSync(join(site, 'daily', 'picks.json'), 'utf8')).picks.length === 0, 'no picks before any ratings');
  const past = readdirSync(join(site, 'daily', 'puzzles')).map((f) => f.slice(0, 10)).filter((d) => d < today).sort();
  const [handDay, ratedDay] = past;
  const story = (d) => JSON.parse(readFileSync(join(site, 'daily', 'puzzles', `${d}.json`), 'utf8')).puzzle.story.id;
  quality = {
    rating: { average: 4.6, rated: 52, days: 90 },
    daily: [{ story: story(today), average: 5, rated: 9 }, { story: story(ratedDay), average: 4.8, rated: 6 }, { story: story(handDay), average: 4.5, rated: 4 }, { story: 'gone', average: 4.9, rated: 5 }],
    handPicked: [handDay, '2001-01-01'],
  };
  await buildSeo({ root, site });
  const picks = JSON.parse(readFileSync(join(site, 'daily', 'picks.json'), 'utf8')).picks;
  assert(picks.length === 2, `two picks (${picks.map((x) => x.date).join(', ')})`);
  assert(picks[0].date === handDay && picks[0].hand, 'the hand-picked day comes first');
  assert(picks[1].date === ratedDay && picks[1].average === 4.8 && picks[1].rated === 6, 'then the best-rated past daily puzzle');
  assert(!picks.some((x) => x.date === today), "today's puzzle is never a pick");
  for (const x of picks) assert(JSON.parse(readFileSync(join(site, 'daily', 'puzzles', `${x.date}.json`), 'utf8')).puzzle.title === x.title, `${x.date} can be opened in the game`);
  const page = readFileSync(join(site, 'picks', 'index.html'), 'utf8');
  assert(page.includes(`?play=daily&amp;day=${handDay}`) && page.includes('Picked by the team') && page.includes('Rated 4.8 out of 5 by 6 players'), 'the Hand-picked page lists them with a play link');
  assert(page.includes('How every puzzle is checked') && page.includes('<strong>4.6 out of 5</strong>'), 'with how puzzles are checked and the average rating');
  const footer = readFileSync(join(site, 'daily', 'index.html'), 'utf8');
  assert(footer.includes('Every puzzle has exactly one answer, checked by our solver, and players rate them 4.6 out of 5 stars'), 'every page says so at the foot');
  assert(readFileSync(join(site, 'sitemap.xml'), 'utf8').includes('/picks/'), 'the page is in the sitemap');
} finally {
  server.close();
  rmSync(site, { recursive: true, force: true });
}
