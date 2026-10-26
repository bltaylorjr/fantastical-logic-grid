// Puzzle ratings and insights: the 1 to 5 stars players give a puzzle after
// solving it (5 is excellent), from the anonymous play summaries (learn.js).
//
//   GET  /admin/v1/ratings?days=&by=   averages, the 1-5 spread and trends,
//                                      grouped by one dimension, plus the
//                                      plain-words analysis (viewer)
//   GET  /admin/v1/ratings?brief=1     only the overall numbers and analysis,
//                                      for the nightly report and the emails
//   POST /admin/v1/ratings/summary     write today's Workers AI summary again (admin)
//
// The analysis has two parts. Findings come from fixed rules over the numbers
// and are always there. The summary is a few sentences written by a free
// Workers AI text model from those findings only (never player text), at
// most ratings_ai_daily_cap times a day, and kept in rating_insights so the
// dashboard, the nightly report and the emails share it.
//
// Privacy: everything here is counted over anonymous rows. Nothing is joined
// to accounts, and a group is only flagged once it has MIN_RATED ratings.
import { THEMES } from '../../engine/src/themes.js';
import { getTopics, buildScenario } from '../../engine/src/topics.js';
import { TIERS, CLUE_TYPES } from '../../engine/src/tiers.js';
import { getSettings } from './settings.js';
import { bump } from './learn.js';

const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const round = (v, p = 2) => (v == null ? null : Math.round(v * 10 ** p) / 10 ** p);
export const MIN_RATED = 5;
export const PERIODS = [7, 30, 90, 365];
const MAX_GROUPS = 200;

const THEME = Object.fromEntries(THEMES.map((t) => [t.id, t]));
const themeName = (id) => THEME[id]?.name || id;
const tierName = (id) => TIERS[id]?.name || id;
const topicName = (theme, topic) => getTopics(theme).find((t) => t.id === topic)?.name || topic;
const PART_NAMES = { o: 'opening', i: 'incident', m: 'mishap', e: 'ending' };
const PART_LISTS = { o: 'openings', i: 'incidents', m: 'mishaps', e: 'endings' };
const WHATIF_NAMES = { none: 'No what-if steps', some: '1 to 3 what-if steps', many: '4 or more what-if steps' };
const MODE_NAMES = { free: 'Own puzzles', daily: 'Daily puzzle', race: 'Races' };

// The words of a built-in story part, so the admin can see which one it is.
function partText(theme, topic, kind, key) {
  if (!/^\d+$/.test(key)) return 'a story part added in the Story workshop';
  try {
    const t = THEME[theme];
    const tp = getTopics(theme).find((x) => x.id === topic) || getTopics(theme)[0];
    const v = buildScenario(t, tp).story[PART_LISTS[kind]][Number(key)];
    const text = typeof v === 'string' ? v : v ? `${v.name}: ${v.text}` : '';
    return text.replace(/(\{[^}]*\}\s*)+/g, '… ').replace(/^…\s*/, '… ').trim().slice(0, 90);
  } catch (e) { return ''; }
}

// One entry per way of grouping. sql: the group key; from/where: extra
// tables (json_each) and conditions; name: how the key reads to a person.
export const DIMENSIONS = {
  theme: { label: 'Theme', sql: 'plays.theme', name: (k) => themeName(k) },
  topic: { label: 'Topic', sql: "plays.theme || '/' || plays.topic", where: 'plays.topic IS NOT NULL', name: (k) => { const [a, b] = k.split('/'); return `${themeName(a)}: ${topicName(a, b)}`; } },
  tier: { label: 'Difficulty', sql: 'plays.tier', name: (k) => tierName(k) },
  themeTier: { label: 'Theme and difficulty', sql: "plays.tier || ' ' || plays.theme", name: (k) => { const [a, b] = k.split(' '); return `${tierName(a)} ${themeName(b)}`; } },
  size: { label: 'Size', sql: 'plays.size', where: 'plays.size IS NOT NULL', name: (k) => { const [a, b] = k.split('x'); return `${a} categories of ${b}`; } },
  clue: { label: 'Clue type', from: ', json_each(plays.clue_types) j', sql: 'j.key', where: 'j.value > 0', name: (k) => `${CLUE_TYPES[k] || k} clues` },
  whatif: {
    label: 'What-if reasoning', where: 'plays.whatif IS NOT NULL', name: (k) => WHATIF_NAMES[k] || k,
    sql: "CASE WHEN plays.whatif = 0 THEN 'none' WHEN plays.whatif <= 3 THEN 'some' ELSE 'many' END",
  },
  part: {
    label: 'Story part', from: ', json_each(plays.parts) j', where: "j.key IN ('o', 'i', 'm', 'e')",
    sql: "plays.theme || '/' || COALESCE(plays.topic, '') || '/' || j.key || '/' || j.value",
    name: (k) => {
      const [theme, topic, kind, key] = k.split('/');
      const text = partText(theme, topic, kind, key);
      return `${themeName(theme)}${topic ? `: ${topicName(theme, topic)}` : ''}, ${PART_NAMES[kind]} ${/^\d+$/.test(key) ? Number(key) + 1 : key}${text ? ` ("${text}")` : ''}`;
    },
  },
  story: { label: 'Story', sql: 'plays.story', where: 'plays.story IS NOT NULL', name: (k) => k },
  character: { label: 'Character', from: ', json_each(plays.chars) j', sql: 'j.value', where: 'plays.chars IS NOT NULL', name: (k, names) => names[k] || k },
  version: { label: 'App version', sql: 'plays.version', where: 'plays.version IS NOT NULL', name: (k) => `Version ${k}` },
  platform: { label: 'Platform', sql: 'plays.platform', name: (k) => ({ web: 'Web', desktop: 'Windows app', android: 'Android', ios: 'iPhone and iPad' }[k] || k) },
  mode: { label: 'Play mode', sql: 'plays.mode', where: 'plays.mode IS NOT NULL', name: (k) => MODE_NAMES[k] || k },
};

const groupSql = (d) => `SELECT ${d.sql} AS grp, COUNT(*) AS games, COUNT(plays.rating) AS rated, AVG(plays.rating) AS avg,
    SUM(plays.rating = 1) AS r1, SUM(plays.rating = 2) AS r2, SUM(plays.rating = 3) AS r3, SUM(plays.rating = 4) AS r4, SUM(plays.rating = 5) AS r5,
    SUM(plays.outcome = 'solved') AS solved, SUM(plays.outcome IN ('revealed', 'abandoned')) AS quit,
    SUM(plays.feel = 'hard') AS hard, SUM(plays.feel = 'easy') AS easy, COUNT(plays.feel) AS felt,
    AVG(CASE WHEN plays.day >= ?2 THEN plays.rating END) AS recent, COUNT(CASE WHEN plays.day >= ?2 THEN plays.rating END) AS recentN,
    AVG(CASE WHEN plays.day < ?2 THEN plays.rating END) AS earlier, COUNT(CASE WHEN plays.day < ?2 THEN plays.rating END) AS earlierN
  FROM plays${d.from || ''} WHERE plays.day >= ?1${d.where ? ` AND ${d.where}` : ''} GROUP BY grp HAVING grp IS NOT NULL
  ORDER BY rated DESC, games DESC LIMIT ${MAX_GROUPS}`;

function shape(r, name) {
  return {
    id: r.grp, name, games: r.games, rated: r.rated, avg: round(r.avg, 2), spread: [r.r1, r.r2, r.r3, r.r4, r.r5].map((x) => x || 0),
    solveRate: round(r.solved / r.games), quitRate: round(r.quit / r.games),
    tooHard: r.felt ? round(r.hard / r.felt) : null, tooEasy: r.felt ? round(r.easy / r.felt) : null,
    recent: round(r.recent, 2), recentN: r.recentN, earlier: round(r.earlier, 2), earlierN: r.earlierN,
    change: r.recentN >= MIN_RATED && r.earlierN >= MIN_RATED ? round(r.recent - r.earlier, 2) : null,
  };
}

async function characterNames(env) {
  try {
    const { results } = await env.DB.prepare('SELECT id, name FROM characters').all();
    return Object.fromEntries(results.map((c) => [c.id, c.name]));
  } catch (e) { return {}; } // no Characters section yet
}

const semver = (v) => String(v).split('.').map(Number);
const newer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

// The numbers: overall, spread, a point per day, and the groups for each
// dimension the analysis reads (all of them when `by` is not given).
export async function ratingNumbers(env, days = 30, now = Date.now(), dims = Object.keys(DIMENSIONS)) {
  const db = env.DB;
  const since = isoDay(now - (days - 1) * DAY);
  const half = isoDay(now - (Math.ceil(days / 2) - 1) * DAY);
  const all = { sql: "'all'" };
  const res = await db.batch([
    db.prepare(groupSql(all)).bind(since, half),
    db.prepare('SELECT day, COUNT(*) AS games, COUNT(rating) AS rated, AVG(rating) AS avg FROM plays WHERE day >= ?1 GROUP BY day ORDER BY day').bind(since),
    ...dims.map((k) => db.prepare(groupSql(DIMENSIONS[k])).bind(since, half)),
  ]);
  const names = dims.includes('character') ? await characterNames(env) : {};
  const o = res[0].results[0];
  const overall = o ? shape(o, 'All puzzles') : shape({ games: 0, rated: 0, r1: 0, r2: 0, r3: 0, r4: 0, r5: 0, solved: 0, quit: 0, felt: 0, recentN: 0, earlierN: 0 }, 'All puzzles');
  if (!o) { overall.solveRate = null; overall.quitRate = null; }
  overall.rateShare = overall.games ? round(overall.rated / overall.games) : null;
  const byDay = new Map(res[1].results.map((d) => [d.day, d]));
  const trend = Array.from({ length: days }, (_, i) => {
    const day = isoDay(now - (days - 1 - i) * DAY);
    const d = byDay.get(day);
    return { day, games: d ? d.games : 0, rated: d ? d.rated : 0, avg: d ? round(d.avg, 2) : null };
  });
  const groups = {};
  dims.forEach((k, i) => {
    const d = DIMENSIONS[k];
    groups[k] = res[i + 2].results.map((r) => shape(r, d.name(String(r.grp), names)));
    if (k === 'version') groups[k].sort((a, b) => newer(b.id, a.id));
  });
  return { days, since, half, minRated: MIN_RATED, overall, trend, groups };
}

// ---------------------------------------------------------------- findings
const pct = (f) => `${Math.round(f * 100)}%`;
const stars = (v) => (Math.round(v * 10) / 10).toFixed(1);
// Dimensions the rules look at, in the order a fix is most direct.
const RULE_DIMS = ['themeTier', 'topic', 'theme', 'tier', 'size', 'clue', 'whatif', 'part', 'character', 'version', 'mode', 'platform'];

function adviceFor(dim, g, groups) {
  const hard = (g.tooHard || 0) >= 0.4 || g.quitRate >= 0.4;
  const easy = (g.tooEasy || 0) >= 0.4;
  if (dim === 'clue') return `Consider using fewer ${g.name.toLowerCase()}, or pairing them with simpler clues.`;
  if (dim === 'whatif') return 'Consider fewer what-if steps (the long "if this were true" chains) at the levels that use them.';
  if (dim === 'part') return 'Consider rewriting or retiring this story part in the Story workshop.';
  if (dim === 'character') return 'Consider new lines, a different voice or a different face for this character, or unpublishing them for a while.';
  if (dim === 'version') return 'Ratings dropped with this version; check what changed in it.';
  if (dim === 'platform') return 'Check how the game looks and plays there; it may be a layout or speed problem.';
  if (hard) {
    // Point at the clue type rated lowest overall, when one stands out.
    const low = (groups.clue || []).filter((c) => c.rated >= MIN_RATED).sort((a, b) => a.avg - b.avg)[0];
    const whatif = (groups.whatif || []).find((w) => w.id === 'many');
    if (whatif && whatif.rated >= MIN_RATED && whatif.avg < 3) return 'It feels too hard: consider fewer what-if steps, fewer clues or a smaller size.';
    return `It feels too hard: consider a smaller size or fewer advanced clues${low && low.avg < 3 ? ` (${low.name.toLowerCase()} rate lowest)` : ''}.`;
  }
  if (easy) return 'It feels too easy: consider a bigger size or more advanced clues.';
  if (g.quitRate >= 0.3) return 'Many players give up: check the clues read clearly and the hints help.';
  return 'Look at its stories and clues: players solve it but do not enjoy it much.';
}

function praiseFor(dim) {
  if (dim === 'theme' || dim === 'topic' || dim === 'themeTier') return 'Keep it in the daily puzzle plan and write more stories like these.';
  if (dim === 'part') return 'This story part works well; write more like it.';
  if (dim === 'character') return 'Players like this character; give them more puzzles.';
  if (dim === 'clue') return 'Players enjoy these clues; they can be used a little more.';
  if (dim === 'version') return 'The changes in this version went down well.';
  return 'Keep doing what works here.';
}

// How a group reads at the start of a sentence, and its verb.
function subject(dim, g) {
  const lower = g.name.charAt(0).toLowerCase() + g.name.slice(1);
  if (dim === 'theme' || dim === 'tier' || dim === 'themeTier' || dim === 'topic') return [`${g.name} puzzles`, 'average'];
  if (dim === 'clue' || dim === 'size') return [`Puzzles with ${lower}`, 'average'];
  if (dim === 'whatif') return [`Puzzles with ${lower.replace(/^no /, 'no ')}`, 'average'];
  if (dim === 'character') return [`Puzzles with ${g.name}`, 'average'];
  if (dim === 'part') return [`Stories using ${g.name}`, 'average'];
  if (dim === 'mode') return [g.name, 'average'];
  if (dim === 'platform') return [`Puzzles played on ${g.name}`, 'average'];
  return [g.name, 'averages'];
}

// Plain-words findings: what is working and what to improve, biggest first.
// Each: { kind: 'good' | 'improve' | 'note', dim, id, text, advice, rated, avg }.
export function findings(n) {
  const o = n.overall;
  const out = [];
  if (!o.rated) {
    out.push({ kind: 'note', dim: null, text: o.games ? `${o.games} puzzles finished but none rated yet in this period.` : 'No puzzles finished in this period yet.', advice: 'Findings appear once players rate a few puzzles.' });
    return out;
  }
  const base = o.avg;
  const seen = new Set();
  for (const dim of RULE_DIMS) {
    for (const g of n.groups[dim] || []) {
      if (g.rated < MIN_RATED || g.rated >= o.rated) continue; // a group that is everything says nothing new
      const low = g.avg <= Math.max(2.5, base - 0.8);
      const high = g.avg >= Math.max(4.2, base + 0.5);
      if (!low && !high) continue;
      const extra = [];
      if (low && g.quitRate >= 0.3) extra.push(`${pct(g.quitRate)} gave up or revealed the answer`);
      if (low && (g.tooHard || 0) >= 0.4) extra.push(`${pct(g.tooHard)} said too hard`);
      if (low && (g.tooEasy || 0) >= 0.4) extra.push(`${pct(g.tooEasy)} said too easy`);
      if (high && g.solveRate >= 0.8) extra.push(`${pct(g.solveRate)} solved`);
      const [who, verb] = subject(dim, g);
      const text = `${who} ${verb} ${stars(g.avg)} stars from ${g.rated} ratings (all puzzles: ${stars(base)})${extra.length ? `; ${extra.join(', ')}` : ''}.`;
      // The same games seen another way (Fantasy, Quantum Physicist and Quantum Physicist Fantasy
      // when only Quantum Physicist Fantasy was played) are said once, the most exact way.
      const key = `${g.games}:${g.rated}:${g.avg}:${g.quitRate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: low ? 'improve' : 'good', dim, id: g.id, text, advice: low ? adviceFor(dim, g, n.groups) : praiseFor(dim), rated: g.rated, avg: g.avg, weight: g.rated * Math.abs(g.avg - base) });
    }
  }
  // Over time: the second half of the period against the first.
  if (o.change != null && Math.abs(o.change) >= 0.3) {
    const up = o.change > 0;
    out.push({ kind: up ? 'good' : 'improve', dim: 'trend', text: `Ratings went ${up ? 'up' : 'down'} from ${stars(o.earlier)} to ${stars(o.recent)} stars in the second half of the period.`, advice: up ? 'Recent changes are working.' : 'Look at what changed recently: new themes, stories, characters or an app update.', rated: o.rated, avg: o.avg, weight: 1e6 });
  }
  for (const g of n.groups.theme || []) {
    if (g.change != null && Math.abs(g.change) >= 0.6) {
      out.push({ kind: g.change > 0 ? 'good' : 'improve', dim: 'trend', id: g.id, text: `${g.name} ratings went ${g.change > 0 ? 'up' : 'down'} from ${stars(g.earlier)} to ${stars(g.recent)} stars.`, advice: g.change > 0 ? 'Whatever changed there is working.' : `Check recent ${g.name} stories and daily puzzles.`, rated: g.rated, avg: g.avg, weight: g.rated * Math.abs(g.change) });
    }
  }
  // The newest app version against the one before it.
  const versions = (n.groups.version || []).filter((v) => v.rated >= MIN_RATED);
  if (versions.length >= 2) {
    const [a, b] = versions;
    const d = a.avg - b.avg;
    if (Math.abs(d) >= 0.4 && !out.some((f) => f.dim === 'version' && f.id === a.id)) {
      out.push({ kind: d > 0 ? 'good' : 'improve', dim: 'version', id: a.id, text: `Version ${a.id} averages ${stars(a.avg)} stars, ${d > 0 ? 'up' : 'down'} from ${stars(b.avg)} in version ${b.id}.`, advice: d > 0 ? praiseFor('version') : adviceFor('version', a, n.groups), rated: a.rated, avg: a.avg, weight: a.rated * Math.abs(d) });
    }
  }
  if (o.games >= 20 && o.rateShare < 0.15) {
    out.push({ kind: 'note', dim: null, text: `Only ${pct(o.rateShare)} of finished puzzles were rated, so these numbers may not speak for most players.`, advice: 'Ratings stay optional; more will come as more people play.', weight: 0 });
  }
  if (!out.some((f) => f.kind !== 'note')) {
    out.push({ kind: 'note', dim: null, text: `Puzzles average ${stars(base)} stars from ${o.rated} ratings, and no group stands out yet${o.rated < 40 ? ' (each needs 5 ratings)' : ''}.`, advice: '', weight: 0 });
  }
  const top = (kind) => out.filter((f) => f.kind === kind).sort((a, b) => b.weight - a.weight).slice(0, 8);
  return [...top('improve'), ...top('good'), ...top('note')].map(({ weight, ...f }) => f);
}

// ---------------------------------------------------------------- AI summary
const SYSTEM = 'You help the maker of a logic grid puzzle game understand player ratings (1 to 5 stars, 5 is excellent). '
  + 'Using only the facts given, write 3 to 5 short, plain sentences for a non-technical reader: first what is working, then the most useful things to improve and how. '
  + 'Do not invent numbers or facts. No lists, headings or markdown.';

function factsText(n, f) {
  const o = n.overall;
  return [`Period: last ${n.days} days. ${o.games} puzzles finished, ${o.rated} rated, average ${stars(o.avg || 0)} stars, ${pct(o.solveRate || 0)} solved.`,
    ...f.map((x) => `${x.kind === 'good' ? 'Working' : x.kind === 'improve' ? 'To improve' : 'Note'}: ${x.text} ${x.advice || ''}`.trim())].join('\n').slice(0, 3500);
}

const clean = (t) => String(t || '').replace(/[*#_`>]+/g, '').replace(/^\s*[-•]\s*/gm, '').replace(/\s+/g, ' ').trim().slice(0, 1200);

// The automated tests have no Workers AI: TEST_RATINGS_AI=1 answers with the first fact.
function model(env) {
  if (env.AI) return env.AI;
  if (env.TEST_RATINGS_AI === '1') return { run: async (m, { messages }) => ({ response: `**Summary:** ${messages[1].content.split('\n')[1] || ''}` }) };
  return null;
}

async function writeSummary(env, s, n, f) {
  if (!s.ratings_ai_enabled) return { status: 'off' };
  const ai = model(env);
  if (!ai) return { status: 'not_set_up' };
  if (n.overall.rated < MIN_RATED) return { status: 'too_few' };
  if (s.ratings_ai_daily_cap <= 0 || !(await bump(env, 'ratings_ai', s.ratings_ai_daily_cap))) return { status: 'cap' };
  try {
    const out = await ai.run(s.ratings_model, { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: factsText(n, f) }], max_tokens: 320 });
    const text = clean(out && (out.response ?? out.result?.response));
    return text ? { status: 'ok', text } : { status: 'error' };
  } catch (e) {
    console.error('ratings summary', e);
    return { status: 'error' };
  }
}

export const SUMMARY_NOTES = {
  ok: '', off: 'The AI summary is switched off in Settings (Alerts and reports).', not_set_up: 'The Workers AI binding is not set up, so there is no AI summary.',
  too_few: `The AI summary starts once there are ${MIN_RATED} ratings.`, cap: 'Today\'s AI summaries are used up; the rules above still update live.', error: 'Workers AI did not answer. The rules above still work; try again later.',
};

// Numbers + findings + the day's summary (written once a day per period, or
// again when `fresh` is asked for by an admin).
export async function ratingInsights(env, days = 30, { by = null, brief = false, fresh = false, now = Date.now() } = {}) {
  const dims = brief ? RULE_DIMS : [...new Set([...RULE_DIMS, ...(by && DIMENSIONS[by] ? [by] : [])])];
  const n = await ratingNumbers(env, days, now, dims);
  const f = findings(n);
  const today = isoDay(now);
  const s = await getSettings(env, now);
  let row = null;
  try { row = await env.DB.prepare('SELECT at, summary FROM rating_insights WHERE day = ?1 AND days = ?2').bind(today, days).first(); } catch (e) { /* not migrated */ }
  let summary = row && row.summary ? { status: 'ok', text: row.summary, at: row.at } : null;
  if (!summary || fresh) {
    const w = await writeSummary(env, s, n, f);
    if (w.status === 'ok' || !summary) summary = { ...w, at: now };
    if (w.status === 'ok' || !row) {
      await env.DB.prepare(`INSERT INTO rating_insights (day, days, at, findings, summary) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT (day, days) DO UPDATE SET at = excluded.at, findings = excluded.findings, summary = COALESCE(excluded.summary, rating_insights.summary)`)
        .bind(today, days, now, JSON.stringify(f), w.status === 'ok' ? w.text : null).run().catch(() => {});
    }
  }
  summary.note = SUMMARY_NOTES[summary.status] || '';
  summary.model = s.ratings_model;
  const used = await env.DB.prepare("SELECT count FROM usage WHERE day = ?1 AND name = 'ratings_ai'").bind(today).first().catch(() => null);
  summary.usedToday = used ? used.count : 0;
  summary.cap = s.ratings_ai_daily_cap;
  const good = f.filter((x) => x.kind === 'good');
  const improve = f.filter((x) => x.kind === 'improve');
  // For the nightly report (public run log): one plain sentence and the
  // things to act on. Numbers and built-in names only, never player text.
  const o = n.overall;
  const headline = o.rated
    ? `${o.rated} rating${o.rated === 1 ? '' : 's'} in the last ${days} days, average ${stars(o.avg)} of 5 stars${o.change != null && Math.abs(o.change) >= 0.1 ? ` (${o.change > 0 ? 'up' : 'down'} ${Math.abs(o.change).toFixed(1)})` : ''}.`
    : `No ratings in the last ${days} days (${o.games} puzzles finished).`;
  const actionNeeded = improve.map((x) => `${x.text} ${x.advice || ''}`.trim());
  const base = { days, since: n.since, half: n.half, minRated: MIN_RATED, overall: n.overall, headline, actionNeeded, findings: f, good, improve, summary };
  if (brief) return base;
  const dimensions = Object.fromEntries(Object.entries(DIMENSIONS).map(([k, d]) => [k, d.label]));
  return { ...base, trend: n.trend, by: by && DIMENSIONS[by] ? by : null, groups: by && n.groups[by] ? n.groups[by] : null, dimensions, periods: PERIODS };
}

export function ratingRoutes(Refusal) {
  const period = (url) => { const d = Number(url.searchParams.get('days')) || 30; return PERIODS.includes(d) ? d : 30; };
  return [
    ['GET', /^ratings$/, 'viewer', 'ratings.view', async ({ env, url }) => {
      const by = url.searchParams.get('by');
      if (by && !DIMENSIONS[by]) throw new Refusal(400, 'bad_group', 'Unknown grouping.');
      return { body: await ratingInsights(env, period(url), { by, brief: url.searchParams.get('brief') === '1' }) };
    }],
    ['POST', /^ratings\/summary$/, 'admin', 'ratings.summary', async ({ env, url, body }) => {
      const days = PERIODS.includes(Number(body?.days)) ? Number(body.days) : period(url);
      const r = await ratingInsights(env, days, { brief: true, fresh: true });
      return { body: { summary: r.summary }, detail: { days, status: r.summary.status } };
    }],
  ];
}
