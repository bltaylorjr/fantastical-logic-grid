// The Analysis page: one report built from every number the dashboard keeps
// (GET /admin/v1/analysis, server/src/analysis.js), broken down by topic. Each
// topic shows its figures, what they mean in plain words and what to do next.
// The market and technology sections come from analysis-market.js, written
// from outside research and dated, so they can be refreshed by hand.
//
// The report never claims more than the data shows: a figure with too few
// games or visits behind it is marked "Too early" instead of good or bad.
import { MARKET } from './analysis-market.js';
import { loadTuning } from './tuning.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// Below these sample sizes a rate is shown but not judged.
const MIN = { visits: 100, games: 30, rated: 10, search: 100 };
const STATUS = {
  good: { label: 'Working well', cls: 'ok' },
  watch: { label: 'Keep an eye on', cls: 'warn' },
  act: { label: 'Needs action', cls: 'bad' },
  early: { label: 'Too early to judge', cls: '' },
};
const TIERS = { basic: 'Basic', easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', mensa: 'Quantum Physicist', theorist: 'Theoretical Physicist' };
const APPS = { web: 'Website', desktop: 'Windows app', android: 'Android app', ios: 'iPhone or iPad' };
const MARK_WORDS = { pass: ['Pass', 'ok'], below: ['Below the mark', 'bad'], too_early: ['Too early', ''], not_measured: ['Not measured', ''] };
const IMPACT = { high: 3, medium: 2, low: 1 };
const EFFORT = { small: 1, medium: 2, large: 3 };

let H = null; // helpers from admin.js
let last = null;

const sum = (xs) => (xs || []).reduce((s, v) => s + (Number(v) || 0), 0);
const share = (a, b) => (b ? a / b : null);
const pc = (f) => (f == null ? '–' : `${Math.round(f * 100)}%`);
const isoLabel = (d) => (d ? H.day(Date.parse(`${String(d).slice(0, 10)}T12:00:00`)) : '–');
const plural = (n, one, many = `${one}s`) => `${H.fmt(n)} ${n === 1 ? one : many}`;
const r1 = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1));
const regionName = (() => { try { const n = new Intl.DisplayNames(['en'], { type: 'region' }); return (c) => (c === 'XX' ? 'Unknown' : n.of(c) || c); } catch (e) { return (c) => c; } })();

// "+40% on the previous period", "new this period" or nothing.
function change(cur, prev) {
  if (!prev && !cur) return '';
  if (!prev) return 'new this period';
  const d = Math.round(((cur - prev) / prev) * 100);
  return `${d > 0 ? '+' : ''}${d}% on the previous period`;
}
const badge = (st) => `<span class="badge ${STATUS[st].cls}">${STATUS[st].label}</span>`;
const list = (items, empty) => (items.length ? `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`);
// The worst status of a topic's findings decides the topic's own badge.
const worst = (fs) => (fs.some((f) => f.st === 'act') ? 'act' : fs.some((f) => f.st === 'watch') ? 'watch' : fs.some((f) => f.st === 'good') ? 'good' : 'early');

// ------------------------------------------------------------- topics
// Each returns { id, title, intro, tiles, body, findings: [{ st, text }], ideas: [{ text, why, impact, effort, link }] }.

function audience(d) {
  const v = d.visitors;
  const e = d.extra || {};
  const t = { id: 'audience', title: 'Audience and reach', intro: 'Who opens the site and apps, on what, and from where. Each device is counted once a day.', findings: [], ideas: [] };
  if (!v) return { ...t, missing: true };
  const total = v.total || 0;
  const players = sum(v.byDay.player);
  const mobile = (v.device.find((x) => x.id === 'mobile') || {}).n || 0;
  const top = v.country.slice(0, 5);
  const topShare = share(top[0]?.n || 0, total);
  t.tiles = [
    H.tile('Visits', H.fmt(total), change(total, e.previous?.visits)),
    H.tile('Signed-in visits', H.fmt(players), `${pc(share(players, total))} of visits`),
    H.tile('On phones', pc(share(mobile, total)), `${H.fmt(mobile)} visits`),
    H.tile('Countries', H.fmt(v.country.filter((c) => c.id !== 'XX').length), top[0] ? `most from ${H.esc(regionName(top[0].id))}` : ''),
  ];
  t.body = `<div class="charts">${H.bars('Visits per day', v.dayList.map((_, i) => v.byDay.guest[i] + v.byDay.player[i]), { second: v.byDay.player, labels: v.dayList, names: ['All visits', 'Signed in'] })}</div>
    <div class="an-cols">
      <div><h3>Where from</h3>${H.table([{ label: 'Country' }, { label: 'Visits', num: 1 }], top.map((c) => [H.esc(regionName(c.id)), H.fmt(c.n)]), 'No visits yet.', { csv: false })}</div>
      <div><h3>Which app</h3>${H.table([{ label: 'App' }, { label: 'Visits', num: 1 }], v.app.filter((x) => x.n).map((x) => [H.esc(APPS[x.id] || x.id), H.fmt(x.n)]), 'No visits yet.', { csv: false })}</div>
      <div><h3>Which device</h3>${H.table([{ label: 'Device' }, { label: 'Visits', num: 1 }], v.device.filter((x) => x.n).map((x) => [H.esc(x.id), H.fmt(x.n)]), 'No visits yet.', { csv: false })}</div>
    </div>`;
  if (total < MIN.visits) {
    t.findings.push({ st: 'early', text: `${H.fmt(total)} visits in this period. Under ${MIN.visits} visits the shares below can swing a lot from one person.` });
    t.ideas.push({ text: 'Grow reach before tuning: post the daily puzzle every day and add the site to puzzle directories and lists', why: `Only ${H.fmt(total)} visits so far`, impact: 'high', effort: 'small', link: '#marketing' });
  } else if (e.previous?.visits && total < e.previous.visits * 0.8) {
    t.findings.push({ st: 'act', text: `Visits fell from ${H.fmt(e.previous.visits)} to ${H.fmt(total)} on the previous period.` });
  } else if (e.previous?.visits && total > e.previous.visits * 1.2) {
    t.findings.push({ st: 'good', text: `Visits grew from ${H.fmt(e.previous.visits)} to ${H.fmt(total)} on the previous period.` });
  }
  if (total && share(mobile, total) >= 0.5) {
    t.findings.push({ st: 'watch', text: `${pc(share(mobile, total))} of visits are on phones, so the grid has to work well on a small screen first.` });
    t.ideas.push({ text: 'Run a phone-first pass on the grid: bigger tap targets, one-hand clue panel, no sideways scrolling', why: `${pc(share(mobile, total))} of visits are on phones`, impact: 'high', effort: 'medium' });
  }
  if (total >= 20 && topShare >= 0.8) t.findings.push({ st: 'watch', text: `${pc(topShare)} of visits come from ${H.esc(regionName(top[0].id))}. That is normal at the start; translations and posting times can widen it later.` });
  if (total && share(players, total) < 0.25) t.findings.push({ st: total < MIN.visits ? 'early' : 'watch', text: `Only ${pc(share(players, total))} of visits are signed in. Most people play as guests.` });
  return t;
}

function players(d) {
  const a = d.analytics;
  const e = d.extra || {};
  const t = { id: 'players', title: 'Players and accounts', intro: 'Accounts are optional. A screen name is only made when a player picks one, so many players never appear in Screen names.', findings: [], ideas: [] };
  if (!a) return { ...t, missing: true };
  const p = a.players;
  const added = sum(p.newAccounts);
  const visits = d.visitors?.total || 0;
  t.tiles = [
    H.tile('Accounts', H.fmt(p.accounts), `${H.fmt(added)} new · ${change(added, e.previous?.accounts) || 'none before'}`, '#players'),
    H.tile('Screen names', H.fmt(p.screenNames), `${H.fmt(p.newScreenNames)} new in this period`),
    H.tile('Players who scored', H.fmt(p.activePeriod), `${H.fmt(p.active7)} in the last 7 days`),
    H.tile('Visit to account', pc(share(added, visits)), `${H.fmt(added)} of ${H.fmt(visits)} visits`),
  ];
  t.body = `<div class="charts">${H.bars('New accounts per day', p.newAccounts, { labels: a.dayList })}</div>
    <p class="muted">${H.fmt(p.deletedAccounts)} accounts deleted in this period; ${H.fmt(p.banned)} players banned now.</p>`;
  if (p.accounts < 10) {
    t.findings.push({ st: 'early', text: `${plural(p.accounts, 'account')} in all. Every account counts at this stage, and each one is worth a personal welcome.` });
    t.ideas.push({ text: 'Give a reason to sign up at the moment it matters: after the first solve, offer "save your streak and badges" in one tap', why: `${plural(p.accounts, 'account')} from ${plural(visits, 'visit')}`, impact: 'high', effort: 'small' });
  } else if (visits >= MIN.visits && share(added, visits) < 0.02) {
    t.findings.push({ st: 'act', text: `Only ${pc(share(added, visits))} of visits turn into an account.` });
  }
  if (p.accounts >= 10 && p.activePeriod / p.accounts >= 0.5) t.findings.push({ st: 'good', text: `${pc(p.activePeriod / p.accounts)} of accounts scored at least once in this period.` });
  else if (p.accounts >= 10) t.findings.push({ st: 'watch', text: `${pc(p.activePeriod / p.accounts)} of accounts scored in this period. The rest signed up and went quiet.` });
  if (p.deletedAccounts && p.deletedAccounts >= added) t.findings.push({ st: 'act', text: `${H.fmt(p.deletedAccounts)} accounts were deleted, as many as or more than were made.` });
  return t;
}

function play(d) {
  const a = d.analytics;
  const e = d.extra || {};
  const t = { id: 'play', title: 'Play and engagement', intro: 'Anonymous summaries from players who share what they play: never linked to accounts.', findings: [], ideas: [] };
  if (!a) return { ...t, missing: true };
  const g = a.games;
  const games = sum(g.byDay);
  const solved = sum(g.solvedByDay);
  const out = Object.fromEntries((g.outcomes || []).map((x) => [x.id, x.n]));
  const quit = (out.revealed || 0) + (out.abandoned || 0);
  const tiers = [...g.byTier].sort((x, y) => Object.keys(TIERS).indexOf(x.id) - Object.keys(TIERS).indexOf(y.id));
  const daily = e.daily || {};
  const ch = e.challenges || {};
  t.tiles = [
    H.tile('Games finished', H.fmt(games), change(games, e.previous?.plays)),
    H.tile('Solved', pc(share(solved, games)), `${H.fmt(solved)} of ${H.fmt(games)}`),
    H.tile('Gave up or revealed', pc(share(quit, games)), `${H.fmt(quit)} games`),
    H.tile('Daily puzzle results', H.fmt(daily.n), daily.days ? `over ${H.fmt(daily.days)} days` : 'none yet'),
    H.tile('Races', H.fmt(sum(a.races.byDay)), `${H.fmt(a.races.entries)} entries, ${H.fmt(a.races.open)} open now`),
    H.tile('Friend challenges', H.fmt(ch.n), `${H.fmt(ch.plays)} friends played them`),
  ];
  t.body = `<div class="charts">${H.bars('Games finished per day', g.byDay, { second: g.solvedByDay, labels: a.dayList, names: ['Finished', 'Solved'] })}</div>
    <h3>By difficulty</h3>${H.table([{ label: 'Difficulty' }, { label: 'Games', num: 1 }, { label: 'Solved', num: 1 }, { label: 'Rating', num: 1 }, { label: 'Minutes', num: 1 }, { label: 'Hints', num: 1 }],
      tiers.map((x) => [H.esc(TIERS[x.id] || x.id), H.fmt(x.n), pc(share(x.solved, x.n)), x.rating ?? '–', x.minutes ?? '–', x.hints ?? '–']), 'No games shared in this period.')}
    <h3>By theme</h3>${H.table([{ label: 'Theme' }, { label: 'Games', num: 1 }, { label: 'Solved', num: 1 }, { label: 'Rating', num: 1 }, { label: 'Minutes', num: 1 }],
      g.byTheme.map((x) => [H.esc(x.id), H.fmt(x.n), pc(share(x.solved, x.n)), x.rating ?? '–', x.minutes ?? '–']), 'No games shared in this period.')}
    <h3>By app</h3>${H.table([{ label: 'App' }, { label: 'Games', num: 1 }], (g.byPlatform || []).map((x) => [H.esc(APPS[x.id] || x.id), H.fmt(x.n)]), 'No games shared in this period.', { csv: false })}`;
  const sr = share(solved, games);
  if (games < MIN.games) {
    t.findings.push({ st: 'early', text: `${H.fmt(games)} games finished. The solve rate (${pc(sr)}) is a first sign, not a result, until there are ${MIN.games} or more.` });
  } else if (sr >= 0.5) {
    t.findings.push({ st: 'good', text: `${pc(sr)} of games end solved, above the 50% mark: the puzzles are hard but fair.` });
  } else {
    t.findings.push({ st: 'act', text: `Only ${pc(sr)} of games end solved, under the 50% mark. Players are stuck or leaving.` });
    t.ideas.push({ text: 'Make the first puzzle easier and add a gentler hint (point at the next deduction, not the answer)', why: `${pc(sr)} solve rate`, impact: 'high', effort: 'medium', link: '#quality' });
  }
  const topTier = [...g.byTier].sort((x, y) => y.n - x.n)[0];
  if (topTier && games >= MIN.games && share(topTier.n, games) >= 0.35) t.findings.push({ st: 'good', text: `${H.esc(TIERS[topTier.id] || topTier.id)} is the most played level (${pc(share(topTier.n, games))} of games).` });
  const hardTiers = tiers.filter((x) => x.n >= 5 && share(x.solved, x.n) < 0.4);
  for (const x of hardTiers) t.findings.push({ st: 'watch', text: `${H.esc(TIERS[x.id] || x.id)}: ${pc(share(x.solved, x.n))} solved in ${H.fmt(x.n)} games.` });
  if (games >= 10 && !sum(a.races.byDay) && !ch.n) {
    t.findings.push({ st: 'watch', text: 'Nobody raced or sent a friend challenge in this period: the social features are not being found.' });
    t.ideas.push({ text: 'Put "Challenge a friend" on the solved screen with a share card (time and a spoiler-free grid picture)', why: 'No races or challenges this period', impact: 'medium', effort: 'small' });
  }
  if (games >= 10 && !daily.n) t.ideas.push({ text: 'Make the daily puzzle the front door: one big "Today\'s puzzle" button and a visible streak', why: 'No daily puzzle results this period', impact: 'high', effort: 'small', link: '#daily' });
  return t;
}

function quality(d) {
  const q = d.quality;
  const r = d.ratings;
  const e = d.extra || {};
  const t = { id: 'quality', title: 'Puzzle quality and ratings', intro: 'Ratings players give after a game, the puzzles they give up on or call too hard or too easy, and problems they report.', findings: [], ideas: [] };
  if (!q && !r) return { ...t, missing: true };
  const reports = Object.fromEntries((e.reports || []).map((x) => [x.status, x.n]));
  const openReports = (reports.new || 0) + (reports.checking || 0) + (reports.needs_fix || 0);
  const dist = r && r.spread ? r.spread : [];
  t.tiles = [
    H.tile('Average rating', r && r.rated ? `${r1(r.avg)} / 5` : '–', r ? `${H.fmt(r.rated)} ratings` : ''),
    H.tile('Games rated', r ? pc(r.rateShare) : '–', 'of games finished'),
    H.tile('Puzzles flagged', H.fmt(q ? q.flagged : null), `need at least ${q ? q.minGames : '–'} games to flag`, '#quality'),
    H.tile('Problem reports', H.fmt(sum(Object.values(reports))), `${H.fmt(openReports)} still open`, '#errortracking'),
  ];
  const flagged = q ? q.rows.filter((x) => x.issues.length) : [];
  t.body = `${r && r.rated && dist.length ? `<h3>Stars given</h3>${H.table([{ label: 'Stars' }, { label: 'Ratings', num: 1 }], dist.map((n, i) => [`${i + 1} star${i ? 's' : ''}`, H.fmt(n)]).reverse(), '', { csv: false })}` : ''}
    <h3>Puzzles to look at</h3>${H.table([{ label: 'Theme' }, { label: 'Difficulty' }, { label: 'Games', num: 1 }, { label: 'What players did' }],
      flagged.map((x) => [H.esc(x.theme), H.esc(TIERS[x.tier] || x.tier), H.fmt(x.games), H.esc(x.issues.map((i) => i.text).join('; '))]), 'No theme and level has enough games to flag yet, or none has a problem.')}`;
  if (!r || r.rated < MIN.rated) t.findings.push({ st: 'early', text: `${H.fmt(r ? r.rated : 0)} ratings so far. ${r && r.rated ? `They average ${r1(r.avg)} stars, a good start, but` : 'At least'} ${MIN.rated} are needed before the average means much.` });
  else if (r.avg >= 4) t.findings.push({ st: 'good', text: `Puzzles average ${r1(r.avg)} stars from ${H.fmt(r.rated)} ratings, above the 4.0 mark.` });
  else t.findings.push({ st: 'act', text: `Puzzles average ${r1(r.avg)} stars, under the 4.0 mark.` });
  if (r && r.games >= 10 && r.rateShare < 0.3) {
    t.findings.push({ st: 'watch', text: `Only ${pc(r.rateShare)} of finished games get a rating, so the stars rest on few players.` });
    t.ideas.push({ text: 'Ask for the rating in one tap on the solved screen (stars only, no form)', why: `${pc(r.rateShare)} of games are rated`, impact: 'medium', effort: 'small', link: '#ratings' });
  }
  if (flagged.length) t.findings.push({ st: 'act', text: `${H.fmt(flagged.length)} theme and level pairs need attention; the worst is ${H.esc(flagged[0].theme)} at ${H.esc(TIERS[flagged[0].tier] || flagged[0].tier)}.` });
  if (openReports) {
    t.findings.push({ st: openReports > 5 ? 'act' : 'watch', text: `${H.fmt(openReports)} player problem reports are still open.` });
    t.ideas.push({ text: 'Clear the open problem reports and tell each player what was fixed', why: `${H.fmt(openReports)} open reports`, impact: 'medium', effort: 'small', link: '#errortracking' });
  }
  return t;
}

function search(d) {
  const s = d.search;
  const t = { id: 'search', title: 'Search and discoverability', intro: 'How the site shows up in Google and Bing: how often it appears, how often people click, and where it ranks.', findings: [], ideas: [] };
  if (!s) return { ...t, missing: true };
  const g = s.google || {};
  const b = s.bing || {};
  const gt = g.totals || {};
  const bt = b.totals || {};
  const sm = (g.sitemaps || [])[0] || (b.sitemaps || [])[0];
  t.tiles = [
    H.tile('Google: shown', H.fmt(gt.impressions), g.start ? `${isoLabel(g.start)} to ${isoLabel(g.end)}` : (g.connected ? 'no numbers yet' : 'not connected'), '#search'),
    H.tile('Google: clicks', H.fmt(gt.clicks), gt.ctr != null ? `${gt.ctr}% of times shown` : ''),
    H.tile('Google: average position', gt.position != null ? r1(gt.position) : '–', gt.position != null ? (gt.position <= 10 ? 'on page 1' : `page ${Math.ceil(gt.position / 10)}`) : ''),
    H.tile('Bing: shown', H.fmt(bt.impressions), b.error ? 'last refresh failed' : `${H.fmt(bt.clicks)} clicks`),
    H.tile('Pages indexed', sm && sm.indexed != null ? `${H.fmt(sm.indexed)} of ${H.fmt(sm.submitted)}` : '–', sm ? 'from the sitemap' : 'no sitemap report'),
  ];
  const queries = [...(g.queries || [])].sort((x, y) => y.impressions - x.impressions);
  t.body = `<h3>What people searched for (Google)</h3>${H.table([{ label: 'Search' }, { label: 'Shown', num: 1 }, { label: 'Clicks', num: 1 }, { label: 'Position', num: 1 }],
      queries.map((x) => [H.esc(x.key), H.fmt(x.impressions), H.fmt(x.clicks), r1(x.position)]), 'No searches recorded yet.')}
    <h3>Pages people found (Google)</h3>${H.table([{ label: 'Page' }, { label: 'Shown', num: 1 }, { label: 'Clicks', num: 1 }, { label: 'Position', num: 1 }],
      (g.pages || []).map((x) => [H.esc(String(x.key).replace(/^https?:\/\/[^/]+/, '') || '/'), H.fmt(x.impressions), H.fmt(x.clicks), r1(x.position)]), 'No pages recorded yet.')}`;
  const shown = (gt.impressions || 0) + (bt.impressions || 0);
  if (!g.connected && !gt.impressions) t.findings.push({ st: 'act', text: 'Google Search Console is not connected, so there are no Google numbers.' });
  else if (!g.connected) t.findings.push({ st: 'watch', text: 'Google Search Console is not connected right now, so these Google numbers may be old.' });
  if (shown < MIN.search) {
    t.findings.push({ st: 'early', text: `The site was shown in search ${H.fmt(shown)} times. New sites usually take a few months to build search traffic.` });
    t.ideas.push({ text: 'Publish one helpful page a week aimed at real searches ("how to solve logic grid puzzles", printable logic puzzles, logic puzzles for kids and classrooms)', why: `${H.fmt(shown)} search appearances so far`, impact: 'high', effort: 'medium', link: '#website' });
  }
  if (gt.position != null && gt.position > 10) t.findings.push({ st: 'watch', text: `The average Google position is ${r1(gt.position)}, on page ${Math.ceil(gt.position / 10)}. Few people click past page 1.` });
  const near = queries.filter((x) => x.position <= 10 && x.impressions);
  if (near.length) t.findings.push({ st: sum(near.map((x) => x.impressions)) >= 20 ? 'good' : 'early', text: `Already on page 1 for: ${near.slice(0, 3).map((x) => `"${H.esc(x.key)}"`).join(', ')}. Pages built around these searches have the best chance.` });
  if (sm && sm.indexed != null && sm.submitted && sm.indexed / sm.submitted < 0.7) t.findings.push({ st: 'watch', text: `Google has indexed ${H.fmt(sm.indexed)} of ${H.fmt(sm.submitted)} pages in the sitemap.` });
  if (b.error) t.findings.push({ st: 'watch', text: `Bing's last refresh failed (${H.esc(String(b.error).slice(0, 80))}). It tries again by itself.` });
  return t;
}

function marketing(d) {
  const m = d.marketing;
  const t = { id: 'marketing', title: 'Marketing and social', intro: 'Visits that came through tracked links and other sites, and what those visitors went on to do.', findings: [], ideas: [] };
  if (!m) return { ...t, missing: true };
  const tot = m.totals || {};
  const src = m.bySource.filter((x) => x.visit || x.play);
  t.tiles = [
    H.tile('Tracked visits', H.fmt(tot.visit), `${H.fmt(src.length)} sources`, '#marketing'),
    H.tile('Started a puzzle', pc(share(tot.play || 0, tot.visit || 0)), `${H.fmt(tot.play)} visitors`),
    H.tile('Came back', pc(share(tot.return || 0, tot.visit || 0)), `${H.fmt(tot.return)} visitors`),
    H.tile('Campaigns', H.fmt(m.campaigns), `${H.fmt(m.ads)} posts planned, ${H.fmt(m.posted)} posted`),
  ];
  t.body = `<h3>Where visitors came from</h3>${H.table([{ label: 'Source' }, { label: 'Kind' }, { label: 'Visits', num: 1 }, { label: 'Started a puzzle', num: 1 }, { label: 'Solved', num: 1 }, { label: 'Came back', num: 1 }],
    src.map((x) => [H.esc(x.source), H.esc(x.medium), H.fmt(x.visit), `${H.fmt(x.play)} (${pc(share(x.play, x.visit))})`, H.fmt(x.solve), H.fmt(x.return)]), 'No tracked visits in this period.')}`;
  if ((tot.visit || 0) < MIN.visits) t.findings.push({ st: 'early', text: `${H.fmt(tot.visit)} tracked visits. Too few to say which channel works best, but the early signs are below.` });
  const best = src.filter((x) => x.visit >= 5).sort((x, y) => share(y.play, y.visit) - share(x.play, x.visit))[0];
  if (best && best.play) t.findings.push({ st: best.visit >= 20 ? 'good' : 'early', text: `${H.esc(best.source)} (${H.esc(best.medium)}) sends the most engaged visitors so far: ${pc(share(best.play, best.visit))} of them start a puzzle.` });
  const weak = src.filter((x) => x.visit >= 5 && !x.play);
  if (weak.length) {
    t.findings.push({ st: 'watch', text: `Visitors from ${weak.map((x) => H.esc(x.source)).join(', ')} came but did not start a puzzle.` });
    t.ideas.push({ text: `Send ${weak.map((x) => x.source).join(' and ')} visitors straight into a puzzle (a link to today's puzzle, not the front page)`, why: 'Visits with no puzzle started', impact: 'medium', effort: 'small', link: '#marketing' });
  }
  if (m.ads && m.posted / m.ads < 0.3) t.findings.push({ st: 'watch', text: `${H.fmt(m.posted)} of ${H.fmt(m.ads)} planned posts have gone out.` });
  const social = src.filter((x) => x.medium === 'social' || x.medium === 'video');
  if (!social.some((x) => x.source === 'tiktok' || x.source === 'instagram')) t.ideas.push({ text: 'Test short vertical videos (a 20-second "can you solve this?" clue reveal) on Instagram Reels, TikTok and YouTube Shorts', why: 'No visits from short-video apps yet', impact: 'high', effort: 'medium', link: '#marketing' });
  return t;
}

function community(d) {
  const e = d.extra;
  const a = d.analytics;
  const t = { id: 'community', title: 'Community and player content', intro: 'Ideas, problems and storylines players send, story parts waiting for review, and messages.', findings: [], ideas: [] };
  if (!e) return { ...t, missing: true };
  const fb = e.feedback || [];
  const count = (rows, f) => rows.filter(f).reduce((s, x) => s + x.n, 0);
  const ideas = count(fb, (x) => x.kind === 'idea');
  const problems = count(fb, (x) => x.kind === 'problem');
  const waiting = count(fb, (x) => x.status === 'new');
  const st = Object.fromEntries((e.stories || []).map((x) => [x.status, x.n]));
  const stories = sum(Object.values(st));
  const parts = a ? a.review.parts : {};
  t.tiles = [
    H.tile('Ideas', H.fmt(ideas), `${H.fmt(count(fb, (x) => x.kind === 'idea' && x.status === 'new'))} not answered`, '#communication'),
    H.tile('Problems', H.fmt(problems), `${H.fmt(count(fb, (x) => x.kind === 'problem' && x.status === 'new'))} not answered`, '#communication'),
    H.tile('Storylines sent', H.fmt(stories), `${H.fmt(st.new)} waiting, ${H.fmt(st.approved)} approved`, '#story-submissions'),
    H.tile('Story parts waiting', H.fmt(parts.pending || 0), `${H.fmt(parts.approved || 0)} approved in all`, '#stories'),
    H.tile('Conversations', H.fmt(e.conversations?.n), `${H.fmt(e.conversations?.open)} open`),
    H.tile('Badges held', H.fmt(e.badges), 'special badges given'),
  ];
  t.body = `<h3>What players wrote about (this period)</h3>${H.table([{ label: 'Kind' }, { label: 'Topic' }, { label: 'Count', num: 1 }],
    (e.feedbackTopics || []).map((x) => [H.esc(x.kind), H.esc(x.topic), H.fmt(x.n)]), 'Nothing sent in this period.', { csv: false })}`;
  if (stories) t.findings.push({ st: 'good', text: `Players have sent ${H.fmt(stories)} storylines. Players want to make puzzles, not only solve them, and none of the rivals checked offers this.` });
  if ((st.new || 0) > 5) {
    t.findings.push({ st: 'act', text: `${H.fmt(st.new)} storylines are waiting for a decision. A quick answer keeps contributors coming back.` });
    t.ideas.push({ text: 'Answer waiting storylines within a week, and show approved ones with the author\'s screen name on a "Made by players" shelf', why: `${H.fmt(st.new)} storylines waiting`, impact: 'medium', effort: 'small', link: '#story-submissions' });
  }
  if (waiting > 10) t.findings.push({ st: 'watch', text: `${H.fmt(waiting)} ideas and problems have no answer yet.` });
  else if (ideas + problems) t.findings.push({ st: 'good', text: `${H.fmt(ideas + problems)} ideas and problems received; ${H.fmt(waiting)} still waiting.` });
  if ((parts.pending || 0) > 10) t.findings.push({ st: 'watch', text: `${H.fmt(parts.pending)} story parts are waiting for review.` });
  return t;
}

function education(d) {
  const e = d.extra;
  const t = { id: 'education', title: 'Education', intro: 'Teachers who ask for puzzle packages built from their lesson plans, and what they say afterwards.', findings: [], ideas: [] };
  if (!e) return { ...t, missing: true };
  const req = Object.fromEntries((e.educators || []).map((x) => [x.status, x]));
  const total = sum((e.educators || []).map((x) => x.n));
  const sent = sum((e.educators || []).map((x) => x.puzzles));
  t.tiles = [
    H.tile('Requests', H.fmt(total), `${H.fmt(req.pending?.n || 0)} waiting`, '#educators'),
    H.tile('Puzzles sent to classes', H.fmt(sent), ''),
    H.tile('Teacher feedback', H.fmt(sum((e.educatorFeedback || []).map((x) => x.n))), '', '#edu-feedback'),
  ];
  t.body = '';
  if (!total) {
    t.findings.push({ st: 'early', text: 'No teacher has asked for a puzzle package yet.' });
    t.ideas.push({ text: 'Reach teachers where they look: a free sample pack on Teachers Pay Teachers and a one-page standards map (critical thinking, reading for detail)', why: 'No educator requests yet', impact: 'high', effort: 'medium', link: '#educators' });
  } else {
    t.findings.push({ st: 'good', text: `${H.fmt(total)} teacher requests and ${H.fmt(sent)} puzzles sent to classrooms.` });
  }
  return t;
}

function money(d) {
  const e = d.extra;
  const m = d.marketing;
  const t = { id: 'money', title: 'Support and income', intro: 'Supporters, app keys, printed puzzle packs and presses of the Support button.', findings: [], ideas: [] };
  if (!e || !e.money) return { ...t, hidden: true };
  const sup = e.supporters || [];
  const active = sum(sup.map((x) => x.n));
  const lic = e.licenses || {};
  const presses = m?.totals?.support || 0;
  t.tiles = [
    H.tile('Supporters now', H.fmt(active), `${H.fmt(sum(sup.map((x) => x.added)))} new in this period`, '#supporters'),
    H.tile('Support presses', H.fmt(presses), `${pc(share(presses, m?.totals?.visit || 0))} of tracked visits`),
    H.tile('App keys in use', H.fmt(lic.active), `${H.fmt(lic.waiting)} waiting, ${H.fmt(lic.downloads)} downloads`, '#licenses'),
    H.tile('Puzzle packs printed', H.fmt(e.printPacks?.n), `${H.fmt(e.printPacks?.puzzles)} puzzles`),
  ];
  t.body = '';
  if (!active && presses) {
    t.findings.push({ st: 'watch', text: `${H.fmt(presses)} presses of Support but no supporter yet: people are curious but do not finish.` });
    t.ideas.push({ text: 'Check the Support page end to end on a phone and add a one-tap amount (for example $3) with Apple Pay and Google Pay through Stripe', why: `${H.fmt(presses)} presses, no supporters`, impact: 'medium', effort: 'small', link: '#supporters' });
  } else if (!active) {
    t.findings.push({ st: 'early', text: 'No supporters yet. With few players that is expected; income follows a habit (daily players), not visits.' });
  } else t.findings.push({ st: 'good', text: `${H.fmt(active)} supporters right now.` });
  return t;
}

function reliability(d) {
  const a = d.analytics;
  const e = d.extra || {};
  const st = d.storage;
  const al = d.alerts;
  const t = { id: 'reliability', title: 'Reliability and running costs', intro: 'Errors players hit, free allowances close to running out, and how full the database is. Everything runs on free plans.', findings: [], ideas: [] };
  if (!a) return { ...t, missing: true };
  const errors = sum(a.errors.byDay);
  const games = sum(a.games.byDay);
  const dbFull = st && st.databaseBytes && st.limits ? st.databaseBytes / st.limits.d1DatabaseBytes : null;
  t.tiles = [
    H.tile('Errors', H.fmt(errors), change(errors, e.previous?.errors), '#errortracking'),
    H.tile('Errors per 100 games', games ? r1((100 * errors) / games) : '–', ''),
    H.tile('Database', st ? H.esc(H.bytes(st.databaseBytes)) : '–', dbFull != null ? `${pc(dbFull)} of the free 500 MB` : '', '#usage'),
    H.tile('Free limit alerts', H.fmt(al ? al.alerts.length : null), al ? `Cloudflare numbers: ${al.cloudflare}` : '', '#usage'),
  ];
  t.body = `<div class="charts">${H.bars('Errors per day', a.errors.byDay, { labels: a.dayList })}</div>
    <h3>Most frequent errors</h3>${H.table([{ label: 'Error' }, { label: 'Where' }, { label: 'App' }, { label: 'Count', num: 1 }],
      (e.errorsTop || []).map((x) => [H.esc(String(x.message).slice(0, 120)), H.esc(x.place || '–'), H.esc(APPS[x.platform] || x.platform || '–'), H.fmt(x.n)]), 'No errors in this period.')}`;
  if (games >= 10 && errors / games > 0.2) {
    t.findings.push({ st: 'act', text: `${r1((100 * errors) / games)} errors for every 100 games. The top error is "${H.esc(String(e.errorsTop?.[0]?.message || '').slice(0, 60))}".` });
    t.ideas.push({ text: 'Fix the most frequent error first; it usually covers most of the reports', why: `${H.fmt(errors)} errors this period`, impact: 'high', effort: 'small', link: '#errortracking' });
  } else if (games >= 10) t.findings.push({ st: 'good', text: `${H.fmt(errors)} errors for ${H.fmt(games)} games: few players hit a problem.` });
  if (al && al.alerts.length) t.findings.push({ st: 'act', text: `${al.alerts.map((x) => H.esc(x.label)).join(', ')} close to the free limit.` });
  else if (al) t.findings.push({ st: 'good', text: 'No free allowance is close to running out.' });
  if (dbFull != null && dbFull > 0.6) t.findings.push({ st: 'watch', text: `The database is ${pc(dbFull)} full. Turn on the weekly archive in Backups.` });
  return t;
}

function otherGames(d) {
  const gs = Object.values(d.games || {}).filter(Boolean);
  const t = { id: 'games', title: 'Other games on The Logic Grid', intro: 'NINETIMESNINE and the grid-kit games: games shared in this period, by level.', findings: [], ideas: [] };
  if (!gs.length) return { ...t, missing: true };
  const all = sum(gs.map((g) => g.games));
  const flg = sum(d.analytics?.games.byDay);
  t.tiles = gs.map((g) => H.tile(g.name, H.fmt(g.games), 'games shared'));
  t.body = gs.filter((g) => g.games).map((g) => `<h3>${H.esc(g.name)}</h3>${H.table([{ label: 'Level' }, { label: 'Games', num: 1 }, { label: 'Solved', num: 1 }, { label: 'Median minutes', num: 1 }, { label: 'Hints', num: 1 }],
    g.levels.map((l) => [H.esc(l.level), H.fmt(l.games), pc(share(l.solved, l.games)), l.medianMinutes ?? '–', l.avgHints ?? '–']), '', { csv: false })}`).join('') || '<p class="muted">No games shared in this period.</p>';
  if (all < 10) {
    t.findings.push({ st: 'early', text: `${plural(all, 'game')} across the other puzzles, against ${H.fmt(flg)} of The Fantastical Logic Grid. Players mostly come for the logic grid.` });
    t.ideas.push({ text: 'Cross-promote: after a logic grid solve, offer "try a 2-minute NINETIMESNINE" as a quick second puzzle (a daily bundle like NYT Games)', why: `${plural(all, 'game')} in the other puzzles`, impact: 'medium', effort: 'small' });
  }
  return t;
}

// ------------------------------------------------------------- the market
function marketTest(d) {
  const mt = d.market;
  if (!mt) return '<p class="muted">The market test could not be read.</p>';
  return `<p>Five pass marks a puzzle game needs to keep the players it gets, measured over the last ${H.fmt(mt.days)} days (since ${H.esc(mt.since)}). A mark with too little data says "Too early" instead of pass or fail.</p>
    ${H.table([{ label: 'Mark' }, { label: 'Target', num: 1 }, { label: 'Now', num: 1 }, { label: 'Based on', num: 1 }, { label: 'Result' }],
      mt.marks.map((m) => { const [w, cls] = MARK_WORDS[m.status] || [m.status, '']; const unit = m.id === 'rating' ? '' : '%'; return [H.esc(m.label), `${m.mark}${unit}`, m.value == null ? '–' : `${m.value}${unit}`, `${H.fmt(m.n)} ${H.esc(m.unit)}`, `<span class="badge ${cls}">${w}</span>`]; }), '', { csv: false })}`;
}

function marketSection(d) {
  const M = MARKET;
  const comp = H.table([{ label: 'Who' }, { label: 'What they offer' }, { label: 'How they make money' }, { label: 'Where we stand' }],
    M.competitors.map((c) => [`<a href="${H.esc(c.url)}" target="_blank" rel="noopener">${H.esc(c.name)}</a>`, H.esc(c.offer), H.esc(c.model), H.esc(c.us)]), '', { csv: false });
  return `<div class="an-topic-body">
    <h3>Market test</h3>${marketTest(d)}
    <h3>The market</h3>${list(M.market.map((x) => `${H.esc(x.text)} ${src(x.sources)}`), '')}
    <h3>Competitors</h3>${comp}
    <h3>Where The Logic Grid stands out</h3>${list(M.strengths.map((x) => H.esc(x)), '')}
    <h3>Gaps against the leaders</h3>${list(M.gaps.map((x) => H.esc(x)), '')}
  </div>`;
}

function trendsSection() {
  const card = (x) => `<li class="an-trend"><h4>${H.esc(x.title)}</h4><p>${H.esc(x.text)}</p>${x.forUs ? `<p><b>For us:</b> ${H.esc(x.forUs)}</p>` : ''}<p class="muted small">${src(x.sources)}</p></li>`;
  return `<div class="an-topic-body">
    <h3>Puzzle and game trends</h3><ul class="an-trends">${MARKET.trends.map(card).join('')}</ul>
    <h3>Technology</h3><ul class="an-trends">${MARKET.tech.map(card).join('')}</ul>
  </div>`;
}

const src = (sources = []) => (sources.length ? `<span class="an-src">(${sources.map((s) => `<a href="${H.esc(s.url)}" target="_blank" rel="noopener">${H.esc(s.title)}</a>`).join(', ')})</span>` : '');

// Every idea from the topics plus the new builds from the research, ranked by
// impact for the effort.
function plan(topics) {
  const fromData = topics.flatMap((t) => (t.ideas || []).map((i) => ({ ...i, area: t.title, kind: 'Improve' })));
  const builds = MARKET.builds.map((b) => ({ text: b.title, why: b.why, impact: b.impact, effort: b.effort, area: b.area, kind: 'New build', sources: b.sources }));
  const all = [...fromData, ...builds];
  const score = (x) => (IMPACT[x.impact] || 1) * 2 - (EFFORT[x.effort] || 2);
  all.sort((a, b) => score(b) - score(a) || (b.kind === 'Improve') - (a.kind === 'Improve'));
  const when = (x) => (score(x) >= 4 ? 'Now' : score(x) >= 2 ? 'Next' : 'Later');
  return { all, when };
}

function planSection(topics) {
  const { all, when } = plan(topics);
  const row = (x) => [`<span class="badge ${when(x) === 'Now' ? 'ok' : when(x) === 'Next' ? 'warn' : ''}">${when(x)}</span>`, H.esc(x.kind),
    `${x.link ? `<a href="${H.esc(x.link)}">${H.esc(x.text)}</a>` : H.esc(x.text)}${x.sources ? ` ${src(x.sources)}` : ''}`, H.esc(x.why), H.esc(x.area), H.esc(x.impact), H.esc(x.effort)];
  return `<div class="an-topic-body"><p>Ranked by how much each is likely to help for the work it takes. "Improve" comes from this period's numbers; "New build" comes from the market and technology research.</p>
    ${H.table([{ label: 'When' }, { label: 'Type' }, { label: 'Suggestion' }, { label: 'Why' }, { label: 'Area' }, { label: 'Impact' }, { label: 'Effort' }], all.map(row), 'No suggestions.')}</div>`;
}

// ------------------------------------------------------------- the page
function topicHtml(t, open) {
  if (t.hidden) return '';
  const st = t.missing ? 'early' : worst(t.findings);
  if (t.missing) return `<details class="an-topic" id="an-${t.id}"><summary><span>${H.esc(t.title)}</span>${badge('early')}</summary><div class="an-topic-body"><p class="muted">This part could not be read right now. Try Refresh.</p></div></details>`;
  const ideas = t.ideas.length ? `<h3>Suggestions</h3>${list(t.ideas.map((i) => `${i.link ? `<a href="${H.esc(i.link)}">${H.esc(i.text)}</a>` : H.esc(i.text)} <span class="muted">(${H.esc(i.why)})</span>`), '')}` : '';
  return `<details class="an-topic" id="an-${t.id}"${open ? ' open' : ''}><summary><span>${H.esc(t.title)}</span>${badge(st)}</summary>
    <div class="an-topic-body"><p class="muted">${H.esc(t.intro)}</p>
      <div class="tiles">${t.tiles.join('')}</div>
      <h3>What this shows</h3>${list(t.findings.map((f) => `${badge(f.st)} ${f.text}`), 'Nothing stands out.')}
      ${ideas}
      ${t.body ? `<details class="an-more"><summary>Figures and tables</summary>${t.body}</details>` : ''}
    </div></details>`;
}

function summaryHtml(d, topics) {
  const a = d.analytics;
  const games = a ? sum(a.games.byDay) : 0;
  const solved = a ? sum(a.games.solvedByDay) : 0;
  const visits = d.visitors?.total || 0;
  const start = d.extra?.firstVisit || d.extra?.firstPlay;
  const stage = visits < 500 || games < 100 ? ['Launch stage', 'Few enough players that every figure is a first sign. The job now is reach and a daily habit; tuning comes once there is more data.']
    : visits < 5000 ? ['Early growth', 'Enough players to see patterns. Focus on what keeps players coming back.'] : ['Growing', 'Enough data to tune with confidence.'];
  const fs = topics.filter((t) => !t.hidden && !t.missing).flatMap((t) => t.findings.map((f) => ({ ...f, topic: t })));
  const good = fs.filter((f) => f.st === 'good').slice(0, 4);
  const bad = fs.filter((f) => f.st === 'act').concat(fs.filter((f) => f.st === 'watch')).slice(0, 4);
  const { all, when } = plan(topics);
  const now = all.filter((x) => when(x) === 'Now').slice(0, 3);
  return `<div class="card an-summary">
    <h2>Summary <span class="badge">${H.esc(stage[0])}</span></h2>
    <p>${H.esc(stage[1])}${start ? ` Numbers start on ${H.esc(isoLabel(start))}.` : ''}</p>
    <div class="tiles">
      ${H.tile('Visits', H.fmt(visits), change(visits, d.extra?.previous?.visits))}
      ${H.tile('Games finished', H.fmt(games), change(games, d.extra?.previous?.plays))}
      ${H.tile('Solved', pc(share(solved, games)), 'target 50% or more')}
      ${H.tile('Average rating', d.ratings && d.ratings.rated ? `${r1(d.ratings.avg)} / 5` : '–', d.ratings ? `${H.fmt(d.ratings.rated)} ratings · target 4.0` : '')}
      ${H.tile('Accounts', H.fmt(a?.players.accounts), `${H.fmt(a ? sum(a.players.newAccounts) : 0)} new`)}
    </div>
    <div class="an-cols">
      <div><h3>Working well</h3>${list(good.map((f) => `${f.text} <a href="#an-${f.topic.id}" data-an-open="${f.topic.id}" class="muted">${H.esc(f.topic.title)}</a>`), 'Nothing yet with enough data behind it.')}</div>
      <div><h3>Needs attention</h3>${list(bad.map((f) => `${badge(f.st)} ${f.text} <a href="#an-${f.topic.id}" data-an-open="${f.topic.id}" class="muted">${H.esc(f.topic.title)}</a>`), 'Nothing urgent.')}</div>
    </div>
    <h3>Do these first</h3>${list(now.map((x) => `${H.esc(x.text)} <span class="muted">(${H.esc(x.why)})</span>`), 'No suggestions.')}
  </div>`;
}

function render(d) {
  last = d;
  const topics = [audience(d), players(d), play(d), quality(d), search(d), marketing(d), community(d), education(d), money(d), reliability(d), otherGames(d)];
  const shown = topics.filter((t) => !t.hidden);
  const contents = `<nav class="an-contents" aria-label="Report contents"><h2>Contents</h2><ol>
    <li><a href="#an-summary" data-an-jump>Summary</a></li>
    <li><a href="#an-tuning" data-an-open="tuning">Self-tuning</a></li>
    ${shown.map((t) => `<li><a href="#an-${t.id}" data-an-open="${t.id}">${H.esc(t.title)}</a> ${badge(t.missing ? 'early' : worst(t.findings))}</li>`).join('')}
    <li><a href="#an-market" data-an-open="market">Performance in the market</a></li>
    <li><a href="#an-trends" data-an-open="trends">Trends and technology</a></li>
    <li><a href="#an-plan" data-an-open="plan">Suggested improvements and new builds</a></li></ol></nav>`;
  const gen = `Built ${H.esc(H.when(d.generatedAt))} from the last ${H.fmt(d.days)} days. Market and technology research from ${H.esc(isoLabel(MARKET.researchedOn))}.`;
  $('#an-body').innerHTML = `<p class="muted">${gen}</p>
    <div id="an-summary">${summaryHtml(d, topics)}</div>
    <section class="card an-tuning" id="an-tuning" aria-label="Self-tuning"><p class="muted">Loading self-tuning…</p></section>
    ${contents}
    <h2 class="an-part">By topic</h2>
    ${shown.map((t, i) => topicHtml(t, i === 0)).join('')}
    <h2 class="an-part">The market and what to build next</h2>
    <details class="an-topic" id="an-market"><summary><span>Performance in the market</span></summary>${marketSection(d)}</details>
    <details class="an-topic" id="an-trends"><summary><span>Trends and technology</span></summary>${trendsSection()}</details>
    <details class="an-topic" id="an-plan" open><summary><span>Suggested improvements and new builds</span></summary>${planSection(topics)}</details>
    <p class="muted small">${H.esc(MARKET.note)}</p>`;
}

export async function analysisView(helpers) {
  H = helpers;
  $('#an-body').innerHTML = '<p class="muted">Gathering every number. This takes a few seconds…</p>';
  const [d] = await Promise.all([H.api(`analysis?days=${$('#an-days').value}`)]);
  render(d);
  await loadTuning(H);
}

// Printing opens every topic first, so the PDF has the whole report.
function printReport() {
  const shut = $$('#an-body details:not([open])');
  shut.forEach((x) => { x.open = true; });
  document.body.classList.add('an-printing');
  const done = () => { document.body.classList.remove('an-printing'); shut.forEach((x) => { x.open = false; }); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  print();
}

export function initAnalysis(helpers, show) {
  H = helpers;
  $('#an-days').onchange = () => show('analysis');
  $('#an-refresh').onclick = () => show('analysis', { keepFocus: true });
  $('#an-print').onclick = () => { if (last) printReport(); };
  // Contents links open their topic and move to it, without changing the page address.
  $('#an-body').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-an-open], a[data-an-jump]');
    if (!a) return;
    e.preventDefault();
    const box = $(`#an-${a.dataset.anOpen || 'summary'}`);
    if (!box) return;
    if (box.tagName === 'DETAILS') box.open = true;
    box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    const s = box.querySelector('summary') || box;
    s.setAttribute('tabindex', '-1');
    s.focus({ preventScroll: true });
  });
}
