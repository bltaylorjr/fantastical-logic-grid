// Builds the launch plan report (docs/reports/2026-10-26-launch-plan.pdf).
// The ads, media and tracked links come straight from the admin Marketing
// starter campaign (server/src/marketing-seed.js), so the PDF matches the
// dashboard word for word.
//   node docs/reports/launch-plan/build.mjs
// Needs Playwright (preinstalled in CI images; free).
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SEEDS } from '../../../server/src/marketing-seed.js';
import { trackedLink, DEFAULT_LANDING } from '../../../server/src/marketing.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const OUT = resolve(root, 'docs/reports/2026-10-26-launch-plan.pdf');
const seed = SEEDS[0];
const SITE = 'https://thelogicgrid.com';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const img = (p) => `file://${resolve(root, p.replace(/^\/admin\//, 'admin/'))}`;

// Posting schedule: one date per starter ad, keyed by channel/content.
const PLAN = {
  'email/friends-family': ['2026-11-02', 1, 'Warm audience first: fastest feedback, catches problems before strangers arrive.'],
  'linkedin/maker-post': ['2026-11-03', 1, 'Personal network; maker story.'],
  'bluesky/launch': ['2026-11-03', 1, ''],
  'mastodon/launch': ['2026-11-04', 1, 'Accessibility features suit this audience.'],
  'facebook/page-video': ['2026-11-04', 1, 'Pin to the top of the Page.'],
  'instagram/reel-launch': ['2026-11-05', 1, 'Link in bio for launch week.'],
  'threads/launch': ['2026-11-05', 1, ''],
  'x/launch-video': ['2026-11-06', 1, ''],
  'alternativeto/listing': ['2026-11-06', 1, 'Evergreen search traffic.'],
  'itch/game-page': ['2026-11-07', 1, 'Evergreen; portal build if ready.'],
  'youtube/promo-90s': ['2026-11-09', 2, 'Evergreen search on YouTube and Google.'],
  'youtube/shorts-30s': ['2026-11-10', 2, ''],
  'tiktok/launch-30s': ['2026-11-10', 2, ''],
  'reddit/webgames-launch': ['2026-11-11', 2, 'After a week of commenting from the account.'],
  'instagram/post-square': ['2026-11-12', 2, ''],
  'reddit/sideproject-story': ['2026-11-14', 2, ''],
  'producthunt/launch': ['2026-11-17', 3, '12:01 am Pacific, Tuesday.'],
  'hackernews/show-hn': ['2026-11-18', 3, 'Weekday morning, US Eastern.'],
  'pinterest/printable-pin': ['2026-11-19', 3, 'Then one new pin every week.'],
  'reddit/playmygame': ['2026-11-21', 3, ''],
  'facebook/groups-printable': ['2026-11-23', 4, 'One group a day through Thanksgiving week.'],
  'reddit/logicpuzzles-daily': ['2026-11-24', 4, 'Holiday downtime: people look for puzzles.'],
  'microsoftstore/pwa-listing': ['2026-11-30', 5, 'Once the free developer account is approved.'],
  'indiehackers/launch-post': ['2026-12-07', 6, 'Share the first month of real numbers.'],
};
const ads = seed.ads.map((a) => {
  const [date, week, why] = PLAN[`${a.channel}/${a.content}`] || ['', 0, ''];
  const ad = { ...a, landing: a.landing || DEFAULT_LANDING };
  const link = trackedLink(SITE, ad, seed.campaign.code);
  return { ...ad, date, week, why, link, words: a.body.replaceAll('{link}', link) };
}).sort((x, y) => x.date.localeCompare(y.date));
if (ads.some((a) => !a.date)) throw new Error('an ad has no date in PLAN');
const day = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

const CHANNEL_NAMES = { reddit: 'Reddit', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', bluesky: 'Bluesky', threads: 'Threads', mastodon: 'Mastodon', pinterest: 'Pinterest', linkedin: 'LinkedIn', hackernews: 'Hacker News', producthunt: 'Product Hunt', itch: 'itch.io', indiehackers: 'Indie Hackers', alternativeto: 'AlternativeTo', microsoftstore: 'Microsoft Store', email: 'Email' };
const cname = (c) => CHANNEL_NAMES[c] || c;

// Channel analysis. Scores are planning judgements (1 = low, 5 = high), not
// measurements; the dashboard replaces them with real numbers from week 1.
const CHANNELS = [
  ['reddit', 'Puzzle fans, web gamers, makers', 5, 4, 3, 4, 'Self-promotion rules; posts removed if the account is new or only posts links.'],
  ['producthunt', 'Early adopters, tech-curious', 4, 3, 3, 2, 'One-day spike; ranking depends on launch-day support.'],
  ['hackernews', 'Developers; like the generator story', 4, 3, 2, 2, 'Unpredictable: most Show HN posts get little attention; a front-page day can bring thousands.'],
  ['pinterest', 'Teachers, parents, printable seekers', 4, 5, 3, 5, 'Slow to start; pins keep bringing visits for months.'],
  ['facebook', 'Casual puzzlers 35+, homeschool groups', 4, 4, 3, 3, 'Group rules; organic Page reach is low without paid boosts (not planned).'],
  ['youtube', 'Searchers for puzzle games; Shorts viewers', 3, 4, 2, 5, 'Needs steady uploads to grow; the promo is evergreen.'],
  ['tiktok', 'Younger casual players', 3, 2, 3, 2, 'Link in bio limits; needs repeated short videos.'],
  ['instagram', 'Casual and lifestyle puzzlers', 3, 3, 3, 2, 'No clickable links in captions.'],
  ['email', 'Friends and family', 2, 5, 5, 1, 'Small numbers, but the best early feedback.'],
  ['itch', 'Indie game players', 3, 3, 3, 4, 'Crowded; good tags and screenshots matter.'],
  ['alternativeto', 'People searching for Puzzle Baron alternatives', 2, 5, 4, 5, 'Takes weeks to be approved and ranked.'],
  ['microsoftstore', 'Windows users browsing the Store', 3, 4, 3, 5, 'Certification can take a few days; identity check.'],
  ['bluesky', 'Early adopters, creators', 2, 3, 4, 2, ''],
  ['mastodon', 'Accessibility-minded, open-web users', 2, 4, 4, 2, ''],
  ['threads', 'Instagram users', 2, 3, 4, 2, ''],
  ['x', 'General', 2, 2, 4, 1, 'Low organic reach for new accounts.'],
  ['linkedin', "Bobby's network; teachers", 2, 3, 5, 1, ''],
  ['indiehackers', 'Makers', 1, 3, 4, 2, 'Brings makers more than players.'],
].map(([c, who, reach, fit, ease, last, risk]) => ({ c, who, reach, fit, ease, last, risk, score: reach * 2 + fit * 2 + ease + last }));
CHANNELS.sort((a, b) => b.score - a.score);

// Scenario model for the 8 campaign weeks (Nov 2 - Dec 31). Visits are
// assumptions; the conversion rates are the pass marks from the market test.
const RATES = { start: 0.40, solve: 0.50, ret: 0.15, install: 0.03 };
const SCEN = [
  ['Low', 1500, 'Few posts gain traction; Reddit and Product Hunt bring a few hundred visits each.'],
  ['Expected', 4000, 'One or two posts do well (for example r/WebGames or Product Hunt) and Pinterest starts to build.'],
  ['High', 12000, 'A front-page day on Hacker News or a popular Reddit post, plus steady Pinterest and YouTube search.'],
].map(([name, visits, why]) => {
  const starts = Math.round(visits * RATES.start), solves = Math.round(starts * RATES.solve);
  return { name, visits, starts, solves, ret: Math.round(starts * RATES.ret), installs: Math.round(visits * RATES.install), why };
});

// --- small inline SVG charts ---
const C = { ink: '#1f1d2b', muted: '#5d5a70', line: '#d9d6e6', a: '#5b3fd1', b: '#e0a526', c: '#2d8a6e', bg: '#f6f4fc' };
function barChart(rows) {
  const w = 640, rowH = 22, left = 130, max = 30, h = rows.length * rowH + 30;
  const bars = rows.map((r, i) => {
    const y = 10 + i * rowH, bw = (r.score / max) * (w - left - 40);
    return `<text x="${left - 8}" y="${y + 14}" text-anchor="end" font-size="11" fill="${C.ink}">${esc(cname(r.c))}</text>
      <rect x="${left}" y="${y + 3}" width="${bw}" height="14" rx="3" fill="${r.score >= 24 ? C.a : r.score >= 20 ? '#8f7ae6' : '#c3b8f2'}"/>
      <text x="${left + bw + 5}" y="${y + 14}" font-size="10.5" fill="${C.muted}">${r.score}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Channel priority scores">${bars}
    <text x="${left}" y="${h - 4}" font-size="9.5" fill="${C.muted}">Priority score = 2 x reach + 2 x audience fit + ease + how long it keeps working (max 30)</text></svg>`;
}
function gantt() {
  const w = 660, left = 120, weeks = 9, colW = (w - left) / weeks;
  const lanes = [
    ['Setup and approval', 0, 1, C.muted],
    ['Soft launch', 1, 1, C.a],
    ['Video and Reddit', 2, 1, C.a],
    ['Big launch days', 3, 1, C.b],
    ['Groups and printables', 4, 1, C.c],
    ['Store and directories', 5, 2, C.c],
    ['Holiday puzzles', 6, 3, C.c],
    ['Weekly pins and posts', 3, 6, '#8f7ae6'],
    ['Review and next plan', 8, 1, C.b],
  ];
  const labels = ['Oct 27', 'Nov 2', 'Nov 9', 'Nov 16', 'Nov 23', 'Nov 30', 'Dec 7', 'Dec 14', 'Dec 21-31'];
  const head = labels.map((l, i) => `<text x="${left + i * colW + colW / 2}" y="12" text-anchor="middle" font-size="9.5" fill="${C.muted}">${i === 0 ? 'Wk 0' : 'Wk ' + i}</text><text x="${left + i * colW + colW / 2}" y="24" text-anchor="middle" font-size="9" fill="${C.muted}">${l}</text>`).join('');
  const grid = Array.from({ length: weeks + 1 }, (_, i) => `<line x1="${left + i * colW}" x2="${left + i * colW}" y1="30" y2="${36 + lanes.length * 22}" stroke="${C.line}"/>`).join('');
  const rows = lanes.map(([n, s, len, col], i) => {
    const y = 36 + i * 22;
    return `<text x="${left - 8}" y="${y + 13}" text-anchor="end" font-size="10.5" fill="${C.ink}">${n}</text><rect x="${left + s * colW + 2}" y="${y + 2}" width="${len * colW - 4}" height="15" rx="4" fill="${col}"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${44 + lanes.length * 22}" width="100%" role="img" aria-label="Campaign timeline">${head}${grid}${rows}</svg>`;
}
function funnel(s) {
  const steps = [['Visits', s.visits], ['Started a puzzle', s.starts], ['Solved one', s.solves], ['Came back within 7 days', s.ret]];
  const w = 560, max = steps[0][1];
  return `<svg viewBox="0 0 ${w} ${steps.length * 34}" width="100%" role="img" aria-label="Expected funnel">${steps.map(([n, v], i) => {
    const bw = Math.max(4, (v / max) * (w - 250));
    return `<text x="170" y="${i * 34 + 21}" text-anchor="end" font-size="11.5" fill="${C.ink}">${n}</text><rect x="180" y="${i * 34 + 6}" width="${bw}" height="22" rx="4" fill="${[C.a, '#7a62dc', '#9d8ae6', C.b][i]}"/><text x="${186 + bw}" y="${i * 34 + 21}" font-size="11.5" fill="${C.ink}" font-weight="600">${v.toLocaleString('en-US')}</text>`;
  }).join('')}</svg>`;
}

const counts = {};
for (const a of ads) counts[a.channel] = (counts[a.channel] || 0) + 1;
const channelsUsed = Object.keys(counts).length;
const exp = SCEN[1];

const adCards = ads.map((a, i) => {
  const media = (a.media || []).map((k) => seed.media[k]).filter(Boolean);
  return `<div class="ad">
    <div class="ad-head"><span class="num">${i + 1}</span><div><h4>${esc(a.title)}</h4>
      <div class="meta">${day(a.date)} · Week ${a.week} · ${esc(cname(a.channel))} (${esc(a.medium)}) · code <code>${esc(a.content)}</code></div></div></div>
    <div class="ad-body">
      <div class="words">${esc(a.words).replace(/\n/g, '<br>')}</div>
      <div class="side">
        ${media.map((m) => `<figure><img src="${img(m.preview)}" alt=""><figcaption>${esc(m.title)}</figcaption></figure>`).join('') || '<p class="muted small">No picture: text only.</p>'}
        <p class="small"><b>Where:</b> ${esc(a.where_to || a.where)}</p>
        ${a.notes ? `<p class="small"><b>Tip:</b> ${esc(a.notes)}</p>` : ''}
        ${a.why ? `<p class="small"><b>Why this day:</b> ${esc(a.why)}</p>` : ''}
      </div>
    </div>
    <div class="link">Tracked link: ${esc(a.link)}</div>
  </div>`;
}).join('');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Launch plan</title>
<style>
@page { size: Letter; margin: 0.7in 0.7in 0.8in; }
* { box-sizing: border-box; }
body { font-family: Georgia, 'Times New Roman', serif; color: ${C.ink}; font-size: 10.5pt; line-height: 1.45; margin: 0; }
h1, h2, h3, h4, .sans, table, .meta, .tile, figcaption, .small { font-family: Arial, Helvetica, sans-serif; }
h1 { font-size: 30pt; line-height: 1.1; margin: 0 0 10px; color: ${C.a}; }
h2 { font-size: 16pt; color: ${C.a}; border-bottom: 2px solid ${C.line}; padding-bottom: 4px; margin: 0 0 10px; break-after: avoid; }
h3 { font-size: 12pt; margin: 16px 0 6px; break-after: avoid; }
h4 { font-size: 11pt; margin: 0; }
section { break-before: page; }
p { margin: 0 0 8px; }
ul, ol { margin: 0 0 8px; padding-left: 20px; }
li { margin-bottom: 3px; }
table { width: 100%; border-collapse: collapse; font-size: 8.8pt; margin: 6px 0 12px; }
th { background: ${C.bg}; text-align: left; color: ${C.muted}; font-weight: 600; }
th, td { border-bottom: 1px solid ${C.line}; padding: 4px 6px; vertical-align: top; }
tr { break-inside: avoid; }
td.n, th.n { text-align: right; white-space: nowrap; }
.muted { color: ${C.muted}; } .small { font-size: 8.6pt; }
.cover { height: 9.2in; display: flex; flex-direction: column; justify-content: space-between; }
.cover img { width: 100%; border-radius: 10px; border: 1px solid ${C.line}; }
.kicker { font-family: Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: ${C.muted}; font-size: 9pt; }
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 14px; }
.tile { background: ${C.bg}; border-radius: 8px; padding: 8px 10px; }
.tile b { display: block; font-size: 17pt; color: ${C.a}; }
.tile span { font-size: 8.4pt; color: ${C.muted}; }
.callout { background: #fff8e6; border-left: 4px solid ${C.b}; padding: 8px 12px; margin: 8px 0 12px; border-radius: 0 6px 6px 0; }
.ok { background: #eaf6f1; border-left-color: ${C.c}; }
.ad { border: 1px solid ${C.line}; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; break-inside: avoid; }
.ad-head { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 6px; }
.num { font-family: Arial, sans-serif; background: ${C.a}; color: #fff; border-radius: 50%; min-width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; font-size: 10pt; font-weight: 700; }
.meta { font-size: 8.4pt; color: ${C.muted}; }
.ad-body { display: grid; grid-template-columns: 1fr 180px; gap: 12px; }
.words { font-family: Arial, sans-serif; font-size: 8.8pt; background: ${C.bg}; padding: 8px; border-radius: 6px; white-space: normal; word-break: break-word; }
.side { word-break: break-word; } .side figure { margin: 0 0 6px; } .side img { width: 100%; border-radius: 4px; border: 1px solid ${C.line}; }
figcaption { font-size: 7.6pt; color: ${C.muted}; }
.link { font-family: 'Courier New', monospace; font-size: 7.4pt; color: ${C.muted}; margin-top: 6px; word-break: break-all; }
code { font-family: 'Courier New', monospace; font-size: 8.6pt; background: ${C.bg}; padding: 0 3px; border-radius: 3px; }
.mediagrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.mediagrid figure { margin: 0; break-inside: avoid; } .mediagrid img { width: 100%; max-height: 190px; object-fit: contain; background: ${C.bg}; border-radius: 6px; border: 1px solid ${C.line}; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.toc li { margin-bottom: 4px; font-family: Arial, sans-serif; }
</style></head><body>

<div class="cover">
  <div>
    <div class="kicker">The Fantastical Logic Grid · Marketing</div>
    <h1>Launch Plan:<br>Free Online Campaign</h1>
    <p class="sans" style="font-size:12.5pt;color:${C.muted}">Plan, channel analysis, schedule, tracking and every ad, for the launch on free channels from November 2 to December 31, 2026.</p>
  </div>
  <img src="${img('media/marketing/wide-1600x900.png')}" alt="">
  <table class="sans" style="font-size:9.5pt">
    <tr><th style="width:30%">Prepared for</th><td>Bobby Taylor, owner</td></tr>
    <tr><th>Date</th><td>October 26, 2026</td></tr>
    <tr><th>Campaign</th><td>${esc(seed.campaign.name)} (tracking code <code>${esc(seed.campaign.code)}</code>)</td></tr>
    <tr><th>Budget</th><td>$0. Free channels and free tools only.</td></tr>
    <tr><th>Status</th><td>Draft for approval. Nothing has been posted. Each ad waits for your OK.</td></tr>
  </table>
</div>

<section>
<h2>Contents</h2>
<ol class="toc">
  <li>Executive summary</li><li>Where the game stands</li><li>Who we are trying to reach</li><li>Goals and how we will know</li>
  <li>Channel analysis</li><li>Schedule</li><li>Tracking and reports</li><li>Cost analysis</li><li>Risks and how we handle them</li>
  <li>Decisions needed from you</li><li>Appendix A: all ${ads.length} ads, word for word</li><li>Appendix B: media library</li><li>Appendix C: account setup checklist</li>
</ol>
<h2 style="margin-top:22px">1. Executive summary</h2>
<p>The game is ready to meet players. This plan brings in the first players over eight weeks using only free channels, and measures which channels bring players who actually play, solve and come back.</p>
<div class="tiles">
  <div class="tile"><b>${ads.length}</b><span>ready-to-post ads</span></div>
  <div class="tile"><b>${channelsUsed}</b><span>free channels</span></div>
  <div class="tile"><b>8 wks</b><span>Nov 2 to Dec 31</span></div>
  <div class="tile"><b>$0</b><span>spend</span></div>
</div>
<ul>
  <li><b>The idea in one line:</b> "Logic grid puzzles with a new story every time." No competitor writes a fresh story for each puzzle, and none teaches with step-by-step hints for free.</li>
  <li><b>How it rolls out:</b> a quiet first week with friends, family and small social accounts to catch problems; then video and Reddit; then the two big launch days (Product Hunt on Tuesday, November 17 and Show HN on Wednesday, November 18); then printables and holiday puzzles through Thanksgiving and December.</li>
  <li><b>Every link is tracked</b> with an anonymous campaign code. The admin Marketing section shows visits, puzzles started, puzzles solved and installs per channel, per ad and per day. No personal data, no cookies, no third-party trackers.</li>
  <li><b>Every ad opens a quick Easy puzzle</b> (<code>?play=now</code>), so a new visitor is playing in one tap.</li>
  <li><b>Expected result</b> (middle scenario): about ${exp.visits.toLocaleString('en-US')} visits, ${exp.starts.toLocaleString('en-US')} players starting a puzzle and ${exp.solves.toLocaleString('en-US')} solving one by December 31. The range is ${SCEN[0].visits.toLocaleString('en-US')} to ${SCEN[2].visits.toLocaleString('en-US')} visits (section 4).</li>
</ul>
<div class="callout"><b>What happens next:</b> you approve the ads (in the admin Marketing section or by replying in the project), create the free accounts (Appendix C, also emailed), and the first post goes out on Monday, November 2.</div>
</section>

<section>
<h2>2. Where the game stands</h2>
<h3>What we are launching</h3>
<ul>
  <li>Free logic grid puzzles in the browser, plus a Windows app and an installable web app that works offline.</li>
  <li>A new story, cast and clue wording for every puzzle, from 14 themes and six levels (Basic to MENSA). Every puzzle has exactly one answer, checked by a solver.</li>
  <li>A daily puzzle with streaks, races against other players and a scoreboard, Challenge a friend links, printing with answer keys, hints that explain the reasoning, read-aloud voices, more than 100 languages, keyboard and screen-reader play.</li>
</ul>
<h3>The market</h3>
<p>Logic grid puzzles have a loyal audience (puzzle magazines, Puzzle Baron, app-store puzzle packs) but the main players sell fixed puzzle books and packs. Prices checked on October 26, 2026:</p>
<table>
  <tr><th>Competitor</th><th>Model</th><th>Price</th><th>What we do differently</th></tr>
  <tr><td>Puzzle Baron (Logic Puzzles)</td><td>100 free, then paid volumes</td><td>$2.99 per volume, $4.99 a month</td><td rowspan="4">Unlimited new puzzles with a story each, teaching hints, daily puzzle, races and printables, all free</td></tr>
  <tr><td>Logic Puzzles Daily</td><td>Puzzle packs</td><td>$1.99 packs, $4.49</td></tr>
  <tr><td>Penny Dell Logic</td><td>Paid packs</td><td>$3.99 for 30</td></tr>
  <tr><td>Everyday Grids</td><td>Ads plus subscription</td><td>$14.99 a year</td></tr>
</table>
<h3>Strengths, weaknesses, opportunities, threats</h3>
<div class="two">
  <div><b class="sans">Strengths</b><ul><li>Endless fresh puzzles with stories</li><li>Free, no sign-up, one tap to play</li><li>Accessibility and printables</li><li>Runs at $0</li></ul>
  <b class="sans">Weaknesses</b><ul><li>Unknown name, no followers yet</li><li>No phone apps while mobile is paused</li><li>No player reviews to show yet</li></ul></div>
  <div><b class="sans">Opportunities</b><ul><li>Teachers and parents want free printables</li><li>Holiday downtime (Thanksgiving, December)</li><li>Communities that like "made with care" indie projects</li><li>Search: "free printable logic puzzles"</li></ul>
  <b class="sans">Threats</b><ul><li>Reddit and group self-promotion rules</li><li>Big launch days can bring more traffic than free limits (watched by the free-limit alerts)</li><li>Low organic reach on X and Facebook Pages</li></ul></div>
</div>
</section>

<section>
<h2>3. Who we are trying to reach</h2>
<table>
  <tr><th style="width:20%">Group</th><th>What they want</th><th>Message that fits</th><th style="width:22%">Where they are</th></tr>
  <tr><td><b>Puzzle fans</b></td><td>Fair, hard puzzles; a steady supply</td><td>"Basic to MENSA, a new puzzle whenever you want, exactly one answer"</td><td>r/logicpuzzles, r/puzzles, Facebook puzzle groups</td></tr>
  <tr><td><b>Casual brain-game players</b></td><td>Something short and pleasant each day</td><td>"A new daily puzzle with a little story"</td><td>Instagram, TikTok, Threads, Facebook, YouTube Shorts</td></tr>
  <tr><td><b>Teachers and parents</b></td><td>Free printables with answer keys</td><td>"Free printable logic puzzles with answer keys, any theme"</td><td>Pinterest, homeschool groups, LinkedIn</td></tr>
  <tr><td><b>Web and indie gamers</b></td><td>Something new and well made to try</td><td>"Logic puzzles with a story, free in the browser"</td><td>r/WebGames, r/playmygame, itch.io</td></tr>
  <tr><td><b>Makers and tech people</b></td><td>How it was built; they share widely</td><td>"A generator that writes a story for each puzzle, on free tiers"</td><td>Hacker News, Product Hunt, r/SideProject, Indie Hackers</td></tr>
</table>
<p>Makers and tech people are not the main players, but they share links widely, so they are the cheapest way to reach the other groups.</p>
</section>

<section>
<h2>4. Goals and how we will know</h2>
<h3>Pass marks (from the market test)</h3>
<p>These are the numbers that tell us the game itself is working for new players. They are measured over 28 days and appear in the Monday summary email.</p>
<table>
  <tr><th>Measure</th><th class="n">Pass mark</th><th>Needs at least</th><th>Where it is measured</th></tr>
  <tr><td>Visitors who start a puzzle</td><td class="n">40%</td><td>100 visitors</td><td>Marketing: Visits and Played</td></tr>
  <tr><td>Started games that are solved</td><td class="n">50%</td><td>30 games</td><td>Marketing: Played and Solved</td></tr>
  <tr><td>Average rating</td><td class="n">4.0 of 5</td><td>30 ratings</td><td>Ratings and insights</td></tr>
  <tr><td>Players who come back within 7 days</td><td class="n">15%</td><td>100 players</td><td>Weekly summary funnel</td></tr>
  <tr><td>Support link clicks</td><td class="n">2%</td><td>n/a</td><td>Not measured yet (no Support button live)</td></tr>
</table>
<h3>Campaign scenarios to December 31</h3>
<p>Visits are planning assumptions, not promises. The other numbers apply the pass marks above, plus an assumed 3% install rate.</p>
<table>
  <tr><th>Scenario</th><th class="n">Visits</th><th class="n">Started</th><th class="n">Solved</th><th class="n">Came back</th><th class="n">Installs</th><th>What it would take</th></tr>
  ${SCEN.map((s) => `<tr><td><b>${s.name}</b></td><td class="n">${s.visits.toLocaleString('en-US')}</td><td class="n">${s.starts.toLocaleString('en-US')}</td><td class="n">${s.solves.toLocaleString('en-US')}</td><td class="n">${s.ret.toLocaleString('en-US')}</td><td class="n">${s.installs.toLocaleString('en-US')}</td><td>${esc(s.why)}</td></tr>`).join('')}
</table>
<h3>Expected funnel</h3>
${funnel(exp)}
<p class="small muted">Middle scenario. The admin Marketing section draws the real version of this from day one.</p>
<h3>Rules for acting on the numbers</h3>
<ul>
  <li><b>Double down</b> on a channel when its visitors solve puzzles at or above the 50% pass mark and it brought at least 50 visits: post there again with fresh words.</li>
  <li><b>Fix the game, not the ads,</b> if visits are fine but fewer than 40% start a puzzle (first screen) or fewer than 50% solve (difficulty, hints).</li>
  <li><b>Stop</b> a channel after two posts with fewer than 20 visits in total, and move that time to the best two channels.</li>
  <li><b>Watch free limits</b> on big launch days. The free-limit alerts in admin warn before anything runs out.</li>
</ul>
</section>

<section>
<h2>5. Channel analysis</h2>
<p>Each channel is scored on reach (how many people one good post can reach), audience fit, ease (time and rules) and how long a post keeps bringing visits. The scores are judgements to set the order; after week 2 the real numbers in the dashboard replace them.</p>
${barChart(CHANNELS)}
<table>
  <tr><th>Channel</th><th>Audience</th><th class="n">Reach</th><th class="n">Fit</th><th class="n">Ease</th><th class="n">Lasts</th><th class="n">Ads</th><th>Main risk</th></tr>
  ${CHANNELS.map((r) => `<tr><td><b>${esc(cname(r.c))}</b></td><td>${esc(r.who)}</td><td class="n">${r.reach}</td><td class="n">${r.fit}</td><td class="n">${r.ease}</td><td class="n">${r.last}</td><td class="n">${counts[r.c] || 0}</td><td>${esc(r.risk)}</td></tr>`).join('')}
</table>
<h3>What this means</h3>
<ul>
  <li><b>Reddit, Pinterest and Facebook groups</b> fit our players best. Reddit needs a week of genuine commenting first, so the account should be made this week.</li>
  <li><b>Product Hunt and Hacker News</b> are one-day bets with a big upside. They go on back-to-back days in week 3, after the quiet launch has caught any problems.</li>
  <li><b>Pinterest, YouTube, AlternativeTo, itch.io and the Microsoft Store</b> keep bringing visits for months from search, so they are worth setting up well even if week one is slow.</li>
  <li><b>X, Threads, Bluesky and Mastodon</b> are cheap to post to but reach few people from new accounts. They are kept for completeness and for sharing daily puzzles later.</li>
</ul>
</section>

<section>
<h2>6. Schedule</h2>
${gantt()}
<h3>Week 0 (October 27 to November 1): get ready</h3>
<ul>
  <li>You approve the ads and create the free accounts (Appendix C, also emailed to fantasticallogicgrid@gmail.com).</li>
  <li>Start commenting on Reddit (r/WebGames, r/logicpuzzles, r/puzzles) so the account is not brand-new on posting day.</li>
  <li>Apply for the free Microsoft Store developer account (identity check takes a few days).</li>
  <li>Sign up on Product Hunt now; new accounts may wait about a week before they can launch.</li>
</ul>
<h3>Posting calendar</h3>
<table>
  <tr><th style="width:13%">Date</th><th style="width:6%">Week</th><th style="width:15%">Channel</th><th>Ad</th><th style="width:30%">Note</th></tr>
  ${ads.map((a, i) => `<tr><td>${day(a.date)}</td><td class="n">${a.week}</td><td>${esc(cname(a.channel))}</td><td>${i + 1}. ${esc(a.title)}</td><td>${esc(a.why)}</td></tr>`).join('')}
</table>
<h3>Ongoing, every week from week 3</h3>
<ul>
  <li>One new Pinterest pin with a different theme (holiday themes in late November and December).</li>
  <li>Two or three short posts a week on the social accounts that are working, built around the daily puzzle and Challenge a friend links. New words each time, never copies.</li>
  <li>Reply to every comment within a day; replies count as much as posts on Reddit, Product Hunt and Hacker News.</li>
  <li>Monday: read the weekly summary email and the Marketing section, then pick the next week's posts by the rules in section 4.</li>
</ul>
</section>

<section>
<h2>7. Tracking and reports</h2>
<h3>How tracking works</h3>
<ul>
  <li>Every ad has a tracked link: <code>thelogicgrid.com/?play=now&amp;utm_source=…&amp;utm_medium=…&amp;utm_campaign=launch-2026&amp;utm_content=…</code>. The admin link builder makes new ones.</li>
  <li>When a visitor arrives, the game remembers the campaign in their own browser for 30 days and removes the tags from the address bar, so links people copy and share stay clean.</li>
  <li>The game counts five events: <b>visit</b> (once per tab), <b>play</b>, <b>solve</b>, <b>install</b> (home screen) and <b>download</b> (Windows app). Each is a number added to a daily total for that campaign, channel and ad.</li>
  <li>Nothing personal is stored: no names, no IP addresses, no cookies, no third-party trackers. Unknown codes are grouped as "other". This keeps us within the privacy page and free of cookie banners.</li>
  <li>Visits from sites without tags (for example a shared link on Reddit) are still credited to the right source from the referring site.</li>
</ul>
<h3>Where to see the numbers</h3>
<table>
  <tr><th style="width:30%">Report</th><th>What it shows</th><th style="width:20%">When</th></tr>
  <tr><td>Admin, Marketing section</td><td>Totals, a visits and solves trend, tables by channel, campaign and ad, the media library, and every ad with copy and Mark as posted buttons</td><td>Any time</td></tr>
  <tr><td>Marketing CSV export</td><td>Daily rows by campaign, channel, ad, event and platform for your own spreadsheet</td><td>Any time</td></tr>
  <tr><td>Weekly summary email</td><td>Funnel and pass marks for the last 28 days</td><td>Monday</td></tr>
  <tr><td>Free-limit alerts</td><td>Warning before any free service limit is reached</td><td>When needed</td></tr>
  <tr><td>Ratings and insights</td><td>Star ratings after solving, trends and findings</td><td>Any time</td></tr>
</table>
<h3>Reporting rhythm</h3>
<ul>
  <li><b>Launch days</b> (Nov 2, 17, 18): check the Marketing section at the end of the day.</li>
  <li><b>Weekly:</b> best and worst channel by solves, not just visits.</li>
  <li><b>December 7:</b> one-month review, shared publicly in the Indie Hackers post (numbers only).</li>
  <li><b>January 4, 2027:</b> final campaign report and next plan.</li>
</ul>
</section>

<section>
<h2>8. Cost analysis</h2>
<div class="callout ok"><b>Total planned spend: $0.</b> Every channel, account and tool in this plan is free. Nothing that costs money is used without your OK.</div>
<table>
  <tr><th>Item</th><th class="n">Cost</th><th>Notes</th></tr>
  <tr><td>Social accounts (Facebook, Instagram, Threads, TikTok, YouTube, X, Bluesky, Mastodon, Pinterest, LinkedIn)</td><td class="n">$0</td><td>Free accounts and free business/creator modes</td></tr>
  <tr><td>Reddit, Hacker News, Product Hunt, Indie Hackers, AlternativeTo, itch.io</td><td class="n">$0</td><td>Free to post or list</td></tr>
  <tr><td>Microsoft Store</td><td class="n">$0</td><td>Individual developer accounts are free; PWABuilder packaging is free</td></tr>
  <tr><td>Videos, pictures and ad words</td><td class="n">$0</td><td>Made from the game itself; music synthesized; no licences needed</td></tr>
  <tr><td>Tracking and reports</td><td class="n">$0</td><td>Our own server on the Cloudflare free plan</td></tr>
  <tr><td>Hosting during launch spikes</td><td class="n">$0</td><td>Within free limits at these sizes; alerts warn first</td></tr>
</table>
<h3>Not in this plan (would cost money, needs your OK)</h3>
<table>
  <tr><th>Item</th><th class="n">Cost</th><th>Why it is left out</th></tr>
  <tr><td>Paid or boosted posts (Facebook, Instagram, Reddit, TikTok, X)</td><td class="n">from about $5 a day</td><td>Free-only rule. Worth testing only after the free posts show which message works.</td></tr>
  <tr><td>Google Play developer account</td><td class="n">$25 once</td><td>Mobile apps are paused</td></tr>
  <tr><td>Apple developer program</td><td class="n">$99 a year</td><td>Mobile apps are paused</td></tr>
  <tr><td>X Premium, LinkedIn Premium, scheduling tools</td><td class="n">varies</td><td>Not needed: posts are copied from the admin dashboard by hand</td></tr>
</table>
<h3>Your time</h3>
<p>The real cost is time. About 3 to 4 hours in week 0 for accounts, about 30 minutes on each posting day, about 2 hours on each big launch day (replying to comments), and 30 minutes on Mondays for the review. Roughly 15 to 20 hours over the eight weeks.</p>
</section>

<section>
<h2>9. Risks and how we handle them</h2>
<table>
  <tr><th style="width:26%">Risk</th><th style="width:12%">Likelihood</th><th>What we do</th></tr>
  <tr><td>A Reddit post is removed for self-promotion</td><td>Medium</td><td>Comment for a week first, read each subreddit's rules on the day, post one subreddit at a time, reply to comments. Never repost a removed post.</td></tr>
  <tr><td>A launch day brings more traffic than the free limits</td><td>Low</td><td>The site is static and cached; free-limit alerts warn first; races and voices have caps.</td></tr>
  <tr><td>A bug shows up with many new players</td><td>Medium</td><td>Soft launch first; error reports and nightly checks catch problems; Product Hunt and Hacker News only after week 1 is clean.</td></tr>
  <tr><td>Low reach on new social accounts</td><td>High</td><td>Expected. These accounts are low effort; time moves to channels that work by the rules in section 4.</td></tr>
  <tr><td>Negative comments about the game</td><td>Medium</td><td>Thank people, log the idea or problem in admin feedback, fix it and say so. Fixed items are marked Addressed and players are told.</td></tr>
  <tr><td>Accounts blocked for looking like spam</td><td>Low</td><td>Different words for every channel, no mass posting, one Facebook group a day.</td></tr>
  <tr><td>Privacy complaints about tracking</td><td>Low</td><td>Tracking is anonymous daily counts only, described on the privacy page.</td></tr>
</table>
</section>

<section>
<h2>10. Decisions needed from you</h2>
<ol>
  <li><b>Approve the ads.</b> In admin, Marketing, open each ad and set it to Approved to post, or reply in the project with the numbers from Appendix A you approve. Edit anything you like first.</li>
  <li><b>Create the free accounts</b> in Appendix C. The same steps were emailed to fantasticallogicgrid@gmail.com.</li>
  <li><b>Confirm the start date</b> of Monday, November 2, or pick another; the calendar moves with it.</li>
  <li><b>Who posts.</b> The ads post from your accounts, so you post them by copying the words and link from the dashboard (one click each), then press Mark as posted and paste the post's link.</li>
  <li><b>Optional later:</b> if the free posts work, whether to test a small paid boost on the best channel. Not planned and not used without your OK.</li>
</ol>
<div class="callout">Nothing in this plan is posted publicly until you approve it.</div>
</section>

<section>
<h2>Appendix A: all ${ads.length} ads, word for word</h2>
<p>These match the drafts in the admin Marketing section, in posting order. Each has its own tracked link; the dashboard copies the words with the link filled in.</p>
${adCards}
</section>

<section>
<h2>Appendix B: media library</h2>
<p>All pictures are made from the real game; the videos are the promo videos with captions. Full-size files are linked from the admin Marketing section and kept in the repository under media/marketing and media/promo.</p>
<div class="mediagrid">
${Object.values(seed.media).map((m) => `<figure><img src="${img(m.preview)}" alt=""><figcaption><b>${esc(m.title)}</b><br>${esc(m.kind)} · ${esc(m.size)}${m.notes ? '<br>' + esc(m.notes) : ''}</figcaption></figure>`).join('')}
</div>
</section>

<section>
<h2>Appendix C: account setup checklist</h2>
<p>Use fantasticallogicgrid@gmail.com for every account. All are free.</p>
<table>
  <tr><th style="width:4%">#</th><th style="width:20%">Account</th><th>Where</th><th style="width:30%">Note</th></tr>
  ${[
    ['Facebook Page', 'facebook.com/pages/create', 'Category: Video game'],
    ['Instagram', 'instagram.com/accounts/emailsignup', 'Switch to a free Creator or Business account; link in bio'],
    ['Threads', 'threads.net', 'Sign in with the Instagram account'],
    ['TikTok', 'tiktok.com/signup', 'Free Business account for the bio link'],
    ['YouTube channel', 'youtube.com/create_channel', 'Verify with a phone at youtube.com/verify'],
    ['X', 'x.com/i/flow/signup', 'Free plan'],
    ['Bluesky', 'bsky.app', ''],
    ['Mastodon', 'joinmastodon.org/servers', 'A general server such as mastodon.social'],
    ['Pinterest', 'pinterest.com/business/create', 'Boards: Printable Logic Puzzles, Brain Games, Puzzle Night'],
    ['Reddit', 'reddit.com/register', 'Comment for a week before posting'],
    ['LinkedIn', 'Your own profile', 'Nothing to create'],
    ['itch.io', 'itch.io/register', 'Price: No payments'],
    ['Product Hunt', 'producthunt.com', 'Sign up now; new accounts may wait a week'],
    ['Hacker News', 'news.ycombinator.com/login', ''],
    ['Indie Hackers', 'indiehackers.com', ''],
    ['AlternativeTo', 'alternativeto.net', ''],
    ['Microsoft Store', 'storedeveloper.microsoft.com', 'Individual developer, free; identity check'],
  ].map(([n, w, t], i) => `<tr><td>${i + 1}</td><td><b>${n}</b></td><td>${w}</td><td>${t}</td></tr>`).join('')}
</table>
<p class="small muted">Made from the game's own campaign data on October 26, 2026. Rebuild with <code>node docs/reports/launch-plan/build.mjs</code>.</p>
</section>
</body></html>`;

const htmlPath = resolve(here, 'launch-plan.html');
writeFileSync(htmlPath, html);
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });
await page.pdf({
  path: OUT, format: 'Letter', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:8px;color:#5d5a70;width:100%;padding:0 0.7in;display:flex;justify-content:space-between;font-family:Arial"><span>The Fantastical Logic Grid · Launch plan · October 26, 2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
});
await browser.close();
console.log('wrote', OUT);
